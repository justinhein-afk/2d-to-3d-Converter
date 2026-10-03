import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rasterize, buildMask } from './mask.js';
import { buildFigureGeometry } from './mesh.js';
import { download, exportSTL, exportGLB, exportFBX, exportBLEND, checkBlendSupport } from './export.js';
import { drawDemoFigure } from './demo.js';

const $ = (sel) => document.querySelector(sel);

// ---------- 3D viewer ----------

const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.8);
key.position.set(1, 1.5, 2);
camera.add(key); // light follows the camera so the front is always lit
scene.add(camera);

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0 });
let mesh = null;

function resize() {
  const { clientWidth: w, clientHeight: h } = viewport;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

function fitView() {
  if (!mesh) return;
  const sphere = mesh.geometry.boundingSphere ?? (mesh.geometry.computeBoundingSphere(), mesh.geometry.boundingSphere);
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1;
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(new THREE.Vector3(0.35, 0.15, 1).normalize().multiplyScalar(dist));
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

// ---------- settings ----------

const inputs = {
  puffiness: $('#puffiness'),
  smoothing: $('#smoothing'),
  edge: $('#edge'),
  thickness: $('#thickness'),
  size: $('#size'),
  detail: $('#detail'),
  tolerance: $('#tolerance'),
  flatBack: $('#flatback'),
  smoothOutline: $('#smooth-outline'),
  color: $('#color'),
  wireframe: $('#wireframe'),
};

function settings() {
  return {
    mode: document.querySelector('input[name=mode]:checked').value,
    puffiness: +inputs.puffiness.value,
    smoothing: +inputs.smoothing.value,
    edgeThickness: +inputs.edge.value,
    thickness: +inputs.thickness.value,
    sizeMm: +inputs.size.value,
    flatBack: inputs.flatBack.checked,
    smoothOutline: inputs.smoothOutline.checked,
  };
}

function syncOutputs() {
  for (const out of document.querySelectorAll('output[for]')) {
    out.textContent = $(`#${out.htmlFor}`).value + (out.dataset.unit ? ` ${out.dataset.unit}` : '');
  }
  const mode = settings().mode;
  for (const el of document.querySelectorAll('[data-mode]')) el.hidden = el.dataset.mode !== mode;
}

// ---------- pipeline ----------

let source = null; // { image, name }
let raster = null;
let rasterKey = '';
let maskResult = null;
let maskKey = '';
let blendAvailable = false;

function setStatus(text, isError = false) {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function drawMaskPreview() {
  const c = $('#mask-preview');
  c.width = raster.width;
  c.height = raster.height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(raster.width, raster.height);
  for (let i = 0; i < maskResult.mask.length; i++) {
    if (!maskResult.mask[i]) continue;
    img.data.set(raster.data.subarray(i * 4, i * 4 + 3), i * 4);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  $('#preview-row').hidden = false;
  $('#mask-info').textContent = maskResult.usedAlpha
    ? 'Background removed using transparency.'
    : 'Background colour removed. Adjust tolerance if parts are missing or the background remains.';
  $('#tolerance-field').hidden = maskResult.usedAlpha;
}

function regenerate({ refit = false } = {}) {
  if (!source) return;
  const detail = +inputs.detail.value;
  const tolerance = +inputs.tolerance.value;

  const rk = `${detail}`;
  if (rk !== rasterKey) {
    raster = rasterize(source.image, detail);
    rasterKey = rk;
    maskKey = '';
  }
  const mk = `${rk}|${tolerance}`;
  if (mk !== maskKey) {
    maskResult = buildMask(raster, { tolerance });
    maskKey = mk;
    drawMaskPreview();
  }

  const result = buildFigureGeometry(raster, maskResult.mask, settings());
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh = null;
  }
  const hasMesh = !!result;
  for (const b of document.querySelectorAll('.exports button')) {
    b.disabled = !hasMesh || (b.dataset.format === 'blend' && !blendAvailable);
  }
  $('#empty').hidden = hasMesh;
  if (!result) {
    $('#stats').textContent = '';
    setStatus('No figure found in the image. Try a higher background tolerance or a transparent PNG.', true);
    return;
  }
  setStatus('');
  mesh = new THREE.Mesh(result.geometry, material);
  updateMaterial();
  scene.add(mesh);
  const s = result.stats.size;
  $('#stats').textContent =
    `${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm · ${result.stats.triangles.toLocaleString()} triangles`;
  if (refit) fitView();
}

let timer = 0;
function scheduleRegenerate(opts) {
  clearTimeout(timer);
  timer = setTimeout(() => regenerate(opts), 60);
}

function updateMaterial() {
  material.vertexColors = inputs.color.checked;
  material.color.set(inputs.color.checked ? 0xffffff : 0xd8d2c8);
  material.wireframe = inputs.wireframe.checked;
  material.needsUpdate = true;
}

function loadSource(image, name) {
  source = { image, name: name.replace(/\.[^.]+$/, '') || 'figure' };
  rasterKey = '';
  regenerate({ refit: true });
}

function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    setStatus('Please choose an image file (PNG, JPG, WEBP, GIF or SVG).', true);
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    loadSource(img, file.name);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus('Could not read that image.', true);
  };
  img.src = url;
}

// ---------- events ----------

$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]));
$('#demo').addEventListener('click', () => loadSource(drawDemoFigure(), 'demo-figure'));

const dz = $('#dropzone');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => {
  e.preventDefault();
  dz.classList.remove('over');
  loadFile(e.dataTransfer.files[0]);
});

for (const el of [inputs.puffiness, inputs.smoothing, inputs.edge, inputs.thickness, inputs.detail, inputs.tolerance]) {
  el.addEventListener('input', () => { syncOutputs(); scheduleRegenerate(); });
}
inputs.size.addEventListener('input', () => { syncOutputs(); scheduleRegenerate({ refit: true }); });
for (const el of [inputs.flatBack, inputs.smoothOutline, ...document.querySelectorAll('input[name=mode]')]) {
  el.addEventListener('change', () => { syncOutputs(); scheduleRegenerate(); });
}
inputs.color.addEventListener('change', updateMaterial);
inputs.wireframe.addEventListener('change', updateMaterial);
$('#reset-view').addEventListener('click', fitView);

const exporters = {
  stl: async (g) => exportSTL(g),
  glb: (g, color) => exportGLB(g, color),
  fbx: async (g, color) => exportFBX(g, color),
  blend: (g, color) => exportBLEND(g, color),
};

for (const button of document.querySelectorAll('.exports button')) {
  button.addEventListener('click', async () => {
    if (!mesh) return;
    const format = button.dataset.format;
    button.disabled = true;
    setStatus(format === 'blend' ? 'Converting with Blender…' : `Preparing ${format.toUpperCase()}…`);
    try {
      const blob = await exporters[format](mesh.geometry, inputs.color.checked);
      download(blob, `${source.name}.${format}`);
      setStatus(`Downloaded ${source.name}.${format} (${(blob.size / 1024).toFixed(0)} KB).`);
    } catch (err) {
      console.error(err);
      setStatus(err.message || String(err), true);
    } finally {
      button.disabled = false;
    }
  });
}

// .blend needs the optional server; without it the button explains why.
const blendButton = document.querySelector('.exports button[data-format=blend]');
blendButton.title = 'Needs the Python server with Blender (see README)';
checkBlendSupport().then((ok) => {
  blendAvailable = ok;
  blendButton.title = ok ? 'Converted by Blender on the server' : 'Needs the Python server with Blender (see README)';
  if (mesh) blendButton.disabled = !ok;
});

syncOutputs();
resize();
