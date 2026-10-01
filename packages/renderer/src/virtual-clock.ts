/**
 * Injected via page.addInitScript before any page script runs. Freezes the page's
 * notion of time so that seek(t) is the only thing that can move anything:
 * overrides Date/performance.now/rAF/timers, and on each seek pauses any
 * document.getAnimations() a careless template might have started via CSS.
 *
 * This is a string (not an import) because addInitScript needs source text to
 * inject into the page's own realm, evaluated before the page's own scripts run.
 */
export const VIRTUAL_CLOCK_INIT_SCRIPT = `
(() => {
  let virtualNowMs = 0;
  const realDateNow = Date.now;
  const OriginalDate = Date;

  class VirtualDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        super(virtualNowMs);
      } else {
        // @ts-ignore - forwarding varargs to the real Date constructor
        super(...args);
      }
    }
    static now() {
      return virtualNowMs;
    }
  }
  // @ts-ignore
  window.Date = VirtualDate;

  performance.now = () => virtualNowMs;

  // NOT neutering setTimeout/requestAnimationFrame: headless Chromium's own
  // internal rendering pipeline — specifically, resolving img.decode() —
  // depends on real animation-frame ticks actually happening. Disabling rAF
  // entirely (tried first) left every render hung forever waiting on
  // __film.ready, since decode() never resolved. Template purity (no template
  // may use rAF/setTimeout to drive its OWN visual state) is independently
  // enforced by the purity test (seek(t) must be pixel-identical), which is
  // the actual safety net here — not this override.

  window.__setVirtualTimeMs = (ms) => {
    virtualNowMs = ms;
    if (document.getAnimations) {
      for (const anim of document.getAnimations()) {
        try {
          anim.pause();
          anim.currentTime = ms;
        } catch {}
      }
    }
  };
})();
`;

declare global {
  interface Window {
    __setVirtualTimeMs: (ms: number) => void;
  }
}
