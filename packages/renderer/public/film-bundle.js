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

  // ../../packages/film-runtime/src/templates/kinetic-hook.ts
  function createKineticHook() {
    let instance;
    return {
      id: "KineticHook",
      mount(root, props, ctx) {
        setStyle(root, {
          position: "absolute",
          inset: "0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.display
        });
        const logoWrap = el("div", "kh-logo");
        setStyle(logoWrap, {
          width: `${ctx.height * 0.14}px`,
          height: `${ctx.height * 0.14}px`,
          marginBottom: `${ctx.height * 0.04}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
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
            color: ctx.palette.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: `${ctx.height * 0.08}px`,
            fontWeight: "700"
          });
          logoWrap.appendChild(fallback);
        }
        root.appendChild(logoWrap);
        const headlineWrap = el("div", "kh-headline");
        setStyle(headlineWrap, {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.3em",
          maxWidth: `${ctx.width * 0.8}px`
        });
        const lines = wrapText(props.headline, Math.round(ctx.width / 34), 2);
        const lineNodes = lines.map((line) => {
          const p = el("div", "kh-line", line);
          setStyle(p, {
            fontSize: `${ctx.height * 0.072}px`,
            fontWeight: "700",
            color: ctx.palette.fg,
            textAlign: "center",
            letterSpacing: "-0.01em",
            lineHeight: "1.15"
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
        instance.logoWrap.style.opacity = String(logoP);
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
          { t: 0.35 + words * 0.05 + 0.4, type: "settle" }
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
        setStyle(root, {
          position: "absolute",
          inset: "0",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: `${ctx.width * 0.03}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.body
        });
        const cards = props.features.map((feature) => {
          const card = el("div", "ft-card");
          setStyle(card, {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.5em",
            width: `${ctx.width * 0.24}px`,
            padding: `${ctx.height * 0.03}px`,
            borderRadius: "16px",
            background: ctx.palette.accent,
            textAlign: "center"
          });
          if (feature.icon) {
            const icon = el("div", "ft-icon", feature.icon);
            setStyle(icon, { fontSize: `${ctx.height * 0.06}px` });
            card.appendChild(icon);
          }
          const label = el("div", "ft-label", feature.label);
          setStyle(label, {
            fontSize: `${ctx.height * 0.032}px`,
            fontWeight: "600",
            color: ctx.palette.fg,
            lineHeight: "1.3"
          });
          card.appendChild(label);
          root.appendChild(card);
          return card;
        });
        instance = { cards };
      },
      seek(localT) {
        if (!instance) return;
        instance.cards.forEach((card, i) => {
          const start = i * CARD_STAGGER;
          const p = progress(localT, start, start + CARD_RISE_DURATION, easeOutCubic);
          applyReveal(card, p, 20);
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
        setStyle(root, {
          position: "absolute",
          inset: "0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${ctx.height * 0.025}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.body
        });
        const imageWrap = el("div", "ss-image-wrap");
        setStyle(imageWrap, {
          width: `${ctx.width * 0.78}px`,
          height: `${ctx.height * 0.6}px`,
          borderRadius: "14px",
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
        const lines = wrapText(props.caption, Math.round(ctx.width / 40), 1);
        captionWrap.textContent = lines[0] ?? "";
        setStyle(captionWrap, {
          fontSize: `${ctx.height * 0.04}px`,
          fontWeight: "600",
          color: ctx.palette.fg,
          textAlign: "center"
        });
        root.appendChild(captionWrap);
        instance = { imageWrap, image, captionWrap };
      },
      seek(localT) {
        if (!instance) return;
        const revealP = progress(localT, 0, 0.35, easeOutCubic);
        applyReveal(instance.imageWrap, revealP, 12);
        const kenburnsP = progress(localT, 0, 1);
        const scale = 1 + kenburnsP * 0.06;
        instance.image.style.transform = `scale(${scale})`;
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
        setStyle(root, {
          position: "absolute",
          inset: "0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${ctx.height * 0.02}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.display
        });
        const logoWrap = el("div", "cta-logo");
        setStyle(logoWrap, {
          width: `${ctx.height * 0.1}px`,
          height: `${ctx.height * 0.1}px`,
          marginBottom: `${ctx.height * 0.02}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
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
            color: ctx.palette.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: `${ctx.height * 0.055}px`,
            fontWeight: "700"
          });
          logoWrap.appendChild(fallback);
        }
        root.appendChild(logoWrap);
        const ctaNode = el("div", "cta-text", props.ctaText);
        setStyle(ctaNode, {
          fontSize: `${ctx.height * 0.06}px`,
          fontWeight: "700",
          color: ctx.palette.fg,
          textAlign: "center"
        });
        root.appendChild(ctaNode);
        const accentBar = el("div", "cta-accent");
        setStyle(accentBar, {
          height: "4px",
          width: "0px",
          background: ctx.palette.accent,
          borderRadius: "2px"
        });
        root.appendChild(accentBar);
        const domainNode = el("div", "cta-domain", props.domain);
        setStyle(domainNode, {
          fontSize: `${ctx.height * 0.032}px`,
          color: ctx.palette.accent,
          fontWeight: "500",
          letterSpacing: "0.02em"
        });
        root.appendChild(domainNode);
        instance = { logoWrap, ctaNode, domainNode, accentBar };
      },
      seek(localT) {
        if (!instance) return;
        const logoP = progress(localT, 0, 0.35, easeOutBack);
        instance.logoWrap.style.opacity = String(logoP);
        instance.logoWrap.style.transform = `scale(${0.7 + 0.3 * logoP})`;
        const ctaP = progress(localT, 0.15, 0.5, easeOutCubic);
        applyReveal(instance.ctaNode, ctaP, 14);
        const barP = progress(localT, 0.4, 0.65, easeOutCubic);
        instance.accentBar.style.width = `${barP * 64}px`;
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
        setStyle(root, {
          position: "absolute",
          inset: "0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: ctx.palette.bg
        });
        const size = ctx.height * 0.22;
        const wrap = el("div", "lr-logo");
        setStyle(wrap, {
          position: "relative",
          width: `${size}px`,
          height: `${size}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        });
        const ring = el("div", "lr-ring");
        setStyle(ring, {
          position: "absolute",
          inset: "0",
          borderRadius: "50%",
          border: `3px solid ${ctx.palette.accent}`
        });
        wrap.appendChild(ring);
        if (props.logoUrl) {
          const img = el("img");
          img.src = props.logoUrl;
          setStyle(img, { width: "55%", height: "55%", objectFit: "contain", position: "relative" });
          wrap.appendChild(img);
        } else {
          const fallback = el("div", "lr-fallback", props.productName.slice(0, 1).toUpperCase());
          setStyle(fallback, {
            fontSize: `${size * 0.4}px`,
            fontWeight: "700",
            color: ctx.palette.fg
          });
          wrap.appendChild(fallback);
        }
        root.appendChild(wrap);
        instance = { wrap, ring };
      },
      seek(localT) {
        if (!instance) return;
        const popP = progress(localT, 0, 0.45, easeOutBack);
        instance.wrap.style.opacity = String(popP);
        instance.wrap.style.transform = `scale(${0.5 + 0.5 * popP})`;
        const ringP = progress(localT, 0.1, 0.6);
        instance.ring.style.clipPath = `inset(0 ${100 - ringP * 100}% 0 0)`;
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
        setStyle(root, {
          position: "absolute",
          inset: "0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${ctx.height * 0.02}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.display,
          padding: `0 ${ctx.width * 0.1}px`
        });
        const accentBar = el("div", "hr-accent");
        setStyle(accentBar, {
          width: "0px",
          height: "4px",
          background: ctx.palette.accent,
          borderRadius: "2px",
          marginBottom: `${ctx.height * 0.015}px`
        });
        root.appendChild(accentBar);
        const headlineWrap = el("div", "hr-headline");
        setStyle(headlineWrap, { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25em" });
        const lines = wrapText(props.headline, Math.round(ctx.width / 30), 2);
        const lineNodes = lines.map((line) => {
          const node = el("div", "hr-line", line);
          setStyle(node, {
            fontSize: `${ctx.height * 0.062}px`,
            fontWeight: "700",
            color: ctx.palette.fg,
            textAlign: "center",
            lineHeight: "1.15"
          });
          headlineWrap.appendChild(node);
          return node;
        });
        root.appendChild(headlineWrap);
        const subNode = el("div", "hr-sub", props.subheadline);
        setStyle(subNode, {
          fontSize: `${ctx.height * 0.03}px`,
          color: ctx.palette.accent,
          fontFamily: ctx.fonts.body,
          textAlign: "center",
          maxWidth: `${ctx.width * 0.6}px`
        });
        root.appendChild(subNode);
        instance = { lineNodes, subNode, accentBar };
      },
      seek(localT) {
        if (!instance) return;
        const barP = progress(localT, 0, 0.3, easeOutCubic);
        instance.accentBar.style.width = `${barP * 56}px`;
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
          { t: 0.9, type: "settle" }
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
        setStyle(root, {
          position: "absolute",
          inset: "0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${ctx.height * 0.025}px`,
          background: ctx.palette.bg,
          fontFamily: ctx.fonts.body
        });
        const width = ctx.width * 0.76;
        const height = ctx.height * 0.58;
        const imageWrap = el("div", "uf-image-wrap");
        setStyle(imageWrap, {
          position: "relative",
          width: `${width}px`,
          height: `${height}px`,
          borderRadius: "14px",
          overflow: "hidden",
          boxShadow: "0 30px 60px -20px rgba(0,0,0,0.5)",
          border: `1px solid ${ctx.palette.accent}`
        });
        const img = el("img");
        img.src = props.screenshotUrl;
        setStyle(img, { width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" });
        imageWrap.appendChild(img);
        const cursor = el("div", "uf-cursor");
        const cursorSize = ctx.height * 0.022;
        setStyle(cursor, {
          position: "absolute",
          width: `${cursorSize}px`,
          height: `${cursorSize}px`,
          borderRadius: "50%",
          background: ctx.palette.accent,
          boxShadow: `0 0 0 6px ${ctx.palette.accent}33`,
          transform: "translate(-50%, -50%)"
        });
        imageWrap.appendChild(cursor);
        root.appendChild(imageWrap);
        const captionWrap = el("div", "uf-caption", props.caption);
        setStyle(captionWrap, {
          fontSize: `${ctx.height * 0.036}px`,
          fontWeight: "600",
          color: ctx.palette.fg,
          textAlign: "center"
        });
        root.appendChild(captionWrap);
        instance = { imageWrap, cursor, captionWrap, path: props.cursorPath ?? DEFAULT_PATH, width, height };
      },
      seek(localT) {
        if (!instance) return;
        const revealP = progress(localT, 0, 0.3, easeOutCubic);
        applyReveal(instance.imageWrap, revealP, 12);
        const capP = progress(localT, 0.15, 0.45, easeOutCubic);
        applyReveal(instance.captionWrap, capP, 10);
        const path = instance.path;
        const segments = path.length - 1;
        const t = progress(localT, 0.3, 1);
        const segF = t * segments;
        const segIdx = Math.min(segments - 1, Math.floor(segF));
        const localSegT = easeInOutCubic(segF - segIdx);
        const [x0, y0] = path[segIdx];
        const [x1, y1] = path[segIdx + 1] ?? path[segIdx];
        const x = lerp(x0, x1, localSegT) * instance.width;
        const y = lerp(y0, y1, localSegT) * instance.height;
        instance.cursor.style.opacity = t > 0 ? "1" : "0";
        instance.cursor.style.left = `${x}px`;
        instance.cursor.style.top = `${y}px`;
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
        setStyle(root, {
          position: "absolute",
          inset: "0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${ctx.height * 0.015}px`,
          background: ctx.palette.bg
        });
        const { numeric, prefix, suffix, decimals } = parseStatValue(props.value);
        const valueNode = el("div", "sc-value", numeric === null ? props.value : `${prefix}0${suffix}`);
        setStyle(valueNode, {
          fontSize: `${ctx.height * 0.16}px`,
          fontWeight: "800",
          color: ctx.palette.accent,
          fontFamily: ctx.fonts.display,
          letterSpacing: "-0.02em"
        });
        root.appendChild(valueNode);
        const labelNode = el("div", "sc-label", props.label);
        setStyle(labelNode, {
          fontSize: `${ctx.height * 0.034}px`,
          color: ctx.palette.fg,
          fontFamily: ctx.fonts.body,
          textAlign: "center"
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
          const current = instance.numericTarget * countP;
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
        setStyle(root, {
          position: "absolute",
          inset: "0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: `${ctx.height * 0.02}px`,
          background: ctx.palette.bg,
          padding: `0 ${ctx.width * 0.12}px`
        });
        const markNode = el("div", "qc-mark", "\u201C");
        setStyle(markNode, {
          fontSize: `${ctx.height * 0.1}px`,
          lineHeight: "1",
          color: ctx.palette.accent,
          fontFamily: ctx.fonts.display,
          fontWeight: "800"
        });
        root.appendChild(markNode);
        const quoteWrap = el("div", "qc-quote-wrap");
        setStyle(quoteWrap, { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3em", marginTop: `-${ctx.height * 0.04}px` });
        const lines = wrapText(props.quote, Math.round(ctx.width / 36), 3);
        const lineNodes = lines.map((line) => {
          const node = el("div", "qc-line", line);
          setStyle(node, {
            fontSize: `${ctx.height * 0.044}px`,
            fontWeight: "600",
            color: ctx.palette.fg,
            textAlign: "center",
            lineHeight: "1.25",
            fontFamily: ctx.fonts.display
          });
          quoteWrap.appendChild(node);
          return node;
        });
        root.appendChild(quoteWrap);
        const authorNode = el("div", "qc-author", props.author ?? "");
        setStyle(authorNode, {
          fontSize: `${ctx.height * 0.026}px`,
          color: ctx.palette.accent,
          fontFamily: ctx.fonts.body
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
          { t: 0.8, type: "settle" }
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
        setStyle(root, {
          position: "absolute",
          inset: "0",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: `${ctx.height * 0.028}px`,
          background: ctx.palette.bg,
          padding: `0 ${ctx.width * 0.16}px`
        });
        const rows = props.items.map((item) => {
          const row = el("div", "cl-row");
          setStyle(row, { display: "flex", alignItems: "center", gap: `${ctx.height * 0.02}px` });
          const check = el("div", "cl-check", "\u2713");
          const checkSize = ctx.height * 0.045;
          setStyle(check, {
            width: `${checkSize}px`,
            height: `${checkSize}px`,
            minWidth: `${checkSize}px`,
            borderRadius: "50%",
            background: ctx.palette.accent,
            color: ctx.palette.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: `${checkSize * 0.55}px`,
            fontWeight: "700"
          });
          row.appendChild(check);
          const label = el("div", "cl-label", item);
          setStyle(label, {
            fontSize: `${ctx.height * 0.038}px`,
            fontWeight: "600",
            color: ctx.palette.fg,
            fontFamily: ctx.fonts.body
          });
          row.appendChild(label);
          root.appendChild(row);
          return { check, label };
        });
        instance = { rows };
      },
      seek(localT) {
        if (!instance) return;
        instance.rows.forEach(({ check, label }, i) => {
          const start = i * ROW_STAGGER;
          const checkP = progress(localT, start, start + ROW_DURATION * 0.6, easeOutBack);
          check.style.opacity = String(checkP);
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

  // ../../packages/film-runtime/src/player.ts
  async function mountFilm(stage, manifest) {
    stage.innerHTML = "";
    Object.assign(stage.style, {
      position: "relative",
      width: `${manifest.width}px`,
      height: `${manifest.height}px`,
      overflow: "hidden",
      background: manifest.palette.bg
    });
    const mounted = manifest.scenes.map((scene) => {
      const root = document.createElement("div");
      root.dataset.sceneId = scene.id;
      root.dataset.templateId = scene.templateId;
      stage.appendChild(root);
      const template = createTemplate(scene.templateId);
      const ctx = {
        palette: manifest.palette,
        fonts: manifest.fonts,
        width: manifest.width,
        height: manifest.height,
        rng: createSceneRng(scene.id)
      };
      template.mount(root, scene.props, ctx);
      root.style.display = "none";
      root.style.position = "absolute";
      root.style.inset = "0";
      return { id: scene.id, start: scene.start, end: scene.end, template, root };
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
          if (scene.root.style.display === "none") scene.root.style.display = "";
          scene.template.seek(t - scene.start);
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
