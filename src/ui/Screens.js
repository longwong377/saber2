/**
 * SABER — who owns the screen, and how the player gets out.
 *
 * THE BUG THIS FILE EXISTS FOR.
 *
 * `draft` and `landing` are states in which the world is stopped and an overlay
 * owns the screen, and the only way out of either was a click on that overlay.
 * Two things had to hold for that to be safe. Neither did.
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

/** The states in which a world exists and the player is not at a menu. */
export const LIVE = ['playing', 'paused', 'draft', 'landing', 'dead'];

/** The states in which an overlay owns the screen and the world is stopped. */
export const OVERLAY_STATES = ['draft', 'landing', 'dead'];

export class Screens {
  /**
   * @param {object} io
   * @param {() => object|null} io.world   the live world, or null
   * @param {object} io.input              needs `enabled`, `exitLock`, `requestLock`
   * @param {object} io.menu               needs a show/hide pair per overlay
   * @param {() => Array} io.pauseStats    rows for the pause card
   * @param {() => boolean} [io.sandboxLive]
   * @param {(what: string, e: Error) => void} [io.onError]
   */
  constructor(io) {
    this.io = io;
    this.state = 'boot';
    /** @type {{state: string, show: () => void}|null} */
    this.overlay = null;
  }

  /* ── plain transitions ─────────────────────────────────────────────── */

  /** boot → menu → playing, and the abandon path back. Clears any overlay. */
  set(name) {
    this.clear();
    this.state = name;
  }

  /** Hide everything this class raised, and forget it. */
  clear() {
    const m = this.io.menu;
    m.hidePause?.(); m.hideDraft?.(); m.hideLanding?.(); m.hideDeath?.();
    this.overlay = null;
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
        // 'draft'/'landing' pause fine; if we were somewhere pause() refuses,
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
    // and 'landing', which is the whole fix: those were the two you could be
    // stuck in.
    if (this.state === 'paused' || this.state === 'dead') return false;
    if (!LIVE.includes(this.state) || !this.io.world()) return false;
    if (this.overlay) this._hide(this.overlay.state);
    this.state = 'paused';
    this.io.world().paused = true;
    this.io.input.enabled = false;
    this.io.input.exitLock?.();
    this.io.menu.showPause(this.io.pauseStats(), this.io.sandboxLive?.());
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
    const m = this.io.menu;
    if (name === 'draft') m.hideDraft?.();
    else if (name === 'landing') m.hideLanding?.();
    else if (name === 'dead') m.hideDeath?.();
  }
}
