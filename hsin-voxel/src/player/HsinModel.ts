// Voxel Hsin: a Minecraft-proportioned box model with a procedurally painted skin,
// fox ears, a big three-segment tail, long hair, a layered red dress and a floating Rectifier.
import * as THREE from 'three';
import { HSIN_LOOK } from '../config/appearance';
import { mulberry32 } from '../core/math';
import {
  Skin, boxGeometry, createEntityMaterial, faceRects, joint, part,
  type BoxSpec, type EntityUniforms, type Rect,
} from '../entities/boxModel';

/** World units per model pixel (32 px tall = 1.8 blocks, like Minecraft). */
export const PX = 1.8 / 32;

export type HsinForm = 'answering' | 'illumining';

function palette(form: HsinForm): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(HSIN_LOOK)) if (typeof v === 'string') base[k] = v;
  if (form === 'illumining') Object.assign(base, HSIN_LOOK.illumining);
  return base;
}

// Texture layout: [name, w, h, d, density]. Positions are packed automatically.
const PARTS: Array<[string, number, number, number, number]> = [
  ['head', 8, 8, 8, 2],
  ['hairCap', 8, 8, 8, 2],
  ['torso', 8, 12, 4, 2],
  ['armR', 3, 12, 4, 2],
  ['armL', 3, 12, 4, 2],
  ['legR', 4, 12, 4, 2],
  ['legL', 4, 12, 4, 2],
  ['skirt', 9, 7, 5, 2],
  ['backHair', 8, 20, 2, 2],
  ['tabard', 5, 9, 1, 2],
  ['lockR', 2, 10, 2, 2],
  ['lockL', 2, 10, 2, 2],
  ['earR', 4, 3, 2, 2],
  ['earL', 4, 3, 2, 2],
  ['earTipR', 2, 2, 2, 2],
  ['earTipL', 2, 2, 2, 2],
  ['cuffR', 5, 6, 5, 1],
  ['cuffL', 5, 6, 5, 1],
  ['tail1', 5, 5, 7, 1],
  ['tail2', 6, 6, 8, 1],
  ['tail3', 5, 5, 7, 1],
  ['ornament', 2, 2, 2, 1],
];

const TEX_W = 128;

function packLayout(): { specs: Record<string, BoxSpec>; height: number } {
  const specs: Record<string, BoxSpec> = {};
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const [name, w, h, d, k] of PARTS) {
    const pw = (2 * d + 2 * w) * k;
    const ph = (d + h) * k;
    if (x + pw > TEX_W) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    specs[name] = { w, h, d, u: x, v: y, density: k };
    x += pw;
    rowH = Math.max(rowH, ph);
  }
  return { specs, height: y + rowH };
}

const LAYOUT = packLayout();
const TEX_H = Math.ceil(LAYOUT.height / 16) * 16;

