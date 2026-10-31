/**
 * 3D cutaway of a curved vessel wall: one solid slab per layer, stepped so
 * every layer's cut face shows, each with its own procedural surface (wound
 * fibre, chopped-strand mat, brushed steel, enamel, dimpled jacket, mineral
 * wool). Used live by <LayerDiagram> and for the still renders.
 */
import * as THREE from 'three';

export type SectionLayer = { id: string; weight: number; tone: string };

const R0 = 2.6; // inner radius of the wall
const H = 1.7; // height of the innermost slab
const SPAN = 0.95; // arc of the innermost slab (radians)
const STEP_ARC = 0.13; // each layer outward is cut shorter on one side…
const STEP_H = 0.13; // …and lower on top, so inner layers show
const UNIT = 0.1; // slab thickness per unit of layer weight
const MID = -Math.PI / 2; // arc centre faces +Z after rotation

// ---------- procedural surface textures ----------
function canvasTex(draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  draw(g, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}
const rand = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const textures: Record<string, (base: string) => THREE.Texture> = {
  // Continuous roving wound at ± helical angle: crossing bands of fine filaments.
  wound: (base) =>
    canvasTex((g, s) => {
      g.fillStyle = base;
      g.fillRect(0, 0, s, s);
      for (const dir of [1, -1]) {
        g.save();
        g.translate(s / 2, s / 2);
        g.rotate(dir * 0.96);
        for (let x = -s; x < s; x += 2) {
          const band = Math.floor((x + s) / 12) % 2 === (dir > 0 ? 0 : 1);
          g.strokeStyle = band ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.045)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x, -s);
          g.lineTo(x, s);
          g.stroke();
        }
        g.restore();
      }
    }, 2),
  // Chopped-strand mat: short fibres at random angles.
  chopped: (base) =>
    canvasTex((g, s) => {
      g.fillStyle = base;
      g.fillRect(0, 0, s, s);
      const r = rand(7);
      for (let i = 0; i < 2600; i++) {
        const x = r() * s;
        const y = r() * s;
        const a = r() * Math.PI;
        const l = 10 + r() * 34;
        g.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.10)';
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
    }, 1.5),
  // Brushed metal: dense fine streaks in one direction.
  brushed: (base) =>
    canvasTex((g, s) => {
      g.fillStyle = base;
      g.fillRect(0, 0, s, s);
      const r = rand(3);
      for (let i = 0; i < 1400; i++) {
        const y = r() * s;
        g.strokeStyle = r() > 0.5 ? `rgba(255,255,255,${0.04 + r() * 0.06})` : `rgba(0,0,0,${0.04 + r() * 0.06})`;
        g.lineWidth = 0.6 + r();
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(s, y + (r() - 0.5) * 3);
        g.stroke();
      }
    }, 1),
  // Dimple jacket: regular grid of pressed dimples.
  dimple: (base) =>
    canvasTex((g, s) => {
      g.fillStyle = base;
      g.fillRect(0, 0, s, s);
      const step = s / 8;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const cx = (x + (y % 2) * 0.5) * step;
          const cy = (y + 0.5) * step;
          const grd = g.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, step * 0.32);
          grd.addColorStop(0, 'rgba(255,255,255,0.22)');
          grd.addColorStop(1, 'rgba(0,0,0,0.22)');
          g.fillStyle = grd;
          g.beginPath();
          g.arc(cx, cy, step * 0.3, 0, Math.PI * 2);
          g.fill();
        }
    }, 1),
  // Mineral wool: soft, tangled fibres.
  wool: (base) =>
    canvasTex((g, s) => {
      g.fillStyle = base;
      g.fillRect(0, 0, s, s);
      const r = rand(11);
      for (let i = 0; i < 900; i++) {
        g.strokeStyle = r() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
        g.lineWidth = 0.7;
        g.beginPath();
        const x = r() * s;
        const y = r() * s;
        g.moveTo(x, y);
        g.bezierCurveTo(x + (r() - 0.5) * 80, y + (r() - 0.5) * 30, x + (r() - 0.5) * 80, y + (r() - 0.5) * 30, x + (r() - 0.5) * 120, y + (r() - 0.5) * 20);
        g.stroke();
      }
    }, 1),
};

