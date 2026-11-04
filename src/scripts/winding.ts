/**
 * Scroll-driven filament-winding scene for the home hero.
 *
 * The whole scene is a pure function of scroll progress `p` (0–1). Each stage
 * opens with a short camera move, then the camera holds still while the
 * process advances, so the frame never drifts under the captions. Nothing
 * renders unless progress or size changes, which leaves headroom for
 * ambient occlusion and multisampling.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { frameLoop } from './motion';
import { MOVE, STAGE_P } from './three/stages';
import { DU, PASSES, SPOOL, floor, laminateMaterial, laminateUniforms, profileAt, spoolProfile, studioEnvironment } from './three/vessel';
import { HEAD_TURN, createTow, spoolTexture } from './three/tow';
import { createBeam, createDust, createVapour } from './three/atmosphere';
import { createHeater } from './three/heater';
import { createWorkshop } from './three/workshop';
import { createPlant, type PinId } from './three/plant';

const IDLE_REVS = 0.6; // gentle mandrel turn before winding starts
const IDLE_RPS = 0.12; // slow turn of the bare mandrel while the visitor reads
const INTRO_S = 2.6; // lights-up and dolly-in on first load
const FLOOR_Y = -1.6;
const smooth = (x: number) => THREE.MathUtils.smootherstep(x, 0, 1);
const clamp01 = (x: number) => THREE.MathUtils.clamp(x, 0, 1);

type Shot = { pos: [number, number, number]; look: [number, number, number] };
// One held camera shot per stage (landscape framing).
const SHOTS: Shot[] = [
  { pos: [6.4, 2.4, 13.6], look: [0, -1.25, 0] }, // mandrel: wide, machine above the headline
  { pos: [3.8, 1.3, 7.4], look: [0.4, 0, 0] }, // veil: three-quarter, closer
  { pos: [1.4, 3.4, 9.2], look: [0, -0.35, 0.4] }, // winding: high front view of the whole traverse
  { pos: [-4.8, 1.7, 8.2], look: [0, 0, 0] }, // cure: low side, warm
  { pos: [1.6, 0.5, 13.8], look: [-0.4, 0.4, 0] }, // off the mandrel: low and wide, room above for the lift
];
// Outside (plant coordinates: the scrubber at the origin, ground at y = 0).
const AERIAL: Shot = { pos: [88, 92, 124], look: [-4, 0, -14] };
// Mid-winding close-up: low and near, on the laying point as the bands cross.
const CLOSE: Shot = { pos: [2.3, 1.15, 4.2], look: [0.1, 0.45, 0.6] };

export type Winding = {
  setProgress(p: number): void;
  /** 0 while the hero is pinned → 1 once it has scrolled fully out of view. */
  setExit(e: number): void;
  jump(p: number): void;
  dispose(): void;
};

