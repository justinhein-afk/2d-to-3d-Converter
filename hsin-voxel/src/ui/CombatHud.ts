// Combat HUD: skill cooldown icons, Liberation energy ring, Forte gauges (Answering / Illumining Heart),
// active form badge, status chips (Edict, Radiance Ward, Moon Fox, Dominion), combo dots and charge ring.
import type { HsinKit } from '../abilities/HsinKit';
import { ABILITIES as A } from '../config/abilities';
import { el } from './dom';
import { skillIcon } from './skillIcons';

const SVG = 'http://www.w3.org/2000/svg';

interface SkillSlot {
  root: HTMLDivElement;
  icon: HTMLDivElement;
  cd: HTMLDivElement;
  cdText: HTMLDivElement;
  name: HTMLDivElement;
  lastIcon: string;
}

function slot(parent: HTMLElement, cls: string, key: string): SkillSlot {
  const root = el('div', `skill ${cls}`, parent);
  const icon = el('div', 'skill-icon', root);
  const cd = el('div', 'skill-cd', root);
  const cdText = el('div', 'skill-cd-text', root);
  el('div', 'skill-key', root, key);
  const name = el('div', 'skill-name', root);
  return { root, icon, cd, cdText, name, lastIcon: '' };
}

function setIcon(s: SkillSlot, name: string): void {
  if (s.lastIcon === name) return;
  s.lastIcon = name;
  s.icon.style.backgroundImage = `url(${skillIcon(name)})`;
}

function setCooldown(s: SkillSlot, remaining: number, max: number): void {
  if (remaining > 0.05) {
    const pct = Math.min(1, remaining / max) * 360;
    s.cd.style.background = `conic-gradient(rgba(6,4,14,0.78) ${pct}deg, transparent ${pct}deg)`;
    s.cd.style.display = '';
    s.cdText.textContent = remaining >= 10 ? Math.ceil(remaining).toString() : remaining.toFixed(1);
    s.root.classList.remove('ready');
  } else {
    s.cd.style.display = 'none';
    s.cdText.textContent = '';
    s.root.classList.add('ready');
  }
}

