"""Web server for the 2D → 3D figure converter.

Serves the static page in ../web and adds the one thing a browser cannot do:
turning the model into a .blend file, which requires Blender.

    pip install -r server/requirements.txt
    uvicorn server.app:app --port 8000

Blender is found via $BLENDER_PATH, then `blender` on PATH, then the `bpy`
Python module (pip install bpy). Without any of them the page still works,
just without .blend export.
"""

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

SERVER_DIR = Path(__file__).resolve().parent
WEB_DIR = SERVER_DIR.parent / "web"
CONVERT_SCRIPT = SERVER_DIR / "blend_convert.py"
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "50")) * 1024 * 1024
TIMEOUT_SECONDS = int(os.environ.get("BLENDER_TIMEOUT", "120"))

app = FastAPI(title="Figure to 3D")


def blender_command():
    """Command prefix that runs blend_convert.py, or None if Blender is unavailable."""
    exe = shutil.which(os.environ.get("BLENDER_PATH", "blender"))
    if exe:
        return [exe, "-b", "--factory-startup", "--python", str(CONVERT_SCRIPT), "--"]
    if importlib.util.find_spec("bpy") is not None:
        return [sys.executable, str(CONVERT_SCRIPT)]
    return None


@app.get("/api/health")
def health():
    return {"ok": True, "blend": blender_command() is not None}


@app.post("/api/blend")
def convert_to_blend(file: UploadFile = File(...)):
    command = blender_command()
    if command is None:
        raise HTTPException(503, "Blender is not installed on the server.")

    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Model is too large.")
    if data[:4] != b"glTF":
        raise HTTPException(400, "Expected a GLB file.")

    workdir = Path(tempfile.mkdtemp(prefix="figure-blend-"))
    src, dst = workdir / "figure.glb", workdir / "figure.blend"
    src.write_bytes(data)
    try:
        result = subprocess.run(
            [*command, str(src), str(dst)],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        shutil.rmtree(workdir, ignore_errors=True)
        raise HTTPException(504, "Blender took too long.")
    if result.returncode != 0 or not dst.exists():
        shutil.rmtree(workdir, ignore_errors=True)
        tail = (result.stderr or result.stdout).strip().splitlines()[-5:]
        raise HTTPException(500, "Blender failed: " + " | ".join(tail))

    return FileResponse(
        dst,
        media_type="application/x-blender",
        filename="figure.blend",
        background=BackgroundTask(shutil.rmtree, workdir, ignore_errors=True),
    )


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
