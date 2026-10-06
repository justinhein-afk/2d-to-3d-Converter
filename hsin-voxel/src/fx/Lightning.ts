// Electro visuals: jagged lightning bolts (camera-facing ribbons), sky-to-ground pillars,
// expanding shockwave rings and big glow flashes.
import * as THREE from 'three';
import { glowTexture } from './glow';

export interface BoltOptions {
  width?: number;
  color?: number;
  coreColor?: number;
  life?: number;
  /** Sideways jitter relative to length. */
  jitter?: number;
  branches?: number;
  /** Re-randomise the shape this often (flicker). */
  flicker?: number;
}

const MAX_POINTS = 33;

class Bolt {
  readonly glow: THREE.Mesh;
  readonly core: THREE.Mesh;
  readonly points: THREE.Vector3[] = [];
  from = new THREE.Vector3();
  to = new THREE.Vector3();
  life = 0;
  maxLife = 0;
  width = 0.3;
  jitter = 0.18;
  flicker = 0.06;
  flickerT = 0;
  active = false;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly coreMat: THREE.MeshBasicMaterial;

  constructor(group: THREE.Group) {
    const mk = () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const idx: number[] = [];
      for (let i = 0; i < MAX_POINTS - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      g.setIndex(idx);
      return g;
    };
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xa060ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.glow = new THREE.Mesh(mk(), this.glowMat);
    this.core = new THREE.Mesh(mk(), this.coreMat);
    for (const m of [this.glow, this.core]) {
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = 30;
      group.add(m);
    }
    for (let i = 0; i < MAX_POINTS; i++) this.points.push(new THREE.Vector3());
  }

  start(from: THREE.Vector3, to: THREE.Vector3, o: BoltOptions): void {
    this.from.copy(from);
    this.to.copy(to);
    this.life = this.maxLife = o.life ?? 0.22;
    this.width = o.width ?? 0.3;
    this.jitter = o.jitter ?? 0.18;
    this.flicker = o.flicker ?? 0.05;
    this.flickerT = 0;
    this.glowMat.color.set(o.color ?? 0xa060ff);
    this.coreMat.color.set(o.coreColor ?? 0xf4eaff);
    this.active = true;
    this.glow.visible = this.core.visible = true;
    this.reshape();
  }

  private reshape(): void {
    const n = MAX_POINTS - 1;
    const len = this.from.distanceTo(this.to);
    const dir = new THREE.Vector3().subVectors(this.to, this.from).normalize();
    const side1 = new THREE.Vector3(1, 0, 0);
    if (Math.abs(dir.x) > 0.9) side1.set(0, 1, 0);
    const s1 = side1.cross(dir).normalize();
    const s2 = new THREE.Vector3().crossVectors(dir, s1).normalize();
    // Midpoint displacement for a natural jagged look.
    const off = new Float32Array((n + 1) * 2);
    let step = n;
    let amp = this.jitter * len;
    while (step > 1) {
      const half = step / 2;
      for (let i = half; i < n; i += step) {
        const a = i - half;
        const b = i + half;
        off[i * 2] = (off[a * 2] + off[b * 2]) / 2 + (Math.random() - 0.5) * amp;
        off[i * 2 + 1] = (off[a * 2 + 1] + off[b * 2 + 1]) / 2 + (Math.random() - 0.5) * amp;
      }
      step = half;
      amp *= 0.55;
    }
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.points[i].copy(this.from).lerp(this.to, t).addScaledVector(s1, off[i * 2]).addScaledVector(s2, off[i * 2 + 1]);
    }
  }

  update(dt: number, cam: THREE.Vector3): void {
    this.life -= dt;
    if (this.life <= 0) {
      this.active = false;
      this.glow.visible = this.core.visible = false;
      return;
    }
    this.flickerT += dt;
    if (this.flickerT >= this.flicker) {
      this.flickerT = 0;
      this.reshape();
    }
    const fade = Math.min(1, this.life / (this.maxLife * 0.5));
    this.glowMat.opacity = 0.55 * fade;
    this.coreMat.opacity = fade;
    this.build(this.glow, this.width * 2.6, cam);
    this.build(this.core, this.width * 0.7, cam);
  }

  private build(mesh: THREE.Mesh, width: number, cam: THREE.Vector3): void {
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const tmpDir = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (let i = 0; i < MAX_POINTS; i++) {
      const p = this.points[i];
      const q = this.points[Math.min(MAX_POINTS - 1, i + 1)];
      const r = this.points[Math.max(0, i - 1)];
      tmpDir.subVectors(q, r).normalize();
      toCam.subVectors(cam, p).normalize();
      side.crossVectors(tmpDir, toCam).normalize().multiplyScalar(width * 0.5 * (i === 0 || i === MAX_POINTS - 1 ? 0.4 : 1));
      arr[i * 6] = p.x + side.x;
      arr[i * 6 + 1] = p.y + side.y;
      arr[i * 6 + 2] = p.z + side.z;
      arr[i * 6 + 3] = p.x - side.x;
      arr[i * 6 + 4] = p.y - side.y;
      arr[i * 6 + 5] = p.z - side.z;
    }
    pos.needsUpdate = true;
  }
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  size: number;
  grow: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  radius: number;
}