export class CombatHud {
  readonly root: HTMLDivElement;
  private readonly heavy: SkillSlot;
  private readonly skill: SkillSlot;
  private readonly lib: SkillSlot;
  private readonly passive: SkillSlot;
  private readonly ringArc: SVGCircleElement;
  private readonly answerFill: HTMLDivElement;
  private readonly illumFill: HTMLDivElement;
  private readonly answerGauge: HTMLDivElement;
  private readonly illumGauge: HTMLDivElement;
  private readonly formBadge: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  private readonly combo: HTMLDivElement;
  private readonly comboDots: HTMLDivElement[] = [];
  private readonly chargeArc: SVGCircleElement;
  private readonly chargeSvg: SVGSVGElement;
  private readonly weaponHint: HTMLDivElement;
  private lastChips = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'layer combat-hud', parent);

    // Skills cluster (bottom right).
    const skills = el('div', 'skills', this.root);
    this.passive = slot(skills, 'passive', '');
    this.heavy = slot(skills, 'heavy', 'Hold LMB');
    this.skill = slot(skills, 'eskill', 'E');
    this.lib = slot(skills, 'lib', 'R');
    setIcon(this.passive, 'grace');
    this.passive.name.textContent = A.passive.name;

    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.classList.add('energy-ring');
    const bg = document.createElementNS(SVG, 'circle');
    for (const [k, v] of [['cx', '50'], ['cy', '50'], ['r', '46'], ['fill', 'none'], ['stroke', 'rgba(0,0,0,0.55)'], ['stroke-width', '6']]) bg.setAttribute(k, v);
    this.ringArc = document.createElementNS(SVG, 'circle');
    for (const [k, v] of [['cx', '50'], ['cy', '50'], ['r', '46'], ['fill', 'none'], ['stroke-width', '6'], ['stroke-linecap', 'round'], ['transform', 'rotate(-90 50 50)']]) {
      this.ringArc.setAttribute(k, v);
    }
    this.ringArc.setAttribute('stroke-dasharray', String(2 * Math.PI * 46));
    svg.append(bg, this.ringArc);
    this.lib.root.appendChild(svg);

    // Forte gauges and form badge (above the health bar).
    const forte = el('div', 'forte', this.root);
    this.formBadge = el('div', 'form-badge', forte);
    const gauges = el('div', 'gauges', forte);
    this.answerGauge = el('div', 'gauge answering', gauges);
    el('div', 'gauge-label', this.answerGauge, 'Answering Heart');
    this.answerFill = el('div', 'gauge-fill', el('div', 'gauge-track', this.answerGauge));
    this.illumGauge = el('div', 'gauge illumining', gauges);
    el('div', 'gauge-label', this.illumGauge, 'Illumining Heart');
    this.illumFill = el('div', 'gauge-fill', el('div', 'gauge-track', this.illumGauge));
    this.chips = el('div', 'chips', this.root);

    // Combo dots and charge ring around the crosshair.
    this.combo = el('div', 'combo', this.root);
    for (let i = 0; i < 4; i++) this.comboDots.push(el('div', 'dot', this.combo));
    this.chargeSvg = document.createElementNS(SVG, 'svg');
    this.chargeSvg.setAttribute('viewBox', '0 0 60 60');
    this.chargeSvg.classList.add('charge-ring');
    this.chargeArc = document.createElementNS(SVG, 'circle');
    for (const [k, v] of [['cx', '30'], ['cy', '30'], ['r', '26'], ['fill', 'none'], ['stroke', '#e0c0ff'], ['stroke-width', '3'], ['transform', 'rotate(-90 30 30)']]) {
      this.chargeArc.setAttribute(k, v);
    }
    this.chargeArc.setAttribute('stroke-dasharray', String(2 * Math.PI * 26));
    this.chargeSvg.appendChild(this.chargeArc);
    this.root.appendChild(this.chargeSvg);
    this.weaponHint = el('div', 'weapon-hint', this.root, 'Select slot 1 (Rectifier) to attack');
  }

  update(kit: HsinKit, weaponSelected: boolean, playing: boolean): void {
    this.root.classList.toggle('hidden', !playing);
    const illum = kit.form === 'illumining';
    this.root.classList.toggle('illum', illum);

    // Heavy / Realm Protector.
    if (illum) {
      setIcon(this.heavy, 'realm');
      this.heavy.name.textContent = 'Heavy Attack';
      setCooldown(this.heavy, 0, 1);
      this.heavy.root.classList.remove('special');
    } else {
      setIcon(this.heavy, 'realm');
      this.heavy.name.textContent = kit.realmReady ? 'Realm Protector' : 'Heavy Attack';
      setCooldown(this.heavy, kit.realmCd, A.answering.realmProtector.cooldown);
      this.heavy.root.classList.toggle('special', kit.realmReady);
    }

    // Resonance Skill (form dependent).
    if (kit.fox) {
      setIcon(this.skill, 'fox');
      this.skill.name.textContent = 'Moon Fox (E: change back)';
      setCooldown(this.skill, 0, 1);
      this.skill.root.classList.add('special');
    } else if (kit.pillarsAlignedReady) {
      setIcon(this.skill, 'pillars');
      this.skill.name.textContent = A.illumining.pillarsAligned.name;
      setCooldown(this.skill, 0, 1);
      this.skill.root.classList.add('special');
    } else {
      setIcon(this.skill, illum ? 'fist' : 'burst');
      this.skill.name.textContent = illum ? 'Xuanfang Mechanism' : 'Moonfire Burst';
      setCooldown(this.skill, kit.skillCooldown, kit.skillCooldownMax);
      this.skill.root.classList.toggle('special', kit.foxWindow > 0 && !illum);
      if (kit.foxWindow > 0 && !illum) this.skill.name.textContent = 'Move now: Moon Fox!';
    }

    // Liberation with energy ring.
    setIcon(this.lib, illum ? 'heaven' : 'formshift');
    this.lib.name.textContent = illum ? A.illumining.liberation.name : A.answering.liberation.name;
    const e = kit.energy / kit.maxEnergy;
    const circ = 2 * Math.PI * 46;
    this.ringArc.setAttribute('stroke-dashoffset', String(circ * (1 - (illum ? 1 : e))));
    this.ringArc.setAttribute('stroke', illum ? '#ffd36a' : e >= 1 ? '#f4e6ff' : '#b46cff');
    this.lib.root.classList.toggle('ready', kit.liberationReady);
    this.lib.cd.style.display = kit.liberationReady ? 'none' : '';
    this.lib.cd.style.background = 'rgba(6,4,14,0.55)';
    this.lib.cdText.textContent = illum ? '' : `${Math.floor(kit.energy)}`;

    // Passive cooldown.
    setCooldown(this.passive, kit.passiveCd, A.passive.cooldown);

    // Forte gauges.
    this.answerFill.style.transform = `scaleX(${kit.answeringHeart / A.general.maxAnsweringHeart})`;
    this.illumFill.style.transform = `scaleX(${Math.max(0, kit.illuminingHeart) / A.general.maxIlluminingHeart})`;
    this.answerGauge.classList.toggle('active', !illum);
    this.illumGauge.classList.toggle('active', illum);
    this.answerGauge.classList.toggle('full', kit.answeringHeart >= A.general.maxAnsweringHeart);
    this.illumGauge.classList.toggle('full', kit.illuminingHeart >= A.general.maxIlluminingHeart || kit.dominion);
    this.illumGauge.classList.toggle('dominion', kit.dominion);
    this.formBadge.textContent = kit.fox ? 'Moon Fox' : illum ? 'Illumining Form' : 'Answering Form';
    this.formBadge.className = `form-badge ${kit.fox ? 'fox' : illum ? 'illum' : 'answer'}`;

    // Status chips.
    const chips: string[] = [];
    if (illum) {
      chips.push(`Edict ×${kit.edictStacks}`);
      chips.push(`Radiance Ward ×${kit.wardStacks}${kit.wardTimer > 0 ? ' (active)' : ''}`);
      chips.push(`DMG taken −${Math.round(A.illumining.damageReduction * 100)}%`);
    }
    if (kit.dominion) chips.push('Mechanism Dominion');
    if (kit.fox) chips.push('Moon Fox: fast & high jumps');
    if (kit.realmReady && !illum) chips.push('Realm Protector ready');
    const key = chips.join('|');
    if (key !== this.lastChips) {
      this.lastChips = key;
      this.chips.innerHTML = '';
      for (const c of chips) el('div', `chip${c.startsWith('Mechanism') ? ' gold' : ''}`, this.chips, c);
    }

    // Combo dots and charge ring.
    const inCombo = kit.action === 'basic';
    this.combo.classList.toggle('hidden', !weaponSelected || kit.fox);
    this.comboDots.forEach((d, i) => d.classList.toggle('on', inCombo && i <= kit.stage));
    const ch = kit.charge;
    this.chargeSvg.style.opacity = kit.action === 'charge' ? '1' : '0';
    this.chargeArc.setAttribute('stroke-dashoffset', String(2 * Math.PI * 26 * (1 - ch)));
    this.chargeArc.setAttribute('stroke', ch >= 1 ? (kit.realmReady ? '#ffd36a' : '#ffffff') : '#e0c0ff');
    this.weaponHint.classList.toggle('hidden', weaponSelected || kit.fox);
  }
}
