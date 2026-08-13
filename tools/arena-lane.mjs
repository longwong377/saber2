/**
 * The arena lane's instrument.
 *
 * Three jobs, one file, because they are three views of the same question —
 * "is this frame actually made of separate things?" — and they have to agree.
 *
 *   atmos   GL-free. Runs the engine's own sky model over a level's atmosphere
 *           block and reports the HUE ANGLE of every element the eye separates
 *           by: sky at four bearings, the light in shade, the haze, the ground
 *           bounce. Costs 40 ms, so a parameter can be swept instead of guessed
 *           at, and it prints the three quantities in tools/checks that a
 *           change to turbidity or rayleigh can break.
 *
 *   frame   Boots a level, FREEZES THE WEATHER (a squall was 36% of the arena's
 *           fog density in the shot this replaces, which is enough to move
 *           every hue in the frame between two runs of the same build), pins
 *           the camera to a fixed pose, and measures hue over a standing set of
 *           regions. Before/after is then a table, not an argument.
 *
 *   plate   A TRUE ORTHOGRAPHIC TOP-DOWN plate of the ground, rendered with our
 *           own camera into our own render target. The previous harness tried
 *           to move the game's camera and lost the race with the game's own
 *           update every time — both its plates were the same shallow view. The
 *           way that cannot lose is not to use the game camera at all: put the
 *           terrain on its own layer, point an OrthographicCamera straight down
 *           at it, and call renderer.render ourselves. The update loop never
 *           enters into it.
 *
 *           The plate is axis-aligned to the RIPPLE FRAME (screen +x along the
 *           preset's wind), so a lag in pixels is a lag in the tile's own
 *           coordinates and the tile lattice, if there is one, lands on the
 *           axes. Rendered to a FLOAT target so nothing clips, with the haze
 *           switched off and the sun's shadow map off — prop shadows falling on
 *           the ground would be a periodic-ish signal of their own.
 *
 *   lag     The measurement, on the saved plates, without booting anything.
 *           Full 2-D autocorrelation on a zero-padded FFT, high-passed in the
 *           frequency domain rather than by a box detrend, so what is removed
 *           is stated exactly instead of being "41 px" — and always against a
 *           SYNTHETIC POSITIVE CONTROL built out of the plate's own tile, so
 *           "no repeat found" is a result rather than an absence of evidence.
 *
 *   hue     `frame`'s measurement on a PNG that already exists.
 *   grid    A coarse lum/hue map of a frame, for placing region boxes on the
 *           thing they are named after rather than on whatever is at those
 *           coordinates. (The first version of the region table had "sky high
 *           L" sitting on the colossus's head.)
 *
 * Usage:
 *   node tools/arena-lane.mjs atmos [level ...]
 *   node tools/arena-lane.mjs frame --level arena --tag before
 *   node tools/arena-lane.mjs hue   .smoke/lane-arena/before-arena.png --level arena
 *   node tools/arena-lane.mjs grid  .smoke/lane-arena/before-arena.png [--cols 32 --rows 18]
 *   node tools/arena-lane.mjs plate --level arena --tag before [--size 48] [--px 512] [--height 200]
 *   node tools/arena-lane.mjs lag   .smoke/lane-arena/before-arena-48m-shipped ... [--sigma 2.5]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { resolve, join, extname, normalize, basename } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const CMD = argv[0];
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);
/** Positional arguments — anything that is neither a --flag nor a flag's value. */
function positional(from = 1) {
  const out = [];
  for (let i = from; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { i++; continue; }
    out.push(argv[i]);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Colour                                                                */
/* ══════════════════════════════════════════════════════════════════════ */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * HUE ANGLE, and why it is the HSV one.
 *
 * The complaint this instrument exists to answer was made on hue angles, and a
 * hue angle only means anything if everybody computes it the same way. HSV hue
 * of the DISPLAY pixel is the one a colour picker reports and the one an art
 * director reads off a frame, so that is the headline. It is also the one that
 * goes unstable as chroma goes to zero, which is why `sat` is printed beside
 * every angle — a hue quoted at 0.02 saturation is noise.
 *
 * OkLab hue is printed as well because it is the one that is perceptually
 * uniform: 10° of HSV between two oranges and 10° between an orange and a
 * yellow-green are not the same amount of separation, and the claim being
 * tested is about how much separation the eye gets.
 */
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: mx <= 1e-9 ? 0 : d / mx, v: mx };
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);

/** OkLab hue of a LINEAR rgb triple, in degrees, plus its chroma. */
function oklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  let h = Math.atan2(B, A) * 180 / Math.PI;
  if (h < 0) h += 360;
  return { h, C: Math.hypot(A, B), L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s };
}

/** Signed shortest distance between two hue angles, in degrees. */
function hueDelta(a, b) {
  let d = ((b - a + 540) % 360) - 180;
  return d;
}

/**
 * The SPREAD of a set of hue angles: the width of the smallest arc that holds
 * all of them. A plain max−min is wrong on a circle (350° and 10° are 20°
 * apart, not 340°), and this frame has elements on both sides of red.
 */
