/**
 * A headline that arrives line by line: each line rises out from behind its
 * own mask, a beat after the one above, once, as the headline comes into view.
 *
 * Opt in with data-reveal. Lines are split as the browser actually wraps them
 * (SplitText re-splits on resize and once fonts load); a re-split after the
 * reveal has played just shows the lines. Reduced motion or no script: the
 * headline is simply there.
 */
import { gsap, reducedMotion } from './motion';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

export function initLineReveal(el: HTMLElement) {
  if (reducedMotion) return () => {};
  let played = false;
  const split = SplitText.create(el, {
    type: 'lines',
    mask: 'lines',
    linesClass: 'reveal__line',
    autoSplit: true,
    onSplit(self) {
      if (played) return;
      return gsap.from(self.lines, {
        yPercent: 110,
        duration: 1.1,
        ease: 'expo.out',
        stagger: 0.09,
        scrollTrigger: { trigger: el, start: 'top 82%', once: true },
        onStart: () => (played = true),
      });
    },
  });
  return () => split.revert();
}
