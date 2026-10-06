// Every number in Hsin's combat kit, in one place. Damage values are before the small random spread
// and crits. Times are in seconds, distances in blocks, energy/gauges in points.

export const ABILITIES = {
  general: {
    critRate: 0.25,
    critDamage: 1.5,
    /** Random spread applied to every hit (±). */
    damageSpread: 0.05,
    /** Liberation energy needed for Formshift. */
    maxEnergy: 125,
    maxAnsweringHeart: 100,
    maxIlluminingHeart: 100,
    /** How far attacks reach and how wide the aim assist cone is (degrees). */
    attackRange: 45,
    aimAssistDegrees: 7,
    /** Time a buffered click waits for the current attack to finish. */
    inputBuffer: 0.35,
    /** Combo resets this long after the last basic attack ends. */
    comboReset: 0.9,
    /** Movement speed multiplier while attacking / charging. */
    attackMoveSpeed: 0.55,
    chargeMoveSpeed: 0.35,
  },

  answering: {
    /** 4-stage ranged Electro combo. `fireAt` = when in the stage the shot leaves. */
    basic: [
      { damage: 1150, duration: 0.42, fireAt: 0.12, shots: 1, spread: 0, speed: 38, energy: 2, heart: 7 },
      { damage: 860, duration: 0.42, fireAt: 0.12, shots: 2, spread: 0.06, speed: 38, energy: 2, heart: 8 },
      { damage: 740, duration: 0.5, fireAt: 0.16, shots: 3, spread: 0.12, speed: 36, energy: 3, heart: 10 },
      { damage: 3100, duration: 0.72, fireAt: 0.38, shots: 1, spread: 0, speed: 30, energy: 5, heart: 16, aoeRadius: 2.6 },
    ],
    heavy: {
      /** Hold left click this long to start charging. */
      holdTime: 0.32,
      /** Additional time to reach full charge. */
      chargeTime: 0.45,
      damage: 4400,
      speed: 42,
      energy: 6,
      heart: 12,
      /** A full Answering Heart is spent by the next Heavy Attack for this much extra damage. */
      heartBonus: 0.8,
      heartEnergyRefund: 10,
    },
    realmProtector: {
      /** Every this many seconds the Heavy Attack is upgraded to Realm Protector. */
      cooldown: 24,
      damage: 16500,
      radius: 5.2,
      speed: 26,
      energy: 15,
      heart: 25,
      /** Blocks broken when destructive abilities are enabled. */
      blockRadius: 2.6,
    },
    skill: {
      name: 'Resonance Skill: Moonfire Burst',
      cooldown: 12,
      damage: 5400,
      radius: 4.6,
      /** How far the skill can reach a target. */
      range: 32,
      energy: 12,
      heart: 25,
      /** Moving within this window after the burst turns Hsin into the Moon Fox. */
      foxWindow: 0.75,
    },
    moonFox: {
      speedMultiplier: 2.1,
      jumpMultiplier: 1.55,
      width: 0.7,
      height: 0.9,
      cameraPivot: 0.85,
    },
    liberation: {
      name: 'Formshift',
      energyCost: 125,
    },
  },

  illumining: {
    /** Damage taken is reduced by this fraction while in Illumining Form. */
    damageReduction: 0.2,
    edict: {
      stacks: 21,
      /** At most one Soaring Pillar per this many seconds. */
      interval: 1,
      damage: 2600,
      radius: 2.2,
      energy: 1,
      blockRadius: 1.2,
    },
    radianceWard: {
      stacks: 2,
      /** Damage reduction while a Ward is active. */
      reduction: 0.6,
      duration: 1,
    },
    /** Stronger Electro combo that builds Illumining Heart. */
    basic: [
      { damage: 1500, duration: 0.42, fireAt: 0.12, shots: 1, spread: 0, speed: 44, energy: 2, heart: 9 },
      { damage: 1150, duration: 0.42, fireAt: 0.12, shots: 2, spread: 0.06, speed: 44, energy: 2, heart: 10 },
      { damage: 980, duration: 0.5, fireAt: 0.16, shots: 3, spread: 0.12, speed: 42, energy: 3, heart: 12 },
      { damage: 4300, duration: 0.72, fireAt: 0.38, shots: 1, spread: 0, speed: 36, energy: 5, heart: 18, aoeRadius: 3 },
    ],
    heavy: {
      damage: 5600,
      speed: 46,
      energy: 6,
      heart: 14,
    },
    skill: {
      name: 'Resonance Skill: Colossal Xuanfang Mechanism',
      cooldown: 20,
      damage: 15000,
      radius: 6,
      range: 32,
      energy: 10,
      heart: 30,
      /** Seconds from summoning to the slam landing. */
      slamDelay: 1.05,
      blockRadius: 3,
    },
    pillarsAligned: {
      name: 'Pillars Aligned',
      /** In Mechanism Dominion, basic attacks deal this much more damage... */
      damageMultiplier: 1.8,
      /** ...each call down an extra lightning pillar on what they hit... */
      pillarDamage: 2200,
      /** ...and drain this much Illumining Heart. Dominion ends when the gauge is empty. */
      drainPerAttack: 14,
      /** Gauge also drains slowly over time. */
      drainPerSecond: 3,
      castEnergy: 10,
    },
    liberation: {
      name: 'Pillars Across Heaven',
      /** Energy needed (0 = free, it is the exit from Illumining Form). */
      energyCost: 0,
      /** Must have been in Illumining Form at least this long. */
      minTimeInForm: 3,
      damage: 46000,
      radius: 14,
      pillarCount: 11,
      pillarDamage: 3000,
      blockRadius: 2.2,
    },
  },

  passive: {
    name: "Heart Moon's Grace",
    /** On a fatal hit: survive, heal to full and become invulnerable. */
    invulnerability: 1,
    cooldown: 300,
  },

  /** Energy gained per kill (any form). */
  energyPerKill: 4,
} as const;

export type BasicStage = (typeof ABILITIES.answering.basic)[number] | (typeof ABILITIES.illumining.basic)[number];
