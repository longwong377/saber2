/**
 * WHAT A LIT BLADE DOES TO THE PERSON HOLDING IT, AND TO THE GROUND.
 *
 * The established experiment for "the character looks wrong" was the same walk
 * with the blade LIT and with it RETRACTED. The effect it shows is real and
 * large. But retracting a blade removes TWO things at once — the two point
 * lights, and the drawn emitter with its bloom halo — so it cannot say which
 * one did it, and the whole mechanism had been attributed to the point lights.
 * Separating them is what this tool is for, and they turn out to be two
 * different faults with two different fixes:
 *
 *   the wielder's blue wash   is the BLOOM HALO of the drawn blade
 *   the cyan cast shadow      is the POINT LIGHTS, unopposed where the sun is not
 *
 * Two modes:
 *
 *   sweep   ONE BOOT, EVERY CANDIDATE, THE REAL GAME. Boot the level, walk the
 *           real player into a steady stride, FREEZE the world, and then redraw
 *           that one frame once per candidate, changing nothing but the saber
 *           between redraws. Pose, camera, sun and every other pixel are
 *           identical, so a silhouette masked off one cell lands on the same
 *           body part in all of them and every reading is paired per-pixel.
 *
 *           This has to be one session. A before/after built from two runs of
 *           tools/motion.mjs cannot answer anything while other people are
 *           editing Levels.js, Scenery.js and Terrain.js: measured that way the
 *           sunlit sand came out DARKER with the blade lit than with it
 *           retracted, which an additive light cannot do. The level had moved
 *           underneath the comparison, not the lighting.
 *
 *             node tools/_wielder.mjs sweep [--level dunes] [--tag ab]
 *             node tools/_wielder.mjs sweep --only before,after
 *
 *           --clip picks what the player is DOING when the world stops. `walk`
 *           (the default) freezes a steady stride and is the frame every blade
 *           question has been answered on. `slash` drives motion.mjs's real
 *           overhead arc and freezes mid-swing, and it is the ONLY frame on which
 *           a question about the TRAIL means anything — walking gives
 *           swingSpeed ~ 0, so `trail.visible` is false and every trail candidate
 *           returns the same numbers. It refuses to draw a sheet at all if the
 *           smear is not really there:
 *
 *             node tools/_wielder.mjs sweep --clip slash --tag trail \
 *               --only notrail,trail-old,trail-chroma,trail-amp,trail-new,trail-old
 *
 *           A candidate named twice is measured twice, in the order given. That
 *           is not a convenience: it is how the snapshot/restore below is proved,
 *           by putting three candidates that write the same uniforms between two
 *           cells that must agree.
 *
 *   sheet   The same statistics against a tools/motion.mjs contact sheet, with
 *           the silhouette masked off a reference frame — normally the retracted
 *           blade control — so the same pixels are read in both. Useful for
 *           reading a sheet somebody else produced; NOT a way to compare two
 *           sheets taken at different times, for the reason above.
 *
 *             node tools/_wielder.mjs sheet <png> [--mask <png>] [--dump]
 *
 * WHAT IS MEASURED, and why each one:
 *
 *   R/B mean        the chroma CAST — whose colour the figure is wearing. On its
 *                   own it is a trap: a blue light SHOULD tint its wielder blue.
 *   matID(overlap)  MATERIAL IDENTITY, the headline. How much of the retracted
 *                   figure's own p10..p90 chroma band the lit figure still
 *                   occupies. A body is many materials — warm skin, neutral
 *                   wool, cold leather — and what a 23:1 light destroys is their
 *                   difference. Overlap and not width: see the comment at the
 *                   report, where measuring width got the answer backwards.
 *   lum p10..p90    form, kept so a fix cannot buy chroma by flattening the
 *                   figure. The complaint said "no readable form"; measuring it
 *                   is how we found that is not what is wrong — the relief
 *                   survives, the material does not.
 *   overlit         the figure's luminance against the retracted control.
 *   clip %          a channel at 1.0 cannot vary; this says whether one is.
 *
 * Chroma and luminance are reported separately and never mixed into one score,
 * because a chroma fault was once measured in luminance here and the fix
 * inverted the wrong axis.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, normalize } from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
import { resolveLevel } from './_roster.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = join(ROOT, '.smoke', 'wielder');
const argv = process.argv.slice(2);
const CMD = argv[0] || 'sweep';
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.indexOf('--' + n) >= 0;

const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const fmt = (v, n = 3, w = 7) => (Number.isFinite(v) ? v.toFixed(n) : '   —  ').padStart(w);

/* ── PNG in and out. A deliberate copy of the decoder in _shade.mjs: a tool
 *    that can be broken by an edit to a tool in someone else's lane is not an
 *    instrument. ───────────────────────────────────────────────────────────── */
function decodePng(file) {
  const buf = readFileSync(file);
  let p = 8, w = 0, h = 0, bitDepth = 8, colour = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colour = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNGs');
  const bpp = colour === 6 ? 4 : colour === 2 ? 3 : 1;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[o++];
    const line = raw.subarray(o, o + stride); o += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const A = i >= bpp ? cur[i - bpp] : 0, B = prev ? prev[i] : 0, C = i >= bpp && prev ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += A; else if (ft === 2) v += B; else if (ft === 3) v += (A + B) >> 1;
      else if (ft === 4) { const pp = A + B - C, pa = Math.abs(pp - A), pb = Math.abs(pp - B), pc = Math.abs(pp - C); v += (pa <= pb && pa <= pc) ? A : (pb <= pc ? B : C); }
      cur[i] = v & 255;
    }
  }
  return { width: w, height: h, bpp, data: out };
}

/** Minimal RGB PNG writer — only ever used for the mask dump. */
function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return c ^ -1; }

/* ══ the statistic ════════════════════════════════════════════════════════ */

/**
 * Per-pixel statistics over a mask, NOT over a rectangle.
 *
 * A rectangle around a figure is nine parts sand, and the sand then carries the
 * mean. Every number here is computed only where `keep(i)` says there is
 * character — which is why the mask has to come from somewhere that does not
 * move when the thing being measured does.
 */
