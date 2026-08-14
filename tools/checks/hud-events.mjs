/**
 * SABER — the two things the HUD gained, and the promise attached to each.
 *
 * 1. AN EVENT FEED. A four-kill exchange and a one-kill exchange used to feel
 *    identical, because nothing on screen said which had happened. The promise
 *    is that it reads as PART of the HUD — the score column saying something,
 *    not a banner arriving over the game — which is a layout claim, and layout
 *    claims are exactly the kind that quietly stop being true.
 *
 * 2. A CUSTOMISABLE RETICLE. It sits in the dead centre of the screen for the
 *    entire game and was a hard-coded white ring with its colour baked into
 *    styles.css. The trap here is specific and it has bitten this file once
 *    already: a stylesheet rule beats an SVG presentation attribute, so a
 *    leftover `stroke:` on `.ret-ring` pins every player to white while the
 *    slider moves, the setting saves, the reader runs, and nothing anywhere
 *    fails. That is checked as a property of styles.css, not as source.
 *
 * Underneath both: the settings themselves. tools/checks/controls.mjs already
 * holds every key in DEFAULT_SETTINGS to having a reader and a control; what it
 * cannot know is that these nine in particular are the ones that were promised,
 * so they are named here.
 */

import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { HUD, POWERS, POWER_COST, applyReticle, shapeAt, colorAt, RETICLE_SHAPES, RETICLE_COLORS, RETICLE_BASE }
  from '../../src/ui/HUD.js';
import { Player } from '../../src/game/Player.js';
import { makeDocument } from './_page.mjs';
import { DEFAULT_SETTINGS, SETTING_READERS } from '../../src/ui/Menu.js';
import { PLAYER_VOICES } from '../../src/engine/Voice.js';
import { defaultBindings, keyLabel } from '../../src/engine/Bindings.js';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/* ── a DOM the HUD can be driven through ─────────────────────────────── */

function node(tag = 'div') {
  const classes = new Set();
  const n = {
    tagName: tag, style: {}, dataset: {}, children: [], parentElement: null,
    textContent: '', innerHTML: '', classes,
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { const w = on === undefined ? !classes.has(c) : !!on; if (w) classes.add(c); else classes.delete(c); return w; },
    },
    appendChild(c) { n.children.push(c); c.parentElement = n; return c; },
    removeChild(c) { const i = n.children.indexOf(c); if (i >= 0) n.children.splice(i, 1); },
    remove() { n.parentElement?.removeChild(n); n.parentElement = null; },
    querySelector() { return n._q || (n._q = node('i')); },
    querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    get firstElementChild() { return n.children[0] || (n.children[0] = node('i')); },
    get firstChild() { return n.children[0] || null; },
    get previousSibling() { return null; },
  };
  return n;
}

/** A HUD on a fake page, with the fake document left installed for its use. */
function hudOn() {
  const nodes = new Map();
  const root = {
    getElementById: (id) => { if (!nodes.has(id)) nodes.set(id, node('div')); return nodes.get(id); },
    querySelector: (sel) => root.getElementById(sel),
  };
  for (const id of ['bar-hp', 'bar-force', 'bar-stam']) node('div').appendChild(root.getElementById(id));
  const realDoc = globalThis.document;
  globalThis.document = { createElement: (t) => node(t), createElementNS: (_n, t) => node(t) };
  let hud;
  try { hud = new HUD(root); } catch (e) { globalThis.document = realDoc; throw e; }
  return { hud, root, nodes, restore: () => { globalThis.document = realDoc; } };
}

const player = () => ({
  hp: 100, maxHp: 100, force: 50, maxForce: 100, stamina: 50, maxStamina: 100,
  flow: 0.4, combo: 1, score: 0, senseActive: false, throwState: 'held', kills: 0,
  deflects: 0, perfects: 0, alive: true, grounded: true, velocity: { y: 0 },
  gripBody: null, gripEnemy: null, lockState: null,
  cooldowns: { push: 0, pull: 0, throw: 0 },
  position: new THREE.Vector3(), chest: new THREE.Vector3(0, 1.4, 0),
  saber: { tipSpeed: 4 },
  camera: { firstPerson: false, aimQuat: new THREE.Quaternion() },
  control: { _grip: null, steering: 0, screenGuard: (c, ch, q, out) => out.set(0, 0) },
});

const stubWorld = (settings) => ({
  score: 0, enemies: [], training: false, focus: null, settings,
  director: { wave: 1, remaining: 3, active: true, intermission: 0 },
});

