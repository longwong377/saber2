/**
 * BATTLEFRONT BORZ — input.
 *
 * Pointer-locked mouse deltas are the wrist. Everything here exists to hand the
 * blade controller a clean, framerate-independent gesture signal: raw delta,
 * smoothed delta, and the second derivative (the acceleration that separates a
 * committed swing from a feint).
 */

import { loadBindings, MOUSE, WHEEL, PAD, PAD_INDEX, PAD_AXES, PAD_MODIFIERS,
         chordParts, isChord, isPadCode, padFamily } from './Bindings.js';

/**
 * THE DEADZONE, AND IT IS ONE NUMBER FOR BOTH ANSWERS.
 *
 * A stick's rest position is never exactly zero, so everything past this is
 * rescaled to run 0..1 from the edge of the zone rather than from the centre —
 * otherwise a stick just past the zone would jump straight to 0.16 of full
 * pace. `act('moveF')` is "past the deadzone" and `actAxis('moveF')` is "how
 * far past", so the boolean and the magnitude cannot disagree.
 */
const DEAD = 0.16;
const deadzone = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/**
 * WHEN AN ANALOG TRIGGER IS A BUTTON.
 *
 * LT and RT report a `value` in 0..1 and a `pressed` flag, and what `pressed`
 * means is the browser's business: Chromium latches it around a third of the
 * pull and some pads never set it at all. `blade` is on RT, so a trigger that
 * only counts as pressed at the stop would be a guard the player cannot raise.
 * 0.35 is a deliberate pull and well clear of the slack at the top of the
 * travel; `pressed` is honoured too, so a pad that reports only the flag works.
 */
