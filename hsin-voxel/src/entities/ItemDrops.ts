// Dropped items: little spinning blocks/sprites with physics that the player picks up.
import * as THREE from 'three';
import { GAME } from '../config/game';
import { RENDER, blockDef } from '../world/blocks';
import { Body, moveBody } from '../world/physics';
import { sampleLightColor } from '../world/lightProbe';
import type { World } from '../world/World';
import { iconCanvas } from '../ui/icons';

interface Drop {
  id: number;
  count: number;
  mesh: THREE.Mesh;
  body: Body;
  age: number;
  pickupDelay: number;
  spin: number;
}

const cubeGeoCache = new Map<number, THREE.BufferGeometry>();
const iconTexCache = new Map<number, THREE.Texture>();
const planeGeo = new THREE.PlaneGeometry(0.42, 0.42);

export class ItemDrops {
  private readonly drops: Drop[] = [];
  private readonly group = new THREE.Group();
  private readonly cubeMaterialTemplate: THREE.ShaderMaterial;
  private readonly atlasUniform: { value: THREE.DataArrayTexture };
  private readonly tint = new THREE.Color();
  private mergeTimer = 0;
  freeze = false;

  constructor(scene: THREE.Scene, private readonly world: World, atlas: THREE.DataArrayTexture) {
    scene.add(this.group);
    this.atlasUniform = { value: atlas };
    this.cubeMaterialTemplate = new THREE.ShaderMaterial({
      uniforms: { uAtlas: this.atlasUniform, uTint: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: /* glsl */ `
        in float layer;
        out vec2 vUv;
        flat out float vLayer;
        out float vShade;
        void main() {
          vUv = uv;
          vLayer = layer;
          vec3 n = normalize(mat3(modelMatrix) * normal);
          vShade = 0.6 + 0.4 * max(n.y, 0.0) + 0.2 * abs(n.z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp sampler2DArray;
        uniform sampler2DArray uAtlas;
        uniform vec3 uTint;
        in vec2 vUv;
        flat in float vLayer;
        in float vShade;
        void main() {
          vec4 t = texture(uAtlas, vec3(vUv.x, 1.0 - vUv.y, vLayer));
          if (t.a < 0.5) discard;
          gl_FragColor = vec4(t.rgb * uTint * min(vShade, 1.0), 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
  }

  get count(): number {
    return this.drops.length;
  }

  spawn(id: number, count: number, x: number, y: number, z: number, vel?: THREE.Vector3, pickupDelay = 0.4): void {
    if (count <= 0) return;
    let mesh: THREE.Mesh;
    if (id < 256 && RENDER[id] === 1) {
      const t = this.cubeMaterialTemplate;
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAtlas: this.atlasUniform, uTint: { value: new THREE.Color(1, 1, 1) } },
        vertexShader: t.vertexShader,
        fragmentShader: t.fragmentShader,
      });
      mesh = new THREE.Mesh(this.cubeGeometry(id), mat);
    } else {
      mesh = new THREE.Mesh(
        planeGeo,
        new THREE.MeshBasicMaterial({ map: this.iconTexture(id), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }),
      );
    }
    const body = new Body(0.14, 0.28);
    body.pos.set(x, y, z);
    if (vel) body.vel.copy(vel);
    else body.vel.set((Math.random() - 0.5) * 2.5, 3 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5);
    this.group.add(mesh);
    this.drops.push({ id, count, mesh, body, age: 0, pickupDelay, spin: Math.random() * Math.PI * 2 });
  }

  private cubeGeometry(id: number): THREE.BufferGeometry {
    let g = cubeGeoCache.get(id);
    if (!g) {
      g = new THREE.BoxGeometry(0.28, 0.28, 0.28);
      const tex = blockDef(id).tex;
      const layers = new Float32Array(24);
      for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) layers[f * 4 + v] = tex[f];
      g.setAttribute('layer', new THREE.BufferAttribute(layers, 1));
      cubeGeoCache.set(id, g);
    }
    return g;
  }

  private iconTexture(id: number): THREE.Texture {
    let t = iconTexCache.get(id);
    if (!t) {
      const cv = iconCanvas(id);
      t = cv ? new THREE.CanvasTexture(cv) : new THREE.Texture();
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      iconTexCache.set(id, t);
    }
    return t;
  }

  /**
   * Simulates drops and hands nearby ones to `collect` (returns how many were taken).
   */
  update(dt: number, target: THREE.Vector3, collect: (id: number, count: number) => number): void {
    if (this.freeze) return;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.pickupDelay -= dt;
      if (d.age > GAME.items.despawnSeconds || d.body.pos.y < -10) {
        this.remove(i);
        continue;
      }
      const b = d.body;
      const dx = target.x - b.pos.x;
      const dz = target.z - b.pos.z;
      const dyChest = target.y + 0.9 - b.pos.y;
      const rel = b.pos.y - target.y;
      const horiz = Math.hypot(dx, dz);
      const dist = Math.hypot(horiz, dyChest);
      let magnet = false;
      if (d.pickupDelay <= 0 && dist < GAME.items.pickupRadius) {
        if (horiz < 0.75 && rel > -0.7 && rel < 1.9) {
          const taken = collect(d.id, d.count);
          d.count -= taken;
          if (d.count <= 0) {
            this.remove(i);
            continue;
          }
          d.pickupDelay = 1;
        } else {
          // Fly toward the player's chest, ignoring gravity.
          magnet = true;
          const speed = 7 + 5 * (1 - dist / GAME.items.pickupRadius);
          const k = 1 - Math.exp(-10 * dt);
          b.vel.x += ((dx / dist) * speed - b.vel.x) * k;
          b.vel.y += ((dyChest / dist) * speed - b.vel.y) * k;
          b.vel.z += ((dz / dist) * speed - b.vel.z) * k;
        }
      }
      if (!magnet) b.vel.y -= 20 * dt;
      if (b.inWater && !magnet) {
        b.vel.y += 26 * dt;
        b.vel.multiplyScalar(Math.exp(-3 * dt));
      }
      moveBody(this.world, b, dt);
      if (b.onGround) {
        const f = Math.exp(-8 * dt);
        b.vel.x *= f;
        b.vel.z *= f;
      }
      d.spin += dt * 1.6;
      d.mesh.position.set(b.pos.x, b.pos.y + 0.18 + Math.sin(d.age * 3) * 0.05, b.pos.z);
      d.mesh.rotation.y = d.spin;
      sampleLightColor(this.world, b.pos.x, b.pos.y + 0.2, b.pos.z, this.tint);
      const m = d.mesh.material as THREE.ShaderMaterial | THREE.MeshBasicMaterial;
      if ('uniforms' in m && m.uniforms.uTint) (m.uniforms.uTint.value as THREE.Color).copy(this.tint);
      else (m as THREE.MeshBasicMaterial).color.copy(this.tint);
    }
    this.mergeTimer -= dt;
    if (this.mergeTimer <= 0) {
      this.mergeTimer = 0.5;
      this.merge();
    }
  }

  private merge(): void {
    for (let i = 0; i < this.drops.length; i++) {
      for (let j = this.drops.length - 1; j > i; j--) {
        const a = this.drops[i];
        const b = this.drops[j];
        if (a.id !== b.id || a.count + b.count > 64) continue;
        if (a.body.pos.distanceToSquared(b.body.pos) < 0.8) {
          a.count += b.count;
          this.remove(j);
        }
      }
    }
  }

  private remove(i: number): void {
    const d = this.drops[i];
    this.group.remove(d.mesh);
    (d.mesh.material as THREE.Material).dispose();
    this.drops.splice(i, 1);
  }

  clear(): void {
    for (let i = this.drops.length - 1; i >= 0; i--) this.remove(i);
  }
}
