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

  /* ────────────────────────────────────────────────────────────────────
   * THE OPEN WINDOW — FLAGSHIP §7's third verb, and what bounds it
   * ──────────────────────────────────────────────────────────────────── */

  await check('grip: a shove hard enough to leave its feet leaves it on the ground, and a body on the ground is open', async () => {
    /**
     * ── THE DEFECT, WHICH WAS A COMMENT THAT NOTHING IMPLEMENTED ──────────
     *
     * `Enemy.applyKnockback` carried `// hit hard enough to leave its feet`
     * over `this.stun(1.2, impulse, 1.4)`. A stun is a body STANDING STILL —
     * so an eleven-metre Force wave at impulse 34 threw a dozen droids and
     * every one of them landed upright, froze for 1.2 s and walked on. This
     * suite's own opening paragraph names that shape: code that reads
     * correctly and is silently inert.
     *
     * ── WHY IT IS THE THING THAT BOUNDED §7's THIRD VERB ─────────────────
     *
     * "OPEN — the Force is a multiplier on other people's guns." `openness()`
     * pays it, and measured on a real Command battle with a Jedi gripping
     * continuously it reached 0.5-1.2% of enemy body-seconds. The bar was
     * already fully committed — 503 Force spent in 82 game-seconds against an
     * income of 7.5/s — so the answer was never "spend more"; it was that a
     * point of Force bought 0.05 open body-seconds. The grip is one body at a
     * time and the choke kills it in four and a half seconds.
     *
     * A shove is three to eight bodies for one press, and a body on the floor
     * is limp for its flight plus `GET_UP` plus `recover`'s beat — about three
     * times a stun. Same Force, same button, an order of magnitude more of the
     * thing §7 is about.
     *
     * ── WHAT THIS CHECK BINDS, ON A REAL WORLD ───────────────────────────
     *
     * Three facts, because any one of them alone is inert:
     *
     *   1. the shove puts the body down (`knockFlat`),
     *   2. a body that is down is OPEN — `openness()` above 1 for the whole
     *      window and not merely for the 1.2 s stun inside it,
     *   3. and that opening is paid to SOMEBODY ELSE'S GUN, through the
     *      shipped `World._boltHitTest` rather than through a second copy of
     *      the damage rule.
     *
     * `World.js` and `Combat.js` are imported INSIDE the body — HANDOFF §2.1:
     * a static edge from a check to the engine graph links before the loader
     * hook is in, and patches the wrong copy of three.
     */
    const H = await import('./_coop.mjs');
    const THREE = await import('three');
    const { openness } = await import('../../src/game/Combat.js');
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true },
    });
    const input = H.idleInput();
    const step = () => world.update(1 / 60, input);
    for (let i = 0; i < 10; i++) step();

    /* TWO BODIES AND ONE BOLT EACH, for the reason `force.mjs` gives at the
     * same fixture: this bolt is worth more than a B1's whole health, so a
     * body shot twice is a corpse the second time and `openState` answers
     * null for a corpse. */
    const shoot = (e) => {
      const before = e.hp;
      const mid = e.position.clone().setY(e.position.y + 0.9);
      world._boltHitTest({ damage: 6, owner: null, team: 0, color: { getHex: () => 0 } },
        mid.clone().add(new THREE.Vector3(0, 0, -6)), mid.clone().add(new THREE.Vector3(0, 0, 6)));
      return before - e.hp;
    };

    const a = world.spawnEnemy('b1', new THREE.Vector3(0, 0, -8));
    const b = world.spawnEnemy('b1', new THREE.Vector3(4, 0, -8));
    assert(a && b, 'setup: two droids did not spawn');
    for (let i = 0; i < 6; i++) step();

    /* THE REFERENCE IS TAKEN BEFORE THE SHOT AND NOT AFTER IT. A bolt landing
     * on a droid can stagger it, so `openness(a)` a frame later is a fact
     * about the bolt rather than about the body it is the control for. */
    assert(openness(a) === 1 && openness(b) === 1,
      'a droid standing on its own two feet already reports an opening');
    const standing = shoot(a);
    assert(standing > 0, 'the bolt missed a standing droid — the instrument is wrong, not the game');

    /* THE SHOVE ITSELF, through the one door every Force power comes through.
     * Impulse 26 is `forcePush`'s own, so this is the shipped blow rather than
     * a number chosen to pass. */
    b.applyKnockback(new THREE.Vector3(0, 0.6, 1).normalize().multiplyScalar(26), 0, null, false);
    assert(!!b.actor?.ragdolled,
      'a droid shoved at impulse 26 is still on its feet — the comment says it leaves them');
    const flatOpen = openness(b);
    assert(flatOpen > 1, `a droid on the ground reports openness ${flatOpen.toFixed(2)}x`);

    /* AND THE LINE'S GUNS ARE PAID IT. Same bolt, same body plan, one
     * standing and one down. */
    const down = shoot(b);
    assert(Math.abs(down / standing - flatOpen) < 0.3,
      `a shoved droid took ${(down / standing).toFixed(2)}x the bolt a standing one took, against `
      + `the ${flatOpen.toFixed(2)}x its open state is worth`);

    /**
     * ── THE WINDOW IS LONGER THAN THE STUN, WHICH IS THE WHOLE POINT ─────
     *
     * `applyKnockback` stuns for 1.2 s. If the opening ended there this change
     * would be worth nothing: what buys the extra is the body lying still for
     * `GET_UP` and then paying `recover`'s beat on top. So the window is
     * measured rather than asserted from the constants — stepped until
     * `openness` comes back to 1 — and it has to outlast the stun by enough to
     * be the reason anybody pressed the button.
     */
    let open = 0;
    for (let i = 0; i < 60 * 12 && openness(b) > 1; i++) { step(); open += 1 / 60; }
    assert(open > 1.2 * 1.6,
      `a shoved droid is open for ${open.toFixed(2)} s against the 1.20 s its stun alone would buy`);
    assert(open < 11,
      `a shoved droid is open for ${open.toFixed(2)} s — it never got up, which is a floor and not a window`);
    assert(!b.dead && !b.actor?.ragdolled,
      'the shoved droid never came back off the floor');

    /**
     * ── AND A SHOVE FROM YOUR OWN SIDE DOES NOT FELL YOU ─────────────────
     *
     * `Player._shockwave` iterates `ctx.enemies` with no team test — a Force
     * wave is physics and does not aim — and in Command your own line stands
     * in `world.enemies`. Without the clause this asserts, a panic button
     * pressed every few seconds would put your own rank on the floor for five
     * seconds at a time, which is the mode's whole objective inverted. The
     * 1.2 s stun still reaches them; only the knockdown is filtered.
     */
    assert(a.team === b.team, 'setup: the two droids are not on the same side');
    const c = world.spawnEnemy('b1', new THREE.Vector3(-4, 0, -8));
    assert(c, 'setup: the third droid did not spawn');
    for (let i = 0; i < 6; i++) step();
    c.applyKnockback(new THREE.Vector3(0, 0.6, 1).normalize().multiplyScalar(26), 0, a, false);
    assert(!c.actor?.ragdolled,
      'a shove from a body on its own side put it on the floor — every Force wave would fell your line');
    assert(c.stunTimer > 0, 'a shove from its own side stopped reaching it at all');

    world.unload();
    return `standing ${standing.toFixed(1)} hp, down ${down.toFixed(1)} hp — `
      + `${(down / standing).toFixed(2)}x against a stated ${flatOpen.toFixed(2)}x, `
      + `open for ${open.toFixed(2)} s against a 1.20 s stun`;
  });
}
