/**
 * SABER — input.
 *
 * Pointer-locked mouse deltas are the wrist. Everything here exists to hand the
 * blade controller a clean, framerate-independent gesture signal: raw delta,
 * smoothed delta, and the second derivative (the acceleration that separates a
 * committed swing from a feint).
 */

import { loadBindings, MOUSE, WHEEL } from './Bindings.js';

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
    this.bindings = loadBindings();
    this._listeners = [];

    this._bind();
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
      this.usingGamepad = false;
    });
    this._on(window, 'keyup', (e) => { this.keys.delete(e.code); this.released.add(e.code); });
    this._on(window, 'blur', () => { this.keys.clear(); this.buttons.fill(false); });

    this._on(this.canvas, 'mousedown', (e) => {
      if (!this.locked && this.enabled) { this.requestLock(); return; }
      if (e.button < 5) { this.buttons[e.button] = true; this.buttonPressed[e.button] = true; }
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
      this.usingGamepad = false;
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

    this._on(window, 'gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    this._on(window, 'gamepaddisconnected', () => { this.gamepadIndex = null; this.gamepad = null; });
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
    if (this.gamepadIndex !== null && navigator.getGamepads) {
      const gp = navigator.getGamepads()[this.gamepadIndex];
      this.gamepad = gp || null;
      if (gp) {
        const dead = (v) => Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84;
        const rx = dead(gp.axes[2] || 0), ry = dead(gp.axes[3] || 0);
        if (rx || ry) {
          this.usingGamepad = true;
          this.mouse.dx += rx * 950 * dt * this.sensitivity;
          this.mouse.dy += (this.invertY ? -ry : ry) * 950 * dt * this.sensitivity;
        }
        this.padLeft = { x: dead(gp.axes[0] || 0), y: dead(gp.axes[1] || 0) };
        this.padButtons = gp.buttons;
      }
    }
    const inv = dt > 0 ? 1 / dt : 0;
    this.accel.x = (this.mouse.dx - this.prevDelta.x) * inv;
    this.accel.y = (this.mouse.dy - this.prevDelta.y) * inv;
    this.prevDelta.x = this.mouse.dx;
    this.prevDelta.y = this.mouse.dy;
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
  padDown(i) { return !!(this.padButtons && this.padButtons[i] && this.padButtons[i].pressed); }

  /* ── bindings ────────────────────────────────────────────────────────
   * Gameplay asks for ACTIONS. A key code that starts with "Mouse" is read
   * from the button arrays, everything else from the keyboard sets, so a
   * player can bind Focus to a thumb button or to T and neither is special.
   */

  setBindings(b) { this.bindings = b; }

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

  _codeDown(code) {
    const w = this._wheelCode(code);
    if (w !== null) return w;
    if (code.startsWith('Mouse')) {
      for (const i in MOUSE) if (MOUSE[i] === code) return !!this.buttons[i];
      return false;
    }
    return this.keys.has(code);
  }
  _codeHit(code) {
    const w = this._wheelCode(code);
    if (w !== null) return w;
    if (code.startsWith('Mouse')) {
      for (const i in MOUSE) if (MOUSE[i] === code) return !!this.buttonPressed[i];
      return false;
    }
    return this.pressed.has(code);
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
   */
  moveAxis(out = { x: 0, y: 0 }) {
    let x = 0, y = 0;
    if (this.act('moveF')) y += 1;
    if (this.act('moveB')) y -= 1;
    if (this.act('moveR')) x += 1;
    if (this.act('moveL')) x -= 1;
    if (this.padLeft) { x += this.padLeft.x; y -= this.padLeft.y; }
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
