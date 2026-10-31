/**
 * Solutions, applications, projects and resources.
 * `confirmed: true` = the category appears in Shaktinova's own company profile.
 * `confirmed: false` = a layout placeholder that renders as "to be confirmed".
 * Summaries are general descriptions; specific sizes/specs still need the owner.
 */
import type { MaterialSlug } from './materials';

export type Solution = {
  slug: string;
  name: string;
  material: MaterialSlug | 'service';
  summary: string;
  confirmed: boolean;
};

export const solutions: Solution[] = [
  { slug: 'frp-process-equipment', name: 'FRP / GRP chemical process equipment', material: 'frp', summary: 'Tanks, vessels, scrubbers, ducting and piping for corrosive process duty.', confirmed: true },
  { slug: 'dual-laminate', name: 'Dual-laminate equipment', material: 'frp', summary: 'Thermoplastic-lined FRP for severe industrial chemical service.', confirmed: true },
  { slug: 'thermoplastic', name: 'Thermoplastic equipment', material: 'frp', summary: 'Thermoplastic solutions for aggressive chemical environments.', confirmed: true },
  { slug: 'marine-brine', name: 'Marine & brine equipment', material: 'frp', summary: 'FRP vessels and pipework for brine, seawater and coastal service.', confirmed: true },
  { slug: 'gls-equipment', name: 'Glass-lined (glass-fused-to-steel) tanks', material: 'gls', summary: 'Bolted, factory-coated tanks for large-volume storage.', confirmed: true },
  { slug: 'fb-vessels', name: 'F&B stainless steel vessels', material: 'ss', summary: 'Process and storage vessels for food and beverage duty.', confirmed: true },
  { slug: 'engineering', name: 'Engineering, design & cost engineering', material: 'service', summary: 'Material selection, system design, cost engineering and technical support.', confirmed: true },
  { slug: 'project-management', name: 'Project management & partner coordination', material: 'service', summary: 'End-to-end coordination, partner selection, manufacturing oversight, quality documentation.', confirmed: true },
];

export type Application = {
  slug: string;
  name: string;
  challenge: string;
  materials: MaterialSlug[];
  considerations: string[];
  imageNeed: string;
  confirmed: boolean;
};

export const applications: Application[] = [
  {
    slug: 'chemical-process',
    name: 'Chemical & process',
    challenge: 'Aggressive media, temperature swings, and costly downtime if the material fails.',
    materials: ['frp'],
    considerations: ['Medium, concentration and temperature', 'Composite, dual-laminate or thermoplastic build', 'Venting, nozzles and supports'],
    imageNeed: 'FRP process tanks / scrubber installed at a plant (profile video has examples; originals needed)',
    confirmed: true,
  },
  {
    slug: 'marine-brine',
    name: 'Marine & brine',
    challenge: 'Salt, humidity and spray that corrode unprotected steel quickly.',
    materials: ['frp'],
    considerations: ['Chloride exposure', 'UV and weathering', 'Wind loads on exposed sites'],
    imageNeed: 'FRP brine vessel or marine pipework (profile video has examples; originals needed)',
    confirmed: true,
  },
  {
    slug: 'food-beverage',
    name: 'Food & beverage',
    challenge: 'Hygienic, cleanable vessels that hold temperature and survive daily wash-down.',
    materials: ['ss'],
    considerations: ['Product-contact finish', 'Cleaning-in-place regime', 'Heating, cooling and insulation'],
    imageNeed: 'Stainless F&B vessels on site (profile video has examples; originals needed)',
    confirmed: true,
  },
  {
    slug: 'water-storage',
    name: 'Water & effluent storage',
    challenge: 'Large volumes, long service expectations, and sites where field coating is hard.',
    materials: ['gls', 'frp'],
    considerations: ['Capacity and footprint', 'Potable-water approvals where needed', 'Roof, access and instrumentation'],
    imageNeed: 'Glass-fused-to-steel tank installation (profile video has examples; originals needed)',
    confirmed: false,
  },
];

export const getApplication = (slug: string) => applications.find((a) => a.slug === slug);

export type Project = {
  slug: string;
  title: string;
  sector: string;
  location: string;
  material: MaterialSlug;
  challenge: string;
  solution: string;
  outcome: string;
  image: string; // path under /public
  approvedToPublish: true;
};

// TODO(owner): the profile video shows photos of "some contributions" — send the
// original photos plus client/location/outcome details and publishing permission.
export const projects: Project[] = [];

export type Resource = { title: string; kind: string; file: string; size?: string };

// TODO(owner): add real files to /public/downloads and list them here.
export const resources: Resource[] = [];

// General explanatory FAQs; answers avoid company-specific claims.
export const faqs = [
  {
    q: 'Do you manufacture the equipment yourselves?',
    a: 'Shaktinova is asset-light. We engineer the solution and manage the project, and qualified manufacturing partners build it under our coordination and quality oversight. Because we aren’t tied to one manufacturer, we can choose the partner that best fits the job.',
  },
  {
    q: 'How do I choose between FRP, glass-lined steel and stainless?',
    a: 'Start with what is being stored or handled, at what temperature, and how much of it. FRP suits chemically aggressive duty and custom shapes. Glass-lined steel suits large bolted storage tanks. Stainless suits hygienic and food-grade process vessels. Where more than one would work, the site, schedule and lifecycle cost decide.',
  },
  {
    q: 'What is dual laminate?',
    a: 'A thermoplastic liner bonded to an FRP structure. The liner gives a high level of chemical resistance, and the FRP gives strength at lower weight. It is used for severe chemical service.',
  },
  {
    q: 'What information do you need for a quote?',
    a: 'The medium and its concentration, operating temperature and pressure, the capacity or dimensions, the site location and any applicable standards. Drawings or a specification sheet help most. The inquiry form walks through each of these.',
  },
  {
    q: 'Is FRP maintenance-free?',
    a: 'No material is. FRP does not rust, but it should still be inspected for surface wear, UV weathering and mechanical damage. How often depends on the duty.',
  },
];
