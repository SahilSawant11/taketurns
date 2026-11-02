/**
 * Shared vessel geometry and the FRP laminate material, used by the hero
 * scene (winding.ts) and the still renders (studio.ts).
 */
import * as THREE from 'three';

// Winding pattern: N bands per direction, pattern step 3 (coprime with 8) so
// circuits spread round the mandrel. 2·DU ≡ 3/N (mod 1) keeps rotation continuous.
export const N = 8;
export const PASSES = N * 2;
export const DU = (3 + 3 / N) / 2; // mandrel turns per pass (~58° winding angle)

/** Horizontal pressure-vessel profile: cylinder ±half, 2:1 elliptical heads, polar openings. */
export function vesselProfile(R = 1, half = 2, head = 0.5, pole = 0.2) {
  const pts: THREE.Vector2[] = [];
  const a0 = Math.asin(pole / R);
  for (let i = 0; i <= 14; i++) {
    const a = a0 + (i / 14) * (Math.PI / 2 - a0);
    pts.push(new THREE.Vector2(R * Math.sin(a), -half - head * Math.cos(a)));
  }
  for (let i = 1; i < 48; i++) pts.push(new THREE.Vector2(R, -half + (i / 48) * 2 * half));
  for (let i = 14; i >= 0; i--) {
    const a = a0 + (i / 14) * (Math.PI / 2 - a0);
    pts.push(new THREE.Vector2(R * Math.sin(a), half + head * Math.cos(a)));
  }
  return pts;
}

/** The hero's wound part: an open, flanged stack section. */
export const SPOOL = { r: 1, half: 2.2, flange: 1.42 };

/**
 * Stack section profile: a straight cylinder ±half with a short rounded lip at
 * each end where the bands turn round on the mandrel (hidden by the flanges
 * once they're on).
 */
export function spoolProfile(R = SPOOL.r, half = SPOOL.half, lip = 0.07) {
  const pts: THREE.Vector2[] = [];
  const end = (s: 1 | -1, i: number) => {
    const a = (i / 6) * (Math.PI / 2);
    return new THREE.Vector2(R - 0.08 * (1 - Math.sin(a)), s * (half + lip * Math.cos(a)));
  };
  for (let i = 0; i <= 6; i++) pts.push(end(-1, i));
  for (let i = 1; i < 48; i++) pts.push(new THREE.Vector2(R, -half + (i / 48) * 2 * half));
  for (let i = 6; i >= 0; i--) pts.push(end(1, i));
  return pts;
}

/** Interpolated (radius, axial) point at normalised profile position v. */
export function profileAt(pts: THREE.Vector2[], v: number) {
  const f = THREE.MathUtils.clamp(v, 0, 1) * (pts.length - 1);
  const i = Math.min(Math.floor(f), pts.length - 2);
  return pts[i].clone().lerp(pts[i + 1], f - i);
}

export type LaminateUniforms = ReturnType<typeof laminateUniforms>;

export function laminateUniforms() {
  return {
    uProgress: { value: 0 }, // passes laid, fractional
    uVeil: { value: 0 }, // 0–1 resin-rich surface veil
    uCure: { value: 0 }, // 0 wet → 1 cured
    uOff: { value: 0 }, // pattern phase so the laying point faces the carriage
    uDu: { value: DU },
    uBand: { value: 0.5 / N + 0.004 },
    uWet: { value: new THREE.Color('#e4f5e9') },
    uCured: { value: new THREE.Color('#1f8a55') },
    uResin: { value: new THREE.Color('#4cbf7f') },
    uCoat: { value: 0 }, // 0–1 how far the glossy topcoat has been smeared along the vessel
    uCoatCol: { value: new THREE.Color('#0f6b42') },
  };
}

/**
 * FRP laminate: helical bands drawn in the fragment shader (no textures),
 * with fine roving filaments, darker band edges, and gloss that goes from
 * wet to satin as it cures. A final lacquer topcoat can then flow along the
 * vessel (uCoat): an uneven wet edge, deeper colour and a true clear-coat
 * layer with sharp reflections where it has covered.
 */
