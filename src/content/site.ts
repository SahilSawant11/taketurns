/**
 * Site-wide facts. Anything set to `null` is unconfirmed and renders as a
 * neutral "to be confirmed" state — never as a public claim.
 * Sources: shaktinovaprojects.com and the Shaktinova company profile video.
 * See OWNER-INPUTS.md for the full list of what is still needed.
 */
export const site = {
  companyName: 'Shaktinova Projects' as string | null,
  workingMark: 'Shaktinova',
  tagline: 'Empowering Projects',
  description:
    'Shaktinova Projects engineers FRP, glass-lined steel and stainless steel solutions for industrial projects, delivered through a qualified, vendor-neutral manufacturing partner network.',
  yearsExperience: '13+',
  founder: { name: 'Sushil Naikwadi', role: 'Founder' },
  contact: {
    // TODO(owner): confirm which channels to publish. The profile video lists
    // info@shaktinovaprojects.com, compositeworks22@gmail.com and +91 98338 47341, Mumbai.
    email: null as string | null,
    phone: null as string | null,
    whatsapp: null as string | null, // international format, digits only, e.g. "919800000000"
    address: null as string | null,
  },
};

export const nav = [
  { href: '/materials/', label: 'Materials' },
  { href: '/solutions/', label: 'Solutions' },
  { href: '/applications/', label: 'Applications' },
  { href: '/projects/', label: 'Projects' },
  { href: '/resources/', label: 'Resources' },
  { href: '/about/', label: 'About' },
];

/** Services as stated on the current site, in delivery order. */
export const services = [
  {
    name: 'Engineering, design & solutions',
    body: 'Material selection and system design for the duty, including design and cost engineering and technical support.',
  },
  {
    name: 'Manufacturing partner coordination',
    body: 'We pick the right qualified partner for the job and oversee manufacturing for quality and schedule. We are not tied to any one manufacturer.',
  },
  {
    name: 'Project management',
    body: 'One point of coordination from concept to delivery, with quality planning and documentation throughout.',
  },
  {
    name: 'Risk mitigation',
    body: 'Risks are identified early and planned for, so you can see what could affect the outcome and what is in place to handle it.',
  },
];

export const displayName = () => site.companyName ?? site.workingMark;
