// GPU particle pool: one Points object, CPU-simulated, additive or normal blended.
import * as THREE from 'three';
import { env } from '../world/materials';

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  color: number | THREE.Color;
  size?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  /** End size multiplier. */
  shrink?: number;
}

const tmpColor = new THREE.Color();

class ParticleLayer {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly shrink: Float32Array;
  private count = 0;

  constructor(private readonly capacity: number, additive: boolean, square: boolean) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.shrink = new Float32Array(capacity);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('palpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uFogColor: env.uFogColor, uFogFar: env.uFogFar },
      vertexShader: /* glsl */ `
        in vec3 color;
        in float psize;
        in float palpha;
        uniform float uScale;
        out vec3 vColor;
        out float vAlpha;
        out float vDist;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_PointSize = psize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
          vColor = color;
          vAlpha = palpha;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor;
        uniform float uFogFar;
        in vec3 vColor;
        in float vAlpha;
        in float vDist;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          ${square ? 'float a = 1.0;' : 'float d = length(p) * 2.0; if (d > 1.0) discard; float a = pow(1.0 - d, 1.5);'}
          float fog = smoothstep(uFogFar * 0.6, uFogFar, vDist);
          gl_FragColor = vec4(${additive ? 'vColor * (1.0 - fog)' : 'mix(vColor, uFogColor, fog)'}, a * vAlpha);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  setScale(viewportHeight: number, fov: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value =
      viewportHeight / (2 * Math.tan((fov * Math.PI) / 360));
  }

  spawn(p: ParticleSpawn): void {
    let i = this.count;
    if (i >= this.capacity) i = Math.floor(Math.random() * this.capacity);
    else this.count++;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx ?? 0;
    this.vel[i * 3 + 1] = p.vy ?? 0;
    this.vel[i * 3 + 2] = p.vz ?? 0;
    if (typeof p.color === 'number') tmpColor.setHex(p.color);
    else tmpColor.copy(p.color);
    this.col[i * 3] = tmpColor.r;
    this.col[i * 3 + 1] = tmpColor.g;
    this.col[i * 3 + 2] = tmpColor.b;
    this.life[i] = this.maxLife[i] = p.life ?? 0.8;
    this.baseSize[i] = this.size[i] = p.size ?? 0.12;
    this.gravity[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 1;
    this.shrink[i] = p.shrink ?? 0.2;
    this.alpha[i] = 1;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.copy(this.count - 1, i);
        this.count--;
        continue;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.baseSize[i] * (1 + (this.shrink[i] - 1) * t);
      this.alpha[i] = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.count);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.palpha as THREE.BufferAttribute).needsUpdate = true;
  }

  private copy(from: number, to: number): void {
    if (from === to) return;
    for (let k = 0; k < 3; k++) {
      this.pos[to * 3 + k] = this.pos[from * 3 + k];
      this.vel[to * 3 + k] = this.vel[from * 3 + k];
      this.col[to * 3 + k] = this.col[from * 3 + k];
    }
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.baseSize[to] = this.baseSize[from];
    this.size[to] = this.size[from];
    this.gravity[to] = this.gravity[from];
    this.drag[to] = this.drag[from];
    this.shrink[to] = this.shrink[from];
    this.alpha[to] = this.alpha[from];
  }

  get active(): number {
    return this.count;
  }
}

/** Two layers: glowing additive particles (electro, sparks) and solid square bits (block debris). */
export class Particles {
  readonly glow = new ParticleLayer(6000, true, false);
  readonly debris = new ParticleLayer(2500, false, true);
  freeze = false;

  constructor(scene: THREE.Scene) {
    scene.add(this.glow.points, this.debris.points);
  }

  setViewport(height: number, fov: number): void {
    this.glow.setScale(height, fov);
    this.debris.setScale(height, fov);
  }

  spark(p: ParticleSpawn): void {
    this.glow.spawn(p);
  }

  bit(p: ParticleSpawn): void {
    this.debris.spawn(p);
  }

  /** Block debris when a block breaks. */
  blockBreak(x: number, y: number, z: number, color: number): void {
    const base = new THREE.Color(color);
    for (let i = 0; i < 18; i++) {
      const c = base.clone().multiplyScalar(0.75 + Math.random() * 0.4);
      this.debris.spawn({
        x: x + 0.15 + Math.random() * 0.7,
        y: y + 0.15 + Math.random() * 0.7,
        z: z + 0.15 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 3 + 1,
        vz: (Math.random() - 0.5) * 3,
        color: c,
        size: 0.09 + Math.random() * 0.05,
        life: 0.5 + Math.random() * 0.4,
        gravity: 14,
        drag: 0.5,
        shrink: 0.6,
      });
    }
  }

  update(dt: number): void {
    if (this.freeze) return;
    this.glow.update(dt);
    this.debris.update(dt);
  }

  get active(): number {
    return this.glow.active + this.debris.active;
  }
}
