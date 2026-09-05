/**
 * BATTLEFRONT BORZ — who owns the screen, and how the player gets out.
 *
 * THE BUG THIS FILE EXISTS FOR.
 *
 * `draft` was a state in which the world is stopped and an overlay owns the
 * screen, and the only way out of it was a click on that overlay. Two things
 * had to hold for that to be safe. Neither did. (It was one of a PAIR: the
 * other was 'landing', since deleted. Every trace of that state is gone from
 * this file now except this sentence, which is here so nobody re-derives the
 * bug from a half-removed name.)
 *
 * The overlay hides itself BEFORE it calls back — Menu.showDraft's card does
 * `this.el.draft.classList.add('hidden'); onPick(b)` — so anything that throws
 * inside the callback leaves the game in state 'draft' with the world paused,
 * input disabled, and NO OVERLAY ON SCREEN. There is nothing left to click.
 * `world.applyBoon` is one of the things in that callback, and it has thrown
 * before now: on a remote avatar, in co-op, which has no `applyBoon` at all.
 *
 * And Escape — the one key whose whole job is to be the way out of anything —
 * read:
 *
 *     if (state === 'playing') pause(); else if (state === 'paused') resume();
 *
 * which is to say it did nothing at all in the state the player was stuck in.
 * A frozen game, a blank screen and a dead Escape key: reload the page.
 *
 * WHY IT IS A MODULE.
 *
 * Because the invariant is small, total, and was unverifiable where it lived.
 * The whole thing was eight lines spread through main.js, which cannot be
 * imported outside a browser, so nothing could ever ask it the only question
 * that matters — "is there a state you can reach and not leave?" — and the
 * answer was yes for as long as the game has had a draft. In here it is a plain
 * object with injected collaborators, and tools/checks/screens.mjs drives it
 * with a menu that throws on demand.
 *
 * THE RULES, and every one of them is checked:
 *
 *   1. Escape is never a dead key. From any state, pressing it changes what is
 *      on the screen or what the world is doing.
 *   2. An overlay that stops the world is REMEMBERED as it is raised, so
 *      resuming from a pause puts it back rather than silently skipping the
 *      draft the wave was paid for.
 *   3. Every overlay callback runs inside `guarded`. A throw costs a console
 *      error and lands the player on the pause card, which can always resume or
 *      abandon — never in a void.
 *   4. A corpse is not resumable. 'dead' does not pause and does not resume;
 *      its card is its own exit, and Escape re-raises it.
 */

/**
 * The states in which a world exists and the player is not at a menu.
 *
 * 'meditation' is the Holocron, raised mid-run by kneeling. It is here
 * because rule 1 is about EVERY reachable state: Escape has to get you out of
 * the Holocron exactly as it gets you out of a draft, and `guarded` has to be
 * able to fall back to the pause card from inside it.
 */
export const LIVE = ['playing', 'paused', 'draft', 'dead', 'meditation', 'muster', 'deploy',
  /* 'kiosk' is the station's counter (SHARK §5.2) and it is here for exactly
   * the reason 'meditation' is: an overlay that stops the world and owns the
   * screen, whose card is registered through `card()` rather than being one of
   * Menu's three. Inert with STATION_ENABLED off — nothing raises it. */
  'kiosk'];

/**
 * The states in which an overlay owns the screen and the world is stopped, and
 * whose CARD IS THE MENU'S — `clear()` and `_hide()` know how to take these
 * three down because they are Menu methods this class was built around.
 *
 * An overlay that owns its own card registers a hider with `card()` instead;
 * it is raised through the identical `take()` and gets the identical
 * guarantees (remembered as it is raised, restored by resume, escapable), which
 * is what tools/checks/living-force.mjs drives the meditation through. Adding
 * such a state to this array would be a lie of a different kind: the array is
 * consumed by a check that constructs each state through Menu's own show/hide
 * pair, and there is no Menu pair to construct.
 */
export const OVERLAY_STATES = ['draft', 'dead', 'muster', 'deploy'];

/**
 * HOW LONG A SEAM MAY BE SILENT BEFORE IT SAYS ANYTHING AT ALL, in seconds.
 *
 * The lift's own ride is 3.4 s of shaft and the rebuild happens behind it, so
 * a load that finishes inside this said nothing and needed to say nothing —
 * which is the whole of "it should feel like going to a different place". Past
 * it the player is waiting, and a line in the fiction is better than a silent
 * photograph. It is never a percentage and never the name of an engine stage.
 */
export const SEAM_QUIET = 4;

