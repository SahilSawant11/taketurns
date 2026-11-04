/**
 * Material explanations. General descriptions below are written as
 * industry-typical and qualified ("typically", "can"). Company-specific
 * values — thicknesses, resins, standards, test data — are `null` until the
 * owner confirms them with a source.
 */

export type Layer = {
  id: string;
  name: string;
  role: string;
  detail: string;
  /** relative visual thickness in the diagram, not a real dimension */
  weight: number;
  tone: string;
  /** TODO(owner): confirmed spec, e.g. "2.5 mm, vinyl ester + C-glass veil" */
  spec: string | null;
};

export type Property = {
  name: string;
  need: string; // the buyer need it answers
  implication: string;
  // TODO(owner): approved figure/claim + its source document.
  evidence: { claim: string; source: string } | null;
};

export type MaterialSlug = 'frp' | 'gls' | 'ss';

export type Material = {
  slug: MaterialSlug;
  short: string;
  name: string;
  accent: string;
  oneLiner: string;
  plain: string;
  layers: Layer[];
  diagramCaption: string;
  // TODO(owner): replace with the actual fabrication steps used.
  process: { step: string; note: string }[] | null;
  properties: Property[];
  goodFitFor: string[];
  checkFirst: string[];
  /** Construction variants within the family, e.g. FRP liner options. */
  variants?: { name: string; body: string }[];
};

