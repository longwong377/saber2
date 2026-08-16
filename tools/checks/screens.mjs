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

import { Screens, LIVE, OVERLAY_STATES } from '../../src/ui/Screens.js';

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
}