function hueSpread(angles) {
  if (angles.length < 2) return 0;
  const s = [...angles].sort((a, b) => a - b);
  let widestGap = 0;
  for (let i = 0; i < s.length; i++) {
    const gap = (s[(i + 1) % s.length] - s[i] + 360) % 360;
    if (gap > widestGap) widestGap = gap;
  }
  return 360 - widestGap;
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  PNG, in node, because a browser launch to decode an image is absurd    */
/* ══════════════════════════════════════════════════════════════════════ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 8-bit RGB/RGBA, no interlace — which is everything playwright writes. */
function decodePng(file) {
  const buf = readFileSync(file);
  let p = 8, w = 0, h = 0, depth = 0, type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const tag = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (tag === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; type = data[9];
      if (depth !== 8 || (type !== 2 && type !== 6)) throw new Error(`unsupported PNG ${depth}/${type}`);
      if (data[12] !== 0) throw new Error('interlaced PNG');
    } else if (tag === 'IDAT') idat.push(Buffer.from(data));
    else if (tag === 'IEND') break;
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const row = raw.subarray(q, q + stride); q += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { width: w, height: h, bpp, data: out };
}

function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (tag, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(tag, 4, 'ascii');
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  atmos — the sky model, on the CPU, before anything is booted           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ACES, transcribed from three's tonemapping chunk, and then the composite's
 * grade in the order the shader applies it. This is a PREDICTION: it has no
 * bloom, no cloud deck and no geometry in it, so it is right about the sky's
 * own hue and only indicative about a rendered frame. `frame` is the authority;
 * this is what makes a sweep affordable.
 */
function aces(rgb, exposure) {
  const IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
  const OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
  const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  let v = rgb.map((c) => c * exposure / 0.6);
  v = mul(IN, v);
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return mul(OUT, v).map(clamp01);
}

const GRADE_FIXED = { black: 0.018, curve: 0.32, contrast: 1.04,
  shadowTint: [0.955, 0.985, 1.070], highTint: [1.035, 1.000, 0.955] };

function grade(srgb, a) {
  const lift = a.lift ?? [0.004, 0.006, 0.012];
  const gain = a.gain ?? [1.02, 1.0, 0.98];
  const sat = a.saturation ?? 1.06;
  const G = GRADE_FIXED;
  let c = srgb.map((v) => Math.max(v - G.black, 0) / (1 - G.black));
  c = c.map((v) => v + (v * v * (3 - 2 * v) - v) * G.curve);
  c = c.map((v) => (v - 0.5) * G.contrast + 0.5);
  c = c.map((v, i) => v * gain[i] + lift[i]);
  const luma = LUM(c[0], c[1], c[2]);
  const t = clamp01((luma - 0.12) / 0.60); const ss = t * t * (3 - 2 * t);
  c = c.map((v, i) => v * (G.shadowTint[i] + (G.highTint[i] - G.shadowTint[i]) * ss));
  const th = clamp01((luma - 0.62) / 0.38); const sh = th * th * (3 - 2 * th);
  const satEff = sat * (1 + (0.70 - 1) * sh);
  return c.map((v) => clamp01(luma + (v - luma) * satEff));
}

/** Linear radiance → what the screen shows, all of it. */
function through(linear, exposure, a) {
  return grade(aces(linear, exposure).map(linearToSrgb), a);
}

function fmt(v, n = 1, w = 6) { return v.toFixed(n).padStart(w); }

async function cmdAtmos() {
  const E = await import(join(ROOT, 'src/engine/Engine.js'));
  const { LEVELS, LEVEL_ORDER } = await import(join(ROOT, 'src/game/Levels.js'));
  const THREE = await import('three');
  const names = positional();
  const levels = names.length ? names : LEVEL_ORDER.filter((k) => LEVELS[k].atmosphere.sky !== false);

  for (const key of levels) {
    const a = LEVELS[key].atmosphere;
    const meter = E.atmosphereMeter(a);
    const disp = E.skyDisplayShoulder(a, meter);
    const sun = E.sunDirection(a, new THREE.Vector3());
    const side = sun.clone().setY(0).normalize().cross(new THREE.Vector3(0, 1, 0)).setY(0.02).normalize();
    const anti = sun.clone().setY(0).normalize().multiplyScalar(-1).setY(0.02).normalize();
    const flat = sun.clone().setY(0.03).normalize();
    const up30 = sun.clone().setY(0).normalize().multiplyScalar(-Math.cos(Math.PI / 6)).setY(Math.sin(Math.PI / 6)).normalize();

    const dirs = {
      'zenith       ': new THREE.Vector3(0, 1, 0),
      'sky 30° anti ': up30,
      'skyline anti ': anti,
      'skyline side ': side,
      'skyline sun  ': flat,
    };
    const rows = [];
    const push = (name, lin) => {
      const d = through(lin, meter.exposure, a);
      const H = hsv(d[0], d[1], d[2]);
      const O = oklab(srgbToLinear(d[0]), srgbToLinear(d[1]), srgbToLinear(d[2]));
      rows.push({ name, lin, disp: d, hue: H.h, sat: H.s, val: H.v, okHue: O.h, okC: O.C });
    };
    for (const [name, dir] of Object.entries(dirs)) {
      push(name, E.skyShoulder(E.skyRadiance(dir, sun, a, new THREE.Color()), disp.knee, disp.ceil).toArray());
    }
    // What lights the shade: the hemisphere's sky colour and the fill, at the
    // strengths applyAtmosphere actually gives them, plus the ground bounce.
    const hemiI = (a.ambient ?? 0.85) * 0.45;
    const c = new THREE.Color(a.skyColor ?? 0xbcd8ff);
    push('shade: hemi ', [c.r * hemiI, c.g * hemiI, c.b * hemiI]);
    const f = new THREE.Color(a.fillColor ?? 0x9fc4ff), fi = a.fillIntensity ?? 0.25;
    push('shade: fill ', [f.r * fi, f.g * fi, f.b * fi]);
    const gb = new THREE.Color(a.groundColor ?? 0x60482e);
    const gk = Math.min(6, Math.max(0.02, (a.sunIntensity ?? 3.6) * Math.max(0.12, sun.y) / Math.PI));
    push('bounce: grnd', [gb.r * gk, gb.g * gk, gb.b * gk]);
    push('haze        ', E.hazeRadiance(a, new THREE.Color(), disp).toArray());
    const s = new THREE.Color(a.sunColor ?? 0xfff0d8);
    const sk = (a.sunIntensity ?? 3.6) * Math.max(sun.y, 0) / Math.PI;
    push('sunlit plate', [s.r * sk * 0.55, s.g * sk * 0.55, s.b * sk * 0.55]);

    console.log(`\n══ ${key}  exposure ${meter.exposure.toFixed(3)}  shoulder ${disp.knee.toFixed(3)}/${disp.ceil.toFixed(3)}`);
    console.log('   what                  linear rgb              display rgb        hueHSV  sat   hueOk   C');
    for (const r of rows) {
      console.log(`   ${r.name} ${r.lin.map((v) => fmt(v, 3, 6)).join(' ')}  ${r.disp.map((v) => fmt(v, 3, 6)).join(' ')}`
        + `  ${fmt(r.hue, 1, 6)}  ${fmt(r.sat, 3, 5)}  ${fmt(r.okHue, 1, 6)}  ${fmt(r.okC, 3, 5)}`);
    }
    const skyRows = rows.slice(0, 5);
    console.log(`   sky hue spread across the dome: ${hueSpread(skyRows.map((r) => r.hue)).toFixed(1)}°`
      + `   sky↔bounce ${Math.abs(hueDelta(rows[0].hue, rows[7].hue)).toFixed(1)}°`);

    // The three things in tools/checks that a change here can break.
    const ground = new THREE.Color(LEVELS[key].groundColor ?? 0xb09578);
    const fog = E.hazeRadiance(a, new THREE.Color());
    const lu = (x) => LUM(x.r, x.g, x.b);
    const chroma = Math.abs(fog.r / lu(fog) - ground.r / lu(ground)) + Math.abs(fog.b / lu(fog) - ground.b / lu(ground));
    const indirect = meter.skyFull * (meter.envI / 0.38) / meter.direct;
    console.log(`   CHECKS  haze↔ground chroma ${chroma.toFixed(3)} (>0.18)   indirect ${(indirect * 100).toFixed(0)}% (<=56%)`
      + `   authored key ${(meter.key * (a.exposure ?? 1.05)).toFixed(4)}   envI ${meter.envI.toFixed(3)} (>0.15)`);
  }

  // The one cross-level assertion: the authored exposures must still disagree.
  // Over every metered level rather than three named ones — the spread is a
  // claim about the whole roster, and two of the three it used to name are gone.
  const auth = [];
  for (const key of LEVEL_ORDER.filter((k) => LEVELS[k]?.atmosphere?.sky !== false)) {
    const a = LEVELS[key].atmosphere;
    auth.push(E.atmosphereMeter(a).key * (a.exposure ?? 1.05));
  }
  console.log(`\n   authored-key spread ${(Math.max(...auth) / Math.min(...auth)).toFixed(3)}:1 (must stay > 1.4)`);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Regions — the standing set, against the pinned pose below              */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * The six things the art direction note names, plus the painted ranges, which
 * changed under this lane this morning and have to be re-derived rather than
 * quoted. Boxes are x,y,w,h against the 1280×720 pinned pose in `frame`.
 */
const REGIONS = {
  arena: [
    ['sky sunward  ', 520, 4, 240, 56],     // the solar aureole, which fills most of the sky here
    ['sky mid      ', 1020, 8, 120, 48],
    ['sky anti-sun ', 1224, 6, 54, 70],     // the one patch of the dome that is not the aureole
    ['painted range', 1004, 108, 176, 40],  // the drawn skyline, = sky × RANGE_AIR
    ['mesa ring    ', 600, 204, 200, 76],   // the arena's own rim wall, 170 m out
    ['mesa ring R  ', 1160, 190, 110, 70],
    ['masonry      ', 96, 160, 118, 140],   // the colossus, 12 m out
    ['sand sunlit  ', 648, 620, 200, 80],
    ['sand shadowed', 88, 496, 130, 128],   // in the colossus's shadow
  ],
  // The other two outdoor levels' boxes are placed the same way (tools
  // arena-lane.mjs grid <png>) against their own pinned frame.
  dunes: [
    ['sky sunward  ', 520, 4, 240, 56],
    ['sky mid      ', 1020, 8, 120, 48],
    ['sky anti-sun ', 1224, 6, 54, 70],
    ['painted range', 1004, 108, 176, 40],
    ['far dune     ', 600, 204, 200, 76],
    ['mid ground   ', 1160, 190, 110, 70],
    ['near rock    ', 96, 160, 118, 140],
    ['sand sunlit  ', 648, 620, 200, 80],
    ['sand shadowed', 88, 496, 130, 128],
  ],
  canyon: [
    ['sky sunward  ', 520, 4, 240, 56],
    ['sky mid      ', 1020, 8, 120, 48],
    ['sky anti-sun ', 1224, 6, 54, 70],
    ['painted range', 1004, 108, 176, 40],
    ['far wall     ', 600, 204, 200, 76],
    ['wall R       ', 1160, 190, 110, 70],
    ['near rock    ', 96, 160, 118, 140],
    ['bed sunlit   ', 648, 620, 200, 80],
    ['bed shadowed ', 88, 496, 130, 128],
  ],
};

function regionStats(png, x, y, w, h) {
  const { width, height, bpp, data } = png;
  let r = 0, g = 0, b = 0, n = 0;
  for (let j = y; j < Math.min(y + h, height); j++) {
    for (let i = x; i < Math.min(x + w, width); i++) {
      const o = (j * width + i) * bpp;
      r += data[o] / 255; g += data[o + 1] / 255; b += data[o + 2] / 255; n++;
    }
  }
  r /= n; g /= n; b /= n;
  const H = hsv(r, g, b);
  const O = oklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  return { rgb: [r, g, b], lum: LUM(r, g, b), hue: H.h, sat: H.s, okHue: O.h, okC: O.C };
}

/**
 * A coarse map of the frame, so a region box is placed on the thing it is
 * named after instead of on whatever happens to be at those coordinates. The
 * first pass of this instrument had "sky high L" sitting on the colossus's
 * head, which measured 33° and would have been quoted as a sky hue.
 */
function grid(file, cols = parseInt(flag('cols', '16'), 10), rows = parseInt(flag('rows', '9'), 10)) {
  const png = decodePng(file);
  const cw = Math.floor(png.width / cols), ch = Math.floor(png.height / rows);
  console.log(`\n── ${basename(file)}  ${cols}×${rows} cells of ${cw}×${ch}px — "lum/hue" (hue blank under 0.05 sat)`);
  for (let j = 0; j < rows; j++) {
    let line = `  y${String(j * ch).padStart(3)} `;
    for (let i = 0; i < cols; i++) {
      const s = regionStats(png, i * cw, j * ch, cw, ch);
      line += `${s.lum.toFixed(2)}/${s.sat < 0.05 ? ' -- ' : s.hue.toFixed(0).padStart(4)} `;
    }
    console.log(line);
  }
  let hdr = '       ';
  for (let i = 0; i < cols; i++) hdr += `x${String(i * cw).padEnd(8)}`;
  console.log(hdr);
}

/**
 * THE NUMBER THE COMPLAINT WAS MADE IN.
 *
 * "Every element in the frame sits inside a ten-degree band of hue" is a claim
 * about the whole image, not about nine boxes, and nine boxes can be argued
 * with — put one on the one blue corner of the sky and the region spread jumps
 * to 170° while the picture is unchanged. So: take every pixel with enough
 * chroma for its hue to mean anything, and ask how wide an arc has to be to
 * hold half of them, four fifths of them, nineteen twentieths of them.
 *
 * The saturation floor is 0.06 rather than 0: below that the hue of an 8-bit
 * pixel is quantised to a handful of values and swings by tens of degrees on
 * ±1 in a channel, so including it would be measuring the encoder.
 */
function hueMass(png, floor = 0.06) {
  const { width, height, bpp, data } = png;
  const bins = new Float64Array(360);
  let kept = 0, total = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * bpp;
    const H = hsv(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255);
    total++;
    if (H.s < floor || H.v < 0.02) continue;
    bins[Math.floor(H.h) % 360]++; kept++;
  }
  // smallest arc holding a given fraction — scan every start, widen until full
  const arc = (frac) => {
    const want = kept * frac;
    let best = 360;
    for (let s = 0; s < 360; s++) {
      let acc = 0, w = 0;
      while (w < 360 && acc < want) { acc += bins[(s + w) % 360]; w++; }
      if (acc >= want && w < best) best = w;
    }
    return best;
  };
  console.log(`   HUE MASS over ${(100 * kept / total).toFixed(0)}% of pixels (sat ≥ ${floor}): `
    + `50% inside ${arc(0.5)}°, 80% inside ${arc(0.8)}°, 95% inside ${arc(0.95)}°`);
  return { p50: arc(0.5), p80: arc(0.8), p95: arc(0.95), kept: kept / total };
}

function reportHue(file, level) {
  const png = decodePng(file);
  const boxes = REGIONS[level] || REGIONS.arena;
  console.log(`\n── ${basename(file)}   ${png.width}×${png.height}`);
  console.log('   region           R     G     B     lum   HSVhue  sat    OkHue   OkC');
  const rows = [];
  for (const [name, x, y, w, h] of boxes) {
    const s = regionStats(png, x, y, w, h);
    rows.push({ name, ...s });
    console.log(`   ${name}  ${s.rgb.map((v) => fmt(v, 3, 5)).join(' ')} ${fmt(s.lum, 3, 6)}  ${fmt(s.hue, 1, 6)}  ${fmt(s.sat, 3, 5)}  ${fmt(s.okHue, 1, 6)}  ${fmt(s.okC, 3, 5)}`);
  }
  // Everything except the sky sits in the frame's warm family; the claim being
  // tested is about how wide that family is, so the spread is over ALL of it.
  const all = rows.map((r) => r.hue);
  console.log(`   HSV hue spread over ${rows.length} regions: ${hueSpread(all).toFixed(1)}°`
    + `    OkLab: ${hueSpread(rows.map((r) => r.okHue)).toFixed(1)}°`);
  hueMass(png);
  const sky = rows.filter((r) => r.name.startsWith('sky'));
  const lit = rows.find((r) => /sunlit/.test(r.name));
  const shd = rows.find((r) => /shadow/.test(r.name));
  if (sky.length && lit) {
    const gaps = sky.map((s) => Math.abs(hueDelta(s.hue, lit.hue)));
    console.log(`   sky ↔ sunlit ground: ${gaps.map((g) => g.toFixed(1)).join(' / ')}°`);
  }
  if (lit && shd) {
    console.log(`   sunlit ↔ shadowed ground (fixed boxes): ${Math.abs(hueDelta(lit.hue, shd.hue)).toFixed(1)}° HSV, `
      + `${Math.abs(hueDelta(lit.okHue, shd.okHue)).toFixed(1)}° OkLab, `
      + `Δ(B/R) ${(shd.rgb[2] / shd.rgb[0] - lit.rgb[2] / lit.rgb[0]).toFixed(3)}`);
  }
  warmCool(png);
  return rows;
}

/**
 * WARM LIGHT AND COOL SHADOW, without a hand-placed shadow.
 *
 * A fixed "sand shadowed" box is only in shadow while the sun stays where it
 * was — move the sun and the box measures lit sand, and the split-tone number
 * collapses to zero for a reason that has nothing to do with the grade. So take
 * the whole ground band (the bottom third of the frame is the fighting floor at
 * this pose and almost nothing else), split its pixels at the quartiles of
 * luminance, and compare the two ends. That is the same question — is light a
 * different colour from shade — asked in a way a sun cannot invalidate.
 */
function warmCool(png, top = 0.62) {
  const { width, height, bpp, data } = png;
  const y0 = Math.floor(height * top);
  const px = [];
  for (let j = y0; j < height; j++) {
    for (let i = 0; i < width; i += 2) {
      const o = (j * width + i) * bpp;
      const r = data[o] / 255, g = data[o + 1] / 255, b = data[o + 2] / 255;
      px.push([LUM(r, g, b), r, g, b]);
    }
  }
  px.sort((a, b) => a[0] - b[0]);
  const band = (lo, hi) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = Math.floor(px.length * lo); i < Math.floor(px.length * hi); i++) { r += px[i][1]; g += px[i][2]; b += px[i][3]; n++; }
    return [r / n, g / n, b / n];
  };
  const dark = band(0, 0.25), light = band(0.75, 1);
  const hd = hsv(...dark), hl = hsv(...light);
  const od = oklab(...dark.map(srgbToLinear)), ol = oklab(...light.map(srgbToLinear));
  console.log(`   GROUND BAND (bottom ${((1 - top) * 100).toFixed(0)}% of frame, luminance quartiles):`);
  console.log(`      lit  p75+  ${light.map((v) => fmt(v, 3, 5)).join(' ')}  lum ${LUM(...light).toFixed(3)}  hue ${hl.h.toFixed(1)}°  B/R ${(light[2] / light[0]).toFixed(3)}`);
  console.log(`      shade p25− ${dark.map((v) => fmt(v, 3, 5)).join(' ')}  lum ${LUM(...dark).toFixed(3)}  hue ${hd.h.toFixed(1)}°  B/R ${(dark[2] / dark[0]).toFixed(3)}`);
  console.log(`      warm/cool split: Δhue ${Math.abs(hueDelta(hl.h, hd.h)).toFixed(1)}° HSV / `
    + `${Math.abs(hueDelta(ol.h, od.h)).toFixed(1)}° OkLab, Δ(B/R) ${(dark[2] / dark[0] - light[2] / light[0]).toFixed(3)}, `
    + `tonal range ${(LUM(...light) / Math.max(1e-4, LUM(...dark))).toFixed(2)}:1`);
  return { dark, light };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  Booting                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

async function boot(level) {
  const { chromium } = await import('playwright-core');
  const { createServer } = await import('node:http');
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
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((lv) => {
    localStorage.setItem('saber.settings.v2', JSON.stringify({
      level: lv, quality: 'medium', resolutionScale: 0.6, difficulty: 'knight', mode: 'roguelite',
      volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6 }));
  }, level);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 120000 });
  await page.click('#btn-deploy', { timeout: 180000, noWaitAfter: true });
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 120000 });
  await page.waitForTimeout(2200);
  // FREEZE THE WEATHER. The arena's calm-air unrest alone was running its fog
  // 36% over the authored 0.0034 at t = 0, and a squall is worth 3×; nothing
  // about hue is measurable until this is off. Reached through the live object
  // graph, not through a fresh `import()` of Scenery.js — a second module
  // instance would give a Weather nobody reads and the freeze would silently
  // do nothing, which is exactly what the first version of this did.
  const frozen = await page.evaluate(async () => {
    const w = window.SABER.world;
    const W = w.atmosphere?.weather;
    if (W) { W.peak = 0; W.unrest = 0; W.update(0); }
    await new Promise((r) => requestAnimationFrame(r));
    return { intensity: W ? W.intensity : null, density: (w.scene.fog || {}).density };
  });
  await page.waitForTimeout(1200);
  const settled = await page.evaluate(() => ({
    intensity: window.SABER.world.atmosphere?.weather?.intensity,
    density: (window.SABER.world.scene.fog || {}).density,
  }));
  console.log(`weather frozen: intensity ${frozen.intensity} → ${settled.intensity}, `
    + `fog density ${frozen.density?.toFixed(5)} → ${settled.density?.toFixed(5)}`);
  return { page, browser, server, errors };
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  frame                                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

