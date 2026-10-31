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
import { MOVE, STAGE_P } from './three/stages';
import { DU, PASSES, floor, laminateMaterial, laminateUniforms, profileAt, studioEnvironment, vesselProfile } from './three/vessel';

const IDLE_REVS = 0.6; // gentle mandrel turn before winding starts
const smooth = (x: number) => THREE.MathUtils.smootherstep(x, 0, 1);
const clamp01 = (x: number) => THREE.MathUtils.clamp(x, 0, 1);

type Shot = { pos: [number, number, number]; look: [number, number, number] };
// One held camera shot per stage (landscape framing).
const SHOTS: Shot[] = [
  { pos: [6.4, 2.4, 13.6], look: [0, -1.25, 0] }, // mandrel: wide, machine above the headline
  { pos: [3.8, 1.3, 7.4], look: [0.4, 0, 0] }, // veil: three-quarter, closer
  { pos: [1.4, 3.4, 9.2], look: [0, -0.35, 0.4] }, // winding: high front view of the whole traverse
  { pos: [-4.8, 1.7, 8.2], look: [0, 0, 0] }, // cure: low side, warm
  { pos: [0.3, 1.0, 10.4], look: [0, 0.1, 0] }, // finished: product shot
];

export type Winding = { setProgress(p: number): void; jump(p: number): void; dispose(): void };

