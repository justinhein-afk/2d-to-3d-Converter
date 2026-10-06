import { describe, expect, it } from 'vitest';
import { CUTSCENES, VIEWER_LIST } from '../src/cutscenes';
import type { CutsceneDef } from '../src/cutscenes/types';

function sorted(keys: Array<{ t: number }> | undefined): boolean {
  if (!keys) return true;
  for (let i = 1; i < keys.length; i++) if (keys[i].t < keys[i - 1].t) return false;
  return true;
}

function within(def: CutsceneDef): boolean {
  const all = [...(def.camera ?? []), ...(def.events ?? []), ...(def.fx ?? []), ...(def.sounds ?? []), ...(def.poses ?? [])];
  return all.every((k) => k.t >= 0 && k.t <= def.duration);
}

describe('cutscene data', () => {
  it('keeps every track sorted and inside the scene duration', () => {
    for (const def of Object.values(CUTSCENES)) {
      expect(sorted(def.camera), def.id).toBe(true);
      expect(sorted(def.events), def.id).toBe(true);
      expect(sorted(def.fx), def.id).toBe(true);
      expect(sorted(def.sounds), def.id).toBe(true);
      expect(within(def), def.id).toBe(true);
    }
  });

  it('Formshift is about 3 seconds, letterboxed, skippable, and shifts her form', () => {
    const d = CUTSCENES.formshift;
    expect(d.duration).toBeGreaterThan(2.5);
    expect(d.duration).toBeLessThan(3.5);
    expect(d.takeCamera && d.letterbox && d.freezeWorld && d.skippable).toBe(true);
    expect(d.events?.some((e) => e.event === 'shift')).toBe(true);
    // Starts at the gameplay camera and snaps back to it.
    expect(d.camera?.[0].pos).toBe('gameplay');
    const last = d.camera![d.camera!.length - 1];
    expect(last.pos === 'gameplay' && last.cut).toBe(true);
  });

  it('Pillars Across Heaven is about 4 seconds and applies damage on impact after the white flash', () => {
    const d = CUTSCENES.pillars;
    expect(d.duration).toBeGreaterThan(3.5);
    expect(d.duration).toBeLessThan(4.5);
    const impact = d.events?.find((e) => e.event === 'impact');
    const flash = d.fx?.find((f) => f.type === 'screenFlash');
    expect(impact && flash && flash.t <= impact.t).toBeTruthy();
    expect(d.fx?.some((f) => f.type === 'pillarRain')).toBe(true);
  });

  it('the Moon Fox flourish is under a second and leaves the camera alone', () => {
    for (const id of ['moonfox', 'moonfox_out']) {
      const d = CUTSCENES[id];
      expect(d.duration).toBeLessThan(1);
      expect(d.takeCamera).toBe(false);
      expect(d.letterbox).toBe(false);
      expect(d.freezeWorld).toBe(false);
    }
  });

  it('lists the viewer scenes', () => {
    for (const id of VIEWER_LIST) expect(CUTSCENES[id]).toBeDefined();
  });
});
