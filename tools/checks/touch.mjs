/**
 * BATTLEFRONT BORZ — the thumb, and the desktop it must not touch.
 *
 * "the game actually runs pretty decent on the phone but there's no control
 * scheme I don't think, is there any way you can make touch controls for the
 * phone? (Don't fuck up the actual desktop game)"
 * "make sure there's a way to make the game full screen"
 *
 * The parenthesis is the hard half. A touch layer is easy to add and easy to
 * add BADLY: the failure mode is not that the phone plays wrong, it is that a
 * desktop starts paying for a device nobody is holding — a listener on every
 * frame, a node in the tree, a pointer lock that will not take. So the first
 * three checks below are about the machine with a mouse, and only then does
 * anything here press a button.
 *
 * ── WHAT WAS MEASURED, AND WHERE ────────────────────────────────────────
 *
 * This file drives the real `Touch`, the real `Input` and the real
 * `Fullscreen` over a real parse of index.html. What it CANNOT do is lay
 * anything out — `_page.mjs` is a DOM, not a layout engine — so the geometry
 * the handlers need comes from `PHONE`, which is not invented: every box in it
 * was measured in Chromium at 844x390 with `hasTouch`, and the same session
 * confirmed the behaviours this file then re-checks structurally:
 *
 *   before any touch   #touch 0 children, touchActive false, 0 axes, 0 holds —
 *                      and still 0 after a mouse click on the play surface
 *   the first touch    5 children; blade thrust jump dash sprint ignite, and
 *                      the tools MENU FULL 1st/3rd Crouch
 *   the stick          a 60px push up on an 844px screen -> moveF 0.322, which
 *                      is exactly ((60/135) - 0.18) / (1 - 0.18), and
 *                      actAxis('moveF') read the same 0.322
 *   the drag           80x50 px on the right half -> mouse.dx 152, dy 95
 *   GUARD              held while down, still held after sliding 70px off it,
 *                      released on lift and released again when the HUD hid
 *   FULL               one requestFullscreen, from the touchstart
 *   the wheel          12 power slots, all pressable, the first being `push`
 *   the frame          nothing in #touch outside 844x390
 *
 * The numbers are recorded because a check that only says "greater than zero"
 * would have passed on the first version of the stick, which was linear from
 * the centre and therefore had no rest position at all.
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { makeDocument } from './_page.mjs';
import { chromiumPath, CHROME_ARGS } from './_browser.mjs';
import { handler } from '../serve.mjs';
import { Touch, TOUCH_BUTTONS, TOUCH_TOOLS } from '../../src/engine/Touch.js';
import { Input } from '../../src/engine/Input.js';
import { canFullscreen, isFullscreen, goFullscreen, exitFullscreen, toggleFullscreen } from '../../src/engine/Fullscreen.js';
import { ACTION_IDS } from '../../src/engine/Bindings.js';
import { DEFAULT_SETTINGS, SETTING_READERS } from '../../src/ui/Menu.js';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/** A phone held sideways, as Chromium reported it. See the header. */
const PHONE = { w: 844, h: 390 };
/** Every box in the overlay, measured. Keyed the way `claim()` looks things up. */
const BOXES = {
  'blade':  [562, 192, 658, 288],
  'thrust': [668, 214, 742, 288],
  'jump':   [752, 214, 826, 288],
  'dash':   [584, 298, 658, 372],
  'sprint': [18, 308, 82, 372],
  'ignite': [92, 308, 156, 372],
  'view':   [683, 14, 756, 46],
  'crouch': [764, 14, 830, 46],
  'MENU':   [562, 14, 614, 46],
  'FULL':   [622, 14, 675, 46],
};

/**
 * A page with a window that remembers, and a `elementFromPoint` that answers
 * from `BOXES` rather than from a layout that does not exist here.
 *
 * SYNCHRONOUS from `open()` to `close()`, for the reason menu.mjs gives: the
 * runner starts the next check the moment this one suspends, and a check that
 * awaited anything while a fake document sat on globalThis would hand its page
 * to whatever ran next.
 */
function phone(html) {
  const doc = makeDocument(html);
  const restoreDoc = doc.install();
  const win = {
    innerWidth: PHONE.w, innerHeight: PHONE.h,
    _bound: [],
    addEventListener(type, fn, opts) { win._bound.push({ type, fn, opts }); },
    removeEventListener(type, fn) {
      const i = win._bound.findIndex((b) => b.fn === fn);
      if (i >= 0) win._bound.splice(i, 1);
    },
  };
  doc.elementFromPoint = (x, y) => {
    for (const [key, [l, t, r, b]] of Object.entries(BOXES)) {
      if (x < l || x > r || y < t || y > b) continue;
      const sel = key === 'MENU' ? '[data-menu]' : key === 'FULL' ? '[data-fullscreen]'
        : `[data-action="${key}"]`;
      const hit = doc.querySelector(`#touch ${sel}`);
      if (hit) return hit;
    }
    return doc.getElementById('touch');
  };
  const prevWin = globalThis.window;
  const prevW = globalThis.innerWidth;
  const prevH = globalThis.innerHeight;
  globalThis.window = win;
  globalThis.innerWidth = PHONE.w;
  globalThis.innerHeight = PHONE.h;
  return {
    doc, win,
    close() {
      globalThis.window = prevWin;
      globalThis.innerWidth = prevW;
      globalThis.innerHeight = prevH;
      restoreDoc();
    },
  };
}

