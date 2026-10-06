// Cutscene 2: Resonance Liberation "Pillars Across Heaven" (~4 s).
// The camera pulls up and back, pillars of lightning rain down across the area, a white flash on
// impact, then the damage is applied (event 'impact') and Hsin returns to Answering Form.
import type { CutsceneDef } from '../types';

export const pillarsAcrossHeaven: CutsceneDef = {
  id: 'pillars',
  name: 'Pillars Across Heaven',
  description: 'Illumining finisher. The sky answers her call with pillars of lightning.',
  duration: 4.05,
  takeCamera: true,
  letterbox: true,
  freezeWorld: true,
  skippable: true,
  camera: [
    { t: 0, pos: 'gameplay' },
    // Close on her raised hand first.
    { t: 0.55, pos: [1.6, 1.4, 2.4], look: [0, 2.4, 0], fov: 55, ease: 'inOutCubic' },
    // Pull up and back to take in the whole area.
    { t: 1.45, pos: [3.5, 9, -11], look: [0, 0.5, 5], fov: 72, ease: 'inOutCubic' },
    { t: 3.0, pos: [4, 11.5, -13.5], look: [0, 0, 6], fov: 74, ease: 'inOutSine' },
    // Lurch on impact.
    { t: 3.25, pos: [3.6, 10.5, -12.5], look: [0, 0.4, 6], fov: 80, ease: 'outExpo' },
    { t: 3.9, pos: [3.4, 9.5, -11.5], look: [0, 0.8, 5], fov: 74, ease: 'inOutSine' },
    { t: 3.95, pos: 'gameplay', cut: true },
  ],
  poses: [
    { t: 0, dur: 1.9, pose: 'pillars_raise' },
    { t: 1.9, dur: 2.15, pose: 'pillars_strike' },
  ],
  events: [{ t: 3.2, event: 'impact' }],
  fx: [
    { t: 0.0, type: 'glow', value: 1.0 },
    { t: 0.1, type: 'gather', at: [0, 3.1, 0.2], radius: 3, count: 60, duration: 0.8, color: 0xffd36a },
    { t: 0.7, type: 'bolt', from: [0, 3.0, 0.2], to: [0, 24, 2], width: 0.5, life: 0.4, branches: 3, color: 0xe0c0ff },
    { t: 0.75, type: 'flash', at: [0, 3.0, 0.2], size: 4, color: 0xfff0c8, life: 0.4 },
    { t: 0.8, type: 'shake', amount: 0.25 },
    { t: 1.05, type: 'pillarRain', count: 18, minRadius: 3, radius: 13, duration: 1.95, color: 0xb070ff, altColor: 0xffd36a, seed: 7 },
    { t: 1.6, type: 'shake', amount: 0.25 },
    { t: 2.4, type: 'shake', amount: 0.3 },
    { t: 2.95, type: 'pillar', at: [0, 0, 6], radius: 2.4, height: 34, color: 0xf4e6ff, life: 0.9 },
    { t: 3.12, type: 'screenFlash', color: '#ffffff', duration: 0.7, strength: 1 },
    { t: 3.2, type: 'ring', at: [0, 0.05, 0], radius: 15, color: 0xf4e6ff, life: 0.9 },
    { t: 3.2, type: 'ring', at: [0, 0.07, 0], radius: 9, color: 0xffd36a, life: 0.7 },
    { t: 3.2, type: 'shake', amount: 1 },
    { t: 3.2, type: 'sparks', at: [0, 1, 4], count: 90, speed: 12, color: 0xe0c0ff, life: 1 },
    { t: 3.6, type: 'glow', value: 0 },
  ],
  sounds: [
    { t: 0.1, sound: 'charge' },
    { t: 0.7, sound: 'thunder' },
    { t: 1.1, sound: 'rumble' },
    { t: 3.1, sound: 'finisher' },
  ],
};
