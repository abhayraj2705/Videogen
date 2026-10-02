import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";

import { sceneRoot, wordsIn, wordsSettle } from "../util/ui.js";

export interface KineticTypeProps {
  /** One short, strong line (3-8 words). Grounded. */
  text: string;
}

interface Line {
  words: HTMLElement[];
  start: number;
}

interface Instance {
  lines: Line[];
}

const FIRST_LINE = 0.1;
const LINE_EACH = 0.26;
const WORD_EACH = 0.06;
const WORD_DUR = 0.45;
/** Advance width of a heavy sans glyph in ems — generous, so a line of wide letters still fits the frame. */
const ADVANCE_EM = 0.64;

/** Splits the text into the lines the poster will set, the same way for mount() and marks(). */
function linesOf(text: string, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const target = Math.max(1, Math.min(maxLines, Math.ceil(words.length / 2)));
  const ideal = words.join(" ").length / target;
  // Fill each row to about the ideal length; the last row takes whatever is left, so no word is ever dropped.
  const rows: string[] = [];
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

const settleOf = (text: string) => {
  // marks() has no layout: assume the most lines any format uses, so settle is never early.
  const lines = linesOf(text, 5);
  const last = lines[lines.length - 1] ?? "";
  return wordsSettle(last.split(" ").length, FIRST_LINE + (lines.length - 1) * LINE_EACH, WORD_EACH, WORD_DUR);
};

/**
 * Type as the picture: the line is broken into two to five rows and each row
 * is set as large as the frame allows, so short rows come out huge and long
 * ones tight — a typographic poster that builds row by row, word by word.
 * Layouts: 16:9 up to three rows; 1:1 up to four; 9:16 up to five.
 */
export function createKineticType(): SceneTemplate<KineticTypeProps> {
  let instance: Instance | undefined;

  return {
    id: "KineticType",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      sceneRoot(root, L, { alignItems: "flex-start", fontFamily: ctx.fonts.display });

      const rows = linesOf(props.text, L.pick({ landscape: 3, portrait: 5, square: 4 }));
      const lineHeight = 1.0;
      // Each row fills the width unless that would make the stack taller than the frame.
      const tallest = (L.safe.height * 0.94) / rows.length / lineHeight;
      const block = el("div", "kt-block");
      setStyle(block, { display: "flex", flexDirection: "column", alignItems: "flex-start", width: `${L.safe.width}px` });

      const lines = rows.map((row, i): Line => {
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
          color: ctx.palette.fg,
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
      for (const line of instance.lines) wordsIn(line.words, localT, line.start, WORD_EACH, WORD_DUR, 0.5);
    },

    marks(props): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: settleOf(props.text), type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
