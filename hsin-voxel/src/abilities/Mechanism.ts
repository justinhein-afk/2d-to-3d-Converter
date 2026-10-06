// The Colossal Xuanfang Mechanism: a giant ivory-and-gold construct that rises from a rune circle,
// raises its fists and slams the target area.
import * as THREE from 'three';
import { easings } from '../core/math';
import { glowTexture } from '../fx/glow';
import { createEntityMaterial, type EntityUniforms } from '../entities/boxModel';

const S = 0.34; // world units per construct pixel

/** Lit-looking construct material (independent of scene lights) that can fade in and out. */
function mat(color: number, emissive = 0x000000): THREE.ShaderMaterial {
  const m = createEntityMaterial({ color, emissive, transparent: true });
  (m.uniforms as EntityUniforms).uOpacity.value = 0;
  return m;
}

export class Mechanism {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly circle = new THREE.Group();
  private readonly materials: Array<THREE.ShaderMaterial | THREE.MeshBasicMaterial | THREE.SpriteMaterial> = [];
  private t = 0;
  private slammed = false;
  readonly duration = 1.9;

  constructor(
    scene: THREE.Scene,
    readonly center: THREE.Vector3,
    yaw: number,
    private readonly slamAt: number,
    private readonly onSlam: () => void,
  ) {
    const ivory = mat(0xf2ecdc, 0x1a1408);
    const gold = mat(0xe8c060, 0x2a1c00);
    const dark = mat(0x3a3448);
    const seam = new THREE.MeshBasicMaterial({ color: 0xc890ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.materials.push(ivory, gold, dark, seam);
    const box = (w: number, h: number, d: number, m: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    // Torso and head (in construct pixels; the body group is scaled by S).
    box(14, 10, 8, ivory, this.body, 0, 5, 0);
    box(15, 2, 9, gold, this.body, 0, 0.5, 0);
    box(15, 1.5, 9, gold, this.body, 0, 10, 0);
    box(4, 4, 1, seam, this.body, 0, 5.5, 4.2);
    box(10, 1, 1, seam, this.body, 0, 2.5, 4.1);
    box(7, 6, 6, ivory, this.body, 0, 14, 0.5);
    box(7.4, 1.2, 6.4, gold, this.body, 0, 17, 0.5);
    box(5, 1.2, 1, seam, this.body, 0, 14.5, 3.6);
    // Horn-like crest.
    box(1.5, 4, 1.5, gold, this.body, -2.5, 19, 0.5).rotation.z = 0.35;
    box(1.5, 4, 1.5, gold, this.body, 2.5, 19, 0.5).rotation.z = -0.35;
    // Shoulders and arms with huge fists.
    for (const [arm, side] of [[this.armR, -1], [this.armL, 1]] as Array<[THREE.Group, number]>) {
      arm.position.set(side * 9.5, 9, 0);
      this.body.add(arm);
      box(6, 5, 6, gold, arm, 0, 0, 0);
      box(4.5, 9, 4.5, ivory, arm, 0, -6, 0);
      box(4.8, 1, 4.8, dark, arm, 0, -10, 0);
      box(7, 6, 7, ivory, arm, 0, -14, 0);
      box(7.4, 1.5, 7.4, gold, arm, 0, -11.5, 0);
      box(1, 4, 1, seam, arm, side * 3.6, -14, 0);
    }
    this.body.scale.setScalar(S);
    this.group.add(this.body);

    // Rune circle on the ground.
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ringMat2 = new THREE.MeshBasicMaterial({ color: 0xc890ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.materials.push(ringMat, ringMat2);
    this.circle.add(new THREE.Mesh(new THREE.RingGeometry(4.6, 5, 64).rotateX(-Math.PI / 2), ringMat));
    this.circle.add(new THREE.Mesh(new THREE.RingGeometry(3.2, 3.4, 48).rotateX(-Math.PI / 2), ringMat2));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.9), ringMat);
      g.position.set(Math.cos(a) * 4.1, 0, Math.sin(a) * 4.1);
      g.rotation.y = -a;
      this.circle.add(g);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xc890ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(9);
    glow.position.y = 3;
    this.materials.push(glow.material);
    this.group.add(glow);
    this.group.add(this.circle);

    // Stand behind the target (as seen from Hsin) and face her, so the fists come down on the target.
    this.group.position.set(center.x + Math.sin(yaw) * 3.4, center.y, center.z + Math.cos(yaw) * 3.4);
    this.group.rotation.y = yaw + Math.PI;
    this.circle.position.set(0, 0.04, 3.4);
    this.body.position.set(0, -5, -1.4);
    scene.add(this.group);
  }

  /** Returns false when finished. */
  update(dt: number): boolean {
    this.t += dt;
    const t = this.t;
    const appear = easings.outCubic(Math.min(1, t / 0.45));
    const fade = t > this.duration - 0.45 ? Math.max(0, (this.duration - t) / 0.45) : 1;
    const alpha = appear * fade;
    for (const m of this.materials) {
      if (m instanceof THREE.ShaderMaterial) (m.uniforms as EntityUniforms).uOpacity.value = alpha;
      else m.opacity = alpha * 0.9;
    }
    this.circle.rotation.y += dt * 1.2;
    this.circle.scale.setScalar(0.4 + 0.6 * appear);
    // Rise out of the circle.
    this.body.position.y = -5 + 5 * appear - (t > this.duration - 0.45 ? (1 - fade) * 3 : 0);
    // Raise fists, then slam.
    const up = Math.min(1, Math.max(0, (t - 0.35) / 0.45));
    const slamT = this.slamAt - 0.15;
    const down = Math.min(1, Math.max(0, (t - slamT) / 0.15));
    const pitch = -2.4 * easings.outCubic(up) + 2.4 * easings.inCubic(down) - 0.35 * down;
    this.armR.rotation.x = pitch;
    this.armL.rotation.x = pitch;
    this.body.rotation.x = 0.25 * down;
    if (!this.slammed && t >= this.slamAt) {
      this.slammed = true;
      this.onSlam();
    }
    if (t >= this.duration) {
      this.dispose();
      return false;
    }
    return true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