function paintSkin(form: HsinForm): Skin {
  const c = palette(form);
  const s = new Skin(TEX_W, TEX_H);
  const rand = mulberry32(form === 'answering' ? 7 : 8);
  const L = LAYOUT.specs;
  const hairAlt = [c.hairShade, c.hairShade, c.hairDeep];
  const strands = (r: Rect, step: number) => {
    for (let x = r.x + 1; x < r.x + r.w; x += step) {
      for (let y = r.y; y < r.y + r.h; y++) if (rand() < 0.7) s.px(x, y, c.hairShade);
    }
  };

  // ---- Head ----
  {
    const f = faceRects(L.head);
    s.noise(f.py, c.hair, hairAlt, 0.18, rand);
    s.noise(f.nz, c.hair, hairAlt, 0.12, rand);
    strands(f.nz, 3);
    s.rect(f.ny, c.skinShade);
    // Sides: hair with a cheek showing toward the front.
    s.noise(f.nx, c.hair, hairAlt, 0.12, rand);
    s.fill(f.nx.x + 11, f.nx.y + 6, 5, 8, c.skin);
    s.noise(f.px, c.hair, hairAlt, 0.12, rand);
    s.fill(f.px.x, f.px.y + 6, 5, 8, c.skin);
    // Face.
    const fr = f.pz;
    s.rect(fr, c.skin);
    s.fill(fr.x, fr.y, 16, 4, c.hair);
    for (let x = 0; x < 16; x++) {
      const len = [2, 1, 2, 0, 1, 2, 1, 0, 1, 2, 0, 1, 2, 1, 2, 2][x];
      s.fill(fr.x + x, fr.y + 4, 1, len, x % 3 === 0 ? c.hairShade : c.hair);
    }
    s.fill(fr.x, fr.y + 4, 2, 9, c.hair);
    s.fill(fr.x + 14, fr.y + 4, 2, 9, c.hair);
    // Brows, lashes and eyes (red with a golden glint).
    s.fill(fr.x + 3, fr.y + 7, 3, 1, c.hairDeep);
    s.fill(fr.x + 10, fr.y + 7, 3, 1, c.hairDeep);
    for (const ex of [3, 9]) {
      s.fill(fr.x + ex, fr.y + 8, 4, 1, c.lash);
      s.px(fr.x + ex, fr.y + 9, c.eyeWhite);
      s.fill(fr.x + ex + 1, fr.y + 9, 2, 2, c.eyeIris);
      s.px(fr.x + ex + 3, fr.y + 9, c.eyeWhite);
      s.px(fr.x + ex + (ex === 3 ? 2 : 1), fr.y + 10, c.eyeGlint);
      s.glowPx(fr.x + ex + 1, fr.y + 9, form === 'answering' ? '#3a0a10' : '#3a1a5a', 2, 2);
    }
    s.fill(fr.x + 2, fr.y + 11, 2, 1, c.blush);
    s.fill(fr.x + 12, fr.y + 11, 2, 1, c.blush);
    s.fill(fr.x + 7, fr.y + 13, 2, 1, c.mouth);
    s.fill(fr.x, fr.y + 15, 16, 1, c.skinShade);
  }

  // ---- Hair cap overlay (adds volume; transparent over the face) ----
  {
    const f = faceRects(L.hairCap);
    s.noise(f.py, c.hair, hairAlt, 0.2, rand);
    s.noise(f.nz, c.hair, hairAlt, 0.15, rand);
    strands(f.nz, 4);
    s.noise(f.nx, c.hair, hairAlt, 0.15, rand);
    s.clear(f.nx.x + 9, f.nx.y + 5, 7, 11);
    s.noise(f.px, c.hair, hairAlt, 0.15, rand);
    s.clear(f.px.x, f.px.y + 5, 7, 11);
    s.clear(f.pz.x, f.pz.y, f.pz.w, f.pz.h);
    for (let x = 0; x < 16; x++) {
      const len = 3 + ((x * 7) % 3);
      s.fill(f.pz.x + x, f.pz.y, 1, len, x % 4 === 1 ? c.hairShade : c.hair);
    }
    s.clear(f.ny.x, f.ny.y, f.ny.w, f.ny.h);
  }

  // ---- Torso: high collar, diagonal gold opening, sash ----
  {
    const f = faceRects(L.torso);
    for (const r of [f.pz, f.nz, f.px, f.nx]) {
      s.noise(r, c.dress, [c.dressShade], 0.06, rand);
      s.fill(r.x, r.y + 12, r.w, 1, c.trim);
      s.fill(r.x, r.y + 13, r.w, 3, c.gold);
      s.fill(r.x, r.y + 16, r.w, 1, c.trim);
      for (let x = r.x + 2; x < r.x + r.w; x += 4) s.fill(x, r.y + 17, 1, 7, c.dressShade);
    }
    const fr = f.pz;
    s.fill(fr.x + 5, fr.y, 6, 3, c.trim);
    s.fill(fr.x + 7, fr.y + 1, 2, 1, c.gold);
    s.fill(fr.x + 1, fr.y + 3, 14, 1, c.dressLight);
    for (let i = 0; i < 7; i++) {
      s.px(fr.x + 8 - i, fr.y + 3 + i, c.gold);
      s.px(fr.x + 9 - i, fr.y + 3 + i, c.goldShade);
    }
    s.px(fr.x + 6, fr.y + 5, c.teal);
    s.px(fr.x + 4, fr.y + 7, c.teal);
    s.fill(fr.x + 6, fr.y + 13, 4, 3, c.teal);
    s.fill(fr.x + 7, fr.y + 14, 2, 1, '#ffffff');
    s.glowPx(fr.x + 6, fr.y + 13, form === 'answering' ? '#0a2a28' : '#3a1a6a', 4, 3);
    // Back: collar and a bow knot.
    const bk = f.nz;
    s.fill(bk.x + 3, bk.y, 10, 3, c.trim);
    s.fill(bk.x + 5, bk.y + 11, 6, 7, c.teal);
    s.fill(bk.x + 7, bk.y + 12, 2, 5, c.gold);
    s.noise(f.py, c.dress, [c.dressShade], 0.1, rand);
    s.fill(f.py.x + 5, f.py.y, 6, 8, c.trim);
    s.rect(f.ny, c.dressShade);
  }

  // ---- Arms: sleeves and hands ----
  for (const name of ['armR', 'armL']) {
    const f = faceRects(L[name]);
    for (const r of [f.pz, f.nz, f.px, f.nx]) {
      s.noise({ x: r.x, y: r.y, w: r.w, h: 18 }, c.dress, [c.dressShade], 0.08, rand);
      s.fill(r.x, r.y, r.w, 1, c.gold);
      s.fill(r.x, r.y + 18, r.w, 6, c.skin);
      s.fill(r.x, r.y + 23, r.w, 1, c.skinShade);
      s.glowPx(r.x, r.y + 10, form === 'answering' ? '#062420' : '#2a0f4a', r.w, 1);
      s.fill(r.x, r.y + 10, r.w, 1, c.teal);
    }
    s.rect(f.py, c.dress);
    s.rect(f.ny, c.skin);
  }

  // ---- Wide sleeve cuffs ----
  for (const name of ['cuffR', 'cuffL']) {
    const f = faceRects(L[name]);
    for (const r of [f.pz, f.nz, f.px, f.nx]) {
      s.noise(r, c.dress, [c.dressShade], 0.1, rand);
      s.fill(r.x, r.y + 3, r.w, 1, c.gold);
      s.fill(r.x, r.y + 4, r.w, 2, c.trim);
    }
    s.rect(f.py, c.dress);
    s.rect(f.ny, '#2a0810');
  }

  // ---- Legs: stockings and boots ----
  for (const name of ['legR', 'legL']) {
    const f = faceRects(L[name]);
    for (const r of [f.pz, f.nz, f.px, f.nx]) {
      s.fill(r.x, r.y, r.w, 6, c.dress);
      s.fill(r.x, r.y + 6, r.w, 2, c.gold);
      s.noise({ x: r.x, y: r.y + 8, w: r.w, h: 8 }, c.stocking, ['#24202c'], 0.1, rand);
      s.fill(r.x, r.y + 16, r.w, 2, c.bootTrim);
      s.noise({ x: r.x, y: r.y + 18, w: r.w, h: 5 }, c.boot, ['#3a2a30'], 0.1, rand);
      s.fill(r.x, r.y + 23, r.w, 1, '#120c10');
    }
    s.rect(f.py, c.dress);
    s.rect(f.ny, '#120c10');
  }

  // ---- Skirt: layered, folded, black hem ----
  {
    const f = faceRects(L.skirt);
    for (const r of [f.pz, f.nz, f.px, f.nx]) {
      s.noise(r, c.dress, [c.dressShade], 0.05, rand);
      s.fill(r.x, r.y, r.w, 2, c.gold);
      for (let x = r.x + 2; x < r.x + r.w; x += 5) {
        s.fill(x, r.y + 2, 1, 9, c.dressShade);
        s.fill(x + 1, r.y + 2, 1, 9, c.dressLight);
      }
      s.fill(r.x, r.y + 11, r.w, 1, c.gold);
      s.fill(r.x, r.y + 12, r.w, 2, c.trim);
    }
    s.rect(f.py, c.dressShade);
    s.rect(f.ny, '#2a0810');
  }

  // ---- Front panel ----
  {
    const f = faceRects(L.tabard);
    for (const r of [f.pz, f.nz]) {
      s.rect(r, c.dressShade);
      s.fill(r.x, r.y, 1, r.h, c.gold);
      s.fill(r.x + r.w - 1, r.y, 1, r.h, c.gold);
      s.fill(r.x + 4, r.y + 2, 2, 2, c.teal);
      for (const [x, y] of [[3, 6], [4, 5], [5, 5], [6, 6], [4, 7], [5, 7], [2, 8], [7, 8], [3, 9], [6, 9]]) s.px(r.x + x, r.y + y, c.gold);
      s.fill(r.x + 1, r.y + 13, r.w - 2, 1, c.trim);
      for (let x = 0; x < r.w; x++) {
        s.fill(r.x + x, r.y + 14, 1, 4, x % 2 === 0 ? c.gold : c.goldShade);
        if (x % 2 === 1) s.clear(r.x + x, r.y + 16, 1, 2);
      }
    }
    for (const r of [f.px, f.nx, f.py, f.ny]) s.rect(r, c.trim);
  }

  // ---- Long back hair, with pointed tips ----
  {
    const f = faceRects(L.backHair);
    for (const r of [f.nz, f.px, f.nx, f.pz]) {
      s.noise(r, c.hair, hairAlt, 0.1, rand);
      strands(r, 3);
      for (let x = 0; x < r.w; x++) {
        const cut = [0, 2, 3, 1, 0, 2, 4, 1, 0, 3, 2, 0, 1, 3, 2, 0][x % 16];
        s.clear(r.x + x, r.y + r.h - cut, 1, cut);
      }
    }
    s.rect(f.py, c.hair);
    s.rect(f.ny, c.hairShade);
  }

  // ---- Side locks with a teal tie ----
  for (const name of ['lockR', 'lockL']) {
    const f = faceRects(L[name]);
    for (const r of [f.pz, f.nz, f.px, f.nx]) {
      s.noise(r, c.hair, hairAlt, 0.15, rand);
      s.fill(r.x, r.y + 8, r.w, 2, c.teal);
      s.fill(r.x, r.y + 10, r.w, 1, c.gold);
      s.clear(r.x, r.y + r.h - 1, 1, 1);
      s.clear(r.x + r.w - 1, r.y + r.h - 2, 1, 2);
    }
    s.rect(f.py, c.hair);
    s.rect(f.ny, c.hairShade);
  }

  // ---- Fox ears: a wide base and a dark-tipped point ----
  for (const name of ['earR', 'earL']) {
    const f = faceRects(L[name]);
    for (const r of [f.nz, f.px, f.nx, f.py]) s.noise(r, c.hair, hairAlt, 0.1, rand);
    const fr = f.pz;
    s.rect(fr, c.hair);
    s.fill(fr.x + 2, fr.y, 4, 6, c.earInner);
    s.fill(fr.x + 3, fr.y + 1, 2, 5, '#f8c8cc');
    s.rect(f.ny, c.hair);
  }
  for (const name of ['earTipR', 'earTipL']) {
    const f = faceRects(L[name]);
    for (const r of [f.nz, f.px, f.nx]) {
      s.noise(r, c.hair, hairAlt, 0.1, rand);
      s.fill(r.x, r.y, r.w, 2, c.tailTip);
    }
    s.rect(f.pz, c.hair);
    s.fill(f.pz.x + 1, f.pz.y + 2, 2, 2, c.earInner);
    s.fill(f.pz.x, f.pz.y, f.pz.w, 2, c.tailTip);
    s.rect(f.py, c.tailTip);
    s.rect(f.ny, c.hair);
  }

  // ---- Tail: fluffy white segments with a dark tip ----
  for (const name of ['tail1', 'tail2', 'tail3']) {
    const f = faceRects(L[name]);
    for (const r of [f.pz, f.nz, f.px, f.nx, f.py, f.ny]) s.noise(r, c.hair, hairAlt, 0.22, rand);
    if (name === 'tail3') {
      const d = L.tail3.d;
      s.rect(f.nz, c.tailTip);
      s.fill(f.px.x + 3, f.px.y, d - 3, f.px.h, c.tailTip);
      s.fill(f.nx.x, f.nx.y, d - 3, f.nx.h, c.tailTip);
      s.fill(f.py.x, f.py.y, f.py.w, d - 3, c.tailTip);
      s.fill(f.ny.x, f.ny.y + 3, f.ny.w, d - 3, c.tailTip);
      if (form === 'illumining') {
        s.glowPx(f.px.x + 3, f.px.y, '#4a1a8a', d - 3, f.px.h);
        s.glowPx(f.nx.x, f.nx.y, '#4a1a8a', d - 3, f.nx.h);
        s.glowPx(f.nz.x, f.nz.y, '#4a1a8a', f.nz.w, f.nz.h);
        s.glowPx(f.py.x, f.py.y, '#4a1a8a', f.py.w, d - 3);
      }
    }
  }

  // ---- Hair ornament ----
  {
    const f = s.solid(L.ornament, c.gold);
    s.px(f.px.x, f.px.y, c.teal);
    s.px(f.pz.x + 1, f.pz.y + 1, c.teal);
  }
  return s;
}