async function cmdFrame() {
  const level = flag('level', 'arena');
  const tag = flag('tag', 'now');
  const out = join(ROOT, '.smoke', 'lane-arena');
  mkdirSync(out, { recursive: true });
  const { page, browser, server, errors } = await boot(level);

  // The pinned pose: bowl centre, eye height, looking level across the level at
  // whatever the far side of it is. Identical to tools/skyshot.mjs so the two
  // lanes' plates are the same picture.
  const info = await page.evaluate(() => {
    const S = window.SABER, e = S.engine, w = S.world;
    const gy = w.terrain ? w.terrain.height(0, 0) : 0;
    const orig = e.render.bind(e);
    e.render = (dt) => {
      const c = e.camera;
      c.position.set(0, gy + 1.75, 30);
      c.lookAt(0, gy + 8, -180);
      c.updateMatrixWorld(true);
      orig(dt);
    };
    document.querySelector('#hud')?.classList.add('hidden');
    const fog = e.scene.fog;
    return {
      exposure: e.renderer.toneMappingExposure,
      fog: fog && { rgb: [fog.color.r, fog.color.g, fog.color.b], density: fog.density },
      grade: { saturation: e.composite.uniforms.uSaturation.value,
        lift: e.composite.uniforms.uLift.value.toArray(),
        gain: e.composite.uniforms.uGain.value.toArray() },
      sky: { knee: e.sky.material.uniforms.uSkyKnee?.value, ceil: e.sky.material.uniforms.uSkyCeil?.value },
      hemi: e.hemi.color.toArray(), fill: [e.fill.color.toArray(), e.fill.intensity],
    };
  });
  await page.waitForTimeout(3000);
  const file = join(out, `${tag}-${level}.png`);
  await page.screenshot({ path: file });
  await browser.close(); server.close();
  console.log(JSON.stringify(info));
  if (errors.length) console.log('ERRORS', errors.slice(0, 6));
  reportHue(file, level);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  plate — our own camera, our own target                                */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * Three tilings, one geometry, one light. The point of the controls is that a
 * lag-plane number means nothing on its own: LATTICE is the pathological case
 * the metric must be able to see, and if it cannot see it there the metric is
 * broken and no reading of SHIPPED is worth anything.
 *
 *   lattice  uHex.x widened past the whole map and the bearing gate shut, so
 *            all three hex taps collapse onto one cell: one bearing, one
 *            wavelength, one amplitude, one phase — the fixed 3.3 m lattice.
 *   phase    the cells are back, but the gate is still shut: per-cell phase
 *            only, which is what a poured deck ships with.
 *   shipped  everything on.
 */
const PLATE_MODES = ['shipped', 'phase', 'lattice'];

async function cmdPlate() {
  const level = flag('level', 'arena');
  const tag = flag('tag', 'now');
  const size = parseFloat(flag('size', '48'));
  const px = parseInt(flag('px', '512'), 10);
  const height = parseFloat(flag('height', '200'));
  const modes = (flag('modes', PLATE_MODES.join(','))).split(',');
  const out = join(ROOT, '.smoke', 'lane-arena');
  mkdirSync(out, { recursive: true });
  const { page, browser, server, errors } = await boot(level);

  const results = [];
  for (const mode of modes) {
    const r = await page.evaluate(async ({ size, px, height, mode }) => {
      const THREE = await import('/vendor/three/three.module.js');
      const S = window.SABER, e = S.engine, w = S.world, T = w.terrain;
      const LAYER = 9;

      // ── isolate the ground. Nothing here touches the game camera, the
      // composer or the update loop, so there is no race to lose.
      const savedMask = T.mesh.layers.mask;
      T.mesh.layers.set(LAYER);
      const lights = [];
      e.scene.traverse((o) => { if (o.isLight) { lights.push([o, o.layers.mask]); o.layers.enable(LAYER); } });
      // Prop shadows falling across the plate would be a signal of their own,
      // and shadow-map texel aliasing is very nearly a periodic one.
      const shadowWas = e.sun.castShadow; e.sun.castShadow = false;
      // And no haze: the plate is about the ground's own pattern. Density 0
      // makes the exp2 factor exactly 0 without recompiling anything.
      const fog = e.scene.fog, fogWas = fog ? fog.density : 0;
      if (fog) fog.density = 0;

      const hex = T._uniforms.uHex.value;
      const hexWas = hex.clone();
      if (mode === 'lattice') { hex.x = 4000; hex.y = 0; }
      else if (mode === 'phase') { hex.y = 0; }

      // ── the ripple frame. Screen +x runs ALONG the preset's wind, which is
      // the axis the tile's 3.3 m period is measured on; screen +y runs across
      // it, where the period is 3.3/uRipAspect metres.
      const wv = T.preset.wind || [1, 0];
      const wl = Math.hypot(wv[0], wv[1]) || 1;
      const d = { x: wv[0] / wl, z: wv[1] / wl };
      const upv = new THREE.Vector3(d.z, 0, -d.x);   // ⇒ camera right = (d.x, d.z)

      const cx = 0, cz = 0;
      const gy = T.height(cx, cz);
      const half = size / 2;
      const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, height + 400);
      cam.position.set(cx, gy + height, cz);
      cam.up.copy(upv);
      cam.lookAt(cx, gy, cz);
      cam.layers.set(LAYER);
      cam.updateMatrixWorld(true);

      let rt = null, buf = null, type = 'float';
      const clearWas = e.renderer.getClearColor(new THREE.Color());
      const clearAlphaWas = e.renderer.getClearAlpha();
      try {
        // FLOAT, so nothing clips. Rendering into a target skips tone mapping
        // (three only applies it when the destination is the default
        // framebuffer), so these are LINEAR radiances — which is what an
        // autocorrelation wants anyway: no S-curve compressing the very
        // contrast being measured.
        rt = new THREE.WebGLRenderTarget(px, px, {
          type: THREE.FloatType, format: THREE.RGBAFormat,
          colorSpace: THREE.LinearSRGBColorSpace, samples: 0,
          minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        });
        buf = new Float32Array(px * px * 4);
        e.renderer.setRenderTarget(rt);
        e.renderer.setClearColor(0x000000, 1);
        e.renderer.clear(true, true, false);
        e.renderer.render(e.scene, cam);
        e.renderer.readRenderTargetPixels(rt, 0, 0, px, px, buf);
      } catch (err) {
        type = 'error:' + String(err && err.message);
      }
      e.renderer.setRenderTarget(null);
      e.renderer.setClearColor(clearWas, clearAlphaWas);

      // ── put everything back, exactly.
      if (rt) rt.dispose();
      hex.copy(hexWas);
      if (fog) fog.density = fogWas;
      e.sun.castShadow = shadowWas;
      for (const [o, mask] of lights) o.layers.mask = mask;
      T.mesh.layers.mask = savedMask;

      if (!buf) return { type };
      // Luminance, linear, bottom-up rows as GL hands them over.
      const lum = new Float32Array(px * px);
      let mn = Infinity, mx = -Infinity, sum = 0, nonzero = 0;
      for (let i = 0; i < px * px; i++) {
        const v = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
        lum[i] = v; sum += v;
        if (v < mn) mn = v; if (v > mx) mx = v;
        if (v > 1e-6) nonzero++;
      }
      // base64 out; a 512² float plane is 1 MB, which is nothing next to a boot.
      // btoa, not the raw binary string — playwright serialises the return value
      // as JSON and a raw byte string comes back through UTF-8 mangled.
      let bin = '';
      const bytes = new Uint8Array(lum.buffer);
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      bin = btoa(bin);
      return { type, px, size, height, min: mn, max: mx, mean: sum / (px * px),
        coverage: nonzero / (px * px), wind: [d.x, d.z],
        aspect: T._uniforms.uRipAspect.value, tileM: 1 / T._uniforms.uScales.value.x,
        cellM: hexWas.x, b64: bin };
    }, { size, px, height, mode });

    if (!r.b64) { console.log(`${mode}: FAILED — ${r.type}`); continue; }
    const raw = Buffer.from(r.b64, 'base64');
    if (raw.byteLength !== r.px * r.px * 4) {
      throw new Error(`${mode}: got ${raw.byteLength} bytes back, expected ${r.px * r.px * 4} — the plate did not survive the page boundary`);
    }
    const f32 = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const name = `${tag}-${level}-${size}m-${mode}`;
    // Two files, and both say what they are: the plate is raw little-endian
    // float32 luminance, the sidecar is the metadata needed to read it.
    writeFileSync(join(out, name + '.meta.json'), JSON.stringify({
      px: r.px, size: r.size, height: r.height, tileM: r.tileM, aspect: r.aspect,
      cellM: r.cellM, wind: r.wind, mode, level,
    }, null, 1));
    writeFileSync(join(out, name + '.f32'), Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength));
    // preview: a plain gamma of the plate normalised to its own p1..p99
    const s = Float32Array.from(f32).sort();
    const lo = s[(s.length * 0.01) | 0], hi = s[(s.length * 0.99) | 0];
    const rgb = Buffer.alloc(r.px * r.px * 3);
    for (let y = 0; y < r.px; y++) {
      for (let x = 0; x < r.px; x++) {
        const v = clamp01((f32[(r.px - 1 - y) * r.px + x] - lo) / Math.max(1e-6, hi - lo));
        const g8 = Math.round(linearToSrgb(v) * 255);
        const o = (y * r.px + x) * 3;
        rgb[o] = rgb[o + 1] = rgb[o + 2] = g8;
      }
    }
    writeFileSync(join(out, name + '.png'), encodePng(r.px, r.px, rgb));
    console.log(`${name}: mean ${r.mean.toFixed(4)} range ${r.min.toFixed(4)}..${r.max.toFixed(4)} `
      + `coverage ${(r.coverage * 100).toFixed(1)}%  tile ${r.tileM.toFixed(2)} m  cell ${r.cellM.toFixed(2)} m  aspect ${r.aspect}`);
    results.push(join(out, name));
  }
  await browser.close(); server.close();
  if (errors.length) console.log('ERRORS', errors.slice(0, 6));
  for (const base of results) analyse(base);
  compare(results);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  lag — the measurement                                                 */
