/**
 * Still renders of equipment and material close-ups, in the same studio look
 * as the hero. Used by the dev-only /dev/render page to produce the images in
 * public/renders/. These are labelled illustrations, not project photos.
 */
import * as THREE from 'three';
import { PASSES, floor, laminateMaterial, laminateUniforms, studio, studioEnvironment, vesselProfile } from './three/vessel';
import { buildSection } from './three/section';
import { materials } from '../content/materials';

export type Shot = {
  name: string;
  build(scene: THREE.Scene): void;
  cam: [number, number, number];
  look: [number, number, number];
  fov?: number;
  /** Flat background (with a shadow-only ground) instead of the dark studio floor. */
  bg?: string;
};

const enamel = () => new THREE.MeshPhysicalMaterial({ color: '#1f4656', roughness: 0.32, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.35 });
const stainless = (rough = 0.3) => new THREE.MeshStandardMaterial({ color: '#c4c8cc', metalness: 0.9, roughness: Math.max(rough, 0.3) });
const blackSteel = () => new THREE.MeshStandardMaterial({ color: '#1a1a1a', metalness: 0.5, roughness: 0.5 });
const concrete = () => new THREE.MeshStandardMaterial({ color: '#3a3836', roughness: 0.9 });

function curedLaminate(scaleBand = 1) {
  const u = laminateUniforms();
  u.uProgress.value = PASSES;
  u.uVeil.value = 1;
  u.uCure.value = 1;
  u.uBand.value *= scaleBand;
  u.uCured.value.set('#1f7d4f');
  u.uWet.value.set('#d4ecd9');
  return laminateMaterial(u);
}

const shadowed = <T extends THREE.Object3D>(o: T) => {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) c.castShadow = c.receiveShadow = true;
  });
  return o;
};

function nozzle(r: number, len: number, m: THREE.Material) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 32), m));
  const fl = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.7, r * 1.7, len * 0.12, 32), m);
  fl.position.y = len / 2;
  g.add(fl);
  return g;
}

/** Vertical FRP process tank: flat base, conical roof, nozzles. */
function frpTank(scene: THREE.Scene) {
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(1.3, 0), new THREE.Vector2(1.3, 0.06)];
  for (let i = 1; i <= 40; i++) pts.push(new THREE.Vector2(1.3, 0.06 + (i / 40) * 3.6));
  pts.push(new THREE.Vector2(1.05, 3.92), new THREE.Vector2(0.25, 4.25), new THREE.Vector2(0.001, 4.28));
  const lam = curedLaminate(1.2);
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 128), lam);
  scene.add(shadowed(body));
  const n1 = nozzle(0.16, 0.6, lam);
  n1.position.set(0, 4.3, 0);
  scene.add(shadowed(n1));
  const n2 = nozzle(0.12, 0.5, lam);
  n2.rotation.z = Math.PI / 2;
  n2.position.set(1.45, 0.6, 0.2);
  scene.add(shadowed(n2));
  const n3 = nozzle(0.1, 0.45, lam);
  n3.rotation.x = Math.PI / 2;
  n3.position.set(-0.3, 2.6, 1.42);
  scene.add(shadowed(n3));
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.75, 0.18, 64), concrete());
  pad.position.y = -0.09;
  scene.add(shadowed(pad));
}

/** FRP pipe spool: straight runs, an elbow, flanges. */
function frpPipe(scene: THREE.Scene) {
  const lam = curedLaminate(0.6);
  const path = new THREE.CurvePath<THREE.Vector3>();
  path.add(new THREE.LineCurve3(new THREE.Vector3(-3.4, 0.55, 0), new THREE.Vector3(-0.6, 0.55, 0)));
  path.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.6, 0.55, 0), new THREE.Vector3(0.6, 0.55, 0), new THREE.Vector3(0.6, 1.75, 0)));
  path.add(new THREE.LineCurve3(new THREE.Vector3(0.6, 1.75, 0), new THREE.Vector3(0.6, 3.4, 0)));
  const tube = new THREE.Mesh(new THREE.TubeGeometry(path, 200, 0.42, 64), lam);
  scene.add(shadowed(tube));
  const fl = (x: number, y: number, rotZ: number) => {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.12, 48), lam);
    f.rotation.z = rotZ;
    f.position.set(x, y, 0);
    scene.add(shadowed(f));
  };
  fl(-3.4, 0.55, Math.PI / 2);
  fl(-0.6, 0.55, Math.PI / 2);
  fl(0.6, 3.4, 0);
  const sup = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.9), blackSteel());
  sup.position.set(-2.2, 0.06, 0);
  scene.add(shadowed(sup));
}