function stats(png, keep) {
  const { width, height, bpp, data } = png;
  const L = [], R = [], G = [], B = [], RB = [];
  let sr = 0, sg = 0, sb = 0, n = 0;
  const clip = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!keep(x, y, i)) continue;
      const o = i * bpp;
      const r = data[o] / 255, g = data[o + 1] / 255, b = data[o + 2] / 255;
      sr += r; sg += g; sb += b; n++;
      L.push(LUM(r, g, b)); R.push(r); G.push(g); B.push(b);
      RB.push(r / Math.max(b, 1 / 255));
      if (r > 0.985) clip[0]++; if (g > 0.985) clip[1]++; if (b > 0.985) clip[2]++;
    }
  }
  if (!n) return null;
  const pct = (a, p) => { const s = a.slice().sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
  const spread = (a) => pct(a, 0.90) - pct(a, 0.10);
  const mr = sr / n, mg = sg / n, mb = sb / n;
  const mL = L.reduce((a, b) => a + b, 0) / n;
  return {
    n,
    mean: [mr, mg, mb],
    lum: mL,
    lumSpread: spread(L),
    lumSd: Math.sqrt(L.reduce((s, v) => s + (v - mL) ** 2, 0) / n),
    spread: [spread(R), spread(G), spread(B)],
    clip: clip.map((c) => (c / n) * 100),
    rbMean: mr / Math.max(mb, 1e-6),
    rbMedian: pct(RB, 0.5),
    /* MATERIAL IDENTITY. How far apart the warmest and coolest tenth of the
     * figure are in R/B. A body under its own light has skin at one ratio, wool
     * at another and leather at a third; a body under a 23:1 blue light has all
     * three at the blade's, and this number goes to nothing. It is deliberately
     * NOT a saturation measure: uniformly desaturating the light would move
     * saturation and leave this exactly where it was. */
    rbSpread: spread(RB),
    rbP10: pct(RB, 0.10), rbP90: pct(RB, 0.90),
    sat: (Math.max(mr, mg, mb) - Math.min(mr, mg, mb)) / Math.max(1e-4, Math.max(mr, mg, mb)),
  };
}

function printStats(label, s) {
  if (!s) { console.log(`  ${label.padEnd(22)} — no pixels`); return; }
  console.log(`  ${label.padEnd(22)} n=${String(s.n).padStart(6)}`
    + `  RGB ${s.mean.map((v) => fmt(v, 3, 6)).join(' ')}`
    + `  lum ${fmt(s.lum, 3, 6)}`
    + `  R/B ${fmt(s.rbMean, 3, 6)}`
    + `  R/Bspread ${fmt(s.rbSpread, 3, 6)} [${fmt(s.rbP10, 2, 5)}..${fmt(s.rbP90, 2, 5)}]`
    + `  lumSpread ${fmt(s.lumSpread, 3, 6)}`
    + `  clipRGB ${s.clip.map((v) => fmt(v, 1, 5)).join('/')}`);
}

/* ══ sheet mode ═══════════════════════════════════════════════════════════ */

/**
 * The silhouette, taken off a reference frame.
 *
 * The figure is the DARK thing in a bright desert, so a luminance threshold
 * finds it — but only inside a window, because the rock line and the sheet's own
 * frame furniture are dark too. The window is expressed in fractions of a CELL
 * so it survives a change of cell size, and the mask's own pixel count and
 * bounding box are printed every time: a mask you cannot see is a mask you
 * cannot trust, and --dump writes it out to be looked at.
 */
function silhouette(ref, cellW, cellH, box, thresh) {
  const { width, height, bpp, data } = ref;
  const cols = Math.max(1, Math.round(width / cellW));
  const rows = Math.max(1, Math.round(height / cellH));
  const keepArr = new Uint8Array(width * height);
  let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const ox = cx * cellW, oy = cy * cellH;
      for (let j = Math.round(box[1] * cellH); j < Math.round(box[3] * cellH); j++) {
        for (let i = Math.round(box[0] * cellW); i < Math.round(box[2] * cellW); i++) {
          const X = ox + i, Y = oy + j;
          if (X >= width || Y >= height) continue;
          const o = (Y * width + X) * bpp;
          const l = LUM(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255);
          if (l > thresh) continue;
          keepArr[Y * width + X] = 1; n++;
          if (X < x0) x0 = X; if (X > x1) x1 = X;
          if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
        }
      }
    }
  }
  return { keepArr, n, bbox: [x0, y0, x1, y1] };
}

