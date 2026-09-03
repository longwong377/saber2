/**
 * BATTLEFIELD BORZ — the wordmark, generated.
 *
 * The player supplied a logo and said of the one that shipped: "I hate your
 * version." The one that shipped read BATTLEFRONT and was a stencil alphabet
 * with a hard offset stamp; the supplied mark is a different object entirely —
 *
 *   · BATTLEFIELD in heavy angular black caps, very wide, every terminal cut
 *     on a diagonal, a rivet in the A's counter and a slit through the I;
 *   · two hairline coral rules, one above the word and one below it, each
 *     broken by tech furniture — a stem-and-diamond sight above, dot-and-bar
 *     connectors at both ends below;
 *   · BORZ under it in coral, BRUSH-PAINTED — irregular edges, dry-brush voids,
 *     and a long tapering sweep off the Z;
 *   · a target reticle inside the O: a light ring, a vertical split, a dot.
 *
 * IT IS GEOMETRY AND NOT A FONT, and that is not a preference:
 * `tools/checks/packed.mjs` boots the single-file build from `file://` and
 * FAILS if the page asks for one byte off-page, so no @font-face can ship here.
 * DESIGN.md §7's claim — every asset but one licensed MP3 generated in code —
 * survives for the same reason it survived for the old mark.
 *
 * WHY A GENERATOR AND NOT 8 KB OF HAND-TYPED PATH DATA. The black caps are a
 * ELEVEN-glyph alphabet with a shared shear rule, and the coral word is four
 * brush strokes whose whole character is a seeded per-vertex wobble. Both are
 * DERIVED — change `SHEAR` or the brush seed and every glyph moves together.
 * Path data pasted into index.html is HANDOFF §2.3's defect: a hand-maintained
 * artefact beside the thing that describes it. So this file is the authority
 * and index.html holds its OUTPUT, spliced between two markers, committed.
 *
 *   node tools/wordmark.mjs            # rewrite index.html between the markers
 *   node tools/wordmark.mjs --print    # just print the SVG defs
 *   node tools/wordmark.mjs --preview out.html   # a page to eyeball it on
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

/* ══════════════════════════════════════════════════════════════════════ */
/*  Numbers                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/** Cap height of the black word. Every glyph below is drawn on this box. */
const CAP = 100;
/** How far a cut corner travels. One number, and it is what makes the alphabet
 *  read as one alphabet rather than eleven shapes with angles on them. */
const SHEAR = 13;
/** Stem weight. The word is heavy — this is 22% of the cap. */
const STEM = 22;
/** Space between glyphs. Wide: the reference is tracked out to nearly a third
 *  of a stem, which is most of what makes it read as a title and not a word. */
const TRACK = 40;

/* ══════════════════════════════════════════════════════════════════════ */
/*  The black alphabet                                                    */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Each glyph is `{ w, out: [contours] }`, every contour a flat list of numbers.
 * Counters are contours too — the path is emitted `fill-rule="evenodd"`, so a
 * contour inside another one is a hole whichever way it winds. That is the one
 * decision that keeps a glyph readable as a list of corners.
 */
const S = SHEAR;
const GLYPHS = {
  // B — cut on the top-left and bottom-right, waisted between the bowls.
  B: { w: 78, out: [
    [S, 0, 58, 0, 78, 18, 78, 36, 68, 46, 78, 56, 78, 82, 58, 100, 0, 100, 0, S],
    [STEM, 18, 50, 18, 56, 24, 56, 34, 50, 40, STEM, 40],
    [STEM, 60, 52, 60, 58, 66, 58, 76, 52, 82, STEM, 82],
  ] },
  // A — a chevron with a flat sheared apex, a crossbar, and the rivet.
  A: { w: 86, out: [
    [0, 100, 20, 0, 66, 0, 86, 100, 62, 100, 57.5, 78, 28.5, 78, 24, 100],
    [33, 58, 53, 58, 45.5, 20, 40.5, 20],
    // the rivet: a small diamond punched through the crossbar
    [43, 63, 48, 68, 43, 73, 38, 68],
  ] },
  // T — the arm is cut away at the left, which is the mark's signature notch.
  T: { w: 78, out: [
    [S, 0, 78, 0, 78, 22, 50, 22, 50, 100, 28, 100, 28, 22, 0, 22, 0, S],
  ] },
  // L — squared at the corner, cut at the foot.
  L: { w: 70, out: [
    [0, 0, 22, 0, 22, 78, 70, 78, 70, 88, 58, 100, 0, 100],
  ] },
  // E — three arms, the top one cut, the middle one short.
  E: { w: 76, out: [
    [0, 0, 64, 0, 76, 12, 76, 22, 22, 22, 22, 39, 66, 39, 66, 61, 22, 61,
      22, 78, 76, 78, 76, 100, 0, 100],
  ] },
  // F — the same, without the foot, so the shear reads on the top arm alone.
  F: { w: 72, out: [
    [0, 0, 60, 0, 72, 12, 72, 22, 22, 22, 22, 41, 66, 41, 66, 63, 22, 63,
      22, 100, 0, 100],
  ] },
  // I — a bar with a slit through its waist. The reference has this and it is
  // the detail that stops the narrowest glyph reading as a mistake.
  I: { w: 34, out: [
    [0, 0, 34, 0, 34, 43, 27, 50, 34, 57, 34, 100, 0, 100, 0, 57, 7, 50, 0, 43],
  ] },
  // D — a wide bowl, cut top-right and bottom-right.
  D: { w: 82, out: [
    [0, 0, 56, 0, 82, 26, 82, 74, 56, 100, 0, 100],
    [22, 20, 48, 20, 60, 32, 60, 68, 48, 80, 22, 80],
  ] },
};

