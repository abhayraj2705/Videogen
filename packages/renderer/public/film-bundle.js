"use strict";
(() => {
  // ../../packages/film-runtime/src/util/easing.ts
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
  var easeOutBack = (t) => {
    const x = clamp01(t);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };
  var easeOutExpo = (t) => {
    const x = clamp01(t);
    return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
  };
  function progress(localT, start, end, ease = linear) {
    if (end <= start) return localT >= end ? 1 : 0;
    return ease(clamp01((localT - start) / (end - start)));
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // ../../packages/film-runtime/src/util/dom.ts
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
    node.style.transform = `translateY(${(1 - p) * riseDistancePx}px)`;
  }

  // ../../packages/film-runtime/src/util/text-fit.ts
  function wrapText(text, maxCharsPerLine, maxLines = 3) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxCharsPerLine && current) {
        lines.push(current);
        current = word;
        if (lines.length === maxLines - 1) {
          const rest = words.slice(words.indexOf(word)).join(" ");
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

  // ../../packages/film-runtime/src/util/layout.ts
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
  function layoutFor(ctx) {
    const orientation = orientationOf(ctx.width, ctx.height);
    const u = Math.min(ctx.width, ctx.height) / 1080;
    const safe = safeRect(ctx.width, ctx.height);
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

  // ../../packages/film-runtime/src/templates/kinetic-hook.ts
  function createKineticHook() {
    let instance;
    return {
      id: "KineticHook",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        setStyle(root, {
          position: "absolute",
          inset: "0",
          boxSizing: "border-box",
          padding: L.safePadding,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.display
        });
        const logoSize = L.pick({ landscape: 150, portrait: 220, square: 150 }) * u;
        const logoWrap = el("div", "kh-logo");
        setStyle(logoWrap, {
          width: `${logoSize}px`,
          height: `${logoSize}px`,
          marginBottom: `${L.pick({ landscape: 44, portrait: 72, square: 40 }) * u}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: "0"
        });
        if (props.logoUrl) {
          const img = el("img");
          img.src = props.logoUrl;
          setStyle(img, { width: "100%", height: "100%", objectFit: "contain" });
          logoWrap.appendChild(img);
        } else {
          const fallback = el("div", "kh-logo-fallback", props.productName.slice(0, 1).toUpperCase());
          setStyle(fallback, {
            width: "100%",
            height: "100%",
            borderRadius: "20%",
            background: ctx.palette.accent,
            color: ctx.palette.onAccent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: `${logoSize * 0.55}px`,
            fontWeight: "700"
          });
          logoWrap.appendChild(fallback);
        }
        root.appendChild(logoWrap);
        const textWidth = Math.min(L.safe.width, L.pick({ landscape: 1500, portrait: 1e3, square: 960 }) * u);
        const maxLines = L.pick({ landscape: 2, portrait: 4, square: 3 });
        const fontSize = fitFontSize(props.headline, textWidth, L.pick({ landscape: 84, portrait: 104, square: 80 }) * u, maxLines, 28 * u);
        const headlineWrap = el("div", "kh-headline");
        setStyle(headlineWrap, {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.12em",
          maxWidth: `${textWidth}px`
        });
        const lines = wrapText(props.headline, charsPerLine(textWidth, fontSize), maxLines);
        const lineNodes = lines.map((line) => {
          const p = el("div", "kh-line", line);
          setStyle(p, {
            ...WRAP_SAFE,
            fontSize: `${fontSize}px`,
            fontWeight: "700",
            color: ctx.palette.fg,
            textAlign: "center",
            letterSpacing: "-0.01em",
            lineHeight: "1.15",
            maxWidth: `${textWidth}px`
          });
          headlineWrap.appendChild(p);
          return p;
        });
        root.appendChild(headlineWrap);
        instance = { logoWrap, lineNodes };
      },
      seek(localT) {
        if (!instance) return;
        const logoP = progress(localT, 0, 0.5, easeOutBack);
        instance.logoWrap.style.opacity = String(Math.min(1, logoP));
        instance.logoWrap.style.transform = `scale(${0.6 + 0.4 * logoP})`;
        instance.lineNodes.forEach((node, i) => {
          const start = 0.35 + i * 0.18;
          const p = progress(localT, start, start + 0.35, easeOutCubic);
          applyReveal(node, p, 16);
        });
      },
      marks(props) {
        const words = props.headline.trim().split(/\s+/).length;
        return [
          { t: 0, type: "start" },
          { t: 0.35, type: "headline-begin" },
          { t: Math.max(1.25, 0.35 + words * 0.05 + 0.4), type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../../packages/film-runtime/src/templates/feature-triplet.ts
  var CARD_STAGGER = 0.2;
  var CARD_RISE_DURATION = 0.4;
  function createFeatureTriplet() {
    let instance;
    return {
      id: "FeatureTriplet",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const row = L.orientation === "landscape";
        const gap = L.pick({ landscape: 48, portrait: 36, square: 24 }) * u;
        setStyle(root, {
          position: "absolute",
          inset: "0",
          boxSizing: "border-box",
          padding: L.safePadding,
          display: "flex",
          flexDirection: row ? "row" : "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${gap}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.body
        });
        const pad = L.pick({ landscape: 40, portrait: 40, square: 28 }) * u;
        const cardWidth = row ? Math.min((L.safe.width - 2 * gap) / 3, 540 * u) : L.safe.width * L.pick({ landscape: 1, portrait: 1, square: 0.92 });
        const iconSize = L.pick({ landscape: 72, portrait: 76, square: 56 }) * u;
        const labelWidth = row ? cardWidth - 2 * pad : cardWidth - 2 * pad - (props.features.some((f) => f.icon) ? iconSize + pad * 0.8 : 0);
        const longest = props.features.reduce((a, f) => f.label.length > a.length ? f.label : a, "");
        const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 40, portrait: 50, square: 40 }) * u, row ? 3 : 2, 22 * u);
        const cards = props.features.map((feature) => {
          const card = el("div", "ft-card");
          setStyle(card, {
            boxSizing: "border-box",
            display: "flex",
            flexDirection: row ? "column" : "row",
            alignItems: "center",
            justifyContent: row ? "center" : "flex-start",
            gap: `${row ? pad * 0.5 : pad * 0.8}px`,
            width: `${cardWidth}px`,
            minHeight: row ? `${L.safe.height * 0.42}px` : "0",
            padding: `${pad}px`,
            borderRadius: `${20 * u}px`,
            background: ctx.palette.accent,
            textAlign: row ? "center" : "left"
          });
          if (feature.icon) {
            const icon = el("div", "ft-icon", feature.icon);
            setStyle(icon, { fontSize: `${iconSize}px`, lineHeight: "1", flexShrink: "0", width: row ? "auto" : `${iconSize}px`, textAlign: "center" });
            card.appendChild(icon);
          }
          const label = el("div", "ft-label", feature.label);
          setStyle(label, {
            ...WRAP_SAFE,
            fontSize: `${labelSize}px`,
            fontWeight: "600",
            color: ctx.palette.onAccent,
            lineHeight: "1.3",
            maxWidth: `${labelWidth}px`
          });
          card.appendChild(label);
          root.appendChild(card);
          return card;
        });
        instance = { cards, horizontal: row };
      },
      seek(localT) {
        if (!instance) return;
        const { horizontal } = instance;
        instance.cards.forEach((card, i) => {
          const start = i * CARD_STAGGER;
          const p = progress(localT, start, start + CARD_RISE_DURATION, easeOutCubic);
          if (horizontal) {
            applyReveal(card, p, 20);
          } else {
            card.style.opacity = String(p);
            card.style.transform = `translateX(${(1 - p) * -28}px)`;
          }
        });
      },
      marks(props) {
        const lastStart = (props.features.length - 1) * CARD_STAGGER;
        return [
          { t: 0, type: "start" },
          { t: lastStart + CARD_RISE_DURATION, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../../packages/film-runtime/src/templates/section-showcase.ts
  function createSectionShowcase() {
    let instance;
    return {
      id: "SectionShowcase",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const gap = L.pick({ landscape: 30, portrait: 48, square: 28 }) * u;
        setStyle(root, {
          position: "absolute",
          inset: "0",
          boxSizing: "border-box",
          padding: L.safePadding,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${gap}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.body
        });
        const captionWidth = L.safe.width * L.pick({ landscape: 0.8, portrait: 1, square: 0.95 });
        const maxLines = L.pick({ landscape: 2, portrait: 3, square: 2 });
        const fontSize = fitFontSize(props.caption, captionWidth, L.pick({ landscape: 46, portrait: 58, square: 44 }) * u, maxLines, 22 * u);
        const lines = wrapText(props.caption, charsPerLine(captionWidth, fontSize), maxLines);
        const captionHeight = lines.length * fontSize * 1.25;
        const imgW = L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 });
        const imgH = Math.min(L.safe.height - gap - captionHeight - 8 * u, L.pick({ landscape: 0.62 * ctx.height, portrait: 0.58 * ctx.height, square: 0.6 * ctx.height }));
        const imageWrap = el("div", "ss-image-wrap");
        setStyle(imageWrap, {
          boxSizing: "border-box",
          width: `${imgW}px`,
          height: `${imgH}px`,
          flexShrink: "0",
          borderRadius: `${16 * u}px`,
          overflow: "hidden",
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.5)",
          border: `1px solid ${ctx.palette.accent}`
        });
        const image = el("img");
        image.src = props.screenshotUrl;
        setStyle(image, {
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "top",
          transformOrigin: "center top"
        });
        imageWrap.appendChild(image);
        root.appendChild(imageWrap);
        const captionWrap = el("div", "ss-caption");
        setStyle(captionWrap, { display: "flex", flexDirection: "column", alignItems: "center", maxWidth: `${captionWidth}px` });
        for (const line of lines) {
          const node = el("div", "ss-caption-line", line);
          setStyle(node, {
            ...WRAP_SAFE,
            fontSize: `${fontSize}px`,
            fontWeight: "600",
            color: ctx.palette.fg,
            textAlign: "center",
            lineHeight: "1.25"
          });
          captionWrap.appendChild(node);
        }
        root.appendChild(captionWrap);
        instance = { imageWrap, image, captionWrap };
      },
      seek(localT) {
        if (!instance) return;
        const revealP = progress(localT, 0, 0.35, easeOutCubic);
        applyReveal(instance.imageWrap, revealP, 12);
        const kenburnsP = progress(localT, 0, 6);
        instance.image.style.transform = `scale(${1 + kenburnsP * 0.06})`;
        const capP = progress(localT, 0.15, 0.5, easeOutCubic);
        applyReveal(instance.captionWrap, capP, 10);
      },
      marks() {
        return [
          { t: 0, type: "start" },
          { t: 0.5, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../../packages/film-runtime/src/templates/cta-end-card.ts
  function createCTAEndCard() {
    let instance;
    return {
      id: "CTAEndCard",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        setStyle(root, {
          position: "absolute",
          inset: "0",
          boxSizing: "border-box",
          padding: L.safePadding,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${L.pick({ landscape: 24, portrait: 36, square: 22 }) * u}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.display
        });
        const logoSize = L.pick({ landscape: 112, portrait: 168, square: 112 }) * u;
        const logoWrap = el("div", "cta-logo");
        setStyle(logoWrap, {
          width: `${logoSize}px`,
          height: `${logoSize}px`,
          marginBottom: `${20 * u}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: "0"
        });
        if (props.logoUrl) {
          const img = el("img");
          img.src = props.logoUrl;
          setStyle(img, { width: "100%", height: "100%", objectFit: "contain" });
          logoWrap.appendChild(img);
        } else {
          const fallback = el("div", "cta-logo-fallback", props.productName.slice(0, 1).toUpperCase());
          setStyle(fallback, {
            width: "100%",
            height: "100%",
            borderRadius: "20%",
            background: ctx.palette.accent,
            color: ctx.palette.onAccent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: `${logoSize * 0.55}px`,
            fontWeight: "700"
          });
          logoWrap.appendChild(fallback);
        }
        root.appendChild(logoWrap);
        const ctaWidth = Math.min(L.safe.width, 1400 * u);
        const ctaLines = L.pick({ landscape: 2, portrait: 3, square: 2 });
        const ctaSize = fitFontSize(props.ctaText, ctaWidth, L.pick({ landscape: 72, portrait: 92, square: 70 }) * u, ctaLines, 28 * u);
        const ctaNode = el("div", "cta-text");
        setStyle(ctaNode, { display: "flex", flexDirection: "column", alignItems: "center", maxWidth: `${ctaWidth}px` });
        for (const line of wrapText(props.ctaText, charsPerLine(ctaWidth, ctaSize), ctaLines)) {
          const n = el("div", "cta-line", line);
          setStyle(n, { ...WRAP_SAFE, fontSize: `${ctaSize}px`, fontWeight: "700", color: ctx.palette.fg, textAlign: "center", lineHeight: "1.15" });
          ctaNode.appendChild(n);
        }
        root.appendChild(ctaNode);
        const barWidth = L.pick({ landscape: 72, portrait: 96, square: 72 }) * u;
        const accentBar = el("div", "cta-accent");
        setStyle(accentBar, {
          height: `${5 * u}px`,
          width: "0px",
          background: ctx.palette.accent,
          borderRadius: `${3 * u}px`,
          flexShrink: "0"
        });
        root.appendChild(accentBar);
        const domainSize = fitFontSize(props.domain, L.safe.width, L.pick({ landscape: 36, portrait: 46, square: 36 }) * u, 1, 18 * u);
        const domainNode = el("div", "cta-domain", props.domain);
        setStyle(domainNode, {
          ...WRAP_SAFE,
          fontSize: `${domainSize}px`,
          color: ctx.palette.accentText,
          fontWeight: "500",
          letterSpacing: "0.02em",
          maxWidth: `${L.safe.width}px`,
          textAlign: "center"
        });
        root.appendChild(domainNode);
        instance = { logoWrap, ctaNode, domainNode, accentBar, barWidth };
      },
      seek(localT) {
        if (!instance) return;
        const logoP = progress(localT, 0, 0.35, easeOutBack);
        instance.logoWrap.style.opacity = String(Math.min(1, logoP));
        instance.logoWrap.style.transform = `scale(${0.7 + 0.3 * logoP})`;
        const ctaP = progress(localT, 0.15, 0.5, easeOutCubic);
        applyReveal(instance.ctaNode, ctaP, 14);
        const barP = progress(localT, 0.4, 0.65, easeOutCubic);
        instance.accentBar.style.width = `${barP * instance.barWidth}px`;
        const domainP = progress(localT, 0.5, 0.8, easeOutCubic);
        applyReveal(instance.domainNode, domainP, 10);
      },
      marks() {
        return [
          { t: 0, type: "start" },
          { t: 0.8, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../../packages/film-runtime/src/templates/logo-reveal.ts
  function createLogoReveal() {
    let instance;
    return {
      id: "LogoReveal",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        setStyle(root, {
          position: "absolute",
          inset: "0",
          boxSizing: "border-box",
          padding: L.safePadding,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${L.pick({ landscape: 36, portrait: 56, square: 36 }) * u}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.display
        });
        const size = L.pick({ landscape: 260, portrait: 360, square: 280 }) * u;
        const wrap = el("div", "lr-logo");
        setStyle(wrap, {
          position: "relative",
          width: `${size}px`,
          height: `${size}px`,
          flexShrink: "0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        });
        const ring = el("div", "lr-ring");
        setStyle(ring, {
          position: "absolute",
          inset: "0",
          borderRadius: "50%",
          border: `${Math.max(3, 5 * u)}px solid ${ctx.palette.accent}`
        });
        wrap.appendChild(ring);
        if (props.logoUrl) {
          const img = el("img");
          img.src = props.logoUrl;
          setStyle(img, { width: "55%", height: "55%", objectFit: "contain", position: "relative" });
          wrap.appendChild(img);
        } else {
          const fallback = el("div", "lr-fallback", props.productName.slice(0, 1).toUpperCase());
          setStyle(fallback, { fontSize: `${size * 0.4}px`, fontWeight: "700", color: ctx.palette.fg });
          wrap.appendChild(fallback);
        }
        root.appendChild(wrap);
        const nameSize = fitFontSize(props.productName, L.safe.width, L.pick({ landscape: 60, portrait: 76, square: 60 }) * u, 2, 24 * u);
        const wordmark = el("div", "lr-wordmark", props.productName);
        setStyle(wordmark, {
          ...WRAP_SAFE,
          fontSize: `${nameSize}px`,
          fontWeight: "700",
          color: ctx.palette.fg,
          textAlign: "center",
          maxWidth: `${L.safe.width}px`,
          letterSpacing: "-0.01em"
        });
        root.appendChild(wordmark);
        instance = { wrap, ring, wordmark };
      },
      seek(localT) {
        if (!instance) return;
        const popP = progress(localT, 0, 0.45, easeOutBack);
        instance.wrap.style.opacity = String(Math.min(1, popP));
        instance.wrap.style.transform = `scale(${0.5 + 0.5 * popP})`;
        const ringP = progress(localT, 0.1, 0.6);
        instance.ring.style.clipPath = `inset(0 ${100 - ringP * 100}% 0 0)`;
        applyReveal(instance.wordmark, progress(localT, 0.3, 0.6, easeOutCubic), 12);
      },
      marks() {
        return [
          { t: 0, type: "start" },
          { t: 0.6, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../../packages/film-runtime/src/templates/hero-rebuild.ts
  function createHeroRebuild() {
    let instance;
    return {
      id: "HeroRebuild",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const align = L.orientation === "portrait" ? "flex-start" : "center";
        const textAlign = L.orientation === "portrait" ? "left" : "center";
        setStyle(root, {
          position: "absolute",
          inset: "0",
          boxSizing: "border-box",
          padding: L.safePadding,
          display: "flex",
          flexDirection: "column",
          alignItems: align,
          justifyContent: "center",
          gap: `${L.pick({ landscape: 24, portrait: 36, square: 22 }) * u}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.display
        });
        const barWidth = L.pick({ landscape: 64, portrait: 96, square: 64 }) * u;
        const accentBar = el("div", "hr-accent");
        setStyle(accentBar, {
          width: "0px",
          height: `${5 * u}px`,
          background: ctx.palette.accent,
          borderRadius: `${3 * u}px`,
          flexShrink: "0"
        });
        root.appendChild(accentBar);
        const textWidth = Math.min(L.safe.width, L.pick({ landscape: 1500, portrait: 1e3, square: 960 }) * u);
        const maxLines = L.pick({ landscape: 2, portrait: 4, square: 3 });
        const size = fitFontSize(props.headline, textWidth, L.pick({ landscape: 76, portrait: 96, square: 72 }) * u, maxLines, 28 * u);
        const headlineWrap = el("div", "hr-headline");
        setStyle(headlineWrap, { display: "flex", flexDirection: "column", alignItems: align, gap: "0.1em", maxWidth: `${textWidth}px` });
        const lineNodes = wrapText(props.headline, charsPerLine(textWidth, size), maxLines).map((line) => {
          const node = el("div", "hr-line", line);
          setStyle(node, { ...WRAP_SAFE, fontSize: `${size}px`, fontWeight: "700", color: ctx.palette.fg, textAlign, lineHeight: "1.15" });
          headlineWrap.appendChild(node);
          return node;
        });
        root.appendChild(headlineWrap);
        const subWidth = Math.min(L.safe.width, L.pick({ landscape: 1100, portrait: 1e3, square: 900 }) * u);
        const subSize = fitFontSize(props.subheadline, subWidth, L.pick({ landscape: 36, portrait: 44, square: 34 }) * u, 3, 20 * u);
        const subNode = el("div", "hr-sub", props.subheadline);
        setStyle(subNode, {
          ...WRAP_SAFE,
          fontSize: `${subSize}px`,
          color: ctx.palette.accentText,
          fontFamily: ctx.fonts.body,
          textAlign,
          lineHeight: "1.35",
          maxWidth: `${subWidth}px`
        });
        root.appendChild(subNode);
        instance = { lineNodes, subNode, accentBar, barWidth };
      },
      seek(localT) {
        if (!instance) return;
        const barP = progress(localT, 0, 0.3, easeOutCubic);
        instance.accentBar.style.width = `${barP * instance.barWidth}px`;
        instance.lineNodes.forEach((node, i) => {
          const start = 0.2 + i * 0.15;
          applyReveal(node, progress(localT, start, start + 0.35, easeOutCubic), 18);
        });
        const subStart = 0.2 + instance.lineNodes.length * 0.15 + 0.15;
        applyReveal(instance.subNode, progress(localT, subStart, subStart + 0.35, easeOutCubic), 12);
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

  // ../../packages/film-runtime/src/templates/ui-flow-cursor.ts
  var DEFAULT_PATH = [
    [0.25, 0.35],
    [0.6, 0.5],
    [0.45, 0.7]
  ];
  function createUIFlowCursor() {
    let instance;
    return {
      id: "UIFlowCursor",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const gap = L.pick({ landscape: 30, portrait: 44, square: 28 }) * u;
        setStyle(root, {
          position: "absolute",
          inset: "0",
          boxSizing: "border-box",
          padding: L.safePadding,
          display: "flex",
          flexDirection: L.orientation === "portrait" ? "column-reverse" : "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${gap}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.body
        });
        const captionWidth = L.safe.width * L.pick({ landscape: 0.8, portrait: 1, square: 0.95 });
        const maxLines = L.pick({ landscape: 2, portrait: 3, square: 2 });
        const fontSize = fitFontSize(props.caption, captionWidth, L.pick({ landscape: 42, portrait: 56, square: 42 }) * u, maxLines, 22 * u);
        const lines = wrapText(props.caption, charsPerLine(captionWidth, fontSize), maxLines);
        const captionHeight = lines.length * fontSize * 1.25;
        const width = L.safe.width * L.pick({ landscape: 0.82, portrait: 1, square: 0.96 });
        const height = Math.min(L.safe.height - gap - captionHeight - 8 * u, L.pick({ landscape: 0.6 * ctx.height, portrait: 0.56 * ctx.height, square: 0.6 * ctx.height }));
        const imageWrap = el("div", "uf-image-wrap");
        setStyle(imageWrap, {
          boxSizing: "border-box",
          position: "relative",
          width: `${width}px`,
          height: `${height}px`,
          flexShrink: "0",
          borderRadius: `${16 * u}px`,
          overflow: "hidden",
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.5)",
          border: `1px solid ${ctx.palette.accent}`
        });
        const img = el("img");
        img.src = props.screenshotUrl;
        setStyle(img, { width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" });
        imageWrap.appendChild(img);
        const cursor = el("div", "uf-cursor");
        const cursorSize = 26 * u;
        setStyle(cursor, {
          position: "absolute",
          width: `${cursorSize}px`,
          height: `${cursorSize}px`,
          borderRadius: "50%",
          background: ctx.palette.accent,
          boxShadow: `0 0 0 ${7 * u}px rgba(127,127,127,0.25)`,
          transform: "translate(-50%, -50%)"
        });
        imageWrap.appendChild(cursor);
        root.appendChild(imageWrap);
        const captionWrap = el("div", "uf-caption");
        setStyle(captionWrap, { display: "flex", flexDirection: "column", alignItems: "center", maxWidth: `${captionWidth}px` });
        for (const line of lines) {
          const node = el("div", "uf-caption-line", line);
          setStyle(node, { ...WRAP_SAFE, fontSize: `${fontSize}px`, fontWeight: "600", color: ctx.palette.fg, textAlign: "center", lineHeight: "1.25" });
          captionWrap.appendChild(node);
        }
        root.appendChild(captionWrap);
        instance = { imageWrap, cursor, captionWrap, path: props.cursorPath ?? DEFAULT_PATH, width, height };
      },
      seek(localT) {
        if (!instance) return;
        applyReveal(instance.imageWrap, progress(localT, 0, 0.3, easeOutCubic), 12);
        applyReveal(instance.captionWrap, progress(localT, 0.15, 0.45, easeOutCubic), 10);
        const path = instance.path;
        const segments = Math.max(1, path.length - 1);
        const t = progress(localT, 0.3, 3);
        const segF = t * segments;
        const segIdx = Math.min(segments - 1, Math.floor(segF));
        const localSegT = easeInOutCubic(segF - segIdx);
        const [x0, y0] = path[segIdx];
        const [x1, y1] = path[segIdx + 1] ?? path[segIdx];
        instance.cursor.style.opacity = t > 0 ? "1" : "0";
        instance.cursor.style.left = `${lerp(x0, x1, localSegT) * instance.width}px`;
        instance.cursor.style.top = `${lerp(y0, y1, localSegT) * instance.height}px`;
      },
      marks() {
        return [
          { t: 0, type: "start" },
          { t: 0.45, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../../packages/film-runtime/src/templates/stat-counter.ts
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
        setStyle(root, {
          position: "absolute",
          inset: "0",
          boxSizing: "border-box",
          padding: L.safePadding,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${L.pick({ landscape: 16, portrait: 28, square: 16 }) * u}px`,
          background: ctx.palette.bg
        });
        const { numeric, prefix, suffix, decimals } = parseStatValue(props.value);
        const finalText = numeric === null ? props.value : `${prefix}${formatCounted(numeric, decimals)}${suffix}`;
        const maxValue = L.pick({ landscape: 190, portrait: 230, square: 180 }) * u;
        const valueSize = Math.min(maxValue, L.safe.width * 0.95 / (Math.max(1, finalText.length) * 0.66));
        const valueNode = el("div", "sc-value", numeric === null ? props.value : `${prefix}0${suffix}`);
        setStyle(valueNode, {
          fontSize: `${valueSize}px`,
          fontWeight: "800",
          color: ctx.palette.accentText,
          fontFamily: ctx.fonts.display,
          letterSpacing: "-0.02em",
          lineHeight: "1.05",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          textAlign: "center"
        });
        root.appendChild(valueNode);
        const labelWidth = Math.min(L.safe.width, 1200 * u);
        const labelSize = fitFontSize(props.label, labelWidth, L.pick({ landscape: 42, portrait: 54, square: 40 }) * u, 3, 22 * u);
        const labelNode = el("div", "sc-label", props.label);
        setStyle(labelNode, {
          ...WRAP_SAFE,
          fontSize: `${labelSize}px`,
          color: ctx.palette.fg,
          fontFamily: ctx.fonts.body,
          textAlign: "center",
          lineHeight: "1.3",
          maxWidth: `${labelWidth}px`
        });
        root.appendChild(labelNode);
        instance = { valueNode, labelNode, numericTarget: numeric, prefix, suffix, decimals };
      },
      seek(localT) {
        if (!instance) return;
        const revealP = progress(localT, 0, 0.2, easeOutExpo);
        instance.valueNode.style.opacity = String(revealP);
        if (instance.numericTarget !== null) {
          const countP = progress(localT, 0.1, 0.75, easeOutExpo);
          const current = countP >= 1 ? instance.numericTarget : instance.numericTarget * countP;
          instance.valueNode.textContent = `${instance.prefix}${formatCounted(current, instance.decimals)}${instance.suffix}`;
        }
        applyReveal(instance.labelNode, progress(localT, 0.35, 0.65), 10);
      },
      marks() {
        return [
          { t: 0, type: "start" },
          { t: 0.75, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../../packages/film-runtime/src/templates/quote-card.ts
  function createQuoteCard() {
    let instance;
    return {
      id: "QuoteCard",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        const portrait = L.orientation === "portrait";
        const align = portrait ? "flex-start" : "center";
        const textAlign = portrait ? "left" : "center";
        setStyle(root, {
          position: "absolute",
          inset: "0",
          boxSizing: "border-box",
          padding: L.safePadding,
          display: "flex",
          flexDirection: "column",
          alignItems: align,
          justifyContent: "center",
          gap: `${L.pick({ landscape: 20, portrait: 32, square: 20 }) * u}px`,
          background: ctx.palette.bg
        });
        const markSize = L.pick({ landscape: 140, portrait: 190, square: 130 }) * u;
        const markNode = el("div", "qc-mark", "\u201C");
        setStyle(markNode, {
          fontSize: `${markSize}px`,
          lineHeight: "0.8",
          height: `${markSize * 0.5}px`,
          color: ctx.palette.accentText,
          fontFamily: ctx.fonts.display,
          fontWeight: "800"
        });
        root.appendChild(markNode);
        const textWidth = Math.min(L.safe.width, L.pick({ landscape: 1400, portrait: 1e3, square: 940 }) * u);
        const maxLines = L.pick({ landscape: 3, portrait: 5, square: 4 });
        const size = fitFontSize(props.quote, textWidth, L.pick({ landscape: 54, portrait: 66, square: 50 }) * u, maxLines, 22 * u);
        const quoteWrap = el("div", "qc-quote-wrap");
        setStyle(quoteWrap, { display: "flex", flexDirection: "column", alignItems: align, gap: "0.15em", maxWidth: `${textWidth}px` });
        const lineNodes = wrapText(props.quote, charsPerLine(textWidth, size), maxLines).map((line) => {
          const node = el("div", "qc-line", line);
          setStyle(node, { ...WRAP_SAFE, fontSize: `${size}px`, fontWeight: "600", color: ctx.palette.fg, textAlign, lineHeight: "1.25", fontFamily: ctx.fonts.display });
          quoteWrap.appendChild(node);
          return node;
        });
        root.appendChild(quoteWrap);
        const authorNode = el("div", "qc-author", props.author ? `\u2014 ${props.author}` : "");
        setStyle(authorNode, {
          ...WRAP_SAFE,
          fontSize: `${L.pick({ landscape: 32, portrait: 40, square: 30 }) * u}px`,
          color: ctx.palette.accentText,
          fontFamily: ctx.fonts.body,
          maxWidth: `${textWidth}px`,
          textAlign
        });
        root.appendChild(authorNode);
        instance = { markNode, lineNodes, authorNode };
      },
      seek(localT) {
        if (!instance) return;
        applyReveal(instance.markNode, progress(localT, 0, 0.25, easeOutCubic), 8);
        instance.lineNodes.forEach((node, i) => {
          const start = 0.15 + i * 0.12;
          applyReveal(node, progress(localT, start, start + 0.3, easeOutCubic), 10);
        });
        const authorStart = 0.15 + instance.lineNodes.length * 0.12 + 0.1;
        applyReveal(instance.authorNode, progress(localT, authorStart, authorStart + 0.3, easeOutCubic), 8);
      },
      marks() {
        return [
          { t: 0, type: "start" },
          { t: 1.2, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../../packages/film-runtime/src/templates/checklist-reveal.ts
  var ROW_STAGGER = 0.22;
  var ROW_DURATION = 0.4;
  function createChecklistReveal() {
    let instance;
    return {
      id: "ChecklistReveal",
      mount(root, props, ctx) {
        const L = layoutFor(ctx);
        const u = L.u;
        setStyle(root, {
          position: "absolute",
          inset: "0",
          boxSizing: "border-box",
          padding: L.safePadding,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: ctx.palette.bg
        });
        const listWidth = Math.min(L.safe.width, L.pick({ landscape: 1200, portrait: 1e3, square: 940 }) * u);
        const list = el("div", "cl-list");
        setStyle(list, {
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: `${L.pick({ landscape: 30, portrait: 48, square: 26 }) * u}px`,
          width: `${listWidth}px`
        });
        root.appendChild(list);
        const checkSize = L.pick({ landscape: 52, portrait: 64, square: 48 }) * u;
        const rowGap = 24 * u;
        const labelWidth = listWidth - checkSize - rowGap;
        const longest = props.items.reduce((a, s) => s.length > a.length ? s : a, "");
        const labelSize = fitFontSize(longest, labelWidth, L.pick({ landscape: 44, portrait: 54, square: 40 }) * u, 2, 22 * u);
        const rows = props.items.map((item) => {
          const row = el("div", "cl-row");
          setStyle(row, { display: "flex", alignItems: "center", gap: `${rowGap}px`, maxWidth: `${listWidth}px` });
          const check = el("div", "cl-check", "\u2713");
          setStyle(check, {
            width: `${checkSize}px`,
            height: `${checkSize}px`,
            minWidth: `${checkSize}px`,
            borderRadius: "50%",
            background: ctx.palette.accent,
            color: ctx.palette.onAccent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: `${checkSize * 0.55}px`,
            fontWeight: "700"
          });
          row.appendChild(check);
          const label = el("div", "cl-label", item);
          setStyle(label, {
            ...WRAP_SAFE,
            fontSize: `${labelSize}px`,
            fontWeight: "600",
            color: ctx.palette.fg,
            fontFamily: ctx.fonts.body,
            lineHeight: "1.3",
            maxWidth: `${labelWidth}px`
          });
          row.appendChild(label);
          list.appendChild(row);
          return { check, label };
        });
        instance = { rows };
      },
      seek(localT) {
        if (!instance) return;
        instance.rows.forEach(({ check, label }, i) => {
          const start = i * ROW_STAGGER;
          const checkP = progress(localT, start, start + ROW_DURATION * 0.6, easeOutBack);
          check.style.opacity = String(Math.min(1, checkP));
          check.style.transform = `scale(${0.4 + 0.6 * checkP})`;
          applyReveal(label, progress(localT, start, start + ROW_DURATION, easeOutCubic), 12);
        });
      },
      marks(props) {
        const lastStart = (props.items.length - 1) * ROW_STAGGER;
        return [
          { t: 0, type: "start" },
          { t: lastStart + ROW_DURATION, type: "settle" }
        ];
      },
      unmount() {
        instance = void 0;
      }
    };
  }

  // ../../packages/film-runtime/src/registry.ts
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
    ChecklistReveal: createChecklistReveal
  };
  function createTemplate(templateId) {
    const factory = TEMPLATE_REGISTRY[templateId];
    if (!factory) {
      throw new Error(`Unknown template id: ${templateId}. Known: ${Object.keys(TEMPLATE_REGISTRY).join(", ")}`);
    }
    return factory();
  }

  // ../../packages/film-runtime/src/util/rng.ts
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

  // ../../packages/film-runtime/src/util/color.ts
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

  // ../../packages/film-runtime/src/player.ts
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
    return { ...p, accentText, onAccent: onAccent === bg ? p.bg : onAccent === fg ? p.fg : onAccent };
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
    const mounted = manifest.scenes.map((scene) => {
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
        rng: createSceneRng(scene.id)
      };
      template.mount(root, scene.props, ctx);
      const shownDisplay = root.style.display;
      root.dataset.display = shownDisplay;
      root.style.display = "none";
      root.style.position = "absolute";
      root.style.inset = "0";
      return { id: scene.id, start: scene.start, end: scene.end, template, root, transitionIn: scene.transitionInSec ?? 0 };
    });
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
      const nextActive = /* @__PURE__ */ new Set();
      for (const scene of mounted) {
        const isActive = t >= scene.start && t < scene.end;
        if (isActive) {
          nextActive.add(scene.id);
          if (scene.root.style.display === "none") scene.root.style.display = scene.root.dataset.display ?? "";
          const localT = t - scene.start;
          scene.root.style.opacity = scene.transitionIn > 0 ? String(clamp01(localT / scene.transitionIn)) : "1";
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

  // ../../packages/renderer/src/film-entry.ts
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