export function laminateMaterial(uniforms: LaminateUniforms) {
  const mat = new THREE.MeshPhysicalMaterial({
    transparent: true,
    roughness: 0.55,
    clearcoat: 0.12,
    clearcoatRoughness: 0.6,
    sheen: 0.25,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color('#e3f1e6'),
  });
  mat.defines = { USE_UV: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uProgress, uVeil, uCure, uOff, uDu, uBand, uCoat;
        uniform vec3 uWet, uCured, uResin, uCoatCol;
        float lamHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float lamNoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(lamHash(i), lamHash(i + vec2(1.0, 0.0)), f.x), mix(lamHash(i + vec2(0.0, 1.0)), lamHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float lamCover = 0.0;
        float lamRov = 1.0;
        float lamEdge = 0.0;
        float lamCoat = 0.0;
        {
          float pu = vUv.x - uOff;
          float v = vUv.y;
          for (int k = 0; k < ${PASSES}; k++) {
            float fk = float(k);
            if (fk >= uProgress) break;
            float f = clamp(uProgress - fk, 0.0, 1.0);
            float s = fract(floor(fk * 0.5) * 2.0 * uDu);
            bool down = mod(fk, 2.0) < 0.5;
            float ul = down ? s + uDu * v : s + uDu + uDu * (1.0 - v);
            float inR = down ? step(v, f) : step(1.0 - f, v);
            float d = abs(fract(pu - ul + 0.5) - 0.5);
            float b = (1.0 - smoothstep(uBand * 0.86, uBand, d)) * inR;
            float filaments = 0.84 + 0.16 * sin(d / uBand * 70.0);
            float tows = 0.9 + 0.1 * cos(d / uBand * 9.42);
            lamRov = mix(lamRov, filaments * tows, b);
            lamEdge = max(lamEdge, b * smoothstep(uBand * 0.55, uBand * 0.86, d));
            lamCover = 1.0 - (1.0 - lamCover) * (1.0 - b * 0.9);
          }
          vec3 fibre = mix(uWet, uCured, uCure) * lamRov * (1.0 - lamEdge * 0.3);
          // Surface veil: a resin-wet tissue wrapped on in overlapping helical
          // turns, so it sweeps along the mandrel with a stepped leading edge.
          float vq = v + 0.1 * fract(vUv.x * 3.0);
          float vEdge = uVeil * 1.22 - 0.08;
          float veil = 1.0 - smoothstep(vEdge - 0.008, vEdge, vq);
          float tissue = lamNoise(vUv * vec2(260.0, 90.0)) * 0.6 + lamNoise(vUv * vec2(70.0, 24.0)) * 0.4;
          float lap = smoothstep(0.012, 0.0, abs(fract(vUv.x * 3.0) - 0.0)) * 0.5 + smoothstep(0.02, 0.0, vEdge - vq) * veil;
          vec3 base = mix(uResin, uCured * 0.8, uCure) * mix(1.0, 0.9 + 0.2 * tissue, 1.0 - uCure * 0.6) * (1.0 + 0.18 * lap * (1.0 - uCure));
          diffuseColor.rgb = mix(base, fibre, lamCover);
          diffuseColor.a *= max(veil * 0.9, lamCover);
          if (uCoat > 0.0) {
            // the coat flows along the axis with an uneven, organic wet edge
            float front = uCoat * 1.14 - 0.07;
            vec2 q = vec2(vUv.x * 18.0, v * 5.0);
            float n = lamNoise(q) * 0.65 + lamNoise(q * 2.7) * 0.35;
            float edge = front + (n - 0.5) * 0.07;
            lamCoat = 1.0 - smoothstep(edge - 0.012, edge, v);
            // lacquer deepens the colour; the weave stays visible underneath
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.74 + uCoatCol * 0.16, lamCoat);
          }
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, mix(0.38, 0.62, uCure) + (1.0 - lamRov) * 0.5, lamCover);
        roughnessFactor = mix(roughnessFactor, 0.3, lamCoat);`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = mix(material.clearcoat, 1.0, lamCoat);
          material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.05, lamCoat);
        #endif`,
      );
  };
  return mat;
}

/**
 * Photographic studio environment for reflections: a dark room lit by a large
 * overhead softbox, two tall strip lights and a back rim strip. Gives metal
 * and gloss the long, clean highlights of product photography.
 */
export function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(30, 16, 30), new THREE.MeshBasicMaterial({ color: '#050505', side: THREE.BackSide })));
  const soft = (w: number, h: number, power: number, pos: [number, number, number], warm = false) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(warm ? '#f6f8fa' : '#ffffff').multiplyScalar(power), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  soft(10, 6, 1.6, [0, 7.5, 1.5], true); // overhead key softbox
  soft(1.2, 8, 2.6, [-9, 1, 3]); // left strip
  soft(1.2, 8, 1.8, [9, 1, -2]); // right strip
  soft(12, 0.8, 2.2, [0, 2.5, -10]); // back rim strip
  soft(6, 2, 0.6, [0, -1.2, 9]); // faint front fill
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

/** Common studio look: background, fog, image-based reflections, tone mapping. */
export function studio(renderer: THREE.WebGLRenderer, scene: THREE.Scene, bg = '#0d0d0d') {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, 14, 30);
}

/** Dark, slightly glossy floor that fades into the fog. */
export function floor(y: number) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64),
    new THREE.MeshStandardMaterial({ color: '#0e0e0e', roughness: 0.42, metalness: 0.2 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}
