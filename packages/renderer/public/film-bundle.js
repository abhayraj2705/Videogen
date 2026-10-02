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
  function spring(t, damping = 0.62, freq = 1.4) {
    const x = clamp01(t);
    if (x === 0) return 0;
    if (x === 1) return 1;
    const w0 = 2 * Math.PI * freq;
    const wd = w0 * Math.sqrt(1 - damping * damping);
    return 1 - Math.exp(-damping * w0 * x) * (Math.cos(wd * x) + damping * w0 / wd * Math.sin(wd * x));
  }
  var easeSpring = (t) => spring(t);
  var easeSpringSoft = (t) => spring(t, 0.78, 1.1);
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
  function wordsIn(words, t, start, each = 0.05, dur = 0.5, riseEm = 0.55) {
    for (let i = 0; i < words.length; i++) {
      const lin = clamp01((t - start - i * each) / dur);
      const s = spring(lin, 0.72, 1.1);
      const w = words[i];
      w.style.opacity = String(clamp01(lin * 2.5));
      w.style.transform = lin >= 1 ? "none" : `translateY(${((1 - s) * riseEm).toFixed(4)}em)`;
    }
  }
  function wordsSettle(count, start, each = 0.05, dur = 0.5) {
    return start + Math.max(0, count - 1) * each + dur;
  }
  function enter(node, t, start, dur, o = {}, extra = "") {
    const lin = clamp01((t - start) / dur);
    const inv = 1 - (o.ease ?? easeSpringSoft)(lin);
    node.style.opacity = String(clamp01(lin * 2.2));
    if (lin >= 1) {
      node.style.transform = extra || "none";
      return;
    }
    const scale = 1 - (1 - (o.scale ?? 1)) * inv;
    node.style.transform = `translate(${((o.x ?? 0) * inv).toFixed(2)}px, ${((o.y ?? 0) * inv).toFixed(2)}px) scale(${scale.toFixed(4)}) rotate(${((o.rotate ?? 0) * inv).toFixed(3)}deg) ${extra}`.trim();
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
    return {
      boxSizing: "border-box",
      background: ctx.palette.surface,
      border: `${Math.max(1, 1.5 * u)}px solid ${ctx.palette.border}`,
      borderRadius: `${radius * u}px`,
      boxShadow: `0 ${24 * u}px ${60 * u}px -${28 * u}px ${ctx.palette.glow}, 0 ${2 * u}px ${6 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.4 : 0.06})`
    };
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

  // ../film-runtime/src/templates/feature-triplet.ts
  var CARD_STAGGER = 0.14;
  var CARD_ENTER = 0.75;
  var settleFor = (count) => (count - 1) * CARD_STAGGER + CARD_ENTER;
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
        const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 52, portrait: 52, square: 40 }) * u, row ? 3 : 2, 22 * u);
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
            minHeight: row ? `${L.safe.height * 0.52}px` : "0",
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
          const badgeNode = el("div", "ft-icon", feature.icon ?? String(i + 1).padStart(2, "0"));
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
            fontSize: `${badge * (feature.icon ? 0.56 : 0.4)}px`,
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
        instance = { cards, horizontal: row, u, durationSec: ctx.durationSec };
      },
      seek(localT) {
        if (!instance) return;
        const { horizontal, u, cards, durationSec } = instance;
        const settled = settleFor(cards.length);
        const turn = Math.max(0.5, (durationSec - settled - 0.5) / cards.length);
        cards.forEach((card, i) => {
          const start = i * CARD_STAGGER;
          const local = localT - settled - 0.1 - i * turn;
          const spot = clamp01(local / 0.25) * clamp01((turn - local) / 0.25);
          card.ring.style.opacity = String(spot);
          const lift = spot > 0 ? `translateY(${(-10 * u * spot).toFixed(2)}px)` : "";
          enter(card.node, localT, start, CARD_ENTER, horizontal ? { y: 90 * u, scale: 0.9, rotate: (i - 1) * 4 } : { x: -110 * u, scale: 0.96 }, lift);
          card.bar.style.transform = scaleXTo(progress(localT, start + 0.3, start + 0.8, easeOutCubic));
        });
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: settleFor(props.features.length), type: "settle" }
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
    viewport.appendChild(image);
    wrap.appendChild(viewport);
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
          image.style.transform = zoom < 1e-4 ? "none" : `scale(${(1 + zoom).toFixed(4)})`;
          return 0;
        }
        const offset = travel * easeInOutCubic(clamp01(p));
        image.style.transform = offset < 5e-3 ? "none" : `translateY(${(-offset).toFixed(2)}px)`;
        return offset;
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
        instance = { frame, words: caption.words, durationSec: ctx.durationSec };
      },
      seek(localT) {
        if (!instance) return;
        instance.frame.enter(localT, 0, FRAME_ENTER);
        instance.frame.scroll(progress(localT, 1, Math.max(1.8, instance.durationSec - 0.5)));
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
          background: `linear-gradient(120deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
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
        const path = props.cursorPath && props.cursorPath.length > 0 ? props.cursorPath : DEFAULT_PATH;
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
        instance = { frame, cursor, ripples, words: caption.words, path, durationSec: ctx.durationSec };
      },
      seek(localT) {
        if (!instance) return;
        const { frame, cursor, ripples, path } = instance;
        frame.enter(localT, 0, FRAME_ENTER2);
        wordsIn(instance.words, localT, CAPTION_START2, WORD_EACH4, WORD_DUR5);
        frame.scroll(progress(localT, CURSOR_START + LEG_SEC + 0.3, Math.max(2.4, instance.durationSec - 0.6)), 0.45);
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
        instance = { rows, u };
      },
      seek(localT) {
        if (!instance) return;
        const { u } = instance;
        instance.rows.forEach(({ node, check, tick }, i) => {
          const start = i * ROW_STAGGER;
          enter(node, localT, start, ROW_DURATION, { x: -90 * u, scale: 0.96 });
          const pop = progress(localT, start + 0.2, start + 0.7, easeSpring);
          check.style.transform = localT >= start + 0.7 ? "none" : `scale(${(0.3 + 0.7 * pop).toFixed(4)})`;
          if (tick) tick.style.strokeDashoffset = (1 - progress(localT, start + 0.4, start + 0.75, easeOutCubic)).toFixed(4);
        });
      },
      marks(props) {
        const lastStart = (props.items.length - 1) * ROW_STAGGER;
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
  var settleFor2 = (count) => TILE_START + (count - 1) * TILE_STAGGER + TILE_ENTER;
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
          background: `linear-gradient(140deg, ${ctx.palette.accent}, ${ctx.palette.accentAlt})`,
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
        instance = { lead, titleWords: title.words, tiles, dots, horizontal: row, u };
      },
      seek(localT) {
        if (!instance) return;
        const { u, horizontal } = instance;
        enter(instance.lead, localT, 0, 0.8, { scale: 0.86, y: 40 * u });
        wordsIn(instance.titleWords, localT, 0.25, 0.06, 0.5);
        instance.tiles.forEach((tile, i) => {
          const start = TILE_START + i * TILE_STAGGER;
          enter(tile, localT, start, TILE_ENTER, horizontal ? { x: 120 * u, scale: 0.94 } : { y: 90 * u, scale: 0.94 });
          const pop = Math.min(1, Math.max(0, (localT - start - 0.25) / 0.45));
          instance.dots[i].style.transform = pop >= 1 ? "none" : `scale(${(0.2 + 0.8 * easeSpring(pop)).toFixed(4)})`;
        });
      },
      marks(props) {
        return [
          { t: 0, type: "start" },
          { t: settleFor2(props.items.length), type: "settle" }
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
    BentoGrid: createBentoGrid
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
    const strength = palette.isDark ? 1.5 : 1;
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
    layer.appendChild(grid);
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
    const cues = manifest.captions.map((cue) => {
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
  var AUTO_TRANSITIONS = ["zoom", "slide-left", "fade", "slide-up"];
  function cutStyle(kind, role, p, width, height) {
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
    await Promise.all([loadFontFaces(manifest.fontFaces), loadFontStylesheets(manifest.fontCssUrls)]);
    const backdrop = createBackdrop(stage, manifest, palette, toRgbString);
    const burnCaptions = manifest.captionStyle === "burned" && manifest.captions.length > 0;
    const insetBottom = burnCaptions ? captionBand(manifest.width, manifest.height).reserve : 0;
    const mounted = manifest.scenes.map((scene, sceneIndex) => {
      const root = document.createElement("div");
      root.dataset.sceneId = scene.id;
      root.dataset.templateId = scene.templateId;
      stage.appendChild(root);
      const template = createTemplate(scene.templateId);
      const ctx = {
        palette,
        fonts: manifest.fonts,
        width: manifest.width,
        height: manifest.height,
        durationSec: scene.end - scene.start,
        sceneIndex,
        insetBottom,
        rng: createSceneRng(scene.id)
      };
      template.mount(root, scene.props, ctx);
      const shownDisplay = root.style.display;
      root.dataset.display = shownDisplay;
      root.style.display = "none";
      root.style.position = "absolute";
      root.style.inset = "0";
      const transition = scene.transition ?? AUTO_TRANSITIONS[Math.max(0, sceneIndex - 1) % AUTO_TRANSITIONS.length];
      return { id: scene.id, start: scene.start, end: scene.end, template, root, transitionIn: scene.transitionInSec ?? 0, transition };
    });
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
      const nextActive = /* @__PURE__ */ new Set();
      for (const [i, scene] of mounted.entries()) {
        const isActive = t >= scene.start && t < scene.end;
        if (isActive) {
          nextActive.add(scene.id);
          if (scene.root.style.display === "none") scene.root.style.display = scene.root.dataset.display ?? "";
          const localT = t - scene.start;
          let opacity = 1;
          const transforms = [];
          if (scene.transitionIn > 0 && localT < scene.transitionIn) {
            const c = cutStyle(scene.transition, "in", clamp01(localT / scene.transitionIn), manifest.width, manifest.height);
            opacity *= c.opacity;
            transforms.push(c.transform);
          }
          const next = mounted[i + 1];
          if (next && next.transitionIn > 0 && t >= next.start) {
            const c = cutStyle(next.transition, "out", clamp01((t - next.start) / next.transitionIn), manifest.width, manifest.height);
            opacity *= c.opacity;
            transforms.push(c.transform);
          }
          scene.root.style.opacity = String(opacity);
          scene.root.style.transform = transforms.length > 0 ? transforms.join(" ") : "none";
          scene.template.seek(localT);
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
