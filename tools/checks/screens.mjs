/**
 * BATTLEFRONT BORZ — you can always get out.
 *
 * THE BUG. `draft` and `landing` stopped the world and handed the screen to an
 * overlay, and the only way out of either was a click on that overlay. The
 * overlay hides itself BEFORE it calls back, so a callback that throws left the
 * game paused, input disabled, and nothing at all on the screen — and Escape,
 * which read `playing → pause, paused → resume`, did nothing whatsoever in the
 * state the player was stuck in. Frozen game, blank screen, dead Escape key,
 * reload the page. Reported exactly like that.
 *
 * It survived because it lived in main.js, which does not import outside a
 * browser, so nothing could ask the only question that matters: is there a
 * state you can reach and not leave? src/ui/Screens.js is that logic with its
 * collaborators injected, and everything below drives it with a menu that
 * throws on demand and a world that is a plain object.
 *
 * Every check here FAILS on the code as it shipped.
 */

import { Screens, LIVE, OVERLAY_STATES, LID_STATES, QUIET, CALM } from '../../src/ui/Screens.js';

/* ── the bench ───────────────────────────────────────────────────────── */

/** A menu that records what is on screen, and can be told to throw. */
function fakeMenu() {
  const up = new Set();
  const m = {
    up,
    shown: [],
    showPause: () => { up.add('pause'); m.shown.push('pause'); },
    hidePause: () => up.delete('pause'),
    showDraft: () => { up.add('draft'); m.shown.push('draft'); },
    hideDraft: () => up.delete('draft'),
    /* The muster. It is a Menu card like the other three — the same show/hide
     * pair, taken down by clear() and _hide() by name — which is what earns it
     * a place in OVERLAY_STATES rather than in the `card()` registry. */
    showMuster: () => { up.add('muster'); m.shown.push('muster'); },
    hideMuster: () => up.delete('muster'),
    /* The deploy card. Same shape again — a Menu show/hide pair taken down by
     * `clear()` and `_hide()` by name — which is what earns it a place in
     * OVERLAY_STATES beside the muster rather than in the `card()` registry. */
    showDeploy: () => { up.add('deploy'); m.shown.push('deploy'); },
    hideDeploy: () => up.delete('deploy'),
    showDeath: () => { up.add('death'); m.shown.push('death'); },
    hideDeath: () => up.delete('death'),
  };
  return m;
}

function bench() {
  const menu = fakeMenu();
  const world = { paused: false, player: {}, director: { wave: 3 }, score: 0 };
  const input = { enabled: true, locks: 0,
    exitLock() { this.locks--; }, requestLock() { this.locks++; } };
  const errors = [];
  const s = new Screens({
    world: () => world, input, menu,
    pauseStats: () => [['Wave', 3]],
    sandboxLive: () => false,
    onError: (what, e) => errors.push(`${what}: ${e.message}`),
  });
  return { s, menu, world, input, errors };
}

/** Put the bench into a state, the way main.js does. */
function enter(b, state) {
  if (state === 'playing') { b.s.state = 'playing'; b.world.paused = false; b.input.enabled = true; return; }
  if (state === 'paused') { enter(b, 'playing'); b.s.pause(); return; }
  if (state === 'draft') { enter(b, 'playing'); b.s.take('draft', () => b.menu.showDraft()); return; }
  // Through Screens.muster itself, not through take() — the point of that
  // method is that main.js cannot raise this overlay any other way.
  if (state === 'muster') { enter(b, 'playing'); b.s.muster({ area: 1 }, {}); return; }
  if (state === 'dead') { enter(b, 'playing'); b.s.take('dead', () => b.menu.showDeath()); return; }
  /* THE DEPLOY CARD — FLAGSHIP §5's 0:00, raised through `Screens.deploy` and
   * not through `take()`, for the same reason the muster is: the point of that
   * method is that main.js cannot raise the overlay any other way, and this one
   * stops the world on the first frame of a session. A state you can only be
   * put into wrongly is a state nothing has proved you can get out of. */
  if (state === 'deploy') { enter(b, 'playing'); b.s.deploy({ seed: 1, roll: [] }, {}); return; }
  b.s.state = state;
}