const TRIGGER = 0.35;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, x: 0, y: 0, wheel: 0 };
    this.prevDelta = { x: 0, y: 0 };
    this.accel = { x: 0, y: 0 };
    this.buttons = [false, false, false, false, false];
    this.buttonPressed = [false, false, false, false, false];
    this.buttonReleased = [false, false, false, false, false];
    this.locked = false;
    this.enabled = false;
    this.sensitivity = 1;
    this.invertY = false;
    this.gamepadIndex = null;
    this.gamepad = null;
    this.usingGamepad = false;
    /**
     * WHICH DEVICE THE PLAYER IS ACTUALLY HOLDING — 'key' or 'pad'.
     *
     * `usingGamepad` already existed and answered a narrower question (did the
     * RIGHT STICK move this frame), which is why nothing could use it to decide
     * what to print: it is false the whole time a player is holding a pad still
     * and pressing buttons. This flips on ANY pad input, flips back on any key,
     * mouse move or click, and `onDevice` fires once on each change so the
     * surfaces that print a binding can repaint instead of polling.
     */
    this.device = 'key';
    /** The plugged-in pad's naming family — see padFamily(). */
    this.padFamily = 'xbox';
    /** Fired with 'key' | 'pad' when the active device changes. */
    this.onDevice = null;
    /** Fired with a code when a pad button goes down — the rebinder listens. */
    this.onPadCode = null;
    /** Fired when Start is pressed with no modifier held — see _readPad. */
    this.onMenu = null;
    this.padDownSet = new Set();
    this.padPressedSet = new Set();
    this.padAxis = { 0: 0, 1: 0, 2: 0, 3: 0 };
    this.bindings = loadBindings();
    this._chordsBy = new Map();
    this._indexChords();
    this._listeners = [];

    this._bind();
  }

  /** Say which device is live, and tell anything that prints a binding. */
  _useDevice(d) {
    this.usingGamepad = d === 'pad';
    if (this.device === d) return;
    this.device = d;
    this.onDevice?.(d);
  }

  /**
   * THE "MOST SPECIFIC CHORD WINS" INDEX.
   *
   * Built once per rebind rather than scanned per read: `act()` runs for
   * dozens of actions every frame and a superset search inside it would be a
   * loop over the whole table per call. This is code → the bound chords that
   * contain it, so suppressing a bare code costs one map lookup and, in the
   * shipped table, at most one chord test.
   */
  _indexChords() {
    this._chordsBy.clear();
    const seen = new Set();
    for (const id in this.bindings) {
      for (const code of this.bindings[id] || []) {
        if (!isChord(code) || seen.has(code)) continue;
        seen.add(code);
        for (const part of chordParts(code)) {
          if (!this._chordsBy.has(part)) this._chordsBy.set(part, []);
          this._chordsBy.get(part).push(code);
        }
      }
    }
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  _bind() {
    this._on(window, 'keydown', (e) => {
      if (e.repeat) return;
      const c = e.code;
      // Never swallow the browser's own escape hatches.
      if (!['F5', 'F11', 'F12'].includes(c)) {
        if (this.enabled && c !== 'Escape') e.preventDefault();
      }
      this.keys.add(c);
      this.pressed.add(c);
      this._useDevice('key');
    });
    this._on(window, 'keyup', (e) => { this.keys.delete(e.code); this.released.add(e.code); });
    this._on(window, 'blur', () => {
      this.keys.clear(); this.buttons.fill(false);
      // A pad held down when the window loses focus otherwise stays held
      // forever: `navigator.getGamepads()` stops being polled with the frame,
      // so nothing ever observes the release. Same reason `keys` is cleared.
      this.padDownSet.clear(); this.padPressedSet.clear();
    });

    this._on(this.canvas, 'mousedown', (e) => {
      if (!this.locked && this.enabled) { this.requestLock(); return; }
      if (e.button < 5) { this.buttons[e.button] = true; this.buttonPressed[e.button] = true; }
      this._useDevice('key');
    });
    this._on(window, 'mouseup', (e) => {
      if (e.button < 5) { this.buttons[e.button] = false; this.buttonReleased[e.button] = true; }
    });
    this._on(window, 'contextmenu', (e) => { if (this.enabled) e.preventDefault(); });

    this._on(window, 'mousemove', (e) => {
      if (!this.locked) {
        this.mouse.x = e.clientX; this.mouse.y = e.clientY;
        return;
      }
      const s = this.sensitivity;
      this.mouse.dx += e.movementX * s;
      this.mouse.dy += (this.invertY ? -e.movementY : e.movementY) * s;
      if (e.movementX || e.movementY) this._useDevice('key');
    });

    this._on(window, 'wheel', (e) => {
      if (this.enabled) e.preventDefault();
      this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: false });

    this._on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    this._on(document, 'pointerlockerror', () => { this.locked = false; });

    this._on(window, 'gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      this.padFamily = padFamily(e.gamepad.id);
    });
    this._on(window, 'gamepaddisconnected', () => {
      this.gamepadIndex = null; this.gamepad = null;
      this.padDownSet.clear(); this.padPressedSet.clear();
      // A pad pulled out mid-fight must not leave the screen printing its
      // glyphs at a player who is now on a keyboard.
      this._useDevice('key');
    });
  }

  requestLock() {
    if (this.locked) return;
    // Both paths can reject — most often "a user gesture is required", which
    // simply means the caller has to wait for the next click. Swallow it; an
    // unhandled rejection here would surface as a page error.
    const retry = () => { try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch {} };
    try {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) p.catch(retry);
    } catch { retry(); }
  }
  exitLock() { if (this.locked) document.exitPointerLock?.(); }

  /** Call once per frame BEFORE gameplay reads input. */
  begin(dt) {
    this._readPad(dt);
    const inv = dt > 0 ? 1 / dt : 0;
    this.accel.x = (this.mouse.dx - this.prevDelta.x) * inv;
    this.accel.y = (this.mouse.dy - this.prevDelta.y) * inv;
    this.prevDelta.x = this.mouse.dx;
    this.prevDelta.y = this.mouse.dy;
  }

  /**
   * THE PAD, ONCE A FRAME.
   *
   * `navigator.getGamepads()` returns a SNAPSHOT — a fresh array of fresh
   * objects on every call in Chromium — so the old code's `this.padButtons =
   * gp.buttons` was a reference to last frame's snapshot the moment the frame
   * ended, and there was no way to ask what had changed between two frames.
   * That is why the pad only ever had `down`, never `hit`: with one snapshot
   * there is no edge. Two sets, swapped here, are what make `actHit` work on a
   * controller at all.
   *
   * `gamepadconnected` does not fire for a pad that was already held when the
   * page loaded — the spec requires a button press first, and some browsers
   * only expose pads after a gesture — so the index is also recovered by
   * scanning, which costs one call a frame and is what makes a pad work
   * without the player having to unplug it.
   */
  _readPad(dt) {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav || typeof nav.getGamepads !== 'function') return;
    let pads = null;
    try { pads = nav.getGamepads(); } catch { return; }
    if (!pads) return;
    let gp = this.gamepadIndex !== null ? pads[this.gamepadIndex] : null;
    if (!gp || !gp.connected) {
      gp = null;
      for (const p of pads) if (p && p.connected) { gp = p; break; }
      if (gp) { this.gamepadIndex = gp.index; this.padFamily = padFamily(gp.id); }
    }
    this.gamepad = gp || null;
    // Last frame's held set becomes the baseline; anything down now that was
    // not down then is a press. Cleared rather than reallocated per frame.
    const wasDown = this._padWas || (this._padWas = new Set());
    wasDown.clear();
    for (const c of this.padDownSet) wasDown.add(c);
    this.padDownSet.clear();
    this.padPressedSet.clear();
    if (!gp) return;

    let any = false;
    const buttons = gp.buttons || [];
    for (const [i, code] of Object.entries(PAD)) {
      const b = buttons[i];
      if (!b) continue;
      // An analog trigger is a button with a threshold; `pressed` is honoured
      // for the pads that only report the flag. See TRIGGER.
      const on = typeof b === 'number' ? b >= TRIGGER : (b.pressed || (b.value ?? 0) >= TRIGGER);
      if (!on) continue;
      this.padDownSet.add(code);
      if (!wasDown.has(code)) this.padPressedSet.add(code);
      any = true;
    }
    const ax = gp.axes || [];
    for (let i = 0; i < 4; i++) this.padAxis[i] = deadzone(ax[i] || 0);
    // The stick directions are codes, so a bound stick answers `act` and
    // `actHit` exactly as a button does — see PAD_AXES.
    for (const [code, a] of Object.entries(PAD_AXES)) {
      const v = this.padAxis[a.axis] * a.sign;
      if (v <= 0) continue;
      this.padDownSet.add(code);
      if (!wasDown.has(code)) this.padPressedSet.add(code);
      any = true;
    }

    // The right stick is the wrist. It is NOT a binding: it is a continuous
    // aim, the same shape as the mouse delta it is added to, and the same
    // declared exception Player's grip-distance wheel read is.
    const rx = this.padAxis[2], ry = this.padAxis[3];
    if (rx || ry) {
      any = true;
      this.mouse.dx += rx * 950 * dt * this.sensitivity;
      this.mouse.dy += (this.invertY ? -ry : ry) * 950 * dt * this.sensitivity;
    }
    if (any) this._useDevice('pad');

    // The rebinder hears a pad the way it hears a key. A press with a modifier
    // already held is reported AS the chord, so binding "LB + A" is holding LB
    // and pressing A — which is also how you would fire it.
    if (this.onPadCode) {
      for (const code of this.padPressedSet) {
        if (PAD_MODIFIERS.includes(code)) continue;
        this.onPadCode(this.chordOf(code));
      }
    }
    // START IS THE WAY OUT, and it is device-level for the reason Escape is:
    // pausing has to survive a binding that has gone wrong, so it is not in
    // ACTIONS and there is nothing to rebind. A modifier held turns it into an
    // ordinary chord instead — see PAD_MODIFIERS.
    if (this.padPressedSet.has('PadStart') && !this._anyModifier()) this.onMenu?.();
  }

  _anyModifier() {
    for (const m of PAD_MODIFIERS) if (this.padDownSet.has(m)) return true;
    return false;
  }

  /** `code`, prefixed by whichever modifiers are held. Canonical order. */
  chordOf(code) {
    const mods = PAD_MODIFIERS.filter(m => m !== code && this.padDownSet.has(m));
    return mods.length ? mods.concat(code).join('+') : code;
  }

  /** Call once per frame AFTER gameplay reads input. */
  end() {
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.pressed.clear(); this.released.clear();
    this.buttonPressed.fill(false);
    this.buttonReleased.fill(false);
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  up(code) { return this.released.has(code); }
  anyDown(...codes) { return codes.some((c) => this.keys.has(c)); }
  /**
   * A pad button by INDEX, kept for callers that predate the code family.
   *
   * Nothing in the game may use it — a raw index is exactly as unrebindable
   * and as invisible to findConflicts as a raw `down('KeyB')`, and
   * `SaberController`'s wrist roll used to spend indices 4 and 5 this way. It
   * survives because a check and a probe are allowed to ask a device a direct
   * question; gameplay asks for an ACTION.
   */
  padDown(i) { return this.padDownSet.has(PAD[i]); }

  /* ── bindings ────────────────────────────────────────────────────────
   * Gameplay asks for ACTIONS. A key code that starts with "Mouse" is read
   * from the button arrays, everything else from the keyboard sets, so a
   * player can bind Focus to a thumb button or to T and neither is special.
   */

  setBindings(b) { this.bindings = b; this._indexChords(); }

  /**
   * The wheel, as two pseudo-keys.
   *
   * `mouse.wheel` accumulates Math.sign(deltaY) over the frame and is cleared
   * by end(), so it is already an edge: down and hit are the same question and
   * both are true for exactly the one frame the notch landed on. deltaY is
   * NEGATIVE scrolling up, which is why the comparison looks backwards.
   */
  _wheelCode(code) {
    if (code === WHEEL.up) return this.mouse.wheel < 0;
    if (code === WHEEL.down) return this.mouse.wheel > 0;
    return null;
  }

  /**
   * IS A MORE SPECIFIC CHORD ANSWERING THIS PRESS?
   *
   * The header of Bindings.js has always stated the rule — "with Push on F and
   * Pull on Shift+F, holding shift must fire Pull and NOT Push" — and this is
   * where it is finally true. Hold LB and press A: `PadLB+PadA` is Force push
   * and `PadA` is jump, and the player asked for one of them.
   *
   * It suppresses the BARE code and never the chord, so the direction is
   * always "the longer binding wins". A chord that is not bound to anything
   * suppresses nothing, which is what keeps a modifier that the player has
   * unbound from silently eating a face button.
   */
  _masked(code) {
    const list = this._chordsBy.get(code);
    if (!list) return false;
    for (let i = 0; i < list.length; i++) if (this._chordDown(list[i])) return true;
    return false;
  }
  _chordDown(chord) {
    const parts = chordParts(chord);
    for (let i = 0; i < parts.length; i++) if (!this._rawDown(parts[i])) return false;
    return true;
  }

  /** One code, with no chord suppression applied. */
  _rawDown(code) {
    const w = this._wheelCode(code);
    if (w !== null) return w;
    if (PAD_INDEX.has(code) || code in PAD_AXES) return this.padDownSet.has(code);
    if (code.startsWith('Mouse')) {
      for (const i in MOUSE) if (MOUSE[i] === code) return !!this.buttons[i];
      return false;
    }
    return this.keys.has(code);
  }
  _rawHit(code) {
    const w = this._wheelCode(code);
    if (w !== null) return w;
    if (PAD_INDEX.has(code) || code in PAD_AXES) return this.padPressedSet.has(code);
    if (code.startsWith('Mouse')) {
      for (const i in MOUSE) if (MOUSE[i] === code) return !!this.buttonPressed[i];
      return false;
    }
    return this.pressed.has(code);
  }

  _codeDown(code) {
    if (isChord(code)) return this._chordDown(code);
    return this._rawDown(code) && !this._masked(code);
  }
  /**
   * A CHORD LANDS ON WHICHEVER HALF OF IT ARRIVES LAST.
   *
   * All of it has to be down, and one part of it has to have gone down this
   * frame — so holding LB and then pressing A fires once, and so does pressing
   * A and then adding LB. Requiring the MAIN code to be the new one would make
   * the second order silently dead, and a player mid-combo does not hold the
   * two halves in a fixed order.
   */
  _codeHit(code) {
    if (isChord(code)) {
      if (!this._chordDown(code)) return false;
      for (const p of chordParts(code)) if (this._rawHit(p)) return true;
      return false;
    }
    return this._rawHit(code) && !this._masked(code);
  }

  /** Is any key bound to this action currently held. */
  act(id) {
    const keys = this.bindings[id];
    if (!keys) return false;
    for (let i = 0; i < keys.length; i++) if (this._codeDown(keys[i])) return true;
    return false;
  }
  /** Did any key bound to this action go down THIS frame. */
  actHit(id) {
    const keys = this.bindings[id];
    if (!keys) return false;
    for (let i = 0; i < keys.length; i++) if (this._codeHit(keys[i])) return true;
    return false;
  }

  /**
   * HOW HARD this action is being asked for — 0..1, and the whole reason the
   * left stick could join the table without becoming a switch.
   *
   * A key is 1 when it is down, because a key has no other answer. A bound
   * stick direction is its own magnitude past the deadzone, so a stick eased a
   * third of the way still walks a third of the pace. The strongest binding
   * wins rather than the sum, so W and the stick at once is 1 and not 2.
   *
   * `act(id)` is `actAxis(id) > 0` by construction — both are the same
   * deadzone — which is what stops "am I moving" and "how much" from being two
   * different opinions on the same frame.
   */
  actAxis(id) {
    const keys = this.bindings[id];
    if (!keys) return 0;
    let best = 0;
    for (let i = 0; i < keys.length; i++) {
      const code = keys[i];
      const a = PAD_AXES[code];
      if (a && !this._masked(code)) {
        best = Math.max(best, Math.min(1, this.padAxis[a.axis] * a.sign));
      } else if (this._codeDown(code)) return 1;
    }
    return best;
  }

  /**
   * The movement actions + left stick, as a normalised 2D vector
   * (x = strafe, y = forward).
   *
   * The four `|| this.down('Arrow…')` that used to sit on these lines were a
   * SECOND set of movement bindings that no table knew about. Measured with the
   * shipped defaults: ArrowUp fired no action at all, drove moveAxis.y to 1, and
   * findConflicts(defaults, 'ArrowUp') came back empty — the key read as free.
   * Bind anything to ArrowUp and one press did two things (push AND walk
   * forward), with no way for the options screen to warn and no rebind able to
   * separate them: exactly the KeyB/KeyN disease that was closed one round ago,
   * still alive down here because a raw `down(code)` is not in ACTIONS.
   *
   * So movement is read through the table and nowhere else. Arrow keys are now
   * ordinary free keys: adding ArrowUp as a second key on "Move forward" in the
   * options screen takes one click and — unlike the hidden version — shows up in
   * the bindings list and in every conflict warning. The DEFAULT arrow movement
   * is gone with the hidden binding; restoring it means putting the arrows in
   * ACTIONS beside W/A/S/D, which is a change to src/engine/Bindings.js.
   *
   * …AND THE LEFT STICK WAS THE SAME BUG, STILL HERE.
   *
   * `if (this.padLeft) { x += this.padLeft.x; y -= this.padLeft.y; }` sat on
   * the line below this comment: a second set of movement bindings that no
   * table knew about, added to whatever the table said. `findConflicts` could
   * not see the stick, no options row listed it, no rebind could move it, and
   * the check that exists to catch exactly this could not either — it probes
   * KEY CODES, and a stick is not one. The arrows wearing a different device.
   *
   * The stick is four codes now (PAD_AXES) bound to these same four actions,
   * and it is read through `actAxis` so it stays ANALOG: `moveF` answers 0.34
   * when the stick is a third of the way forward, and 1 when W is down. A
   * threshold would have made a pad's one advantage over a keyboard — a
   * continuous gait — into another switch.
   */
  moveAxis(out = { x: 0, y: 0 }) {
    let x = this.actAxis('moveR') - this.actAxis('moveL');
    let y = this.actAxis('moveF') - this.actAxis('moveB');
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    out.x = x; out.y = y;
    return out;
  }

  dispose() {
    for (const [t, ty, fn, o] of this._listeners) t.removeEventListener(ty, fn, o);
    this._listeners.length = 0;
  }
}