/**
 * A HUD ON THE REAL PAGE, with real text nodes and real parents.
 *
 * `hudOn` above is a bag of nodes keyed by id, and that is enough for most of
 * this file — but two of the defects below are about the SHAPE of the markup:
 * the wave counter reaches for a sibling element, and the frame counter's box
 * is decided by where the `<pre>` sits in the tree. Both of the fake nodes in
 * this repo define `get previousSibling() { return null; }`, which is exactly
 * what hid the LESSON bug for a whole round: the branch that renamed the
 * counter could never execute under test.
 *
 * Synchronous between install and restore — the runner starts the next check
 * the moment this one suspends, and a globally installed document would follow
 * it there.
 */
function hudOnPage(html) {
  const doc = makeDocument(html);
  const restore = doc.install();
  try {
    return { hud: new HUD(doc), doc, restore };
  } catch (e) { restore(); throw e; }
}

/** A player with the fields the wheel reads, and the real Force economy. */
function wheelPlayer(world) {
  const p = player();
  Object.assign(p, {
    world,
    force: 100,
    boonMods: { forceCost: 1, lightning: true },
    healing: null,
    stasis: { bodies: new Set() },
    cooldowns: { push: 0, pull: 0, throw: 0, grip: 0, sense: 0, lightning: 0, stasis: 0, heal: 0, compel: 0 },
    // The one function Player uses to decide whether a power can be paid for.
    // Borrowed rather than reimplemented: a copy of the formula here would be
    // the same second source of truth this whole check exists to forbid.
    _canSpend: Player.prototype._canSpend,
  });
  return p;
}