/** Horizontal FRP vessel on saddles. */
function frpVessel(scene: THREE.Scene) {
  const lathe = new THREE.LatheGeometry(vesselProfile(1, 2, 0.5, 0.001), 128);
  lathe.rotateZ(-Math.PI / 2);
  const lam = curedLaminate();
  const v = new THREE.Mesh(lathe, lam);
  v.position.y = 1.35;
  scene.add(shadowed(v));
  for (const x of [-1.4, 1.4]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 1.7), blackSteel());
    s.position.set(x, 0.3, 0);
    scene.add(shadowed(s));
  }
  const n = nozzle(0.14, 0.5, lam);
  n.position.set(0.6, 2.4, 0);
  scene.add(shadowed(n));
  const m = nozzle(0.3, 0.3, lam);
  m.position.set(-0.9, 2.3, 0);
  scene.add(shadowed(m));
}

/** Bolted glass-fused-to-steel tank: rings of curved panels, bolt lines, roof. */
function glsTank(scene: THREE.Scene, rings = 4, perRing = 10) {
  const R = 2.2;
  const H = 0.85;
  const mat = enamel();
  const gap = 0.006;
  const boltGeo = new THREE.SphereGeometry(0.022, 10, 8);
  const bolts: THREE.Matrix4[] = [];
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < perRing; i++) {
      const t0 = (i / perRing) * Math.PI * 2 + (r % 2) * (Math.PI / perRing) + gap;
      const len = (Math.PI * 2) / perRing - gap * 2;
      const panel = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H - 0.012, 24, 1, true, t0, len), mat);
      panel.position.y = r * H + H / 2 + 0.2;
      scene.add(shadowed(panel));
      const seam = t0 - gap;
      for (let k = 1; k < 8; k++) {
        const y = r * H + 0.2 + (k / 8) * H;
        bolts.push(new THREE.Matrix4().makeTranslation(Math.sin(seam) * (R + 0.01), y, Math.cos(seam) * (R + 0.01)));
      }
    }
    for (let k = 0; k < perRing * 8; k++) {
      const a = (k / (perRing * 8)) * Math.PI * 2;
      bolts.push(new THREE.Matrix4().makeTranslation(Math.sin(a) * (R + 0.01), r * H + 0.2, Math.cos(a) * (R + 0.01)));
    }
  }
  const inst = new THREE.InstancedMesh(boltGeo, stainless(0.3), bolts.length);
  bolts.forEach((m, i) => inst.setMatrixAt(i, m));
  scene.add(inst);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(R + 0.06, 0.55, 64, 1, true), new THREE.MeshStandardMaterial({ color: '#8f9498', metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide }));
  roof.position.y = rings * H + 0.2 + 0.275;
  scene.add(shadowed(roof));
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.35, 0.2, 64), concrete());
  base.position.y = 0.1;
  scene.add(shadowed(base));
}

/** Stainless process vessel: dished heads, legs, manway, nozzles. */
function ssVessel(scene: THREE.Scene) {
  const pts = vesselProfile(1, 1.4, 0.32, 0.001);
  const shell = new THREE.Mesh(new THREE.LatheGeometry(pts, 128), stainless());
  shell.position.y = 2.6;
  scene.add(shadowed(shell));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 20), stainless(0.25));
    leg.position.set(Math.sin(a) * 0.85, 0.8, Math.cos(a) * 0.85);
    scene.add(shadowed(leg));
  }
  const man = nozzle(0.24, 0.3, stainless());
  man.position.set(0.3, 4.4, 0);
  scene.add(shadowed(man));
  const n = nozzle(0.08, 0.5, stainless());
  n.rotation.z = Math.PI / 2;
  n.position.set(1.15, 2.2, 0);
  scene.add(shadowed(n));
  const weld = new THREE.Mesh(new THREE.TorusGeometry(1.002, 0.008, 8, 128), stainless(0.45));
  weld.rotation.x = Math.PI / 2;
  weld.position.y = 2.6;
  scene.add(weld);
}

/** Close-up: weld seam on a polished stainless shell. */
function ssMacro(scene: THREE.Scene) {
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 6, 160, 1, true), stainless(0.22));
  shell.position.y = 3;
  scene.add(shell);
  const weld = new THREE.Mesh(new THREE.TorusGeometry(3.004, 0.028, 12, 240), stainless(0.5));
  weld.rotation.x = Math.PI / 2;
  weld.position.y = 3;
  scene.add(weld);
}