export async function run({ check, assert }) {
  check('screens: Escape is never a dead key, from any state the game can reach', () => {
    /*
     * THE CHECK THE FREEZE NEEDED. Not "escape works from playing" — that was
     * true the whole time — but that there is no reachable state in which
     * pressing it changes nothing. On the shipped code, `draft` and `landing`
     * both answered 'nothing', which is the freeze.
     */
    const out = [];
    for (const st of LIVE) {
      const b = bench();
      enter(b, st);
      const before = { state: b.s.state, up: [...b.menu.up].join('+'), paused: b.world.paused };
      const did = b.s.escape();
      assert(did !== 'nothing',
        `Escape does nothing at all in state '${st}' — that is a game you can only leave by reloading the page`);
      const after = { state: b.s.state, up: [...b.menu.up].join('+'), paused: b.world.paused };
      if (st === 'dead') {
        // The one state where Escape is deliberately idempotent: it re-raises
        // the death card. With the card already up nothing visibly moves, and
        // that is right — the guarantee there is that the exit IS on screen
        // afterwards, which is the only thing a stuck player needs.
        assert(b.menu.up.has('death'),
          `Escape on the death screen left ${after.up || 'nothing'} on screen`);
      } else {
        assert(after.state !== before.state || after.up !== before.up || after.paused !== before.paused,
          `Escape in '${st}' reported '${did}' and changed nothing on screen`);
      }
      out.push(`${st} → ${did}`);
    }
    return out.join(', ');
  });

  check('screens: an overlay whose card is gone still has a way out', () => {
    /*
     * The exact shape of the bug. Menu.showDraft hides the card and THEN calls
     * back, so a throw in the callback leaves an empty screen. Reproduced here
     * by hiding before throwing, which is what the real menu does.
     */
    for (const st of ['draft', 'muster']) {
      const b = bench();
      enter(b, st);
      const boom = b.s.guarded('picking', () => {
        b.menu.up.clear();                          // the card hides itself first
        throw new Error('applyBoon is not a function');
      });
      boom();
      assert(b.errors.length === 1, `the throw in ${st} was swallowed — it must be reported`);
      assert(b.menu.up.has('pause'),
        `a callback that threw out of '${st}' left ${b.menu.up.size} overlays on screen — the player has nothing to click`);
      assert(b.s.state === 'paused', `after a throw out of '${st}' the state is '${b.s.state}', which nothing can resume`);
      // and the pause card really does resume
      b.s.resume();
      assert(b.s.state === 'playing' && !b.world.paused,
        `resuming after a failed ${st} left the state at '${b.s.state}' with paused=${b.world.paused}`);
    }
    return 'a throwing draft and a throwing muster both land on a working pause card';
  });

  check('screens: pausing over a draft gives the draft back, not a skipped boon', () => {
    // The quieter half. Escape during a draft must not cost the player the boon
    // the wave paid for, so `resume` puts the interrupted overlay back.
    const b = bench();
    enter(b, 'draft');
    assert(b.menu.up.has('draft'), 'the draft never went up');
    b.s.escape();
    assert(b.s.state === 'paused' && b.menu.up.has('pause') && !b.menu.up.has('draft'),
      `Escape over a draft left state '${b.s.state}' with ${[...b.menu.up].join('+')} on screen`);
    b.s.resume();
    assert(b.s.state === 'draft' && b.menu.up.has('draft'),
      `resuming from a pause raised over a draft went to '${b.s.state}' — the boon was silently skipped`);
    assert(b.world.paused, 'the world is running again with a draft card on top of it');
    // and answering it now really does resume
    b.s.overlay = null; b.s.state = 'paused'; b.s.resume();
    assert(b.s.state === 'playing' && !b.world.paused, 'answering the draft did not restart the world');
    return 'draft → pause → draft → answered → playing';
  });

  check('screens: a corpse is not resumable', () => {
    /*
     * The one state Escape must NOT pause: resume() clears world.paused, and a
     * player handed back a run they have already lost is a different bug from
     * the one being fixed. Its card is its own exit, and Escape re-raises it —
     * which is the only recovery from a death card that never arrived.
     */
    const b = bench();
    enter(b, 'dead');
    assert(!b.s.pause(), 'the death screen paused — resume would hand back a lost run');
    b.menu.up.clear();                              // the card failed to arrive
    const did = b.s.escape();
    assert(did === 'death card' && b.menu.up.has('death'),
      `Escape on a death card with nothing on screen reported '${did}' and left ${[...b.menu.up].join('+')}`);
    assert(b.s.state === 'dead', `Escape on the death card moved the state to '${b.s.state}'`);
    return 'dead does not pause; Escape re-raises the card';
  });

  check('screens: every state that stops the world is remembered as it is raised', () => {
    // The mechanism the two checks above rely on. A `take` that forgot to store
    // the overlay would pass those by accident on the first pass and strand the
    // player on the second.
    const out = [];
    for (const st of OVERLAY_STATES) {
      const b = bench();
      enter(b, st);
      assert(b.s.overlay && b.s.overlay.state === st,
        `'${st}' owns the screen and was not remembered — nothing can put it back`);
      assert(b.world.paused, `'${st}' owns the screen and the world is still running underneath it`);
      assert(!b.input.enabled, `'${st}' owns the screen and the blade is still taking input`);
      out.push(st);
    }
    return `${out.join(', ')} — all remembered, all stop the world`;
  });

  check('screens: main.js drives the state machine rather than keeping its own', async () => {
    /*
     * The checks above prove Screens is right. This one proves the game uses
     * it: the bug was eight lines of ad-hoc state in main.js, and a second copy
     * appearing there is how it comes back.
     */
    const { readFile } = await import('node:fs/promises');
    const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
    const strip = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const own = [...strip.matchAll(/(?:^|[^.\w])state\s*=\s*['"]/g)];
    assert(!own.length,
      `main.js still assigns a bare \`state\` ${own.length} time(s) — the screen state has two owners again`);
    assert(/new Screens\(/.test(strip), 'main.js never builds a Screens');
    assert(/screens\.escape\(\)/.test(strip), 'the Escape key does not go through Screens.escape');
    for (const call of ['screens.take(', 'screens.guarded(']) {
      assert(strip.includes(call), `main.js never calls ${call} — an overlay is being raised the unsafe way`);
    }
    /* …and every overlay that could strand the player goes up through `take`.
     * There were two; the landing went with the Descent and the muster arrived
     * with Command. It is worth saying that the LIST is the thing being checked
     * rather than the pair — the next overlay somebody adds is the next one
     * that can strand a player, and it has to be added here too.
     * `OVERLAY_STATES` is the authority for what those are, so this reads it
     * rather than restating it.
     *
     * TWO SHAPES ARE ACCEPTED, and the second is the better one. main.js may
     * raise the overlay itself (`screens.take('draft', () => menu.showDraft())`)
     * or go through a NAMED METHOD on Screens that does the take for it
     * (`screens.muster(...)` → `take('muster', …)` inside Screens.js). The
     * second keeps the `take` and the `guarded` wrappers out of main.js
     * altogether, which is where they were forgotten the first time; what is
     * checked is that the overlay reaches `take`, not which file spells it. */
    const screensSrc = await readFile(new URL('../../src/ui/Screens.js', import.meta.url), 'utf8');
    const seams = [];
    for (const what of OVERLAY_STATES.filter(o => o !== 'dead')) {
      const took = new RegExp(`take\\(\\s*'${what}'`);
      const viaMain = took.test(strip);
      const viaMethod = new RegExp(`screens\\.${what}\\(`).test(strip) && took.test(screensSrc);
      assert(viaMain || viaMethod,
        `the ${what} is raised without screens.take — it will not be remembered, and a `
        + 'callback that throws inside it leaves the player on a frozen field with nothing to click');
      const show = `show${what[0].toUpperCase()}${what.slice(1)}`;
      assert(strip.includes(`menu.${show}(`) || (viaMethod && screensSrc.includes(`${show}(`)),
        `nothing calls menu.${show} — the card cannot arrive`);
      seams.push(`${what} ${viaMain ? 'via main' : 'via Screens.' + what}`);
    }
    return `no bare state assignments; every overlay goes up through take() — ${seams.join(', ')}`;
  });

  check('screens: a lid stops the world, a board does not, and one rule says which', () => {
    /**
     * THE DEFECT THIS IS THE UNIT HALF OF. `take` stopped the world for EVERY
     * overlay it raised, and every station board goes up through `take` — so
     * the room a player walked up to and opened a card in was a photograph for
     * as long as they looked at it. See Screens.js's LID_STATES.
     *
     * Two halves, both required. The named lids stop the world wherever they
     * are raised; everything else is a board, and a board only gets its way
     * where `io.calm` says nothing in the world can hit the player.
     */
    const out = [];
    for (const st of LID_STATES.filter((n) => n !== 'paused')) {
      const b = bench();
      b.s.io.calm = () => true;            // the friendliest world there is
      enter(b, 'playing');
      b.s.take(st, () => {});
      assert(b.world.paused,
        `'${st}' is a lid and the world is still running underneath it`);
      /* 'dead' is the one lid the frame loop still walks into, and it always
       * has: the death card wants the HUD and the guard rose updated behind it,
       * and `World.update`'s own first line refuses a paused world. So what is
       * asserted there is the pause, which is what actually stops the world. */
      if (st !== 'dead') {
        assert(b.s.hands('LIVE') === null,
          `'${st}' is a lid and the frame loop was told to step the world anyway`);
      }
      out.push(`${st} lid`);
    }
    /* AND A BOARD. 'tote' is a state Screens has never heard of, which is the
     * point: the rule is not a list of rooms. */
    const b = bench();
    b.s.io.calm = () => true;
    enter(b, 'playing');
    b.s.take('tote', () => {});
    assert(!b.world.paused, 'the tote board stopped the world — the room behind it is a photograph');
    assert(b.s.hands('LIVE') === QUIET,
      'the frame loop was handed the live input behind a board — a held key walks the player away from it');
    assert(!b.input.enabled, 'a board is up and the blade is still taking input');
    assert(b.s.overlay?.state === 'tote', 'a board is not remembered — a pause over it cannot put it back');
    /* AND A PAUSE OVER A BOARD STILL STOPS THE WORLD, and resuming onto the
     * board starts it again. Rule 2 over the new half of the rule, driven on
     * 'kiosk' because it is the one board already in `LIVE` and `pause()` is
     * gated on that list — Escape over a board whose state is not in `LIVE`
     * answers 'nothing' today, which is a gap this repair does not open and
     * does not close: every one of those panes has a button of its own, and
     * `closeTote`/`closePit`/`closeKiosk` are it. */
    const k = bench();
    k.s.io.calm = () => true;
    enter(k, 'playing');
    k.s.take('kiosk', () => {});
    assert(!k.world.paused, 'the counter stopped the world — the room behind it is a photograph');
    assert(k.s.escape() === 'paused' && k.world.paused, 'Escape over a board did not pause the world');
    k.s.resume();
    assert(k.s.state === 'kiosk' && !k.world.paused,
      `resuming onto the board left state '${k.s.state}' paused=${k.world.paused}`);

    /* AND NOWHERE ANYTHING CAN HIT YOU. The same board, in a world `calm`
     * refuses: the old behaviour, exactly, which is what a battlefield and
     * every bench in this file get. */
    const c = bench();
    enter(c, 'playing');
    c.s.take('tote', () => {});
    assert(c.world.paused && c.s.hands('LIVE') === null,
      'a board left the world running in a world nothing vouched for — a caller that wires no `calm` must get the old behaviour');

    /* The shipped predicate itself, on the shape it exists to tell apart. */
    assert(!CALM({ partyTeam: 0, enemies: [] }), 'CALM vouched for a world that is not a station');
    assert(CALM({ _station: {}, partyTeam: 0, enemies: [{ team: 0 }, { team: 0, dead: true }] }),
      'CALM refused a station whose only bodies are its own residents');
    assert(!CALM({ _station: {}, partyTeam: 0, enemies: [{ team: 0 }, { team: 2 }] }),
      'CALM vouched for a station with something hostile standing in it');
    return `${out.join(', ')}; a board runs the world, keeps input off, and is still escapable — and only where CALM says so`;
  });

  check('screens: the room keeps reacting while its own board is open', async () => {
    /**
     * ══ THE MEASURED HALF, AND IT IS THE ONLY ONE THAT COULD HAVE CAUGHT IT ══
     *
     * *"you should be able to watch the entire battle, has a crowd"* (V16 §G4).
     * The crowd was built, checked and audible ONLY WHEN NOBODY WAS LOOKING AT
     * IT: `Screens.take` stopped the world, `frame()` stepped it in two states,
     * and the board a player opens to watch a race is the one thing that made
     * the room stop answering the race. Measured before the repair, standing in
     * #19 at a live meet: 60 s with the world running gave 6 roars and a swell
     * through 319 distinct values; 90 s with the board open gave ZERO roars and
     * a swell frozen at 0.
     *
     * NOTHING SHORT OF A REAL WORLD CATCHES THIS. `st.crowd` is written by
     * `stepCrowd`, four calls deep inside `world.update`; a check that called
     * the model, or asserted a flag on `Screens`, is green over the whole of
     * the defect. So this boots the station, stands in the room, raises the
     * board through the REAL `Screens.take` with main.js's own `calm`, and runs
     * main.js's own frame-loop gate — `screens.hands(input)` — and then asks the
     * world what the room did. `requestAnimationFrame` does not fire headless,
     * which is why this is `world.update` and not a browser.
     *
     * BOTH COLUMNS ARE MEASURED. The shipped gate is driven first over the same
     * board and the same hour and required to be SILENT, so a regression that
     * quietly puts the lid back cannot pass by making both numbers small.
     */
    const { readFile } = await import('node:fs/promises');
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const St = await import('../../src/game/Station.js');
    const P = await import('../../src/game/StationPlan.js');
    const Save = await import('../../src/game/StationSave.js');
    const Tote = await import('../../src/game/Tote.js');

    const hadFetch = globalThis.fetch;
    const root = new URL('../../', import.meta.url);
    globalThis.__stationFetch = true;
    globalThis.fetch = async (url) => {
      const buf = await readFile(new URL(String(url), root));
      return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    };
    try {
      await St.prepareStation();
      const v = Tote.venueById('holo-theatre');
      /* WHICH DAY IS NOT THIS CHECK'S TO DECIDE — `tickStationClock` writes
       * `st.day` out of the durable fold every frame, and the fold is
       * process-wide. So the day is taken from it and wound forward through its
       * own shipped door until the venue has a card on. */
      const dayWas = Save.stationDay();
      let day = dayWas, races = [];
      while (!races.length && day < dayWas + 60) { races = Tote.racesOn(v.id, day); if (!races.length) day++; }
      assert(races.length, `${v.id} has no card in the sixty days after ${dayWas}`);
      if (day > dayWas) Save.passStationHours(24 * (day - dayWas));
      const race = races[0];

      const { world } = await bootWorld({
        level: 'station',
        settings: { mode: 'station', level: 'station', allies: 0 },
        onWorld: (w) => { w._stationFloor = 40; },
      });
      const st = world._station;
      const place = P.PLACES.find((x) => x.id === v.place);
      world.player.position.set(place.x, st.deckY + 1.6, place.z);
      world.player.camera?.obj?.position?.set(place.x, st.deckY + 1.6, place.z);

      const live = idleInput();
      const input = { enabled: true, exitLock() {}, requestLock() {} };
      const screens = new Screens({
        world: () => world, input, menu: fakeMenu(), pauseStats: () => [], calm: CALM,
      });
      screens.state = 'playing';
      screens.card('tote', () => {});

      /** main.js's frame loop: the gate, and nothing else in it. */
      const frame = () => { const h = screens.hands(live); if (h) world.update(1 / 60, h); };
      /** …and the gate exactly as it shipped, for the other column. */
      const shipped = () => {
        if (screens.state === 'playing' || screens.state === 'dead') world.update(1 / 60, live);
      };

      /** What the room did over `frames` of whichever gate. */
      const watch = (frames, step) => {
        const roars0 = st.crowd?.roars | 0;
        const swells = new Set(); const moments = new Set();
        let peak = 0, held = 0;
        for (let i = 0; i < frames; i++) {
          step();
          const c = st.crowd; if (!c) continue;
          swells.add(Math.round(c.swell * 1000));
          if (c.swell > peak) peak = c.swell;
          if (c.moment) moments.add(c.moment);
          held = Math.max(held, c.in | 0);
        }
        return { roars: (st.crowd?.roars | 0) - roars0, swells: swells.size, peak, moments, held };
      };

      /* Park just before the meet and let the loop wind the clock from there —
       * the hour is never written by hand after this line. */
      st.hour = race.hour - 0.01;
      for (let i = 0; i < 30; i++) frame();

      /* ── 1. THE ROOM WITH NOBODY AT A BOARD. The reading the repair has to
       * reach, taken on the same world and the same meet. */
      const open = watch(2400, frame);

      /* ── 2. THE BOARD GOES UP, exactly as `openTote` raises it. */
      screens.take('tote', () => {});
      assert(screens.state === 'tote' && !world.paused,
        `the board is up and world.paused is ${world.paused} — the room behind it is a photograph`);
      const p0 = world.player.position.clone();

      /* ── 3. THE SHIPPED GATE OVER THE SAME BOARD, and it must say nothing. */
      const wasPaused = world.paused, wasHour = st.hour;
      world.paused = true;
      const before = watch(2400, shipped);
      world.paused = wasPaused; st.hour = wasHour;
      /* `peak` is not the tell here — `swell` keeps whatever value it was left
       * at, and a frozen room reports that number for ever. The tell is that it
       * NEVER MOVES: one distinct value over 2400 frames, and no new roar. */
      assert(before.roars === 0 && before.swells === 1,
        `the gate as it shipped answered ${before.roars} roars and ${before.swells} swell values `
        + 'behind a board — this check is not measuring the defect');

      /* ── 4. AND THE GATE AS IT IS NOW. */
      const behind = watch(2400, frame);
      assert(behind.roars >= 2,
        `2400 frames with the board open and the room roared ${behind.roars} times — `
        + `with the same board shut it roared ${open.roars}. The crowd reacts only when nobody is watching it.`);
      assert(behind.peak > 0.1,
        `the room's loudest moment behind its own board was ${behind.peak.toFixed(3)}`);
      assert(behind.swells >= 8,
        `the swell took ${behind.swells} distinct values behind the board — a flag, not a room`);
      assert(behind.moments.size >= 2,
        `the room reacted to one kind of thing only behind the board: ${[...behind.moments].join(', ')}`);
      /* AND THE PLAYER'S OWN BODY DID NOT MOVE, which is the half of
       * `world.paused` that was worth keeping: `input.enabled = false` does not
       * stop `Input` recording keys, so the world is stepped with `QUIET`. */
      assert(world.player.position.distanceTo(p0) < 1e-6,
        `the player walked ${world.player.position.distanceTo(p0).toFixed(3)} m while reading a board`);
      assert(!input.enabled, 'the board is up and the blade is taking input again');

      return `#${v.place} on day ${st.day} at ${race.hour.toFixed(2)}: 2400 frames behind the board gave `
        + `${behind.roars} roars (${[...behind.moments].join('/')}), peak swell ${behind.peak.toFixed(3)} over `
        + `${behind.swells} values, ${behind.held} in the room — against ${before.roars} roars over ${before.swells} value `
        + `on the gate as it shipped and ${open.roars}/${open.peak.toFixed(3)} with the board shut; `
        + 'the player never moved';
    } finally {
      globalThis.fetch = hadFetch;
    }
  });
}

