// Shared tools for Minecraft-style box models: a pixel "skin" canvas with per-face regions,
// box geometry mapped onto it, and a lit entity material that matches the voxel lighting.
import * as THREE from 'three';
import { env } from '../world/materials';

export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box `w x h x d` model-pixels big whose texture lives at (u, v) in the skin, `density` texels per pixel. */
export interface BoxSpec {
  w: number;
  h: number;
  d: number;
  u: number;
  v: number;
  density?: number;
}

/**
 * Minecraft-style unfolded layout: [top][bottom] above [right][front][left][back].
 * "right"/"left" are the character's own sides (the model faces +Z, so its right is -X).
 * Side faces have +Y up; the top face has the back edge at the top of its region.
 */
export function faceRects(b: BoxSpec): Record<Face, Rect> {
  const k = b.density ?? 1;
  const w = b.w * k;
  const h = b.h * k;
  const d = b.d * k;
  const { u, v } = b;
  return {
    py: { x: u + d, y: v, w, h: d },
    ny: { x: u + d + w, y: v, w, h: d },
    nx: { x: u, y: v + d, w: d, h },
    pz: { x: u + d, y: v + d, w, h },
    px: { x: u + d + w, y: v + d, w: d, h },
    nz: { x: u + 2 * d + w, y: v + d, w, h },
  };
}

const FACE_ORDER: Face[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

/** Box geometry (in model pixels) with UVs pointing at the box's regions of the skin texture. */
export function boxGeometry(b: BoxSpec, texW: number, texH: number, inflate = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.w + inflate * 2, b.h + inflate * 2, b.d + inflate * 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const rects = faceRects(b);
  for (let f = 0; f < 6; f++) {
    const r = rects[FACE_ORDER[f]];
    const u0 = r.x / texW;
    const u1 = (r.x + r.w) / texW;
    const vTop = 1 - r.y / texH;
    const vBot = 1 - (r.y + r.h) / texH;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), vBot + uv.getY(i) * (vTop - vBot));
    }
  }
  return g;
}

/** A pair of canvases (colour + glow) that model textures are painted into. */
export class Skin {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly glowCanvas: HTMLCanvasElement;
  readonly glow: CanvasRenderingContext2D;

  constructor(readonly width: number, readonly height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.glowCanvas = document.createElement('canvas');
    this.glowCanvas.width = width;
    this.glowCanvas.height = height;
    this.glow = this.glowCanvas.getContext('2d')!;
    this.glow.fillStyle = '#000';
    this.glow.fillRect(0, 0, width, height);
  }

  rect(r: Rect, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  fill(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  px(x: number, y: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, 1, 1);
  }

  clear(x: number, y: number, w: number, h: number): void {
    this.ctx.clearRect(x, y, w, h);
  }

  glowPx(x: number, y: number, color: string, w = 1, h = 1): void {
    this.glow.fillStyle = color;
    this.glow.fillRect(x, y, w, h);
  }

  /** Fills a region with a base colour plus random darker/lighter speckles. */
  noise(r: Rect, base: string, alt: string[], amount: number, rand: () => number): void {
    this.rect(r, base);
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (rand() < amount) this.px(x, y, alt[Math.floor(rand() * alt.length)]);
      }
    }
  }

  /** Paints all six faces of a box with one colour. */
  solid(b: BoxSpec, color: string): Record<Face, Rect> {
    const rects = faceRects(b);
    for (const f of FACE_ORDER) this.rect(rects[f], color);
    return rects;
  }

  textures(): { map: THREE.CanvasTexture; glowMap: THREE.CanvasTexture } {
    const map = new THREE.CanvasTexture(this.canvas);
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.colorSpace = THREE.SRGBColorSpace;
    map.generateMipmaps = false;
    const glowMap = new THREE.CanvasTexture(this.glowCanvas);
    glowMap.magFilter = THREE.NearestFilter;
    glowMap.minFilter = THREE.NearestFilter;
    glowMap.colorSpace = THREE.SRGBColorSpace;
    glowMap.generateMipmaps = false;
    return { map, glowMap };
  }
}

const BLANK = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();
const BLACK = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

export interface EntityUniforms {
  [uniform: string]: THREE.IUniform;
  map: { value: THREE.Texture };
  glowMap: { value: THREE.Texture };
  uColor: { value: THREE.Color };
  uLight: { value: THREE.Color };
  uGlow: { value: number };
  uEmissive: { value: THREE.Color };
  uFlash: { value: number };
  uFlashColor: { value: THREE.Color };
  uOpacity: { value: number };
}

/**
 * Material for characters and mobs. Lit by `uLight` (sampled from the voxel light at the entity),
 * plus a glow texture and a hit-flash colour.
 */
export function createEntityMaterial(opts: {
  map?: THREE.Texture;
  glowMap?: THREE.Texture;
  color?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  transparent?: boolean;
  uniforms?: EntityUniforms;
}): THREE.ShaderMaterial {
  const uniforms: EntityUniforms = opts.uniforms ?? {
    map: { value: opts.map ?? BLANK },
    glowMap: { value: opts.glowMap ?? BLACK },
    uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
    uLight: { value: new THREE.Color(1, 1, 1) },
    uGlow: { value: 1 },
    uEmissive: { value: new THREE.Color(opts.emissive ?? 0x000000) },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uOpacity: { value: 1 },
  };
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uFogColor: env.uFogColor, uFogNear: env.uFogNear, uFogFar: env.uFogFar },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      out vec3 vNormal;
      out float vFogDist;
      void main() {
        vUv = uv;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDist = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform sampler2D glowMap;
      uniform vec3 uColor;
      uniform vec3 uLight;
      uniform float uGlow;
      uniform vec3 uEmissive;
      uniform float uFlash;
      uniform vec3 uFlashColor;
      uniform float uOpacity;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      in vec2 vUv;
      in vec3 vNormal;
      in float vFogDist;
      void main() {
        vec4 t = texture(map, vUv);
        if (t.a < 0.5) discard;
        vec3 n = normalize(vNormal);
        float shade = 0.8 + 0.2 * n.y - 0.1 * abs(n.x);
        vec3 col = t.rgb * uColor * uLight * shade;
        col += texture(glowMap, vUv).rgb * uGlow + uEmissive;
        col = mix(col, uFlashColor, uFlash);
        col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, vFogDist));
        gl_FragColor = vec4(col, uOpacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: opts.transparent ?? false,
  });
}

/** Creates a mesh for a box part, positioned so (0,0,0) of `pivot` is the joint. */
export function part(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export function joint(parent: THREE.Object3D, x: number, y: number, z: number, name = ''): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
