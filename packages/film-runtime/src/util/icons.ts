/**
 * A small set of line icons for feature cards, drawn for this project (24x24
 * grid, 2px round strokes, `currentColor`). The planner picks one by name;
 * anything it sends that isn't a name here is shown as text (an emoji still works).
 */
const PATHS: Record<string, string> = {
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
  gear: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
};

/** The names the planner may use for a feature's `icon`. */
export const ICON_NAMES = Object.keys(PATHS);

/** Inline SVG markup for a named icon, or null when the name isn't one of ours. */
export function iconSvg(name: string | undefined): string | null {
  const d = name ? PATHS[name.trim().toLowerCase()] : undefined;
  if (!d) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}
