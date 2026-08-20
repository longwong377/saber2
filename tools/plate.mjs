/**
 * BATTLEFIELD BORZ — the title plate, painted.
 *
 * WHAT THIS REPLACES. `tools/keyart.mjs` posed the real renderer and shot a
 * frame of the game for `.menu-bg`. That plate is a good screenshot and the
 * player's answer to it was "I don't think our current one is good enough" —
 * with a reference: a wide ochre battlefield seen from a rock shelf, walkers
 * crossing a dust plain, a spired city in the haze, a transport down on the
 * right, drawn flat and warm rather than rendered.
 *
 * A SCREENSHOT CANNOT BE THAT, and that is the whole argument for a second
 * tool rather than a re-pose of the first. The reference is an ILLUSTRATION:
 * its depth is carried by six or seven flat bands whose value steps are wider
 * than any real atmospheric falloff, its dust is drawn, and its horizon holds a
 * city the game has no geometry for. `keyart.mjs` stays — it is still the way
 * to shoot a level — and this paints the front of the game.
 *
 * IT IS STILL GENERATED IN CODE, which is DESIGN.md §7's standing claim and
 * `tools/checks/keyart.mjs`'s page-weight bound. Every shape below is an
 * expression; nothing is traced and nothing is downloaded. The one thing this
 * needs that Node has not got is a rasteriser, so the painting runs in the
 * headless Chromium the smoke test already uses and comes back as a WebP —
 * which is also the only encoder in the box that can hit the 160 KB bound.
 *
 *   node tools/plate.mjs                       # write assets/menu/title.webp
 *   node tools/plate.mjs --out /tmp/p.png --png --width 1280   # look at it
 *
 * THE GEOMETRY IS 21:9 AND THAT IS ARITHMETIC, NOT TASTE — see keyart.mjs's
 * own header for the measurement. `.menu-bg` is `background-size:cover` and
 * `.menu-wrap` covers the middle, so what a player sees is a RING; a 21:9
 * source is never cropped vertically between 4:3 and 21:9, which is seven and
 * a half times the usable band of a 16:9 one for the same pixel budget.
 *
 * THE HEADER BAND IS WHERE THE WORDMARK GOES, so the top 22% of the picture is
 * painted as SKY and nothing else: no silhouette crosses it, the value stays
 * inside a narrow pale range, and `--wm-knock` in styles.css is set to the same
 * cream the sky is mixed from, which is what lets the reticle in the O read as
 * a hole cut in the page.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };

const W = parseInt(flag('width', '2560'), 10);
const H = Math.round(W * 1080 / 2560);
const OUT = flag('out', 'assets/menu/title.webp');
const Q = parseFloat(flag('q', '0.82'));
const PNG = has('png');

/**
 * THE PAINTING, as one function evaluated inside the page.
 *
 * Everything is in fractions of the canvas so a 1280-wide proof is the same
 * picture as the 2560 plate — a proof drawn at a different scale would be a
 * different composition, which is the trap a "just render it smaller" flag
 * usually is.
 */
