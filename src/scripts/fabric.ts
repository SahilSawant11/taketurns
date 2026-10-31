/**
 * A square of woven glass-fibre cloth that drifts down the home page.
 *
 * It deliberately moves around the page (centre, off-screen, right, centre)
 * and leaves the screen during dense sections, then arrives large and calm
 * on its own stage in the finale.
 *
 * One fixed, transparent, click-through canvas sits over the page. Sections
 * opt in with data-float="<pose>"; a pose is laid out relative to its
 * section's top (or a child, data-float-ref) and scrolls with it, so the
 * cloth stays in that section's empty space. Between sections it tumbles to
 * the next pose.
 *
 * World units: the z=0 plane spans y ∈ [-1, 1] and x ∈ [-A, A] (A = aspect).
 * Pose y is measured from the reference top (0) downward.
 */
import * as THREE from 'three';
import { studioEnvironment } from './three/vessel';

const SEG = 96; // cloth mesh resolution
const TOWS = 18; // tows per side

type Pose = {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number; // width (world units)
  sy: number; // height
  curl: number; // bend around the vertical axis (1/radius)
  twist: number; // twist along the width
  wave: number; // ripple amplitude
  opacity: number;
  tone: number; // 0 = over black, 1 = over bone
};
const KEYS: (keyof Pose)[] = ['x', 'y', 'rx', 'ry', 'rz', 'sx', 'sy', 'curl', 'twist', 'wave', 'opacity', 'tone'];
const pose = (p: Partial<Pose>): Pose => ({ x: 0, y: 0, rx: 0, ry: 0, rz: 0, sx: 0.5, sy: 0.5, curl: 0, twist: 0, wave: 0.03, opacity: 1, tone: 0, ...p });

/** The journey: position deliberately varies and the cloth leaves the screen during dense sections. */
function poseFor(name: string, A: number, narrow: boolean): Pose {
  if (narrow) {
    switch (name) {
      case 'statement': return pose({ x: A * 0.68, y: 0.3, sx: 0.24, sy: 0.24, rx: -0.5, ry: 0.6, rz: 0.3, curl: 1.2 });
      case 'materials': return pose({ x: -A - 0.5, y: -0.4, sx: 0.4, sy: 0.3, rz: 0.6, opacity: 0, tone: 1 });
      case 'wall': return pose({ x: A * 0.66, y: -0.16, sx: 0.24, sy: 0.24, rx: -0.4, ry: 0.6, rz: 0.4, curl: 1.4 });
      case 'fits': return pose({ x: A + 0.5, y: -0.6, sx: 0.3, sy: 0.3, rz: -0.8, opacity: 0 });
      case 'apps': return pose({ x: A * 0.6, y: -0.15, sx: 0.24, sy: 0.24, rx: -0.5, ry: -0.6, rz: -0.2, curl: 1 });
      case 'work': return pose({ x: -A - 0.5, y: -0.3, sx: 0.3, sy: 0.3, rz: 0.9, opacity: 0, tone: 1 });
      case 'finale': return pose({ x: 0, y: -0.62, sx: 0.78, sy: 0.78, rx: -0.3, ry: 0.35, rz: 0.12, curl: 0.4, wave: 0.02 });
      default: return pose({ x: 0, y: 1.6, sx: 0.5, sy: 0.3, rz: 0.4, opacity: 0 });
    }
  }
  switch (name) {
    // Laid out from the intro block: floats at the right edge above the facts.
    case 'statement': return pose({ x: A * 0.84, y: 0.5, sx: 0.6, sy: 0.6, rx: -0.35, ry: 0.55, rz: 0.35, curl: 0.9, wave: 0.04 });
    // Slips out to the left while the dense material rows are read.
    case 'materials': return pose({ x: -A - 0.7, y: -0.5, sx: 0.7, sy: 0.5, rx: -0.6, rz: 0.7, curl: 1.5, opacity: 0, tone: 1 });
    // Small and curled beside "Layer by layer".
    case 'wall': return pose({ x: A * 0.74, y: -0.42, sx: 0.5, sy: 0.5, rx: -0.25, ry: 0.65, rz: 0.45, curl: 1.6 });
    // Leaves again, down and to the right, during the comparison columns.
    case 'fits': return pose({ x: A + 0.7, y: -1.2, sx: 0.6, sy: 0.6, rx: -0.8, rz: -0.9, twist: 0.8, opacity: 0 });
    // Returns nearer the middle, above the applications strip.
    case 'apps': return pose({ x: A * 0.22, y: -0.3, sx: 0.5, sy: 0.5, rx: -0.45, ry: -0.55, rz: -0.18, curl: 1 });
    // Off to the left while the service rows are read.
    case 'work': return pose({ x: -A - 0.7, y: -0.6, sx: 0.6, sy: 0.6, rx: -0.5, rz: 0.9, curl: 1.2, opacity: 0, tone: 1 });
    case 'proof': return pose({ x: -A - 0.6, y: -0.2, sx: 0.6, sy: 0.6, rz: 0.5, opacity: 0, tone: 1 });
    // Centred, large and calm in its own space in the finale.
    case 'finale': return pose({ x: 0, y: -0.68, sx: 0.98, sy: 0.98, rx: -0.42, ry: 0.38, rz: 0.12, curl: 0.7, twist: 0.15, wave: 0.025 });
    default: return pose({ x: 0, y: 1.7, sx: A * 1.6, sy: 0.15, rz: 0.08, wave: 0.02, opacity: 0 });
  }
}

