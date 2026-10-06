// General game tuning: world, player movement, camera and survival rules.
// Combat and ability numbers live in ./abilities.ts.

export const GAME = {
  world: {
    /** Real-time seconds for one full day/night cycle. */
    dayLengthSeconds: 720,
    /** Time of day a new world starts at (0 = midnight, 0.25 = sunrise, 0.5 = noon). */
    startTime: 0.3,
    /** Seconds between automatic saves. */
    autosaveSeconds: 45,
    /** Hard limits for the render distance setting (in chunks). */
    minRenderDistance: 2,
    maxRenderDistance: 16,
  },

  player: {
    width: 0.6,
    height: 1.8,
    eyeHeight: 1.62,
    maxHealth: 12000,
    walkSpeed: 4.6,
    sprintSpeed: 7.2,
    swimSpeed: 2.6,
    airControl: 0.35,
    gravity: 28,
    jumpVelocity: 8.6,
    terminalVelocity: 55,
    /** Blocks fallen before fall damage starts. */
    safeFallDistance: 4,
    /** Fraction of max health lost per block fallen past the safe distance. */
    fallDamagePerBlock: 0.06,
    /** Seconds between double taps of W that trigger a sprint. */
    doubleTapWindow: 0.3,
    reach: 6,
    maxStamina: 240,
    staminaRegenPerSecond: 60,
    staminaRegenDelay: 0.8,
    sprintStaminaPerSecond: 0,
    /** Health regained per second while out of combat (fraction of max). */
    passiveRegen: 0.004,
    outOfCombatDelay: 6,
  },

  dodge: {
    staminaCost: 40,
    duration: 0.32,
    distance: 4.2,
    /** Invulnerability window at the start of a dodge, seconds. */
    invulnerability: 0.26,
    cooldown: 0.45,
  },

  camera: {
    minDistance: 1.6,
    maxDistance: 9,
    defaultDistance: 4.2,
    shoulderOffset: 0.55,
    pivotHeight: 1.55,
    minPitch: -1.35,
    maxPitch: 1.25,
    /** Radians per pixel at sensitivity 1. */
    baseSensitivity: 0.0024,
    collisionPadding: 0.22,
  },

  items: {
    maxStack: 64,
    pickupRadius: 2.6,
    despawnSeconds: 300,
  },
} as const;
