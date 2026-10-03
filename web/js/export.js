// Export helpers. Geometry coming from mesh.js is in millimetres, Y up, with
// linear-space vertex colours.

import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { writeFBX } from './fbx.js';

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// STL has no colour or units; slicers read the numbers as millimetres. The
// back of the figure lies on Z = 0, ready to print.
export function exportSTL(geometry) {
  const mesh = new THREE.Mesh(geometry);
  const data = new STLExporter().parse(mesh, { binary: true });
  return new Blob([data], { type: 'model/stl' });
}

// glTF uses metres, so the millimetre model is scaled by 1/1000.
export async function exportGLB(geometry, includeColor) {
  const geo = geometry.clone();
  if (!includeColor) geo.deleteAttribute('color');
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: includeColor,
    roughness: 0.6,
    metalness: 0,
  });
  material.name = 'FigureMaterial';
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'Figure';
  mesh.scale.setScalar(0.001);
  const scene = new THREE.Scene();
  scene.add(mesh);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  geo.dispose();
  material.dispose();
  return new Blob([glb], { type: 'model/gltf-binary' });
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function exportFBX(geometry, includeColor) {
  let colors = null;
  if (includeColor) {
    const lin = geometry.getAttribute('color').array;
    colors = new Float32Array(lin.length);
    for (let i = 0; i < lin.length; i++) colors[i] = linearToSrgb(lin[i]);
  }
  const buf = writeFBX({
    positions: geometry.getAttribute('position').array,
    normals: geometry.getAttribute('normal').array,
    colors,
    indices: geometry.getIndex().array,
  });
  return new Blob([buf], { type: 'application/octet-stream' });
}

// .blend files can only be written by Blender, so the GLB is sent to the
// optional Python server (server/app.py) which converts it with Blender.
export async function exportBLEND(geometry, includeColor) {
  const glb = await exportGLB(geometry, includeColor);
  const form = new FormData();
  form.append('file', glb, 'figure.glb');
  const res = await fetch('api/blend', { method: 'POST', body: form });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* not JSON */ }
    throw new Error(`Blender conversion failed: ${detail}`);
  }
  return await res.blob();
}

export async function checkBlendSupport() {
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    if (!res.ok) return false;
    return (await res.json()).blend === true;
  } catch {
    return false;
  }
}
