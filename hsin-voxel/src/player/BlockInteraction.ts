// Minecraft-style block targeting, mining (hold to break) and placing.
import * as THREE from 'three';
import { GAME } from '../config/game';
import { B, RENDER, TEX, blockDef, isBreakable } from '../world/blocks';
import { createCrackMaterial } from '../world/materials';
import { raycastVoxels, type VoxelHit } from '../world/raycast';
import type { World } from '../world/World';
import { blockDrop, isPlaceable } from '../items/items';
import type { Inventory } from '../items/Inventory';

export interface InteractionContext {
  world: World;
  inventory: Inventory;
  /** Ray start (camera position) and direction (camera forward). */
  rayOrigin: THREE.Vector3;
  rayDir: THREE.Vector3;
  /** Point reach is measured from (the player's eyes). */
  reachFrom: THREE.Vector3;
  breakHeld: boolean;
  placeClicked: boolean;
  placeHeld: boolean;
  pickClicked: boolean;
  /** Returns true if a box at a block position would hit the player or a mob. */
  blockedByEntity: (x: number, y: number, z: number) => boolean;
  onBreak: (x: number, y: number, z: number, id: number, drop: [number, number] | null) => void;
  onPlace: (x: number, y: number, z: number, id: number) => void;
  onUseItem: (id: number) => boolean;
  onInteractBlock: (x: number, y: number, z: number, id: number) => boolean;
  onMiningTick: (x: number, y: number, z: number, id: number) => void;
}

export class BlockInteraction {
  target: VoxelHit | null = null;
  private progress = 0;
  private progressKey = '';
  private breakDelay = 0;
  private placeDelay = 0;
  private hitSoundTimer = 0;
  private readonly outline: THREE.LineSegments;
  private readonly crack: THREE.Mesh;
  private readonly crackMat: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Vector3();
  /** Disabled while the Rectifier is selected or in menus. */
  enabled = true;

  constructor(scene: THREE.Scene, atlas: THREE.DataArrayTexture) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.outline.visible = false;
    this.outline.renderOrder = 2;
    this.crackMat = createCrackMaterial(atlas);
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), this.crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 3;
    scene.add(this.outline, this.crack);
  }

  /** Finds the block under the crosshair within reach of the player. */
  findTarget(ctx: Pick<InteractionContext, 'world' | 'rayOrigin' | 'rayDir' | 'reachFrom'>): VoxelHit | null {
    const reach = GAME.player.reach;
    const toEye = this.tmp.copy(ctx.reachFrom).sub(ctx.rayOrigin);
    const along = toEye.dot(ctx.rayDir);
    const minT = Math.max(0, along - 0.6);
    const hit = raycastVoxels(
      (x, y, z) => ctx.world.getBlock(x, y, z),
      ctx.rayOrigin.x, ctx.rayOrigin.y, ctx.rayOrigin.z,
      ctx.rayDir.x, ctx.rayDir.y, ctx.rayDir.z,
      Math.max(0, along) + reach + 1,
      (id) => id !== B.WATER,
    );
    if (!hit || hit.dist < minT) return null;
    const cx = hit.x + 0.5 - ctx.reachFrom.x;
    const cy = hit.y + 0.5 - ctx.reachFrom.y;
    const cz = hit.z + 0.5 - ctx.reachFrom.z;
    if (cx * cx + cy * cy + cz * cz > (reach + 0.5) * (reach + 0.5)) return null;
    return hit;
  }

  update(dt: number, ctx: InteractionContext): void {
    this.breakDelay -= dt;
    this.placeDelay -= dt;
    this.hitSoundTimer -= dt;
    this.target = this.enabled ? this.findTarget(ctx) : null;
    const t = this.target;
    this.outline.visible = !!t;
    if (t) this.outline.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);

    // Mining.
    const key = t ? `${t.x},${t.y},${t.z}` : '';
    if (!t || !ctx.breakHeld || key !== this.progressKey) {
      this.progress = 0;
      this.progressKey = key;
    }
    if (t && ctx.breakHeld && this.breakDelay <= 0 && isBreakable(t.id)) {
      const hardness = blockDef(t.id).hardness;
      this.progress += hardness <= 0 ? 1 : dt / hardness;
      if (this.hitSoundTimer <= 0) {
        ctx.onMiningTick(t.x, t.y, t.z, t.id);
        this.hitSoundTimer = 0.22;
      }
      if (this.progress >= 1) {
        this.breakBlock(ctx, t.x, t.y, t.z, t.id);
        this.progress = 0;
        this.breakDelay = 0.15;
      }
    }
    this.crack.visible = !!t && this.progress > 0.02;
    if (this.crack.visible && t) {
      this.crack.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
      this.crackMat.uniforms.uLayer.value = TEX.destroy_0 + Math.min(9, Math.floor(this.progress * 10));
    }

    // Using / placing.
    const wantsPlace = ctx.placeClicked || (ctx.placeHeld && this.placeDelay <= 0);
    if (wantsPlace && this.enabled) {
      this.placeDelay = 0.22;
      if (t && ctx.onInteractBlock(t.x, t.y, t.z, t.id)) return;
      const stack = ctx.inventory.selectedStack;
      if (stack && !isPlaceable(stack.id)) {
        if (ctx.placeClicked) ctx.onUseItem(stack.id);
        return;
      }
      if (t && stack) this.placeBlock(ctx, t, stack.id);
    }

    if (ctx.pickClicked && t && this.enabled) this.pickBlock(ctx.inventory, t.id);
  }

  private breakBlock(ctx: InteractionContext, x: number, y: number, z: number, id: number): void {
    const drop = blockDrop(id);
    ctx.world.setBlock(x, y, z, B.AIR);
    ctx.onBreak(x, y, z, id, drop);
    // Plants lose their support.
    const above = ctx.world.getBlock(x, y + 1, z);
    if (RENDER[above] === 2 || (above === B.CACTUS && id === B.CACTUS)) {
      this.breakBlock(ctx, x, y + 1, z, above);
    }
  }

  private placeBlock(ctx: InteractionContext, t: VoxelHit, id: number): void {
    let x = t.x + t.nx;
    let y = t.y + t.ny;
    let z = t.z + t.nz;
    if (blockDef(t.id).replaceable) {
      x = t.x;
      y = t.y;
      z = t.z;
    }
    if (y < 0 || y >= 128) return;
    const cur = ctx.world.getBlock(x, y, z);
    if (!blockDef(cur).replaceable) return;
    const def = blockDef(id);
    if (def.solid && ctx.blockedByEntity(x, y, z)) return;
    if (def.render === 'cross') {
      const below = ctx.world.getBlock(x, y - 1, z);
      if (cur === B.WATER || !(below === B.GRASS || below === B.DIRT || below === B.SAND)) return;
    }
    if (ctx.world.setBlock(x, y, z, id)) {
      ctx.inventory.consumeSelected();
      ctx.onPlace(x, y, z, id);
    }
  }

  private pickBlock(inv: Inventory, id: number): void {
    for (let i = 0; i < 9; i++) {
      if (inv.slots[i]?.id === id) {
        inv.selected = i;
        inv.changed();
        return;
      }
    }
    for (let i = 9; i < inv.slots.length; i++) {
      if (inv.slots[i]?.id === id && !inv.locked.has(inv.selected)) {
        const tmp = inv.slots[inv.selected];
        inv.slots[inv.selected] = inv.slots[i];
        inv.slots[i] = tmp;
        inv.changed();
        return;
      }
    }
  }

  hide(): void {
    this.outline.visible = false;
    this.crack.visible = false;
    this.target = null;
    this.progress = 0;
  }
}
