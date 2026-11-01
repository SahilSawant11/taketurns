/**
 * Workshop air for the hero: dust motes that drift through the room and catch
 * the overhead key light, and a faint visible shaft for that light. Both are
 * additive and cheap; neither writes depth.
 */
import * as THREE from 'three';

const DUST_MIN = new THREE.Vector3(-7, -1.6, -4);
const DUST_SIZE = new THREE.Vector3(14, 7.5, 11);

export function createDust(count: number, key: THREE.SpotLight) {
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  // Positions come from the shader; this attribute only sets the draw count.
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const dir = new THREE.Vector3().subVectors(key.target.position, key.position).normalize();
  const uniforms = {
    uTime: { value: 0 },
    uScale: { value: 1 },
    uOpacity: { value: 0 },
    uMin: { value: DUST_MIN },
    uSize: { value: DUST_SIZE },
    uKey: { value: key.position.clone() },
    uKeyDir: { value: dir },
    uCosOuter: { value: Math.cos(key.angle * 0.55) },
    uCosInner: { value: Math.cos(key.angle * 0.15) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float uTime, uScale, uOpacity, uCosOuter, uCosInner;
      uniform vec3 uMin, uSize, uKey, uKeyDir;
      varying float vA;
      void main() {
        // slow rise on warm air, a lazy sideways swirl, wrapped inside the box
        vec3 drift = vec3(0.012, 0.03 * (0.4 + seed.w), 0.008) * uTime;
        vec3 q = fract(seed.xyz + drift / uSize);
        vec3 p = uMin + q * uSize;
        p.x += sin(uTime * 0.23 + seed.w * 40.0) * 0.14;
        p.z += cos(uTime * 0.19 + seed.w * 23.0) * 0.14;
        float beam = smoothstep(uCosOuter, uCosInner, dot(normalize(p - uKey), uKeyDir));
        float twinkle = 0.6 + 0.4 * sin(uTime * (0.5 + seed.w * 1.6) + seed.x * 30.0);
        vec3 e = min(q, 1.0 - q);
        float edge = smoothstep(0.0, 0.06, min(e.x, min(e.y, e.z)));
        vA = (0.012 + 0.988 * beam * beam) * twinkle * edge * uOpacity;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = max(1.0, uScale * (0.5 + seed.w) / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r);
        gl_FragColor = vec4(vec3(1.0, 0.96, 0.88), a * vA * 0.55);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    object: points,
    /** World size of a mote → point size in pixels for this viewport. */
    resize(heightPx: number, fovDeg: number) {
      uniforms.uScale.value = (0.034 * heightPx) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    },
    update(t: number, opacity: number) {
      uniforms.uTime.value = t;
      uniforms.uOpacity.value = opacity;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** A soft cone of light from the key spot down to the floor, brightest where seen edge-on through it. */
export function createBeam(key: THREE.SpotLight, floorY: number) {
  const target = key.target.position.clone();
  const dir = new THREE.Vector3().subVectors(target, key.position).normalize();
  const len = (key.position.y - floorY) / -dir.y;
  const geo = new THREE.CylinderGeometry(0.08, len * Math.tan(key.angle * 0.36), len, 64, 1, true);
  geo.translate(0, -len / 2, 0);
  const uniforms = { uI: { value: 0 }, uLen: { value: len } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uLen;
      varying vec3 vN, vV;
      varying float vAlong;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vAlong = -position.y / uLen;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uI;
      varying vec3 vN, vV;
      varying float vAlong;
      void main() {
        float f = pow(abs(dot(normalize(vN), normalize(vV))), 4.0);
        float along = smoothstep(0.0, 0.35, vAlong) * (1.0 - smoothstep(0.75, 1.0, vAlong));
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.92), f * along * uI);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(key.position);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  mesh.renderOrder = 2;
  return {
    object: mesh,
    update(intensity: number) {
      uniforms.uI.value = intensity;
      mesh.visible = intensity > 0.001;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

/** Faint vapour lifting off the warm laminate while it cures. */
export function createVapour(count: number, radius: number, halfLen: number) {
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const uniforms = { uTime: { value: 0 }, uAmount: { value: 0 }, uScale: { value: 1 }, uR: { value: radius }, uHalf: { value: halfLen } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float uTime, uAmount, uScale, uR, uHalf;
      varying float vA;
      void main() {
        float ph = fract(uTime / (3.5 + seed.w * 2.5) + seed.x);
        float a = (seed.z - 0.5) * 1.6; // around the top of the shell
        vec3 p = vec3((seed.y * 2.0 - 1.0) * uHalf, cos(a) * uR, sin(a) * uR);
        p.y += ph * (0.9 + seed.w * 0.8);
        p.x += sin(ph * 4.0 + seed.w * 20.0) * 0.12;
        p.z += ph * 0.25 * sign(a);
        vA = sin(3.14159 * ph) * sin(3.14159 * ph) * uAmount;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uScale * (0.4 + ph * 0.9) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r);
        gl_FragColor = vec4(vec3(0.95, 0.97, 0.96), a * a * vA * 0.022);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    object: points,
    resize(heightPx: number, fovDeg: number) {
      uniforms.uScale.value = (0.45 * heightPx) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    },
    update(t: number, amount: number) {
      uniforms.uTime.value = t;
      uniforms.uAmount.value = amount;
      points.visible = amount > 0.001;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
