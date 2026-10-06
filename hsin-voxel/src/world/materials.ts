// Shaders for chunk meshes (opaque/cutout and water) plus shared environment uniforms.
import * as THREE from 'three';

/** Uniforms shared by every world-lit material; the sky updates these once per frame. */
export const env = {
  uTime: { value: 0 },
  uSkyLight: { value: new THREE.Color(1, 1, 1) },
  uBlockLight: { value: new THREE.Color(1.0, 0.78, 0.52) },
  uMinLight: { value: 0.035 },
  uFogColor: { value: new THREE.Color(0.6, 0.75, 0.95) },
  uFogNear: { value: 60 },
  uFogFar: { value: 100 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  /** A soft moving light around the player (Hsin's glowing Rectifier). */
  uPlayerLightPos: { value: new THREE.Vector3(0, -1000, 0) },
  uPlayerLightColor: { value: new THREE.Color(0.55, 0.45, 0.75) },
  uPlayerLightRadius: { value: 7 },
};

const LIGHT_GLSL = /* glsl */ `
  uniform vec3 uSkyLight;
  uniform vec3 uBlockLight;
  uniform float uMinLight;
  uniform vec3 uPlayerLightPos;
  uniform vec3 uPlayerLightColor;
  uniform float uPlayerLightRadius;
  vec3 worldLight(float sky, float blk) {
    float s = sky * sky * (0.35 + 0.65 * sky);
    float b = blk * blk * (0.4 + 0.6 * blk);
    return max(max(uSkyLight * s, uBlockLight * b), vec3(uMinLight));
  }
  vec3 playerLight(vec3 worldPos) {
    float d = distance(worldPos, uPlayerLightPos);
    float f = clamp(1.0 - d / uPlayerLightRadius, 0.0, 1.0);
    return uPlayerLightColor * f * f;
  }
`;

const FOG_GLSL = /* glsl */ `
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  vec3 applyFog(vec3 col, float dist) {
    return mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));
  }
`;

export const SHADER_CHUNKS = { LIGHT_GLSL, FOG_GLSL };

const chunkVertex = /* glsl */ `
  in vec4 data;
  in vec4 light;
  uniform float uTime;
  out vec2 vUv;
  flat out float vLayer;
  out vec3 vLight;
  out float vFogDist;
  out float vFlags;
  out vec3 vWorldPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    float flags = data.w;
    if (mod(flags, 2.0) >= 1.0) {
      float t = uTime;
      world.x += sin(t * 1.7 + world.x * 0.6 + world.z * 0.4 + world.y * 0.3) * 0.05;
      world.z += cos(t * 1.4 + world.x * 0.4 + world.z * 0.7) * 0.05;
    }
    vFlags = flags;
    vWorldPos = world.xyz;
    vUv = data.xy;
    vLayer = data.z;
    vLight = light.xyz;
    vec4 mv = viewMatrix * world;
    vFogDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const chunkFragment = /* glsl */ `
  precision highp sampler2DArray;
  uniform sampler2DArray uAtlas;
  in vec2 vUv;
  flat in float vLayer;
  in vec3 vLight;
  in float vFogDist;
  in float vFlags;
  in vec3 vWorldPos;
  ${LIGHT_GLSL}
  ${FOG_GLSL}
  void main() {
    vec4 tex = texture(uAtlas, vec3(vUv.x, 1.0 - vUv.y, vLayer));
    if (tex.a < 0.5) discard;
    vec3 light = max(worldLight(vLight.x, vLight.y), playerLight(vWorldPos));
    vec3 col = tex.rgb * light * vLight.z;
    gl_FragColor = vec4(applyFog(col, vFogDist), 1.0);
    #include <colorspace_fragment>
  }
`;

const waterFragment = /* glsl */ `
  precision highp sampler2DArray;
  uniform sampler2DArray uAtlas;
  uniform float uTime;
  uniform vec3 uSunDir;
  in vec2 vUv;
  flat in float vLayer;
  in vec3 vLight;
  in float vFogDist;
  in float vFlags;
  in vec3 vWorldPos;
  ${LIGHT_GLSL}
  ${FOG_GLSL}
  void main() {
    vec2 uv = vUv + vec2(uTime * 0.03, uTime * 0.02);
    vec4 tex = texture(uAtlas, vec3(uv.x, 1.0 - uv.y, vLayer));
    vec3 light = max(worldLight(vLight.x, vLight.y), playerLight(vWorldPos));
    vec3 col = tex.rgb * light * mix(0.85, 1.0, vLight.z);
    float alpha = 0.72;
    if (vFlags >= 2.0) {
      // Gentle sparkle on the surface during the day.
      float sparkle = pow(max(0.0, sin(uv.x * 40.0 + uTime * 2.0) * sin(uv.y * 37.0 - uTime * 1.6)), 24.0);
      col += vec3(sparkle) * max(uSunDir.y, 0.0) * vLight.x * 0.6;
    }
    gl_FragColor = vec4(applyFog(col, vFogDist), alpha);
    #include <colorspace_fragment>
  }
`;

export interface ChunkMaterials {
  opaque: THREE.ShaderMaterial;
  water: THREE.ShaderMaterial;
}

export function createChunkMaterials(atlas: THREE.DataArrayTexture): ChunkMaterials {
  const shared = { ...env, uAtlas: { value: atlas } };
  const opaque = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: chunkVertex,
    fragmentShader: chunkFragment,
  });
  const water = new THREE.ShaderMaterial({
    uniforms: shared,
    vertexShader: chunkVertex,
    fragmentShader: waterFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return { opaque, water };
}

/** Crack overlay shown on the block being mined; samples one destroy_N layer. */
export function createCrackMaterial(atlas: THREE.DataArrayTexture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: atlas }, uLayer: { value: 0 } },
    vertexShader: /* glsl */ `
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp sampler2DArray;
      uniform sampler2DArray uAtlas;
      uniform float uLayer;
      in vec2 vUv;
      void main() {
        vec4 tex = texture(uAtlas, vec3(vUv.x, 1.0 - vUv.y, uLayer));
        if (tex.a < 0.1) discard;
        gl_FragColor = vec4(tex.rgb, tex.a * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
}
