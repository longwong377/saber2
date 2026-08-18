/**
 * AN OPTION HANDED TO A BUILDER THAT THE BUILDER DOES NOT READ.
 *
 * Four call sites in Levels.js asked `addCrateStack` for
 * `{ count: 2 + (rng() * 4 | 0) }`. The builder read `size`, `tiers`,
 * `columns`, `seed`, `yaw`, `dynamic` and `quaternion`, and had never read
 * `count` — so four crate stacks in the shipped game were the default eight to
 * twelve boxes instead of the two to five their call sites asked for, on four
 * different levels, and nothing anywhere said so. They survived two
 * adversarial audits and a judging pass, because there is nothing to see: the
 * call site reads correctly, the builder reads correctly, and the defect is
 * only in the space between them.
 *
 * Looking for the rest of them found five more of exactly the same shape, and
 * three of them were doing visible damage:
 *
 *   addCableRun({ sag })      × 2   the maker's droop option is `slack`, a
 *                                   fraction of span; both call sites wrote
 *                                   `sag` in metres and got the 9% default.
 *                                   MEASURED on the hangar's own 80 m run,
 *                                   anchored at 8.0 m: the cable bottoms out
 *                                   26 m below its low anchor — eighteen
 *                                   metres under the deck it is strung over.
 *   addCrateStack({ kit })    × 1   the file's whole composition convention,
 *                                   documented in its own header, and this one
 *                                   maker did not implement it: the stack was
 *                                   emitted at its KIT-SPACE position in world
 *                                   coordinates, beside the level origin.
 *   makeSpire({ mat })        × 1   ignored; the level asked for its own stone
 *                                   and got the hard-coded default, which
 *                                   happened to be the same material, which is
 *                                   the only reason nobody saw it.
 *   addRailing({ lift: 0 })   × 1   dead option, passed by addStair itself.
 *
 * ════ WHAT THIS CHECK PINS ═════════════════════════════════════════════
 *
 * Two halves of one question, neither of them a list anybody maintains:
 *
 *  1. Every builder REFUSES what it does not read. Enumerated off the module's
 *     own exports — a builder added next year is covered without anyone
 *     remembering this file exists — and tested by calling it, so it is the
 *     behaviour that is pinned and not the presence of a line of source.
 *
 *  2. No call site HANDS one anything unread. `Props.optionKeys` answers what
 *     a builder reads (from the builder's own source, at runtime, so it cannot
 *     drift), `tools/_optscan.mjs` answers what a call site passes (from the
 *     source, so it also sees the code no level runs — which is where the
 *     `{ kit }` one was hiding).
 *
 * The runtime guard is the authority and this is the net under it: the guard
 * only fires on a call that actually runs, and the pass that carried the
 * `{ kit }` defect — `cut()`, the Cut's dressing, since deleted for having had
 * no caller anywhere in the tree — never ran at all. A source sweep saw it
 * anyway, which is the whole argument and holds for the next orphan.
 */

import * as P from '../../src/world/Props.js';
import { optionKeys, assertOpts } from '../../src/world/Props.js';
import { callSites } from '../_optscan.mjs';

const SRC = ['src/world/Props.js', 'src/world/Scenery.js', 'src/world/Trees.js',
  'src/world/Destruction.js', 'src/world/Terrain.js', 'src/world/Particles.js',
  'src/game/Levels.js', 'src/game/World.js', 'src/game/Waves.js', 'src/game/Enemy.js',
  'src/main.js'];

/**
 * The builders, off the module's exports. `add*` and `make*` is the file's own
 * stated convention for "a thing a level places" (see its header), and taking
 * an `opts` is what makes one checkable at all.
 */
function builders() {
  const out = [];
  for (const [name, fn] of Object.entries(P)) {
    if (typeof fn !== 'function' || !/^(add|make)[A-Z]/.test(name)) continue;
    const params = /^[^(]*\(([^)]*)\)/.exec(fn.toString());
    if (!params) continue;
    const at = params[1].split(',').findIndex((p) => /^\s*opts\b/.test(p));
    if (at < 0) continue;
    out.push({ name, fn, at, arity: params[1].split(',').length });
  }
  return out;
}

