# Owner inputs needed: Shaktinova Projects

Run `npm run dev` to see each gap marked "Owner input" on the page. In a production build, gaps show as a neutral "To be confirmed".

## Already in the site
These come from shaktinovaprojects.com and the company profile video:
- Name, the "Empowering Projects" tagline, 13+ years, founder Sushil Naikwadi
- Asset-light, vendor-neutral model, the four services, and the key strengths
- Solution families: FRP/GRP chemical process equipment, dual laminate, thermoplastic, marine & brine, glass-lined (glass-fused-to-steel) tanks, F&B stainless vessels
- Applications: chemical & process, marine & brine, food & beverage

## Not reused on purpose
- The testimonials on the current site ("Michael Johnson" and "Emily White"). They look like WordPress template text. Send real, approved quotes if you have them.
- The current blog posts, which are template placeholders.
- Stock images from the profile video (calendar pins, balancing stones, staircase).

## Needed

### Identity
- [ ] Logo (SVG preferred). The header uses a text wordmark for now.
- [ ] Confirm the domain (`astro.config.mjs` → `site`)
- [x] Contact channels (`src/content/site.ts` → `contact`): compositeworks22@gmail.com and +91 98338 47341, confirmed 2026-11-09. WhatsApp on the same number and the address "Mumbai, India" confirmed too. Still open (later): an endpoint so the inquiry form sends directly (`PUBLIC_INQUIRY_ENDPOINT`; until then it opens the visitor's email, filled in).

### The 3D demo
- [ ] Confirm the partner manufacturers use **filament winding** for FRP vessels. The hero is labelled "illustrative", but it should still match real practice.

### Technical claims
- [ ] Fabrication steps per material → `src/content/materials.ts` → `process`
- [ ] Typical layer specs (resin and veil, liner material, steel grade, coating build, stainless grade and finish) → `layers[].spec`
- [ ] For each property, an approved figure and its source document → `properties[].evidence`
- [ ] Confirm the water & effluent storage application (`catalog.ts`, currently `confirmed: false`)
- [ ] Standards worked to, and partner qualifications or certificates

### Proof
- [ ] **Original photos** from the "contributions" slides in the profile video. The video is 848×478, too low-resolution to crop from. For each: client or sector, location, what was supplied, outcome, and permission to publish → `catalog.ts` → `projects`
- [ ] Workshop and fabrication photos from partners, if you're allowed to show them
- [ ] Company profile PDF and datasheets → `/public/downloads` + `catalog.ts` → `resources`
- [ ] The **DSD proposal PDF**. macOS blocked access to it inside WhatsApp's folder. Save a copy into this project folder.

### Company
- [ ] Founder bio and photo, plus other key team members (About page)

### Later, if wanted
- [ ] Real workshop or site footage for a hero video loop (10–30 s, landscape, 1080p+)
- [ ] Inquiry form endpoint (see README)
- [ ] Indicative calculator (needs an approved method), vendor onboarding, QR trade-show page
