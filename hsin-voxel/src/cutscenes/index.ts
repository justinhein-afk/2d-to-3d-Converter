// All cutscenes by id. Add new scenes here to make them available to abilities and the viewer.
import { formshift } from './data/formshift';
import { moonFoxIn, moonFoxOut } from './data/moonFox';
import { pillarsAcrossHeaven } from './data/pillarsAcrossHeaven';
import type { CutsceneDef } from './types';

export const CUTSCENES: Record<string, CutsceneDef> = {
  formshift,
  pillars: pillarsAcrossHeaven,
  moonfox: moonFoxIn,
  moonfox_out: moonFoxOut,
};

/** Scenes listed in the pause menu's Cutscene Viewer. */
export const VIEWER_LIST = ['formshift', 'pillars', 'moonfox'];