/** Named joints the animator drives. */
export interface HsinJoints {
  hips: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  armR: THREE.Group;
  armL: THREE.Group;
  legR: THREE.Group;
  legL: THREE.Group;
  hair: THREE.Group;
  tail1: THREE.Group;
  tail2: THREE.Group;
  tail3: THREE.Group;
  skirt: THREE.Group;
  earR: THREE.Group;
  earL: THREE.Group;
}

export class HsinModel {
  /** Placed at the player's feet; rotation.y is the facing. */
  readonly root = new THREE.Group();
  /** Scaled container: children are in model pixels. */
  readonly body = new THREE.Group();
  readonly joints: HsinJoints;
  /** The floating Rectifier (in model pixels, relative to body). */
  readonly rectifier = new THREE.Group();
  readonly rectifierCore: THREE.Mesh;
  readonly halo = new THREE.Group();
  form: HsinForm = 'answering';
  private readonly uniforms: EntityUniforms;
  private readonly skins: Record<HsinForm, { map: THREE.Texture; glowMap: THREE.Texture }>;
  private readonly rectMat: THREE.ShaderMaterial;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly glowSprite: THREE.Sprite;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private flash = 0;
  private time = 0;
  /** Extra glow strength (e.g. while charging or in cutscenes). */
  glowBoost = 0;

