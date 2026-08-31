/**
 * BATTLEFRONT BORZ — the thumb.
 *
 * "the game actually runs pretty decent on the phone but there's no control
 * scheme I don't think, is there any way you can make touch controls for the
 * phone? (Don't fuck up the actual desktop game)"
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────
 *
 * It is not a second way to play. Every finger in here ends up in one of four
 * places the game already reads:
 *
 *   `input.touchAxes`   the left stick, as the same 0..1 magnitudes the pad's
 *                       left stick produces — so a thumb eased a third of the
 *                       way walks a third of the pace, through `actAxis`.
 *   `input.touchHeld`   a held button, as an ACTION id.
 *   `input.touchHitSet` a tapped button, as an action id, for exactly one frame.
 *   `input.mouse.dx/dy` the right-hand drag. This is the important one: the
 *                       mouse delta IS the wrist in this game — the blade
 *                       controller reads nothing else — so a drag on the right
 *                       of the screen is a mouse move and the whole blade
 *                       system works on a phone with no new code path in it.
 *                       Whatever the chosen scheme does with a mouse, touch
 *                       inherits, including the free-blade scheme.
 *
 * So there is no touch branch anywhere in the game. There is a device that
 * writes the fields the other two devices write.
 *
 * ── AND WHY THE DESKTOP CANNOT NOTICE ───────────────────────────────────
 *
 * `attach()` binds ONE listener — `touchstart`, passive, on the window — and
 * builds nothing. The overlay, the rest of the listeners and every write into
 * `input` happen on the first real touch and never before. A desktop with a
 * touchscreen is therefore untouched until somebody actually touches it, which
 * is also the right behaviour for a laptop that has both.
 *
 * ── THE LAYOUT, AND WHY IT IS THIS ──────────────────────────────────────
 *
 * There are forty-four actions in `ACTIONS` and a phone has two thumbs, so the
 * question is not "how do we fit them" but "which ones does a thumb need".
 *
 *   LEFT HALF   a floating stick. It appears under the thumb wherever it lands
 *               rather than sitting in a fixed corner, because a fixed stick on
 *               a phone is a stick you miss — you look at the fight, not at
 *               your thumb.
 *   RIGHT HALF  a drag, anywhere that is not a button: look and blade.
 *   BUTTONS     the six a fight cannot be had without — guard, attack, jump,
 *               dash, sprint, ignite — in a thumb arc off the bottom-right,
 *               with the guard biggest because it is the one that is HELD.
 *
 * Everything else is reached through surfaces the game already has: the power
 * wheel is a row of the Force verbs you actually hold, with cooldowns and
 * prices already on it, so on a phone its slots are buttons (see `bindWheel`);
 * the order and emote wheels are held-key radials, which is a gesture a thumb
 * already makes.
 */

import { canFullscreen, toggleFullscreen } from './Wholescreen.js';

/** How much of a screen width a full stick throw is. */
const STICK_RADIUS = 0.16;
/** Dead centre of the stick, as a fraction of its radius. */
const STICK_DEAD = 0.18;
/**
 * Screen pixels of drag per pixel of "mouse" movement.
 *
 * A phone screen is small and a wrist flick has to be able to cross the guard
 * rose, so a drag is worth more than its own length. Multiplied by the
 * player's own sensitivity afterwards, so the Options slider means the same
 * thing on both devices.
 */
const LOOK_SCALE = 1.9;

/** The buttons, in the order they are laid out. `hold` is a press-and-keep. */
export const TOUCH_BUTTONS = [
  { id: 'blade',  label: 'GUARD',  hold: true,  cls: 'big' },
  { id: 'thrust', label: 'ATTACK', hold: false, cls: '' },
  { id: 'jump',   label: 'JUMP',   hold: true,  cls: '' },
  { id: 'dash',   label: 'DASH',   hold: false, cls: '' },
  { id: 'sprint', label: 'RUN',    hold: true,  cls: 'left' },
  { id: 'ignite', label: 'IGNITE', hold: false, cls: 'left' },
];

/** The small top-right cluster: things you press between fights. */
export const TOUCH_TOOLS = [
  { id: 'view',   label: '1st/3rd' },
  { id: 'crouch', label: 'Crouch', hold: true },
];