const PAINT = /* js */`(canvas, W, H) => {
  const g = canvas.getContext('2d');
  const X = (f) => f * W, Y = (f) => f * H;
  const U = W / 2560;                       // one unit of the reference scale

  /* ── the palette ──────────────────────────────────────────────────────
     Seven steps from the sky down into the near rock. The range is narrow at
     the top and wide at the bottom: that is what makes a flat picture read as
     deep, and it is what leaves the header band pale enough to lay a black
     wordmark on. \`line\` is the ink every silhouette is drawn with — this
     picture is a drawing, and a drawing has an edge. */
  const P = {
    skyHi:'#f8f0de', skyLo:'#f2dcba', haze:'#ecc99f', city:'#dcb086',
    far:'#d69c6e', mid:'#c9814f', near:'#bb6d40', rock:'#a95a32',
    deep:'#8e4526', dark:'#743519', ink:'#4d220f', dust:'#f6e7cc',
    metal:'#e8d3b4', cool:'#8d6159',
  };

  let _s = 20931;
  const rnd = () => { _s ^= _s << 13; _s >>>= 0; _s ^= _s >>> 17; _s ^= _s << 5; _s >>>= 0; return _s / 4294967296; };
  const between = (a, b) => a + rnd() * (b - a);

  /* Every shape goes through here. \`k\` is the ink weight in reference pixels;
     0 is a shape with no edge, which is what the far field wants. */
  const poly = (pts, fill, k = 0, stroke = P.ink) => {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (k) { g.lineWidth = k * U; g.lineJoin = 'miter'; g.strokeStyle = stroke; g.stroke(); }
  };
  const P2 = (pts, fill, k, stroke) => poly(pts.map(([a, b]) => [X(a), Y(b)]), fill, k, stroke);

  /**
   * A RIDGE — a horizon walked left to right in seeded steps and closed to the
   * bottom of the frame. \`jag\` is how blocky it is, which is what separates a
   * far dune from a near mesa in a picture with no texture in it.
   */
  const ridge = (y0, amp, jag, fill, k = 0) => {
    const pts = [[X(-0.02), Y(y0)]];
    let x = X(-0.02), y = Y(y0);
    while (x < X(1.02)) {
      x += X(between(0.012, 0.055)) * jag;
      y += (rnd() - 0.5) * Y(amp);
      y = Math.max(Y(y0 - amp * 1.6), Math.min(Y(y0 + amp * 1.6), y));
      pts.push([x, y]);
    }
    pts.push([X(1.02), H + 10], [X(-0.02), H + 10]);
    poly(pts, fill, k);
  };

  /* ══ 1. sky ═══════════════════════════════════════════════════════════
     Two stops and no more. The whole picture is flat bands; a sky that
     gradates is the one place a gradient depicts light rather than decorating,
     which is styles.css law 2, and two stops is what a printed poster of this
     kind actually has. */
  const sky = g.createLinearGradient(0, 0, 0, Y(0.60));
  sky.addColorStop(0, P.skyHi); sky.addColorStop(1, P.skyLo);
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const sun = g.createRadialGradient(X(0.36), Y(0.46), 0, X(0.36), Y(0.46), X(0.44));
  sun.addColorStop(0, 'rgba(255,249,232,0.9)'); sun.addColorStop(1, 'rgba(255,249,232,0)');
  g.fillStyle = sun; g.fillRect(0, 0, W, Y(0.78));

  /* thin banded cloud, flat, three values — no soft edges anywhere */
  for (let i = 0; i < 9; i++) {
    const y = between(0.30, 0.47), x = between(-0.05, 0.85), w = between(0.10, 0.34);
    g.globalAlpha = between(0.12, 0.26);
    P2([[x, y], [x + w, y - 0.004], [x + w * 0.92, y + 0.012], [x + 0.02, y + 0.016]], P.dust);
  }
  g.globalAlpha = 1;

  /* ── flyers, BELOW the header band: the top 22% carries the wordmark ── */
  const flyer = (x, y, s, a) => {
    g.save(); g.translate(X(x), Y(y)); g.scale(s, s); g.globalAlpha = a;
    poly([[0, 0], [W * 0.026, -H * 0.005], [W * 0.050, 0], [W * 0.028, H * 0.007]], P.cool);
    poly([[W * 0.011, -H * 0.003], [W * 0.024, -H * 0.014], [W * 0.030, -H * 0.013], [W * 0.020, -H * 0.001]], P.cool);
    g.restore();
  };
  flyer(0.115, 0.262, 0.60, 0.34); flyer(0.168, 0.232, 0.42, 0.24);
  flyer(0.585, 0.246, 0.52, 0.30); flyer(0.640, 0.216, 0.36, 0.22);

  /* ══ 2. the far city ══════════════════════════════════════════════════
     Spires and stacked discs on the horizon at one flat value. It is the only
     man-made thing in the far field, and it is what tells you the plain is
     being fought ACROSS rather than fought in. */
  g.save(); g.globalAlpha = 0.55;
  const cityY = 0.512;
  for (let i = 0; i < 30; i++) {
    const x = 0.125 + i * 0.0152 + between(-0.003, 0.003);
    const bell = Math.max(0.25, 1 - Math.abs(i - 13) / 15);
    const h = between(0.045, 0.135) * (0.6 + bell);
    const w = between(0.0035, 0.0095);
    P2([[x, cityY], [x, cityY - h], [x + w / 2, cityY - h - 0.030 * bell],
        [x + w, cityY - h], [x + w, cityY]], P.city);
    if (rnd() > 0.5) {
      const dy = cityY - h * between(0.35, 0.85);
      P2([[x - w * 2.0, dy], [x + w * 3.0, dy], [x + w * 2.0, dy + 0.014], [x - w * 1.0, dy + 0.014]], P.city);
    }
  }
  g.restore();

  /* ══ 3. the plain, in bands ═══════════════════════════════════════════ */
  ridge(0.512, 0.005, 2.6, P.haze);
  ridge(0.552, 0.009, 2.1, P.far);
  ridge(0.624, 0.013, 1.6, P.mid);

  /* the track the walkers are following: two ruts curving out of the haze */
  g.globalAlpha = 0.22;
  P2([[0.18, 0.556], [0.52, 0.600], [0.90, 0.690], [0.90, 0.706], [0.50, 0.612], [0.17, 0.562]], P.dark);
  P2([[0.20, 0.552], [0.55, 0.592], [0.93, 0.672], [0.93, 0.684], [0.54, 0.602], [0.19, 0.558]], P.dark);
  g.globalAlpha = 1;

  /* ── dust: drawn, not blurred ─────────────────────────────────────── */
  const column = (x, y, h, w, a) => {
    const grd = g.createLinearGradient(0, Y(y), 0, Y(y - h));
    grd.addColorStop(0, 'rgba(248,238,220,' + a + ')');
    grd.addColorStop(0.55, 'rgba(248,238,220,' + (a * 0.55) + ')');
    grd.addColorStop(1, 'rgba(248,238,220,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(X(x - w * 0.30), Y(y));
    g.lineTo(X(x - w * 1.15), Y(y - h));
    g.lineTo(X(x + w * 1.25), Y(y - h));
    g.lineTo(X(x + w * 0.45), Y(y));
    g.closePath(); g.fill();
  };
  column(0.560, 0.582, 0.24, 0.028, 0.62);
  column(0.470, 0.566, 0.17, 0.020, 0.42);
  column(0.258, 0.556, 0.13, 0.017, 0.34);

  /* ══ 4. the right-hand mesa ═══════════════════════════════════════════
     The reference's strongest shape: a stepped cliff running off the right
     edge. Every terrace is a LIT TOP and a SHADOW FACE — two polygons, not one
     — because that pairing is the only shading a flat picture gets, and it is
     what stops the whole thing reading as a brown wall. */
  const terrace = (x0, x1, top, drop, lit, shade) => {
    const steps = [];
    let x = x0;
    while (x < x1) { const w = between(0.030, 0.075); steps.push([x, Math.min(x + w, x1), (rnd() - 0.45) * drop]); x += w; }
    for (const [a, b, dy] of steps) {
      P2([[a, top + dy], [b, top + dy], [b, top + dy + 0.020], [a, top + dy + 0.024]], lit);
      P2([[a, top + dy + 0.020], [b, top + dy + 0.020], [b, 1.02], [a, 1.02]], shade);
    }
    // vertical striations down the shadow face — the cliff's own drawing
    g.globalAlpha = 0.16;
    for (let i = 0; i < 14; i++) {
      const sx = between(x0, x1), sy = top + between(0.03, 0.07), sh = between(0.05, 0.17);
      P2([[sx, sy], [sx + 0.0028, sy], [sx + 0.0022, sy + sh], [sx - 0.0005, sy + sh]], P.ink);
    }
    g.globalAlpha = 1;
  };
  terrace(0.790, 1.03, 0.392, 0.048, P.near, P.rock);
  terrace(0.858, 1.03, 0.478, 0.038, P.rock, P.deep);
  terrace(0.930, 1.03, 0.570, 0.030, P.deep, P.dark);
  column(0.812, 0.412, 0.15, 0.011, 0.44);
  column(0.955, 0.372, 0.18, 0.014, 0.38);

  /* ══ 5. the left masts ════════════════════════════════════════════════
     Two lattice comms masts on the near-left shelf — the tallest things in the
     frame, which is what gives the plain its scale. A taper, four cross-braces
     and a dish; no tiers, which is what made the first pass read as pagodas. */
  const mast = (x, base, h, w) => {
    P2([[x - w, base], [x - w * 0.22, base - h], [x + w * 0.22, base - h], [x + w, base]], P.dark, 2);
    g.globalAlpha = 0.55;
    for (let i = 1; i <= 5; i++) {
      const t = i / 6, yy = base - h * t, ww = w * (1 - t * 0.78);
      P2([[x - ww, yy], [x + ww, yy], [x + ww, yy + 0.004], [x - ww, yy + 0.004]], P.ink);
    }
    g.globalAlpha = 1;
    P2([[x - w * 0.09, base - h], [x + w * 0.09, base - h],
        [x + w * 0.09, base - h - 0.075], [x - w * 0.09, base - h - 0.075]], P.dark);
    P2([[x - w * 0.85, base - h - 0.052], [x + w * 0.85, base - h - 0.056],
        [x + w * 0.85, base - h - 0.036], [x - w * 0.85, base - h - 0.032]], P.dark, 2);
  };
  mast(0.036, 0.585, 0.40, 0.013);
  mast(0.106, 0.596, 0.27, 0.010);

  /* ══ 6. the walkers ═══════════════════════════════════════════════════
     Six-legged siege walkers strung across the plain, each smaller and paler
     the further back it is, each dragging its own dust. They are the only
     things in the picture that are unambiguously moving. */
  const walker = (x, y, s, fill, k) => {
    const u = W * 0.017 * s;
    g.save(); g.translate(X(x), Y(y));
    for (let i = 0; i < 3; i++) {                       // legs behind the hull
      const lx = -u * 1.05 + i * u * 1.05, kick = (i % 2 ? 0.5 : -0.4) * u;
      poly([[lx, u * 0.05], [lx + kick, u * 1.05], [lx + kick + u * 0.15, u * 1.05],
            [lx + u * 0.18, u * 0.05]], fill, k);
    }
    poly([[-u * 1.55, -u * 0.15], [-u * 1.15, -u * 0.85], [u * 0.95, -u * 0.95],
          [u * 1.75, -u * 0.35], [u * 1.55, u * 0.20], [-u * 1.35, u * 0.15]], fill, k);
    poly([[-u * 0.15, -u * 0.92], [u * 0.35, -u * 1.45], [u * 0.70, -u * 1.40],
          [u * 0.25, -u * 0.88]], fill, k);
    poly([[u * 1.55, -u * 0.45], [u * 2.15, -u * 0.35], [u * 2.15, -u * 0.18], [u * 1.55, -u * 0.22]], fill, k);
    g.restore();
  };
  const trailOf = (x, y, len, a) => {
    g.save(); g.globalAlpha = a;
    const grd = g.createLinearGradient(X(x), 0, X(x - len), 0);
    grd.addColorStop(0, P.dust); grd.addColorStop(1, 'rgba(246,231,204,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(X(x), Y(y)); g.lineTo(X(x - len), Y(y - 0.022));
    g.lineTo(X(x - len), Y(y + 0.004)); g.lineTo(X(x), Y(y + 0.010));
    g.closePath(); g.fill(); g.restore();
  };
  const WALKERS = [
    [0.236, 0.548, 0.40, P.far,  0, 0.045, 0.22],
    [0.318, 0.562, 0.55, P.far,  0, 0.060, 0.28],
    [0.404, 0.582, 0.72, P.mid,  0, 0.075, 0.32],
    [0.498, 0.616, 0.98, P.near, 1.4, 0.095, 0.38],
    [0.598, 0.652, 1.28, P.rock, 1.8, 0.115, 0.42],
    [0.672, 0.706, 1.60, P.deep, 2.2, 0.135, 0.46],
  ];
  for (const [x, y, s, f, k, tl, ta] of WALKERS) { trailOf(x - 0.012, y, tl, ta); walker(x, y, s, f, k); }

  /* ══ 7. the transport, down on the plain ══════════════════════════════
     Wedge hull, swept wing, gear down, ramp out — the shape the player boards
     in the game, drawn at the size it would be a kilometre off, and in the
     LIGHT metal of the picture rather than in white: the first pass painted it
     paper-white and it read as a paper aeroplane. */
  (() => {
    const x = 0.872, y = 0.848, u = W * 0.040;
    g.save(); g.translate(X(x), Y(y));
    poly([[-u * 1.55, u * 0.02], [-u * 0.80, u * 0.06], [-u * 0.66, u * 0.30],
          [-u * 1.72, u * 0.26]], P.rock, 2);                       // ramp, down
    poly([[-u * 1.58, 0], [-u * 0.50, -u * 0.44], [u * 1.10, -u * 0.38],
          [u * 1.66, -u * 0.02], [u * 1.00, u * 0.22], [-u * 1.22, u * 0.19]], P.metal, 2.4);
    poly([[-u * 0.26, -u * 0.42], [u * 0.52, -u * 0.66], [u * 0.92, -u * 0.42],
          [u * 0.10, -u * 0.30]], P.cool, 1.6);                     // canopy
    poly([[-u * 0.16, -u * 0.12], [u * 1.34, -u * 0.70], [u * 1.60, -u * 0.54],
          [u * 0.38, u * 0.02]], P.near, 2);                        // swept wing
    poly([[-u * 1.22, u * 0.19], [u * 1.00, u * 0.22], [u * 0.86, u * 0.30],
          [-u * 1.16, u * 0.27]], P.deep);                          // shadowed belly
    for (const gx of [-u * 0.85, u * 0.45, u * 1.05]) {
      poly([[gx, u * 0.20], [gx + u * 0.07, u * 0.20], [gx + u * 0.05, u * 0.34], [gx - u * 0.02, u * 0.34]], P.ink);
    }
    g.globalAlpha = 0.28;
    poly([[-u * 1.8, u * 0.34], [u * 1.8, u * 0.34], [u * 1.4, u * 0.44], [-u * 1.5, u * 0.44]], P.dark);
    g.globalAlpha = 1;
    g.restore();
  })();

  /* infantry: specks that grow toward the camera, thickest around the ship */
  for (let i = 0; i < 120; i++) {
    const t = rnd();
    const near = rnd() > 0.55;
    const x = near ? between(0.50, 0.74) : between(0.28, 0.72);
    const y = 0.640 + (x - 0.28) * 0.16 + between(-0.016, 0.020);
    const s = (0.5 + (y - 0.62) * 9) * W * 0.0018;
    g.globalAlpha = 0.35 + t * 0.35;
    g.fillStyle = P.ink;
    g.fillRect(X(x), Y(y), Math.max(1, s * 0.5), Math.max(2, s * 1.8));
  }
  g.globalAlpha = 1;

  /* ══ 8. the near shelf ════════════════════════════════════════════════
     The ground the camera is standing on. Three slabs stepping down to the
     left with a lit top edge on each, a crack system across the largest, and
     loose blocks ON the rock rather than floating over the plain — which is
     what the first pass got wrong. It is the darkest thing in the picture,
     which is what pushes everything else back. */
  const slab = (pts, fill, lit) => {
    P2(pts, fill, 2.6);
    if (lit) {                                   // a lit lip along the top edge
      const top = pts.slice(0, 3);
      P2([...top, [top[2][0], top[2][1] + 0.013], [top[1][0], top[1][1] + 0.016],
        [top[0][0], top[0][1] + 0.013]], lit);
    }
  };
  slab([[-0.03, 0.690], [0.115, 0.660], [0.262, 0.700], [0.330, 0.790],
        [0.250, 0.900], [-0.03, 0.930]], P.rock, P.near);
  slab([[-0.03, 0.790], [0.150, 0.762], [0.320, 0.830], [0.395, 0.960],
        [-0.03, 1.03]], P.deep, P.rock);
  slab([[-0.03, 0.912], [0.225, 0.876], [0.500, 0.968], [0.560, 1.03], [-0.03, 1.03]], P.dark, P.deep);
  slab([[0.395, 0.972], [0.800, 0.940], [1.03, 0.992], [1.03, 1.03], [0.40, 1.03]], P.dark, P.deep);
  slab([[0.560, 0.916], [0.880, 0.898], [1.03, 0.936], [1.03, 0.976], [0.66, 0.968]], P.deep, P.rock);

  /* cracks: a few long ink lines with branches, on the near slabs only */
  g.strokeStyle = P.ink; g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    let cx = between(-0.02, 0.42), cy = between(0.80, 1.0);
    g.lineWidth = between(1.4, 3.4) * U; g.globalAlpha = between(0.35, 0.65);
    g.beginPath(); g.moveTo(X(cx), Y(cy));
    for (let j = 0; j < 5; j++) { cx += between(0.010, 0.048); cy += between(-0.020, 0.026); g.lineTo(X(cx), Y(cy)); }
    g.stroke();
  }
  g.globalAlpha = 1;

  /* blocks, sitting on the shelf */
  for (let i = 0; i < 9; i++) {
    const x = between(-0.02, 0.30), y = between(0.74, 0.98);
    const w = between(0.024, 0.058), h = w * between(0.5, 0.95);
    P2([[x, y], [x + w * 0.55, y - h * 0.55], [x + w, y - h * 0.30], [x + w * 0.95, y + h * 0.45],
        [x + w * 0.30, y + h * 0.70]], rnd() > 0.45 ? P.deep : P.dark, 2.2);
  }

  /* ══ 9. grain ═════════════════════════════════════════════════════════
     A sparse warm/dark speckle. Invisible as texture, and enough to stop the
     flat bands banding in an 8-bit WebP, which is the actual job. */
  for (let i = 0; i < W * H * 0.0020; i++) {
    const x = rnd() * W, y = rnd() * H;
    g.fillStyle = rnd() > 0.5 ? 'rgba(255,242,218,0.075)' : 'rgba(60,26,14,0.065)';
    g.fillRect(x, y, 1.7 * U, 1.7 * U);
  }

  /* ══ 10. the vignette and the header hold ═════════════════════════════
     A corner darkening, and then the top band pulled BACK toward the sky so
     nothing that crept up there can fight the wordmark. The second half is the
     one non-pictorial move in the file and it is deliberate: the header band is
     interface, and the plate's job there is to be quiet. */
  const vig = g.createRadialGradient(X(0.5), Y(0.50), X(0.26), X(0.5), Y(0.50), X(0.80));
  vig.addColorStop(0, 'rgba(80,36,20,0)'); vig.addColorStop(1, 'rgba(80,36,20,0.32)');
  g.fillStyle = vig; g.fillRect(0, 0, W, H);
  const hold = g.createLinearGradient(0, 0, 0, Y(0.30));
  hold.addColorStop(0, 'rgba(248,240,222,0.58)'); hold.addColorStop(1, 'rgba(248,240,222,0)');
  g.fillStyle = hold; g.fillRect(0, 0, W, Y(0.30));
}`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
await page.setContent('<canvas id="c"></canvas>');
const data = await page.evaluate(async ({ W, H, src, png, q }) => {
  const c = document.getElementById('c');
  c.width = W; c.height = H;
  // eslint-disable-next-line no-eval
  (0, eval)(src)(c, W, H);
  return c.toDataURL(png ? 'image/png' : 'image/webp', q);
}, { W, H, src: PAINT, png: PNG, q: Q });
await browser.close();

const buf = Buffer.from(data.split(',')[1], 'base64');
const out = resolve(ROOT, OUT);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, buf);
console.error(`${OUT}  ${W}x${H}  ${(buf.length / 1024).toFixed(1)} KB`);
