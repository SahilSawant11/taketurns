/**
 * "The leaf": the object that follows the home page.
 *
 * One leaf, for clean air: what the plant's FRP scrubbers, ducts and tanks
 * are there to protect. It rests beside each section's headline with a slow
 * flutter. Between sections it glides down to the next one the way a real
 * leaf falls: swinging side to side, banking into each swing, and turning
 * over once mid-fall. Its colour flips with each section: pale and backlit on
 * dark and green, deep green on bone. In the finale it drifts down to a cut peepal
 * sprig centred over the finale's stage (scripts/blender/twig.py), catches
 * it by its stalk and swings down to hang there beside an older leaf and a
 * young copper one, swaying on its stalk.
 *
 * One fixed, click-through canvas sits over the page. Sections opt in with
 * data-float="<pose>"; a pose is laid out relative to its section's top (or a
 * child, data-float-ref) and scrolls with it. Supporting cast: a soft shadow
 * on the page, a few small leaves drifting at depth, and a breeze from a
 * fast-moving cursor.
 *
 * World units: the z=0 plane spans y ∈ [-1, 1] and x ∈ [-A, A] (A = aspect).
 */
import * as THREE from 'three';
import { studioEnvironment } from './three/vessel';
import { frameLoop } from './motion';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

type Pose = {
  x: number;
  y: number;
  s: number; // leaf length (world units)
  opacity: number;
  rest: number; // 0–1 hanging from the finale's twig
};
const KEYS: (keyof Pose)[] = ['x', 'y', 's', 'opacity', 'rest'];
const pose = (p: Partial<Pose>): Pose => ({ x: 0, y: 0, s: 0.5, opacity: 1, rest: 0, ...p });

/** Our plume's position from the hero (CSS px in the hero's stage), in world units. */
function plumeAt(A: number) {
  const p = (window as unknown as { __plume?: { x: number; y: number } }).__plume;
  return p ? { x: ((p.x / innerWidth) * 2 - 1) * A, y: 1 - (2 * p.y) / innerHeight } : { x: A * 0.1, y: 0.2 };
}

/** Beside each headline (they all sit on the left), off-screen during dense sections. */
function poseFor(name: string, A: number, narrow: boolean): Pose {
  // Born in the clean plume at the end of the hero: tiny and unseen, then rising out of it.
  if (name === 'plume') return pose({ ...plumeAt(A), s: 0.05, opacity: 0 });
  if (name === 'rise') {
    const p = plumeAt(A);
    return pose({ x: p.x + 0.12, y: p.y + 0.3, s: narrow ? 0.14 : 0.26 });
  }
  if (narrow) {
    // Headlines run full width on phones: sit small in the space above each section's label.
    const top = (s: number) => -0.08 - s * 0.45;
    switch (name) {
      case 'statement': return pose({ x: A * 0.68, y: top(0.2), s: 0.2 });
      case 'materials': return pose({ x: A * 0.68, y: top(0.22), s: 0.22 });
      case 'wall': return pose({ x: A * 0.68, y: top(0.19), s: 0.19 });
      case 'fits': return pose({ x: A + 0.4, y: -0.5, s: 0.19, opacity: 0 });
      case 'apps': return pose({ x: A * 0.68, y: top(0.19), s: 0.19 });
      case 'work': return pose({ x: A * 0.68, y: top(0.19), s: 0.19 });
      case 'proof': return pose({ x: -A * 0.2, y: 1.0, s: 0.22, opacity: 0 });
      case 'finale': return hanging(twigNode(true));
      default: return pose({ x: A * 0.3, y: 1.4, s: 0.2, opacity: 0 });
    }
  }
  switch (name) {
    case 'statement': return pose({ x: A * 0.7, y: -0.55, s: 0.52 });
    // "Three ways to protect what's inside": the thing being protected
    case 'materials': return pose({ x: A * 0.52, y: -0.62, s: 0.6 });
    case 'wall': return pose({ x: A * 0.64, y: -0.55, s: 0.42 });
    case 'fits': return pose({ x: A + 0.5, y: -0.9, s: 0.42, opacity: 0 });
    case 'apps': return pose({ x: A * 0.56, y: -0.5, s: 0.44 });
    case 'work': return pose({ x: A * 0.56, y: -0.6, s: 0.4 });
    // waits above the screen, so the finale is a drift down from overhead
    case 'proof': return pose({ x: -A * 0.25, y: 1.0, s: 0.44, opacity: 0 });
    // comes to hang from the twig over the finale's stage
    case 'finale': return hanging(twigNode(false));
    default: return pose({ x: A * 0.55, y: 1.5, s: 0.46, opacity: 0 });
  }
}

