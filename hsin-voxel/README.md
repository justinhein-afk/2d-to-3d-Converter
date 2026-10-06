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
| W A S D | Move |
| Double-tap W / Left Ctrl | Sprint |
| Space | Jump / swim up |
| Mouse | Look around |
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

## Project layout

```
src/
  config/     game.ts (movement, world, camera tuning), keybinds.ts
  core/       Game loop, input, settings, math helpers
  world/      blocks, procedural textures, noise, terrain, lighting, mesher, workers,
              chunk streaming (World.ts), sky, physics, raycasting, IndexedDB storage
  items/      item registry, inventory, crafting recipes
  player/     player movement physics, block mining/placing
  camera/     first/third-person camera rig with block collision
  entities/   dropped items
  fx/         particles
  ui/         hotbar, vitals, inventory, title screen, pause menu, debug overlay, icons
tests/        Vitest unit tests
scripts/      headless smoke test
```
