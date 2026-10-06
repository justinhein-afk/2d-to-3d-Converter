// Item icons: isometric cubes for blocks (drawn from the atlas), pixel sprites for items.
import { RENDER, blockDef } from '../world/blocks';
import type { TextureAtlas } from '../world/textures';
import { I, allItems } from '../items/items';

const SIZE = 48;
const icons = new Map<number, string>();
const canvases = new Map<number, HTMLCanvasElement>();

type Sprite = { rows: string[]; palette: Record<string, string> };

const INGOT_ROWS = [
  '................', '................', '................', '................', '................',
  '.....hhhhhhh....', '....hLLLLLLLh...', '...hLLLLLLLLLh..', '..hMMMMMMMMMMMh.', '..hMMMMMMMMMMh..',
  '..hDDDDDDDDDh...', '..hhhhhhhhhh....', '................', '................', '................', '................',
];
const MEAT_ROWS = [
  '................', '................', '......oooo......', '....ooRrrroo....', '...oRrrrwrrro...',
  '..oRrrrwwrrrro..', '..oRrrrrwrrrro..', '.oRrrrrrrrrrro..', '.oRrrrwrrrrrro..', '.oRRrrwwrrrrro..',
  '..oRRrrrrrrro...', '...ooRRrrrro....', '.....ooooooo....', '................', '................', '................',
];

const SPRITES: Record<number, Sprite> = {
  [I.STICK]: {
    rows: [
      '................', '............bB..', '...........bBb..', '..........bBb...', '.........bBb....',
      '........bBb.....', '.......bBb......', '......bBb.......', '.....bBb........', '....bBb.........',
      '...bBb..........', '..bBb...........', '..bb............', '................', '................', '................',
    ],
    palette: { B: '#a07a45', b: '#6b4a26' },
  },
  [I.COAL]: {
    rows: [
      '................', '................', '......kkkk......', '....kkKKkkkk....', '...kKKkkkkKkk...',
      '..kKkkkgkkkkkk..', '..kkkkkkkkKkkk..', '.kkkgkkkkkkkkkk.', '.kkkkkKkkkgkkkk.', '..kkkkkkkkkkkk..',
      '..kkgkkkkkKkkk..', '...kkkkKkkkkk...', '....kkkkkkkk....', '......kkkk......', '................', '................',
    ],
    palette: { k: '#202020', K: '#3a3a3a', g: '#5c5c5c' },
  },
  [I.IRON_INGOT]: { rows: INGOT_ROWS, palette: { h: '#4a4a4a', L: '#f0f0f0', M: '#cfcfcf', D: '#9a9a9a' } },
  [I.GOLD_INGOT]: { rows: INGOT_ROWS, palette: { h: '#7a5a10', L: '#fff7a0', M: '#f4d030', D: '#c89a18' } },
  [I.DIAMOND]: {
    rows: [
      '................', '................', '................', '....dccccccd....', '...dCwCcccccd...',
      '..dCCCccccccdd..', '.dddddddddddddd.', '..dccccccccccd..', '...dccccccccd...', '....dccccccd....',
      '.....dccccd.....', '......dccd......', '.......dd.......', '................', '................', '................',
    ],
    palette: { d: '#1f8a92', c: '#5decf5', C: '#a8fbff', w: '#ffffff' },
  },
  [I.RAW_MEAT]: { rows: MEAT_ROWS, palette: { o: '#6a2a2a', R: '#b84a4a', r: '#e07070', w: '#f4d0c0' } },
  [I.COOKED_MEAT]: { rows: MEAT_ROWS, palette: { o: '#3a1e10', R: '#7a4024', r: '#a0603a', w: '#c88a58' } },
  [I.FEATHER]: {
    rows: [
      '................', '...........ww...', '..........wwgw..', '.........wwgww..', '........wwgww...',
      '.......wwgww....', '......wwgww.....', '.....wwgww......', '....wwgww.......', '...wwgww........',
      '...wgww.........', '..wsww..........', '..s.............', '.s..............', '................', '................',
    ],
    palette: { w: '#f4f4f8', g: '#c8c8d0', s: '#8a8a90' },
  },
  [I.BONE]: {
    rows: [
      '................', '................', '...........ww...', '..........wwww..', '..........wwgw..',
      '.........wwg....', '........wwg.....', '.......wwg......', '......wwg.......', '.....wwg........',
      '....wwg.........', '..wgww..........', '..wwww..........', '...ww...........', '................', '................',
    ],
    palette: { w: '#f0eee0', g: '#c8c4b0' },
  },
  [I.ELECTRO_SHARD]: {
    rows: [
      '................', '..........dw....', '.........dPw....', '........dPPd....', '.......dPPpd....',
      '......dPPppd....', '.....dPPppd.....', '....dPPppd......', '...dPPppd.......', '...dPppd........',
      '..dPppd.........', '..dppd..........', '..dpd...........', '..dd............', '................', '................',
    ],
    palette: { d: '#5a259a', p: '#b46cff', P: '#e0c0ff', w: '#ffffff' },
  },
  [I.TACET_CORE]: {
    rows: [
      '................', '................', '......kkkk......', '....kkkkkkkk....', '...kkttttttkk...',
      '...ktkkkkkktk...', '..kktkppppktkk..', '..kktkpwwpktkk..', '..kktkpwwpktkk..', '..kktkppppktkk..',
      '...ktkkkkkktk...', '...kkttttttkk...', '....kkkkkkkk....', '......kkkk......', '................', '................',
    ],
    palette: { k: '#161a24', t: '#3fe0d0', p: '#b46cff', w: '#ffffff' },
  },
  [I.RECTIFIER]: {
    rows: [
      '................', '.....dggggd.....', '...dgGGGGGgd....', '..dgGdddddGgd...', '.dgGd.ppp.dGgd..',
      '.dgd.pwwwp.dgd..', '.dgd.pwwwp.dgd..', '.dgd.ppppp.dgd..', '.dgGd.ppp.dGgd..', '..dgGdddddGgd...',
      '...dgGGGGGgd....', '.....dggggd.....', '......tttt......', '.......tt.......', '................', '................',
    ],
    palette: { d: '#8a6420', g: '#e8c060', G: '#fff0a0', p: '#b46cff', w: '#ffffff', t: '#40d8c8' },
  },
};

