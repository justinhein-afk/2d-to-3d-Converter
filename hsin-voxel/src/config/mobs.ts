// Enemy and animal tuning: health, damage, speed, AI ranges, spawning and drops.
import { B } from '../world/blocks';
import { I } from '../items/items';

export type MobKind = 'husk' | 'archer' | 'colossus' | 'boar' | 'sheep' | 'chicken';

export interface DropEntry {
  item: number;
  min: number;
  max: number;
  chance: number;
}

export interface MobDef {
  kind: MobKind;
  name: string;
  hostile: boolean;
  elite: boolean;
  level: number;
  maxHealth: number;
  /** Walking speed, blocks per second. */
  speed: number;
  /** Collision box. */
  width: number;
  height: number;
  /** Damage per hit to Hsin. */
  damage: number;
  /** Reach of melee attacks (or preferred distance for ranged). */
  attackRange: number;
  /** Seconds of telegraphed wind-up before an attack lands. */
  windup: number;
  attackCooldown: number;
  /** How far away it notices Hsin. */
  detectRange: number;
  /** 0 = flies back when hit, 1 = immovable. */
  knockbackResist: number;
  /** Knockback applied to Hsin by its attacks (blocks/s). */
  knockback: number;
  /** Seconds it flinches when hit (0 = super armour). */
  stagger: number;
  drops: DropEntry[];
}

export const MOBS: Record<MobKind, MobDef> = {
  husk: {
    kind: 'husk',
    name: 'Discord Husk',
    hostile: true,
    elite: false,
    level: 40,
    maxHealth: 9000,
    speed: 3.3,
    width: 0.6,
    height: 1.9,
    damage: 900,
    attackRange: 1.8,
    windup: 0.45,
    attackCooldown: 1.4,
    detectRange: 22,
    knockbackResist: 0,
    knockback: 6,
    stagger: 0.3,
    drops: [
      { item: I.ELECTRO_SHARD, min: 1, max: 1, chance: 0.6 },
      { item: I.COAL, min: 1, max: 2, chance: 0.3 },
    ],
  },
  archer: {
    kind: 'archer',
    name: 'Hollow Archer',
    hostile: true,
    elite: false,
    level: 40,
    maxHealth: 6500,
    speed: 3.0,
    width: 0.6,
    height: 1.9,
    damage: 750,
    attackRange: 11,
    windup: 0.7,
    attackCooldown: 2.4,
    detectRange: 26,
    knockbackResist: 0,
    knockback: 4,
    stagger: 0.3,
    drops: [
      { item: I.BONE, min: 1, max: 2, chance: 0.8 },
      { item: I.ELECTRO_SHARD, min: 1, max: 1, chance: 0.4 },
    ],
  },
  colossus: {
    kind: 'colossus',
    name: 'Iron Colossus',
    hostile: true,
    elite: true,
    level: 50,
    maxHealth: 150000,
    speed: 2.4,
    width: 1.8,
    height: 3.1,
    damage: 2400,
    attackRange: 4.5,
    windup: 1.0,
    attackCooldown: 3.5,
    detectRange: 28,
    knockbackResist: 0.92,
    knockback: 14,
    stagger: 0,
    drops: [
      { item: I.TACET_CORE, min: 1, max: 1, chance: 1 },
      { item: I.IRON_INGOT, min: 3, max: 5, chance: 1 },
      { item: I.DIAMOND, min: 1, max: 2, chance: 0.35 },
      { item: I.ELECTRO_SHARD, min: 3, max: 5, chance: 1 },
    ],
  },
  boar: {
    kind: 'boar',
    name: 'Boar',
    hostile: false,
    elite: false,
    level: 10,
    maxHealth: 2500,
    speed: 2.2,
    width: 0.9,
    height: 0.9,
    damage: 0,
    attackRange: 0,
    windup: 0,
    attackCooldown: 0,
    detectRange: 0,
    knockbackResist: 0,
    knockback: 0,
    stagger: 0.2,
    drops: [{ item: I.RAW_MEAT, min: 1, max: 3, chance: 1 }],
  },
  sheep: {
    kind: 'sheep',
    name: 'Sheep',
    hostile: false,
    elite: false,
    level: 10,
    maxHealth: 2500,
    speed: 2.0,
    width: 0.9,
    height: 1.25,
    damage: 0,
    attackRange: 0,
    windup: 0,
    attackCooldown: 0,
    detectRange: 0,
    knockbackResist: 0,
    knockback: 0,
    stagger: 0.2,
    drops: [
      { item: B.WOOL, min: 1, max: 2, chance: 1 },
      { item: I.RAW_MEAT, min: 1, max: 1, chance: 0.5 },
    ],
  },
  chicken: {
    kind: 'chicken',
    name: 'Chicken',
    hostile: false,
    elite: false,
    level: 5,
    maxHealth: 1200,
    speed: 2.0,
    width: 0.45,
    height: 0.75,
    damage: 0,
    attackRange: 0,
    windup: 0,
    attackCooldown: 0,
    detectRange: 0,
    knockbackResist: 0,
    knockback: 0,
    stagger: 0.2,
    drops: [
      { item: I.FEATHER, min: 1, max: 2, chance: 1 },
      { item: I.RAW_MEAT, min: 1, max: 1, chance: 0.6 },
    ],
  },
};

export const SPAWNING = {
  /** Seconds between spawn attempts. */
  interval: 1.2,
  maxHostile: 12,
  maxPassive: 10,
  maxElite: 1,
  /** Spawn ring around the player (blocks). */
  minDistance: 18,
  maxDistance: 42,
  /** Hostiles further than this vanish; passives use passiveDespawn. */
  hostileDespawn: 72,
  passiveDespawn: 90,
  /** Chance an eligible hostile spawn is an elite (when none exists). */
  eliteChance: 0.06,
  /** Archer share of normal hostile spawns. */
  archerChance: 0.35,
  /** Max block light / sky light for cave spawns; night spawns need darkness overall. */
  caveMaxSkyLight: 3,
  maxBlockLight: 6,
  /** Hostiles in strong daylight fade away after this many seconds unseen in combat. */
  daylightFadeSeconds: 8,
  /** Damage of an unarmed punch (any non-Rectifier slot), before the Rectifier exists. */
  punchDamage: 500,
  punchKnockback: 5,
};