/** Close-up: glass-fused panels meeting at a bolted seam. */
function glsMacro(scene: THREE.Scene) {
  glsTank(scene, 3, 6);
}

/** Close-up: cured FRP laminate surface with the winding pattern. */
function frpMacro(scene: THREE.Scene) {
  const lathe = new THREE.LatheGeometry(vesselProfile(1, 2, 0.5, 0.2), 160);
  lathe.rotateZ(-Math.PI / 2);
  const m = curedLaminate();
  const v = new THREE.Mesh(lathe, m);
  v.position.y = 1.2;
  v.rotation.x = 0.6;
  v.rotation.y = -0.35;
  scene.add(shadowed(v));
}

/** Wall cutaway for a material, framed like the live diagram (slightly exploded). */
function sectionShot(slug: string): Shot {
  return {
    name: `${slug}-section`,
    bg: '#d8d1c3',
    fov: 28,
    cam: [0, 0, 0],
    look: [0, 0, 0],
    build(scene) {
      const m = materials.find((x) => x.slug === slug)!;
      const sec = buildSection(m.layers);
      sec.set({ selected: -1, exploded: true });
      for (let i = 0; i < 120; i++) sec.update(0.05);
      scene.add(sec.group);
      const look = sec.centre.clone().add(new THREE.Vector3(0, 0, 0.35));
      const pos = look.clone().add(new THREE.Vector3(0.55, 0.5, 0.68).normalize().multiplyScalar((sec.radius * 1.08) / Math.sin(THREE.MathUtils.degToRad(14))));
      scene.userData.fit = { pos, look };
    },
  };
}

export const SHOTS: Shot[] = [
  { name: 'frp-tank', build: frpTank, cam: [4.3, 2.7, 6.1], look: [0, 2.0, 0] },
  { name: 'frp-pipe', build: frpPipe, cam: [2.6, 2.3, 5.7], look: [-1.0, 1.6, 0] },
  { name: 'frp-vessel', build: frpVessel, cam: [3.8, 2.1, 5.3], look: [0, 1.3, 0] },
  { name: 'gls-tank', build: (s) => glsTank(s), cam: [5.5, 2.4, 6.4], look: [0, 1.8, 0] },
  { name: 'ss-vessel', build: ssVessel, cam: [3.3, 2.7, 5.1], look: [0, 2.4, 0] },
  { name: 'frp-macro', build: frpMacro, cam: [3.6, 1.9, 2.4], look: [1.2, 1.2, 0], fov: 34 },
  { name: 'gls-macro', build: glsMacro, cam: [1.25, 1.35, 2.6], look: [0.1, 1.05, 2.05], fov: 34 },
  sectionShot('frp'),
  sectionShot('gls'),
  sectionShot('ss'),
  { name: 'ss-macro', build: ssMacro, cam: [2.4, 3.5, 5.2], look: [0, 3.0, 2.4], fov: 30 },
];

/** Render one shot into the canvas at its current size. */
export function renderShot(canvas: HTMLCanvasElement, shot: Shot) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  const scene = new THREE.Scene();
  studio(renderer, scene);
  scene.fog = new THREE.Fog('#0d0d0d', 12, 28);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.92;
  const envTex = studioEnvironment(renderer);
  scene.environment = envTex;
  scene.environmentIntensity = 0.35;

  scene.add(new THREE.HemisphereLight('#d9d4cc', '#000000', 0.15));
  const key = new THREE.SpotLight('#f3f5f7', 70, 34, 0.6, 0.9, 1.1);
  key.position.set(-4, 9, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.target.position.set(...shot.look);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#ffffff', 2.6);
  rim.position.set(5, 4, -7);
  scene.add(rim);
  if (shot.bg) {
    scene.background = new THREE.Color(shot.bg);
    scene.fog = null;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.26 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    key.position.set(-1.2, 10, 6);
  } else {
    scene.add(floor(0));
  }

  shot.build(scene);
  const camera = new THREE.PerspectiveCamera(shot.fov ?? 36, canvas.width / canvas.height, 0.05, 80);
  const fit = scene.userData.fit as { pos: THREE.Vector3; look: THREE.Vector3 } | undefined;
  camera.position.copy(fit?.pos ?? new THREE.Vector3(...shot.cam));
  camera.lookAt(fit?.look ?? new THREE.Vector3(...shot.look));
  renderer.render(scene, camera);
  renderer.dispose();
  envTex.dispose();
}
