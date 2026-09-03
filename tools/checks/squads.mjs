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
import { HUD, OrderWheel } from '../../src/ui/HUD.js';
import { makeDocument } from './_page.mjs';

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
    /* THE GENERAL WALKS OVER TO SAY IT. 70 m is twice ORDER_REACH's 34 m, and a
     * post — a per-squad order that does not advance — also has to satisfy
     * `_supervised`, which on a muster of ten rank-0 troopers means the general
     * inside RELAY_REACH, 20 m, of the squad's own centre. Said from the origin
     * the order is refused whole and `squadPlanted` is never even created;
     * what this check is about is what happens to that ground afterwards. He
     * walks back, so the wipe below is measured with him where he deployed. */
    c.player.position.set(70, 0, 0);
    assert(d.order('cover', c, 1) === true, '2nd squad refused ground it was standing on');
    c.player.position.set(0, 0, 0);
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
    const INDEX = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
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
    const { WHEEL_EXTRAS } = await import('../../src/ui/HUD.js');
    /* WHICH ACTION EACH WHEEL SLOT IS. The slot ids are the wheel's own words
     * and the action ids are the bindings table's; this is the one place they
     * are joined, and a slot missing from it fails the assertion below rather
     * than being quietly skipped. */
    const EXTRA_ACTION = { hold: 'holdground', squad: 'squadtarget', detach: 'detachman' };
    const b = defaultBindings();
    assert(Array.isArray(b.squadtarget) && b.squadtarget.length,
      'there is no binding for targeting a squad, so the only door is still the wheel');

    /* THE CHIP, on the strip a thumb can reach. */
    const { readFile } = await import('node:fs/promises');
    const { makeDocument } = await import('./_page.mjs');
    const { HUD } = await import('../../src/ui/HUD.js');
    const INDEX = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
    const doc = makeDocument(INDEX);
    const restore = doc.install();
    try {
      const hud = new HUD(document, {});
      hud.setBindings(b);
      const chips = [...doc.querySelectorAll('#rp-orders .rp-key')];
      /* THE COUNT IS DERIVED FROM BOTH TABLES, and the second one is the point.
       * `+ 1` was written when Target was the only wheel slot with a key, and
       * it went stale the day Hold ground and Detach got theirs — the same
       * hand-maintained `+ 1` that `WHEEL_EXTRAS`' own note says it was
       * exported to abolish, one file over. A fourth wheel slot with no chip is
       * red here now instead of silently uncounted. */
      assert(chips.length === ORDER_ACTIONS.length + WHEEL_EXTRAS.length,
        `${chips.length} chips for ${ORDER_ACTIONS.length} orders and `
        + `${WHEEL_EXTRAS.length} wheel verbs`);
      assert(chips.every((ch) => ch.dataset.action),
        'a chip carries no data-action, so `Touch.bindWheel` cannot make it pressable and '
        + 'a phone player cannot give that order at all');
      /**
       * EVERY VERB ON THE WHEEL THAT IS NOT A FORMATION HAS A KEY AND A CHIP.
       *
       * `registerOrders` builds a row per FORMATION, so the nine shapes each
       * got a key, a chip, a controls row and a rebind — and Hold ground and
       * Detach, which are not formations, got a wheel slot and nothing else.
       * Reachable only by hold-aim-release, on no list a player reads,
       * unrebindable, and unreachable on a phone (the wheel is a HELD key and
       * a phone has no button to hold). Target had exactly this defect and was
       * pulled out of the wheel for exactly this reason; these two were left.
       *
       * DERIVED FROM `WHEEL_EXTRAS` so the next one cannot be forgotten. */
      const byAction = new Set(chips.map((ch) => ch.dataset.action));
      const orphan = WHEEL_EXTRAS.filter((x) => !EXTRA_ACTION[x.id]
        || !byAction.has(EXTRA_ACTION[x.id]) || !b[EXTRA_ACTION[x.id]]?.length);
      assert(!orphan.length,
        `${orphan.map((x) => x.name).join(', ')} — on the wheel with no key, no chip or both, `
        + 'which makes it a control a player can only find by sweeping a radial menu');
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
  check('squads: two squads sent forward on their own do not stand in each other', () => {
    /**
     * ── THE OTHER HALF OF THE SHAPE, AND IT TOOK A MEASUREMENT TO FIND ────
     *
     * Laying a delegated squad out with its own index and count is right and
     * is not enough: an ADVANCING order writes no plant, so two squads both
     * told to advance both fell through to the commander's frame and solved
     * the SAME shape around the SAME point. `front`'s slot ignores the squad
     * index entirely, so ten men landed on five slots — five stacked pairs,
     * which is worse than the half-ring it replaced.
     *
     * A squad you send forward on its own goes forward from its own ground.
     */
    const { d, c } = deployed();
    const squads = d.squadsOf(c);
    assert(squads.length >= 2, 'need two squads');
    for (const t of squads[0]) if (t.body) t.body.position.set(-90, 0, 0);
    for (const t of squads[1]) if (t.body) t.body.position.set(90, 0, 0);
    d._troops(1 / 30, {});

    /* EACH ORDER IS GIVEN FROM THE SQUAD'S OWN GROUND. 90 m is well past
     * ORDER_REACH's 34 m, so shouted from the origin neither squad hears it,
     * both keep the army's formation and both solve one shape around one point
     * — which is the exact stacking this check exists to catch, arrived at for
     * a reason that has nothing to do with the shape. `front` advances, so the
     * post rule never applies and the two men-tests pass where they stand:
     * default morale reads 0.43 against SHAKEN_AT's 0.30, and a squad standing
     * on itself is nobody's idea of alone. He returns to the origin before the
     * shapes are measured. */
    c.player.position.set(-90, 0, 0);
    assert(d.order('front', c, 0) === true, '1st squad refused an advance from its own ground');
    c.player.position.set(90, 0, 0);
    assert(d.order('front', c, 1) === true, '2nd squad refused an advance from its own ground');
    c.player.position.set(0, 0, 0);
    d._troops(1 / 30, {});

    const slots = [];
    for (const sq of [squads[0], squads[1]]) {
      for (const t of sq) {
        const v = d.slotFor(t.body, new THREE.Vector3());
        if (v) slots.push(v.clone());
      }
    }
    assert(slots.length >= 8, `${slots.length} men solved a slot`);
    let worst = Infinity;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        worst = Math.min(worst, slots[i].distanceTo(slots[j]));
      }
    }
    assert(worst > 0.5,
      `two men were sent to slots ${worst.toFixed(2)} m apart — the two squads are solving `
      + 'one shape around one point');
    /* …AND THE TWO SQUADS ARE ACTUALLY APART, not merely non-identical. */
    const mid = (sq) => {
      const v = new THREE.Vector3();
      let n = 0;
      for (const t of sq) {
        const p = d.slotFor(t.body, new THREE.Vector3());
        if (p) { v.add(p); n++; }
      }
      return n ? v.divideScalar(n) : null;
    };
    const a = mid(squads[0]); const b = mid(squads[1]);
    assert(a && b && a.distanceTo(b) > 60,
      `the two squads' shapes are centred ${a && b ? a.distanceTo(b).toFixed(0) : '?'} m apart `
      + 'after being sent forward from ground 180 m apart');
    return `${slots.length} distinct slots, closest pair ${worst.toFixed(1)} m, the two shapes `
      + `${a.distanceTo(b).toFixed(0)} m apart`;
  });

  check('squads: an order into a squad nobody answers to is refused, out loud', () => {
    /**
     * `cycleSquad` clamps the selection when Target is pressed, and that was
     * the ONLY moment it clamped. Select 2nd Squad, lose 2nd Squad, press an
     * order key: `order` returned true, wrote a plant on nobody, fired
     * `onOrder` so the panel printed "Squad 2 — take cover", toasted it, and
     * did nothing whatever on the field. An order that vanishes silently is
     * worse than one that is refused.
     */
    const { d, c } = deployed();
    const squads = d.squadsOf(c);
    assert(squads.length >= 2, 'need two squads');
    d.selectedSquad = 1;
    for (const t of squads[1]) { t.alive = false; if (t.body) t.body.dead = true; }
    const said = [];
    d.onTarget = (name) => said.push(['target', name]);
    d.world.notes.length = 0;

    assert(d.order('cover', c, 1) === false,
      'an order into a wiped squad was accepted');
    assert(!c.squadPlanted?.has('1'), 'the refused order still planted ground on nobody');
    assert(!c.squadOrders?.has('1'), 'the refused order still wrote a squad order');
    assert(d.world.notes.some(([a]) => /NOBODY ANSWERS/.test(a)),
      `the refusal said ${JSON.stringify(d.world.notes.map(([a]) => a))}`);
    assert(d.selectedSquad === null, 'the selection stayed on a squad nobody answers to');
    assert(said.some(([, n]) => n === null), 'the panel was not told the target had gone');

    /* AND AN INDEX THAT WAS NEVER A SQUAD IS THE SAME ANSWER. */
    assert(d.order('cover', c, 99) === false, 'an order to squad 100 was accepted');
    assert(!c.squadOrders?.has('99'), 'squad 100 has an order');
    return 'a wiped squad and an invented one are both refused, and the selection goes with them';
  });

  check('squads: a detached man is never a squad, and never takes a squad\'s name', () => {
    /**
     * Solo groups used to be appended after the last LIVE squad, so wiping the
     * top squad shifted every detached man down one index — carrying
     * `squadOrders`, `squadPlanted`, `selectedSquad` and the NAME with him.
     * Measured before the fix: with two squads and one detached man the game
     * announced "REAPER HAS THE GROUND — trooper CT-7200, 1 man", a lone
     * trooper wearing the name the player typed for 3rd Squad.
     */
    const { d, c } = deployed();
    d.squadNames = ['1st', '2nd', 'Reaper'];
    const before = d.squadsOf(c);
    const loose = before[1][0];
    assert(c.roster.detach(loose, true), 'the fixture could not detach a man');
    const after = d.squadsOf(c);
    const at = after.findIndex((sq) => sq.length === 1 && sq[0] === loose);
    assert(at >= Cmd.SQUAD_SLOTS,
      `a detached man sits at index ${at} and the squad ceiling is ${Cmd.SQUAD_SLOTS} — his `
      + 'index is a squad number and will be somebody else\'s tomorrow');
    assert(!/Reaper|1st|2nd/.test(d.squadLabel(at, c)),
      `a detached man is called "${d.squadLabel(at, c)}" — a name the player typed for a squad`);
    assert(/detached/i.test(d.squadLabel(at, c)),
      `a detached man is called "${d.squadLabel(at, c)}"`);

    /* …AND HIS INDEX DOES NOT MOVE WHEN A SQUAD DIES. */
    for (const t of after[0]) { t.alive = false; if (t.body) t.body.dead = true; }
    const later = d.squadsOf(c);
    const now = later.findIndex((sq) => sq.length === 1 && sq[0] === loose);
    assert(now === at,
      `the detached man moved from index ${at} to ${now} because another squad died`);
    return `detached at index ${at} past a ceiling of ${Cmd.SQUAD_SLOTS}, named `
      + `"${d.squadLabel(at, c)}", and it does not move when a squad is wiped`;
  });

  check('squads: the panel counts the squads that have men in them', async () => {
    /**
     * `squadsOf` is indexed by the squad NUMBER, so its length counts SLOTS
     * including wiped ones. Both the order panel's count and the wheel's
     * caption read it, so wiping 1st Squad left the panel saying "2 squads"
     * for the rest of the run while pressing Target — which filters — found
     * one and did nothing. That is the owner's original complaint, made
     * literally worse.
     */
    const { d, c } = deployed();
    /* The list is padded to `SQUAD_SLOTS` so a detached man's index can never
     * be a squad's — see the note on `squads()` — which is exactly why its
     * length was never a count of squads and reading it as one was the bug. */
    assert(d.squadsOf(c).length >= Cmd.SQUAD_SLOTS,
      `the list is ${d.squadsOf(c).length} long and the ceiling is ${Cmd.SQUAD_SLOTS}`);
    assert(d.liveSquads(c).length === 2,
      `the fixture deployed ${d.liveSquads(c).length} live squads`);
    const seen = [];
    d.onOrder = (F, n) => seen.push(n);
    d.order('rank', c);
    assert(seen[0] === 2, `a two-squad army reported ${seen[0]} squads`);

    for (const t of d.squadsOf(c)[0]) { t.alive = false; if (t.body) t.body.dead = true; }
    assert(d.liveSquads(c).length === 1,
      `${d.liveSquads(c).length} live squads after one of two was wiped`);
    d.order('rank', c);
    assert(seen[1] === 1,
      `one squad is standing and the panel was told ${seen[1]} — the count is of slots`);
    assert(d.readout(c).squads === 1,
      `the readout says ${d.readout(c).squads} squads with one standing`);
    return '2 → 1 as a squad is lost, on the panel and in the readout';
  });

  /**
   * ══ AND THE SCREEN IS DRIVEN, NOT THE DIRECTOR ═════════════════════════
   *
   * The check above asserts `onOrder`'s `n` and `readout().squads`. Its own
   * header names *the wheel's caption* as one of the two readers of the wrong
   * number — and then does not touch it. An audit measured what the player
   * actually saw, on a real page, through the real HUD:
   *
   *   the wheel's Target caption      "All 5 squads."   with two on the field
   *                                   "All 5 squads."   with one
   *   the order panel's second line   "2 squads"        with one standing
   *   the roster column after detach  no Detached heading, ever
   *   the roster column's `post`      not rendered anywhere at all
   *
   * Four separate readings, all wrong, all downstream of a suite that stopped
   * at the director. So this one starts at `roster.summary()` — the object
   * that actually crosses to the UI — and reads the HTML the player would.
   *
   * ON THE REAL `index.html`, because `#rp-list` and the wheel's host are ids
   * in that file and a bag of fake nodes can only ever agree with itself.
   * Synchronous between install and restore, for the reason `hud-events.mjs`
   * gives: the runner starts the next check the moment this one suspends.
   */
  check('squads: the wheel, the panel and the column all count the same squads', async () => {
    const { readFile } = await import('node:fs/promises');
    const INDEX = await readFile(new URL('../../index.play.html', import.meta.url), 'utf8');
    const { d, c } = deployed();
    const doc = makeDocument(INDEX);
    const restore = doc.install();
    try {
      const hud = new HUD(doc);
      const wheel = new OrderWheel(doc.getElementById('order-wheel'), FORMATIONS);
      wheel.director = d;
      const target = wheel.items.find((i) => i.kind === 'squad');
      assert(target, 'the wheel has no Target slot');
      const cap = () => wheel.captionFor(target);
      const list = () => doc.getElementById('rp-list').innerHTML;
      const sub = () => doc.getElementById('rp-order-sub').textContent;

      /* TWO SQUADS, AND EVERY SURFACE SAYS TWO. */
      assert(d.liveSquads(c).length === 2, `the fixture deployed ${d.liveSquads(c).length} squads`);
      hud.setRoster(d.roster.summary());
      assert(/All 2 squads/.test(cap()),
        `the wheel says "${cap()}" with two squads on the field`);
      assert(/2 squads/.test(sub()), `the panel says "${sub()}" with two squads standing`);

      /* …AND A SQUAD UNDER AN ORDER THAT PLANTS NOTHING. `charge` is one of the
       * seven `advance` formations, which is the case `_vacancy` could not see.
       * `order()` is the real door; the HUD hears it through `onOrder` exactly
       * as main.js wires it. */
      d.onOrder = (F, n, one) => hud.setOrder(F.id, F.name, n, one);
      d.selectedSquad = 0;
      assert(d.order('charge', c, 0), 'the fixture could not order squad 0 to charge');
      assert(/charge/i.test(sub()), `the panel says "${sub()}" after squad 0 was told to charge`);

      /* ── WIPE IT. Nothing calls an order key again — which is the point: the
       * panel used to be repainted by `setOrder` and by nothing else. */
      for (const t of d.squadsOf(c)[0]) { t.alive = false; if (t.body) t.body.dead = true; }
      hud.setRoster(d.roster.summary());
      assert(/One squad/.test(cap()),
        `the wheel says "${cap()}" with one squad left — the count is of slots`);
      assert(!/charge/i.test(sub()),
        `the panel still says "${sub()}" for a squad with nobody alive in it`);
      assert(!/2 squads/.test(sub()), `the panel says "${sub()}" with one squad standing`);

      /* ── DETACH A MAN and the column regroups. The cache key carried neither
       * `squad` nor `detached`, so `rosterHtml` produced a Detached heading and
       * `#rp-list` did not — for the rest of the run. */
      const live = d.squadsOf(c).find((sq) => sq.some((t) => t.alive !== false));
      const loose = live.find((t) => t.alive !== false);
      assert(c.roster.detach(loose, true), 'the fixture could not detach a man');
      hud.setRoster(d.roster.summary());
      assert(/Detached/.test(list()), 'the column never regrouped a detached man');

      /* ── AND THE POST IS ON SCREEN. `summary()` has carried it since the
       * licence was written and `grep -c post src/ui/HUD.js` was 0: the one
       * decision the licence asks the player to make was invisible in a fight
       * until the man holding it died. */
      const seat = d.squadsOf(c).flat().find((t) => t.alive !== false && t !== loose);
      seat.xp = 999;
      const got = c.roster.appoint(seat, true);
      assert(got.ok, `the fixture could not give the post: ${got.reason}`);
      hud.setRoster(d.roster.summary());
      assert(list().includes(seat.name) && /rp-post/.test(list()),
        'the man who holds the squad is unmarked on the roster column');
      return `wheel 2 → one squad · the panel drops a wiped squad's charge with no order pressed `
        + `· a detached man regroups · ${seat.name} is marked as holding the squad`;
    } finally { restore(); }
  });

  /**
   * ══ A WIPED SQUAD'S ORDER IS GIVEN UP, WHATEVER IT WAS ═════════════════
   *
   * `_vacancy` drops a squad's order only when the order PLANTED — and seven
   * of the nine formations are `advance` and plant nothing. Measured through
   * the real `order()` and the real `onDeath`:
   *
   *     cover   plants     "Havoc — take cover"    → dropped ✓
   *     charge  plants not "Havoc — charge"        → kept for ever ✗
   *     line    plants not "Havoc — line abreast"  → kept for ever ✗
   *
   * So for seven of nine orders `c.squadOrders` kept an entry for a squad with
   * nobody alive in it, `_formationFor` went on reading it, and the panel went
   * on naming a dead squad until the area boundary.
   *
   * EVERY FORMATION, DERIVED. The list is `FORMATIONS` itself rather than the
   * two that were known to be broken: the defect was that a property of the
   * order decided whether the bookkeeping happened, and the only way to hold
   * that closed is to drive all of them.
   */
  check('squads: whatever a wiped squad was told, it is given up', () => {
    const kept = [];
    for (const id of Object.keys(FORMATIONS)) {
      const { d, c } = deployed();
      const men = d.squadsOf(c)[0];
      assert(men?.length, `the fixture has no squad 0 for ${id}`);
      /* In earshot, so the order lands rather than being refused for distance.
       * `_ask`'s fear and isolation terms are satisfied by a full squad at
       * full morale, which is what `deploy()` produces. */
      for (const t of men) if (t.body) t.body.position.set(-4, 0, 0);
      c.player.position.set(0, 0, 0);
      if (!d.order(id, c, 0)) continue;                 // refused: nothing to give up
      assert(c.squadOrders?.get('0') === id,
        `${id} did not write squad 0's own order`);
      /* THROUGH `onDeath`, ONE AT A TIME, which is the only way a squad is ever
       * actually wiped. `squads()` slices the LIVING list, so killing the
       * records first and then reporting one death asks about a squad that no
       * longer exists and `_squadKeyOf` comes back null — a fixture that could
       * not reach the branch it is about. */
      for (const t of men.slice()) d.onDeath(t.body, null);
      assert(!men.some((t) => t.alive !== false), `${id} left men alive in a wiped squad`);
      if (c.squadOrders?.has('0')) kept.push(`${id} (${FORMATIONS[id].advance ? 'advance' : 'plants'})`);
    }
    assert(!kept.length,
      `${kept.length} of ${Object.keys(FORMATIONS).length} orders survived the squad that was `
      + `under them: ${kept.join(', ')}`);
    return `all ${Object.keys(FORMATIONS).length} formations give the squad up when it is wiped`;
  });

  /**
   * ══ THE DOOR NORMALISES THE INDEX, BECAUSE IT IS THE DOOR ══════════════
   *
   * `order()`'s own note calls itself "the door every path goes through" and
   * trusted its callers to hand it an integer. Measured: `order('cover', c,
   * 1.7)` returned TRUE, ordered squad 1's men — `squadsOf(c)[Number(squad) |
   * 0]` truncates — and wrote `squadOrders['1.7']` and `squadPlanted['1.7']`,
   * keys `_formationFor(c, 1)` looks up under `'1'` and can never read. The
   * order landed and the squad's memory of it went into a slot nothing opens.
   * `order('cover', c, -1)` was refused with a message naming "Squad 0", a
   * squad that exists and had nothing to do with it.
   *
   * Latent — the wire door validates and no local caller computes an index —
   * and latent is what this shape is until the day something does.
   */
  check('squads: an index that is not a squad number is not half-obeyed', () => {
    const { d, c } = deployed();
    const men = d.squadsOf(c)[1];
    for (const t of men) if (t.body) t.body.position.set(-4, 0, 0);
    c.player.position.set(0, 0, 0);
    assert(d.order('cover', c, 1.7), 'the fixture could not order squad 1');
    const keys = [...(c.squadOrders?.keys() || [])];
    assert(keys.length === 1 && keys[0] === '1',
      `a fractional index wrote ${JSON.stringify(keys)} — a key nothing reads`);
    assert([...(c.squadPlanted?.keys() || [])].every((k) => k === '1'),
      `the plant went under ${JSON.stringify([...c.squadPlanted.keys()])}`);

    /* …AND A NUMBER BELOW THE FLOOR IS REFUSED WITHOUT BLAMING A REAL SQUAD. */
    const before = new Map(c.squadOrders);
    assert(d.order('cover', c, -1) === false, 'an order for squad -1 was taken');
    assert(!/Squad 1\b/.test(d.orderRefused || ''),
      `the refusal for index -1 says "${d.orderRefused}" — a squad that exists`);
    assert(c.squadOrders.size === before.size, 'the refused order still wrote a key');
    /* AND NEVER SILENTLY THE WHOLE ARMY: `null` means every squad here, so an
     * index nobody can answer to must not become one. */
    assert(d.order('cover', c, NaN) === false, 'an order for NaN was taken by the whole army');
    return `1.7 → key "1" · -1 refused as "${d.orderRefused}" · NaN refused, not army-wide`;
  });

}