interface Beam {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  radius: number;
}

export class Lightning {
  private readonly group = new THREE.Group();
  private readonly bolts: Bolt[] = [];
  private readonly flashes: Flash[] = [];
  private readonly rings: Ring[] = [];
  private readonly beams: Beam[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
  private readonly beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true).translate(0, 0.5, 0);
  private readonly beamTex: THREE.Texture;
  freeze = false;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    for (let i = 0; i < 48; i++) this.bolts.push(new Bolt(this.group));
    this.beamTex = beamTexture();
  }

  bolt(from: THREE.Vector3, to: THREE.Vector3, o: BoltOptions = {}): void {
    let b = this.bolts.find((x) => !x.active);
    if (!b) b = this.bolts.reduce((a, c) => (a.life < c.life ? a : c));
    b.start(from, to, o);
    const branches = o.branches ?? 0;
    for (let i = 0; i < branches; i++) {
      const t = 0.2 + Math.random() * 0.6;
      const start = from.clone().lerp(to, t);
      const len = from.distanceTo(to) * (0.15 + Math.random() * 0.2);
      const end = start.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.7) * 2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(len));
      let nb = this.bolts.find((x) => !x.active);
      if (!nb) break;
      nb.start(start, end, { ...o, width: (o.width ?? 0.3) * 0.5, branches: 0 });
    }
  }

  /** A column of lightning from the sky onto a point (Soaring Pillar). */
  pillar(x: number, y: number, z: number, opts: { radius?: number; height?: number; color?: number; life?: number } = {}): void {
    const height = opts.height ?? 22;
    const radius = opts.radius ?? 0.9;
    const color = opts.color ?? 0xb070ff;
    const life = opts.life ?? 0.55;
    const top = new THREE.Vector3(x + (Math.random() - 0.5) * 2, y + height, z + (Math.random() - 0.5) * 2);
    const bottom = new THREE.Vector3(x, y, z);
    this.bolt(top, bottom, { width: 0.5 + radius * 0.3, color, life: life * 0.7, jitter: 0.06, branches: 2, flicker: 0.04 });
    this.bolt(top.clone().add(new THREE.Vector3(0.5, 0, -0.4)), bottom, { width: 0.25, color, life: life * 0.5, jitter: 0.08 });
    const mat = new THREE.MeshBasicMaterial({
      map: this.beamTex,
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.beamGeo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(radius, height, radius);
    mesh.renderOrder = 29;
    this.group.add(mesh);
    this.beams.push({ mesh, life, max: life, radius });
    this.ring(x, y + 0.05, z, radius * 2.6, color, 0.45);
    this.flash(new THREE.Vector3(x, y + 0.6, z), radius * 3.4, color, 0.3);
  }

  /** Expanding flat ring on the ground. */
  ring(x: number, y: number, z: number, radius: number, color: number, life = 0.5): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 28;
    this.group.add(mesh);
    this.rings.push({ mesh, life, max: life, radius });
  }

  /** Big soft glow that pops and fades. */
  flash(pos: THREE.Vector3, size: number, color: number, life = 0.3, grow = 0.4): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sprite.position.copy(pos);
    sprite.scale.setScalar(size);
    sprite.renderOrder = 31;
    this.group.add(sprite);
    this.flashes.push({ sprite, life, max: life, size, grow });
  }

  update(dt: number, camera: THREE.Camera): void {
    if (this.freeze) dt = 0;
    const cam = camera.position;
    for (const b of this.bolts) if (b.active) b.update(dt, cam);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.group.remove(f.sprite);
        f.sprite.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const t = 1 - f.life / f.max;
      f.sprite.scale.setScalar(f.size * (1 + f.grow * t));
      f.sprite.material.opacity = 1 - t * t;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.group.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const t = 1 - r.life / r.max;
      r.mesh.scale.setScalar(r.radius * (0.2 + 0.8 * Math.sqrt(t)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.group.remove(b.mesh);
        (b.mesh.material as THREE.Material).dispose();
        this.beams.splice(i, 1);
        continue;
      }
      const t = 1 - b.life / b.max;
      const w = b.radius * (t < 0.15 ? 0.4 + (t / 0.15) * 0.8 : 1.2 - (t - 0.15) * 1.2);
      b.mesh.scale.x = b.mesh.scale.z = Math.max(0.05, w);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85);
    }
  }

  clear(): void {
    for (const b of this.bolts) b.life = 0;
    for (const f of this.flashes) f.life = 0;
    for (const r of this.rings) r.life = 0;
    for (const b of this.beams) b.life = 0;
  }
}

function beamTexture(): THREE.Texture {
  const w = 4;
  const h = 64;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  // A tube that is brightest near the ground and fades out toward the sky.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
