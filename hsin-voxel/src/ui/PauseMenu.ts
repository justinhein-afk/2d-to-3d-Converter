// Pause menu with tabs: game actions, settings, controls (and extra tabs added by later systems).
import { KEYBIND_HELP } from '../config/keybinds';
import { GAME } from '../config/game';
import type { Settings, SettingsData } from '../core/Settings';
import { el } from './dom';

export interface PauseActions {
  resume: () => void;
  save: () => Promise<void> | void;
  quit: () => void;
}

export class PauseMenu {
  readonly root: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly tabs: Array<{ name: string; build: (c: HTMLElement) => void }> = [];
  private active = 0;
  open = false;

  constructor(parent: HTMLElement, private readonly settings: Settings, private readonly actions: PauseActions) {
    this.root = el('div', 'screen hidden', parent);
    const card = el('div', 'panel pause-card', this.root);
    el('h2', '', card, 'Paused');
    this.tabsEl = el('div', 'tabs', card);
    this.body = el('div', '', card);
    this.addTab('Game', (c) => this.buildGame(c));
    this.addTab('Settings', (c) => this.buildSettings(c));
    this.addTab('Controls', (c) => this.buildControls(c));
  }

  addTab(name: string, build: (c: HTMLElement) => void): void {
    this.tabs.push({ name, build });
    if (this.open) this.render();
  }

  show(tab = 0): void {
    this.open = true;
    this.active = tab;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  private render(): void {
    this.tabsEl.innerHTML = '';
    this.tabs.forEach((t, i) => {
      const b = el('div', `tab${i === this.active ? ' active' : ''}`, this.tabsEl, t.name);
      b.addEventListener('click', () => {
        this.active = i;
        this.render();
      });
    });
    this.body.innerHTML = '';
    this.tabs[this.active].build(this.body);
  }

  private buildGame(c: HTMLElement): void {
    const resume = el('button', 'btn primary', c, 'Resume');
    resume.addEventListener('click', () => this.actions.resume());
    const save = el('button', 'btn', c, 'Save World');
    save.addEventListener('click', async () => {
      save.textContent = 'Saving…';
      await this.actions.save();
      save.textContent = 'Saved ✓';
    });
    const quit = el('button', 'btn danger', c, 'Save & Quit to Title');
    quit.addEventListener('click', () => this.actions.quit());
  }

  private buildSettings(c: HTMLElement): void {
    const s = this.settings;
    const slider = (
      label: string,
      key: keyof SettingsData,
      min: number,
      max: number,
      step: number,
      fmt: (v: number) => string,
      hint?: string,
    ) => {
      const row = el('div', 'setting', c);
      el('div', '', row, label);
      const input = el('input', '', row);
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(s.data[key]);
      const val = el('div', 'val', row, fmt(Number(s.data[key])));
      input.addEventListener('input', () => {
        const v = Number(input.value);
        val.textContent = fmt(v);
        s.set(key, v as never);
      });
      if (hint) el('div', 'hint', row, hint);
    };
    const toggle = (label: string, key: keyof SettingsData, hint?: string) => {
      const row = el('div', 'setting', c);
      el('div', '', row, label);
      const input = el('input', '', row);
      input.type = 'checkbox';
      input.checked = Boolean(s.data[key]);
      el('div', '', row);
      input.addEventListener('change', () => s.set(key, input.checked as never));
      if (hint) el('div', 'hint', row, hint);
    };
    slider('Mouse sensitivity', 'mouseSensitivity', 0.1, 3, 0.05, (v) => v.toFixed(2));
    toggle('Invert mouse Y', 'invertY');
    slider(
      'Render distance',
      'renderDistance',
      GAME.world.minRenderDistance,
      GAME.world.maxRenderDistance,
      1,
      (v) => `${v} ch`,
      'Chunks loaded around you. Lower it if the game stutters.',
    );
    slider('Field of view', 'fov', 50, 110, 1, (v) => `${v}°`);
    slider('Camera shake', 'cameraShake', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    slider('Volume', 'masterVolume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    toggle('Show FPS', 'showFps');
    toggle('Auto-jump onto blocks', 'autoJump');
    toggle(
      'Destructive abilities',
      'destructiveAbilities',
      'Lets big attacks (Realm Protector, Xuanfang Mechanism, Soaring Pillars, Pillars Across Heaven) break blocks.',
    );
    const reset = el('button', 'btn', c, 'Reset to defaults');
    reset.addEventListener('click', () => {
      this.settings.reset();
      this.render();
    });
  }

  private buildControls(c: HTMLElement): void {
    const table = el('table', 'keybinds', c);
    for (const [key, what] of KEYBIND_HELP) {
      const tr = el('tr', '', table);
      el('td', '', tr, key);
      el('td', '', tr, what);
    }
  }
}
