/**
 * THE MEDBAY — and whether a wound survives the walk to the door.
 *
 * V16 §C1 asked for one thing above all the rest: *"you actually see them
 * being healed (would take time in game)."* Everything in this file is about
 * whether that sentence is true, and the failure it exists to catch is not a
 * crash — it is a medbay that LOOKS like it works. A tank that lights up, a
 * banner that says six hours, a roll that quietly forgets by the next reload.
 * Every clause below is therefore driven through the shipped store and the
 * shipped clock, never through a hand-set field.
 *
 * THE FOUR THINGS THAT WOULD MAKE IT A DECORATION, each with a clause:
 *
 *   THE WOUND NEVER LEAVES THE GROUND. `Trooper` has no health of its own —
 *     the hit points are on a body that is disposed at the area boundary — so
 *     "how badly was he hurt" is answerable for exactly as long as `bank()`
 *     takes to run. If `Company.manOf` does not read it there, nothing ever
 *     can, and the medbay has no patients.
 *   THE CLOCK IS NOT REALLY THE CLOCK. Six hours has to mean six hours of
 *     `st.hour`, the same one the departure boards read, surviving a reload
 *     and surviving midnight. A private timer that counts frames would pass
 *     any test that did not name the station's own clock.
 *   THE WALK BUYS NOTHING. If an untended man mends at the same rate as one in
 *     a tank then the whole loop is a chore with a light on it. The gap is
 *     asserted as a RATIO, so tuning either number keeps the clause honest.
 *   THE GLASS LIES. `#44` is five tanks you can look through, and a lit tank
 *     with nobody in it — or a man in two of them — is the one failure a
 *     player would see before any check did.
 */

import { readFile } from 'node:fs/promises';
import { clocked } from './_shared.mjs';
import * as Company from '../../src/game/Company.js';
import * as Medbay from '../../src/game/Medbay.js';
import { ARMIES, CommandRoster } from '../../src/game/Command.js';
import { clearStation, setStationHour } from '../../src/game/StationSave.js';

const KEY = 'saber.company.v1';

/**
 * Run `fn` against an empty company store and an empty station fold, and put
 * the player's own back afterwards.
 *
 * BOTH KEYS, because this file is the first thing in the tree that reads one
 * and writes the other in the same breath: the ward lives on the company
 * record and the hour it was settled at comes off the station's. A fixture
 * that cleaned only one would leave the other's state behind for the next
 * clause to trip over, which is the failure `company.mjs`'s own wrapper
 * already names for the muster slate.
 */
function withCleanStore(fn) {
  const had = localStorage.getItem(KEY);
  const hadStation = localStorage.getItem('saber.station.v1');
  localStorage.removeItem(KEY);
  clearStation();
  try { return fn(); }
  finally {
    if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had);
    clearStation();
    if (hadStation != null) localStorage.setItem('saber.station.v1', hadStation);
  }
}

/** A roll of `n` fresh clones off the REAL roster, so the names are real. */
function freshRoll(n, army = ARMIES.republic) {
  const r = new CommandRoster(army);
  for (let i = 0; i < n; i++) r.enlist(army.tiers[0].type);
  return r;
}

/**
 * A BODY WITH A WOUND ON IT, in the two fields `Company.manOf` reads.
 *
 * `Enemy` needs a live world, a scene and a rig to exist, and what this asks
 * of a body is `hp`, `maxHp` and `dead` — three public fields the whole tree
 * writes directly. The clause that needs a REAL body builds one; the rest use
 * this, and the difference is stated rather than hidden.
 */
const hurtBody = (frac, max = 100) => ({ hp: max * frac, maxHp: max, dead: false });

/** No `fetch` in node: the rooms come off disk through the shipped decoder. */
function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/**
 * The same wrapper for a body that has to await something.
 *
 * `clocked` serialises every body in this file behind one lock, so nothing
 * else is reading the store while this runs; what the synchronous version
 * cannot do is hold the keys across an `await`, because its `finally` fires
 * the moment the body returns its promise rather than when the work is done.
 */
