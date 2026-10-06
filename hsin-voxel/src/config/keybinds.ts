// Key bindings (KeyboardEvent.code values). Mouse buttons are fixed: left attack/break, right use/place.

export const KEYBINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dodge: ['ShiftLeft', 'ShiftRight'],
  sprint: ['ControlLeft'],
  skill: ['KeyE'],
  liberation: ['KeyR'],
  inventory: ['Tab', 'KeyI'],
  drop: ['KeyQ'],
  debug: ['F3'],
  toggleView: ['F5', 'KeyV'],
  pause: ['Escape', 'KeyP'],
} as const;

export type Action = keyof typeof KEYBINDS;

/** Shown in the pause menu's keybind list. */
export const KEYBIND_HELP: Array<[string, string]> = [
  ['W A S D', 'Move'],
  ['Double-tap W / Left Ctrl', 'Sprint'],
  ['Space', 'Jump / swim up / skip cutscene'],
  ['Shift', 'Dodge (short invulnerability)'],
  ['Mouse', 'Look around (click the game to capture the mouse)'],
  ['Mouse wheel', 'Camera zoom'],
  ['1 - 9', 'Select hotbar slot (slot 1 is the Rectifier)'],
  ['Left click', 'Rectifier: attack (hold for Heavy Attack) / other slots: break block'],
  ['Right click', 'Place block / eat food'],
  ['Middle click', 'Pick block'],
  ['E', 'Resonance Skill'],
  ['R', 'Resonance Liberation'],
  ['Tab or I', 'Inventory and crafting'],
  ['Q', 'Drop one of the held item'],
  ['F5 or V', 'Toggle first / third person'],
  ['F3', 'Debug info'],
  ['Esc or P', 'Pause menu'],
];
