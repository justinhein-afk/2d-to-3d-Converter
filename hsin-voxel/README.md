# Hsin · Voxel

A Minecraft-style voxel sandbox that runs in the browser, starring a blocky
Hsin (the Moon Fox Sentinel from *Wuthering Waves*) as a third-person player
character.

Built from scratch with **TypeScript + Three.js + Vite**. There are no game engines and no
external art: every texture is generated in code as 16×16 pixel art.

## Running it

You need [Node.js](https://nodejs.org/) 20 or newer.

```bash
cd hsin-voxel
npm install
npm run dev        # then open the printed http://localhost:5173 link
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Type-checks and builds a static site into `dist/` (open it with `npm run preview`) |
| `npm test` | Runs the unit tests (terrain, meshing, lighting, physics, inventory, crafting, …) |
| `npm run smoke` | Optional: plays the game in headless Chromium and saves screenshots to `smoke-output/` (needs Playwright: `npm i -D playwright && npx playwright install chromium`) |

On the title screen, create a world (optionally with a seed) or continue a saved one.
Click the game to capture the mouse; press **Esc** to pause.

## Controls

| Input | Action |
|---|---|
| W A S D | Move (Hsin turns to face where she runs) |
| Double-tap W / Left Ctrl | Sprint |
| Space | Jump / swim up |
| Shift | Dodge: a quick dash with a short invulnerability window (costs stamina) |
| Mouse | Orbit the over-the-shoulder camera |
| Mouse wheel | Zoom the camera in and out |
| Left click (hold) | Break the targeted block |
| Right click | Place the held block, eat food, open a Crafting Table |
| Middle click | Pick the targeted block into your hand |
| 1 – 9 | Select hotbar slot |
| Tab or I | Inventory and crafting |
| Q | Drop one of the held item |
| F5 or V | Toggle first / third person |
| F3 | Debug info (position, biome, light, chunk and draw-call stats) |
| Esc or P | Pause menu (settings, controls, save & quit) |

## What's in the world

* **Infinite terrain** in 16×16×128 chunks from seeded simplex noise: plains, forest
  (oak and birch), hills with snowy peaks, desert with cacti, beaches, oceans, winding rivers,
  and spaghetti/cavern caves with ore veins (coal, iron, gold, diamond) and glowing Electro
  crystals.
* **Blocks**: grass, dirt, stone, cobblestone, sand, sandstone, gravel, logs, leaves,
  planks, glass, ores, water, snow, cactus, crafting table, glow lantern, stone bricks,
  bricks, wool, flowers and tall grass.
* **Meshing** with hidden-face culling, per-vertex ambient occlusion and smooth lighting,
  built in web workers so the main thread stays smooth. Chunks stream in and out around you.
* **Lighting**: sky light and block light (lanterns, crystals) flood-filled across chunk borders,
  so caves are dark and lanterns light them up; a day/night cycle with sun, moon, stars, blocky
  clouds, sunsets and distance fog.
* **Survival basics**: hold-to-mine with crack overlay, item drops you pick up, a 9-slot hotbar,
  a 36-slot inventory and recipe-list crafting (some recipes need a nearby Crafting Table).
* **Saving**: worlds, edited chunks (run-length encoded), player position, inventory and time of
  day are stored in IndexedDB. The game autosaves and also saves when you pause or leave the tab.

## Hsin

Hsin is built from boxes in Minecraft proportions (8-pixel head, 12-pixel body and legs,
slim arms), with a pixel skin painted in code: long white hair past the waist, white fox ears
with dark tips, red eyes with a golden glint, a deep red dress with a high black collar, gold
sash and teal gem, wide sleeves, a front panel, black stockings and boots, and a big white
three-segment tail with a dark tip. Her Rectifier (a gold moon ring with an Electro core)
floats beside her and moves to her hands when she attacks.

Her colours live in [`src/config/appearance.ts`](src/config/appearance.ts); change them and the
skin is repainted.

Animations are procedural and blend into each other: idle (breathing, tail and ear twitches),
walk, sprint, jump, fall, swim, dodge, a four-stage attack combo, heavy-attack charge, casting,
summoning, mining and getting hurt.

The camera orbits over her right shoulder, zooms with the mouse wheel and is pulled in front
of any block that would come between it and her, so it never clips into terrain. Blocks are
targeted with a ray from the crosshair, limited to her reach.

## Enemies and animals

| Mob | Type | Behaviour |
|---|---|---|
| **Discord Husk** | melee | Charges in with arms raised, telegraphs with a red flash, then swipes. |
| **Hollow Archer** | ranged | Keeps 7–15 blocks away, strafes, and fires arcing Tacet arrows that lead your movement. |
| **Iron Colossus** | elite | Huge and slow, shows a boss bar. Slams the ground after a red warning circle fills up, and rushes you from range. Shrugs off knockback. |
| Boar, Sheep, Chicken | passive | Wander and graze; run away when hit. Drop meat, wool and feathers. |

* Hostiles spawn **at night** on dark open ground and **in caves** at any time (anywhere the light is low).
  In the morning, surface hostiles that aren't fighting fade away. Animals spawn in daylight on grass.
* Enemies show **health bars** above their heads (hidden behind terrain), every hit pops a **floating
  damage number** (purple for Electro, gold for crits, red for damage you take), hits cause
  **knockback**, and defeated mobs dissolve and **drop loot**.
* Without a weapon you can punch like in Minecraft (left click a mob). Hsin's real combat kit
  arrives with her Rectifier.
* All mob stats (health, damage, speed, ranges, spawn caps, drops) are in
  [`src/config/mobs.ts`](src/config/mobs.ts).

## Project layout

```
src/
  config/     game.ts (movement, world, camera tuning), mobs.ts (enemy stats),
              appearance.ts (Hsin's colours), keybinds.ts
  core/       Game loop, input, settings, math helpers
  world/      blocks, procedural textures, noise, terrain, lighting, mesher, workers,
              chunk streaming (World.ts), sky, physics, raycasting, IndexedDB storage
  items/      item registry, inventory, crafting recipes
  player/     Hsin's model and animator, movement physics, block mining/placing
  camera/     first/third-person camera rig with block collision
  entities/   box-model toolkit (skins + entity shader), dropped items, mobs (models, AI, spawning)
  combat/     damage types, target registry and queries, projectiles
  fx/         particles, blob shadows, screen shake, attack warning circles
  ui/         hotbar, vitals, inventory, title screen, pause menu, debug overlay, icons,
              enemy health bars, damage numbers, boss bar
tests/        Vitest unit tests
scripts/      headless smoke test
```
