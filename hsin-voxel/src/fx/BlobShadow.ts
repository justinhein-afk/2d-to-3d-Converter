// Soft round shadows under characters (Minecraft-style), snapped to the ground below.
import * as THREE from 'three';
import { IS_SOLID } from '../world/blocks';
import type { World } from '../world/World';

let texture: THREE.Texture | null = null;

function shadowTexture(): THREE.Texture {
  if (texture) return texture;
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  texture = new THREE.CanvasTexture(cv);
  return texture;
}

export class BlobShadow {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(parent: THREE.Object3D, private readonly radius: number) {
    this.material = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.material);
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
  }

  update(world: World, x: number, y: number, z: number, scale = 1, strength = 1): void {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    let gy = -1;
    for (let yy = Math.floor(y + 0.05); yy > Math.floor(y) - 6; yy--) {
      if (IS_SOLID[world.getBlock(bx, yy - 1, bz)]) {
        gy = yy;
        break;
      }
    }
    if (gy < 0) {
      this.mesh.visible = false;
      return;
    }
    const h = y - gy;
    this.mesh.visible = true;
    this.mesh.position.set(x, gy + 0.02, z);
    const s = this.radius * 2 * scale * (1 + h * 0.15);
    this.mesh.scale.set(s, 1, s);
    this.material.opacity = Math.max(0, 1 - h / 5) * strength;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
