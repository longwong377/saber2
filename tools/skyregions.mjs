/**
 * The sky lane's standing set of regions, measured the same way every time so
 * before/after is a table rather than an argument. Wraps tools/pixels.mjs.
 *
 *   node tools/skyregions.mjs .smoke/lane-sky/before-full.png [more.png ...]
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// x,y,w,h against the pinned 1280x720 arena pose in tools/skyshot.mjs
const REGIONS = {
  'rim shaded': [600, 190, 60, 50],
  'rim shad R': [940, 210, 60, 50],
  'rim sunlit': [1070, 210, 60, 50],
  'sand near ': [360, 470, 60, 50],
  'sand mid  ': [900, 500, 60, 50],
  'sky sunward': [150, 60, 80, 60],
  'sky away  ': [1120, 30, 80, 60],
  'cloud lit ': [1000, 90, 70, 50],
  'cloud dark': [860, 130, 60, 40],
  'centre    ': [560, 300, 160, 120],
};

const ROOT = resolve(new URL('..', import.meta.url).pathname);
for (const png of process.argv.slice(2)) {
  const boxes = Object.values(REGIONS).map((b) => b.join(','));
  const out = JSON.parse(execFileSync('node', [resolve(ROOT, 'tools/pixels.mjs'), png, ...boxes], { encoding: 'utf8' }));
  console.log(`\n── ${png}`);
  console.log('  region        lum    sat    R     G     B     min   max   clip%');
  const rows = Object.keys(REGIONS);
  out.regions.forEach((r, i) => {
    const f = (v, n = 3) => v.toFixed(n).padStart(5);
    console.log(`  ${rows[i]}  ${f(r.lum)}  ${f(r.sat)} ${f(r.mean[0])} ${f(r.mean[1])} ${f(r.mean[2])} ${f(r.lmin)} ${f(r.lmax)} ${(r.clipped * 100).toFixed(2)}`);
  });
  const w = out.whole;
  console.log(`  WHOLE FRAME   ${w.lum.toFixed(3)}  ${w.sat.toFixed(3)} ${w.mean.map((v) => v.toFixed(3)).join(' ')}  clip ${(w.clipped * 100).toFixed(2)}%`);
}
