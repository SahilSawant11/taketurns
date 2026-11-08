import type { APIRoute } from 'astro';

/** robots.txt: everything public is open to crawlers; the sitemap lists it. QR redirects and the print sheet stay out. */
export const GET: APIRoute = ({ site }) =>
  new Response(
    ['User-agent: *', 'Allow: /', 'Disallow: /go/', 'Disallow: /qr/', '', `Sitemap: ${new URL('sitemap-index.xml', site)}`, ''].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
