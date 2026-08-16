/**
 * BATTLEFRONT BORZ — sun height against shadow key share, for every outdoor
 * level, in the exact arithmetic `cel`'s "a shadow is READABLE" check uses.
 *
 * The second clause of that check is a Spearman rank correlation between the
 * two columns, and it cannot be moved by editing one number — you have to see
 * which levels are OUT OF ORDER before you can decide which of them is wrong.
 * That is the whole job of this file: print the table the check reasons over,
 * plus the individual rank displacements, so the two or three levels carrying
 * the loss are named rather than guessed at.
 *
 *   node --import ./tools/register.mjs tools/_celrank.mjs
 *
 * Engine.js is imported dynamically for HANDOFF §2.1: a static edge from a tool
 * to Engine.js patches the wrong copy of three and burns its once-only flags.
 */
import '../tools/dom-shim.mjs';

const CEL_SHADOW_BAND = 0.30;

function spearman(pairs) {
  // pairs: [[x, y, label], …] — returns rho over the ranks of x vs y.
  const n = pairs.length;
  const byX = [...pairs].sort((p, q) => p[0] - q[0]);
  const byY = [...pairs].sort((p, q) => p[1] - q[1]);
  let d2 = 0;
  const disp = [];
  byX.forEach((r, i) => {
    const d = i - byY.indexOf(r);
    d2 += d * d;
    disp.push([r[2], d]);
  });
  return { rho: 1 - (6 * d2) / (n * (n * n - 1)), d2, disp };
}

const E = await import('../src/engine/Engine.js');
const { LEVELS, LEVEL_ORDER } = await import('../src/game/Levels.js');
const { CEL } = await import('../src/toon/Cel.js').catch(() => ({ CEL: { shadowBand: CEL_SHADOW_BAND } }));
const band = CEL.shadowBand ?? CEL_SHADOW_BAND;

/* `--set level.field=value,…` applies overrides to the atmosphere blocks BEFORE
 * metering, so a candidate look can be measured against every bound at once
 * without editing Levels.js and re-running the whole suite each time. */
const SET = (process.argv.find((s) => s.startsWith('--set=')) || '').slice(6);
const overrides = {};
for (const pair of SET ? SET.split(',') : []) {
  const [lhs, v] = pair.split('=');
  const [lvl, field] = lhs.split('.');
  (overrides[lvl] ||= {})[field] = Number(v);
}

const OUT = LEVEL_ORDER.filter((k) => LEVELS[k] && LEVELS[k].atmosphere.sky !== false);
const rows = [];
for (const key of OUT) {
  const a = { ...LEVELS[key].atmosphere, ...(overrides[key] || {}) };
  const m = E.atmosphereMeter(a);
  const ambient = m.irradiance - m.direct;
  const shade = ambient + m.direct * band;
  const share = (m.direct * band) / shade;
  // The three terms that make up the ambient, so a fix names the knob it turns.
  const usedSky = m.skyFull * (m.envI / 0.38);
  /* THE CLOUD DECK, because it is the bound that bit when the sun came down.
   * `cloudLight().sun` is linear in `sunIntensity` while `skyDisplayShoulder`
   * rises as the meter re-exposes a dimmer level, so cutting a key moves the
   * two TOWARD each other twice over — and `sky.mjs` requires a sunlit cloud to
   * stay within 5% of the top of its own sky or the deck reads as smoke. */
  const L = E.cloudLight(a, m);
  const ceil = E.skyDisplayShoulder(a).ceil;
  rows.push({
    key, sunY: m.sunPos.y, share, direct: m.direct, ambient,
    elev: a.elevation ?? 22, sunI: a.sunIntensity ?? 3.6,
    amb: a.ambient ?? 0.85, ratio: m.irradiance / shade,
    usedSky, hemiFill: ambient - usedSky, ratio0: m.irradiance / ambient,
    indirect: usedSky / m.direct,
    floor: 1.2 + 4.6 * m.sunPos.y,
    cloudSun: L.sun, skyCeil: ceil, cloudBase: L.amb * 0.55,
    exposure: m.exposure, trim: m.trim, rawTrim: m.rawTrim, rawKey: m.key,
    authored: a.exposure ?? 1.05, renderedKey: m.key * m.exposure,
  });
}
rows.sort((p, q) => p.sunY - q.sunY);

if (SET) console.log(`OVERRIDES: ${SET}\n`);
console.log(`shadowBand ${band}   ${rows.length} outdoor levels, sorted by sun height\n`);
console.log('  rank  level        sunY     elev°  sunI  amb(auth)  direct  IBLsky  hemi+fill  ambient  key share  lit:shade');
rows.forEach((r, i) => {
  console.log(`  ${String(i).padStart(4)}  ${r.key.padEnd(11)}  ${r.sunY.toFixed(5)}  `
    + `${r.elev.toFixed(1).padStart(5)}  ${r.sunI.toFixed(2)}  ${r.amb.toFixed(2).padStart(9)}  `
    + `${r.direct.toFixed(3).padStart(6)}  ${r.usedSky.toFixed(3).padStart(6)}  `
    + `${r.hemiFill.toFixed(3).padStart(9)}  ${r.ambient.toFixed(3).padStart(7)}  `
    + `${(r.share * 100).toFixed(1).padStart(8)}%  ${r.ratio.toFixed(2)}:1`);
});

/* The neighbouring bounds, printed beside the one being tuned. Every one of
 * these has failed at some point while somebody moved a sun, and they all read
 * the same atmosphere block. */