function sheetMode() {
  const target = argv[1];
  if (!target) { console.error('usage: node tools/_wielder.mjs sheet <png> [--mask <png>]'); process.exit(1); }
  const maskFile = flag('mask', join(ROOT, '.smoke', 'motion', 'dark-dunes-walkdark.png'));
  const cellW = Number(flag('cellw', 640)), cellH = Number(flag('cellh', 360));
  const thresh = Number(flag('thresh', 0.22));
  // The figure occupies the middle of each cell. Generous, and clear of the
  // sheet's frame stroke and its timestamp badge.
  const box = (flag('box', '0.30,0.12,0.72,0.92')).split(',').map(Number);

  const ref = decodePng(maskFile);
  const img = decodePng(target);
  if (img.width !== ref.width || img.height !== ref.height) {
    console.error(`size mismatch: ${img.width}x${img.height} vs mask ${ref.width}x${ref.height}`);
    process.exit(1);
  }
  const { keepArr, n, bbox } = silhouette(ref, cellW, cellH, box, thresh);
  const frac = (n / (img.width * img.height)) * 100;
  console.log(`\n  mask from ${maskFile.replace(ROOT + '/', '')}`);
  console.log(`  lum < ${thresh} inside cell box ${box.join(',')} -> ${n} px (${frac.toFixed(2)}% of sheet), bbox ${bbox.join(',')}`);
  if (n < 2000) console.log('  ** WARNING: mask is tiny, the numbers below are grain **');

  const keep = (x, y, i) => keepArr[i] === 1;
  console.log(`\n  ${target.replace(ROOT + '/', '')}`);
  printStats('character', stats(img, keep));
  printStats('  (same mask on ref)', stats(ref, keep));

  /* THE CAST SHADOW. A separate claim from the character — "the shadow reads as
   * a bright cyan hole" — and it needs its own region.
   *
   * A fixed box will not do it: the figure walks, so its shadow is in a
   * different place in every cell, and the first version of this straddled the
   * terminator and measured half sunlit sand. So the shadow is MASKED off the
   * reference the same way the silhouette is — sand in the lower band that is
   * distinctly darker than sunlit sand but nowhere near as dark as the figure —
   * which puts the region on the shadow wherever the shadow happens to be. */
  const sband = (flag('shadowband', '0.02,0.80,0.98,1.00')).split(',').map(Number);
  const shadowMask = new Uint8Array(img.width * img.height);
  {
    const lo = Number(flag('shadowlo', 0.28)), hi = Number(flag('shadowhi', 0.50));
    for (let y = 0; y < ref.height; y++) {
      const j = y % cellH;
      if (j < sband[1] * cellH || j >= sband[3] * cellH) continue;
      for (let x = 0; x < ref.width; x++) {
        const i = x % cellW;
        if (i < sband[0] * cellW || i >= sband[2] * cellW) continue;
        const idx = y * ref.width + x, o = idx * ref.bpp;
        const l = LUM(ref.data[o] / 255, ref.data[o + 1] / 255, ref.data[o + 2] / 255);
        if (l > lo && l < hi) shadowMask[idx] = 1;
      }
    }
  }
  const nShadow = shadowMask.reduce((a, b) => a + b, 0);
  console.log(`\n  shadow mask: ref lum in (${flag('shadowlo', 0.28)}, ${flag('shadowhi', 0.50)}) in the lower band -> ${nShadow} px`);
  printStats('cast shadow', stats(img, (x, y, i) => shadowMask[i] === 1));
  printStats('  (ref)', stats(ref, (x, y, i) => shadowMask[i] === 1));

  /* Sunlit sand, well clear of both, as the control that says the frame itself
   * did not move. */
  const gbox = (flag('sandbox', '0.74,0.72,0.98,0.94')).split(',').map(Number);
  const inSand = (x, y) => {
    const i = x % cellW, j = y % cellH;
    return i >= gbox[0] * cellW && i < gbox[2] * cellW && j >= gbox[1] * cellH && j < gbox[3] * cellH;
  };
  console.log('');
  printStats('sand (control)', stats(img, (x, y) => inSand(x, y)));
  printStats('  (ref)', stats(ref, (x, y) => inSand(x, y)));

  if (has('dump')) {
    mkdirSync(OUT, { recursive: true });
    const rgb = Buffer.alloc(img.width * img.height * 3);
    for (let i = 0; i < img.width * img.height; i++) {
      const o = i * img.bpp;
      let r = img.data[o], g = img.data[o + 1], b = img.data[o + 2];
      const x = i % img.width, y = (i / img.width) | 0;
      if (keepArr[i]) { r = 255; g = 40; b = 200; }
      else if (shadowMask[i]) { g = Math.min(255, g + 110); }
      else if (inSand(x, y)) { r = Math.min(255, r + 90); }
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    }
    const f = join(OUT, 'mask-dump.png');
    writeFileSync(f, encodePng(img.width, img.height, rgb));
    console.log(`\n  mask dump -> ${f}`);
  }
}

/* ══ sweep mode ═══════════════════════════════════════════════════════════
 *
 * ONE BOOT, EVERY CANDIDATE, THE REAL GAME.
 *
 * The first version of this was a synthetic scene — a cylinder of robe cloth on
 * a sand plane — on the reasoning that Bodies.js and Rig.js are under
 * concurrent edit and a subject that can be rebuilt underneath the instrument
 * is not repeatable. That reasoning is right about REGRESSION checks and wrong
 * about CHOOSING: the proxy's sand rendered at luminance 0.85 against the real
 * dune sea's 0.62 (no albedo bake on the plane) and its cylinder saw nothing but
 * sky, so its "unlit" wielder came back at R/B 0.21 where the real retracted
 * figure measures 0.96. A trade decided on those numbers would have been decided
 * on the rig's framing, not on the game.
 *
 * So: boot the real level once, walk the real player into the same steady-state
 * pose motion.mjs uses, FREEZE it, and then render the same frame once per
 * candidate — swapping only the saber's light between renders. Every candidate
 * therefore sees identical geometry, identical pose, identical camera and
 * identical sun; the only difference in the picture is the thing being judged.
 * The comparison is per-pixel and paired, which is what makes 'dark' usable as a
 * silhouette mask for all of them.
 *
 * The candidate is applied inside the render wrapper, after the world's update
 * and before the draw, because Saber._updateVisuals rewrites light.intensity
 * every single frame — anything applied outside that window is undone before it
 * is ever drawn, and every row comes back identical.
 *
 *   node tools/_wielder.mjs sweep [--level dunes] [--tag before]
 */

/* Retracting the blade is the ONLY control that isolates the material, and it is
 * not the same thing as zeroing the lights: the blade is an additive emitter
 * with a 0.36 m quad and a core 32x over the bloom threshold, so a drawn blade
 * paints the figure whether or not it is also a light. The first sweep here used
 * lights-off as its control and would have concluded the point lights were the
 * whole story — they are not, and only a retract control can say so. */
const RETRACT = 'sb.lit = false; sb.ignition = 0; sb.bladeGroup.visible = false;'
  + ' sb.trail.visible = false; L.intensity = 0; T.intensity = 0;';

/* THE TRAIL AS IT WAS BEFORE THIS ROUND, reconstructed from the class's own
 * constants rather than typed in, so the "before" cell cannot quietly stop being
 * the old build when a constant moves. Two faults, and they are separable:
 *
 *   chroma   the smear multiplied uHue by e and nothing else, so every pixel of
 *            it was the crystal at full 22.9:1 blue-to-red, including the part
 *            that is 1.5x to 2.4x over the bloom threshold.
 *   width    TRAIL_HOT/TRAIL_GLOW were absolute numbers that did not scale with
 *            coreWidth, so the smear sat at the w = 1 amplitude on every blade.
 */
const OLD_AMP = 'sb.trailMat.uniforms.uHot.value = sb.constructor.PROFILE.amp[1]'
  + ' * sb.constructor.TRAIL_HOT_OF_GLOW * sb.punch;'
  + ' sb.trailMat.uniforms.uGlow.value = sb.constructor.PROFILE.amp[2]'
  + ' * sb.constructor.TRAIL_GLOW_OF_HALO * sb.punch;';