/**
 * ══ THE SEAM IS NOT A FREEZE-FRAME ════════════════════════════════════════
 *
 * *"should feel like just going to a different place, not two separate
 * games."* The plate and the progress bar went first, and what was left was
 * still a photograph the player stares at while the world is rebuilt — the
 * car standing still is the whole of what reads as a load.
 *
 * WHY THIS IS CSS AND NOT A RENDER. Between the two worlds there is nothing
 * to render: the old one has been disposed and the new one does not exist, and
 * the thread that would draw a frame is the thread building it. A JS animation
 * over the still would be as frozen as the still. A CSS animation of
 * `transform` alone is not — Chromium runs it on the compositor thread, off
 * the main thread entirely, so it keeps moving for the whole of a synchronous
 * build. That is why the two keyframes below touch nothing but `transform`,
 * and why the drift lives on the plate rather than on its background-position
 * (which would be a main-thread animation and would stop dead).
 *
 * WHAT IT LOOKS LIKE. The still is the inside of the car; it rises slowly and
 * sways, on the same period as `DeckLift`'s own sway, and a band of shaft
 * light runs down over it — the levels going past the window, which is what
 * the player was watching a second ago. It is the cheap half of V15's third
 * move ("both worlds alive"): the car is not really moving, but the seam is.
 * `styles.css` owns both keyframes; this owns when they are on.
 *
 * The band is built here rather than in `index.html` because it exists only
 * for the length of a seam, and a screen element that is empty for the whole
 * of every other load is one more thing for a screen check to reason about.
 */
export const SEAM_LIGHTS = 'seam-lights';

function seamMotion(el, on) {
  if (!el) return;
  el.classList.toggle('seam', !!on);
  /**
   * THE BAND IS FOUND BY WALKING THE CHILDREN, NOT BY `querySelector`.
   *
   * The first cut asked `el.querySelector('.seam-lights')`, which is right in
   * a browser and answers `null` for ever under `tools/dom-shim.mjs` — so the
   * band was created on the way in and never found on the way out, and the
   * menu wore a drifting light band for the rest of the session. The clause
   * in station.mjs that says so caught it. `children` is a real list on both
   * sides, and the DOM stays the only record of whether the band is up.
   */
  let band = null;
  for (const c of (el.children || [])) if (c && c.className === SEAM_LIGHTS) { band = c; break; }
  if (!on) { if (band) el.removeChild ? el.removeChild(band) : band.parentNode?.removeChild(band); return; }
  if (!band && typeof document !== 'undefined' && document.createElement) {
    band = document.createElement('div');
    band.className = SEAM_LIGHTS;
    /* Behind the caption, over the picture. The rest of it — the gradient and
     * the keyframe — is a stylesheet rule, so it is one place. */
    el.insertBefore ? el.insertBefore(band, el.firstChild) : el.appendChild(band);
  }
}

export class Screens {
  /**
   * @param {object} io
   * @param {() => object|null} io.world   the live world, or null
   * @param {object} io.input              needs `enabled`, `exitLock`, `requestLock`
   * @param {object} io.menu               needs a show/hide pair per overlay
   * @param {() => Array} io.pauseStats    rows for the pause card
   * @param {() => boolean} [io.sandboxLive]
   * @param {() => object|null} [io.report]  the after-action report for the
   *   pause card, or null where the mode has no army — PLAN.md §4.9. Asked for
   *   at the moment of the pause and never held: a report cached when the run
   *   started would be a report of the run's first minute.
   * @param {(what: string, e: Error) => void} [io.onError]
   */
  constructor(io) {
    this.io = io;
    this.state = 'boot';
    /** @type {{state: string, show: () => void}|null} */
    this.overlay = null;
    /**
     * Hiders for overlays whose card is not one of Menu's four. A screen this
     * class did not know how to HIDE would survive `clear()` and sit on top of
     * the main menu forever, which is the freeze wearing its opposite face.
     * @type {Map<string, () => void>}
     */
    this.cards = new Map();
  }

  /**
   * Teach this state machine about an overlay it did not ship with.
   *
   * The whole contract: give it the state's name and how to take the card down,
   * and `take(name, show)` then behaves exactly as it does for the draft — the
   * overlay is remembered, the world stops, Escape pauses over it and resume
   * puts it back.
   */
  card(name, hide) {
    if (name && typeof hide === 'function') this.cards.set(name, hide);
    return this;
  }

  /* ── plain transitions ─────────────────────────────────────────────── */

  /** boot → menu → playing, and the abandon path back. Clears any overlay. */
  set(name) {
    this.clear();
    this.state = name;
  }

