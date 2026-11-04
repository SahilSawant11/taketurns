import { defineConfig } from 'astro/config';

// TODO(owner): set the production domain once confirmed.
export default defineConfig({
  site: 'https://example.com',
  vite: {
    // Pre-bundle every dependency the pages import, up front. Found one page at a time instead,
    // a new import leaves the dev server's cache "outdated" (504s), and the page script that
    // imports it fails whole: on the home page that left the "Inside the wall" tabs dead.
    optimizeDeps: {
      include: [
        'three',
        'gsap',
        'gsap/ScrollTrigger',
        'gsap/SplitText',
        'lenis',
        'three/examples/jsm/environments/RoomEnvironment.js',
        'three/examples/jsm/geometries/RoundedBoxGeometry.js',
        'three/examples/jsm/libs/meshopt_decoder.module.js',
        'three/examples/jsm/loaders/GLTFLoader.js',
        'three/examples/jsm/postprocessing/BokehPass.js',
        'three/examples/jsm/postprocessing/EffectComposer.js',
        'three/examples/jsm/postprocessing/GTAOPass.js',
        'three/examples/jsm/postprocessing/OutputPass.js',
        'three/examples/jsm/postprocessing/RenderPass.js',
        'three/examples/jsm/postprocessing/ShaderPass.js',
        'three/examples/jsm/postprocessing/UnrealBloomPass.js',
        'three/examples/jsm/utils/BufferGeometryUtils.js',
      ],
    },
  },
});