/* ══════════════════════════════════════════════════════════════════════ */

/** In-place radix-2 complex FFT. */
function fft(re, im, n, inverse) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function fft2(re, im, w, h, inverse) {
  const rr = new Float64Array(w), ri = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { rr[x] = re[y * w + x]; ri[x] = im[y * w + x]; }
    fft(rr, ri, w, inverse);
    for (let x = 0; x < w; x++) { re[y * w + x] = rr[x]; im[y * w + x] = ri[x]; }
  }
  const cr = new Float64Array(h), ci = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) { cr[y] = re[y * w + x]; ci[y] = im[y * w + x]; }
    fft(cr, ci, h, inverse);
    for (let y = 0; y < h; y++) { re[y * w + x] = cr[y]; im[y * w + x] = ci[y]; }
  }
}

/**
 * The autocorrelation lag plane of one plate.
 *
 * HIGH-PASS IN THE FREQUENCY DOMAIN, not by subtracting a box blur. The
 * previous harness detrended with a 41 px box and then could not tell whether
 * the peaks it found at 66–210 px lag were the tile or the dune's own shading
 * surviving the detrend — which is a fair worry, because a box blur's transfer
 * function has sidelobes and its stopband is not a stopband. The Gaussian
 * high-pass below has a stated response at every wavelength: at σ = 2.5 m it
 * keeps 100% of the 3.3 m tile, 82% of the 7.9 m cross-tile, and 6% of a 40 m
 * landform. Those three numbers are printed with the result.
 *
 * ZERO-PADDED to twice the plate, so the correlation is linear rather than
 * circular — an unpadded FFT autocorrelation wraps the plate onto itself and
 * manufactures a peak at exactly the plate size.
 */
