// Owns the renderer, scene and every game system; runs the main loop.
import * as THREE from 'three';
import { CameraRig } from '../camera/CameraRig';
import { GAME } from '../config/game';
import { ItemDrops } from '../entities/ItemDrops';
import { Particles } from '../fx/Particles';
import { Inventory } from '../items/Inventory';
import { I, itemDef } from '../items/items';
import { BlockInteraction } from '../player/BlockInteraction';
import { HsinAnimator, type ActionState } from '../player/HsinAnimator';
import { HsinModel } from '../player/HsinModel';
import { Player } from '../player/Player';
import { BlobShadow } from '../fx/BlobShadow';
import { ScreenShake } from '../fx/ScreenShake';
import { Telegraphs } from '../fx/Telegraphs';
import { CombatSystem } from '../combat/CombatSystem';
import { Projectiles } from '../combat/Projectiles';
import type { DamageInfo } from '../combat/types';
import { targetCenter } from '../combat/types';
import { MobManager } from '../entities/mobs/MobManager';
import type { Mob, MobContext } from '../entities/mobs/Mob';
import { SPAWNING } from '../config/mobs';
import { BossBar } from '../ui/BossBar';
import { WorldOverlay, type NumberStyle } from '../ui/WorldOverlay';
import { CombatHud } from '../ui/CombatHud';
import { HsinCombat } from '../abilities/HsinCombat';
import type { KitSave } from '../abilities/HsinKit';
import { Lightning } from '../fx/Lightning';
import { HsinAura } from '../fx/HsinAura';
import { Sfx } from '../audio/Sfx';
import { CutscenePlayer } from '../cutscenes/CutscenePlayer';
import { CUTSCENES, VIEWER_LIST } from '../cutscenes';
import { dampAngle, wrapAngle } from './math';
import { sampleLightColor } from '../world/lightProbe';
import { DebugOverlay } from '../ui/DebugOverlay';
import { el } from '../ui/dom';
import { Hotbar } from '../ui/Hotbar';
import { InventoryScreen } from '../ui/InventoryScreen';
import { PauseMenu } from '../ui/PauseMenu';
import { Toasts } from '../ui/Toasts';
import { Vitals } from '../ui/Vitals';
import { B, IS_SOLID, blockDef } from '../world/blocks';
import { raycastVoxels } from '../world/raycast';
import { createChunkMaterials, env } from '../world/materials';
import { Sky } from '../world/Sky';
import type { WorldMeta, WorldStorage } from '../world/storage';
import { BIOME_NAMES } from '../world/terrain';
import { createBlockTextureArray, type TextureAtlas } from '../world/textures';
import { World } from '../world/World';
import { Input } from './Input';
import type { Settings } from './Settings';

export type GameState = 'loading' | 'playing' | 'paused' | 'inventory' | 'dead' | 'cutscene';

export interface PlayerSave {
  version: 1;
  pos: [number, number, number];
  yaw: number;
  camYaw: number;
  camPitch: number;
  health: number;
  inventory: Array<[number, number] | null>;
  selected: number;
  time: number;
  spawn: [number, number, number];
  kit?: KitSave;
}

