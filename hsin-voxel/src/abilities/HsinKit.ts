// Hsin's combat kit as a state machine: forms, combo, heavy/charge, skills, Liberation,
// Moon Fox, Edict / Radiance Ward stacks, Mechanism Dominion and the revive passive.
// Pure logic: it emits events that AbilityEffects turns into projectiles, damage and visuals.
import { ABILITIES } from '../config/abilities';

export type Form = 'answering' | 'illumining';

export type KitEvent =
  | { type: 'basic'; form: Form; stage: number; dominion: boolean }
  | { type: 'chargeStart' }
  | { type: 'chargeCancel' }
  | { type: 'heavy'; form: Form; realm: boolean; heartBonus: number; charge: number }
  | { type: 'skill' }
  | { type: 'mechanism' }
  | { type: 'pillarsAligned' }
  | { type: 'dominionEnd' }
  | { type: 'foxEnter' }
  | { type: 'foxExit' }
  | { type: 'formshift' }
  | { type: 'pillarsAcrossHeaven' }
  | { type: 'formChanged'; form: Form }
  | { type: 'edict'; target: unknown }
  | { type: 'ward' }
  | { type: 'revive' }
  | { type: 'notReady'; what: string };

export interface KitInput {
  /** The Rectifier is the selected hotbar slot (mouse buttons attack). */
  weaponSelected: boolean;
  attackDown: boolean;
  attackPressed: boolean;
  attackReleased: boolean;
  skillPressed: boolean;
  liberationPressed: boolean;
  /** Movement keys held. */
  moving: boolean;
  /** False during cutscenes, menus, death or while dodging. */
  canAct: boolean;
}

export type ActionKind = 'none' | 'basic' | 'charge' | 'heavy' | 'skill' | 'summon';

export interface KitSave {
  form: Form;
  energy: number;
  answeringHeart: number;
  illuminingHeart: number;
  realmCd: number;
  passiveCd: number;
  edictStacks: number;
  wardStacks: number;
}

const A = ABILITIES;

export class HsinKit {
  form: Form = 'answering';
  energy = 0;
  answeringHeart = 0;
  illuminingHeart = 0;
  /** Cooldowns (seconds remaining). */
  answeringSkillCd = 0;
  illuminingSkillCd = 0;
  realmCd = 0;
  passiveCd = 0;
  edictCd = 0;
  edictStacks = 0;
  wardStacks = 0;
  wardTimer = 0;
  dominion = false;
  fox = false;
  foxWindow = 0;
  formTime = 0;
  /** Current action and its timer. */
  action: ActionKind = 'none';
  actionTime = 0;
  actionDuration = 0;
  stage = 0;
  private fired = false;
  private comboNext = 0;
  private sinceBasic = 999;
  private holding = false;
  private holdTime = 0;
  private buffered = -1;
  /** Liberation in progress (cutscene) — locks the kit until finished. */
  busy = false;
  private readonly events: KitEvent[] = [];
  /** Lets the game veto leaving fox form (no head room). */
  canLeaveFox: () => boolean = () => true;

  /** Drains the events produced since the last call. */
  drain(): KitEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private emit(e: KitEvent): void {
    this.events.push(e);
  }

  get maxEnergy(): number {
    return A.general.maxEnergy;
  }

  get skillCooldown(): number {
    return this.form === 'answering' ? this.answeringSkillCd : this.illuminingSkillCd;
  }

  get skillCooldownMax(): number {
    return this.form === 'answering' ? A.answering.skill.cooldown : A.illumining.skill.cooldown;
  }

  /** True when E will cast Pillars Aligned instead of the Mechanism. */
  get pillarsAlignedReady(): boolean {
    return this.form === 'illumining' && !this.dominion && this.illuminingHeart >= A.general.maxIlluminingHeart;
  }

  get liberationReady(): boolean {
    if (this.busy) return false;
    if (this.form === 'answering') return this.energy >= A.answering.liberation.energyCost;
    return this.formTime >= A.illumining.liberation.minTimeInForm && this.energy >= A.illumining.liberation.energyCost;
  }

  get realmReady(): boolean {
    return this.form === 'answering' && this.realmCd <= 0;
  }

