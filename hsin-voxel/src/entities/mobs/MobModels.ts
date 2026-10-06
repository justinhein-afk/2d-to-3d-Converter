// Box models and animations for every mob type, with procedurally painted skins.
import * as THREE from 'three';
import type { MobKind } from '../../config/mobs';
import { clamp, easings, lerp, mulberry32 } from '../../core/math';
import { glowTexture } from '../../fx/glow';
import {
  Skin, boxGeometry, createEntityMaterial, faceRects, joint, part,
  type BoxSpec, type EntityUniforms, type Rect,
} from '../boxModel';

export interface MobAnim {
  speed: number;
  /** 0..1 wind-up progress of the current attack, or -1. */
  windup: number;
  /** 0..1 progress of the strike after the wind-up, or -1. */
  strike: number;
  /** 0..1 after taking a hit (1 = just hit). */
  hurt: number;
  /** 0..1 death progress, or 0 while alive. */
  dead: number;
  onGround: boolean;
  aggro: boolean;
  /** Used by passive animals: head down to graze. */
  grazing: boolean;
}

export interface MobModel {
  readonly root: THREE.Group;
  readonly uniforms: EntityUniforms;
  animate(dt: number, a: MobAnim): void;
  /** World position for health bars. */
  headTop(out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

type PartSpec = [name: string, w: number, h: number, d: number, density: number];

/** Packs box UV regions into a skin and returns the layout. */
function layout(parts: PartSpec[], width: number): { specs: Record<string, BoxSpec>; height: number } {
  const specs: Record<string, BoxSpec> = {};
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const [name, w, h, d, k] of parts) {
    const pw = (2 * d + 2 * w) * k;
    const ph = (d + h) * k;
    if (x + pw > width) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    specs[name] = { w, h, d, u: x, v: y, density: k };
    x += pw;
    rowH = Math.max(rowH, ph);
  }
  return { specs, height: Math.ceil((y + rowH) / 8) * 8 };
}

interface SkinSet {
  specs: Record<string, BoxSpec>;
  w: number;
  h: number;
  map: THREE.Texture;
  glowMap: THREE.Texture;
  geos: Map<string, THREE.BufferGeometry>;
}

const skinCache = new Map<MobKind, SkinSet>();

function sides(f: Record<string, Rect>): Rect[] {
  return [f.pz, f.nz, f.px, f.nx];
}

function crack(s: Skin, r: Rect, color: string, glow: string, rand: () => number, count: number): void {
  for (let c = 0; c < count; c++) {
    let x = r.x + Math.floor(rand() * r.w);
    let y = r.y + Math.floor(rand() * r.h);
    const len = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < len; i++) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
        s.px(x, y, color);
        s.glowPx(x, y, glow);
      }
      x += rand() < 0.5 ? 1 : 0;
      y += rand() < 0.6 ? 1 : -1;
    }
  }
}

