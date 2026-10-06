// Shared combat types.
import type * as THREE from 'three';

export type Team = 'player' | 'enemy' | 'neutral';
export type Element = 'electro' | 'physical' | 'tacet';
export type DamageKind =
  | 'punch' | 'basic' | 'heavy' | 'realm' | 'skill' | 'mechanism' | 'pillar'
  | 'liberation' | 'dominion' | 'mob' | 'fall' | 'other';

export interface DamageInfo {
  amount: number;
  element: Element;
  kind: DamageKind;
  /** Where the hit came from (for knockback direction). */
  source: THREE.Vector3;
  /** Knockback speed in blocks/second. */
  knockback: number;
  crit?: boolean;
  /** Liberation energy Hsin gains when this hit lands (0 if none). */
  energy?: number;
}

/** Anything that can be hit: mobs, and (via the game) Hsin herself. */
export interface Damageable {
  readonly team: Team;
  readonly alive: boolean;
  /** Feet position. */
  readonly position: THREE.Vector3;
  readonly hitWidth: number;
  readonly hitHeight: number;
  /** Applies damage; returns the amount actually dealt. */
  takeDamage(info: DamageInfo): number;
}

/** Centre of a target's hitbox. */
export function targetCenter(t: Damageable, out: THREE.Vector3): THREE.Vector3 {
  return out.set(t.position.x, t.position.y + t.hitHeight * 0.5, t.position.z);
}
