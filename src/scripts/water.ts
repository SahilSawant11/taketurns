/**
 * The finale's still water (a Cycles render, scripts/blender/pond.py): empty
 * until the page's leaf touches down on it (src/scripts/leaf.ts fires
 * 'leaf:land'), then the landing plays (rings, a bob) and hands on to a
 * seamless loop of the leaf afloat. 'leaf:lift' (scrolling back up) resets it.
 *
 * Without motion, or without the live leaf (no WebGL), it shows a still of
 * the leaf afloat instead. The videos load only as the finale comes near.
 */
export function initWater(root: HTMLElement) {
  const empty = root.querySelector<HTMLImageElement>('[data-water-empty]')!;
  const land = root.querySelector<HTMLVideoElement>('[data-water-land]')!;
  const loop = root.querySelector<HTMLVideoElement>('[data-water-loop]')!;
  const still = root.querySelector<HTMLImageElement>('[data-water-still]')!;
  const layers = [empty, land, loop, still];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const show = (el: HTMLElement) => layers.forEach((l) => l.classList.toggle('is-on', l === el));
  show(empty);

  // load the videos only as the finale comes near
  const near = new IntersectionObserver(
    (es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      near.disconnect();
      if (reduce) return;
      for (const v of [land, loop]) {
        v.preload = 'auto';
        v.load();
      }
    },
    { rootMargin: '150% 0px' },
  );
  near.observe(root);

  // no live leaf to come down (no WebGL, or it failed): show it already afloat once the stage is in view
  const seen = new IntersectionObserver(
    (es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      if (!document.querySelector('canvas.float')) show(still);
    },
    { threshold: 0.4 },
  );
  seen.observe(root);

  let landing = 0; // which touchdown is playing, so a late 'ended' from an old one is ignored
  const reset = () => {
    for (const v of [land, loop]) {
      v.pause();
      v.currentTime = 0;
    }
  };
  addEventListener('leaf:land', () => {
    if (reduce) return show(still);
    const n = ++landing;
    reset();
    land
      .play()
      .then(() => n === landing && show(land))
      .catch(() => n === landing && show(still));
  });
  land.addEventListener('ended', () => {
    const n = landing;
    loop
      .play()
      .then(() => n === landing && show(loop))
      .catch(() => n === landing && show(still));
  });
  addEventListener('leaf:lift', () => {
    landing++;
    reset();
    show(empty);
  });
}
