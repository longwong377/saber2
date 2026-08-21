/**
 * WHAT SURVIVES A TRANSITION — src/main.js, src/game/World.js.
 *
 * Four defects that are all the same shape: something outlives the thing that
 * created it, or is torn down before the thing that can fail.
 *
 *   · `deploy()` hid the menu and cleared the screens BEFORE the build that can
 *     throw, and `screens.state` is only 'playing' afterwards — so a machine
 *     whose Rapier WASM never instantiated (the path `initPhysics` explicitly
 *     supports: "a browser without WASM still reaches the main menu") pressed
 *     Ignite and got a black screen with a dead Escape key.
 *   · the death card's 2.6 s timer had no handle and no state test, so it fired
 *     into the NEXT run: pointer lock dropped, the live game paused, and the
 *     dead run's card painted over it.
 *   · `world.notifications` was pushed to by `notify()` and read by nothing —
 *     262 objects in 90 s of play, still 262 after `unload()`.
 *   · `World.dispose()` ended by ALLOCATING a Rapier world, because `unload()`
 *     finishes with `physics.clear()` and clear() is the reset: free, then
 *     rebuild. Every deploy and every quit stranded one.
 *
 * The two World defects are driven. The two in main.js are read, because
 * main.js is a top-level script that boots an Engine against a WebGL2 context
 * and cannot be imported under Node at all — so what is asserted there is the
 * ORDER of its statements and the ownership of its timer, which is exactly what
 * was wrong. Both go red on the code they replace.
 */
import { readFile } from 'node:fs/promises';

const src = (rel) => readFile(new URL(`../../src/${rel}`, import.meta.url), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The body of a top-level `function name(` in a source file. */
function fnBody(text, name) {
  const i = text.indexOf(`function ${name}(`);
  if (i < 0) return null;
  const open = text.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(open, j + 1);
  }
  return null;
}