function buildSkin(kind: MobKind): SkinSet {
  const cached = skinCache.get(kind);
  if (cached) return cached;
  const rand = mulberry32(kind.length * 977 + kind.charCodeAt(0));
  let parts: PartSpec[];
  const W = 128;
  switch (kind) {
    case 'husk':
      parts = [['head', 8, 8, 8, 1], ['body', 8, 12, 4, 1], ['arm', 4, 13, 4, 1], ['leg', 4, 12, 4, 1], ['mask', 8, 8, 1, 1]];
      break;
    case 'archer':
      parts = [['head', 8, 8, 8, 1], ['hood', 8, 8, 8, 1], ['body', 8, 12, 4, 1], ['arm', 2, 12, 2, 1], ['leg', 2, 12, 2, 1], ['bow', 1, 6, 1, 1]];
      break;
    case 'colossus':
      parts = [['head', 8, 8, 8, 1], ['body', 16, 14, 10, 1], ['arm', 6, 16, 6, 1], ['fist', 8, 6, 8, 1], ['leg', 6, 12, 6, 1]];
      break;
    case 'boar':
      parts = [['body', 10, 8, 14, 1], ['head', 8, 7, 6, 1], ['snout', 4, 3, 2, 1], ['leg', 3, 6, 3, 1], ['tusk', 1, 2, 1, 1]];
      break;
    case 'sheep':
      parts = [['body', 9, 9, 13, 1], ['head', 6, 6, 7, 1], ['leg', 3, 7, 3, 1]];
      break;
    case 'chicken':
      parts = [['body', 6, 6, 8, 1], ['head', 4, 6, 3, 1], ['beak', 4, 2, 2, 1], ['wattle', 2, 2, 2, 1], ['wing', 1, 4, 6, 1], ['leg', 1, 5, 1, 1]];
      break;
  }
  const L = layout(parts, W);
  const s = new Skin(W, L.height);
  const S = L.specs;
  const fr = (n: string) => faceRects(S[n]);

  if (kind === 'husk') {
    const dark = ['#211c2c', '#2a2438', '#1a1622'];
    for (const n of ['head', 'body', 'arm', 'leg']) {
      const f = fr(n);
      for (const r of Object.values(f)) s.noise(r, dark[1], dark, 0.35, rand);
      for (const r of sides(f)) crack(s, r, '#3fe0d0', '#1a8a80', rand, n === 'body' ? 3 : 2);
    }
    // Ragged dark cloth on the body.
    const b = fr('body');
    for (const r of sides(b)) s.fill(r.x, r.y + r.h - 3, r.w, 3, '#141018');
    // White Tacet mask with a single glowing eye slit.
    const m = fr('mask');
    s.rect(m.pz, '#e8e4ec');
    s.fill(m.pz.x + 1, m.pz.y + 3, 6, 1, '#40f0e0');
    s.glowPx(m.pz.x + 1, m.pz.y + 3, '#40f0e0', 6, 1);
    s.fill(m.pz.x + 3, m.pz.y + 5, 2, 2, '#9a96a4');
    s.px(m.pz.x, m.pz.y, '#b8b4c4');
    s.px(m.pz.x + 7, m.pz.y, '#b8b4c4');
    for (const r of [m.nz, m.px, m.nx, m.py, m.ny]) s.rect(r, '#c8c4d0');
  } else if (kind === 'archer') {
    const bone = ['#d6d2c4', '#c8c2b0', '#e2ded2'];
    for (const n of ['head', 'arm', 'leg']) {
      const f = fr(n);
      for (const r of Object.values(f)) s.noise(r, bone[0], bone, 0.25, rand);
    }
    const head = fr('head');
    s.fill(head.pz.x + 1, head.pz.y + 3, 6, 2, '#1a1424');
    s.fill(head.pz.x + 2, head.pz.y + 3, 4, 1, '#c070ff');
    s.glowPx(head.pz.x + 2, head.pz.y + 3, '#a050ff', 4, 1);
    s.fill(head.pz.x + 2, head.pz.y + 6, 4, 1, '#3a3430');
    const hood = fr('hood');
    for (const r of Object.values(hood)) s.noise(r, '#2e2440', ['#3a2e52', '#241c34'], 0.3, rand);
    s.clear(hood.pz.x + 1, hood.pz.y + 2, 6, 6);
    s.clear(hood.ny.x, hood.ny.y, hood.ny.w, hood.ny.h);
    const body = fr('body');
    for (const r of Object.values(body)) s.noise(r, '#2e2440', ['#3a2e52', '#241c34'], 0.3, rand);
    for (const r of sides(body)) {
      s.fill(r.x, r.y + 5, r.w, 1, '#8a6ad0');
      s.glowPx(r.x, r.y + 5, '#40206a', r.w, 1);
    }
    const bow = fr('bow');
    for (const r of Object.values(bow)) s.noise(r, '#5a3a24', ['#6b4a2e', '#4a2e1a'], 0.3, rand);
  } else if (kind === 'colossus') {
    const iron = ['#4a4e5a', '#555a66', '#3e424c', '#62687a'];
    for (const n of ['head', 'body', 'arm', 'fist', 'leg']) {
      const f = fr(n);
      for (const r of Object.values(f)) s.noise(r, iron[0], iron, 0.4, rand);
      for (const r of sides(f)) {
        // Riveted plates.
        for (let y = r.y + 2; y < r.y + r.h; y += 5) s.fill(r.x, y, r.w, 1, '#2e3138');
        crack(s, r, '#46e8d8', '#1a9a90', rand, n === 'body' ? 4 : 1);
      }
    }
    const head = fr('head');
    s.fill(head.pz.x + 1, head.pz.y + 3, 2, 2, '#46f0e0');
    s.fill(head.pz.x + 5, head.pz.y + 3, 2, 2, '#46f0e0');
    s.glowPx(head.pz.x + 1, head.pz.y + 3, '#46f0e0', 2, 2);
    s.glowPx(head.pz.x + 5, head.pz.y + 3, '#46f0e0', 2, 2);
    const body = fr('body');
    s.fill(body.pz.x + 6, body.pz.y + 4, 4, 4, '#b8fff6');
    s.fill(body.pz.x + 7, body.pz.y + 5, 2, 2, '#ffffff');
    s.glowPx(body.pz.x + 5, body.pz.y + 3, '#30c8b8', 6, 6);
    s.glowPx(body.pz.x + 6, body.pz.y + 4, '#a0fff4', 4, 4);
  } else if (kind === 'boar') {
    const fur = ['#5a3c28', '#6b4a32', '#4a301e', '#7a5638'];
    for (const n of ['body', 'head', 'leg']) {
      const f = fr(n);
      for (const r of Object.values(f)) s.noise(r, fur[1], fur, 0.4, rand);
    }
    const h = fr('head');
    s.fill(h.pz.x + 1, h.pz.y + 2, 2, 1, '#1a1210');
    s.fill(h.pz.x + 5, h.pz.y + 2, 2, 1, '#1a1210');
    const sn = fr('snout');
    for (const r of Object.values(sn)) s.rect(r, '#b88070');
    s.px(sn.pz.x + 1, sn.pz.y + 1, '#5a3028');
    s.px(sn.pz.x + 2, sn.pz.y + 1, '#5a3028');
    const tusk = fr('tusk');
    for (const r of Object.values(tusk)) s.rect(r, '#f0ead8');
    const leg = fr('leg');
    for (const r of sides(leg)) s.fill(r.x, r.y + r.h - 1, r.w, 1, '#2a1a10');
  } else if (kind === 'sheep') {
    const wool = ['#ece8e0', '#dedad0', '#f6f4ee'];
    const b = fr('body');
    for (const r of Object.values(b)) s.noise(r, wool[0], wool, 0.4, rand);
    const h = fr('head');
    for (const r of Object.values(h)) s.noise(r, '#3a3430', ['#2e2824', '#463e38'], 0.2, rand);
    s.fill(h.py.x, h.py.y, h.py.w, h.py.h, wool[0]);
    for (const r of sides(h)) s.fill(r.x, r.y, r.w, 2, wool[1]);
    s.fill(h.pz.x + 1, h.pz.y + 3, 1, 1, '#f0f0f0');
    s.fill(h.pz.x + 4, h.pz.y + 3, 1, 1, '#f0f0f0');
    s.fill(h.pz.x + 2, h.pz.y + 5, 2, 1, '#c88a8a');
    const leg = fr('leg');
    for (const r of Object.values(leg)) s.rect(r, '#3a3430');
    for (const r of sides(leg)) s.fill(r.x, r.y, r.w, 3, wool[0]);
  } else {
    const white = ['#f4f4f0', '#e4e4dc', '#ffffff'];
    for (const n of ['body', 'head', 'wing']) {
      const f = fr(n);
      for (const r of Object.values(f)) s.noise(r, white[0], white, 0.25, rand);
    }
    const h = fr('head');
    s.px(h.pz.x, h.pz.y + 1, '#1a1a1a');
    s.px(h.pz.x + 3, h.pz.y + 1, '#1a1a1a');
    s.fill(h.py.x, h.py.y, h.py.w, h.py.h, '#e03030');
    for (const r of Object.values(fr('beak'))) s.rect(r, '#f0b020');
    for (const r of Object.values(fr('wattle'))) s.rect(r, '#d02020');
    for (const r of Object.values(fr('leg'))) s.rect(r, '#e0a020');
  }

  const tex = s.textures();
  const set: SkinSet = { specs: S, w: W, h: L.height, map: tex.map, glowMap: tex.glowMap, geos: new Map() };
  skinCache.set(kind, set);
  return set;
}

