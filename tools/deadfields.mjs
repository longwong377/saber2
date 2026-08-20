/**
 * BATTLEFRONT BORZ — instance fields that are WRITTEN AND NEVER READ.
 *
 *     node tools/deadfields.mjs
 *
 * The same defect this project keeps finding, in its third costume. A label
 * with no mechanic behind it is one; a mechanism with nothing on the other end
 * is the second — `activeCuts`, cloned every contact and read by no file in any
 * commit — and this is the third: `this.something = value` on a hot path, with
 * nothing anywhere that ever asks for it.
 *
 * It costs a write per frame, which is nothing. What it actually costs is
 * BELIEF. `AudioEngine.musicMissing` was written three times and read nowhere,
 * and TWO comments named it as the thing the options screen reads when a track
 * fails to load — the screen reads a callback, and the field beside it was
 * scenery. A reader trusting those comments would have built the next feature
 * on a field that has never carried a value to anyone.
 *
 * ── WHAT THIS IS AND IS NOT ──────────────────────────────────────────────
 *
 * It is a SHORTLIST, not a verdict. An earlier attempt at the same shape — a
 * detector for a constant with a hand-copied twin — returned 421 hits with no
 * precision and was abandoned rather than tuned, which is the right outcome
 * for a tool that cannot be believed. This one is kept because its hit rate is
 * about 2% of the fields it scans and, the first time it was run, a third of
 * the list was already independently confirmed dead.
 *
 * Three ways it can be wrong, all of them in the direction of over-reporting:
 *
 *   · A field read through a computed key — `obj[name]`, a destructure, a
 *     spread. The scan looks for the name as a string and as a bare identifier
 *     before `,` `}` `:` to cover most of that, and cannot cover all of it.
 *   · A field a SUBCLASS or an outside consumer reads. src/ and tools/ are both
 *     scanned for reads; anything else is out of view.
 *   · A field that is deliberately write-only — instrumentation a debugger
 *     attaches to, or state kept for a reader that is coming. Those are real
 *     answers; they want a comment saying so, not a deletion.
 *
 * So: read the list, check each one, and either delete it or write down why it
 * stays. Do not delete from this output alone.
 */
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const walk = (dir, into) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'vendor') walk(p, into); }
    else if (/\.(js|mjs)$/.test(e.name)) into.push(p);
  }
};

/* Comments first. Two of the three worst offenders this found were NAMED in a
 * comment as something a screen reads — count those as reads and the tool goes
 * blind exactly where it is most useful. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const written = [], readable = [];
walk(`${ROOT}/src`, written);
walk(`${ROOT}/src`, readable);
walk(`${ROOT}/tools`, readable);

const all = readable.map((f) => strip(readFileSync(f, 'utf8'))).join('\n');
const writes = new Map();
for (const f of written) {
  strip(readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
    const m = /(?:^|[\s;{(])this\.([A-Za-z_][A-Za-z0-9_]*)\s*(?:=[^=]|\+=|-=)/.exec(line);
    if (!m) return;
    const at = `${f.slice(ROOT.length + 1)}:${i + 1}`;
    if (writes.has(m[1])) writes.get(m[1]).push(at); else writes.set(m[1], [at]);
  });
}

const dead = [];
for (const [name, at] of writes) {
  const read = new RegExp(`\\.${name}\\b(?!\\s*(?:=[^=]|\\+=|-=))`, 'g');
  const indirect = new RegExp(`['"\`]${name}['"\`]|\\b${name}\\s*[,}:]`, 'g');
  if (!(all.match(read) || []).length && !(all.match(indirect) || []).length) dead.push([name, at]);
}
dead.sort((a, b) => a[0].localeCompare(b[0]));

console.log(`${writes.size} distinct instance fields are written in src/.`);
console.log(`${dead.length} of them are never read, in src/ or in tools/:\n`);
for (const [n, at] of dead) console.log(`  ${n.padEnd(20)} ${at.join(', ')}`);
console.log('\nA shortlist, not a verdict — see the header before deleting anything.');
