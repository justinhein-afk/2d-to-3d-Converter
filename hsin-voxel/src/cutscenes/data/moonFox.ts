// Short flourishes for the Moon Fox transformation (< 1 s, no camera takeover).
import type { CutsceneDef } from '../types';

export const moonFoxIn: CutsceneDef = {
  id: 'moonfox',
  name: 'Moon Fox',
  description: 'Hsin bounds forward and becomes the Moon Fox.',
  duration: 0.7,
  takeCamera: false,
  letterbox: false,
  freezeWorld: false,
  skippable: false,
  fx: [
    { t: 0, type: 'flash', at: [0, 0.8, 0], size: 3.2, color: 0xe0c0ff, life: 0.35 },
    { t: 0, type: 'sparks', at: [0, 0.8, 0], count: 40, speed: 4, color: 0xc890ff, life: 0.5 },
    { t: 0.05, type: 'ring', at: [0, 0.05, 0], radius: 2.4, color: 0xc890ff, life: 0.45 },
    { t: 0.1, type: 'bolt', from: [0, 0.9, -0.2], to: [0, 0.9, -2.6], width: 0.18, life: 0.2, color: 0xe0c0ff },
    { t: 0.2, type: 'flash', at: [0, 1.4, 0.4], size: 1.6, color: 0xffe08a, life: 0.3 },
    { t: 0.3, type: 'sparks', at: [0, 0.5, -0.6], count: 20, speed: 2, color: 0xffffff, life: 0.5 },
  ],
  sounds: [{ t: 0, sound: 'fox' }],
};

export const moonFoxOut: CutsceneDef = {
  id: 'moonfox_out',
  name: 'Moon Fox (return)',
  description: 'The fox form unravels back into Hsin.',
  duration: 0.5,
  takeCamera: false,
  letterbox: false,
  freezeWorld: false,
  skippable: false,
  fx: [
    { t: 0, type: 'flash', at: [0, 1, 0], size: 2.6, color: 0xffffff, life: 0.3 },
    { t: 0, type: 'sparks', at: [0, 1, 0], count: 30, speed: 3, color: 0xf4f2f8, life: 0.45 },
    { t: 0.05, type: 'ring', at: [0, 0.05, 0], radius: 1.8, color: 0xe0c0ff, life: 0.4 },
  ],
  sounds: [{ t: 0, sound: 'fox' }],
};
