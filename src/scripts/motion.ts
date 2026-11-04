/**
 * The site's one motion core: GSAP with ScrollTrigger registered, driven by a
 * single ticker. Every scroll-linked or per-frame script should import from
 * here (frameLoop / ScrollTrigger) rather than run its own requestAnimationFrame.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A per-frame callback on GSAP's shared ticker, started and stopped on demand.
 * `cb` gets a performance.now() timestamp, like a requestAnimationFrame callback.
 */
export function frameLoop(cb: (now: number) => void) {
  let on = false;
  const step = () => cb(performance.now());
  return {
    get running() {
      return on;
    },
    start() {
      if (on) return;
      on = true;
      gsap.ticker.add(step);
    },
    stop() {
      if (!on) return;
      on = false;
      gsap.ticker.remove(step);
    },
  };
}

export { gsap, ScrollTrigger };
