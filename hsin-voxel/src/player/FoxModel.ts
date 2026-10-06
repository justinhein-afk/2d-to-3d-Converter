// The Moon Fox: Hsin's fast exploration form. A white voxel fox with Electro markings,
// a crescent moon on the brow and a big tail with a glowing tip.
import * as THREE from 'three';
import { clamp, mulberry32 } from '../core/math';
import { glowTexture } from '../fx/glow';
import {
  Skin, boxGeometry, createEntityMaterial, faceRects, joint, part,
  type BoxSpec, type EntityUniforms,
} from '../entities/boxModel';

const PARTS: Array<[string, number, number, number]> = [
  ['body', 6, 6, 12],
  ['chest', 6, 4, 3],
  ['head', 6, 5, 5],
  ['snout', 3, 2, 3],
  ['ear', 2, 3, 1],
  ['leg', 2, 6, 2],
  ['tail1', 3, 3, 5],
  ['tail2', 4, 4, 6],
  ['tail3', 4, 4, 5],
];

const W = 64;

function packLayout(): { specs: Record<string, BoxSpec>; height: number } {
  const specs: Record<string, BoxSpec> = {};
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const [name, w, h, d] of PARTS) {
    const pw = 2 * d + 2 * w;
    const ph = d + h;
    if (x + pw > W) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    specs[name] = { w, h, d, u: x, v: y };
    x += pw;
    rowH = Math.max(rowH, ph);
  }
  return { specs, height: Math.ceil((y + rowH) / 8) * 8 };
}

const LAYOUT = packLayout();
const PX = 0.065;

function paint(): Skin {
  const s = new Skin(W, LAYOUT.height);
  const rand = mulberry32(31);
  const fur = ['#f4f2f8', '#e6e2ee', '#d8d2e6'];
  const L = LAYOUT.specs;
  for (const name of Object.keys(L)) {
    const f = faceRects(L[name]);
    for (const r of Object.values(f)) s.noise(r, fur[0], fur, 0.3, rand);
  }
  // Electro stripe along the back and the tail tip.
  const body = faceRects(L.body);
  s.fill(body.py.x + 2, body.py.y, 2, body.py.h, '#b46cff');
  s.glowPx(body.py.x + 2, body.py.y, '#6a2fd0', 2, body.py.h);
  for (const r of [body.px, body.nx]) {
    s.fill(r.x + 2, r.y + 1, 7, 1, '#c890ff');
    s.glowPx(r.x + 2, r.y + 1, '#5a20b0', 7, 1);
  }
  const t3 = faceRects(L.tail3);
  for (const r of Object.values(t3)) {
    s.rect(r, '#d8b8ff');
    s.glowPx(r.x, r.y, '#8a4ae0', r.w, r.h);
  }
  // Face: eyes, nose, crescent moon.
  const head = faceRects(L.head);
  s.px(head.pz.x + 1, head.pz.y + 2, '#d8283a');
  s.px(head.pz.x + 4, head.pz.y + 2, '#d8283a');
  s.glowPx(head.pz.x + 1, head.pz.y + 2, '#5a0a14');
  s.glowPx(head.pz.x + 4, head.pz.y + 2, '#5a0a14');
  s.px(head.py.x + 2, head.py.y + 3, '#ffe08a');
  s.px(head.py.x + 3, head.py.y + 4, '#ffe08a');
  s.px(head.py.x + 3, head.py.y + 2, '#ffe08a');
  s.glowPx(head.py.x + 2, head.py.y + 2, '#a08020', 2, 3);
  const snout = faceRects(L.snout);
  s.fill(snout.pz.x + 1, snout.pz.y, 1, 1, '#2a2030');
  const ear = faceRects(L.ear);
  for (const r of [ear.pz, ear.nz, ear.px, ear.nx]) s.fill(r.x, r.y, r.w, 1, '#2a2630');
  s.fill(ear.pz.x, ear.pz.y + 1, ear.pz.w, 2, '#f0a0a8');
  const leg = faceRects(L.leg);
  for (const r of [leg.pz, leg.nz, leg.px, leg.nx]) s.fill(r.x, r.y + r.h - 2, r.w, 2, '#c8c0d8');
  return s;
}

