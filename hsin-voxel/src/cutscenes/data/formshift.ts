// Cutscene 1: Resonance Liberation "Formshift" (~3 s).
// The camera sweeps round to a low front angle, lightning gathers around Hsin, her look shifts to
// Illumining Form (event 'shift'), and the camera snaps back behind her.
import type { CutsceneDef } from '../types';

export const formshift: CutsceneDef = {
  id: 'formshift',
  name: 'Formshift',
  description: 'Answering → Illumining. Lightning gathers, the Moon Fox Sentinel takes her true form.',
  duration: 2.95,
  takeCamera: true,
  letterbox: true,
  freezeWorld: true,
  skippable: true,
  camera: [
    { t: 0, pos: 'gameplay' },
    // Sweep around to a low angle in front of her.
    { t: 0.75, pos: [1.4, 0.45, 3.1], look: [0, 1.25, 0], fov: 58, ease: 'inOutCubic' },
    // Slow push-in while the lightning gathers.
    { t: 1.35, pos: [0.7, 0.55, 2.3], look: [0, 1.35, 0], fov: 50, ease: 'inOutSine' },
    // Kick back with the shockwave.
    { t: 1.55, pos: [1.1, 0.7, 3.2], look: [0, 1.45, 0], fov: 62, ease: 'outExpo' },
    { t: 2.75, pos: [1.6, 0.9, 3.6], look: [0, 1.5, 0], fov: 60, ease: 'inOutSine' },
    // Snap back behind her.
    { t: 2.8, pos: 'gameplay', cut: true },
  ],
  poses: [
    { t: 0, dur: 1.4, pose: 'formshift_gather' },
    { t: 1.4, dur: 1.55, pose: 'formshift_release' },
  ],
  events: [{ t: 1.4, event: 'shift' }],
  fx: [
    { t: 0.0, type: 'glow', value: 0.6 },
    { t: 0.15, type: 'gather', at: [0, 1.25, 0], radius: 4, count: 90, duration: 1.15, color: 0xc890ff },
    { t: 0.35, type: 'bolt', from: [-3, 9, 1], to: [0, 1.4, 0], width: 0.25, life: 0.2 },
    { t: 0.6, type: 'bolt', from: [3.5, 10, -1], to: [0, 1.4, 0], width: 0.3, life: 0.2, branches: 1 },
    { t: 0.85, type: 'bolt', from: [-2, 11, -3], to: [0, 1.4, 0], width: 0.3, life: 0.22 },
    { t: 1.0, type: 'glow', value: 1.4 },
    { t: 1.05, type: 'bolt', from: [2, 12, 3], to: [0, 1.4, 0], width: 0.4, life: 0.25, branches: 2 },
    { t: 1.2, type: 'bolt', from: [0, 13, 0], to: [0, 1.6, 0], width: 0.6, life: 0.3, branches: 3, color: 0xe0c0ff },
    { t: 1.38, type: 'screenFlash', color: '#f0e0ff', duration: 0.45, strength: 0.85 },
    { t: 1.4, type: 'flash', at: [0, 1.3, 0], size: 7, color: 0xe8d4ff, life: 0.5 },
    { t: 1.4, type: 'ring', at: [0, 0.05, 0], radius: 6, color: 0xc890ff, life: 0.7 },
    { t: 1.4, type: 'sparks', at: [0, 1.2, 0], count: 70, speed: 7, color: 0xe0c0ff, life: 0.8 },
    { t: 1.4, type: 'shake', amount: 0.55 },
    { t: 1.5, type: 'pillar', at: [2.6, 0, 1.2], radius: 0.6, color: 0xffd36a, life: 0.7 },
    { t: 1.6, type: 'pillar', at: [-2.6, 0, 1.2], radius: 0.6, color: 0xffd36a, life: 0.7 },
    { t: 1.7, type: 'pillar', at: [1.8, 0, -2.4], radius: 0.6, color: 0xb070ff, life: 0.7 },
    { t: 1.8, type: 'pillar', at: [-1.8, 0, -2.4], radius: 0.6, color: 0xb070ff, life: 0.7 },
    { t: 2.0, type: 'glow', value: 0.4 },
    { t: 2.3, type: 'sparks', at: [0, 1.9, 0], count: 30, speed: 3, color: 0xffd36a, life: 0.9 },
    { t: 2.9, type: 'glow', value: 0 },
  ],
  sounds: [
    { t: 0.1, sound: 'charge' },
    { t: 0.6, sound: 'thunder' },
    { t: 1.2, sound: 'thunder' },
    { t: 1.4, sound: 'formshift' },
  ],
};
