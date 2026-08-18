/**
 * PNG in and out, and a WebP's header, in Node with no dependency and no
 * browser.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT tools/pixels.mjs. `pixels.mjs` decodes
 * through Chromium, which is the right instrument for a one-off look at a
 * render: it uses the same codec the player's browser will. It is the wrong
 * instrument for anything that has to run often or inside tools/verify.mjs,
 * which drives eighty suites in workers on four cores — HANDOFF §2.6 is a long
 * record of what one heavy suite does to that run.
 *
 * Three jobs, and they are all downstream of the title plate:
 *
 *   decodePng / region   read the LOSSLESS INTERMEDIATE that tools/keyart.mjs
 *                        screenshots, and measure the composition on it. This
 *                        is where the ring and the header band are actually
 *                        judged, before any codec touches them.
 *   encodePng / quantise the PNG side of the format decision, and the reason
 *                        that decision is a measurement rather than an opinion
 *                        — see the table in tools/keyart.mjs. Chromium's own
 *                        canvas encoder returns 397 KB for a 710x300 frame of
 *                        this game where these return 143, so an argument made
 *                        against `toDataURL` would have been made against the
 *                        wrong number.
 *   webpInfo             the shipped plate is a WebP, and this is everything
 *                        about one that can be known without decoding it:
 *                        format and dimensions, straight out of the RIFF
 *                        container. tools/checks/keyart.mjs builds the whole
 *                        crop geometry on those two numbers.
 *
 * The decoder is deliberately narrow: 8-bit, non-interlaced, colour types
 * 0/2/3/4/6. Anything else THROWS rather than guessing — a decoder that
 * silently mis-reads a bit depth would hand every measurement below it a
 * plausible wrong answer, which is HANDOFF §2.3 wearing a codec.
 */

import { inflateSync, deflateSync } from 'node:zlib';

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

/**
 * And back the other way — because the browser's canvas encoder is not good
 * enough to decide a format on.
 *
 * `canvas.toDataURL('image/png')` gave 397 KB for a 710x300 frame of this
 * game. The same pixels through this function are 143 KB, and the only
 * difference is effort: Chromium encodes at a low zlib level with a fixed
 * filter, while this tries all five filters per row against the spec's own
 * minimum-sum-of-absolute-differences heuristic and deflates at level 9. That
 * 2.8x is the whole reason the shipped plate can be a PNG at all, and a PNG is
 * the reason tools/checks/keyart.mjs can measure it without a browser.
 *
 * @param {{width:number,height:number,rgba:Uint8Array}} img
 * @param {boolean} alpha keep the alpha channel (colour type 6) or drop it (2)
 */
