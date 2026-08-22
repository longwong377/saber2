/**
 * THE SETTINGS A RUN CAN REACH, AND WHAT A CONTROL OWES THE PLAYER WHO PRESSES IT.
 *
 * ── THE HOLE THIS SUITE WAS WRITTEN FOR ─────────────────────────────────
 *
 * `#pause` carried Resume, Restart wave, Abandon run, Copy frame report and
 * the key table. Nothing else. Master volume, music, field of view, blade
 * sensitivity, inverted Y, camera shake, cinematic slow-motion, the reticle,
 * the minimap, the whole of Fidelity and the whole of Sound lived on the
 * Options tab of the FRONT SCREEN, and the only route to the front screen
 * mid-run is `#btn-quit`, which is `quitToMenu()`, which calls
 * `world.dispose()`. The price of turning the music down was the run.
 *
 * What makes that a defect rather than a decision is that four separate
 * comments in the shipped source already claimed the opposite, in those words:
 *
 *   Menu.applyFeelSettings   "so a box ticked on the pause screen bites on the
 *                             very next explosion with no redeploy"
 *   SETTING_READERS.rumble   "so a pad that is too strong is turned down
 *                             mid-fight from the pause card"
 *   the reticle sliders      "these three controls are reachable from the
 *                             pause card"
 *   _buildPauseTraining      "'Live' is worth nothing if the only copy of the
 *                             control is behind Abandon Run"
 *
 * Four claims about a card with no settings on it. `_buildBindings` had
 * already won this argument once for the key table — "the list was one
 * #bind-list in the Options panel, which behind a run means Abandon Run,
 * rebind, deploy again" — and left every other control where it found it.
 *
 * ── AND THE TWO THINGS A CONTROL OWES ───────────────────────────────────
 *
 * Measured on the shipped page in Chromium, by patching `audio.ui` and driving
 * every control in the menu one at a time:
 *
 *   THE CLICK   116 cards, swatches and tabs answered a press. 21 of the 23
 *               checkboxes answered nothing at all. The two that did had
 *               `() => audio.ui('click')` hand-written as their onChange,
 *               which is the proof it was an oversight and not a taste.
 *   THE HOVER   24 of 140 controls answered the pointer arriving, and the
 *               split ran THROUGH single screens: on the Deploy panel the
 *               seven theatre cards and the seven run rules blipped while the
 *               four difficulties and the nine modes under them were silent.
 *
 * Both are now on the funnel — `_check` and `_activate` — rather than on the
 * call sites, which is the same move the shake and hitstop gates made, and the
 * checks below drive the real Menu and count.
 */

import { readFile } from 'node:fs/promises';
import { makeDocument } from './_page.mjs';
import { Menu, DEFAULT_SETTINGS, SETTING_READERS } from '../../src/ui/Menu.js';
import { audio } from '../../src/engine/Audio.js';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

let INDEX_HTML = '';

/**
 * A real Menu on a real parse of index.html.
 *
 * SYNCHRONOUS from install() to close(), for the reason menu.mjs gives: the
 * runner starts the next check the moment this one suspends, and a check that
 * awaited anything while a fake `document` sat on globalThis would hand its
 * page to whatever ran next.
 */