/** Surface treatment per layer id. */
const LOOK: Record<string, { tex?: string; rough: number; metal: number; coat?: number; opacity?: number }> = {
  // FRP
  liner: { rough: 0.32, metal: 0, coat: 0.3, opacity: 0.92 },
  barrier: { tex: 'chopped', rough: 0.55, metal: 0 },
  structural: { tex: 'wound', rough: 0.5, metal: 0 },
  exterior: { rough: 0.45, metal: 0, coat: 0.25 },
  // Glass-lined steel
  'inner-glass': { rough: 0.22, metal: 0, coat: 0.5 },
  steel: { tex: 'brushed', rough: 0.4, metal: 0.9 },
  'outer-glass': { rough: 0.22, metal: 0, coat: 0.5 },
  // Stainless
  contact: { tex: 'brushed', rough: 0.25, metal: 1 },
  shell: { tex: 'brushed', rough: 0.38, metal: 0.95 },
  jacket: { tex: 'dimple', rough: 0.4, metal: 0.9 },
  insulation: { tex: 'wool', rough: 0.9, metal: 0 },
};

export type Section = {
  group: THREE.Group;
  /** Target state; call update() each frame until it returns false. */
  set(state: { selected: number; exploded: boolean }): void;
  update(dt: number): boolean;
  centre: THREE.Vector3;
  radius: number;
  dispose(): void;
};

export function buildSection(layers: SectionLayer[]): Section {
  const group = new THREE.Group();
  const meshes: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshPhysicalMaterial>[] = [];
  const disposables: { dispose(): void }[] = [];
  let r = R0;
  layers.forEach((l, i) => {
    const t = l.weight * UNIT;
    const a0 = MID - SPAN / 2;
    const a1 = MID + SPAN / 2 - i * STEP_ARC;
    const shape = new THREE.Shape();
    shape.moveTo(r * Math.cos(a0), r * Math.sin(a0));
    shape.lineTo((r + t) * Math.cos(a0), (r + t) * Math.sin(a0));
    shape.absarc(0, 0, r + t, a0, a1, false);
    shape.lineTo(r * Math.cos(a1), r * Math.sin(a1));
    shape.absarc(0, 0, r, a1, a0, true);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: H - i * STEP_H,
      curveSegments: 96,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    const look = LOOK[l.id] ?? { rough: 0.5, metal: 0 };
    const map = look.tex ? textures[look.tex](l.tone) : null;
    const mat = new THREE.MeshPhysicalMaterial({
      color: map ? '#ffffff' : l.tone,
      map,
      roughness: look.rough,
      metalness: look.metal,
      clearcoat: look.coat ?? 0,
      clearcoatRoughness: 0.3,
      transparent: look.opacity !== undefined,
      opacity: look.opacity ?? 1,
    });
    if (map) map.repeat.multiplyScalar(0.6);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.base = mat.color.clone();
    group.add(mesh);
    meshes.push(mesh);
    disposables.push(geo, mat);
    if (map) disposables.push(map);
    r += t;
  });

  const bounds = new THREE.Box3().setFromObject(group);
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const radial = new THREE.Vector3(0, 0, 1);
  const offsets = meshes.map(() => ({ cur: 0, goal: 0, lift: 0, liftGoal: 0, dim: 1, dimGoal: 1 }));
  let state = { selected: 0, exploded: false };

  const set: Section['set'] = (s) => {
    state = s;
    offsets.forEach((o, i) => {
      o.goal = s.exploded ? i * 0.3 : 0;
      o.liftGoal = i === s.selected ? 0.22 : 0; // selected layer lifts out of the stack
      o.dimGoal = s.selected < 0 || i === s.selected ? 1 : 0.62;
    });
  };
  set(state);

  const update = (dt: number) => {
    let moving = false;
    const k = 1 - Math.exp(-dt * 9);
    meshes.forEach((m, i) => {
      const o = offsets[i];
      o.cur += (o.goal - o.cur) * k;
      o.lift += (o.liftGoal - o.lift) * k;
      o.dim += (o.dimGoal - o.dim) * k;
      if (Math.abs(o.goal - o.cur) > 0.0005 || Math.abs(o.liftGoal - o.lift) > 0.0005 || Math.abs(o.dimGoal - o.dim) > 0.002) moving = true;
      m.position.copy(radial).multiplyScalar(o.cur);
      m.position.y = o.lift;
      m.material.color.copy(m.userData.base).multiplyScalar(o.dim);
    });
    return moving;
  };

  return { group, set, update, centre, radius, dispose: () => disposables.forEach((d) => d.dispose()) };
}
