// Headless smoke test: starts Vite, opens the game in Chromium, plays a little and takes screenshots.
// Usage: node scripts/smoke.mjs [outputDir] [phase]
// Needs Playwright (npm i -D playwright, or a global install).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
  } catch {
    console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
}

const out = resolve(process.argv[2] ?? 'smoke-output');
const phase = process.argv[3] ?? 'all';
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  if (process.env.VERBOSE) console.log('[console]', m.type(), m.text());
});
page.on('pageerror', (e) => errors.push(e.message));

let failed = 0;
let placedAt = null;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
}

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 });
}

/** Advances the game by n frames of `dt` seconds without waiting on real time. */
async function step(n, dt = 1 / 30) {
  await page.evaluate(([n, dt]) => {
    const g = window.game;
    for (let i = 0; i < n; i++) {
      g.__t = (g.__t ?? performance.now()) + dt * 1000;
      g.frame(g.__t);
    }
  }, [n, dt]);
}

try {
  await page.addInitScript(() => {
    localStorage.setItem('hsin-voxel-settings', JSON.stringify({ renderDistance: 4, showFps: true }));
  });
  await page.goto(url);
  await page.waitForSelector('.title-screen');
  await shot('00-title');

  await page.evaluate(async () => {
    const meta = { id: 'smoke', name: 'Smoke Test', seed: 1234, created: Date.now(), lastPlayed: Date.now() };
    const g = await window.startWorld(meta, true);
    g.running = false; // drive frames manually
  });
  // Wait for the spawn area to stream in.
  const start = Date.now();
  while (Date.now() - start < 60000) {
    await step(1);
    const state = await page.evaluate(() => window.game.state);
    if (state === 'playing') break;
    await page.waitForTimeout(100);
  }
  const state = await page.evaluate(() => window.game.state);
  check('world loads and enters playing state', state === 'playing', state);
  // Let more chunks mesh.
  for (let i = 0; i < 40; i++) {
    await step(1);
    await page.waitForTimeout(60);
  }
  const stats = await page.evaluate(() => window.game.world.stats());
  check('chunks meshed around the player', stats.meshed >= 9, JSON.stringify(stats));

  const pos0 = await page.evaluate(() => window.game.player.position.toArray());
  await step(30);
  const pos1 = await page.evaluate(() => window.game.player.position.toArray());
  check('player stands on terrain', Math.abs(pos1[1] - pos0[1]) < 0.6 && pos1[1] > 40, `y=${pos1[1].toFixed(2)}`);

  await page.evaluate(() => {
    const g = window.game;
    g.rig.pitch = -0.25;
    g.sky.time = 0.36;
  });
  await step(2);
  await shot('01-day');

  // Walk forward for a second.
  await page.evaluate(() => window.game.input.simulateKey('KeyW', true));
  await step(30);
  await page.evaluate(() => window.game.input.simulateKey('KeyW', false));
  const pos2 = await page.evaluate(() => window.game.player.position.toArray());
  const walked = Math.hypot(pos2[0] - pos1[0], pos2[2] - pos1[2]);
  check('WASD moves the player', walked > 1.5, `${walked.toFixed(2)} blocks`);

  // Night.
  await page.evaluate(() => {
    window.game.sky.time = 0.92;
    window.game.rig.pitch = 0.1;
  });
  for (let i = 0; i < 10; i++) {
    await step(1);
    await page.waitForTimeout(50);
  }
  await shot('02-night');
  await page.evaluate(() => {
    window.game.sky.time = 0.74;
  });
  await step(2);
  await shot('03-sunset');

  // Wait until the player is standing on the ground again.
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => window.game.player.onGround)) break;
    await step(1);
  }

  // Place a block (on flat ground in front).
  const placed = await page.evaluate(() => {
    const g = window.game;
    g.rig.pitch = -0.55;
    g.inventory.selected = 0;
    g.inventory.changed();
    return g.inventory.selectedStack?.id;
  });
  await step(2);
  const t2 = await page.evaluate(() => window.game.interaction.target);
  if (t2) {
    await page.evaluate(() => window.game.input.simulateMouse(2, true));
    await step(1);
    await page.evaluate(() => window.game.input.simulateMouse(2, false));
    await step(1);
    // Plants are replaced in place; otherwise the block goes against the clicked face.
    const ids = await page.evaluate(
      ([x, y, z, nx, ny, nz]) => [window.game.world.getBlock(x, y, z), window.game.world.getBlock(x + nx, y + ny, z + nz)],
      [t2.x, t2.y, t2.z, t2.nx, t2.ny, t2.nz],
    );
    check('right click places the held block', ids.includes(placed), `cells now ${ids.join('/')}, held ${placed}`);
    placedAt = ids[0] === placed ? [t2.x, t2.y, t2.z] : [t2.x + t2.nx, t2.y + t2.ny, t2.z + t2.nz];
  } else check('right click places the held block', false, 'no target');


  // Look down and break the block underfoot.
  const broke = await page.evaluate(() => {
    const g = window.game;
    // Stand in the middle of a block so looking down targets the block underfoot.
    const p = g.player.position;
    g.player.setPosition(Math.floor(p.x) + 0.5, p.y, Math.floor(p.z) + 0.5);
    g.rig.pitch = -1.35;
    return true;
  });
  await step(2);
  const target = await page.evaluate(() => window.game.interaction.target);
  check('crosshair targets a block', !!target, target ? `id ${target.id}` : 'none');
  if (target && broke) {
    const dirtBefore = await page.evaluate(() => window.game.inventory.count(3));
    await page.evaluate(() => window.game.input.simulateMouse(0, true));
    await step(60);
    await page.evaluate(() => window.game.input.simulateMouse(0, false));
    await step(1);
    const after = await page.evaluate(([x, y, z]) => window.game.world.getBlock(x, y, z), [target.x, target.y, target.z]);
    check('holding left click breaks the block', after === 0 || after === 12, `block now ${after}`);
    await step(40);
    const dirtAfter = await page.evaluate(() => window.game.inventory.count(3));
    check('broken blocks drop items that get picked up', dirtAfter > dirtBefore, `dirt ${dirtBefore} -> ${dirtAfter}`);
  }

  // Inventory screen.
  await page.evaluate(() => {
    window.game.sky.time = 0.4;
    window.game.input.simulateKey('Tab', true);
  });
  await step(1);
  await page.evaluate(() => window.game.input.simulateKey('Tab', false));
  await step(1);
  check('Tab opens the inventory', (await page.evaluate(() => window.game.state)) === 'inventory');
  await shot('04-inventory');
  await page.evaluate(() => window.game.input.simulateKey('Tab', true));
  await step(1);
  await page.evaluate(() => window.game.input.simulateKey('Tab', false));
  await step(1);
  check('Tab closes the inventory', (await page.evaluate(() => window.game.state)) === 'playing');

  // Save and reload.
  await page.evaluate(() => window.game.save());
  const saved = await page.evaluate(async () => {
    const req = indexedDB.open('hsin-voxel');
    const db = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const tx = db.transaction('players', 'readonly');
    const v = await new Promise((r) => {
      const q = tx.objectStore('players').get('smoke');
      q.onsuccess = () => r(q.result);
    });
    return !!v;
  });
  check('world saves to IndexedDB', saved);

  // Quit to the title screen and load the same world again.
  const savedPos = await page.evaluate(() => window.game.player.position.toArray());
  await page.evaluate(() => window.game.quitToTitle());
  await page.waitForSelector('.title-screen:not(.hidden)');
  await page.evaluate(async () => {
    const meta = { id: 'smoke', name: 'Smoke Test', seed: 1234, created: Date.now(), lastPlayed: Date.now() };
    const g = await window.startWorld(meta, false);
    g.running = false;
  });
  for (let i = 0; i < 400; i++) {
    await step(1);
    if ((await page.evaluate(() => window.game.state)) === 'playing') break;
    await page.waitForTimeout(100);
  }
  const reloadedPos = await page.evaluate(() => window.game.player.position.toArray());
  check(
    'player position restored after reload',
    Math.hypot(reloadedPos[0] - savedPos[0], reloadedPos[2] - savedPos[2]) < 0.5,
    `${savedPos.map((v) => v.toFixed(1))} -> ${reloadedPos.map((v) => v.toFixed(1))}`,
  );
  if (placedAt) {
    const id = await page.evaluate(([x, y, z]) => window.game.world.getBlock(x, y, z), placedAt);
    check('placed block persists after reload', id === 5, `block ${id} at ${placedAt}`);
  }

  // Pause menu.
  await page.evaluate(() => window.game.pause());
  await step(1);
  await shot('05-pause');
  await page.evaluate(() => window.game.resume());

  if (phase !== '1') {
    await page.evaluate(() => {
      const g = window.game;
      g.sky.time = 0.33;
      g.rig.pitch = -0.2;
    });
    await step(3);
    await shot('06-third-person');
  }

  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (err) {
  console.error(err);
  failed++;
} finally {
  await browser.close();
  await server.close();
}

console.log(failed === 0 ? '\nSmoke test passed.' : `\nSmoke test: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
