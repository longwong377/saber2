/**
 * BATTLEFRONT BORZ — TWO SQUADS ARE TWO SQUADS.
 *
 * The owner, twice, a year apart:
 *
 *   "are we able to separately order squads? Sometimes it'll say 2 squads but
 *    they get ordered as one."
 *   "the troop management menu says 2 squads sometimes but for all intents and
 *    purposes it's just one squad. I should be able to separately view my
 *    squads in an actual game and order them."
 *
 * The second time was after per-squad orders had been built. They existed, they
 * worked in the sense that `command.mjs` could prove two `squadPlanted` entries
 * were 80 m apart — and every one of the following was also true:
 *
 *   THE SHAPE WAS THE ARMY'S. `slot(idx, n, k)` was handed a GLOBAL index and
 *     the whole line's count, so a second squad of five ordered into a circle
 *     stood in the arc from 180° to 324°. A half ring. Two squads on two
 *     anchors, each drawing a slice of a shape meant for ten men.
 *   ONE SQUAD'S ORDER MOVED THE ARMY'S GROUND. Telling 2nd Squad to charge
 *     nulled `c._planted`, so every other squad lost the cover it was holding.
 *   THE INDEX WAS A POSITION. `squads()` compacted, so wiping 1st Squad made
 *     2nd Squad index 0 — and the ground it had been given, the name the player
 *     gave it and the target they had selected all followed the number onto a
 *     different body of men.
 *   THE PANEL LIED. A per-squad order repainted the army-wide order readout,
 *     the one always-visible statement of what your men are doing.
 *   NOTHING ON SCREEN SAID WHICH SQUAD ANYTHING WAS. Not the roster, not the
 *     plates, not the minimap, not the paint; `summary()` did not carry the
 *     field at all.
 *   AND THE DOOR WAS TWO WHEEL CYCLES WIDE, on no list a player reads, with no
 *     touch path at all.
 *
 * This file is one check per sentence above. It is deliberately separate from
 * `command.mjs`, which owns the roster and the formations: what is measured
 * here is that a squad is a THING — it keeps its number, its ground, its name
 * and its shape, and the player can see it and talk to it.
 */

import * as Cmd from '../../src/game/Command.js';
import { FORMATIONS } from '../../src/game/Command.js';
import { army as deployed } from './_army.mjs';

