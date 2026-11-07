/**
 * Daylight in the workshop: the sun slants in through the tall glazing on the
 * left wall (scripts/blender/workshop.py, WIN_L), throws the window's pattern
 * across the floor and the machine, and shows as soft shafts in the air.
 *
 * The light is a spot far outside the wall whose projected map is the window
 * itself as seen from the sun (worked out by casting a ray per texel onto the
 * wall), so the pools on the floor line up with the glazing and the machine
 * still casts its shadow through them.
 */
import * as THREE from 'three';

// Window geometry in three.js terms, floor at y = 0 (matches workshop.py).
const WALL_X = -15.3;
const SILL = 2.4;
const HEAD = 8.4;
const Z0 = -20;
const Z1 = 14;
const FRAMES_Z = [-21, -15, -9, -3, 3, 9, 15];
/** Towards where the light travels: in from the left, down, and a little towards the camera. */
const DIR = new THREE.Vector3(1, -0.5, 0.12).normalize();
/** The sun stops short of the foreground, so it falls on the machine and not under the headline. */
const NEAR_Z: [number, number] = [1.5, 6];
const SUN = new THREE.Color('#ffe2b6'); // late-morning sun, warm against the cool shade

/** 1 where a point on the wall plane is glass, 0 on frame or cladding. */
function glass(y: number, z: number) {
  if (y < SILL || y > HEAD || z < Z0 || z > Z1) return 0;
  if (Math.abs(y - (SILL + HEAD) / 2) < 0.06) return 0; // transom
  for (const f of FRAMES_Z) {
    if (Math.abs(z - f) < 0.11) return 0;
    for (const k of [2, 4]) if (Math.abs(z - (f + k)) < 0.05) return 0;
  }
  return 1;
}

export function createSun(floorY: number, focus = new THREE.Vector3(-2, floorY, 0)) {
  const light = new THREE.SpotLight(SUN, 0, 0, 0.32, 0, 0);
  light.position.copy(focus).addScaledVector(DIR, -46);
  light.target.position.copy(focus);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.03;
  light.shadow.radius = 3;
  light.shadow.camera.near = 20;
  light.shadow.camera.far = 70;

  // The window as the sun sees it: a ray per texel from the light through its
  // projection, onto the wall plane. A few samples per texel soften the edges.
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  light.shadow.updateMatrices(light);
  const cam = light.shadow.camera;
  const N = 256;
  const SS = 3;
  const data = new Uint8Array(N * N * 4);
  const ndc = new THREE.Vector3();
  const ray = new THREE.Vector3();
  const o = light.position;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      let lit = 0;
      for (let a = 0; a < SS; a++)
        for (let b = 0; b < SS; b++) {
          ndc.set(((i + (a + 0.5) / SS) / N) * 2 - 1, ((j + (b + 0.5) / SS) / N) * 2 - 1, 0.5).unproject(cam);
          ray.subVectors(ndc, o);
          const t = (WALL_X - o.x) / ray.x;
          const zf = o.z + (ray.z * (floorY - o.y)) / ray.y; // where this ray meets the floor
          const near = 1 - THREE.MathUtils.smoothstep(zf, NEAR_Z[0], NEAR_Z[1]);
          lit += t > 0 ? glass(o.y + ray.y * t - floorY, o.z + ray.z * t) * near : 0;
        }
      const v = Math.round((lit / (SS * SS)) * 255);
      const k = (j * N + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = v;
      data[k + 3] = 255;
    }
  const map = new THREE.DataTexture(data, N, N);
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  light.map = map;

  // Shafts: one soft slab per pane column, from the glass along the light.
  const shafts = new THREE.Group();
  const uniforms = { uI: { value: 0 }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float along;
      varying float vAlong;
      varying vec3 vW, vN, vV;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vAlong = along;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uI, uTime;
      varying float vAlong;
      varying vec3 vW, vN, vV;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        // brightest near the glass, gone before the floor; faces seen edge-on read thicker
        float fade = smoothstep(0.0, 0.08, vAlong) * pow(1.0 - vAlong, 1.6);
        float edge = 1.0 - pow(abs(dot(normalize(vN), normalize(vV))), 0.6) * 0.6;
        float drift = 0.65 + 0.35 * n(vW.zy * 0.45 + vec2(uTime * 0.05, 0.0));
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.74), fade * edge * drift * uI);
      }`,
  });
  const reach = (HEAD + 0.5) / -DIR.y; // far enough to meet the floor from the head
  const pane: [number, number][] = [];
  for (let f = 0; f < FRAMES_Z.length - 1; f++)
    for (let k = 0; k < 3; k++) {
      const za = FRAMES_Z[f] + k * 2 + 0.12;
      const zb = FRAMES_Z[f] + (k + 1) * 2 - 0.12;
      if (zb > Z0 && za < NEAR_Z[0] - 1) pane.push([Math.max(za, Z0), Math.min(zb, Z1)]);
    }
  const geos: THREE.BufferGeometry[] = [];
  for (const [za, zb] of pane) {
    // a box from the window rectangle, swept along the light; 'along' 0 at the glass, 1 at the far end
    const base = [
      [WALL_X, SILL, za],
      [WALL_X, HEAD, za],
      [WALL_X, HEAD, zb],
      [WALL_X, SILL, zb],
    ].map(([x, y, z]) => new THREE.Vector3(x, floorY + y, z));
    const tip = base.map((p) => p.clone().addScaledVector(DIR, reach));
    const pos: number[] = [];
    const al: number[] = [];
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, la: number, lb: number) => {
      for (const [p, l] of [[a, la], [b, la], [c, lb], [a, la], [c, lb], [d, lb]] as const) {
        pos.push(p.x, p.y, p.z);
        al.push(l);
      }
    };
    for (let s = 0; s < 4; s++) {
      const e = (s + 1) % 4;
      quad(base[s], base[e], tip[e], tip[s], 0, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('along', new THREE.Float32BufferAttribute(al, 1));
    g.computeVertexNormals();
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 2;
    m.frustumCulled = false;
    shafts.add(m);
  }

  const object = new THREE.Group();
  object.add(light, light.target, shafts);
  return {
    object,
    light,
    /** Not surfaces: keep them out of depth/normal passes. */
    shafts,
    /** k: 0 off → 1 full sun; shaft: how much of it shows in the air. */
    update(t: number, k: number, shaft = 1) {
      light.intensity = 26 * k;
      uniforms.uI.value = 0.1 * k * shaft;
      uniforms.uTime.value = t;
      shafts.visible = k * shaft > 0.001;
    },
    dispose() {
      map.dispose();
      mat.dispose();
      geos.forEach((g) => g.dispose());
      light.dispose();
    },
  };
}
