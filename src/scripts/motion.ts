/**
 * The site's one motion core: GSAP with ScrollTrigger registered, driven by a
 * single ticker. Every scroll-linked or per-frame script should import from
 * here (and use gsap.ticker / ScrollTrigger) rather than run its own
 * requestAnimationFrame loop.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export { gsap, ScrollTrigger };