const STARTER_KIT: Array<[number, number]> = [
  [B.PLANKS, 32],
  [B.COBBLESTONE, 32],
  [B.GLASS, 16],
  [B.LANTERN, 8],
  [B.CRAFTING_TABLE, 1],
  [B.STONE_BRICKS, 32],
  [B.BRICKS, 16],
  [B.WOOL, 16],
  [I.COOKED_MEAT, 8],
];

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly input: Input;
  readonly world: World;
  readonly sky: Sky;
  readonly particles: Particles;
  readonly drops: ItemDrops;
  readonly player = new Player();
  readonly inventory = new Inventory();
  readonly interaction: BlockInteraction;
  readonly blockTexture: THREE.DataArrayTexture;
  readonly model = new HsinModel();
  readonly combat = new CombatSystem();
  readonly projectiles: Projectiles;
  readonly mobs: MobManager;
  readonly telegraphs: Telegraphs;
  readonly shake = new ScreenShake();
  readonly lightning: Lightning;
  readonly hsin: HsinCombat;
  readonly cutscenes: CutscenePlayer;
  readonly sfx = new Sfx();
  private readonly aura: HsinAura;
  private stepDistance = 0;
  private wasInWater = false;
  /** Seconds of near-frozen time after a big hit (impact feel). */
  private hitStop = 0;
  /** Cutscene Viewer preview in progress (from the pause menu). */
  private previewing = false;
  private previewFox = 0;
  private previewRestore: (() => void) | null = null;
  private punchCooldown = 0;
  private readonly prevPlayerPos = new THREE.Vector3();
  private readonly playerVel = new THREE.Vector3();
  readonly animator: HsinAnimator;
  private readonly shadow: BlobShadow;
  /** Current one-shot animation action (attack, cast, place, ...). */
  private action: { kind: ActionState['kind']; time: number; duration: number; stage: number } | null = null;
  /** Seconds the character keeps facing the camera after acting. */
  private combatFacing = 0;
  private readonly lightTint = new THREE.Color();
  state: GameState = 'loading';
  time = 0;
  private spawn = new THREE.Vector3();
  private needsSpawnPlacement = false;
  private autosaveTimer: number = GAME.world.autosaveSeconds;
  private last = performance.now();
  private running = false;
  private rafId = 0;
  private suppressUnlockPause = false;
  private pausedAt = -1;

  // UI
  readonly hudLayer: HTMLDivElement;
  readonly hud: CombatHud;
  private readonly screenFlash: HTMLDivElement;
  readonly toasts: Toasts;
  private readonly hotbar: Hotbar;
  private readonly vitals: Vitals;
  private readonly inventoryScreen: InventoryScreen;
  private readonly pauseMenu: PauseMenu;
  private readonly debug: DebugOverlay;
  private readonly crosshair: HTMLDivElement;
  private readonly clickHint: HTMLDivElement;
  private readonly loadingEl: HTMLDivElement;
  private readonly deathEl: HTMLDivElement;
  private readonly underwaterEl: HTMLDivElement;
  private readonly vignette: HTMLDivElement;
  readonly overlay: WorldOverlay;
  private readonly bossBar: BossBar;

  private constructor(
    private readonly container: HTMLElement,
    readonly meta: WorldMeta,
    private readonly storage: WorldStorage | null,
    readonly settings: Settings,
    atlas: TextureAtlas,
    private readonly onQuit: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;

    this.rig = new CameraRig(container.clientWidth / container.clientHeight);
    this.rig.mode = 'third';
    this.rig.setFov(settings.data.fov);
    this.input = new Input(this.renderer.domElement);
    this.input.doubleTapWindow = GAME.player.doubleTapWindow;

    this.blockTexture = createBlockTextureArray(atlas);
    const materials = createChunkMaterials(this.blockTexture);
    this.world = new World(meta.seed, meta.id, storage, materials, settings.data.renderDistance);
    this.scene.add(this.world.group);
    this.sky = new Sky(this.scene);
    this.particles = new Particles(this.scene);
    this.drops = new ItemDrops(this.scene, this.world, this.blockTexture);
    this.interaction = new BlockInteraction(this.scene, this.blockTexture);
    this.scene.add(this.model.root);
    this.animator = new HsinAnimator(this.model);
    this.shadow = new BlobShadow(this.scene, 0.45);
    this.lightning = new Lightning(this.scene);
    this.aura = new HsinAura(this.particles, this.lightning);
    this.projectiles = new Projectiles(this.scene, this.world, this.combat, this.particles);
    this.mobs = new MobManager(this.scene, this.world, this.combat, this.drops, this.particles);
    this.telegraphs = new Telegraphs(this.scene);
    this.projectiles.playerBox = () => {
      const b = this.player.body;
      return new THREE.Box3(
        new THREE.Vector3(b.pos.x - b.halfWidth, b.pos.y, b.pos.z - b.halfWidth),
        new THREE.Vector3(b.pos.x + b.halfWidth, b.pos.y + b.height, b.pos.z + b.halfWidth),
      );
    };
    this.projectiles.hitPlayer = (spec, point) =>
      spec.damage ? this.hitPlayer({ ...spec.damage, source: point.clone().sub(spec.vel.clone().normalize()) }) : false;
    this.combat.onHit = (target, info, dealt) => {
      const c = targetCenter(target, new THREE.Vector3());
      c.y += target.hitHeight * 0.3;
      const style: NumberStyle = info.kind === 'liberation' ? 'big' : info.crit ? 'crit' : info.element === 'electro' ? 'electro' : 'normal';
      this.overlay.addNumber(c, dealt, style);
      this.hsin.onDamageDealt(target, info);
      this.hitSparks(c, info);
      this.sfx.play(info.crit ? 'crit' : 'hit', c, 0.05);
      if (target.team === 'neutral') this.sfx.play('animal', c, 0.2);
      else this.sfx.play('mobHurt', c, 0.12);
      const big = info.kind === 'realm' || info.kind === 'mechanism' || info.kind === 'liberation';
      if (big) this.hitStop = Math.max(this.hitStop, GAME.feel.hitStopBig);
      else if (info.crit || info.kind === 'heavy') this.hitStop = Math.max(this.hitStop, GAME.feel.hitStopSmall);
    };
    this.mobs.onKilled = (m) => {
      this.hsin.onKill();
      this.sfx.play('mobDie', m.position.clone(), 0.05);
    };

    // ---- UI ----
    this.hudLayer = el('div', 'layer', container);
    this.underwaterEl = el('div', 'underwater-tint hidden', this.hudLayer);
    this.vignette = el('div', 'damage-vignette', this.hudLayer);
    this.crosshair = el('div', 'crosshair', this.hudLayer);
    this.vitals = new Vitals(this.hudLayer);
    this.hotbar = new Hotbar(this.hudLayer, this.inventory);
    this.toasts = new Toasts(this.hudLayer);
    this.overlay = new WorldOverlay(this.hudLayer);
    this.hud = new CombatHud(this.hudLayer);
    this.screenFlash = el('div', 'screen-flash', this.hudLayer);
    this.cutscenes = new CutscenePlayer(this, this.hudLayer);
    this.bossBar = new BossBar(this.hudLayer);
    this.debug = new DebugOverlay(this.hudLayer);
    this.debug.setFpsVisible(settings.data.showFps);
    this.clickHint = el('div', 'click-to-play hidden', this.hudLayer, 'Click to capture the mouse (or right-drag to look)');
    this.inventoryScreen = new InventoryScreen(container, this.inventory);
    this.inventoryScreen.onClose = () => this.closeInventory(false);
    this.inventoryScreen.onDrop = (s) => this.dropStack(s.id, s.count);
    this.pauseMenu = new PauseMenu(container, settings, {
      resume: () => this.resume(),
      save: () => this.save(),
      quit: () => void this.quitToTitle(),
    });
    this.pauseMenu.addTab('Cutscenes', (c) => this.buildViewer(c));
    this.loadingEl = el('div', 'loading', container);
    el('div', 'spinner', this.loadingEl);
    el('div', '', this.loadingEl, 'Generating terrain…');
    this.deathEl = el('div', 'screen hidden', container);
    const deathCard = el('div', 'panel title-card', this.deathEl);
    el('h2', '', deathCard, 'Hsin has fallen');
    el('div', 'subtitle', deathCard, 'The Moon Fox will rise again.');
    const respawn = el('button', 'btn primary', deathCard, 'Respawn');
    respawn.addEventListener('click', () => this.respawn());

    this.hsin = new HsinCombat(this);
    settings.onChange((s) => this.applySettings(s));
    this.applySettings(settings.data);

    this.input.setLockListener((locked) => {
      if (!locked && this.state === 'playing' && !this.suppressUnlockPause) this.pause();
      this.suppressUnlockPause = false;
    });
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === 'playing') this.input.requestLock();
    });
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.player.onFallDamage = (amount) => this.damagePlayer(amount, 'fall');
    this.player.onJump = () => this.sfx.play('jump');
    this.player.onLand = (fall) => {
      if (fall > 1.2) {
        this.sfx.play('land');
        this.dust(Math.min(14, 4 + fall * 2));
      }
    };
    window.addEventListener('pointerdown', this.unlockAudio);
    window.addEventListener('keydown', this.unlockAudio);
    this.inventoryScreen.onCraft = () => this.sfx.play('craft');
  }

  static async create(
    container: HTMLElement,
    meta: WorldMeta,
    storage: WorldStorage | null,
    settings: Settings,
    atlas: TextureAtlas,
    isNew: boolean,
    onQuit: () => void,
  ): Promise<Game> {
    const game = new Game(container, meta, storage, settings, atlas, onQuit);
    await game.world.init();
    const save = !isNew && storage ? await storage.loadPlayer<PlayerSave>(meta.id) : null;
    if (save) game.loadPlayer(save);
    else game.newPlayer();
    meta.lastPlayed = Date.now();
    if (storage) await storage.saveWorldMeta(meta);
    return game;
  }

  private newPlayer(): void {
    const s = this.world.generator.findSpawnColumn();
    this.spawn.set(s.x, s.height + 1, s.z);
    this.player.setPosition(s.x, s.height + 1, s.z);
    this.needsSpawnPlacement = true;
    this.hsin.ensureRectifier((id, n) => this.dropStack(id, n));
    for (const [id, n] of STARTER_KIT) this.inventory.add(id, n);
    this.inventory.selected = 0;
    this.sky.time = GAME.world.startTime;
  }

  private loadPlayer(s: PlayerSave): void {
    this.player.setPosition(s.pos[0], s.pos[1], s.pos[2]);
    this.player.yaw = s.yaw;
    this.rig.yaw = s.camYaw;
    this.rig.pitch = s.camPitch;
    this.player.health = Math.max(1, s.health);
    this.inventory.load(s.inventory);
    this.inventory.selected = s.selected ?? 0;
    this.sky.time = s.time;
    this.spawn.set(s.spawn[0], s.spawn[1], s.spawn[2]);
    this.hsin.ensureRectifier((id, n) => this.dropStack(id, n));
    this.hsin.kit.load(s.kit);
    this.model.setForm(this.hsin.kit.form);
  }

  private playerSave(): PlayerSave {
    const p = this.player.position;
    return {
      version: 1,
      pos: [p.x, p.y, p.z],
      yaw: this.player.yaw,
      camYaw: this.rig.yaw,
      camPitch: this.rig.pitch,
      health: this.player.health,
      inventory: this.inventory.serialize(),
      selected: this.inventory.selected,
      time: this.sky.time,
      spawn: [this.spawn.x, this.spawn.y, this.spawn.z],
      kit: this.hsin.kit.serialize(),
    };
  }

  async save(): Promise<void> {
    if (!this.storage) return;
    try {
      await this.world.saveAll();
      await this.storage.savePlayer(this.meta.id, this.playerSave());
      this.meta.lastPlayed = Date.now();
      await this.storage.saveWorldMeta(this.meta);
    } catch (err) {
      console.error('Save failed', err);
      this.toasts.show('Saving failed (see console).');
    }
  }

  start(): void {
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * Advances the game by one frame. Exposed so automated tests can step deterministically;
   * they may skip rendering for speed.
   */
  frame(now: number, render = true): void {
    const t0 = performance.now();
    const realDt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let dt = realDt;
    if (this.hitStop > 0) {
      // Hit-stop: the world nearly freezes for a few frames so big hits feel heavy.
      this.hitStop -= realDt;
      dt *= GAME.feel.hitStopTimeScale;
    }
    this.time += dt;
    this.input.now = this.time;
    this.update(dt);
    if (render) this.renderer.render(this.scene, this.rig.camera);
    this.input.endFrame();
    if (this.debug.tick(realDt, performance.now() - t0)) this.updateDebugText();
  }

  private update(dt: number): void {
    const input = this.input;
    const p = this.player;

    // Global keys.
    if (input.actionPressed('debug')) this.debug.toggle();
    if (input.actionPressed('pause')) {
      if (this.state === 'playing' || this.state === 'cutscene') this.pause();
      else if (this.state === 'paused' && this.time - this.pausedAt > 0.3) this.resume();
      else if (this.state === 'inventory') this.closeInventory(true);
    }
    if (input.actionPressed('inventory')) {
      if (this.state === 'playing') this.openInventory(false);
      else if (this.state === 'inventory') this.closeInventory(true);
    }

    if (this.state === 'cutscene' && input.keyPressed('Space')) this.cutscenes.skip();

    // World streaming continues in every state so the view fills in.
    this.world.update(p.position.x, p.position.z);

    if (this.state === 'loading') {
      const ready = this.world.areaReady(p.position.x, p.position.z, 1);
      if (ready) {
        if (this.needsSpawnPlacement) this.placeAtSpawn();
        this.state = 'playing';
        this.loadingEl.remove();
        this.input.requestLock();
      }
    }

    const playing = this.state === 'playing';
    input.enabled = playing;

    if (playing) {
      // Mouse movement arrives while the mouse is captured, or while right-dragging without capture.
      if (input.mouseDX !== 0 || input.mouseDY !== 0) {
        this.rig.applyMouse(input.mouseDX, input.mouseDY, this.settings.data.mouseSensitivity, this.settings.data.invertY);
      }
      if (input.wheel !== 0) this.rig.applyZoom(input.wheel);
      if (input.actionPressed('toggleView')) this.rig.mode = this.rig.mode === 'first' ? 'third' : 'first';
      const slot = input.hotbarPressed();
      if (slot >= 0) {
        if (slot !== this.inventory.selected) this.sfx.play('select');
        this.inventory.selected = slot;
        this.inventory.changed();
      }
      if (input.actionPressed('drop')) this.dropSelected();
    }

    // Player physics (frozen until the chunk under them exists).
    if (this.state !== 'loading' && this.world.isLoadedAt(p.position.x, p.position.z) && this.state !== 'dead') {
      const fwd = (input.action('forward') ? 1 : 0) - (input.action('back') ? 1 : 0);
      const str = (input.action('right') ? 1 : 0) - (input.action('left') ? 1 : 0);
      if (input.doubleTapForward) p.sprinting = true;
      const sprint = input.action('sprint') || (p.sprinting && fwd > 0);
      p.autoJump = this.settings.data.autoJump;
      if (playing && input.actionPressed('dodge')) this.tryDodge(fwd, str);
      p.update(dt, { forward: playing ? fwd : 0, strafe: playing ? str : 0, jumpHeld: input.action('jump'), sprint, cameraYaw: this.rig.yaw }, this.world);
      this.updateFacing(dt);
    }

    // Hsin's kit (attacks, skills, forms) runs before the character is posed.
    const canAct = playing && !p.dead;
    this.hsin.update(dt, canAct && !this.previewing, this.state !== 'paused' && this.state !== 'loading' && !this.previewing);
    if (this.state !== 'paused') this.cutscenes.update(dt);
    if (this.previewFox > 0) {
      this.previewFox -= dt;
      if (this.previewFox <= 0) this.endPreview();
    }
    this.rig.update(dt, p.position, this.hsin.kit.fox ? 0.7 : GAME.player.eyeHeight, this.world, this.hsin.pivotHeight);
    const cam = this.rig.camera;
    this.updateCharacter(dt);

    // Block targeting / mining / placing (or punching a mob under the crosshair).
    this.punchCooldown -= dt;
    if (playing) {
      const eye = new THREE.Vector3(p.position.x, p.position.y + GAME.player.eyeHeight, p.position.z);
      const blockMode = this.hsin.blockMode;
      const punched = blockMode && input.mouseClicked(0) && this.tryPunch(eye);
      this.interaction.enabled = blockMode && !punched;
      this.interaction.update(dt, {
        world: this.world,
        inventory: this.inventory,
        rayOrigin: cam.position,
        rayDir: this.rig.forward,
        reachFrom: eye,
        breakHeld: input.mouse(0),
        placeClicked: input.mouseClicked(2),
        placeHeld: input.mouse(2),
        pickClicked: input.mouseClicked(1),
        blockedByEntity: (x, y, z) => this.blockOverlapsPlayer(x, y, z),
        onBreak: (x, y, z, id, drop) => {
          this.particles.blockBreak(x, y, z, blockDef(id).color);
          this.sfx.block('break', blockDef(id).sound, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
          if (drop) this.drops.spawn(drop[0], drop[1], x + 0.5, y + 0.3, z + 0.5);
        },
        onPlace: (x, y, z, id) => {
          this.playAction('place', 0.3);
          this.sfx.block('place', blockDef(id).sound, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
        },
        onUseItem: (id) => this.useItem(id),
        onInteractBlock: (_x, _y, _z, id) => {
          if (id === B.CRAFTING_TABLE) {
            this.openInventory(true);
            return true;
          }
          return false;
        },
        onMiningTick: (x, y, z, id) => {
          if (!this.action || this.action.kind === 'mine') this.playAction('mine', 0.4);
          this.sfx.block('hit', blockDef(id).sound, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
        },
      });
    } else {
      this.interaction.hide();
    }

    const simulate = this.state !== 'paused' && this.state !== 'loading';
    const worldFrozen = this.cutscenes.freezing || this.previewing;
    this.drops.freeze = !simulate || worldFrozen;
    this.drops.update(dt, p.position, (id, count) => {
      const left = this.inventory.add(id, count);
      if (left < count) this.sfx.play('pickup', undefined, 0.06);
      return count - left;
    });
    this.updateEnemies(dt, simulate && !worldFrozen);
    this.particles.freeze = !simulate;
    this.particles.update(dt);
    this.particles.setViewport(this.renderer.domElement.height, cam.fov);

    // Environment.
    const camBlock = this.world.getBlock(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z));
    this.sky.underwater = camBlock === B.WATER;
    this.underwaterEl.classList.toggle('hidden', !this.sky.underwater);
    this.sky.update(dt, cam, this.world.renderDistance, this.state === 'paused');
    env.uTime.value = this.time;
    env.uPlayerLightPos.value.set(p.position.x, p.position.y + 1.4, p.position.z);
    cam.far = Math.max(this.world.renderDistance * 16 * 1.6, 420);
    cam.updateProjectionMatrix();
    this.shake.strength = this.settings.data.cameraShake;
    this.shake.update(dt, this.rig);
    this.lightning.freeze = this.state === 'paused';
    this.lightning.update(dt, cam);
    this.sfx.setListener(cam);
    if (this.state !== 'paused') this.updateAmbience(dt);
    this.overlay.update(dt, cam, this.mobs.mobs, (m) => this.mobs.occluded(m as Mob, cam.position, this.time));
    this.hud.update(this.hsin.kit, this.hsin.weaponSelected, playing || this.state === 'inventory');
    this.crosshair.classList.toggle('combat', this.hsin.weaponSelected && !this.hsin.kit.fox);
    const elite = this.mobs.engagedElite(p.position);
    if (elite) this.bossBar.show(elite.def.name, elite.def.level, elite.health, elite.def.maxHealth, dt);
    else this.bossBar.hide();

    // HUD.
    this.hotbar.update(dt);
    this.vitals.update(dt, p);
    this.crosshair.classList.toggle('hidden', !playing);
    this.clickHint.classList.toggle('hidden', !(playing && !input.locked));

    // Autosave.
    if (this.state === 'playing') {
      this.autosaveTimer -= dt;
      if (this.autosaveTimer <= 0) {
        this.autosaveTimer = GAME.world.autosaveSeconds;
        void this.save();
      }
    }
  }

  /** An enemy attack reaches Hsin. Returns false if she avoided it (dodge invulnerability). */
  hitPlayer(info: DamageInfo): boolean {
    const p = this.player;
    if (p.dead || p.invulnerable) return false;
    const mod = this.hsin.incoming(info);
    this.damagePlayer(mod.amount, 'enemy');
    if (mod.knockback > 0) {
      const dir = new THREE.Vector3(p.position.x - info.source.x, 0, p.position.z - info.source.z);
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
      dir.normalize().multiplyScalar(mod.knockback);
      p.impulse.add(dir);
      if (p.onGround) p.body.vel.y = Math.max(p.body.vel.y, Math.min(7, mod.knockback * 0.5));
    }
    this.shake.add(Math.min(0.6, 0.15 + info.knockback * 0.03));
    const c = p.position.clone();
    c.y += 1.9;
    this.overlay.addNumber(c, mod.amount, 'player');
    return true;
  }

  /** Small burst of sparks where a hit lands. */
  private hitSparks(c: THREE.Vector3, info: DamageInfo): void {
    const color = info.element === 'electro' ? (info.crit ? 0xffe08a : 0xd0a0ff) : 0xffffff;
    const n = info.crit ? 14 : 8;
    for (let i = 0; i < n; i++) {
      this.particles.spark({
        x: c.x, y: c.y, z: c.z,
        vx: (Math.random() - 0.5) * 7, vy: (Math.random() - 0.2) * 6, vz: (Math.random() - 0.5) * 7,
        color, size: 0.12, life: 0.25 + Math.random() * 0.15, drag: 4, gravity: 6,
      });
    }
  }

  // ---- CombatHost hooks ----
  destructive(): boolean {
    return this.settings.data.destructiveAbilities;
  }

  toast(text: string): void {
    this.toasts.show(text);
  }

  sound(name: string, pos?: THREE.Vector3): void {
    this.sfx.play(name, pos);
  }

  private readonly unlockAudio = () => {
    this.sfx.unlock();
    this.sfx.setVolume(this.settings.data.masterVolume);
  };

  /** Footsteps, sprint dust, splashes and Hsin's Electro aura. */
  private updateAmbience(dt: number): void {
    const p = this.player;
    const pos = p.position;
    const fox = this.hsin.kit.fox;
    if (p.onGround && p.speed > 1 && !p.dodging) {
      this.stepDistance += p.speed * dt;
      const stride = fox ? 1.3 : p.sprinting ? 2.1 : 1.7;
      if (this.stepDistance >= stride) {
        this.stepDistance = 0;
        const below = this.world.getBlock(Math.floor(pos.x), Math.floor(pos.y - 0.2), Math.floor(pos.z));
        if (below !== B.AIR) this.sfx.block('step', blockDef(below).sound, pos);
        if (p.sprinting || fox) this.dust(3);
      }
    }
    if (!this.wasInWater && p.inWater && p.body.vel.y < -2) {
      this.sfx.play('splash', pos.clone());
      for (let i = 0; i < 24; i++) {
        this.particles.bit({
          x: pos.x + (Math.random() - 0.5) * 0.8, y: pos.y + 0.6, z: pos.z + (Math.random() - 0.5) * 0.8,
          vx: (Math.random() - 0.5) * 3, vy: 3 + Math.random() * 3, vz: (Math.random() - 0.5) * 3,
          color: Math.random() < 0.5 ? 0xd8ecff : 0x6f9fff, size: 0.1, life: 0.6, gravity: 14,
        });
      }
    }
    this.wasInWater = p.inWater;
    const k = this.hsin.kit;
    this.aura.update(dt, {
      rectifier: this.model.rectifierWorld(new THREE.Vector3()),
      feet: pos,
      illumining: k.form === 'illumining',
      dominion: k.dominion,
      fox,
      dodging: p.dodging,
      visible: this.model.root.visible || this.hsin.fox.root.visible,
      charge: k.charge,
    });
  }

  /** Little puffs of ground-coloured dust at her feet. */
  private dust(n: number): void {
    const pos = this.player.position;
    const below = this.world.getBlock(Math.floor(pos.x), Math.floor(pos.y - 0.2), Math.floor(pos.z));
    if (below === B.AIR || below === B.WATER) return;
    const color = blockDef(below).color;
    for (let i = 0; i < n; i++) {
      this.particles.bit({
        x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y + 0.05, z: pos.z + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 1.6, vy: 0.6 + Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.6,
        color, size: 0.07, life: 0.4, gravity: 6, drag: 2,
      });
    }
  }

  flashScreen(color: string, seconds: number, strength = 1): void {
    const f = this.screenFlash;
    f.style.transition = 'none';
    f.style.background = color;
    f.style.opacity = String(strength);
    void f.offsetWidth;
    f.style.transition = `opacity ${seconds}s ease-out`;
    f.style.opacity = '0';
  }

  private updateEnemies(dt: number, simulate: boolean): void {
    const p = this.player;
    if (dt > 0) this.playerVel.copy(p.position).sub(this.prevPlayerPos).divideScalar(dt);
    this.prevPlayerPos.copy(p.position);
    const ctx: MobContext = {
      world: this.world,
      playerPos: p.position,
      playerVel: this.playerVel,
      playerAlive: !p.dead && this.state !== 'loading',
      projectiles: this.projectiles,
      particles: this.particles,
      hitPlayer: (info) => this.hitPlayer(info),
      telegraph: (x, y, z, r, t) => this.telegraphs.draw(x, y, z, r, t),
      shake: (a) => this.shake.add(a),
      sound: (name, pos) => this.sfx.play(name, pos, 0.08),
      daylight: this.sky.daylight,
    };
    this.mobs.freeze = !simulate;
    this.mobs.update(dt, ctx, this.sky.isNight);
    this.projectiles.freeze = !simulate;
    this.projectiles.update(dt);
    this.telegraphs.endFrame();
  }

  /** Minecraft-style punch when a mob is under the crosshair and closer than any block. */
  private tryPunch(eye: THREE.Vector3): boolean {
    if (this.punchCooldown > 0) return false;
    const cam = this.rig.camera.position;
    const dir = this.rig.forward;
    const along = Math.max(0, eye.clone().sub(cam).dot(dir));
    let hit = this.combat.raycast(cam, dir, along + GAME.player.reach, 'enemy') ?? this.combat.raycast(cam, dir, along + GAME.player.reach, 'neutral');
    if (hit && hit.dist < along - 0.5) hit = null;
    const block = this.interaction.findTarget({ world: this.world, rayOrigin: cam, rayDir: dir, reachFrom: eye });
    if (!hit) {
      // Over-the-shoulder aim misses close targets slightly; assist within a small cone from her eyes.
      const reach = 3.2;
      const t = this.combat.aimAssist(eye, dir, reach, Math.cos(0.45), 'enemy') ?? this.combat.aimAssist(eye, dir, reach, Math.cos(0.45), 'neutral');
      if (!t) return false;
      const d = targetCenter(t, new THREE.Vector3()).distanceTo(cam);
      hit = { target: t, dist: d };
      if (block && block.dist < d - 1) return false;
    } else if (block && block.dist < hit.dist) return false;
    this.punchCooldown = 0.45;
    this.playAction('place', 0.3);
    const amount = SPAWNING.punchDamage * (0.9 + Math.random() * 0.2);
    this.combat.hit(hit.target, { amount, element: 'physical', kind: 'punch', source: this.player.position.clone(), knockback: SPAWNING.punchKnockback });
    return true;
  }

  playAction(kind: ActionState['kind'], duration: number, stage = 0): void {
    this.action = { kind, time: 0, duration, stage };
    if (kind !== 'hurt' && kind !== 'eat') this.combatFacing = Math.max(this.combatFacing, duration + 0.3);
  }

  private currentAction(): ActionState | null {
    const a = this.action;
    if (!a) return null;
    const t = Math.min(1, a.time / a.duration);
    switch (a.kind) {
      case 'attack':
        return { kind: 'attack', stage: a.stage, t };
      case 'charge':
        return { kind: 'charge', amount: t };
      default:
        return { kind: a.kind, t } as ActionState;
    }
  }

  private tryDodge(fwd: number, str: number): void {
    const p = this.player;
    const dir = new THREE.Vector3();
    if (fwd !== 0 || str !== 0) {
      const sin = Math.sin(this.rig.yaw);
      const cos = Math.cos(this.rig.yaw);
      dir.set(-sin * fwd + cos * str, 0, -cos * fwd - sin * str);
    } else {
      // No direction held: hop backward, away from where she faces.
      dir.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    }
    if (p.tryDodge(dir)) {
      this.sfx.play('dodge');
      this.action = null;
    }
  }

  /** Turns the character toward movement, or toward the crosshair while acting. */
  private updateFacing(dt: number): void {
    const p = this.player;
    this.combatFacing = Math.max(0, this.combatFacing - dt);
    let target = p.yaw;
    if (p.dodging) {
      // Face the dash direction unless dashing backward.
      const back = p.dodgeDir.x * Math.sin(p.yaw) + p.dodgeDir.z * Math.cos(p.yaw) > 0.7;
      if (!back) target = Math.atan2(-p.dodgeDir.x, -p.dodgeDir.z);
    } else if (this.combatFacing > 0 || this.hsin.acting || this.rig.mode === 'first') {
      target = this.rig.yaw;
    } else if (p.moveDir.lengthSq() > 0.01 && p.speed > 0.3) {
      target = Math.atan2(-p.moveDir.x, -p.moveDir.z);
    }
    p.yaw = wrapAngle(dampAngle(p.yaw, target, this.combatFacing > 0 ? 22 : 12, dt));
  }

  private updateCharacter(dt: number): void {
    const p = this.player;
    const m = this.model;
    if (this.action) {
      this.action.time += dt;
      if (this.action.time >= this.action.duration) this.action = null;
    }
    m.root.position.copy(p.position);
    m.root.rotation.y = p.yaw + Math.PI;
    // Dodge direction relative to the body.
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    this.animator.update(dt, {
      speed: p.speed,
      walkSpeed: GAME.player.walkSpeed,
      sprinting: p.sprinting,
      onGround: p.onGround,
      vy: p.body.vel.y,
      inWater: p.inWater,
      headInWater: p.body.headInWater,
      dodge: p.dodgeProgress,
      dodgeX: p.dodgeDir.x * rx + p.dodgeDir.z * rz,
      dodgeZ: p.dodgeDir.x * fx + p.dodgeDir.z * fz,
      action: this.hsin.animAction() ?? this.currentAction(),
      lookPitch: this.rig.pitch,
      lookYaw: wrapAngle(this.rig.yaw - p.yaw),
      pose: this.cutscenes.pose()?.pose ?? null,
      poseT: this.cutscenes.pose()?.t ?? 0,
    });
    m.update(dt);
    sampleLightColor(this.world, p.position.x, p.position.y + 1.2, p.position.z, this.lightTint);
    m.setLight(this.lightTint);
    const fox = this.hsin.kit.fox || this.previewFox > 0;
    const visible = this.rig.override !== null || (this.rig.mode === 'third' && this.rig.distance > 0.7);
    m.setVisible(visible && !fox);
    this.hsin.fox.setVisible(visible && fox);
    if (fox) this.hsin.updateFox(dt, this.lightTint);
    this.shadow.update(this.world, p.position.x, p.position.y, p.position.z, fox ? 0.8 : 1, visible ? 1 : 0);
  }

  /** Puts the player on open ground near the spawn column (not on top of a tree). */
  private placeAtSpawn(): void {
    const sx = Math.floor(this.spawn.x);
    const sz = Math.floor(this.spawn.z);
    const ground = new Set<number>([B.GRASS, B.DIRT, B.SAND, B.SNOW, B.STONE, B.GRAVEL, B.SANDSTONE]);
    // Open ground around her, so the first view isn't squeezed against a tree or a cliff.
    const roomy = (x: number, top: number, z: number): boolean => {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = 1; dy <= 4; dy++) if (this.world.isSolid(x + dx, top + dy, z + dz)) return false;
        }
      }
      return true;
    };
    const search = (radius: number, needRoom: boolean): [number, number, number] | null => {
      for (let r = 0; r <= radius; r++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const x = sx + dx;
            const z = sz + dz;
            const top = this.world.topSolidY(x, z);
            if (top <= 0 || !ground.has(this.world.getBlock(x, top, z))) continue;
            if (!needRoom || roomy(x, top, z)) return [x, top + 1, z];
          }
        }
      }
      return null;
    };
    const [x, y, z] = search(16, true) ?? search(12, false) ?? [sx, this.world.topSolidY(sx, sz) + 1, sz];
    this.spawn.set(x + 0.5, y, z + 0.5);
    this.player.setPosition(x + 0.5, y, z + 0.5);
    this.needsSpawnPlacement = false;

    // Face the most open direction: room behind her for the camera, then the longest view ahead.
    const get = (bx: number, by: number, bz: number) => this.world.getBlock(bx, by, bz);
    const solid = (id: number) => IS_SOLID[id] === 1;
    const feet = new THREE.Vector3(x + 0.5, y, z + 0.5);
    let bestYaw = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < 8; i++) {
      const yaw = (i * Math.PI) / 4;
      this.rig.yaw = yaw;
      const behind = this.rig.clearDistance(feet, this.world);
      const ahead = raycastVoxels(get, feet.x, y + GAME.camera.pivotHeight, feet.z, -Math.sin(yaw), 0, -Math.cos(yaw), 24, solid)?.dist ?? 24;
      const score = (behind >= this.rig.zoom - 0.01 ? 100 : behind * 10) + ahead;
      if (score > bestScore) {
        bestScore = score;
        bestYaw = yaw;
      }
    }
    this.rig.yaw = bestYaw;
    this.player.yaw = bestYaw;
    // Start at the right distance instead of easing out from wherever the camera was while loading.
    this.rig.distance = this.rig.clearDistance(feet, this.world);
  }

  private blockOverlapsPlayer(x: number, y: number, z: number): boolean {
    const b = this.player.body;
    return (
      x + 1 > b.pos.x - b.halfWidth && x < b.pos.x + b.halfWidth &&
      y + 1 > b.pos.y && y < b.pos.y + b.height &&
      z + 1 > b.pos.z - b.halfWidth && z < b.pos.z + b.halfWidth
    );
  }

  private useItem(id: number): boolean {
    const def = itemDef(id);
    if (def?.kind === 'food' && def.heal) {
      if (this.player.health >= this.player.maxHealth) {
        this.toasts.show('Already at full health.');
        return false;
      }
      this.player.heal(this.player.maxHealth * def.heal);
      this.inventory.consumeSelected();
      this.playAction('eat', 0.6);
      this.sfx.play('eat');
      this.toasts.show(`Ate ${def.name}`);
      return true;
    }
    return false;
  }

  damagePlayer(amount: number, source: string): void {
    const p = this.player;
    if (p.dead || amount <= 0) return;
    if (source !== 'fall' && p.invulnerable) return;
    p.health -= amount;
    p.sinceDamage = 0;
    this.flashVignette();
    this.model.hitFlash();
    this.sfx.play('playerHurt', undefined, 0.1);
    if (!this.action || this.action.kind === 'mine') this.playAction('hurt', 0.35);
    if (p.health <= 0) {
      if (this.hsin.tryRevive()) {
        p.health = p.maxHealth;
        this.hsin.effects.handle(this.hsin.kit.drain());
        return;
      }
      p.health = 0;
      this.die();
    }
  }

  private flashVignette(): void {
    this.vignette.style.opacity = '1';
    setTimeout(() => (this.vignette.style.opacity = '0'), 140);
  }

  private die(): void {
    this.player.dead = true;
    this.state = 'dead';
    this.suppressUnlockPause = true;
    this.input.exitLock();
    this.deathEl.classList.remove('hidden');
  }

  private respawn(): void {
    const p = this.player;
    this.hsin.resetOnRespawn();
    p.dead = false;
    p.health = p.maxHealth;
    p.setPosition(this.spawn.x, this.spawn.y, this.spawn.z);
    this.deathEl.classList.add('hidden');
    this.state = 'loading';
    this.needsSpawnPlacement = true;
  }

  private dropSelected(): void {
    const s = this.inventory.selectedStack;
    if (!s || this.inventory.locked.has(this.inventory.selected)) return;
    const id = s.id;
    this.inventory.consumeSelected();
    this.dropStack(id, 1);
  }

  private dropStack(id: number, count: number): void {
    const p = this.player.position;
    const f = this.rig.forward;
    const vel = new THREE.Vector3(f.x * 5, 2.5, f.z * 5);
    this.drops.spawn(id, count, p.x + f.x * 0.6, p.y + 1.3, p.z + f.z * 0.6, vel, 1.5);
  }

  private openInventory(table: boolean): void {
    if (this.state !== 'playing') return;
    this.sfx.play('click');
    this.state = 'inventory';
    this.suppressUnlockPause = true;
    this.input.exitLock();
    this.inventoryScreen.show(table || this.nearCraftingTable());
  }

  private closeInventory(fromKey: boolean): void {
    if (this.state !== 'inventory') return;
    if (fromKey) {
      this.inventoryScreen.hide();
      return;
    }
    this.state = 'playing';
    this.input.requestLock();
  }

  private nearCraftingTable(): boolean {
    const p = this.player.position;
    const r = 4;
    for (let y = Math.floor(p.y) - 2; y <= Math.floor(p.y) + 3; y++) {
      for (let z = Math.floor(p.z) - r; z <= Math.floor(p.z) + r; z++) {
        for (let x = Math.floor(p.x) - r; x <= Math.floor(p.x) + r; x++) {
          if (this.world.getBlock(x, y, z) === B.CRAFTING_TABLE) return true;
        }
      }
    }
    return false;
  }

  pause(): void {
    if (this.state !== 'playing' && this.state !== 'cutscene') return;
    if (this.previewing) return;
    this.state = 'paused';
    this.pausedAt = this.time;
    this.suppressUnlockPause = true;
    this.input.exitLock();
    this.pauseMenu.show();
    void this.save();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.pauseMenu.hide();
    this.state = this.cutscenes.playing ? 'cutscene' : 'playing';
    this.input.requestLock();
  }

  // ---- Cutscenes ----

  /** CutsceneHost: the scene's local origin is Hsin's feet and facing. */
  anchor(): { pos: THREE.Vector3; yaw: number } {
    return { pos: this.player.position.clone(), yaw: this.player.yaw };
  }

  setGlow(v: number): void {
    this.model.glowBoost = v;
  }

  /** CombatHost: plays a Liberation cutscene. */
  playCutscene(name: 'formshift' | 'pillars', onEvent: (e: string) => void, onDone: () => void): boolean {
    const def = CUTSCENES[name];
    if (!def) return false;
    this.beginCutscene();
    this.cutscenes.play(def, {
      onEvent,
      onDone: () => {
        this.endCutscene();
        onDone();
      },
    });
    return true;
  }

  /** CombatHost: short flourish without camera takeover. */
  playFlourish(name: 'moonfox' | 'moonfox_out'): void {
    const def = CUTSCENES[name];
    if (def) this.cutscenes.play(def);
  }

  private beginCutscene(): void {
    if (this.state === 'playing') this.state = 'cutscene';
    this.hudLayer.classList.add('in-cutscene');
    this.player.movementLocked = true;
    this.player.invulnSources.add('cutscene');
    this.interaction.hide();
  }

  private endCutscene(): void {
    this.hudLayer.classList.remove('in-cutscene');
    this.player.movementLocked = false;
    this.player.invulnSources.delete('cutscene');
    if (this.state === 'cutscene') this.state = 'playing';
  }

  private buildViewer(c: HTMLElement): void {
    el('div', 'notice', c, "Replay Hsin's cutscenes. The world is frozen while they play, and nothing happens to it.");
    const list = el('div', 'viewer-list', c);
    for (const id of VIEWER_LIST) {
      const def = CUTSCENES[id];
      const row = el('div', 'viewer-item', list);
      const info = el('div', 'info', row);
      el('div', 'title', info, def.name);
      el('div', 'desc', info, `${def.description} (${def.duration.toFixed(1)} s${def.takeCamera ? '' : ', no camera takeover'})`);
      const btn = el('button', 'btn small primary', row, 'Play');
      btn.addEventListener('click', () => this.previewCutscene(id));
    }
  }

  /** Plays a cutscene from the viewer; returns to the pause menu afterwards. */
  previewCutscene(id: string): void {
    const def = CUTSCENES[id];
    if (!def || this.previewing) return;
    this.pauseMenu.hide();
    this.previewing = true;
    this.state = 'cutscene';
    this.hudLayer.classList.add('in-cutscene');
    this.player.movementLocked = true;
    this.player.invulnSources.add('cutscene');
    const form = this.hsin.kit.form;
    this.previewRestore = () => this.model.setForm(form);
    if (id === 'formshift') this.model.setForm('answering');
    if (id === 'pillars') this.model.setForm('illumining');
    if (def.takeCamera) {
      this.cutscenes.play(def, {
        preview: true,
        onEvent: (e) => {
          if (e === 'shift') this.model.setForm('illumining');
          if (e === 'impact') this.model.setForm('answering');
        },
        onDone: () => this.endPreview(),
      });
    } else {
      // Flourishes don't move the camera: show the fox for a moment where Hsin stands.
      this.previewFox = 1.6;
      this.cutscenes.play(def);
    }
  }

  private endPreview(): void {
    if (!this.previewing) return;
    this.previewRestore?.();
    this.previewRestore = null;
    this.previewing = false;
    this.previewFox = 0;
    this.hudLayer.classList.remove('in-cutscene');
    this.player.movementLocked = false;
    this.player.invulnSources.delete('cutscene');
    this.state = 'paused';
    this.pausedAt = this.time;
    this.pauseMenu.show(3);
  }

  private async quitToTitle(): Promise<void> {
    await this.save();
    this.dispose();
    this.onQuit();
  }

  private applySettings(s: Settings['data']): void {
    this.sfx.setVolume(s.masterVolume);
    this.rig.setFov(s.fov);
    this.world.setRenderDistance(s.renderDistance);
    this.debug.setFpsVisible(s.showFps);
  }

  private readonly onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.rig.setAspect(w / h);
  };

  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (this.state === 'playing') this.pause();
      else void this.save();
    }
  };

  private updateDebugText(): void {
    const p = this.player.position;
    const ws = this.world.stats();
    const info = this.world.generator.column(Math.floor(p.x), Math.floor(p.z));
    const light = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z));
    const ri = this.renderer.info;
    const t = this.interaction.target;
    this.debug.setText(
      [
        `Hsin Voxel  ${Math.round(this.debug.fps)} fps  cpu ${this.debug.cpuMs.toFixed(1)} ms`,
        `XYZ ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
        `Chunk ${Math.floor(p.x) >> 4}, ${Math.floor(p.z) >> 4}   Biome ${BIOME_NAMES[info.biome]}`,
        `Light sky ${light.sky} block ${light.block}   Time ${this.sky.clockText()}`,
        `Chunks ${ws.meshed}/${ws.loaded} (pending ${ws.pending})   Tris ${(ws.triangles / 1000).toFixed(0)}k`,
        `Draw calls ${ri.render.calls}   Geometries ${ri.memory.geometries}`,
        `Particles ${this.particles.active}   Drops ${this.drops.count}   Mobs ${this.mobs.mobs.length} (hostile ${this.mobs.hostileCount})   Shots ${this.projectiles.count}`,
        t ? `Target ${blockDef(t.id).name} @ ${t.x}, ${t.y}, ${t.z}` : 'Target -',
        `Form ${this.hsin.kit.form}${this.hsin.kit.fox ? ' (fox)' : ''}  Energy ${this.hsin.kit.energy.toFixed(0)}  AH ${this.hsin.kit.answeringHeart.toFixed(0)}  IH ${this.hsin.kit.illuminingHeart.toFixed(0)}`,
        `Sound ${this.sfx.state}   Seed ${this.meta.seed}`,
      ].join('\n'),
    );
  }

  /** True when the block at a position is solid (used by tests). */
  isSolidAt(x: number, y: number, z: number): boolean {
    return IS_SOLID[this.world.getBlock(x, y, z)] === 1;
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointerdown', this.unlockAudio);
    window.removeEventListener('keydown', this.unlockAudio);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.exitLock();
    this.world.dispose();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
