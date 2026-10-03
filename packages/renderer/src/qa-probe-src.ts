/**
 * In-page layout/text/contrast probe, kept as plain JS *source text* rather
 * than a TS function passed to page.evaluate: tsx/esbuild's keepNames
 * transform injects a `__name()` helper into nested functions, which doesn't
 * exist in the page realm. Called as `(${SCENE_PROBE_JS})(args)`.
 *
 * Returns, for the scene root `[data-scene-id=sceneId]`:
 *  - textItems: every element that directly owns text, with its visible
 *    (ancestor-clipped) box unioned with its text extents, effective opacity,
 *    computed color, effective background (first opaque ancestor), font
 *    size/weight, and whether a clipping container is hiding part of it;
 *  - overflowEls: any element whose visible box leaves the frame.
 */
export const SCENE_PROBE_JS = String.raw`function (args) {
  var sceneId = args.sceneId, vw = args.vw, vh = args.vh;
  var root = document.querySelector('[data-scene-id="' + sceneId + '"]');
  if (!root || root.style.display === "none") return { found: false, textItems: [], overflowEls: [] };
  var canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  var g = canvas.getContext("2d", { willReadFrequently: true });
  function toRgba(c) {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = "rgba(0,0,0,0)";
    g.fillStyle = c;
    g.fillRect(0, 0, 1, 1);
    var d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  function rgb(c) { return "rgb(" + c[0] + ", " + c[1] + ", " + c[2] + ")"; }
  function visibleRect(el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    var l = r.left, t = r.top, rr = r.right, b = r.bottom;
    for (var node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      var cs = getComputedStyle(node);
      if (cs.overflow !== "visible" || cs.clipPath !== "none") {
        var pr = node.getBoundingClientRect();
        l = Math.max(l, pr.left); t = Math.max(t, pr.top);
        rr = Math.min(rr, pr.right); b = Math.min(b, pr.bottom);
        if (rr - l <= 0 || b - t <= 0) return null;
      }
    }
    return [l, t, rr, b];
  }
  function effectiveOpacity(el) {
    var o = 1;
    for (var n = el; n && n !== document.body; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  }
  function effectiveBg(el) {
    for (var n = el; n; n = n.parentElement) {
      var c = toRgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0.5) return c;
    }
    return [0, 0, 0, 1];
  }
  var overflowEls = [];
  var textItems = [];
  // Bounding box of everything the scene actually draws (text, images, filled or outlined boxes).
  var content = null;
  function grow(r) {
    content = content ? [Math.min(content[0], r[0]), Math.min(content[1], r[1]), Math.max(content[2], r[2]), Math.max(content[3], r[3])] : r.slice();
  }
  var all = root.querySelectorAll("*");
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var vr = visibleRect(el);
    if (vr && (vr[0] < -2 || vr[1] < -2 || vr[2] > vw + 2 || vr[3] > vh + 2)) {
      overflowEls.push({ tag: el.tagName.toLowerCase(), cls: String(el.className), rect: vr });
    }
    if (vr && effectiveOpacity(el) > 0.5) {
      var st = getComputedStyle(el);
      var drawn = el.tagName === "IMG" || toRgba(st.backgroundColor)[3] > 0.5 || st.backgroundImage !== "none" || (parseFloat(st.borderTopWidth) > 0 && st.borderTopStyle !== "none");
      // A box that covers the whole frame is a backdrop, not content.
      if (drawn && !(vr[2] - vr[0] > vw * 0.98 && vr[3] - vr[1] > vh * 0.98)) grow(vr);
    }
    var ownText = "";
    for (var k = 0; k < el.childNodes.length; k++) {
      if (el.childNodes[k].nodeType === 3) ownText += el.childNodes[k].textContent || "";
    }
    ownText = ownText.trim();
    if (!ownText) continue;
    var cs = getComputedStyle(el);
    var clipsContent = cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.textOverflow === "ellipsis";
    var clipped = clipsContent && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    var range = document.createRange();
    range.selectNodeContents(el);
    var tr = range.getBoundingClientRect();
    var rect = vr ? [Math.min(vr[0], tr.left), Math.min(vr[1], tr.top), Math.max(vr[2], tr.right), Math.max(vr[3], tr.bottom)] : [0, 0, 0, 0];
    if (effectiveOpacity(el) > 0.5 && rect[2] - rect[0] > 0) grow(rect);
    textItems.push({
      text: ownText,
      opacity: effectiveOpacity(el),
      rect: rect,
      color: rgb(toRgba(cs.color)),
      bg: rgb(effectiveBg(el)),
      fontSize: parseFloat(cs.fontSize),
      fontWeight: Number(cs.fontWeight) || 400,
      clipped: clipped,
      // A letter of a word typed out letter by letter (HTML scenes) belongs to the letter before it, with no space.
      glue: el.classList.contains("hs-ch") && !!el.previousElementSibling
    });
  }
  return { found: true, textItems: textItems, overflowEls: overflowEls, content: content };
}`;