export const materials: Material[] = [
  {
    slug: 'frp',
    short: 'FRP',
    name: 'Fibre-reinforced plastic',
    accent: 'var(--frp)',
    oneLiner: 'Glass fibre for strength, resin for chemical resistance, built up in layers.',
    plain:
      'FRP (also called GRP) is a composite: glass fibres carry the load, and a thermoset resin binds them and forms the barrier against what is stored or carried. Because it is laid up in layers, each layer can be specified for a different job, so the inside faces the chemistry and the outside faces the weather.',
    diagramCaption: 'A typical FRP laminate for corrosive service. The actual layers and resins depend on the duty.',
    layers: [
      {
        id: 'liner',
        name: 'Inner surface',
        role: 'Faces the contents',
        detail:
          'A resin-rich layer, usually reinforced with a thin surface veil. It is the first defence against chemical attack and gives a smooth, cleanable face.',
        weight: 1,
        tone: '#cfe9d3',
        spec: null,
      },
      {
        id: 'barrier',
        name: 'Corrosion barrier',
        role: 'Backs up the surface',
        detail:
          'Chopped-strand reinforcement in the same chemical-resistant resin. It adds thickness so that small surface damage does not reach the structure.',
        weight: 1.6,
        tone: '#8fd0a5',
        spec: null,
      },
      {
        id: 'structural',
        name: 'Structural layer',
        role: 'Carries the load',
        detail:
          'Continuous glass fibre, filament-wound or hand-laid, sized to carry the pressure, loads and handling stresses. Thickness is set by design calculation, not by rule of thumb.',
        weight: 3.4,
        tone: '#3f9e68',
        spec: null,
      },
      {
        id: 'exterior',
        name: 'Exterior finish',
        role: 'Faces the environment',
        detail:
          'A resin topcoat that can include UV inhibitors, pigment or fire-retardant additives, depending on where the equipment sits.',
        weight: 0.8,
        tone: '#1c5e3d',
        spec: null,
      },
    ],
    process: null,
    properties: [
      {
        name: 'Chemical resistance',
        need: 'Storing or handling acids, alkalis, brine or effluent',
        implication:
          'Resistance depends on the resin and on the medium, concentration and temperature. Each duty is checked against resin data, not assumed.',
        evidence: null,
      },
      {
        name: 'Weight',
        need: 'Transport, lifting and supporting structures',
        implication:
          'FRP is typically much lighter than steel for a comparable duty, which can simplify handling and foundations. The actual weight comes from the design.',
        evidence: null,
      },
      {
        name: 'No rust',
        need: 'Coastal, marine and wet environments',
        implication:
          'FRP does not rust the way steel does, but it still needs inspection. UV exposure, temperature and mechanical damage all matter.',
        evidence: null,
      },
      {
        name: 'Formability',
        need: 'Custom shapes, ducts, covers and fittings',
        implication:
          'Moulded and wound parts can be made in shapes that would be costly to fabricate in metal.',
        evidence: null,
      },
    ],
    variants: [
      {
        name: 'Composite (FRP / GRP)',
        body: 'An all-composite build, with the resin system and laminate designed for the specific chemical duty.',
      },
      {
        name: 'Dual laminate',
        body: 'A thermoplastic liner backed by FRP structure. The liner handles severe chemical service, and the FRP carries the load.',
      },
      {
        name: 'Thermoplastic',
        body: 'Thermoplastic equipment for aggressive chemical environments where it suits the temperature and size.',
      },
    ],
    goodFitFor: [
      'Corrosive or chemically aggressive contents',
      'Coastal, marine and brine environments',
      'Custom geometry: ducts, scrubbers, covers, fittings',
    ],
    checkFirst: [
      'Operating temperature against the resin limits',
      'Pressure or vacuum duty',
      'Abrasive solids in the medium',
      'Fire-performance requirements',
    ],
  },
  {
    slug: 'gls',
    short: 'GLS',
    name: 'Glass-lined steel',
    accent: 'var(--gls)',
    oneLiner: 'Steel for strength, a fused glass coating for a hard, inert surface.',
    plain:
      'Glass-lined steel (also called glass-fused-to-steel) bonds a glass coating to steel sheet at high temperature. The steel provides the structure, and the glass forms a hard, impervious surface on it. The panels are usually made in a factory and bolted together on site, which suits large tanks.',
    diagramCaption: 'A typical glass-fused-to-steel panel section. Coating build and steel grade depend on the specification.',
    layers: [
      {
        id: 'inner-glass',
        name: 'Inner glass coat',
        role: 'Faces the contents',
        detail:
          'A glass coating fused to the steel during firing. It is hard, smooth and inert, and resists sticking and staining.',
        weight: 0.9,
        tone: '#7fa7c9',
        spec: null,
      },
      {
        id: 'steel',
        name: 'Steel substrate',
        role: 'Carries the load',
        detail:
          'Steel sheet chosen and sized for the tank’s diameter, height, contents and site loads such as wind or seismic.',
        weight: 3.6,
        tone: '#5d6772',
        spec: null,
      },
      {
        id: 'outer-glass',
        name: 'Outer glass coat',
        role: 'Faces the environment',
        detail:
          'Coating on the outside face. It protects the steel from weather and can come in a choice of colour.',
        weight: 0.9,
        tone: '#3f6f98',
        spec: null,
      },
    ],
    process: null,
    properties: [
      {
        name: 'Inert, hard surface',
        need: 'Potable water, wastewater, process liquids',
        implication:
          'Glass does not react with many liquids and resists build-up. How well it holds up depends on the pH and temperature of the contents.',
        evidence: null,
      },
      {
        name: 'Modular bolted build',
        need: 'Large volumes, remote or constrained sites',
        implication:
          'Factory-coated panels are bolted together on site, which can reduce site welding and coating work. The seams and sealant then need to be specified and inspected.',
        evidence: null,
      },
      {
        name: 'Factory-controlled coating',
        need: 'Consistent finish and predictable maintenance',
        implication:
          'The coating is applied and checked in the factory before the panels leave. That avoids painting in the field, where weather and access make it harder to control.',
        evidence: null,
      },
      {
        name: 'Expandable',
        need: 'Capacity that may grow',
        implication:
          'Depending on the design, bolted tanks can sometimes be extended or moved. This needs to be checked case by case.',
        evidence: null,
      },
    ],
    goodFitFor: [
      'Large-volume water and wastewater storage',
      'Digesters and biogas, where specified',
      'Sites where field welding or coating is difficult',
    ],
    checkFirst: [
      'pH and temperature range of the contents',
      'Abrasive or very high-solids media',
      'Foundation and site-access constraints',
      'Applicable tank standard for the region',
    ],
  },
  {
    slug: 'ss',
    short: 'SS',
    name: 'Stainless steel',
    accent: 'var(--ss)',
    oneLiner: 'Hygienic, cleanable vessels for food, beverage and process duty.',
    plain:
      'Stainless steel vessels are the standard where product contact, hygiene and cleaning matter, as in food and beverage. The steel itself resists corrosion, so the inside finish, the welds and the cleaning design do most of the work. Jackets and insulation are added when the process needs heating or cooling.',
    diagramCaption: 'A typical jacketed, insulated process vessel wall. Many vessels use only the inner shell.',
    layers: [
      {
        id: 'contact',
        name: 'Product-contact surface',
        role: 'Faces the contents',
        detail:
          'The inside face of the shell, finished smooth so it drains fully and cleans easily. Surface finish and weld quality are specified to suit the product.',
        weight: 0.7,
        tone: '#e3e7eb',
        spec: null,
      },
      {
        id: 'shell',
        name: 'Stainless shell',
        role: 'Carries the load',
        detail:
          'The pressure-bearing wall. The grade is chosen for the product and the cleaning chemicals, and the thickness by design for the pressure and loads.',
        weight: 2.2,
        tone: '#b4bcc4',
        spec: null,
      },
      {
        id: 'jacket',
        name: 'Heating / cooling jacket',
        role: 'Controls temperature',
        detail:
          'An optional jacket around the shell that carries steam, hot water or coolant to hold the product at process temperature.',
        weight: 1.1,
        tone: '#8e99a4',
        spec: null,
      },
      {
        id: 'insulation',
        name: 'Insulation & cladding',
        role: 'Faces the environment',
        detail:
          'Insulation holds the temperature and protects people from hot surfaces. An outer stainless cladding keeps it clean and dry.',
        weight: 1.3,
        tone: '#5f6a75',
        spec: null,
      },
    ],
    process: null,
    properties: [
      {
        name: 'Hygienic surface',
        need: 'Food, beverage and product-contact duty',
        implication:
          'Smooth, crevice-free surfaces that drain fully support cleaning-in-place and hygiene requirements. The finish has to be specified and checked.',
        evidence: null,
      },
      {
        name: 'Temperature control',
        need: 'Heating, cooling, fermentation, holding',
        implication: 'Jackets and insulation let the vessel play an active part in the process, not just store the product.',
        evidence: null,
      },
      {
        name: 'Corrosion resistance',
        need: 'Wet, washed-down environments',
        implication:
          'Stainless resists general corrosion well, but chlorides and some cleaning chemicals can still attack it. The grade has to match the duty.',
        evidence: null,
      },
    ],
    goodFitFor: [
      'Food and beverage processing and storage',
      'Jacketed and insulated process vessels',
      'Duties where cleaning-in-place is required',
    ],
    checkFirst: [
      'Chloride content of the product or wash water',
      'Required surface finish and hygiene standard',
      'Pressure, vacuum and temperature duty',
      'Cleaning chemicals and their temperature',
    ],
  },
];

export const getMaterial = (slug: string) => materials.find((m) => m.slug === slug);

/**
 * 3D illustration (public/renders/<name>.jpg) for a material, solution or
 * application slug. Equipment shots are rendered in Blender (scripts/blender/renders.py);
 * the macros and sections still come from /dev/render. Swap for real photos via
 * <ImageSlot src>. Slugs without an entry get a neutral frame.
 */
const RENDERS: Record<string, string> = {
  frp: 'frp-macro',
  gls: 'gls-macro',
  ss: 'ss-macro',
  'chemical-process': 'frp-tank',
  'marine-brine': 'frp-pipe',
  'food-beverage': 'ss-vessel',
  'water-storage': 'gls-tank',
  'frp-process-equipment': 'frp-tank',
  'dual-laminate': 'frp-vessel',
  thermoplastic: 'thermo-tank',
  'gls-equipment': 'gls-tank',
  'fb-vessels': 'ss-vessel',
};
export const renderFor = (slug: string) => RENDERS[slug];