const WORD = 'BATTLEFIELD';

/* ══════════════════════════════════════════════════════════════════════ */
/*  The brush                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/** Seeded, so a rebuild produces the identical mark. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * A BRUSH STROKE, as a closed outline.
 *
 * `pts` is the skeleton — [x,y,w] triples, w being the half-width at that
 * station. The outline walks up one side and back down the other, offsetting
 * along the local normal, and every station is displaced by a seeded wobble in
 * BOTH axes. That second axis is what separates a brush from a tapered ribbon:
 * a stroke whose edges wobble but whose spine is dead straight still reads as
 * vector art.
 *
 * `bite` pulls one or two stations sharply inward, which is the dry-brush skip
 * where the bristles lifted off the paper.
 */
function brush(pts, seed, { wobble = 3.2, bite = 0 } = {}) {
  const r = rng(seed);
  const n = pts.length;
  const L = [], R = [];
  const biteAt = bite ? 1 + Math.floor(r() * (n - 2)) : -1;
  for (let i = 0; i < n; i++) {
    const [x, y, w] = pts[i];
    const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)];
    let dx = q[0] - p[0], dy = q[1] - p[1];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const nx = -dy, ny = dx;
    const jl = (r() - 0.5) * wobble, jr = (r() - 0.5) * wobble;
    const jt = (r() - 0.5) * wobble * 0.6;
    const wl = i === biteAt ? w * 0.34 : w;
    L.push([x + nx * (wl + jl) + dx * jt, y + ny * (wl + jl) + dy * jt]);
    R.push([x - nx * (w + jr) + dx * jt, y - ny * (w + jr) + dy * jt]);
  }
  const ring = L.concat(R.reverse());
  return ring;
}

/** A closed ring of [x,y] as an SVG subpath, rounded to a tenth of a unit. */
function sub(ring) {
  const f = (v) => (Math.round(v * 10) / 10).toString();
  return 'M' + ring.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
}

/** A circle as a ring of points, so it can be roughened like everything else. */
function ringPts(cx, cy, r, steps, seed, wobble = 0) {
  const rnd = rng(seed);
  const out = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const rr = r + (wobble ? (rnd() - 0.5) * wobble : 0);
    out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return out;
}

/**
 * BORZ, painted.
 *
 * Drawn on a 100-unit cap like the black word so the two share one scale, then
 * the whole group is placed and scaled once. Coordinates run 0..~560 across.
 */