export class FoxModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly uniforms: EntityUniforms;
  private readonly j: Record<string, THREE.Group> = {};
  private readonly aura: THREE.Sprite;
  private phase = 0;
  private time = 0;
  private flash = 0;

  constructor() {
    const tex = paint().textures();
    const mat = createEntityMaterial({ map: tex.map, glowMap: tex.glowMap });
    this.uniforms = mat.uniforms as EntityUniforms;
    const L = LAYOUT.specs;
    const geo = (n: string) => boxGeometry(L[n], W, LAYOUT.height);
    this.root.add(this.body);
    this.body.scale.setScalar(PX);
    const J = this.j;
    J.torso = joint(this.body, 0, 8.5, 0);
    part(geo('body'), mat, J.torso, 0, 0, 0);
    part(geo('chest'), mat, J.torso, 0, -1.5, 5.6);
    J.head = joint(J.torso, 0, 2.5, 6);
    part(geo('head'), mat, J.head, 0, 0.5, 2.5);
    part(geo('snout'), mat, J.head, 0, -0.5, 6);
    J.earR = joint(J.head, -1.8, 3, 1.8);
    part(geo('ear'), mat, J.earR, 0, 1.5, 0);
    J.earR.rotation.z = 0.2;
    J.earL = joint(J.head, 1.8, 3, 1.8);
    part(geo('ear'), mat, J.earL, 0, 1.5, 0);
    J.earL.rotation.z = -0.2;
    J.legFR = joint(this.body, -2, 6, 4.2);
    part(geo('leg'), mat, J.legFR, 0, -3, 0);
    J.legFL = joint(this.body, 2, 6, 4.2);
    part(geo('leg'), mat, J.legFL, 0, -3, 0);
    J.legBR = joint(this.body, -2, 6, -4.2);
    part(geo('leg'), mat, J.legBR, 0, -3, 0);
    J.legBL = joint(this.body, 2, 6, -4.2);
    part(geo('leg'), mat, J.legBL, 0, -3, 0);
    J.tail1 = joint(J.torso, 0, 1.5, -6);
    part(geo('tail1'), mat, J.tail1, 0, 0, -2.5);
    J.tail2 = joint(J.tail1, 0, 0, -4.5);
    part(geo('tail2'), mat, J.tail2, 0, 0, -3);
    J.tail3 = joint(J.tail2, 0, 0, -5.5);
    part(geo('tail3'), mat, J.tail3, 0, 0, -2.5);
    this.aura = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb070ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.aura.scale.setScalar(1.6);
    this.aura.position.y = 0.55;
    this.root.add(this.aura);
    this.root.visible = false;
  }

  setLight(c: THREE.Color): void {
    this.uniforms.uLight.value.copy(c);
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  hitFlash(): void {
    this.flash = 0.6;
    this.uniforms.uFlashColor.value.set(0xff4060);
  }

  update(dt: number, speed: number, onGround: boolean, vy: number): void {
    this.time += dt;
    const J = this.j;
    const k = 1 - Math.exp(-16 * dt);
    const set = (o: THREE.Object3D, x: number, y = o.rotation.y, z = o.rotation.z) => {
      o.rotation.x += (x - o.rotation.x) * k;
      o.rotation.y += (y - o.rotation.y) * k;
      o.rotation.z += (z - o.rotation.z) * k;
    };
    const run = clamp(speed / 6, 0, 1.5);
    this.phase += dt * (4 + speed * 1.8);
    const g = Math.sin(this.phase);
    const g2 = Math.sin(this.phase + 0.9);
    if (!onGround) {
      const rising = vy > 0;
      set(J.legFR, rising ? -0.9 : -0.5);
      set(J.legFL, rising ? -0.9 : -0.5);
      set(J.legBR, rising ? 0.9 : 0.4);
      set(J.legBL, rising ? 0.9 : 0.4);
      set(J.torso, rising ? -0.25 : 0.2);
      set(J.tail1, rising ? 0.1 : 0.6);
      this.body.position.y = 0;
    } else if (run > 0.05) {
      // Gallop: front pair and back pair alternate.
      set(J.legFR, g * 1.0 * run);
      set(J.legFL, g2 * 1.0 * run);
      set(J.legBR, -g * 1.0 * run);
      set(J.legBL, -g2 * 1.0 * run);
      set(J.torso, Math.sin(this.phase * 2) * 0.08 * run);
      set(J.tail1, 0.15 + 0.1 * g, 0.15 * g2);
      this.body.position.y = Math.abs(g) * 0.06 * run;
    } else {
      set(J.legFR, 0);
      set(J.legFL, 0);
      set(J.legBR, 0);
      set(J.legBL, 0);
      set(J.torso, 0.02 * Math.sin(this.time * 1.8));
      set(J.tail1, 0.45 + 0.1 * Math.sin(this.time * 1.2), 0.35 * Math.sin(this.time * 0.9));
      this.body.position.y = 0;
    }
    set(J.tail2, 0.25, J.tail1.rotation.y * 0.8);
    set(J.tail3, 0.3, J.tail1.rotation.y * 0.6);
    set(J.head, -0.1 + 0.05 * Math.sin(this.time * 2));
    this.flash = Math.max(0, this.flash - dt * 3);
    this.uniforms.uFlash.value = this.flash;
    this.uniforms.uGlow.value = 1 + 0.3 * Math.sin(this.time * 5);
    this.aura.material.opacity = 0.25 + 0.1 * Math.sin(this.time * 4) + run * 0.1;
  }
}
