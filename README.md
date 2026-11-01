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

- **Timeline:** a single loop time drives it, through five stages: mandrel → surface veil → winding → curing → finished vessel. Timings are in `STAGES`.
- **How the bands are drawn:** a fragment shader lays down the helical bands. `N` sets bands per direction, and `DU` sets turns per pass, which works out to about a 58° winding angle.
- **Reduced motion:** visitors who prefer reduced motion get still frames. The step buttons still work.
- **No WebGL:** the steps fall back to a text walkthrough.
- **Intro:** on a load at the top of the page, the lights come up and the camera dollies in while the headline rises in. The headline is hidden by an inline script before first paint and revealed when the scene reports ready (or after 4.5 s, whatever happens).
- **Idle life:** the bare mandrel turns slowly before winding starts, the camera drifts and follows the mouse a little, dust drifts through the key light's shaft (`src/scripts/three/atmosphere.ts`), and the finished vessel sways on a slow turntable.
- **Fibre tow:** `src/scripts/three/tow.ts` runs the roving off the creel spool, under the wet-out roller, through the payout eye and onto the mandrel at the band's head. Its texture scrolls with the fibre feed.
- **Cinematography:** midway through winding, the camera swings in on an arc to a close-up of the laying point, with depth of field (`BokehPass`, only on during the close-up), then pulls back out to show the full pattern. Soft bloom picks out clear-coat glints and the heater tubes.
- **Stages:** the surface veil wraps on along the mandrel in overlapping turns (`vessel.ts`). An IR heater bank (`src/scripts/three/heater.ts`) lowers in for curing, with faint vapour off the laminate. On the finished vessel, nozzles and lugs rise out of the shell, the manway slides out of the dome and the saddles rise through the floor, each settling into place.
- **Workshop:** `src/scripts/three/workshop.ts` puts a gantry crane, racking, stored tanks, pendant lamps and high windows behind the machine. Layers of depth haze (kept out of the AO and depth-of-field passes) turn them into distant silhouettes.
- **Hand-off:** as the hero scrolls out (`setExit`), the camera drops and tilts up so the vessel stays in the part of the canvas still on screen, the lights close down, and the lower frame fades into the next section's colour (`--exit` on `.wh__fx::before`). The fittings are all seated by about 75% of the Finished stage, which leaves a short hold on the product.
- **Adaptive quality:** if frames average slower than ~45 fps, it steps down once at a time (AO off → lower pixel ratio, no bloom or depth of field → smaller shadow map). In dev, each step logs `[hero] quality tier N`.
- **Rendering:** it renders every frame while visible, and pauses when off-screen or when the tab is hidden. Drag-to-rotate works only with a mouse, so touch scrolling isn't hijacked.

See `OWNER-INPUTS.md` for everything still needed from the owner.

## The drop (home page)

A single drop of aggressive liquid follows the home page on a fixed, click-through canvas (`src/components/FloatingDrop.astro` + `src/scripts/drop.ts`). It's the thing every wall on the site is engineered to hold.

- **Placement:** it sits beside each section's headline. Between sections it falls to the next one, stretching into a teardrop with speed and wobbling when it stops (two damped surface modes driven by its acceleration).
- **Tone:** over dark sections it reads as clear liquid (bright rim, caustic glow). Over bone and green sections it's dark, glossy liquid.
- **Life:** a slow idle wobble. On desktop it leans towards a nearby cursor and ripples when the cursor moves across it. A soft shadow on the page lifts and fades as it falls, and a few small drops drift at depth with scroll parallax.
- **Finale:** it waits above the screen during "Show the work", then falls into an FRP dish on the finale's stage (`.finale__stage`). The dish is wound laminate with a quarter cut away so the wall shows its layers. It splashes, and settles.
- **Opting in:** a section opts in with `data-float="<pose>"` (poses are in `poseFor`). `data-float-ref` gives a pose its own stage. `data-float="hidden"` markers fade it out after the hero and before the footer.
- **Phones:** it's smaller and sits above each section's label.
- **Reduced motion:** it snaps to each pose with no wobble.
- **Dev check:** in dev, add `?settle` to the URL to snap it to exact poses.

Smooth scrolling is Lenis (`src/components/SmoothScroll.astro`), on every page and off for reduced motion.