export function createWinding(
  canvas: HTMLCanvasElement,
  opts: {
    still: boolean;
    /** Play the lights-up and dolly-in (only when the page opens at the top). */
    intro?: boolean;
    onStage(stage: number, frac: number): void;
    /** Shaders compiled and the first frame is on screen. */
    onReady?(): void;
    /** Screen positions (CSS px in the canvas) of the plant's labelled FRP, and how far they're faded in. */
    onPins?(pins: { id: PinId; x: number; y: number; front: boolean }[], on: number): void;
  },
): Winding {
  const small = Math.min(innerWidth, innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  // 1.5 at most: at 2 on a Retina laptop the composer (AO, bokeh, bloom) runs near 20 fps
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0d0d0d');
  scene.fog = new THREE.Fog('#0d0d0d', 15, 32);
  const envTex = studioEnvironment(renderer);
  scene.environment = envTex;
  scene.environmentIntensity = 0.34;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);

  // Lights: overhead key spot (shadows), cool rim, cure glow.
  const key = new THREE.SpotLight('#f3f5f7', 44, 34, 0.7, 1, 1.1);
  key.position.set(-3, 9, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#eef2f5', 2.2);
  rim.position.set(4, 3.5, -7);
  scene.add(rim);
  const cureGlow = new THREE.PointLight('#ffe6c4', 0, 10, 1.4);
  cureGlow.position.set(0, 0.6, 1.8);
  scene.add(cureGlow);
  scene.add(floor(FLOOR_Y));
  // Faint workshop grid on the floor.
  const grid = new THREE.GridHelper(40, 80, '#2c3a33', '#1d2621');
  grid.position.y = -1.595;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.3;
  scene.add(grid);

  // Vessel on its mandrel
  const pts = spoolProfile();
  const lathe = new THREE.LatheGeometry(pts, 160);
  lathe.rotateZ(-Math.PI / 2);
  const spinner = new THREE.Group();
  spinner.rotation.order = 'YZX'; // spin about the section's own axis, then stand it up, then turn it
  scene.add(spinner);
  const mandrelMat = new THREE.MeshStandardMaterial({ color: '#9ea3a8', metalness: 0.9, roughness: 0.5, transparent: true });
  const mandrel = new THREE.Mesh(lathe, mandrelMat);
  mandrel.scale.setScalar(0.985);
  mandrel.castShadow = true;
  spinner.add(mandrel);
  const uniforms = laminateUniforms();
  const lamMat = laminateMaterial(uniforms);
  const laminate = new THREE.Mesh(lathe, lamMat);
  laminate.castShadow = true;
  spinner.add(laminate);

  // The finished section: a flange at each end, the liner seen through the
  // open ends, and a lifting lug on one flange. They follow the section's lift
  // and upending but not the mandrel's spin.
  const fittings = new THREE.Group();
  fittings.rotation.order = 'YZX';
  scene.add(fittings);
  const frpMat = new THREE.MeshPhysicalMaterial({ color: '#1d7a4c', roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.22 });
  const zinc = new THREE.MeshStandardMaterial({ color: '#c3c7cb', metalness: 0.9, roughness: 0.32 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#1d1f21', metalness: 0.5, roughness: 0.5 });
  const crane = new THREE.MeshStandardMaterial({ color: '#c99a1e', roughness: 0.5, metalness: 0.25 });
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /** Stud bolts with hex nuts above and below a flange, on a bolt circle in the XZ plane. */
  const studs = (parent: THREE.Object3D, r: number, n: number, yTop: number, yBot: number) => {
    const nut = new THREE.CylinderGeometry(0.024, 0.024, 0.026, 6);
    const stud = new THREE.CylinderGeometry(0.011, 0.011, yTop - yBot + 0.06, 10);
    const nuts = new THREE.InstancedMesh(nut, zinc, n * 2);
    const rods = new THREE.InstancedMesh(stud, zinc, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      nuts.setMatrixAt(i * 2, m.makeTranslation(x, yTop + 0.013, z));
      nuts.setMatrixAt(i * 2 + 1, m.makeTranslation(x, yBot - 0.013, z));
      rods.setMatrixAt(i, m.makeTranslation(x, (yTop + yBot) / 2, z));
    }
    nuts.castShadow = rods.castShadow = true;
    parent.add(nuts, rods);
  };
  const flangeGeo = (() => {
    const rIn = SPOOL.r - 0.04;
    const t = 0.07;
    const sh = [new THREE.Vector2(rIn, -t), new THREE.Vector2(SPOOL.flange, -t), new THREE.Vector2(SPOOL.flange, t), new THREE.Vector2(rIn, t), new THREE.Vector2(rIn, -t)];
    return new THREE.LatheGeometry(sh, 96);
  })();
  // Flanges slide on from beyond each end.
  const flanges = ([-1, 1] as const).map((s) => {
    const g = new THREE.Group();
    const axis = new THREE.Group(); // built along +y, turned to the section's x axis
    axis.rotation.z = -Math.PI / 2;
    g.add(axis);
    mesh(flangeGeo, frpMat, axis);
    studs(axis, (SPOOL.r + SPOOL.flange) / 2 + 0.03, 16, 0.07, -0.07);
    g.visible = false;
    fittings.add(g);
    return { g, s };
  });
  const liner = mesh(
    new THREE.CylinderGeometry(SPOOL.r * 0.97, SPOOL.r * 0.97, SPOOL.half * 2, 64, 1, true).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#cfe3d4', roughness: 0.5, side: THREE.BackSide }),
    fittings,
  );
  liner.visible = false;
  // Two lifting lugs on the rim of the +x flange (the end that will point up),
  // either side of the axis, so the slings hang square through the upending.
  const TOP = new THREE.Vector3(SPOOL.half - 0.02, 0, 0);
  const LUGS = [-1, 1].map((s) => new THREE.Vector3(SPOOL.half - 0.02, 0, s * (SPOOL.flange + 0.1)));
  const lugs = LUGS.map((at) => {
    const g = new THREE.Group();
    g.position.copy(at);
    mesh(new RoundedBoxGeometry(0.1, 0.24, 0.22, 2, 0.02), frpMat, g).position.z = -Math.sign(at.z) * 0.06;
    mesh(new THREE.TorusGeometry(0.06, 0.02, 10, 24), zinc, g).position.z = Math.sign(at.z) * 0.04;
    g.visible = false;
    fittings.add(g);
    return g;
  });
  // Timber cradles it rests on once the machine has gone.
  const cradleTop = -SPOOL.r - 0.08;
  const cradles = [-1.5, 1.5].map((x) => {
    const c = mesh(new RoundedBoxGeometry(0.42, cradleTop - FLOOR_Y, 1.3, 2, 0.03), new THREE.MeshStandardMaterial({ color: '#5a4630', roughness: 0.85 }), scene);
    c.position.set(x, (cradleTop + FLOOR_Y) / 2, 0);
    c.visible = false;
    return c;
  });
  // Crane hook: comes down from the roof over the top end, slings to the lugs, then takes the section up.
  const hook = new THREE.Group();
  scene.add(hook);
  mesh(new RoundedBoxGeometry(0.42, 0.55, 0.32, 2, 0.05), crane, hook).position.y = 0.3;
  mesh(new THREE.CylinderGeometry(0.025, 0.025, 30, 6), darkSteel, hook).position.y = 15.5;
  hook.visible = false;
  const slingGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 6).translate(0, 0.5, 0);
  const slings = LUGS.map(() => {
    const m = mesh(slingGeo, darkSteel, scene);
    m.visible = false;
    return m;
  });
  const UP = new THREE.Vector3(0, 1, 0);
  const span = new THREE.Vector3();
  /** Stretch a sling from a to b. */
  const strut = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
    span.subVectors(b, a);
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(UP, span.clone().normalize());
    m.scale.set(1, span.length(), 1);
  };
  // The roof opens to daylight above the bay.
  const ROOF_Y = FLOOR_Y + 13.9; // just above the workshop's roof opening (scripts/blender/workshop.py)
  const skyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f4f8fb').multiplyScalar(4), fog: false });
  const roofGap = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 5.6), skyMat);
  roofGap.rotation.x = Math.PI / 2;
  roofGap.position.set(-1.5, ROOF_Y, 0);
  roofGap.visible = false;
  scene.add(roofGap);
  const daylight = new THREE.DirectionalLight('#eef4ff', 0);
  daylight.position.set(-1.5, 20, 2);
  scene.add(daylight);

  // Machine
  const machine = new THREE.Group();
  scene.add(machine);
  const powder = new THREE.MeshStandardMaterial({ color: '#161616', metalness: 0.15, roughness: 0.7, transparent: true });
  const graphite = new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: 0.4, roughness: 0.62, transparent: true });
  const steel = new THREE.MeshStandardMaterial({ color: '#a9adb1', metalness: 0.9, roughness: 0.45, transparent: true });
  const resin = new THREE.MeshPhysicalMaterial({ color: '#1f8a55', roughness: 0.2, clearcoat: 0.6, transparent: true });
  const spool = new THREE.MeshStandardMaterial({ color: '#eceee8', map: spoolTexture(), roughness: 0.8, transparent: true });
  const machineMats: THREE.Material[] = [powder, graphite, steel, resin, spool, mandrelMat];
  const rbox = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = machine) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(w, h, d) * 0.12), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cyl = (r: number, len: number, m: THREE.Material, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, parent: THREE.Object3D = machine) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 48), m);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  rbox(10.6, 0.34, 1.5, powder, 0, -1.43, 0); // bed
  rbox(1.25, 2.4, 1.7, powder, -4.8, -0.3, 0); // headstock
  cyl(0.38, 1, graphite, 'z', -4.8, 0.55, -1.05); // motor
  rbox(0.05, 0.9, 1.2, graphite, -4.16, -0.2, 0); // face panel
  cyl(0.44, 0.26, steel, 'x', -4.05, 0, 0); // chuck
  const jaws = new THREE.Group(); // turn with the chuck
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    g.rotation.x = (i / 3) * Math.PI * 2;
    rbox(0.18, 0.14, 0.3, graphite, -3.9, 0.3, 0, g);
    jaws.add(g);
  }
  spinner.add(jaws);
  cyl(0.07, 8.9, steel, 'x', 0, 0, 0); // shaft
  rbox(0.85, 1.75, 1.15, powder, 4.6, -0.68, 0); // tailstock

  // ---- details ----
  // trim rail along the front edge of the bed
  rbox(10.2, 0.03, 0.03, steel, 0, -1.3, 0.76);
  // levelling feet
  for (const fx of [-4.9, -1.7, 1.7, 4.9]) for (const fz of [-0.6, 0.6]) cyl(0.09, 0.12, steel, 'y', fx, -1.66, fz);
  // bolt heads along the bed top
  {
    const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12), steel, 32);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) {
      const bx = -4.9 + (i / 15) * 9.8;
      bolts.setMatrixAt(i * 2, m.makeTranslation(bx, -1.25, 0.62));
      bolts.setMatrixAt(i * 2 + 1, m.makeTranslation(bx, -1.25, -0.62));
    }
    bolts.castShadow = true;
    machine.add(bolts);
  }
  // cable chain along the back of the bed
  {
    const links = new THREE.InstancedMesh(new RoundedBoxGeometry(0.16, 0.12, 0.14, 2, 0.02), graphite, 46);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 46; i++) links.setMatrixAt(i, m.makeTranslation(-4.4 + i * 0.19, -1.18, -0.82));
    links.castShadow = true;
    machine.add(links);
  }
  // control pendant on the headstock: a live readout of the winding
  const SCREEN_W = 512;
  const SCREEN_H = 300;
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = SCREEN_W;
  screenCanvas.height = SCREEN_H;
  const sctx = screenCanvas.getContext('2d')!;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = 8;
  // a dim display, not a light: it reads, it doesn't glow
  const screenMat = new THREE.MeshStandardMaterial({ map: screenTex, emissiveMap: screenTex, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.25, transparent: true });
  machineMats.push(screenMat);
  rbox(0.08, 0.72, 1.05, graphite, -4.13, 0.55, 0.15); // pendant housing
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.53), screenMat);
  screen.rotation.y = Math.PI / 2;
  screen.position.set(-4.085, 0.55, 0.15);
  machine.add(screen);
  cyl(0.035, 0.03, steel, 'x', -4.12, 0.06, 0.5); // selector knob
  let screenKey = '';
  const drawScreen = (stage: string, pass: number, rpm: number, pct: number) => {
    const key = `${stage}|${pass}|${rpm}|${Math.round(pct * 100)}`;
    if (key === screenKey) return;
    screenKey = key;
    const g = sctx;
    g.fillStyle = '#04120b';
    g.fillRect(0, 0, SCREEN_W, SCREEN_H);
    g.fillStyle = '#4cc38a';
    g.font = '500 26px "Geist Mono", ui-monospace, monospace';
    g.fillText('SHAKTINOVA · FW-01', 26, 46);
    g.globalAlpha = 0.6;
    g.font = '400 20px "Geist Mono", ui-monospace, monospace';
    g.fillText(stage.toUpperCase(), 26, 82);
    g.globalAlpha = 1;
    g.font = '500 44px "Geist Mono", ui-monospace, monospace';
    g.fillText(`${String(pass).padStart(2, '0')}/${PASSES}`, 26, 160);
    g.fillText(`${rpm} RPM`, 270, 160);
    g.globalAlpha = 0.6;
    g.font = '400 18px "Geist Mono", ui-monospace, monospace';
    g.fillText('PASS', 26, 190);
    g.fillText('MANDREL', 270, 190);
    g.fillText('ANGLE ±58°', 26, 236);
    g.globalAlpha = 1;
    g.strokeStyle = '#1d5a3c';
    g.lineWidth = 2;
    g.strokeRect(26, 252, SCREEN_W - 52, 18);
    g.fillRect(28, 254, (SCREEN_W - 56) * pct, 14);
    screenTex.needsUpdate = true;
  };
  cyl(0.13, 0.7, steel, 'x', 4.05, 0, 0); // quill
  cyl(0.045, 10.2, steel, 'x', 0, -1.2, 1.78); // rails
  cyl(0.045, 10.2, steel, 'x', 0, -1.2, 2.36);

  const carriage = new THREE.Group();
  machine.add(carriage);
  rbox(0.95, 0.24, 0.95, powder, 0, -1.06, 2.07, carriage);
  rbox(0.74, 0.24, 0.46, steel, 0, -0.84, 2.07, carriage); // resin bath
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.36), resin);
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(0, -0.715, 2.07);
  carriage.add(surface);
  const roller = cyl(0.07, 0.56, steel, 'x', 0, -0.72, 2.07, carriage); // wet-out roller
  rbox(0.15, 1.15, 0.15, graphite, 0, -0.33, 2.26, carriage); // column
  rbox(0.11, 0.11, 0.78, graphite, 0, 0.05, 1.9, carriage); // arm
  const EYE = new THREE.Vector3(0, 0.05, 1.5);
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 16, 40), steel);

  eye.position.copy(EYE);
  carriage.add(eye);
  // creel: roving package on a spindle between two uprights
  cyl(0.07, 0.5, graphite, 'x', 0, -0.52, 2.72, carriage); // spindle
  const pkg = cyl(0.22, 0.36, spool, 'x', 0, -0.52, 2.72, carriage);
  for (const sx of [-0.25, 0.25]) rbox(0.035, 0.46, 0.14, graphite, sx, -0.75, 2.72, carriage);

  const tow = createTow(carriage, scene, EYE);
  /** Mandrel radius at axial position x (profile points run along the axis). */
  const radiusAt = (x: number) => {
    if (x <= pts[0].y) return pts[0].x;
    for (let i = 1; i < pts.length; i++)
      if (x <= pts[i].y) return THREE.MathUtils.lerp(pts[i - 1].x, pts[i].x, (x - pts[i - 1].y) / (pts[i].y - pts[i - 1].y));
    return pts[pts.length - 1].x;
  };

  // Workshop air: dust in the key light, and the light's shaft.
  const dust = createDust(small ? 160 : 320, key);
  scene.add(dust.object);
  const beam = createBeam(key, FLOOR_Y);
  scene.add(beam.object);
  const workshop = createWorkshop(FLOOR_Y);
  scene.add(workshop.object);
  // Curing: IR heater bank lowered over the vessel, and vapour off the warm laminate.
  const heater = createHeater();
  scene.add(heater.object);
  const vapour = createVapour(small ? 40 : 80, 1.06, 2.1);
  scene.add(vapour.object);

  // ---- State from progress (and time) ----
  const stageOf = (p: number) => {
    let i = STAGE_P.length - 2;
    while (i > 0 && p < STAGE_P[i]) i--;
    return i;
  };

  // Before any band is laid the steel mandrel and the veil look the same at
  // every angle, so it can turn freely with time. The extra turns are folded
  // into the band pattern's phase, so winding still starts at the eye; once a
  // band exists the turn is locked to scroll again.
  let idleRevs = 0;
  let idleW = 1;
  let lastP = -1;
  let flash = 0;
  const stageNames = ['Ready', 'Surface veil', 'Winding', 'Curing', 'Complete', 'Complete', 'Complete'];
  const outside = (st: number) => st >= 5;

  // The plant: built at start-up (see below), so it's ready long before the roof opens.
  let plant: ReturnType<typeof createPlant> | null = null;
  const getPlant = () => {
    if (!plant) {
      plant = createPlant(renderer, small);
      plant.resize(canvas.clientHeight * renderer.getPixelRatio(), camera.fov);
      const p = plant;
      prep(p.scene);
      p.loaded.then(() => prep(p.scene)); // its Blender models arrive after it's built
    }
    return plant;
  };
  const shotA = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const shotB = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const toShot = (o: { pos: THREE.Vector3; look: THREE.Vector3 }): Shot => ({ pos: o.pos.toArray() as Shot['pos'], look: o.look.toArray() as Shot['look'] });
  const lugW = new THREE.Vector3();
  /** Outside, after the section is down: close on the stack top, pulling back to show the whole scrubber. */
  const serviceShot = (seat: number, back: number) => {
    shotA.pos.set(7.2, 16.2, 10.8).lerp(shotB.pos.set(20, 12.5, 32), back);
    shotA.look.set(0, THREE.MathUtils.lerp(19.5, 15.2, seat), 0).lerp(shotB.look.set(2.5, 9.6, 0), back);
    return toShot(shotA);
  };

  const apply = (p: number, t: number, dt: number, intro: number, exit: number) => {
    const st = stageOf(p);
    const frac = clamp01((p - STAGE_P[st]) / (STAGE_P[st + 1] - STAGE_P[st]));
    if (p !== lastP) opts.onStage(st, frac);
    lastP = p;
    // Process advances only once the camera has settled.
    const work = clamp01((frac - MOVE) / (1 - MOVE));
    if (st >= 3) getPlant();

    const passes = st < 2 ? 0 : st === 2 ? work * PASSES : PASSES;
    const pre = clamp01(p / STAGE_P[2]) * IDLE_REVS;
    const post = st > 2 ? 0.25 * (st === 3 ? work : 1) : 0;
    if (passes > 0 || st > 2) idleW = 0;
    else idleW += ((st < 2 ? 1 : 0) - idleW) * (1 - Math.exp(-dt * 2.5));
    idleRevs += IDLE_RPS * idleW * dt;
    spinner.rotation.x = -2 * Math.PI * (pre + idleRevs + passes * DU + post);
    uniforms.uOff.value = (((IDLE_REVS + idleRevs - HEAD_TURN) % 1) + 1) % 1;

    uniforms.uProgress.value = passes;
    const sc = Math.min(st, 4);
    drawScreen(stageNames[st], Math.min(PASSES, Math.floor(passes)), st === 2 ? 22 : st === 3 ? 6 : st >= 4 ? 0 : 4, (sc + (sc === 4 ? 1 : work)) / 5);
    uniforms.uVeil.value = st === 0 ? 0 : st === 1 ? smooth(work) : 1;
    uniforms.uCure.value = st < 3 ? 0 : st === 3 ? smooth(work) : 1;
    const grow = 1 + 0.04 * (passes / PASSES);
    laminate.scale.set(1 + 0.01 * (passes / PASSES), grow, grow);
    const glow = st === 3 ? Math.sin(Math.PI * work) : 0;
    lamMat.emissive.setRGB(glow * 0.05, glow * 0.06, glow * 0.03);
    cureGlow.intensity = glow * 5;

    // Machine and mandrel fade away once the section is off the mandrel.
    const mOp = st === 4 ? 1 - smooth(clamp01(frac / MOVE)) : st > 4 ? 0 : 1;
    machineMats.forEach((m) => (m.opacity = mOp));
    tow.setOpacity(mOp);
    machine.visible = jaws.visible = mandrel.visible = mOp > 0.01;
    machine.position.y = -0.8 * (1 - mOp);

    let v = 0;
    let dir: 1 | -1 = 1;
    if (st === 2 && passes > 0) {
      const k = Math.min(Math.floor(passes), PASSES - 1);
      const f = passes - k;
      dir = k % 2 === 0 ? 1 : -1;
      v = dir === 1 ? f : 1 - f;
    }
    const prof = profileAt(pts, v);
    carriage.position.x = st === 2 ? prof.y : -2.75;
    // Fibre runs off the creel, round the wet-out roller and out to the mandrel.
    const feed = tow.feedFor(passes * DU, 1.02);
    pkg.rotation.x = -feed / 0.22;
    roller.rotation.x = -feed / 0.07;
    tow.update({ x: carriage.position.x, r: prof.x * grow, radiusAt: (x) => radiusAt(x) * grow, dir, show: st === 2 && passes > 0, feed, t, dt });

    // Off the mandrel: topcoat and flanges, onto cradles; the hook comes down to
    // the lug; the section is upended about its lower end, then lifted out
    // through the roof into daylight.
    const s4 = st === 4;
    uniforms.uCoat.value = st < 4 ? 0 : s4 ? smooth(clamp01(work / 0.3)) : 1;
    const fit = s4 ? smooth(clamp01(work / 0.25)) : st > 4 ? 1 : 0;
    flanges.forEach(({ g, s }, n) => {
      const k = clamp01(fit * 1.6 - n * 0.4);
      g.position.x = s * (SPOOL.half - 0.02 + 0.9 * (1 - k));
      g.visible = k > 0.001;
    });
    liner.visible = st >= 4;
    lugs.forEach((l) => (l.visible = fit > 0.9));
    const onCradle = s4 ? smooth(clamp01(frac / MOVE)) : 0;
    const upend = s4 ? smooth(clamp01((work - 0.45) / 0.25)) : 0;
    const lift = s4 ? smooth(clamp01((work - 0.68) / 0.32)) : 0;
    cradles.forEach((c) => {
      c.visible = onCradle > 0.01 && lift < 0.5;
      c.position.y = (cradleTop + FLOOR_Y) / 2 - (1 - onCradle) * 0.6;
    });
    const th = upend * Math.PI * 0.5;
    const px = -SPOOL.half - 0.1;
    const py = cradleTop;
    const ox = SPOOL.half + 0.1;
    const oy = -cradleTop;
    if (st >= 4) {
      spinner.position.set(px + Math.cos(th) * ox - Math.sin(th) * oy, py + Math.sin(th) * ox + Math.cos(th) * oy + lift * 15, 0);
    } else spinner.position.set(0, 0, 0);
    spinner.rotation.z = th;
    spinner.rotation.y = 0;
    fittings.position.copy(spinner.position);
    fittings.rotation.set(0, 0, th);
    fittings.updateMatrixWorld();
    fittings.localToWorld(lugW.copy(TOP));
    const hookDown = s4 ? smooth(clamp01((work - 0.22) / 0.22)) : 0;
    hook.visible = hookDown > 0.001 && st === 4;
    hook.position.set(lugW.x, lugW.y + 2.2 + (1 - hookDown) * 9, 0);
    const slung = hookDown > 0.98 && st === 4;
    slings.forEach((m, i) => {
      m.visible = slung;
      if (slung) strut(m, fittings.localToWorld(span.copy(LUGS[i])).clone(), hook.position);
    });
    // the roof opens as the section rises; daylight pours in
    const open = s4 ? smooth(clamp01((work - 0.55) / 0.3)) : 0;
    roofGap.visible = open > 0.001;
    // the model's hatch doors slide apart over the opening; the stand-in just reveals it
    roofGap.scale.set(workshop.hasHatch() ? 1 : open, 1, 1);
    workshop.setHatch(open);
    daylight.intensity = 4 * open;

    // Cure: the heater bank comes down during the camera move, glows while the
    // laminate cures, then lifts away as the machine fades.
    const heaterIn = st === 3 ? smooth(clamp01(frac / MOVE)) : st === 4 ? 1 - smooth(clamp01(frac / MOVE)) : 0;
    const heat = st === 3 ? smooth(clamp01(work / 0.25)) * (1 - smooth(clamp01((work - 0.82) / 0.18))) : 0;
    heater.update(heaterIn, heat);
    vapour.update(t, heat);

    // Lights come up on first load, and close down as the hero scrolls away.
    const out = 1 - 0.85 * smooth(exit);
    const kIn = smooth(clamp01(intro * 1.35)) * out;
    key.intensity = 44 * kIn;
    rim.intensity = 2.2 * smooth(clamp01(intro * 1.35 - 0.3)) * out;
    scene.environmentIntensity = 0.34 * smooth(clamp01(intro * 1.2 - 0.1)) * out;
    workshop.setLevel(kIn);
    dust.update(t, smooth(clamp01(intro * 1.2 - 0.2)) * (1 - 0.6 * onCradle));
    beam.update(0.022 * kIn * (1 - 0.7 * glow) * (1 - open));

    // White-out: the eye adjusting to daylight hides the cut from shop to site.
    flash = s4 ? smooth(clamp01((work - 0.8) / 0.2)) : st === 5 ? 1 - smooth(clamp01(frac / MOVE)) : 0;

    // Outside: the section comes down onto the scrubber, is bolted, and the system starts.
    let pinsOn = 0;
    if (outside(st)) {
      const pl = getPlant();
      const s5 = st === 5;
      const seat = s5 ? clamp01((frac - 0.12) / 0.48) : 1;
      const fix = s5 ? clamp01((frac - 0.58) / 0.2) : 1;
      const on = s5 ? clamp01((frac - 0.74) / 0.2) : 1;
      pl.update(t, seat, fix, on);
      pinsOn = st === 6 ? smooth(clamp01((frac - MOVE) / 0.12)) : 0;
      if (s5) {
        const shot = serviceShot(smooth(seat), smooth(clamp01((frac - 0.6) / 0.4)));
        return { scene: pl.scene, from: shot, to: shot, t: 1, close: 0, arc: 0, exit: smooth(exit), pinsOn };
      }
      const from = serviceShot(1, 1);
      const ct = smooth(clamp01(frac / MOVE));
      return { scene: pl.scene, from, to: AERIAL, t: ct, close: 0, arc: 18 * Math.sin(Math.PI * ct), exit: smooth(exit), pinsOn };
    }

    // Camera: ease from the previous stage's shot, then hold.
    let from = SHOTS[Math.max(0, st - 1)];
    let to = SHOTS[st];
    const ct = st === 0 ? 1 : smooth(clamp01(frac / MOVE));
    if (s4) {
      // follow the section up as it's upended and lifted, tilting towards the roof
      const follow = smooth(clamp01((work - 0.45) / 0.4));
      shotA.pos.fromArray(SHOTS[4].pos).add(shotB.pos.set(0, 1.8 * lift, 2.5 * lift));
      shotA.look.fromArray(SHOTS[4].look);
      shotA.look.y = THREE.MathUtils.lerp(shotA.look.y, spinner.position.y + 0.8, follow * 0.85);
      shotA.look.x = THREE.MathUtils.lerp(shotA.look.x, spinner.position.x, follow);
      to = toShot(shotA);
    }
    // A close-up in the middle of winding, then back out to see the whole pattern.
    const close = st === 2 ? smooth(clamp01((work - 0.2) / 0.12)) * (1 - smooth(clamp01((work - 0.62) / 0.12))) : 0;
    return { scene, from, to, t: ct, close, arc: 0, exit: smooth(exit), pinsOn };
  };

  // ---- Camera ----
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  let pullBack = 1;
  // Pointer parallax (mouse only), eased.
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    ptr.tx = (e.clientX / innerWidth) * 2 - 1;
    ptr.ty = (e.clientY / innerHeight) * 2 - 1;
  };
  addEventListener('pointermove', onPointer, { passive: true });
  type Placement = { scene: THREE.Scene; from: Shot; to: Shot; t: number; close: number; arc: number; exit: number; pinsOn: number };
  const pinPos = new THREE.Vector3();
  let pinsShown = false;
  const placeCamera = ({ scene: active, from, to, t: ct, close, arc, exit, pinsOn }: Placement, t: number, intro: number) => {
    useScene(active);
    pos.lerpVectors(a.fromArray(from.pos), b.fromArray(to.pos), ct);
    look.lerpVectors(a.fromArray(from.look), b.fromArray(to.look), ct);
    pos.y += arc;
    if (close > 0) {
      // swing in on an arc (lifted mid-way) rather than a straight line
      pos.lerp(a.fromArray(CLOSE.pos), close).y += 0.6 * Math.sin(Math.PI * close);
      look.lerp(a.fromArray(CLOSE.look), close);
    }
    // Narrow screens: pull back along the view line so the machine still fits.
    // First load: start further out and settle in.
    const dolly = 1 + 0.24 * (1 - smooth(clamp01(intro)));
    pos.sub(look).multiplyScalar(pullBack * dolly).add(look);
    // Hand-off: the page carries the canvas up, so only its lower part stays on
    // screen. Drop the camera and tilt up: the vessel sinks into that part of
    // the frame and ends on a low, heroic angle as the light closes down.
    pos.y -= 1.1 * exit;
    look.y += 2.6 * exit;
    // A slow, breathing drift, as if hand-held on a very steady rig, plus parallax.
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const dx = Math.sin(t * 0.21) * 0.6 + Math.sin(t * 0.53 + 1.3) * 0.4;
    const dy = Math.sin(t * 0.17 + 2.1) * 0.6 + Math.sin(t * 0.41) * 0.4;
    pos.addScaledVector(right, dx * 0.06 + ptr.x * 0.32).addScaledVector(up, dy * 0.04 - ptr.y * 0.16);
    look.addScaledVector(right, dx * 0.015).addScaledVector(up, dy * 0.01);
    camera.position.copy(pos);
    camera.lookAt(look);
    // Labels for the FRP in the plant, once the camera has risen over it.
    if (opts.onPins && plant && (pinsOn > 0 || pinsShown)) {
      camera.updateMatrixWorld();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      opts.onPins(
        plant.pins.map(({ id, at }) => {
          pinPos.copy(at).project(camera);
          return { id, x: (pinPos.x * 0.5 + 0.5) * w, y: (-pinPos.y * 0.5 + 0.5) * h, front: pinPos.z < 1 };
        }),
        pinsOn,
      );
      pinsShown = pinsOn > 0;
    }
    // Depth of field only in the close-up, focused on the laying point.
    const dofOn = close > 0.01 && tier < 2;
    bokeh.enabled = dofOn;
    if (dofOn) {
      bokehU.focus.value = pos.distanceTo(look);
      bokehU.aperture.value = 0.006 * close;
    }
  };

  // ---- Post-processing: multisampled HDR target → AO → AgX output ----
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  /**
   * Compile a scene's shaders ahead of time, in parallel where the browser can. With the
   * composer's target bound: drawn into it, materials skip tone mapping and output linear
   * colour, which three.js compiles as a different program from the on-screen one, so a
   * plain compile wouldn't be the program that gets used.
   */
  const prep = (s: THREE.Scene) => {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const done = renderer.compileAsync(s, camera).catch(() => {});
    renderer.setRenderTarget(prev);
    return done;
  };
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 1.2, scale: 1.2, samples: 16 });
  gtao.blendIntensity = 0.85;
  gtao.enabled = !small;
  // The light shaft is air, not a surface: keep it out of passes that re-render depth.
  const skipAir = (pass: GTAOPass | BokehPass) => {
    const inner = pass.render.bind(pass) as (...a: unknown[]) => void;
    const air = [beam.object, ...workshop.air];
    pass.render = ((...args: unknown[]) => {
      const was = air.map((o) => o.visible);
      air.forEach((o) => (o.visible = false));
      inner(...args);
      air.forEach((o, i) => (o.visible = was[i]));
    }) as typeof pass.render;
  };
  skipAir(gtao);
  composer.addPass(gtao);
  const bokeh = new BokehPass(scene, camera, { focus: 5, aperture: 0, maxblur: 0.009 });
  const bokehU = bokeh.uniforms as unknown as Record<'focus' | 'aperture' | 'maxblur', { value: number }>;
  bokeh.enabled = false;
  skipAir(bokeh);
  composer.addPass(bokeh);
  // Shop or site: one composer, the scene swapped under the white-out.
  let activeScene = scene;
  const useScene = (s: THREE.Scene) => {
    if (s === activeScene) return;
    activeScene = s;
    renderPass.scene = s;
    gtao.scene = s;
    (bokeh as unknown as { scene: THREE.Scene }).scene = s;
    const out = s !== scene;
    camera.near = out ? 0.5 : 0.1;
    camera.far = out ? 1400 : 80;
    camera.updateProjectionMatrix();
  };
  // Soft bloom on true highlights only: clear-coat glints, heater tubes.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.2, 1.3);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Final grade in display space: light unsharp mask, a hint of saturation and contrast.
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uPx: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.25 }, uSat: { value: 1.14 }, uContrast: { value: 1.04 }, uFlash: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 uPx; uniform float uSharp, uSat, uContrast, uFlash; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        vec3 n = texture2D(tDiffuse, vUv + vec2(uPx.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uPx.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv + vec2(0.0, uPx.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uPx.y)).rgb;
        c += (c * 4.0 - n) * uSharp;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c = (c - 0.5) * uContrast + 0.5;
        // white-out between shop and site: highlights blow first, then everything
        c = mix(c, vec3(1.0, 0.995, 0.985), clamp(uFlash * 1.5 - (1.0 - l) * 0.5, 0.0, 1.0));
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
  });
  composer.addPass(grade);

  const frame = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    const dpr = renderer.getPixelRatio();
    grade.uniforms.uPx.value.set(1 / (w * dpr), 1 / (h * dpr));
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 40 : 30;
    pullBack = camera.aspect < 1.3 ? THREE.MathUtils.clamp(1.3 / camera.aspect, 1, 2.2) * (camera.aspect < 1 ? 0.8 : 1) : 1;
    camera.updateProjectionMatrix();
    dust.resize(h * dpr, camera.fov);
    plant?.resize(h * dpr, camera.fov);
    vapour.resize(h * dpr, camera.fov);
  };

  // ---- Adaptive quality: step down if frames run long, never back up ----
  let tier = 0;
  const samples: number[] = [];
  let warm = 0;
  const degrade = () => {
    tier++;
    if (tier === 1) gtao.enabled = false;
    if (tier === 2) {
      renderer.setPixelRatio(Math.min(renderer.getPixelRatio(), 1.25));
      bloom.enabled = false;
    }
    if (tier === 3) {
      renderer.setPixelRatio(1);
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
    frame();
    if (import.meta.env.DEV) console.info(`[hero] quality tier ${tier}`);
  };
  const watch = (raw: number) => {
    warm += raw;
    if (warm < 1.5 || tier >= 3) return; // ignore start-up (shader compile, decoding)
    samples.push(raw);
    if (samples.length < 30) return;
    // the median, so one hitch (an image decoding) doesn't cost the whole hero its quality
    const med = samples.sort((x, y) => x - y)[15];
    samples.length = 0;
    if (med > 1 / 45) degrade();
    if (med > 1 / 24 && tier < 3) degrade(); // far over: skip a step
  };

  // ---- Loop ----
  let goal = 0;
  let current = 0;
  let exit = 0;
  let visible = true;
  let ready = false;
  let last = performance.now();
  let time = 0;
  let intro = opts.intro && !opts.still ? 0 : 1;
  const render = (dt: number) => {
    placeCamera(apply(current, time, dt, intro, exit), time, intro);
    grade.uniforms.uFlash.value = flash;
    composer.render();
  };
  const tick = (now: number) => {
    const raw = (now - last) / 1000;
    const dt = Math.min(raw, 0.05);
    last = now;
    time += dt;
    intro = Math.min(1, intro + dt / INTRO_S);
    current += (goal - current) * (1 - Math.exp(-dt * 4.5)); // calm scroll inertia
    if (Math.abs(goal - current) < 0.00005) current = goal;
    const k = 1 - Math.exp(-dt * 3);
    ptr.x += (ptr.tx - ptr.x) * k;
    ptr.y += (ptr.ty - ptr.y) * k;
    render(dt);
    watch(raw);
  };
  const loop = frameLoop(tick);
  const start = () => {
    if (loop.running || opts.still || !ready) return;
    last = performance.now();
    loop.start();
  };
  const stop = () => loop.stop();

  const ro = new ResizeObserver(() => {
    frame();
    if (ready && !loop.running) render(0);
  });
  ro.observe(canvas);
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    visible && !document.hidden ? start() : stop();
  });
  io.observe(canvas);
  const onVis = () => (document.hidden || !visible ? stop() : start());
  document.addEventListener('visibilitychange', onVis);

  frame();
  // Compile every shader before the first frame so the intro doesn't stutter.
  placeCamera(apply(current, 0, 0, intro, exit), 0, intro);
  workshop.loaded.then(() => prep(scene)); // the Blender shop arrives after the first compile
  // The plant too, now, before the first frame: built mid-scroll (during curing) its
  // environment map and ~25 shaders cost a visible ~150 ms stall.
  if (!opts.still) getPlant();
  prep(scene).then(() => {
      ready = true;
      render(0);
      opts.onReady?.();
      if (visible && !document.hidden) start();
    });

  return {
    setProgress(p) {
      goal = clamp01(p);
      if (opts.still) {
        current = goal;
        if (ready) render(0);
      }
    },
    setExit(e) {
      exit = opts.still ? 0 : clamp01(e);
    },
    jump(p) {
      goal = current = clamp01(p);
      if (ready) render(0);
    },
    dispose() {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('pointermove', onPointer);
      dust.dispose();
      beam.dispose();
      vapour.dispose();
      workshop.dispose();
      plant?.dispose();
      composer.dispose();
      target.dispose();
      envTex.dispose();
      renderer.dispose();
    },
  };
}