function analyse(base, opts = {}) {
  const meta = JSON.parse(readFileSync(base + '.meta.json', 'utf8'));
  const raw = readFileSync(base + '.f32');
  const f32 = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const N = meta.px, mPerPx = meta.size / N;
  const sigmaM = opts.sigma ?? parseFloat(flag('sigma', '2.5'));

  const P = N * 2;
  const re = new Float64Array(P * P), im = new Float64Array(P * P);
  let mean = 0;
  for (let i = 0; i < N * N; i++) mean += f32[i];
  mean /= N * N;
  // Hann in both axes: the plate has hard edges and a rectangular window puts a
  // cross of sinc leakage through the middle of the lag plane.
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) re[y * P + x] = (f32[y * N + x] - mean) * win[y] * win[x];

  fft2(re, im, P, P, false);
  // Gaussian high-pass, exactly: H(f) = 1 − exp(−2π²σ²|f|²).
  const sPx = sigmaM / mPerPx;
  for (let y = 0; y < P; y++) {
    const fy = (y <= P / 2 ? y : y - P) / P;
    for (let x = 0; x < P; x++) {
      const fx = (x <= P / 2 ? x : x - P) / P;
      const H = 1 - Math.exp(-2 * Math.PI * Math.PI * sPx * sPx * (fx * fx + fy * fy));
      const o = y * P + x;
      re[o] *= H; im[o] *= H;
    }
  }
  // power spectrum → autocorrelation
  for (let i = 0; i < P * P; i++) { const a = re[i], b = im[i]; re[i] = a * a + b * b; im[i] = 0; }
  fft2(re, im, P, P, true);
  const zero = re[0];
  const acf = (lx, ly) => {              // lag in pixels, may be negative
    const x = ((lx % P) + P) % P, y = ((ly % P) + P) % P;
    return re[y * P + x] / zero;
  };
  const acfM = (dxM, dyM) => {           // bilinear, lag in metres
    const fx = dxM / mPerPx, fy = dyM / mPerPx;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    return acf(x0, y0) * (1 - tx) * (1 - ty) + acf(x0 + 1, y0) * tx * (1 - ty)
         + acf(x0, y0 + 1) * (1 - tx) * ty + acf(x0 + 1, y0 + 1) * tx * ty;
  };

  const tile = meta.tileM, cross = meta.tileM / meta.aspect;
  const maxLagPx = Math.min(N - 1, Math.round(20 / mPerPx));
  // the strongest correlation anywhere off the origin, and where it is
  let best = { v: -2, dx: 0, dy: 0 };
  for (let ly = -maxLagPx; ly <= maxLagPx; ly++) {
    for (let lx = -maxLagPx; lx <= maxLagPx; lx++) {
      const rr = Math.hypot(lx, ly) * mPerPx;
      if (rr < 0.9 || rr > 20) continue;
      const v = acf(lx, ly);
      if (v > best.v) best = { v, dx: lx * mPerPx, dy: ly * mPerPx };
    }
  }
  // The whole ridge either side of the nominal tile: the per-cell wavelength
  // spread is 0.72–1.52×, so a repeat would show up as a BAND of lags, not at
  // one lag, and sampling only 3.33 m could walk straight past it.
  let bandBest = { v: -2, d: 0 };
  for (let d = tile * 0.70; d <= tile * 1.55; d += mPerPx) {
    const v = acfM(d, 0);
    if (v > bandBest.v) bandBest = { v, d };
  }
  const keep = (lam) => 1 - Math.exp(-2 * Math.PI * Math.PI * sigmaM * sigmaM / (lam * lam));
  const lattice = {
    'tile  (λ,0)  ': acfM(tile, 0),
    'tile  (2λ,0) ': acfM(tile * 2, 0),
    'cross (0,μ)  ': acfM(0, cross),
    'both  (λ,μ)  ': acfM(tile, cross),
  };
  console.log(`\n── ${basename(base)}   ${N}px over ${meta.size} m (${mPerPx.toFixed(4)} m/px), `
    + `tile ${tile.toFixed(2)}×${cross.toFixed(2)} m, hex cell ${meta.cellM.toFixed(1)} m`);
  console.log(`   high-pass σ ${sigmaM} m keeps ${(keep(tile) * 100).toFixed(0)}% of the tile, `
    + `${(keep(cross) * 100).toFixed(0)}% of the cross-tile, ${(keep(40) * 100).toFixed(0)}% of a 40 m landform`);
  for (const [k, v] of Object.entries(lattice)) console.log(`   ACF at ${k} ${v >= 0 ? ' ' : ''}${v.toFixed(4)}`);
  console.log(`   best anywhere in the 0.72–1.52× wavelength band the cells can draw: `
    + `${bandBest.v.toFixed(4)} at ${bandBest.d.toFixed(2)} m`);
  console.log(`   strongest off-origin peak in 0.9–20 m: ${best.v.toFixed(4)} at `
    + `(${best.dx.toFixed(2)}, ${best.dy.toFixed(2)}) m, |lag| ${Math.hypot(best.dx, best.dy).toFixed(2)} m`);
  if (!opts.quiet) {
    // The profile, because four sampled numbers can miss a peak and a curve
    // cannot. Along the wind first — that is the axis the tile repeats on.
    const line = (dy, label) => {
      let s = `   ${label} `;
      for (let d = 0.5; d <= 12.01; d += 0.5) s += `${acfM(dy ? 0 : d, dy ? d : 0).toFixed(2).padStart(6)}`;
      return s;
    };
    let hdr = '   lag m    ';
    for (let d = 0.5; d <= 12.01; d += 0.5) hdr += `${d.toFixed(1).padStart(6)}`;
    console.log(hdr);
    console.log(line(0, 'along   '));
    console.log(line(1, 'across  '));
  }
  return { base, meta, lattice, best, bandBest, mPerPx, tile, cross, acfM, plate: f32, N, size: meta.size };
}