/** Model pixel size per kind (world units per pixel). */
const SCALE: Record<MobKind, number> = {
  husk: 1.9 / 32,
  archer: 1.9 / 32,
  colossus: 0.09,
  boar: 0.0625,
  sheep: 0.0625,
  chicken: 0.05,
};

class BasicMobModel implements MobModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly uniforms: EntityUniforms;
  readonly j: Record<string, THREE.Group> = {};
  private readonly material: THREE.ShaderMaterial;
  private phase = 0;
  private time = Math.random() * 10;
  private readonly headTopLocal: THREE.Vector3;
  private extra: THREE.Object3D[] = [];

  constructor(readonly kind: MobKind) {
    const sk = buildSkin(kind);
    this.material = createEntityMaterial({ map: sk.map, glowMap: sk.glowMap });
    this.uniforms = this.material.uniforms as EntityUniforms;
    const geo = (n: string, inflate = 0) => {
      const key = `${n}:${inflate}`;
      let g = sk.geos.get(key);
      if (!g) {
        g = boxGeometry(sk.specs[n], sk.w, sk.h, inflate);
        sk.geos.set(key, g);
      }
      return g;
    };
    const m = this.material;
    this.root.add(this.body);
    this.body.scale.setScalar(SCALE[kind]);
    const J = this.j;
    switch (kind) {
      case 'husk': {
        J.legR = joint(this.body, -2, 12, 0);
        part(geo('leg'), m, J.legR, 0, -6, 0);
        J.legL = joint(this.body, 2, 12, 0);
        part(geo('leg'), m, J.legL, 0, -6, 0);
        J.hips = joint(this.body, 0, 12, 0);
        part(geo('body'), m, J.hips, 0, 6, 0);
        J.head = joint(J.hips, 0, 12, 0);
        part(geo('head'), m, J.head, 0, 4, 0);
        part(geo('mask'), m, J.head, 0, 4, 4.3);
        J.armR = joint(J.hips, -6, 10.5, 0);
        part(geo('arm'), m, J.armR, 0, -5, 0);
        J.armL = joint(J.hips, 6, 10.5, 0);
        part(geo('arm'), m, J.armL, 0, -5, 0);
        this.headTopLocal = new THREE.Vector3(0, 35, 0);
        break;
      }
      case 'archer': {
        J.legR = joint(this.body, -1.5, 12, 0);
        part(geo('leg'), m, J.legR, 0, -6, 0);
        J.legL = joint(this.body, 1.5, 12, 0);
        part(geo('leg'), m, J.legL, 0, -6, 0);
        J.hips = joint(this.body, 0, 12, 0);
        part(geo('body'), m, J.hips, 0, 6, 0);
        J.head = joint(J.hips, 0, 12, 0);
        part(geo('head'), m, J.head, 0, 4, 0);
        part(geo('hood', 0.5), m, J.head, 0, 4, 0);
        J.armR = joint(J.hips, -5, 10.5, 0);
        part(geo('arm'), m, J.armR, 0, -5, 0);
        J.armL = joint(J.hips, 5, 10.5, 0);
        part(geo('arm'), m, J.armL, 0, -5, 0);
        // Bow in the left hand: three angled segments.
        const bow = joint(J.armL, 0, -10, 1.5);
        for (const [y, rz] of [[0, 0], [4.5, -0.45], [-4.5, 0.45]] as Array<[number, number]>) {
          const seg = part(geo('bow'), m, bow, 0, y, rz === 0 ? 0 : -0.8);
          seg.rotation.x = rz;
        }
        const string = new THREE.Mesh(new THREE.BoxGeometry(0.2, 12, 0.2), new THREE.MeshBasicMaterial({ color: 0xc8b8ff }));
        string.position.set(0, 0, -1.6);
        bow.add(string);
        this.extra.push(string);
        J.bow = bow;
        this.headTopLocal = new THREE.Vector3(0, 34, 0);
        break;
      }
      case 'colossus': {
        J.legR = joint(this.body, -4.5, 12, 0);
        part(geo('leg'), m, J.legR, 0, -6, 0);
        J.legL = joint(this.body, 4.5, 12, 0);
        part(geo('leg'), m, J.legL, 0, -6, 0);
        J.hips = joint(this.body, 0, 12, 0);
        part(geo('body'), m, J.hips, 0, 7, 0);
        J.head = joint(J.hips, 0, 14, 1.5);
        part(geo('head'), m, J.head, 0, 3.5, 0);
        J.armR = joint(J.hips, -11, 12, 0);
        part(geo('arm'), m, J.armR, 0, -7, 0);
        part(geo('fist'), m, J.armR, 0, -17, 0);
        J.armL = joint(J.hips, 11, 12, 0);
        part(geo('arm'), m, J.armL, 0, -7, 0);
        part(geo('fist'), m, J.armL, 0, -17, 0);
        const core = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: glowTexture(), color: 0x60fff0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        core.scale.setScalar(10);
        core.position.set(0, 9, 5.5);
        J.hips.add(core);
        this.extra.push(core);
        this.headTopLocal = new THREE.Vector3(0, 37, 0);
        break;
      }
      case 'boar': {
        J.body = joint(this.body, 0, 10, 0);
        part(geo('body'), m, J.body, 0, 0, 0);
        J.head = joint(J.body, 0, 0, 7);
        part(geo('head'), m, J.head, 0, 0.5, 3);
        part(geo('snout'), m, J.head, 0, -0.5, 7);
        part(geo('tusk'), m, J.head, -2.2, -1.5, 6.2);
        part(geo('tusk'), m, J.head, 2.2, -1.5, 6.2);
        this.legs4(geo('leg'), m, 3, 6, 5);
        this.headTopLocal = new THREE.Vector3(0, 18, 0);
        break;
      }
      case 'sheep': {
        J.body = joint(this.body, 0, 11.5, 0);
        part(geo('body'), m, J.body, 0, 0, 0);
        J.head = joint(J.body, 0, 2, 6.5);
        part(geo('head'), m, J.head, 0, 1, 3);
        this.legs4(geo('leg'), m, 2.8, 7, 4.5);
        this.headTopLocal = new THREE.Vector3(0, 21, 0);
        break;
      }
      case 'chicken': {
        J.body = joint(this.body, 0, 8, 0);
        part(geo('body'), m, J.body, 0, 0, 0);
        J.head = joint(J.body, 0, 3, 3.5);
        part(geo('head'), m, J.head, 0, 2, 0.5);
        part(geo('beak'), m, J.head, 0, 2.5, 3);
        part(geo('wattle'), m, J.head, 0, 0.5, 2.5);
        J.wingR = joint(J.body, -3.5, 2, 0);
        part(geo('wing'), m, J.wingR, 0, -2, 0);
        J.wingL = joint(J.body, 3.5, 2, 0);
        part(geo('wing'), m, J.wingL, 0, -2, 0);
        J.legR = joint(this.body, -1.5, 5, 0);
        part(geo('leg'), m, J.legR, 0, -2.5, 0);
        J.legL = joint(this.body, 1.5, 5, 0);
        part(geo('leg'), m, J.legL, 0, -2.5, 0);
        this.headTopLocal = new THREE.Vector3(0, 17, 0);
        break;
      }
    }
  }

  private legs4(g: THREE.BufferGeometry, m: THREE.Material, x: number, h: number, z: number): void {
    const J = this.j;
    J.legFR = joint(this.body, -x, h, z);
    part(g, m, J.legFR, 0, -h / 2, 0);
    J.legFL = joint(this.body, x, h, z);
    part(g, m, J.legFL, 0, -h / 2, 0);
    J.legBR = joint(this.body, -x, h, -z);
    part(g, m, J.legBR, 0, -h / 2, 0);
    J.legBL = joint(this.body, x, h, -z);
    part(g, m, J.legBL, 0, -h / 2, 0);
  }

  headTop(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.headTopLocal);
    return this.body.localToWorld(out);
  }

  animate(dt: number, a: MobAnim): void {
    this.time += dt;
    const t = this.time;
    const J = this.j;
    const sp = clamp(a.speed / 3, 0, 1.4);
    this.phase += dt * a.speed * 1.6;
    const sw = Math.sin(this.phase) * sp;
    const k = 1 - Math.exp(-18 * dt);
    const set = (o: THREE.Object3D | undefined, x: number, y = 0, z = 0) => {
      if (!o) return;
      o.rotation.x += (x - o.rotation.x) * k;
      o.rotation.y += (y - o.rotation.y) * k;
      o.rotation.z += (z - o.rotation.z) * k;
    };
    const biped = this.kind === 'husk' || this.kind === 'archer' || this.kind === 'colossus';
    if (biped) {
      set(J.legR, sw * 0.7);
      set(J.legL, -sw * 0.7);
      let armR = -sw * 0.5;
      let armL = sw * 0.5;
      let armRy = 0;
      let armLy = 0;
      let armRz = -0.05;
      let armLz = 0.05;
      let hips = 0.02 * Math.sin(t * 1.5);
      let headX = 0;
      if (this.kind === 'husk') {
        if (a.aggro) {
          armR = -1.45 + sw * 0.15;
          armL = -1.45 - sw * 0.15;
        }
        if (a.windup >= 0) {
          armR = armL = lerp(-1.45, -2.7, easings.outCubic(a.windup));
          hips = -0.15 * a.windup;
        } else if (a.strike >= 0) {
          armR = armL = lerp(-2.7, -0.7, easings.outCubic(Math.min(1, a.strike * 3)));
          hips = 0.25 * (1 - a.strike);
        }
        headX = Math.sin(t * 2.3) * 0.08;
      } else if (this.kind === 'archer') {
        if (a.aggro || a.windup >= 0) {
          armL = -1.5;
          armLy = 0.15;
          armR = -1.45;
          armRy = -0.3 - (a.windup >= 0 ? 0.4 * a.windup : 0);
          armRz = -0.1;
        }
        if (a.strike >= 0) armRy = -0.1;
      } else {
        if (a.windup >= 0) {
          armR = armL = lerp(-0.2, -3.0, easings.outCubic(a.windup));
          armRz = -0.3;
          armLz = 0.3;
          hips = -0.25 * a.windup;
          headX = -0.3 * a.windup;
        } else if (a.strike >= 0) {
          armR = armL = lerp(-3.0, -0.9, easings.outExpo(Math.min(1, a.strike * 4)));
          hips = 0.35 * (1 - a.strike);
        } else {
          armRz = -0.15;
          armLz = 0.15;
        }
      }
      set(J.armR, armR, armRy, armRz);
      set(J.armL, armL, armLy, armLz);
      set(J.hips, hips);
      set(J.head, headX + (a.hurt > 0 ? -0.3 * a.hurt : 0));
      this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.04 * sp;
    } else {
      set(J.legFR, sw * 0.8);
      set(J.legBL, sw * 0.8);
      set(J.legFL, -sw * 0.8);
      set(J.legBR, -sw * 0.8);
      set(J.legR, sw * 0.9);
      set(J.legL, -sw * 0.9);
      const graze = a.grazing && a.speed < 0.2 ? 0.9 : 0;
      set(J.head, graze + Math.sin(t * 1.7) * 0.05, Math.sin(t * 0.6) * 0.15);
      if (this.kind === 'chicken') {
        const flap = !a.onGround || a.hurt > 0 ? Math.sin(t * 30) * 0.8 : 0;
        set(J.wingR, 0, 0, -0.1 - Math.abs(flap));
        set(J.wingL, 0, 0, 0.1 + Math.abs(flap));
      }
      this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.03 * sp;
    }
    // Death: tip over and sink.
    if (a.dead > 0) {
      const d = easings.outCubic(Math.min(1, a.dead * 1.6));
      this.body.rotation.z = (Math.PI / 2) * d;
      this.body.position.y = -0.1 * d;
    } else {
      this.body.rotation.z = a.hurt > 0 ? Math.sin(a.hurt * 20) * 0.04 : 0;
    }
  }

  dispose(): void {
    this.material.dispose();
    for (const e of this.extra) {
      const mat = (e as THREE.Mesh).material as THREE.Material | undefined;
      mat?.dispose();
    }
    this.root.removeFromParent();
  }
}

export function createMobModel(kind: MobKind): MobModel {
  return new BasicMobModel(kind);
}
