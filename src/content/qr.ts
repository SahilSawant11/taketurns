/**
 * QR codes for print: brochures, business cards, presentations, exhibition
 * stands. Each code encodes a short link that never changes (/go/<slug>/);
 * where it lands is set here, so a printed code can be pointed somewhere new
 * without reprinting. The print sheet is /qr/ (kept out of search).
 */
export const qrCodes = [
  { slug: 'portfolio', label: 'Company portfolio', note: 'The home page: who we are and what we deliver', to: '/' },
  { slug: 'projects', label: 'Projects', note: 'Work in the field and case studies', to: '/projects/' },
  { slug: 'contact', label: 'Contact', note: 'Start a project inquiry, or call or write', to: '/contact/' },
];