  /** Charge progress 0..1 while holding a heavy attack. */
  get charge(): number {
    if (this.action !== 'charge') return 0;
    return Math.min(1, this.actionTime / A.answering.heavy.chargeTime);
  }

  /** Movement multiplier from the current action. */
  get moveMultiplier(): number {
    if (this.action === 'charge') return A.general.chargeMoveSpeed;
    if (this.action === 'basic' || this.action === 'heavy') return A.general.attackMoveSpeed;
    if (this.action === 'skill' || this.action === 'summon') return 0.25;
    return 1;
  }

  gainEnergy(n: number): void {
    this.energy = Math.min(A.general.maxEnergy, this.energy + n);
  }

  /** Called for each hit that Hsin's attacks land, with the heart and energy values of the attack. */
  onHitLanded(energy: number, heart: number): void {
    this.gainEnergy(energy);
    if (this.form === 'answering') {
      this.answeringHeart = Math.min(A.general.maxAnsweringHeart, this.answeringHeart + heart);
    } else if (!this.dominion) {
      this.illuminingHeart = Math.min(A.general.maxIlluminingHeart, this.illuminingHeart + heart);
    }
  }

  /** Called when Hsin damages a target; may spend an Edict stack to call a Soaring Pillar. */
  onDamageDealt(target: unknown, kind: string): void {
    if (this.form !== 'illumining' || kind === 'pillar' || kind === 'liberation') return;
    if (this.edictStacks <= 0 || this.edictCd > 0) return;
    this.edictStacks--;
    this.edictCd = A.illumining.edict.interval;
    this.emit({ type: 'edict', target });
  }

  /**
   * Applies Illumining Form's damage reduction and Radiance Ward to an incoming hit.
   * Returns the reduced amount and whether knockback should be ignored.
   */
  modifyIncoming(amount: number): { amount: number; resistKnockback: boolean } {
    let a = amount;
    let resist = false;
    if (this.form === 'illumining') {
      a *= 1 - A.illumining.damageReduction;
      if (this.wardTimer <= 0 && this.wardStacks > 0) {
        this.wardStacks--;
        this.wardTimer = A.illumining.radianceWard.duration;
        this.emit({ type: 'ward' });
      }
      if (this.wardTimer > 0) {
        a *= 1 - A.illumining.radianceWard.reduction;
        resist = true;
      }
    }
    return { amount: a, resistKnockback: resist };
  }

  /** Called when a hit would be fatal. Returns true if the passive saves Hsin. */
  tryRevive(): boolean {
    if (this.passiveCd > 0) return false;
    this.passiveCd = A.passive.cooldown;
    this.emit({ type: 'revive' });
    return true;
  }

  /** Switches to Illumining Form (after the Formshift cutscene). */
  enterIllumining(): void {
    this.form = 'illumining';
    this.edictStacks = A.illumining.edict.stacks;
    this.wardStacks = A.illumining.radianceWard.stacks;
    this.wardTimer = 0;
    this.edictCd = 0;
    this.dominion = false;
    this.formTime = 0;
    this.busy = false;
    this.emit({ type: 'formChanged', form: 'illumining' });
  }

  /** Returns to Answering Form (after Pillars Across Heaven). */
  exitToAnswering(): void {
    this.form = 'answering';
    this.edictStacks = 0;
    this.wardStacks = 0;
    this.wardTimer = 0;
    this.dominion = false;
    this.formTime = 0;
    this.busy = false;
    this.emit({ type: 'formChanged', form: 'answering' });
  }

  /** Called by the game once a Liberation cutscene is finished or cancelled. */
  liberationFinished(): void {
    this.busy = false;
  }

  private setAction(kind: ActionKind, duration: number): void {
    this.action = kind;
    this.actionTime = 0;
    this.actionDuration = duration;
    this.fired = false;
  }

  private leaveFox(): boolean {
    if (!this.fox) return true;
    if (!this.canLeaveFox()) {
      this.emit({ type: 'notReady', what: 'No room to change back' });
      return false;
    }
    this.fox = false;
    this.emit({ type: 'foxExit' });
    return true;
  }

