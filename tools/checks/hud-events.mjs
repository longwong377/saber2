/**
 * BATTLEFRONT BORZ — the two things the HUD gained, and the promise attached to each.
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
import { HUD, POWERS, POWER_COST, POWER_BOON, applyReticle, shapeAt, colorAt, RETICLE_SHAPES, RETICLE_COLORS, RETICLE_BASE,
  Minimap, MINIMAP, MINIMAP_COLORS, hostilesLeft, rosterHtml } from '../../src/ui/HUD.js';
import { Player } from '../../src/game/Player.js';
import { makeDocument } from './_page.mjs';
import { DEFAULT_SETTINGS, SETTING_READERS, Menu } from '../../src/ui/Menu.js';
import { PLAYER_VOICES } from '../../src/engine/Voice.js';
import { defaultBindings, keyLabel, ORDER_ACTIONS } from '../../src/engine/Bindings.js';
import { Stratagems, STRATAGEMS } from '../../src/game/Stratagems.js';
// The two tables the roster panel draws WITH. Imported here for the same
// reason the HUD imports them: a rank colour or an army name typed into a
// check is a third copy of a table that already has two readers.
import { RANKS, ARMIES, CommandRoster } from '../../src/game/Command.js';
import { OPEN_STATES, openState, openMul } from '../../src/game/Combat.js';
/* The ONE statement of "does this body belong to the other side", so the check
 * asks it the same way the HUD now does instead of writing a fourth copy. */