  /**
   * Hide everything this class raised, and forget it.
   *
   * `m.hideLanding?.()` used to be in this line and is gone. There has been no
   * 'landing' state since it was deleted — it is not in LIVE, not in
   * OVERLAY_STATES, `_hide` has no branch for it, and no Menu in this tree has
   * ever had a `hideLanding`. So the optional call was a no-op that read like a
   * fourth overlay, and the comment on `pause()` still names 'landing' as one
   * of the two states you could be stuck in. That is worse than dead code: the
   * next person to add a screen copies it, sees `?.()` beside three real
   * hiders, and assumes an overlay whose card is not one of Menu's is handled
   * here. It is not — `card(name, hide)` is the seam for that, and it is the
   * one the muster screen goes up through.
   */
  clear() {
    const m = this.io.menu;
    /* …AND THE LOAD SCREEN, which is not an overlay and is still this class's
     * to take down — `main.js`'s `world.onGround` handler calls `clear()` the
     * moment a rotation lands, and that is the only thing that ends a load. */
    this.hideLoading();
    m.hidePause?.(); m.hideDraft?.(); m.hideMuster?.(); m.hideDeath?.();
    m.hideDeploy?.();
    for (const hide of this.cards.values()) hide();
    this.overlay = null;
  }

  /**
   * THE LOADING SCREEN — and it had never existed.
   *
   * `main.js` has called `screens.loading?.(frac, label)` from two places since
   * the async loader was written: the deploy path, and `world.onRotate` for
   * every mid-run ground change. This class had no such method, so the
   * optional-call operator swallowed both, silently, for the whole life of the
   * loader. What a player saw while a terrain heightfield, a Rapier world,
   * every instanced field and up to 224 props were built was the menu going
   * away and nothing arriving — 350 ms warm, 3.8 s cold, on a blank page.
   *
   * IT IS NOT AN OVERLAY, which is why it does not go through `take`. `take`
   * pauses the world, drops input and remembers a card so Escape can pause over
   * it; a load is none of those. There is no world yet to pause, there is
   * nothing to escape to, and being "stuck" here is the loader's problem and
   * not this state machine's. It is a plain show/hide over the top of
   * everything, cleared by `clear()` with the rest.
   *
   * `frac` is 0..1 and `label` is the stage the loader is in. Both are what the
   * boot screen's bar already takes, so the two screens read alike.
   */
  loading(frac = 0, label = '', opts = null) {
    const el = typeof document !== 'undefined' && document.getElementById('loading');
    if (!el) return;
    /**
     * A STILL OF THE LAST FRAME, when the load is a seam in a flight.
     *
     * The deploy from the flight deck ends with the bay sealed and the hull
     * accelerating away, and the battlefield opens in the same sealed bay in
     * orbit — but between them the world is rebuilt, and the menu plate with
     * a bar over it was what the player saw: "the transition… is kind of
     * janky like it isn't seamless". main.js captures the last rendered
     * frame and hands it here; the screen is that picture with a thin bar
     * along the bottom, and `hideLoading` puts the plate back. Passing no
     * `still` (the ordinary deploy from the menu) is the old screen.
     */
    const still = opts?.still || null;
    if (still && !el.classList.contains('still')) {
      el.classList.add('still');
      el.style.backgroundImage = `url(${still})`;
      seamMotion(el, true);
    } else if (!still && el.classList.contains('still')) {
      el.classList.remove('still');
      el.style.backgroundImage = '';
      seamMotion(el, false);
    }
    el.classList.remove('hidden');
    /**
     * ── AND ON A SEAM THERE IS NO BAR AND NO ENGINE TALK ──────────────────
     *
     * *"no loading screens … should feel like just going to a different place,
     * not two separate games."*
     *
     * The still was half the answer and it was read as the whole of it. A
     * hostile pass polled the DOM through a real deck change and found, for
     * 24.8 s: the photograph of the car, correct — and over it a 220 px
     * progress bar and a caption reading "raising the ground", "lighting the
     * sky", "dressing the level". That is a loading screen with a picture
     * behind it, and the words are the names of engine stages.
     *
     * So on a seam the bar does not draw and the loader's own labels are
     * dropped on the floor. What CAN appear is a line the caller wrote in the
     * fiction — `opts.say` — and only after `SEAM_QUIET`, because a ride that
     * finishes inside four seconds should say nothing at all. A player who is
     * standing in a lift does not need to be told the lift is a lift; a player
     * who has been standing in it for six seconds does.
     *
     * THE BAR IS REMOVED RATHER THAN HIDDEN BY CSS. A width still written to
     * an invisible element is a fact this file would keep having to remember
     * is invisible, and the class it hangs on has been read as "the still is
     * handled" once already.
     */
    const seam = !!still;
    const fill = document.getElementById('load-fill');
    if (fill) fill.style.width = seam ? '0%' : `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    const bar = fill?.parentElement;
    if (bar) bar.style.display = seam ? 'none' : '';
    const msg = document.getElementById('load-msg');
    if (msg) {
      if (!seam) { if (label) msg.textContent = label; }
      else {
        if (this._seamAt == null) this._seamAt = Date.now();
        const waited = (Date.now() - this._seamAt) / 1000;
        msg.textContent = (waited > SEAM_QUIET && opts?.say) ? opts.say : '';
      }
    }
    if (!seam) this._seamAt = null;
    this._loading = true;
  }

  /** Take it down. Called by `clear()`, and by `set()` through it. */
  hideLoading() {
    this._seamAt = null;
    if (typeof document === 'undefined') return;
    const el = document.getElementById('loading');
    if (el) {
      el.classList.add('hidden'); el.classList.remove('still'); el.style.backgroundImage = '';
      seamMotion(el, false);
    }
    this._loading = false;
  }

  /* ── overlays ──────────────────────────────────────────────────────── */

  /**
   * Stop the world and raise an overlay that owns the screen.
   *
   * `show` is kept, not just called: it is how the pause card gives the screen
   * back, and how a card that failed to arrive can be asked for again.
   */
  take(name, show) {
    const w = this.io.world();
    this.overlay = { state: name, show };
    this.state = name;
    if (w) w.paused = true;
    this.io.input.enabled = false;
    this.io.input.exitLock?.();
    show();
  }

  /**
   * THE MUSTER, raised the same way the draft is.
   *
   * This method is the thing `main.js` has been testing for since the Command
   * mode was written — `if (typeof screens.muster === 'function')` — and never
   * finding, which is why `CommandDirector` fell through to `autoMuster()` and
   * spent the player's reinforcement points for them between every area with
   * nothing on the screen.
   *
   * It is a method here rather than eight lines in main.js for the reason this
   * whole module exists: an overlay that stops the world and owns the screen is
   * a state you can be stranded in, and every guarantee against that lives in
   * `take` — remembered as it is raised, restored by resume, escapable, and its
   * buttons wrapped so a throw lands on the pause card instead of on a frozen
   * field with nothing to click. A muster raised any other way would have none
   * of those, and it is the one overlay in the game a player can sit on for a
   * minute deciding.
   *
   * `io.recruit` and `io.done` are the director's, wrapped in `guarded` here so
   * the caller cannot forget to.
   *
   * @param {object} offer `CommandDirector.musterOffer()`
   * @param {{recruit:(t:string)=>object, route:(id:string)=>object,
   *          commend:(name:string)=>object, done:()=>void}} io
   */
  muster(offer, io = {}) {
    const menu = this.io.menu;
    if (typeof menu.showMuster !== 'function') return false;
    let up = true;
    this.take('muster', () => {
      up = menu.showMuster(offer, {
        recruit: this.guarded('recruiting', (type) => io.recruit?.(type)),
        /* THE ROAD — PLAN.md §4.6's fork, forwarded rather than dropped. This
         * object is rebuilt here rather than passed through, which is the whole
         * point of `guarded` and also its one hazard: a callback the caller
         * supplies and this method does not name is a callback the screen never
         * sees, and a fork whose buttons do nothing is worse than no fork. */
        route: this.guarded('choosing a road', (id) => io.route?.(id)),
        /* Forwarded for the reason `route` is: `guarded` REBUILDS this object,
         * so a callback that is not named here is a dead button on the card. */
        commend: this.guarded('commending', (name) => io.commend?.(name)),
        done: this.guarded('closing the muster', () => io.done?.()),
      }) !== false;
    });
    if (up) return true;
    /**
     * THE CARD DID NOT ARRIVE — and this is the branch that stops that being a
     * frozen campaign.
     *
     * `take` has already stopped the world and put the state in 'muster'.
     * Without this, a menu whose markup is missing leaves the player paused on
     * a state whose overlay is not on the screen; Escape still works (rule 1
     * holds — it pauses, and the pause card can abandon), but the advance can
     * never continue, because the only thing that calls `closeMuster` is a
     * button that was never drawn. So the screen is handed straight back and
     * `false` is returned, which is the caller's signal to muster without one —
     * exactly what CommandDirector does when no handler is installed at all.
     */
    this.overlay = null;
    this.state = 'paused';
    this.resume();
    return false;
  }

  /**
   * THE DEPLOY CARD — FLAGSHIP §5's 0:00, raised the way the muster is.
   *
   * It is the same shape of problem as the muster and it gets the same
   * guarantees rather than a second arrangement of them: an overlay that stops
   * the world and owns the screen is a state you can be stranded in, and every
   * defence against that lives in `take` — remembered as it is raised, put back
   * by resume, escapable, and its one button wrapped so a throw lands on the
   * pause card instead of on a frozen field.
   *
   * THE FALLBACK IS THE SAME ONE AND IT MATTERS MORE HERE. `io.drop` is what
   * starts the run — the insertion flight, or the notify that stands in for it.
   * A markup-less build that raised this state and could not draw the card
   * would leave a player paused on the first frame of a session with nothing to
   * press. So a card that does not go up hands the screen straight back and
   * returns false, and the caller's answer is to drop without one.
   *
   * @param {object} card `Session.deployCard()`
   * @param {{drop:() => void}} io
   */
  deploy(card, io = {}) {
    const menu = this.io.menu;
    if (typeof menu.showDeploy !== 'function') return false;
    let up = true;
    this.take('deploy', () => {
      up = menu.showDeploy(card, {
        drop: this.guarded('dropping in', () => io.drop?.()),
      }) !== false;
    });
    if (up) return true;
    this.overlay = null;
    this.state = 'paused';
    this.resume();
    return false;
  }

  /**
   * Anything an overlay button calls.
   *
   * A throw in one of these used to strand the game in a state with nothing on
   * screen. Now it costs a console error and drops the player on the pause
   * card. It is deliberately not silent: a swallowed exception here is a bug
   * that will be reported as "it froze" and never found.
   */
  guarded(what, fn) {
    return (...a) => {
      try { return fn(...a); }
      catch (e) {
        this.io.onError ? this.io.onError(what, e)
                        : console.error(`${what} failed — falling back to the pause menu:`, e);
        this.overlay = null;
        // A draft pauses fine; if we were somewhere pause() refuses,
        // say we are playing so the player gets a card they can act on.
        if (this.state === 'dead' || !LIVE.includes(this.state)) this.state = 'playing';
        this.pause();
        return undefined;
      }
    };
  }

  /* ── pause ─────────────────────────────────────────────────────────── */

  pause() {
    // Every live state EXCEPT 'dead' — see rule 4. Notably including 'draft'
    // and every overlay registered through `card()`, which is the whole fix:
    // an overlay you cannot pause out of is an overlay you are stuck in.
    if (this.state === 'paused' || this.state === 'dead') return false;
    if (!LIVE.includes(this.state) || !this.io.world()) return false;
    if (this.overlay) this._hide(this.overlay.state);
    this.state = 'paused';
    this.io.world().paused = true;
    this.io.input.enabled = false;
    this.io.input.exitLock?.();
    this.io.menu.showPause(this.io.pauseStats(), this.io.sandboxLive?.(), this.io.report?.() ?? null);
    return true;
  }

  resume() {
    if (this.state !== 'paused') return false;
    this.io.menu.hidePause();
    // Rule 2: a pause over a draft interrupts it, and resuming has to put it
    // back. Skipping it would silently rob the player of the boon the wave paid
    // for, which is a quieter bug than the freeze and no more acceptable.
    if (this.overlay) {
      this.state = this.overlay.state;
      const w = this.io.world();
      if (w) w.paused = true;
      this.io.input.enabled = false;
      this.overlay.show();
      return true;
    }
    this.state = 'playing';
    const w = this.io.world();
    if (w) w.paused = false;
    this.io.input.enabled = true;
    this.io.input.requestLock?.();
    return true;
  }

  /**
   * Escape. Rule 1: this never does nothing.
   *
   * Returns what it did, so a test can say so and a caller can log it.
   */
  escape() {
    if (this.state === 'paused') return this.resume() ? 'resumed' : 'nothing';
    // A corpse cannot be resumed, so Escape asks for the card again instead.
    // It is idempotent, and the only way to be stuck on 'dead' is for that card
    // never to have arrived.
    if (this.state === 'dead') {
      if (!this.overlay) return 'nothing';
      this.overlay.show();
      return 'death card';
    }
    return this.pause() ? 'paused' : 'nothing';
  }

  /** The card for a state, hidden. */
  _hide(name) {
    const own = this.cards.get(name);
    if (own) { own(); return; }
    const m = this.io.menu;
    if (name === 'draft') m.hideDraft?.();
    else if (name === 'muster') m.hideMuster?.();
    else if (name === 'deploy') m.hideDeploy?.();
    else if (name === 'dead') m.hideDeath?.();
  }
}