export function encodePng(img, alpha = false) {
  const { width, height, rgba } = img;
  const bpp = alpha ? 4 : 3;
  const stride = width * bpp;
  const raw = Buffer.alloc(height * (stride + 1));
  const line = Buffer.alloc(stride);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride),
    Buffer.alloc(stride), Buffer.alloc(stride)];
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4, d = x * bpp;
      line[d] = rgba[s]; line[d + 1] = rgba[s + 1]; line[d + 2] = rgba[s + 2];
      if (alpha) line[d + 3] = rgba[s + 3];
    }
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v;
        if (f === 0) v = line[i];
        else if (f === 1) v = line[i] - a;
        else if (f === 2) v = line[i] - b;
        else if (f === 3) v = line[i] - ((a + b) >> 1);
        else {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = line[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        out[i] = v & 255;
        score += out[i] < 128 ? out[i] : 256 - out[i];
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
    prev = Buffer.from(cand[0]);          // filter 0 IS the unfiltered row, which is what `prev` means
  }

  const chunk = (type, data) => {
    const b = Buffer.alloc(8 + data.length + 4);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    data.copy(b, 8);
    b.writeInt32BE(crc32(b.subarray(4, 8 + data.length)) | 0, 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([SIG, chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9, memLevel: 9, strategy: 0 })),
    chunk('IEND', Buffer.alloc(0))]);
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * MEDIAN-CUT QUANTISATION TO A PALETTE, and an indexed PNG to put it in.
 *
 * This is the best a lossless format can do on a frame of this game, and
 * measuring it is what settled the shipped plate's format. On the 2560x1080
 * plate, every number produced by this repo:
 *
 *   truecolour, no posterise                       2783 KB
 *   truecolour, 24 levels per channel               749 KB
 *   indexed, median-cut to 256 colours              628 KB   ← this
 *   indexed, 64 colours (visibly banded)            360 KB
 *   webp q60 / q70 / q80                    86 / 96 / 130 KB
 *
 * It gets as far as it does because of the art direction rather than the
 * compressor: a cel frame is flat colour fields with hard ink outlines, so 256
 * entries is not a reduction the picture suffers — it is roughly what it
 * already had — and an index plane is one byte per pixel before deflate starts.
 * It is still six and a half times the WebP, which is why the plate is a WebP.
 * Luminance-sorting the palette and Z_RLE were both tried and both LOST (642
 * and 648 KB); the residual entropy is real structure, not a coding accident.
 *
 * NO DITHERING, deliberately and twice over. Dithering is per-pixel noise and
 * per-pixel noise is the one input a lossless compressor cannot pack — it would
 * give back everything the palette saved. And a cel renderer is the one place
 * where the artefact you get instead, banding, is indistinguishable from the
 * intent: styles.css's own header says fills are solid and a gradient is
 * allowed only where it is depicting light.
 *
 * The palette is built from a SUBSAMPLE (every `stride`-th pixel) and applied
 * through a 15-bit lookup table, because median cut over 2.8 million pixels and
 * a nearest-entry search per pixel are both minutes of work for an answer that
 * does not change: 170 000 samples is a hundred times more than 256 boxes need,
 * and two colours that fall in the same 32x32x32 cell were always going to
 * quantise together.
 */
export function quantise(img, colours = 256, stride = 16) {
  const { rgba } = img;
  const n = img.width * img.height;

  const box = [];
  for (let i = 0; i < n; i += stride) box.push(i * 4);
  let boxes = [box];
  while (boxes.length < colours) {
    /* Split the box with the largest extent on any channel — the standard
     * median cut. A box of one colour cannot be split and is left alone; if
     * every box is like that the image has fewer colours than the palette. */
    let pick = -1, best = -1, axis = 0;
    for (let b = 0; b < boxes.length; b++) {
      const px = boxes[b];
      if (px.length < 2) continue;
      const lo = [255, 255, 255], hi = [0, 0, 0];
      for (const p of px) {
        for (let c = 0; c < 3; c++) {
          if (rgba[p + c] < lo[c]) lo[c] = rgba[p + c];
          if (rgba[p + c] > hi[c]) hi[c] = rgba[p + c];
        }
      }
      for (let c = 0; c < 3; c++) {
        if (hi[c] - lo[c] > best) { best = hi[c] - lo[c]; pick = b; axis = c; }
      }
    }
    if (pick < 0 || best <= 0) break;
    const px = boxes[pick];
    px.sort((a, b) => rgba[a + axis] - rgba[b + axis]);
    const mid = px.length >> 1;
    boxes.splice(pick, 1, px.slice(0, mid), px.slice(mid));
  }

  const palette = boxes.map((px) => {
    let r = 0, g = 0, b = 0;
    for (const p of px) { r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2]; }
    return [Math.round(r / px.length), Math.round(g / px.length), Math.round(b / px.length)];
  });

  /* 15-bit cell → palette index, filled lazily. Every pixel that shares a cell
   * shares an answer, which turns a 2.8 M x 256 search into at most 32 768. */
  const lut = new Int16Array(32768).fill(-1);
  const index = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * 4;
    const key = ((rgba[s] >> 3) << 10) | ((rgba[s + 1] >> 3) << 5) | (rgba[s + 2] >> 3);
    let k = lut[key];
    if (k < 0) {
      let bd = Infinity;
      for (let j = 0; j < palette.length; j++) {
        const dr = rgba[s] - palette[j][0], dg = rgba[s + 1] - palette[j][1], db = rgba[s + 2] - palette[j][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; k = j; }
      }
      lut[key] = k;
    }
    index[i] = k;
  }
  return { width: img.width, height: img.height, index, palette };
}