function menuOn(overrides = {}) {
  const doc = makeDocument(INDEX_HTML);
  const restore = doc.install();
  try {
    const settings = { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
    const hooks = { fired: [] };
    for (const name of ['onDeploy', 'onQualityChange', 'onBloom', 'onSchemeChange', 'onDeflectAim',
      'onLightning', 'onSaberChange', 'onName', 'onHost', 'onJoin', 'onBindings', 'onBladeLength',
      'onInvert', 'onFeel', 'onFov', 'onSensitivity', 'onCamFollow', 'onGrain', 'onResolution']) {
      hooks[name] = (v) => hooks.fired.push([name, v]);
    }
    const menu = new Menu(settings, hooks);
    return { menu, settings, hooks, doc, close: restore };
  } catch (e) { restore(); throw e; }
}

/** Every mirror on the pause card, as [row id, mirror input id, the setting]. */
const MIRRORS = [
  ['opt-vol', 'opt-pause-vol', 'volume'],
  ['opt-music', 'opt-pause-music', 'music'],
  ['opt-fov', 'opt-pause-fov', 'fov'],
  ['opt-sens', 'opt-pause-sens', 'sensitivity'],
  ['opt-invert', 'opt-pause-invert', 'invertY'],
  ['opt-shake', 'opt-pause-shake', 'shake'],
];

/**
 * Count what `audio.ui` is asked for while `fn` runs.
 *
 * The engine singleton is borrowed, so it is handed back whole — HANDOFF §2.9,
 * and `ui` is a prototype method, so the restore is a delete of the own
 * property rather than an assignment of the old one.
 */
function heard(fn) {
  const log = [];
  const had = Object.prototype.hasOwnProperty.call(audio, 'ui');
  const was = audio.ui;
  audio.ui = (kind = 'hover') => { log.push(kind); };
  try { fn(); } finally {
    if (had) audio.ui = was; else delete audio.ui;
  }
  return log;
}

export async function run({ check, assert }) {
  INDEX_HTML = await read('index.html');
  const MENU_SRC = await read('src/ui/Menu.js');
  const MAIN_SRC = await read('src/main.js');

  /* ══════════════════════════════════════════════════════════════════
   *  1. THE SETTINGS ARE ON THE CARD AT ALL
   * ══════════════════════════════════════════════════════════════════ */

  check('pause: the card carries settings, and every one of them is live', () => {
    const b = menuOn();
    try {
      b.menu.showPause([['Wave', 1]]);
      const toggle = b.doc.getElementById('btn-pause-opts');
      const box = b.doc.getElementById('pause-opts-box');
      assert(toggle && box, 'the pause card has no way into the settings');
      assert(box.classList.contains('hidden'), 'the settings box is open before it is asked for');
      assert(toggle.getAttribute('aria-controls') === 'pause-opts-box',
        'the disclosure button does not name the box it opens');

      /* EVERY ONE OF THEM IS LIVE, and that is the test for belonging here:
       * a control that answers "next time you deploy" is the lie this card is
       * removing, not a second helping of it. The reader is read out of
       * SETTING_READERS rather than restated (HANDOFF §2.4), and where the
       * reader is a hook it is main.js's implementation that is checked —
       * a hook Menu declares and main.js never implements would be a control
       * that writes a number nothing acts on until the next deploy. */
      const LIVE = {
        // The two mixer sliders act on the shared engine from the control
        // itself, which is why their seam is in this file and not in main.js.
        volume:      ['ui/Menu.js', 'v => audio.setVolume(v)'],
        music:       ['ui/Menu.js', 'v => audio.setMusicVolume(v)'],
        fov:         ['main.js', 'world.player.camera.fovTarget = v'],
        sensitivity: ['main.js', 'world.player.control.sensitivity = v'],
        invertY:     ['main.js', 'input.invertY = v'],
        shake:       ['ui/Menu.js', 'if (rig._feelSettings.shake) addShake(v)'],
      };
      const src = { 'main.js': MAIN_SRC, 'ui/Menu.js': MENU_SRC };
      for (const [, , key] of MIRRORS) {
        assert(key in DEFAULT_SETTINGS, `${key} is on the pause card and has no default`);
        assert(key in SETTING_READERS, `${key} is on the pause card and has no declared reader`);
        const [file, expr] = LIVE[key];
        assert(src[file].includes(expr),
          `${key} is on the pause card, and ${file} no longer contains \`${expr}\` — `
          + 'the seam that made it live mid-run is gone');
      }
      return `${MIRRORS.length} settings on the card, all live: `
        + MIRRORS.map(([, , k]) => k).join(', ');
    } finally { b.close(); }
  });

  check('pause: no row on the card is a second copy of the control it mirrors', () => {
    const b = menuOn();
    try {
      b.menu.showPause([['Wave', 1]]);
      const rows = [];
      for (const [twinId, mirrorId] of MIRRORS) {
        const twin = b.doc.getElementById(twinId);
        const copy = b.doc.getElementById(mirrorId);
        assert(twin, `${twinId} is gone from the Options panel`);
        assert(copy, `${mirrorId} is not on the pause card — the row was never built`);
        assert(copy.closest('#pause-opts-list'),
          `${mirrorId} is not inside the pause card's own list`);
        /* THE WORDS. Filled from the twin's label so the two screens cannot
         * end up calling one setting two things. */
        const words = copy.closest('label')?.querySelector('span')?.textContent || '';
        const from = [...(twin.closest('label')?.childNodes || [])]
          .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim())
          .filter(Boolean).join(' ');
        assert(words && words === from,
          `${mirrorId} is labelled "${words}" and ${twinId} is labelled "${from}"`);
        /* THE NUMBERS. Copied, never typed — the whole point (HANDOFF §2.3).
         * A checkbox has none, and asserting it has none is what stops a
         * range creeping onto one. */
        if ((twin.getAttribute('type') || twin.type) === 'checkbox') {
          for (const a of ['min', 'max', 'step']) {
            assert(!copy.hasAttribute(a), `${mirrorId} is a checkbox carrying a ${a}`);
          }
          rows.push(`${words} (box)`);
          continue;
        }
        for (const a of ['min', 'max', 'step']) {
          assert(copy.getAttribute(a) === twin.getAttribute(a),
            `${mirrorId} ${a}=${copy.getAttribute(a)} against ${twinId} ${a}=${twin.getAttribute(a)}`);
        }
        rows.push(`${words} ${copy.getAttribute('min')}–${copy.getAttribute('max')}`
          + `/${copy.getAttribute('step')}`);
      }
      /* …and nothing in the markup carries a number of its own, which is what
       * makes the paragraph above true rather than merely currently agreeing. */
      const list = INDEX_HTML.slice(INDEX_HTML.indexOf('id="pause-opts-list"'));
      const typed = list.slice(0, list.indexOf('</div>'))
        .match(/\b(?:min|max|step|value)="/g) || [];
      assert(!typed.length,
        `index.html types ${typed.length} range attribute(s) into the pause rows — `
        + 'they are copied off the twin and a second copy will drift');
      return rows.join(' · ');
    } finally { b.close(); }
  });

  check('pause: a control moved on the card is moved on the Options screen, and reaches the game', () => {
    const b = menuOn();
    try {
      b.menu.showPause([['Wave', 1]]);
      const said = [];
      for (const [twinId, mirrorId, key] of MIRRORS) {
        const twin = b.doc.getElementById(twinId);
        const copy = b.doc.getElementById(mirrorId);
        const before = b.settings[key];
        if ((copy.getAttribute('type') || copy.type) === 'checkbox') {
          copy.checked = !before;
          copy.dispatchEvent({ type: 'change' });
          assert(b.settings[key] === !before,
            `${mirrorId} was ticked and ${key} is still ${JSON.stringify(b.settings[key])}`);
          assert(twin.checked === !before,
            `${mirrorId} was ticked and ${twinId} still reads ${twin.checked} — two boxes, two answers`);
          /* …and the other way, which is the half a one-directional sync
           * passes by accident. */
          twin.checked = before;
          twin.dispatchEvent({ type: 'change' });
          assert(copy.checked === before,
            `${twinId} was untucked and ${mirrorId} still reads ${copy.checked}`);
          said.push(`${key} ${before}→${!before}→${before}`);
          continue;
        }
        const min = parseFloat(copy.getAttribute('min'));
        const max = parseFloat(copy.getAttribute('max'));
        const want = before === min ? max : min;
        copy.value = String(want);
        copy.dispatchEvent({ type: 'input' });
        assert(b.settings[key] === want,
          `${mirrorId} was dragged to ${want} and ${key} is ${b.settings[key]}`);
        assert(parseFloat(twin.value) === want,
          `${mirrorId} was dragged to ${want} and ${twinId} still shows ${twin.value}`);
        /* The number under the SLIDER is the same number, painted by the
         * formatter the Options control registered — the pause copy declares
         * none, which is what makes "one setting, one vocabulary" true. */
        const label = copy.closest('label')?.querySelector('b')?.textContent;
        const twinLabel = twin.closest('label')?.querySelector('b')?.textContent;
        assert(label && label === twinLabel,
          `${mirrorId} reads "${label}" and ${twinId} reads "${twinLabel}"`);
        said.push(`${key} ${before}→${want} (${label})`);
      }
      /* AND IT LEFT THE MENU. Each of the six hangs off a hook main.js
       * implements; the fired log is the proof the pause copy raised them. */
      const fired = new Set(b.hooks.fired.map(([n]) => n));
      for (const n of ['onFov', 'onSensitivity', 'onInvert', 'onFeel']) {
        assert(fired.has(n), `${n} never fired — the pause copy writes a setting and tells nobody`);
      }
      return said.join(' · ');
    } finally { b.close(); }
  });

  check('pause: the settings box folds itself away between pauses', () => {
    const b = menuOn();
    try {
      b.menu.showPause([['Wave', 1]]);
      const toggle = b.doc.getElementById('btn-pause-opts');
      const box = b.doc.getElementById('pause-opts-box');
      toggle.dispatchEvent({ type: 'click' });
      assert(!box.classList.contains('hidden'), 'the disclosure did not open the box');
      assert(toggle.getAttribute('aria-expanded') === 'true', 'the button did not say it was open');
      b.menu.hidePause();
      b.menu.showPause([['Wave', 2]]);
      assert(box.classList.contains('hidden'),
        'the settings box is still open on the next pause — a card that remembers being '
        + 'open hides Resume behind a list you opened once, twenty minutes ago');
      assert(toggle.getAttribute('aria-expanded') === 'false',
        'the button still says it is open');
      /* The key table's box has always done this, and the two are now driven
       * by one loop; if one folds and the other does not, the loop is gone. */
      assert(b.doc.getElementById('pause-bind-box').classList.contains('hidden'),
        'the key table no longer folds away between pauses');
      return 'open → hidePause → showPause → folded, and the key table with it';
    } finally { b.close(); }
  });

  /* ══════════════════════════════════════════════════════════════════
   *  2. EVERY CONTROL ANSWERS THE PRESS
   * ══════════════════════════════════════════════════════════════════ */

  check('pause: every checkbox in the menu answers a press, and answers once', () => {
    const b = menuOn();
    try {
      b.menu.showPause([['Wave', 1]]);
      const boxes = [...b.doc.querySelectorAll('input')]
        .filter((el) => el.getAttribute('type') === 'checkbox' && el.id);
      assert(boxes.length >= 20, `only ${boxes.length} checkboxes found — the page did not build`);
      const silent = [], twice = [];
      for (const el of boxes) {
        const log = heard(() => { el.checked = !el.checked; el.dispatchEvent({ type: 'change' }); });
        const clicks = log.filter((k) => k === 'click').length;
        if (clicks === 0) silent.push(el.id);
        if (clicks > 1) twice.push(`${el.id} x${clicks}`);
      }
      assert(!silent.length, `checkboxes that make no sound: ${silent.join(', ')}`);
      assert(!twice.length, `checkboxes that answer twice: ${twice.join(', ')}`);
      return `${boxes.length} checkboxes, every one exactly one click`;
    } finally { b.close(); }
  });

  check('pause: every card the pointer can reach answers it, and answers once', () => {
    const b = menuOn();
    try {
      /* `_activate` is the one seam that knows an element is a control, so it
       * is the one place the hover can live. Everything it has touched carries
       * `role="button"`, which is how they are found here — a list of class
       * names would only ever agree with itself. */
      const cards = [...b.doc.querySelectorAll('[role="button"]')];
      assert(cards.length >= 100, `only ${cards.length} activatable controls — the page did not build`);
      const silent = [], twice = [];
      for (const el of cards) {
        const log = heard(() => el.dispatchEvent({ type: 'mouseenter' }));
        const hovers = log.filter((k) => k === 'hover').length;
        if (hovers === 0) silent.push(el.id || el.getAttribute('aria-label') || el.localName);
        if (hovers > 1) twice.push(el.id || el.getAttribute('aria-label') || el.localName);
      }
      assert(!silent.length, `${silent.length} controls answer no hover: ${silent.slice(0, 6).join(', ')}`);
      assert(!twice.length, `${twice.length} controls hover twice: ${twice.slice(0, 6).join(', ')}`);
      /* …and the four hand-written copies are gone, which is what stops the
       * doubling coming back the next time somebody adds a card. */
      const hand = (MENU_SRC.match(/addEventListener\('mouseenter', \(\) => audio\.ui\('hover'\)\)/g) || []);
      assert(hand.length === 2,
        `${hand.length} hand-written hover listeners in Menu.js — expected 2 (the tab strip, `
        + 'which is a real <button> and not an _activate, and _activate itself)');
      return `${cards.length} controls, every one exactly one hover`;
    } finally { b.close(); }
  });

  check('pause: a pad can move a slider, not just land on one', () => {
    /**
     * `padNav` moved the focus and did nothing else, so on a controller every
     * range input in the game was a row you could land on and not a control.
     * A pad raises no DOM events and there is no arrow key behind it for the
     * browser's own range handling to answer — the same gap `_padFocusable`
     * closes one step earlier for buttons.
     *
     * Driven through the real method, on a real Menu, and asserted on the
     * SETTING: "the slider moved" is a fact about the game, not about focus.
     */
    const b = menuOn();
    try {
      const moved = [];
      const stuck = [];
      /* Every slider on the two screens a pad walks, not a hand-picked one:
       * the front screen is where a pad player sets the game up, and the pause
       * card is where they fix it. One at a time, because `_padHost` answers
       * with the topmost card and a control on the screen behind it is
       * correctly out of reach. */
      for (const host of ['menu', 'pause']) {
        if (host === 'menu') { b.menu.hidePause(); b.menu.showMenu(); } else {
          b.menu.showPause([['Wave', 1]]);
          // The settings are behind a disclosure, exactly as the key table is.
          b.doc.getElementById('btn-pause-opts').dispatchEvent({ type: 'click' });
        }
        const el = b.doc.getElementById(host);
        assert(b.menu._padHost() === el, `the pad is walking #${b.menu._padHost()?.id} and not #${host}`);
        for (const input of b.menu._padFocusable(el)) {
          if ((input.getAttribute('type') || input.type) !== 'range') continue;
          const min = parseFloat(input.getAttribute('min'));
          const max = parseFloat(input.getAttribute('max'));
          const step = parseFloat(input.getAttribute('step')) || 1;
          /* Parked one step off the floor so both directions have somewhere to
           * go — a slider already at its stop legitimately refuses. Set the
           * way a drag sets it, because that is the seam being tested. */
          input.value = String(Math.min(max, min + step));
          input.dispatchEvent({ type: 'input' });
          input.focus();
          /* THE SETTINGS BLOB, not one named key: `_sheetSlider`'s two write
           * into the character sheet rather than into a top-level setting, and
           * a check that could only read a top-level key would report the two
           * sliders it cannot see as the two the pad cannot move. */
          const before = parseFloat(input.value), blob = JSON.stringify(b.settings);
          b.menu.padNav('right');
          const after = parseFloat(input.value), moved2 = JSON.stringify(b.settings) !== blob;
          b.menu.padNav('left');
          const back = parseFloat(input.value);
          if (!(after > before)) { stuck.push(`${input.id} did not move right`); continue; }
          if (!moved2) { stuck.push(`${input.id} moved and wrote nothing`); continue; }
          if (back !== before) { stuck.push(`${input.id} did not come back left`); continue; }
          moved.push(input.id);
        }
      }
      assert(moved.length >= 25, `only ${moved.length} sliders were reached from a pad`);
      assert(!stuck.length, `sliders a pad cannot move: ${stuck.join(', ')}`);
      /* AND UP/DOWN STILL WALKS PAST ONE, or the slider becomes a trap of its
       * own: left and right are the number, up and down are the list. */
      const first = b.doc.getElementById('opt-sens');
      first.focus();
      b.menu.padNav('down');
      assert(b.doc.activeElement !== first, 'down did not leave the slider');
      return `${moved.length} sliders move on a pad, both ways, and up still walks past them`;
    } finally { b.close(); }
  });

  check('pause: the card cannot grow past the screen it is centred on', async () => {
    /**
     * `.screen` centres its child with `align-items:center`, which clips an
     * over-tall child at BOTH ends and gives the player nothing to scroll.
     * Measured in Chromium — card height and the top of #btn-resume, shut /
     * settings open / key table open / both:
     *
     *   1920x1080  521 px / 424 · 765 / 302 · 1064 / 153 · 1308 / 31
     *   1366x768   521 / 268 · 767 / 145 · 947 / 55 · 1194 / −68
     *   1280x720   521 / 244 · 767 / 121 · 929 / 40 · 1176 / −83
     *
     * The third column is the KEY TABLE ALONE and it is what shipped: at 1366
     * the card already began 82 px above the window. The fourth is both boxes,
     * where Resume leaves the screen.
     *
     * This is a claim about the CASCADE and there is no layout engine here, so
     * it is checked the way front-screen.mjs checks its two geometric claims:
     * against the stylesheet, by the rule that has to exist for the numbers
     * above to be answered.
     */
    const css = await read('styles.css');
    const rule = /#pause \.pause-wrap\{([^}]*)\}/.exec(css);
    assert(rule, 'nothing in styles.css bounds the height of the pause card');
    const body = rule[1];
    assert(/max-height:\s*\d+vh/.test(body), `#pause .pause-wrap has no max-height: ${body}`);
    assert(/overflow-y:\s*auto/.test(body), `#pause .pause-wrap does not scroll: ${body}`);
    /* The padding is not decoration: `overflow-y:auto` makes the other axis a
     * scrollport too, and every button on this card carries a 5 px stamp and
     * lifts 2 px more under the pointer. And the width has to grow by exactly
     * that padding, because `box-sizing:border-box` would otherwise take it
     * out of the buttons. */
    const pad = /padding:\s*0\s+(\d+)px/.exec(body);
    const wide = /width:\s*min\((\d+)px/.exec(body);
    assert(pad && wide, `#pause .pause-wrap needs a padding and a width: ${body}`);
    const base = /\.pause-wrap,\.death-wrap\{width:min\((\d+)px/.exec(css);
    assert(base, 'the shared pause/death width rule is gone');
    assert(Number(wide[1]) === Number(base[1]) + 2 * Number(pad[1]),
      `the card is ${wide[1]} px wide with ${pad[1]} px of padding against a content width of `
      + `${base[1]} — the padding is coming out of the buttons`);
    return `max-height ${/max-height:\s*(\d+vh)/.exec(body)[1]}, scrolls, `
      + `${wide[1]} px wide for ${base[1]} px of content`;
  });

  /* ══════════════════════════════════════════════════════════════════
   *  3. A SLIDER CAN SIT WHERE ITS OWN DEFAULT IS
   * ══════════════════════════════════════════════════════════════════ */

  check('pause: no slider shows a position its own setting cannot occupy', () => {
    /**
     * A browser SNAPS a range input to its own step, and `_slider` prints the
     * number beside it from the SETTING. So a default that is not on the grid
     * puts the thumb in one place and the words in another, on the one row
     * whose whole job is to tell you where the thumb is.
     *
     * Measured across all 32 sliders on the shipped page: exactly one was off
     * — Music, default 0.45 on a 0.02 grid starting at 0. The thumb sat at
     * 0.46 while the label read 45%, and the first nudge right went to 48%.
     */
    const b = menuOn();
    try {
      b.menu.showPause([['Wave', 1]]);
      const rows = [...b.doc.querySelectorAll('input')]
        .filter((el) => el.getAttribute('type') === 'range' && el.id);
      assert(rows.length >= 25, `only ${rows.length} sliders found — the page did not build`);
      const off = [];
      let checked = 0;
      for (const el of rows) {
        const min = parseFloat(el.getAttribute('min'));
        const step = parseFloat(el.getAttribute('step'));
        const v = parseFloat(el.value);
        if (!Number.isFinite(min) || !Number.isFinite(step) || step <= 0 || !Number.isFinite(v)) continue;
        checked++;
        const n = (v - min) / step;
        // 1e-6 and not 0: the grid is decimal and the arithmetic is binary.
        if (Math.abs(n - Math.round(n)) > 1e-6) off.push(`${el.id} sits at ${v} on a ${step} grid from ${min}`);
      }
      assert(!off.length, off.join('; '));
      return `${checked} sliders, every default on its own grid`;
    } finally { b.close(); }
  });
}