function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite): void {
  const scale = SIZE / 16;
  for (let y = 0; y < 16; y++) {
    const row = s.rows[y] ?? '';
    for (let x = 0; x < 16; x++) {
      const ch = row[x];
      if (!ch || ch === '.') continue;
      const col = s.palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

function drawIsoBlock(ctx: CanvasRenderingContext2D, atlas: TextureAtlas, blockId: number): void {
  const def = blockDef(blockId);
  const top = atlas.tiles[def.tex[2]];
  const left = atlas.tiles[def.tex[4]];
  const right = atlas.tiles[def.tex[0]];
  const k = SIZE / 48;
  const face = (tile: HTMLCanvasElement, a: number, b: number, c: number, d: number, e: number, f: number, dark: number) => {
    ctx.setTransform(a * k, b * k, c * k, d * k, e * k, f * k);
    ctx.drawImage(tile, 0, 0, 16, 16);
    if (dark > 0) {
      ctx.fillStyle = `rgba(0,0,0,${dark})`;
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillRect(0, 0, 16, 16);
      ctx.globalCompositeOperation = 'source-over';
    }
  };
  face(top, 20 / 16, 10.5 / 16, -20 / 16, 10.5 / 16, 24, 3, 0);
  face(left, 20 / 16, 10.5 / 16, 0, 21 / 16, 4, 13.5, 0.22);
  face(right, 20 / 16, -10.5 / 16, 0, 21 / 16, 24, 24, 0.4);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Renders every item icon once. Call after the texture atlas exists. */
export function buildItemIcons(atlas: TextureAtlas): void {
  for (const item of allItems()) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    if (item.id < 256) {
      if (RENDER[item.id] === 1) {
        // Draw each face on its own layer so the darkening only touches that face.
        const layer = document.createElement('canvas');
        layer.width = layer.height = SIZE;
        const lctx = layer.getContext('2d')!;
        lctx.imageSmoothingEnabled = false;
        drawIsoBlock(lctx, atlas, item.id);
        ctx.drawImage(layer, 0, 0);
      } else {
        ctx.drawImage(atlas.tiles[blockDef(item.id).tex[0]], 0, 0, SIZE, SIZE);
      }
    } else {
      const sprite = SPRITES[item.id];
      if (sprite) drawSprite(ctx, sprite);
    }
    canvases.set(item.id, canvas);
    icons.set(item.id, canvas.toDataURL());
  }
}

export function iconUrl(id: number): string {
  return icons.get(id) ?? '';
}

export function iconCanvas(id: number): HTMLCanvasElement | undefined {
  return canvases.get(id);
}