  update(dt: number, input: KitInput): void {
    // Timers.
    this.answeringSkillCd = Math.max(0, this.answeringSkillCd - dt);
    this.illuminingSkillCd = Math.max(0, this.illuminingSkillCd - dt);
    this.realmCd = Math.max(0, this.realmCd - dt);
    this.passiveCd = Math.max(0, this.passiveCd - dt);
    this.edictCd = Math.max(0, this.edictCd - dt);
    this.wardTimer = Math.max(0, this.wardTimer - dt);
    this.foxWindow = Math.max(0, this.foxWindow - dt);
    this.formTime += dt;
    if (this.action === 'none') this.sinceBasic += dt;
    if (this.dominion) {
      this.illuminingHeart -= A.illumining.pillarsAligned.drainPerSecond * dt;
      if (this.illuminingHeart <= 0) this.endDominion();
    }

    if (this.busy) return;
    if (!input.canAct) {
      if (this.action === 'charge') this.emit({ type: 'chargeCancel' });
      if (this.action === 'charge' || this.action === 'basic') this.setAction('none', 0);
      this.holding = false;
      this.buffered = -1;
      return;
    }

    // ---- Moon Fox ----
    if (this.fox) {
      if (input.liberationPressed) {
        if (!this.leaveFox()) return;
      } else {
        if ((input.attackPressed && input.weaponSelected) || input.skillPressed) this.leaveFox();
        return;
      }
    } else if (this.foxWindow > 0 && input.moving && this.action !== 'skill') {
      this.foxWindow = 0;
      this.fox = true;
      this.setAction('none', 0);
      this.emit({ type: 'foxEnter' });
      return;
    }

    // ---- Resonance Liberation ----
    if (input.liberationPressed) {
      if (this.form === 'answering') {
        if (this.energy >= A.answering.liberation.energyCost) {
          this.energy -= A.answering.liberation.energyCost;
          this.busy = true;
          this.setAction('none', 0);
          this.emit({ type: 'formshift' });
          return;
        }
        this.emit({ type: 'notReady', what: 'Not enough Resonance Energy' });
      } else {
        const lib = A.illumining.liberation;
        if (this.formTime >= lib.minTimeInForm && this.energy >= lib.energyCost) {
          this.energy -= lib.energyCost;
          this.busy = true;
          this.dominion = false;
          this.setAction('none', 0);
          this.emit({ type: 'pillarsAcrossHeaven' });
          return;
        }
        this.emit({ type: 'notReady', what: this.formTime < lib.minTimeInForm ? 'Pillars are still gathering' : 'Not enough Resonance Energy' });
      }
    }

    // ---- Resonance Skill ----
    if (input.skillPressed && this.action !== 'skill' && this.action !== 'summon') {
      if (this.form === 'answering') {
        if (this.answeringSkillCd <= 0) {
          this.answeringSkillCd = A.answering.skill.cooldown;
          this.setAction('skill', 0.6);
          this.emit({ type: 'skill' });
          this.foxWindow = 0.6 + A.answering.skill.foxWindow;
        } else this.emit({ type: 'notReady', what: 'Resonance Skill on cooldown' });
      } else if (this.pillarsAlignedReady) {
        this.dominion = true;
        this.gainEnergy(A.illumining.pillarsAligned.castEnergy);
        this.setAction('summon', 0.55);
        this.emit({ type: 'pillarsAligned' });
      } else if (this.illuminingSkillCd <= 0) {
        this.illuminingSkillCd = A.illumining.skill.cooldown;
        this.setAction('summon', 0.9);
        this.emit({ type: 'mechanism' });
      } else this.emit({ type: 'notReady', what: 'Resonance Skill on cooldown' });
    }

    // ---- Basic / Heavy attacks ----
    if (input.weaponSelected) {
      if (input.attackPressed) {
        this.holding = true;
        this.holdTime = 0;
        this.buffered = 0;
      }
      if (this.holding) {
        if (input.attackDown) this.holdTime += dt;
        if (input.attackDown && this.holdTime >= A.answering.heavy.holdTime && this.action !== 'charge' && this.canStartCharge()) {
          this.setAction('charge', 99);
          this.buffered = -1;
          this.emit({ type: 'chargeStart' });
        }
        if (input.attackReleased || !input.attackDown) {
          this.holding = false;
          if (this.action === 'charge') this.releaseHeavy();
        }
      }
    } else if (this.action === 'charge') {
      this.emit({ type: 'chargeCancel' });
      this.setAction('none', 0);
      this.holding = false;
    }

    if (this.buffered >= 0) {
      this.buffered += dt;
      if (this.buffered > A.general.inputBuffer) this.buffered = -1;
      else if (this.canStartBasic()) {
        this.buffered = -1;
        this.startBasic();
      }
    }

    // ---- Advance the current action ----
    if (this.action !== 'none') {
      this.actionTime += dt;
      if (this.action === 'basic') {
        const st = this.basicStages()[this.stage];
        if (!this.fired && this.actionTime >= st.fireAt) {
          this.fired = true;
          this.emit({ type: 'basic', form: this.form, stage: this.stage, dominion: this.dominion });
          if (this.dominion) {
            this.illuminingHeart -= A.illumining.pillarsAligned.drainPerAttack;
            if (this.illuminingHeart <= 0) this.endDominion();
          }
        }
      }
      if (this.action === 'charge' && this.actionTime > A.answering.heavy.chargeTime + 2.5) this.releaseHeavy();
      if (this.action !== 'charge' && this.actionTime >= this.actionDuration) {
        if (this.action === 'basic') this.sinceBasic = 0;
        this.setAction('none', 0);
      }
    }
  }

