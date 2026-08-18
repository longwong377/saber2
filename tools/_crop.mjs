// Crop and nearest-neighbour upscale a PNG, through the browser's own decoder.
// Usage: node tools/_crop.mjs <in.png> <out.png> x,y,w,h [zoom]
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const [inFile, outFile, box, zoomArg] = process.argv.slice(2);
const [x, y, w, h] = box.split(',').map(Number);
const zoom = Number(zoomArg || 2);
const b64 = readFileSync(inFile).toString('base64');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const out = await page.evaluate(async ({ b64, x, y, w, h, zoom }) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w * zoom; c.height = h * zoom;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h, 0, 0, w * zoom, h * zoom);
  return c.toDataURL('image/png').split(',')[1];
}, { b64, x, y, w, h, zoom });
writeFileSync(outFile, Buffer.from(out, 'base64'));
await browser.close();
console.log(outFile);
