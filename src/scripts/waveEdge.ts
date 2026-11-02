/**
 * A single soft-wave transition into a section: as the section's top rises
 * through the viewport, its colour swells up into the section above in one
 * smooth, travelling wave, then settles flat as the section arrives.
 *
 * An SVG sits just above the section's top, inside the section, so it only
 * covers the padding at the bottom of the section above (never its type).
 * Reduced motion: no wave, just the plain edge.
 */
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

export function initWaveEdge(section: HTMLElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  let prev = section.previousElementSibling as HTMLElement | null;
  while (prev && prev.tagName !== 'SECTION') prev = prev.previousElementSibling as HTMLElement | null;
  if (!prev) return () => {};

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.classList.add('wave-edge');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', getComputedStyle(section).backgroundColor);
  svg.append(path);
  section.classList.add('has-wave-edge');
  section.prepend(svg);

  let w = 0;
  let h = 0;
  const layout = () => {
    w = section.clientWidth;
    // the swell stays inside the bottom padding of the section above
    h = Math.max(48, Math.min(innerHeight * 0.22, (parseFloat(getComputedStyle(prev!).paddingBottom) || 80) - 16));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.style.height = `${h}px`;
    last = -1;
  };

  let last = -1;
  const draw = (t: number) => {
    const key = Math.round(t * 1000);
    if (key === last) return;
    last = key;
    // swells as it enters, settles flat as it arrives; the crest travels across
    const amp = Math.sin(Math.PI * smooth(t)) ** 1.4;
    const phase = smooth(t) * 2.4;
    const N = 96;
    let d = `M0 ${h} `;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const a = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u * 0.9 - phase * 0.35) + 0.6);
      const b = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u * 0.45 + phase * 0.2) + 2.1);
      const shape = Math.pow(0.62 * a + 0.38 * b, 1.6);
      d += `L${(u * w).toFixed(1)} ${(h - (h - 1) * amp * shape).toFixed(1)} `;
    }
    d += `L${w} ${h} Z`;
    path.setAttribute('d', d);
  };

  let visible = false;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '20% 0px' });
  io.observe(section);
  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (!visible) return;
    // 0 as the section's top enters at the bottom of the screen → 1 at 35% from the top
    const top = section.getBoundingClientRect().top;
    draw((innerHeight - top) / (innerHeight * 0.65));
  };
  layout();
  raf = requestAnimationFrame(tick);
  addEventListener('resize', layout);
  return () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    removeEventListener('resize', layout);
    svg.remove();
    section.classList.remove('has-wave-edge');
  };
}
