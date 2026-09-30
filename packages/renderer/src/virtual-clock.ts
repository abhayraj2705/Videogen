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

  // Neutralize timers and rAF: scene code must never rely on them for visual state.
  // Callbacks are dropped rather than deferred, so a template that depends on a
  // timer firing will visibly fail instead of silently working by luck.
  window.setTimeout = (() => 0);
  window.setInterval = (() => 0);
  window.requestAnimationFrame = (() => 0);
  window.cancelAnimationFrame = (() => {});

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
