"use strict";
(() => {
  // ../film-runtime/src/util/easing.ts
  var clamp01 = (t) => Math.min(1, Math.max(0, t));
  var linear = (t) => clamp01(t);
  var easeOutCubic = (t) => {
    const x = clamp01(t);
    return 1 - Math.pow(1 - x, 3);
  };
  var easeInOutCubic = (t) => {
    const x = clamp01(t);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  };
  var easeOutExpo = (t) => {
    const x = clamp01(t);
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
  };
  var easeOutQuint = (t) => {
    const x = clamp01(t);
    return 1 - Math.pow(1 - x, 5);
  };
  var easeInCubic = (t) => {
    const x = clamp01(t);
    return x * x * x;
  };
  var easeInOutQuart = (t) => {
    const x = clamp01(t);
    return x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2;
  };
  function spring(t, damping = 0.62, freq = 1.4) {
    const x = clamp01(t);
    if (x === 0) return 0;
    if (x === 1) return 1;
    const w0 = 2 * Math.PI * freq;
    const wd = w0 * Math.sqrt(1 - damping * damping);
    return 1 - Math.exp(-damping * w0 * x) * (Math.cos(wd * x) + damping * w0 / wd * Math.sin(wd * x));
  }
  var easeSpring = (t) => spring(t);
  function progress(localT, start, end, ease = linear) {
    if (end <= start) return localT >= end ? 1 : 0;
    return ease(clamp01((localT - start) / (end - start)));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // ../film-runtime/src/util/dom.ts
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function setStyle(node, style) {
    Object.assign(node.style, style);
  }
  function applyReveal(node, p, riseDistancePx = 24) {
    node.style.opacity = String(p);
    node.style.transform = p >= 1 ? "none" : `translateY(${(1 - p) * riseDistancePx}px)`;
  }

  // ../film-runtime/src/util/layout.ts
  var SAFE_AREA = {
    landscape: { left: 0.05, right: 0.05, top: 0.06, bottom: 0.06 },
    portrait: { left: 0.07, right: 0.07, top: 0.1, bottom: 0.14 },
    square: { left: 0.06, right: 0.06, top: 0.06, bottom: 0.06 }
  };
  function orientationOf(width, height) {
    const r = width / height;
    if (r > 1.2) return "landscape";
    if (r < 0.83) return "portrait";
    return "square";
  }
  function safeRect(width, height) {
    const m = SAFE_AREA[orientationOf(width, height)];
    const left = width * m.left;
    const right = width * (1 - m.right);
    const top = height * m.top;
    const bottom = height * (1 - m.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  function captionBand(width, height) {
    const orientation = orientationOf(width, height);
    const u = Math.min(width, height) / 1080;
    const safe = safeRect(width, height);
    const fontSize = { landscape: 38, portrait: 50, square: 40 }[orientation] * u;
    const maxLines = orientation === "landscape" ? 1 : 2;
    const bandHeight = maxLines * fontSize * 1.25 + 28 * u;
    return { fontSize, maxLines, height: bandHeight, reserve: bandHeight + 24 * u, width: safe.width * (orientation === "landscape" ? 0.8 : 1) };
  }
  function layoutFor(ctx) {
    const orientation = orientationOf(ctx.width, ctx.height);
    const u = Math.min(ctx.width, ctx.height) / 1080;
    const full = safeRect(ctx.width, ctx.height);
    const inset = Math.max(0, ctx.insetBottom ?? 0);
    const safe = { ...full, bottom: full.bottom - inset, height: full.height - inset };
    return {
      orientation,
      u,
      safe,
      safePadding: `${safe.top}px ${ctx.width - safe.right}px ${ctx.height - safe.bottom}px ${safe.left}px`,
      pick: (v) => v[orientation]
    };
  }
  function charsPerLine(widthPx, fontSizePx, avgAdvanceEm = 0.56) {
    return Math.max(6, Math.floor(widthPx / (fontSizePx * avgAdvanceEm)));
  }
  function fitFontSize(text, widthPx, maxPx, maxLines, minPx = 18) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const longest = words.reduce((m, w) => Math.max(m, w.length), 0);
    let size = maxPx;
    while (size > minPx) {
      const cpl = charsPerLine(widthPx, size);
      if (longest <= cpl && estimateLines(words, cpl) <= maxLines) return size;
      size -= 2;
    }
    return minPx;
  }
  function estimateLines(words, cpl) {
    let lines = 1;
    let cur = 0;
    for (const w of words) {
      const add = cur === 0 ? w.length : cur + 1 + w.length;
      if (add > cpl && cur > 0) {
        lines++;
        cur = w.length;
      } else cur = add;
    }
    return lines;
  }
  var WRAP_SAFE = {
    overflowWrap: "break-word",
    wordBreak: "normal",
    minWidth: "0"
  };

  // ../film-runtime/src/style.ts
  var CLEAN = {
    id: "clean",
    reveal: "rise",
    spring: { damping: 0.78, freq: 1.1 },
    card: "soft",
    radius: 1,
    backdrop: { glow: 1, grid: true, vignette: 0 },
    transitions: ["push", "zoom", "wipe", "slide-up"],
    camera: 0.025,
    grain: 0
  };
  var STYLE_PACKS = {
    clean: CLEAN,
    playful: {
      id: "playful",
      reveal: "pop",
      spring: { damping: 0.52, freq: 1.5 },
      card: "solid",
      radius: 1.6,
      backdrop: { glow: 1.7, grid: false, vignette: 0 },
      transitions: ["whip", "zoom", "push", "slide-up"],
      camera: 0.035,
      grain: 0
    },
    cinematic: {
      id: "cinematic",
      reveal: "blur",
      spring: { damping: 0.95, freq: 0.8 },
      card: "glass",
      radius: 0.5,
      backdrop: { glow: 1.3, grid: false, vignette: 0.55 },
      transitions: ["fade", "zoom", "cut", "fade"],
      camera: 0.05,
      grain: 0
    },
    "app-store": {
      id: "app-store",
      reveal: "mask",
      spring: { damping: 0.7, freq: 1.2 },
      card: "outline",
      radius: 1.3,
      backdrop: { glow: 0.8, grid: true, vignette: 0 },
      transitions: ["cut", "push", "wipe", "zoom"],
      camera: 0.02,
      grain: 0
    }
  };
  function stylePackFor(style) {
    return style && STYLE_PACKS[style] || CLEAN;
  }
  function resolveTransition(pack, sceneIndex, explicit) {
    return explicit ?? pack.transitions[Math.max(0, sceneIndex - 1) % pack.transitions.length];
  }

  // ../film-runtime/src/util/text-fit.ts
  function wrapText(text, maxCharsPerLine, maxLines = 3) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    for (const [index, word] of words.entries()) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxCharsPerLine && current) {
        lines.push(current);
        current = word;
        if (lines.length === maxLines - 1) {
          const rest = words.slice(index).join(" ");
          lines.push(rest.length > maxCharsPerLine ? `${rest.slice(0, maxCharsPerLine - 1)}\u2026` : rest);
          return lines;
        }
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  // ../film-runtime/src/util/ui.ts
  function sceneRoot(root, L, style = {}) {
    setStyle(root, {
      position: "absolute",
      inset: "0",
      boxSizing: "border-box",
      padding: L.safePadding,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      background: "transparent",
      ...style
    });
  }
  function textBlock(text, o) {
    const fontSize = fitFontSize(text, o.width, o.maxSize, o.maxLines, o.minSize);
    const lineHeight = o.lineHeight ?? 1.12;
    const left = o.align === "left";
    const wrap = el("div", o.className);
    setStyle(wrap, {
      display: "flex",
      flexDirection: "column",
      alignItems: left ? "flex-start" : "center",
      maxWidth: `${o.width}px`,
      fontSize: `${fontSize}px`,
      fontFamily: o.family,
      fontWeight: o.weight ?? "700",
      color: o.color,
      lineHeight: String(lineHeight),
      letterSpacing: o.tracking ?? "-0.02em"
    });
    const words = [];
    const lines = wrapText(text, charsPerLine(o.width, fontSize), o.maxLines).map((line) => {
      const lineNode = el("div", `${o.className}-line`);
      setStyle(lineNode, { display: "flex", flexWrap: "wrap", justifyContent: left ? "flex-start" : "center", columnGap: "0.26em", maxWidth: `${o.width}px`, minWidth: "0" });
      for (const word of line.split(/\s+/).filter(Boolean)) {
        const node = el("span", `${o.className}-word`, word);
        setStyle(node, { display: "inline-block", position: "relative", isolation: "isolate" });
        lineNode.appendChild(node);
        words.push(node);
      }
      wrap.appendChild(lineNode);
      return lineNode;
    });
    return { wrap, lines, words, fontSize, height: lines.length * fontSize * lineHeight };
  }
  var sceneCache = /* @__PURE__ */ new WeakMap();
  function sceneOf(node) {
    let info = sceneCache.get(node);
    if (!info) {
      const host = node.closest("[data-style]");
      info = { pack: stylePackFor(host?.dataset.style), exitAt: Number(host?.dataset.exitAt ?? 0), exitSec: Number(host?.dataset.exitSec ?? 0) };
      if (host) sceneCache.set(node, info);
    }
    return info;
  }
  function exitAmount(info, t, delay = 0) {
    if (info.exitSec <= 0 || t <= info.exitAt) return 0;
    return easeInCubic(clamp01((t - info.exitAt - delay * info.exitSec) / (info.exitSec * (1 - delay))));
  }
  function wordsIn(words, t, start, each = 0.05, dur = 0.5, riseEm = 0.55) {
    if (words.length === 0) return;
    const scene = sceneOf(words[0]);
    const reveal = scene.pack.reveal;
    for (let i = 0; i < words.length; i++) {
      const lin = clamp01((t - start - i * each) / dur);
      const w = words[i];
      const done = lin >= 1;
      w.style.opacity = String(clamp01(lin * 2.5));
      if (reveal === "mask") {
        const e = easeOutQuint(lin);
        w.style.opacity = lin > 0 ? "1" : "0";
        w.style.clipPath = done ? "none" : `inset(0 0 ${((1 - e) * 100).toFixed(2)}% 0)`;
        w.style.transform = done ? "none" : `translateY(${((1 - e) * 0.9).toFixed(4)}em)`;
      } else if (reveal === "pop") {
        const s = spring(lin, 0.5, 1.3);
        w.style.transform = done ? "none" : `scale(${(0.5 + 0.5 * s).toFixed(4)})`;
      } else if (reveal === "blur") {
        const e = easeOutCubic(lin);
        w.style.opacity = String(e);
        w.style.filter = done ? "none" : `blur(${((1 - e) * 0.28).toFixed(4)}em)`;
        w.style.transform = done ? "none" : `translateY(${((1 - e) * 0.18).toFixed(4)}em)`;
      } else {
        const s = spring(lin, 0.72, 1.1);
        w.style.transform = done ? "none" : `translateY(${((1 - s) * riseEm).toFixed(4)}em)`;
      }
      const out = exitAmount(scene, t, 0.4 * i / words.length);
      if (out > 0) {
        w.style.opacity = String(1 - out);
        w.style.transform = `translateY(${(-0.4 * out).toFixed(4)}em)`;
      }
    }
  }
  function wordsSettle(count, start, each = 0.05, dur = 0.5) {
    return start + Math.max(0, count - 1) * each + dur;
  }
  function enter(node, t, start, dur, o = {}, extra = "") {
    const lin = clamp01((t - start) / dur);
    const scene = sceneOf(node);
    const { damping, freq } = scene.pack.spring;
    const inv = 1 - (o.ease ? o.ease(lin) : spring(lin, damping, freq));
    node.style.opacity = String(clamp01(lin * 2.2));
    if (lin >= 1) {
      const out = exitAmount(scene, t);
      if (out > 0) {
        node.style.opacity = String(1 - out);
        node.style.transform = `translateY(${(-5 * out).toFixed(3)}%) scale(${(1 - 0.05 * out).toFixed(4)}) ${extra}`.trim();
        return;
      }
      node.style.transform = extra || "none";
      return;
    }
    const scale = 1 - (1 - (o.scale ?? 1)) * inv;
    node.style.transform = `translate(${((o.x ?? 0) * inv).toFixed(2)}px, ${((o.y ?? 0) * inv).toFixed(2)}px) scale(${scale.toFixed(4)}) rotate(${((o.rotate ?? 0) * inv).toFixed(3)}deg) ${extra}`.trim();
  }
  function cueStart(cues, i, stagger, lead = 0.25) {
    const cue = cues?.[i];
    return cue === void 0 ? i * stagger : Math.max(i * stagger, cue - lead);
  }
  function scaleXTo(p) {
    return p >= 1 ? "none" : `scaleX(${p.toFixed(4)})`;
  }
  function addMarker(word, color) {
    const marker = el("span", "marker");
    setStyle(marker, {
      position: "absolute",
      // Flush with the word: a marker that overhangs would push a line-edge word past the title-safe area.
      left: "0",
      right: "0",
      top: "0.56em",
      bottom: "0.06em",
      background: color,
      borderRadius: "0.12em",
      transformOrigin: "left center",
      transform: "scaleX(0)",
      zIndex: "-1"
    });
    word.appendChild(marker);
    return marker;
  }
  function cardStyle(ctx, u, radius = 28) {
    const p = ctx.palette;
    const base = { boxSizing: "border-box", borderRadius: `${radius * ctx.style.radius * u}px` };
    const hairline = `${Math.max(1, 1.5 * u)}px solid ${p.border}`;
    switch (ctx.style.card) {
      case "outline":
        return { ...base, background: p.surface, border: `${Math.max(2, 3 * u)}px solid ${p.accentSoft}`, boxShadow: "none" };
      case "glass":
        return { ...base, background: `linear-gradient(160deg, ${p.border}, transparent 60%), ${p.surface}`, border: hairline, boxShadow: `0 ${30 * u}px ${80 * u}px -${40 * u}px rgba(0,0,0,${p.isDark ? 0.7 : 0.25})` };
      case "solid":
        return { ...base, background: p.surface, border: `${Math.max(2, 3 * u)}px solid ${p.fg}`, boxShadow: `${8 * u}px ${10 * u}px 0 ${p.accent}` };
      default:
        return { ...base, background: p.surface, border: hairline, boxShadow: `0 ${24 * u}px ${60 * u}px -${28 * u}px ${p.glow}, 0 ${2 * u}px ${6 * u}px rgba(0,0,0,${p.isDark ? 0.4 : 0.06})` };
    }
  }
  function logoMark(opts) {
    const { size, ctx } = opts;
    const wrap = el("div", opts.className);
    setStyle(wrap, { width: `${size}px`, height: `${size}px`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: "0" });
    if (opts.logoUrl) {
      const img = el("img");
      img.src = opts.logoUrl;
      setStyle(img, { width: "100%", height: "100%", objectFit: "contain" });
      wrap.appendChild(img);
    } else {
      const tile = el("div", `${opts.className}-fallback`, opts.productName.slice(0, 1).toUpperCase());
      setStyle(tile, {
        width: "100%",
        height: "100%",
        borderRadius: "26%",
        background: `linear-gradient(135deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
        color: ctx.palette.onAccent,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: `${size * 0.52}px`,
        fontWeight: "800",
        fontFamily: ctx.fonts.display,
        boxShadow: `0 ${size * 0.14}px ${size * 0.4}px -${size * 0.12}px ${ctx.palette.glow}`
      });
      wrap.appendChild(tile);
    }
    return wrap;
  }

  // ../film-runtime/src/templates/kinetic-hook.ts
  var WORDS_START = 0.3;
  var WORD_EACH = 0.06;
  var WORD_DUR = 0.55;
  var wordCountOf = (headline) => headline.trim().split(/\s+/).filter(Boolean).length;
  function createKineticHook() {
    let instance;
    return {
      id: "KineticHook",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        sceneRoot(root, L, { fontFamily: ctx.fonts.display });
        const stack = el("div", "kh-stack");
        setStyle(stack, { display: "flex", flexDirection: "column", alignItems: "center", gap: `${L.pick({ landscape: 48, portrait: 76, square: 44 }) * u}px` });
        root.appendChild(stack);
        const logo = logoMark({ className: "kh-logo", size: L.pick({ landscape: 132, portrait: 200, square: 132 }) * u, logoUrl: props.logoUrl, productName: props.productName, ctx });
        stack.appendChild(logo);
        const headline = textBlock(props.headline, {
          className: "kh-headline",
          width: Math.min(L.safe.width, L.pick({ landscape: 1560, portrait: 1e3, square: 960 }) * u),
          maxSize: L.pick({ landscape: 112, portrait: 124, square: 96 }) * u,
          minSize: 28 * u,
          maxLines: L.pick({ landscape: 2, portrait: 4, square: 3 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "800",
          lineHeight: 1.08,
          tracking: "-0.03em"
        });
        stack.appendChild(headline.wrap);
        const last = headline.words[headline.words.length - 1];
        const marker = last && headline.words.length >= 3 ? addMarker(last, ctx.palette.accentSoft) : null;
        instance = { stack, logo, words: headline.words, marker, durationSec: ctx.durationSec };
      },
      seek(localT) {
        if (!instance) return;
        enter(instance.logo, localT, 0, 0.65, { scale: 0.35, rotate: -14, ease: easeSpring });
        wordsIn(instance.words, localT, WORDS_START, WORD_EACH, WORD_DUR);
        if (instance.marker) {
          const landed = wordsSettle(instance.words.length, WORDS_START, WORD_EACH, WORD_DUR);
          instance.marker.style.transform = scaleXTo(progress(localT, landed - 0.3, landed + 0.1, easeOutCubic));
        }
        instance.stack.style.transform = `scale(${(0.955 + 0.04 * progress(localT, 0, instance.durationSec, easeOutCubic)).toFixed(4)})`;
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: WORDS_START, type: "headline-begin" },
          { t: Math.max(1.25, wordsSettle(wordCountOf(props.headline), WORDS_START, WORD_EACH, WORD_DUR) + 0.1), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/util/icons.ts
  var PATHS = {
    bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
    shield: "M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z",
    chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
    users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 7M22 21a6 6 0 0 0-4-5.6",
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
    globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20",
    lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
    code: "M8 6 2 12l6 6M16 6l6 6-6 6M14 4l-4 16",
    layers: "M12 2 2 7l10 5 10-5zM2 12l10 5 10-5M2 17l10 5 10-5",
    check: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-6",
    star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
    rocket: "M12 2c4 2 6 6 6 11l-3 3H9l-3-3c0-5 2-9 6-11zM12 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 16l-2 5 5-2 5 2-2-5",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
    bell: "M6 17v-6a6 6 0 0 1 12 0v6l2 2H4zM10 21a2 2 0 0 0 4 0",
    card: "M2 6h20v12H2zM2 10h20M6 15h4",
    cloud: "M7 19a5 5 0 0 1-.5-10A6 6 0 0 1 18 10a4.5 4.5 0 0 1 0 9z",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
    chat: "M4 5h16v11H9l-5 4z",
    calendar: "M4 6h16v15H4zM4 10h16M8 3v5M16 3v5",
    heart: "M12 21C5 15 2 12 2 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 10 2.5C22 12 19 15 12 21z",
    gear: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"
  };
  var ICON_NAMES = Object.keys(PATHS);
  function iconSvg(name) {
    const d = name ? PATHS[name.trim().toLowerCase()] : void 0;
    if (!d) return null;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  }

  // ../film-runtime/src/templates/feature-triplet.ts
  var CARD_STAGGER = 0.14;
  var CARD_ENTER = 0.75;
  var settleFor = (count, cues) => cueStart(cues, count - 1, CARD_STAGGER) + CARD_ENTER;
  function createFeatureTriplet() {
    let instance;
    return {
      id: "FeatureTriplet",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const row = L.orientation === "landscape";
        const gap = L.pick({ landscape: 40, portrait: 34, square: 22 }) * u;
        sceneRoot(root, L, { flexDirection: row ? "row" : "column", gap: `${gap}px`, fontFamily: ctx.fonts.body });
        const pad = L.pick({ landscape: 44, portrait: 40, square: 28 }) * u;
        const cardWidth = row ? Math.min((L.safe.width - 2 * gap) / 3, 560 * u) : L.safe.width * L.pick({ landscape: 1, portrait: 1, square: 0.94 });
        const badge = L.pick({ landscape: 84, portrait: 88, square: 64 }) * u;
        const labelWidth = row ? cardWidth - 2 * pad : cardWidth - 2 * pad - badge - pad * 0.8;
        const longest = props.features.reduce((a, f) => f.label.length > a.length ? f.label : a, "");
        const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 60, portrait: 58, square: 44 }) * u, 3, 22 * u);
        const cards = props.features.map((feature, i) => {
          const node = el("div", "ft-card");
          setStyle(node, {
            ...cardStyle(ctx, u),
            position: "relative",
            display: "flex",
            flexDirection: row ? "column" : "row",
            alignItems: row ? "flex-start" : "center",
            justifyContent: row ? "center" : "flex-start",
            gap: `${row ? pad * 0.7 : pad * 0.8}px`,
            width: `${cardWidth}px`,
            minHeight: `${L.safe.height * L.pick({ landscape: 0.62, portrait: 0.17, square: 0.2 })}px`,
            padding: `${pad}px`
          });
          const bar = el("div", "ft-bar");
          setStyle(bar, {
            position: "absolute",
            left: `${pad}px`,
            top: "0",
            width: `${badge}px`,
            height: `${6 * u}px`,
            borderRadius: `0 0 ${4 * u}px ${4 * u}px`,
            background: `linear-gradient(90deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
            transformOrigin: "left center"
          });
          node.appendChild(bar);
          const drawn = iconSvg(feature.icon);
          const glyph = feature.icon && !/^[a-z][a-z -]*$/i.test(feature.icon.trim()) ? feature.icon : void 0;
          const badgeNode = el("div", "ft-icon", drawn ? void 0 : glyph ?? String(i + 1).padStart(2, "0"));
          if (drawn) badgeNode.innerHTML = `<div style="width:56%;height:56%;display:flex">${drawn}</div>`;
          setStyle(badgeNode, {
            width: `${badge}px`,
            height: `${badge}px`,
            flexShrink: "0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: `${badge * 0.3}px`,
            background: ctx.palette.accentSoft,
            color: ctx.palette.accentText,
            fontFamily: ctx.fonts.display,
            fontSize: `${badge * (glyph ? 0.56 : 0.4)}px`,
            fontWeight: "800",
            lineHeight: "1",
            letterSpacing: "-0.02em"
          });
          node.appendChild(badgeNode);
          const label = el("div", "ft-label", feature.label);
          setStyle(label, {
            ...WRAP_SAFE,
            fontSize: `${labelSize}px`,
            fontWeight: "700",
            color: ctx.palette.fg,
            fontFamily: ctx.fonts.display,
            lineHeight: "1.22",
            letterSpacing: "-0.02em",
            maxWidth: `${labelWidth}px`,
            textAlign: "left"
          });
          node.appendChild(label);
          const ring = el("div", "ft-ring");
          setStyle(ring, {
            position: "absolute",
            inset: `${-3 * u}px`,
            borderRadius: `${30 * u}px`,
            border: `${4 * u}px solid ${ctx.palette.accent}`,
            boxShadow: `0 0 ${50 * u}px ${ctx.palette.glow}`,
            opacity: "0"
          });
          node.appendChild(ring);
          root.appendChild(node);
          return { node, ring, bar };
        });
        instance = { cards, horizontal: row, u, durationSec: ctx.durationSec, cues: props.cues };
      },
      seek(localT) {
        if (!instance) return;
        const { horizontal, u, cards, durationSec, cues } = instance;
        const settled = settleFor(cards.length);
        const turn = Math.max(0.5, (durationSec - settled - 0.5) / cards.length);
        cards.forEach((card, i) => {
          const start = cueStart(cues, i, CARD_STAGGER);
          const litFrom = cues ? Math.max(start + 0.3, cues[i]) : settled + 0.1 + i * turn;
          const litFor = cues ? Math.max(0.6, (cues[i + 1] ?? durationSec - 0.5) - litFrom) : turn;
          const local = localT - litFrom;
          const spot = clamp01(local / 0.25) * clamp01((litFor - local) / 0.25);
          card.ring.style.opacity = String(spot);
          const lift = spot > 0 ? `translateY(${(-10 * u * spot).toFixed(2)}px)` : "";
          enter(card.node, localT, start, CARD_ENTER, horizontal ? { y: 90 * u, scale: 0.9, rotate: (i - 1) * 4 } : { x: -110 * u, scale: 0.96 }, lift);
          card.bar.style.transform = scaleXTo(progress(localT, start + 0.3, start + 0.8, easeOutCubic));
        });
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: settleFor(props.features.length, props.cues), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/util/browser-frame.ts
  function browserFrame(opts) {
    const { ctx, u, width, height } = opts;
    const barHeight = Math.round(46 * u);
    const viewportHeight = height - barHeight;
    const wrap = el("div", opts.className);
    setStyle(wrap, {
      boxSizing: "border-box",
      position: "relative",
      width: `${width}px`,
      height: `${height}px`,
      flexShrink: "0",
      display: "flex",
      flexDirection: "column",
      borderRadius: `${18 * u}px`,
      overflow: "hidden",
      background: ctx.palette.surface,
      boxShadow: `0 ${50 * u}px ${110 * u}px -${40 * u}px ${ctx.palette.glow}, 0 ${30 * u}px ${60 * u}px -${30 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.7 : 0.35}), 0 0 0 ${Math.max(1, 1.5 * u)}px ${ctx.palette.border}`,
      transformOrigin: "50% 60%"
    });
    const bar = el("div", `${opts.className}-bar`);
    setStyle(bar, {
      boxSizing: "border-box",
      height: `${barHeight}px`,
      flexShrink: "0",
      display: "flex",
      alignItems: "center",
      gap: `${8 * u}px`,
      padding: `0 ${18 * u}px`,
      borderBottom: `${Math.max(1, u)}px solid ${ctx.palette.border}`
    });
    for (let i = 0; i < 3; i++) {
      const dot = el("div", `${opts.className}-dot`);
      setStyle(dot, { width: `${11 * u}px`, height: `${11 * u}px`, borderRadius: "50%", background: ctx.palette.border, flexShrink: "0" });
      bar.appendChild(dot);
    }
    if (opts.pageLabel) {
      const pill = el("div", `${opts.className}-url`, opts.pageLabel);
      setStyle(pill, {
        marginLeft: `${14 * u}px`,
        padding: `${4 * u}px ${16 * u}px`,
        borderRadius: `${20 * u}px`,
        background: ctx.palette.accentSoft,
        color: ctx.palette.muted,
        fontFamily: ctx.fonts.body,
        fontSize: `${17 * u}px`,
        fontWeight: "500",
        whiteSpace: "nowrap",
        maxWidth: `${width * 0.6}px`
      });
      bar.appendChild(pill);
    }
    wrap.appendChild(bar);
    const viewport = el("div", `${opts.className}-viewport`);
    setStyle(viewport, { position: "relative", width: "100%", height: `${viewportHeight}px`, overflow: "hidden", flexShrink: "0" });
    const image = el("img");
    image.src = opts.screenshotUrl;
    setStyle(image, { display: "block", width: "100%", height: "auto", minHeight: "100%", objectFit: "cover", objectPosition: "top", transformOrigin: "top center" });
    const pageLayer = el("div", `${opts.className}-page`);
    setStyle(pageLayer, { position: "relative", width: "100%", minHeight: "100%" });
    pageLayer.appendChild(image);
    viewport.appendChild(pageLayer);
    wrap.appendChild(viewport);
    const poses = /* @__PURE__ */ new Map();
    const poseFor = (rect) => {
      const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
      const known = poses.get(key);
      if (known !== void 0) return known;
      if (image.naturalWidth <= 0) return null;
      const store = (pose) => {
        poses.set(key, pose);
        return pose;
      };
      const pageHeight = width * image.naturalHeight / image.naturalWidth;
      const r = { x: rect.x * width, y: rect.y * width, w: rect.w * width, h: rect.h * width };
      if (r.w < 4 || r.h < 4 || r.y + r.h > pageHeight || r.x + r.w > width + 1) return store(null);
      const scale = Math.max(1, Math.min(2.6, 2 * image.naturalWidth / width, width * 0.7 / r.w, viewportHeight * 0.7 / r.h));
      const tx = Math.min(0, Math.max(width - scale * width, width / 2 - scale * (r.x + r.w / 2)));
      const ty = Math.min(0, Math.max(viewportHeight - scale * pageHeight, viewportHeight / 2 - scale * (r.y + r.h / 2)));
      const pad = 10 * u;
      const highlight = el("div", `${opts.className}-highlight`);
      pageLayer.appendChild(highlight);
      setStyle(highlight, {
        position: "absolute",
        boxSizing: "border-box",
        opacity: "0",
        pointerEvents: "none",
        left: `${r.x - pad}px`,
        top: `${r.y - pad}px`,
        width: `${r.w + 2 * pad}px`,
        height: `${r.h + 2 * pad}px`,
        // Sized in page units, so divide by the zoom to keep the line weight constant on screen.
        border: `${4 * u / scale}px solid ${ctx.palette.accent}`,
        borderRadius: `${14 * u / scale}px`,
        boxShadow: `0 0 0 ${6 * u / scale}px ${ctx.palette.accentSoft}, 0 0 ${40 * u / scale}px ${ctx.palette.glow}`
      });
      return store({ scale, tx, ty, highlight });
    };
    return {
      wrap,
      viewport,
      image,
      viewportWidth: width,
      viewportHeight,
      enter(t, start, dur) {
        const lin = clamp01((t - start) / dur);
        const inv = 1 - spring(lin, 0.8, 1);
        wrap.style.opacity = String(clamp01(lin * 2.4));
        wrap.style.transform = lin >= 1 ? "none" : `perspective(${1800 * u}px) translateY(${(60 * u * inv).toFixed(2)}px) rotateX(${(16 * inv).toFixed(3)}deg) scale(${(1 - 0.1 * inv).toFixed(4)})`;
      },
      scroll(p, maxViewports = 0.9) {
        const pageHeight = image.naturalWidth > 0 ? width * image.naturalHeight / image.naturalWidth : viewportHeight;
        const travel = Math.min(Math.max(0, pageHeight - viewportHeight), viewportHeight * maxViewports);
        if (travel < 1) {
          const zoom = 0.06 * clamp01(p);
          pageLayer.style.transformOrigin = "top center";
          pageLayer.style.transform = zoom < 1e-4 ? "none" : `scale(${(1 + zoom).toFixed(4)})`;
          return 0;
        }
        const offset = travel * easeInOutCubic(clamp01(p));
        pageLayer.style.transform = offset < 5e-3 ? "none" : `translateY(${(-offset).toFixed(2)}px)`;
        return offset;
      },
      focus(rect, p, ring) {
        const pose = poseFor(rect);
        if (!pose) return false;
        const e = easeInOutQuart(clamp01(p));
        const scale = 1 + (pose.scale - 1) * e;
        pageLayer.style.transformOrigin = "0 0";
        pageLayer.style.transform = e < 1e-4 ? "none" : `translate(${(pose.tx * e).toFixed(2)}px, ${(pose.ty * e).toFixed(2)}px) scale(${scale.toFixed(4)})`;
        pose.highlight.style.opacity = String(clamp01(ring));
        return true;
      },
      tour(rects, t, durationSec) {
        const stops = rects.map(poseFor).filter((p) => p !== null);
        if (stops.length === 0) return false;
        const HOLD = 0.9;
        const per = Math.max(0.8, (durationSec - HOLD - 0.4) / stops.length);
        const move = Math.min(0.9, per * 0.45);
        const k = Math.min(stops.length - 1, Math.max(0, Math.floor((t - HOLD) / per)));
        const from = k === 0 ? { scale: 1, tx: 0, ty: 0 } : stops[k - 1];
        const to = stops[k];
        const e = easeInOutQuart(clamp01((t - HOLD - k * per) / move));
        const scale = from.scale + (to.scale - from.scale) * e;
        const tx = from.tx + (to.tx - from.tx) * e;
        const ty = from.ty + (to.ty - from.ty) * e;
        pageLayer.style.transformOrigin = "0 0";
        pageLayer.style.transform = scale < 1.0001 && Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01 ? "none" : `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${scale.toFixed(4)})`;
        stops.forEach((stop, i) => {
          const arrive = HOLD + i * per + move;
          const leave = i < stops.length - 1 ? HOLD + (i + 1) * per : Infinity;
          stop.highlight.style.opacity = String(clamp01((t - arrive + 0.2) / 0.3) * clamp01((leave + 0.15 - t) / 0.2));
        });
        return true;
      }
    };
  }

  // ../film-runtime/src/templates/section-showcase.ts
  var FRAME_ENTER = 0.9;
  var CAPTION_START = 0.4;
  var WORD_EACH2 = 0.05;
  var WORD_DUR2 = 0.5;
  var countWords = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  function createSectionShowcase() {
    let instance;
    return {
      id: "SectionShowcase",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const gap = L.pick({ landscape: 34, portrait: 52, square: 30 }) * u;
        sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });
        const caption = textBlock(props.caption, {
          className: "ss-caption",
          width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
          maxSize: L.pick({ landscape: 54, portrait: 64, square: 48 }) * u,
          minSize: 22 * u,
          maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "700",
          lineHeight: 1.2
        });
        const frameWidth = L.safe.width * L.pick({ landscape: 0.86, portrait: 1, square: 0.98 });
        const frameHeight = Math.min(L.safe.height - gap - caption.height - 8 * u, L.pick({ landscape: 0.68, portrait: 0.6, square: 0.64 }) * ctx.height);
        const frame = browserFrame({ className: "ss-frame", width: frameWidth, height: frameHeight, screenshotUrl: props.screenshotUrl, pageLabel: props.pageLabel, ctx, u });
        root.appendChild(frame.wrap);
        root.appendChild(caption.wrap);
        instance = { frame, words: caption.words, durationSec: ctx.durationSec, focus: props.focus, focusStops: props.focusStops };
      },
      seek(localT) {
        if (!instance) return;
        instance.frame.enter(localT, 0, FRAME_ENTER);
        const focusEnd = Math.min(2.3, Math.max(1.6, instance.durationSec - 1.2));
        if (instance.focusStops && instance.frame.tour(instance.focusStops, localT, instance.durationSec)) {
          wordsIn(instance.words, localT, CAPTION_START, WORD_EACH2, WORD_DUR2);
          return;
        }
        const focused = instance.focus ? instance.frame.focus(instance.focus, progress(localT, 0.9, focusEnd), progress(localT, focusEnd - 0.2, focusEnd + 0.25)) : false;
        if (!focused) instance.frame.scroll(progress(localT, 1, Math.max(1.8, instance.durationSec - 0.5)));
        wordsIn(instance.words, localT, CAPTION_START, WORD_EACH2, WORD_DUR2);
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: Math.max(FRAME_ENTER, wordsSettle(countWords(props.caption), CAPTION_START, WORD_EACH2, WORD_DUR2)), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/cta-end-card.ts
  var WORDS_START2 = 0.2;
  var WORD_EACH3 = 0.07;
  var WORD_DUR3 = 0.5;
  var countWords2 = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  var buttonStartFor = (words) => wordsSettle(words, WORDS_START2, WORD_EACH3, WORD_DUR3) - 0.3;
  function createCTAEndCard() {
    let instance;
    return {
      id: "CTAEndCard",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        sceneRoot(root, L, { gap: `${L.pick({ landscape: 36, portrait: 52, square: 32 }) * u}px`, fontFamily: ctx.fonts.display });
        const logo = logoMark({ className: "cta-logo", size: L.pick({ landscape: 112, portrait: 168, square: 112 }) * u, logoUrl: props.logoUrl, productName: props.productName, ctx });
        root.appendChild(logo);
        const cta = textBlock(props.ctaText, {
          className: "cta-text",
          width: Math.min(L.safe.width, 1440 * u),
          maxSize: L.pick({ landscape: 120, portrait: 128, square: 100 }) * u,
          minSize: 28 * u,
          maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "800",
          lineHeight: 1.08,
          tracking: "-0.035em"
        });
        root.appendChild(cta.wrap);
        const padX = L.pick({ landscape: 44, portrait: 52, square: 40 }) * u;
        const arrowSpace = 60 * u;
        const maxButton = L.safe.width * 0.8;
        const domainSize = fitFontSize(props.domain, maxButton - 2 * padX - arrowSpace, L.pick({ landscape: 42, portrait: 50, square: 40 }) * u, 1, 18 * u);
        const button = el("div", "cta-button");
        setStyle(button, {
          position: "relative",
          overflow: "hidden",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: `${18 * u}px`,
          maxWidth: `${maxButton}px`,
          padding: `${L.pick({ landscape: 22, portrait: 28, square: 20 }) * u}px ${padX}px`,
          borderRadius: `${60 * u}px`,
          background: `${ctx.palette.accent} linear-gradient(120deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
          flexShrink: "0"
        });
        const domainNode = el("span", "cta-domain", props.domain);
        setStyle(domainNode, { fontSize: `${domainSize}px`, fontWeight: "700", color: ctx.palette.onAccent, letterSpacing: "-0.01em", whiteSpace: "nowrap", fontFamily: ctx.fonts.body });
        button.appendChild(domainNode);
        const arrow = el("span", "cta-arrow", "\u2192");
        setStyle(arrow, { fontSize: `${domainSize}px`, fontWeight: "700", color: ctx.palette.onAccent, lineHeight: "1" });
        button.appendChild(arrow);
        const shine = el("div", "cta-shine");
        setStyle(shine, {
          position: "absolute",
          top: "0",
          bottom: "0",
          left: "0",
          width: `${120 * u}px`,
          background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.45), transparent)",
          opacity: "0"
        });
        button.appendChild(shine);
        root.appendChild(button);
        instance = { logo, words: cta.words, button, shine, glow: ctx.palette.glow, buttonStart: buttonStartFor(cta.words.length), buttonWidth: maxButton, u };
      },
      seek(localT) {
        if (!instance) return;
        const { u, buttonStart } = instance;
        enter(instance.logo, localT, 0, 0.6, { scale: 0.4, rotate: -12, ease: easeSpring });
        wordsIn(instance.words, localT, WORDS_START2, WORD_EACH3, WORD_DUR3);
        enter(instance.button, localT, buttonStart, 0.7, { y: 50 * u, scale: 0.8, ease: easeSpring });
        const breath = Math.sin(Math.max(0, localT - buttonStart - 0.75) * 3.2) ** 2;
        instance.button.style.boxShadow = `0 ${(22 * u).toFixed(2)}px ${((50 + 40 * breath) * u).toFixed(2)}px -${((18 - 10 * breath) * u).toFixed(2)}px ${instance.glow}`;
        const sweep = clamp01((localT - buttonStart - 0.5) / 0.7);
        instance.shine.style.opacity = sweep > 0 && sweep < 1 ? "1" : "0";
        instance.shine.style.transform = `translateX(${(-140 * u + sweep * (instance.buttonWidth + 280 * u)).toFixed(2)}px) skewX(-18deg)`;
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: Math.max(0.8, buttonStartFor(countWords2(props.ctaText)) + 0.72), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/logo-reveal.ts
  function createLogoReveal() {
    let instance;
    return {
      id: "LogoReveal",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        sceneRoot(root, L, { gap: `${L.pick({ landscape: 44, portrait: 64, square: 40 }) * u}px`, fontFamily: ctx.fonts.display });
        const size = L.pick({ landscape: 250, portrait: 340, square: 260 }) * u;
        const holder = el("div", "lr-logo");
        setStyle(holder, { position: "relative", width: `${size}px`, height: `${size}px`, flexShrink: "0" });
        const rings = [0, 1].map(() => {
          const ring = el("div", "lr-ring");
          setStyle(ring, { position: "absolute", inset: "0", boxSizing: "border-box", borderRadius: "28%", border: `${Math.max(3, 5 * u)}px solid ${ctx.palette.accent}`, opacity: "0" });
          holder.appendChild(ring);
          return ring;
        });
        const tile = el("div", "lr-tile");
        setStyle(tile, { ...cardStyle(ctx, u), position: "absolute", inset: "0", borderRadius: "28%", display: "flex", alignItems: "center", justifyContent: "center" });
        tile.appendChild(logoMark({ className: "lr-mark", size: size * 0.56, logoUrl: props.logoUrl, productName: props.productName, ctx }));
        holder.appendChild(tile);
        root.appendChild(holder);
        const wordmark = textBlock(props.productName, {
          className: "lr-wordmark",
          width: L.safe.width,
          maxSize: L.pick({ landscape: 76, portrait: 92, square: 72 }) * u,
          minSize: 24 * u,
          maxLines: 2,
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "800",
          tracking: "-0.03em"
        });
        root.appendChild(wordmark.wrap);
        instance = { tile, rings, words: wordmark.words };
      },
      seek(localT) {
        if (!instance) return;
        enter(instance.tile, localT, 0, 0.7, { scale: 0.3, rotate: -20, ease: easeSpring });
        instance.rings.forEach((ring, i) => {
          const p = clamp01((localT - 0.25 - i * 0.18) / 0.8);
          ring.style.opacity = String(p <= 0 ? 0 : (1 - p) * 0.7);
          ring.style.transform = `scale(${(1 + 0.6 * easeOutCubic(p)).toFixed(4)})`;
        });
        wordsIn(instance.words, localT, 0.3, 0.07, 0.45);
      },
      marks() {
        return [
          { t: 0, type: "start" },
          { t: 0.9, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/hero-rebuild.ts
  var HEAD_START = 0.2;
  var HEAD_EACH = 0.055;
  var SUB_EACH = 0.022;
  var WORD_DUR4 = 0.5;
  var countWords3 = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  var subStartFor = (headWords) => HEAD_START + Math.max(0, headWords - 1) * HEAD_EACH + 0.25;
  function createHeroRebuild() {
    let instance;
    return {
      id: "HeroRebuild",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const portrait = L.orientation === "portrait";
        const align = portrait ? "left" : "center";
        sceneRoot(root, L, { alignItems: portrait ? "flex-start" : "center", fontFamily: ctx.fonts.display });
        const stack = el("div", "hr-stack");
        setStyle(stack, {
          display: "flex",
          flexDirection: "column",
          alignItems: portrait ? "flex-start" : "center",
          gap: `${L.pick({ landscape: 30, portrait: 44, square: 26 }) * u}px`,
          transformOrigin: portrait ? "left center" : "center"
        });
        root.appendChild(stack);
        const barWidth = L.pick({ landscape: 96, portrait: 120, square: 88 }) * u;
        const accentBar = el("div", "hr-accent");
        setStyle(accentBar, {
          width: "0px",
          height: `${8 * u}px`,
          background: `linear-gradient(90deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
          borderRadius: `${4 * u}px`,
          flexShrink: "0"
        });
        stack.appendChild(accentBar);
        const headline = textBlock(props.headline, {
          className: "hr-headline",
          width: Math.min(L.safe.width, L.pick({ landscape: 1560, portrait: 1e3, square: 960 }) * u),
          maxSize: L.pick({ landscape: 100, portrait: 112, square: 88 }) * u,
          minSize: 28 * u,
          maxLines: L.pick({ landscape: 2, portrait: 4, square: 3 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "800",
          align,
          lineHeight: 1.08,
          tracking: "-0.03em"
        });
        stack.appendChild(headline.wrap);
        const sub = textBlock(props.subheadline, {
          className: "hr-sub",
          width: Math.min(L.safe.width, L.pick({ landscape: 1200, portrait: 1e3, square: 900 }) * u),
          maxSize: L.pick({ landscape: 40, portrait: 48, square: 36 }) * u,
          minSize: 20 * u,
          maxLines: 3,
          color: ctx.palette.muted,
          family: ctx.fonts.body,
          weight: "500",
          align,
          lineHeight: 1.35,
          tracking: "-0.005em"
        });
        stack.appendChild(sub.wrap);
        instance = { stack, headWords: headline.words, subWords: sub.words, accentBar, barWidth, durationSec: ctx.durationSec };
      },
      seek(localT) {
        if (!instance) return;
        instance.accentBar.style.width = `${(progress(localT, 0, 0.45, easeOutCubic) * instance.barWidth).toFixed(2)}px`;
        wordsIn(instance.headWords, localT, HEAD_START, HEAD_EACH, WORD_DUR4);
        wordsIn(instance.subWords, localT, subStartFor(instance.headWords.length), SUB_EACH, WORD_DUR4, 0.4);
        instance.stack.style.transform = `scale(${(0.96 + 0.035 * progress(localT, 0, instance.durationSec, easeOutCubic)).toFixed(4)})`;
      },
      marks(props) {
        const settle = wordsSettle(countWords3(props.subheadline), subStartFor(countWords3(props.headline)), SUB_EACH, WORD_DUR4);
        return [
          { t: 0, type: "start" },
          { t: Math.max(1.3, settle + 0.05), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/ui-flow-cursor.ts
  var DEFAULT_PATH = [
    [0.25, 0.35],
    [0.6, 0.5],
    [0.45, 0.7]
  ];
  var FRAME_ENTER2 = 0.8;
  var CAPTION_START2 = 0.35;
  var WORD_EACH4 = 0.05;
  var WORD_DUR5 = 0.5;
  var CURSOR_START = 0.7;
  var LEG_SEC = 0.85;
  var countWords4 = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  var CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 2.5l15.5 9.2-6.6 1.5 3.9 7.2-2.9 1.6-3.9-7.3-4.9 4.7z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  function createUIFlowCursor() {
    let instance;
    return {
      id: "UIFlowCursor",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const gap = L.pick({ landscape: 34, portrait: 48, square: 30 }) * u;
        sceneRoot(root, L, { flexDirection: L.orientation === "portrait" ? "column-reverse" : "column", gap: `${gap}px`, fontFamily: ctx.fonts.body });
        const caption = textBlock(props.caption, {
          className: "uf-caption",
          width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
          maxSize: L.pick({ landscape: 52, portrait: 62, square: 46 }) * u,
          minSize: 22 * u,
          maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "700",
          lineHeight: 1.2
        });
        const width = L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.98 });
        const height = Math.min(L.safe.height - gap - caption.height - 8 * u, L.pick({ landscape: 0.66, portrait: 0.58, square: 0.62 }) * ctx.height);
        const frame = browserFrame({ className: "uf-frame", width, height, screenshotUrl: props.screenshotUrl, pageLabel: props.pageLabel, ctx, u });
        const targetPath = (props.cursorTargets ?? []).map((r) => [r.x + r.w / 2, (r.y + r.h / 2) * frame.viewportWidth / frame.viewportHeight]).filter(([x, y]) => x > 0.02 && x < 0.98 && y > 0.04 && y < 0.94);
        const path = targetPath.length > 0 ? targetPath : props.cursorPath && props.cursorPath.length > 0 ? props.cursorPath : DEFAULT_PATH;
        const rippleSize = 96 * u;
        const ripples = path.map(() => {
          const ripple = el("div", "uf-ripple");
          setStyle(ripple, {
            position: "absolute",
            left: `${-rippleSize / 2}px`,
            top: `${-rippleSize / 2}px`,
            width: `${rippleSize}px`,
            height: `${rippleSize}px`,
            borderRadius: "50%",
            border: `${5 * u}px solid ${ctx.palette.accent}`,
            background: ctx.palette.accentSoft,
            boxSizing: "border-box",
            opacity: "0"
          });
          frame.viewport.appendChild(ripple);
          return ripple;
        });
        const cursorSize = 46 * u;
        const cursor = el("div", "uf-cursor");
        setStyle(cursor, { position: "absolute", left: "0", top: "0", width: `${cursorSize}px`, height: `${cursorSize}px`, transformOrigin: "15% 10%", filter: `drop-shadow(0 ${4 * u}px ${6 * u}px rgba(0,0,0,0.35))` });
        cursor.innerHTML = CURSOR_SVG;
        frame.viewport.appendChild(cursor);
        root.appendChild(frame.wrap);
        root.appendChild(caption.wrap);
        instance = { frame, cursor, ripples, words: caption.words, path, durationSec: ctx.durationSec, pinned: targetPath.length > 0 };
      },
      seek(localT) {
        if (!instance) return;
        const { frame, cursor, ripples, path } = instance;
        frame.enter(localT, 0, FRAME_ENTER2);
        wordsIn(instance.words, localT, CAPTION_START2, WORD_EACH4, WORD_DUR5);
        if (!instance.pinned) frame.scroll(progress(localT, CURSOR_START + LEG_SEC + 0.3, Math.max(2.4, instance.durationSec - 0.6)), 0.45);
        const w = frame.viewportWidth;
        const h = frame.viewportHeight;
        const leg = Math.max(0, (localT - CURSOR_START) / LEG_SEC);
        const idx = Math.min(path.length - 1, Math.floor(leg));
        const from = idx === 0 ? [0.92, 1.05] : path[idx - 1];
        const to = path[idx];
        const f = easeInOutCubic(clamp01(leg - idx));
        const x = lerp(from[0], to[0], f) * w;
        const y = lerp(from[1], to[1], f) * h;
        let press = 0;
        path.forEach((point, i) => {
          const since = localT - (CURSOR_START + (i + 1) * LEG_SEC);
          press = Math.max(press, clamp01(1 - Math.abs(since - 0.06) / 0.12));
          const ripple = ripples[i];
          const rp = clamp01(since / 0.55);
          ripple.style.opacity = since <= 0 ? "0" : String((1 - rp) * 0.9);
          ripple.style.transform = `translate(${(point[0] * w).toFixed(2)}px, ${(point[1] * h).toFixed(2)}px) scale(${(0.3 + 1.1 * easeOutCubic(rp)).toFixed(4)})`;
        });
        cursor.style.opacity = String(clamp01((localT - CURSOR_START) / 0.2));
        cursor.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(1 - 0.18 * press).toFixed(4)})`;
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: Math.max(FRAME_ENTER2, wordsSettle(countWords4(props.caption), CAPTION_START2, WORD_EACH4, WORD_DUR5)), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/stat-counter.ts
  var COUNT_START = 0.15;
  var COUNT_END = 1.2;
  var LABEL_START = 0.55;
  function parseStatValue(value) {
    const match = /^([^\d]*)([\d,]+(?:\.\d+)?)([^\d]*)$/.exec(value.trim());
    if (!match) return { numeric: null, prefix: "", suffix: "", decimals: 0 };
    const [, prefix, numStr, suffix] = match;
    const numeric = Number(numStr.replace(/,/g, ""));
    if (Number.isNaN(numeric)) return { numeric: null, prefix: "", suffix: "", decimals: 0 };
    const decimals = numStr.includes(".") ? numStr.split(".")[1].length : 0;
    return { numeric, prefix: prefix ?? "", suffix: suffix ?? "", decimals };
  }
  function formatCounted(n, decimals) {
    return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function createStatCounter() {
    let instance;
    return {
      id: "StatCounter",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        sceneRoot(root, L, { gap: `${L.pick({ landscape: 22, portrait: 34, square: 20 }) * u}px` });
        const haloSize = L.pick({ landscape: 820, portrait: 900, square: 760 }) * u;
        const halo = el("div", "sc-halo");
        setStyle(halo, {
          position: "absolute",
          left: `${ctx.width / 2 - haloSize / 2}px`,
          top: `${(L.safe.top + L.safe.bottom) / 2 - haloSize / 2}px`,
          width: `${haloSize}px`,
          height: `${haloSize}px`,
          borderRadius: "50%",
          background: `radial-gradient(closest-side, ${ctx.palette.accentSoft}, transparent)`
        });
        root.appendChild(halo);
        const { numeric, prefix, suffix, decimals } = parseStatValue(props.value);
        const finalText = numeric === null ? props.value : `${prefix}${formatCounted(numeric, decimals)}${suffix}`;
        const maxValue = L.pick({ landscape: 300, portrait: 320, square: 260 }) * u;
        const valueSize = Math.min(maxValue, L.safe.width * 0.92 / (Math.max(1, finalText.length) * 0.66));
        const gradient = ctx.palette.accentText === ctx.palette.accent;
        const valueNode = el("div", "sc-value", numeric === null ? props.value : `${prefix}0${suffix}`);
        setStyle(valueNode, {
          position: "relative",
          fontSize: `${valueSize}px`,
          fontWeight: "800",
          color: ctx.palette.accentText,
          fontFamily: ctx.fonts.display,
          letterSpacing: "-0.04em",
          lineHeight: "1.05",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          textAlign: "center",
          ...gradient ? { backgroundImage: `linear-gradient(120deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, backgroundClip: "text", webkitBackgroundClip: "text", webkitTextFillColor: "transparent" } : {}
        });
        root.appendChild(valueNode);
        const barWidth = L.pick({ landscape: 140, portrait: 170, square: 130 }) * u;
        const bar = el("div", "sc-bar");
        setStyle(bar, { position: "relative", width: "0px", height: `${8 * u}px`, borderRadius: `${4 * u}px`, background: ctx.palette.accent, flexShrink: "0" });
        root.appendChild(bar);
        const label = textBlock(props.label, {
          className: "sc-label",
          width: Math.min(L.safe.width, 1200 * u),
          maxSize: L.pick({ landscape: 54, portrait: 62, square: 48 }) * u,
          minSize: 22 * u,
          maxLines: 3,
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "700",
          lineHeight: 1.2
        });
        label.wrap.style.position = "relative";
        root.appendChild(label.wrap);
        instance = { halo, valueNode, bar, barWidth, labelWords: label.words, numericTarget: numeric, prefix, suffix, decimals };
      },
      seek(localT) {
        if (!instance) return;
        enter(instance.valueNode, localT, 0, 0.8, { scale: 0.55, ease: easeSpring });
        const haloP = progress(localT, 0, 1.1, easeOutCubic);
        instance.halo.style.opacity = String(clamp01(localT / 0.4));
        instance.halo.style.transform = haloP >= 1 ? "none" : `scale(${(0.4 + 0.6 * haloP).toFixed(4)})`;
        if (instance.numericTarget !== null) {
          const countP = progress(localT, COUNT_START, COUNT_END, easeOutExpo);
          const current = countP >= 1 ? instance.numericTarget : instance.numericTarget * countP;
          instance.valueNode.textContent = `${instance.prefix}${formatCounted(current, instance.decimals)}${instance.suffix}`;
        }
        instance.bar.style.width = `${(progress(localT, 0.4, 0.9, easeOutCubic) * instance.barWidth).toFixed(2)}px`;
        wordsIn(instance.labelWords, localT, LABEL_START, 0.05, 0.45);
      },
      marks() {
        return [
          { t: 0, type: "start" },
          { t: 1.3, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/quote-card.ts
  var SWEEP_START = 0.45;
  var WORD_FADE = 0.25;
  var countWords5 = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  var sweepEach = (count) => Math.min(0.09, 1.4 / Math.max(1, count));
  var sweepEnd = (count) => SWEEP_START + Math.max(0, count - 1) * sweepEach(count) + WORD_FADE;
  function createQuoteCard() {
    let instance;
    return {
      id: "QuoteCard",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const portrait = L.orientation === "portrait";
        sceneRoot(root, L);
        const pad = L.pick({ landscape: 64, portrait: 56, square: 44 }) * u;
        const cardWidth = Math.min(L.safe.width, L.pick({ landscape: 1500, portrait: 1e3, square: 960 }) * u);
        const textWidth = cardWidth - 2 * pad;
        const card = el("div", "qc-card");
        setStyle(card, {
          ...cardStyle(ctx, u, 36),
          display: "flex",
          flexDirection: "column",
          alignItems: portrait ? "flex-start" : "center",
          gap: `${L.pick({ landscape: 24, portrait: 34, square: 22 }) * u}px`,
          width: `${cardWidth}px`,
          padding: `${pad}px`
        });
        root.appendChild(card);
        const markSize = L.pick({ landscape: 150, portrait: 190, square: 130 }) * u;
        const markNode = el("div", "qc-mark", "\u201C");
        setStyle(markNode, {
          fontSize: `${markSize}px`,
          lineHeight: "0.8",
          height: `${markSize * 0.46}px`,
          color: ctx.palette.accentText,
          fontFamily: ctx.fonts.display,
          fontWeight: "800"
        });
        card.appendChild(markNode);
        const quote = textBlock(props.quote, {
          className: "qc-quote",
          width: textWidth,
          maxSize: L.pick({ landscape: 62, portrait: 70, square: 52 }) * u,
          minSize: 22 * u,
          maxLines: L.pick({ landscape: 3, portrait: 5, square: 4 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "700",
          align: portrait ? "left" : "center",
          lineHeight: 1.22
        });
        card.appendChild(quote.wrap);
        const authorNode = el("div", "qc-author", props.author ? `\u2014 ${props.author}` : "");
        setStyle(authorNode, {
          ...WRAP_SAFE,
          fontSize: `${L.pick({ landscape: 32, portrait: 40, square: 30 }) * u}px`,
          fontWeight: "600",
          color: ctx.palette.muted,
          fontFamily: ctx.fonts.body,
          maxWidth: `${textWidth}px`,
          textAlign: portrait ? "left" : "center"
        });
        card.appendChild(authorNode);
        instance = { card, markNode, words: quote.words, authorNode, u };
      },
      seek(localT) {
        if (!instance) return;
        const { words, u } = instance;
        enter(instance.card, localT, 0, 0.8, { y: 70 * u, scale: 0.92 });
        enter(instance.markNode, localT, 0.2, 0.6, { scale: 0.3, rotate: -18 });
        const each = sweepEach(words.length);
        words.forEach((word, i) => {
          const lit = clamp01((localT - SWEEP_START - i * each) / WORD_FADE);
          word.style.opacity = String(0.2 + 0.8 * lit);
        });
        const end = sweepEnd(words.length);
        applyReveal(instance.authorNode, progress(localT, end - 0.1, end + 0.25, easeOutCubic), 12 * u);
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: Math.max(1.2, sweepEnd(countWords5(props.quote)) + 0.3), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/checklist-reveal.ts
  var ROW_STAGGER = 0.24;
  var ROW_DURATION = 0.7;
  function createChecklistReveal() {
    let instance;
    return {
      id: "ChecklistReveal",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        sceneRoot(root, L);
        const listWidth = Math.min(L.safe.width, L.pick({ landscape: 1240, portrait: 1e3, square: 960 }) * u);
        const list = el("div", "cl-list");
        setStyle(list, { display: "flex", flexDirection: "column", alignItems: "stretch", gap: `${L.pick({ landscape: 22, portrait: 30, square: 18 }) * u}px`, width: `${listWidth}px` });
        root.appendChild(list);
        const checkSize = L.pick({ landscape: 60, portrait: 70, square: 52 }) * u;
        const rowGap = 26 * u;
        const padX = L.pick({ landscape: 34, portrait: 34, square: 26 }) * u;
        const padY = L.pick({ landscape: 24, portrait: 30, square: 20 }) * u;
        const labelWidth = listWidth - 2 * padX - checkSize - rowGap;
        const longest = props.items.reduce((a, s) => s.length > a.length ? s : a, "");
        const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 46, portrait: 54, square: 40 }) * u, 2, 22 * u);
        const rows = props.items.map((item) => {
          const node = el("div", "cl-row");
          setStyle(node, { ...cardStyle(ctx, u, 24), display: "flex", alignItems: "center", gap: `${rowGap}px`, padding: `${padY}px ${padX}px` });
          const check = el("div", "cl-check");
          setStyle(check, {
            width: `${checkSize}px`,
            height: `${checkSize}px`,
            minWidth: `${checkSize}px`,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          });
          check.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="${ctx.palette.onAccent}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.6l4.6 4.6L19 7.6" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg>`;
          node.appendChild(check);
          const label = el("div", "cl-label", item);
          setStyle(label, {
            ...WRAP_SAFE,
            fontSize: `${labelSize}px`,
            fontWeight: "700",
            color: ctx.palette.fg,
            fontFamily: ctx.fonts.display,
            lineHeight: "1.25",
            letterSpacing: "-0.015em",
            maxWidth: `${labelWidth}px`
          });
          node.appendChild(label);
          list.appendChild(node);
          return { node, check, tick: check.querySelector("path") };
        });
        instance = { rows, u, cues: props.cues };
      },
      seek(localT) {
        if (!instance) return;
        const { u, cues } = instance;
        instance.rows.forEach(({ node, check, tick }, i) => {
          const start = cueStart(cues, i, ROW_STAGGER);
          enter(node, localT, start, ROW_DURATION, { x: -90 * u, scale: 0.96 });
          const pop = progress(localT, start + 0.2, start + 0.7, easeSpring);
          check.style.transform = localT >= start + 0.7 ? "none" : `scale(${(0.3 + 0.7 * pop).toFixed(4)})`;
          if (tick) tick.style.strokeDashoffset = (1 - progress(localT, start + 0.4, start + 0.75, easeOutCubic)).toFixed(4);
        });
      },
      marks(props) {
        const lastStart = cueStart(props.cues, props.items.length - 1, ROW_STAGGER);
        return [
          { t: 0, type: "start" },
          { t: lastStart + 0.8, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/big-statement.ts
  var WORDS_START3 = 0.25;
  var WORD_EACH5 = 0.07;
  var WORD_DUR6 = 0.55;
  var splitWords = (s) => s.trim().split(/\s+/).filter(Boolean);
  var bare = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  function highlightRange(text, highlight) {
    if (!highlight) return null;
    const words = splitWords(text).map(bare);
    const target = splitWords(highlight).map(bare).filter(Boolean);
    if (target.length === 0) return null;
    for (let i = 0; i + target.length <= words.length; i++) {
      if (target.every((w, k) => words[i + k] === w)) return [i, i + target.length];
    }
    return null;
  }
  function createBigStatement() {
    let instance;
    return {
      id: "BigStatement",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const portrait = L.orientation === "portrait";
        sceneRoot(root, L, { alignItems: portrait ? "flex-start" : "center", fontFamily: ctx.fonts.display });
        const stack = el("div", "bs-stack");
        setStyle(stack, {
          display: "flex",
          flexDirection: "column",
          alignItems: portrait ? "flex-start" : "center",
          gap: `${L.pick({ landscape: 40, portrait: 56, square: 36 }) * u}px`,
          transformOrigin: portrait ? "left center" : "center"
        });
        root.appendChild(stack);
        const ruleWidth = L.pick({ landscape: 120, portrait: 150, square: 110 }) * u;
        const rule = el("div", "bs-rule");
        setStyle(rule, { width: `${ruleWidth}px`, height: `${10 * u}px`, borderRadius: `${5 * u}px`, background: `linear-gradient(90deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, transformOrigin: portrait ? "left center" : "center", flexShrink: "0" });
        stack.appendChild(rule);
        const block = textBlock(props.text, {
          className: "bs-text",
          width: Math.min(L.safe.width, L.pick({ landscape: 1640, portrait: 1e3, square: 960 }) * u),
          maxSize: L.pick({ landscape: 150, portrait: 150, square: 118 }) * u,
          minSize: 32 * u,
          maxLines: L.pick({ landscape: 3, portrait: 5, square: 4 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "800",
          align: portrait ? "left" : "center",
          lineHeight: 1.04,
          tracking: "-0.04em"
        });
        stack.appendChild(block.wrap);
        const range = highlightRange(props.text, props.highlight);
        const markers = [];
        if (range) {
          for (let i = range[0]; i < range[1] && i < block.words.length; i++) {
            const word = block.words[i];
            word.style.color = ctx.palette.accentText;
            markers.push(addMarker(word, ctx.palette.accentSoft));
          }
        }
        instance = { stack, rule, ruleWidth, words: block.words, markers, durationSec: ctx.durationSec };
      },
      seek(localT) {
        if (!instance) return;
        instance.rule.style.transform = scaleXTo(progress(localT, 0, 0.45, easeOutCubic));
        wordsIn(instance.words, localT, WORDS_START3, WORD_EACH5, WORD_DUR6, 0.7);
        const landed = wordsSettle(instance.words.length, WORDS_START3, WORD_EACH5, WORD_DUR6);
        instance.markers.forEach((marker, i) => {
          marker.style.transform = scaleXTo(progress(localT, landed - 0.25 + i * 0.08, landed + 0.1 + i * 0.08, easeOutCubic));
        });
        instance.stack.style.transform = `scale(${(0.95 + 0.045 * progress(localT, 0, instance.durationSec, easeOutCubic)).toFixed(4)})`;
      },
      marks(props) {
        const count = splitWords(props.text).length;
        const range = highlightRange(props.text, props.highlight);
        const markerTail = range ? 0.1 + (range[1] - range[0] - 1) * 0.08 : 0;
        return [
          { t: 0, type: "start" },
          { t: Math.max(1.1, wordsSettle(count, WORDS_START3, WORD_EACH5, WORD_DUR6) + markerTail + 0.05), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/bento-grid.ts
  var TILE_START = 0.35;
  var TILE_STAGGER = 0.13;
  var TILE_ENTER = 0.7;
  var tileStart = (i, cues) => Math.max(TILE_START + i * TILE_STAGGER, (cues?.[i] ?? 0) - 0.25);
  var settleFor2 = (count, cues) => tileStart(count - 1, cues) + TILE_ENTER;
  function createBentoGrid() {
    let instance;
    return {
      id: "BentoGrid",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const row = L.orientation === "landscape";
        const gap = L.pick({ landscape: 28, portrait: 26, square: 18 }) * u;
        const pad = L.pick({ landscape: 48, portrait: 44, square: 30 }) * u;
        sceneRoot(root, L, { fontFamily: ctx.fonts.display });
        const gridWidth = Math.min(L.safe.width, L.pick({ landscape: 1640, portrait: 1e3, square: 980 }) * u);
        const gridHeight = L.safe.height * L.pick({ landscape: 0.8, portrait: 0.86, square: 0.94 });
        const grid = el("div", "bg-grid");
        setStyle(grid, {
          display: "grid",
          width: `${gridWidth}px`,
          height: `${gridHeight}px`,
          gap: `${gap}px`,
          gridTemplateColumns: row ? "1.15fr 1fr" : "1fr",
          gridTemplateRows: row ? "repeat(3, 1fr)" : "1.5fr repeat(3, 1fr)"
        });
        root.appendChild(grid);
        const leadWidth = row ? (gridWidth - gap) * 1.15 / 2.15 : gridWidth;
        const lead = el("div", "bg-lead");
        setStyle(lead, {
          boxSizing: "border-box",
          gridRow: row ? "1 / span 3" : "auto",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: `${pad * 1.2}px`,
          borderRadius: `${36 * u}px`,
          background: `${ctx.palette.accent} linear-gradient(140deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
          boxShadow: `0 ${30 * u}px ${80 * u}px -${30 * u}px ${ctx.palette.glow}`,
          minWidth: "0",
          minHeight: "0"
        });
        const title = textBlock(props.title, {
          className: "bg-title",
          width: leadWidth - 2 * pad * 1.2,
          maxSize: L.pick({ landscape: 96, portrait: 92, square: 68 }) * u,
          minSize: 26 * u,
          maxLines: L.pick({ landscape: 5, portrait: 3, square: 3 }),
          color: ctx.palette.onAccent,
          family: ctx.fonts.display,
          weight: "800",
          align: "left",
          lineHeight: 1.06,
          tracking: "-0.035em"
        });
        lead.appendChild(title.wrap);
        grid.appendChild(lead);
        const tileWidth = row ? gridWidth - gap - leadWidth : gridWidth;
        const dot = L.pick({ landscape: 22, portrait: 24, square: 18 }) * u;
        const labelWidth = tileWidth - 2 * pad - dot - pad * 0.6;
        const longest = props.items.reduce((a, s) => s.length > a.length ? s : a, "");
        const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 46, portrait: 50, square: 38 }) * u, 2, 22 * u);
        const dots = [];
        const tiles = props.items.map((item) => {
          const tile = el("div", "bg-tile");
          setStyle(tile, { ...cardStyle(ctx, u, 30), display: "flex", alignItems: "center", gap: `${pad * 0.6}px`, padding: `0 ${pad}px`, minWidth: "0", minHeight: "0" });
          const dotNode = el("div", "bg-dot");
          setStyle(dotNode, { width: `${dot}px`, height: `${dot}px`, borderRadius: "50%", flexShrink: "0", background: `linear-gradient(135deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})` });
          tile.appendChild(dotNode);
          dots.push(dotNode);
          const label = el("div", "bg-label", item);
          setStyle(label, { ...WRAP_SAFE, fontSize: `${labelSize}px`, fontWeight: "700", color: ctx.palette.fg, lineHeight: "1.2", letterSpacing: "-0.02em", maxWidth: `${labelWidth}px` });
          tile.appendChild(label);
          grid.appendChild(tile);
          return tile;
        });
        instance = { lead, titleWords: title.words, tiles, dots, horizontal: row, u, cues: props.cues };
      },
      seek(localT) {
        if (!instance) return;
        const { u, horizontal, cues } = instance;
        enter(instance.lead, localT, 0, 0.8, { scale: 0.86, y: 40 * u });
        wordsIn(instance.titleWords, localT, 0.25, 0.06, 0.5);
        instance.tiles.forEach((tile, i) => {
          const start = tileStart(i, cues);
          enter(tile, localT, start, TILE_ENTER, horizontal ? { x: 120 * u, scale: 0.94 } : { y: 90 * u, scale: 0.94 });
          const pop = Math.min(1, Math.max(0, (localT - start - 0.25) / 0.45));
          instance.dots[i].style.transform = pop >= 1 ? "none" : `scale(${(0.2 + 0.8 * easeSpring(pop)).toFixed(4)})`;
        });
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: settleFor2(props.items.length, props.cues), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/screen-collage.ts
  var SHOT_STAGGER = 0.14;
  var SHOT_ENTER = 0.8;
  var CAPTION_START3 = 0.45;
  var WORD_EACH6 = 0.05;
  var WORD_DUR7 = 0.5;
  var SHOT_ASPECT = 1.6;
  var countWords6 = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  function createScreenCollage() {
    let instance;
    return {
      id: "ScreenCollage",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const gap = L.pick({ landscape: 36, portrait: 48, square: 30 }) * u;
        sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });
        const caption = textBlock(props.caption, {
          className: "sg-caption",
          width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
          maxSize: L.pick({ landscape: 54, portrait: 64, square: 48 }) * u,
          minSize: 22 * u,
          maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "700",
          lineHeight: 1.2
        });
        const stageWidth = L.safe.width;
        const stageHeight = L.safe.height - gap - caption.height - 8 * u;
        const stage = el("div", "sg-stage");
        setStyle(stage, { position: "relative", width: `${stageWidth}px`, height: `${stageHeight}px`, flexShrink: "0" });
        const stacked = L.orientation !== "landscape";
        const urls = props.screenshotUrls.slice(0, L.orientation === "square" ? 2 : 3);
        const leadWidth = stacked ? Math.min(stageWidth * 0.86, stageHeight / (1 + 0.72 * (urls.length - 1)) * SHOT_ASPECT) : Math.min(stageWidth * 0.45, stageHeight * 0.94 * SHOT_ASPECT);
        const leadHeight = leadWidth / SHOT_ASPECT;
        const shots = urls.map((url, i) => {
          const side = i === 0 ? 0 : i === 1 ? -1 : 1;
          const scale = stacked || i === 0 ? 1 : 0.8;
          const width = leadWidth * scale;
          const height = leadHeight * scale;
          const cx = stacked ? stageWidth / 2 + (i % 2 === 0 ? -1 : 1) * stageWidth * 0.05 : stageWidth / 2 + side * leadWidth * 0.66;
          const cy = stacked ? leadHeight / 2 + i * leadHeight * 0.72 + (stageHeight - leadHeight * (1 + 0.72 * (urls.length - 1))) / 2 : stageHeight / 2;
          const tilt = stacked ? i % 2 === 0 ? -2.5 : 2.5 : side * 5;
          const node = el("div", "sg-shot");
          setStyle(node, {
            position: "absolute",
            left: `${cx - width / 2}px`,
            top: `${cy - height / 2}px`,
            width: `${width}px`,
            height: `${height}px`,
            borderRadius: `${18 * ctx.style.radius * u}px`,
            overflow: "hidden",
            background: ctx.palette.surface,
            boxShadow: `0 ${40 * u}px ${90 * u}px -${36 * u}px ${ctx.palette.glow}, 0 ${24 * u}px ${50 * u}px -${24 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.7 : 0.35}), 0 0 0 ${Math.max(1, 1.5 * u)}px ${ctx.palette.border}`,
            // The lead card overlaps its neighbours.
            zIndex: String(i === 0 ? 3 : 1)
          });
          const img = el("img");
          img.src = url;
          setStyle(img, { display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" });
          node.appendChild(img);
          stage.appendChild(node);
          const driftAxis = stacked ? "translateX" : "translateY";
          const driftSign = i === 0 ? -1 : 1;
          return {
            node,
            rest: (drift) => `${driftAxis}(${(drift * driftSign * 22 * u).toFixed(2)}px) rotate(${tilt}deg)`,
            // Neighbours first, the lead card last so it lands on top.
            start: i === 0 ? SHOT_STAGGER * (urls.length - 1) : SHOT_STAGGER * (i - 1),
            from: stacked ? { x: (i % 2 === 0 ? -1 : 1) * 160 * u, scale: 0.86, rotate: tilt * 2 } : { y: 140 * u, scale: 0.8, rotate: side * 8 }
          };
        });
        root.appendChild(stage);
        root.appendChild(caption.wrap);
        instance = { shots, words: caption.words, durationSec: ctx.durationSec };
      },
      seek(localT) {
        if (!instance) return;
        const drift = Math.min(1, Math.max(0, localT / Math.max(1e-3, instance.durationSec)));
        for (const shot of instance.shots) enter(shot.node, localT, shot.start, SHOT_ENTER, shot.from, shot.rest(drift));
        wordsIn(instance.words, localT, CAPTION_START3, WORD_EACH6, WORD_DUR7);
      },
      marks(props) {
        const shotsLanded = SHOT_STAGGER * (Math.min(3, props.screenshotUrls?.length ?? 1) - 1) + SHOT_ENTER;
        return [
          { t: 0, type: "start" },
          { t: Math.max(shotsLanded, wordsSettle(countWords6(props.caption), CAPTION_START3, WORD_EACH6, WORD_DUR7)), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/device-mockup.ts
  var DEVICE_ENTER = 1;
  var CAPTION_START4 = 0.5;
  var WORD_EACH7 = 0.05;
  var WORD_DUR8 = 0.5;
  var countWords7 = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  function createDeviceMockup() {
    let instance;
    return {
      id: "DeviceMockup",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const gap = L.pick({ landscape: 40, portrait: 56, square: 32 }) * u;
        sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });
        const caption = textBlock(props.caption, {
          className: "dm-caption",
          width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
          maxSize: L.pick({ landscape: 54, portrait: 64, square: 48 }) * u,
          minSize: 22 * u,
          maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "700",
          lineHeight: 1.2
        });
        const laptop = L.orientation === "landscape";
        const room = L.safe.height - gap - caption.height - 8 * u;
        const bezel = (laptop ? 16 : 14) * u;
        const baseHeight = laptop ? 26 * u : 0;
        const screenHeight = laptop ? Math.min(room - 2 * bezel - baseHeight, L.safe.width * 0.72 / 1.6) : Math.min(room - 2 * bezel, L.safe.width * 0.6 * 19 / 9);
        const screenWidth = laptop ? screenHeight * 1.6 : screenHeight * 9 / 19;
        const shell = ctx.palette.isDark ? "rgb(38, 38, 42)" : "rgb(24, 24, 28)";
        const device = el("div", "dm-device");
        setStyle(device, { position: "relative", flexShrink: "0", display: "flex", flexDirection: "column", alignItems: "center", transformOrigin: "50% 60%" });
        const body = el("div", "dm-body");
        setStyle(body, {
          boxSizing: "content-box",
          width: `${screenWidth}px`,
          height: `${screenHeight}px`,
          padding: `${bezel}px`,
          borderRadius: `${(laptop ? 22 : 54) * u}px`,
          background: shell,
          boxShadow: `0 ${50 * u}px ${110 * u}px -${40 * u}px ${ctx.palette.glow}, 0 ${30 * u}px ${70 * u}px -${30 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.75 : 0.4}), inset 0 0 0 ${Math.max(1, 1.5 * u)}px rgba(255,255,255,0.14)`
        });
        const screen = el("div", "dm-screen");
        setStyle(screen, { position: "relative", width: "100%", height: "100%", overflow: "hidden", borderRadius: `${(laptop ? 8 : 40) * u}px`, background: ctx.palette.surface });
        const imageWidth = laptop ? screenWidth : screenWidth * 2.3;
        const image = el("img");
        image.src = props.screenshotUrl;
        setStyle(image, { display: "block", width: `${imageWidth}px`, maxWidth: "none", height: "auto" });
        screen.appendChild(image);
        if (!laptop) {
          const island = el("div", "dm-island");
          setStyle(island, { position: "absolute", left: "50%", top: `${12 * u}px`, width: `${screenWidth * 0.3}px`, height: `${24 * u}px`, marginLeft: `${-screenWidth * 0.15}px`, borderRadius: `${12 * u}px`, background: shell });
          screen.appendChild(island);
        }
        body.appendChild(screen);
        device.appendChild(body);
        if (laptop) {
          const base = el("div", "dm-base");
          setStyle(base, { width: `${(screenWidth + 2 * bezel) * 1.16}px`, height: `${baseHeight}px`, borderRadius: `${4 * u}px ${4 * u}px ${18 * u}px ${18 * u}px`, background: `linear-gradient(${shell}, rgb(60, 60, 66))` });
          device.appendChild(base);
        }
        root.appendChild(device);
        root.appendChild(caption.wrap);
        instance = { device, image, screenWidth, screenHeight, imageWidth, words: caption.words, durationSec: ctx.durationSec, u };
      },
      seek(localT) {
        if (!instance) return;
        const { device, image, screenHeight, imageWidth, durationSec, u } = instance;
        const lin = clamp01(localT / DEVICE_ENTER);
        const inv = 1 - spring(lin, 0.82, 1);
        const turn = -7 + 14 * clamp01(localT / Math.max(1e-3, durationSec));
        device.style.opacity = String(clamp01(lin * 2.4));
        device.style.transform = `perspective(${1800 * u}px) translateY(${(90 * u * inv).toFixed(2)}px) rotateX(${(4 + 14 * inv).toFixed(3)}deg) rotateY(${(turn - 16 * inv).toFixed(3)}deg) scale(${(1 - 0.1 * inv).toFixed(4)})`;
        const pageHeight = image.naturalWidth > 0 ? imageWidth * image.naturalHeight / image.naturalWidth : screenHeight;
        const travel = Math.min(Math.max(0, pageHeight - screenHeight), screenHeight * 0.8);
        const offset = travel * easeInOutCubic(clamp01((localT - 1.1) / Math.max(0.8, durationSec - 1.6)));
        image.style.transform = offset < 5e-3 ? "none" : `translateY(${(-offset).toFixed(2)}px)`;
        wordsIn(instance.words, localT, CAPTION_START4, WORD_EACH7, WORD_DUR8);
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: Math.max(DEVICE_ENTER, wordsSettle(countWords7(props.caption), CAPTION_START4, WORD_EACH7, WORD_DUR8)), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/zoom-detail.ts
  var CARD_ENTER2 = 0.8;
  var CAPTION_START5 = 0.4;
  var WORD_EACH8 = 0.05;
  var WORD_DUR9 = 0.5;
  var DEFAULT_FOCUS = { x: 0.04, y: 0.08, w: 0.5, h: 0.18 };
  var countWords8 = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  function createZoomDetail() {
    let instance;
    return {
      id: "ZoomDetail",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const gap = L.pick({ landscape: 36, portrait: 52, square: 30 }) * u;
        sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });
        const caption = textBlock(props.caption, {
          className: "zd-caption",
          width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
          maxSize: L.pick({ landscape: 56, portrait: 66, square: 50 }) * u,
          minSize: 22 * u,
          maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "700",
          lineHeight: 1.2
        });
        const cardWidth = L.safe.width * L.pick({ landscape: 0.8, portrait: 1, square: 0.96 });
        const cardHeight = Math.min(L.safe.height - gap - caption.height - 8 * u, cardWidth * L.pick({ landscape: 0.46, portrait: 0.9, square: 0.62 }));
        const focus = props.focus ?? DEFAULT_FOCUS;
        const shownFraction = Math.max(focus.w * 1.35, focus.h * 1.6 * cardWidth / cardHeight, 0.34);
        const imageWidth = cardWidth / Math.min(1, shownFraction);
        const cx = (focus.x + focus.w / 2) * imageWidth;
        const cy = (focus.y + focus.h / 2) * imageWidth;
        const left = Math.min(0, Math.max(cardWidth - imageWidth, cardWidth / 2 - cx));
        const top = Math.min(0, cardHeight / 2 - cy);
        const card = el("div", "zd-card");
        setStyle(card, {
          position: "relative",
          width: `${cardWidth}px`,
          height: `${cardHeight}px`,
          flexShrink: "0",
          overflow: "hidden",
          borderRadius: `${26 * ctx.style.radius * u}px`,
          background: ctx.palette.surface,
          boxShadow: `0 ${50 * u}px ${110 * u}px -${40 * u}px ${ctx.palette.glow}, 0 ${30 * u}px ${60 * u}px -${30 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.7 : 0.35}), 0 0 0 ${Math.max(1, 1.5 * u)}px ${ctx.palette.border}`
        });
        const image = el("img");
        image.src = props.screenshotUrl;
        setStyle(image, { position: "absolute", left: `${left}px`, top: `${top}px`, width: `${imageWidth}px`, maxWidth: "none", height: "auto", transformOrigin: `${cx}px ${cy}px` });
        card.appendChild(image);
        const pad = 12 * u;
        const ring = el("div", "zd-ring");
        setStyle(ring, {
          position: "absolute",
          boxSizing: "border-box",
          left: `${left + focus.x * imageWidth - pad}px`,
          top: `${top + focus.y * imageWidth - pad}px`,
          width: `${focus.w * imageWidth + 2 * pad}px`,
          height: `${focus.h * imageWidth + 2 * pad}px`,
          border: `${4 * u}px solid ${ctx.palette.accent}`,
          borderRadius: `${14 * u}px`,
          boxShadow: `0 0 0 ${6 * u}px ${ctx.palette.accentSoft}, 0 0 ${40 * u}px ${ctx.palette.glow}`,
          opacity: "0",
          transformOrigin: "50% 50%"
        });
        if (props.focus) card.appendChild(ring);
        let tag = null;
        if (props.pageLabel) {
          tag = el("div", "zd-tag", props.pageLabel);
          setStyle(tag, {
            position: "absolute",
            left: `${20 * u}px`,
            bottom: `${20 * u}px`,
            padding: `${7 * u}px ${18 * u}px`,
            borderRadius: `${20 * u}px`,
            background: ctx.palette.fg,
            color: ctx.palette.bg,
            fontFamily: ctx.fonts.body,
            fontSize: `${20 * u}px`,
            fontWeight: "600",
            whiteSpace: "nowrap"
          });
          card.appendChild(tag);
        }
        root.appendChild(card);
        root.appendChild(caption.wrap);
        instance = { card, image, ring, tag, words: caption.words, durationSec: ctx.durationSec, u };
      },
      seek(localT) {
        if (!instance) return;
        const { card, image, ring, tag, durationSec, u } = instance;
        enter(card, localT, 0, CARD_ENTER2, { y: 90 * u, scale: 0.86 });
        image.style.transform = `scale(${(1.001 + 0.07 * clamp01(localT / Math.max(1e-3, durationSec))).toFixed(4)})`;
        const ringP = progress(localT, 0.7, 1.15, easeOutCubic);
        ring.style.opacity = String(ringP);
        ring.style.transform = ringP >= 1 ? "none" : `scale(${(1.12 - 0.12 * ringP).toFixed(4)})`;
        if (tag) tag.style.opacity = String(progress(localT, 0.6, 1));
        wordsIn(instance.words, localT, CAPTION_START5, WORD_EACH8, WORD_DUR9);
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: Math.max(1.15, wordsSettle(countWords8(props.caption), CAPTION_START5, WORD_EACH8, WORD_DUR9)), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/split-compare.ts
  var LEFT_WORDS = 0.3;
  var RIGHT_START = 1.1;
  var WORD_EACH9 = 0.05;
  var WORD_DUR10 = 0.45;
  var countWords9 = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  var rightSettle = (props) => wordsSettle(countWords9(props.right), RIGHT_START + 0.3, WORD_EACH9, WORD_DUR10);
  function createSplitCompare() {
    let instance;
    return {
      id: "SplitCompare",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const row = L.orientation === "landscape";
        const gap = L.pick({ landscape: 56, portrait: 60, square: 44 }) * u;
        sceneRoot(root, L, { flexDirection: row ? "row" : "column", gap: `${gap}px`, fontFamily: ctx.fonts.body });
        const pad = L.pick({ landscape: 52, portrait: 48, square: 36 }) * u;
        const cardWidth = row ? (L.safe.width - gap) / 2 : L.safe.width;
        const cardHeight = row ? L.safe.height * 0.68 : (L.safe.height - gap) / 2;
        const side = (text, label, accent) => {
          const card = el("div", accent ? "sp-after" : "sp-before");
          setStyle(card, {
            ...cardStyle(ctx, u, 32),
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            gap: `${pad * 0.5}px`,
            width: `${cardWidth}px`,
            height: `${cardHeight}px`,
            padding: `${pad}px`,
            ...accent ? { background: `${ctx.palette.accent} linear-gradient(140deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, border: "none" } : {}
          });
          const chip = el("div", "sp-chip", label);
          setStyle(chip, {
            padding: `${8 * u}px ${22 * u}px`,
            borderRadius: `${24 * u}px`,
            background: accent ? ctx.palette.onAccent : ctx.palette.accentSoft,
            color: accent ? ctx.palette.accent : ctx.palette.muted,
            fontFamily: ctx.fonts.body,
            fontSize: `${L.pick({ landscape: 26, portrait: 30, square: 24 }) * u}px`,
            fontWeight: "700",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            whiteSpace: "nowrap"
          });
          card.appendChild(chip);
          const block = textBlock(text, {
            className: accent ? "sp-after-text" : "sp-before-text",
            width: cardWidth - 2 * pad,
            maxSize: L.pick({ landscape: 88, portrait: 84, square: 64 }) * u,
            minSize: 24 * u,
            maxLines: 4,
            color: accent ? ctx.palette.onAccent : ctx.palette.muted,
            family: ctx.fonts.display,
            weight: "800",
            align: "left",
            lineHeight: 1.12
          });
          card.appendChild(block.wrap);
          root.appendChild(card);
          return { card, block };
        };
        const before = side(props.left, props.leftLabel ?? "Before", false);
        const after = side(props.right, props.rightLabel ?? "After", true);
        const arrowSize = L.pick({ landscape: 84, portrait: 92, square: 72 }) * u;
        const arrow = el("div", "sp-arrow", row ? "\u2192" : "\u2193");
        setStyle(arrow, {
          position: "absolute",
          left: `${ctx.width / 2 - arrowSize / 2}px`,
          top: `${(L.safe.top + L.safe.bottom) / 2 - arrowSize / 2}px`,
          width: `${arrowSize}px`,
          height: `${arrowSize}px`,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: ctx.palette.fg,
          color: ctx.palette.bg,
          fontSize: `${arrowSize * 0.5}px`,
          fontWeight: "800",
          lineHeight: "1",
          boxShadow: `0 ${10 * u}px ${30 * u}px -${10 * u}px rgba(0,0,0,0.5)`,
          zIndex: "2"
        });
        root.appendChild(arrow);
        instance = { leftCard: before.card, rightCard: after.card, arrow, left: before.block, right: after.block, u, horizontal: row };
      },
      seek(localT) {
        if (!instance) return;
        const { leftCard, rightCard, arrow, left, right, u, horizontal } = instance;
        enter(leftCard, localT, 0, 0.75, horizontal ? { x: -120 * u, scale: 0.94 } : { y: -100 * u, scale: 0.94 });
        wordsIn(left.words, localT, LEFT_WORDS, WORD_EACH9, WORD_DUR10);
        enter(rightCard, localT, RIGHT_START, 0.8, horizontal ? { x: 160 * u, scale: 0.9 } : { y: 140 * u, scale: 0.9 });
        wordsIn(right.words, localT, RIGHT_START + 0.3, WORD_EACH9, WORD_DUR10);
        const dim = progress(localT, RIGHT_START + 0.2, RIGHT_START + 0.8, easeOutCubic);
        left.wrap.style.opacity = String(1 - 0.45 * dim);
        const pop = clamp01((localT - RIGHT_START - 0.25) / 0.5);
        arrow.style.opacity = String(clamp01(pop * 3));
        arrow.style.transform = pop >= 1 ? "none" : `scale(${(0.3 + 0.7 * easeSpring(pop)).toFixed(4)})`;
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: Math.max(RIGHT_START + 0.8, rightSettle(props)), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/logo-wall.ts
  var CHIPS_START = 0.5;
  var CHIP_STAGGER = 0.08;
  var CHIP_ENTER = 0.6;
  var settleFor3 = (count) => CHIPS_START + Math.max(0, count - 1) * CHIP_STAGGER + CHIP_ENTER;
  function createLogoWall() {
    let instance;
    return {
      id: "LogoWall",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        sceneRoot(root, L, { gap: `${L.pick({ landscape: 56, portrait: 72, square: 44 }) * u}px`, fontFamily: ctx.fonts.body });
        const title = textBlock(props.title, {
          className: "lw-title",
          width: L.safe.width * L.pick({ landscape: 0.8, portrait: 1, square: 0.96 }),
          maxSize: L.pick({ landscape: 92, portrait: 88, square: 68 }) * u,
          minSize: 24 * u,
          maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "800",
          lineHeight: 1.12
        });
        root.appendChild(title.wrap);
        const names = props.names.slice(0, 10);
        const chipGap = L.pick({ landscape: 22, portrait: 24, square: 18 }) * u;
        const wall = el("div", "lw-wall");
        setStyle(wall, { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `${chipGap}px`, maxWidth: `${L.safe.width * L.pick({ landscape: 0.9, portrait: 1, square: 1 })}px` });
        const size = L.pick({ landscape: 58, portrait: 56, square: 44 }) * u * (names.length <= 4 ? 1.45 : names.length <= 6 ? 1.2 : 1);
        const chips = names.map((name) => {
          const chip = el("div", "lw-chip", name);
          setStyle(chip, {
            ...cardStyle(ctx, u, 22),
            padding: `${size * 0.42}px ${size * 0.8}px`,
            fontFamily: ctx.fonts.display,
            fontSize: `${size}px`,
            fontWeight: "700",
            letterSpacing: "-0.02em",
            lineHeight: "1.1",
            color: ctx.palette.fg,
            whiteSpace: "nowrap"
          });
          wall.appendChild(chip);
          return chip;
        });
        root.appendChild(wall);
        instance = { titleWords: title.words, chips, u };
      },
      seek(localT) {
        if (!instance) return;
        const { u } = instance;
        wordsIn(instance.titleWords, localT, 0.15, 0.06, 0.5);
        instance.chips.forEach((chip, i) => {
          enter(chip, localT, CHIPS_START + i * CHIP_STAGGER, CHIP_ENTER, { y: 50 * u, scale: 0.6, rotate: i % 2 === 0 ? -6 : 6 });
        });
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: settleFor3(Math.min(10, props.names?.length ?? 0)), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/step-by-step.ts
  var FRAME_START = 0.15;
  var FRAME_ENTER3 = 0.9;
  var CAPTION_START6 = 0.35;
  var WORD_EACH10 = 0.05;
  var WORD_DUR11 = 0.5;
  var countWords10 = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  function createStepByStep() {
    let instance;
    return {
      id: "StepByStep",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const side = L.orientation === "landscape";
        const gap = L.pick({ landscape: 64, portrait: 48, square: 30 }) * u;
        sceneRoot(root, L, { flexDirection: side ? "row" : "column", gap: `${gap}px`, fontFamily: ctx.fonts.body });
        const panelWidth = side ? L.safe.width * 0.3 : L.safe.width;
        const panel = el("div", "sb-panel");
        setStyle(panel, { display: "flex", flexDirection: "column", alignItems: side ? "flex-start" : "center", gap: `${L.pick({ landscape: 26, portrait: 22, square: 14 }) * u}px`, width: `${panelWidth}px`, flexShrink: "0" });
        const step = Math.max(1, Math.round(props.step || 1));
        const badgeSize = L.pick({ landscape: 190, portrait: 150, square: 104 }) * u;
        const badge = el("div", "sb-step", String(step).padStart(2, "0"));
        const gradient = ctx.palette.accentText === ctx.palette.accent;
        setStyle(badge, {
          fontFamily: ctx.fonts.display,
          fontSize: `${badgeSize}px`,
          fontWeight: "800",
          lineHeight: "0.95",
          letterSpacing: "-0.05em",
          color: ctx.palette.accentText,
          fontVariantNumeric: "tabular-nums",
          ...gradient ? { backgroundImage: `linear-gradient(120deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`, backgroundClip: "text", webkitBackgroundClip: "text", webkitTextFillColor: "transparent" } : {}
        });
        panel.appendChild(badge);
        const caption = textBlock(props.caption, {
          className: "sb-caption",
          width: panelWidth,
          maxSize: L.pick({ landscape: 62, portrait: 64, square: 46 }) * u,
          minSize: 24 * u,
          maxLines: L.pick({ landscape: 5, portrait: 2, square: 2 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "800",
          align: side ? "left" : "center",
          lineHeight: 1.1
        });
        panel.appendChild(caption.wrap);
        const total = Math.max(step, Math.min(8, Math.round(props.total ?? step)));
        const dotRow = el("div", "sb-dots");
        const dot = L.pick({ landscape: 16, portrait: 16, square: 12 }) * u;
        setStyle(dotRow, { display: "flex", gap: `${dot * 0.7}px`, marginTop: `${6 * u}px` });
        const dots = Array.from({ length: total }, (_, i) => {
          const node = el("div", "sb-dot");
          setStyle(node, { width: `${i === step - 1 ? dot * 2.6 : dot}px`, height: `${dot}px`, borderRadius: `${dot}px`, background: i < step ? ctx.palette.accent : ctx.palette.border });
          dotRow.appendChild(node);
          return node;
        });
        if (total > 1) panel.appendChild(dotRow);
        const frameWidth = side ? L.safe.width - panelWidth - gap : L.safe.width;
        const panelHeight = badgeSize * 0.95 + caption.height + (total > 1 ? dot + 30 * u : 0) + 2 * L.pick({ landscape: 26, portrait: 22, square: 14 }) * u;
        const frameHeight = side ? Math.min(L.safe.height * 0.82, frameWidth * 0.68) : Math.max(120 * u, L.safe.height - gap - panelHeight - 70 * u);
        const frame = browserFrame({ className: "sb-frame", width: frameWidth, height: frameHeight, screenshotUrl: props.screenshotUrl, pageLabel: props.pageLabel, ctx, u });
        root.appendChild(panel);
        root.appendChild(frame.wrap);
        instance = { badge, dots, step, frame, words: caption.words, focus: props.focus, durationSec: ctx.durationSec, u, side };
      },
      seek(localT) {
        if (!instance) return;
        const { badge, dots, step, frame, focus, durationSec, u, side } = instance;
        enter(badge, localT, 0, 0.7, side ? { x: -80 * u, scale: 0.7 } : { y: -60 * u, scale: 0.7 });
        wordsIn(instance.words, localT, CAPTION_START6, WORD_EACH10, WORD_DUR11);
        const current = dots[step - 1];
        if (current) {
          const p = progress(localT, 0.4, 0.9, easeOutCubic);
          current.style.transformOrigin = "left center";
          current.style.transform = p >= 1 ? "none" : `scaleX(${Math.max(0.38, p).toFixed(4)})`;
        }
        frame.enter(localT, FRAME_START, FRAME_ENTER3);
        const focusEnd = Math.min(2.6, Math.max(1.9, durationSec - 1.2));
        const focused = focus ? frame.focus(focus, progress(localT, 1.2, focusEnd), progress(localT, focusEnd - 0.2, focusEnd + 0.25)) : false;
        if (!focused) frame.scroll(progress(localT, 1.3, Math.max(2.1, durationSec - 0.5)));
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: Math.max(FRAME_START + FRAME_ENTER3, wordsSettle(countWords10(props.caption), CAPTION_START6, WORD_EACH10, WORD_DUR11)), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/kinetic-type.ts
  var FIRST_LINE = 0.1;
  var LINE_EACH = 0.26;
  var WORD_EACH11 = 0.06;
  var WORD_DUR12 = 0.45;
  var ADVANCE_EM = 0.64;
  function linesOf(text, maxLines) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const target = Math.max(1, Math.min(maxLines, Math.ceil(words.length / 2)));
    const ideal = words.join(" ").length / target;
    const rows = [];
    let row = "";
    for (const word of words) {
      const grown = row ? `${row} ${word}` : word;
      if (row && rows.length < target - 1 && grown.length - ideal > ideal - row.length) {
        rows.push(row);
        row = word;
      } else row = grown;
    }
    if (row) rows.push(row);
    return rows;
  }
  var settleOf = (text) => {
    const lines = linesOf(text, 5);
    const last = lines[lines.length - 1] ?? "";
    return wordsSettle(last.split(" ").length, FIRST_LINE + (lines.length - 1) * LINE_EACH, WORD_EACH11, WORD_DUR12);
  };
  function createKineticType() {
    let instance;
    return {
      id: "KineticType",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        sceneRoot(root, L, { alignItems: "flex-start", fontFamily: ctx.fonts.display });
        const rows = linesOf(props.text, L.pick({ landscape: 3, portrait: 5, square: 4 }));
        const lineHeight = 1;
        const tallest = L.safe.height * 0.94 / rows.length / lineHeight;
        const block = el("div", "kt-block");
        setStyle(block, { display: "flex", flexDirection: "column", alignItems: "flex-start", width: `${L.safe.width}px` });
        const lines = rows.map((row, i) => {
          const size = Math.max(28 * u, Math.min(tallest, L.safe.width / (row.length * ADVANCE_EM)));
          const line = el("div", "kt-line");
          setStyle(line, {
            display: "flex",
            columnGap: "0.24em",
            whiteSpace: "nowrap",
            fontSize: `${size}px`,
            fontWeight: "800",
            lineHeight: String(lineHeight),
            letterSpacing: "-0.045em",
            color: ctx.palette.fg
          });
          const words = row.split(" ").map((word) => {
            const node = el("span", "kt-word", word);
            setStyle(node, { display: "inline-block" });
            line.appendChild(node);
            return node;
          });
          block.appendChild(line);
          return { words, start: FIRST_LINE + i * LINE_EACH };
        });
        root.appendChild(block);
        instance = { lines };
      },
      seek(localT) {
        if (!instance) return;
        for (const line of instance.lines) wordsIn(line.words, localT, line.start, WORD_EACH11, WORD_DUR12, 0.5);
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: settleOf(props.text), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/templates/montage.ts
  var CARD_ENTER3 = 0.5;
  var CAPTION_START7 = 0.2;
  var WORD_EACH12 = 0.05;
  var WORD_DUR13 = 0.45;
  var countWords11 = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  function montageCuts(count, durationSec) {
    const n = Math.max(1, Math.min(6, count));
    const per = Math.max(0.42, (durationSec - 0.7) / n);
    return Array.from({ length: n }, (_, i) => Math.round((i === 0 ? 0 : 0.25 + i * per) * 1e3) / 1e3);
  }
  function createMontage() {
    let instance;
    return {
      id: "Montage",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const gap = L.pick({ landscape: 36, portrait: 52, square: 30 }) * u;
        sceneRoot(root, L, { gap: `${gap}px`, fontFamily: ctx.fonts.body });
        const caption = textBlock(props.caption, {
          className: "mg-caption",
          width: L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 }),
          maxSize: L.pick({ landscape: 58, portrait: 68, square: 50 }) * u,
          minSize: 22 * u,
          maxLines: L.pick({ landscape: 2, portrait: 3, square: 2 }),
          color: ctx.palette.fg,
          family: ctx.fonts.display,
          weight: "800",
          lineHeight: 1.15
        });
        const room = L.safe.height - gap - caption.height - 8 * u;
        const width = Math.min(L.safe.width * L.pick({ landscape: 0.82, portrait: 1, square: 0.98 }), room * L.pick({ landscape: 1.7, portrait: 0.85, square: 1.5 }));
        const height = Math.min(room, width / L.pick({ landscape: 1.7, portrait: 0.85, square: 1.5 }));
        const card = el("div", "mg-card");
        setStyle(card, {
          position: "relative",
          width: `${width}px`,
          height: `${height}px`,
          flexShrink: "0",
          overflow: "hidden",
          borderRadius: `${26 * ctx.style.radius * u}px`,
          background: ctx.palette.surface,
          boxShadow: `0 ${50 * u}px ${110 * u}px -${40 * u}px ${ctx.palette.glow}, 0 ${30 * u}px ${60 * u}px -${30 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.7 : 0.35}), 0 0 0 ${Math.max(1, 1.5 * u)}px ${ctx.palette.border}`
        });
        const shots = props.screenshotUrls.slice(0, 6).map((url) => {
          const img = el("img");
          img.src = url;
          setStyle(img, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", opacity: "0", transformOrigin: "50% 40%" });
          card.appendChild(img);
          return img;
        });
        const flash = el("div", "mg-flash");
        setStyle(flash, { position: "absolute", inset: "0", background: ctx.palette.isDark ? "rgb(255,255,255)" : ctx.palette.accent, opacity: "0", pointerEvents: "none" });
        card.appendChild(flash);
        root.appendChild(card);
        root.appendChild(caption.wrap);
        instance = { card, shots, flash, cuts: montageCuts(shots.length, ctx.durationSec), words: caption.words, durationSec: ctx.durationSec, u };
      },
      seek(localT) {
        if (!instance) return;
        const { card, shots, flash, cuts, durationSec, u } = instance;
        enter(card, localT, 0, CARD_ENTER3, { y: 70 * u, scale: 0.9 });
        let current = 0;
        for (let i = 0; i < cuts.length; i++) if (localT >= cuts[i]) current = i;
        const since = localT - cuts[current];
        const hold = (cuts[current + 1] ?? durationSec) - cuts[current];
        shots.forEach((img, i) => {
          img.style.opacity = i === current ? "1" : "0";
          if (i !== current) return;
          const p = clamp01(since / Math.max(1e-3, hold));
          img.style.transform = `scale(${(1.1 - 0.07 * p).toFixed(4)}) translateX(${((i % 2 === 0 ? 1 : -1) * (1 - p) * 1.2).toFixed(3)}%)`;
        });
        flash.style.opacity = current > 0 ? String(0.55 * clamp01(1 - since / 0.14)) : "0";
        wordsIn(instance.words, localT, CAPTION_START7, WORD_EACH12, WORD_DUR13);
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: Math.max(CARD_ENTER3, wordsSettle(countWords11(props.caption), CAPTION_START7, WORD_EACH12, WORD_DUR13)), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../film-runtime/src/registry.ts
  var TEMPLATE_REGISTRY = {
    KineticHook: createKineticHook,
    FeatureTriplet: createFeatureTriplet,
    SectionShowcase: createSectionShowcase,
    CTAEndCard: createCTAEndCard,
    LogoReveal: createLogoReveal,
    HeroRebuild: createHeroRebuild,
    UIFlowCursor: createUIFlowCursor,
    StatCounter: createStatCounter,
    QuoteCard: createQuoteCard,
    ChecklistReveal: createChecklistReveal,
    BigStatement: createBigStatement,
    BentoGrid: createBentoGrid,
    ScreenCollage: createScreenCollage,
    DeviceMockup: createDeviceMockup,
    ZoomDetail: createZoomDetail,
    SplitCompare: createSplitCompare,
    LogoWall: createLogoWall,
    StepByStep: createStepByStep,
    KineticType: createKineticType,
    Montage: createMontage
  };
  function createTemplate(templateId) {
    const factory = TEMPLATE_REGISTRY[templateId];
    if (!factory) {
      throw new Error(`Unknown template id: ${templateId}. Known: ${Object.keys(TEMPLATE_REGISTRY).join(", ")}`);
    }
    return factory();
  }

  // ../film-runtime/src/util/rng.ts
  function hashString(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed;
    return () => {
      a |= 0;
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function createSceneRng(sceneSeed) {
    const cache = /* @__PURE__ */ new Map();
    return (seedKey) => {
      const key = `${sceneSeed}:${seedKey}`;
      let gen = cache.get(key);
      if (!gen) {
        gen = mulberry32(hashString(key));
        cache.set(key, gen);
      }
      return gen();
    };
  }

  // ../film-runtime/src/util/color.ts
  function parseColor(input) {
    const s = input.trim().toLowerCase();
    const hex = /^#([0-9a-f]{3,8})$/.exec(s);
    if (hex) {
      let h = hex[1];
      if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
      if (h.length !== 6 && h.length !== 8) return null;
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    if (s === "white") return [255, 255, 255];
    if (s === "black") return [0, 0, 0];
    return null;
  }
  function relativeLuminance([r, g, b]) {
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function contrastRgb(a, b) {
    const la = relativeLuminance(a) + 0.05;
    const lb = relativeLuminance(b) + 0.05;
    return la > lb ? la / lb : lb / la;
  }
  function contrastRatio(a, b) {
    const ra = parseColor(a);
    const rb = parseColor(b);
    return ra && rb ? contrastRgb(ra, rb) : null;
  }
  function rgbString([r, g, b]) {
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }
  function rgbaString([r, g, b], alpha) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
  }
  function mixRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function shiftHue([r, g, b], degrees) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 1e-6) return [r, g, b];
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
    h = ((h * 60 + degrees) % 360 + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(h / 60 % 2 - 1));
    const m = l - c / 2;
    const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
  }
  function bestContrast(against, candidates) {
    let best = candidates[0];
    let bestRatio = -1;
    for (const c of candidates) {
      const r = contrastRatio(c, against) ?? 0;
      if (r > bestRatio) {
        bestRatio = r;
        best = c;
      }
    }
    return best;
  }

  // ../film-runtime/src/backdrop.ts
  function createBackdrop(stage, manifest, palette, normalize) {
    const { width, height } = manifest;
    const u = Math.min(width, height) / 1080;
    const accent = parseColor(normalize(palette.accent)) ?? [124, 92, 255];
    const alt = parseColor(normalize(palette.accentAlt)) ?? accent;
    const fg = parseColor(normalize(palette.fg)) ?? [17, 17, 17];
    const look = stylePackFor(manifest.style).backdrop;
    const strength = (palette.isDark ? 1.5 : 1) * look.glow;
    const layer = el("div", "backdrop");
    setStyle(layer, { position: "absolute", inset: "0", overflow: "hidden", background: `linear-gradient(155deg, ${palette.bg} 30%, ${rgbaString(accent, 0.07 * strength)} 100%), ${palette.bg}` });
    const rng = createSceneRng("backdrop");
    const sceneCount = Math.max(1, manifest.scenes.length);
    const size = Math.max(width, height) * 1.1;
    const blobs = [
      { color: accent, alpha: 0.17 },
      { color: alt, alpha: 0.13 },
      { color: accent, alpha: 0.11 }
    ].map(({ color, alpha }, i) => {
      const node = el("div", "backdrop-glow");
      setStyle(node, {
        position: "absolute",
        left: `${-size / 2}px`,
        top: `${-size / 2}px`,
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: "50%",
        background: `radial-gradient(closest-side, ${rgbaString(color, alpha * strength)}, ${rgbaString(color, 0)})`
      });
      layer.appendChild(node);
      const anchors = Array.from({ length: sceneCount }, () => {
        const edge = rng(`edge-${i}`) < 0.5;
        const a = rng(`a-${i}`);
        const b = rng(`b-${i}`) < 0.5 ? 0.02 + rng(`c-${i}`) * 0.16 : 0.82 + rng(`c-${i}`) * 0.16;
        return edge ? [a, b] : [b, a];
      });
      return { node, anchors, phase: rng(`phase-${i}`) * Math.PI * 2, drift: 0.02 + rng(`drift-${i}`) * 0.02 };
    });
    const grid = el("div", "backdrop-grid");
    const step = 44 * u;
    setStyle(grid, {
      position: "absolute",
      inset: `${-step}px`,
      backgroundImage: `radial-gradient(${rgbaString(fg, palette.isDark ? 0.13 : 0.1)} ${1.4 * u}px, transparent ${1.9 * u}px)`,
      backgroundSize: `${step}px ${step}px`,
      maskImage: "radial-gradient(ellipse at 50% 50%, transparent 30%, black 100%)",
      webkitMaskImage: "radial-gradient(ellipse at 50% 50%, transparent 30%, black 100%)"
    });
    if (look.grid) layer.appendChild(grid);
    if (look.vignette > 0) {
      const edge = palette.isDark ? rgbaString([0, 0, 0], look.vignette) : rgbaString(accent, look.vignette * 0.22);
      const vignette = el("div", "backdrop-vignette");
      setStyle(vignette, { position: "absolute", inset: "0", background: `radial-gradient(ellipse at 50% 50%, transparent 45%, ${edge} 100%)` });
      layer.appendChild(vignette);
    }
    stage.appendChild(layer);
    const scenes = manifest.scenes;
    const beats = manifest.beats ?? [];
    function scenePosition(t) {
      let pos = 0;
      for (let i = 1; i < scenes.length; i++) {
        const s = scenes[i];
        const d = s.transitionInSec ?? 0;
        if (t >= s.start + d) pos = i;
        else if (t >= s.start) pos = i - 1 + easeInOutCubic(clamp01((t - s.start) / Math.max(d, 1e-3)));
        else break;
      }
      return pos;
    }
    function beatPulse(t) {
      let pulse = 0;
      for (const b of beats) {
        if (b > t) break;
        const dt = t - b;
        if (dt < 0.6) pulse = Math.max(pulse, Math.exp(-dt * 7));
      }
      return pulse;
    }
    return {
      seek(t) {
        const pos = scenePosition(t);
        const i0 = Math.min(sceneCount - 1, Math.floor(pos));
        const i1 = Math.min(sceneCount - 1, i0 + 1);
        const f = pos - i0;
        const pulse = beatPulse(t);
        for (const blob of blobs) {
          const [x0, y0] = blob.anchors[i0];
          const [x1, y1] = blob.anchors[i1];
          const x = (x0 + (x1 - x0) * f + Math.sin(t * 0.35 + blob.phase) * blob.drift) * width;
          const y = (y0 + (y1 - y0) * f + Math.cos(t * 0.28 + blob.phase) * blob.drift) * height;
          blob.node.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(1 + pulse * 0.07).toFixed(4)})`;
        }
        grid.style.transform = `translate(${(-((pos + 0.37) * step * 0.5) % step).toFixed(2)}px, ${(-((t + 1.3) * 3 * u) % step).toFixed(2)}px)`;
      }
    };
  }

  // ../film-runtime/src/captions.ts
  function createCaptionLayer(stage, manifest, palette) {
    const { width, height } = manifest;
    const u = Math.min(width, height) / 1080;
    const band = captionBand(width, height);
    const safe = safeRect(width, height);
    const layer = el("div", "captions");
    setStyle(layer, {
      position: "absolute",
      left: `${safe.left}px`,
      width: `${safe.width}px`,
      top: `${safe.bottom - band.height}px`,
      height: `${band.height}px`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "none"
    });
    const cues = manifest.captions.filter((cue) => cue.burn !== false).map((cue) => {
      const node = el("div", "caption");
      const fontSize = fitFontSize(cue.text, band.width - 56 * u, band.fontSize, band.maxLines, band.fontSize * 0.6);
      setStyle(node, {
        position: "absolute",
        display: "none",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: "0.28em",
        boxSizing: "border-box",
        maxWidth: `${band.width}px`,
        padding: `${10 * u}px ${28 * u}px`,
        borderRadius: `${22 * u}px`,
        background: palette.fg,
        color: palette.bg,
        fontFamily: manifest.fonts.body,
        fontSize: `${fontSize}px`,
        fontWeight: "700",
        lineHeight: "1.25",
        letterSpacing: "-0.01em",
        boxShadow: `0 ${12 * u}px ${32 * u}px -${12 * u}px rgba(0,0,0,0.45)`
      });
      const timed = cue.words && cue.words.length > 0 ? cue.words : cue.text.split(/\s+/).filter(Boolean).map((text) => ({ text, t0: cue.t0, t1: cue.t1 }));
      const words = timed.map((w) => {
        const span = el("span", "caption-word", w.text);
        setStyle(span, { display: "inline-block" });
        node.appendChild(span);
        return { node: span, t0: w.t0 };
      });
      layer.appendChild(node);
      return { cue, node, words };
    });
    stage.appendChild(layer);
    return {
      seek(t) {
        for (const c of cues) {
          const active = t >= c.cue.t0 && t < c.cue.t1;
          if (!active) {
            if (c.node.style.display !== "none") c.node.style.display = "none";
            continue;
          }
          c.node.style.display = "flex";
          const inP = clamp01((t - c.cue.t0) / 0.18);
          const outP = clamp01((c.cue.t1 - t) / 0.1);
          c.node.style.opacity = String(Math.min(easeOutCubic(inP), outP));
          c.node.style.transform = inP >= 1 ? "none" : `translateY(${((1 - spring(inP, 0.7, 1)) * 14 * u).toFixed(2)}px) scale(${(0.94 + 0.06 * spring(inP, 0.7, 1)).toFixed(4)})`;
          for (const w of c.words) {
            const spoken = clamp01((t - w.t0) / 0.08);
            w.node.style.opacity = String(0.45 + 0.55 * spoken);
          }
        }
      }
    };
  }

  // ../film-runtime/src/player.ts
  function toRgbString(color) {
    if (typeof document === "undefined") return color;
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const g = c.getContext("2d");
    if (!g) return color;
    g.fillStyle = "#000";
    g.fillStyle = color;
    g.fillRect(0, 0, 1, 1);
    const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${gg}, ${b})`;
  }
  function resolvePalette(p, normalize = toRgbString) {
    const bg = normalize(p.bg);
    const fg = normalize(p.fg);
    const accent = normalize(p.accent);
    const accentText = (contrastRatio(accent, bg) ?? 0) >= 3 ? p.accent : p.fg;
    const onAccent = bestContrast(accent, [bg, fg, "rgb(255, 255, 255)", "rgb(17, 17, 17)"]);
    const bgRgb = parseColor(bg) ?? [255, 255, 255];
    const fgRgb = parseColor(fg) ?? [17, 17, 17];
    const accentRgb = parseColor(accent) ?? fgRgb;
    const isDark = relativeLuminance(bgRgb) < 0.3;
    const accentIsNeutral = Math.max(...accentRgb) - Math.min(...accentRgb) < 24;
    return {
      ...p,
      accentText,
      onAccent: onAccent === bg ? p.bg : onAccent === fg ? p.fg : onAccent,
      isDark,
      surface: rgbString(isDark ? mixRgb(bgRgb, fgRgb, 0.08) : mixRgb(bgRgb, [255, 255, 255], 0.6)),
      border: rgbaString(fgRgb, isDark ? 0.16 : 0.1),
      muted: rgbString(mixRgb(fgRgb, bgRgb, 0.32)),
      accentSoft: rgbaString(accentRgb, isDark ? 0.24 : 0.13),
      accentAlt: rgbString(shiftHue(accentRgb, 38)),
      glow: accentIsNeutral ? `rgba(0, 0, 0, ${isDark ? 0.6 : 0.3})` : rgbaString(accentRgb, isDark ? 0.5 : 0.38)
    };
  }
  async function loadFontFaces(specs) {
    if (!specs || specs.length === 0 || typeof FontFace === "undefined") return;
    const loads = specs.map(async (s) => {
      try {
        const face = new FontFace(s.family, `url(${JSON.stringify(s.url)})`, {
          weight: s.weight ?? "400",
          style: s.style ?? "normal",
          ...s.unicodeRange ? { unicodeRange: s.unicodeRange } : {}
        });
        await face.load();
        document.fonts.add(face);
      } catch {
      }
    });
    await Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, 8e3))]);
  }
  async function loadFontStylesheets(urls) {
    if (!urls || urls.length === 0 || typeof document === "undefined") return;
    const loads = urls.map(
      (href) => new Promise((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.onload = () => resolve();
        link.onerror = () => resolve();
        document.head.appendChild(link);
      })
    );
    await Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, 4e3))]);
  }
  function cutStyle(kind, role, p, width, height, u) {
    if (kind === "cut") return { opacity: role === "in" === p >= 0.5 ? 1 : 0, transform: "" };
    if (kind === "push") {
      const e2 = easeInOutQuart(p);
      const x = role === "in" ? (1 - e2) * width : -e2 * width;
      return { opacity: 1, transform: `translateX(${x.toFixed(2)}px)` };
    }
    if (kind === "wipe") {
      const edge = ((1 - easeInOutQuart(p)) * 100).toFixed(3);
      return role === "in" ? { opacity: 1, transform: "", clipPath: `inset(0 0 0 ${edge}%)` } : { opacity: 1, transform: "", clipPath: `inset(0 ${(100 - Number(edge)).toFixed(3)}% 0 0)` };
    }
    if (kind === "whip") {
      if (role === "in") {
        const inv = 1 - easeOutQuint(p);
        return { opacity: clamp01((p - 0.3) / 0.3), transform: `translateX(${(inv * 0.6 * width).toFixed(2)}px)`, filter: `blur(${(inv * 40 * u).toFixed(2)}px)` };
      }
      const e2 = easeInCubic(p);
      return { opacity: 1 - clamp01((p - 0.2) / 0.3), transform: `translateX(${(-e2 * 0.6 * width).toFixed(2)}px)`, filter: `blur(${(e2 * 40 * u).toFixed(2)}px)` };
    }
    if (role === "in") {
      const inv = 1 - easeOutQuint(p);
      const opacity2 = clamp01((p - 0.15) / 0.6);
      if (kind === "slide-left") return { opacity: opacity2, transform: `translateX(${(inv * 0.22 * width).toFixed(2)}px)` };
      if (kind === "slide-up") return { opacity: opacity2, transform: `translateY(${(inv * 0.2 * height).toFixed(2)}px)` };
      if (kind === "zoom") return { opacity: opacity2, transform: `scale(${(1 - 0.18 * inv).toFixed(4)})` };
      return { opacity: opacity2, transform: `scale(${(1 - 0.03 * inv).toFixed(4)})` };
    }
    const e = easeInCubic(p);
    const opacity = 1 - clamp01(p / 0.55);
    if (kind === "slide-left") return { opacity, transform: `translateX(${(-e * 0.22 * width).toFixed(2)}px)` };
    if (kind === "slide-up") return { opacity, transform: `translateY(${(-e * 0.2 * height).toFixed(2)}px)` };
    if (kind === "zoom") return { opacity, transform: `scale(${(1 + 0.22 * e).toFixed(4)})` };
    return { opacity, transform: `scale(${(1 + 0.03 * e).toFixed(4)})` };
  }
  var wordKey = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  async function mountFilm(stage, manifest) {
    stage.innerHTML = "";
    Object.assign(stage.style, {
      position: "relative",
      width: `${manifest.width}px`,
      height: `${manifest.height}px`,
      overflow: "hidden",
      background: manifest.palette.bg
    });
    const palette = resolvePalette(manifest.palette);
    const style = stylePackFor(manifest.style);
    const u = Math.min(manifest.width, manifest.height) / 1080;
    await Promise.all([loadFontFaces(manifest.fontFaces), loadFontStylesheets(manifest.fontCssUrls)]);
    const backdrop = createBackdrop(stage, manifest, palette, toRgbString);
    const burnCaptions = manifest.captionStyle === "burned" && manifest.captions.some((c) => c.burn !== false);
    const insetBottom = burnCaptions ? captionBand(manifest.width, manifest.height).reserve : 0;
    const mounted = manifest.scenes.map((scene, sceneIndex) => {
      const root = document.createElement("div");
      const template = createTemplate(scene.templateId);
      root.dataset.sceneId = scene.id;
      root.dataset.templateId = scene.templateId;
      root.dataset.style = style.id;
      const nextScene = manifest.scenes[sceneIndex + 1];
      const nextIn = nextScene?.transitionInSec ?? 0;
      if (nextScene && nextIn > 0 && !["cut", "push", "wipe"].includes(resolveTransition(style, sceneIndex + 1, nextScene.transition))) {
        const length = scene.end - scene.start;
        const settle = Math.max(0, ...template.marks(scene.props).filter((m) => m.type === "settle").map((m) => m.t));
        const exitAt = Math.max(length - nextIn, settle + 0.3);
        if (exitAt < length - 0.1) {
          root.dataset.exitAt = exitAt.toFixed(4);
          root.dataset.exitSec = (length - exitAt).toFixed(4);
        }
      }
      stage.appendChild(root);
      const ctx = {
        palette,
        fonts: manifest.fonts,
        width: manifest.width,
        height: manifest.height,
        durationSec: scene.end - scene.start,
        sceneIndex,
        insetBottom,
        style,
        rng: createSceneRng(scene.id)
      };
      template.mount(root, scene.props, ctx);
      const shownDisplay = root.style.display;
      root.dataset.display = shownDisplay;
      root.style.display = "none";
      root.style.position = "absolute";
      root.style.inset = "0";
      const transition = resolveTransition(style, sceneIndex, scene.transition);
      const stress = new Set((scene.emphasis?.words ?? []).flatMap((w) => w.split(/\s+/)).map(wordKey).filter(Boolean));
      const nodes = stress.size > 0 ? Array.from(root.querySelectorAll('[class$="-word"]')).filter((n) => stress.has(wordKey(n.textContent ?? ""))) : [];
      const emphasis = scene.emphasis && nodes.length > 0 ? { nodes, at: scene.emphasis.at } : null;
      return { id: scene.id, start: scene.start, end: scene.end, template, root, transitionIn: scene.transitionInSec ?? 0, transition, emphasis };
    });
    let grain = null;
    const GRAIN_TILE = 192;
    if (style.grain > 0) {
      const tile = document.createElement("canvas");
      tile.width = tile.height = GRAIN_TILE;
      const g = tile.getContext("2d");
      if (g) {
        const rng = createSceneRng("grain");
        const px = g.createImageData(GRAIN_TILE, GRAIN_TILE);
        for (let i = 0; i < px.data.length; i += 4) {
          const v = Math.floor(rng(`n`) * 256);
          px.data[i] = px.data[i + 1] = px.data[i + 2] = v;
          px.data[i + 3] = 255;
        }
        g.putImageData(px, 0, 0);
        grain = document.createElement("div");
        grain.className = "film-grain";
        Object.assign(grain.style, {
          position: "absolute",
          inset: `-${GRAIN_TILE}px`,
          backgroundImage: `url(${tile.toDataURL("image/png")})`,
          backgroundSize: `${GRAIN_TILE * u * 3}px ${GRAIN_TILE * u * 3}px`,
          opacity: String(style.grain),
          mixBlendMode: "overlay",
          pointerEvents: "none"
        });
        stage.appendChild(grain);
      }
    }
    const captionLayer = burnCaptions ? createCaptionLayer(stage, manifest, palette) : null;
    const images = Array.from(stage.querySelectorAll("img"));
    await Promise.all([
      document.fonts ? document.fonts.ready : Promise.resolve(),
      ...images.map(
        (img) => img.decode ? img.decode().catch(() => void 0) : new Promise((resolve) => {
          if (img.complete) resolve();
          else img.addEventListener("load", () => resolve(), { once: true });
        })
      )
    ]);
    let activeIds = /* @__PURE__ */ new Set();
    function seek(t) {
      backdrop.seek(t);
      captionLayer?.seek(t);
      if (grain) {
        const frame = Math.floor(Math.round(t * manifest.fps) / 3);
        grain.style.transform = `translate(${frame * 73 % GRAIN_TILE}px, ${frame * 131 % GRAIN_TILE}px)`;
      }
      const nextActive = /* @__PURE__ */ new Set();
      for (const [i, scene] of mounted.entries()) {
        const isActive = t >= scene.start && t < scene.end;
        if (isActive) {
          nextActive.add(scene.id);
          if (scene.root.style.display === "none") scene.root.style.display = scene.root.dataset.display ?? "";
          const localT = t - scene.start;
          let opacity = 1;
          let clipPath = "none";
          let filter = "none";
          const transforms = [];
          const apply = (c) => {
            opacity *= c.opacity;
            if (c.transform) transforms.push(c.transform);
            if (c.clipPath) clipPath = c.clipPath;
            if (c.filter) filter = c.filter;
          };
          if (scene.transitionIn > 0 && localT < scene.transitionIn) {
            apply(cutStyle(scene.transition, "in", clamp01(localT / scene.transitionIn), manifest.width, manifest.height, u));
          }
          const next = mounted[i + 1];
          if (next && next.transitionIn > 0 && t >= next.start) {
            apply(cutStyle(next.transition, "out", clamp01((t - next.start) / next.transitionIn), manifest.width, manifest.height, u));
          }
          if (style.camera > 0) {
            const p = clamp01(localT / Math.max(1e-3, scene.end - scene.start));
            const shrink = style.camera * (i % 2 === 0 ? 1 - p : p);
            if (shrink > 5e-5) transforms.push(`scale(${(1 - shrink).toFixed(5)})`);
          }
          scene.root.style.opacity = String(opacity);
          scene.root.style.clipPath = clipPath;
          scene.root.style.filter = filter;
          scene.root.style.transform = transforms.length > 0 ? transforms.join(" ") : "none";
          scene.template.seek(localT);
          if (scene.emphasis) {
            const since = localT - scene.emphasis.at;
            const pulse = since < 0 ? 0 : since < 0.1 ? since / 0.1 : Math.max(0, 1 - (since - 0.1) / 0.4);
            for (const node of scene.emphasis.nodes) {
              node.style.color = since >= 0 ? palette.accentText : "";
              if (pulse > 1e-3) node.style.transform = `scale(${(1 + 0.14 * pulse).toFixed(4)})`;
            }
          }
        } else if (activeIds.has(scene.id) && scene.root.style.display !== "none") {
          scene.root.style.display = "none";
        }
      }
      activeIds = nextActive;
    }
    const marks = manifest.scenes.flatMap((scene) => {
      const template = mounted.find((m) => m.id === scene.id).template;
      return template.marks(scene.props).map((m) => ({ t: scene.start + m.t, type: `${scene.id}:${m.type}` }));
    });
    return { seek, duration: manifest.duration, marks };
  }

  // src/film-entry.ts
  async function boot() {
    const params = new URLSearchParams(window.location.search);
    const manifestUrl = params.get("manifest");
    if (!manifestUrl) throw new Error("film.html requires ?manifest=<url>");
    const res = await fetch(manifestUrl);
    const manifest = await res.json();
    const stage = document.getElementById("stage");
    if (!stage) throw new Error("film.html is missing #stage");
    const handle = await mountFilm(stage, manifest);
    handle.seek(0);
    window.__film = {
      ready: true,
      duration: handle.duration,
      fps: manifest.fps,
      seek: handle.seek,
      marks: handle.marks
    };
    window.dispatchEvent(new CustomEvent("film:ready"));
  }
  boot().catch((err) => {
    console.error("[film-entry] boot failed", err);
    document.body.innerHTML = `<pre style="color:#f55;background:#111;padding:16px;white-space:pre-wrap">${String(err?.stack ?? err)}</pre>`;
  });
})();
//# sourceMappingURL=film-bundle.js.map