// ---------- the finale's twig ----------
/** The sprig's middle, from its bud's tip (−0.45) to its cut end (2.35), in leaf lengths from the hero leaf's node. */
const SPRIG_MID = 0.95;
/** Where the leaf's stalk meets the twig, relative to the finale stage's top, and the leaf's size there: the sprig sits centred. */
function twigNode(narrow: boolean) {
  const s = narrow ? 0.26 : 0.46;
  return { x: -SPRIG_MID * s, y: narrow ? -0.4 : -0.42, s };
}
/** Hanging from the twig: tip down and to the right, tipped a little towards us. */
const HANG = { roll: -2.55, pitch: -0.35 };
/** The pose for a leaf hanging from a node: its centre is about 0.62 leaf-lengths out along the blade. */
function hanging(n: { x: number; y: number; s: number }) {
  const r = 0.62 * n.s;
  return pose({ x: n.x - Math.sin(HANG.roll) * r, y: n.y + Math.cos(HANG.roll) * r * Math.cos(HANG.pitch), s: n.s, rest: 1 });
}
/** The end of a leaf's stalk in its own (bent) space, for hanging it by that point. */
function stalkEnd(u: LeafUniforms, out: THREE.Vector3) {
  const yc = -0.62;
  const z = -u.uCurl.value * yc * yc;
  const a = u.uTwist.value * yc;
  return out.set(z * Math.sin(a), yc, z * Math.cos(a)).multiplyScalar(u.uS.value);
}

// ---------- leaf material ----------
/**
 * The leaf is a subdivided plane in leaf space: x ∈ [-0.5, 0.5] across,
 * y ∈ [-0.2, 1] from the stem's end to the tip (blade from 0 to 1). The
 * vertex shader folds it along the midrib, curls it lengthwise, twists it and
 * runs a flutter wave from stem to tip. The fragment shader cuts the outline
 * and draws the veins.
 */
const LEAF_COMMON = /* glsl */ `
  uniform float uS, uFold, uCurl, uTwist, uFlutter, uTime;
  varying vec2 vLeaf;
  vec3 leafP(vec2 p) {
    float x = p.x;
    float yc = p.y - 0.42; // pivot near the widest part
    float t = clamp(p.y, 0.0, 1.0);
    float z = uFold * abs(x) - uCurl * yc * yc;
    // a faint crinkle at the margins, and a flutter wave running out to the tip
    z += 0.018 * sin(p.y * 15.0 + x * 4.0) * abs(x) * 2.0;
    z += uFlutter * 0.09 * sin(p.y * 6.5 - uTime * 8.0) * t * t * (0.4 + abs(x) * 2.0);
    float a = uTwist * yc;
    float c = cos(a), s = sin(a);
    return vec3(x * c + z * s, yc, -x * s + z * c) * uS;
  }`;

const LEAF_FRAG = /* glsl */ `
  uniform vec3 uTop, uBack, uVein, uGlow, uKey;
  uniform float uTrans, uFade, uUseTex;
  uniform sampler2D uDetail;
  varying vec2 vLeaf;
  float halfW(float y) {
    float t = clamp(y, 0.0, 1.0);
    return 0.34 * pow(max(sin(3.14159265 * pow(t, 0.72)), 0.0), 0.85);
  }`;

type LeafUniforms = ReturnType<typeof leafUniforms>;
function leafUniforms(back: THREE.Vector3) {
  return {
    uS: { value: 0.5 },
    uFold: { value: 0.18 },
    uCurl: { value: 0.25 },
    uTwist: { value: 0 },
    uFlutter: { value: 0.3 },
    uTime: { value: 0 },
    uTop: { value: new THREE.Color() },
    uBack: { value: new THREE.Color() },
    uVein: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uKey: { value: back.clone().normalize() }, // the light behind the leaf, for translucency
    uTrans: { value: 1 },
    uFade: { value: 1 },
    // the peepal from Blender (scripts/blender/leaf.py): R albedo, G veins, B margin, A cutout
    uDetail: { value: null as THREE.Texture | null },
    uUseTex: { value: 0 },
  };
}

