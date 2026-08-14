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
    const { world } = await H.bootWorld({ level: 'arena' });
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
    const kept = [...post].filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`);
    assert(!kept.length, `unload() left ${kept.join(', ')} standing`);
    world.dispose?.();
    return '1000 notifications, no array on the world grew; unload() leaves every one of them empty';
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
    const { world } = await H.bootWorld({ level: 'arena' });
    assert(world.physics.world, 'the world has no physics world to begin with');
    world.dispose();
    assert(world.physics.world === null,
      'dispose() left a live Rapier world allocated — one per deploy and one per quit, none of them '
      + 'reachable again');
    assert(world.physics.bodies.length === 0, 'dispose() left bodies registered');

    // Four full cycles, to show the teardown is repeatable and not merely lucky.
    for (let i = 0; i < 4; i++) {
      const w = await H.bootWorld({ level: 'arena' });
      w.world.dispose();
      assert(w.world.physics.world === null, `cycle ${i + 1} stranded a physics world`);
    }
    return 'five create/dispose cycles, none of them leaving a Rapier world behind';
  });
}
