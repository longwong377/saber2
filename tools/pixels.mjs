// Decode a PNG in a headless browser and report region statistics.
// Usage: node tools/pixels.mjs <png> [x,y,w,h ...]
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const regions = process.argv.slice(3).map((s) => s.split(',').map(Number));
const b64 = readFileSync(file).toString('base64');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const out = await page.evaluate(
  async ({ b64, regions }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const stat = (x, y, w, h) => {
      const d = ctx.getImageData(x, y, w, h).data;
      let r = 0, g = 0, b = 0, n = 0, hot = 0, lmin = 1, lmax = 0;
      const hist = new Array(16).fill(0);
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255;
        r += R; g += G; b += B; n++;
        const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        if (l > lmax) lmax = l;
        if (l < lmin) lmin = l;
        if (R > 0.96 && G > 0.96 && B > 0.96) hot++;
        hist[Math.min(15, (l * 16) | 0)]++;
      }
      const mr = r / n, mg = g / n, mb = b / n;
      return {
        mean: [+mr.toFixed(3), +mg.toFixed(3), +mb.toFixed(3)],
        lum: +(0.2126 * mr + 0.7152 * mg + 0.0722 * mb).toFixed(3),
        // saturation of the mean colour
        sat: +((Math.max(mr, mg, mb) - Math.min(mr, mg, mb)) / Math.max(1e-4, Math.max(mr, mg, mb))).toFixed(3),
        lmin: +lmin.toFixed(3),
        lmax: +lmax.toFixed(3),
        clipped: +((hot / n) * 100).toFixed(2),
        hist: hist.map((v) => +((v / n) * 100).toFixed(1)),
      };
    };

    const res = { size: [img.width, img.height], whole: stat(0, 0, img.width, img.height), regions: [] };
    for (const [x, y, w, h] of regions) res.regions.push({ box: [x, y, w, h], ...stat(x, y, w, h) });
    return res;
  },
  { b64, regions },
);
await browser.close();
console.log(JSON.stringify(out, null, 2));