function leafMaterial(uniforms: LeafUniforms) {
  const mat = new THREE.MeshPhysicalMaterial({
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
    sheen: 0.4,
    sheenRoughness: 0.6,
    envMapIntensity: 0.9,
    side: THREE.DoubleSide,
    transparent: true,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${LEAF_COMMON}`)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal;
        {
          float e = 0.004;
          vec3 du = leafP(position.xy + vec2(e, 0.0)) - leafP(position.xy - vec2(e, 0.0));
          vec3 dv = leafP(position.xy + vec2(0.0, e)) - leafP(position.xy - vec2(0.0, e));
          objectNormal = normalize(cross(du, dv));
        }`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = leafP(position.xy);\nvLeaf = position.xy;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${LEAF_FRAG}`)
      .replace(
        '#include <map_fragment>',
        `float leafA, leafVein;
        if (uUseTex > 0.5) {
          // the peepal: silhouette, veins and shading detail baked in Blender
          vec4 dt = texture2D(uDetail, vec2(vLeaf.x + 0.5, (vLeaf.y + 0.2) / 1.2));
          leafA = clamp((dt.a - 0.5) / (fwidth(dt.a) + 1e-4) + 0.5, 0.0, 1.0);
          if (leafA < 0.02) discard;
          leafVein = dt.g;
          vec3 c = gl_FrontFacing ? uTop : uBack;
          c *= dt.r / 0.86;
          diffuseColor.rgb = mix(c, uVein, leafVein * 0.55);
        } else {
          float x = vLeaf.x, y = vLeaf.y;
          float ax = abs(x);
          float w = halfW(y);
          float d = ax - w;
          float aa = fwidth(d) * 1.2 + 1e-4;
          float blade = (1.0 - smoothstep(-aa, aa, d)) * step(0.0, y);
          // stem: thin, tapering, curving slightly
          float sx = x - 0.22 * y * y;
          float sw = 0.009 + 0.007 * clamp((y + 0.18) / 0.2, 0.0, 1.0);
          float sd = abs(sx) - sw;
          float saa = fwidth(sd) * 1.2 + 1e-4;
          float stem = (1.0 - smoothstep(-saa, saa, sd)) * step(-0.18, y) * step(y, 0.04);
          leafA = max(blade, stem);
          if (leafA < 0.02) discard;
          // veins: a midrib that thins to the tip, and secondaries running up and out
          float mw = 0.012 * (1.0 - 0.75 * clamp(y, 0.0, 1.0));
          float mid = 1.0 - smoothstep(mw * 0.5, mw, ax);
          float f = fract((y - ax * 1.15) * 8.0);
          float sec = (1.0 - smoothstep(0.0, 0.07, min(f, 1.0 - f))) * smoothstep(0.015, 0.04, ax) * (1.0 - smoothstep(0.65, 0.95, ax / max(w, 1e-3)));
          leafVein = max(max(mid, sec * 0.7), stem);
          vec3 c = gl_FrontFacing ? uTop : uBack;
          c *= 0.88 + 0.2 * clamp(y, 0.0, 1.0); // a touch lighter towards the tip
          c *= 1.0 - 0.18 * smoothstep(0.55, 1.0, ax / max(w, 1e-3)); // darker margin
          diffuseColor.rgb = mix(c, uVein, leafVein * 0.8);
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 n = normalize(normal);
          vec3 v = normalize(vViewPosition);
          // light from behind the leaf shines through the blade; the veins block it
          vec3 keyV = normalize((viewMatrix * vec4(uKey, 0.0)).xyz);
          float back = max(-dot(n, keyV), 0.0);
          float rimF = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 3.0);
          // glow strongest between the veins, so they read dark against the light, as in a backlit leaf
          vec3 col = outgoingLight + uGlow * (back * 0.32 + rimF * 0.18) * (1.0 - 0.85 * leafVein) * uTrans;
          gl_FragColor = vec4(col, leafA * opacity * uFade);
        }`,
      );
  };
  return mat;
}

/** The peepal's baked textures, shared by every leaf; materials switch to them once they've arrived. */
let leafTex: Promise<{ detail: THREE.Texture; normal: THREE.Texture }> | null = null;
function loadLeafTextures() {
  if (!leafTex) {
    const base = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}models/leaf/`;
    const loader = new THREE.TextureLoader();
    const load = (name: string) =>
      loader.loadAsync(base + name).then((t) => {
        t.colorSpace = THREE.NoColorSpace; // data, not colour
        t.anisotropy = 8;
        return t;
      });
    leafTex = Promise.all([load('leaf-detail.webp'), load('leaf-normal.webp')]).then(([detail, normal]) => ({ detail, normal }));
  }
  return leafTex;
}
/** Give a leaf material the peepal (keeps the procedural leaf if the textures can't load). */
function usePeepal(mat: THREE.MeshPhysicalMaterial, u: LeafUniforms) {
  loadLeafTextures()
    .then(({ detail, normal }) => {
      u.uDetail.value = detail;
      u.uUseTex.value = 1;
      mat.normalMap = normal;
      mat.normalScale.set(1.3, 1.3);
      mat.needsUpdate = true;
    })
    .catch(() => {});
}

