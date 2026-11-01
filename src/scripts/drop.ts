/**
 * "The drop": the object that follows the home page.
 *
 * A single drop of aggressive liquid, the thing every wall on this site is
 * engineered to hold. It sits beside each section's headline; between
 * sections it falls to the next one, stretching into a teardrop with speed and
 * wobbling when it stops. Over dark sections it reads as clear liquid (bright
 * rim, highlights, a caustic glow); over light and green ones as dark, glossy
 * liquid. In the finale it falls into a cut-away FRP wall, splashes, and is
 * held there.
 *
 * One fixed, click-through canvas sits over the page. Sections opt in with
 * data-float="<pose>"; a pose is laid out relative to its section's top (or a
 * child, data-float-ref) and scrolls with it. Supporting cast: a soft shadow
 * on the page, a few small drops drifting at depth, splash droplets, and a
 * lean towards the cursor.
 *
 * World units: the z=0 plane spans y ∈ [-1, 1] and x ∈ [-A, A] (A = aspect).
 */
import * as THREE from 'three';
import { PASSES, laminateMaterial, laminateUniforms, studioEnvironment } from './three/vessel';

type Pose = {
  x: number;
  y: number;
  r: number; // drop radius (world units)
  opacity: number;
  cup: number; // 0–1 the holding wall is in place (finale)
  rest: number; // 0–1 the drop has settled into it
};
const KEYS: (keyof Pose)[] = ['x', 'y', 'r', 'opacity', 'cup', 'rest'];
const pose = (p: Partial<Pose>): Pose => ({ x: 0, y: 0, r: 0.2, opacity: 1, cup: 0, rest: 0, ...p });

/** Beside each headline (they all sit on the left), off-screen during dense sections. */
function poseFor(name: string, A: number, narrow: boolean): Pose {
  if (narrow) {
    // Headlines run full width on phones: sit small in the space above each section's label.
    const top = (r: number) => -0.06 - r;
    switch (name) {
      case 'statement': return pose({ x: A * 0.7, y: top(0.075), r: 0.075 });
      case 'materials': return pose({ x: A * 0.7, y: top(0.085), r: 0.085 });
      case 'wall': return pose({ x: A * 0.7, y: top(0.07), r: 0.07 });
      case 'fits': return pose({ x: A + 0.4, y: -0.5, r: 0.07, opacity: 0 });
      case 'apps': return pose({ x: A * 0.7, y: top(0.07), r: 0.07 });
      case 'work': return pose({ x: A * 0.7, y: top(0.07), r: 0.07 });
      case 'proof': return pose({ x: 0, y: 0.9, r: 0.1, opacity: 0 });
      case 'finale': return pose({ x: 0, y: -0.48, r: 0.12, cup: 1, rest: 1 });
      default: return pose({ x: A * 0.3, y: 1.4, r: 0.08, opacity: 0 });
    }
  }
  switch (name) {
    case 'statement': return pose({ x: A * 0.7, y: -0.55, r: 0.2 });
    // "Three ways to protect what's inside": the thing being protected
    case 'materials': return pose({ x: A * 0.5, y: -0.62, r: 0.24 });
    case 'wall': return pose({ x: A * 0.62, y: -0.55, r: 0.16 });
    case 'fits': return pose({ x: A + 0.5, y: -0.9, r: 0.16, opacity: 0 });
    case 'apps': return pose({ x: A * 0.55, y: -0.5, r: 0.17 });
    case 'work': return pose({ x: A * 0.55, y: -0.6, r: 0.15 });
    // waits above the screen, so the finale is a fall from overhead
    case 'proof': return pose({ x: 0, y: 0.9, r: 0.16, opacity: 0 });
    // lands in the holding wall on the finale's own stage
    case 'finale': return pose({ x: 0, y: -0.6, r: 0.16, cup: 1, rest: 1 });
    default: return pose({ x: A * 0.55, y: 1.5, r: 0.18, opacity: 0 });
  }
}

