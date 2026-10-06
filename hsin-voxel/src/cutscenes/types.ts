// Data format for cutscenes. Everything is plain data so scenes can be edited without touching code.
//
// Positions are in Hsin's local space, captured when the scene starts:
//   [right, up, forward] in blocks, with the origin at her feet.
// Times are seconds from the start of the scene.
import type { EasingName } from '../core/math';

export type Vec3 = [number, number, number];

/** Camera keyframe. The camera eases from the previous key to this one. */
export interface CameraKey {
  t: number;
  /** Camera position, or 'gameplay' for wherever the normal camera is. */
  pos: Vec3 | 'gameplay';
  /** Point to look at (ignored when pos is 'gameplay'). */
  look?: Vec3;
  fov?: number;
  ease?: EasingName;
  /** Jump to this key instantly instead of easing. */
  cut?: boolean;
}

/** Named animator pose (see player/HsinAnimator.ts namedPose) held from t for dur seconds. */
export interface PoseKey {
  t: number;
  dur: number;
  pose: string;
}

/** Gameplay hooks. They always fire, even if the scene is skipped (e.g. 'shift', 'impact'). */
export interface EventKey {
  t: number;
  event: string;
}

export interface SoundKey {
  t: number;
  sound: string;
}

export type FxKey =
  | { t: number; type: 'bolt'; from: Vec3; to: Vec3; width?: number; color?: number; life?: number; branches?: number }
  | { t: number; type: 'pillar'; at: Vec3; radius?: number; height?: number; color?: number; life?: number }
  /** Many pillars at seeded-random spots in a ring, spread over `duration` seconds. */
  | { t: number; type: 'pillarRain'; count: number; minRadius: number; radius: number; duration: number; color?: number; altColor?: number; seed?: number }
  | { t: number; type: 'ring'; at: Vec3; radius: number; color?: number; life?: number }
  | { t: number; type: 'flash'; at: Vec3; size: number; color?: number; life?: number }
  /** Particles that stream inward to a point ("lightning gathers"). */
  | { t: number; type: 'gather'; at: Vec3; radius: number; count: number; duration: number; color?: number }
  | { t: number; type: 'sparks'; at: Vec3; count: number; speed: number; color?: number; life?: number }
  | { t: number; type: 'shake'; amount: number }
  | { t: number; type: 'screenFlash'; color: string; duration: number; strength?: number }
  /** Rectifier / model glow boost, held until the next glow key. */
  | { t: number; type: 'glow'; value: number };

export interface CutsceneDef {
  id: string;
  name: string;
  description: string;
  duration: number;
  /** Takes over the camera (with letterbox bars). Flourishes leave the camera alone. */
  takeCamera: boolean;
  letterbox: boolean;
  /** Freezes enemies and projectiles while playing. */
  freezeWorld: boolean;
  skippable: boolean;
  camera?: CameraKey[];
  poses?: PoseKey[];
  events?: EventKey[];
  fx?: FxKey[];
  sounds?: SoundKey[];
}
