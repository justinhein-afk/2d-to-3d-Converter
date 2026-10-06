// Entry point: builds textures, shows the title screen and starts a Game.
import './styles.css';
import { Game } from './core/Game';
import { Settings } from './core/Settings';
import { buildItemIcons } from './ui/icons';
import { TitleScreen } from './ui/TitleScreen';
import { WorldStorage, type WorldMeta } from './world/storage';
import { buildTextureAtlas } from './world/textures';

declare global {
  interface Window {
    game?: Game;
    startWorld?: (meta: WorldMeta, isNew: boolean) => Promise<Game>;
  }
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const atlas = buildTextureAtlas();
  buildItemIcons(atlas);
  const settings = new Settings();
  const storage = await WorldStorage.open();
  const gameRoot = document.createElement('div');
  gameRoot.className = 'layer';
  gameRoot.style.pointerEvents = 'auto';
  app.appendChild(gameRoot);

  let title: TitleScreen;
  const startWorld = async (meta: WorldMeta, isNew: boolean): Promise<Game> => {
    title.hide();
    const game = await Game.create(gameRoot, meta, storage, settings, atlas, isNew, () => {
      window.game = undefined;
      title.show();
    });
    window.game = game;
    game.start();
    return game;
  };
  title = new TitleScreen(app, storage, (meta, isNew) => void startWorld(meta, isNew));
  window.startWorld = startWorld;
}

void boot();