export class Touch {
  /**
   * @param input  the Input this writes into
   * @param canvas the play surface; the overlay is a sibling of it
   * @param opts   { onMenu } — the pause button, since Escape is a keyboard
   */
  constructor(input, opts = {}) {
    this.input = input;
    this.onMenu = opts.onMenu || null;
    this.root = null;
    this.active = false;
    this.enabled = false;
    /** identifier → what that finger is doing. */
    this._fingers = new Map();
    this._listeners = [];
    this._stick = null;
    this._held = new Set();
  }

  /** Bind the one listener that decides whether any of this happens at all. */
  attach() {
    const wake = (e) => {
      if (!e.touches || !e.touches.length) return;
      this._build();
    };
    /* `capture` so a button that stops propagation still wakes the layer, and
     * `passive` so the first touch of the session is never delayed by us. */
    window.addEventListener('touchstart', wake, { capture: true, passive: true });
    this._listeners.push([window, 'touchstart', wake, { capture: true, passive: true }]);
    return this;
  }

  /** Is the player holding the phone rather than a mouse. */
  get live() { return this.active; }

  /** Show or hide the pad. The HUD's own visibility decides this. */
  show(on) {
    this.enabled = !!on;
    if (!this.root) return;
    this.root.classList.toggle('on', this.active && this.enabled);
    if (!on) this._releaseAll();
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  /**
   * THE FIRST TOUCH BUILDS EVERYTHING, ONCE.
   *
   * Nothing above this line has written to `input`, drawn a node or bound a
   * move listener, which is why a desktop cannot tell this module is here.
   */
  _build() {
    if (this.active) return;
    this.active = true;
    this.input.touchActive = true;
    this.input._useDevice?.('touch');
    /* AND THE LOCK IS RELEASED IF ONE WAS TAKEN. A laptop with a touchscreen
     * can have grabbed the pointer with a click before the first tap, and a
     * locked pointer eats the touches this layer needs. */
    this.input.exitLock?.();

    const root = document.getElementById('touch');
    if (!root) return;                                  // no markup: no pad
    this.root = root;
    root.innerHTML = '';

    const stick = document.createElement('div');
    stick.className = 'tc-stick';
    stick.innerHTML = '<i></i>';
    root.appendChild(stick);
    this._stickEl = stick;
    this._stickNub = stick.querySelector('i');

    /* TWO RACKS, because there are two thumbs. The right one is the fight —
     * guard, attack, jump, dash — and the left one carries the holds the left
     * thumb can reach past the stick without leaving it. */
    const pad = document.createElement('div');
    pad.className = 'tc-pad';
    const left = document.createElement('div');
    left.className = 'tc-left';
    for (const b of TOUCH_BUTTONS) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = `tc-btn ${b.cls}`.trim();
      d.dataset.action = b.id;
      d.dataset.hold = b.hold ? '1' : '';
      d.textContent = b.label;
      (b.cls === 'left' ? left : pad).appendChild(d);
    }
    root.appendChild(pad);
    root.appendChild(left);

    /* SAID ONCE, WHERE A PORTRAIT PHONE WILL READ IT. The HUD's two bottom
     * corners need the width and the pad needs both thumbs off the same edge,
     * so this game is played sideways. The stylesheet decides when it shows. */
    const turn = document.createElement('div');
    turn.className = 'tc-turn';
    turn.textContent = 'Turn your phone sideways';
    root.appendChild(turn);

    const tools = document.createElement('div');
    tools.className = 'tc-tools';
    const menu = document.createElement('button');
    menu.type = 'button';
    menu.className = 'tc-tool';
    menu.dataset.menu = '1';
    menu.textContent = 'MENU';
    tools.appendChild(menu);
    /**
     * FULL SCREEN, AND ON A PHONE IT IS THE MOST USEFUL BUTTON HERE.
     *
     * It is not an ACTION and deliberately has no key binding: it is a request
     * the browser only grants inside a user gesture, so it has to be a thing
     * you PRESS rather than something the frame loop can decide to do. On a
     * phone it also takes the URL bar away, which is what stops the viewport
     * resizing under the HUD every time the page is touched — see
     * Wholescreen.js.
     *
     * Only where the API exists. iOS Safari on an iPhone has no fullscreen at
     * all, and a button that cannot work is worse than no button.
     */
    if (canFullscreen()) {
      const fs = document.createElement('button');
      fs.type = 'button';
      fs.className = 'tc-tool';
      fs.dataset.fullscreen = '1';
      fs.textContent = 'FULL';
      tools.appendChild(fs);
    }
    for (const t of TOUCH_TOOLS) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'tc-tool';
      d.dataset.action = t.id;
      d.dataset.hold = t.hold ? '1' : '';
      d.textContent = t.label;
      tools.appendChild(d);
    }
    root.appendChild(tools);