export async function run({ check, assert, THREE: T }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  const THREE = T || await import('three');

  check('squads: the index is the squad number, and identity survives a wipe', () => {
    /**
     * `squads()` returned a COMPACTED list, so the index was "how many squads
     * with anybody in them come before this one". Wipe 1st Squad and 2nd
     * became index 0 — and every index-keyed thing followed: the ground it had
     * been given, the order it was under, the player's selection, and the name
     * they gave it. A squad became a different squad mid-fight, holding ground
     * it was never sent to.
     */
    const { d, c } = deployed();
    const squads = d.squadsOf(c);
    assert(squads.length >= 2, `${squads.length} squads deployed — nothing to lose`);
    const second = squads[1].map((t) => t.designation);
    assert(second.length, 'the fixture made an empty second squad');

    /* Give 2nd Squad its own ground and its own name. */
    for (const t of squads[1]) if (t.body) t.body.position.set(70, 0, 0);
    d.squadNames = ['', 'Havoc'];
    d.order('cover', c, 1);
    const ground = c.squadPlanted.get('1');
    assert(ground, '2nd squad was never given ground');

    /* …and wipe 1st Squad off the board. */
    for (const t of squads[0]) { t.alive = false; if (t.body) t.body.dead = true; }
    const after = d.squadsOf(c);
    assert(after.length >= 2,
      `${after.length} entries after a wipe — the list compacted and 2nd Squad is now 1st`);
    assert(after[0].filter((t) => t.alive).length === 0,
      'the wiped squad still has living men in its slot');
    assert(after[1].map((t) => t.designation).join() === second.join(),
      `2nd Squad is now ${JSON.stringify(after[1].map((t) => t.designation))} and was `
      + `${JSON.stringify(second)}`);
    assert(c.squadPlanted.get('1') === ground,
      'the ground 2nd Squad was given moved when 1st Squad died');
    assert(d.squadLabel(1, c) === 'Havoc',
      `the survivors are called ${d.squadLabel(1, c)} — the name followed the number onto `
      + 'a different body of men');
    return `1st wiped; 2nd kept its number, its ground and its name (${second.length} men)`;
  });

  check('squads: a delegated squad forms its own whole shape, not a slice of the army\'s', () => {
    /**
     * ── THE COMPLAINT, AS GEOMETRY ────────────────────────────────────────
     *
     * `slot(idx, n, k)` lays a formation out by a man's index within a count,
     * and both were the ARMY's — `i` ran globally across every squad and `n`
     * was the whole living line. A second squad of five in a circle got
     * `slot(5..9, 10)`, so `a = (i / n) * TAU` put them in the arc from 180° to
     * 324°: a half ring, which is exactly what "for all intents and purposes
     * it's just one squad" looks like when you draw it.
     *
     * Measured as the SPREAD OF BEARINGS around the squad's own anchor. A whole
     * circle of five is five bearings spanning most of a turn; a slice is a
     * fan. The army's own formation is untouched, because there the shape IS
     * the army's and slicing it would break the one thing that spans everybody.
     */
    const { d, c } = deployed();
    const squads = d.squadsOf(c);
    assert(squads.length >= 2, 'need two squads');
    for (const t of squads[0]) if (t.body) t.body.position.set(-80, 0, 0);
    for (const t of squads[1]) if (t.body) t.body.position.set(80, 0, 0);
    d._troops(1 / 30, {});

    const bearings = (sq) => {
      const anchor = d._anchorFor(FORMATIONS.circle, c, sq[0].body.cmdSquad);
      const out = [];
      for (const t of sq) {
        const v = d.slotFor(t.body, new THREE.Vector3());
        if (!v) continue;
        out.push(Math.atan2(v.x - anchor.pos.x, v.z - anchor.pos.z));
      }
      return out;
    };
    const span = (list) => {
      const s = [...list].sort((a, b) => a - b);
      let worst = (s[0] + Math.PI * 2) - s[s.length - 1];
      for (let i = 1; i < s.length; i++) worst = Math.max(worst, s[i] - s[i - 1]);
      return Math.PI * 2 - worst;             // how much of the turn they cover
    };

    d.order('circle', c, 1);
    d._troops(1 / 30, {});
    const one = bearings(squads[1]);
    assert(one.length >= 4, `${one.length} men solved a slot in the delegated squad`);
    const covered = span(one);
    assert(covered > Math.PI * 1.4,
      `the delegated squad's circle covers ${(covered * 180 / Math.PI).toFixed(0)}° of the `
      + 'turn — it is drawing a slice of a shape meant for the whole line');

    /* …AND THE ARMY'S OWN CIRCLE IS STILL THE ARMY'S. */
    const { d: d2, c: c2 } = deployed();
    d2._troops(1 / 30, {});
    d2.order('circle', c2);
    d2._troops(1 / 30, {});
    const all = d2.led(c2).filter((t) => t.body);
    const n = new Set(all.map((t) => t.body.cmdCount));
    assert(n.size === 1 && n.has(all.length),
      `an army-wide circle laid its men out in counts ${[...n].join(',')} of ${all.length} — `
      + 'the whole-line formation was sliced');
    return `a delegated circle of ${one.length} covers ${(covered * 180 / Math.PI).toFixed(0)}°; `
      + `an army-wide one is still one shape of ${all.length}`;
  });

  check('squads: one squad\'s order does not move the army\'s ground', () => {
    /**
     * `c._planted` is the ARMY's frozen frame, and the line that wrote it ran
     * on both branches with `F` bound to whichever formation was just given. So
     * ordering one squad to CHARGE — an advancing formation — nulled the
     * army's plant, and every OTHER squad, holding cover on ground it had been
     * given, silently snapped back to following the commander.
     */
    const { d, c } = deployed();
    assert(d.squadsOf(c).length >= 2, 'need two squads');
    d.order('cover', c);                       // the army takes ground
    const planted = c._planted;
    assert(planted, 'the army-wide order planted nothing to lose');

    d.order('charge', c, 1);                   // …and one squad is sent off it
    assert(c._planted === planted,
      'a per-squad charge un-planted the whole army — every other squad just lost the '
      + 'cover it was holding');

    /* AND AN ARMY-WIDE ADVANCE STILL DOES, which is the half that makes the
     * clause above a rule rather than an omission. */
    d.order('charge', c);
    assert(c._planted == null,
      'an army-wide charge left the army planted — the whole line is holding ground it '
      + 'was just ordered off');
    return 'a squad charge leaves the army where it stood; an army charge does not';
  });

  check('squads: the order readout does not repaint for an order one squad was given', async () => {
    /**
     * `onOrder` drives the one always-visible statement of what your men are
     * doing, and it fired for a per-squad order too — while the per-squad
     * branch deliberately does not set `c.formation`. So telling 2nd Squad to
     * take cover lit "Take cover" across the army's panel while the army was
     * still in line abreast.
     */
    const { d, c } = deployed();
    const seen = [];
    d.onOrder = (F, n, one) => seen.push([F.id, one ? one.name : null]);
    d.squadNames = ['', 'Havoc'];

    d.order('rank', c);
    assert(seen.length === 1 && seen[0][1] === null,
      `an army-wide order reported ${JSON.stringify(seen)}`);
    d.order('cover', c, 1);
    assert(seen.length === 2, `a per-squad order reported ${seen.length - 1} times`);
    assert(seen[1][1] === 'Havoc',
      `the per-squad order named ${JSON.stringify(seen[1])} — the HUD cannot tell it from `
      + 'an army-wide one, so it repaints the headline');

    /* AND THE HUD ITSELF PAINTS THEM APART. */
    const { readFile } = await import('node:fs/promises');
    const { makeDocument } = await import('./_page.mjs');
    const { HUD } = await import('../../src/ui/HUD.js');
    const INDEX = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const doc = makeDocument(INDEX);
    const restore = doc.install();
    try {
      const hud = new HUD(document, {});
      hud.setOrder('rank', 'Rank', 2, null);
      assert(doc.getElementById('rp-order-name').textContent === 'Rank',
        'an army-wide order did not reach the headline');
      hud.setOrder('cover', 'Take cover', 2, { squad: 1, name: 'Havoc' });
      assert(doc.getElementById('rp-order-name').textContent === 'Rank',
        'a per-squad order repainted the army-wide headline — the one persistent statement '
        + 'of what your men are doing, saying something no squad is doing');
      assert(/Havoc/.test(doc.getElementById('rp-order-sub').textContent),
        'the per-squad order is not on the panel at all');
      /* …and the target is HELD, not announced and forgotten. */
      hud.setTarget('Havoc');
      assert(/Havoc/.test(doc.getElementById('rp-order-sub').textContent),
        'the selected squad is not held on screen');
    } finally { restore(); }
    return 'the headline is the army\'s; the squad\'s order and the target share the line under it';
  });

  check('squads: the fight can say who is in which squad', async () => {
    /**
     * `CommandRoster.summary()` is what every HUD surface reads, and it did not
     * carry `squad` at all — so the roster column, the nameplates and the
     * minimap could not have grouped by squad if they wanted to. "I should be
     * able to separately view my squads in an actual game" had no data behind
     * it.
     */
    const { d, c } = deployed();
    d._troops(1 / 30, {});
    const sum = c.roster.summary();
    assert(sum.roll.length, 'the summary carries no men');
    for (const m of sum.roll) {
      assert('squad' in m && 'detached' in m,
        `a summary row carries ${Object.keys(m).join(',')} — no surface can group by squad`);
    }
    assert(sum.roll.some((m) => Number.isInteger(m.squad)), 'no man in the summary has a squad');

    const { rosterHtml } = await import('../../src/ui/HUD.js');
    const named = rosterHtml(sum, ['', 'Havoc'], 'Squad');
    assert(/Squad 1 —/.test(named) && /Havoc —/.test(named),
      'the roster column does not group under the squads\' own names');
    /* …and one squad is one list, not a heading over everybody. */
    const bare = rosterHtml({ ...sum, roll: sum.roll.map((m) => ({ ...m, squad: 0 })) },
      null, 'Squad');
    assert(!/Squad 1 —/.test(bare),
      'a roll with one squad in it sprouted a heading that says nothing');
    return `${sum.roll.length} men carry a squad; the column groups under the player's own names`;
  });

  check('squads: targeting one is a key, a chip and a wire', async () => {
    /**
     * The only way to order ONE squad was the wheel's Target slot: two full
     * hold-aim-release cycles for one order, on no list a player reads, with no
     * touch path at all — `Touch.js`'s own header claims the order wheel is "a
     * gesture a thumb already makes" and there is no button to hold. And a
     * joining player's selection was dropped at the wire.
     */
    const { defaultBindings, ORDER_ACTIONS } = await import('../../src/engine/Bindings.js');
    const b = defaultBindings();
    assert(Array.isArray(b.squadtarget) && b.squadtarget.length,
      'there is no binding for targeting a squad, so the only door is still the wheel');

    /* THE CHIP, on the strip a thumb can reach. */
    const { readFile } = await import('node:fs/promises');
    const { makeDocument } = await import('./_page.mjs');
    const { HUD } = await import('../../src/ui/HUD.js');
    const INDEX = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    const doc = makeDocument(INDEX);
    const restore = doc.install();
    try {
      const hud = new HUD(document, {});
      hud.setBindings(b);
      const chips = [...doc.querySelectorAll('#rp-orders .rp-key')];
      assert(chips.length === ORDER_ACTIONS.length + 1,
        `${chips.length} chips for ${ORDER_ACTIONS.length} orders and a target`);
      assert(chips.every((ch) => ch.dataset.action),
        'a chip carries no data-action, so `Touch.bindWheel` cannot make it pressable and '
        + 'a phone player cannot give that order at all');
      assert(chips.some((ch) => ch.dataset.action === 'squadtarget'),
        'the target is not on the strip');
    } finally { restore(); }

    /* THE WIRE. A client's order used to carry the formation alone. */
    const sent = [];
    const shell = Object.create(Cmd.CommandDirector.prototype);
    shell._netShell = true;
    shell.world = { requestOrder: (id, squad) => { sent.push([id, squad]); return true; } };
    Cmd.CommandDirector.prototype.order.call(shell, 'cover', null, 2);
    assert(sent.length === 1 && sent[0][1] === 2,
      `a joining player's order reached the wire as ${JSON.stringify(sent[0])} — their squad `
      + 'selection was thrown away and the order went army-wide');

    /* …AND THE HOST READS IT BACK, refusing anything that is not an index. */
    const { World } = await import('../../src/game/World.js');
    const got = [];
    const host = Object.create(World.prototype);
    host.netMode = 'host';
    host.command = { order: (f, c, s) => { got.push([f, s]); return true; } };
    host.commanderFor = () => null;
    World.prototype.applyOrder.call(host, 'p', { f: 'cover', s: 2 });
    World.prototype.applyOrder.call(host, 'p', { f: 'cover', s: 'all' });
    World.prototype.applyOrder.call(host, 'p', { f: 'cover' });
    assert(got[0][1] === 2, `the host read squad ${got[0][1]} off the wire`);
    assert(got[1][1] === null && got[2][1] === null,
      `the host let ${JSON.stringify([got[1][1], got[2][1]])} through as a squad index`);
    return `bound to ${b.squadtarget[0]}, a chip on the strip, and the squad crosses the wire`;
  });
}
