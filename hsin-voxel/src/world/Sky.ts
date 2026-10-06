// Day/night cycle: sky gradient, sun, moon, stars, blocky clouds, fog and sky-light colour.
import * as THREE from 'three';
import { GAME } from '../config/game';
import { TAU, clamp, smoothstep } from '../core/math';
import { env } from './materials';

const c = (hex: number) => new THREE.Color(hex);

const ZENITH_DAY = c(0x3a78d4);
const ZENITH_NIGHT = c(0x03050d);
const ZENITH_DUSK = c(0x3b3470);
const HORIZON_DAY = c(0xa8cbef);
const HORIZON_NIGHT = c(0x0a0f1e);
const HORIZON_DUSK = c(0xf08a4e);
const LIGHT_DAY = new THREE.Color(1.0, 0.98, 0.94);
const LIGHT_NIGHT = new THREE.Color(0.11, 0.13, 0.22);
const LIGHT_DUSK = new THREE.Color(1.0, 0.66, 0.42);
const UNDERWATER = c(0x123a6e);
const WHITE = new THREE.Color(1, 1, 1);

export class Sky {
  /** 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  time: number = GAME.world.startTime;
  dayLength: number = GAME.world.dayLengthSeconds;
  readonly sunDir = new THREE.Vector3();
  /** 1 in full daylight, 0 at night. */
  daylight = 1;
  underwater = false;