console.log('\n  neighbouring bounds (cel keyShare>0.30, cel lit:shade 1.3–2.2, cel control >2.2,');
console.log('   lighting indirect<=0.50, lighting lit/shade >= 1.2+4.6·sunY):');
for (const r of rows) {
  const bad = [];
  if (r.share <= 0.30) bad.push(`keyShare ${(r.share * 100).toFixed(1)}% <= 30`);
  if (r.ratio < 1.3 || r.ratio > 2.2) bad.push(`lit:shade ${r.ratio.toFixed(2)} outside 1.3–2.2`);
  if (r.ratio0 <= 2.2) bad.push(`control ${r.ratio0.toFixed(2)} <= 2.2`);
  if (r.indirect > 0.50) bad.push(`indirect ${(r.indirect * 100).toFixed(0)}% > 50`);
  if (r.ratio0 < r.floor) bad.push(`lighting lit/shade ${r.ratio0.toFixed(2)} < ${r.floor.toFixed(2)}`);
  if (r.cloudSun < r.skyCeil * 0.95) {
    bad.push(`sky cloud top ${r.cloudSun.toFixed(3)} < 0.95 x sky ceil ${r.skyCeil.toFixed(3)}`);
  }
  if (r.cloudSun / Math.max(r.cloudBase, 1e-4) <= 2.2) {
    bad.push(`sky cloud lit:base ${(r.cloudSun / r.cloudBase).toFixed(2)} <= 2.2`);
  }
  if (r.exposure >= 3.0 || r.exposure <= 0.2) bad.push(`exposure on the clamp at ${r.exposure.toFixed(2)}`);
  console.log(`    ${r.key.padEnd(11)} ${bad.length ? 'FAIL  ' + bad.join('; ')
    : `ok    keyShare ${(r.share * 100).toFixed(1)}%  lit:shade ${r.ratio.toFixed(2)}  `
      + `control ${r.ratio0.toFixed(2)} (floor ${r.floor.toFixed(2)})  indirect ${(r.indirect * 100).toFixed(0)}%  `
      + `cloud ${r.cloudSun.toFixed(2)}/${r.skyCeil.toFixed(2)} (x${(r.cloudSun / r.skyCeil).toFixed(2)}, `
      + `${(r.cloudSun / r.cloudBase).toFixed(1)}:1)  exposure ${r.exposure.toFixed(2)}`}`);
}
/* THE METER IS A TRIM, NOT A NORMALISER — and this is the column to read when
 * a level renders brighter or darker than its author meant. `wanted` is how far
 * the meter would move this level if it could (KEY / key); `trim` is how far
 * METER_TRIM lets it. A level pinned on the bound is one whose atmosphere and
 * whose `exposure` are pulling the same way, which is usually what was meant —
 * what it is NOT any more is a level normalised onto everybody else's key.
 * `rendered` is the mid-grey the frame actually lands on, and the ordering of
 * that column against `authored` is what the art direction lives in. */
console.log('\n  the meter, as a trim (rendered = key × exposure; a level authored dark must render dark):');
console.log('    level        authored  wanted   trim   exposure   key      rendered');
for (const r of [...rows].sort((p, q) => p.renderedKey - q.renderedKey)) {
  console.log(`    ${r.key.padEnd(11)} ${r.authored.toFixed(2).padStart(8)} `
    + `${('×' + r.rawTrim.toFixed(2)).padStart(7)} ${('×' + r.trim.toFixed(2)).padStart(6)}`
    + `${r.rawTrim > r.trim * 1.005 ? ' (held)' : r.rawTrim < r.trim * 0.995 ? ' (held)' : '       '}`
    + ` ${r.exposure.toFixed(3).padStart(7)} ${r.rawKey.toFixed(4).padStart(8)} `
    + `${r.renderedKey.toFixed(4).padStart(8)}`);
}

const ind = [...rows].map((r) => [r.sunY, r.indirect, r.key]);
for (let i = 1; i < ind.length; i++) {
  if (!(ind[i][1] < ind[i - 1][1])) {
    console.log(`    ORDERING FAIL ${ind[i][2]} has a higher sun than ${ind[i - 1][2]} and no less indirect light`);
  }
}

const pairs = rows.map((r) => [r.sunY, r.share, r.key]);
const { rho, d2, disp } = spearman(pairs);
console.log(`\nSpearman rho = ${rho.toFixed(4)}   (sum d^2 = ${d2}, n = ${rows.length}); bound is 0.90`);
console.log('\n  rank displacement (sun-height rank minus key-share rank; 0 is in order):');
for (const [label, d] of disp) {
  if (d !== 0) console.log(`    ${label.padEnd(11)} ${d > 0 ? '+' : ''}${d}`);
}
const clean = disp.filter(([, d]) => d === 0).map(([l]) => l);
console.log(`    in order: ${clean.join(', ') || '(none)'}`);

// The pairwise clause too, so a fix for one is not a break for the other.
console.log('\n  pairwise clause (sun >10% higher must take more from the key):');
let bad = 0;
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    if (rows[j].sunY <= rows[i].sunY * 1.10) continue;
    if (rows[j].share <= rows[i].share) {
      bad++;
      console.log(`    VIOLATION ${rows[j].key} (sunY ${rows[j].sunY.toFixed(4)}, `
        + `${(rows[j].share * 100).toFixed(1)}%) vs ${rows[i].key} (sunY ${rows[i].sunY.toFixed(4)}, `
        + `${(rows[i].share * 100).toFixed(1)}%)`);
    }
  }
}
if (!bad) console.log('    clean');

const shares = rows.map((r) => r.share);
console.log(`\n  span ${(Math.max(...shares) / Math.min(...shares)).toFixed(2)}x `
  + `(${(Math.min(...shares) * 100).toFixed(1)}% → ${(Math.max(...shares) * 100).toFixed(1)}%); bound is 1.50x`);
console.log(`  floor: lowest key share ${(Math.min(...shares) * 100).toFixed(1)}%; bound is 30%`);
