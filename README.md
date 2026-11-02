# Shaktinova Projects website

A multi-page site for Shaktinova Projects' FRP, glass-lined steel (GLS) and stainless steel solutions. Built with [Astro](https://astro.build) 5 and plain CSS.

- **Home:** dark and cinematic. It opens with a 3D filament-winding demo built with [three.js](https://threejs.org), which is loaded only on that page and split into its own file.
- **Inner pages:** stay light so they're easy to scan.
- **Other JavaScript:** the layer diagrams, tabs, mobile menu and inquiry form.

## Run

Requires Node 18.20+ or 20.3+.

```bash
npm install
npm run dev       # http://localhost:4321, shows owner TODO notes
npm run build     # static site in dist/, TODOs shown as neutral "To be confirmed"
npm run preview   # serve the built site
```

Deploy `dist/` to any static host (Netlify, Vercel, Cloudflare Pages, S3…).

## Where things live

| What | File |
|---|---|
| Company facts, services, contact channels | `src/content/site.ts` |
| 3D filament-winding hero | `src/scripts/winding.ts` (scene) + `src/components/WindingHero.astro` (UI) |
| Company profile video | `public/video/shaktinova-profile.mp4` (About page) |
| Material copy, layers, properties, evidence | `src/content/materials.ts` |
| Solutions, applications, projects, downloads, FAQs | `src/content/catalog.ts` |
| Inquiry sending | `src/lib/submitInquiry.ts` + `.env` |
| Colours, type, spacing | `src/styles/global.css` (`:root`) |

### Placeholder conventions

- **`null` values** (company name, contact details, layer specs, property evidence, process steps) render through `<Pending>`. In dev it shows the exact owner TODO; in production it shows a neutral "To be confirmed".
- **`confirmed: false`** on solutions and applications marks a layout placeholder. Set it to `true` once the item is verified.
- **Images:** `<ImageSlot need="…">` shows a material texture plus the brief for the photo needed. Pass `src="/images/…"` once a real, approved photo exists.
- **Projects and downloads** only appear when they're added to their arrays. Empty arrays show an honest empty state.

## Inquiry form

The form has five steps: contact → interest → project → technical → review. It validates each step, saves a draft to `localStorage`, and prefills from `?solution=<slug>` and `?type=technical`.

To enable sending, copy `.env.example` to `.env` and set `PUBLIC_INQUIRY_ENDPOINT` to any endpoint that accepts a JSON POST (for example a Formspree form URL). Without it, submitting shows a "not set up yet" screen with the inquiry as copyable text. It never fakes a success.

## 3D hero

The scene is generated in code, so there are no model files.

- **Timeline:** scroll progress drives it through seven stages: mandrel → surface veil → winding → curing → off the mandrel → into service → in the plant. Timings are in `STAGE_P` (`src/scripts/three/stages.ts`).
- **How the bands are drawn:** a fragment shader lays down the helical bands. `N` sets bands per direction, and `DU` sets turns per pass, which works out to about a 58° winding angle.
- **Reduced motion:** visitors who prefer reduced motion get still frames. The step buttons still work.
- **No WebGL:** the steps fall back to a text walkthrough.
- **Intro:** on a load at the top of the page, the lights come up and the camera dollies in while the headline rises in. The headline is hidden by an inline script before first paint and revealed when the scene reports ready (or after 4.5 s, whatever happens).
- **Idle life:** the bare mandrel turns slowly before winding starts, the camera drifts and follows the mouse a little, dust drifts through the key light's shaft (`src/scripts/three/atmosphere.ts`), and the finished vessel sways on a slow turntable.
- **Fibre tow:** `src/scripts/three/tow.ts` runs the roving off the creel spool, under the wet-out roller, through the payout eye and onto the mandrel at the band's head. Its texture scrolls with the fibre feed.
- **Cinematography:** midway through winding, the camera swings in on an arc to a close-up of the laying point, with depth of field (`BokehPass`, only on during the close-up), then pulls back out to show the full pattern. Soft bloom picks out clear-coat glints and the heater tubes.
- **Stages:** the surface veil wraps on along the mandrel in overlapping turns (`vessel.ts`). An IR heater bank (`src/scripts/three/heater.ts`) lowers in for curing, with faint vapour off the laminate. The wound part is an open, flanged stack section (`spoolProfile`), not a closed tank.
- **Off the mandrel:** the machine fades, the section is topcoated and flanged and sits on timber cradles. The crane hook comes down and slings onto two lugs. The section is upended about its lower end and lifted towards a roof opening full of daylight, and the frame whites out (`uFlash` in the grade pass).
- **Outside:** under the white-out the composer swaps to a second scene, `src/scripts/three/plant.ts`: a daytime industrial estate (grey-box, procedural). The section is lowered onto an FRP fume scrubber as its stack and bolted, and the hook lets go. Then the system starts: the neighbours' brick chimneys keep putting out brown haze, while our stack gives a faint white wisp. The plant is built and its shaders compiled during curing, so the swap doesn't stutter.
- **Blender models:** the scrubber is modelled by `scripts/blender/scrubber.py` (bevelled parts, ambient occlusion baked with Cycles into the glTF occlusion map). To rebuild it: `blender -b -P scripts/blender/scrubber.py -- /tmp/scrubber.glb && npx gltfpack -i /tmp/scrubber.glb -o public/models/scrubber.glb -cc -kn -km`. It loads with meshopt decoding during curing. If it can't load, a procedural stand-in shows instead.
- **The workshop:** `scripts/blender/workshop.py` builds a portal-frame shop: I-section columns, Pratt roof trusses, purlins trimmed round a roof opening over the machine, sliding hatch doors (`ws_hatch_l`/`ws_hatch_r`, slid by `setHatch`), window strips, skylights, high-bay lamps, an overhead crane parked down the bay, and a filament-winding shop floor (roving racks, resin drums, FRP pipe, finished duct sections, walkway lines). Materials named `ws_glow_*` are drawn unlit at the scene's light level. To rebuild it: `blender -b -P scripts/blender/workshop.py -- /tmp/workshop.glb && npx gltfpack -i /tmp/workshop.glb -o public/models/workshop.glb -cc -kn -km`. Shared mesh helpers live in `scripts/blender/kit.py`.
- **The estate:** `scripts/blender/estate.py` lays out a road grid, compound plots and buildings typical of an Indian industrial estate: portal-frame sheds with ridge ventilators and skylights, north-light sawtooth factories, flat-roofed blocks with black rooftop water tanks, container yards, the tank farm, the glass-lined tanks, the pipe rack, chimneys and the process building. The ground is painted, then baked with Cycles under the same sun as three.js, so every shadow is in one unlit texture. Trees are instanced in three.js from `public/models/estate-trees.json`, but they're in the bake so their shadows are too. To rebuild it: `blender -b -P scripts/blender/estate.py -- /tmp/estate.glb public/models/estate-trees.json && npx gltfpack -i /tmp/estate.glb -o public/models/estate.glb -cc -kn -km`. Plume and pin positions in `plant.ts` match the layout constants at the top of the script.
- **In the plant:** the camera rises to a sky view. HTML pins (`.wh__pin` in `WindingHero.astro`) track points from `plant.pins` and link to the matching solution or application. They're only focusable once faded in.
- **Workshop:** `src/scripts/three/workshop.ts` puts a gantry crane, racking, stored tanks, pendant lamps and high windows behind the machine. Layers of depth haze (kept out of the AO and depth-of-field passes) turn them into distant silhouettes.
- **Hand-off:** as the hero scrolls out (`setExit`), the camera drops and tilts up so the vessel stays in the part of the canvas still on screen, the lights close down, and the lower frame fades into the next section's colour (`--exit` on `.wh__fx::before`). 
- **Adaptive quality:** if frames average slower than ~45 fps, it steps down once at a time (AO off → lower pixel ratio, no bloom or depth of field → smaller shadow map). In dev, each step logs `[hero] quality tier N`.
- **Rendering:** it renders every frame while visible, and pauses when off-screen or when the tab is hidden. Drag-to-rotate works only with a mouse, so touch scrolling isn't hijacked.

See `OWNER-INPUTS.md` for everything still needed from the owner.

## The leaf (home page)

A single leaf follows the home page on a fixed, click-through canvas (`src/components/FloatingLeaf.astro` + `src/scripts/leaf.ts`). It stands for clean air, which is what the plant's FRP is there to protect.

- **Placement:** it rests beside each section's headline. Between sections it glides down to the next one the way a leaf falls: swinging side to side, banking into each swing, and turning over once mid-fall.
- **Shape:** a peepal leaf (Ficus religiosa): heart-shaped base, long drip tip. `scripts/blender/leaf.py` draws its outline and venation and bakes a high-poly relief with Cycles into `public/models/leaf/` (`leaf-normal.webp` for the vein relief, and `leaf-detail.webp`: R albedo, G veins, B margin, A cutout). The page bends a subdivided plane in the vertex shader (midrib fold, lengthwise curl, twist, a flutter wave from stem to tip) and tints the textures per section. Until they load, a simple procedural leaf stands in. To rebuild it: `blender -b -P scripts/blender/leaf.py -- public/models/leaf /tmp/leaf-preview.png`.
- **Tone:** pale and backlit over dark and green sections, with the veins showing dark against the light. Deep green over bone sections.
- **Life:** a slow idle flutter and turn. Scrolling fast stirs it like wind. On desktop, a fast cursor nearby is a breeze that pushes it away. A soft shadow on the page lifts and fades in flight, and a few small leaves drift down at depth with scroll parallax.
- **Finale:** it waits above the screen during "Show the work", then drifts down onto the finale's stage (`.finale__stage`), rocks once, and lies still on a contact shadow.
- **Opting in:** a section opts in with `data-float="<pose>"` (poses are in `poseFor`). `data-float-ref` gives a pose its own stage. `data-float="hidden"` markers fade it out after the hero and before the footer.
- **Phones:** it's smaller and sits above each section's label.
- **Reduced motion:** it snaps to each pose with no flutter.
- **Dev check:** in dev, add `?settle` to the URL to snap it to exact poses.

Smooth scrolling is Lenis (`src/components/SmoothScroll.astro`), on every page and off for reduced motion.
