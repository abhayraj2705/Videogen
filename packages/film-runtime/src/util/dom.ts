/** Small DOM helpers shared by templates. No timers, no animation APIs. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setStyle(node: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  Object.assign(node.style, style);
}

/** Applies an opacity + translateY reveal at a given eased progress (0..1). No CSS transitions involved — caller drives it per-frame via seek(). */
export function applyReveal(node: HTMLElement, p: number, riseDistancePx = 24): void {
  node.style.opacity = String(p);
  // Land on `none`, not an identity transform: Chromium pixel-snaps the two differently (see util/ui.ts).
  node.style.transform = p >= 1 ? "none" : `translateY(${(1 - p) * riseDistancePx}px)`;
}