export function createWinding(
  canvas: HTMLCanvasElement,
  opts: { still: boolean; onStage(stage: number, frac: number): void },
): Winding {
  const small = Math.min(innerWidth, innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

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
  scene.add(floor(-1.6));
  // Faint workshop grid on the floor.
  const grid = new THREE.GridHelper(40, 80, '#2c3a33', '#1d2621');
  grid.position.y = -1.595;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.3;
  scene.add(grid);

  // Vessel on its mandrel
  const pts = vesselProfile();
  const lathe = new THREE.LatheGeometry(pts, 160);
  lathe.rotateZ(-Math.PI / 2);
  const spinner = new THREE.Group();
  spinner.rotation.order = 'YXZ'; // spin about the vessel's own axis, then turn it
  scene.add(spinner);
  const mandrel = new THREE.Mesh(lathe, new THREE.MeshStandardMaterial({ color: '#9ea3a8', metalness: 0.9, roughness: 0.5 }));
  mandrel.scale.setScalar(0.985);
  mandrel.castShadow = true;
  spinner.add(mandrel);
  const uniforms = laminateUniforms();
  uniforms.uOff.value = IDLE_REVS % 1;
  const lamMat = laminateMaterial(uniforms);
  const laminate = new THREE.Mesh(lathe, lamMat);
  laminate.castShadow = true;
  spinner.add(laminate);

  // Fittings that appear once the vessel is finished and coated. They follow
  // the vessel's lift and turn but not the mandrel's spin, so they settle upright.
  // Vessel shell: axis along x, cylinder |x| ≤ 2, domes beyond.
  const fittings = new THREE.Group();
  scene.add(fittings);
  const SHELL = 1.04; // outer radius of the finished laminate
  // coated FRP, matching the lacquered shell
  const frpMat = new THREE.MeshPhysicalMaterial({ color: '#1d7a4c', roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  const padMat = new THREE.MeshPhysicalMaterial({ color: '#1a6e44', roughness: 0.4, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  const zinc = new THREE.MeshStandardMaterial({ color: '#c3c7cb', metalness: 0.9, roughness: 0.32 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#1d1f21', metalness: 0.5, roughness: 0.5 });
  const appear: THREE.Object3D[] = [];
  const part = (build: (g: THREE.Group) => void) => {
    const g = new THREE.Group();
    build(g);
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    g.scale.setScalar(0.001);
    fittings.add(g);
    appear.push(g);
    return g;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
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
  /** Triangular gusset rib between shell and nozzle neck. */
  const gussetGeo = (() => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(0.2, 0);
    sh.quadraticCurveTo(0.06, 0.04, 0, 0.24);
    sh.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
    g.translate(0, 0, -0.011);
    return g;
  })();
  /**
   * Vertical flanged nozzle on top of the shell: hand-laid reinforcing pad,
   * neck, gussets, raised-face flange, blind cover, studs and nuts.
   */
  const nozzle = (x: number, r: number, h: number, studsN: number) =>
    part((g) => {
      g.position.set(x, SHELL - 0.03, 0);
      const pad = mesh(new THREE.CylinderGeometry(r * 1.35, r * 2.6, 0.1, 48), padMat, g);
      pad.position.y = 0.05;
      const neck = mesh(new THREE.CylinderGeometry(r, r * 1.04, h, 48), frpMat, g);
      neck.position.y = h / 2;
      for (let k = 0; k < 4; k++) {
        const gu = mesh(gussetGeo, padMat, g);
        gu.rotation.y = (k / 4) * Math.PI * 2 + Math.PI / 4;
        gu.position.set(Math.cos(-gu.rotation.y) * r * 0.98, 0.06, Math.sin(-gu.rotation.y) * r * 0.98);
        gu.scale.setScalar(r / 0.15);
      }
      const fl = mesh(new THREE.CylinderGeometry(r * 2.15, r * 2.15, 0.07, 64), frpMat, g);
      fl.position.y = h;
      const face = mesh(new THREE.CylinderGeometry(r * 1.55, r * 1.55, 0.016, 64), frpMat, g);
      face.position.y = h + 0.043;
      const cover = mesh(new THREE.CylinderGeometry(r * 2.15, r * 2.15, 0.05, 64), frpMat, g);
      cover.position.y = h + 0.076;
      studs(g, r * 1.82, studsN, h + 0.101, h - 0.035);
    });
  nozzle(-1.2, 0.15, 0.42, 8);
  nozzle(0.75, 0.1, 0.34, 6);
  nozzle(-0.15, 0.065, 0.26, 4);

  // Manway on the right-hand dome: pad, neck, flange, cover, studs and a hinged davit.
  part((g) => {
    g.position.set(2.36, 0, 0);
    const axisGroup = new THREE.Group(); // build along +y, then turn to +x
    axisGroup.rotation.z = -Math.PI / 2;
    g.add(axisGroup);
    const pad = mesh(new THREE.CylinderGeometry(0.4, 0.6, 0.12, 64), padMat, axisGroup);
    pad.position.y = 0.06;
    const neck = mesh(new THREE.CylinderGeometry(0.31, 0.32, 0.3, 64), frpMat, axisGroup);
    neck.position.y = 0.17;
    const fl = mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.07, 72), frpMat, axisGroup);
    fl.position.y = 0.33;
    const cover = mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.06, 72), frpMat, axisGroup);
    cover.position.y = 0.4;
    const handle = mesh(new THREE.TorusGeometry(0.09, 0.012, 10, 32, Math.PI), zinc, axisGroup);
    handle.position.y = 0.43;
    handle.rotation.y = Math.PI / 2;
    studs(axisGroup, 0.39, 16, 0.43, 0.295);
    // davit: bracket on the shell, arm over the top of the cover
    const arm = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, 0.52, 0),
      new THREE.Vector3(0.18, 0.66, 0),
      new THREE.Vector3(0.42, 0.62, 0),
      new THREE.Vector3(0.5, 0.42, 0),
      new THREE.Vector3(0.48, 0.0, 0),
    ]);
    mesh(new THREE.TubeGeometry(arm, 48, 0.022, 12), zinc, g);
    const bracket = mesh(new RoundedBoxGeometry(0.12, 0.1, 0.1, 2, 0.015), darkSteel, g);
    bracket.position.set(0, 0.52, 0);
  });

  // Lifting lugs: plate with an eye, on a laminated pad.
  const lugGeo = (() => {
    const sh = new THREE.Shape();
    sh.moveTo(-0.13, 0);
    sh.lineTo(0.13, 0);
    sh.lineTo(0.13, 0.12);
    sh.absarc(0, 0.12, 0.13, 0, Math.PI, false);
    sh.lineTo(-0.13, 0);
    const hole = new THREE.Path();
    hole.absarc(0, 0.13, 0.05, 0, Math.PI * 2, true);
    sh.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 32 });
    g.translate(0, 0, -0.02);
    return g;
  })();
  for (const x of [-1.75, 1.75])
    part((g) => {
      g.position.set(x, SHELL - 0.02, 0);
      const pad = mesh(new RoundedBoxGeometry(0.42, 0.04, 0.26, 2, 0.015), padMat, g);
      pad.position.y = 0.01;
      const lug = mesh(lugGeo, frpMat, g);
      lug.position.y = 0.02;
    });

  // Saddle supports: a curved cradle that wraps the shell, web cut-out, base plate, anchor bolts.
  const saddleGeo = (() => {
    const R = SHELL + 0.01;
    const half = 0.82;
    const top = -Math.sqrt(R * R - half * half);
    const foot = -1.9; // floor (vessel is lifted 0.3 in the finished shot)
    const sh = new THREE.Shape();
    sh.moveTo(-half, foot);
    sh.lineTo(half, foot);
    sh.lineTo(half, top);
    sh.absarc(0, 0, R, Math.atan2(top, half), Math.atan2(top, -half) - Math.PI * 2, true);
    sh.lineTo(-half, foot);
    const win = new THREE.Path();
    win.moveTo(-0.5, foot + 0.16);
    win.lineTo(0.5, foot + 0.16);
    win.lineTo(0.5, top - 0.28);
    win.quadraticCurveTo(0, -R - 0.12, -0.5, top - 0.28);
    win.lineTo(-0.5, foot + 0.16);
    sh.holes.push(win);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 48 });
    g.translate(0, 0, -0.06);
    g.rotateY(Math.PI / 2);
    return g;
  })();
  for (const x of [-1.35, 1.35])
    part((g) => {
      g.position.x = x;
      mesh(saddleGeo, frpMat, g);
      // wear plate under the shell and stiffening ribs
      const wear = mesh(new THREE.CylinderGeometry(SHELL + 0.02, SHELL + 0.02, 0.32, 64, 1, true, Math.PI * 1.12, Math.PI * 0.76), padMat, g);
      wear.rotation.z = Math.PI / 2;
      for (const z of [-0.6, 0, 0.6]) {
        const rib = mesh(new RoundedBoxGeometry(0.3, 0.3, 0.025, 2, 0.008), frpMat, g);
        rib.position.set(0, -1.72, z);
      }
      const base = mesh(new RoundedBoxGeometry(0.46, 0.04, 1.86, 2, 0.012), darkSteel, g);
      base.position.y = -1.88;
      for (const z of [-0.78, 0.78]) {
        const bolt = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 6), zinc, g);
        bolt.position.set(0.15, -1.845, z);
        const bolt2 = bolt.clone();
        bolt2.position.x = -0.15;
        g.add(bolt2);
      }
    });

  // Nameplate riveted to the front of the shell.
  part((g) => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 224;
    const t = c.getContext('2d')!;
    t.fillStyle = '#c9cdd1';
    t.fillRect(0, 0, 512, 224);
    t.strokeStyle = '#7d8287';
    t.lineWidth = 6;
    t.strokeRect(10, 10, 492, 204);
    t.fillStyle = '#2a2d30';
    t.font = '600 34px "Geist", sans-serif';
    t.fillText('SHAKTINOVA PROJECTS', 34, 66);
    t.font = '400 24px "Geist Mono", monospace';
    t.fillText('FRP VESSEL · FILAMENT WOUND', 34, 112);
    t.fillText('TAG  V-101', 34, 152);
    t.fillText('ILLUSTRATIVE', 34, 192);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const plate = mesh(new THREE.PlaneGeometry(0.46, 0.2), new THREE.MeshStandardMaterial({ map: tex, metalness: 0.6, roughness: 0.4 }), g);
    g.position.set(-0.55, -0.12, 0);
    plate.position.z = SHELL + 0.022; // small stand-off so the flat plate clears the curved shell
  });

  // Machine
  const machine = new THREE.Group();
  scene.add(machine);
  const powder = new THREE.MeshStandardMaterial({ color: '#161616', metalness: 0.15, roughness: 0.7, transparent: true });
  const graphite = new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: 0.4, roughness: 0.62, transparent: true });
  const steel = new THREE.MeshStandardMaterial({ color: '#a9adb1', metalness: 0.9, roughness: 0.45, transparent: true });
  const resin = new THREE.MeshPhysicalMaterial({ color: '#1f8a55', roughness: 0.2, clearcoat: 0.6, transparent: true });
  const spool = new THREE.MeshStandardMaterial({ color: '#e4e7e2', roughness: 0.75, transparent: true });
  const machineMats: THREE.Material[] = [powder, graphite, steel, resin, spool];
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
  cyl(0.07, 0.56, steel, 'x', 0, -0.72, 2.07, carriage); // wet-out roller
  rbox(0.15, 1.15, 0.15, graphite, 0, -0.33, 2.26, carriage); // column
  rbox(0.11, 0.11, 0.78, graphite, 0, 0.05, 1.9, carriage); // arm
  const EYE = new THREE.Vector3(0, 0.05, 1.5);
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 16, 40), steel);

  eye.position.copy(EYE);
  carriage.add(eye);
  cyl(0.24, 0.42, graphite, 'x', 0, -0.52, 2.72, carriage); // spool core
  cyl(0.2, 0.36, spool, 'x', 0, -0.52, 2.72, carriage);

  // Fibre band: spool → wet-out roller → payout eye → laying point.
  const ribbonGeo = new THREE.BufferGeometry();
  const ribbonPos = new Float32Array(8 * 3);
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(ribbonPos, 3));
  ribbonGeo.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6, 6, 5, 7]);
  const ribbon = new THREE.Mesh(
    ribbonGeo,
    new THREE.MeshStandardMaterial({ color: '#e3eae0', roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
  );
  scene.add(ribbon);
  const setRibbon = (x: number, surfR: number, show: boolean) => {
    ribbon.visible = show;
    if (!show) return;
    const w = 0.12;
    [[x, -0.36, 2.72], [x, -0.72, 2.07], [x, EYE.y, EYE.z], [x, 0, surfR]].forEach(([px, py, pz], i) =>
      ribbonPos.set([px - w, py, pz, px + w, py, pz], i * 6),
    );
    ribbonGeo.attributes.position.needsUpdate = true;
    ribbonGeo.computeVertexNormals();
  };

  // ---- State from progress ----
  const stageOf = (p: number) => {
    let i = STAGE_P.length - 2;
    while (i > 0 && p < STAGE_P[i]) i--;
    return i;
  };

  const apply = (p: number) => {
    const st = stageOf(p);
    const frac = clamp01((p - STAGE_P[st]) / (STAGE_P[st + 1] - STAGE_P[st]));
    opts.onStage(st, frac);
    // Process advances only once the camera has settled.
    const work = clamp01((frac - MOVE) / (1 - MOVE));

    const passes = st < 2 ? 0 : st === 2 ? work * PASSES : PASSES;
    const pre = clamp01(p / STAGE_P[2]) * IDLE_REVS;
    const post = st > 2 ? 0.25 * (st - 3 + (st === 3 ? work : frac)) : 0;
    spinner.rotation.x = -2 * Math.PI * (pre + passes * DU + post);

    uniforms.uProgress.value = passes;
    const stageNames = ['Ready', 'Surface veil', 'Winding', 'Curing', 'Complete'];
    drawScreen(stageNames[st], Math.min(PASSES, Math.floor(passes)), st === 2 ? 22 : st === 3 ? 6 : st === 4 ? 0 : 4, (st + (st === 4 ? 1 : work)) / 5);
    uniforms.uVeil.value = st === 0 ? 0 : st === 1 ? smooth(work) : 1;
    uniforms.uCure.value = st < 3 ? 0 : st === 3 ? smooth(work) : 1;
    const grow = 1 + 0.04 * (passes / PASSES);
    laminate.scale.set(1 + 0.01 * (passes / PASSES), grow, grow);
    const glow = st === 3 ? Math.sin(Math.PI * work) : 0;
    lamMat.emissive.setRGB(glow * 0.05, glow * 0.06, glow * 0.03);
    cureGlow.intensity = glow * 5;

    // Machine fades away for the finished-vessel product shot.
    const mOp = st === 4 ? 1 - smooth(clamp01(frac / MOVE)) : 1;
    machineMats.forEach((m) => (m.opacity = mOp));
    machine.visible = jaws.visible = mOp > 0.01;
    machine.position.y = -0.8 * (1 - mOp);

    let v = 0;
    if (st === 2 && passes > 0) {
      const k = Math.min(Math.floor(passes), PASSES - 1);
      const f = passes - k;
      v = k % 2 === 0 ? f : 1 - f;
    }
    const prof = profileAt(pts, v);
    carriage.position.x = st === 2 ? prof.y : -2.75;
    setRibbon(prof.y, prof.x * grow, st === 2 && passes > 0);

    const show = st === 4 ? smooth(clamp01(frac / MOVE)) : 0;
    spinner.position.y = 0.3 * show;
    spinner.rotation.y = -0.22 * show;

    // Finished: the topcoat is smeared along the vessel, then the fittings go on.
    uniforms.uCoat.value = st === 4 ? smooth(clamp01(work / 0.55)) : 0;
    const fit = st === 4 ? clamp01((work - 0.4) / 0.55) : 0;
    fittings.position.copy(spinner.position);
    fittings.rotation.y = spinner.rotation.y;
    appear.forEach((g, n) => {
      const k = smooth(clamp01(fit * 2.2 - n * 0.14));
      g.scale.setScalar(Math.max(0.001, k));
      g.visible = k > 0.002;
    });

    // Camera: ease from the previous stage's shot, then hold.
    const from = SHOTS[Math.max(0, st - 1)];
    const to = SHOTS[st];
    const t = st === 0 ? 1 : smooth(clamp01(frac / MOVE));
    return { from, to, t };
  };

  // ---- Camera ----
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let pullBack = 1;
  const placeCamera = ({ from, to, t }: { from: Shot; to: Shot; t: number }) => {
    pos.lerpVectors(a.fromArray(from.pos), b.fromArray(to.pos), t);
    look.lerpVectors(a.fromArray(from.look), b.fromArray(to.look), t);
    // Narrow screens: pull back along the view line so the machine still fits.
    pos.sub(look).multiplyScalar(pullBack).add(look);
    camera.position.copy(pos);
    camera.lookAt(look);
  };

  // ---- Post-processing: multisampled HDR target → AO → AgX output ----
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 1.2, scale: 1.2, samples: 16 });
  gtao.blendIntensity = 0.85;
  gtao.enabled = !small;
  composer.addPass(gtao);
  composer.addPass(new OutputPass());
  // Final grade in display space: light unsharp mask, a hint of saturation and contrast.
  const grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uPx: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0.25 }, uSat: { value: 1.14 }, uContrast: { value: 1.04 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 uPx; uniform float uSharp, uSat, uContrast; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        vec3 n = texture2D(tDiffuse, vUv + vec2(uPx.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uPx.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv + vec2(0.0, uPx.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uPx.y)).rgb;
        c += (c * 4.0 - n) * uSharp;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        c = (c - 0.5) * uContrast + 0.5;
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
  };

  let goal = 0;
  let current = 0;
  let dirty = true;
  let raf = 0;
  let visible = true;
  let last = performance.now();
  const render = () => {
    placeCamera(apply(current));
    composer.render();
    dirty = false;
  };
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const before = current;
    current += (goal - current) * (1 - Math.exp(-dt * 4.5)); // calm scroll inertia
    if (Math.abs(goal - current) < 0.00005) current = goal;
    if (current !== before || dirty) render();
  };
  const start = () => {
    if (raf || opts.still) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  const ro = new ResizeObserver(() => {
    frame();
    dirty = true;
    if (!raf) render();
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
  render();
  start();

  return {
    setProgress(p) {
      goal = clamp01(p);
      if (opts.still) {
        current = goal;
        render();
      }
    },
    jump(p) {
      goal = current = clamp01(p);
      render();
    },
    dispose() {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      composer.dispose();
      target.dispose();
      envTex.dispose();
      renderer.dispose();
    },
  };
}