const OLD_CHROMA = 'sb.trailMat.uniforms.uCoreWhite.value = 0;';

const CANDIDATES = [
  { name: 'retract', note: 'CONTROL: no blade at all — the material on its own',
    apply: RETRACT },
  /* ── THE TRAIL A/B (run with --clip slash, or every one of these is a
   *    measurement of a trail that is not on screen). ────────────────────── */
  { name: 'notrail', note: 'blade as shipped, SMEAR HIDDEN — the trail contribution isolated',
    apply: 'sb.trail.visible = false;' },
  { name: 'trail-old', note: 'THE OLD SMEAR: full crystal chroma, amplitudes that ignore the width',
    apply: OLD_CHROMA + OLD_AMP },
  { name: 'trail-chroma', note: 'old amplitudes, chroma fixed — defect 1 alone',
    apply: OLD_AMP },
  { name: 'trail-amp', note: 'old chroma, amplitudes scaled by the width — defect 2 alone',
    apply: OLD_CHROMA },
  { name: 'trail-new', note: 'AS NOW SHIPPED: hot lobe neutralised, both amplitudes scaled',
    apply: '' },
  { name: 'retract-nobloom', note: 'control with bloom off, to size bloom on its own',
    apply: RETRACT + ' E.bloom.enabled = false;' },
  /* THE A/B THAT MATTERS. Two cells, one frame, one build.
   *
   * A before/after taken from two runs of tools/motion.mjs cannot answer this
   * while other people are editing Levels.js, Scenery.js and Terrain.js: the
   * two sheets are of different worlds. Measured that way the sunlit sand came
   * out DARKER with the blade lit than with it retracted, which an additive
   * light cannot do — the level had changed underneath the comparison. Both
   * states have to be rendered from the same frozen frame of the same build,
   * which is what these two are for. */
  { name: 'before', note: 'THE OLD BEHAVIOUR: core at full crystal chroma, light un-floored',
    apply: 'sb.bladeMat.uniforms.uCoreWhite.value = 0;'
      + ' L.color.copy(sb.hue); T.color.copy(sb.hue);' },
  { name: 'after', note: 'AS NOW SHIPPED: core neutralised, light floored', apply: '' },
  { name: 'core0', note: 'core at full crystal chroma, light still floored',
    apply: 'sb.bladeMat.uniforms.uCoreWhite.value = 0;' },
  { name: 'nofloor', note: 'core neutralised but light un-floored — the floor isolated',
    apply: 'L.color.copy(sb.hue); T.color.copy(sb.hue);' },
  /* Sweeping the FLOOR. Each of these RESETS the light to the raw crystal hue
   * first and then floors it: the shipped light is already floored, so a bare
   * FLOOR(L, 0.10) would be a no-op against it and the whole row would come back
   * identical to 'after' while claiming to be a 10% floor. Reset, then set. */
  { name: 'floor0.10', note: 'light floored at 10% of peak instead of the shipped floor',
    apply: 'L.color.copy(sb.hue); T.color.copy(sb.hue); FLOOR(L, 0.10); FLOOR(T, 0.10);' },
  { name: 'floor0.24', note: 'floored at 24%',
    apply: 'L.color.copy(sb.hue); T.color.copy(sb.hue); FLOOR(L, 0.24); FLOOR(T, 0.24);' },
  { name: 'lights0.6', note: 'shipped + point lights at 60% — magnitude alone, measured and rejected',
    apply: 'L.intensity *= 0.6; T.intensity *= 0.6;' },
];

/* ── WHAT THE PLAYER IS DOING WHEN THE WORLD FREEZES ───────────────────────
 *
 * The freeze used to be unconditional: hold KeyW for 31 steps and stop. That is
 * the right frame for a question about the blade, and it is worthless for a
 * question about the SMEAR, because walking swings nothing — swingSpeed lands
 * near zero, _trailPunch clamps to 0, live segments never exceed one and
 * `trail.visible` is FALSE in every cell of the sheet. Every trail candidate
 * measured against that frame comes back identical to every other, and the sheet
 * reads exactly like a fix that did nothing.
 *
 * So the clip is chosen, and `slash` drives the same real arc tools/motion.mjs
 * drives — the guard button held and a mouse sweep through it, not a synthetic
 * pose poked onto the saber transform. The freeze is then ADAPTIVE rather than a
 * step count: keep stepping the arc until the smear is actually there, and fail
 * loudly if it never is. A number measured off an invisible trail is not a
 * weaker measurement, it is not a measurement.
 */
const CLIPS = {
  walk: {
    note: 'holding forward, frozen in a steady stride',
    warmup: 31,
    input: (S) => { S.input.keys.add('KeyW'); },
    stop: (S) => { S.input.keys.delete('KeyW'); },
    // 2.1 m out and level with the hips — motion.mjs's walk camera, so this
    // sheet and that one are the same picture of the same thing.
    camera: (p) => ({ pos: [p.x + 2.1, p.y + 0.95, p.z], look: [p.x, p.y + 0.85, p.z] }),
    needTrail: false,
  },
  slash: {
    note: 'guard held, mouse swept through an overhead arc, frozen mid-swing',
    /* ELEVEN, off the instrument's own trace, not off motion.mjs's 24.
     *
     * The first run of this used motion.mjs's warmup and aborted, correctly: at
     * step 24 the smear was alive but limp, maxPunch 0.23. The trace it printed
     * says why — the arc's ONE hard swing is its first, and everything after it
     * is the aim settling:
     *
     *   step   0   3   5   7  10  16  20  24  33  55
     *   punch .11 .31 .46 .53 .53 .53 .47 .23 .26 .28
     *   swing 4.3 7.1 9.2 10. 9.0 3.9 1.9 2.3 6.0 6.3
     *
     * _trailPunch is (swingSpeed - 2.6) / 13, so nothing after the first arc ever
     * gets near the top of that ramp again. Step 11 is the first frame that has
     * BOTH the peak punch of 0.531 and a full 10-segment ribbon behind it — the
     * live count only reaches 10 at step 10 — so it is the strongest frame the
     * clip contains, and freezing anywhere later measures a fading smear and
     * calls it the smear. */
    warmup: 11,
    // Lifted verbatim from tools/motion.mjs's `slash` clip. Period 48 steps in i.
    input: (S, i) => {
      S.input.buttons[0] = true;
      const t = i / 24;
      S.input.mouse.dx = Math.cos(t * Math.PI) * -34;
      S.input.mouse.dy = Math.sin(t * Math.PI) * -22;
    },
    stop: (S) => { S.input.buttons[0] = false; S.input.mouse.dx = 0; S.input.mouse.dy = 0; },
    // motion.mjs's slash camera: far enough back and high enough that the whole
    // arc is in frame, which the hip-height walk camera cannot do — half the
    // smear of an overhead cut is above its top edge, and bloom only spreads
    // what is in the buffer.
    camera: (p) => ({ pos: [p.x + 3.6, p.y + 1.7, p.z + 1.4], look: [p.x, p.y + 1.4, p.z] }),
    needTrail: true,
  },
};

