/**
 * The plant: where the wound section ends up. A daytime industrial estate with
 * an FRP fume scrubber at its centre. The section from the workshop is lowered
 * onto the scrubber's top flange as its stack, the hook lets go, and the
 * system starts: the neighbours' chimneys keep putting out brown haze while a
 * faint white wisp leaves ours. Then the camera rises to show the estate,
 * with the FRP in it pinned and labelled (the pins themselves are HTML, see
 * WindingHero.astro; this file only says where they are).
 *
 * Grey-box: simple procedural shapes, made to settle the story, camera and
 * pacing before detailed models (Blender) replace them.
 *
 * Units match the workshop: the section is ~4.6 long with a radius of ~1.04.
 * The scrubber stands at the origin on ground level y = 0.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PASSES, SPOOL, laminateMaterial, laminateUniforms, spoolProfile } from './vessel';

/** Top flange of the scrubber: where the section's lower flange seats. */
export const SEAT_Y = 12.3;
const TOWER_R = 2.1;

/** 'plume' has no label: it's where the home page's leaf rises from (see leaf.ts). */
export type PinId = 'scrubber' | 'duct' | 'tanks' | 'piping' | 'gls' | 'plume';

const smooth = (x: number) => THREE.MathUtils.smootherstep(x, 0, 1);
const clamp01 = (x: number) => THREE.MathUtils.clamp(x, 0, 1);

/** Deterministic "random", so the estate is the same on every visit. */
function rng(seed: number) {
  let r = seed;
  return () => (r = (r * 16807) % 2147483647) / 2147483647;
}