// ---------- woven glass cloth ----------
/**
 * Plain weave computed per pixel in the shader, so it stays crisp at any size
 * and speaks the same language as the wound vessel (scripts/three/vessel.ts):
 * pale wet-glass tows over resin green, fine filaments along each tow, darker
 * tow edges. Each tow is a rounded bundle that crimps where it dives under a
 * cross-tow; the crowns drive the surface normal. Tow ends fray past the edges.
 */
function clothMaterial() {
  const uniforms = {
    uTows: { value: TOWS },
    uGlass: { value: new THREE.Color('#e4f5e9') }, // vessel uWet
    uGlassEdge: { value: new THREE.Color('#5fae80') },
    uResin: { value: new THREE.Color('#1f8a55') }, // vessel uCured
    uBump: { value: 2.2 },
  };
  // a 1×1 bump map only so three compiles in its normal-perturbation helper
  const dummy = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  dummy.needsUpdate = true;
  const mat = new THREE.MeshPhysicalMaterial({
    bumpMap: dummy,
    alphaTest: 0.5,
    roughness: 0.44,
    sheen: 0.85,
    sheenRoughness: 0.32,
    sheenColor: new THREE.Color('#e6f4ea'),
    side: THREE.DoubleSide,
    transparent: true,
  });
  mat.defines = { USE_UV: '' };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTows, uBump;
        uniform vec3 uGlass, uGlassEdge, uResin;
        float clothHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float clothH = 0.0;
        float clothFil = 1.0;
        {
          float m = 0.035;                              // fringe margin, in uv
          vec2 uv = (vUv - m) / (1.0 - 2.0 * m);        // woven body spans 0..1
          vec2 g = uv * uTows;
          vec2 cell = floor(g);
          vec2 f = fract(g);
          bool vTop = mod(cell.x + cell.y, 2.0) < 0.5;
          float gap = 0.06;
          float aV = smoothstep(gap, gap + 0.035, f.x) * (1.0 - smoothstep(1.0 - gap - 0.035, 1.0 - gap, f.x));
          float aH = smoothstep(gap, gap + 0.035, f.y) * (1.0 - smoothstep(1.0 - gap - 0.035, 1.0 - gap, f.y));
          bool inX = uv.x >= 0.0 && uv.x <= 1.0;
          bool inY = uv.y >= 0.0 && uv.y <= 1.0;
          // fringe: tows run past the edge by a random length, thinning into loose filaments
          float fr = m / (1.0 - 2.0 * m);
          float outX = max(-uv.x, uv.x - 1.0);
          float outY = max(-uv.y, uv.y - 1.0);
          float strandH = step(0.45, fract(f.y * 9.0 + clothHash(vec2(cell.y, 5.0))));
          float strandV = step(0.45, fract(f.x * 9.0 + clothHash(vec2(cell.x, 9.0))));
          float showH = inY ? aH * (inX ? 1.0 : strandH * step(outX, fr * (0.35 + 0.65 * clothHash(vec2(cell.y, 3.0))))) : 0.0;
          float showV = inX ? aV * (inY ? 1.0 : strandV * step(outY, fr * (0.35 + 0.65 * clothHash(vec2(cell.x, 7.0))))) : 0.0;

          // fine filaments along each tow; fade them out where they'd alias
          float fadeV = 1.0 - smoothstep(0.25, 0.7, fwidth(f.x * 80.0));
          float fadeH = 1.0 - smoothstep(0.25, 0.7, fwidth(f.y * 80.0));
          float filV = 1.0 + (0.84 + 0.16 * sin(f.x * 80.0 + clothHash(vec2(cell.x, 1.0)) * 6.28) - 1.0) * fadeV;
          float filH = 1.0 + (0.84 + 0.16 * sin(f.y * 80.0 + clothHash(vec2(cell.y, 2.0)) * 6.28) - 1.0) * fadeH;
          float crownV = sin(f.x * PI);
          float crownH = sin(f.y * PI);
          float crimpV = 0.72 + 0.28 * sin(f.y * PI);   // dips where it passes under
          float crimpH = 0.72 + 0.28 * sin(f.x * PI);
          float tintV = 0.95 + 0.08 * clothHash(vec2(cell.x, 11.0));
          float tintH = 0.95 + 0.08 * clothHash(vec2(cell.y, 13.0));
          vec3 cV = mix(uGlassEdge, uGlass, pow(crownV, 0.7)) * filV * tintV;
          vec3 cH = mix(uGlassEdge, uGlass, pow(crownH, 0.7)) * filH * tintH;

          vec3 col = uResin * 0.75;                     // resin green between tows
          float a = (inX && inY) ? 1.0 : 0.0;
          float h = 0.0;
          if (vTop) {
            col = mix(col, cH * 0.8 * crimpH, showH);  h = mix(h, 0.35 * crownH, showH);
            col = mix(col, cV * crimpV, showV);        h = mix(h, 0.45 + 0.55 * crownV * crimpV, showV);
          } else {
            col = mix(col, cV * 0.8 * crimpV, showV);  h = mix(h, 0.35 * crownV, showV);
            col = mix(col, cH * crimpH, showH);        h = mix(h, 0.45 + 0.55 * crownH * crimpH, showH);
          }
          a = max(a, max(showH, showV));
          diffuseColor.rgb *= col;
          diffuseColor.a *= a;
          clothH = h;
          clothFil = vTop ? filV : filH;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (1.0 - clothFil) * 0.8, 0.0, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
          vec2 dHdxy = vec2(dFdx(clothH), dFdy(clothH)) * uBump;
          normal = perturbNormalArb(-vViewPosition, normal, dHdxy, faceDirection);
        }`,
      );
  };
  return { mat, dispose: () => dummy.dispose() };
}

export function createFabric(canvas: HTMLCanvasElement, opts: { still: boolean }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.AgXToneMapping;
  const scene = new THREE.Scene();
  const env = studioEnvironment(renderer);
  scene.environment = env;
  scene.environmentIntensity = 0.65;
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(-2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ffffff', 1.2);
  rim.position.set(3, -1, -3);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 1 / Math.tan(THREE.MathUtils.degToRad(15)));

  const cloth0 = clothMaterial();
  const mat = cloth0.mat;
  const ON_DARK = new THREE.Color('#ffffff');
  const ON_LIGHT = new THREE.Color('#d2dcd5'); // a touch deeper so it reads on bone
  const geo = new THREE.PlaneGeometry(1, 1, SEG, SEG);
  const base = Float32Array.from(geo.attributes.position.array as Float32Array);
  const cloth = new THREE.Mesh(geo, mat);
  scene.add(cloth);

  // ---------- anchors ----------
  let A = 1;
  let narrow = false;
  let anchors: { y: number; name: string; el: HTMLElement }[] = [];
  const measure = () => {
    anchors = [...document.querySelectorAll<HTMLElement>('[data-float]')].map((el) => ({
      // a pose is "home" once its section's top reaches 25% of the viewport
      y: el.getBoundingClientRect().top + scrollY - innerHeight * (el.dataset.floatAt ? Number(el.dataset.floatAt) : 0.25),
      name: el.dataset.float!,
      el,
    }));
  };
  const placed = (i: number): Pose => {
    const a = anchors[i];
    const p = poseFor(a?.name ?? 'hidden', A, narrow);
    if (!a) return p;
    const ref = a.el.dataset.floatRef ? a.el.querySelector<HTMLElement>(a.el.dataset.floatRef) ?? a.el : a.el;
    p.y += 1 - (2 * ref.getBoundingClientRect().top) / innerHeight;
    return p;
  };
  const targetAt = (y: number): Pose => {
    let i = 0;
    while (i < anchors.length - 1 && y >= anchors[i + 1].y) i++;
    const a = placed(i);
    if (i >= anchors.length - 1 || y < (anchors[0]?.y ?? 0)) return a;
    const b = placed(i + 1);
    // Hold the pose while its section is read, tumble across in the last stretch.
    const k = THREE.MathUtils.smootherstep((y - anchors[i].y) / (anchors[i + 1].y - anchors[i].y), 0.45, 1);
    const out = { ...a };
    KEYS.forEach((key) => (out[key] = a[key] + (b[key] - a[key]) * k));
    // lift and spin mid-flight, like something carried on air
    const flight = Math.sin(Math.PI * k);
    out.rz += flight * 0.6;
    out.curl += flight * 0.7;
    out.wave += flight * 0.03;
    return out;
  };

  // ---------- cloth deformation ----------
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const deform = (p: Pose, time: number) => {
    const loose = 0.8;
    for (let i = 0; i < pos.count; i++) {
      let x = base[i * 3] * p.sx;
      let y = base[i * 3 + 1] * p.sy;
      let z = 0;
      const edge = Math.max(Math.abs(base[i * 3]), Math.abs(base[i * 3 + 1])) * 2;
      z += loose * p.wave * edge * Math.sin(x * 7 + y * 4 + time * 1.1) + p.wave * 0.5 * Math.sin(y * 9 - time * 0.8);
      if (Math.abs(p.curl) > 0.01) {
        const ang = x * p.curl;
        const nx = Math.sin(ang) / p.curl;
        z += (1 - Math.cos(ang)) / p.curl;
        x = nx;
      }
      if (Math.abs(p.twist) > 0.01) {
        const ang = x * p.twist;
        const ny = y * Math.cos(ang) - z * Math.sin(ang);
        z = y * Math.sin(ang) + z * Math.cos(ang);
        y = ny;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };

  // ---------- loop ----------
  const frame = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    A = camera.aspect;
    narrow = innerWidth < 760;
    measure();
  };
  frame();
  const cur = targetAt(scrollY);

  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const goal = targetAt(scrollY);
    const k = opts.still ? 1 : 1 - Math.exp(-dt * 8);
    KEYS.forEach((key) => (cur[key] += (goal[key] - cur[key]) * k));
    cloth.visible = cur.opacity > 0.01;
    if (!cloth.visible) return renderer.render(scene, camera);
    const t = opts.still ? 0 : now / 1000;
    const drift = opts.still ? 0 : 0.05;
    cloth.position.set(cur.x, cur.y, 0);
    cloth.rotation.set(cur.rx + Math.sin(t * 0.4) * drift, cur.ry + Math.sin(t * 0.33) * drift, cur.rz);
    mat.color.lerpColors(ON_DARK, ON_LIGHT, cur.tone);
    mat.opacity = cur.opacity;
    deform(cur, t);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  addEventListener('resize', frame);
  const ro = new ResizeObserver(() => measure());
  ro.observe(document.body);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', frame);
      ro.disconnect();
      cloth0.dispose();
      env.dispose();
      renderer.dispose();
    },
  };
}
