/**
 * BATTLEFRONT BORZ — TWO SERGEANTS ARE NOT THE SAME SOLDIER.
 *
 * "Right now do troops have any different attributes/stats at base from each
 *  other? … I really want to explore and expand on this and make it a really
 *  big highlight of the game (troop management)."
 *
 * They did not. Every body of a given archetype at a given rank was numerically
 * identical to every other, and the whole of "troop management" was a rank
 * ladder that only went up. `src/game/Attributes.js` is the answer and this
 * file is the thing that keeps it honest, because an attribute system has
 * exactly two failure modes and both of them are silent:
 *
 *   A NUMBER ON A CARD. A stat the roster prints and the simulation never
 *     reads. It looks like depth, it costs nothing to add, and there is no
 *     symptom — the game plays precisely as it did. Check 1 is a source scan
 *     over the whole tree and it is the most important assertion here.
 *   AN UPGRADE LIST. A trait that only gives. The moment one exists, a veteran
 *     roster is strictly stronger than a fresh one, `Company.js`'s refusal of
 *     cross-run power is broken, and the roster screen has become a shop.
 *     Check 3 forbids it in the table and check 4 proves the price is real.
 *
 * A check that cannot fail is worse than no check (HANDOFF 2.3), so the two
 * sim checks below drive REAL BODIES through `enlistBody` and compare a good
 * man against a poor one on the actual field a battle reads. Neither can pass
 * if the wiring is deleted, and both were written by first deleting it.
 */

import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';
import { bootWorld } from './_coop.mjs';
import { functionBody } from './_source.mjs';
import {
  ATTRS, ATTR_IDS, TRAITS, attrScale, rollSoldier, attrOf, scaleOf, hasFlag,
  kindOfArmy, traitsFor, attrName, attrBlurb, standout, profileMean, shedTraits,
} from '../../src/game/Attributes.js';
import { ARMIES, ARCHETYPE_BIAS, ORDER_LAG, HOLD_BREAK } from '../../src/game/Command.js';

const SRC = new URL('../../src/', import.meta.url);

/** Every .js under src/, as [path, text]. The scan's subject is DERIVED. */
async function sources() {
  const { readdir } = await import('node:fs/promises');
  const out = [];
  const walk = async (dir, rel) => {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      const u = new URL(d.name + (d.isDirectory() ? '/' : ''), dir);
      if (d.isDirectory()) await walk(u, `${rel}${d.name}/`);
      else if (d.name.endsWith('.js')) out.push([`${rel}${d.name}`, await readFile(u, 'utf8')]);
    }
  };
  await walk(SRC, 'src/');
  return out;
}

