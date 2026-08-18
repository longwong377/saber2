/**
 * A PNG decoder, in Node, with no dependency and no browser.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT tools/pixels.mjs. `pixels.mjs` decodes
 * through Chromium, which is the right instrument for a one-off look at a
 * render: it uses the same codec the player's browser will. It is the wrong
 * instrument for a CHECK. tools/verify.mjs runs eighty suites in workers on
 * four cores and HANDOFF §2.6 is a long record of what a heavy suite does to
 * that run; launching a browser inside the gate to read one image is exactly
 * the shape that made `cloth-cost` un-runnable for a session.
 *
 * So the shipped title plate is a PNG rather than a WebP, and this reads it.
 * That is a real cost — see tools/keyart.mjs for the byte comparison — and it
 * buys one thing: the check measures THE BYTES THE BROWSER WILL LOAD, not a
 * sidecar of statistics that somebody promised were true of them. A committed
 * table of "the mean luminance of the wordmark band is 0.07" beside an image
 * nothing re-reads is HANDOFF §2.3's signature defect with a picture in it.
 *
 * Deliberately narrow: 8-bit, non-interlaced, colour types 0/2/3/4/6. Anything
 * else THROWS rather than guessing — a decoder that silently mis-reads a bit
 * depth would hand every measurement below it a plausible wrong answer, which
 * is the other half of §2.3.
 */

import { inflateSync } from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** channels per pixel, by PNG colour type. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * @param {Buffer} buf raw file bytes
 * @returns {{width:number,height:number,rgba:Uint8Array,colorType:number,palette:number}}
 */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG (bad signature)');

  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let plte = null, trns = null;
  const idat = [];

  for (let off = 8; off + 8 <= buf.length;) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;                                   // 4 len + 4 type + len + 4 crc
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }

  if (depth !== 8) throw new Error(`PNG bit depth ${depth} — this decoder reads 8 only`);
  if (interlace !== 0) throw new Error('interlaced PNG — this decoder reads non-interlaced only');
  const ch = CHANNELS[colorType];
  if (!ch) throw new Error(`PNG colour type ${colorType} is not one of 0/2/3/4/6`);
  if (colorType === 3 && !plte) throw new Error('indexed PNG with no PLTE chunk');
  if (!idat.length) throw new Error('PNG has no IDAT');

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = ch;                                      // bytes per pixel at depth 8
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);

  /* Unfilter. The five filter types are the spec's, byte for byte; `a` is the
   * pixel to the left, `b` above, `c` above-left, all zero off the edge. */
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = (y * (stride + 1)) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y > 0 ? out[up + i] : 0;
      const c = (y > 0 && i >= bpp) ? out[up + i - bpp] : 0;
      let v;
      if (ft === 0) v = x;
      else if (ft === 1) v = x + a;
      else if (ft === 2) v = x + b;
      else if (ft === 3) v = x + ((a + b) >> 1);
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`PNG filter type ${ft} on row ${y}`);
      out[dst + i] = v & 255;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const s = i * bpp, d = i * 4;
    if (colorType === 2) { rgba[d] = out[s]; rgba[d + 1] = out[s + 1]; rgba[d + 2] = out[s + 2]; rgba[d + 3] = 255; }
    else if (colorType === 6) { rgba[d] = out[s]; rgba[d + 1] = out[s + 1]; rgba[d + 2] = out[s + 2]; rgba[d + 3] = out[s + 3]; }
    else if (colorType === 0) { rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = 255; }
    else if (colorType === 4) { rgba[d] = rgba[d + 1] = rgba[d + 2] = out[s]; rgba[d + 3] = out[s + 1]; }
    else { const p = out[s] * 3; rgba[d] = plte[p]; rgba[d + 1] = plte[p + 1]; rgba[d + 2] = plte[p + 2];
      rgba[d + 3] = trns && out[s] < trns.length ? trns[out[s]] : 255; }
  }
  return { width, height, rgba, colorType, palette: plte ? plte.length / 3 : 0 };
}

/**
 * Region statistics on a decoded image, in FRACTIONS of the frame.
 *
 * Everything is display-referred sRGB, deliberately — the questions this
 * answers are all "can a player read the type over this" and "is there
 * anything there to look at", and both are about the picture on the screen and
 * not about radiance. `sd` is the standard deviation of luminance, which is
 * the whole "is it busy" measurement: a flat wash reads near 0 and a lit
 * silhouette against a sky reads high.
 *
 * `edge` is the mean absolute luminance step to the right/down neighbour,
 * sampled on a grid. It separates the two ways a band can score high on `sd` —
 * a smooth gradient across it (low edge) versus real drawn detail in it (high
 * edge) — and it is the ink-outline detector, because the one thing this
 * renderer puts everywhere is a hard black line on a silhouette.
 */
export function region(img, fx, fy, fw, fh, step = 1) {
  const x0 = Math.max(0, Math.round(fx * img.width));
  const y0 = Math.max(0, Math.round(fy * img.height));
  const x1 = Math.min(img.width, Math.round((fx + fw) * img.width));
  const y1 = Math.min(img.height, Math.round((fy + fh) * img.height));
  const d = img.rgba;
  const L = (x, y) => {
    const i = (y * img.width + x) * 4;
    return (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  };
  let n = 0, s = 0, ss = 0, lmin = 1, lmax = 0, e = 0, en = 0;
  let r = 0, g = 0, b = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const l = L(x, y);
      n++; s += l; ss += l * l;
      if (l < lmin) lmin = l;
      if (l > lmax) lmax = l;
      const i = (y * img.width + x) * 4;
      r += d[i] / 255; g += d[i + 1] / 255; b += d[i + 2] / 255;
      if (x + step < x1) { e += Math.abs(L(x + step, y) - l); en++; }
      if (y + step < y1) { e += Math.abs(L(x, y + step) - l); en++; }
    }
  }
  const mean = n ? s / n : 0;
  return {
    px: n,
    lum: +mean.toFixed(4),
    sd: +Math.sqrt(Math.max(0, ss / Math.max(1, n) - mean * mean)).toFixed(4),
    lmin: +lmin.toFixed(4), lmax: +lmax.toFixed(4),
    edge: +(en ? e / en : 0).toFixed(4),
    rgb: [+(r / Math.max(1, n)).toFixed(3), +(g / Math.max(1, n)).toFixed(3), +(b / Math.max(1, n)).toFixed(3)],
  };
}
