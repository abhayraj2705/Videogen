import { registerTemplate, type SceneTemplate } from "@sitereel/film-runtime";

/**
 * Deliberately broken templates for QA's seeded-defect tests (Phase 4 exit
 * criterion: "QA catches seeded defects (planted overflow, planted
 * Math.random) 100% of the time"). Only bundled into the test entry
 * (seeded-entry.ts), never into the production film-bundle.js.
 */

function box(root: HTMLElement, bg: string) {
  Object.assign(root.style, { position: "absolute", inset: "0", background: bg, fontFamily: "sans-serif" });
}

/** Uses Math.random inside seek(): every re-seek of the same t paints differently. */
registerTemplate("__SeededRandomSeek", (): SceneTemplate<{ text: string }> => {
  let node: HTMLElement | undefined;
  return {
    id: "__SeededRandomSeek",
    mount(root, props, ctx) {
      box(root, ctx.palette.bg);
      node = document.createElement("div");
      node.textContent = props.text;
      Object.assign(node.style, { position: "absolute", left: "30%", top: "40%", fontSize: "40px", color: ctx.palette.fg });
      root.appendChild(node);
    },
    seek() {
      if (node) node.style.transform = `translate(${Math.round(Math.random() * 120)}px, ${Math.round(Math.random() * 60)}px)`;
    },
    marks: () => [{ t: 0.5, type: "settle" }],
  };
});

/** Uses Math.random once at mount: stable within a page, different on every load (the sneaky kind). */
registerTemplate("__SeededRandomMount", (): SceneTemplate<{ text: string }> => {
  return {
    id: "__SeededRandomMount",
    mount(root, props, ctx) {
      box(root, ctx.palette.bg);
      const node = document.createElement("div");
      node.textContent = props.text;
      Object.assign(node.style, {
        position: "absolute",
        left: `${20 + Math.random() * 30}%`,
        top: `${30 + Math.random() * 30}%`,
        fontSize: "40px",
        color: ctx.palette.fg,
      });
      root.appendChild(node);
    },
    seek() {},
    marks: () => [{ t: 0.5, type: "settle" }],
  };
});

/** Planted overflow: a non-wrapping headline far wider than the frame. */
registerTemplate("__SeededOverflow", (): SceneTemplate<{ text: string }> => {
  return {
    id: "__SeededOverflow",
    mount(root, props, ctx) {
      box(root, ctx.palette.bg);
      Object.assign(root.style, { display: "flex", alignItems: "center", justifyContent: "center" });
      const node = document.createElement("div");
      node.textContent = props.text;
      Object.assign(node.style, { whiteSpace: "nowrap", fontSize: `${ctx.height * 0.2}px`, fontWeight: "800", color: ctx.palette.fg });
      root.appendChild(node);
    },
    seek() {},
    marks: () => [{ t: 0.5, type: "settle" }],
  };
});

/** In frame, but hugging the edge: violates the title-safe margin. */
registerTemplate("__SeededUnsafe", (): SceneTemplate<{ text: string }> => {
  return {
    id: "__SeededUnsafe",
    mount(root, props, ctx) {
      box(root, ctx.palette.bg);
      const node = document.createElement("div");
      node.textContent = props.text;
      Object.assign(node.style, { position: "absolute", left: "4px", top: "4px", fontSize: "32px", color: ctx.palette.fg });
      root.appendChild(node);
    },
    seek() {},
    marks: () => [{ t: 0.5, type: "settle" }],
  };
});