// ---------- drop material ----------
const DROP_VERT = /* glsl */ `
  uniform float uR, uStretch, uA2, uA3, uSquash, uTime;
  uniform vec3 uAxis;
  vec3 dropP(vec3 p) {
    float c = dot(p, uAxis);
    // surface oscillation: the two lowest modes of a liquid drop, plus a faint shimmer
    float r = 1.0 + uA2 * 0.5 * (3.0 * c * c - 1.0) + uA3 * 0.5 * (5.0 * c * c * c - 3.0 * c);
    r += 0.01 * sin(uTime * 2.1 + p.x * 3.0 + p.y * 2.0) + 0.006 * sin(uTime * 3.3 - p.z * 4.0);
    vec3 q = p * r;
    // teardrop: the tail trails behind the motion; the body slims to keep its volume
    float t = max(-c, 0.0);
    q -= uAxis * uStretch * t * t * t * 1.1;
    vec3 side = q - uAxis * dot(q, uAxis);
    q -= side * uStretch * 0.2;
    // resting: settles under its own weight onto a flat-ish bottom
    q.y *= 1.0 - 0.28 * uSquash;
    q.xz *= 1.0 + 0.16 * uSquash;
    float fl = -(1.0 - 0.36 * uSquash);
    float k = 14.0;
    q.y = mix(q.y, fl + log(1.0 + exp((q.y - fl) * k)) / k, uSquash);
    return q * uR;
  }`;

type DropUniforms = ReturnType<typeof dropUniforms>;
function dropUniforms(key: THREE.Vector3) {
  return {
    uR: { value: 0.2 },
    uStretch: { value: 0 },
    uA2: { value: 0 },
    uA3: { value: 0 },
    uSquash: { value: 0 },
    uTime: { value: 0 },
    uAxis: { value: new THREE.Vector3(0, -1, 0) },
    uCore: { value: 0.18 }, // opacity through the middle of the drop
    uCaustic: { value: 1 },
    uFade: { value: 1 },
    uGlow: { value: new THREE.Color('#c8f7da') },
    uKey: { value: key.clone().normalize() },
  };
}

