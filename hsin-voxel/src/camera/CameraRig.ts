// Camera: over-the-shoulder orbit (third person) that never clips through blocks, or first person.
import * as THREE from 'three';
import { GAME } from '../config/game';
import { clamp, damp } from '../core/math';
import { IS_SOLID } from '../world/blocks';
import { raycastVoxels } from '../world/raycast';
import type { World } from '../world/World';

export type CameraMode = 'third' | 'first';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'third';
  yaw = 0;
  pitch = -0.15;
  /** Wanted zoom distance (mouse wheel). */
  zoom: number = GAME.camera.defaultDistance;
  /** Actual distance after collision. */
  distance: number = GAME.camera.defaultDistance;
  /** Unit vector the camera looks along. */
  readonly forward = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  /** Point the camera orbits around (over the shoulder). */
  readonly pivot = new THREE.Vector3();
  /** Extra offset added after collision (screen shake), in camera space. */
  readonly shake = new THREE.Vector3();
  shakeRoll = 0;
  /** When set, a cutscene drives the camera directly. */
  override: { position: THREE.Vector3; target: THREE.Vector3; fov: number } | null = null;
  private baseFov = 75;
  fovKick = 0;
  private shoulder: number = GAME.camera.shoulderOffset;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
  }

  setFov(fov: number): void {
    this.baseFov = fov;
  }

  applyMouse(dx: number, dy: number, sensitivity: number, invertY: boolean): void {
    const k = GAME.camera.baseSensitivity * sensitivity;
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, GAME.camera.minPitch, GAME.camera.maxPitch);
  }

  applyZoom(steps: number): void {
    this.zoom = clamp(this.zoom + steps * 0.6, GAME.camera.minDistance, GAME.camera.maxDistance);
  }

  /** Updates forward/right vectors from yaw and pitch. */
  updateVectors(): void {
    const cp = Math.cos(this.pitch);
    this.forward.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /**
   * Positions the camera around the player.
   * @param feet the player's feet position
   * @param eyeHeight first-person eye height
   */
  update(dt: number, feet: THREE.Vector3, eyeHeight: number, world: World, pivotHeight: number = GAME.camera.pivotHeight): void {
    this.updateVectors();
    const cam = this.camera;
    if (this.override) {
      cam.position.copy(this.override.position);
      cam.lookAt(this.override.target);
      if (cam.fov !== this.override.fov) {
        cam.fov = this.override.fov;
        cam.updateProjectionMatrix();
      }
      this.applyShake();
      return;
    }
    const fov = this.baseFov + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    if (this.mode === 'first') {
      cam.position.set(feet.x, feet.y + eyeHeight, feet.z);
      this.pivot.copy(cam.position);
      this.distance = 0;
      this.applyShake();
      return;
    }

    const pad = GAME.camera.collisionPadding;
    const solid = (id: number) => IS_SOLID[id] === 1;
    const get = (x: number, y: number, z: number) => world.getBlock(x, y, z);
    const head = this.tmp.set(feet.x, feet.y + pivotHeight, feet.z);

    // Shoulder offset, pulled in if a wall is right beside the player.
    let shoulder: number = GAME.camera.shoulderOffset;
    const sideHit = raycastVoxels(get, head.x, head.y, head.z, this.right.x, 0, this.right.z, shoulder + pad, solid);
    if (sideHit) shoulder = Math.max(0, sideHit.dist - pad);
    this.shoulder = damp(this.shoulder, shoulder, 12, dt);
    if (shoulder < this.shoulder) this.shoulder = shoulder;
    this.pivot.copy(head).addScaledVector(this.right, this.shoulder);

    // Pull the camera in front of any block between the pivot and the wanted position.
    const back = this.tmp2.copy(this.forward).negate();
    let allowed = this.zoom;
    const up = Math.cos(this.pitch);
    const offsets: Array<[number, number]> = [[0, 0], [0.18, 0.12], [-0.18, 0.12], [0.18, -0.12], [-0.18, -0.12]];
    for (const [ox, oy] of offsets) {
      const sx = this.pivot.x + this.right.x * ox;
      const sy = this.pivot.y + oy * up;
      const sz = this.pivot.z + this.right.z * ox;
      const hit = raycastVoxels(get, sx, sy, sz, back.x, back.y, back.z, this.zoom + pad, solid);
      if (hit) allowed = Math.min(allowed, hit.dist - pad);
    }
    allowed = Math.max(0.35, allowed);
    if (allowed < this.distance) this.distance = allowed;
    else this.distance = damp(this.distance, allowed, 5, dt);
    cam.position.copy(this.pivot).addScaledVector(back, this.distance);
    this.applyShake();
  }

  private applyShake(): void {
    const cam = this.camera;
    if (this.shake.lengthSq() > 0) {
      cam.updateMatrixWorld();
      const offset = this.shake.clone().applyQuaternion(cam.quaternion);
      cam.position.add(offset);
    }
    if (this.shakeRoll !== 0) cam.rotateZ(this.shakeRoll);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
