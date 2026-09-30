"use strict";
(() => {
  // ../film-runtime/src/util/easing.ts
  var clamp01 = (t) => Math.min(1, Math.max(0, t));
  var linear = (t) => clamp01(t);
  var easeOutCubic = (t) => {
    const x = clamp01(t);
    return 1 - Math.pow(1 - x, 3);
  };
  var easeOutBack = (t) => {
    const x = clamp01(t);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };
  function progress(localT, start, end, ease = linear) {
    if (end <= start) return localT >= end ? 1 : 0;
    return ease(clamp01((localT - start) / (end - start)));
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
    node.style.transform = `translateY(${(1 - p) * riseDistancePx}px)`;
  }

  // ../film-runtime/src/util/text-fit.ts
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

  // ../film-runtime/src/templates/kinetic-hook.ts
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

  // ../film-runtime/src/templates/feature-triplet.ts
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

  // ../film-runtime/src/templates/section-showcase.ts
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

  // ../film-runtime/src/templates/cta-end-card.ts
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

  // ../film-runtime/src/registry.ts
  var TEMPLATE_REGISTRY = {
    KineticHook: createKineticHook,
    FeatureTriplet: createFeatureTriplet,
    SectionShowcase: createSectionShowcase,
    CTAEndCard: createCTAEndCard
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

  // ../film-runtime/src/player.ts
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
