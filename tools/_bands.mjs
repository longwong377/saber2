/**
 * THE TITLE BACKDROP'S GEOMETRY, IN ONE PLACE.
 *
 * Three things need the same rectangles and they must not each derive them:
 * tools/keyart.mjs composes the plate against them, tools/checks/keyart.mjs
 * asserts against them, and tools/_menubands.mjs checks this arithmetic against
 * a real browser. HANDOFF §2.4 is the reason it is a module and not three
 * paragraphs — an instrument that restates a rule eventually disagrees with it,
 * and it fails in the direction that manufactures defects.
 *
 * Everything below is in FRACTIONS OF THE PLATE, origin top-left, because that
 * is the only frame in which "is anything interesting there" is a question
 * about the image rather than about somebody's monitor.
 *
 * The panel size is not typed here. It is parsed out of styles.css by the
 * caller and passed in — `.menu-wrap` owns it.
 */

/** The aspect ratios the composition is specified over. Outside them the plate
 *  still covers; it simply is not promised to keep anything in particular. */
export const MIN_ASPECT = 4 / 3;
export const MAX_ASPECT = 21 / 9;

/**
 * THE REFERENCE VIEWPORT. Every geometry number in styles.css was measured at
 * 1920x1080 (its own comments say so, repeatedly), the panel is a FIXED pixel
 * box so its share of the screen is a function of resolution and not only of
 * aspect, and a spec has to name one. Below it — 1366x768, 1280x720 — the wrap
 * covers 92% of the height and 69% of a 21:9 plate's width, and no composition
 * shows through that; above it, everything the ring promises is still true and
 * more besides. Measured at eight viewports by tools/_menubands.mjs.
 */
export const REF_W = 1920;
export const REF_H = 1080;

/**
 * `background-size:cover`, exactly as the spec defines it: scale by whichever
 * ratio is larger, centre, crop the overflow. Returns the part of the PLATE
 * that lands on screen, as [x, y, w, h] in plate fractions.
 */
export function coverVisible(plateW, plateH, viewW, viewH) {
  const s = Math.max(viewW / plateW, viewH / plateH);
  const dw = plateW * s, dh = plateH * s;
  return [(dw - viewW) / 2 / dw, (dh - viewH) / 2 / dh, viewW / dw, viewH / dh];
}

/**
 * The whole specification, computed.
 *
 * @param {object} o
 * @param {number} o.plateW,o.plateH   the plate's own pixels
 * @param {number} o.panelW,o.panelH   `.menu-wrap`, in CSS px, from styles.css
 * @returns {{safe:number[],covered:number[],ring:object,aspect:number,cropsVertically:boolean}}
 */
export function bands({ plateW, plateH, panelW, panelH }) {
  const aspect = plateW / plateH;

  /* CROP-SAFE — the intersection of what is on screen at the two extreme
   * aspect ratios. One of them always crops horizontally and the other
   * vertically, so the intersection is the whole specification in two calls. */
  const a = coverVisible(plateW, plateH, MIN_ASPECT * 1000, 1000);
  const b = coverVisible(plateW, plateH, MAX_ASPECT * 1000, 1000);
  const safe = [
    Math.max(a[0], b[0]), Math.max(a[1], b[1]),
    Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]),
    Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]),
  ];

  /* COVERED — `.menu-wrap` at the reference viewport, mapped into the plate. */
  const s = Math.max(REF_W / plateW, REF_H / plateH);
  const dw = plateW * s, dh = plateH * s;
  const ox = (REF_W - dw) / 2, oy = (REF_H - dh) / 2;
  const pw = Math.min(panelW, REF_W * 0.94), ph = Math.min(panelH, REF_H * 0.92);
  const covered = [
    ((REF_W - pw) / 2 - ox) / dw, ((REF_H - ph) / 2 - oy) / dh, pw / dw, ph / dh,
  ];

  const [sx, sy, sw, sh] = safe;
  const [cx, cy, cw, ch] = covered;
  const ring = {
    left: [sx, sy, cx - sx, sh],
    right: [cx + cw, sy, sx + sw - cx - cw, sh],
    top: [sx, sy, sw, cy - sy],
    bottom: [sx, cy + ch, sw, sy + sh - cy - ch],
  };
  return {
    aspect, safe, covered, ring,
    /* A plate at least as wide as the widest viewport in range is never
     * cropped vertically anywhere in it, which is the whole reason the top and
     * bottom bands are worth composing in. Measured by tools/_menubands.mjs at
     * 1920x1080 against a 1180x770 panel: a 16:9 plate leaves 20 px of top
     * band and 20 of bottom; a 21:9 plate leaves 155 and 155. The side bands
     * are 130 px either way, because they are set by the panel's width and the
     * 4:3 crop and neither of those knows what the source aspect is. */
    cropsVertically: aspect < MAX_ASPECT - 1e-9,
  };
}

/**
 * THE WORDMARK'S BOX, MEASURED IN CHROMIUM, and stated here because a DOM with
 * no layout engine cannot compute it — the same admission and the same device
 * as tools/checks/front-screen.mjs's stated geometries.
 *
 * `node tools/_menubands.mjs` re-measures it in about two seconds and prints
 * the line to paste. `FONT_PX` is the size it was measured at: the check
 * compares that against the live rule in styles.css and fails if they differ,
 * so the pair cannot drift silently (HANDOFF §2.3).
 */
export const WORDMARK = { w: 308, h: 29, fontPx: 25, top: 4 };

/** The wordmark's box on the plate, at the reference viewport. */
export function wordmarkBand({ plateW, plateH, panelH }, mark = WORDMARK) {
  const s = Math.max(REF_W / plateW, REF_H / plateH);
  const dw = plateW * s, dh = plateH * s;
  const ox = (REF_W - dw) / 2, oy = (REF_H - dh) / 2;
  const ph = Math.min(panelH, REF_H * 0.92);
  const top = (REF_H - ph) / 2 + mark.top;
  return [(REF_W / 2 - mark.w / 2 - ox) / dw, (top - oy) / dh, mark.w / dw, mark.h / dh];
}