/** An indexed PNG (colour type 3) from `quantise`'s output. */
export function encodeIndexedPng(q) {
  const { width, height, index, palette } = q;
  const raw = Buffer.alloc(height * (width + 1));
  const cand = [Buffer.alloc(width), Buffer.alloc(width)];
  let prev = Buffer.alloc(width);
  for (let y = 0; y < height; y++) {
    const row = index.subarray(y * width, (y + 1) * width);
    /* Only filters 0 (none) and 2 (up) are worth trying on an INDEX plane:
     * indices are labels, not magnitudes, so subtracting the neighbour to the
     * left is arithmetic on nonsense. `up` still helps, because two identical
     * scanlines are common in flat fields and difference to zero. */
    let s0 = 0, s2 = 0;
    for (let i = 0; i < width; i++) {
      cand[0][i] = row[i];
      const v = (row[i] - prev[i]) & 255;
      cand[1][i] = v;
      s0 += row[i] < 128 ? row[i] : 256 - row[i];
      s2 += v < 128 ? v : 256 - v;
    }
    const f = s2 < s0 ? 2 : 0;
    raw[y * (width + 1)] = f;
    (f === 2 ? cand[1] : cand[0]).copy(raw, y * (width + 1) + 1);
    prev = Buffer.from(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((c, i) => { plte[i * 3] = c[0]; plte[i * 3 + 1] = c[1]; plte[i * 3 + 2] = c[2]; });
  const chunk = (type, data) => {
    const b = Buffer.alloc(8 + data.length + 4);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'latin1');
    data.copy(b, 8);
    b.writeInt32BE(crc32(b.subarray(4, 8 + data.length)) | 0, 8 + data.length);
    return b;
  };
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9, memLevel: 9 })),
    chunk('IEND', Buffer.alloc(0))]);
}

/**
 * A WebP's own header, WITHOUT decoding it — which is the only thing about a
 * WebP that Node can know for free, and it turns out to be most of what a
 * check needs.
 *
 * The shipped title plate is a WebP because it is 96 KB against 628 for the
 * same 2560x1080 frame as the best PNG this file can make (indexed, 256
 * colours, level 9), and a 532 KB tax on every player so that a test can read
 * the pixels is not a trade a game that opens at a URL should make. See
 * tools/keyart.mjs for the whole table.
 *
 * What is lost with it is the pixel statistics, and they did not vanish: they
 * moved to the point the artefact is MADE. `tools/keyart.mjs --ship` measures
 * the composition and the header band on the lossless source and refuses to
 * write a plate that fails them, which is a better place to measure a
 * composition than after a lossy codec anyway.
 *
 * RIFF, three container shapes, no libraries:
 *   'VP8 '  lossy      — dimensions in the keyframe header, 14 bytes in
 *   'VP8L'  lossless   — 14 bits each, packed little-endian after a 0x2f sig
 *   'VP8X'  extended   — 24-bit minus-one dimensions in the chunk itself
 */
export function webpInfo(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF'
    || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('not a WebP (bad RIFF/WEBP header)');
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8X') {
    return { kind, width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (kind === 'VP8L') {
    if (buf[20] !== 0x2f) throw new Error('VP8L chunk without its 0x2f signature');
    const b = buf.readUInt32LE(21);
    return { kind, width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8 ') {
    // 3 bytes of frame tag, then the 3-byte start code 0x9d 0x01 0x2a
    if (!(buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a)) {
      throw new Error('VP8 chunk without its keyframe start code — this is not a still WebP');
    }
    return { kind, width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  throw new Error(`WebP chunk '${kind}' is none of VP8 / VP8L / VP8X`);
}