function borz() {
  const P = [];              // coral, under
  const K = [];              // knocked out in the plate colour
  const O = [];              // coral, over the knockouts
  const H = 150;             // the coral cap
  let seed = 1301;
  const B = (pts, o) => P.push(sub(brush(pts, seed++, o)));
  /* A DRY SKIP — a sliver of the plate colour laid across a stroke where the
   * bristles lifted. Two or three is the whole difference between a brush and
   * a blob; more than that and it reads as damage. */
  const skip = (pts) => K.push(sub(brush(pts, seed++, { wobble: 1.6 })));

  /* EACH LETTER IS ABOUT AS WIDE AS IT IS TALL, which is what the supplied
   * mark does and what stops a brush word reading as a condensed font. The
   * bowls are drawn LARGE with a thinner stroke than the stems: a bowl whose
   * stroke is half its own height has no counter left, which is exactly how
   * the first pass turned B and R into blobs. */

  /* ── B ─────────────────────────────────────────────────────────────── */
  B([[16, 4, 16], [11, 52, 18], [13, 102, 17], [18, H - 2, 15]]);
  B([[24, 11, 9], [88, 5, 10], [140, 25, 9], [144, 48, 8], [102, 65, 9], [28, 70, 10]]);
  B([[28, 83, 10], [96, 77, 10], [152, 98, 10], [144, 128, 9], [90, 148, 10], [24, H, 13]]);
  skip([[40, 64, 2.4], [82, 60, 1.5]]);

  /* ── O, and the sight inside it ────────────────────────────────────── */
  const ox = 262, oy = 75, R = 75;
  P.push(sub(ringPts(ox, oy, R, 46, 91, 6)));
  P.push(sub(ringPts(ox, oy, R * 0.60, 36, 94, 3)));       // evenodd → the counter
  /* THE RETICLE. A light disc inside the bowl, a vertical split running the
   * whole height of the letter, and a coral pip at the centre — the one piece
   * of the supplied mark that is not typography, so it is drawn and not
   * approximated. */
  K.push(sub(ringPts(ox, oy, R * 0.60, 36, 95, 2.4)));
  K.push(sub([[ox - 8, oy - R - 16], [ox + 8, oy - R - 16],
    [ox + 8, oy + R + 16], [ox - 8, oy + R + 16]]));
  O.push(sub(ringPts(ox, oy, R * 0.22, 22, 96, 1.6)));

  /* ── R ─────────────────────────────────────────────────────────────── */
  const rx = 356;
  B([[rx + 16, 4, 16], [rx + 11, 52, 18], [rx + 13, 102, 17], [rx + 18, H - 2, 15]]);
  B([[rx + 24, 11, 9], [rx + 88, 5, 10], [rx + 140, 28, 9], [rx + 142, 56, 8], [rx + 98, 74, 9], [rx + 28, 78, 10]]);
  B([[rx + 62, 86, 12], [rx + 102, 118, 13], [rx + 138, H + 2, 11]]);
  skip([[rx + 44, 41, 2.2], [rx + 80, 37, 1.4]]);

  /* ── Z, and the sweep that comes off its foot ──────────────────────── */
  const zx = 512;
  B([[zx + 4, 12, 15], [zx + 70, 5, 16], [zx + 140, 12, 14]]);
  B([[zx + 130, 20, 16], [zx + 68, 82, 17], [zx + 8, 140, 16]]);
  B([[zx + 6, 142, 15], [zx + 74, 135, 16], [zx + 146, 142, 14]]);
  /* One stroke, not a decoration beside the letter: it starts inside the foot
   * and thins to nothing rather than ending on a cap. */
  B([[zx + 112, 144, 14], [zx + 186, 151, 11], [zx + 262, 162, 7],
    [zx + 324, 172, 3.4], [zx + 366, 179, 0.7]], { wobble: 2.4 });
  /* Two flecks thrown off it — the brush leaving the paper. */
  B([[zx + 238, 182, 3.6], [zx + 274, 187, 1.1]], { wobble: 1.4 });
  B([[zx + 162, 171, 2.8], [zx + 190, 175, 0.8]], { wobble: 1.2 });

  /* `letters` is where the word stops and the sweep begins — the layout scales
   * off THAT, because the sweep is meant to run past the black word's edge and
   * scaling off the total would pull the letters in to compensate. */
  return { fill: P.join(''), knock: K.join(''), over: O.join(''),
    letters: zx + 146, w: zx + 372, h: H };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Furniture — the two rules and what breaks them                        */
/* ══════════════════════════════════════════════════════════════════════ */

function rules(width) {
  const p = [];
  const bar = (x0, x1, y, h) => p.push(`M${x0} ${y}H${x1}V${y + h}H${x0}Z`);
  const box = (x, y, w, h) => p.push(`M${x} ${y}h${w}v${h}h${-w}Z`);

  /* ── the upper rule, broken by a sight ─────────────────────────────── */
  const yTop = -46, mid = width / 2;
  bar(6, mid - 96, yTop, 4.5);
  bar(mid + 96, width - 6, yTop, 4.5);
  // the sight: a stem, a diamond on it, and two raked wings
  p.push(`M${mid - 3} ${yTop - 62}h6v46h-6Z`);
  p.push(`M${mid} ${yTop - 30}l11 12l-11 12l-11 -12Z`);
  p.push(`M${mid - 86} ${yTop}l30 -22h7l-30 22Z`);
  p.push(`M${mid + 86} ${yTop}l-30 -22h-7l30 22Z`);
  p.push(`M${mid - 44} ${yTop + 2}l22 -16h6l-22 16Z`);
  p.push(`M${mid + 44} ${yTop + 2}l-22 -16h-6l22 16Z`);

  /* ── the speed ticks at the far left of the black word ─────────────── */
  bar(-96, -44, 40, 4);
  bar(-78, -50, 52, 4);
  bar(-60, -46, 64, 4);

  /* ── the lower rule, with dot-and-bar connectors at both ends ──────── */
  const yBot = CAP + 26;
  bar(96, width - 96, yBot, 4.5);
  for (const s of [0, 1]) {
    const x = s ? width - 96 : 96, dir = s ? 1 : -1;
    // a plug of three segments running out to a terminal dot
    box(x + dir * 4, yBot - 6, dir * 34, 17);
    box(x + dir * 44, yBot - 3, dir * 9, 11);
    box(x + dir * 58, yBot - 3, dir * 5, 11);
    bar(Math.min(x + dir * 68, x + dir * 88), Math.max(x + dir * 68, x + dir * 88), yBot + 0.5, 3.5);
    p.push(`M${x + dir * 96} ${yBot + 2.2}a7 7 0 1 0 0.1 0Z`);
  }
  return p.join('');
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Assembly                                                              */
/* ══════════════════════════════════════════════════════════════════════ */

function build() {
  // the black word, laid out
  let x = 0;
  const caps = [];
  for (const ch of WORD) {
    const g = GLYPHS[ch];
    if (!g) throw new Error(`no glyph for ${ch}`);
    const d = g.out.map((c) => {
      let s = '';
      for (let i = 0; i < c.length; i += 2) s += (i ? 'L' : 'M') + (c[i] + x) + ' ' + c[i + 1];
      return s + 'Z';
    }).join('');
    caps.push(d);
    x += g.w + TRACK;
  }
  const width = x - TRACK;

  const { fill, knock, over, letters: bl } = borz();
  /* BORZ IS SCALED TO THE BLACK WORD'S WIDTH rather than tracked to it — it is
   * one painted object and letter-spacing a brush is what makes a brush look
   * like a font. The sweep runs past the right edge on purpose. */
  /* 0.58 of the black word for the letters, which puts the sweep's tail at
   * about 0.90 — both measured off the supplied mark. */
  const k = (width * 0.58) / bl;
  const bx = width * 0.085;

  return { width, caps: caps.join(''), fill, knock, over, k, bx, furniture: rules(width) };
}

function svgDefs() {
  const { width, caps, fill, knock, over, k, bx, furniture } = build();
  return `<svg class="wm-src" width="0" height="0" aria-hidden="true" focusable="false"><defs>
<g id="wm-body">
<path class="wm-caps" fill="var(--wm-a)" fill-rule="evenodd" d="${caps}"/>
<path class="wm-rule" fill="var(--wm-b)" d="${furniture}"/>
<g transform="translate(${bx.toFixed(2)} ${(CAP + 62).toFixed(2)}) scale(${k.toFixed(4)})">
<path class="wm-brush" fill="var(--wm-b)" fill-rule="evenodd" d="${fill}"/>
<path class="wm-knock" fill="var(--wm-knock)" fill-rule="evenodd" d="${knock}"/>
<path class="wm-pip" fill="var(--wm-b)" d="${over}"/>
</g>
</g>
<g id="wm-mark"><use href="#wm-body"/></g>
</defs></svg>`.replace(/\n/g, '\n');
}

const out = svgDefs();

if (has('preview')) {
  const path = flag('preview', 'wordmark.html');
  await writeFile(path, `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#efe6d8;display:grid;place-items:center;min-height:100vh}
  .wrap{width:min(1400px,92vw)}
  svg.mark{width:100%;height:auto;overflow:visible;
    --wm-a:#16181c;--wm-b:#cf7f66;--wm-knock:#efe6d8}
  .dark{background:#141118}.dark svg.mark{--wm-a:#f3ece2;--wm-knock:#141118}
  </style>${out}
  <div class="wrap"><svg class="mark" viewBox="-120 -130 1440 480"><use href="#wm-mark"/></svg></div>
  <div class="wrap dark" style="padding:40px 0"><svg class="mark" viewBox="-120 -130 1440 480"><use href="#wm-mark"/></svg></div>`);
  console.error(`preview → ${path}`);
}

if (has('print')) { console.log(out); process.exit(0); }

/* ── splice into index.html between the markers ───────────────────────── */
const idx = resolve(ROOT, 'index.play.html');
let html = await readFile(idx, 'utf8');
const A = '<!-- WORDMARK:BEGIN — generated by tools/wordmark.mjs, do not hand-edit -->';
const B = '<!-- WORDMARK:END -->';
const i = html.indexOf(A), j = html.indexOf(B);
if (i < 0 || j < 0) {
  console.error('markers not found in index.html — add them around the <svg class="wm-src"> block');
  process.exit(1);
}
html = html.slice(0, i + A.length) + '\n' + out + '\n' + html.slice(j);
await writeFile(idx, html);
console.error(`index.html ← wordmark (${out.length} bytes)`);