function dropMaterial(uniforms: DropUniforms) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#2c4237',
    roughness: 0.04,
    metalness: 0,
    ior: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.6,
    transparent: true,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${DROP_VERT}`)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal;
        {
          vec3 p = normalize(position);
          vec3 t1 = normalize(cross(p, abs(p.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
          vec3 t2 = cross(p, t1);
          float e = 0.01;
          vec3 du = dropP(normalize(p + t1 * e)) - dropP(normalize(p - t1 * e));
          vec3 dv = dropP(normalize(p + t2 * e)) - dropP(normalize(p - t2 * e));
          objectNormal = normalize(cross(du, dv));
          if (dot(objectNormal, dropP(p)) < 0.0) objectNormal = -objectNormal;
        }`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = dropP(normalize(position));');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uCore, uCaustic, uFade;\nuniform vec3 uGlow, uKey;`)
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 n = normalize(normal);
          vec3 v = normalize(vViewPosition);
          float fres = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.2);
          // light focused through the drop gathers on the side away from the key light
          vec3 keyV = normalize((viewMatrix * vec4(uKey, 0.0)).xyz);
          float caus = pow(max(dot(n, -keyV), 0.0), 6.0) * (1.0 - fres);
          // clear liquid on dark: a bright meniscus rim and a glowing caustic
          vec3 col = outgoingLight + uGlow * caus * uCaustic * 1.6 + uGlow * fres * uCaustic * 0.55;
          float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          float a = mix(uCore, 1.0, fres);
          a = clamp(a + lum * 0.85 + caus * uCaustic * 0.7, 0.0, 1.0);
          gl_FragColor = vec4(col, a * opacity * uFade);
        }`,
      );
  };
  return mat;
}

// ---------- the holding wall ----------
/**
 * A thick FRP dish with a quarter cut away towards the viewer, so the wall's
 * layers show in section: resin-rich liner, structural laminate, topcoat.
 * The same idea as "Inside the wall", holding the drop.
 */
function holdingWall() {
  const R = 1;
  const depth = 0.52;
  const wall = 0.22;
  const yIn = (r: number) => -depth + depth * Math.pow(Math.min(r / R, 1), 1.6);
  const yOut = (r: number) => -depth - wall + (depth + wall) * Math.pow(Math.min(r / (R + wall), 1), 1.6);
  const pts: THREE.Vector2[] = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const r = (i / N) * (R + wall);
    pts.push(new THREE.Vector2(Math.max(r, 0.001), yOut(r)));
  }
  pts.push(new THREE.Vector2(R + wall * 0.5, 0.03));
  for (let i = N; i >= 0; i--) {
    const r = (i / N) * R;
    pts.push(new THREE.Vector2(Math.max(r, 0.001), yIn(r)));
  }
  const group = new THREE.Group();
  const cut = Math.PI / 2; // the missing wedge, centred on the viewer
  const geo = new THREE.LatheGeometry(pts, 120, cut / 2, Math.PI * 2 - cut);
  const u = laminateUniforms();
  u.uProgress.value = PASSES;
  u.uVeil.value = 1;
  u.uCure.value = 1;
  u.uCoat.value = 1;
  const shell = laminateMaterial(u);
  shell.side = THREE.DoubleSide;
  group.add(new THREE.Mesh(geo, shell));

  // Section faces: the profile as a flat shape, coloured by depth through the wall.
  const shapeGeo = new THREE.ShapeGeometry(new THREE.Shape(pts), 1);
  const faceUniforms = { uDepth: { value: depth }, uWall: { value: wall }, uR: { value: R } };
  const face = new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide, transparent: true });
  face.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, faceUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSec;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSec = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSec;\nuniform float uDepth, uWall, uR;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float r = vSec.x;
          float yi = -uDepth + uDepth * pow(min(r / uR, 1.0), 1.6);
          float yo = -uDepth - uWall + (uDepth + uWall) * pow(min(r / (uR + uWall), 1.0), 1.6);
          float t = clamp((yi - vSec.y) / max(yi - yo, 0.001), 0.0, 1.0); // 0 inside → 1 outside
          vec3 liner = vec3(0.86, 0.93, 0.88);
          // structural laminate: wound layers seen end-on, as fine bands through the thickness
          vec3 structural = vec3(0.20, 0.55, 0.37) * (0.82 + 0.18 * sin(t * 70.0));
          vec3 topcoat = vec3(0.04, 0.24, 0.15);
          vec3 c = t < 0.2 ? liner : t < 0.84 ? structural : topcoat;
          // thin bright lines where the layers meet
          float edge = smoothstep(0.02, 0.0, abs(t - 0.2)) + smoothstep(0.02, 0.0, abs(t - 0.84));
          diffuseColor.rgb = mix(c, vec3(0.92), edge * 0.5);
        }`,
      );
  };
  for (const phi of [cut / 2, Math.PI * 2 - cut / 2]) {
    const m = new THREE.Mesh(shapeGeo, face);
    // the shape's +x is the profile radius; at lathe angle phi that points along (sin φ, 0, cos φ)
    m.rotation.y = phi - Math.PI / 2;
    group.add(m);
  }
  return {
    group,
    innerDepth: depth,
    setOpacity(a: number) {
      shell.opacity = a;
      face.opacity = a;
    },
    dispose() {
      geo.dispose();
      shapeGeo.dispose();
      shell.dispose();
      face.dispose();
    },
  };
}

// ---------- soft shadow on the page ----------
function softShadow() {
  const uniforms = { uA: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform float uA; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(0.0, 0.01, 0.005, uA * exp(-d * d * 4.0) * (1.0 - smoothstep(0.85, 1.0, d))); }',
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = 0;
  return { mesh, uniforms, dispose: () => (mesh.geometry.dispose(), mat.dispose()) };
}

