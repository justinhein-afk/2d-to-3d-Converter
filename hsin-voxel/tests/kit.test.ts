import { describe, expect, it } from 'vitest';
import { HsinKit, type KitEvent, type KitInput } from '../src/abilities/HsinKit';
import { ABILITIES as A } from '../src/config/abilities';

const idle: KitInput = {
  weaponSelected: true,
  attackDown: false,
  attackPressed: false,
  attackReleased: false,
  skillPressed: false,
  liberationPressed: false,
  moving: false,
  canAct: true,
};

function run(kit: HsinKit, seconds: number, input: Partial<KitInput> = {}, dt = 1 / 60): KitEvent[] {
  const out: KitEvent[] = [];
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    kit.update(dt, { ...idle, ...input });
    out.push(...kit.drain());
  }
  return out;
}

function tap(kit: HsinKit, input: Partial<KitInput>): KitEvent[] {
  kit.update(1 / 60, { ...idle, ...input });
  return kit.drain();
}

function click(kit: HsinKit): KitEvent[] {
  return [...tap(kit, { attackPressed: true, attackDown: true }), ...tap(kit, { attackReleased: true })];
}

describe('basic attack combo', () => {
  it('cycles through four stages when clicking in rhythm', () => {
    const kit = new HsinKit();
    const stages: number[] = [];
    for (let i = 0; i < 5; i++) {
      for (const e of [...click(kit), ...run(kit, 0.45)]) if (e.type === 'basic') stages.push(e.stage);
      run(kit, 0.3);
    }
    expect(stages).toEqual([0, 1, 2, 3, 0]);
  });

  it('resets to stage 1 after a pause', () => {
    const kit = new HsinKit();
    click(kit);
    run(kit, 0.6);
    run(kit, A.general.comboReset + 0.2);
    const ev = [...click(kit), ...run(kit, 0.4)];
    expect(ev.find((e) => e.type === 'basic')).toMatchObject({ stage: 0 });
  });

  it('builds Answering Heart and energy from hits', () => {
    const kit = new HsinKit();
    kit.onHitLanded(5, 30);
    expect(kit.energy).toBe(5);
    expect(kit.answeringHeart).toBe(30);
  });
});

describe('heavy attack and Realm Protector', () => {
  it('charges while held and fires Realm Protector, then plain heavies until the cooldown ends', () => {
    const kit = new HsinKit();
    tap(kit, { attackPressed: true, attackDown: true });
    const charge = run(kit, A.answering.heavy.holdTime + A.answering.heavy.chargeTime + 0.05, { attackDown: true });
    expect(charge.some((e) => e.type === 'chargeStart')).toBe(true);
    const rel = tap(kit, { attackReleased: true });
    expect(rel.find((e) => e.type === 'heavy')).toMatchObject({ realm: true });
    expect(kit.realmCd).toBeCloseTo(A.answering.realmProtector.cooldown, 1);
    run(kit, 1);
    tap(kit, { attackPressed: true, attackDown: true });
    run(kit, 1, { attackDown: true });
    expect(tap(kit, { attackReleased: true }).find((e) => e.type === 'heavy')).toMatchObject({ realm: false });
    run(kit, A.answering.realmProtector.cooldown);
    expect(kit.realmReady).toBe(true);
  });

  it('spends a full Answering Heart for bonus damage', () => {
    const kit = new HsinKit();
    kit.answeringHeart = A.general.maxAnsweringHeart;
    tap(kit, { attackPressed: true, attackDown: true });
    run(kit, 1, { attackDown: true });
    const heavy = tap(kit, { attackReleased: true }).find((e) => e.type === 'heavy');
    expect(heavy).toMatchObject({ heartBonus: A.answering.heavy.heartBonus });
    expect(kit.answeringHeart).toBe(0);
  });
});

describe('resonance skill and Moon Fox', () => {
  it('has a 12 second cooldown', () => {
    const kit = new HsinKit();
    expect(tap(kit, { skillPressed: true }).some((e) => e.type === 'skill')).toBe(true);
    run(kit, 1);
    expect(tap(kit, { skillPressed: true }).some((e) => e.type === 'notReady')).toBe(true);
    run(kit, A.answering.skill.cooldown);
    expect(tap(kit, { skillPressed: true }).some((e) => e.type === 'skill')).toBe(true);
  });

  it('turns into the Moon Fox when moving right after casting, and back on attack or E', () => {
    const kit = new HsinKit();
    tap(kit, { skillPressed: true });
    const ev = run(kit, 0.9, { moving: true });
    expect(ev.some((e) => e.type === 'foxEnter')).toBe(true);
    expect(kit.fox).toBe(true);
    expect(click(kit).some((e) => e.type === 'foxExit')).toBe(true);
    expect(kit.fox).toBe(false);
    // Standing still after a cast does not transform.
    run(kit, A.answering.skill.cooldown + 0.1);
    tap(kit, { skillPressed: true });
    run(kit, 2);
    expect(kit.fox).toBe(false);
    // E leaves fox form without casting.
    kit.fox = true;
    const e = tap(kit, { skillPressed: true });
    expect(e.some((x) => x.type === 'foxExit')).toBe(true);
    expect(e.some((x) => x.type === 'skill')).toBe(false);
  });
});

