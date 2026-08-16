/**
 * BATTLEFRONT BORZ — a flag an author sets has to mean something.
 *
 * Two defects, both found by auditing the player's own feature requests rather
 * than by anything failing, and both the signature bug of this codebase: code
 * that reads correctly and is silently inert.
 *
 *   `Prop.grippable` was WRITTEN AND NEVER READ. Props.js sets it false on
 *   exactly two things — the pillar and the spire — and Destruction's proxy for
 *   every destructible structure in the level sets it false too. Not one line
 *   in src/ or tools/ ever looked at it. The only real gate was mass, so at a
 *   high Force Power slider the 900 kg pillar the author had explicitly
 *   excluded came out of the ground anyway.
 *
 *   `lastGripRefusal` recorded the mass and the cap when a lift was refused,
 *   and nothing ever read those either. A refused lift was a groan and a
 *   shudder with no explanation, which reads as the Force being broken rather
 *   than as the thing being too heavy.
 *
 * The last check here is the general form, and it is the one worth keeping: a
 * field that only ever appears on the left of an assignment is not a feature.
 */
import { readFile, readdir } from 'node:fs/promises';
import { Player } from '../../src/game/Player.js';
import { LAYER } from '../../src/physics/RapierWorld.js';
import { lines } from './_source.mjs';

/** Every .js under src/, as [relative path, text]. */
async function sources() {
  const root = new URL('../../src/', import.meta.url);
  const out = [];
  const walk = async (dir, prefix) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) await walk(u, prefix + e.name + '/');
      else if (e.name.endsWith('.js')) out.push([prefix + e.name, await readFile(u, 'utf8')]);
    }
  };
  await walk(root, '');
  return out;
}

/** A body of the shape the physics layer hands the grip picker. */
function body(opts = {}) {
  return {
    invMass: opts.invMass ?? 1 / 40,
    layer: opts.layer ?? LAYER.PROP,
    dead: false,
    userData: opts.prop ? { prop: opts.prop } : {},
  };
}

export async function run({ check, assert }) {
  check('grip: a prop an author marked ungrippable cannot be gripped', () => {
    const me = { body: {} };
    const g = (b) => Player.prototype._grippableBody.call(me, b);

    assert(g(body({ prop: { grippable: true } })), 'an ordinary prop is not grippable');
    assert(g(body({ prop: {} })), 'a prop that never mentions grippable is not grippable');
    assert(g(body()), 'a loose body with no prop behind it is not grippable');
    assert(!g(body({ prop: { grippable: false } })),
      'a prop marked grippable:false was still grippable — the flag is inert again');

    // The flag must not become a way to grip something that is otherwise
    // ineligible, and it must not override the mass/layer gates either way.
    assert(!g(body({ invMass: 0, prop: { grippable: true } })),
      'a static body became grippable because a prop said so');
    return 'true / true / true / FALSE for grippable:false; a static stays static';
  });

  check('grip: a refused lift says why, with the numbers', async () => {
    // The refusal has to carry the mass, the cap AND name the control that
    // moves the cap. A number with no lever attached is just a wall.
    const src = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');
    // The REFUSAL SITE, not the first mention — the constructor initialises the
    // field, and a window measured from there reaches nothing.
    assert(src.includes('lastGripRefusal = {'), 'the refusal no longer records the mass and the cap');
    // The refusal and the notify that follows it: a neighbourhood, counted in
    // lines, so a comment added above the notify does not push it out of range.
    const near = lines(src, 'lastGripRefusal = {', 12);
    assert(/notify/.test(near), 'a refused lift still tells the player nothing');
    assert(/mass/.test(near) && /cap/.test(near),
      'the refusal message does not carry both the mass and the cap');
    assert(/Force Power/i.test(near),
      'the refusal does not name the setting that raises the cap, so the number is a dead end');
    return 'the refusal notifies with mass, cap and the name of the slider that moves it';
  });

  check('grip: no field is written everywhere and read nowhere', async () => {
    // THE GENERAL FORM, and the reason this suite exists. `grippable` was set in
    // two files and read in none. A field that only ever appears on the left of
    // an assignment is not a feature, it is a comment with syntax.
    //
    // Scoped to fields an AUTHOR sets to describe a thing — the ones where being
    // inert is silent — rather than every property in the codebase, because the
    // broad sweep is all false positives and a check nobody trusts gets deleted.
    const files = await sources();
    const WATCH = ['grippable', 'lastGripRefusal', 'invincible', 'explosive'];
    const rows = [];
    for (const field of WATCH) {
      let writes = 0, reads = 0;
      for (const [, text] of files) {
        const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        writes += (code.match(new RegExp(`\\.${field}\\s*=[^=]`, 'g')) || []).length;
        writes += (code.match(new RegExp(`(^|[{,\\s])${field}\\s*:`, 'gm')) || []).length;
        // A read is the name used anywhere it is NOT the target of an assignment.
        for (const m of code.matchAll(new RegExp(`\\b${field}\\b`, 'g'))) {
          const after = code.slice(m.index + field.length, m.index + field.length + 4);
          if (!/^\s*[:=][^=]/.test(after)) reads++;
        }
      }
      rows.push(`${field} ${writes}w/${reads}r`);
      // A field that does not exist is fine; a field that is WRITTEN and never
      // read is the bug. Deleting it is as valid a fix as giving it a reader.
      assert(writes === 0 || reads > 0,
        `${field} is written ${writes} times and read nowhere — it does nothing`);
    }
    return rows.join(', ');
  });
}
