/**
 * Live viewer for the wall cutaway in <LayerDiagram>. Transparent background
 * so it sits on light and dark sections; renders only while layers move.
 */
import * as THREE from 'three';
import { buildSection, type SectionLayer } from './three/section';
import { studioEnvironment } from './three/vessel';
import { frameLoop } from './motion';

export function createSectionView(canvas: HTMLCanvasElement, layers: SectionLayer[], still: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const env = studioEnvironment(renderer);
  scene.environment = env;
  scene.environmentIntensity = 0.5;

  const key = new THREE.SpotLight('#f6f7f8', 60, 30, 0.6, 1, 1.2);
  key.position.set(-1.2, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 8;
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#ffffff', 1.4);
  rim.position.set(4, 3, -4);
  scene.add(rim);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: 0.28 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const section = buildSection(layers);
  scene.add(section.group);
  key.target.position.copy(section.centre);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);
  const frame = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Fit the section (plus room for lift/explode) to the frame.
    const vfov = THREE.MathUtils.degToRad(camera.fov / 2);
    const hfov = Math.atan(Math.tan(vfov) * camera.aspect);
    const fit = (section.radius * 1.32) / Math.sin(Math.min(vfov, hfov));
    const look = section.centre.clone().add(new THREE.Vector3(0, 0.12, 0.2));
    camera.position.copy(look).add(new THREE.Vector3(0.55, 0.5, 0.68).normalize().multiplyScalar(fit));
    camera.lookAt(look);
  };

  let last = 0;
  const render = () => renderer.render(scene, camera);
  const tick = (now: number) => {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    const moving = section.update(still ? 1 : dt);
    render();
    if (!moving) loop.stop();
  };
  const loop = frameLoop(tick);
  const kick = () => {
    if (loop.running) return;
    last = 0;
    loop.start();
  };

  const ro = new ResizeObserver(() => {
    frame();
    kick();
  });
  ro.observe(canvas);
  frame();
  kick();

  let selected = 0;
  let exploded = false;
  return {
    select(i: number) {
      selected = i;
      section.set({ selected, exploded });
      kick();
    },
    explode(on: boolean) {
      exploded = on;
      section.set({ selected, exploded });
      kick();
    },
    dispose() {
      loop.stop();
      ro.disconnect();
      section.dispose();
      env.dispose();
      renderer.dispose();
    },
  };
}