import { WaveDirector } from '../../src/game/Waves.js';

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
  /* Read here rather than inside a check: `hudOnPage` installs a global
   * document and the note on it explains that the window between install and
   * restore must not straddle an await, because the runner starts the next
   * check the moment this one suspends. A suite-level read costs nothing and
   * keeps every check that drives a real page synchronous. */
  const STYLES = await readFile(new URL('../../styles.css', import.meta.url), 'utf8');

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

  check('hud: every writer that can carry a PEER NAME escapes it', () => {
    /**
     * A CO-OP NAME IS ATTACKER-CONTROLLED MARKUP UNTIL IT IS ESCAPED.
     *
     * `Net.js` reads a remote's name off their own `{t:'hello', name}` — no
     * cap, no sanitisation — and `main.js` puts it straight into
     * `world.notify('A JEDI HAS FALLEN AWAY', `${r.name} left the fight`)`,
     * which lands in `HUD.message`. That method wrote its template raw while
     * `popup` and `killFeed` one screen away both escaped: a name of
     * `<img src=/nope onerror=…>` parsed into the live DOM with its handler
     * attached and the browser fetched the URL.
     *
     * Driven on a document that PARSES innerHTML rather than storing it, so
     * the question asked is "is there an element" and not "is there a
     * substring" — a check that greps for `<img` passes against a page that
     * built the node. Every writer that can receive a name is driven, because
     * the defect was one method being missed when its neighbour was fixed.
     */
    const { hud, doc, restore } = hudOnPage(INDEX);
    try {
      const HOSTILE = '<img src="/nope" onerror="globalThis.__pwned = 1">';
      /**
       * COUNTED AS A DELTA, AND IT USED TO BE COUNTED ABSOLUTELY.
       *
       * `querySelectorAll('img')` over the whole document was right while the
       * page contained no images at all — every asset in this product is
       * generated in code, so any `<img>` had to be one the attack built. That
       * stopped being true the moment the front end started loading the
       * player's own logo file: index.html now carries three legitimate
       * `<img class="wordmark">`, on the boot screen, the menu and the loading
       * screen, and the check reported them as three successful injections.
       *
       * A red result that names a real file as an attack is worse than no
       * check, because the next reader deletes the check. The question was
       * always "did these three calls BUILD anything", so it is asked that way:
       * the count before, the count after, and the difference.
       */
      const before = doc.documentElement.querySelectorAll('img').length;
      hud.popupsOn = true;
      hud.message('A JEDI HAS FALLEN AWAY', `${HOSTILE} left the fight`);
      hud.popup('A JEDI HAS FALLEN AWAY', `${HOSTILE} left the fight`, 'event');
      hud.killFeed(HOSTILE, 'a droideka', 'cut');
      const injected = doc.documentElement.querySelectorAll('img').length - before;
      assert(injected === 0,
        `${injected} element(s) were parsed out of a peer's name — `
        + 'a remote machine is writing markup into this page');
      // and the name still has to READ, so the text must survive the escaping
      assert(hud.el.center.textContent.includes('left the fight'),
        'the banner escaped the name into nothing');
      return `3 name-bearing writers × a hostile name → 0 elements built, text intact`;
    } finally { restore(); }
  });

  check('hud: the support-call panel is the STRATAGEMS table and not a copy of it', () => {
    /**
     * A CODE SYSTEM WITH NO READOUT IS A MANUAL YOU KEEP BESIDE THE KEYBOARD.
     * The panel is the whole of this mechanic's discoverability, so what it
     * has to be is a live view of the real table — every call still consistent
     * with what has been typed, in the order the table declares them, priced,
     * with the letters already matched lit.
     *
     * Driven by REBINDING the table rather than by reading the markup: a row
     * added to `STRATAGEMS` has to appear on the panel by itself, and the only
     * way to assert that is to look for a call this file never names.
     */
    const { hud, root, restore } = hudOn();
    try {
      const host = root.getElementById('stratagem');
      assert(hud.el.stratagem === host, 'the HUD no longer looks up #stratagem');
      const p = player();
      p.world = { command: null };
      p.stratagems = new Stratagems(p);
      p.force = 400;

      // key up: nothing on screen at all
      hud._stratagemPanel(p);
      assert(!host.innerHTML, 'the panel is painted with the comm key up');

      /**
       * KEY DOWN: THE FIRST TEN THE TABLE OFFERS, AND A COUNT OF THE REST.
       *
       * It used to be all of them, and that was right when the table was seven
       * rows. It is eighteen now, of which fifteen are offered to a lone Jedi,
       * and fifteen rows at this size is 430 px of list down the left of the
       * screen at the one moment the player has typed nothing and the panel is
       * at its longest — see `_stratagemPanel`'s own note on the cap. What has
       * to hold is unchanged and is asserted the same way: the panel is a VIEW
       * of the table, in the table's own order, and a row added to
       * `STRATAGEMS` appears on it without this file naming the row.
       */
      p.stratagems.setArming(true);
      hud._stratagemPanel(p);
      const solo = STRATAGEMS.filter((s) => !s.commandOnly);
      const CAP = 10;
      for (const s of solo.slice(0, CAP)) {
        assert(host.innerHTML.includes(s.name), `${s.id} is in the table and not on the panel`);
      }
      if (solo.length > CAP) {
        assert(new RegExp(`\\+${solo.length - CAP} more`).test(host.innerHTML),
          `${solo.length} calls are offered, ${CAP} are shown, and the panel does not say that `
          + `${solo.length - CAP} of them are missing — a list that silently truncates is worse `
          + 'than a long one');
      }
      for (const s of STRATAGEMS.filter((s) => s.commandOnly)) {
        assert(!host.innerHTML.includes(s.name),
          `${s.id} needs an army and is offered to a lone Jedi`);
      }

      // one letter: the panel narrows to what is still spellable, and says so
      const pick = solo[0];
      p.stratagems.feed(pick.code[0], { world: p.world });
      hud._stratagemPanel(p);
      const still = solo.filter((s) => s.code.startsWith(pick.code[0]));
      const gone = solo.filter((s) => !s.code.startsWith(pick.code[0]));
      assert(gone.length, 'every call starts with the same letter — this clause measures nothing');
      for (const s of gone) {
        assert(!host.innerHTML.includes(s.name),
          `${s.id} cannot be spelled from "${pick.code[0]}" and is still on the panel`);
      }
      assert(host.innerHTML.includes(still[0].name), 'the panel dropped a call that is still live');
      const lit = (host.innerHTML.match(/class="sg-d on"/g) || []).length;
      /* ONE LIT LETTER PER ROW ON SCREEN. The cap applies here too — with
       * eighteen rows a single opening direction can still leave more than ten
       * live — so the expectation is the shown count and not the live one. */
      const shown = Math.min(still.length, CAP);
      assert(lit === shown,
        `${lit} letters are lit across ${shown} rows on screen — one per row is how far in you are`);
      /* AND EXACTLY ONE ARROW IS MARKED AS THE NEXT ONE TO PRESS. The codes
       * are dealt per run, so nobody enters one from memory and the panel has
       * to be an instruction rather than a reference — but marking the next
       * arrow of every candidate at once would be several instructions and no
       * answer, so it belongs to the leading row alone. */
      const nxt = (host.innerHTML.match(/class="sg-d next"/g) || []).length;
      assert(nxt === 1,
        `${nxt} arrows are marked as the next press — the panel is either not telling the `
        + 'player what to do or telling them several things at once');

      // a call you cannot afford is greyed, not hidden: a list that reordered
      // itself as the Force came back would be unreadable
      p.stratagems.entry = '';
      p.force = 0;
      hud._stratagemPanel(p);
      for (const s of solo.slice(0, CAP)) {
        assert(host.innerHTML.includes(s.name), `${s.id} vanished when the purse emptied`);
      }
      assert((host.innerHTML.match(/sg-row off/g) || []).length >= Math.min(solo.length, CAP),
        'nothing is greyed with no Force at all');
      return `${solo.length} calls offered solo, ${Math.min(solo.length, CAP)} on screen with the `
        + `rest counted, ${gone.length} dropped by one letter, ${lit} matched letters lit, `
        + 'all greyed at 0 Force';
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
   * THE MAP, WHICH IS NOW SOMETHING YOU SPEND FORCE ON
   * ──────────────────────────────────────────────────────────────────── */

  check('hud: the minimap is a Force reading, and always-on is the accessibility answer', async () => {
    /**
     * "Bringing up the minimap should maybe use some force like you're using
     * force sense you know what I mean?" The map was permanently on and free.
     * It rides Force sense now — the power that already costs to open, drains
     * 22 Force a second while it is held and blocks regeneration — so this
     * measures three things and nothing else: that the reading follows
     * `senseActive`, that it LINGERS rather than blinking out, and that the
     * always-on behaviour is still one box away.
     *
     * Driven through the shipped Minimap with a counting canvas, because "it
     * costs nothing while it is cold" is a claim about operations issued.
     */
    const ops = { n: 0 };
    const g = new Proxy({}, { get: () => (() => { ops.n++; }) });
    const canvas = { width: 0, height: 0, style: {}, classes: new Set(),
      classList: { toggle(c, on) { const w = on === undefined ? !canvas.classes.has(c) : !!on;
        if (w) canvas.classes.add(c); else canvas.classes.delete(c); return w; },
      contains: (c) => canvas.classes.has(c) },
      getContext: () => g };
    const map = new Minimap(canvas);
    const me = player();
    const world = { enemies: [{ position: new THREE.Vector3(4, 0, 4), dead: false }], players: [] };
    const s = { ...DEFAULT_SETTINGS };
    assert(s.minimapSense === true, 'the map ships free again — the note asks for it to cost something');

    // COLD: the power is off, so there is no reading and nothing is drawn.
    for (let i = 0; i < 60; i++) map.update(1 / 60, world, me, s);
    assert(map.repaints === 0, `${map.repaints} repaints with Force sense off — the map is still free`);
    assert(canvas.classes.has('hidden'), 'a map nobody is paying for is still in the layout');
    assert(ops.n === 0, `${ops.n} canvas operations for a map that is not being read`);

    // SENSING: it lights, and it is the same map it always was.
    me.senseActive = true;
    for (let i = 0; i < 60; i++) map.update(1 / 60, world, me, s);
    const lit = map.repaints;
    assert(lit >= 15, `${lit} repaints in a second of Force sense against a declared ${MINIMAP.hz} Hz`);
    assert(!canvas.classes.has('hidden'), 'the map stayed hidden while the Force was on it');
    assert(map.read === 1, `the reading is ${map.read} while the power is open`);

    // A PULSE: let go, and the reading fades over MINIMAP.linger rather than
    // vanishing on the frame boundary — a map that blinks out reads as a bug.
    me.senseActive = false;
    let mid = 0;
    for (let i = 0; i < Math.round(MINIMAP.linger * 60) - 12; i++) {
      map.update(1 / 60, world, me, s);
      if (i === 30) mid = map.read;
    }
    assert(mid > 0.2 && mid < 0.95, `half a second after the power closed the reading is ${mid.toFixed(2)}`);
    assert(map.repaints > lit, 'the map stopped repainting the moment the power closed — there is no linger');
    assert(map.read > 0, 'the reading was already cold before the linger was up');
    assert(canvas.style.opacity && Number(canvas.style.opacity) < 1,
      `the map is at full opacity ${canvas.style.opacity || 1} while its reading is fading out`);
    const cooled = map.repaints;
    for (let i = 0; i < 60; i++) map.update(1 / 60, world, me, s);
    assert(map.read === 0, `the reading never reached zero: ${map.read}`);
    const after = map.repaints;
    for (let i = 0; i < 60; i++) map.update(1 / 60, world, me, s);
    assert(map.repaints === after, 'a cold map is still repainting');
    assert(after > cooled, 'the linger drew nothing at all, so it is a delay rather than a reading');

    // THE ACCESSIBILITY ANSWER: one box, and the map is the permanent window
    // that shipped — with no Force spent and none required.
    const free = { ...DEFAULT_SETTINGS, minimapSense: false };
    const was = map.repaints;
    for (let i = 0; i < 60; i++) map.update(1 / 60, world, me, free);
    assert(map.repaints - was >= 15, 'unticking the Force gate did not give the always-on map back');
    assert(!canvas.classes.has('hidden'), 'the always-on map is hidden');
    // …and the master switch still wins over both.
    const off = { ...DEFAULT_SETTINGS, minimap: false, minimapSense: false };
    const held = map.repaints;
    for (let i = 0; i < 60; i++) map.update(1 / 60, world, me, off);
    assert(map.repaints === held, 'the Minimap box no longer switches the map off');

    // The setting is real, declared and controlled — the same three
    // requirements every other switch on this screen answers.
    assert('minimapSense' in DEFAULT_SETTINGS, 'minimapSense cannot be remembered between runs');
    assert(SETTING_READERS.minimapSense?.[0] === 'ui/HUD.js', 'minimapSense declares no reader in the HUD');
    const menu = await read('src/ui/Menu.js');
    assert(/_check\('opt-minimap-sense',\s*'minimapSense'/.test(menu), 'no control writes minimapSense');
    assert(INDEX.includes('id="opt-minimap-sense"'), '#opt-minimap-sense is not on the options screen');
    // and the HUD prints the key that is bound to the power, not a typed one
    const { hud, restore } = hudOnPage(INDEX);
    try {
      const b = defaultBindings();
      b.sense = ['F13'];
      hud.setBindings(b);
      const legend = hud.el.mapKey?.innerHTML || '';
      assert(/F13/.test(legend), `the map's legend says "${legend}" with sense rebound to F13`);
      assert(new RegExp(`${Math.round(POWER_COST.sense)}`).test(legend),
        `the legend does not price the power: "${legend}"`);
    } finally { restore(); }
    return `cold 0 repaints · sensing ${lit} in a second · ${MINIMAP.linger}s linger fading to `
      + `${canvas.style.opacity || 1} · always-on still one box away`;
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

  check('hud: what the blade is being paid extra for is on the screen', () => {
    /**
     * `Combat.openness()` pays a cut 3× through a body you are holding, 2×
     * through one still being yanked and 1.5× through one that is down. The
     * comment on it says it exists "to make pull→cut read as ONE MOVE instead
     * of two" — and that cannot happen while the second half is invisible,
     * which it was: the strongest damage multiplier in the game was unsignposted
     * from the day it was written. `claims.mjs` already holds the table against
     * `openness`; nothing held that anything DRAWS it.
     *
     * Every string and every number here is read off Combat.js. Typing "3× CUT"
     * into this check would make it the eighth hand-maintained table in this
     * repo to drift from its generated twin — and this one would pass while the
     * HUD quoted a multiplier the blade was not being paid.
     */
    /* WHERE IT SITS, held to the same promise the event feed is: in the score
     * column, in flow, right-aligned — not a box floated over the game. The
     * alignment is asserted because `.hud-tr` is `text-align:right` and a FLEX
     * container's children do not inherit that, so this row is the one element
     * in the column that has to say so for itself. */
    const tr = INDEX.slice(INDEX.indexOf('<div class="hud-tr">'), INDEX.indexOf('<div class="hud-bl">'));
    assert(tr.includes('id="target-open"'),
      'the open-state readout is not in the top-right HUD block — it is floating on its own');
    assert(tr.indexOf('id="hud-score"') < tr.indexOf('id="target-open"'),
      'the readout is above the score rather than under it');
    const rule = STYLES.slice(STYLES.indexOf('.targetopen{'), STYLES.indexOf('}', STYLES.indexOf('.targetopen{')));
    assert(rule.length > 10, '.targetopen has no styles at all');
    assert(!/position\s*:\s*(fixed|absolute)/.test(rule),
      'the readout is positioned out of the HUD block it lives in — that is a bolted-on overlay');
    assert(/justify-content\s*:\s*flex-end/.test(rule),
      'the readout is a flex row that never says to right-align, so it sits left of the column it is in');

    const { hud, doc, restore } = hudOnPage(INDEX);
    try {
      const world = stubWorld({ ...DEFAULT_SETTINGS });
      world.director.state = () => ({ need: 4, progress: 1 });
      const p = player();
      const cam = new THREE.PerspectiveCamera();
      const foe = {
        dead: false, gripped: false, yankT: 0, toppled: false, stunTimer: 0,
        hp: 60, maxHp: 60, position: new THREE.Vector3(3, 0, 0), A: { label: 'PROBE' },
      };
      world.enemies = [foe];
      const el = doc.getElementById('target-open');
      assert(el, "the HUD has no element for the target's open state");

      hud.update(1 / 60, world, p, cam);
      assert(el.classList.contains('hidden'), 'an ordinary body is announced as open');

      /* Into each state in turn, through the table's OWN test — so a state
       * added to Combat.js without a way to reach it fails here rather than
       * being silently skipped. */
      const seen = [];
      for (const s of OPEN_STATES) {
        Object.assign(foe, { gripped: false, yankT: 0, toppled: false, stunTimer: 0 });
        /* `hold()` when the fixture is a real body — a hold is a LEASE now
         * (see Enemy.hold) — and the flag itself when it is the stub this
         * check builds, which has no clock to expire one. */
        if (s.key === 'held') { if (foe.hold) foe.hold(); else foe.gripped = true; }
        else if (s.key === 'yanked') foe.yankT = 0.4;
        else if (s.key === 'downed') foe.toppled = true;
        assert(openState(foe) === s,
          `no way to put a body into the ${s.key} state from this check — the state is undrawable and untested`);
        hud.update(1 / 60, world, p, cam);
        assert(!el.classList.contains('hidden'), `a ${s.key} body draws nothing`);
        assert(el.firstChild.textContent === s.label,
          `${s.key} reads "${el.firstChild.textContent}" against the table's "${s.label}"`);
        assert(el.lastChild.textContent === `${openMul(s, foe)}× CUT`,
          `${s.key} quotes "${el.lastChild.textContent}" against the ${openMul(s, foe)}× it is actually paid`);
        seen.push(`${s.label} ${openMul(s, foe)}×`);
      }

      /* A BOSS TAKES A QUARTER of the held and yanked bonuses, which is the
       * half a readout is most likely to get wrong: printing `state.mul`
       * passes every assertion above and overstates at a boss by exactly the
       * factor the design intends. */
      Object.assign(foe, { gripped: true, yankT: 0, toppled: false, stunTimer: 0, A: { label: 'PROBE', boss: true } });
      hud.update(1 / 60, world, p, cam);
      const held = OPEN_STATES.find(s => s.key === 'held');
      assert(openMul(held, foe) !== held.mul,
        'a boss now takes the full held bonus, so this half of the check proves nothing');
      assert(el.lastChild.textContent === `${openMul(held, foe)}× CUT`,
        `a boss is advertised at "${el.lastChild.textContent}" and cut for ${openMul(held, foe)}×`);
      const bossHeld = openMul(held, foe);

      Object.assign(foe, { gripped: false, A: { label: 'PROBE' } });
      hud.update(1 / 60, world, p, cam);
      assert(el.classList.contains('hidden'), 'the readout never clears — it names a state the body has left');
      return `${seen.join(', ')}; boss held ${bossHeld}×`;
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
        /* …and READY means affordable AND granted. A boon-gated power with a
         * clear cooldown and a full bar is still not ready if the player never
         * drew the card, which is the whole of the Domination defect: the wheel
         * lit it from the first frame of a first run and pressing it answered
         * "not attuned". POWER_BOON is the one list of those gates — asserted
         * against it rather than against a name typed here. */
        const gated = POWER_BOON[key] && !p.boonMods[POWER_BOON[key]];
        assert(hud.powerEls[key].root.classList.contains('ready') === !gated,
          gated
            ? `${key}: the slot is marked ready for a player who has never been granted it`
            : `${key}: the slot is not marked ready with no cooldown and full Force`);
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
      /* EVERY boon gate, not the one that used to be the only one. Unlimited
       * Force is an economy setting; a power the player has never been granted
       * is not an economy question, and leaving compel ungranted here would
       * make this assertion fail for the right reason and read like the wrong
       * one. POWER_BOON is the list — driven from it so a third gated power
       * cannot break this check by existing. */
      for (const b of Object.values(POWER_BOON)) p.boonMods[b] = true;
      hud.update(1 / 60, world, p, cam);
      const dim = POWERS.map(([k]) => k).filter((k) => POWER_COST[k] != null).filter((k) => !ready(k));
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

  /* ────────────────────────────────────────────────────────────────────
   * THE THREE LABELS THAT HAD NEVER BEEN DRAWN
   * ──────────────────────────────────────────────────────────────────── */

  check('hud: the three bar captions are outside the box that clips them', () => {
    /**
     * VITALITY, FORCE and STAMINA were `<label>` children of `.bar`, and `.bar`
     * is `height:13px; overflow:hidden` while `.bar label` sat at `bottom:16px`
     * — three pixels above the box that clips them. In the DOM, styled, and
     * never once on a screen. What was left was three coloured rectangles told
     * apart by HUE ALONE, which is also the one channel a colour-blind player
     * does not have.
     *
     * Checked STRUCTURALLY rather than as a rectangle, because there is no
     * layout engine here and because the structure is the actual fix: a caption
     * inside a clipping box can only ever be clipped, whatever the numbers are.
     * Both halves are asserted — the caption is out, AND the socket still clips,
     * so "fixed" cannot mean "deleted the overflow and let the glow bleed".
     */
    const { doc, restore } = hudOnPage(INDEX);
    try {
      const bars = doc.querySelectorAll('.bar');
      assert(bars.length >= 3, `${bars.length} bars in the HUD, expected three`);
      const inside = [];
      for (const b of bars) {
        for (const l of b.querySelectorAll('label')) inside.push(l.textContent.trim());
      }
      assert(!inside.length,
        `${inside.length} caption(s) are still inside a .bar: ${inside.join(', ')} — `
        + '.bar is overflow:hidden, so they cannot be drawn');
      const caps = [...doc.querySelectorAll('.bar-cap label')].map(l => l.textContent.trim().toUpperCase());
      for (const want of ['VITALITY', 'FORCE', 'STAMINA']) {
        assert(caps.includes(want), `no caption reads ${want} — captions found: ${caps.join(', ') || 'none'}`);
      }
      // Each caption is a sibling of the bar it names, in one wrapper, so it
      // cannot drift onto the wrong one.
      for (const line of doc.querySelectorAll('.barline')) {
        assert(line.querySelector('.bar-cap') && line.querySelector('.bar'),
          'a .barline has a caption with no bar or a bar with no caption');
      }
      const barRule = (STYLES.match(/\n\.bar\{([^}]*)\}/) || [])[1] || '';
      assert(/overflow:\s*hidden/.test(barRule),
        '.bar no longer clips — the fills are inset:0 with a glow, and the socket is what stops it');
      // and the caption really is fed: HUD._num writes the reading beside it.
      const { hud, root, restore: undo } = hudOn();
      try {
        const p = player();
        p.hp = 61.4;
        hud.update(1 / 60, stubWorld({ ...DEFAULT_SETTINGS }), p, new THREE.PerspectiveCamera());
        assert(root.getElementById('bar-hp-num').textContent === '61',
          `the vitality reading says "${root.getElementById('bar-hp-num').textContent}" for 61.4 hp`);
      } finally { undo(); }
      return `${caps.join(' / ')} — all out of the clipped socket, socket still clips`;
    } finally { restore(); }
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE ARMY
   * ──────────────────────────────────────────────────────────────────── */

  /** A roll shaped exactly like CommandRoster.summary(). */
  const roll = () => ({
    army: 'republic', strength: 3, fallen: 2, points: 14,
    roll: [
      { id: 't1', name: 'CT-2093', unit: 'Clone Trooper', rank: 'TRP', rankTitle: 'Trooper', xp: 1, kills: 0, areas: 0, alive: true, diedIn: null },
      { id: 't2', name: 'CT-4471 "Ladder"', unit: 'Clone Trooper', rank: 'SGT', rankTitle: 'Sergeant', xp: 12, kills: 7, areas: 2, alive: true, diedIn: null },
      { id: 't3', name: 'CT-1500 "Ringo"', unit: 'ARC Trooper', rank: 'VET', rankTitle: 'Veteran', xp: 5, kills: 3, areas: 1, alive: true, diedIn: null },
      { id: 't4', name: 'CT-8812', unit: 'Clone Trooper', rank: 'TRP', rankTitle: 'Trooper', xp: 0, kills: 0, areas: 0, alive: false, diedIn: 1 },
      { id: 't5', name: 'CT-6600', unit: 'Heavy Trooper', rank: 'VET', rankTitle: 'Veteran', xp: 4, kills: 2, areas: 1, alive: false, diedIn: 3 },
    ],
  });

  check('hud: the roster panel draws the real roll, living above fallen', () => {
    /**
     * main.js called `hud.setRoster?.(summary)` into a method that DID NOT
     * EXIST, so the optional-call operator swallowed it on every promotion and
     * every casualty for the whole life of Command mode. Everything the note
     * asked for — "you can see who lived or who died, maybe one particular one
     * lasts longer than the others and you protect him" — was built and none of
     * it reached a screen.
     */
    const { hud, doc, restore } = hudOnPage(INDEX);
    try {
      assert(typeof hud.setRoster === 'function', 'HUD.setRoster does not exist — the call in main.js is a no-op again');
      const panel = doc.getElementById('roster');
      assert(panel, '#roster is not in the markup');
      assert(panel.classList.contains('hidden'), 'the roster panel is up before any army exists');

      hud.setRoster(roll());
      assert(!panel.classList.contains('hidden'), 'setRoster did not raise the panel');
      const rows = doc.querySelectorAll('#rp-list .rp-row');
      const named = rows.filter(r => !r.classList.contains('rp-cols'));
      assert(named.length === 5, `${named.length} names on the roll, expected 5`);

      // The living, best first — the two or three you have been protecting are
      // the point of the column and belong where you can watch them.
      const order = named.map(r => r.querySelector('span').textContent);
      assert(order[0].includes('Ladder'),
        `the top of the roll is "${order[0]}" — the sergeant with seven kills should lead it`);
      const deadAt = named.findIndex(r => r.classList.contains('gone'));
      assert(deadAt === 3, `the first casualty is row ${deadAt}, so the dead are not below the living`);
      assert(named.slice(3).every(r => r.classList.contains('gone')),
        'a living trooper is filed under the fallen');
      // A casualty says where it happened, not how many it killed.
      assert(named[3].querySelector('em').textContent === 'A3',
        `the most recent casualty reports "${named[3].querySelector('em').textContent}", not the area it fell in`);

      // The insignia is the RANK'S OWN COLOUR from Command.js, never a copy.
      const sgt = named[0].querySelector('i').getAttribute('style') || '';
      const want = `#${(RANKS.find(r => r.short === 'SGT').color >>> 0).toString(16).padStart(6, '0')}`;
      assert(sgt.includes(want), `the sergeant's chip is "${sgt}", and RANKS says ${want}`);
      assert(!(named.find(r => r.querySelector('b').textContent === 'TRP').querySelector('i').getAttribute('style')),
        'a plain Trooper is wearing an insignia colour — RANKS gives that rung null on purpose');

      // The army's proper name, out of ARMIES rather than the raw id.
      assert(doc.getElementById('rp-army').textContent === ARMIES.republic.name,
        `the panel is headed "${doc.getElementById('rp-army').textContent}", not ${ARMIES.republic.name}`);
      assert(doc.getElementById('rp-strength').textContent === '3/5',
        `strength reads "${doc.getElementById('rp-strength').textContent}", expected 3/5`);
      assert(doc.getElementById('rp-foot').textContent.includes('14'),
        'the reinforcement points are not on the panel');

      // …and it goes away again, or a Trial of Waves keeps an army it has not got.
      hud.setRoster(null);
      assert(panel.classList.contains('hidden'), 'setRoster(null) left the panel up');
      return `5 names: ${order.join(', ')} — 3 standing, 2 struck through`;
    } finally { restore(); }
  });

  check('hud: the panel is fed by the roster\'s OWN summary, not a shape invented here', () => {
    /**
     * The check above drives the panel with a hand-built roll, and a hand-built
     * roll can only ever agree with the renderer that was written beside it.
     * This one uses a REAL `CommandRoster`, promoted and killed through its own
     * API, and asserts the panel draws what actually comes out of it — which is
     * the only way "the roster panel renders real data" is a claim about the
     * game rather than about this file.
     *
     * It also pins the thing the mode is FOR. A fresh clone is a number; a
     * nickname is earned on the second rung and never lost. The whole design of
     * that asymmetry is that a roll full of numbers with three names in it is
     * the game telling you who you kept alive — so the panel has to print the
     * earned name, and a number for everyone else.
     */
    const roster = new CommandRoster(ARMIES.republic);
    const men = Array.from({ length: 6 }, () => roster.enlist('trooper', { joined: 1 }));
    /* RANKS[2] and RANKS[4], not RANKS[1]: a nickname is won on the rung whose
     * INDEX is 2, which is the third entry — `Trooper.award` says `now >= 2`.
     * Promoting to Veteran and expecting a name is the mistake this comment
     * exists to stop the next reader repeating; the table is the authority for
     * where the gate is, and it is read rather than typed. */
    const promoted = men[0].award(RANKS[2].xp);
    assert(promoted, 'awarding a Sergeant\'s worth of experience did not promote anybody');
    men[1].award(RANKS[4].xp);
    men[2].kills = 4;
    roster.fall(men[4], 2);
    roster.fall(men[5], 3);

    const summary = roster.summary();
    const html = rosterHtml(summary);
    const rows = [...html.matchAll(/<div class="rp-row( gone)?"[^>]*><i[^>]*><\/i><b>([A-Z]+)<\/b><span>([^<]*)<\/span><em>([^<]*)<\/em>/g)]
      .map(m => ({ gone: !!m[1], rank: m[2], name: m[3], right: m[4] }));
    assert(rows.length === 6, `${rows.length} rows drawn from a roster of 6`);
    assert(rows[0].rank === RANKS[4].short && rows[1].rank === RANKS[2].short,
      `the roll leads with ${rows[0].rank} then ${rows[1].rank} — the Commander should be above the Sergeant`);
    // The two who were promoted carry an earned name; the rest are numbers.
    const named = rows.filter(r => /"/.test(r.name));
    assert(named.length === 2,
      `${named.length} of 6 carry a nickname — exactly the two that were promoted should`);
    for (const r of rows.filter(r => r.rank === RANKS[0].short)) {
      assert(!/"/.test(r.name), `a plain Trooper is drawn as ${r.name} — a nickname is EARNED`);
    }
    assert(rows.filter(r => r.gone).length === 2, 'the two who fell are not struck through');
    assert(rows.find(r => r.gone).right === 'A3',
      `the most recent casualty reports "${rows.find(r => r.gone).right}" for area 3`);
    // …and the panel takes the real thing without a translation step anywhere.
    const { hud, doc, restore } = hudOnPage(INDEX);
    try {
      hud.setRoster(summary);
      assert(doc.getElementById('rp-strength').textContent === '4/6',
        `the header reads ${doc.getElementById('rp-strength').textContent} for 4 living of 6`);
      assert(doc.querySelectorAll('#rp-list .rp-row.gone').length === 2,
        'the real summary lost its casualties on the way to the panel');
      return `${rows.length} real records: ${rows.map(r => `${r.rank} ${r.name}`).join(', ')}`;
    } finally { restore(); }
  });

  check('hud: the formation indicator names the order and prints its live key', () => {
    /**
     * `hud.setOrder?.(F.id, F.name, squads)` was the other call into nothing.
     * Six order keys change how twenty-four bodies behave and the only feedback
     * was a message that faded in two seconds.
     *
     * The keycaps are driven by `setBindings`, so this also pins the half that
     * a typed key would fail: the orders became rebindable actions this round,
     * and a chip printed from memory is the exact bug the power wheel was
     * rebuilt to stop.
     */
    const { hud, doc, restore } = hudOnPage(INDEX);
    try {
      assert(typeof hud.setOrder === 'function', 'HUD.setOrder does not exist — main.js calls it into thin air');
      assert(ORDER_ACTIONS.length, 'no orders are registered, so the indicator has nothing to draw');
      const b = defaultBindings();
      hud.setBindings(b);
      const chips = doc.querySelectorAll('#rp-orders .rp-key');
      assert(chips.length === ORDER_ACTIONS.length,
        `${chips.length} keycaps for ${ORDER_ACTIONS.length} orders`);
      for (let i = 0; i < chips.length; i++) {
        const want = keyLabel(b[ORDER_ACTIONS[i].action][0]);
        assert(chips[i].textContent === want,
          `the ${ORDER_ACTIONS[i].id} cap reads "${chips[i].textContent}" and it is bound to "${want}"`);
      }

      const F = ORDER_ACTIONS[0];
      hud.setOrder(F.id, F.name, 3);
      assert(doc.getElementById('rp-order-name').textContent === F.name,
        `the indicator says "${doc.getElementById('rp-order-name').textContent}", not ${F.name}`);
      assert(doc.getElementById('rp-order-sub').textContent === '3 squads',
        `the squad count reads "${doc.getElementById('rp-order-sub').textContent}"`);
      const lit = doc.querySelectorAll('#rp-orders .rp-key').filter(c => c.classList.contains('on'));
      assert(lit.length === 1 && lit[0].dataset.order === F.id,
        `${lit.length} caps are lit — exactly one order is current at a time`);

      // A rebind repaints the caps AND keeps the right one lit.
      const moved = { ...b, [F.action]: ['F13'] };
      hud.setBindings(moved);
      const after = doc.querySelectorAll('#rp-orders .rp-key');
      assert(after[0].textContent === keyLabel('F13'), 'rebinding an order did not repaint its cap');
      assert(after[0].classList.contains('on'), 'a rebind put out the light on the current order');
      return `${chips.length} caps: ${ORDER_ACTIONS.map(o => `${o.name} ${keyLabel(b[o.action][0])}`).join(', ')}`;
    } finally { restore(); }
  });

  check('hud: the wave counter counts the enemy, not your own army', () => {
    /**
     * `director.remaining` is `spawnQueue + arrivals.pending + every live body
     * in world.enemies` — and in Command mode `world.enemies` HOLDS YOUR OWN
     * TROOPS, because an ally is an Enemy with a different team. So the corner
     * of the screen said "10 remaining" with nothing hostile on the field.
     *
     * The getter lives in a file this lane does not own, so the repair is
     * confined to the mode where it is wrong: this asserts BOTH halves of that
     * — Command counts hostiles, and every other mode is left reading the
     * shipped getter untouched, so nothing that is right today can be made
     * wrong here.
     */
    const bodies = (n, team) => Array.from({ length: n }, () => ({ dead: false, team }));
    const world = (extra) => ({
      partyTeam: 0,
      enemies: [...bodies(10, 0), ...bodies(3, 1), { dead: true, team: 1 }],
      director: { remaining: 99, spawnQueue: [1, 2], arrivals: { pending: 1 } },
      ...extra,
    });
    const asCommand = world({ command: {} });
    assert(hostilesLeft(asCommand) === 6,
      `with ten allies, three hostiles, two queued and one inbound the HUD says `
      + `${hostilesLeft(asCommand)} — it should say 6`);
    // The ten allies really were the difference, and a dead hostile is not one.
    assert(asCommand.director.remaining === 99 && hostilesLeft(asCommand) !== 99,
      'the Command path is reading the getter it exists to work around');
    assert(hostilesLeft(world({})) === 99,
      'a mode with no army stopped reading director.remaining — that path must not change');
    assert(hostilesLeft(null) === 0 && hostilesLeft({}) === 0, 'a world with no director throws or lies');
    return 'command: 3 alive + 2 queued + 1 inbound = 6 with 10 allies on the field; every other mode: the getter, unchanged';
  });

  /* ────────────────────────────────────────────────────────────────────
   * THE MUSTER
   * ──────────────────────────────────────────────────────────────────── */

  check('hud: four readers stop treating your own army as the enemy', () => {
    /**
     * IN COMMAND, `world.enemies` HOLDS YOUR OWN TROOPS — an ally is an `Enemy`
     * with a different `team`. The check above fixed the COUNTER for that and
     * wrote a paragraph about it; four readers twelve lines either side of it
     * had the identical missing filter, and every one was measured on a real
     * geonosis Command run (18 bodies alive, 10 of them yours):
     *
     *   THE MINIMAP     index.html promises "bosses warm, allies green" and
     *                   `MINIMAP_COLORS.ally` was reachable only from the two
     *                   co-op loops. Colours used: `{enemy: 18}`, ally 0.
     *   THE RETICLE     `.hot` — "something within 5 m can kill you" — with
     *                   zero hostiles inside the radius: circle, behind, cover,
     *                   line and holdfire all lit it, five of seven formations,
     *                   permanently. A warning that is always on carries none.
     *   THE OPEN STATE  offered a "1.5x CUT" over the player's own toppled
     *                   sergeant.
     *   THE BOSS BAR    both armies field a `big` body, so an allied heavy took
     *                   the boss bar and its name.
     *
     * The predicate is the DIRECTOR'S, not a fourth copy: `blocksWaveEnd` is
     * borrowed onto the fixture the way `wheelPlayer` borrows `_canSpend`.
     */
    const { hud, restore } = hudOnPage(INDEX);
    try {
      const at = (x, z, team, extra = {}) => ({
        dead: false, team, position: new THREE.Vector3(x, 0, z),
        hp: 100, maxHp: 100, ...extra,
        A: { label: `T${team}`, ...(extra.A || {}) },
      });
      const world = stubWorld({ ...DEFAULT_SETTINGS });
      world.command = {};
      world.partyTeam = 0;
      world.director.blocksWaveEnd = WaveDirector.prototype.blocksWaveEnd;
      world.director.world = world;
      // Your own squad, standing where a formation puts it — inside 5 m — with
      // one man toppled and one heavy. Nothing hostile is anywhere near.
      world.enemies = [
        at(1, 1, 0), at(-1, 1, 0), at(2, 0, 0, { toppled: true }),
        at(1.5, 1.5, 0, { A: { label: 'ALLIED HEAVY', big: true } }),
        at(60, 60, 1), at(62, 60, 1, { A: { label: 'HOSTILE HEAVY', big: true } }),
      ];
      const p = player();
      const cam = new THREE.PerspectiveCamera();
      hud.update(1 / 60, world, p, cam);

      const near = world.enemies.filter(e => e.position.distanceToSquared(p.position) < 25);
      assert(near.length && near.every(e => e.team === 0),
        'this fixture no longer parks allies and only allies inside the threat radius');
      assert(!hud.el.reticle.classList.contains('hot'),
        `the reticle warns of a threat with ${near.length} of your own troops and no hostile inside 5 m`);
      assert(hud.el.targetOpen.classList.contains('hidden'),
        `the open-state readout is offering "${hud.el.targetOpen.textContent}" over your own downed trooper`);
      assert(hud.el.boss.classList.contains('hidden')
        || hud.el.bossLabel.textContent !== 'ALLIED HEAVY',
        `the boss bar is showing "${hud.el.bossLabel.textContent}" — that is your own heavy`);

      // …and each one still fires for the real thing, so this is a filter and
      // not an off switch.
      world.enemies = [at(2, 0, 1, { toppled: true }),
        at(3, 0, 1, { A: { label: 'HOSTILE HEAVY', big: true } })];
      hud.update(1 / 60, world, p, cam);
      assert(hud.el.reticle.classList.contains('hot'), 'a real hostile inside 5 m no longer warns');
      assert(!hud.el.targetOpen.classList.contains('hidden'), 'a downed hostile is no longer worth extra');
      assert(hud.el.bossLabel.textContent === 'HOSTILE HEAVY',
        `the boss bar reads "${hud.el.bossLabel.textContent}" with a hostile heavy on the field`);

      /* THE MINIMAP, through the shipped Minimap on a colour-counting canvas —
       * the claim is about which entry of MINIMAP_COLORS came out, and a check
       * that read the source could not tell you. */
      const used = new Map();
      const g = new Proxy({}, {
        get: () => () => {},
        set: (_t, k, v) => { if (k === 'fillStyle') used.set(v, (used.get(v) || 0) + 1); return true; },
      });
      const canvas = { width: 0, height: 0, style: {},
        classList: { toggle() {}, contains: () => false }, getContext: () => g };
      const map = new Minimap(canvas);
      const army = { ...world, enemies: [], players: [] };
      army.director = { ...world.director, world: army };
      army.director.blocksWaveEnd = WaveDirector.prototype.blocksWaveEnd;
      for (let i = 0; i < 10; i++) army.enemies.push(at(i, i, 0));
      for (let i = 0; i < 8; i++) army.enemies.push(at(-i - 1, i, 1));
      const me = player(); me.senseActive = true;
      for (let i = 0; i < 60; i++) map.update(1 / 60, army, me, { ...DEFAULT_SETTINGS });
      const allyBlips = used.get(MINIMAP_COLORS.ally) || 0;
      const hostileBlips = (used.get(MINIMAP_COLORS.enemy) || 0) + (used.get(MINIMAP_COLORS.boss) || 0);
      assert(allyBlips > 0,
        `${army.enemies.filter(e => e.team === 0).length} of your own troops are on the map and the `
        + 'ally colour was used 0 times — index.html promises "allies green"');
      assert(Math.abs(allyBlips / hostileBlips - 10 / 8) < 0.05,
        `10 allies and 8 hostiles drew ${allyBlips} ally blips and ${hostileBlips} hostile ones`);
      return `18 bodies, 10 yours: reticle cold, no open-state offer, no boss bar, `
        + `map ${allyBlips} green / ${hostileBlips} red — and all four still fire on a real hostile`;
    } finally { restore(); }
  });

  check('hud: the muster sells what the director offers, and spends the director\'s points', () => {
    /**
     * There was no muster screen at all, so `main.js`'s `typeof screens.muster
     * === 'function'` was false, `onMuster` was never installed, and the
     * director took its documented fallback — `autoMuster()`, which spent the
     * player's reinforcement points for them between every area and showed them
     * nothing. Permadeath whose replacement budget you never see is permadeath
     * with the decision taken out of it.
     *
     * Driven through the REAL Menu on the REAL markup, with a director double
     * that refuses the way the real one refuses.
     */
    const offer = (points) => ({
      area: 2, areaName: 'The Open Plain',
      brief: 'Two kilometres of flat ochre.',
      next: { id: 'hailfire', name: 'The Hailfire Line', brief: 'Armour on the ridge.' },
      points, strength: 3, max: 24, roster: roll(),
      units: [
        { type: 'trooper', cost: 3, label: 'Clone Trooper', threat: 4, have: 2, afford: points >= 3 },
        { type: 'heavy', cost: 9, label: 'Heavy Trooper', threat: 11, have: 0, afford: points >= 9 },
        { type: 'arc', cost: 20, label: 'ARC Trooper', threat: 18, have: 0, afford: points >= 20 },
      ],
    });
    const doc = makeDocument(INDEX);
    const undo = doc.install();
    let menu;
    try { menu = new Menu({ ...DEFAULT_SETTINGS }); } catch (e) { undo(); throw e; }
    try {
      assert(typeof menu.showMuster === 'function', 'Menu.showMuster does not exist');
      let points = 14, bought = [], closed = 0;
      menu.showMuster(offer(points), {
        recruit: (type) => {
          const u = offer(points).units.find(x => x.type === type);
          if (u.cost > points) return { offer: offer(points), refused: `${u.cost} points needed, you have ${points}` };
          points -= u.cost; bought.push(type);
          return { offer: offer(points), refused: null };
        },
        done: () => { closed++; },
      });
      const card = doc.getElementById('muster');
      assert(!card.classList.contains('hidden'), 'the muster never came up');
      assert(doc.getElementById('muster-held').textContent.includes('The Open Plain'),
        'the screen does not say which area was just held');
      assert(doc.getElementById('muster-title').textContent === 'The Hailfire Line',
        `the screen is titled "${doc.getElementById('muster-title').textContent}", not the area being walked into`);
      assert(doc.getElementById('muster-points').textContent === '14', 'the points are not the offer\'s');
      // The whole roll, at full length — the same renderer the HUD panel uses.
      assert(doc.querySelectorAll('#muster-list .rp-row.gone').length === 2,
        'the casualty list is not on the muster screen');

      const cards = doc.querySelectorAll('#muster-units .mu');
      assert(cards.length === 3, `${cards.length} units on the shelf, the offer has 3`);
      assert(cards[2].classList.contains('poor'),
        'the ARC costs 20 against 14 points and is not marked unaffordable');
      assert(!cards[1].classList.contains('poor'), 'the Heavy costs 9 against 14 points and is greyed out');
      assert(/20/.test(cards[2].textContent) && /threat 18/.test(cards[2].textContent),
        'a unit card does not state what it costs and what it is worth');

      // Buying goes through the director and the screen RE-READS it, rather
      // than adjusting its own copy of the numbers — the heavy is affordable at
      // 14 and is not at the 5 that buying it leaves.
      cards[1].click();
      assert(bought.join() === 'heavy', `clicking the Heavy bought ${bought.join() || 'nothing'}`);
      assert(doc.getElementById('muster-points').textContent === '5',
        `after a 9-point purchase the screen says ${doc.getElementById('muster-points').textContent}`);
      assert(doc.querySelectorAll('#muster-units .mu')[1].classList.contains('poor'),
        'the shelf was not redrawn against the new points');

      // A refusal is the director's sentence, printed, not a silent no-op.
      points = 1;
      menu.showMuster(offer(points), {
        recruit: () => ({ offer: offer(1), refused: '3 points needed, you have 1' }),
        done: () => { closed++; },
      });
      doc.querySelectorAll('#muster-units .mu')[0].click();   // still clickable? it is not affordable
      const said = doc.getElementById('muster-refused').textContent;
      assert(said === '' || said.includes('points needed'),
        `an unaffordable card produced "${said}" instead of nothing or the director's reason`);

      // Advance closes it, once, and calls THIS muster's handler — not the
      // first one's, which is what a listener closing over the first `io` does.
      doc.getElementById('btn-muster-done').click();
      assert(closed === 1, `Advance fired ${closed} times`);
      assert(card.classList.contains('hidden'), 'the card is still on screen after Advance');
      return `3 units offered, heavy bought for 9, 14 → 5 points, shelf redrawn, roll shows 2 casualties, Advance closes once`;
    } finally { undo(); }
  });
}