  private basicStages() {
    return this.form === 'answering' ? A.answering.basic : A.illumining.basic;
  }

  private canStartBasic(): boolean {
    if (this.action === 'none') return true;
    if (this.action === 'basic') {
      const st = this.basicStages()[this.stage];
      return this.fired && this.actionTime >= st.duration * 0.7;
    }
    return false;
  }

  private canStartCharge(): boolean {
    return this.action === 'none' || (this.action === 'basic' && this.fired);
  }

  private startBasic(): void {
    const stage = this.sinceBasic > A.general.comboReset && this.action === 'none' ? 0 : this.comboNext;
    this.stage = stage;
    this.comboNext = (stage + 1) % 4;
    this.setAction('basic', this.basicStages()[stage].duration);
  }

  private releaseHeavy(): void {
    const charge = Math.min(1, this.actionTime / A.answering.heavy.chargeTime);
    const realm = this.form === 'answering' && this.realmCd <= 0 && charge >= 0.5;
    let heartBonus = 0;
    if (this.form === 'answering' && this.answeringHeart >= A.general.maxAnsweringHeart && charge >= 0.5) {
      heartBonus = A.answering.heavy.heartBonus;
      this.answeringHeart = 0;
      this.gainEnergy(A.answering.heavy.heartEnergyRefund);
    }
    if (realm) this.realmCd = A.answering.realmProtector.cooldown;
    this.setAction('heavy', realm ? 0.7 : 0.5);
    this.comboNext = 0;
    this.emit({ type: 'heavy', form: this.form, realm, heartBonus, charge });
  }

  private endDominion(): void {
    if (!this.dominion) return;
    this.dominion = false;
    this.illuminingHeart = 0;
    this.emit({ type: 'dominionEnd' });
  }

  serialize(): KitSave {
    return {
      form: this.form,
      energy: this.energy,
      answeringHeart: this.answeringHeart,
      illuminingHeart: this.illuminingHeart,
      realmCd: this.realmCd,
      passiveCd: this.passiveCd,
      edictStacks: this.edictStacks,
      wardStacks: this.wardStacks,
    };
  }

  load(s: Partial<KitSave> | undefined): void {
    if (!s) return;
    this.form = s.form === 'illumining' ? 'illumining' : 'answering';
    this.energy = s.energy ?? 0;
    this.answeringHeart = s.answeringHeart ?? 0;
    this.illuminingHeart = s.illuminingHeart ?? 0;
    this.realmCd = s.realmCd ?? 0;
    this.passiveCd = s.passiveCd ?? 0;
    this.edictStacks = s.edictStacks ?? 0;
    this.wardStacks = s.wardStacks ?? 0;
    this.formTime = A.illumining.liberation.minTimeInForm;
  }
}