async function sweepMode() {
  let LEVEL = flag('level', null);
  const TAG = flag('tag', 'now');
  const CELL_W = Number(flag('cellw', 560)), CELL_H = Number(flag('cellh', 400));
  const CLIP = flag('clip', 'walk');
  const clip = CLIPS[CLIP];
  if (!clip) { console.error(`unknown clip "${CLIP}". known: ${Object.keys(CLIPS).join(', ')}`); process.exit(1); }
  const WARMUP = Number(flag('warmup', clip.warmup));
  const MAXWARM = Number(flag('maxwarmup', 96));
  // The peak the slash clip actually reaches, measured. The seek below is a
  // fallback for a build whose arc has moved, not the normal path.
  const WANTPUNCH = Number(flag('punch', 0.53));
  const only = flag('only', null);
  /* ORDER AND REPEATS ARE THE CALLER'S, not the table's. A filter over
   * CANDIDATES silently de-duplicates, and a repeat is the only way to prove the
   * snapshot/restore below actually restores: measure one candidate, measure
   * three others that all write the same uniforms, then measure the first one
   * again. If the two cells do not agree the A/B was reading accumulated state. */
  let list = CANDIDATES;
  if (only) {
    const byName = new Map(CANDIDATES.map((c) => [c.name, c]));
    list = [];
    for (const nm of only.split(',').map((s) => s.trim()).filter(Boolean)) {
      const c = byName.get(nm);
      if (!c) { console.error(`unknown candidate "${nm}". known: ${[...byName.keys()].join(', ')}`); process.exit(1); }
      list.push(c);
    }
    if (!list.some((c) => c.name === 'retract')) list.unshift(byName.get('retract'));
  }

  const { chromium } = await import('playwright-core');
  const { createServer } = await import('node:http');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  LEVEL = await resolveLevel(page, LEVEL);
  await page.evaluate((lv) => {
    localStorage.setItem('saber.settings.v2', JSON.stringify({
      level: lv, quality: 'medium', resolutionScale: 0.6, difficulty: 'knight', mode: 'roguelite',
      volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6, firstPerson: false }));
  }, LEVEL);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
  await page.click('#btn-deploy', { timeout: 180000, noWaitAfter: true });
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 120000 });
  await page.waitForTimeout(2200);
  await page.evaluate(async () => {
    const W = window.SABER.world.atmosphere && window.SABER.world.atmosphere.weather;
    if (W) { W.peak = 0; W.unrest = 0; W.update(0); }
    await new Promise((r) => requestAnimationFrame(r));
  });
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async (cfg) => {
    const S = window.SABER;
    const realRAF = window.requestAnimationFrame.bind(window);
    let queue = [];
    window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
    await new Promise((r) => realRAF(r));

    const sheet = document.createElement('canvas');
    const cols = Math.min(4, cfg.cases.length);
    const rows = Math.ceil(cfg.cases.length / cols);
    sheet.width = cols * cfg.cellW; sheet.height = rows * cfg.cellH;
    const sc = sheet.getContext('2d');
    sc.fillStyle = '#101014'; sc.fillRect(0, 0, sheet.width, sheet.height);
    const gl = S.engine.renderer.domElement;

    document.querySelector('#hud') && document.querySelector('#hud').classList.add('hidden');

    const origRender = S.engine.render.bind(S.engine);
    const shots = [];
    const cameraFn = new Function('p', 'return (' + cfg.cameraSrc + ')(p);');
    const inputFn = new Function('S', 'i', '(' + cfg.inputSrc + ')(S, i);');
    const stopFn = new Function('S', '(' + cfg.stopSrc + ')(S);');
    const aimCamera = () => {
      const p = S.world.player.position;
      const pose = cameraFn({ x: p.x, y: p.y, z: p.z });
      const c = S.engine.camera;
      c.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      c.lookAt(pose.look[0], pose.look[1], pose.look[2]);
      c.updateMatrixWorld(true);
    };
    S.engine.render = (dt) => { aimCamera(); origRender(dt); };

    let clock = performance.now();
    const step = async () => {
      clock += cfg.stepMs;
      const pending = queue; queue = [];
      for (const cb of pending) { try { cb(clock); } catch (e) { return String(e && e.message || e); } }
      await new Promise((r) => realRAF(r));
      return null;
    };

    const sb = S.world.player.saber;
    const E = S.engine;

    /* WHAT THE SMEAR ACTUALLY IS THIS FRAME, read off the buffers the trail
     * DRAWS from rather than off the flag that says it is drawn. `trail.visible`
     * is necessary and nowhere near sufficient: every dead segment is collapsed
     * onto the hilt with punch 0, so a "visible" trail can be thirty degenerate
     * quads stacked on the emitter, rasterising nothing. Length, slab and punch
     * are what say there is a ribbon. */
    const trailState = () => {
      const n = sb.trailSegments, S3 = sb.trailSheets;
      const pos = sb.trailPos, age = sb.trailAge, pun = sb.trailPunch;
      let live = 0, maxPunch = 0, path = 0, slab = 0, prev = null;
      for (let i = 0; i < n; i++) {
        const v = (i * S3) * 2;
        if (age[v] >= 1 || pun[v] <= 0.001) continue;
        live++;
        if (pun[v] > maxPunch) maxPunch = pun[v];
        // the centre sheet's TIP vertex — the leading edge of the ribbon
        const q = ((i * S3 + ((S3 - 1) >> 1)) * 2 + 1) * 3;
        if (prev) path += Math.hypot(pos[q] - prev[0], pos[q + 1] - prev[1], pos[q + 2] - prev[2]);
        prev = [pos[q], pos[q + 1], pos[q + 2]];
        // the drawn slab: outermost sheet to outermost sheet at the emitter end
        const lo = (i * S3) * 2 * 3, hi = (i * S3 + S3 - 1) * 2 * 3;
        const d = Math.hypot(pos[lo] - pos[hi], pos[lo + 1] - pos[hi + 1], pos[lo + 2] - pos[hi + 2]);
        if (d > slab) slab = d;
      }
      return { visible: !!sb.trail.visible, live, maxPunch, path, slab,
        swing: sb.swingSpeed, hot: sb.trailMat.uniforms.uHot.value,
        glow: sb.trailMat.uniforms.uGlow.value };
    };

    // Warm up, then — if the clip needs a smear — keep going until there is one.
    const trace = [];
    let i = 0;
    for (; i < cfg.warmup; i++) {
      inputFn(S, i);
      const err = await step();
      if (err) return { error: err, phase: 'warmup', i };
      trace.push(trailState());
    }
    if (cfg.needTrail) {
      const ready = (t) => t.visible && t.live >= 5 && t.maxPunch >= cfg.wantPunch && t.path > 0.3;
      while (!ready(trace[trace.length - 1]) && i < cfg.maxWarmup) {
        inputFn(S, i); i++;
        const err = await step();
        if (err) return { error: err, phase: 'seek', i };
        trace.push(trailState());
      }
    }
    stopFn(S);
    const T0 = trace[trace.length - 1];
    /* THE ASSERTION THAT MAKES THE REST OF THE SHEET MEAN ANYTHING. Bail before
     * a single cell is drawn rather than return a sheet of identical numbers
     * that looks like a null result. */
    if (cfg.needTrail && !(T0.visible && T0.live >= 5 && T0.maxPunch >= cfg.wantPunch * 0.6 && T0.path > 0.3)) {
      return { error: 'froze on a frame with no usable trail: ' + JSON.stringify(T0), phase: 'freeze', i,
        trace: trace.map((t) => [t.visible ? 1 : 0, +t.live, +t.maxPunch.toFixed(3), +t.swing.toFixed(2)]) };
    }

    /* ── FREEZE ────────────────────────────────────────────────────────────
     * From here the world is never stepped again. Every candidate is a redraw
     * of ONE frame with nothing changed but the saber's two lights, so the
     * pose, the camera, the sun and every other pixel are bit-identical and a
     * mask taken off one cell lands on the same body part in all of them.
     *
     * The first version of this stepped one frame per candidate. It looked
     * right and was worthless: the player keeps walking after the key is
     * released, so each cell held a different pose, the silhouette mask drifted
     * off the figure onto bright sand, and the wielder's "luminance" climbed
     * monotonically down the list — an artefact that reads exactly like a
     * result.
     *
     * The light state is SNAPSHOTTED and restored before each candidate.
     * _updateVisuals rewrites intensity every frame but never colour, so
     * without a restore a colour candidate would leak into every candidate
     * after it — which is how the same first version reported four different
     * rows that were all, in fact, the glow colour. */
    /* EVERYTHING A CANDIDATE IS ALLOWED TO TOUCH HAS TO BE IN HERE, or the
     * candidate after it inherits the change.
     *
     * The rule is mechanical: after the freeze, nothing is stepped, so any state
     * the game rewrites PER FRAME repairs itself and any state it does not is
     * permanent. _updateVisuals rewrites the two light intensities every frame
     * and nothing else; _updateTrail rewrites uHot and uGlow every frame and
     * nothing else — and neither of them runs once the world is frozen. So the
     * blade's uAmp/uCoreWhite AND the trail's uHot/uGlow/uCoreWhite are all
     * permanent, and a list covering only the first pair chains every trail
     * candidate into every trail candidate measured after it. This list is
     * therefore built by ENUMERATING the two materials' uniforms rather than by
     * naming the ones anybody happened to think of.
     *
     * Verified rather than asserted: run the same candidate twice, non-adjacent,
     * with candidates that write all three trail uniforms in between, and check
     * the two cells report the same numbers. See --only in the header. Measured
     * that way — trail-old at cells 2 and 6, with trail-chroma, trail-amp and
     * trail-new between them — the two agree to R/B 0.654 vs 0.655.
     *
     * They are NOT bit-identical, and that is not a leak: the composite grade
     * carries animated film grain at uGrain 0.045, i.e. +-5.7/255, keyed off
     * uTime, which advances two frames per candidate. So every cell has different
     * grain, and the residual between two identical candidates is uniform over
     * the whole frame — mean |delta| 1.49/255 on far sand where the trail draws
     * nothing, 1.60 on the figure. A restore leak would be the other shape: large
     * where the trail is, exactly zero on the sand. For scale, the change this
     * instrument is measuring is mean |delta| 3.21 on the figure and 29/255 at
     * its peak, so the signal clears the grain floor by about 2x on the mean. */
    const snapUniforms = (mat) => {
      const o = {};
      for (const k of Object.keys(mat.uniforms)) {
        const v = mat.uniforms[k].value;
        o[k] = (v && typeof v.clone === 'function') ? v.clone() : v;
      }
      return o;
    };
    const restoreUniforms = (mat, o) => {
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (v && typeof v.clone === 'function') mat.uniforms[k].value.copy(v);
        else mat.uniforms[k].value = v;
      }
    };
    const snap = {
      c: sb.light.color.clone(), i: sb.light.intensity,
      tc: sb.tipLight.color.clone(), ti: sb.tipLight.intensity,
      bloom: E.bloom.enabled, lit: sb.lit, ign: sb.ignition,
      bvis: sb.bladeGroup.visible, tvis: sb.trail.visible,
      blade: snapUniforms(sb.bladeMat),
      trail: snapUniforms(sb.trailMat),
      br: E.bloom.radius, bs: E.bloom.strength,
    };
    const restore = () => {
      sb.light.color.copy(snap.c); sb.light.intensity = snap.i;
      sb.tipLight.color.copy(snap.tc); sb.tipLight.intensity = snap.ti;
      E.bloom.enabled = snap.bloom; sb.lit = snap.lit; sb.ignition = snap.ign;
      sb.bladeGroup.visible = snap.bvis; sb.trail.visible = snap.tvis;
      restoreUniforms(sb.bladeMat, snap.blade);
      restoreUniforms(sb.trailMat, snap.trail);
      E.bloom.radius = snap.br; E.bloom.strength = snap.bs;
    };
    const G = sb.glowColor.clone();
    G.multiplyScalar(1 / Math.max(G.r, G.g, G.b, 1e-4));

    for (let k = 0; k < cfg.cases.length; k++) {
      restore();
      if (cfg.cases[k].apply) {
        // FLOOR raises a light colour's dimmest channel to a fraction of its
        // peak, writing r/g/b directly so no colour-space conversion can creep
        // in between the candidate and the shipped implementation.
        const FLOOR = (lt, f) => {
          const c = lt.color, p = Math.max(c.r, c.g, c.b, 1e-4);
          c.r = Math.max(c.r, f * p); c.g = Math.max(c.g, f * p); c.b = Math.max(c.b, f * p);
        };
        try { new Function('L', 'T', 'G', 'sb', 'E', 'FLOOR', cfg.cases[k].apply)(sb.light, sb.tipLight, G.clone(), sb, E, FLOOR); }
        catch (e) { return { error: String(e && e.message || e), phase: 'apply', i: k }; }
      }
      // Twice, and capture the second: anything temporal in the post stack
      // needs a frame to settle, and a candidate must not be graded on the
      // previous candidate's history.
      aimCamera(); origRender(cfg.stepMs / 1000);
      await new Promise((r) => realRAF(r));
      aimCamera(); origRender(cfg.stepMs / 1000);
      const col = k % cols, row = (k / cols) | 0;
      const x = col * cfg.cellW, y = row * cfg.cellH;
      sc.drawImage(gl, x, y, cfg.cellW, cfg.cellH);
      sc.strokeStyle = 'rgba(255,255,255,0.22)';
      sc.strokeRect(x + 0.5, y + 0.5, cfg.cellW - 1, cfg.cellH - 1);
      sc.font = '12px monospace';
      sc.fillStyle = 'rgba(0,0,0,0.72)'; sc.fillRect(x + 3, y + 3, 176, 16);
      sc.fillStyle = '#c8f0ff'; sc.fillText(k + '  ' + cfg.cases[k].name, x + 6, y + 15);
      // The trail uniforms this cell was actually drawn with, so a row that
      // claims to be the old smear can be checked against what it drew.
      shots.push({ name: cfg.cases[k].name,
        colour: sb.light.color.toArray(), I: sb.light.intensity, tipI: sb.tipLight.intensity,
        tvis: !!sb.trail.visible,
        tHot: sb.trailMat.uniforms.uHot.value, tGlow: sb.trailMat.uniforms.uGlow.value,
        tCW: sb.trailMat.uniforms.uCoreWhite.value });
      await new Promise((r) => realRAF(r));
    }

    restore();
    S.engine.render = origRender;
    window.requestAnimationFrame = realRAF;
    return { png: sheet.toDataURL('image/png'), shots, cols, rows, froze: i, trail: T0,
      trace: trace.map((t) => [t.visible ? 1 : 0, +t.live, +t.maxPunch.toFixed(3), +t.swing.toFixed(2)]) };
  }, { cases: list.map((c) => ({ name: c.name, apply: c.apply })), cellW: CELL_W, cellH: CELL_H,
    warmup: WARMUP, maxWarmup: MAXWARM, wantPunch: WANTPUNCH, needTrail: !!clip.needTrail,
    cameraSrc: String(clip.camera), inputSrc: String(clip.input), stopSrc: String(clip.stop),
    stepMs: 1000 / 60 });

  await browser.close(); server.close();
  if (result.error) {
    console.error('sweep threw during ' + result.phase + ' ' + result.i + ': ' + result.error);
    if (result.trace) console.error('  [visible, live, maxPunch, swingSpeed] per step:\n   '
      + result.trace.map((t) => '[' + t.join(' ') + ']').join(' '));
    if (errors.length) console.error('page errors:', errors.slice(0, 6));
    process.exit(1);
  }
  /* WHAT WAS ON SCREEN WHEN THE WORLD STOPPED. Printed unconditionally, because
   * the whole trail lane's failure mode is a beautiful sheet of a frame that has
   * no smear in it. */
  {
    const t = result.trail || {};
    console.log('\n  froze at step ' + result.froze + ' on clip "' + CLIP + '" — ' + clip.note);
    console.log('  trail: visible=' + t.visible + '  live=' + t.live + '/' + '30'
      + '  maxPunch=' + fmt(t.maxPunch, 3, 5) + '  ribbon=' + fmt(t.path, 2, 5) + ' m'
      + '  slab=' + fmt((t.slab || 0) * 1000, 1, 5) + ' mm'
      + '  swing=' + fmt(t.swing, 2, 5) + ' m/s'
      + '  uHot=' + fmt(t.hot, 3, 6) + ' uGlow=' + fmt(t.glow, 3, 6));
  }
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, TAG + '-' + LEVEL + '-sweep.png');
  writeFileSync(file, Buffer.from(result.png.split(',')[1], 'base64'));

  /* ── read it ─────────────────────────────────────────────────────────────
   * The silhouette comes from the 'dark' cell and is then SHIFTED onto every
   * other cell. All cells are the same pose from the same camera, so the same
   * offsets land on the same points of the same figure — which is what makes
   * these paired per-pixel comparisons rather than eight separate measurements
   * that happen to be near each other. */
  const png = decodePng(file);
  const cols = result.cols;
  const cellOf = (k) => [(k % cols) * CELL_W, ((k / cols) | 0) * CELL_H];
  const darkIdx = Math.max(0, list.findIndex((c) => c.name === 'retract'));
  const [dx, dy] = cellOf(darkIdx);
  const thresh = Number(flag('thresh', 0.22));
  const box = (flag('box', '0.30,0.10,0.72,0.86')).split(',').map(Number);
  const sil = [], shad = [];
  for (let j = Math.round(box[1] * CELL_H); j < Math.round(box[3] * CELL_H); j++) {
    for (let i = Math.round(box[0] * CELL_W); i < Math.round(box[2] * CELL_W); i++) {
      const o = ((dy + j) * png.width + dx + i) * png.bpp;
      const l = LUM(png.data[o] / 255, png.data[o + 1] / 255, png.data[o + 2] / 255);
      if (l < thresh) sil.push([i, j]);
    }
  }
  for (let j = Math.round(0.80 * CELL_H); j < CELL_H; j++) {
    for (let i = 0; i < CELL_W; i++) {
      const o = ((dy + j) * png.width + dx + i) * png.bpp;
      const l = LUM(png.data[o] / 255, png.data[o + 1] / 255, png.data[o + 2] / 255);
      if (l > 0.28 && l < 0.50) shad.push([i, j]);
    }
  }
  /* SUNLIT SAND, well away from the figure and its shadow. This is the number
   * _applyColour's comment is defending — what the ground hands back when the
   * blade lights it — and it is the cost side of every candidate that touches
   * the thrown light. Masked the same way: bright sand in the reference. */
  const sand = [];
  for (let j = Math.round(0.55 * CELL_H); j < Math.round(0.78 * CELL_H); j++) {
    for (let i = Math.round(0.62 * CELL_W); i < Math.round(0.96 * CELL_W); i++) {
      const o = ((dy + j) * png.width + dx + i) * png.bpp;
      const l = LUM(png.data[o] / 255, png.data[o + 1] / 255, png.data[o + 2] / 255);
      if (l > 0.52) sand.push([i, j]);
    }
  }
  console.log('\n════ ' + LEVEL.toUpperCase() + ' — ONE POSE, EVERY CANDIDATE  (' + TAG + ') ════');
  console.log('  silhouette ' + sil.length + ' px, cast shadow ' + shad.length + ' px, sunlit sand '
    + sand.length + ' px, all masked off the retract cell');
  if (sil.length < 3000) console.log('  ** WARNING: silhouette mask is tiny **');
  console.log('');

  const set = (pts, ox, oy) => {
    const s = new Set();
    for (const [i, j] of pts) s.add((oy + j) * png.width + ox + i);
    return (x, y, idx) => s.has(idx);
  };
  const base = {};
  for (let k = 0; k < list.length; k++) {
    const [ox, oy] = cellOf(k);
    const C = stats(png, set(sil, ox, oy));
    const D = stats(png, set(shad, ox, oy));
    const N = stats(png, set(sand, ox, oy));
    const sh = result.shots[k] || {};
    if (k === darkIdx) { base.C = C; base.D = D; base.N = N; }
    console.log('  ── [' + k + '] ' + list[k].name + '  (' + (list[k].note || '') + ')');
    console.log('     light ' + (sh.colour || []).map((v) => v.toFixed(3)).join(',') + '  I ' + (sh.I || 0).toFixed(2)
      + '   trail vis=' + sh.tvis + ' uHot=' + fmt(sh.tHot, 3, 6) + ' uGlow=' + fmt(sh.tGlow, 3, 6)
      + ' uCoreWhite=' + fmt(sh.tCW, 2, 4));
    printStats('wielder', C);
    printStats('cast shadow', D);
    if (base.C && C) {
      /* MATERIAL IDENTITY, measured as OVERLAP and not as width.
       *
       * The first version of this reported p90-p10 of R/B as "how many
       * materials can still be told apart", and it is the wrong statistic: a
       * distribution shoved a long way off the material's own can still be
       * wide. Measured on the real A/B it said the shipped blade scored 84% and
       * the fix 73% — while the shipped figure's whole p10..p90 band sat at
       * [0.11, 0.76] against a retracted control of [0.56, 1.33], i.e. almost
       * nowhere near it, and the fix's [0.38, 0.95] sat squarely inside it.
       *
       * What matters is how much of the material's own chroma range the lit
       * figure still occupies, so this is the intersection of the two p10..p90
       * bands over the control's band. Width is still printed, because a fix
       * that bought overlap by collapsing the figure onto one hue would score
       * well here and must not.
       */
      const lo = Math.max(C.rbP10, base.C.rbP10), hi = Math.min(C.rbP90, base.C.rbP90);
      const overlap = Math.max(0, hi - lo) / Math.max(base.C.rbP90 - base.C.rbP10, 1e-6);
      console.log('     -> WIELDER  R/B ' + fmt(C.rbMean, 3, 6) + ' (unlit ' + fmt(base.C.rbMean, 3, 6) + ')'
        + '   matID(overlap) ' + fmt(overlap * 100, 0, 3) + '%'
        + '   band [' + fmt(C.rbP10, 2, 4) + ',' + fmt(C.rbP90, 2, 4) + ']'
        + ' vs [' + fmt(base.C.rbP10, 2, 4) + ',' + fmt(base.C.rbP90, 2, 4) + ']'
        + '   width ' + fmt(C.rbSpread, 2, 5) + '/' + fmt(base.C.rbSpread, 2, 5)
        + '   overlit ' + fmt(C.lum / Math.max(base.C.lum, 1e-6), 2, 5) + 'x'
        + '   form ' + fmt(C.lumSpread, 3, 6));
    }
    if (base.D && D) {
      console.log('     -> SHADOW   lum ' + fmt(D.lum, 3, 6) + ' (unlit ' + fmt(base.D.lum, 3, 6) + ')'
        + ' = ' + fmt(D.lum / Math.max(base.D.lum, 1e-6), 2, 5) + 'x'
        + '   R/B ' + fmt(D.rbMean, 3, 6) + ' (unlit ' + fmt(base.D.rbMean, 3, 6) + ')');
    }
    if (base.N && N) {
      // B/R, not R/B: on the ground the question is how far the blade pushes the
      // sand toward its own blue, and the comment being tested is stated that way.
      const bo = N.mean[2] / Math.max(N.mean[0], 1e-6);
      const b0 = base.N.mean[2] / Math.max(base.N.mean[0], 1e-6);
      console.log('     -> SUN SAND B/R ' + fmt(bo, 3, 6) + ' (unlit ' + fmt(b0, 3, 6) + ')'
        + '   lum ' + fmt(N.lum, 3, 6) + ' (unlit ' + fmt(base.N.lum, 3, 6) + ')');
    }
    console.log('');
  }
  console.log('  sheet -> ' + file);
  if (errors.length) console.log('  page errors:', errors.slice(0, 4));
}

if (CMD === 'sheet') sheetMode();
else await sweepMode();