export function createDrop(canvas: HTMLCanvasElement, opts: { still: boolean }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.AgXToneMapping;
  const scene = new THREE.Scene();
  const env = studioEnvironment(renderer);
  scene.environment = env;
  const keyPos = new THREE.Vector3(-2, 3, 4);
  const key = new THREE.DirectionalLight('#ffffff', 3);
  key.position.copy(keyPos);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#ffffff', 2);
  rim.position.set(3, -1, -3);
  scene.add(rim);
  // soft fill from below the front, so the wall's underside isn't a black hole
  const fill = new THREE.DirectionalLight('#dfeee6', 0.9);
  fill.position.set(0.5, -2, 3);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 1 / Math.tan(THREE.MathUtils.degToRad(15)));

  // The drop.
  const U = dropUniforms(keyPos);
  const mat = dropMaterial(U);
  const geo = new THREE.IcosahedronGeometry(1, 40);
  const drop = new THREE.Mesh(geo, mat);
  drop.frustumCulled = false;
  drop.renderOrder = 3;
  scene.add(drop);

  // Small drops drifting at depth, moving with parallax as the page scrolls.
  const smallGeo = new THREE.IcosahedronGeometry(1, 12);
  const motes = [
    { x: 0.92, y: 0.55, z: -1.6, r: 0.05, speed: 0.55 },
    { x: 0.22, y: -0.35, z: -2.4, r: 0.04, speed: 0.4 },
    { x: 0.78, y: -0.85, z: -1.2, r: 0.035, speed: 0.7 },
    { x: 0.5, y: 0.95, z: -3.0, r: 0.06, speed: 0.3 },
    { x: 1.05, y: -0.1, z: -2.0, r: 0.03, speed: 0.5 },
  ].map((m, i) => {
    const u = dropUniforms(keyPos);
    u.uR.value = m.r;
    const mesh = new THREE.Mesh(smallGeo, dropMaterial(u));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    return { ...m, u, mesh, phase: i * 1.7, y0: m.y };
  });

  // The cut-away wall, the splash, and the shadow.
  const cup = holdingWall();
  scene.add(cup.group);
  const SPLASH = 7;
  const splashMat = new THREE.MeshPhysicalMaterial({ color: '#0f1d16', roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6 });
  const splash = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 3), splashMat, SPLASH);
  splash.frustumCulled = false;
  splash.renderOrder = 4;
  splash.count = 0;
  scene.add(splash);
  const bits = Array.from({ length: SPLASH }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, life: 0 }));
  const shadow = softShadow();
  scene.add(shadow.mesh);

  // Clear liquid over dark sections, dark glossy liquid over light and green ones.
  const CLEAR = new THREE.Color('#2c4237');
  const INK = new THREE.Color('#0f1d16');

  // ---------- anchors ----------
  let A = 1;
  let narrow = false;
  let anchors: { y: number; name: string; el: HTMLElement; ref: HTMLElement; light: number }[] = [];
  const measure = () => {
    anchors = [...document.querySelectorAll<HTMLElement>('[data-float]')].map((el) => {
      const ref = el.dataset.floatRef ? el.querySelector<HTMLElement>(el.dataset.floatRef) ?? el : el;
      return {
        // a pose is "home" once its section's top reaches 25% of the viewport;
        // one with its own stage (the finale) arrives once that stage is well in view
        y:
          ref !== el
            ? ref.getBoundingClientRect().top + scrollY - innerHeight * 0.45
            : el.getBoundingClientRect().top + scrollY - innerHeight * (el.dataset.floatAt ? Number(el.dataset.floatAt) : 0.25),
        name: el.dataset.float!,
        el,
        ref,
        light: el.classList.contains('tone-light') || el.classList.contains('tone-green') ? 1 : 0,
      };
    });
  };
  const placed = (i: number): Pose => {
    const a = anchors[i];
    const p = poseFor(a?.name ?? 'hidden', A, narrow);
    if (!a) return p;
    p.y += 1 - (2 * a.ref.getBoundingClientRect().top) / innerHeight;
    return p;
  };
  const targetAt = (y: number): Pose => {
    let i = 0;
    while (i < anchors.length - 1 && y >= anchors[i + 1].y) i++;
    const a = placed(i);
    if (i >= anchors.length - 1 || y < (anchors[0]?.y ?? 0)) return a;
    const b = placed(i + 1);
    // Hold beside the headline while the section is read, then fall to the next one.
    const k = THREE.MathUtils.smootherstep((y - anchors[i].y) / (anchors[i + 1].y - anchors[i].y), 0.5, 1);
    const out = { ...a };
    KEYS.forEach((key) => (out[key] = a[key] + (b[key] - a[key]) * k));
    // gravity: drift sideways evenly, but fall with growing speed
    out.y = a.y + (b.y - a.y) * k * k;
    // the wall comes up before the drop arrives; it settles only at the very end
    out.cup = a.cup + (b.cup - a.cup) * THREE.MathUtils.smoothstep(k, 0.2, 0.7);
    out.rest = a.rest + (b.rest - a.rest) * THREE.MathUtils.smoothstep(k, 0.85, 1);
    return out;
  };
  /** Light or dark section under a point (0 dark → 1 light/green). */
  const toneAt = (yWorld: number) => {
    const py = ((1 - yWorld) / 2) * innerHeight;
    let light = 0;
    for (const a of anchors) {
      if (a.el.tagName !== 'SECTION') continue;
      const r = a.el.getBoundingClientRect();
      if (py >= r.top && py <= r.bottom) light = a.light;
    }
    return light;
  };

  // ---------- pointer: the drop leans towards a nearby cursor ----------
  const ptr = { x: 9, y: 9, vx: 0, vy: 0, t: 0 };
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const x = ((e.clientX / innerWidth) * 2 - 1) * A;
    const y = 1 - (e.clientY / innerHeight) * 2;
    const now = performance.now();
    const dt = Math.max((now - ptr.t) / 1000, 0.008);
    ptr.vx = (x - ptr.x) / dt;
    ptr.vy = (y - ptr.y) / dt;
    ptr.x = x;
    ptr.y = y;
    ptr.t = now;
  };
  addEventListener('pointermove', onPointer, { passive: true });

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
  let tone = toneAt(cur.y);

  // Liquid dynamics: velocity relative to the page drives the teardrop; changes
  // in that velocity ring the drop's two lowest wobble modes.
  const vel = new THREE.Vector2();
  const lastPos = new THREE.Vector2(cur.x, cur.y);
  let lastScroll = scrollY;
  const axis = new THREE.Vector3(0, -1, 0);
  const axisGoal = new THREE.Vector3();
  const lean = new THREE.Vector2();
  let stretch = 0;
  const m2 = { a: 0, v: 0 };
  const m3 = { a: 0, v: 0 };
  let wasRest = cur.rest;
  const ring = (m: { a: number; v: number }, w: number, z: number, f: number, dt: number) => {
    const n = 4;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      m.v += (-w * w * m.a - 2 * z * w * m.v + f) * h;
      m.a += m.v * h;
    }
    m.a = THREE.MathUtils.clamp(m.a, -0.3, 0.3);
  };
  const dummy = new THREE.Object3D();
  const splashAt = (x: number, y: number, r: number) => {
    bits.forEach((b, i) => {
      const ang = (i / SPLASH) * Math.PI * 2 + Math.random() * 0.5;
      b.p.set(x + Math.cos(ang) * r * 0.6, y, Math.sin(ang) * r * 0.6);
      b.v.set(Math.cos(ang) * (0.25 + Math.random() * 0.25), 0.7 + Math.random() * 0.5, Math.sin(ang) * 0.2);
      b.r = r * (0.06 + Math.random() * 0.07);
      b.life = 1;
    });
  };

  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (dt <= 0) return;
    const goal = targetAt(scrollY);
    const k = opts.still ? 1 : 1 - Math.exp(-dt * 6);
    KEYS.forEach((key) => (cur[key] += (goal[key] - cur[key]) * k));
    canvas.style.opacity = cur.opacity.toFixed(3);
    const t = opts.still ? 0 : now / 1000;

    // velocity relative to the page (the page itself moves up as you scroll)
    const scrollV = (scrollY - lastScroll) / dt;
    lastScroll = scrollY;
    const pageV = scrollV * (2 / innerHeight);
    if (cur.opacity < 0.01) {
      // nothing to show: keep state fresh, skip the draw
      lastPos.set(cur.x, cur.y);
      vel.set(0, 0);
      return;
    }
    const vx = (cur.x - lastPos.x) / dt;
    const vy = (cur.y - lastPos.y) / dt - pageV;
    lastPos.set(cur.x, cur.y);
    const ax = (vx - vel.x) / dt;
    const ay = (vy - vel.y) / dt;
    vel.set(vx, vy);
    const speed = Math.hypot(vx, vy);

    if (!opts.still) {
      // point the drop's head along its motion; at rest it hangs with gravity
      axisGoal.set(vx, vy, 0.15 * speed).normalize();
      if (speed < 0.05) axisGoal.set(0, -1, 0);
      axis.lerp(axisGoal, 1 - Math.exp(-dt * 8)).normalize();
      stretch += (THREE.MathUtils.clamp(speed * 0.35, 0, 0.85) * (1 - cur.rest) - stretch) * (1 - Math.exp(-dt * 10));
      const along = ax * axis.x + ay * axis.y;
      const across = -ax * axis.y + ay * axis.x;
      // a slow breath keeps it alive while the page is still
      const breath = 0.35 * Math.sin(t * 1.3) + 0.2 * Math.sin(t * 2.1 + 1.0);
      // cursor nearby: lean towards it a little, and ripple if it moves across the drop
      const dx = ptr.x - cur.x;
      const dy = ptr.y - cur.y;
      const near = 1 - THREE.MathUtils.smoothstep(Math.hypot(dx, dy) / cur.r, 1.0, 2.6);
      lean.x += (dx * 0.18 * near - lean.x) * (1 - Math.exp(-dt * 6));
      lean.y += (dy * 0.18 * near - lean.y) * (1 - Math.exp(-dt * 6));
      const poke = near * THREE.MathUtils.clamp(Math.hypot(ptr.vx, ptr.vy) * 0.6, 0, 4);
      ptr.vx *= Math.exp(-dt * 8);
      ptr.vy *= Math.exp(-dt * 8);
      ring(m2, 15, 0.12, THREE.MathUtils.clamp(along * 0.06, -6, 6) + breath + poke, dt);
      ring(m3, 23, 0.14, THREE.MathUtils.clamp(across * 0.05, -6, 6) + poke * 0.6, dt);
      // landing in the wall: one firm splat and a few droplets thrown up
      if (cur.rest > 0.6 && wasRest <= 0.6) {
        m2.v -= 2.4;
        splashAt(cur.x, cur.y - cur.r * 0.6, cur.r);
      }
      wasRest = cur.rest;
    }

    // tone follows the section under the drop
    tone += (toneAt(cur.y) - tone) * (1 - Math.exp(-dt * 5));
    const applyTone = (u: DropUniforms, m: THREE.MeshPhysicalMaterial, tn: number) => {
      u.uCore.value = THREE.MathUtils.lerp(0.18, 0.94, tn);
      u.uCaustic.value = 1 - tn * 0.8;
      m.color.lerpColors(CLEAR, INK, tn);
    };
    applyTone(U, mat, tone);

    U.uR.value = cur.r;
    U.uAxis.value.copy(axis);
    U.uStretch.value = stretch;
    U.uA2.value = m2.a;
    U.uA3.value = m3.a;
    U.uSquash.value = cur.rest;
    U.uTime.value = t;
    drop.position.set(cur.x + lean.x, cur.y + lean.y, 0);

    // Small drops: further ones drift slower; they stretch with the scroll.
    const sv = THREE.MathUtils.clamp(-pageV, -6, 6);
    for (const m of motes) {
      const depth = camera.position.z / (camera.position.z - m.z); // screen scale at that depth
      m.y0 += (pageV * m.speed * 0.4 + 0.01 * m.speed) * dt;
      if (m.y0 > 1.5) m.y0 -= 3;
      if (m.y0 < -1.5) m.y0 += 3;
      const wy = (m.y0 + 0.03 * Math.sin(t * 0.5 + m.phase)) / depth;
      m.mesh.position.set((m.x * A) / depth, wy, m.z);
      m.u.uTime.value = t + m.phase;
      m.u.uAxis.value.set(0, sv > 0 ? -1 : 1, 0);
      m.u.uStretch.value = THREE.MathUtils.clamp(Math.abs(sv) * m.speed * 0.08, 0, 0.6) * (1 - cur.cup);
      m.u.uFade.value = 0.55 * (1 - cur.cup);
      m.mesh.visible = m.u.uFade.value > 0.01;
      applyTone(m.u, m.mesh.material as THREE.MeshPhysicalMaterial, toneAt(m.y0));
    }

    // The holding wall waits on the finale's stage (not with the drop), so the drop falls into it.
    const fi = anchors.findIndex((an) => an.name === 'finale');
    const home = fi >= 0 ? placed(fi) : cur;
    const cupScale = home.r * 2.3;
    const tilt = 0.38;
    cup.group.visible = cur.cup > 0.01;
    cup.group.scale.setScalar(cupScale);
    // turned so one cut face is square to the viewer, showing the wall in section
    cup.group.rotation.set(tilt, Math.PI / 4 + 0.08 * Math.sin(t * 0.3), 0);
    const restY = home.y - home.r * (1 - 0.36) * (1 - 0.28);
    cup.group.position.set(home.x, restY + cup.innerDepth * cupScale * Math.cos(tilt) - (1 - cur.cup) * 0.25, -0.05);
    cup.setOpacity(cur.cup);

    // Splash droplets: thrown up, fall back into the wall.
    let live = 0;
    for (const b of bits) {
      if (b.life <= 0) continue;
      b.v.y -= 3.4 * dt;
      b.p.addScaledVector(b.v, dt);
      b.life -= dt * 1.4;
      if (b.p.y < restY - 0.02) b.life = 0;
      if (b.life <= 0) continue;
      dummy.position.copy(b.p);
      dummy.scale.setScalar(b.r * Math.min(1, b.life * 2));
      dummy.updateMatrix();
      splash.setMatrixAt(live++, dummy.matrix);
    }
    splash.count = live;
    splash.instanceMatrix.needsUpdate = true;

    // Shadow on the page: down and right of the key light, softer and lighter as
    // the drop moves (it's lifting off the page); none once it's in the wall.
    const lift = THREE.MathUtils.clamp(speed * 0.5, 0, 1);
    shadow.mesh.position.set(cur.x + lean.x + cur.r * (0.35 + 0.3 * lift), cur.y + lean.y - cur.r * (0.55 + 0.4 * lift), -0.4);
    shadow.mesh.scale.set(cur.r * (2.6 + lift), cur.r * (2.6 + lift) * (1 + stretch * 0.8), 1);
    shadow.uniforms.uA.value = (0.12 + 0.2 * tone) * (1 - 0.6 * lift) * (1 - cur.cup);

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
      removeEventListener('pointermove', onPointer);
      ro.disconnect();
      geo.dispose();
      mat.dispose();
      smallGeo.dispose();
      motes.forEach((m) => (m.mesh.material as THREE.Material).dispose());
      splash.geometry.dispose();
      splashMat.dispose();
      cup.dispose();
      shadow.dispose();
      env.dispose();
      renderer.dispose();
    },
  };
}