    this._bindSurface(root);
    this.show(this.enabled);
  }

  /**
   * ONE SET OF HANDLERS FOR THE WHOLE OVERLAY, keyed on the finger.
   *
   * Per-button listeners were the first version and they are wrong on a phone:
   * a thumb that starts on GUARD and slides two millimetres onto ATTACK must
   * keep guarding, because that is what a physical button does and a finger is
   * never still. So a touch is claimed by whatever is under it when it LANDS
   * and belongs to that thing until it lifts.
   */
  _bindSurface(root) {
    const claim = (t) => {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const btn = el?.closest?.('[data-action],[data-menu],[data-fullscreen]');
      if (btn && root.contains(btn)) return btn;
      return null;
    };

    const start = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const btn = claim(t);
        if (btn) {
          if (btn.dataset.menu) { this._fingers.set(t.identifier, { kind: 'menu' }); btn.classList.add('down'); continue; }
          if (btn.dataset.fullscreen) {
            /* ON THE WAY DOWN, because THIS is the user gesture the browser
             * will grant the request inside — a `touchend` handler is one too,
             * but a finger that slides off the button never sends one. */
            this._fingers.set(t.identifier, { kind: 'tap', el: btn });
            btn.classList.add('down');
            toggleFullscreen();
            continue;
          }
          const id = btn.dataset.action;
          this._fingers.set(t.identifier, { kind: 'btn', id, hold: !!btn.dataset.hold, el: btn });
          btn.classList.add('down');
          /* A TAP IS AN EDGE AND A HOLD IS A STATE, and both are announced on
           * the way DOWN: `actHit` is what a press fires on, and a hold that
           * did not also report its press would lose the first frame of every
           * power that reads the edge. */
          this.input.touchHitSet.add(id);
          if (btn.dataset.hold) { this.input.touchHeld.add(id); this._held.add(id); }
          continue;
        }
        /* NOT A BUTTON: the halves. The stick is the left third and a bit,
         * because a right-handed player looks with the right thumb and the
         * blade wants the bigger half. */
        if (t.clientX < window.innerWidth * 0.42 && !this._stick) {
          this._stick = { id: t.identifier, ox: t.clientX, oy: t.clientY };
          this._fingers.set(t.identifier, { kind: 'stick' });
          this._placeStick(t.clientX, t.clientY, 0, 0);
        } else {
          this._fingers.set(t.identifier, { kind: 'look', x: t.clientX, y: t.clientY });
        }
      }
    };

    const move = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const f = this._fingers.get(t.identifier);
        if (!f) continue;
        if (f.kind === 'stick') {
          const r = window.innerWidth * STICK_RADIUS;
          let dx = (t.clientX - this._stick.ox) / r;
          let dy = (t.clientY - this._stick.oy) / r;
          const len = Math.hypot(dx, dy);
          if (len > 1) { dx /= len; dy /= len; }
          this._writeStick(dx, dy);
          this._placeStick(this._stick.ox, this._stick.oy, dx, dy);
        } else if (f.kind === 'look') {
          const s = LOOK_SCALE * (this.input.sensitivity ?? 1);
          const dy = (t.clientY - f.y) * s;
          this.input.mouse.dx += (t.clientX - f.x) * s;
          this.input.mouse.dy += this.input.invertY ? -dy : dy;
          f.x = t.clientX; f.y = t.clientY;
        }
      }
    };

    const end = (e) => {
      for (const t of e.changedTouches) {
        const f = this._fingers.get(t.identifier);
        this._fingers.delete(t.identifier);
        if (!f) continue;
        if (f.kind === 'stick') { this._stick = null; this._writeStick(0, 0); this._hideStick(); }
        else if (f.kind === 'btn') {
          f.el?.classList.remove('down');
          if (f.hold) { this.input.touchHeld.delete(f.id); this._held.delete(f.id); }
        } else if (f.kind === 'tap') {
          f.el?.classList.remove('down');
        } else if (f.kind === 'menu') {
          for (const b of this.root.querySelectorAll('.tc-tool')) b.classList.remove('down');
          this.onMenu?.();
        }
      }
    };

    /* NOT PASSIVE: a drag on the play surface must not scroll the page or fire
     * the browser's pull-to-refresh, and a double tap must not zoom. That is
     * the one thing this layer takes from the browser, and it takes it only
     * once a finger is already down inside the overlay. */
    const opts = { passive: false };
    const wrap = (fn) => (e) => { e.preventDefault(); fn(e); };
    this._on(root, 'touchstart', wrap(start), opts);
    this._on(root, 'touchmove', wrap(move), opts);
    this._on(root, 'touchend', wrap(end), opts);
    this._on(root, 'touchcancel', wrap(end), opts);
    /* A finger that leaves the overlay entirely still has to be released, and
     * `touchend` on the root is not fired for it on every browser. */
    this._on(window, 'touchend', end, { passive: true });
    this._on(window, 'touchcancel', end, { passive: true });
  }

  /** The stick's four actions, as the analog magnitudes `actAxis` reads. */
  _writeStick(dx, dy) {
    const a = this.input.touchAxes;
    const past = (v) => {
      const m = Math.abs(v);
      return m < STICK_DEAD ? 0 : (m - STICK_DEAD) / (1 - STICK_DEAD);
    };
    a.set('moveR', dx > 0 ? past(dx) : 0);
    a.set('moveL', dx < 0 ? past(dx) : 0);
    /* SCREEN Y IS DOWN AND FORWARD IS UP, which is the one sign flip in here. */
    a.set('moveB', dy > 0 ? past(dy) : 0);
    a.set('moveF', dy < 0 ? past(dy) : 0);
  }

  _placeStick(ox, oy, dx, dy) {
    if (!this._stickEl) return;
    const r = window.innerWidth * STICK_RADIUS;
    this._stickEl.style.left = `${ox}px`;
    this._stickEl.style.top = `${oy}px`;
    this._stickEl.style.width = `${r * 2}px`;
    this._stickEl.style.height = `${r * 2}px`;
    this._stickEl.classList.add('on');
    if (this._stickNub) {
      this._stickNub.style.transform = `translate(${dx * r * 0.62}px, ${dy * r * 0.62}px)`;
    }
  }

  _hideStick() {
    this._stickEl?.classList.remove('on');
    if (this._stickNub) this._stickNub.style.transform = 'translate(0,0)';
  }

  /** Every finger up and every hold let go — used when the pad is hidden. */
  _releaseAll() {
    for (const id of this._held) this.input.touchHeld.delete(id);
    this._held.clear();
    this._fingers.clear();
    this._stick = null;
    this._writeStick(0, 0);
    this._hideStick();
    if (this.root) for (const b of this.root.querySelectorAll('.down')) b.classList.remove('down');
  }

  /**
   * MAKE AN EXISTING HUD SURFACE PRESSABLE — the power wheel, and anything
   * else that already lists an action.
   *
   * The wheel is the right answer to "where do the other thirty actions go":
   * it is already a row of exactly the Force verbs this player holds, already
   * carries the cooldown, the price and the state, and already sits under the
   * right thumb. Making it a button rack costs one listener and no layout.
   *
   * A tap fires the action for one frame through the same edge a screen button
   * uses, so nothing downstream can tell which of the two was pressed.
   */
  bindWheel(el) {
    if (!el || el._touchBound) return;
    el._touchBound = true;
    const fire = (e) => {
      if (!this.active || !this.enabled) return;
      const slot = e.target?.closest?.('[data-action]');
      if (!slot || !el.contains(slot)) return;
      e.preventDefault();
      this.input.touchHitSet.add(slot.dataset.action);
      slot.classList.add('down');
      setTimeout(() => slot.classList.remove('down'), 120);
    };
    el.addEventListener('touchstart', fire, { passive: false });
    this._listeners.push([el, 'touchstart', fire, { passive: false }]);
  }

  dispose() {
    for (const [t, ty, fn, o] of this._listeners) t.removeEventListener(ty, fn, o);
    this._listeners.length = 0;
    this._releaseAll();
    this.input.touchActive = false;
  }
}