/** Day sky: a vertical gradient with a warm glow round the sun. */
function skyDome(sunDir: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#3f78b8') },
      uMid: { value: new THREE.Color('#8fb6d9') },
      uHorizon: { value: new THREE.Color('#dfe6e6') },
      uSun: { value: sunDir.clone().normalize() },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `
      uniform vec3 uTop, uMid, uHorizon, uSun; varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.18, h));
        c = mix(c, uTop, smoothstep(0.18, 0.75, h));
        float s = max(dot(vDir, uSun), 0.0);
        c += vec3(1.0, 0.93, 0.8) * (pow(s, 12.0) * 0.25 + pow(s, 900.0) * 4.0);
        if (vDir.y < 0.0) c = uHorizon * 0.96;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

/** Ground: plots, roads and green belts painted into one texture for the aerial view. */
function groundTexture(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 2048;
  const g = c.getContext('2d')!;
  const px = 2048 / size;
  const r = rng(11);
  g.fillStyle = '#8b8a7a'; // dusty open ground
  g.fillRect(0, 0, 2048, 2048);
  // grass patches
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${86 + r() * 30},${112 + r() * 25},${70 + r() * 15},${0.25 + r() * 0.35})`;
    g.beginPath();
    g.ellipse(r() * 2048, r() * 2048, 20 + r() * 90, 20 + r() * 70, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // plots: paved concrete
  for (let i = 0; i < 70; i++) {
    const w = (30 + r() * 50) * px;
    const h = (30 + r() * 50) * px;
    const v = 150 + r() * 25;
    g.fillStyle = `rgb(${v},${v - 2},${v - 8})`;
    g.fillRect(r() * 2048 - w / 2, r() * 2048 - h / 2, w, h);
  }
  // road grid
  g.fillStyle = '#5d5e5c';
  const road = (x: number, y: number, w: number, h: number) => g.fillRect((x + size / 2) * px, (y + size / 2) * px, w * px, h * px);
  for (const x of [-120, -60, 0, 60, 130]) road(x - 3.5 + 30, -size / 2, 7, size);
  for (const z of [-110, -50, 30, 90]) road(-size / 2, z - 3.5, size, 7);
  // central pad under the scrubber
  g.fillStyle = '#c4c1b6';
  g.fillRect((-14 + size / 2) * px, (-12 + size / 2) * px, 40 * px, 26 * px);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Soft round particle sprites: rising, drifting plumes, all positioned in the vertex shader. */
function createPlumes(sources: { at: THREE.Vector3; n: number; rate: number; rise: number; spread: number; size: number; clean: boolean }[]) {
  const total = sources.reduce((s, x) => s + x.n, 0);
  const src = new Float32Array(total * 3);
  const prm = new Float32Array(total * 4);
  const seed = new Float32Array(total);
  let i = 0;
  const r = rng(5);
  for (const s of sources)
    for (let k = 0; k < s.n; k++, i++) {
      src.set([s.at.x, s.at.y, s.at.z], i * 3);
      prm.set([s.rate, s.rise, s.spread * s.size, s.clean ? 1 : 0], i * 4);
      seed[i] = r();
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(src, 3));
  geo.setAttribute('aPrm', new THREE.BufferAttribute(prm, 4));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = {
    uTime: { value: 0 },
    uClean: { value: 0 },
    uWind: { value: new THREE.Vector3(1, 0, 0.35) },
    uScale: { value: 400 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute vec4 aPrm; attribute float aSeed;
      uniform float uTime, uClean, uScale; uniform vec3 uWind;
      varying float vA; varying float vAge; varying float vClean;
      float h(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float rate = aPrm.x, rise = aPrm.y, spread = aPrm.z; vClean = aPrm.w;
        float age = fract(uTime * rate + aSeed);
        vAge = age;
        vec3 j = vec3(h(aSeed * 91.0) - 0.5, h(aSeed * 37.0) - 0.5, h(aSeed * 13.0) - 0.5);
        vec3 p = position + vec3(0.0, rise * pow(age, 0.6), 0.0) + uWind * rise * 1.4 * age * age + j * spread * (0.4 + age * 2.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = spread * (0.8 + 3.2 * age);
        gl_PointSize = size * uScale / -mv.z;
        vA = smoothstep(0.0, 0.08, age) * (1.0 - age) * mix(0.55, 0.55 * uClean, vClean);
      }`,
    fragmentShader: `
      varying float vA; varying float vAge; varying float vClean;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = length(q) * 2.0;
        float a = exp(-d * d * 3.0) * (1.0 - smoothstep(0.8, 1.0, d));
        vec3 dirty = mix(vec3(0.42, 0.37, 0.31), vec3(0.66, 0.62, 0.56), vAge);
        vec3 col = mix(dirty, mix(vec3(1.0), vec3(0.8, 0.84, 0.88), d), vClean);
        gl_FragColor = vec4(col, a * vA);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  return { object: points, uniforms, dispose: () => (geo.dispose(), mat.dispose()) };
}

/** Brightness of the baked ground, drawn unlit, to sit with the lit buildings. */
const GROUND_GAIN = 0.92;

/** The average colour round the edge of the baked ground, for the plain ground beyond it. */
function edgeColour(tex: THREE.Texture | null) {
  const c = new THREE.Color('#8b8a7a');
  const img = tex?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!img?.width) return c;
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const g = cv.getContext('2d')!;
    g.drawImage(img, 0, 0, img.width, img.height, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    let r = 0, gr = 0, b = 0, n = 0;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (x > 0 && x < 15 && y > 0 && y < 15) continue; // edge pixels only
        const i = (y * 16 + x) * 4;
        r += d[i];
        gr += d[i + 1];
        b += d[i + 2];
        n++;
      }
    c.setRGB(r / n / 255, gr / n / 255, b / n / 255, THREE.SRGBColorSpace).multiplyScalar(GROUND_GAIN);
  } catch {
    // keep the default
  }
  return c;
}

export function createPlant(renderer: THREE.WebGLRenderer, small: boolean) {
  const scene = new THREE.Scene();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // ---- Light and air ----
  const sunDir = new THREE.Vector3(0.55, 0.62, 0.5).normalize();
  const sky = skyDome(sunDir);
  keep(sky.geometry);
  keep(sky.material as THREE.Material);
  scene.add(sky);
  scene.fog = new THREE.Fog('#cdd8de', 160, 900);
  scene.background = new THREE.Color('#d7dfe1');
  // Reflections from the same sky.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = skyDome(sunDir);
  envSky.scale.setScalar(0.05);
  envScene.add(envSky);
  const env = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  pmrem.dispose();
  envSky.geometry.dispose();
  (envSky.material as THREE.Material).dispose();
  keep(env);
  scene.environment = env;
  scene.environmentIntensity = 0.45;

  const sun = new THREE.DirectionalLight('#fff0d8', 3.6);
  sun.position.copy(sunDir).multiplyScalar(80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -45;
  sc.right = 45;
  sc.top = 45;
  sc.bottom = -45;
  sc.near = 10;
  sc.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#bcd3ea', '#6f6a5c', 0.55));

  // ---- Ground ----
  // The estate (ground, buildings, tanks, rack, chimneys) is modelled in Blender
  // (scripts/blender/estate.py → public/models/estate.glb). Until it loads, or if
  // it can't, this procedural stand-in shows; it all lives in one group so it
  // can be swapped out in one go.
  const estate = new THREE.Group();
  scene.add(estate);
  const G = 900;
  const groundMat = keep(new THREE.MeshStandardMaterial({ map: keep(groundTexture(G)), roughness: 0.95 }));
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(G, G)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  estate.add(ground);

  // ---- Materials ----
  const frp = keep(new THREE.MeshPhysicalMaterial({ color: '#1d7a4c', roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.12 }));
  const frpPale = keep(new THREE.MeshPhysicalMaterial({ color: '#d9ddd2', roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.2 }));
  const galv = keep(new THREE.MeshStandardMaterial({ color: '#a7adb2', metalness: 0.8, roughness: 0.4 }));
  const yellow = keep(new THREE.MeshStandardMaterial({ color: '#d9a722', roughness: 0.55, metalness: 0.2 }));
  const concrete = keep(new THREE.MeshStandardMaterial({ color: '#bdb9ae', roughness: 0.9 }));
  const gls = keep(new THREE.MeshPhysicalMaterial({ color: '#2a5f8f', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 }));
  const brick = keep(new THREE.MeshStandardMaterial({ color: '#8a5544', roughness: 0.85 }));
  const steelGrey = keep(new THREE.MeshStandardMaterial({ color: '#7d8287', roughness: 0.6, metalness: 0.4 }));

  let into: THREE.Object3D = scene; // where add() and ring() put things by default
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = into) => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /** A flange ring on a vertical axis (y), centred at height y. */
  const ring = (rIn: number, rOut: number, t: number, y: number, mat: THREE.Material = frp, parent: THREE.Object3D = into) => {
    const sh = [new THREE.Vector2(rIn, -t / 2), new THREE.Vector2(rOut, -t / 2), new THREE.Vector2(rOut, t / 2), new THREE.Vector2(rIn, t / 2), new THREE.Vector2(rIn, -t / 2)];
    return add(new THREE.LatheGeometry(sh, 72), mat, 0, y, 0, parent);
  };

  // ---- The scrubber ----
  // Modelled in Blender with baked ambient occlusion (scripts/blender/scrubber.py →
  // public/models/scrubber.glb). The plant is built during curing, so the model
  // has plenty of time to arrive; until it does (or if it can't), this
  // procedural stand-in shows instead.
  const tower = new THREE.Group();
  scene.add(tower);
  add(new THREE.CylinderGeometry(3.2, 3.3, 0.4, 48), concrete, 0, 0.2, 0, tower); // plinth
  add(new THREE.CylinderGeometry(2.35, 2.35, 1.6, 64), frp, 0, 1.2, 0, tower); // sump
  add(new THREE.CylinderGeometry(TOWER_R, TOWER_R, 9.4, 64), frp, 0, 6.7, 0, tower); // body
  for (const y of [2.0, 5.1, 8.2, 11.4]) ring(TOWER_R - 0.05, TOWER_R + 0.22, 0.16, y, frp, tower);
  // top head: a cone from the body down to the stack's diameter, then the seat flange
  add(new THREE.CylinderGeometry(SPOOL.r * 1.02, TOWER_R, 0.9, 64), frp, 0, 11.85, 0, tower);
  ring(SPOOL.r - 0.04, SPOOL.flange, 0.14, SEAT_Y - 0.07, frp, tower);
  // platform round the top, with a railing
  const deck = ring(TOWER_R, TOWER_R + 1.1, 0.08, 11.0, galv, tower);
  deck.castShadow = false;
  for (const [y, tube] of [[12.1, 0.035], [11.55, 0.025]] as const) {
    const rail = add(new THREE.TorusGeometry(TOWER_R + 1.05, tube, 8, 96), yellow, 0, y, 0, tower);
    rail.rotation.x = Math.PI / 2;
  }
  {
    const posts = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6)), yellow, 28);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      posts.setMatrixAt(i, m.makeTranslation(Math.cos(a) * (TOWER_R + 1.05), 11.6, Math.sin(a) * (TOWER_R + 1.05)));
    }
    posts.castShadow = true;
    tower.add(posts);
  }
  // caged ladder up the side facing the camera's approach
  {
    const lx = Math.cos(0.9) * (TOWER_R + 0.45);
    const lz = Math.sin(0.9) * (TOWER_R + 0.45);
    const ladder = new THREE.Group();
    ladder.position.set(lx, 0, lz);
    ladder.rotation.y = -0.9;
    tower.add(ladder);
    for (const s of [-0.22, 0.22]) add(new THREE.CylinderGeometry(0.025, 0.025, 11, 6), galv, 0, 5.9, s, ladder);
    const hoops = new THREE.InstancedMesh(keep(new THREE.TorusGeometry(0.38, 0.02, 6, 24, Math.PI)), galv, 14);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, -Math.PI / 2));
    for (let i = 0; i < 14; i++) hoops.setMatrixAt(i, m.compose(new THREE.Vector3(0.05, 3 + i * 0.6, 0), q, new THREE.Vector3(1, 1, 1)));
    ladder.add(hoops);
  }
  // recirculation: pump at the base, pipe up to the spray header's nozzle
  add(new RoundedBoxGeometry(1.0, 0.7, 0.7, 2, 0.08), steelGrey, -3.4, 0.75, 1.2, tower);
  {
    const path = new THREE.CurvePath<THREE.Vector3>();
    const pts = [new THREE.Vector3(-3.4, 0.85, 1.2), new THREE.Vector3(-3.4, 8.6, 1.2), new THREE.Vector3(-2.19, 8.6, 1.215)];
    path.add(new THREE.LineCurve3(pts[0], pts[1]));
    path.add(new THREE.LineCurve3(pts[1], pts[2]));
    add(new THREE.TubeGeometry(path, 40, 0.14, 12), frpPale);
  }
  new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}models/scrubber.glb`)
    .then((gltf) => {
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = m.receiveShadow = true;
        keep(m.geometry);
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => keep(mt));
      });
      scene.add(gltf.scene);
      scene.remove(tower);
    })
    .catch(() => {}); // keep the stand-in

  // ---- Ducting: from the process building to the scrubber's inlet, via a fan ----
  const bx = 16;
  add(new THREE.BoxGeometry(11, 9, 14), concrete, bx + 3, 4.5, 3, estate); // process building
  add(new THREE.BoxGeometry(11.4, 0.4, 14.4), steelGrey, bx + 3, 9.2, 3, estate); // roof edge
  {
    const ductR = 0.75;
    const path = new THREE.CurvePath<THREE.Vector3>();
    const P = [
      new THREE.Vector3(bx - 2.5, 6.4, 1.5),
      new THREE.Vector3(5.6, 6.4, 1.5),
      new THREE.Vector3(5.6, 2.6, 1.5),
      new THREE.Vector3(2.8, 2.6, 0.75), // the inlet nozzle's flange
    ];
    const bend = 1.0;
    const towards = (a: THREE.Vector3, b: THREE.Vector3, d: number) => a.clone().add(b.clone().sub(a).setLength(d));
    path.add(new THREE.LineCurve3(P[0], towards(P[1], P[0], bend)));
    path.add(new THREE.QuadraticBezierCurve3(towards(P[1], P[0], bend), P[1], towards(P[1], P[2], bend)));
    path.add(new THREE.LineCurve3(towards(P[1], P[2], bend), towards(P[2], P[1], bend)));
    path.add(new THREE.QuadraticBezierCurve3(towards(P[2], P[1], bend), P[2], towards(P[2], P[3], bend)));
    path.add(new THREE.LineCurve3(towards(P[2], P[3], bend), P[3]));
    add(new THREE.TubeGeometry(path, 160, ductR, 32), frp);
    // flanged joints along the run
    for (const x of [8.5, 11.5]) {
      const f = ring(ductR - 0.02, ductR + 0.14, 0.12, 0, frp);
      f.rotation.z = Math.PI / 2;
      f.position.set(x, 6.4, 1.5);
    }
    // supports under the horizontal run
    for (const x of [7.5, 10.5]) add(new THREE.BoxGeometry(0.2, 5.6, 0.2), galv, x, 2.8, 1.5);
    // fan at the foot of the riser
    add(new RoundedBoxGeometry(1.5, 1.4, 1.6, 2, 0.1), steelGrey, 7.2, 0.9, 1.5);
  }

  // ---- The section: lowered onto the seat as the scrubber's stack ----
  const section = new THREE.Group();
  scene.add(section);
  {
    const lu = laminateUniforms();
    lu.uProgress.value = PASSES;
    lu.uVeil.value = 1;
    lu.uCure.value = 1;
    lu.uCoat.value = 1;
    const shell = add(new THREE.LatheGeometry(spoolProfile(), 128), keep(laminateMaterial(lu)), 0, 0, 0, section);
    shell.scale.set(1.04, 1, 1.04);
    const liner = add(new THREE.CylinderGeometry(SPOOL.r * 0.97, SPOOL.r * 0.97, SPOOL.half * 2, 64, 1, true), keep(new THREE.MeshStandardMaterial({ color: '#cfe3d4', roughness: 0.5, side: THREE.BackSide })), 0, 0, 0, section);
    liner.castShadow = false;
    for (const s of [-1, 1]) ring(SPOOL.r - 0.04, SPOOL.flange, 0.14, s * (SPOOL.half - 0.02), frp, section);
    // rain cap ring at the top
    ring(SPOOL.r * 1.02, SPOOL.r * 1.12, 0.06, SPOOL.half + 0.06, frp, section);
  }
  // bolts round the seat, added once it's down
  const bolts = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 6)), galv, 20);
  {
    const m = new THREE.Matrix4();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const r = (SPOOL.r + SPOOL.flange) / 2 + 0.03;
      bolts.setMatrixAt(i, m.makeTranslation(Math.cos(a) * r, SEAT_Y, Math.sin(a) * r));
    }
    bolts.castShadow = true;
    scene.add(bolts);
  }
  // crane hook and rope, coming down from above the frame
  const hook = new THREE.Group();
  scene.add(hook);
  add(new RoundedBoxGeometry(0.5, 0.6, 0.36, 2, 0.06), yellow, 0, 0.3, 0, hook);
  add(new THREE.CylinderGeometry(0.03, 0.03, 60, 6), steelGrey, 0, 30.6, 0, hook);
  for (const s of [-1, 1]) {
    // slings from the hook to the top flange
    const sling = add(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 6), steelGrey, s * 0.45, -0.85, 0, hook);
    sling.rotation.z = s * 0.5;
  }

  // ---- The estate (procedural stand-in) ----
  into = estate;
  const r = rng(21);
  // Buildings: plain sheds and blocks, pale walls with metal roofs.
  {
    const spots: [number, number, number, number, number][] = [];
    const keepOut = (x: number, z: number, w: number, d: number) =>
      Math.abs(x) < 20 + w / 2 && Math.abs(z) < 16 + d / 2 ? true : // the scrubber's yard
      Math.abs(x + 34) < 20 + w / 2 && Math.abs(z + 12) < 14 + d / 2 ? true : // tank farm
      Math.abs(x - 26) < 14 + w / 2 && Math.abs(z + 34) < 14 + d / 2 ? true : // GLS tanks
      Math.abs(z - 14) < 3 + d / 2 && x > -24 && x < 80; // pipe rack
    for (let i = 0; i < 260 && spots.length < (small ? 70 : 120); i++) {
      const x = (r() - 0.5) * 360;
      const z = (r() - 0.5) * 320 - 30;
      const w = 8 + r() * 26;
      const d = 8 + r() * 22;
      const h = 4 + r() * r() * 14;
      if (keepOut(x, z, w, d)) continue;
      spots.push([x, z, w, d, h]);
    }
    const walls = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), keep(new THREE.MeshStandardMaterial({ roughness: 0.85 })), spots.length);
    const roofs = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), keep(new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 })), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const wallCols = ['#b9b4a6', '#a9aca6', '#c4bfb1', '#9a9f9a', '#b5aa93'];
    const roofCols = ['#6e7b84', '#53697a', '#858b89', '#47677a', '#8f8878'];
    spots.forEach(([x, z, w, d, h], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.08);
      walls.setMatrixAt(i, m.compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3(w, h, d)));
      roofs.setMatrixAt(i, m.compose(new THREE.Vector3(x, h + 0.15, z), q, new THREE.Vector3(w + 0.4, 0.3, d + 0.4)));
      walls.setColorAt(i, c.set(wallCols[Math.floor(r() * wallCols.length)]));
      roofs.setColorAt(i, c.set(roofCols[Math.floor(r() * roofCols.length)]));
    });
    walls.castShadow = walls.receiveShadow = roofs.castShadow = roofs.receiveShadow = true;
    estate.add(walls, roofs);
  }
  // Trees along the roads: a green belt.
  {
    const n = small ? 220 : 420;
    const trees = new THREE.InstancedMesh(keep(new THREE.IcosahedronGeometry(1, 1)), keep(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true })), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const roadsX = [-90, -30, 30, 90, 160];
    const roadsZ = [-110, -50, 30, 90];
    for (let i = 0; i < n; i++) {
      const alongX = r() < 0.5;
      const lane = alongX ? roadsZ[Math.floor(r() * roadsZ.length)] : roadsX[Math.floor(r() * roadsX.length)];
      const t = (r() - 0.5) * 440;
      const off = (r() < 0.5 ? -1 : 1) * (6 + r() * 3);
      const x = alongX ? t : lane + off;
      const z = alongX ? lane + off : t;
      if (Math.abs(x) < 22 && Math.abs(z) < 18) continue;
      const s = 1.6 + r() * 1.8;
      trees.setMatrixAt(i, m.compose(new THREE.Vector3(x, s * 0.9, z), q, new THREE.Vector3(s, s * 1.15, s)));
      trees.setColorAt(i, c.setHSL(0.26 + r() * 0.06, 0.35 + r() * 0.15, 0.24 + r() * 0.1));
    }
    trees.castShadow = true;
    estate.add(trees);
  }
  // Tank farm: FRP chemical storage tanks in a bund.
  const tankFarm = new THREE.Vector3(-34, 0, -12);
  {
    const bund = new THREE.Group();
    bund.position.copy(tankFarm);
    estate.add(bund);
    add(new THREE.BoxGeometry(34, 0.3, 22), concrete, 0, 0.15, 0, bund);
    for (const [w, d, x, z] of [[34, 0.4, 0, -11], [34, 0.4, 0, 11], [0.4, 22, -17, 0], [0.4, 22, 17, 0]] as const)
      add(new THREE.BoxGeometry(w, 1.2, d), concrete, x, 0.6, z, bund);
    const tank = keep(new THREE.CylinderGeometry(2.4, 2.4, 7, 40));
    const roof = keep(new THREE.ConeGeometry(2.45, 0.7, 40));
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 2; j++) {
        const mat = (i + j) % 3 === 0 ? frpPale : frp;
        const x = -11.5 + i * 7.6;
        const z = -4.5 + j * 9;
        add(tank, mat, x, 3.8, z, bund);
        add(roof, mat, x, 7.65, z, bund);
        ring(2.38, 2.6, 0.12, 0.6, mat, bund).position.set(x, 0.6, z);
      }
  }
  // Glass-fused-to-steel tanks for water and effluent: wide, squat, bolted panels in rings.
  const glsAt = new THREE.Vector3(26, 0, -34);
  for (const [dx, dz, R, H] of [[-7, 0, 7, 7.2], [9, 3, 5, 6]] as const) {
    const x = glsAt.x + dx;
    const z = glsAt.z + dz;
    add(new THREE.CylinderGeometry(R, R, H, 64), gls, x, H / 2, z);
    for (let k = 1; k < 4; k++) ring(R, R + 0.06, 0.1, (H / 4) * k, galv).position.set(x, (H / 4) * k, z);
    add(new THREE.ConeGeometry(R + 0.1, 1.2, 64), galv, x, H + 0.6, z);
  }
  // Pipe rack along the road: portal frames carrying a run of FRP pipes.
  const rack = new THREE.Vector3(26, 0, 14);
  {
    const L = 100;
    const x0 = rack.x - L / 2;
    for (let x = x0; x <= x0 + L; x += 7) {
      for (const dz of [-1.4, 1.4]) add(new THREE.BoxGeometry(0.3, 5.2, 0.3), steelGrey, x, 2.6, rack.z + dz);
      add(new THREE.BoxGeometry(0.3, 0.3, 3.4), steelGrey, x, 5.2, rack.z);
    }
    for (const [dz, pr, mat] of [[-1.0, 0.32, frp], [-0.25, 0.26, frpPale], [0.45, 0.36, frp], [1.1, 0.2, galv]] as const) {
      const pipe = add(new THREE.CylinderGeometry(pr, pr, L, 16), mat, rack.x, 5.35 + pr, rack.z + dz);
      pipe.rotation.z = Math.PI / 2;
    }
  }
  // Neighbours' chimneys: no scrubbers.
  const chimneys: THREE.Vector3[] = [];
  for (const [x, z, h, rad] of [[58, -22, 30, 1.3], [-62, 30, 26, 1.1], [80, 40, 22, 1.0], [-20, -70, 34, 1.5]] as const) {
    add(new THREE.CylinderGeometry(rad * 0.8, rad, h, 24), brick, x, h / 2, z);
    for (let k = 0; k < 2; k++) ring(rad * 0.8, rad * 0.92, 0.5, h - 1 - k * 1.4, k ? steelGrey : brick).position.set(x, h - 1 - k * 1.4, z);
    chimneys.push(new THREE.Vector3(x, h, z));
  }
  into = scene;

  // ---- The estate from Blender, and its trees ----
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  Promise.all([loader.loadAsync(`${base}models/estate.glb`), fetch(`${base}models/estate-trees.json`).then((r) => r.json() as Promise<{ trees: number[][] }>)])
    .then(([gltf, { trees }]) => {
      let groundTex: THREE.Texture | null = null;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        keep(m.geometry);
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.map) {
          // the ground: its texture is already lit (baked with the sun), so draw it unlit
          groundTex = mat.map;
          m.material = keep(new THREE.MeshBasicMaterial({ map: mat.map, color: new THREE.Color(GROUND_GAIN, GROUND_GAIN, GROUND_GAIN) }));
          keep(mat.map);
          mat.dispose();
          return;
        }
        keep(mat);
        m.castShadow = m.receiveShadow = true;
      });
      // beyond the baked square: plain ground in the colour of its edge
      const outer = new THREE.Mesh(keep(new THREE.PlaneGeometry(2400, 2400)), keep(new THREE.MeshBasicMaterial({ color: edgeColour(groundTex) })));
      outer.rotation.x = -Math.PI / 2;
      outer.position.y = -0.05;
      // trees: instanced clusters of a few low-poly crowns
      const crown = (r: number, x: number, y: number, z: number) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z);
      const parts = small ? [crown(1, 0, 0.95, 0)] : [crown(1, 0, 1.0, 0), crown(0.7, 0.6, 0.75, 0.25), crown(0.62, -0.45, 0.8, -0.4)];
      const treeGeo = keep(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))));
      parts.forEach((g) => g.dispose());
      const list = small ? trees.filter((_, i) => i % 2 === 0) : trees;
      const inst = new THREE.InstancedMesh(treeGeo, keep(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true })), list.length);
      const mtx = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const c = new THREE.Color();
      list.forEach(([x, z, sc, h], i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h * 6.28);
        inst.setMatrixAt(i, mtx.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(sc * 0.85, sc * 0.95, sc * 0.85)));
        inst.setColorAt(i, c.setHSL(0.24 + h * 0.07, 0.32 + h * 0.15, 0.22 + h * 0.09));
      });
      scene.remove(estate);
      scene.add(gltf.scene, outer, inst);
    })
    .catch(() => {}); // keep the stand-in

  // ---- Plumes ----
  const plumes = createPlumes([
    ...chimneys.map((at) => ({ at, n: small ? 60 : 110, rate: 0.06, rise: 26, spread: 2.6, size: 1, clean: false })),
    { at: new THREE.Vector3(0, SEAT_Y + SPOOL.half * 2 + 0.3, 0), n: small ? 50 : 90, rate: 0.1, rise: 12, spread: 0.9, size: 1, clean: true },
  ]);
  keep(plumes);
  scene.add(plumes.object);

  // ---- Pins: points the HTML labels track ----
  const pins: { id: PinId; at: THREE.Vector3 }[] = [
    { id: 'scrubber', at: new THREE.Vector3(0, SEAT_Y + SPOOL.half * 2 + 1.2, 0) },
    { id: 'plume', at: new THREE.Vector3(2.5, SEAT_Y + SPOOL.half * 2 + 6, 0.8) },
    { id: 'duct', at: new THREE.Vector3(9.5, 7.6, 1.5) },
    { id: 'tanks', at: tankFarm.clone().setY(10) },
    { id: 'piping', at: new THREE.Vector3(rack.x + 22, 7.5, rack.z) },
    { id: 'gls', at: glsAt.clone().add(new THREE.Vector3(-7, 9.5, 0)) },
  ];

  /** Where the hook carries the section from: high above the seat. */
  const HANG = 12;
  const seatedY = SEAT_Y + SPOOL.half;
  return {
    scene,
    pins,
    seatedY,
    sectionTop: () => section.position.y + SPOOL.half,
    /**
     * seat: 0 hanging high → 1 down on the flange.
     * fix: 0–1 bolts in and the hook released.
     * on: 0–1 the system running (our plume).
     */
    update(t: number, seat: number, fix: number, on: number) {
      const s = smooth(clamp01(seat));
      // a slight sway while it hangs, damped out as it lands
      const sway = (1 - s) * 0.12;
      section.position.set(Math.sin(t * 0.7) * sway, seatedY + HANG * (1 - s), Math.cos(t * 0.53) * sway * 0.6);
      section.rotation.set(Math.sin(t * 0.5) * sway * 0.15, (1 - s) * 0.6, 0);
      const rel = smooth(clamp01((fix - 0.4) / 0.6));
      hook.position.set(section.position.x, section.position.y + SPOOL.half + 1.6 + rel * 30, section.position.z);
      hook.visible = rel < 0.98;
      bolts.visible = fix > 0.05;
      bolts.position.y = 0.4 * (1 - smooth(clamp01(fix / 0.5))); // dropped into their holes
      plumes.uniforms.uTime.value = t;
      plumes.uniforms.uClean.value = smooth(clamp01(on));
    },
    resize(hPx: number, fovDeg: number) {
      plumes.uniforms.uScale.value = hPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
