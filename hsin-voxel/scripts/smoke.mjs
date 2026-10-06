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
const page = await browser.newPage({ viewport: { width: 880, height: 495 } });
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
  // Some steps run without rendering for speed, so draw the current state first.
  await page.evaluate(() => {
    const g = window.game;
    if (g) g.renderer.render(g.scene, g.rig.camera);
  });
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
    g.rig.mode = 'first'; // the Phase 1 checks aim from the eyes
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
    g.inventory.selected = 1; // slot 1 is always the Rectifier; slot 2 holds planks
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
    // Move to open ground away from the dug hole, then check the third-person character.
    await page.evaluate(() => {
      const g = window.game;
      const p = g.player.position;
      const x = Math.floor(p.x) + 6;
      const z = Math.floor(p.z) + 2;
      g.player.setPosition(x + 0.5, g.world.topSolidY(x, z) + 1, z + 0.5);
      g.sky.time = 0.33;
      g.rig.pitch = -0.2;
      g.rig.mode = 'third';
    });
    await step(10);
    await shot('06-third-person');
    const vis = await page.evaluate(() => window.game.model.root.visible);
    check('Hsin is visible in third person', vis);

    // Double-tap W to sprint.
    await page.evaluate(() => {
      const g = window.game;
      g.input.simulateKey('KeyW', true);
    });
    await step(1);
    await page.evaluate(() => window.game.input.simulateKey('KeyW', false));
    await step(2);
    await page.evaluate(() => {
      const g = window.game;
      g.input.simulateKey('KeyW', true);
      g.input.doubleTapForward = true; // what Input sets on a real double tap
    });
    await step(15);
    const sprinting = await page.evaluate(() => window.game.player.sprinting);
    await shot('07-sprint');
    await page.evaluate(() => window.game.input.simulateKey('KeyW', false));
    await step(10);
    check('double-tap W sprints', sprinting);

    // Dodge (on a flat platform so terrain can't block it).
    await page.evaluate(() => {
      const g = window.game;
      const p = g.player.position;
      const bx = Math.floor(p.x), bz = Math.floor(p.z), by = 100;
      for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 7; dx++) g.world.setBlock(bx + dx, by, bz + dz, 21);
      g.player.setPosition(bx + 0.5, by + 1, bz + 0.5);
    });
    for (let i = 0; i < 15; i++) {
      await step(1);
      await page.waitForTimeout(40);
    }
    const before = await page.evaluate(() => ({ p: window.game.player.position.toArray(), st: window.game.player.stamina }));
    await page.evaluate(() => window.game.input.simulateKey('ShiftLeft', true));
    await step(1);
    const inv = await page.evaluate(() => window.game.player.invulnerable);
    await page.evaluate(() => window.game.input.simulateKey('ShiftLeft', false));
    await step(14);
    const after = await page.evaluate(() => ({ p: window.game.player.position.toArray(), st: window.game.player.stamina }));
    const moved = Math.hypot(after.p[0] - before.p[0], after.p[2] - before.p[2]);
    check('Shift dodges with invulnerability and stamina cost', inv && moved > 2 && after.st < before.st, `moved ${moved.toFixed(2)}, stamina ${before.st}->${after.st.toFixed(0)}, inv ${inv}`);

    // Scroll zoom.
    const z0 = await page.evaluate(() => window.game.rig.zoom);
    await page.evaluate(() => (window.game.input.wheel = 3));
    await step(1);
    const z1 = await page.evaluate(() => window.game.rig.zoom);
    check('mouse wheel zooms the camera', z1 > z0, `${z0} -> ${z1}`);

    // Camera never ends up inside a solid block, even with walls behind the player.
    const camOk = await page.evaluate(() => {
      const g = window.game;
      const p = g.player.position;
      const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
      // Wall behind the camera direction.
      const back = { x: Math.round(Math.sin(g.rig.yaw)), z: Math.round(Math.cos(g.rig.yaw)) };
      for (let dy = 0; dy < 5; dy++) for (let s = -2; s <= 2; s++) {
        const wx = bx + back.x * 2 + (back.z !== 0 ? s : 0);
        const wz = bz + back.z * 2 + (back.x !== 0 ? s : 0);
        g.world.setBlock(wx, by + dy, wz, 1);
      }
      return true;
    });
    for (let i = 0; i < 20; i++) {
      await step(1);
      await page.waitForTimeout(30);
    }
    const camInfo = await page.evaluate(() => {
      const g = window.game;
      const c = g.rig.camera.position;
      return { solid: g.isSolidAt(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z)), dist: g.rig.distance, zoom: g.rig.zoom };
    });
    check('camera collides with blocks instead of clipping', camOk && !camInfo.solid && camInfo.dist < camInfo.zoom, JSON.stringify(camInfo));
    await shot('08-camera-wall');

    // First-person toggle hides the model.
    await page.evaluate(() => window.game.input.simulateKey('KeyV', true));
    await step(1);
    await page.evaluate(() => window.game.input.simulateKey('KeyV', false));
    await step(1);
    const fp = await page.evaluate(() => ({ mode: window.game.rig.mode, vis: window.game.model.root.visible }));
    check('V toggles first person', fp.mode === 'first' && !fp.vis, JSON.stringify(fp));
    await page.evaluate(() => (window.game.rig.mode = 'third'));
  }

  if (phase !== '1' && phase !== '2') {
    // ---- Phase 3: enemies ----
    const fr = (n) => page.evaluate((n) => { const g = window.game; for (let i = 0; i < n; i++) { g.__t += 33; g.frame(g.__t, i === n - 1); } }, n);
    // Night spawning on the surface / in caves.
    const night = await page.evaluate(() => {
      const g = window.game;
      g.mobs.clear();
      g.sky.time = 0.0;
      g.frame((g.__t += 33), false);
      for (let i = 0; i < 60 && g.mobs.hostileCount < 3; i++) g.mobs.trySpawn(g.player.position, true, 0);
      return { hostile: g.mobs.hostileCount, kinds: g.mobs.mobs.map((m) => m.def.kind) };
    });
    check('hostile mobs spawn at night / in caves', night.hostile > 0, JSON.stringify(night));
    const day = await page.evaluate(() => {
      const g = window.game;
      g.mobs.clear();
      g.sky.time = 0.45;
      g.frame((g.__t += 33), false);
      for (let i = 0; i < 80 && !g.mobs.mobs.some((m) => !m.def.hostile); i++) g.mobs.trySpawn(g.player.position, false, 1);
      // Daytime hostiles are only allowed where it is dark (caves).
      return g.mobs.mobs.map((m) => {
        const p = m.position;
        const l = g.world.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
        return { kind: m.def.kind, hostile: m.def.hostile, sky: l.sky };
      });
    });
    check(
      'passive animals spawn in daylight; hostiles only in dark caves',
      day.some((m) => !m.hostile) && day.every((m) => !m.hostile || m.sky <= 3),
      day.map((m) => `${m.kind}${m.hostile ? `(sky ${m.sky})` : ''}`).join(','),
    );

    // Arena in the sky for deterministic fights.
    await page.evaluate(() => {
      const g = window.game;
      g.mobs.clear();
      g.mobs.spawning = false;
      const p = g.player.position;
      const bx = Math.floor(p.x), bz = Math.floor(p.z), by = 104;
      for (let dz = -12; dz <= 12; dz++) for (let dx = -12; dx <= 12; dx++) g.world.setBlock(bx + dx, by, bz + dz, 21);
      g.player.setPosition(bx + 0.5, by + 1, bz + 0.5);
      g.player.health = g.player.maxHealth;
      g.rig.yaw = 0; g.rig.pitch = -0.15; g.player.yaw = 0;
    });
    for (let i = 0; i < 15; i++) {
      await step(1);
      await page.waitForTimeout(40);
    }
    // Melee husk walks up and hits.
    const melee = await page.evaluate(() => {
      const g = window.game;
      const p = g.player.position;
      g.__husk = g.mobs.spawn('husk', p.x, p.y, p.z - 6);
      const hp = g.player.health;
      for (let i = 0; i < 150 && g.player.health === hp; i++) g.frame((g.__t += 33), false);
      return { before: hp, after: g.player.health, state: g.__husk.state };
    });
    check('melee enemy chases and hits Hsin', melee.after < melee.before, JSON.stringify(melee));
    await shot('09-melee');

    // Punch it (LMB with a block in hand) while it's in front of the camera.
    const punch = await page.evaluate(() => {
      const g = window.game;
      const p = g.player.position;
      const h = g.__husk;
      h.body.pos.set(p.x, p.y, p.z - 1.6);
      h.body.vel.set(0, 0, 0);
      g.rig.yaw = 0; g.rig.pitch = -0.1; g.player.yaw = 0;
      g.frame((g.__t += 33), false);
      const hp = h.health;
      g.input.simulateMouse(0, true);
      g.frame((g.__t += 33), false);
      g.input.simulateMouse(0, false);
      g.frame((g.__t += 33), false);
      return { before: hp, after: h.health };
    });
    check('left click punches a mob under the crosshair', punch.after < punch.before, JSON.stringify(punch));

    // Kill it (it dissolves), and kill a boar far away (boars always drop meat).
    const kill = await page.evaluate(() => {
      const g = window.game;
      const h = g.__husk;
      const p = g.player.position;
      const boar = g.mobs.spawn('boar', p.x + 8, p.y, p.z + 8);
      const dropsBefore = g.drops.count;
      g.combat.hit(h, { amount: 1e6, element: 'physical', kind: 'punch', source: p.clone(), knockback: 0 });
      g.combat.hit(boar, { amount: 1e6, element: 'physical', kind: 'punch', source: p.clone(), knockback: 0 });
      for (let i = 0; i < 40; i++) g.frame((g.__t += 33), false);
      return { dead: !h.alive, removed: !g.mobs.mobs.includes(h) && !g.mobs.mobs.includes(boar), drops: g.drops.count - dropsBefore };
    });
    check('defeated enemies dissolve and drop loot', kill.dead && kill.removed && kill.drops > 0, JSON.stringify(kill));

    // Archer shoots.
    const archer = await page.evaluate(() => {
      const g = window.game;
      const p = g.player.position;
      const a = g.mobs.spawn('archer', p.x + 2, p.y, p.z - 10);
      let shots = 0;
      for (let i = 0; i < 150; i++) {
        g.frame((g.__t += 33), false);
        shots = Math.max(shots, g.projectiles.count);
        if (shots > 0) break;
      }
      return { shots, state: a.state };
    });
    check('ranged enemy fires projectiles', archer.shots > 0, JSON.stringify(archer));
    await fr(8);
    await shot('10-archer');

    // Elite brings up the boss bar and telegraphs its slam.
    const elite = await page.evaluate(() => {
      const g = window.game;
      g.mobs.clear();
      g.projectiles.clear();
      const p = g.player.position;
      const c = g.mobs.spawn('colossus', p.x, p.y, p.z - 5);
      let windup = false;
      for (let i = 0; i < 120 && !windup; i++) {
        g.frame((g.__t += 33), false);
        windup = c.state === 'windup' && c.stateTime > 0.5;
      }
      const bar = !document.querySelector('.bossbar').classList.contains('hidden');
      return { windup, bar, state: c.state };
    });
    check('elite shows a boss bar and telegraphs attacks', elite.bar && elite.windup, JSON.stringify(elite));
    await shot('11-elite');
    await page.evaluate(() => window.game.mobs.clear());
  }

  if (phase !== '1' && phase !== '2' && phase !== '3') {
    // ---- Phase 4: Hsin's combat kit ----
    const k4 = await page.evaluate(() => {
      const g = window.game;
      const F = (n = 1) => { for (let i = 0; i < n; i++) g.frame((g.__t += 33), false); };
      const click = () => { g.input.simulateMouse(0, true); F(); g.input.simulateMouse(0, false); F(); };
      const key = (code) => { g.input.simulateKey(code, true); F(); g.input.simulateKey(code, false); };
      const out = {};
      g.mobs.clear();
      g.mobs.spawning = false;
      const p = g.player.position;
      const bx = Math.floor(p.x), bz = Math.floor(p.z), by = 96;
      for (let dz = -16; dz <= 16; dz++) for (let dx = -16; dx <= 16; dx++) g.world.setBlock(bx + dx, by, bz + dz, 21);
      g.player.setPosition(bx + 0.5, by + 1, bz + 0.5);
      g.player.health = g.player.maxHealth;
      g.rig.yaw = 0; g.rig.pitch = -0.05; g.player.yaw = 0;
      out.slot1 = g.inventory.slots[0]?.id === 256 && g.inventory.locked.has(0);
      g.inventory.selected = 0;
      g.inventory.changed();
      F(20);
      // Left click fires shots, doesn't mine.
      g.rig.pitch = -0.6;
      F(2);
      const shotsBefore = g.projectiles.count;
      click();
      F(4);
      out.firesInsteadOfMining = g.projectiles.count > shotsBefore || g.hsin.kit.action !== 'none';
      g.rig.pitch = -0.05;
      F(40); // let the combo window from that click expire
      // A sturdy, immovable dummy to hit, put back in front of Hsin before each check.
      const home = new p.constructor(bx + 0.5, by + 1, bz - 7.5);
      const dummy = g.mobs.spawn('husk', home.x, home.y, home.z);
      dummy.def = { ...dummy.def, speed: 0, detectRange: 0, knockbackResist: 1, maxHealth: 1e7 };
      dummy.health = 1e7;
      const reset = () => {
        dummy.body.pos.copy(home);
        dummy.body.vel.set(0, 0, 0);
        g.player.setPosition(bx + 0.5, by + 1, bz + 0.5);
        g.player.yaw = 0;
        g.rig.yaw = 0;
        g.rig.pitch = -0.05;
      };
      F(5);
      const stages = [];
      const handle = g.hsin.effects.handle.bind(g.hsin.effects);
      g.hsin.effects.handle = (evs) => { for (const e of evs) if (e.type === 'basic') stages.push(e.stage); handle(evs); };
      g.hsin.kit.energy = 0;
      g.hsin.kit.answeringHeart = 0;
      for (let c = 0; c < 4; c++) { click(); F(14); }
      F(10);
      out.combo = stages.join('');
      out.heart = Math.round(g.hsin.kit.answeringHeart);
      out.energy = Math.round(g.hsin.kit.energy);
      out.dummyHit = dummy.health < 1e7;
      // Heavy -> Realm Protector.
      g.input.simulateMouse(0, true);
      F(26);
      out.charging = g.hsin.kit.action === 'charge';
      const realmReady = g.hsin.kit.realmReady;
      g.input.simulateMouse(0, false);
      F(2);
      out.realm = realmReady && Math.round(g.hsin.kit.realmCd) === 24;
      F(30);
      // Resonance Skill + Moon Fox.
      key('KeyE');
      out.skillCd = Math.round(g.hsin.kit.answeringSkillCd);
      g.input.simulateKey('KeyW', true);
      F(30);
      g.input.simulateKey('KeyW', false);
      out.fox = g.hsin.kit.fox && g.player.body.height < 1;
      F(3);
      click();
      F(3);
      out.unfox = !g.hsin.kit.fox && g.player.body.height > 1.7;
      // Formshift.
      reset();
      g.hsin.kit.energy = 125;
      key('KeyR');
      F(130);
      out.form = g.hsin.kit.form;
      out.edict0 = g.hsin.kit.edictStacks;
      out.ward0 = g.hsin.kit.wardStacks;
      // Illumining basic attacks call Soaring Pillars.
      for (let c = 0; c < 3; c++) { click(); F(14); }
      F(15);
      out.edictUsed = out.edict0 - g.hsin.kit.edictStacks;
      // Radiance Ward.
      g.player.invulnTimer = 0;
      const hp0 = g.player.health;
      g.hitPlayer({ amount: 1000, element: 'tacet', kind: 'mob', source: new p.constructor(p.x, p.y, p.z - 2), knockback: 8 });
      out.wardDamage = Math.round(hp0 - g.player.health);
      F(40);
      // Mechanism.
      reset();
      F(2);
      const before = dummy.health;
      key('KeyE');
      F(40);
      out.mechanism = dummy.health < before && g.hsin.kit.illuminingSkillCd > 15;
      // Pillars Aligned.
      g.hsin.kit.illuminingHeart = 100;
      F(20);
      key('KeyE');
      F(5);
      out.dominion = g.hsin.kit.dominion;
      // Pillars Across Heaven.
      F(30);
      reset();
      F(2);
      g.hsin.kit.formTime = 10;
      const before2 = dummy.health;
      key('KeyR');
      F(170);
      out.pillars = dummy.health < before2 && g.hsin.kit.form === 'answering';
      // Revive passive.
      g.player.invulnTimer = 0;
      g.player.invulnSources.clear();
      g.player.health = 200;
      g.hitPlayer({ amount: 99999, element: 'tacet', kind: 'mob', source: p.clone(), knockback: 0 });
      out.revive = !g.player.dead && g.player.health === g.player.maxHealth && g.player.invulnerable;
      // Destructive abilities toggle.
      g.mobs.clear();
      const countBlocks = () => { let n = 0; for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) if (g.world.getBlock(bx + dx, by, bz - 8 + dz) !== 0) n++; return n; };
      g.settings.set('destructiveAbilities', false);
      const n0 = countBlocks();
      g.hsin.effects.breakSphere; // exists
      g.hsin.kit.realmCd = 0;
      g.rig.pitch = -0.35;
      F(20);
      g.input.simulateMouse(0, true); F(28); g.input.simulateMouse(0, false); F(40);
      const n1 = countBlocks();
      g.settings.set('destructiveAbilities', true);
      g.hsin.kit.realmCd = 0;
      F(10);
      g.input.simulateMouse(0, true); F(28); g.input.simulateMouse(0, false); F(40);
      const n2 = countBlocks();
      g.settings.set('destructiveAbilities', false);
      out.terrainSafe = n1 === n0;
      out.terrainBreaks = n2 < n1;
      out.blocks = [n0, n1, n2];
      g.rig.pitch = -0.1;
      return out;
    });
    check('Rectifier is locked in hotbar slot 1', k4.slot1);
    check('left click with the Rectifier attacks instead of mining', k4.firesInsteadOfMining);
    check('basic attack is a 4-stage combo building Answering Heart and energy', k4.combo === '0123' && k4.heart > 0 && k4.energy > 0 && k4.dummyHit, `stages ${k4.combo}, heart ${k4.heart}, energy ${k4.energy}`);
    check('holding left click charges; the first heavy is Realm Protector (24s)', k4.charging && k4.realm);
    check('E casts the Resonance Skill with a 12s cooldown', k4.skillCd === 12, `cd ${k4.skillCd}`);
    check('moving right after E turns Hsin into the Moon Fox; attacking turns her back', k4.fox && k4.unfox);
    check('R (full energy) Formshifts into Illumining Form with 21 Edict and 2 Ward', k4.form === 'illumining' && k4.edict0 === 21 && k4.ward0 === 2, `${k4.form} ${k4.edict0}/${k4.ward0}`);
    check('Edict calls Soaring Pillars on hits (at most 1 per second)', k4.edictUsed >= 1 && k4.edictUsed <= 3, `used ${k4.edictUsed}`);
    check('Illumining -20% and Radiance Ward -60% damage', k4.wardDamage === 320, `took ${k4.wardDamage} of 1000`);
    check('E in Illumining summons the Xuanfang Mechanism (20s)', k4.mechanism);
    check('full Illumining Heart makes E into Pillars Aligned (Mechanism Dominion)', k4.dominion);
    check('R in Illumining: Pillars Across Heaven hits and returns to Answering Form', k4.pillars);
    check('fatal hit triggers the revive passive', k4.revive);
    check('abilities leave terrain alone unless the setting allows it', k4.terrainSafe && k4.terrainBreaks, JSON.stringify(k4.blocks));
    await step(3);
    await shot('12-kit');
  }

  if (['1', '2', '3', '4'].indexOf(phase) < 0) {
    // ---- Phase 5: cutscenes ----
    const c5 = await page.evaluate(() => {
      const g = window.game;
      const F = (n = 1) => { for (let i = 0; i < n; i++) g.frame((g.__t += 33), false); };
      const key = (code) => { g.input.simulateKey(code, true); F(); g.input.simulateKey(code, false); };
      const out = {};
      g.mobs.clear();
      g.hsin.kit.exitToAnswering();
      g.model.setForm('answering');
      g.hsin.kit.drain();
      // Fresh platform (the Phase 4 terrain test blew holes in the old one).
      const p = g.player.position;
      const bx = Math.floor(p.x) + 40, bz = Math.floor(p.z), by = 92;
      for (let dz = -12; dz <= 12; dz++) for (let dx = -12; dx <= 12; dx++) g.world.setBlock(bx + dx, by, bz + dz, 21);
      g.player.setPosition(bx + 0.5, by + 1, bz + 0.5);
      F(5);
      const mob = g.mobs.spawn('husk', p.x + 3, p.y, p.z - 4);
      F(10);
      // Formshift.
      g.hsin.kit.energy = 125;
      key('KeyR');
      F(5);
      out.fsState = g.state;
      out.letterbox = document.querySelector('.letterbox.top').classList.contains('on');
      out.cameraTaken = g.rig.override !== null;
      const mobPos = mob.position.clone();
      g.player.invulnTimer = 0;
      out.invulnerable = g.hitPlayer({ amount: 500, element: 'tacet', kind: 'mob', source: p.clone(), knockback: 0 }) === false;
      F(40);
      out.frozen = mob.position.distanceTo(mobPos) < 0.01;
      F(60);
      out.fsEnd = { state: g.state, form: g.hsin.kit.form, camera: g.rig.override === null, letterbox: document.querySelector('.letterbox.top').classList.contains('on') };
      // Pillars Across Heaven, skipped with Space.
      F(20);
      g.hsin.kit.formTime = 10;
      const hp = mob.health;
      key('KeyR');
      F(10);
      const wasPlaying = g.cutscenes.playing;
      key('Space');
      F(2);
      out.skip = { wasPlaying, playing: g.cutscenes.playing, form: g.hsin.kit.form, damaged: mob.health < hp || !mob.alive, state: g.state };
      // Moon Fox flourish: no camera takeover.
      F(20);
      g.mobs.clear();
      g.hsin.kit.answeringSkillCd = 0;
      key('KeyE');
      g.input.simulateKey('KeyW', true);
      let sawFlourishCamera = false;
      let foxAt = -1;
      for (let i = 0; i < 40; i++) {
        F();
        if (g.rig.override !== null) sawFlourishCamera = true;
        if (g.hsin.kit.fox && foxAt < 0) foxAt = i;
      }
      g.input.simulateKey('KeyW', false);
      out.fox = { fox: g.hsin.kit.fox, cameraTaken: sawFlourishCamera, state: g.state, duration: 0.7 };
      g.input.simulateMouse(0, true); F(); g.input.simulateMouse(0, false); F(5);
      return out;
    });
    check('Formshift plays a letterboxed cutscene that takes the camera', c5.fsState === 'cutscene' && c5.letterbox && c5.cameraTaken, JSON.stringify(c5));
    check('enemies freeze and Hsin is invulnerable during cutscenes', c5.frozen && c5.invulnerable);
    check('Formshift ends in Illumining Form with the camera back behind her', c5.fsEnd.state === 'playing' && c5.fsEnd.form === 'illumining' && c5.fsEnd.camera && !c5.fsEnd.letterbox, JSON.stringify(c5.fsEnd));
    check('Space skips Pillars Across Heaven but still applies its damage and form change', c5.skip.wasPlaying && !c5.skip.playing && c5.skip.form === 'answering' && c5.skip.damaged, JSON.stringify(c5.skip));
    check('Moon Fox flourish plays without taking the camera', c5.fox.fox && !c5.fox.cameraTaken && c5.fox.state === 'playing', JSON.stringify(c5.fox));

    // Cutscene Viewer in the pause menu.
    await page.evaluate(() => window.game.pause());
    await step(1);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.textContent));
    check('pause menu has a Cutscenes tab', tabs.includes('Cutscenes'), tabs.join(','));
    await page.evaluate(() => [...document.querySelectorAll('.tab')].find((t) => t.textContent === 'Cutscenes').click());
    await shot('13-viewer');
    const formBefore = await page.evaluate(() => window.game.hsin.kit.form);
    await page.evaluate(() => document.querySelector('.viewer-item .btn').click());
    const v = await page.evaluate(() => {
      const g = window.game;
      const playing = g.cutscenes.playing && g.state === 'cutscene';
      for (let i = 0; i < 45; i++) g.frame((g.__t += 33), false);
      return { playing };
    });
    await shot('14-viewer-playing');
    const v2 = await page.evaluate(() => {
      const g = window.game;
      for (let i = 0; i < 80; i++) g.frame((g.__t += 33), false);
      return { state: g.state, menu: !document.querySelectorAll('.screen')[1]?.classList.contains('hidden'), form: g.hsin.kit.form, look: g.model.form };
    });
    check(
      'Cutscene Viewer replays a scene and returns to the pause menu without changing the game',
      v.playing && v2.state === 'paused' && v2.form === formBefore && v2.look === formBefore,
      JSON.stringify({ ...v, ...v2, formBefore }),
    );
    await page.evaluate(() => window.game.resume());
    await step(2);
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