export async function run({ check, assert }) {
  check('session: Ignite builds the world before it takes the menu away', async () => {
    /**
     * ORDER, as a property. `menu.hideMenu()` is the point of no return: from
     * there until `screens.state = 'playing'` the player is looking at nothing
     * and `Screens.pause()` refuses to help, because LIVE has no 'menu'. Any
     * throw in between — the Rapier constructor's deliberate one, Terrain, a
     * level's dress(), Scenery — lands the player in a void that only a page
     * reload recovers from. `grep -n 'try' src/main.js` used to find nothing on
     * this path at all.
     */
    const main = strip(await src('main.js'));
    const body = fnBody(main, 'deploy');
    assert(body, 'deploy() is gone');
    const build = body.indexOf('buildWorld(');
    const hide = body.indexOf('menu.hideMenu()');
    assert(build > 0 && hide > 0, 'deploy no longer builds a world or no longer hides the menu');
    assert(build < hide,
      'deploy() still hides the menu before it builds the world — any failure in the build leaves a '
      + 'black screen with a dead Escape key and no way back but a page reload');
    assert(/try\s*\{/.test(body.slice(0, build + 40)) && /catch\s*\(/.test(body),
      'the build is not guarded, so a throw still escapes into the click handler and nothing recovers');
    const c = body.slice(body.indexOf('catch ('));
    assert(/menu\.showMenu\(\)/.test(c) && /screens\.set\('menu'\)/.test(c),
      'a failed deploy does not put the player back in the menu');
    assert(/world = null/.test(c), 'a half-built world is left in the module variable after a failure');
    assert(/menu-record|netStatus|showDeath/.test(c),
      'a failed deploy says nothing to the player — an invisible failure is the same black screen');
    return 'build → catch → restore the menu; the menu only goes once there is a world behind it';
  });

  check('session: the death card cannot land on the next run', async () => {
    /**
     * The card is scheduled 2.6 s after death so the collapse can play, and
     * Screens.escape() invites the player to ask for it EARLY. Die, press
     * Escape, click Rise again: 2.6 s into the new fight the stale timer ran
     * `input.exitLock()` (which pauses the live run through onLockChange) and
     * `card()` — a closure over the dead run's stats — un-hid #death over the
     * pause card. `screens.overlay` had been cleared by deploy(), so Screens
     * had no record of it and `resume()` could not take it down.
     *
     * A timer that outlives its state needs an owner, cancelled at every exit,
     * and a state test for the dispatch it is already too late to cancel.
     */
    const main = strip(await src('main.js'));
    const scheduled = [...main.matchAll(/setTimeout\(/g)].length;
    assert(scheduled > 0, 'nothing schedules anything any more — re-point this check');
    assert(!/setTimeout\(screens\.guarded\('the death card'/.test(main),
      'the death card is still scheduled inline with no handle to cancel it');
    const owner = fnBody(main, 'cardAfter') || fnBody(main, 'cancelDeathCard');
    assert(owner, 'no single owner schedules the death card');
    const after = fnBody(main, 'cardAfter');
    assert(after && /deathTimer\s*=\s*setTimeout/.test(after), 'the timer id is not kept');
    assert(after && /screens\.state !== 'dead'/.test(after),
      'a timer that has already been dispatched cannot be cancelled, only refused — and nothing '
      + 'refuses it, so the dead run\'s card still paints over a live one');
    const cancel = fnBody(main, 'cancelDeathCard');
    assert(cancel && /clearTimeout\(deathTimer\)/.test(cancel), 'cancelDeathCard does not clear the timer');
    for (const exit of ['deploy', 'quitToMenu']) {
      const b = fnBody(main, exit);
      assert(b && /cancelDeathCard\(\)/.test(b),
        `${exit}() does not cancel a card that is already in flight — it lands 2.6 s later, over `
        + (exit === 'deploy' ? 'the new run' : 'the main menu'));
    }
    assert(/onRetry:[^\n]*cancelDeathCard\(\)/.test(main),
      "'Rise again' does not cancel the card that is already scheduled");
    return 'one handle, cleared on retry, deploy and quit, and refused if the state moved on';
  });

  check('session: the world keeps no queue that grows and nobody reads', async () => {
    /**
     * `notify()` pushed `{title, sub, t: 0}` onto `world.notifications` and
     * NOTHING ANYWHERE READ IT — `grep -rn 'notifications' src/` returned the
     * declaration and the push, and nothing else. `t` was never advanced, the
     * list was never capped, and `unload()` — which clears twelve other
     * collections — did not clear it, so it crossed a level change too.
     * `world.events` was the same, one line shorter: declared, never written,
     * never read.
     *
     * The volume driver is `Player._refuse()`, one entry per Force power
     * refused on cooldown: measured 262 entries in 90 s of ordinary play, ~2.9
     * a second, still 262 after `unload()`.
     *
     * Driven on a real World, and the rule is general: after a thousand
     * notifications no array on the world may have grown by a thousand.
     */
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    const sizes = (w) => {
      const out = new Map();
      for (const [k, v] of Object.entries(w)) if (Array.isArray(v)) out.set(k, v.length);
      return out;
    };
    const before = sizes(world);
    for (let i = 0; i < 1000; i++) world.notify('FORCE LIGHTNING', 'not enough Force');
    const after = sizes(world);
    const grew = [...after].filter(([k, n]) => n - (before.get(k) ?? 0) > 40).map(([k, n]) => `${k} ${before.get(k) ?? 0}→${n}`);
    assert(!grew.length,
      `a thousand notifications grew ${grew.join(', ')} — an unread queue that only accumulates, at `
      + '~2.9 entries a second of play');
    assert(world.notifications === undefined || world.notifications.length === 0,
      'world.notifications is retaining entries nothing will ever read');
    assert(world.events === undefined || world.events.length === 0,
      'world.events is back, and it was never written to by anything');

    // …and a level change must not carry anything over either.
    world.notify('WAVE 1', '9 contacts inbound');
    world.unload();
    const post = sizes(world);
    const kept = [...post].filter(([, n]) => n > 0);
    const total = kept.reduce((a, [, n]) => a + n, 0);
    // Deliberately a budget rather than zero: a small cache that survives a
    // level change is a legitimate thing for someone to add. Two hundred and
    // sixty-two objects of unread history is not.
    assert(total < 8,
      `unload() left ${total} entries standing in ${kept.map(([k, n]) => `${k} ${n}`).join(', ')} — `
      + 'the departed level\'s state is retained for as long as the World is held');
    world.dispose?.();
    return '1000 notifications, no array on the world grew; unload() leaves the world holding nothing';
  });

  check('session: disposing a world does not allocate a new physics world to strand', async () => {
    /**
     * `unload()` ends with `physics.clear()`, whose last three lines free the
     * Rapier world and build a REPLACEMENT — right for a level change, wrong
     * for a teardown. `World.dispose()` was `{ this.unload(); }`, so the last
     * thing teardown did was construct the thing teardown exists to release:
     * a whole broad phase, narrow phase, island manager and pipeline set that
     * no reference in the program could reach again. Measured over 400
     * create/dispose cycles: +28.2 KB per cycle against +8.3 KB with the world
     * freed. WASM linear memory is monotonic; it is never handed back.
     */
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({ level: 'colosseum' });
    assert(world.physics.world, 'the world has no physics world to begin with');
    world.dispose();
    assert(world.physics.world === null,
      'dispose() left a live Rapier world allocated — one per deploy and one per quit, none of them '
      + 'reachable again');
    assert(world.physics.bodies.length === 0, 'dispose() left bodies registered');

    // Four full cycles, to show the teardown is repeatable and not merely lucky.
    for (let i = 0; i < 4; i++) {
      const w = await H.bootWorld({ level: 'colosseum' });
      w.world.dispose();
      assert(w.world.physics.world === null, `cycle ${i + 1} stranded a physics world`);
    }
    return 'five create/dispose cycles, none of them leaving a Rapier world behind';
  });

/* ══════════════════════════════════════════════════════════════════════ */
/*  WHAT A SITTING IS                                                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE OTHER HALF OF THE WORD, AND IT DID NOT EXIST.
 *
 * Everything above this line is about what SURVIVES a session boundary. This
 * half is about the session itself — FLAGSHIP §5, "one sitting = one deployment
 * = one seed = one ground = 20–40 min" — and the mode had none of its shape:
 *
 *   · ONE LENGTH. `AREAS` is five records and the crossing was all five of them
 *     every time, which is 30–45 minutes on its own, so a mode promising 20–40
 *     could only ever deliver the top of its own range. §5 makes the length a
 *     seed roll — Raid 2, Push 3, Grind 5 — and `Session.rollSession` is it.
 *   · NOTHING READ BEFORE YOU LAND. §5's 0:00 is "the seed, the ground, and
 *     your ten names, readable before you land". A run opened on a two-second
 *     notify over a roster panel in the corner. The roll is the mode's second
 *     one-way variable (§3) and there was no moment at which it had been read
 *     at full length, so the first casualty was a number going 10 → 9.
 *
 * Everything below drives the shipped director, the shipped `Session.js` and —
 * for the card — the shipped `Menu` on the shipped `index.html`.
 */
  const S = () => import('../../src/game/Session.js');

  check('session: how long a sitting is, is a roll off the seed and nothing else', async () => {
    /**
     * THREE PROPERTIES, and the third is the one that would have been a bug.
     *
     *   IT IS A FUNCTION OF THE SEED. Asked twice, the same answer — a length
     *     that drifted would make the deploy card a lie by the second area.
     *   THE WEIGHTS ARE THE WEIGHTS. 1:2:1, measured rather than asserted, over
     *     every seed in a range rather than over a sample.
     *   IT CONSUMES NO STREAM. `Command.js` mints every designation off one
     *     module `rng` that `seedCommand` puts on the run's number. A length
     *     drawn from THAT stream would shift every name after it by one draw,
     *     so the same seed would muster the same men under different names the
     *     day this feature landed — which is the one thing a seed is for. The
     *     test is the names themselves: mint a roll, roll a length a hundred
     *     times, mint the roll again from the same seed, compare.
     */
    const { rollSession, SESSION_PLANS } = await S();
    const Cmd = await import('../../src/game/Command.js');

    for (const seed of [0, 1, 7, 4242, 0xdeadbeef | 0]) {
      assert(rollSession(seed).id === rollSession(seed).id, `seed ${seed} rolled two different lengths`);
    }

    const count = {};
    const N = 100000;
    for (let i = 0; i < N; i++) { const id = rollSession(i).id; count[id] = (count[id] || 0) + 1; }
    const total = SESSION_PLANS.reduce((n, p) => n + p.weight, 0);
    for (const p of SESSION_PLANS) {
      const want = N * (p.weight / total), got = count[p.id] || 0;
      assert(Math.abs(got - want) / N < 0.01,
        `${p.id} drew ${got} of ${N} seeds against a declared weight of ${p.weight}/${total} (${want})`);
    }

    /* THE STREAM. Ten names off a fresh seed, then the same ten after a
     * hundred length rolls have gone past. */
    const mint = () => {
      Cmd.seedCommand(0x51DE ^ 0x6f4a1b3d);
      const r = new Cmd.CommandRoster(Cmd.ARMIES.republic);
      for (let i = 0; i < 10; i++) r.enlist('trooper');
      return r.all.map((t) => t.designation).join(' ');
    };
    const before = mint();
    for (let i = 0; i < 100; i++) rollSession(i);
    assert(before === mint(),
      'rolling a length moved the roster stream — the same seed musters different names');

    return `${Object.entries(count).map(([k, v]) => `${k} ${(100 * v / N).toFixed(1)}%`).join(' · ')}`
      + `, deterministic, and the name stream is untouched by 100 rolls`;
  });

  check('session: every length lands on the first ground and ends on the last', async () => {
    /**
     * §3's first convergence is ONE GROUND, so a shorter sitting is fewer stops
     * across the same one rather than a different place. Two clauses carry it
     * and both are load-bearing:
     *
     *   the LANDING is always the landing — 0:12 is the same arrival whatever
     *     the length;
     *   the LAST STAGE is always the last, or a Raid would end on a brief that
     *     says "two kilometres of flat ochre" and call it a victory. It is also
     *     what keeps `_endCampaign` one door: `lastArea` is still "the end of
     *     the list", the list is just shorter.
     *
     * Driven against `AREAS` and against lists of other lengths, because
     * `planStages` takes the ground as an argument and must not know how many
     * areas this mode happens to have.
     */
    const { SESSION_PLANS, planStages } = await S();
    const { AREAS } = await import('../../src/game/Command.js');
    const out = [];
    for (const p of SESSION_PLANS) {
      const got = planStages(p, AREAS);
      assert(got.length === p.engagements, `${p.id} planned ${got.length} engagements, not ${p.engagements}`);
      assert(got[0] === AREAS[0], `${p.id} does not start at ${AREAS[0].name}`);
      assert(got[got.length - 1] === AREAS[AREAS.length - 1], `${p.id} does not end at ${AREAS[AREAS.length - 1].name}`);
      for (let i = 1; i < got.length; i++) {
        assert(AREAS.indexOf(got[i]) > AREAS.indexOf(got[i - 1]),
          `${p.id} crosses ${got[i].name} after ${got[i - 1].name} — the route doubles back`);
      }
      out.push(`${p.id} ${got.map((a) => AREAS.indexOf(a) + 1).join('-')}`);
    }
    // Generic: a stage list of another length, and a plan longer than the ground.
    const five = [1, 2, 3, 4, 5], three = [1, 2, 3];
    assert(planStages({ engagements: 3 }, three).join() === '1,2,3', 'a plan the length of the ground is the ground');
    assert(planStages({ engagements: 9 }, three).join() === '1,2,3', 'a plan longer than the ground overran it');
    assert(planStages({ engagements: 2 }, five).join() === '1,5', 'the two-stage plan is not the ends');
    assert(planStages({ engagements: 3 }, []).length === 0, 'a plan over no ground invented a stage');
    return out.join(' · ');
  });

  check('session: the shelf follows the ground you are standing on, not the count', async () => {
    /**
     * THE OFF-BY-ONE THIS FEATURE WOULD HAVE REINTRODUCED.
     *
     * `AREAS`' own note records the last one: a hand-written `tier` column
     * beside the `at` that decides the same thing, so every rung-4 and rung-5
     * body arrived one whole area late and it read as "the good units never
     * show up". A rolled length opens the same gap from the other side —
     * `rung.at` is a position in the five-area ladder and `areaNumber` is how
     * many engagements in you are, and those are the same number only for a
     * Grind. A Raid's second engagement is the Core Ship: areaNumber 2, ladder
     * rung 5. Gating on the count would sell you a marksman on the ground the
     * walkers are on.
     *
     * `areaRung` is the ground's own position and this drives it through the
     * shipped `musterOffer`, which is what a player actually sees on the shelf.
     */
    const Cmd = await import('../../src/game/Command.js');
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({ level: 'geonosis', settings: { mode: 'command' } });
    const d = world.command;
    assert(d, 'no CommandDirector on a command world');
    /* The plan is forced rather than searched for: this check is about the
     * SHELF and not about which seed happens to draw a Raid. */
    const { SESSION_PLANS, planStages } = await S();
    const plan = SESSION_PLANS.find((p) => p.id === 'raid');
    d.plan = plan;
    d.stages = planStages(plan, Cmd.AREAS);

    d.areaIndex = 0;
    const first = d.musterOffer().units.map((u) => u.type);
    d.areaIndex = 1;                                     // the second and last engagement
    const last = d.musterOffer().units.map((u) => u.type);
    assert(d.areaNumber === 2, `areaNumber ${d.areaNumber}`);
    assert(d.areaRung === Cmd.AREAS.length, `areaRung ${d.areaRung}, not ${Cmd.AREAS.length}`);
    const ladder = d.army.tiers;
    assert(last.length === ladder.length,
      `the last ground of a Raid offers ${last.length} of ${ladder.length} rungs`);
    assert(first.length < last.length, 'the landing zone offers the whole ladder');
    /* And a Grind is unchanged: rung == count at every step. */
    d.plan = SESSION_PLANS.find((p) => p.id === 'grind');
    d.stages = planStages(d.plan, Cmd.AREAS);
    for (let i = 0; i < Cmd.AREAS.length; i++) {
      d.areaIndex = i;
      assert(d.areaRung === d.areaNumber, `a Grind disagrees with itself at area ${i + 1}`);
    }
    world.dispose();
    return `raid: ${first.length} rungs at ${Cmd.AREAS[0].name}, ${last.length} at ${Cmd.AREAS[4].name} `
      + `(areaNumber 2, ladder rung ${Cmd.AREAS.length}); a Grind's rung is its count at all five`;
  });

  check('session: only the crossing rolls a length — a skirmish keeps its dial', async () => {
    /**
     * `AREAS` is a ROUTE in Command and a PRESSURE DIAL in the other two modes
     * that build this director: `World.beginSkirmish` writes `d.areaIndex =
     * sk.pressure` and never advances it, and a campaign is one battle per
     * ground. A length rolled over their heads would re-point the dial — at
     * pressure 2 under a two-stage plan the budget curve, the heavy bias and
     * the shelf would all read the FIFTH area's numbers, which is a difficulty
     * change nobody asked for.
     *
     * `MODES[...].battles` is the field that already draws the line, and it is
     * asked rather than restated. Driven on real worlds, one per mode.
     */
    const H = await import('./_coop.mjs');
    const { AREAS } = await import('../../src/game/Command.js');
    const out = [];
    for (const mode of ['command', 'skirmish', 'campaign']) {
      const { world } = await H.bootWorld({ level: 'geonosis', settings: { mode }, runSeed: 4242 });
      const d = world.command;
      assert(d, `${mode} built no CommandDirector`);
      assert(d.stages.length >= 1, `${mode} has no stages`);
      if (mode === 'command') {
        assert(d.crossing, 'Command is not the crossing');
      } else {
        assert(!d.crossing, `${mode} rolled a length`);
        assert(d.stages.length === AREAS.length,
          `${mode} crosses ${d.stages.length} of ${AREAS.length} areas — its pressure dial has moved`);
        for (let i = 0; i < AREAS.length; i++) {
          d.areaIndex = i;
          assert(d.area === AREAS[i], `${mode} at pressure ${i} reads ${d.area.name}`);
        }
      }
      out.push(`${mode} ${d.crossing ? d.plan.id : 'ladder'} ${d.stages.length}`);
      world.dispose();
    }
    return out.join(' · ');
  });

  check('session: the deploy card is every name you land with, before you land', async () => {
    /**
     * §5's 0:00, driven through the shipped `Menu` on the shipped markup.
     *
     * The assertion that matters is the boring one: the card carries as many
     * names as the roster has living bodies, all of them distinct, and each is
     * the roster's OWN string rather than a second rendering of it. That is the
     * whole feature — §3's fourth convergence says the roll is the one-way
     * variable that needs no scenery, and a list that only ever shrinks has to
     * have been read at full length once or the first casualty is arithmetic.
     */
    const H = await import('./_coop.mjs');
    const P = await import('./_page.mjs');
    const { deployCard } = await S();
    const { world } = await H.bootWorld({ level: 'geonosis', settings: { mode: 'command' }, runSeed: 91125 });
    const d = world.command;
    const summary = d.roster.summary();
    const card = deployCard({
      seed: 91125, plan: d.plan, stages: d.stages, ground: world.level.name,
      roster: summary, networked: true,
    });

    assert(card.seed === 91125, `the card prints seed ${card.seed}`);
    assert(card.strength === summary.roll.filter((t) => t.alive).length,
      `the card counts ${card.strength} against a roster of ${summary.strength}`);
    assert(card.roll.length === card.strength, 'the card counts more men than it names');
    const names = new Set(card.roll.map((t) => t.name));
    assert(names.size === card.roll.length,
      `${card.roll.length} men and ${names.size} names — two of them answer to the same one`);
    for (const t of card.roll) {
      assert(summary.roll.some((r) => r.name === t.name),
        `the card names ${t.name}, who is not on the roster`);
    }
    assert(card.stages.length === d.stages.length, 'the card and the director disagree about the route');
    assert(card.hostNote, 'a networked card said nothing about the host owning the session');

    /**
     * AND IT DRAWS — the real Menu, on the real index.html.
     *
     * SYNCHRONOUS from `install()` to the restore, which is the discipline
     * `tools/checks/menu.mjs` states and the reason the markup and the module
     * are pulled in above rather than here: the runner starts the next check as
     * soon as this one suspends, and a check that awaited anything with a fake
     * `document` on globalThis would hand its page to whoever ran next.
     */
    const { makeDocument } = await import('./_page.mjs');
    const { Menu, DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { readFile } = await import('node:fs/promises');
    const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
    let rows = 0, dropped = 0, hostLine = '';
    {
      const doc = makeDocument(html);
      const restore = doc.install();
      try {
        const menu = new Menu({ ...structuredClone(DEFAULT_SETTINGS) }, {});
        const up = menu.showDeploy(card, { drop: () => dropped++ });
        assert(up, 'showDeploy refused to draw the card');
        assert(!doc.getElementById('deploy-card').classList.contains('hidden'),
          'the card was drawn hidden');
        rows = doc.getElementById('deploy-list').querySelectorAll('.dep-row').length;
        assert(rows === card.roll.length, `${rows} rows drawn for ${card.roll.length} names`);
        const drawn = doc.getElementById('deploy-list').innerHTML;
        for (const t of card.roll) {
          assert(drawn.includes(t.name), `${t.name} is on the card and not on the screen`);
        }
        assert(doc.getElementById('deploy-seed').textContent === '91125',
          `the seed reads "${doc.getElementById('deploy-seed').textContent}"`);
        assert(doc.getElementById('deploy-strength').textContent === String(card.strength),
          'the standing count and the list disagree');
        hostLine = doc.getElementById('deploy-host').textContent;
        assert(/host/i.test(hostLine) && /migration/i.test(hostLine),
          `the host-drop line reads "${hostLine}"`);
        doc.getElementById('btn-deploy-drop').click();
        assert(dropped === 1, `Drop fired ${dropped} time(s)`);
        assert(doc.getElementById('deploy-card').classList.contains('hidden'),
          'the card is still up after Drop');
      } finally { restore(); }
    }

    world.dispose();
    return `seed 91125 → ${card.planName}, ${card.stages.length} stages on ${card.ground}; `
      + `${card.roll.length} names on the card, ${names.size} distinct, ${rows} rows drawn`;
  });
}
