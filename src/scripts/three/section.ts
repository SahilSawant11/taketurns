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

/**
 * A normal map from a pattern: draw it on mid-grey (lighter = higher), then take the slope
 * across neighbouring pixels. Gives the rovings, mat, dimples and wool real relief in the light.
 */
function normalTex(draw: (g: CanvasRenderingContext2D, s: number) => void, strength: number, repeat = 1) {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  draw(g, s);
  const src = g.getImageData(0, 0, s, s).data;
  const out = g.createImageData(s, s);
  const h = (x: number, y: number) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * s + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

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
  // Chopped strand mat in resin: straight chopped bundles (a few filaments side by side) lying flat
  // at every angle, pale and a little milky against the resin. Only ever lighter than the resin, so
  // their relief reads as raised strands, not creases.
  chopped: (base) =>
    canvasTex((g, s) => {
      g.fillStyle = base;
      g.fillRect(0, 0, s, s);
      const r = rand(7);
      g.lineCap = 'round';
      for (let layer = 0; layer < 2; layer++) {
        // the deeper layer first, softer: strands seen through resin
        const n = layer === 0 ? 260 : 330;
        for (let i = 0; i < n; i++) {
          const x = r() * s;
          const y = r() * s;
          const a = r() * Math.PI;
          const l = 34 + r() * 46; // one chopped length, roughly
          const fil = 3 + Math.floor(r() * 4); // filaments in the bundle
          const ux = Math.cos(a);
          const uy = Math.sin(a);
          for (let f = 0; f < fil; f++) {
            const o = (f - (fil - 1) / 2) * 1.3;
            const ox = -uy * o;
            const oy = ux * o;
            const alpha = (layer === 0 ? 0.09 : 0.18) + r() * 0.1;
            // wrap round the tile so the pattern repeats without a seam
            for (const dx of [-s, 0, s])
              for (const dy of [-s, 0, s]) {
                const sx = x + ox + dx;
                const sy = y + oy + dy;
                if (sx < -l || sx > s + l || sy < -l || sy > s + l) continue;
                g.strokeStyle = `rgba(245,250,240,${alpha})`;
                g.lineWidth = 0.9;
                g.beginPath();
                g.moveTo(sx - (ux * l) / 2, sy - (uy * l) / 2);
                g.lineTo(sx + (ux * l) / 2, sy + (uy * l) / 2);
                g.stroke();
              }
          }
        }
      }
    }, 1.6),
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
  // Surface veil in resin: a fine, open web of long wavy fibres seen through a glossy resin skin.
  veil: (base) =>
    canvasTex((g, s) => {
      g.fillStyle = base;
      g.fillRect(0, 0, s, s);
      const r = rand(23);
      // a faint cloudiness where the veil is denser
      for (let i = 0; i < 60; i++) {
        const x = r() * s;
        const y = r() * s;
        const rad = 30 + r() * 90;
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        grd.addColorStop(0, 'rgba(255,255,255,0.06)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      g.lineCap = 'round';
      for (let i = 0; i < 700; i++) {
        const x = r() * s;
        const y = r() * s;
        const a = r() * Math.PI * 2;
        const l = 140 + r() * 260; // long, continuous filaments: a veil, not a chopped mat
        const bend = (r() - 0.5) * 70;
        // mostly pale glass fibres, a few darker where they lie deeper in the resin
        g.strokeStyle = r() > 0.25 ? `rgba(255,255,255,${0.14 + r() * 0.16})` : `rgba(20,60,35,${0.08 + r() * 0.08})`;
        g.lineWidth = 0.4 + r() * 0.5;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * l * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
    }, 1.2),
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

/** The pattern as height (lighter = higher), for its normal map: each texture drawn on grey, strongly. */
function drawHeight(kind: string, g: CanvasRenderingContext2D, s: number) {
  const tmp = textures[kind]('#808080').image as HTMLCanvasElement;
  g.filter = 'contrast(5)';
  g.drawImage(tmp, 0, 0, s, s);
  g.filter = 'none';
}

/** Surface treatment per layer id, matched to the Blender stills (scripts/blender/renders.py). */
type Look = {
  tex?: string;
  /** relief from the same pattern, and how strong */
  relief?: number;
  colour?: string; // instead of the layer's tone (the swatch keeps the tone)
  rough: number;
  metal: number;
  coat?: number;
  coatRough?: number;
  aniso?: number;
  opacity?: number;
  /** light passing into the layer (resin), and how deep it reads */
  transmission?: number;
  thickness?: number;
};
const LOOK: Record<string, Look> = {
  // FRP
  // resin-rich, with the surface veil inside it: glossy, a little translucent, smooth to the touch
  liner: { tex: 'veil', relief: 0.25, colour: '#acd3b6', rough: 0.1, metal: 0, coat: 1, coatRough: 0.02, transmission: 0.2, thickness: 0.12 },
  barrier: { tex: 'chopped', relief: 0.9, rough: 0.3, metal: 0, coat: 0.55, coatRough: 0.08 }, // chopped strand mat in resin
  structural: { tex: 'wound', relief: 6, rough: 0.34, metal: 0, coat: 0.45, coatRough: 0.1 }, // resin over the rovings
  exterior: { rough: 0.3, metal: 0, coat: 0.7, coatRough: 0.08 }, // gel coat
  // Glass-lined steel
  'inner-glass': { rough: 0.12, metal: 0, coat: 1, coatRough: 0.04 },
  steel: { tex: 'brushed', relief: 0.4, rough: 0.42, metal: 1 },
  'outer-glass': { rough: 0.12, metal: 0, coat: 1, coatRough: 0.04 },
  // Stainless
  contact: { colour: '#e6e9ec', rough: 0.06, metal: 1 }, // polished to a mirror
  shell: { tex: 'brushed', relief: 0.35, rough: 0.26, metal: 1, aniso: 0.6 },
  jacket: { tex: 'dimple', relief: 3.5, rough: 0.32, metal: 1 },
  insulation: { tex: 'wool', relief: 4, colour: '#bfae7f', rough: 0.95, metal: 0 }, // mineral wool
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
    const look: Look = LOOK[l.id] ?? { rough: 0.5, metal: 0 };
    const base = look.colour ?? l.tone;
    const map = look.tex ? textures[look.tex](base) : null;
    // the relief comes from the same pattern drawn on grey, so bumps line up with the colour
    const normalMap = look.tex && look.relief ? normalTex((g, sz) => drawHeight(look.tex!, g, sz), look.relief, map?.repeat.x ?? 1) : null;
    const mat = new THREE.MeshPhysicalMaterial({
      color: map ? '#ffffff' : base,
      map,
      normalMap,
      roughness: look.rough,
      metalness: look.metal,
      clearcoat: look.coat ?? 0,
      clearcoatRoughness: look.coatRough ?? 0.3,
      anisotropy: look.aniso ?? 0,
      transmission: look.transmission ?? 0,
      thickness: look.thickness ?? 0,
      attenuationColor: new THREE.Color(base),
      attenuationDistance: 0.4,
      ior: 1.55, // cured vinyl ester / polyester resin
      transparent: look.opacity !== undefined,
      opacity: look.opacity ?? 1,
    });
    if (map) map.repeat.multiplyScalar(0.6);
    if (normalMap) {
      normalMap.repeat.copy(map!.repeat);
      disposables.push(normalMap);
    }
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