export async function run({ check, assert }) {
  const INDEX = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const PLAYER_SRC = await readFile(new URL('../../src/game/Player.js', import.meta.url), 'utf8');

  /* ────────────────────────────────────────────────────────────────────
   * THE FEED
   * ──────────────────────────────────────────────────────────────────── */

  check('hud: the event feed lives in the HUD and holds four rungs at most', () => {
    const { hud, root, restore } = hudOn();
    try {
      const feed = root.getElementById('event-feed');
      assert(hud.el.events === feed, 'the HUD no longer looks up #event-feed');
      hud.popupsOn = true;
      for (let i = 0; i < 9; i++) hud.popup(`EVENT ${i}`, `sub ${i}`, i % 2 ? 'streak' : 'boss');
      assert(feed.children.length === 4,
        `${feed.children.length} popups are on screen at once — the corner is a wall`);
      // the newest survives and the oldest leaves: a streak that just happened
      // must not be refused because five stale ones are still fading
      assert(feed.children[feed.children.length - 1].innerHTML.includes('EVENT 8'),
        'the most recent event was the one dropped');
      // each rung carries its kind, which is the only thing styles.css uses to
      // colour it — a popup with no kind class is an uncoloured popup
      for (const c of feed.children) {
        assert(/^ev ev-\w+$/.test(c.className), `a popup came out with className "${c.className}"`);
      }
      // and a title with markup in it is text, not markup
      hud.popup('<img src=x onerror=1>', '', 'boss');
      assert(!feed.children[feed.children.length - 1].innerHTML.includes('<img'),
        'a popup title is being injected as markup');
      return `9 events → ${feed.children.length} on screen, newest kept, kinds tagged, titles escaped`;
    } finally { restore(); }
  });

  check('hud: the popup switch is read off the live world, every frame', () => {
    const { hud, root, restore } = hudOn();
    try {
      const feed = root.getElementById('event-feed');
      const p = player();
      const s = { ...DEFAULT_SETTINGS, popups: true };
      const w = stubWorld(s);
      const cam = new THREE.PerspectiveCamera();
      hud.update(1 / 60, w, p, cam);
      hud.popup('ON', '', 'streak');
      const withIt = feed.children.length;
      s.popups = false;
      hud.update(1 / 60, w, p, cam);          // the same object, one field moved
      hud.popup('OFF', '', 'streak');
      assert(withIt === 1, 'with the switch on, nothing was drawn');
      assert(feed.children.length === 1,
        'unticking Event popups mid-run left them coming — that is a checkbox that does nothing');
      // …and it comes back without a redeploy
      s.popups = true;
      hud.update(1 / 60, w, p, cam);
      hud.popup('BACK', '', 'streak');
      assert(feed.children.length === 2, 'the switch is one-way');
      return 'on → 1, off → 0, on again → 1, all on the same settings object';
    } finally { restore(); }
  });

  check('hud: a frame of the HUD is a frame of the announcer and of the room', () => {
    // The whole wiring rests on this one call. If HUD.update stops driving
    // them, every voice line and every body sound in the game goes away and
    // absolutely nothing else changes.
    const { hud, restore } = hudOn();
    try {
      let announced = 0, roomed = 0;
      hud.announcer = { update: () => { announced++; }, stats: {} };
      hud.presence = { update: () => { roomed++; }, stats: {} };
      const p = player();
      const w = stubWorld({ ...DEFAULT_SETTINGS });
      const cam = new THREE.PerspectiveCamera();
      for (let f = 0; f < 30; f++) hud.update(1 / 60, w, p, cam);
      assert(announced === 30, `30 HUD frames drove the announcer ${announced} times`);
      assert(roomed === 30, `30 HUD frames drove the room ${roomed} times`);
      // and a HUD with no player drives neither, rather than throwing
      hud.update(1 / 60, w, null, cam);
      assert(announced === 30 && roomed === 30, 'a frame with no player still ran them');
      return '30 frames → 30 announcer updates, 30 presence updates';
    } finally { restore(); }
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE RETICLE
   * ──────────────────────────────────────────────────────────────────── */

  check('hud: the reticle is a shape, a size and a colour, and every one of them lands', () => {
    const el = node('svg');
    const base = applyReticle(el, { ...DEFAULT_SETTINGS });
    assert(base, 'applyReticle painted nothing at all');
    const first = el.innerHTML;
    assert(first.includes(RETICLE_COLORS[0].hex), 'the default colour did not reach the markup');
    assert(el.style.width === `${RETICLE_BASE.toFixed(1)}px`,
      `the default size came out as ${el.style.width}`);

    // shape: every entry in the table draws something a player can tell apart
    const drawn = new Set();
    for (let i = 0; i < RETICLE_SHAPES.length; i++) {
      applyReticle(el, { ...DEFAULT_SETTINGS, reticleShape: i });
      const html = el.innerHTML;
      if (RETICLE_SHAPES[i].id === 'none') { assert(html === '', 'the "None" reticle still draws'); continue; }
      assert(html.length > 10, `shape ${RETICLE_SHAPES[i].id} draws nothing`);
      assert(!drawn.has(html), `shape ${RETICLE_SHAPES[i].id} is identical to an earlier one`);
      drawn.add(html);
    }
    assert(drawn.size === RETICLE_SHAPES.length - 1,
      `${RETICLE_SHAPES.length} shapes produced ${drawn.size} pictures`);

    // colour: every entry reaches the markup, and they are all different
    const cols = new Set();
    for (let i = 0; i < RETICLE_COLORS.length; i++) {
      applyReticle(el, { ...DEFAULT_SETTINGS, reticleColor: i });
      assert(el.innerHTML.includes(RETICLE_COLORS[i].hex),
        `colour ${RETICLE_COLORS[i].name} never reached the reticle`);
      cols.add(RETICLE_COLORS[i].hex);
    }
    assert(cols.size === RETICLE_COLORS.length, 'two colours in the palette are the same colour');

    // size: a real span, in both directions, and clamped rather than absurd
    applyReticle(el, { ...DEFAULT_SETTINGS, reticleSize: 0.5 });
    const small = parseFloat(el.style.width);
    applyReticle(el, { ...DEFAULT_SETTINGS, reticleSize: 2.2 });
    const big = parseFloat(el.style.width);
    assert(big / small > 4, `the size slider only spans ${(big / small).toFixed(2)}×`);
    applyReticle(el, { ...DEFAULT_SETTINGS, reticleSize: 900 });
    assert(parseFloat(el.style.width) <= RETICLE_BASE * 2.4, 'the size is not clamped');
    applyReticle(el, { ...DEFAULT_SETTINGS, reticleSize: NaN });
    assert(parseFloat(el.style.width) === RETICLE_BASE, 'a NaN size did not fall back to 100%');

    // an index off the end of a table is somebody's shape, not a crash
    assert(shapeAt(-1).id && shapeAt(1e6).id && colorAt(NaN).hex, 'a bad index has no answer');
    return `${RETICLE_SHAPES.length} shapes, ${RETICLE_COLORS.length} colours, `
      + `${small}→${big}px (${(big / small).toFixed(1)}×), clamped and NaN-safe`;
  });

  check('hud: the reticle repaints when it changes and not otherwise', () => {
    // It is painted from HUD.update, which runs sixty times a second. Rewriting
    // innerHTML at that rate is a full SVG reparse per frame for a picture that
    // changes when a slider moves.
    const el = node('svg');
    let writes = 0;
    let html = '';
    Object.defineProperty(el, 'innerHTML', {
      get: () => html, set: (v) => { writes++; html = v; }, configurable: true,
    });
    const s = { ...DEFAULT_SETTINGS };
    for (let f = 0; f < 120; f++) applyReticle(el, s);
    assert(writes === 1, `120 frames of an unchanged reticle cost ${writes} repaints`);
    s.reticleColor = 3;
    applyReticle(el, s);
    assert(writes === 2, 'moving the colour slider did not repaint');
    s.reticleSize = 1.4;
    applyReticle(el, s);
    assert(writes === 3, 'moving the size slider did not repaint');
    s.reticleShape = 2;
    applyReticle(el, s);
    assert(writes === 4, 'moving the shape slider did not repaint');
    return `120 idle frames → 1 paint; each of the three sliders → 1 more (${writes} total)`;
  });

  check('hud: a custom colour cannot hide the threat state', async () => {
    /**
     * THE TRAP, as a property of the stylesheet.
     *
     * The colour arrives as an SVG presentation attribute, and a stylesheet
     * rule beats a presentation attribute. So a `stroke:` left on the base
     * `.ret-ring` rule pins every player to white for ever while the slider
     * moves, the value saves and the reader runs — nothing fails, and the
     * feature is dead. The same precedence is what keeps `.hot` working, which
     * is why the answer is not "stop using CSS" but "the base rules carry
     * geometry and the state rules carry colour".
     */
    const css = await read('styles.css');
    const rule = (sel) => {
      const i = css.indexOf(`\n${sel}{`);
      if (i < 0) return null;
      return css.slice(i + sel.length + 2, css.indexOf('}', i));
    };
    for (const sel of ['.ret-ring', '.ret-tick']) {
      const body = rule(sel);
      assert(body !== null, `${sel} is gone from styles.css`);
      assert(!/(^|;)\s*stroke\s*:/.test(body),
        `${sel} sets a stroke colour in CSS, which beats the attribute — the Colour slider is dead: {${body}}`);
      assert(!/(^|;)\s*fill\s*:\s*(?!none)/.test(body), `${sel} sets a fill colour in CSS`);
    }
    const dot = rule('.ret-dot');
    assert(dot === null || !/fill\s*:/.test(dot), 'the reticle dot has its fill pinned in CSS');
    // …and the danger state is still a stylesheet rule, so it still wins
    for (const sel of ['#reticle.hot .ret-ring', '#reticle.hot .ret-tick', '#reticle.hot .ret-dot']) {
      assert(css.includes(sel), `${sel} is gone — a chosen colour would now hide an enemy at five metres`);
    }
    assert(/#reticle\.hot \.ret-ring\{[^}]*var\(--danger\)/.test(css),
      'the hot reticle is no longer the danger colour');
    // and the HUD still puts the class on
    const hud = await read('src/ui/HUD.js');
    assert(/reticle\.classList\.toggle\('hot'/.test(hud), 'the HUD stopped marking the reticle hot');
    return 'base rules carry geometry only; .hot carries --danger and still wins over the attribute';
  });

  check('hud: the options preview and the reticle are painted by the same code', async () => {
    // Two copies of a shape table is how the preview and the thing on screen
    // end up disagreeing, and the preview is the only reason to have a second
    // one. There is one painter and the menu imports it.
    const menu = await read('src/ui/Menu.js');
    assert(/import \{[^}]*applyReticle[^}]*\} from '\.\/HUD\.js'/.test(menu),
      'Menu.js no longer borrows the HUD\'s reticle painter');
    assert(!/RETICLE_SHAPES = \[/.test(menu), 'Menu.js has grown its own copy of the shape table');
    assert(/applyReticle\(document\.getElementById\('ret-demo'\)/.test(menu),
      'the options preview is not painted from the settings');
    assert(/applyReticle\(document\.getElementById\('reticle'\)/.test(menu),
      'moving a reticle slider does not repaint the reticle itself — on the pause card, '
      + 'where HUD.update is not running, the change would not appear until the player resumed');
    // and the sliders' range comes from the tables rather than from the markup
    assert(/cap\('opt-voice', PLAYER_VOICES\.length\)/.test(menu),
      'the voice slider\'s range is typed rather than derived — a sixth voice would be unreachable');
    assert(/cap\('opt-ret-shape', RETICLE_SHAPES\.length\)/.test(menu),
      'the shape slider\'s range is typed rather than derived');
    assert(/cap\('opt-ret-color', RETICLE_COLORS\.length\)/.test(menu),
      'the colour slider\'s range is typed rather than derived');
    return 'one painter, one shape table, ranges derived from the tables';
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE PROMISES
   * ──────────────────────────────────────────────────────────────────── */

  check('hud: everything a player can now hear or see has a switch, a reader and a control', async () => {
    /**
     * controls.mjs already proves that EVERY key of DEFAULT_SETTINGS has a
     * reader and a control. What it cannot know is which keys were promised, so
     * dropping one of these nine would leave that check perfectly green and the
     * feature half gone. This names them.
     */
    const PROMISED = {
      voiceIndex: 'opt-voice', voiceLevel: 'opt-voicelevel', voiceLines: 'opt-voicelines',
      enemyVoices: 'opt-enemyvoices', enemyBody: 'opt-enemybody', popups: 'opt-popups',
      reticleShape: 'opt-ret-shape', reticleSize: 'opt-ret-size', reticleColor: 'opt-ret-color',
    };
    const html = await read('index.html');
    const menu = await read('src/ui/Menu.js');
    const bound = new Map([...menu.matchAll(/_(?:slider|check)\('(opt-[a-z0-9-]+)',\s*'([A-Za-z0-9_]+)'/g)]
      .map(m => [m[2], m[1]]));
    for (const [key, id] of Object.entries(PROMISED)) {
      assert(key in DEFAULT_SETTINGS, `${key} is no longer a setting — it cannot persist`);
      assert(key in SETTING_READERS, `${key} has no declared reader`);
      assert(html.includes(`id="${id}"`), `#${id} is not on the options screen`);
      assert(bound.get(key) === id,
        `${key} is bound to ${bound.get(key) || 'nothing'}, expected #${id} — `
        + '_slider and _check both return SILENTLY when the id is wrong');
    }
    // the three index sliders must step in whole entries, or a player lands
    // between two voices and gets whichever one Math.round picks
    for (const id of ['opt-voice', 'opt-ret-shape', 'opt-ret-color']) {
      const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
      assert(tag, `#${id} is not an <input>`);
      assert(/step="1"/.test(tag[0]), `#${id} does not step in whole entries: ${tag[0]}`);
    }
    // the voice mixer has to reach zero, because "off" is a thing a player asks
    const mix = html.match(/<input[^>]*id="opt-voicelevel"[^>]*>/);
    assert(mix && /min="0"/.test(mix[0]), 'the voice mixer cannot be turned all the way off');
    assert(PLAYER_VOICES.length >= 4, `only ${PLAYER_VOICES.length} voices ship`);
    return `${Object.keys(PROMISED).length} settings, each with a default, a reader and a live control; `
      + `${PLAYER_VOICES.length} voices, ${RETICLE_SHAPES.length} shapes, ${RETICLE_COLORS.length} colours`;
  });

  check('hud: the feed sits in the score column, not over the game', async () => {
    // The layout promise, as markup and as CSS. An event feed that drifts into
    // the centre of the screen is competing with HUD.message() and the wave
    // director for the same space, which is how a HUD stops being readable.
    const html = await read('index.html');
    const css = await read('styles.css');
    const tr = html.slice(html.indexOf('<div class="hud-tr">'), html.indexOf('<div class="hud-bl">'));
    assert(tr.includes('id="event-feed"'),
      'the event feed has left the top-right HUD block — it is now floating on its own');
    assert(tr.indexOf('id="hud-score"') < tr.indexOf('id="event-feed"'),
      'the feed is above the score rather than under it');
    const rule = css.slice(css.indexOf('#event-feed{'), css.indexOf('}', css.indexOf('#event-feed{')));
    assert(rule.length > 10, '#event-feed has no styles at all');
    assert(!/position\s*:\s*(fixed|absolute)/.test(rule),
      'the feed is positioned out of the HUD block it lives in — that is a bolted-on overlay');
    assert(/align-items\s*:\s*flex-end/.test(rule), 'the feed is not right-aligned with the score column');
    assert(/var\(--mono\)/.test(css.slice(css.indexOf('#event-feed .ev b'), css.indexOf('#event-feed .ev b') + 200)),
      'the feed is not in the HUD\'s mono face');

    /**
     * …and it cannot be drawn THROUGH the kill feed.
     *
     * That was the real collision: #killfeed sat at `position:absolute;
     * top:120px`, and the score column now reaches well past 120 px, so a
     * four-rung streak would have been painted straight over "Jedi cut down a
     * B1". Both lists are in the same flow now, which is a property that can be
     * checked rather than a margin that happens to be big enough today.
     */
    assert(tr.includes('id="killfeed"'), 'the kill feed left the score column');
    assert(tr.indexOf('id="event-feed"') < tr.indexOf('id="killfeed"'),
      'the kill feed is above the event feed');
    const kf = css.slice(css.indexOf('#killfeed{'), css.indexOf('}', css.indexOf('#killfeed{')));
    assert(!/position\s*:\s*absolute/.test(kf),
      'the kill feed is absolutely positioned again — it will be drawn through the event feed');
    return 'inside .hud-tr, under the score, above the kill feed, all in one flow, HUD mono';
  });

  check('hud: the power wheel prints the key that is actually bound', async () => {
    /**
     * THE BUG. `_buildPowers` carried five typed letters:
     *
     *     [['push','F'],['pull','⇧F'],['grip','G'],['throw','R'],['sense','C']]
     *
     * Two were wrong on a fresh install. Pull is bound to KeyR and throw to
     * KeyH — so the wheel told the player "R" for Throw / recall saber, and
     * pressing R Force-pulled instead. And none of the five followed a rebind,
     * ever, because the list was built once from the constructor. The wheel is
     * on screen for the whole fight.
     *
     * This drives the real HUD against the real bindings table rather than
     * re-deriving the labels, so it fails on any slot whose action id is wrong
     * as well as on a typed letter.
     */
    /* Comments stripped first: the note in `_buildPowers` quotes the old table
     * verbatim so the next reader can see what was wrong, and a scan that
     * cannot tell the record of a bug from the bug would make explaining the
     * fix impossible. Same treatment as the World quality-ladder scan. */
    const src = (await readFile(new URL('../../src/ui/HUD.js', import.meta.url), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(!/\[\s*'push'\s*,\s*'F'\s*\]/.test(src),
      'the power wheel types its key letters again');

    const b = defaultBindings();
    const bench = hudOn();
    const hud = bench.hud;
    hud.setBindings(b);
    const rows = [];
    for (const [slot, action] of POWERS) {
      assert(b[action], `the wheel's ${slot} slot reads action "${action}", which is not in the bindings table`);
      const el = hud.powerEls[slot];
      assert(el && el.label, `the wheel has no ${slot} slot`);
      const want = keyLabel(b[action][0]);
      assert(el.label.textContent === want,
        `the wheel prints "${el.label.textContent}" for ${slot} and ${action} is bound to "${want}"`);
      rows.push(`${slot} ${want}`);
    }

    // …and it follows a rebind, which is the half a one-shot build cannot do.
    const moved = { ...b, throw: ['KeyP'] };
    hud.setBindings(moved);
    assert(hud.powerEls.throw.label.textContent === keyLabel('KeyP'),
      'rebinding throw did not repaint the wheel');
    hud.setBindings(b);

    // every slot with a cooldown in Player.cooldowns should be ON the wheel:
    // six of them had no readout anywhere before this.
    assert(POWERS.length >= 9,
      `the wheel has ${POWERS.length} slots — the powers with real cooldowns and no readout are the `
      + 'ones a player learns by pressing the key and getting nothing');
    bench.restore();
    return `${POWERS.length} slots, every label from the bindings table: ${rows.join(', ')}`;
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE WAVE COUNTER, AND THE POWER WHEEL'S NUMBERS
   * ──────────────────────────────────────────────────────────────────── */

  check('hud: the counter says WAVE again after a Training run', () => {
    // One Training deploy used to rename it for the rest of the session: the
    // training branch wrote 'LESSON ' into the text node in front of the number
    // and the else branch never wrote anything back, against a HUD that is a
    // module-scope singleton built once from markup that is never rebuilt. Pick
    // Training, deploy, Abandon, deploy Trial of Waves — 'LESSON 7'.
    const { hud, doc, restore } = hudOnPage(INDEX);
    try {
      const world = stubWorld({ ...DEFAULT_SETTINGS });
      world.director.state = () => ({ need: 4, progress: 1 });
      world.director.wave = 3;
      const p = player();
      const cam = new THREE.PerspectiveCamera();
      const line = () => doc.getElementById('hud-wave').parentElement.textContent.trim();
      hud.update(1 / 60, world, p, cam);
      const before = line();
      world.training = true;
      hud.update(1 / 60, world, p, cam);
      const during = line();
      world.training = false;
      hud.update(1 / 60, world, p, cam);
      const after = line();
      assert(before === 'WAVE 3', `a fresh HUD reads "${before}"`);
      assert(during === 'LESSON 3', `a Training run reads "${during}"`);
      assert(after === 'WAVE 3', `after Training, the counter still reads "${after}" — for the whole session`);
      // and the word is an element, not a text node found by position
      assert(doc.getElementById('hud-wave-word'), 'the word has no element of its own again');
      return `${before} → ${during} → ${after}`;
    } finally { restore(); }
  });

  check('hud: every cooldown shutter is the fraction of ITS OWN cooldown', () => {
    /**
     * The wheel used to divide by a constant typed into HUD.update, and four of
     * the nine were wrong: lightning divided by 0.35 against a real 1.5 s,
     * stasis by 0.8 against 1.4, heal by 8 against 9, compel by 6 against 7.
     * Since the shutter clamps at 1, Force Lightning read "just used" for 1.15 s
     * of its 1.5 s wait and then emptied in 0.35 s.
     *
     * The cooldowns are read out of Player.js rather than typed here, so this
     * fails if either side moves — and the assertion is on the BAR, not on a
     * constant, so it also fails if the HUD goes back to dividing.
     */
    const cds = new Map();
    for (const m of PLAYER_SRC.matchAll(/this\.cooldowns\.(\w+)\s*=\s*([^;]+);/g)) {
      const nums = [...m[2].matchAll(/[\d.]+/g)].map(Number).filter(n => n > 0);
      if (!nums.length) continue;
      cds.set(m[1], Math.max(cds.get(m[1]) ?? 0, ...nums));
    }
    assert(cds.size >= 6, `only ${cds.size} cooldowns found in Player.js — this check lost its source`);
    const { hud, restore } = hudOnPage(INDEX);
    try {
      const world = stubWorld({ ...DEFAULT_SETTINGS });
      const p = wheelPlayer(world);
      const cam = new THREE.PerspectiveCamera();
      const shutter = (key) => Number(/scaleY\(([\d.]+)\)/.exec(hud.powerEls[key].cd.style.transform)[1]);
      const rows = [];
      for (const [key] of POWERS) {
        const full = cds.get(key);
        if (full == null) continue;                 // grip and sense have none
        p.cooldowns[key] = 0;
        hud.update(1 / 60, world, p, cam);          // clear any earlier wait
        p.cooldowns[key] = full;
        hud.update(1 / 60, world, p, cam);
        const fired = shutter(key);
        p.cooldowns[key] = full / 2;
        hud.update(1 / 60, world, p, cam);
        const half = shutter(key);
        p.cooldowns[key] = 0;
        hud.update(1 / 60, world, p, cam);
        const done = shutter(key);
        assert(Math.abs(fired - 1) < 1e-6, `${key}: the bar reads ${fired} the moment it is used`);
        assert(Math.abs(half - 0.5) < 1e-6,
          `${key}: ${full / 2}s of a ${full}s cooldown left and the bar reads ${half} — it should read 0.50`);
        assert(done === 0, `${key}: the bar reads ${done} with the power ready`);
        assert(hud.powerEls[key].root.classList.contains('ready'),
          `${key}: the slot is not marked ready with no cooldown and full Force`);
        rows.push(`${key} ${full}s`);
      }
      assert(rows.length >= 6, `only ${rows.length} slots carried a cooldown`);
      return `${rows.length} cooldowns, each half-spent at half the bar: ${rows.join(', ')}`;
    } finally { restore(); }
  });

  check('hud: the wheel prices a power the way the player is charged for it', () => {
    /**
     * Two of the nine gates were the wrong number outright — lightning at 14
     * against a real 30, stasis at 30 against a real 26 — so the wheel said
     * READY and the key answered "30 FORCE NEEDED, YOU HAVE 20", and dimmed a
     * power for four Force it did not need.
     *
     * This used to be nine regular expressions matching each number against
     * the line of Player.js that spends it, which is the best a check can do
     * while the two sides keep separate copies. They do not any more:
     * src/game/Powers.js is a leaf module both import — a leaf because
     * HUD → Player → Menu → HUD is a real cycle — so the assertion moves from
     * "do the copies agree" to "is there still only one copy". A bare literal
     * anywhere in Player's spend path is the defect returning.
     */
    for (const key of Object.keys(POWER_COST)) {
      assert(typeof POWER_COST[key] === 'number' && POWER_COST[key] > 0,
        `POWER_COST.${key} is ${JSON.stringify(POWER_COST[key])}, not a price`);
    }
    assert(Object.keys(POWER_COST).length === POWERS.length,
      `the wheel draws ${POWERS.length} powers and prices ${Object.keys(POWER_COST).length}`);
    for (const key of Object.keys(POWER_COST)) {
      assert(new RegExp(`POWER_COST\\.${key}\\b`).test(PLAYER_SRC),
        `Player.js never names POWER_COST.${key}, so the ${key} price has been typed in again `
        + 'somewhere and the wheel can drift off it');
    }
    /* …and no bare number equal to one of the nine prices survives in a spend
     * or a comparison against the bar. The continuous drains — the air jump's
     * 12, the grip's per-second bite, sundering's 38 — are not wheel powers
     * and are deliberately left alone; this only fires on a price that has
     * been written out longhand next to the table that already holds it. */
    const bare = [];
    const scan = (re, what) => {
      for (const m of PLAYER_SRC.matchAll(re)) {
        const n = Number(m[1]);
        const hit = Object.entries(POWER_COST).find(([, v]) => v === n);
        if (hit) bare.push(`${hit[0]} written as ${what} ${n}`);
      }
    };
    scan(/_(?:can)?[Ss]pend\(\s*(\d+)\s*\)/g, '_spend(');
    scan(/this\.force\s*[<>]=?\s*(\d+)/g, 'this.force <');
    scan(/this\.force\s*-=\s*(\d+)/g, 'this.force -=');
    assert(!bare.length,
      `Player.js prices a power in place — ${bare.join('; ')} — instead of reading Powers.js, which `
      + 'is how the wheel and the key came to disagree in the first place');

    // …and the gate is the player's own, so the two settings that move the
    // price move the wheel with them.
    const { hud, restore } = hudOnPage(INDEX);
    try {
      const world = stubWorld({ ...DEFAULT_SETTINGS });
      const p = wheelPlayer(world);
      const cam = new THREE.PerspectiveCamera();
      const ready = (k) => hud.powerEls[k].root.classList.contains('ready');
      p.force = 27;
      hud.update(1 / 60, world, p, cam);
      assert(ready('stasis'), 'stasis costs 26 and the wheel dims it at 27 Force');
      assert(!ready('heal'), 'heal costs 40 and the wheel offers it at 27 Force');
      assert(!ready('lightning'), 'lightning costs 30 and the wheel offers it at 27 Force');
      // Drain 0 is labelled "unlimited Force" on the Options slider, and
      // Player._spend returns true unconditionally there.
      world.settings.forceDrain = 0;
      p.force = 1;
      p.boonMods.lightning = true;
      hud.update(1 / 60, world, p, cam);
      const dim = ['push', 'pull', 'grip', 'throw', 'sense', 'lightning', 'stasis', 'heal', 'compel']
        .filter((k) => !ready(k));
      assert(!dim.length,
        `with Drain at 0 — the slider labelled "unlimited Force" — the wheel still greys out `
        + `${dim.join(', ')}. Throw, sense and lightning bypassed Player's own economy, so the `
        + 'setting freed six powers and kept charging for three.');
      // A boon that halves the cost is the other direction.
      world.settings.forceDrain = 1;
      p.force = 30;
      p.boonMods.forceCost = 0.5;
      hud.update(1 / 60, world, p, cam);
      assert(ready('heal'), 'a half-price boon does not reach the wheel');
      // …and lightning is a DRAFTED power: without the boon the key refuses.
      p.boonMods.forceCost = 1;
      p.boonMods.lightning = false;
      p.force = 100;
      hud.update(1 / 60, world, p, cam);
      assert(!ready('lightning'), 'the wheel marks Force Lightning ready for a player who never drafted it');
      return 'one price table, no bare literal left in Player; drain 0 frees all nine, and '
        + 'half-price boons and the lightning attunement both reach the wheel';
    } finally { restore(); }
  });

  check('hud: the frame counter cannot paint over the flow meter', async () => {
    /**
     * `#hud-perf` was `position:absolute; top:10; right:12; z-index:6`, under a
     * comment claiming it was "pinned top-right where nothing else in the HUD
     * lives" — and `.hud-tr` (flow meter, combo, score, event feed, kill feed)
     * is at right:34 top:28 with a 168px meter, so anything wider than 22px
     * lands in that band. HUD.perf writes four fixed-format lines of about 20
     * monospace glyphs at 11px, so the box is ~160px wide by construction.
     *
     * The fix is structural, so the check is structural: in the flow of the
     * column it cannot overlap whatever the box turns out to measure. If it
     * ever goes back to being positioned, the geometry has to be argued again —
     * and this fails until it is.
     */
    const css = await readFile(new URL('../../styles.css', import.meta.url), 'utf8');
    const rule = css.match(/#hud-perf\s*\{([^}]*)\}/);
    assert(rule, '#hud-perf has no rule');
    const pos = (rule[1].match(/position:\s*(\w+)/) || [])[1];
    assert(pos !== 'absolute' && pos !== 'fixed',
      `#hud-perf is ${pos} again — a positioned box over .hud-tr has to prove it misses the meter`);
    assert(!/z-index/.test(rule[1]), '#hud-perf still lifts itself over the column it sits in');
    // and it is IN that column, so it displaces rather than covers
    const { doc, restore } = hudOnPage(INDEX);
    try {
      const perf = doc.getElementById('hud-perf');
      assert(perf, '#hud-perf is gone');
      assert(perf.parentElement?.classList.contains('hud-tr'),
        `#hud-perf hangs off <${perf.parentElement?.localName} class="${perf.parentElement?.className}"> instead of the column it overlapped`);
      const column = perf.parentElement.children;
      assert(column[0] === perf, 'the readout is not the first block in the column, so it pushes half of it');
      assert(perf.classList.contains('hidden'), 'the frame counter starts visible');
      return `#hud-perf: ${pos}, first child of .hud-tr, ${column.length - 1} blocks below it`;
    } finally { restore(); }
  });
}