  constructor() {
    const answering = paintSkin('answering').textures();
    const illumining = paintSkin('illumining').textures();
    this.skins = { answering, illumining };
    const mat = createEntityMaterial({ map: answering.map, glowMap: answering.glowMap });
    this.uniforms = mat.uniforms as EntityUniforms;
    const L = LAYOUT.specs;
    const geo = (name: string, inflate = 0) => boxGeometry(L[name], TEX_W, TEX_H, inflate);

    this.root.add(this.body);
    this.body.scale.setScalar(PX);

    // Legs pivot at the hips; the model's right side is -X.
    const legR = joint(this.body, -2, 12, 0, 'legR');
    part(geo('legR'), mat, legR, 0, -6, 0);
    const legL = joint(this.body, 2, 12, 0, 'legL');
    part(geo('legL'), mat, legL, 0, -6, 0);

    const hips = joint(this.body, 0, 12, 0, 'hips');
    part(geo('torso'), mat, hips, 0, 6, 0);
    const skirt = joint(hips, 0, 0, 0, 'skirt');
    part(geo('skirt'), mat, skirt, 0, -1.5, 0);
    part(geo('tabard'), mat, skirt, 0, -3.6, 2.9);

    const armR = joint(hips, -5.5, 10, 0, 'armR');
    part(geo('armR'), mat, armR, 0, -4, 0);
    part(geo('cuffR'), mat, armR, -0.3, -4.3, 0);
    const armL = joint(hips, 5.5, 10, 0, 'armL');
    part(geo('armL'), mat, armL, 0, -4, 0);
    part(geo('cuffL'), mat, armL, 0.3, -4.3, 0);

    const neck = joint(hips, 0, 12, 0, 'neck');
    const head = joint(neck, 0, 0, 0, 'head');
    part(geo('head'), mat, head, 0, 4, 0);
    part(geo('hairCap', 0.6), mat, head, 0, 4, 0);
    part(geo('lockR'), mat, head, -4.4, 1.5, 2.6);
    part(geo('lockL'), mat, head, 4.4, 1.5, 2.6);
    part(geo('ornament'), mat, head, 4.8, 6.2, 1.2);
    const earR = joint(head, -2.7, 8.3, -0.8, 'earR');
    part(geo('earR'), mat, earR, 0, 1.5, 0);
    part(geo('earTipR'), mat, earR, -0.4, 4, 0);
    earR.rotation.z = 0.3;
    const earL = joint(head, 2.7, 8.3, -0.8, 'earL');
    part(geo('earL'), mat, earL, 0, 1.5, 0);
    part(geo('earTipL'), mat, earL, 0.4, 4, 0);
    earL.rotation.z = -0.3;
    const hair = joint(head, 0, 6.5, -4.4, 'hair');
    part(geo('backHair'), mat, hair, 0, -10, -0.6);

    const tail1 = joint(hips, 0, 0.5, -2.2, 'tail1');
    part(geo('tail1'), mat, tail1, 0, 0, -3.5);
    const tail2 = joint(tail1, 0, 0, -6.5, 'tail2');
    part(geo('tail2'), mat, tail2, 0, 0, -4);
    const tail3 = joint(tail2, 0, 0, -7.5, 'tail3');
    part(geo('tail3'), mat, tail3, 0, 0, -3.5);

    this.joints = { hips, neck, head, armR, armL, legR, legL, hair, tail1, tail2, tail3, skirt, earR, earL };

    // ---- Floating Rectifier: a gold moon ring with an Electro core ----
    this.rectMat = createEntityMaterial({ color: HSIN_LOOK.rectifierRing, emissive: 0x201000 });
    const seg = new THREE.BoxGeometry(1.6, 1.6, 1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const m = new THREE.Mesh(seg, this.rectMat);
      m.position.set(Math.cos(a) * 4.2, Math.sin(a) * 4.2, 0);
      m.rotation.z = a;
      this.rectifier.add(m);
    }
    const accent = createEntityMaterial({ color: HSIN_LOOK.teal, emissive: 0x041a18 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.6), accent);
      m.position.set(Math.cos(a) * 5.4, Math.sin(a) * 5.4, 0);
      m.rotation.z = a;
      this.rectifier.add(m);
    }
    this.coreMat = new THREE.MeshBasicMaterial({ color: HSIN_LOOK.rectifierCore });
    this.rectifierCore = new THREE.Mesh(new THREE.OctahedronGeometry(1.9, 0), this.coreMat);
    this.rectifier.add(this.rectifierCore);
    this.glowSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xc890ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glowSprite.scale.setScalar(11);
    this.rectifier.add(this.glowSprite);
    this.rectifier.position.set(10, 26, -4);
    this.body.add(this.rectifier);

