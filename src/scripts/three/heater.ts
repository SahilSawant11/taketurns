/**
 * Infrared curing bank: a brushed reflector hood with quartz heater tubes that
 * is lowered over the turning vessel for the cure, then lifted away. Hung
 * from rods that run up out of frame, as if from an overhead gantry.
 */
import * as THREE from 'three';

export function createHeater(length = 4.6, radius = 1.78) {
  const group = new THREE.Group();
  const hoodMat = new THREE.MeshStandardMaterial({ color: '#5d6266', metalness: 0.7, roughness: 0.6, side: THREE.DoubleSide });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', metalness: 0.4, roughness: 0.6 });
  const tubeMat = new THREE.MeshStandardMaterial({ color: '#3a2a22', emissive: new THREE.Color('#ff5a14'), emissiveIntensity: 0, roughness: 0.2 });

  // Hood: an arc over the top and back of the vessel, open towards the camera side.
  const start = Math.PI * 0.32;
  const span = Math.PI * 0.78;
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 72, 1, true, start, span), hoodMat);
  hood.rotation.z = Math.PI / 2;
  group.add(hood);
  // Rolled edges along both long sides and end ribs.
  for (const th of [start, start + span]) {
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, length, 16), frameMat);
    lip.rotation.z = Math.PI / 2;
    lip.position.set(0, radius * Math.sin(th), radius * Math.cos(th));
    group.add(lip);
  }
  for (const x of [-length / 2, length / 2]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.04, 10, 72, span), frameMat);
    // torus arc lies in its XY plane from angle 0; map to the hood's (y, z) arc
    rib.rotation.set(0, Math.PI / 2, 0);
    rib.rotateZ(Math.PI - start - span);
    rib.position.x = x;
    group.add(rib);
  }
  // Quartz tubes inside the hood.
  const tubes = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const th = start + span * (0.12 + (i / 5) * 0.74);
    const r = radius - 0.16;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, length - 0.3, 12), tubeMat);
    tube.rotation.z = Math.PI / 2;
    tube.position.set(0, r * Math.sin(th), r * Math.cos(th));
    tubes.add(tube);
  }
  group.add(tubes);
  // Hangers up to the gantry.
  for (const x of [-length / 2 + 0.3, length / 2 - 0.3]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 8, 10), frameMat);
    rod.position.set(x, radius + 4, 0);
    group.add(rod);
  }
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });

  const light = new THREE.PointLight('#ff7a2e', 0, 7, 1.6);
  light.position.set(0, 1.1, -0.5);
  group.add(light);

  return {
    object: group,
    /** in: 0 raised out of shot → 1 in place; heat: 0 off → 1 full glow. */
    update(inAmt: number, heat: number) {
      group.visible = inAmt > 0.001;
      group.position.y = 4.2 * (1 - inAmt);
      tubeMat.emissiveIntensity = 7 * heat;
      tubeMat.color.setRGB(0.23 + 0.5 * heat, 0.16 + 0.15 * heat, 0.13);
      light.intensity = 9 * heat;
    },
  };
}