  private readonly dome: THREE.Mesh;
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly clouds: THREE.Mesh;
  private readonly domeUniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uNight: { value: 0 },
    uDusk: { value: 0 },
    uStarRot: { value: 0 },
  };
  private readonly cloudUniforms = {
    uCloudTex: { value: null as THREE.Texture | null },
    uOffset: { value: new THREE.Vector2() },
    uCloudColor: { value: new THREE.Color(1, 1, 1) },
    uFogColor: env.uFogColor,
    uFar: { value: 200 },
  };
  private readonly tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.domeUniforms,
        vertexShader: /* glsl */ `
          out vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith;
          uniform vec3 uHorizon;
          uniform vec3 uSunDir;
          uniform float uNight;
          uniform float uDusk;
          uniform float uStarRot;
          in vec3 vDir;
          float hash(vec3 p) {
            p = fract(p * 0.3183099 + 0.1);
            p *= 17.0;
            return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
          }
          void main() {
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
            if (h < 0.0) col = mix(uHorizon, uHorizon * 0.55, clamp(-h * 4.0, 0.0, 1.0));
            float sd = max(dot(d, uSunDir), 0.0);
            // Warm glow around the sun, strongest at sunrise and sunset.
            col += vec3(1.0, 0.6, 0.3) * pow(sd, 6.0) * uDusk * 0.6;
            col += vec3(1.0, 0.95, 0.8) * pow(sd, 64.0) * (1.0 - uNight) * 0.5;
            if (uNight > 0.01 && h > 0.0) {
              float c = cos(uStarRot), s = sin(uStarRot);
              vec3 r = vec3(c * d.x - s * d.y, s * d.x + c * d.y, d.z);
              vec3 q = floor(r * 260.0);
              float star = step(0.9965, hash(q));
              float twinkle = 0.6 + 0.4 * hash(q + 7.0);
              col += vec3(star * twinkle) * smoothstep(0.55, 0.95, uNight) * smoothstep(0.0, 0.3, h);
            }
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }
        `,
        depthWrite: false,
        depthTest: false,
        side: THREE.BackSide,
      }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: makeSunTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.sun.renderOrder = -5;
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: makeMoonTexture(), transparent: true, depthWrite: false, fog: false }),
    );
    this.moon.renderOrder = -5;
    scene.add(this.sun, this.moon);

    this.cloudUniforms.uCloudTex.value = makeCloudTexture();
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: this.cloudUniforms,
        vertexShader: /* glsl */ `
          out vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uCloudTex;
          uniform vec2 uOffset;
          uniform vec3 uCloudColor;
          uniform vec3 uFogColor;
          uniform float uFar;
          in vec3 vWorld;
          void main() {
            vec2 uv = (vWorld.xz + uOffset) / (12.0 * 64.0);
            float a = texture(uCloudTex, uv).r;
            if (a < 0.5) discard;
            float dist = length(vWorld.xz - cameraPosition.xz);
            float fade = 1.0 - smoothstep(uFar * 0.45, uFar, dist);
            vec3 col = mix(uFogColor, uCloudColor, 0.85);
            gl_FragColor = vec4(col, 0.78 * fade);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = 5;
    scene.add(this.clouds);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, renderDistance: number, paused = false): void {
    if (!paused) this.time = (this.time + dt / this.dayLength) % 1;
    const angle = (this.time - 0.25) * TAU;
    this.sunDir.set(Math.cos(angle), Math.sin(angle), 0.25).normalize();
    const sunY = this.sunDir.y;
    this.daylight = smoothstep(-0.12, 0.2, sunY);
    const dusk = clamp(1 - Math.abs(sunY) / 0.32, 0, 1) * smoothstep(-0.3, 0.05, sunY);

    const u = this.domeUniforms;
    u.uZenith.value.copy(ZENITH_NIGHT).lerp(ZENITH_DAY, this.daylight).lerp(ZENITH_DUSK, dusk * 0.45);
    u.uHorizon.value.copy(HORIZON_NIGHT).lerp(HORIZON_DAY, this.daylight).lerp(HORIZON_DUSK, dusk * 0.7);
    u.uSunDir.value.copy(this.sunDir);
    u.uNight.value = 1 - this.daylight;
    u.uDusk.value = dusk;
    u.uStarRot.value = angle;
    env.uSunDir.value.copy(this.sunDir);

    env.uSkyLight.value.copy(LIGHT_NIGHT).lerp(LIGHT_DAY, this.daylight).lerp(LIGHT_DUSK, dusk * 0.5);

    const far = renderDistance * 16;
    if (this.underwater) {
      env.uFogColor.value.copy(UNDERWATER).multiplyScalar(0.25 + 0.75 * this.daylight);
      env.uFogNear.value = 2;
      env.uFogFar.value = 22;
    } else {
      // Fog leans toward the sunset colour, so distant terrain blends into the horizon.
      env.uFogColor.value.copy(u.uHorizon.value);
      env.uFogNear.value = far * 0.62;
      env.uFogFar.value = far * 0.98;
    }

    // Sun and moon sit on a big circle around the camera and face it.
    const dist = Math.min(camera.far * 0.8, 380);
    this.sun.position.copy(camera.position).addScaledVector(this.sunDir, dist);
    this.sun.scale.setScalar(dist * 0.16);
    this.sun.lookAt(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(this.sunDir, -dist);
    this.moon.scale.setScalar(dist * 0.11);
    this.moon.lookAt(camera.position);
    (this.sun.material as THREE.MeshBasicMaterial).opacity = smoothstep(-0.2, 0.0, sunY);
    (this.moon.material as THREE.MeshBasicMaterial).opacity = smoothstep(0.15, -0.05, sunY);

    // Clouds: one big plane that follows the camera; texture coordinates scroll with time.
    const cu = this.cloudUniforms;
    cu.uOffset.value.x += dt * 1.2;
    cu.uFar.value = Math.max(far * 1.4, 160);
    this.clouds.position.set(camera.position.x, 116, camera.position.z);
    this.clouds.scale.set(cu.uFar.value * 2.2, 1, cu.uFar.value * 2.2);
    this.tmpColor.setRGB(0.03, 0.035, 0.055).lerp(WHITE, this.daylight);
    cu.uCloudColor.value.copy(this.tmpColor).lerp(LIGHT_DUSK, dusk * 0.4);
  }

  /** Background clear colour (used when the dome is hidden). */
  get horizonColor(): THREE.Color {
    return this.domeUniforms.uHorizon.value;
  }

  get isNight(): boolean {
    return this.daylight < 0.25;
  }

  /** Clock text like "06:30". */
  clockText(): string {
    const minutes = Math.floor(this.time * 24 * 60);
    const h = Math.floor(minutes / 60) % 24;
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}

function makeSunTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,240,200,0.55)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#fff6d8';
  ctx.fillRect(s * 0.32, s * 0.32, s * 0.36, s * 0.36);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(s * 0.38, s * 0.38, s * 0.24, s * 0.24);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeMoonTexture(): THREE.Texture {
  const s = 32;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#dfe6f2';
  ctx.fillRect(8, 8, 16, 16);
  ctx.fillStyle = '#b8c2d4';
  for (const [x, y, w] of [[11, 11, 3], [17, 14, 4], [12, 19, 2], [19, 20, 2]]) ctx.fillRect(x, y, w, w);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeCloudTexture(): THREE.Texture {
  // 64x64 blobs; each texel becomes a 12x12-block cloud cell.
  const s = 64;
  const data = new Uint8Array(s * s * 4);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const grid = new Float32Array(s * s);
  for (let i = 0; i < 70; i++) {
    const cx = rand() * s;
    const cy = rand() * s;
    const r = 1.5 + rand() * 4;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        let dx = Math.abs(x - cx);
        let dy = Math.abs(y - cy);
        dx = Math.min(dx, s - dx);
        dy = Math.min(dy, s - dy);
        if (dx * dx * 0.6 + dy * dy < r * r) grid[y * s + x] = 1;
      }
    }
  }
  for (let i = 0; i < s * s; i++) {
    const v = grid[i] ? 255 : 0;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, s, s);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}