// Pale and backlit over dark and green sections, deep green over bone ones.
const PALE = { top: '#9fceaa', back: '#c6e3c8', vein: '#5f9a6e', glow: '#c8f59a' };
const DEEP = { top: '#1c5236', back: '#3f7a52', vein: '#6fa27c', glow: '#8fd46a' };
const PAL = (k: keyof typeof PALE) => [new THREE.Color(PALE[k]), new THREE.Color(DEEP[k])] as const;
const TONES = { top: PAL('top'), back: PAL('back'), vein: PAL('vein'), glow: PAL('glow') };
function applyTone(u: LeafUniforms, tn: number) {
  u.uTop.value.lerpColors(TONES.top[0], TONES.top[1], tn);
  u.uBack.value.lerpColors(TONES.back[0], TONES.back[1], tn);
  u.uVein.value.lerpColors(TONES.vein[0], TONES.vein[1], tn);
  u.uGlow.value.lerpColors(TONES.glow[0], TONES.glow[1], tn);
  u.uTrans.value = 1 - tn * 0.65;
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

/** Plane in leaf space (see the material), finely divided so the bends stay smooth. */
function leafGeometry(seg: number) {
  const g = new THREE.PlaneGeometry(1, 1.2, Math.round(seg * 0.6), seg);
  g.translate(0, 0.4, 0);
  return g;
}

export function createLeaf(canvas: HTMLCanvasElement, opts: { still: boolean }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.AgXToneMapping;
  const scene = new THREE.Scene();
  const env = studioEnvironment(renderer);
  scene.environment = env;
  const key = new THREE.DirectionalLight('#fff8ec', 2.6);
  key.position.set(-2, 3, 4);
  scene.add(key);
  // behind and above: shines through the blade
  const backPos = new THREE.Vector3(1.5, 2.5, -3);
  const back = new THREE.DirectionalLight('#f4ffe6', 1.6);
  back.position.copy(backPos);
  scene.add(back);
  const fill = new THREE.DirectionalLight('#dfeee6', 0.7);
  fill.position.set(0.5, -2, 3);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 1 / Math.tan(THREE.MathUtils.degToRad(15)));

  // The leaf.
  const U = leafUniforms(backPos);
  const mat = leafMaterial(U);
  usePeepal(mat, U);
  const geo = leafGeometry(90);
  const leaf = new THREE.Mesh(geo, mat);
  leaf.frustumCulled = false;
  leaf.renderOrder = 3;
  scene.add(leaf);

  // Small leaves drifting down at depth, with parallax as the page scrolls.
  const smallGeo = leafGeometry(24);
  const motes = [
    { x: 0.9, y: 0.55, z: -1.6, s: 0.12, speed: 0.55 },
    { x: 0.2, y: -0.35, z: -2.4, s: 0.1, speed: 0.4 },
    { x: 0.78, y: -0.85, z: -1.2, s: 0.09, speed: 0.7 },
    { x: 0.48, y: 0.95, z: -3.0, s: 0.14, speed: 0.3 },
  ].map((m, i) => {
    const u = leafUniforms(backPos);
    u.uS.value = m.s;
    const mm = leafMaterial(u);
    usePeepal(mm, u);
    const mesh = new THREE.Mesh(smallGeo, mm);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    return { ...m, u, mesh, phase: i * 1.9, y0: m.y };
  });

  const shadow = softShadow();
  scene.add(shadow.mesh);

  // The finale's twig (scripts/blender/twig.py) and the two leaves already on it:
  // an older one further along, and a young copper one behind the bud.
  const twig = new THREE.Group();
  twig.visible = false;
  scene.add(twig);
  const nodes: Record<string, THREE.Vector3> = {};
  new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}models/twig.glb`)
    .then((g) => {
      g.scene.updateMatrixWorld(true);
      for (const name of ['node_hero', 'node_b', 'node_young']) {
        const o = g.scene.getObjectByName(name);
        if (o) nodes[name] = o.getWorldPosition(new THREE.Vector3());
      }
      if (!nodes.node_hero) return;
      g.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).renderOrder = 2;
      });
      twig.add(g.scene);
    })
    .catch(() => {}); // no twig: the leaf still hangs in the same place
  const COPPER = { top: new THREE.Color('#9a4a34'), back: new THREE.Color('#c27a5c'), vein: new THREE.Color('#6e3324'), glow: new THREE.Color('#f2a074') };
  const kin = [
    { node: 'node_b', size: 0.7, roll: -2.95, pitch: -0.15, spin: 0.95, phase: 1.3 },
    { node: 'node_young', size: 0.34, roll: 0.75, pitch: -0.45, spin: -0.3, phase: 2.6 },
  ].map((k) => {
    const u = leafUniforms(backPos);
    const m = leafMaterial(u);
    usePeepal(m, u);
    if (k.node === 'node_young') {
      u.uTop.value.copy(COPPER.top);
      u.uBack.value.copy(COPPER.back);
      u.uVein.value.copy(COPPER.vein);
      u.uGlow.value.copy(COPPER.glow);
      u.uTrans.value = 0.8;
      u.uCurl.value = 0.45; // still half-rolled
    } else applyTone(u, 0.45); // older: deeper, so the leaf that followed the page leads
    const mesh = new THREE.Mesh(smallGeo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    twig.add(mesh);
    return { ...k, u, mesh };
  });
  const stalk = new THREE.Vector3();
  const node = new THREE.Vector3();

  // ---------- anchors ----------
  let A = 1;
  let narrow = false;
  let anchors: { y: number; name: string; el: HTMLElement; ref: HTMLElement; track: HTMLElement; light: number }[] = [];
  const measure = () => {
    // markers that aren't laid out (display: none) have no place in the order
    const els = [...document.querySelectorAll<HTMLElement>('[data-float]')].filter((el) => el.getClientRects().length > 0);
    anchors = els.map((el) => {
      const ref = el.dataset.floatRef ? el.querySelector<HTMLElement>(el.dataset.floatRef) ?? el : el;
      // a pose can follow another element on screen (the hero's pinned stage) instead of its own marker
      const track = el.dataset.floatTrack ? document.querySelector<HTMLElement>(el.dataset.floatTrack) ?? ref : ref;
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
        track,
        // only bone sections take the deep green leaf; dark and green ones take the pale one
        light: el.classList.contains('tone-light') ? 1 : 0,
      };
    });
  };
  const placed = (i: number): Pose => {
    const a = anchors[i];
    const p = poseFor(a?.name ?? 'hidden', A, narrow);
    if (!a) return p;
    // poses sit relative to their section's top; tracked ones (the plume) are already in screen terms
    p.y += (a.el.dataset.floatTrack ? 0 : 1) - (2 * a.track.getBoundingClientRect().top) / innerHeight;
    return p;
  };
  /** Where the leaf should be, plus how far it is through a fall (fly) and how many turns it has made. */
  const targetAt = (y: number) => {
    let i = 0;
    while (i < anchors.length - 1 && y >= anchors[i + 1].y) i++;
    const a = placed(i);
    // past the end, or hanging from the twig: stay put (the twig scrolls away with its section)
    if (i >= anchors.length - 1 || y < (anchors[0]?.y ?? 0) || a.rest === 1) return { pose: a, k: 0, fly: 0, turn: i };
    const b = placed(i + 1);
    // Hold beside the headline while the section is read, then glide to the next one.
    const k = THREE.MathUtils.smootherstep((y - anchors[i].y) / (anchors[i + 1].y - anchors[i].y), 0.5, 1);
    const out = { ...a };
    KEYS.forEach((key) => (out[key] = a[key] + (b[key] - a[key]) * k));
    const fly = Math.sin(Math.PI * k);
    // a falling leaf swings side to side as it drops
    out.x += Math.sin(k * Math.PI * 3) * fly * (narrow ? 0.12 : 0.26);
    // it settles only at the very end
    out.rest = a.rest + (b.rest - a.rest) * THREE.MathUtils.smoothstep(k, 0.85, 1);
    // one turn over per fall, counted up so the angle never jumps back between sections
    return { pose: out, k, fly, turn: i + THREE.MathUtils.smootherstep(k, 0.3, 0.75) };
  };
  /** The twig's node (where the leaf's stalk meets it) on screen this frame, and the leaf size there; null when the finale is far off screen. */
  const twigAt = () => {
    const a = anchors.find((x) => x.name === 'finale');
    if (!a) return null;
    const r = a.ref.getBoundingClientRect();
    if (r.top > innerHeight * 1.2 || r.bottom < -innerHeight * 0.2) return null;
    const n = twigNode(narrow);
    return { x: n.x, y: n.y + 1 - (2 * r.top) / innerHeight, s: n.s };
  };
  /** Light or dark section under a point (0 dark → 1 bone). */
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

  // ---------- pointer: a fast cursor nearby is a breeze ----------
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
  const start = targetAt(scrollY);
  const cur = { ...start.pose };
  let fly = start.fly;
  let k = start.k;
  let turn = start.turn;
  let tone = toneAt(cur.y);

  let lastScroll = scrollY;
  const rot = new THREE.Euler(0, 0, 0, 'ZXY'); // roll (screen), pitch (lay back), spin (about the midrib)
  const gust = new THREE.Vector2();
  let gustAmt = 0;
  const hang = { a: 0, v: 0 }; // swing on its stalk (rad)
  let wasRest = cur.rest;
  const ring = (m: { a: number; v: number }, w: number, z: number, dt: number) => {
    const n = 4;
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      m.v += (-w * w * m.a - 2 * z * w * m.v) * h;
      m.a += m.v * h;
    }
  };
  const ease = (dt: number, rate: number) => (opts.still ? 1 : 1 - Math.exp(-dt * rate));

  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (dt <= 0) return;
    const goal = targetAt(scrollY);
    const e6 = ease(dt, 6);
    KEYS.forEach((key) => (cur[key] += (goal.pose[key] - cur[key]) * e6));
    fly += (goal.fly - fly) * e6;
    k += (goal.k - k) * e6;
    turn += (goal.turn - turn) * ease(dt, 4);
    const tw = twigAt();
    twig.visible = !!tw && !!nodes.node_hero;
    const t = opts.still ? 0 : now / 1000;

    const scrollV = (scrollY - lastScroll) / dt;
    lastScroll = scrollY;
    const pageV = scrollV * (2 / innerHeight);
    if (cur.opacity < 0.01 && !twig.visible) {
      // nothing to show: clear once, then skip the draw
      if (leaf.visible) {
        leaf.visible = false;
        renderer.clear();
      }
      return;
    }
    leaf.visible = cur.opacity >= 0.01;
    U.uFade.value = cur.opacity;

    // breeze: a cursor moving fast nearby pushes the leaf away and stirs it up
    if (!opts.still) {
      const dx = cur.x - ptr.x;
      const dy = cur.y - ptr.y;
      const dist = Math.hypot(dx, dy);
      const near = 1 - THREE.MathUtils.smoothstep(dist / cur.s, 0.6, 2.2);
      const breeze = near * THREE.MathUtils.clamp(Math.hypot(ptr.vx, ptr.vy) * 0.08, 0, 1);
      const push = breeze * (1 - cur.rest);
      // hanging: a breeze swings it on its stalk, and so does the page moving under it
      hang.v += (Math.sign(dx || 1) * breeze * 9 - THREE.MathUtils.clamp(pageV, -2.5, 2.5) * 1.2) * cur.rest * dt;
      gustAmt += (push - gustAmt) * (1 - Math.exp(-dt * (push > gustAmt ? 10 : 1.5)));
      const ux = dist > 1e-4 ? dx / dist : 0;
      const uy = dist > 1e-4 ? dy / dist : 0;
      gust.x += (ux * push * cur.s * 0.35 - gust.x) * (1 - Math.exp(-dt * (push > 0.01 ? 8 : 1.2)));
      gust.y += (uy * push * cur.s * 0.35 - gust.y) * (1 - Math.exp(-dt * (push > 0.01 ? 8 : 1.2)));
      ptr.vx *= Math.exp(-dt * 6);
      ptr.vy *= Math.exp(-dt * 6);
      // landing: it catches the twig and swings on its stalk
      if (cur.rest > 0.6 && wasRest <= 0.6) hang.v -= 1.6;
      wasRest = cur.rest;
      ring(hang, 3.6, 0.12, dt);
      // a stalk only bends so far: it never swings up across the twig
      if (Math.abs(hang.a) > 0.45) {
        hang.a = Math.sign(hang.a) * 0.45;
        hang.v *= -0.3;
      }
    }

    // Orientation. Resting: tip up and to the right, slowly turning to show its form.
    // Falling: laid back nearly flat, banking into each swing, turning over once.
    const wind = THREE.MathUtils.clamp(Math.abs(pageV) * 0.35, 0, 1.2);
    const swing = Math.cos(k * Math.PI * 3) * fly; // the sway's direction of travel
    const live = 1 - cur.rest;
    const rollRest = -0.55 + 0.07 * Math.sin(t * 0.37);
    const pitchRest = -0.28 + 0.1 * Math.sin(t * 0.55 + 1.0);
    const spinRest = 0.32 * Math.sin(t * 0.23);
    const sway = opts.still ? 0 : 0.05 * Math.sin(t * 0.7) + 0.02 * Math.sin(t * 1.9);
    const roll = THREE.MathUtils.lerp(rollRest + 0.85 * swing, HANG.roll + sway + hang.a, cur.rest) + gust.x * 2.5;
    const pitch = THREE.MathUtils.lerp(THREE.MathUtils.lerp(pitchRest, -1.0, fly), HANG.pitch + 0.06 * Math.sin(t * 0.5), cur.rest);
    const spin = (spinRest * live + 0.25 * swing) * (1 - fly * 0.5) + 0.3 * Math.sin(t * 0.3) * cur.rest + turn * Math.PI * 2;
    const er = ease(dt, 5);
    rot.x += (pitch - rot.x) * er;
    rot.y += (spin - rot.y) * er;
    rot.z += (roll - rot.z) * er;
    leaf.rotation.copy(rot);

    // Shape: fold, curl and flutter, livelier in flight, in a scroll wind and in a gust; a little flutter while it hangs.
    U.uS.value = cur.s;
    U.uTime.value = t;
    U.uFold.value = 0.18 + 0.04 * Math.sin(t * 0.8) * live;
    U.uCurl.value = 0.24 + 0.08 * Math.sin(t * 0.5) * live + 0.1 * fly;
    U.uTwist.value = (0.12 * Math.sin(t * 0.9) + 0.4 * fly * Math.sin(t * 2.3)) * live;
    U.uFlutter.value = opts.still ? 0 : (0.22 + 0.9 * fly + 0.6 * wind + 1.4 * gustAmt) * live + (0.12 + 0.3 * Math.abs(hang.v)) * cur.rest;

    // Free, it goes where its pose says; hanging, its stalk's end is pinned to the twig's node exactly
    // (this frame's, not eased), so it scrolls with the page without lagging behind the twig.
    leaf.position.set(cur.x + gust.x, cur.y + gust.y, 0);
    if (tw && cur.rest > 0) {
      stalkEnd(U, stalk).applyEuler(rot);
      node.set(tw.x, tw.y, 0).sub(stalk);
      leaf.position.lerp(node, cur.rest);
    }

    // The twig, with its node on that point, and the leaves already on it, swaying on their stalks.
    if (twig.visible && tw) {
      twig.scale.setScalar(tw.s);
      twig.position.set(tw.x, tw.y, -0.02).addScaledVector(nodes.node_hero, -tw.s);
      for (const k of kin) {
        const at = nodes[k.node];
        if (!at) continue;
        k.u.uS.value = k.size; // in twig space, which is scaled by the leaf size
        k.u.uTime.value = t + k.phase;
        k.u.uFlutter.value = opts.still ? 0 : 0.12;
        k.mesh.rotation.set(k.pitch + 0.05 * Math.sin(t * 0.5 + k.phase), k.spin + 0.2 * Math.sin(t * 0.3 + k.phase), k.roll + (opts.still ? 0 : 0.04 * Math.sin(t * 0.7 + k.phase)), 'ZXY');
        stalkEnd(k.u, stalk).applyEuler(k.mesh.rotation);
        k.mesh.position.copy(at).sub(stalk);
      }
    }

    // tone follows the section under the leaf
    tone += (toneAt(cur.y) - tone) * (1 - Math.exp(-dt * 5));
    applyTone(U, tone);

    // Small leaves: further ones drift slower; scrolling sweeps them past.
    for (const m of motes) {
      const depth = camera.position.z / (camera.position.z - m.z); // screen scale at that depth
      m.y0 += (pageV * m.speed * 0.4 - 0.02 * m.speed) * dt;
      if (m.y0 > 1.5) m.y0 -= 3;
      if (m.y0 < -1.5) m.y0 += 3;
      const tt = t * m.speed + m.phase;
      const wx = (m.x * A + 0.06 * Math.sin(tt * 0.8)) / depth;
      m.mesh.position.set(wx, m.y0 / depth, m.z);
      m.mesh.rotation.set(-0.6 + 0.4 * Math.sin(tt * 0.7), tt * 0.9, 0.5 * Math.sin(tt * 0.5), 'ZXY');
      m.u.uTime.value = t + m.phase;
      m.u.uFlutter.value = opts.still ? 0 : 0.5 + 0.5 * wind;
      m.u.uFade.value = 0.5 * live * cur.opacity;
      m.mesh.visible = m.u.uFade.value > 0.01;
      applyTone(m.u, toneAt(m.y0));
    }

    // Shadow on the page: down and right of the key light, softer and lighter in
    // flight (it's off the page); close and darker once it lies on the stage.
    const lift = Math.max(fly, wind * 0.4) * live;
    const sx = leaf.position.x + cur.s * (0.18 + 0.2 * lift) * live + cur.s * 0.14 * cur.rest;
    const sy = leaf.position.y - cur.s * (0.3 + 0.25 * lift) * live - cur.s * 0.2 * cur.rest;
    shadow.mesh.position.set(sx, sy, -0.4);
    shadow.mesh.rotation.z = rot.z;
    shadow.mesh.scale.set(cur.s * (0.75 + 0.25 * lift - 0.05 * cur.rest), cur.s * (1.25 + 0.15 * lift - 0.1 * cur.rest), 1);
    shadow.uniforms.uA.value = THREE.MathUtils.lerp((0.1 + 0.16 * tone) * (1 - 0.7 * lift), 0.2, cur.rest) * cur.opacity;

    renderer.render(scene, camera);
  };
  const loop = frameLoop(tick);
  loop.start();

  addEventListener('resize', frame);
  const ro = new ResizeObserver(() => measure());
  ro.observe(document.body);

  return {
    dispose() {
      loop.stop();
      removeEventListener('resize', frame);
      removeEventListener('pointermove', onPointer);
      ro.disconnect();
      geo.dispose();
      mat.dispose();
      smallGeo.dispose();
      motes.forEach((m) => (m.mesh.material as THREE.Material).dispose());
      kin.forEach((k) => (k.mesh.material as THREE.Material).dispose());
      twig.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      });
      shadow.dispose();
      env.dispose();
      renderer.dispose();
    },
  };
}