    // ---- Illumining halo (hidden in Answering Form) ----
    this.haloMat = new THREE.MeshBasicMaterial({ color: 0xe0c8ff, transparent: true, opacity: 0.9 });
    const hseg = new THREE.BoxGeometry(1.2, 1.2, 0.6);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const m = new THREE.Mesh(hseg, this.haloMat);
      m.position.set(Math.cos(a) * 7, Math.sin(a) * 7, 0);
      m.rotation.z = a;
      this.halo.add(m);
    }
    this.halo.position.set(0, 6, -6.5);
    this.halo.visible = false;
    head.add(this.halo);
  }

  setForm(form: HsinForm): void {
    this.form = form;
    const skin = this.skins[form];
    this.uniforms.map.value = skin.map;
    this.uniforms.glowMap.value = skin.glowMap;
    this.halo.visible = form === 'illumining';
    this.coreMat.color.set(form === 'illumining' ? 0xf0e0ff : HSIN_LOOK.rectifierCore);
  }

  /** Light colour sampled from the world at the player. */
  setLight(c: THREE.Color): void {
    this.uniforms.uLight.value.copy(c);
    (this.rectMat.uniforms as EntityUniforms).uLight.value.copy(c);
  }

  /** Briefly flashes the model (e.g. when hit). */
  hitFlash(color: THREE.ColorRepresentation = 0xff4060, amount = 0.6): void {
    this.uniforms.uFlashColor.value.set(color);
    this.flash = amount;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  /** World position of the Rectifier's core. */
  rectifierWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.rectifierCore.getWorldPosition(out);
  }

  /** World position of a hand (end of the arm). */
  handWorld(side: 'R' | 'L', out: THREE.Vector3): THREE.Vector3 {
    const arm = side === 'R' ? this.joints.armR : this.joints.armL;
    out.set(0, -10, 0);
    return arm.localToWorld(out);
  }

  /** Point slightly above the head, e.g. for floating text. */
  headTopWorld(out: THREE.Vector3): THREE.Vector3 {
    out.set(0, 11, 0);
    return this.joints.head.localToWorld(out);
  }

  update(dt: number): void {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.uniforms.uFlash.value = this.flash;
    const pulse = 0.85 + 0.15 * Math.sin(this.time * 4);
    const illum = this.form === 'illumining';
    this.uniforms.uGlow.value = (illum ? 1.6 : 1) * pulse + this.glowBoost;
    this.rectifierCore.rotation.y += dt * 2.2;
    this.rectifierCore.rotation.x = Math.sin(this.time * 1.3) * 0.4;
    const glow = this.glowSprite.material as THREE.SpriteMaterial;
    glow.opacity = (illum ? 0.85 : 0.6) * pulse + this.glowBoost * 0.3;
    this.glowSprite.scale.setScalar((illum ? 14 : 11) * (1 + this.glowBoost * 0.4));
    if (this.halo.visible) {
      this.halo.rotation.z += dt * 0.8;
      this.haloMat.opacity = 0.65 + 0.25 * Math.sin(this.time * 3);
    }
  }
}

let glowTex: THREE.Texture | null = null;

/** Soft radial gradient used for glows. */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}