const freshInput = () => new Input({ addEventListener() {}, requestPointerLock() {} });

/**
 * Attach a real `Touch` and hand back the listener IT added.
 *
 * `new Input(...)` binds its own window listeners — that is what a keyboard
 * is — so counting `win._bound` outright measures the wrong thing. The
 * difference across `attach()` is the number this file is actually about.
 */
function attachPad(p, input, opts = {}) {
  const before = p.win._bound.length;
  const t = new Touch(input, opts).attach();
  const added = p.win._bound.slice(before);
  return { t, added, wake: added[0]?.fn };
}

/** Fire a touch phase at the overlay the way a finger does. */
function touch(root, type, points) {
  const list = points.map((p) => ({ identifier: p.id ?? 1, clientX: p.x, clientY: p.y }));
  return root.dispatchEvent({ type, changedTouches: list, touches: type === 'touchend' ? [] : list });
}

/** The centre of a measured box. */
const mid = (k) => ({ x: (BOXES[k][0] + BOXES[k][2]) / 2, y: (BOXES[k][1] + BOXES[k][3]) / 2 });

export async function run({ check, assert }) {
  const INDEX = await read('index.html');
  const CSS = await read('styles.css');
  const TOUCH_SRC = await read('src/engine/Touch.js');
  const INPUT_SRC = await read('src/engine/Input.js');
  const MAIN_SRC = await read('src/main.js');

  /* ── 1. the desktop cannot notice ─────────────────────────────────── */

  check('a machine with a mouse pays one listener and nothing else', () => {
    const p = phone(INDEX);
    try {
      const input = freshInput();
      const { t, added } = attachPad(p, input);
      assert(added.length === 1,
        `attach() bound ${added.length} window listeners — a desktop pays every one of them`);
      assert(added[0].type === 'touchstart',
        `the one listener is '${added[0].type}', which fires on a machine with no touchscreen`);
      assert(added[0].opts?.passive === true,
        'the wake listener is not passive — it can delay the first touch of the session');
      assert(added[0].opts?.capture === true,
        'the wake listener does not capture — a button that stops propagation never wakes the layer');

      // Nothing built, nothing written, no device change.
      assert(t.active === false, 'the layer woke without a finger');
      assert(input.touchActive === false, 'input.touchActive is set before any touch');
      assert(input.device === 'key', `the device flipped to '${input.device}' with nobody touching anything`);
      assert(p.doc.getElementById('touch').children.length === 0,
        'the overlay was built before a touch — that is a node in a desktop tree');
      assert(input.touchAxes.size === 0 && input.touchHeld.size === 0 && input.touchHitSet.size === 0,
        'the touch device wrote into Input before a finger arrived');
      return `1 passive capturing touchstart on window, 0 nodes, 0 writes, device '${input.device}'`;
    } finally { p.close(); }
  });

  check('the desktop read paths are untouched when no finger has landed', () => {
    const p = phone(INDEX);
    try {
      const input = freshInput();
      attachPad(p, input);
      /* The three readers the whole game goes through. Every one must answer
       * exactly what it answered before this module existed. */
      assert(input.act('blade') === false, 'act() is true with no input at all');
      assert(input.actHit('thrust') === false, 'actHit() is true with no input at all');
      assert(input.actAxis('moveF') === 0, 'actAxis() is non-zero with no input at all');
      const m = input.moveAxis();
      assert(m.x === 0 && m.y === 0, `moveAxis is ${m.x},${m.y} with nothing held`);
      /* AND THE POINTER LOCK STILL TAKES. `requestLock` returns early when a
       * thumb is driving, and a desktop must never hit that early return. */
      let asked = 0;
      input.canvas.requestPointerLock = () => { asked++; };
      input.enabled = true;
      input.requestLock();
      assert(asked === 1, 'the pointer lock was refused on a desktop — the touch guard is inverted');
      return 'act/actHit/actAxis/moveAxis all rest, pointer lock still granted';
    } finally { p.close(); }
  });

  check('a locked pointer is released and refused once a thumb is driving', () => {
    const p = phone(INDEX);
    try {
      const input = freshInput();
      /* A laptop with a touchscreen can have grabbed the pointer with a click
       * before the first tap, and a locked pointer eats the touches. */
      let exits = 0, asks = 0;
      input.exitLock = () => { exits++; };
      input.canvas.requestPointerLock = () => { asks++; };
      input.enabled = true;
      const { t, wake } = attachPad(p, input);
      wake({ touches: [{ clientX: 1, clientY: 1 }] });
      assert(t.active, 'the first touch did not wake the layer');
      assert(exits === 1, `the lock was not released on the first touch (${exits})`);
      input.requestLock();
      assert(asks === 0, 'the pointer lock was taken while a thumb was driving — it eats every touch');
      assert(input.device === 'touch', `the device is '${input.device}' with a finger on the glass`);
      /* Behavioural above, structural here: the early return has to be the
       * FIRST thing requestLock does with a finger down, before any of the
       * retry paths, or a rejected request retries into the lock anyway. */
      const guard = INPUT_SRC.slice(INPUT_SRC.indexOf('requestLock() {'));
      const upToRetry = guard.slice(0, guard.indexOf('const retry'));
      assert(/if \(this\.touchActive\) return;/.test(upToRetry),
        'requestLock() does not bail on touchActive before it starts asking — the guard moved');
      return `1 exitLock, 0 requestPointerLock, device 'touch'`;
    } finally { p.close(); }
  });

  /* ── 2. the first touch builds the pad, once ──────────────────────── */

  check('the first touch builds the whole pad and the second does not rebuild it', () => {
    const p = phone(INDEX);
    try {
      const input = freshInput();
      const { wake } = attachPad(p, input);
      wake({ touches: [{ clientX: 400, clientY: 200 }] });
      const root = p.doc.getElementById('touch');
      const first = root.children.length;
      assert(first >= 4, `the pad built ${first} nodes — Chromium counted 5`);
      const acts = [...root.querySelectorAll('[data-action]')].map((b) => b.dataset.action);
      const want = [...TOUCH_BUTTONS, ...TOUCH_TOOLS].map((b) => b.id);
      assert(want.every((id) => acts.includes(id)),
        `built ${acts.join(',')} but the tables ask for ${want.join(',')}`);
      assert(root.querySelector('.tc-stick'), 'no stick');
      assert(root.querySelector('[data-menu]'), 'no MENU button — Escape is a keyboard and a phone has none');
      assert(root.querySelector('.tc-turn'), 'nothing tells a portrait phone to turn sideways');
      // The second touch must be a no-op, not a second pad.
      wake({ touches: [{ clientX: 10, clientY: 10 }] });
      assert(root.children.length === first,
        `a second touch rebuilt the pad (${first} -> ${root.children.length})`);
      return `${first} nodes, ${acts.length} actions (${acts.join(' ')}), built once`;
    } finally { p.close(); }
  });

  check('every screen button is bound to an action the game actually handles', () => {
    /* The exact defect controls.mjs exists for, one device further out: a
     * button labelled ATTACK that names an id nothing dispatches reads
     * perfectly well as source and does nothing at all when pressed. */
    const ids = [...TOUCH_BUTTONS, ...TOUCH_TOOLS].map((b) => b.id);
    const strays = ids.filter((id) => !ACTION_IDS.includes(id));
    assert(!strays.length, `${strays.join(', ')} — no such action, so the button does nothing`);
    assert(new Set(ids).size === ids.length, 'the same action is on two buttons');
    /* The four the stick writes are actions too, and they are the ones
     * `moveAxis` reads — not raw key codes. */
    for (const a of ['moveF', 'moveB', 'moveL', 'moveR']) {
      assert(ACTION_IDS.includes(a), `the stick writes '${a}' and that is not an action`);
      assert(new RegExp(`actAxis\\('${a}'\\)`).test(INPUT_SRC),
        `moveAxis does not read '${a}' through actAxis — the stick writes into a field nobody reads`);
    }
    return `${ids.length} buttons, all real actions; stick on moveF/moveB/moveL/moveR`;
  });

  /* ── 3. the stick ─────────────────────────────────────────────────── */

  check('the stick has a rest position, a full throw and the right sign on Y', () => {
    const p = phone(INDEX);
    try {
      const input = freshInput();
      const { t, wake } = attachPad(p, input);
      wake({ touches: [{ clientX: 1, clientY: 1 }] });
      t.show(true);
      const root = p.doc.getElementById('touch');
      const r = PHONE.w * 0.16;                      // STICK_RADIUS, measured 135px

      // Land on the left third; the stick appears under the thumb.
      touch(root, 'touchstart', [{ x: 150, y: 250 }]);
      assert(input.actAxis('moveF') === 0 && input.actAxis('moveL') === 0,
        'the stick moved the player the moment the thumb landed');

      // A THUMB THAT HAS BARELY MOVED IS AT REST. Inside the dead zone.
      touch(root, 'touchmove', [{ x: 150, y: 250 - r * 0.1 }]);
      assert(input.actAxis('moveF') === 0,
        `a 10% nudge walked at ${input.actAxis('moveF')} — the stick has no rest position`);

      // 60px up on an 844px screen — the number the browser reported.
      touch(root, 'touchmove', [{ x: 150, y: 190 }]);
      const f = input.actAxis('moveF');
      const wantF = ((60 / r) - 0.18) / (1 - 0.18);
      assert(Math.abs(f - wantF) < 1e-6, `60px up read ${f.toFixed(4)}, not ${wantF.toFixed(4)}`);
      assert(Math.abs(f - 0.322) < 0.002, `60px up read ${f.toFixed(3)}; Chromium measured 0.322`);
      assert(input.actAxis('moveB') === 0, 'pushing up also walked backwards — the Y sign is wrong');

      // A THROW PAST THE RIM IS STILL ONE. Clamped, not amplified.
      touch(root, 'touchmove', [{ x: 150 - r * 4, y: 250 }]);
      const l = input.actAxis('moveL');
      assert(Math.abs(l - 1) < 1e-9, `a four-radius shove read ${l} — the stick is not clamped`);
      const m = input.moveAxis();
      assert(Math.abs(m.x + 1) < 1e-9 && Math.abs(m.y) < 1e-9,
        `moveAxis read ${m.x.toFixed(2)},${m.y.toFixed(2)} on a hard left`);

      // AND LIFTING STOPS THE PLAYER.
      touch(root, 'touchend', [{ x: 150 - r * 4, y: 250 }]);
      assert(input.actAxis('moveL') === 0, 'the player kept walking after the thumb left the glass');
      assert(!root.querySelector('.tc-stick').classList.contains('on'), 'the stick is still drawn');
      return `dead 0.18 rest, 60px -> ${f.toFixed(3)}, 4r -> 1.000 clamped, release -> 0`;
    } finally { p.close(); }
  });

  check('the stick is a stick and the other half is the wrist', () => {
    const p = phone(INDEX);
    try {
      const input = freshInput();
      const { t, wake } = attachPad(p, input);
      wake({ touches: [{ clientX: 1, clientY: 1 }] });
      t.show(true);
      const root = p.doc.getElementById('touch');
      /* THE MOUSE DELTA IS THE BLADE. The saber controller reads nothing else,
       * so a drag on the right half has to arrive as mouse movement or the
       * whole blade system is unreachable on a phone. */
      touch(root, 'touchstart', [{ x: 500, y: 30, id: 7 }]);
      assert(input.mouse.dx === 0 && input.mouse.dy === 0, 'landing a finger moved the view');
      touch(root, 'touchmove', [{ x: 580, y: 80, id: 7 }]);
      assert(Math.abs(input.mouse.dx - 152) < 0.001,
        `an 80px drag gave dx ${input.mouse.dx}; Chromium measured 152 (80 x 1.9)`);
      assert(Math.abs(input.mouse.dy - 95) < 0.001,
        `a 50px drag gave dy ${input.mouse.dy}; Chromium measured 95`);
      // The player's own sensitivity means the same thing on both devices.
      input.mouse.dx = 0;
      input.sensitivity = 2;
      touch(root, 'touchmove', [{ x: 660, y: 80, id: 7 }]);
      assert(Math.abs(input.mouse.dx - 304) < 0.001,
        `sensitivity 2 gave ${input.mouse.dx}, not 304 — the slider does not reach touch`);
      // And invert-Y, which is the same setting the mouse reads.
      input.mouse.dy = 0;
      input.invertY = true;
      touch(root, 'touchmove', [{ x: 660, y: 130, id: 7 }]);
      assert(input.mouse.dy < 0, 'invert-Y does nothing on a phone');
      // A drag on the RIGHT never becomes a stick.
      assert(input.actAxis('moveF') === 0 && input.actAxis('moveR') === 0,
        'a look drag walked the player');
      return 'right-half drag -> mouse.dx/dy, x1.9, sensitivity and invert-Y both honoured';
    } finally { p.close(); }
  });

  /* ── 4. the buttons ───────────────────────────────────────────────── */

  check('a held button is a state, a tap is an edge, and a slide keeps holding', () => {
    const p = phone(INDEX);
    try {
      const input = freshInput();
      const { t, wake } = attachPad(p, input);
      wake({ touches: [{ clientX: 1, clientY: 1 }] });
      t.show(true);
      const root = p.doc.getElementById('touch');
      const g = mid('blade');

      touch(root, 'touchstart', [{ x: g.x, y: g.y }]);
      assert(input.act('blade') === true, 'GUARD is not held while it is pressed');
      /* BOTH ON THE WAY DOWN: a hold that did not also report its press would
       * lose the first frame of every power that reads the edge. */
      assert(input.actHit('blade') === true, 'the press of a held button fired no edge');
      input.end();
      assert(input.actHit('blade') === false, 'the edge survived a frame — a tap fired twice');
      assert(input.act('blade') === true, 'end() let go of a button the thumb is still on');

      /* A THUMB IS NEVER STILL. Sliding 70px off GUARD must keep guarding,
       * because that is what a physical button does. */
      touch(root, 'touchmove', [{ x: g.x + 70, y: g.y + 40 }]);
      assert(input.act('blade') === true, 'a 70px slide let go of the guard mid-fight');
      touch(root, 'touchend', [{ x: g.x + 70, y: g.y + 40 }]);
      assert(input.act('blade') === false, 'the guard is still held after the thumb left');

      // A TAP button is an edge only — it must not stick.
      touch(root, 'touchstart', [{ x: mid('dash').x, y: mid('dash').y }]);
      assert(input.actHit('dash') === true, 'DASH fired nothing');
      assert(input.act('dash') === false, 'DASH is a tap and it latched on');
      input.end();
      touch(root, 'touchend', [{ x: mid('dash').x, y: mid('dash').y }]);
      assert(input.actHit('dash') === false && input.act('dash') === false, 'DASH is still going');
      return 'hold = state, tap = one-frame edge, 70px slide keeps the guard';
    } finally { p.close(); }
  });

  check('two thumbs at once, and hiding the pad lets go of everything', () => {
    const p = phone(INDEX);
    try {
      const input = freshInput();
      const { t, wake } = attachPad(p, input);
      wake({ touches: [{ clientX: 1, clientY: 1 }] });
      t.show(true);
      const root = p.doc.getElementById('touch');
      // Left thumb walks, right thumb guards — the whole point of two racks.
      touch(root, 'touchstart', [{ x: 150, y: 250, id: 1 }]);
      touch(root, 'touchstart', [{ x: mid('blade').x, y: mid('blade').y, id: 2 }]);
      touch(root, 'touchmove', [{ x: 150, y: 250 - PHONE.w * 0.16, id: 1 }]);
      assert(input.actAxis('moveF') === 1, `walking while guarding read ${input.actAxis('moveF')}`);
      assert(input.act('blade') === true, 'the guard dropped when the other thumb moved');
      // And a third finger on RUN, which is the left rack.
      touch(root, 'touchstart', [{ x: mid('sprint').x, y: mid('sprint').y, id: 3 }]);
      assert(input.act('sprint') === true, 'the third finger did nothing');
      assert(input.act('blade') === true && input.actAxis('moveF') === 1,
        'the third finger stole the other two');

      /* THE PAUSE. A guard held when the menu opens is held forever unless the
       * pad lets go on the way down. */
      t.show(false);
      assert(input.act('blade') === false && input.act('sprint') === false,
        'a button stayed held after the pad was hidden');
      assert(input.actAxis('moveF') === 0, 'the player kept walking into the pause menu');
      assert(!root.classList.contains('on'), 'the hidden pad is still painted');
      // …and nothing lands while it is hidden.
      touch(root, 'touchstart', [{ x: mid('blade').x, y: mid('blade').y, id: 9 }]);
      assert(input.act('blade') === false, 'the hidden pad still took a press');
      return '3 fingers independent; show(false) releases every one and refuses new ones';
    } finally { p.close(); }
  });

  check('MENU and FULL are pressed, and the wheel is a button rack', () => {
    const p = phone(INDEX);
    try {
      let menu = 0;
      const input = freshInput();
      const { t, wake } = attachPad(p, input, { onMenu: () => { menu++; } });
      wake({ touches: [{ clientX: 1, clientY: 1 }] });
      t.show(true);
      const root = p.doc.getElementById('touch');
      const m = mid('MENU');
      touch(root, 'touchstart', [{ x: m.x, y: m.y }]);
      touch(root, 'touchend', [{ x: m.x, y: m.y }]);
      assert(menu === 1, `the pause button fired ${menu} times — a phone has no Escape key`);

      /* THE WHEEL IS WHERE THE OTHER THIRTY ACTIONS LIVE. It is already a row
       * of exactly the Force verbs this player holds, with the cooldown and the
       * price on it, so on a phone its slots are buttons. */
      const wheel = p.doc.getElementById('power-wheel');
      assert(wheel, 'no #power-wheel to bind');
      const slot = p.doc.createElement('div');
      slot.dataset.action = 'push';
      wheel.appendChild(slot);
      t.bindWheel(wheel);
      wheel.dispatchEvent({ type: 'touchstart', target: slot });
      assert(input.actHit('push') === true, 'a tap on the power wheel fired nothing');
      input.end();
      assert(input.actHit('push') === false, 'the wheel tap lasted more than a frame');
      /* AND IT MUST NOT FIRE ON A DESKTOP, where the same node is clicked. */
      const cold = freshInput();
      const { t: t2 } = attachPad(p, cold);
      const w2 = p.doc.createElement('div');
      w2.appendChild(slot);
      t2.bindWheel(w2);
      w2.dispatchEvent({ type: 'touchstart', target: slot });
      assert(cold.actHit('push') === false, 'the wheel fired before the layer was ever woken');
      return `MENU fires the hook once; wheel slots fire a one-frame edge, inert until woken`;
    } finally { p.close(); }
  });

  /* ── 5. full screen ───────────────────────────────────────────────── */

  check('full screen is asked for, let go of, and never offered where it cannot work', () => {
    const p = phone(INDEX);
    try {
      const doc = p.doc;
      const root = doc.documentElement;
      // A browser with no fullscreen API at all — iOS Safari on an iPhone.
      assert(canFullscreen() === false, 'canFullscreen() is true with no API on the element');
      assert(goFullscreen() === false, 'goFullscreen() claimed success with no API');
      assert(isFullscreen() === false, 'isFullscreen() is true on a page that is not');

      let asked = 0, left = 0;
      root.requestFullscreen = () => { asked++; doc.fullscreenElement = root; return Promise.resolve(); };
      doc.exitFullscreen = () => { left++; doc.fullscreenElement = null; };
      assert(canFullscreen() === true, 'canFullscreen() is false with requestFullscreen right there');
      assert(toggleFullscreen() === true, 'the toggle did not report going in');
      assert(asked === 1, `${asked} requests from one press`);
      assert(isFullscreen() === true, 'we are full screen and it says otherwise');
      assert(toggleFullscreen() === false, 'the toggle did not report coming out');
      assert(left === 1, `${left} exits from one press`);
      assert(isFullscreen() === false, 'still full screen after exiting');

      // The prefixed spelling, which is the only one some browsers have.
      delete root.requestFullscreen; delete doc.exitFullscreen; doc.fullscreenElement = null;
      let webkit = 0;
      root.webkitRequestFullscreen = () => { webkit++; };
      assert(canFullscreen() === true, 'the webkit spelling is not recognised');
      goFullscreen();
      assert(webkit === 1, 'the webkit request was never made');
      delete root.webkitRequestFullscreen;

      /* A REQUEST OUTSIDE A GESTURE IS REFUSED WITH A REJECTED PROMISE, and a
       * rejection nobody catches is an unhandled error in the console of a
       * player who did nothing wrong. */
      root.requestFullscreen = () => Promise.reject(new Error('not a user gesture'));
      assert(goFullscreen() === true, 'a refusable request did not even get made');
      delete root.requestFullscreen;
      // A throwing implementation must not take the game down either.
      root.requestFullscreen = () => { throw new Error('nope'); };
      assert(goFullscreen() === false, 'a throwing requestFullscreen escaped');
      delete root.requestFullscreen;
      exitFullscreen();                                  // safe when not in it
      return '1 request, 1 exit, webkit spelling, and both refusals swallowed';
    } finally { p.close(); }
  });

  check('the FULL button only exists where the API does, and asks on the way down', () => {
    // No API: no button. A button that cannot work is worse than no button.
    {
      const p = phone(INDEX);
      try {
        const { wake } = attachPad(p, freshInput());
        wake({ touches: [{ clientX: 1, clientY: 1 }] });
        assert(!p.doc.querySelector('#touch [data-fullscreen]'),
          'a FULL button was drawn on a browser with no fullscreen API');
      } finally { p.close(); }
    }
    const p = phone(INDEX);
    try {
      let asked = 0;
      p.doc.documentElement.requestFullscreen = () => { asked++; return Promise.resolve(); };
      const input = freshInput();
      const { t, wake } = attachPad(p, input);
      wake({ touches: [{ clientX: 1, clientY: 1 }] });
      t.show(true);
      const root = p.doc.getElementById('touch');
      const btn = p.doc.querySelector('#touch [data-fullscreen]');
      assert(btn, 'no FULL button where the API exists');
      const f = mid('FULL');
      /* ON THE WAY DOWN, because that is the gesture the browser grants the
       * request inside — and a finger that slides off never sends a touchend. */
      touch(root, 'touchstart', [{ x: f.x, y: f.y }]);
      assert(asked === 1, `the FULL button asked ${asked} times on press`);
      touch(root, 'touchend', [{ x: f.x, y: f.y }]);
      assert(asked === 1, `it asked again on release (${asked} total)`);
      // It is not an action, so it must never reach the game as one.
      assert(input.touchHeld.size === 0 && input.touchHitSet.size === 0,
        'FULL leaked into the action sets — it is a browser request, not a verb');
      assert(!/data-fullscreen/.test(String(btn.dataset.action)),
        'the FULL button also carries an action');
      return 'absent without the API, one request on touchstart, zero actions fired';
    } finally { p.close(); }
  });

  check('the fullscreen setting is real: a default, a control and a reader', () => {
    /* The exact shape controls.mjs was written for — a checkbox with nobody
     * behind it. `fullscreen` is not applied by a frame loop; it is applied at
     * Ignite, which is the only gesture the browser will grant it inside. */
    assert('fullscreen' in DEFAULT_SETTINGS, 'no `fullscreen` default');
    assert(SETTING_READERS.fullscreen, '`fullscreen` has no reader — the tick does nothing');
    assert(/id="opt-fullscreen"|id="btn-fullscreen"/.test(INDEX),
      'no fullscreen control in the markup');
    assert(/settings\.fullscreen\s*\)?\s*\)?\s*(&&|\?)?[\s\S]{0,80}goFullscreen\(\)|if \(settings\.fullscreen\) goFullscreen\(\)/.test(MAIN_SRC),
      'nothing in main.js goes full screen when the setting is on');
    assert(/goFullscreen|toggleFullscreen/.test(MAIN_SRC), 'main.js never calls the module');
    return 'default + control + reader + a caller inside the deploy gesture';
  });

  /* ── 6. the shipped page ──────────────────────────────────────────── */

  check('the page carries the overlay, the stylesheet hides it, and the packer keeps it', async () => {
    assert(/id="touch"/.test(INDEX), 'index.html has no #touch for the pad to build into');
    assert(/aria-hidden/.test(INDEX.match(/<div id="touch"[^>]*>/)?.[0] || ''),
      '#touch is not hidden from a screen reader — it is a set of unlabelled boxes');
    /* PAINTED ONLY WHEN THE LAYER IS AWAKE. The overlay sits over the play
     * surface, so a desktop that got a visible one would have every click
     * swallowed by it. */
    assert(/#touch\s*\{[^}]*display\s*:\s*none/.test(CSS) || /#touch:not\(\.on\)/.test(CSS)
      || /#touch\s*\{[^}]*pointer-events\s*:\s*none/.test(CSS),
      'the stylesheet does not keep #touch off a desktop');
    assert(/#touch\.on/.test(CSS), 'nothing turns the pad on');
    for (const cls of ['.tc-stick', '.tc-btn', '.tc-tool', '.tc-turn']) {
      assert(CSS.includes(cls), `${cls} is built and never styled`);
    }
    /* THE SINGLE-FILE BUILD IS WHAT A PHONE ACTUALLY OPENS. A packer that
     * dropped these two modules would ship a phone with no controls and a
     * desktop that could not tell. */
    /* The packer is generic: it starts at the page's own <script src> and
     * follows every relative specifier, so the question is not whether it
     * knows about Touch.js — it is whether main.js reaches it. */
    const packer = await read('tools/pack.mjs');
    assert(/const entry = resolve\(ROOT, \(html\.match/.test(packer) && /await walk\(entry\)/.test(packer),
      'the packer no longer walks the page entry, so this file cannot say what ships');
    assert(/import .*Touch.*from '\.\/engine\/Touch\.js'/.test(MAIN_SRC),
      'main.js does not import the touch layer, so the packer will never see it');
    assert(/new Touch\([\s\S]{0,120}\.attach\(\)/.test(MAIN_SRC), 'main.js never attaches it');
    assert(/hud\.onShow\s*=\s*\([\s\S]{0,60}touch\.show/.test(MAIN_SRC),
      'nothing hides the pad with the HUD — a guard would stay held into the menu');
    assert(/touch\.bindWheel/.test(MAIN_SRC), 'the power wheel is not made pressable');
    return '#touch present and aria-hidden, 4 classes styled, wired in main.js';
  });

  check('nothing in the touch layer runs on a desktop frame', () => {
    /* The structural half of check 1: no frame-loop entry point at all. If
     * `Touch` ever grows an update() somebody will call it every frame on
     * every machine, which is the cost this design exists to avoid. */
    assert(!/\bupdate\s*\(/.test(TOUCH_SRC), 'Touch has an update() — that is a per-frame cost on a desktop');
    assert(!/requestAnimationFrame/.test(TOUCH_SRC), 'Touch drives its own frames');
    assert(!/setInterval/.test(TOUCH_SRC), 'Touch polls on a timer');
    /* And the game must have no touch branch: the whole design is a device
     * that writes the fields the other two devices write. */
    const src = MAIN_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    const branches = [...src.matchAll(/if\s*\([^)]*\b(touchActive|touch\.live|isTouch)\b/g)];
    assert(branches.length === 0,
      `main.js branches on the device ${branches.length} time(s) — the phone is meant to be invisible downstream`);
    return 'no update(), no rAF, no timer, no device branch in main.js';
  });

  /* ── 7. the phone the pad is actually held on ─────────────────────── */

  check('a landscape phone fits: nothing off the frame, and nothing under a thumb', async () => {
    /**
     * THE ONE THING NO STYLESHEET CAN BE ASKED, and the reason this suite
     * drives a real browser at all.
     *
     * The touch pad wants three corners the HUD already uses, and a phone in
     * landscape is 390 px tall where the HUD was laid out at 720. Measured
     * before this was fixed, at 844x390:
     *
     *   #power-wheel   y 414..512 — the whole control row BELOW the screen,
     *                  because `.hud-br` is capped at `100vh - 300px` and a
     *                  five-box bottom-anchored flow spills out of a 90 px box
     *   .tc-tools      on `.hud-tr`, 172x20 of the score and the wave
     *   .tc-left       on `.hud-bl`, 124x54 of the vitals
     *   .tc-pad        on `.hud-br` and the minimap, 248x90 and 132x102
     *
     * So the assertion is not "does it render" — it did — it is that no two of
     * these boxes share a pixel and none of them is outside the frame, at the
     * three shapes a phone is actually held in.
     */
    const server = createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROME_ARGS });
    /* A wide phone, a short one and a small one. All landscape, because the
     * game says so on the pad itself and the stylesheet says it in a
     * `(orientation:portrait)` rule. */
    const SIZES = [[844, 390], [740, 360], [667, 375]];
    const lines = [];
    try {
      for (const [width, height] of SIZES) {
        const ctx = await browser.newContext({
          viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));
        try {
          await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
          await page.waitForFunction(() => !!window.SABER, null, { timeout: 120000 });
          await page.evaluate(() => {
            document.getElementById('boot')?.classList.add('hidden');
            document.getElementById('menu')?.classList.add('hidden');
            window.SABER.hud.show(true);
          });
          // A real touch, because the pad does not exist until there is one.
          await page.touchscreen.tap(Math.round(width * 0.45), Math.round(height * 0.35));
          await page.waitForTimeout(150);
          const out = await page.evaluate(() => {
            const WATCH = ['.hud-tl', '.hud-tr', '.hud-bl', '.hud-br', '#power-wheel',
              '.tc-pad', '.tc-left', '.tc-tools'];
            const seen = [];
            for (const sel of WATCH) {
              const el = document.querySelector(sel);
              if (!el) continue;
              const cs = getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
              const b = el.getBoundingClientRect();
              if (b.width < 2 || b.height < 2) continue;
              seen.push({ sel, el, b });
            }
            const outside = [];
            for (const { sel, b } of seen) {
              const off = [];
              if (b.left < -0.5) off.push(`left ${Math.round(b.left)}`);
              if (b.right > innerWidth + 0.5) off.push(`right +${Math.round(b.right - innerWidth)}`);
              if (b.top < -0.5) off.push(`top ${Math.round(b.top)}`);
              if (b.bottom > innerHeight + 0.5) off.push(`bottom +${Math.round(b.bottom - innerHeight)}`);
              if (off.length) outside.push(`${sel} ${off.join(', ')}`);
            }
            const overlaps = [];
            for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) {
              const A = seen[i], B = seen[j];
              // A box inside another box is a flow, not a collision.
              if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
              const x = Math.min(A.b.right, B.b.right) - Math.max(A.b.left, B.b.left);
              const y = Math.min(A.b.bottom, B.b.bottom) - Math.max(A.b.top, B.b.top);
              if (x > 2 && y > 2) {
                overlaps.push(`${A.sel} over ${B.sel} by ${Math.round(x)}x${Math.round(y)}`);
              }
            }
            /* AND THE WHEEL HAS TO BE PRESSABLE. `#touch.on` is `inset:0` at
             * z-index 40 over a HUD at 20, so a slot that is merely on screen
             * is still a slot no finger can reach. */
            const slot = document.querySelector('#power-wheel [data-action]');
            let reach = 'no slot';
            if (slot) {
              const r = slot.getBoundingClientRect();
              const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              reach = top?.closest('[data-action]') === slot ? 'ok'
                : `blocked by ${top?.id ? '#' + top.id : '.' + String(top?.className).split(' ')[0]}`;
            }
            return { outside, overlaps, boxes: seen.length, reach };
          });
          assert(!errs.length, `${width}x${height}: the page threw — ${errs[0]}`);
          assert(!out.outside.length,
            `${width}x${height}: ${out.outside.length} box(es) outside the frame — ${out.outside.join('; ')}`);
          assert(!out.overlaps.length,
            `${width}x${height}: ${out.overlaps.length} collision(s) — ${out.overlaps.join('; ')}`);
          assert(out.reach === 'ok',
            `${width}x${height}: the power wheel cannot be pressed — ${out.reach}`);
          lines.push(`${width}x${height} ${out.boxes} boxes, 0 collisions, wheel reachable`);
        } finally { await page.close(); await ctx.close(); }
      }
    } finally { await browser.close(); server.close(); }
    return lines.join('; ');
  });
}