describe('forms and liberations', () => {
  it('Formshift needs full energy and grants Edict and Radiance Ward stacks', () => {
    const kit = new HsinKit();
    expect(tap(kit, { liberationPressed: true }).some((e) => e.type === 'notReady')).toBe(true);
    kit.energy = A.general.maxEnergy;
    expect(tap(kit, { liberationPressed: true }).some((e) => e.type === 'formshift')).toBe(true);
    expect(kit.busy).toBe(true);
    kit.enterIllumining();
    expect(kit.form).toBe('illumining');
    expect(kit.edictStacks).toBe(A.illumining.edict.stacks);
    expect(kit.wardStacks).toBe(A.illumining.radianceWard.stacks);
  });

  it('Edict calls at most one pillar per second', () => {
    const kit = new HsinKit();
    kit.enterIllumining();
    kit.drain();
    for (let i = 0; i < 5; i++) kit.onDamageDealt({}, 'basic');
    let pillars = kit.drain().filter((e) => e.type === 'edict').length;
    expect(pillars).toBe(1);
    run(kit, A.illumining.edict.interval + 0.05);
    kit.onDamageDealt({}, 'basic');
    kit.onDamageDealt({}, 'pillar');
    pillars = kit.drain().filter((e) => e.type === 'edict').length;
    expect(pillars).toBe(1);
    expect(kit.edictStacks).toBe(A.illumining.edict.stacks - 2);
  });

  it('reduces damage in Illumining Form and Radiance Ward cuts more for a second', () => {
    const kit = new HsinKit();
    expect(kit.modifyIncoming(1000).amount).toBe(1000);
    kit.enterIllumining();
    const first = kit.modifyIncoming(1000);
    expect(first.amount).toBeCloseTo(1000 * 0.8 * 0.4, 5);
    expect(first.resistKnockback).toBe(true);
    expect(kit.wardStacks).toBe(1);
    // Within the same second the ward doesn't spend another stack.
    kit.modifyIncoming(1000);
    expect(kit.wardStacks).toBe(1);
    run(kit, A.illumining.radianceWard.duration + 0.05);
    kit.modifyIncoming(1000);
    expect(kit.wardStacks).toBe(0);
    run(kit, A.illumining.radianceWard.duration + 0.05);
    expect(kit.modifyIncoming(1000).amount).toBeCloseTo(800, 5);
  });

  it('Pillars Aligned starts Mechanism Dominion when Illumining Heart is full, which drains it', () => {
    const kit = new HsinKit();
    kit.enterIllumining();
    run(kit, A.illumining.liberation.minTimeInForm);
    expect(tap(kit, { skillPressed: true }).some((e) => e.type === 'mechanism')).toBe(true);
    run(kit, 1);
    kit.illuminingHeart = A.general.maxIlluminingHeart;
    expect(tap(kit, { skillPressed: true }).some((e) => e.type === 'pillarsAligned')).toBe(true);
    expect(kit.dominion).toBe(true);
    const ev: KitEvent[] = [];
    for (let i = 0; i < 20 && kit.dominion; i++) {
      ev.push(...click(kit), ...run(kit, 0.5));
    }
    expect(ev.some((e) => e.type === 'basic' && e.dominion)).toBe(true);
    expect(ev.some((e) => e.type === 'dominionEnd')).toBe(true);
    expect(kit.dominion).toBe(false);
  });

  it('Pillars Across Heaven returns to Answering Form', () => {
    const kit = new HsinKit();
    kit.enterIllumining();
    expect(tap(kit, { liberationPressed: true }).some((e) => e.type === 'notReady')).toBe(true);
    run(kit, A.illumining.liberation.minTimeInForm);
    expect(tap(kit, { liberationPressed: true }).some((e) => e.type === 'pillarsAcrossHeaven')).toBe(true);
    kit.exitToAnswering();
    expect(kit.form).toBe('answering');
    expect(kit.edictStacks).toBe(0);
  });
});

describe('passive', () => {
  it('saves Hsin once, then waits for its long cooldown', () => {
    const kit = new HsinKit();
    expect(kit.tryRevive()).toBe(true);
    expect(kit.tryRevive()).toBe(false);
    run(kit, A.passive.cooldown + 1, {}, 0.5);
    expect(kit.tryRevive()).toBe(true);
  });
});
