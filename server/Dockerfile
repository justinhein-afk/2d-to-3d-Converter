# Runs the page plus .blend export, using Blender's `bpy` Python module.
# Build from the repository root:  docker build -f server/Dockerfile -t figure-to-3d .
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libegl1 libxrender1 libxi6 libxkbcommon0 libsm6 libxxf86vm1 libxfixes3 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt "bpy==4.5.*"
COPY server server
COPY web web

EXPOSE 8000
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
