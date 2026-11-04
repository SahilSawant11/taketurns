/**
 * The workshop round the machine. Modelled in Blender (scripts/blender/
 * workshop.py → public/models/workshop.glb): a portal-frame shop with roof
 * trusses, an overhead crane, window strips, skylights, high-bay lamps, a
 * roof opening with sliding hatch doors over the machine, and a shop floor
 * dressed for filament winding. Until it loads (or if it can't) the simple
 * procedural room below stands in. Either way the fog turns it into
 * silhouettes; it's there for a sense of place and scale. No shadows.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const WINDOW = new THREE.Color('#8ea3b4');
const SKY = new THREE.Color('#a9bccb');
const LAMP = new THREE.Color('#ffe0b0');

export function createWorkshop(floorY: number) {
  const g = new THREE.Group();
  const proc = new THREE.Group(); // the procedural stand-in
  g.add(proc);
  const steel = new THREE.MeshStandardMaterial({ color: '#1b1d1e', metalness: 0.5, roughness: 0.6 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#4a3f1c', metalness: 0.3, roughness: 0.6 }); // crane paint, dulled
  const tankMat = new THREE.MeshStandardMaterial({ color: '#1a3326', roughness: 0.45, metalness: 0.05 });
  const boxMat = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.9 });
  const wallMat = new THREE.MeshStandardMaterial({ color: '#0c0d0d', roughness: 1 });
  const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#8ea3b4').multiplyScalar(0.55) });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe0b0').multiplyScalar(3.2) });
  const disposables: { dispose(): void }[] = [steel, yellow, tankMat, boxMat, wallMat, windowMat, lampMat];
  const geo = <T extends THREE.BufferGeometry>(x: T) => (disposables.push(x), x);
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const o = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m);
    o.position.set(x, y, z);
    proc.add(o);
    return o;
  };

  // Back wall with a row of high windows.
  box(80, 16, 0.3, wallMat, 0, floorY + 8, -20);
  for (let i = 0; i < 11; i++) box(2.6, 1.6, 0.05, windowMat, -20 + i * 4, floorY + 10.4, -19.8);

  // Gantry crane over the back bay: two legs, a girder, a trolley with a hook block.
  const cz = -8.5;
  const top = floorY + 8;
  for (const x of [-9, 9]) {
    box(0.45, top - floorY, 0.45, yellow, x, (top + floorY) / 2, cz);
    box(0.9, 0.3, 2.4, yellow, x, floorY + 0.15, cz); // foot
  }
  box(18.9, 0.7, 0.5, yellow, 0, top, cz);
  box(1.2, 0.5, 1.1, steel, -3.2, top - 0.6, cz);
  box(0.03, 3.2, 0.03, steel, -3.2, top - 2.45, cz); // hoist rope
  box(0.35, 0.45, 0.3, yellow, -3.2, top - 4.2, cz); // hook block

  // Pallet racking along the back wall, with stock on the shelves.
  const rz = -15.5;
  const bays = 6;
  const bayW = 2.8;
  const x0 = -15;
  for (let i = 0; i <= bays; i++) for (const dz of [-0.55, 0.55]) box(0.1, 5.6, 0.1, steel, x0 + i * bayW, floorY + 2.8, rz + dz);
  const levels = [0.2, 1.9, 3.6, 5.3];
  for (const ly of levels) for (const dz of [-0.55, 0.55]) box(bays * bayW, 0.12, 0.06, steel, x0 + (bays * bayW) / 2, floorY + ly, rz + dz);
  {
    const n = bays * (levels.length - 1) * 2;
    const inst = new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1, 1, 1)), boxMat, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let k = 0;
    // deterministic "random" so the stock doesn't change between visits
    let r = 7;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < bays; i++)
      for (let l = 0; l < levels.length - 1; l++)
        for (let j = 0; j < 2; j++) {
          if (rnd() < 0.25) continue;
          const h = 0.6 + rnd() * 0.9;
          s.set(1.0 + rnd() * 0.2, h, 0.9);
          p.set(x0 + i * bayW + 0.75 + j * 1.3, floorY + levels[l] + 0.06 + h / 2, rz);
          inst.setMatrixAt(k++, m.compose(p, q, s));
        }
    inst.count = k;
    proc.add(inst);
  }

  // Finished vertical tanks awaiting dispatch, back right.
  const tank = (x: number, z: number, r: number, h: number) => {
    const body = new THREE.Mesh(geo(new THREE.CylinderGeometry(r, r, h, 48)), tankMat);
    body.position.set(x, floorY + h / 2 + 0.4, z);
    const dome = new THREE.Mesh(geo(new THREE.SphereGeometry(r, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2)), tankMat);
    dome.scale.y = 0.35;
    dome.position.set(x, floorY + h + 0.4, z);
    const skirt = new THREE.Mesh(geo(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.4, 48)), steel);
    skirt.position.set(x, floorY + 0.2, z);
    proc.add(body, dome, skirt);
  };
  tank(6.5, -15.5, 1.4, 5.2);
  tank(9.8, -16.5, 1.2, 4.4);
  tank(12.6, -15, 1.0, 3.6);

  // Pendant lamps hanging from the roof: a dark shade and a bright disc under it.
  const shadeGeo = geo(new THREE.ConeGeometry(0.42, 0.32, 32, 1, true));
  const discGeo = geo(new THREE.CircleGeometry(0.3, 24));
  const cordGeo = geo(new THREE.CylinderGeometry(0.01, 0.01, 4, 6));
  for (const [x, z] of [[-11, -7], [-4, -11], [3.5, -7.5], [11, -10], [-7.5, -15], [6, -16]] as const) {
    const y = floorY + 8.2;
    const shade = new THREE.Mesh(shadeGeo, steel);
    shade.position.set(x, y, z);
    const disc = new THREE.Mesh(discGeo, lampMat);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(x, y - 0.15, z);
    const cord = new THREE.Mesh(cordGeo, steel);
    cord.position.set(x, y + 2.15, z);
    proc.add(shade, disc, cord);
  }

  // Depth haze: soft cards of background colour between the machine and the
  // room, so the room reads as distant silhouettes. Each fades out towards the
  // floor so it doesn't draw a line where it meets it.
  const hazeMat = (a: number) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uA: { value: a }, uY: { value: floorY } },
      vertexShader: 'varying float vY; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader:
        'uniform float uA, uY; varying float vY; void main(){ gl_FragColor = vec4(0.004, 0.004, 0.004, uA * smoothstep(uY, uY + 2.5, vY)); }',
    });
  const hazeGeo = geo(new THREE.PlaneGeometry(120, 40));
  const air: THREE.Object3D[] = [];
  for (const [z, a] of [[-5.5, 0.45], [-11, 0.5], [-17, 0.55]] as const) {
    const m = hazeMat(a);
    disposables.push(m);
    const card = new THREE.Mesh(hazeGeo, m);
    card.position.set(0, floorY + 20, z);
    card.renderOrder = 1;
    g.add(card);
    air.push(card);
  }

  // The Blender model: glow materials are drawn unlit at the current light level.
  let level = 0;
  const glows: { mat: THREE.MeshBasicMaterial; base: THREE.Color; k: number }[] = [];
  const hatches: { o: THREE.Object3D; x: number; dir: number; w: number }[] = [];
  const loaded = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}models/workshop.glb`)
    .then((gltf) => {
      gltf.scene.position.y = floorY;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        disposables.push(m.geometry);
        const name = (m.material as THREE.Material).name;
        const glow = name.includes('glow_window') ? [WINDOW, 0.55] : name.includes('glow_sky') ? [SKY, 0.32] : name.includes('glow_lamp') ? [LAMP, 3.2] : null;
        if (glow) {
          (m.material as THREE.Material).dispose();
          const mat = new THREE.MeshBasicMaterial({ color: (glow[0] as THREE.Color).clone().multiplyScalar((glow[1] as number) * level) });
          glows.push({ mat, base: glow[0] as THREE.Color, k: glow[1] as number });
          disposables.push(mat);
          m.material = mat;
        } else disposables.push(m.material as THREE.Material);
      });
      for (const [name, dir] of [['ws_hatch_l', -1], ['ws_hatch_r', 1]] as const) {
        const o = gltf.scene.getObjectByName(name);
        if (!o) continue;
        const box = new THREE.Box3().setFromObject(o);
        hatches.push({ o, x: o.position.x, dir, w: box.max.x - box.min.x });
      }
      g.remove(proc);
      g.add(gltf.scene);
    })
    .catch(() => {}); // keep the stand-in

  return {
    object: g,
    /** Settles once the Blender model is in (or failed and the stand-in stays). */
    loaded,
    /** Whether the roof opening has doors (the model); if not, the caller reveals the opening itself. */
    hasHatch: () => hatches.length > 0,
    /** 0 shut → 1 the roof hatch doors slid fully apart. */
    setHatch(k: number) {
      const e = k * k * (3 - 2 * k);
      hatches.forEach((h) => (h.o.position.x = h.x + h.dir * h.w * 0.98 * e));
    },
    /** Haze cards: not surfaces, so keep them out of depth/normal passes. */
    air,
    /** 0 dark → 1 normal, for the intro and the hand-off. */
    setLevel(k: number) {
      level = k;
      lampMat.color.set('#ffe0b0').multiplyScalar(3.2 * k);
      windowMat.color.set('#8ea3b4').multiplyScalar(0.55 * k);
      glows.forEach((gl) => gl.mat.color.copy(gl.base).multiplyScalar(gl.k * k));
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