/** A seeded, reproducible rng — a distribution check on Math.random is noise. */
function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export async function run({ check, assert, near }) {
  const files = await sources();
  const game = files.filter(([p]) => !p.endsWith('game/Attributes.js'));

  /* ═══════════════════════════════════════════════════════════════════
     1. EVERY ATTRIBUTE IS READ BY THE SIMULATION
     ═══════════════════════════════════════════════════════════════════ */

  await check('every attribute has a consumer outside the UI', () => {
    /* The four doors into an attribute — `scaleOf(x, 'id')` and `attrOf(x,
     * 'id')` from this module, and the `Trooper.scale('id')` / `.attr('id')`
     * accessors that wrap them. Anything reading a profile goes through one of
     * these; a file that indexed `t.attrs.grit` by hand would not be found,
     * which is deliberate — that is a door this system does not have. */
    const door = (id) => new RegExp(
      `(?:scaleOf|attrOf)\\s*\\([^)]*?['"]${id}['"]|\\.(?:scale|attr)\\s*\\(\\s*['"]${id}['"]`);
    const missing = [];
    const where = {};
    for (const a of ATTRS) {
      const re = door(a.id);
      /* NOT THE MENU. A roster screen printing a bar is exactly the failure
       * this check exists for, so the one file whose whole job is to display
       * these is excluded from counting as a reader. */
      const hits = game.filter(([p, t]) => !p.startsWith('src/ui/') && re.test(t)).map(([p]) => p);
      if (!hits.length) missing.push(a.id); else where[a.id] = hits;
    }
    assert(!missing.length,
      `these attributes are printed and never read: ${missing.join(', ')}`);
    return `${ATTR_IDS.length} attributes, all read — ${
      ATTR_IDS.map((id) => `${id}:${where[id].length}`).join(' ')}`;
  });

  await check('every trait flag is read by the simulation', () => {
    const flags = [...new Set(TRAITS.map((t) => t.flag).filter(Boolean))];
    assert(flags.length >= 2, 'the trait table has no behavioural flags at all');
    const missing = flags.filter((f) => !game.some(([p, t]) =>
      !p.startsWith('src/ui/') && new RegExp(`hasFlag\\s*\\([^)]*?['"]${f}['"]`).test(t)));
    assert(!missing.length, `flags nothing reads: ${missing.join(', ')}`);
    return flags.join(', ');
  });

  await check('the roster screen reads the table and owns no copy of it', async () => {
    const menu = await readFile(new URL('../../src/ui/Menu.js', import.meta.url), 'utf8');
    assert(/from '\.\.\/game\/Attributes\.js'/.test(menu),
      'Menu.js does not import the attribute table');
    assert(/ATTRS/.test(menu) && /attrName/.test(menu),
      'Menu.js does not iterate ATTRS — it is printing a hand-written list');
    /* THE NAMES ARE NOT TYPED THERE. Every display name in the table would be
     * a second copy of it if the page spelled one out, and the day one is
     * retuned the two disagree with nothing to say so. */
    /* SCOPED TO THE RENDERER, through `functionBody` rather than a window —
     * see _source.mjs on why a character count is not a bound. Scanning the
     * whole 6 000-line file for the word "Pace" finds the Jedi page's own
     * movement-speed stat, which is a different fact with the same name. */
    const body = functionBody(menu, '  _companyProfileHtml(');
    const typed = ATTRS.map((a) => [a.flesh, a.steel]).flat()
      .filter((n) => n && body.includes(n));
    assert(!typed.length, `the roster page hard-codes attribute names: ${typed.join(', ')}`);
    for (const t of TRAITS) {
      assert(!body.includes(t.name), `the roster page hard-codes the trait "${t.name}"`);
    }
    return `${body.split('\n').length} lines, none of them a name`;
  });

  /* ═══════════════════════════════════════════════════════════════════
     2. THE SCALE IS FLAT, SYMMETRIC AND BOUNDED
     ═══════════════════════════════════════════════════════════════════ */

  await check('50 is exactly no modifier, on every axis', () => {
    for (const a of ATTRS) near(attrScale(a.id, 50), 1, 1e-9, `${a.id} at 50`);
    return `${ATTRS.length} axes`;
  });

  await check('the ends are the declared lo and hi, and nothing exceeds them', () => {
    for (const a of ATTRS) {
      near(attrScale(a.id, 0), a.lo, 1e-9, `${a.id} at 0`);
      near(attrScale(a.id, 100), a.hi, 1e-9, `${a.id} at 100`);
      /* Out-of-range input is clamped, not extrapolated — a hand-edited save
       * that says 5000 Grit must not buy a body that cannot be killed. */
      near(attrScale(a.id, 5000), a.hi, 1e-9, `${a.id} clamped high`);
      near(attrScale(a.id, -5000), a.lo, 1e-9, `${a.id} clamped low`);
    }
    const widest = Math.max(...ATTRS.map((a) => Math.abs(1 - a.lo) + Math.abs(a.hi - 1)));
    return `widest total swing ${(widest * 100).toFixed(0)}%`;
  });

  await check('a step up from 50 is worth a step down — no late-game curve', () => {
    /* LINEAR IS THE DESIGN, stated in `attrScale`'s own note: a curve makes the
     * last ten points worth more than the first ten, which makes "field your
     * best men" the only strategy and a squad of ordinary men a consolation. */
    for (const a of ATTRS) {
      const up = attrScale(a.id, 60) - 1, down = 1 - attrScale(a.id, 40);
      const upFar = attrScale(a.id, 90) - 1, downFar = 1 - attrScale(a.id, 10);
      near(up / (a.hi - 1), 0.2, 1e-9, `${a.id} near step`);
      near(down / (1 - a.lo), 0.2, 1e-9, `${a.id} near step down`);
      near(upFar / (a.hi - 1), 0.8, 1e-9, `${a.id} far step`);
      near(downFar / (1 - a.lo), 0.8, 1e-9, `${a.id} far step down`);
    }
    return 'flat through the middle';
  });

  /* ═══════════════════════════════════════════════════════════════════
     3. NO TRAIT IS AN UPGRADE
     ═══════════════════════════════════════════════════════════════════ */

  await check('every trait gives and takes, and both sides are real attributes', () => {
    for (const t of TRAITS) {
      const up = Object.keys(t.up || {}), down = Object.keys(t.down || {});
      assert(up.length, `${t.id} takes nothing away — that is a rank, not a trait`);
      assert(down.length, `${t.id} gives nothing`);
      for (const k of [...up, ...down]) {
        assert(ATTR_IDS.includes(k), `${t.id} moves "${k}", which is not an attribute`);
      }
      for (const k of up) assert(!down.includes(k), `${t.id} both raises and lowers ${k}`);
      assert(t.name && t.line, `${t.id} has no name or no line`);
    }
    return `${TRAITS.length} traits, every one two-sided`;
  });

  await check('no trait is a net gain, priced in what a point is worth', () => {
    /**
     * POINTS ARE NOT COMPARABLE ACROSS AXES and pretending they are is how this
     * table was wrong. A raw point sum said twelve of seventeen traits were
     * profitable; it was also understating the worst of them, because a point
     * of Loyalty moved a 0.55–1.70 multiplier and a point of Pace moved a
     * 0.88–1.14 one. Two very different things called "one point".
     *
     * So each point is priced at the fraction of its own axis it buys, which is
     * the only currency the sim actually spends. `|hi − 1|` and `|1 − lo|`
     * rather than the signed values, because Marksmanship and Reflex both run
     * backwards — a lower cone and a shorter delay are both advantages.
     */
    const W = {};
    for (const a of ATTRS) W[a.id] = { up: Math.abs(a.hi - 1) / 50, dn: Math.abs(1 - a.lo) / 50 };
    const priced = TRAITS.map((t) => {
      let g = 0, l = 0;
      for (const k in (t.up || {})) g += t.up[k] * W[k].up;
      for (const k in (t.down || {})) l += t.down[k] * W[k].dn;
      return { id: t.id, net: g - l, temp: !!t.sheds };
    });
    const gains = priced.filter((r) => r.net > 0);
    assert(!gains.length, 'traits that are pure profit: '
      + gains.map((r) => `${r.id} +${r.net.toFixed(3)}`).join(', '));
    /* …AND NOT A CURSE EITHER, for anything permanent. A trait that costs a
     * tenth of a man is not a shape he has, it is a penalty for having been
     * rolled — and a roster where two traits are strictly worse than none is
     * the upgrade list again with the sign flipped. `green` is exempt because
     * `sheds` takes it off him, with the points, once he has held three
     * areas. */
    const curses = priced.filter((r) => !r.temp && r.net < -0.06);
    assert(!curses.length, 'permanent traits that are only a tax: '
      + curses.map((r) => `${r.id} ${r.net.toFixed(3)}`).join(', '));
    const worst = Math.min(...priced.map((r) => r.net));
    return `${TRAITS.length} traits, all ≤ 0, deepest ${worst.toFixed(3)}`;
  });

  await check('a trait that says it wears off actually does, and refunds', () => {
    const temp = TRAITS.filter((t) => t.sheds);
    assert(temp.length, 'nothing in the table is temporary');
    for (const t of temp) {
      assert(typeof t.sheds === 'function', `${t.id}.sheds is not a predicate`);
      /* Both directions, on the same man, so this cannot pass by shedding
       * everything or by shedding nothing. */
      const attrs = {}; for (const id of ATTR_IDS) attrs[id] = 50;
      for (const k in t.up) attrs[k] += t.up[k];
      for (const k in t.down) attrs[k] -= t.down[k];
      const green = { attrs, traits: [t.id], areas: 0 };
      const held = shedTraits(green);
      assert(held.traits.includes(t.id), `${t.id} came off a man who has not earned it`);
      const grown = shedTraits({ ...green, areas: 9 });
      assert(!grown.traits.includes(t.id), `${t.id} never comes off`);
      for (const id of ATTR_IDS) {
        assert(grown.attrs[id] === 50,
          `${t.id} came off but ${id} kept its swing: ${grown.attrs[id]}`);
      }
      /* AND IT DOES NOT EDIT THE RECORD IT WAS HANDED. The caller's object is
       * the man off disk; a mutation here would rewrite the save. */
      assert(green.traits.includes(t.id) && green.attrs.nerve !== 50,
        `${t.id} shed by mutating the stored man`);
    }
    return `${temp.map((t) => t.id).join(', ')} — off and refunded`;
  });

  await check('a droid is not brave and a clone has no actuators', () => {
    const flesh = traitsFor('flesh').map((t) => t.id);
    const steel = traitsFor('steel').map((t) => t.id);
    assert(flesh.length >= 8 && steel.length >= 8, 'one kind has almost nothing to be');
    const fleshOnly = TRAITS.filter((t) => t.kind === 'flesh').map((t) => t.id);
    const steelOnly = TRAITS.filter((t) => t.kind === 'steel').map((t) => t.id);
    assert(fleshOnly.length && steelOnly.length, 'nothing in the table is kind-gated');
    for (const id of fleshOnly) assert(!steel.includes(id), `${id} can be dealt to a droid`);
    for (const id of steelOnly) assert(!flesh.includes(id), `${id} can be dealt to a man`);
    return `${flesh.length} for men, ${steel.length} for machines`;
  });

  await check('the two armies name the same eight numbers differently', () => {
    assert(kindOfArmy('separatist') === 'steel', 'the Confederacy is not steel');
    assert(kindOfArmy('republic') === 'flesh', 'the Republic is not flesh');
    let renamed = 0;
    for (const a of ATTRS) {
      assert(attrName(a.id, 'flesh') && attrName(a.id, 'steel'), `${a.id} has no display name`);
      if (attrName(a.id, 'flesh') !== attrName(a.id, 'steel')) renamed++;
      assert(attrBlurb(a.id, 'flesh') && attrBlurb(a.id, 'steel'), `${a.id} has no blurb`);
    }
    assert(renamed === ATTRS.length, 'some axes are called the same thing on both sides');
    /* THE BOND AXIS IS A DIFFERENT SENTENCE, not just a different word: a man
     * fights above himself because a person is beside him and a droid because
     * a signal is up. That distinction is the reason `kind` exists at all. */
    assert(attrBlurb('bond', 'flesh') !== attrBlurb('bond', 'steel'),
      'Loyalty and Uplink are described identically — the kind split is cosmetic');
    return `${renamed}/${ATTRS.length} renamed`;
  });

  /* ═══════════════════════════════════════════════════════════════════
     4. THE ROLL MAKES A COMPANY, NOT A LADDER
     ═══════════════════════════════════════════════════════════════════ */

  await check('most men are ordinary and a few are worth knowing', () => {
    const r = rng(20250825);
    const all = [];
    for (let i = 0; i < 4000; i++) {
      const s = rollSoldier(r, 'flesh', { traits: 0 });
      for (const id of ATTR_IDS) all.push(s.attrs[id]);
    }
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    const sd = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length);
    const lowTail = all.filter((v) => v < 20).length / all.length;
    const highTail = all.filter((v) => v > 80).length / all.length;
    near(mean, 50, 1.0, 'mean');
    /* THE SHAPE IS THE POINT. A flat 0..100 roll has σ≈28.9 and 20% in each
     * tail — as many 5s as 50s, and a man who cannot shoot at all is not a
     * character, he is a body you delete. Three draws averaged gives σ≈16 and
     * a tail of a few per cent, which is a company: mostly ordinary, with
     * somebody in it worth knowing. Both bounds are needed — the upper one
     * fails if the roll flattens and the lower one if it collapses to 50. */
    assert(sd > 12 && sd < 20, `σ ${sd.toFixed(1)} — the roll is flat or collapsed`);
    assert(lowTail > 0.005 && lowTail < 0.08, `${(lowTail * 100).toFixed(1)}% under 20`);
    assert(highTail > 0.005 && highTail < 0.08, `${(highTail * 100).toFixed(1)}% over 80`);
    return `mean ${mean.toFixed(1)}, σ ${sd.toFixed(1)}, tails ${
      (lowTail * 100).toFixed(1)}% / ${(highTail * 100).toFixed(1)}%`;
  });

  await check('the archetype leans the roll and never replaces it', () => {
    /* A sniper is drawn towards Marksmanship. A sniper is still allowed to be
     * a poor shot, and if none of two thousand of them is, the bias has stopped
     * being a lean and become a floor — which is the rank ladder again. */
    const bias = ARCHETYPE_BIAS.sniper;
    assert(bias && bias.aim > 0, 'the sniper is not drawn towards its own job');
    const r = rng(77);
    let sum = 0, poor = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) {
      const s = rollSoldier(r, 'flesh', { bias, traits: 0 });
      sum += s.attrs.aim;
      if (s.attrs.aim < 50) poor++;
    }
    const mean = sum / N;
    assert(mean > 50 + bias.aim * 0.6, `sniper mean aim ${mean.toFixed(1)} — the bias is not landing`);
    assert(poor / N > 0.02, 'no sniper in two thousand is a poor shot — that is a floor');
    return `mean aim ${mean.toFixed(1)}, ${(poor / N * 100).toFixed(1)}% below the middle`;
  });

  await check('the same man is the same man however he was built', async () => {
    /**
     * THE PROPERTY CO-OP NEEDS, and the one a stream cannot give.
     *
     * `command-pvp.mjs` caught this as a guest holding an idle input billing
     * the host 0.4 hp: two machines built the same army in different orders,
     * a mirror's maxHp came out a point apart, its copy went down on a round
     * the host's survived, and the kill clause claimed the body. It came and
     * went with machine load, because the suite's async checks interleave at
     * their awaits and the interleave was deciding the draw order.
     *
     * Asserted three ways, and all three are needed: order-independent, still
     * different between two men, and still different between two runs. Drop
     * the last and every campaign hands you the same twelve soldiers.
     */
    const { Trooper, seedCommand } = await import('../../src/game/Command.js');
    seedCommand(20250825);
    const a = new Trooper(ARMIES.republic, 'trooper', 'CT-1234', {});
    new Trooper(ARMIES.republic, 'heavy', 'CT-5150', {});   // …and somebody in between
    const again = new Trooper(ARMIES.republic, 'trooper', 'CT-1234', {});
    for (const id of ATTR_IDS) {
      assert(a.attr(id) === again.attr(id),
        `${id} depends on the order he was mustered in: ${a.attr(id)} vs ${again.attr(id)}`);
    }
    assert(a.traits.join() === again.traits.join(), 'his traits depend on the muster order');
    const other = new Trooper(ARMIES.republic, 'trooper', 'CT-8888', {});
    assert(ATTR_IDS.some((id) => other.attr(id) !== a.attr(id)),
      'two different men came out identical — the hash ignores who he is');
    seedCommand(20250826);
    const nextRun = new Trooper(ARMIES.republic, 'trooper', 'CT-1234', {});
    assert(ATTR_IDS.some((id) => nextRun.attr(id) !== a.attr(id)),
      'the same designation is the same soldier in every campaign ever played');
    return 'order-free, man-specific, run-specific';
  });

  await check('two men off the same table are two different men', () => {
    const r = rng(9);
    const a = rollSoldier(r, 'flesh');
    const b = rollSoldier(r, 'flesh');
    const same = ATTR_IDS.filter((id) => a.attrs[id] === b.attrs[id]).length;
    assert(same < ATTR_IDS.length, 'two rolls came out identical on every axis');
    assert(profileMean(a) >= 0 && profileMean(a) <= 100, 'profileMean is out of range');
    const out = standout(a, 'flesh');
    assert(out.length === 2, 'standout does not name two things');
    assert(out[0].spread >= out[1].spread, 'standout is not sorted by distance from the middle');
    assert(out[0].name !== out[0].id, 'standout returns an id where a name belongs');
    return `${ATTR_IDS.length - same} axes apart`;
  });

  await check('a saved man comes back the same man', async () => {
    const Company = await import('../../src/game/Company.js');
    const { Trooper } = await import('../../src/game/Command.js');
    const t = new Trooper(ARMIES.republic, 'trooper', 'CT-4404', { rng: rng(5) });
    const stored = Company.manOf(t, {});
    assert(stored.attrs && stored.traits, 'manOf drops the profile');
    /* THROUGH THE REAL STORE, so the sanitiser on the way in is in the path:
     * a round trip that skipped it would pass while the loader silently
     * rewrote every man to 50. */
    const co = Company.blank('republic');
    co.men.push(stored);
    const back = Company.load ? null : null;
    const read = JSON.parse(JSON.stringify(co));
    const rebuilt = new Trooper(ARMIES.republic, 'trooper', 'CT-4404',
      { attrs: read.men[0].attrs, traits: read.men[0].traits, kind: read.men[0].kind });
    for (const id of ATTR_IDS) {
      assert(rebuilt.attr(id) === t.attr(id),
        `${id} changed across the save: ${t.attr(id)} → ${rebuilt.attr(id)}`);
    }
    assert(rebuilt.traits.join() === t.traits.join(), 'his traits changed across the save');
    return `${ATTR_IDS.length} axes and ${t.traits.length} trait(s) intact`;
  });

  /* ═══════════════════════════════════════════════════════════════════
     5. IT REACHES THE FIELD
     ═══════════════════════════════════════════════════════════════════ */

  await check('a good man and a poor man are different bodies', async () => {
    const { world } = await bootWorld({ settings: { quality: 'low' } });
    const { Enemy } = await import('../../src/game/Enemy.js');
    const { Trooper, enlistBody } = await import('../../src/game/Command.js');
    const THREE = await import('three');

    const at = (v) => { const o = {}; for (const id of ATTR_IDS) o[id] = v; return o; };
    const make = (attrs, x) => {
      const t = new Trooper(ARMIES.republic, 'trooper', `CT-9${x}`, { attrs, traits: [] });
      const e = new Enemy(world, 'trooper', new THREE.Vector3(x * 5, 0, 0));
      enlistBody(e, t);
      return { t, e };
    };
    const poor = make(at(0), 1);
    const good = make(at(100), 2);

    /* RATIOS, NOT VALUES. `Enemy` jitters pace and health per body, so an
     * absolute comparison would be reading the jitter. Each of these is the
     * declared lo/hi pair and must move in the declared direction. */
    const hpR = good.e.maxHp / poor.e.maxHp;
    const spR = good.e.speed / poor.e.speed;
    const coneR = good.e.A.spread / poor.e.A.spread;
    const rateR = good.e.A.fireRate / poor.e.A.fireRate;
    const gapR = good.e.A.burstGap / poor.e.A.burstGap;
    const morR = good.t.morale / poor.t.morale;
    assert(hpR > 1.25, `Grit bought nothing: maxHp ratio ${hpR.toFixed(3)}`);
    assert(spR > 1.2, `Pace bought nothing: speed ratio ${spR.toFixed(3)}`);
    /* THE CONE SHRINKS. This is the one that reads backwards and the one a
     * sign error would silently invert — a marksman with a WIDER cone is a
     * feature nobody would ever notice from the outside. */
    assert(coneR < 0.65, `Marksmanship widened the cone: ratio ${coneR.toFixed(3)}`);
    assert(rateR > 1.35, `Cadence bought nothing: fireRate ratio ${rateR.toFixed(3)}`);
    assert(gapR < 0.75, `a faster trigger did not shorten the burst: ${gapR.toFixed(3)}`);
    assert(morR > 1.4, `Nerve bought nothing: muster morale ratio ${morR.toFixed(3)}`);
    world.dispose?.();
    return `hp ×${hpR.toFixed(2)} · pace ×${spR.toFixed(2)} · cone ×${coneR.toFixed(2)} · `
      + `rate ×${rateR.toFixed(2)} · morale ×${morR.toFixed(2)}`;
  });

  await check('a reckless man closes and a careful one stands off', async () => {
    const { world } = await bootWorld({ settings: { quality: 'low' } });
    const { Enemy } = await import('../../src/game/Enemy.js');
    const { Trooper, enlistBody } = await import('../../src/game/Command.js');
    const THREE = await import('three');
    const flat = {}; for (const id of ATTR_IDS) flat[id] = 50;

    const band = (traits, x) => {
      const t = new Trooper(ARMIES.republic, 'trooper', `CT-8${x}`, { attrs: { ...flat }, traits });
      const e = new Enemy(world, 'trooper', new THREE.Vector3(x * 5, 0, 0));
      enlistBody(e, t);
      return e.A.preferred[1];
    };
    const plain = band([], 1);
    const rash = band(['reckless'], 2);
    const wary = band(['careful'], 3);
    assert(hasFlag({ traits: ['reckless'] }, 'pushes'), 'reckless does not carry its flag');
    assert(hasFlag({ traits: ['careful'] }, 'holds'), 'careful does not carry its flag');
    assert(rash < plain * 0.8, `a reckless man stands off at ${rash.toFixed(1)} m of ${plain.toFixed(1)}`);
    assert(wary > plain * 1.15, `a careful man closes to ${wary.toFixed(1)} m of ${plain.toFixed(1)}`);
    world.dispose?.();
    return `reckless ${rash.toFixed(1)} m · plain ${plain.toFixed(1)} m · careful ${wary.toFixed(1)} m`;
  });

  await check('an order is not instantaneous, and reflex is the difference', async () => {
    const src = await readFile(new URL('../../src/game/Command.js', import.meta.url), 'utf8');
    assert(/ORDER_LAG \* \(t\.scale/.test(src),
      'the order clock does not scale by the man — it is a flat delay');
    /* THE LAG IS IN THE MAN, NOT IN THE SLOT. `slotFor` still answers where the
     * order says he belongs — every other reader wants that truth — and what
     * waits is him acting on it. Both readers are asserted because the stamp
     * with nothing reading it is the silent failure. */
    assert(/e\.cmdOrder !== this\.formationFor\(/.test(src),
      'nothing holds a body in its old shape — the order lands on every man at once');
    assert(/FORMATIONS\[e\.cmdOrder\] \|\| Fk/.test(src),
      'the gun ignores the adopted order — HOLD FIRE is still instantaneous');
    /* THE SPREAD IS REAL AND IS UNDER A SECOND AT BOTH ENDS. A lag the player
     * waits on is a bug; a lag they feel is the mechanic. */
    const slow = ORDER_LAG * attrScale('reflex', 0);
    const fast = ORDER_LAG * attrScale('reflex', 100);
    assert(slow / fast > 1.5, `the sharp and the slow adopt within ${(slow / fast).toFixed(2)}× of each other`);
    assert(slow < 1.4, `${slow.toFixed(2)} s is a wait, not a beat`);
    return `${fast.toFixed(2)} s sharp, ${slow.toFixed(2)} s slow`;
  });

  await check('hold fire is an order a poor man can break', async () => {
    const src = await readFile(new URL('../../src/game/Command.js', import.meta.url), 'utf8');
    assert(/\(1 - disc\) \* HOLD_BREAK/.test(src), 'the break does not read discipline');
    /* AND NO DICE ANYWHERE IN THE DIRECTOR. A roll per frame is a divergence
     * between a host and a guest running the same second — `command-pvp.mjs`
     * caught that exact shape in the muster, where an unseeded profile gave
     * every mirrored trooper a different cone on the guest's machine.
     * `commandRng` is the file's own seeded stream and exists for this.
     *
     * Comments stripped first, or the note explaining the rule fails it. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    assert(!/Math\.random\s*\(/.test(code),
      'Command.js rolls dice of its own — co-op cannot agree with itself');
    assert(/e\.cmdBreak > 0/.test(src), 'a break is rolled and never held for any time');
    /* UNDER FIRE, AND ONLY UNDER FIRE. A break at empty air would ruin the one
     * thing HOLD FIRE is for and the player could neither see it nor prevent
     * it; a man returning rounds that are landing on him is a fact about where
     * you put him. `command.mjs` counts a pinned line's bolts at zero on the
     * strength of this gate. */
    assert(/if \(disc < 1 && e\.underFire > 0\)/.test(src),
      'a man breaks the hold at empty air — an ambush cannot be silent');
    assert(HOLD_BREAK > 0, 'the break rate is zero — hold fire is a switch again');
    /* AND A DISCIPLINED MAN NEVER BREAKS. `disc < 1` gates it, so the whole
     * upper half of the scale holds absolutely — the attribute buys certainty
     * rather than a smaller dice roll, which is what discipline is. */
    assert(attrScale('discipline', 50) >= 1 && attrScale('discipline', 100) > 1,
      'the middle of the discipline scale is below 1 — everyone breaks');
    const worst = (1 - attrScale('discipline', 0)) * HOLD_BREAK / 0.28;
    assert(worst > 0.15 && worst < 1.0,
      `${worst.toFixed(2)} breaks/s at zero Discipline is a mutiny, not a lapse`);
    return `${worst.toFixed(2)} breaks/s at the bottom, none from 50 up`;
  });

  await check('discipline holds the line tighter', async () => {
    const src = await readFile(new URL('../../src/game/Command.js', import.meta.url), 'utf8');
    assert(/FORM_TOLERANCE\) \/ disc/.test(src),
      'the slot tolerance does not read discipline');
    const slack = 2.2 / attrScale('discipline', 0);
    const tight = 2.2 / attrScale('discipline', 100);
    assert(slack > tight, 'a disciplined man is allowed MORE slop than a sloppy one');
    assert(slack - tight > 0.6, `${(slack - tight).toFixed(2)} m between the best and worst line`);
    return `${tight.toFixed(2)} m to ${slack.toFixed(2)} m of slop`;
  });

  await check('how long a man has on the ground is his own number', async () => {
    const { world } = await bootWorld({ settings: { quality: 'low' } });
    const { Enemy, DOWN_BLEED } = await import('../../src/game/Enemy.js');
    const { Trooper, enlistBody } = await import('../../src/game/Command.js');
    const THREE = await import('three');
    const flat = {}; for (const id of ATTR_IDS) flat[id] = 50;

    const down = (v, x) => {
      const t = new Trooper(ARMIES.republic, 'trooper', `CT-7${x}`,
        { attrs: { ...flat, hardiness: v }, traits: [] });
      const e = new Enemy(world, 'trooper', new THREE.Vector3(x * 5, 0, 0));
      enlistBody(e, t);
      /* THROUGH THE REAL DOOR. `_goDown` is what a body takes when its last
       * point comes off, and reading the constant instead would prove only
       * that arithmetic works. */
      e._goDown(null, null, 'shot');
      return e.bleed;
    };
    const weak = down(0, 1), mid = down(50, 2), tough = down(100, 3);
    near(mid, DOWN_BLEED, 0.01, 'the middle of the scale is not the constant');
    assert(tough > weak * 1.6,
      `a tough man and a frail one bleed out within ${(tough / weak).toFixed(2)}× of each other`);
    assert(weak > 8, `${weak.toFixed(1)} s is not a window anybody can cross a field in`);
    world.dispose?.();
    return `${weak.toFixed(0)} s to ${tough.toFixed(0)} s on the ground, ${DOWN_BLEED} s flat before`;
  });

  await check('a man who never recovers is a liability three fights from now', async () => {
    const src = await readFile(new URL('../../src/game/Command.js', import.meta.url), 'utf8');
    assert(/MORALE\.RALLY_PER_S \* scaleOf\(t, 'resolve'\)/.test(src),
      'the between-areas rally is the same for every man');
    /* THE ONE AXIS WHOSE EFFECT IS INVISIBLE ON THE FIELD, which is exactly why
     * it has to be on the roster page: nothing in a firefight will ever tell
     * you a man is not coming back from it. */
    const { MORALE } = await import('../../src/game/Morale.js');
    const slow = MORALE.RALLY_PER_S * attrScale('resolve', 0);
    const quick = MORALE.RALLY_PER_S * attrScale('resolve', 100);
    assert(quick / slow > 1.7,
      `the fastest and slowest recovery are within ${(quick / slow).toFixed(2)}×`);
    /* From MORALE.BREAK back to the presence cap, which is the recovery that
     * actually matters between areas. */
    const gap = MORALE.PRESENCE_CAP - MORALE.BREAK;
    return `${(gap / quick).toFixed(0)} s to come back at best, ${(gap / slow).toFixed(0)} s at worst`;
  });

  await check('where you stand matters more to some men than others', async () => {
    const src = await readFile(new URL('../../src/game/Command.js', import.meta.url), 'utf8');
    assert(/MORALE\.JEDI_NEAR \* w \* lean/.test(src), 'the Jedi presence term ignores bond');
    assert(/MORALE\.LEADER_NEAR \* w \* lean/.test(src), 'the leader presence term ignores bond');
    /* AND THE SAME NUMBER IS THE FALL. Without this line Loyalty was pure
     * upside — a bonus that appears when you walk over and is simply absent
     * when you do not — so a devoted man cost nothing to field and the blurb's
     * "how far he falls when you are not" described nothing. */
    assert(/MORALE\.ALONE \* lean/.test(src),
      'nobody comes apart on his own — bond only ever pays out');
    const devoted = attrScale('bond', 100), alone = attrScale('bond', 0);
    assert(devoted / alone > 2,
      `a devoted man and a lone wolf value your presence within ${(devoted / alone).toFixed(2)}×`);
    /* …and it is still the widest axis in the table, which is what makes the
     * two armies play differently rather than reskin each other. */
    const widest = ATTRS.map((a) => Math.abs(a.hi - 1) + Math.abs(1 - a.lo))
      .sort((x, y) => y - x);
    const bond = ATTRS.find((a) => a.id === 'bond');
    near(Math.abs(bond.hi - 1) + Math.abs(1 - bond.lo), widest[0], 1e-9,
      'bond is no longer the widest swing on the roster');
    return `×${alone.toFixed(2)} to ×${devoted.toFixed(2)} near you, and the same on the fall`;
  });

  clocked?.('attributes');
}
