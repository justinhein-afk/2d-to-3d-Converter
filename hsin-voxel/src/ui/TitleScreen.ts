// Title screen: list saved worlds, create a new one, delete old ones.
import { stringToSeed } from '../core/math';
import type { WorldMeta, WorldStorage } from '../world/storage';
import { el } from './dom';

export class TitleScreen {
  readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly seedInput: HTMLInputElement;

  constructor(
    parent: HTMLElement,
    private readonly storage: WorldStorage | null,
    private readonly onPlay: (meta: WorldMeta, isNew: boolean) => void,
  ) {
    this.root = el('div', 'screen title-screen', parent);
    const card = el('div', 'panel title-card', this.root);
    el('div', 'logo', card, 'HSIN · VOXEL');
    el('div', 'subtitle', card, 'A blocky sandbox starring the Moon Fox of Mengzhou');
    if (typeof matchMedia === 'function' && !matchMedia('(any-pointer: fine)').matches) {
      el('div', 'notice warn', card, 'This game is played with a keyboard and mouse. Open this page on a computer to play.');
    }

    el('h3', '', card, 'Your worlds');
    this.list = el('div', 'world-list', card);

    el('h3', '', card, 'New world');
    this.nameInput = el('input', '', card);
    this.nameInput.type = 'text';
    this.nameInput.placeholder = 'World name';
    this.nameInput.value = 'Mengzhou Wilds';
    const seedRow = el('div', 'row', card);
    seedRow.style.marginTop = '8px';
    this.seedInput = el('input', '', seedRow);
    this.seedInput.type = 'text';
    this.seedInput.placeholder = 'Seed (blank = random)';
    const create = el('button', 'btn primary', card, 'Create & Play');
    create.addEventListener('click', () => this.createWorld());
    if (!storage) el('div', 'notice', card, 'IndexedDB is unavailable here, so this world will not be saved.');
    void this.refresh();
  }

  async refresh(): Promise<void> {
    let worlds: WorldMeta[] = [];
    try {
      worlds = this.storage ? await this.storage.listWorlds() : [];
    } catch (err) {
      console.warn('Could not read saved worlds.', err);
    }
    this.list.innerHTML = '';
    if (worlds.length === 0) {
      el('div', 'notice', this.list, 'No saved worlds yet.');
      return;
    }
    for (const w of worlds) {
      const row = el('div', 'world-row', this.list);
      const info = el('div', '', row);
      el('div', '', info, w.name);
      el('div', 'meta', info, `Seed ${w.seed} · last played ${new Date(w.lastPlayed).toLocaleString()}`);
      const btns = el('div', 'row', row);
      const play = el('button', 'btn small primary', btns, 'Play');
      play.addEventListener('click', () => this.onPlay(w, false));
      const del = el('button', 'btn small danger', btns, 'Delete');
      // Confirm inside the row: browser confirm() dialogs are blocked on some embedded pages.
      del.addEventListener('click', () => {
        btns.innerHTML = '';
        el('span', 'confirm-text', btns, 'Delete for good?');
        const yes = el('button', 'btn small danger', btns, 'Delete');
        const no = el('button', 'btn small', btns, 'Keep');
        yes.addEventListener('click', async () => {
          try {
            await this.storage?.deleteWorld(w.id);
          } catch (err) {
            console.warn('Could not delete the world.', err);
          }
          void this.refresh();
        });
        no.addEventListener('click', () => void this.refresh());
      });
    }
  }

  private createWorld(): void {
    const name = this.nameInput.value.trim() || 'New World';
    const seedText = this.seedInput.value.trim();
    const seed = seedText ? stringToSeed(seedText) : Math.floor(Math.random() * 2147483647);
    const now = Date.now();
    const meta: WorldMeta = { id: `w${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, name, seed, created: now, lastPlayed: now };
    this.onPlay(meta, true);
  }

  show(): void {
    this.root.classList.remove('hidden');
    void this.refresh();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
