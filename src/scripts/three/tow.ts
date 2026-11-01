/**
 * The glass-fibre tow on the winding machine: dry roving off the creel spool,
 * under the wet-out roller in the resin bath, through the payout eye, then a
 * free span that twists and fans out until it lies on the mandrel at the
 * winding angle. The spool-to-eye part is fixed to the carriage; the free span
 * is rebuilt each frame. Filament texture scrolls with the fibre feed, so the
 * tow visibly runs while the mandrel turns.
 */
import * as THREE from 'three';

/** Where the band meets the mandrel: above the front, where a tow from the eye lands tangentially. */
export const HEAD_ANGLE = THREE.MathUtils.degToRad(48);
/** The same angle in mandrel turns, for offsetting the band pattern. */
export const HEAD_TURN = HEAD_ANGLE / (2 * Math.PI);
const WIND_ANGLE = THREE.MathUtils.degToRad(58);
const V_SCALE = 1.6; // texture repeats per unit of tow length
const SPAN = 20; // segments in the free span
const LIE = 5; // extra points where the tow lies on the mandrel, covering the band's cut end
const LIE_LEN = 0.24;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

/** Parallel filaments with a few tow gaps and irregular resin/fibre patches along the length. */
function filamentTexture() {
  const W = 128;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d6dad3';
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x++) {
    const b = 190 + Math.random() * 65;
    g.globalAlpha = 0.45 + Math.random() * 0.55;
    g.fillStyle = `rgb(${b},${b},${b - 4})`;
    g.fillRect(x, 0, 1, H);
  }
  g.fillStyle = '#6f776d';
  for (let i = 1; i < 6; i++) {
    g.globalAlpha = 0.3 + Math.random() * 0.2;
    g.fillRect((i / 6) * W + (Math.random() - 0.5) * 6, 0, 1.5, H);
  }
  // patches stay clear of the top and bottom edges so the texture tiles along the tow
  for (let i = 0; i < 90; i++) {
    g.globalAlpha = 0.1 + Math.random() * 0.2;
    g.fillStyle = Math.random() < 0.5 ? '#ffffff' : '#7c857a';
    const h = 10 + Math.random() * 60;
    g.fillRect(Math.random() * W, 4 + Math.random() * (H - h - 8), 1 + Math.random() * 8, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Wound roving on the creel spool: fine rings around the package. */
export function spoolTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 256; y++) {
    const b = 205 + Math.random() * 45;
    g.fillStyle = `rgb(${b},${b},${b - 5})`;
    g.fillRect(0, y, 16, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A flat strip along a path, `width` wide, oriented by a per-point side vector. */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly nor: Float32Array;
  private readonly uv: Float32Array;
  private readonly t = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly nrm = new THREE.Vector3();

  constructor(readonly n: number, mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 6);
    this.nor = new Float32Array(n * 6);
    this.uv = new Float32Array(n * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
  }

  /** Returns the texture v at the end of the strip, so the next strip continues it. */
  set(pts: THREE.Vector3[], sides: THREE.Vector3[], widths: number[], v0: number) {
    let v = v0;
    for (let i = 0; i < this.n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(this.n - 1, i + 1)];
      this.t.subVectors(b, a).normalize();
      this.s.copy(sides[i]).addScaledVector(this.t, -sides[i].dot(this.t)).normalize();
      this.nrm.crossVectors(this.s, this.t);
      if (i > 0) v += pts[i].distanceTo(pts[i - 1]) * V_SCALE;
      const p = pts[i];
      const w = widths[i] / 2;
      this.pos.set([p.x - this.s.x * w, p.y - this.s.y * w, p.z - this.s.z * w, p.x + this.s.x * w, p.y + this.s.y * w, p.z + this.s.z * w], i * 6);
      this.nor.set([this.nrm.x, this.nrm.y, this.nrm.z, this.nrm.x, this.nrm.y, this.nrm.z], i * 6);
      this.uv.set([0, v, 1, v], i * 4);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.uv.needsUpdate = true;
    return v;
  }
}

export type TowState = {
  x: number; // carriage position along the vessel axis
  r: number; // mandrel radius under the laying point
  radiusAt(x: number): number; // mandrel radius at an axial position
  dir: 1 | -1; // carriage travel along x
  show: boolean; // free span visible (winding in progress)
  feed: number; // fibre length paid out so far
  t: number; // seconds, for the tension shimmer
  dt: number;
};

export function createTow(carriage: THREE.Object3D, scene: THREE.Scene, eye: THREE.Vector3) {
  const tex = filamentTexture();
  const dry = new THREE.MeshStandardMaterial({ color: '#f3f4ef', map: tex, roughness: 0.8, side: THREE.DoubleSide, transparent: true });
  const wet = new THREE.MeshPhysicalMaterial({
    color: '#cde6d4',
    map: tex,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.94,
  });

  // Carriage space (x = 0 is the carriage centre line). Spool at (y −0.52, z 2.72),
  // wet-out roller at (−0.72, 2.07) r 0.07, eye at `eye`.
  const P = (y: number, z: number) => new THREE.Vector3(0, y, z);
  const dryPts = new THREE.CatmullRomCurve3([P(-0.445, 2.513), P(-0.6, 2.3), P(-0.74, 2.13), P(-0.79, 2.07)], false, 'centripetal').getSpacedPoints(20);
  const wetPts = new THREE.CatmullRomCurve3(
    [P(-0.79, 2.07), P(-0.775, 2.02), P(-0.73, 1.995), P(-0.4, 1.78), eye.clone()],
    false,
    'centripetal',
  ).getSpacedPoints(28);
  const dryR = new Ribbon(dryPts.length, dry);
  const wetR = new Ribbon(wetPts.length, wet);
  const vRoller = dryR.set(dryPts, dryPts.map(() => X), dryPts.map(() => 0.18), 0);
  const vEye = wetR.set(wetPts, wetPts.map(() => X), wetPts.map((_, i) => THREE.MathUtils.lerp(0.17, 0.12, i / (wetPts.length - 1))), vRoller);
  carriage.add(dryR.mesh, wetR.mesh);

  const free = new Ribbon(SPAN + 1 + LIE, wet);
  scene.add(free.mesh);
  const pts = Array.from({ length: SPAN + 1 + LIE }, () => new THREE.Vector3());
  const sides = Array.from({ length: SPAN + 1 + LIE }, () => new THREE.Vector3());
  const widths = new Array<number>(SPAN + 1 + LIE).fill(0);
  const E = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const C = new THREE.Vector3();
  const F = new THREE.Vector3();
  const W = new THREE.Vector3();
  const K = new THREE.Vector3();
  let lastFeed = 0;
  let shimmer = 0;

  return {
    update(o: TowState) {
      tex.offset.y = -o.feed * V_SCALE;
      const speed = o.dt > 0 ? Math.abs(o.feed - lastFeed) / o.dt : 0;
      lastFeed = o.feed;
      shimmer += (Math.min(speed * 0.0012, 0.006) - shimmer) * (1 - Math.exp(-o.dt * 6));
      free.mesh.visible = o.show;
      if (!o.show) return;

      E.set(o.x + eye.x, eye.y, eye.z);
      N.set(0, Math.sin(HEAD_ANGLE), Math.cos(HEAD_ANGLE));
      T.set(o.x, 0, 0).addScaledVector(N, o.r);
      // Fibre direction on the surface at the laying point: the band trails behind
      // the carriage and up with the turning surface. The tow lands across it.
      C.set(0, Math.cos(HEAD_ANGLE), -Math.sin(HEAD_ANGLE));
      F.copy(X).multiplyScalar(-o.dir * Math.cos(WIND_ANGLE)).addScaledVector(C, Math.sin(WIND_ANGLE));
      W.crossVectors(F, N).normalize();
      if (W.x < 0) W.negate();

      K.copy(T).addScaledVector(F, -0.28);
      const wEnd = 0.4 * THREE.MathUtils.clamp(o.r, 0.45, 1);
      for (let i = 0; i <= SPAN; i++) {
        const s = i / SPAN;
        // Quadratic curve whose end runs along the band, so the tow meets the surface tangentially.
        const u = 1 - s;
        pts[i].copy(E).multiplyScalar(u * u).addScaledVector(K, 2 * u * s).addScaledVector(T, s * s).addScaledVector(Y, shimmer * Math.sin(Math.PI * s) * Math.sin(o.t * 37 + s * 4));
        sides[i].lerpVectors(X, W, THREE.MathUtils.smoothstep(s, 0, 1));
        widths[i] = THREE.MathUtils.lerp(0.12, wEnd, Math.pow(s, 1.4));
      }
      // Past the laying point the tow wraps onto the surface along the laid band.
      for (let j = 1; j <= LIE; j++) {
        const q = pts[SPAN + j].copy(T).addScaledVector(F, (j / LIE) * LIE_LEN);
        const yz = Math.hypot(q.y, q.z);
        const k = (o.radiusAt(q.x) + 0.006) / yz;
        q.y *= k;
        q.z *= k;
        sides[SPAN + j].copy(W);
        widths[SPAN + j] = wEnd * (1 - 0.15 * (j / LIE));
      }
      free.set(pts, sides, widths, vEye);
    },
    setOpacity(a: number) {
      dry.opacity = a;
      wet.opacity = 0.94 * a;
    },
    /** Feed length for a given mandrel turn count (fibre runs at the winding angle). */
    feedFor(turns: number, radius: number) {
      return (turns * 2 * Math.PI * radius) / Math.sin(WIND_ANGLE);
    },
  };
}
