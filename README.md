# Figure to 3D

A web page that turns simple 2D figure illustrations into 3D models and downloads
them as **STL**, **GLB**, **FBX** or **BLEND**.

**Live site:** https://justinhein-afk.github.io/2d-to-3d-Converter/ (STL, GLB and FBX;
BLEND needs the Python server below). It is redeployed automatically from `web/` on every push
to `main` by `.github/workflows/pages.yml`.

Upload a PNG (transparent background works best) or a JPG on a plain background.
The page finds the figure's outline and "puffs" it into a rounded 3D shape that
keeps the drawing's colours, or makes a flat cutout of a chosen thickness.
Every model is a closed, watertight solid, so it can be 3D printed.

## Running it

**With .blend export** (Python 3.10+):

```bash
pip install -r server/requirements.txt
pip install bpy            # or install Blender and put `blender` on PATH / set BLENDER_PATH
uvicorn server.app:app --port 8000
```

Then open http://localhost:8000.

**Static only** (STL, GLB and FBX work; BLEND is disabled): serve the `web/`
folder with any static host, e.g. `python -m http.server -d web 8000` or GitHub Pages.

**Docker** (includes Blender's `bpy`):

```bash
docker build -f server/Dockerfile -t figure-to-3d .
docker run -p 8000:8000 figure-to-3d
```

## Controls

| Setting | What it does |
|---|---|
| Puffy / Flat cutout | Rounded "inflated" figure, or a flat extrusion |
| Puffiness | How rounded and thick the puffy shape is |
| Smoothness | Smooths the surface (removes creases down the middle of shapes) |
| Edge thickness / Thickness | Height of the side walls (puffy) or the whole cutout (flat) |
| Flat back | Makes the back flat, so it lies on the print bed |
| Smooth outline | Rounds off the pixel staircase along the outline |
| Height / width | Size of the longest side of the figure, in mm |
| Detail | Working resolution; higher is finer but slower and heavier |
| Background tolerance | For images without transparency: how different from the background colour a pixel must be to count as the figure |

## Formats

| Format | Colours | Units / orientation |
|---|---|---|
| STL | no | millimetres; figure lies on the XY plane with its back at Z = 0 |
| GLB | vertex colours | metres, Y up (standard glTF) |
| FBX | vertex colours | binary FBX 7.4, millimetres, Y up |
| BLEND | vertex colours wired into the material | converted from the GLB by Blender on the server |

## How it works

1. **Mask** (`web/js/mask.js`): the image is drawn to a canvas; the alpha channel,
   or a flood fill of the border colour, separates the figure from the background.
   Specks are removed and small holes filled.
2. **Mesh** (`web/js/mesh.js`): each figure pixel becomes a vertex. A distance
   transform gives each pixel's distance to the outline, which is turned into a
   rounded height profile. Front and back surfaces are joined by walls along the
   outline, so the mesh is closed.
3. **Export** (`web/js/export.js`): STL and GLB use three.js exporters; FBX is
   written by a small binary FBX writer (`web/js/fbx.js`); BLEND is produced by
   `server/blend_convert.py` running inside Blender.

three.js (MIT) is vendored in `web/vendor/three`, so the page needs no CDN or build step.

## Limits

The back of the model is a mirror of the front, as the 2D drawing has no
information about it. Best results come from simple, bold figures with a clear
outline. Very thin lines turn into thin, fragile parts; raise Detail if they
look broken.