/**
 * THE POSITIVE CONTROL, and the reason any of the numbers above can be
 * believed.
 *
 * A metric that reports "no repeat" is worthless until it has been shown to
 * report "repeat" on something that certainly repeats. So: take the plate's
 * own top-left tile — λ along the wind by μ across it, the exact block the
 * stochastic tiler is there to stop recurring — stamp it edge to edge over a
 * plate of the same size, and push it through the identical pipeline. If the
 * lag plane does not light up at (λ, 0) here, the pipeline is broken and every
 * other row in this report is noise.
 */
function syntheticControl(a) {
  const N = a.N, mPerPx = a.size / N;
  const tw = Math.max(2, Math.round(a.tile / mPerPx));
  const th = Math.max(2, Math.round(a.cross / mPerPx));
  const tiled = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) tiled[y * N + x] = a.plate[(y % th) * N + (x % tw)];
  const tmp = join(ROOT, '.smoke', 'lane-arena', '_control');
  writeFileSync(tmp + '.meta.json', JSON.stringify({ ...a.meta, mode: 'CONTROL (tile stamped)' }));
  writeFileSync(tmp + '.f32', Buffer.from(tiled.buffer));
  return analyse(tmp, { quiet: true });
}

function compare(bases) {
  if (!bases.length) return;
  const rows = bases.map((b) => analyseQuiet(b));
  const ctrl = analyseQuiet(null, rows[0]);
  console.log('\n══ lag plane, side by side ═══════════════════════════════════');
  console.log('   mode        ACF(λ,0)  ACF(2λ,0)  ACF(0,μ)  ACF(λ,μ)  best in band    peak     at');
  for (const r of [...rows, ctrl]) {
    const L = r.lattice;
    console.log(`   ${r.meta.mode.padEnd(11)} ${fmt(L['tile  (λ,0)  '], 4, 8)} ${fmt(L['tile  (2λ,0) '], 4, 9)} `
      + `${fmt(L['cross (0,μ)  '], 4, 9)} ${fmt(L['both  (λ,μ)  '], 4, 8)} `
      + `${fmt(r.bandBest.v, 4, 8)}@${r.bandBest.d.toFixed(2)}m ${fmt(r.best.v, 4, 8)}  `
      + `(${r.best.dx.toFixed(2)}, ${r.best.dy.toFixed(2)}) m`);
  }
  console.log(`\n   The CONTROL row is the first plate's own λ×μ block stamped edge to edge. It is`);
  console.log(`   what "the tile repeats" looks like to this metric: ACF(λ,0) = ${ctrl.lattice['tile  (λ,0)  '].toFixed(3)}.`);
  console.log(`   Anything an order of magnitude under that is not a tiling artefact.`);
}
function analyseQuiet(base, forControl) {
  const log = console.log; console.log = () => {};
  try { return forControl ? syntheticControl(forControl) : analyse(base, { quiet: true }); }
  finally { console.log = log; }
}

/* ══════════════════════════════════════════════════════════════════════ */

if (CMD === 'atmos') await cmdAtmos();
else if (CMD === 'frame') await cmdFrame();
else if (CMD === 'plate') await cmdPlate();
else if (CMD === 'hue') { for (const f of positional()) reportHue(f, flag('level', 'arena')); }
else if (CMD === 'grid') { for (const f of positional()) grid(f); }
else if (CMD === 'lag') { const b = positional().map((s) => s.replace(/\.(meta\.json|f32|png)$/, '')); for (const x of b) analyse(x); compare(b); }
else {
  console.log('usage: arena-lane.mjs atmos|frame|plate|lag|hue …  (see the header)');
  process.exit(2);
}
