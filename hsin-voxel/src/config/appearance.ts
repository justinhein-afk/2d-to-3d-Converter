// Hsin's look. Edit these colours to restyle the character; the skin texture is regenerated from them.
// Default palette follows her official art: long white hair past the waist, white fox ears and a big
// white tail with dark tips, red-gold eyes, and a deep red dress with black, gold and teal accents.

export const HSIN_LOOK = {
  skin: '#f6dccb',
  skinShade: '#e8c4b0',
  blush: '#f2b4ae',

  hair: '#f4f2f6',
  hairShade: '#d9d4e2',
  hairDeep: '#b9b2c8',

  earInner: '#f0a0a8',
  tailTip: '#2a2630',

  eyeIris: '#d8283a',
  eyeGlint: '#ffd36a',
  eyeWhite: '#ffffff',
  lash: '#2a2030',
  mouth: '#c46a6a',

  dress: '#9e1626',
  dressShade: '#6e0e1a',
  dressLight: '#c42a38',
  trim: '#16121c',
  gold: '#e8c060',
  goldShade: '#b08a30',
  teal: '#3fc8b8',

  stocking: '#1c1822',
  boot: '#2a1e24',
  bootTrim: '#e8c060',

  // Rectifier: a gold moon ring with an Electro core.
  rectifierRing: '#e8c060',
  rectifierCore: '#c88aff',

  // Illumining Form overrides (applied when she shifts form).
  illumining: {
    dress: '#f2eee6',
    dressShade: '#cfc7b8',
    dressLight: '#ffffff',
    trim: '#5a2a9a',
    gold: '#ffe28a',
    teal: '#b46cff',
    hairShade: '#e2d6f6',
    hairDeep: '#b9a2e6',
    tailTip: '#7a3ad0',
  },
} as const;

/** Electro colours used for effects. */
export const ELECTRO = {
  core: 0xf2e6ff,
  bright: 0xd0a0ff,
  mid: 0xa060ff,
  deep: 0x6a2fd0,
};