async function withCleanStoreAsync(fn) {
  const had = localStorage.getItem(KEY);
  const hadStation = localStorage.getItem('saber.station.v1');
  localStorage.removeItem(KEY);
  clearStation();
  try { return await fn(); }
  finally {
    if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had);
    clearStation();
    if (hadStation != null) localStorage.setItem('saber.station.v1', hadStation);
  }
}

/** The station, booted through the same door the game uses. Deck 48. */
async function station(deck = 48) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return { world, idle: idleInput() };
}

export async function run({ check, assert, near }) {
  check = await clocked(check);

  /* ════════════════════════════════════════════════════════════════════════ */

  check('medbay: the wound survives the ramp — the roll remembers how badly, and forgets when he mends',
    () => withCleanStore(() => {
      /**
       * THE JOIN THAT DID NOT EXIST. Driven through the real fold: a real
       * roster, real `Trooper`s, real `Company.keep`, and the answer read back
       * out of localStorage through `Company.load` rather than off the object
       * `keep` returned.
       */
      const roster = freshRoll(3);
      const [a, b, c] = roster.all;
      a.body = hurtBody(0.35);   // half gone and then some — a stretcher case? no: walking
      b.body = hurtBody(0.10);   // only just alive
      c.body = hurtBody(0.95);   // a scorched pauldron
      Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });

      const roll = Company.load('republic');
      const ma = roll.men.find((m) => m.designation === a.designation);
      const mb = roll.men.find((m) => m.designation === b.designation);
      const mc = roll.men.find((m) => m.designation === c.designation);
      near(Medbay.hpOf(ma), 0.35, 1e-6, 'the roll did not keep what he came home with');
      near(Medbay.hpOf(mb), 0.10, 1e-6, 'the roll did not keep the critical man');
      /* THE STORE KEEPS THE FACT AND THE MEDBAY DRAWS THE LINE. 0.95 is what
       * happened to him and `Company.js` is right to keep it; what must not
       * happen is the ward admitting him for it. One advance of the clock
       * clears the scratch off the roll entirely. */
      near(Medbay.hpOf(mc), 0.95, 1e-6, 'the roll did not keep the scorched pauldron');
      assert(!Medbay.isHurt(mc), 'a man on 95% health reads as a patient — the ward would admit the company');
      Medbay.advance('republic', 1);
      assert(Company.load('republic').men.find((m) => m.designation === c.designation).hp === undefined,
        'a scratch follows a man for ever');

      /* AND HOW LONG THAT MEANS, which is the number the player is promised. */
      near(Medbay.hoursLeft(ma), 6, 0.001, 'a man at half health is not out for six hours');
      assert(Medbay.needsLitter(mb) && !Medbay.needsLitter(ma),
        'the game cannot tell a man who can walk from one who has to be carried');
      assert(Medbay.wounded(roll).map((m) => m.designation).join() === `${mb.designation},${ma.designation}`,
        'the wounded are not listed worst first');

      /* AND THE OTHER DIRECTION: he goes out again and comes home whole. */
      const back = new CommandRoster(ARMIES.republic);
      const live = roll.men.map((m) => back.enlistRecord(m)).filter(Boolean);
      for (const t of live) t.body = hurtBody(1.0);
      Company.keep(live, { army: 'republic', deployed: live, ground: 'kashyyyk' });
      const after = Company.load('republic');
      assert(after.men.every((m) => m.hp === undefined),
        `${after.men.filter((m) => m.hp !== undefined).length} men came home whole and stayed on the list`);
      return `${Medbay.hpOf(ma).toFixed(2)} / ${Medbay.hpOf(mb).toFixed(2)} / whole stored off real bodies; `
        + `${Medbay.hoursLeft(ma).toFixed(1)} h and ${Medbay.hoursLeft(mb).toFixed(1)} h owed; `
        + 'a whole run home clears all three';
    }));

  /* ════════════════════════════════════════════════════════════════════════ */

  check('medbay: six station hours in a tank and he is on his feet — the man nobody walked there is not',
    () => withCleanStore(() => {
      /**
       * ══ THE HEADLINE, AND THE WHOLE POINT OF THE LANE ═══════════════════
       *
       * Two men, identically hurt, one difference between them: somebody
       * walked one of them to `#44`. Six station hours later — twelve real
       * minutes on the wall — one is on the roll fit for the line and the
       * other is still a patient.
       *
       * This is also the clause that would go red the day the walk stops
       * buying anything, which is the way this feature dies: not by breaking,
       * by being made kind.
       */
      const roster = freshRoll(2);
      const [tended, left] = roster.all;
      tended.body = hurtBody(0.35);
      left.body = hurtBody(0.35);
      Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });

      const admitted = Medbay.checkIn('republic', tended.designation);
      assert(admitted.admitted.length === 1 && !admitted.turned.length,
        `check-in took ${admitted.admitted.length} and turned ${admitted.turned.length}`);
      assert(Medbay.inTank(Company.load('republic'), { designation: tended.designation }),
        'he was admitted and is not behind any glass');

      const six = Medbay.advance('republic', 6);
      const roll = Company.load('republic');
      const mt = roll.men.find((m) => m.designation === tended.designation);
      const ml = roll.men.find((m) => m.designation === left.designation);

      assert(six.healed.includes(tended.designation),
        `six hours in a tank did not finish him — he is on ${Medbay.hpOf(mt).toFixed(2)}`);
      assert(!Medbay.isHurt(mt), 'he is off the tank list and still counts as hurt');
      assert(Medbay.isHurt(ml),
        'the man nobody checked in mended just as fast — the walk to the medbay buys nothing');

      /* THE GAP, AS A RATIO, so tuning either number keeps this honest. */
      const gained = Medbay.hpOf(ml) - 0.35;
      const wanted = (Medbay.FIT / Medbay.HOURS) * Medbay.UNTENDED * 6;
      near(gained, wanted, 1e-9, 'the untended rate is not the rate the file states');
      const stillOwed = Medbay.hoursLeft(ml, Medbay.UNTENDED);
      assert(stillOwed > 12, `the untended man has only ${stillOwed.toFixed(1)} h left after six`);

      /* AND THE TANK LET GO OF HIM THE MOMENT HE WAS FIT. */
      assert(Medbay.occupied(roll) === 0,
        `${Medbay.occupied(roll)} tank(s) still lit for a man who is well`);
      return `tank: 0.35 → fit in 6 h; untended: 0.35 → ${Medbay.hpOf(ml).toFixed(3)} in the same six, `
        + `${stillOwed.toFixed(1)} h still owed (${(stillOwed / 6).toFixed(1)}× the walk); tank released`;
    }));

  /* ════════════════════════════════════════════════════════════════════════ */

  check('medbay: five tanks, worst first, and a bad run overflows them', () => withCleanStore(() => {
    /**
     * `StationKit.tankrow` builds FIVE and a deployment is ten, so the ward
     * filling up is not an edge case — it is what a bad run looks like. What
     * is asserted is that the overflow is TRUTHFUL: the men who got a tank are
     * the five worst, the two who did not are named rather than silently
     * dropped, and nobody is in two tanks at once.
     */
    const roster = freshRoll(7);
    roster.all.forEach((t, i) => { t.body = hurtBody(0.05 + i * 0.08); });
    Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });
    const roll = Company.load('republic');
    const order = Medbay.wounded(roll).map((m) => m.designation);
    assert(order.length === 7, `${order.length} of seven hurt men reached the roll`);

    const r = Medbay.checkIn('republic');
    assert(r.admitted.length === Medbay.TANKS,
      `${r.admitted.length} men into ${Medbay.TANKS} tanks`);
    assert(r.turned.length === 2 && r.full, `${r.turned.length} turned away, full=${r.full}`);
    assert(r.admitted.join() === order.slice(0, Medbay.TANKS).join(),
      'the tanks did not go to the five worst men');
    assert(r.turned.join() === order.slice(Medbay.TANKS).join(),
      'the two turned away are not the two least hurt');

    const after = Company.load('republic');
    const tanks = Medbay.wardOf(after).tanks;
    assert(new Set(tanks.filter(Boolean)).size === Medbay.TANKS,
      'a designation is in two tanks at once');
    assert(Medbay.tanksFree(after) === 0, `${Medbay.tanksFree(after)} tanks free on a full ward`);

    /* AND A SECOND CHECK-IN CHANGES NOTHING — a patient who moved tanks
     * because somebody opened a menu is a patient the glass lied about. */
    const again = Medbay.checkIn('republic');
    assert(!again.admitted.length, `a second check-in moved ${again.admitted.length} men`);
    assert(Medbay.wardOf(Company.load('republic')).tanks.join() === tanks.join(),
      'the ward re-shuffled itself on a second check-in');

    /* AND PULLING ONE OUT FREES HIS TANK FOR THE NEXT MAN — the release. */
    const out = Medbay.discharge('republic', r.admitted[0]);
    assert(out.length === 1, `discharge released ${out.length}`);
    const room = Medbay.checkIn('republic', r.turned[0]);
    assert(room.admitted.join() === r.turned[0],
      `the freed tank did not take the man who was turned away (${room.admitted.join() || 'nobody'})`);
    return `${Medbay.TANKS} tanks to the ${Medbay.TANKS} worst of 7; 2 turned away by name; `
      + 'a second check-in moves nobody; a release seats the next man';
  }));

  /* ════════════════════════════════════════════════════════════════════════ */

  check('medbay: the clock on the wall is the clock — it persists, and midnight is two hours and not minus twenty-two',
    () => withCleanStore(() => {
      /**
       * `StationSave.hour` is a TIME OF DAY and wraps at 24, which is the one
       * arithmetic mistake this whole mechanism could make: a man admitted at
       * 23:00 and looked at at 01:00 has had two hours of care, and a naive
       * subtraction says he has had minus twenty-two — either curing him
       * instantly or freezing him for ever depending on which way the clamp
       * fell. Driven through the shipped `setStationHour`.
       */
      const roster = freshRoll(1);
      roster.all[0].body = hurtBody(0.35);
      const him = roster.all[0].designation;
      Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });
      Medbay.checkIn('republic', him);

      setStationHour(23);
      const first = Medbay.settle('republic');
      assert(first.hours === 0, `the first settle healed ${first.hours} h out of nowhere`);
      near(Medbay.wardOf(Company.load('republic')).at, 23, 1e-9, 'the ward did not stamp the hour');

      setStationHour(1);
      const wrapped = Medbay.settle('republic');
      near(wrapped.hours, 2, 1e-9, 'the ward read midnight as a negative span');
      const mid = Company.load('republic').men.find((m) => m.designation === him);
      near(Medbay.hpOf(mid), 0.35 + (Medbay.FIT / Medbay.HOURS) * 2, 1e-9,
        'two hours across midnight did not buy two hours of bacta');

      /* AND IT IS ON DISK, not in a variable. Re-read from localStorage and
       * finish him off across a second wrap. */
      const raw = JSON.parse(localStorage.getItem(KEY));
      assert(raw.republic.ward.tanks.includes(him), 'the ward is not in the stored blob');
      near(raw.republic.men.find((m) => m.designation === him).hp, Medbay.hpOf(mid), 1e-9,
        'the mended health is not what was written to disk');

      setStationHour(5);
      const done = Medbay.settle('republic');
      assert(done.healed.includes(him), `four more hours and he is still on ${Medbay.hpOf(mid).toFixed(2)}`);
      assert(Medbay.occupied(Company.load('republic')) === 0, 'his tank is still lit');
      return `23:00 → 01:00 read as 2.0 h (not −22); mended 0.350 → ${Medbay.hpOf(mid).toFixed(3)} on disk; `
        + '01:00 → 05:00 finished him and freed the tank';
    }));

  /* ════════════════════════════════════════════════════════════════════════ */

  check('medbay: the worst are carried — two fit men to a litter, and it says when there are not enough hands',
    () => withCleanStore(() => {
      /**
       * *"maybe the healthier troops carry the injured troops on a floating
       * stretcher."* The party is DERIVED from the roll, so what is asserted
       * is that the derivation is honest at the edges: the hands are spent
       * worst-first, a bearer is never spent twice, and a company that cannot
       * carry everybody says so instead of conjuring a man.
       */
      const roster = freshRoll(7);
      /* Two criticals, one walking wounded, four on their feet — which is
       * exactly two litters' worth of hands and not one man more. */
      const hp = [0.05, 0.20, 0.50, 1, 1, 1, 1];
      roster.all.forEach((t, i) => { t.body = hurtBody(hp[i]); });
      Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });
      const roll = Company.load('republic');
      const p = Medbay.party(roll);

      assert(p.litters.length === 2, `${p.litters.length} litters for two critical men`);
      assert(p.walking.length === 1, `${p.walking.length} men walking wounded, expected 1`);
      assert(p.fit.length === 4, `${p.fit.length} men fit to bear, expected 4`);
      assert(p.litters[0].man.designation === Medbay.wounded(roll)[0].designation,
        'the hands did not go to the worst man first');
      const hands = p.litters.flatMap((l) => l.bearers.map((m) => m.designation));
      assert(hands.length === 4, `${hands.length} bearers for two litters`);
      assert(new Set(hands).size === 4, 'a man is carrying two litters at once');
      assert(hands.every((n) => !Medbay.isHurt(roll.men.find((m) => m.designation === n))),
        'a wounded man was given a litter to carry');

      /* THE EDGE THAT MATTERS: three fit men cannot carry two. */
      const short = { men: roll.men.filter((m) => Medbay.isHurt(m) || hands.slice(0, 3).includes(m.designation)) };
      assert(Medbay.bearersAvailable(short).length === 3, 'the short company is not three pairs of hands');
      const q = Medbay.party(short);
      assert(q.litters.length === 1 && q.unborne.length === 1,
        `${q.litters.length} carried and ${q.unborne.length} left with three pairs of hands`);
      assert(q.unborne[0].designation === Medbay.wounded(short)[1].designation,
        'the man left behind is not the less critical of the two');
      /* AND THE ONE LINE THE BANNER SAYS ABOUT IT — a statement and not a
       * prompt, because nothing forces the walk. */
      const note = Medbay.arrivalNotice(roll);
      assert(note && note.title === '3 WOUNDED', `the banner says "${note?.title}"`);
      assert(/1 walking/.test(note.body) && /2 on litters/.test(note.body),
        `the banner says "${note.body}"`);
      assert(!/\?/.test(note.body), 'the banner asks a question — nothing forces the walk');
      assert(Medbay.arrivalNotice({ men: roll.men.filter((m) => !Medbay.isHurt(m)) }) === null,
        'a company that came home whole still gets a casualty banner');
      return `2 litters × ${Medbay.BEARERS} bearers off 4 fit men, no man on two; 1 walking; `
        + `3 hands carry one and name the one they cannot; banner: "${note.title} — ${note.body}"`;
    }));

  /* ════════════════════════════════════════════════════════════════════════ */

  check('medbay: you wake in the triage hall with the roll beside you', () => withCleanStore(() => {
    /**
     * *"when you die you wake up in the med bay."* A death screen is a modal
     * that stops the game to say the game stopped; a bed in `#43` with the
     * ward's own numbers on the curtain is the same information delivered by
     * the place it happened to.
     *
     * What is asserted is that the plan is REAL — a room that exists, a bay in
     * the six that are built, and the three numbers off the actual roll rather
     * than a placeholder — and that the same death puts you in the same bay,
     * which is what makes it a place rather than a shuffle.
     */
    const roster = freshRoll(4);
    roster.all.forEach((t, i) => { t.body = hurtBody(i < 2 ? 0.2 : 1); });
    Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });
    Medbay.checkIn('republic', Medbay.wounded(Company.load('republic'))[0].designation);
    const roll = Company.load('republic');
    const plan = Medbay.wakePlan(roll, 91125);

    assert(plan.place === Medbay.TRIAGE, `you wake in place ${plan.place}, not the medbay`);
    assert(plan.bay >= 0 && plan.bay < Medbay.BAYS, `bay ${plan.bay} of ${Medbay.BAYS}`);
    assert(plan.inTanks === 1 && plan.waiting === 1,
      `the curtain says ${plan.inTanks} in tanks and ${plan.waiting} waiting`);
    assert(plan.soonest && plan.soonest.tank === 0,
      'the room does not say who is coming off the list next');
    near(plan.soonest.hours, Medbay.hoursLeft({ hp: 0.2 }), 1e-9,
      'the hours on the curtain are not the hours the tank owes');
    assert(Medbay.wakePlan(roll, 91125).bay === plan.bay, 'the same death put you in a different bay');

    /* AND THE ROOMS IT NAMES ARE THE THREE THAT ARE BUILT. */
    return `#${plan.place} bay ${plan.bay + 1}/${Medbay.BAYS}, curtain reads ${plan.inTanks} in tanks · `
      + `${plan.waiting} waiting · ${plan.lost} lost; next out in ${plan.soonest.hours.toFixed(1)} h`;
  }));

  /* ════════════════════════════════════════════════════════════════════════ */

  check('medbay: the ward is a room that exists — deck 48, five tanks, where the kit built them', async () => {
    /**
     * The three rooms this lane points at are `StationPlan`'s and `StationKit`
     * builds them; this file may not and does not touch either. What is
     * measured is that the ids it names are the rooms it thinks they are, that
     * they are ON the deck the station boots, and that `Medbay.tankLocal`
     * lands on the same five points `tankrow`'s own loop does — because a
     * renderer standing a body behind the glass asks this file where the glass
     * is, and a copy of a formula that has drifted puts a man in a wall.
     */
    const { PLACES } = await import('../../src/game/StationPlan.js');
    const by = new Map(PLACES.map((p) => [p.id, p]));
    const triage = by.get(Medbay.TRIAGE), ward = by.get(Medbay.WARD), morgue = by.get(Medbay.MORGUE);
    assert(triage?.name === 'Medbay', `#${Medbay.TRIAGE} is "${triage?.name}"`);
    assert(ward?.name === 'Bacta ward', `#${Medbay.WARD} is "${ward?.name}"`);
    assert(morgue?.name === 'Morgue & memorial', `#${Medbay.MORGUE} is "${morgue?.name}"`);
    assert(triage.deck === 48 && ward.deck === 48 && morgue.deck === 48,
      `the three rooms are on decks ${triage.deck}/${ward.deck}/${morgue.deck}`);

    /* `tankrow`'s own loop, read out of the kit's source so the comparison is
     * against what SHIPS rather than against a second copy of it here. */
    const kit = await readFile(new URL('../../src/game/StationKit.js', import.meta.url), 'utf8');
    const body = /tankrow\(kit, M, p\) \{([\s\S]*?)\n  \},/.exec(kit)?.[1] || '';
    assert(body, 'StationKit.tankrow is gone — the tanks are not built');
    const n = Number(/for \(let i = 0; i < (\d+); i\+\+\)/.exec(body)?.[1]);
    assert(n === Medbay.TANKS,
      `the kit builds ${n} tanks and Medbay.TANKS is ${Medbay.TANKS} — a patient in a tank that is not there`);
    const line = /tank\(kit, M, [^,]+, [^,]+, ([^,]+), ([^)]+)\)/.exec(body);
    assert(line, 'tankrow no longer places its tanks in a loop this can read');
    const { w, d } = ward;
    /* eslint-disable no-new-func */
    const kx = new Function('w', 'd', 'i', `return ${line[1]};`);
    const kz = new Function('w', 'd', 'i', `return ${line[2]};`);
    let worst = 0;
    for (let i = 0; i < Medbay.TANKS; i++) {
      const [x, , z] = Medbay.tankLocal(i, w, d);
      worst = Math.max(worst, Math.hypot(x - kx(w, d, i), z - kz(w, d, i)));
    }
    assert(worst < 1e-9, `tankLocal is ${worst.toFixed(3)} m off the kit's own row`);

    /* AND THE DECK BOOTS WITH THEM ON IT, through the shipped door. */
    const { world } = await station(48);
    const st = world._station;
    assert(st, 'deck 48 did not boot');
    for (const id of [Medbay.TRIAGE, Medbay.WARD, Medbay.MORGUE]) {
      assert(st.places.has(id), `#${id} was not built on the deck that boots`);
    }
    /* THE CLOCK IS THERE TO BE READ, which is this lane's whole premise. */
    assert(Number.isFinite(st.hour) && st.hour >= 0 && st.hour < 24,
      `the station clock reads ${st.hour}`);
    return `#43/#44/#45 all on deck 48 and all built; tankLocal within ${worst.toExponential(1)} m of `
      + `tankrow's ${n} tanks; clock at ${st.hour.toFixed(2)}`;
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('medbay: the station drives it — real frames on the real deck put a man back on his feet',
    () => withCleanStoreAsync(async () => {
      /**
       * ══ THE CLOCK'S FIRST REAL JOB, DRIVEN ══════════════════════════════
       *
       * Everything above advances the ward by naming a number of hours. This
       * one names no hours at all: it boots deck 48, puts a wounded man in a
       * tank, and hands `stepMedbay` REAL FRAMES with real `dt` in them, with
       * the station's own `st.hour` as the only source of time. Six station
       * hours is twelve real minutes and `stepStation` advances the clock at
       * `dt / 120`, so the whole cure is 720 seconds of frames.
       *
       * If the ward ever grows a private timer — a frame count, a
       * `performance.now`, anything that is not the clock on the wall — this
       * is the clause that notices, because the clock here is moved by hand
       * and the frames carry the `dt` that goes with it.
       */
      const { world } = await station(48);
      const st = world._station;
      assert(st, 'deck 48 did not boot');

      const roster = freshRoll(2);
      const [him, other] = roster.all;
      him.body = hurtBody(0.35);
      other.body = hurtBody(0.35);
      Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });
      Medbay.checkIn('republic', him.designation);

      /* THE FIRST STEP ONLY STAMPS THE HOUR — the time before the ward looked
       * at the clock is not time anybody spent in a tank. */
      st.hour = 9;
      Medbay.stepMedbay(world, Medbay.SETTLE_EVERY);
      near(Medbay.wardOf(Company.load('republic')).at, 9, 1e-9, 'the first frame did not stamp the hour');

      /* AND THEN 720 SECONDS OF FRAMES, at 1/60 each, with the clock advanced
       * exactly as `stepStation` advances it. */
      const dt = 1 / 60;
      let frames = 0;
      let announced = null;
      for (let t = 0; t < 720; t += dt) {
        st.hour += dt / 120;
        while (st.hour >= 24) st.hour -= 24;
        const r = Medbay.stepMedbay(world, dt);
        if (r && !announced) announced = r;
        frames++;
      }
      const roll = Company.load('republic');
      const mt = roll.men.find((m) => m.designation === him.designation);
      const ml = roll.men.find((m) => m.designation === other.designation);
      assert(!Medbay.isHurt(mt),
        `${frames} frames and twelve real minutes later he is still on ${Medbay.hpOf(mt).toFixed(2)}`);
      assert(announced && announced.some((a) => a.healed.includes(him.designation)),
        'nothing told the station he was getting up');
      assert(Medbay.isHurt(ml), 'the man nobody walked there got up too');
      assert(Medbay.occupied(roll) === 0, 'his tank is still lit');
      near(st.hour, 15, 0.01, `the station clock finished at ${st.hour.toFixed(2)}, not 15:00`);
      return `${frames} frames × ${dt.toFixed(4)} s = 720 s real → 09:00 to ${st.hour.toFixed(2)}; `
        + `the tank finished him and freed itself, the untended man is on ${Medbay.hpOf(ml).toFixed(3)}`;
    }));

  /* ════════════════════════════════════════════════════════════════════════ */

  check('medbay: it adds no fourth durable key, no room material of its own, and no price', async () => {
    /**
     * THE THREE SILENCES, EACH CLOSED HERE.
     *
     * `session.mjs` counts `localStorage.setItem` inside five NAMED files;
     * `company.mjs` runs the six-word currency scan on files BY PATH; §9.1 and
     * §9.2 are measured over files whose names begin with `Station`. A new
     * file is invisible to all three and therefore legal by default, and
     * `Kennel.js`'s header states the rule for exactly that: *"that silence is
     * a hazard, not a permission."*
     *
     * `company.mjs` is extended to scan `Medbay.js` for the currency words on
     * the same commit. This is the other half — the storage and the materials
     * — and it is here rather than there because it is about this file.
     */
    const src = await readFile(new URL('../../src/game/Medbay.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(!/localStorage/.test(code),
      'Medbay.js touches localStorage — the ward is a field on the company record and '
      + 'the company is already the only writer of its key');
    assert(!/makeStore/.test(code), 'Medbay.js opened a store of its own');
    assert(/from '\.\/Company\.js'/.test(src), 'Medbay.js no longer goes through the company store');
    assert(!/saberNoInk/.test(code), '§9.1: a room may not carry the loader material');
    /* §9.2: a station file may not name a mode. This one is not called
     * `Station*` so the gate's own scan cannot see it; the rule is the same. */
    for (const mode of ['skirmish', 'campaign', 'survival', 'versus', 'horde']) {
      assert(!new RegExp(`['"\`]${mode}['"\`]`, 'i').test(code),
        `Medbay.js names the "${mode}" mode`);
    }
    /* AND THE COMPANY STILL HAS EXACTLY ONE WRITER after growing a ward. */
    const co = await readFile(new URL('../../src/game/Company.js', import.meta.url), 'utf8');
    const writes = [...co.matchAll(/localStorage\.setItem/g)].length;
    assert(writes === 0, `Company.js writes localStorage directly ${writes} times — it goes through Store.js`);
    const stores = [...co.matchAll(/makeStore\(/g)].length;
    assert(stores === 1, `Company.js opens ${stores} stores`);
    return `Medbay.js: ${code.split('\n').length} lines of code, 0 stores, 0 localStorage, `
      + '0 mode names, 0 loader materials; the company still opens exactly 1 store';
  });

  /* ════════════════════════════════════════════════════════════════════════ */

  check('medbay: a save cannot put a dead man behind the glass', () => withCleanStore(() => {
    /**
     * The ward is the one field on a company record that NAMES another record,
     * which is the same thing `saneBonds` guards and for the same reason: a
     * hand edit, or a man struck off between one fold and the next, leaves a
     * lit tank in `#44` with nobody in it. Two ways in, both closed — the fold
     * itself, and the read off disk.
     */
    const roster = freshRoll(3);
    roster.all.forEach((t) => { t.body = hurtBody(0.3); });
    Company.keep(roster.all, { army: 'republic', deployed: roster.all, ground: 'geonosis' });
    const admitted = Medbay.checkIn('republic').admitted;
    assert(admitted.length === 3, `${admitted.length} of three admitted`);

    /* HE GOES OUT AND DOES NOT COME BACK. `keep` strikes him off; his tank
     * must go dark with him. */
    const back = new CommandRoster(ARMIES.republic);
    const live = Company.load('republic').men.map((m) => back.enlistRecord(m)).filter(Boolean);
    for (const t of live) t.body = hurtBody(0.3);
    const home = live.slice(0, 2);
    Company.keep(home, { army: 'republic', deployed: live, left: live.slice(2), ground: 'kashyyyk' });
    const roll = Company.load('republic');
    assert(roll.men.length === 2, `${roll.men.length} men survived a fold that lost one`);
    assert(!Medbay.wardOf(roll).tanks.includes(admitted[2]),
      `${admitted[2]} died on the run and his tank is still lit`);
    assert(Medbay.occupied(roll) === 2, `${Medbay.occupied(roll)} tanks lit for two survivors`);

    /* AND THE READ REFUSES A NAME THAT WAS NEVER ON THE ROLL. */
    const blob = JSON.parse(localStorage.getItem(KEY));
    blob.republic.ward.tanks = ['CT-9999', blob.republic.men[0].designation, 'CT-9999', null, null];
    blob.republic.men[0].hp = 9e9;
    blob.republic.men[1].hp = -4;
    localStorage.setItem(KEY, JSON.stringify(blob));
    const edited = Company.load('republic');
    const tanks = Medbay.wardOf(edited).tanks;
    assert(!tanks.includes('CT-9999'), 'a name that is not on the roll is in a tank');
    assert(tanks.filter(Boolean).length === 1, `${tanks.filter(Boolean).length} tanks lit after the edit`);
    assert(edited.men[0].hp === undefined,
      `a stored 9e9 came back as ${edited.men[0].hp} — a patient nobody can discharge`);
    assert(edited.men[1].hp === 0, `a stored −4 came back as ${edited.men[1].hp}`);
    return 'a man struck off the roll goes dark in the ward on the fold; a hand-edited save '
      + `puts 2 ghosts in tanks and gets 0, and 9e9/−4 health come back as whole/${edited.men[1].hp}`;
  }));
}