export function run({ check, assert }) {

  check('builders: a builder refuses an option it does not read', () => {
    /* CALLED, not read. A regex over the source for `assertOpts(` would pass
     * on a builder that guards the wrong function, or guards it after doing
     * the work — and the guard is only worth anything as the first statement,
     * because a builder that throws halfway through has already put half of
     * itself in the scene.
     *
     * Which is also what makes the call cheap to make here: the guard runs
     * before the builder touches any other argument, so every one of them can
     * be invoked with nothing but a bad option in the right parameter slot.
     * The slot is read off the builder's own parameter list. A builder that
     * does NOT throw gets as far as dereferencing a null world and throws
     * something else, so the message is checked too. */
    const bad = [];
    const rows = [];
    for (const { name, fn, at, arity } of builders()) {
      const args = new Array(Math.max(arity, at + 1)).fill(undefined);
      args[at] = { __notAnOptionOfAnything: 1 };
      let msg = null;
      try { fn(...args); } catch (e) { msg = String(e && e.message); }
      if (!msg || !msg.includes('__notAnOptionOfAnything') || !msg.includes(name)) {
        bad.push(`${name} (${msg ? 'threw: ' + msg.slice(0, 60) : 'did not refuse it'})`);
      }
      const keys = optionKeys(fn);
      rows.push(`${name} ${keys ? keys.size : '?'}`);
    }
    assert(builders().length >= 40, `only ${builders().length} builders found — the enumeration is broken`);
    assert(bad.length === 0, `${bad.length} builders accept an option they do not read: ${bad.join('; ')}`);
    return `${rows.length} builders, all refusing; keys per builder ${
      Math.min(...rows.map((r) => +r.split(' ')[1]))}–${Math.max(...rows.map((r) => +r.split(' ')[1]))}`;
  });

  check('builders: the guard reads the same option list the builder does', () => {
    /* The derivation, held against three builders whose option lists are known
     * by reading them — one plain, one that inherits from the kit helpers, one
     * that spreads into a Prop. Not a restatement of the whole table: the
     * point is that the scan sees each of the three WAYS an option reaches a
     * builder, since a scan that quietly missed one of them would wave through
     * every option that arrives that way. */
    const own = optionKeys(P.addCrateStack);
    for (const k of ['size', 'tiers', 'columns', 'seed', 'yaw', 'dynamic', 'count'])
      assert(own.has(k), `addCrateStack reads ${k} and the derivation missed it`);
    for (const k of ['kit', 'quaternion', 'collide', 'castShadow'])
      assert(own.has(k), `addCrateStack inherits ${k} from the kit helpers and the derivation missed it`);
    assert(!own.has('sag'), 'addCrateStack does not read sag and the derivation invented it');
    const spire = optionKeys(P.makeSpire);
    for (const k of ['mat', 'hp', 'toughness', 'explosive'])
      assert(spire.has(k), `makeSpire forwards ${k} to Prop and the derivation missed it`);
    // and the refusal names what it refused, which is the whole value of it
    let msg = '';
    try { assertOpts(P.addCrateStack, { tiers: 2, tires: 2 }); } catch (e) { msg = e.message; }
    assert(/tires/.test(msg) && !/\btiers\b,/.test(msg.split('reads:')[0]),
      `the refusal did not name the offending key: ${msg}`);
    return `addCrateStack ${own.size} keys, makeSpire ${spire.size}, refusal names the key`;
  });

  check('builders: nothing hands a builder an option it does not read', async () => {
    const { readFile } = await import('node:fs/promises');
    const names = new Set(builders().map((b) => b.name));
    const bad = [];
    let sites = 0, spread = 0;
    for (const f of SRC) {
      let src;
      try { src = await readFile(new URL('../../' + f, import.meta.url), 'utf8'); } catch { continue; }
      for (const site of callSites(src, names)) {
        const known = optionKeys(P[site.name]);
        if (!known) continue;                       // forwards everything; unanswerable
        if (site.spread) { spread++; continue; }    // half the object is invisible here
        sites++;
        const unknown = site.keys.filter((k) => !known.has(k));
        if (!unknown.length) continue;
        bad.push(`${f}:${src.slice(0, site.at).split('\n').length} ${site.name}({ ${unknown.join(', ')} }) — `
          + `it reads ${[...known].sort().join(' ')}`);
      }
    }
    /* The floor is a tripwire on the SCANNER, not a fact about the tree: it is
     * well under the 86 sites it reads today, and it is here because a scanner
     * that silently stopped matching would otherwise report a clean sweep of
     * nothing. */
    assert(sites > 60, `only ${sites} builder call sites found — the scanner is not reading the tree`);
    assert(bad.length === 0, `${bad.length} call sites hand a builder something it drops:\n    ${bad.join('\n    ')}`);
    return `${sites} literal call sites across ${SRC.length} files, ${spread} skipped for a spread`;
  });
}
