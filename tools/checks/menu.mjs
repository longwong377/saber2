/**
 * THE MENU, CONSTRUCTED.
 *
 * Before this file, nothing in the suite had ever built one. `grep -rn "new
 * Menu"` over the whole repo returned exactly one hit — src/main.js — and every
 * check that mentioned the front end read src/ui/Menu.js as TEXT: the flagship
 * guarantee, "every control in the menu is bound to a setting", matches
 * `_slider('opt-…', '…'` against `id="opt-…"` harvested from index.html. Those
 * strings sit in their files whether or not a line of either ever runs, and
 * `_slider`/`_check` return silently when `getElementById` misses, so the whole
 * set would have passed with the constructor replaced by `return;`.
 *
 * That is the "nothing in the suite ever constructed a World" hole, one layer
 * up, and it is what let four separate defects ship at once: a group heading
 * rendered twice with one row orphaned under it, a slider that re-registered
 * its listener on every creator rebuild so one drag cost four full figure
 * rebuilds, a Theatre column that stayed lit while the mode threw it away, and
 * 120 controls no keyboard could reach. Every one of those is a fact about the
 * OBJECT, and no check had ever made one.
 *
 * So every check below builds a real Menu on a real parse of index.html
 * (tools/checks/_page.mjs) and asserts on the result: what got built, what it
 * can be driven with, and what it says. Where a claim is about paint rather
 * than structure — the focus ring's contrast, the frame counter's box — it is
 * measured off styles.css, because a DOM with no layout engine cannot answer
 * that and pretending otherwise would be the same lie in a new place.
 */

import { readFile } from 'node:fs/promises';
import { makeDocument } from './_page.mjs';
import { Menu, DEFAULT_SETTINGS, DEATH_TITLE, codexHtml, codexTeaching,
  loadSettings, STORE_KEY } from '../../src/ui/Menu.js';
/* The standing-order row is BUILT from this table, so the check that says so reads the
 * table rather than a transcription of what it said on the day. */
import { AREAS, FORMATIONS, COMMAND_FORCE, ORDERS as COMMAND_ORDERS,
         MAX_STRENGTH, OPENING_STRENGTH, CommandRoster, ARMIES,
         commandConfig } from '../../src/game/Command.js';
/* A man on the roll is what the NPC half of "Trust in the Force" dresses, and
 * the store is the only way to put one on a page — see `withTrooper`. */
import * as Company from '../../src/game/Company.js';
import { ACTIONS, defaultBindings } from '../../src/engine/Bindings.js';
import { FOCUS } from '../../src/game/Focus.js';
import { QUALITY } from '../../src/engine/Engine.js';
import { MODES, playableModes, WaveDirector, BOSS_EVERY, CONDITION_KEYS, SKIRMISH } from '../../src/game/Waves.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { WITHDRAW_HOLD, LAST_CALL } from '../../src/game/Extraction.js';
import { READ_SECONDS, SENSE_RATE } from '../../src/game/FireMission.js';
import { ALLY_WARD, RESTORE } from '../../src/game/Player.js';
/* The Codex's teaching half is generated off these, and the check reads the
 * same tables rather than a transcription of what they said on the day. */
import { DIFFICULTY, GRADE_NAME, SPEED_GRADE, PARRY_GRADE, parryScale, CATCH } from '../../src/game/Combat.js';
import { POWER_COST, POWER_BOON } from '../../src/game/Powers.js';
import { STRATAGEMS, CODE_GAP, supportCost } from '../../src/game/Stratagems.js';
import { insightRate, insightAfter, COST as FACET_COST, COST_STEP } from '../../src/game/LivingForce.js';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/** Every host in the Deploy, Jedi and Options panels that the menu fills. */
const PICKER_HOSTS = ['level-list', 'diff-list', 'mode-list', 'opt-quality', 'opt-scheme',
  'opt-deflect', 'order-list', 'species-list', 'face-list', 'hairstyle-list', 'beard-list',
  'cut-list', 'skin-list', 'hair-list', 'robe-list', 'color-list', 'lightning-list', 'hilt-list'];

/**
 * A real Menu on a real page.
 *
 * SYNCHRONOUS from `install()` to `close()`, and that is not an accident: the
 * runner starts every check as soon as the one before it suspends, so a check
 * that awaited anything while a fake `document` was installed globally would
 * hand its page to whatever ran next. The markup is read once, before any check
 * is registered, and each check then parses, installs, builds and restores
 * without ever yielding.
 */
let INDEX_HTML = '';
function menuOn(overrides = {}) {
  const doc = makeDocument(INDEX_HTML);
  const restore = doc.install();
  try {
    const settings = { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
    const hooks = { fired: [] };
    for (const name of ['onDeploy', 'onQualityChange', 'onBloom', 'onSchemeChange', 'onDeflectAim',
      'onLightning', 'onSaberChange', 'onName', 'onHost', 'onJoin', 'onBindings']) {
      hooks[name] = (v) => hooks.fired.push([name, v]);
    }
    const menu = new Menu(settings, hooks);
    return { menu, settings, hooks, doc, close: restore };
  } catch (e) { restore(); throw e; }
}

const kids = (doc, id) => (doc.getElementById(id)?.children ?? []);

/** WCAG relative luminance, and the ratio two colours make. */
function luminance([r, g, b]) {
  const f = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const hex = (s) => {
  const h = s.replace('#', '').trim();
  const full = h.length === 3 ? [...h].map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
};
/** src over dst, both opaque-backed; alpha in 0..1. */
const over = (src, a, dst) => src.map((c, i) => Math.round(c * a + dst[i] * (1 - a)));

export async function run({ check, assert }) {
  INDEX_HTML = await read('index.html');
  const CSS = await read('styles.css');
  const MAIN = await read('src/main.js');

  /* ────────────────────────────────────────────────────────────────────
   * IT IS BUILT AT ALL
   * ──────────────────────────────────────────────────────────────────── */

  check('menu: the front end is BUILT — every panel, from the real constructor', () => {
    const { menu, doc, close } = menuOn();
    try {
      const empty = PICKER_HOSTS.filter(id => kids(doc, id).length === 0);
      assert(!empty.length, `hosts the menu left empty: ${empty.join(', ')}`);
      // The three lists whose length is a fact about the game, not about the DOM
      assert(kids(doc, 'level-list').length === LEVEL_ORDER.length,
        `${kids(doc, 'level-list').length} theatres against ${LEVEL_ORDER.length} in LEVEL_ORDER`);
      assert(kids(doc, 'opt-quality').length === 4, 'the fidelity tiers are not four');
      assert(doc.getElementById('bind-list').children.length > 30, 'the key table did not render');
      assert(doc.getElementById('codex-grid').children.length > 20, 'the Codex did not render');
      // and the sliders in the markup were reached, which is the thing a regex
      // over the source cannot tell you: _slider returns silently on a miss.
      const painted = ['opt-build', 'opt-sens', 'opt-fov', 'opt-vol', 'sheet-age']
        .filter(id => doc.getElementById(id)?.dataset.sliderBound || doc.getElementById(id)?.dataset.sheetBound);
      assert(painted.length === 5, `only ${painted.length}/5 sliders were bound to anything`);
      assert(menu._bound.size > 15, `${menu._bound.size} settings carry a control`);
      const total = PICKER_HOSTS.reduce((n, id) => n + kids(doc, id).length, 0);
      return `${total} pickers across ${PICKER_HOSTS.length} hosts, ${menu._bound.size} bound settings, all from one real Menu`;
    } finally { close(); }
  });

  /* ────────────────────────────────────────────────────────────────────
   * KEYBOARD
   * ──────────────────────────────────────────────────────────────────── */

  check('menu: every control a mouse can reach, a keyboard can reach', () => {
    const { doc, close } = menuOn();
    try {
      let total = 0;
      const bad = [];
      for (const id of PICKER_HOSTS) {
        for (const el of kids(doc, id)) {
          total++;
          if (el.tabIndex !== 0) bad.push(`${id}: not focusable`);
          else if (el.getAttribute('role') !== 'button') bad.push(`${id}: no role`);
          else if (el.listenerCount('keydown') === 0) bad.push(`${id}: focusable but deaf`);
        }
      }
      // The key chips in the bindings table are controls too — rebinding the
      // keyboard was itself mouse-only.
      for (const chip of doc.querySelectorAll('.bindrow .keys b')) {
        total++;
        if (chip.tabIndex !== 0 || chip.listenerCount('keydown') === 0) bad.push('a key chip is mouse-only');
      }
      assert(!bad.length, `${bad.length} of ${total} controls: ${[...new Set(bad)].slice(0, 6).join('; ')}`);
      assert(total > 100, `only ${total} controls were checked — the menu did not build`);
      return `${total} controls, every one focusable, role="button", and listening for a key`;
    } finally { close(); }
  });

  check('menu: Enter and Space actually pick, on every kind of picker', () => {
    const { menu, settings, doc, close } = menuOn();
    try {
      // A card, a difflist row and a swatch: the three shapes every picker in
      // the menu is built from. Driven by KEY, with no click anywhere.
      const cards = doc.getElementById('level-list').children;
      const level = cards.find(c => !c.classList.contains('sel'));
      const levelBefore = settings.level;
      level.dispatchEvent({ type: 'keydown', key: 'Enter' });
      assert(settings.level !== levelBefore,
        `Enter on a theatre card left settings.level at ${settings.level}`);
      assert(level.classList.contains('sel'), 'the card the keyboard picked is not the lit one');
      assert(cards.filter(c => c.classList.contains('sel')).length === 1,
        'two theatre cards are lit at once');
      const diffs = doc.getElementById('diff-list').children;
      const before = settings.difficulty;
      diffs[diffs.length - 1].dispatchEvent({ type: 'keydown', key: ' ' });
      assert(settings.difficulty !== before, 'Space on a difficulty row did nothing');
      const sw = doc.getElementById('hair-list').children[6];
      const hairBefore = settings.hairIndex;
      sw.dispatchEvent({ type: 'keydown', key: 'Enter' });
      assert(settings.hairIndex !== hairBefore, 'Enter on a swatch did nothing');
      // and a key that is not an activation must NOT pick
      const q = doc.getElementById('opt-quality').children[0];
      const qBefore = settings.quality;
      q.dispatchEvent({ type: 'keydown', key: 'a' });
      assert(settings.quality === qBefore, 'any key at all activates a tier card');
      assert(menu._bound.size > 0, 'sanity: the menu is still the one that was built');
      return `Enter picked a card and a swatch, Space picked a row, "a" picked nothing`;
    } finally { close(); }
  });

  check('menu: the front end can be walked and pressed with a controller', () => {
    /**
     * THE HALF OF "PLAYABLE ON A PAD" A BINDINGS TABLE CANNOT ANSWER.
     *
     * Every action in the game reaches a pad button now, and a player who
     * cannot press Deploy still cannot play: the front screen is DOM, a pad
     * raises no DOM events, and there is no Tab key on a controller. So the pad
     * moves the FOCUS and presses the focused thing, riding the activation
     * model the check above pins rather than growing a second one.
     *
     * Driven through `padNav`/`padConfirm` against a real Menu on a real parse
     * of index.html, and asserted on what actually happened to the settings —
     * not on whether a method exists.
     */
    const { menu, settings, doc, close } = menuOn();
    try {
      // index.html ships every `.screen` hidden and main.js raises the front
      // one after the boot; the walk is over what is ON SCREEN, so the check
      // has to put it there the same way rather than reaching past the rule.
      menu.showMenu();
      const host = menu._padHost();
      assert(host && host.id === 'menu',
        `with the front screen up the pad walks #${host?.id || 'nothing'}`);
      const list = menu._padFocusable(host);
      assert(list.length > 20, `only ${list.length} controls are reachable from a pad`);

      // The first press lands on the FIRST control, not the second — "press
      // down to start reading a list" is what a controller means by that.
      doc.activeElement = null;
      menu.padNav('down');
      assert(doc.activeElement === list[0],
        'the first press of down did not land on the first control');
      menu.padNav('down');
      assert(doc.activeElement === list[1], 'down twice did not reach the second control');
      menu.padNav('up');
      assert(doc.activeElement === list[0], 'up did not go back');
      // …and it wraps rather than dead-ending, which is the one thing a linear
      // walk must not do: a pad has no scrollbar to tell you where the end is.
      menu.padNav('up');
      assert(doc.activeElement === list[list.length - 1], 'up from the first control dead-ends');

      // CONFIRM REALLY PICKS. A theatre card, chosen because it writes a
      // setting and lights up, so "it fired" is a fact about the game and not
      // about a listener count.
      const cards = doc.getElementById('level-list').children;
      const card = cards.find(c => !c.classList.contains('sel'));
      const before = settings.level;
      card.focus();
      menu.padConfirm();
      assert(settings.level !== before,
        `A on a focused theatre card left settings.level at ${settings.level}`);
      assert(card.classList.contains('sel'), 'the card the pad picked is not the lit one');

      /**
       * A CONTROL THAT IS NOT ON SCREEN IS NOT REACHABLE, and the walk asks the
       * layout engine rather than restating the rule.
       *
       * The front end's tabs are `.panel{display:none}` / `.panel.active
       * {display:flex}` in styles.css, so "is this panel showing" has exactly
       * one authority and it is CSS. `_padFocusable` consults `offsetParent`,
       * which is that authority answering; this harness has no layout engine,
       * which is why the count above is every panel at once and a real browser
       * walks only the tab the player is looking at.
       *
       * Both halves of the exclusion are driven here: the layout answer, and
       * the `.hidden` class, which is what every OVERLAY in this front end
       * uses and which a DOM with no layout can still be held to.
       */
      const probe = list[3];
      Object.defineProperty(probe, 'offsetParent', { value: null, configurable: true });
      assert(!menu._padFocusable(host).includes(probe),
        'a control the layout engine says is not displayed is still on the pad walk');
      delete probe.offsetParent;
      const buried = list[4];
      buried.parentElement.classList.add('hidden');
      assert(!menu._padFocusable(host).includes(buried),
        'a control inside a hidden box is still on the pad walk');
      buried.parentElement.classList.remove('hidden');

      // …and the topmost card wins. A draft over the menu must take the walk
      // with it, or the pad presses a button underneath the thing on screen.
      const draft = doc.getElementById('boon-draft');
      draft.classList.remove('hidden');
      assert(menu._padHost() === draft,
        'a draft is on screen and the pad is still walking the menu underneath it');
      draft.classList.add('hidden');
      return `${list.length} controls reachable with no layout engine (a browser walks the open `
        + `tab only), walk wraps both ways, A wrote settings.level ${before} → ${settings.level}, `
        + 'undisplayed and hidden controls excluded, draft takes the walk';
    } finally { close(); }
  });

  check('menu: the focus ring is visible on the ground the pickers sit on', () => {
    // Keyboard reach with no visible focus is not operability. This is measured
    // rather than eyeballed: WCAG 1.4.11 asks 3:1 of a non-text indicator, and
    // the ring is painted over `--panel` composited on the menu's dark radial.
    const css = CSS;
    const rule = css.match(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/);
    assert(rule, 'styles.css has no :focus-visible rule at all — 120 controls, no ring');
    for (const cls of ['.card', '.diff', '.sw', '.dc']) {
      assert(rule[1].includes(`${cls}:focus-visible`), `${cls} has no focus ring`);
    }
    const outline = rule[2].match(/outline:\s*([\d.]+)px\s+solid\s+var\(([^)]+)\)/);
    assert(outline, `the focus rule does not paint a solid outline: ${rule[2]}`);
    assert(parseFloat(outline[1]) >= 2, `a ${outline[1]}px ring is a hairline`);
    const token = css.match(new RegExp(`${outline[2].trim()}\\s*:\\s*(#[0-9a-fA-F]{3,6})`));
    assert(token, `${outline[2]} is not a colour token in :root`);
    // The panel is OPAQUE now — the interface has no glass in it — so the
    // ground a ring is painted over is the panel itself rather than the panel
    // composited over the page. `over()` with an alpha of 1 is that, and it is
    // kept rather than dropped so this check still measures a composite the
    // day a translucent surface comes back.
    const bg = hex(css.match(/--void\s*:\s*(#[0-9a-fA-F]{6})/)[1]);
    const panel = css.match(/--panel\s*:\s*(#[0-9a-fA-F]{6})/);
    assert(panel, 'no --panel colour token in :root');
    const ground = over(hex(panel[1]), 1, bg);
    const ratio = contrast(hex(token[1]), ground);
    assert(ratio >= 3, `the focus ring is ${ratio.toFixed(2)}:1 against the card ground — WCAG asks 3`);
    // …and it must not be the same colour as "this one is selected", or the
    // ring answers a question the player did not ask.
    const accent = hex(css.match(/--accent\s*:\s*(#[0-9a-fA-F]{6})/)[1]);
    assert(hex(token[1]).join() !== accent.join(), 'the focus ring is the selection colour');
    return `${outline[1]}px ${token[1]} on ${'#' + ground.map(c => c.toString(16).padStart(2, '0')).join('')} = ${ratio.toFixed(1)}:1`;
  });

  check('menu: the mid-run draft can be answered without a mouse', () => {
    const { menu, doc, close } = menuOn();
    try {
      const boons = [{ id: 'a', icon: '1', name: 'Alpha', text: 'a', tag: 't' },
        { id: 'b', icon: '2', name: 'Beta', text: 'b', tag: 't' },
        { id: 'c', icon: '3', name: 'Gamma', text: 'c', tag: 't', attune: true }];
      let picked = null;
      menu.showDraft(boons, (b) => { picked = b; });
      const cards = doc.getElementById('draft-cards').children;
      assert(cards.length === 3, 'the draft did not build');
      // The draft STOPS THE WORLD and Escape only routes to a pause card whose
      // Resume puts it straight back, so focus has to land on the offer.
      assert(doc.activeElement === cards[0], 'nothing was focused when the draft opened');
      cards[0].dispatchEvent({ type: 'keydown', key: 'ArrowRight' });
      assert(doc.activeElement === cards[1], 'the arrows do not walk the row');
      cards[1].dispatchEvent({ type: 'keydown', key: 'ArrowLeft' });
      assert(doc.activeElement === cards[0], 'the arrows only go one way');
      cards[0].dispatchEvent({ type: 'keydown', key: 'Enter' });
      assert(picked === boons[0], `Enter took ${picked?.name ?? 'nothing'}`);
      assert(doc.getElementById('boon-draft').classList.contains('hidden'), 'the draft stayed up');
      // and the number keys, which the card prints
      picked = null;
      menu.showDraft(boons, (b) => { picked = b; });
      const again = doc.getElementById('draft-cards').children;
      assert(again[1].textContent.includes('2'), 'the cards do not print their number');
      again[0].dispatchEvent({ type: 'keydown', key: '3' });
      assert(picked === boons[2], `pressing 3 took ${picked?.name ?? 'nothing'}`);
      return 'focus lands on the first card; arrows walk; Enter takes; 3 takes the third';
    } finally { close(); }
  });

  /* ────────────────────────────────────────────────────────────────────
   * WHAT REBUILDING COSTS
   * ──────────────────────────────────────────────────────────────────── */

  check('menu: a slider binds once, however often the creator rebuilds', () => {
    const { menu, doc, close } = menuOn();
    try {
      // Three Order/Species picks. Each re-runs _buildSaber, and the three
      // appearance sliders are static markup that is never recreated.
      for (let i = 0; i < 3; i++) menu._buildSaber();
      const counts = {};
      for (const id of ['opt-build', 'opt-bladelen', 'opt-bladewidth', 'sheet-muscle', 'sheet-age']) {
        counts[id] = doc.getElementById(id).listenerCount('input');
      }
      const stacked = Object.entries(counts).filter(([, n]) => n !== 1);
      assert(!stacked.length,
        `listeners stacked after 3 rebuilds: ${stacked.map(([k, n]) => `${k}×${n}`).join(', ')}`);
      assert(menu._bound.get('build').inputs.length === 1,
        `_bound.build holds ${menu._bound.get('build').inputs.length} handles on one input`);
      // The one that has two CONTROLS still has two, because Length is reachable
      // from the forge and from the training panel and they must stay in step.
      assert(menu._bound.get('bladeLength').inputs.length === 2,
        `bladeLength holds ${menu._bound.get('bladeLength').inputs.length} inputs, expected the forge's and the training panel's`);
      // and one drag is one rebuild
      let rebuilds = 0;
      menu._refreshPreview = () => { rebuilds++; };
      const frame = doc.getElementById('opt-build');
      frame.value = '0.7';
      frame.dispatchEvent({ type: 'input' });
      assert(rebuilds === 1, `one drag of Frame cost ${rebuilds} figure rebuilds`);
      return 'after 3 rebuilds: 1 listener each, 1 rebuild per drag';
    } finally { close(); }
  });

  /* ────────────────────────────────────────────────────────────────────
   * WHAT IT SAYS
   * ──────────────────────────────────────────────────────────────────── */

  check('menu: the key-bindings list names each group exactly once', () => {
    const { doc, close } = menuOn();
    try {
      const rendered = [...doc.getElementById('bind-list').children];
      const heads = rendered.filter(el => el.className === 'grp').map(el => el.textContent);
      const dupes = heads.filter((g, i) => heads.indexOf(g) !== i);
      assert(!dupes.length, `group headings rendered twice: ${[...new Set(dupes)].join(', ')}`);
      const groups = [...new Set(ACTIONS.map(a => a.group))];
      assert(heads.length === groups.length, `${heads.length} headings for ${groups.length} groups`);
      // every action has exactly one row, and it is under its own heading
      const rows = new Map();
      let current = null;
      for (const el of rendered) {
        if (el.className === 'grp') { current = el.textContent; continue; }
        rows.set(el.children[0].textContent, current);
      }
      const misfiled = ACTIONS.filter(a => rows.get(a.label) !== a.group);
      assert(!misfiled.length,
        `rows under the wrong heading: ${misfiled.map(a => `${a.label} (${a.group} → ${rows.get(a.label)})`).join(', ')}`);
      // the row that started it: `swap` is declared after the Force block
      const swap = ACTIONS.find(a => a.id === 'swap');
      assert(rows.get(swap.label) === 'Blade', `"${swap.label}" is filed under ${rows.get(swap.label)}`);
      return `${heads.length} headings, ${rows.size} rows, every one under its own group`;
    } finally { close(); }
  });

  check('menu: the Theatre column is honoured, or it says it is not', () => {
    /**
     * THE MECHANISM OUTLIVED ITS ONE USER, which is why this check now
     * installs its own.
     *
     * The Descent took its level from the rung and every one of the thirteen
     * cards stayed live, wrote settings.level, saved it and lit up — a control
     * that is highlighted, saved and thrown away, and the write LEAKED into the
     * next run of another mode, so the level the player picked turned up
     * somewhere they did not. The Descent is deleted; the defect it exposed is
     * not, and the next mode that owns its own ground (Command is one) walks
     * straight back into it.
     *
     * So the switch is a declaration on the mode — `MODES[key].fixedTheatre`,
     * whose value is the sentence shown beside the dead column — and this check
     * drives the real front end through a real mode carrying one. Driving it
     * through a mode name typed into Menu.js is what the old shape did, and it
     * is exactly the hand-maintained-table-beside-its-twin defect.
     */
    MODES.waves.fixedTheatre = 'This trial chooses its own ground: The Ember Shelf → Kamino.';
    try {
      const { menu, settings, doc, close } = menuOn({ mode: 'waves', level: 'scoria' });
      try {
        const list = doc.getElementById('level-list');
        assert(list.classList.contains('inert'), 'the Theatre column is live in a mode that owns the ground');
        const focusable = [...list.children].filter(c => c.tabIndex >= 0);
        assert(!focusable.length, `${focusable.length} discarded cards are still in the tab order`);
        const note = doc.getElementById('level-note');
        assert(note, 'there is no note beside the Theatre column to say the mode owns the choice');
        assert(!note.classList.contains('hidden') && note.textContent.length > 20,
          'nothing on screen says the column is not this mode\'s to choose');
        assert(note.textContent === MODES.waves.fixedTheatre,
          'the note is not the mode\'s own sentence — there is a second copy of it somewhere');
        // and a click on a card cannot write the setting the game will discard
        list.children[3].dispatchEvent({ type: 'click' });
        assert(settings.level === 'scoria', `a discarded card wrote settings.level = ${settings.level}`);
        // …while a mode that does NOT own the ground keeps the column live
        delete MODES.waves.fixedTheatre;
        menu.selectMode('waves');
        assert(!list.classList.contains('inert'), 'the column stayed inert in a mode that does not own it');
        assert(note.classList.contains('hidden'), 'the note is still on screen in a mode that has none');
        list.children[3].dispatchEvent({ type: 'keydown', key: 'Enter' });
        assert(settings.level !== 'scoria', 'the column did not come back to life');
        return 'fixedTheatre → inert, 0 focusable, note is the mode\'s own string; without it → live and writes';
      } finally { close(); }
    } finally { delete MODES.waves.fixedTheatre; }
  });

  check('menu: a mode that takes SOME of the grounds bars the rest and says which', async () => {
    /**
     * THE THIRD SHAPE THE THEATRE COLUMN CAN HAVE, and the switch above could
     * not see it.
     *
     * `fixedTheatre` is all-or-nothing: the mode owns the ground, the column
     * greys, one sentence stands beside it. CAMPAIGN declares neither
     * `fixedTheatre` nor `level`, deliberately — the Theatre column IS its
     * campaign picker — so it fell through as "the mode takes everything", and
     * it takes two of nine. Driven through `World.beginCampaign`, one
     * deployment per card: picking the Ember Shelf, Mustafar, the Drowned Wood,
     * the Shifting Waste, the White Pass, Geonosis or the Providence built that
     * ground, ran the campaign runner, fell through `campaignAt` to the first
     * campaign and moved the player onto the Colosseum on the next frame. SEVEN
     * OF NINE cards lit, saved, and overruled — this method's own words, "a
     * card that is lit, written to settings and then thrown away reads as the
     * picker being randomly broken" — with a whole World built and torn down
     * per deployment on top.
     *
     * `Levels.theatresFor(mode)` is the roster and the MODE declares what feeds
     * it (`level`, `picksCampaign`, or nothing), so there is no mode name in
     * this file and none in Menu.js. What is driven here is the reader, on the
     * real front end, for every shipped mode — and the ORACLE is the run:
     * whether a card is barred is compared against whether `theatreFor` would
     * send the deployment somewhere else, which is the defect stated as a
     * measurement rather than as a list.
     */
    const { theatresFor, theatreFor } = await import('../../src/game/Levels.js');
    const { menu, settings, doc, close } = menuOn({ level: LEVEL_ORDER[0] });
    try {
      const list = doc.getElementById('level-list');
      let narrowed = 0, barredTotal = 0;
      const rows = [];
      /* THE MODES A PLAYER CAN PICK, which is what this check is about: it
       * drives `selectMode` and reads the theatre column. `MODES` also holds
       * destinations reached by a door — the flight deck — whose ground is
       * deliberately not in `LEVEL_ORDER` because it is not a theatre. See
       * `playableModes`. */
      for (const mode of playableModes()) {
        menu.selectMode(mode);
        const cards = [...list.children];
        assert(cards.length === LEVEL_ORDER.length,
          `${cards.length} theatre cards against ${LEVEL_ORDER.length} grounds`);
        const live = theatresFor(mode);
        assert(live.every((k) => LEVEL_ORDER.includes(k)),
          `${mode} offers a ground that is not in LEVEL_ORDER: ${live.join(', ')}`);
        assert(live.length, `${mode} can be started on no ground at all`);
        const inert = list.classList.contains('inert');
        if (inert) { rows.push(`${mode} whole column inert`); continue; }
        const barred = cards.filter((c) => c.classList.contains('barred'));
        barredTotal += barred.length;
        for (const c of cards) {
          const ok = live.includes(c.dataset.level);
          assert(c.classList.contains('barred') === !ok,
            `${mode}: ${c.dataset.level} is ${ok ? 'barred and startable' : 'lit and not startable'}`);
          /* A DEAD CONTROL THAT SAYS NOTHING IS THE DEFECT, not the greying —
           * the same argument `_syncRules` makes about a vetoed rule. */
          if (!ok) {
            assert(c.tabIndex === -1 && c.getAttribute('aria-disabled') === 'true',
              `${mode}: a barred ${c.dataset.level} is still on the keyboard path`);
            const why = c.querySelector('.why');
            assert(why && !why.classList.contains('hidden') && why.textContent.length > 8,
              `${mode}: ${c.dataset.level} is barred and does not say why`);
          }
        }
        /* THE SELECTION SHOWS THE GROUND THAT WILL LOAD, and the SETTING is not
         * touched — writing it would push the player's own theatre out of the
         * store and into the next run of another mode, which is the leak this
         * whole column's note is about. */
        const sel = cards.filter((c) => c.classList.contains('sel')).map((c) => c.dataset.level);
        assert(sel.length === 1 && sel[0] === theatreFor(mode, settings.level),
          `${mode} lights [${sel.join(',')}] and deploys onto ${theatreFor(mode, settings.level)}`);
        if (live.length < LEVEL_ORDER.length) narrowed++;
        rows.push(`${mode} ${live.length}/${LEVEL_ORDER.length}`);
      }
      assert(narrowed >= 1,
        'no mode narrows the Theatre column any more — this check has nothing left to guard');
      assert(barredTotal >= 1, 'nothing is barred anywhere, so the reader was never exercised');

      /* …AND A BARRED CARD CANNOT WRITE THE SETTING THE RUN WILL DISCARD.
       * `pointer-events:none` stops a mouse and not a script, a pad walking DOM
       * focus, or Enter — which is exactly how the first version of this defect
       * survived. */
      const narrowMode = Object.keys(MODES).find((m) => theatresFor(m).length < LEVEL_ORDER.length
        && !MODES[m].fixedTheatre);
      menu.selectMode(narrowMode);
      const dead = [...list.children].find((c) => c.classList.contains('barred'));
      const was = settings.level;
      dead.dispatchEvent({ type: 'click' });
      dead.dispatchEvent({ type: 'keydown', key: 'Enter' });
      assert(settings.level === was,
        `a barred theatre card wrote settings.level = ${settings.level}`);
      const alive = [...list.children].find((c) => !c.classList.contains('barred'));
      alive.dispatchEvent({ type: 'click' });
      assert(settings.level === alive.dataset.level,
        `the live cards stopped writing too: settings.level = ${settings.level}`);
      return `${rows.join(', ')}; ${barredTotal} barred cards over ${narrowed} narrowed mode(s), `
        + `each naming its reason, and none of them writes`;
    } finally { close(); }
  });

  check('menu: the ground the card shows is the ground deploy() loads', async () => {
    /**
     * THE OTHER HALF OF THE CLAUSE ABOVE, on the side the menu cannot see.
     *
     * `deploy()` read `MODES[sessionOr('mode')]?.level ?? sessionOr('level')` —
     * the mode that owns ONE ground, and no other case — so a campaign built
     * whatever the player last picked and `beginCampaign` rotated off it a
     * frame later. Two resolutions of one question is HANDOFF §2.3, and the
     * expensive half is that the losing one still costs a full World.
     *
     * Held as SOURCE because `deploy()` is main.js's and needs a canvas, a
     * renderer and a physics world to run: what is asserted is that the one
     * expression which decides the ground calls the shared resolver, and that
     * the resolver answers the same thing the column shows for every mode.
     */
    const { theatreFor } = await import('../../src/game/Levels.js');
    const decl = /const levelKey = ([^;]+);/.exec(MAIN);
    assert(decl, 'main.js no longer declares `const levelKey` in deploy()');
    assert(/\btheatreFor\(/.test(decl[1]),
      `deploy() resolves the ground as \`${decl[1].trim()}\` — that is a second resolution of the `
      + 'question `Levels.theatreFor` answers, and the column is drawn from the other one');
    assert(/import \{[^}]*\btheatreFor\b[^}]*\} from '\.\/game\/Levels\.js'/.test(MAIN),
      'main.js uses theatreFor without importing it from Levels.js');
    /* …and every mode's answer is a ground the game actually has. */
    const rows = [];
    for (const mode of Object.keys(MODES)) {
      for (const want of LEVEL_ORDER) {
        const got = theatreFor(mode, want);
        assert(LEVELS[got], `${mode} + ${want} resolves to '${got}', which is not a level`);
      }
      rows.push(`${mode}→${theatreFor(mode, LEVEL_ORDER[0])}`);
    }
    return `deploy() resolves through theatreFor; ${rows.join(' ')}`;
  });

  check('menu: a slider offers the numbers the run will take, and no others', () => {
    /**
     * A CONTROL WITH A DEAD ZONE IS A CONTROL THAT LIES, and this one lied on
     * nine of its twenty-five positions.
     *
     * `Your line` opened at 0 against `_planSkirmish`'s floor of
     * OPENING_STRENGTH. Driven through the shipped planner, one battle per
     * position: the slider read "1 of 24", "2 of 24" … "9 of 24" and every one
     * of them fielded TEN bodies. The other two were duplicates rather than
     * lies — `max="24"` typed beside `MAX_STRENGTH = 24`, `max="4"` beside
     * `AREAS.length - 1`, `min="1" max="9"` beside `SKIRMISH.engagements` —
     * which is §2.3's hand-maintained table living in the markup, where nothing
     * that reads the constant can see it.
     *
     * `Menu._range` writes the travel from the tables at build time, so what is
     * held here is that the DOM the player touches agrees with the tables the
     * game clamps by. The other half — that every offered position survives the
     * planner — is in `tools/checks/skirmish.mjs`, which can boot a World; this
     * suite installs a fake `document` and may not await anything.
     */
    const { menu, doc, close } = menuOn();
    try {
      const rows = [];
      const want = [
        ['opt-sk-engagements', SKIRMISH.engagements.min, SKIRMISH.engagements.max, 'SKIRMISH.engagements'],
        ['opt-sk-strength', OPENING_STRENGTH, MAX_STRENGTH, 'OPENING_STRENGTH..MAX_STRENGTH'],
        ['opt-sk-pressure', 0, AREAS.length - 1, 'AREAS'],
      ];
      for (const [id, lo, hi, from] of want) {
        const el = doc.getElementById(id);
        assert(el, `${id} is not in the markup`);
        assert(Number(el.getAttribute('min')) === lo && Number(el.getAttribute('max')) === hi,
          `${id} offers ${el.getAttribute('min')}..${el.getAttribute('max')} against ${from}'s ${lo}..${hi}`);
        /* …AND THE STORED VALUE IS INSIDE IT. A browser clamps `input.value` to
         * the range and leaves `settings[key]` alone, so a profile saved before
         * a bound moved would leave the thumb on one number and the run on
         * another — the same lie one layer along. */
        const held = Number(el.getAttribute('value'));
        assert(held >= lo && held <= hi, `${id}'s markup value ${held} is outside its own ${lo}..${hi}`);
        rows.push(`${id.replace('opt-sk-', '')} ${lo}..${hi}`);
      }
      /* A STORED VALUE FROM AN OLDER BOUND IS NORMALISED, not left to disagree
       * with the thumb. Driven on the real reader with the value the shipped
       * default used to be. */
      menu.s.skirmishStrength = 0;
      menu._range('opt-sk-strength', OPENING_STRENGTH, MAX_STRENGTH, 1, 'skirmishStrength');
      assert(menu.s.skirmishStrength === OPENING_STRENGTH,
        `a stored 0 survived the range as ${menu.s.skirmishStrength} — the thumb reads `
        + `${OPENING_STRENGTH} and the battle would be fought at ${menu.s.skirmishStrength}`);
      /* …and a control whose markup bound is deliberately narrower than what the
       * game accepts must NOT be normalised — the sandbox takes the blade off
       * its leash, and cutting a stored length down to the leashed range would
       * be this fix causing the defect it removes. */
      assert(DEFAULT_SETTINGS.skirmishStrength >= OPENING_STRENGTH
        && DEFAULT_SETTINGS.skirmishStrength <= MAX_STRENGTH,
        `the shipped default line is ${DEFAULT_SETTINGS.skirmishStrength}, outside its own control`);
      return `${rows.join(', ')}, all off their own tables; a stored 0 normalises to ${OPENING_STRENGTH}`;
    } finally { close(); }
  });

  check('menu: the Bloom checkbox tells the truth about the tier', () => {
    // QUALITY.low.bloom is false and main.js ANDs the tier column with the box,
    // so on Performance the checkbox could not change anything — and it still
    // painted itself ticked, with no card or hint saying why.
    assert(QUALITY.low.bloom === false && QUALITY.high.bloom === true,
      'the tier table changed shape; this check is about the tier overruling the box');
    const { doc, close } = menuOn({ quality: 'low', bloom: true });
    try {
      const box = doc.getElementById('opt-bloom');
      assert(box.disabled, 'on Performance the Bloom box is live and does nothing');
      assert(box.checked === false, 'the box shows itself ticked while the tier ignores it');
      const labelEl = doc.getElementById('opt-bloom-label');
      assert(labelEl, 'the Bloom label is a bare text node again, so nothing can rewrite it');
      const label = labelEl.textContent;
      assert(/performance/i.test(label), `the label says "${label}" and never says why`);
      const card = [...doc.getElementById('opt-quality').children][0];
      assert(/no bloom/i.test(card.textContent), 'the Performance card does not say what it removed');
      return `low: disabled, unticked, "${label}"`;
    } finally { close(); }
  });

  check('menu: a tier that allows bloom leaves the checkbox alone', () => {
    const { settings, doc, close } = menuOn({ quality: 'high', bloom: true });
    try {
      const box = doc.getElementById('opt-bloom');
      assert(!box.disabled && box.checked, 'the box is dead on a tier that allows bloom');
      // and moving to Performance and back keeps the player's own answer
      const cards = [...doc.getElementById('opt-quality').children];
      cards[0].dispatchEvent({ type: 'click' });
      assert(box.disabled && settings.bloom === true,
        'picking Performance changed the stored preference instead of overruling it');
      cards[3].dispatchEvent({ type: 'click' });
      assert(!box.disabled && box.checked, 'the preference did not come back with the tier');
      return 'high → live; low → overruled, setting untouched; ultra → live again';
    } finally { close(); }
  });

  check('menu: the standing-order row IS the formation table, and a new order needs no markup', () => {
    /**
     * "A NEW RECORD SHOULD APPEAR THERE FOR FREE" IS A CLAIM, AND THIS IS THE
     * THING THAT MEASURES IT.
     *
     * `_cardRow('command-list', …, Object.values(FORMATIONS))` is written to
     * be derived and index.html carries an EMPTY `<div id="command-list">`, so
     * the row is supposed to follow Command.js by itself. Nothing checked it.
     * The failure it protects against is silent in the direction that matters:
     * `_cardRow` returns quietly when its host is missing, and an order the
     * player cannot pick looks exactly like an order they can — a seventh
     * formation would be bound to a key, listed in the Codex, printed on the
     * controls card, and absent from the one screen where a STANDING order is
     * chosen.
     *
     * Built from the real constructor on a real parse of index.html, and every
     * expectation comes off `FORMATIONS` rather than out of this file: one
     * card per record, in declaration order, each carrying that record's own
     * name and its own blurb. Then one is PICKED, by key, and the settings
     * blob is read back — which is the half a DOM count cannot answer.
     */
    const { menu, settings, doc, close } = menuOn();
    try {
      const records = Object.values(FORMATIONS);
      const cards = [...kids(doc, 'command-list')];
      assert(cards.length === records.length,
        `${cards.length} cards in the standing-order row against ${records.length} formations — `
        + `${records.map((F) => F.name).join(', ')}`);
      const wrong = [];
      records.forEach((F, i) => {
        const text = cards[i].textContent;
        if (!text.includes(F.name)) wrong.push(`${F.id}: card ${i} reads "${text.slice(0, 40)}"`);
        if (F.blurb && !text.includes(F.blurb)) wrong.push(`${F.id}: the card does not carry its own blurb`);
      });
      assert(!wrong.length, wrong.join('; '));

      /* AND PICKING ONE WRITES THE SETTING `commandConfig` READS. The card
       * picked is the LAST record, because a row that has fallen behind the
       * table is short at the end — the position a new order lands in. */
      const last = records[records.length - 1];
      assert(settings.commandFormation !== last.id,
        `the shipped default is already ${last.id}, so picking it proves nothing — `
        + 'this check needs the last card to be a change');
      cards[cards.length - 1].dispatchEvent({ type: 'keydown', key: 'Enter' });
      assert(settings.commandFormation === last.id,
        `picking "${last.name}" left settings.commandFormation at ${settings.commandFormation}`);
      assert(cards.filter((c) => c.classList.contains('sel')).length === 1,
        'two standing orders are lit at once');
      assert(menu._bound.size > 0, 'sanity: the menu is still the one that was built');
      return `${cards.length} cards from ${records.length} formations, in order, each with its own `
        + `blurb; Enter on "${last.name}" wrote commandFormation=${settings.commandFormation}`;
    } finally { close(); }
  });

  check('menu: every setting bound in the Co-op tab is written by its own control', () => {
    /**
     * THE HALF `controls.mjs` CANNOT SEE, AND IT IS WHY `pvp` HID FOR SO LONG.
     *
     * There are two dead-control guards in this repository and both are
     * STRING guards: one matches `_check('opt-…', '…'` against `id="opt-…"`
     * harvested from index.html, the other iterates `DEFAULT_SETTINGS` looking
     * for a reader. Both are satisfied by text sitting in two files, and
     * `_check` returns SILENTLY when `getElementById` misses — so a control in
     * a panel the menu never reaches, or one whose id the markup spells
     * differently, passes both of them while doing nothing at all.
     *
     * This drives the box. Every checkbox inside the Co-op panel is found in
     * the built page, matched to the setting `Menu` bound it to, toggled
     * through its own `change` listener, and the settings blob is read back.
     * Derived from the PANEL rather than from a list of ids, so the next
     * session rule is covered the day somebody adds it.
     */
    const { menu, settings, doc, close } = menuOn();
    try {
      const panel = doc.querySelector('section[data-panel="coop"]');
      assert(panel, 'index.html has no Co-op panel at all');
      const boxes = panel.querySelectorAll('input[type="checkbox"]');
      assert(boxes.length > 0,
        'the Co-op tab holds no switch of its own — a session has a code and no rules, and '
        + '`settings.pvp` is read by every damage path in the game with nothing able to write it');
      /* The binding is read out of the built Menu rather than out of the
       * source: `_check` writes the value on `change`, so the setting a box
       * really owns is whichever one MOVES when the box does. */
      const rows = [];
      for (const box of boxes) {
        assert(box.id, 'a checkbox in the Co-op tab has no id, so nothing can bind to it');
        const before = { ...settings };
        box.checked = !box.checked;
        box.dispatchEvent({ type: 'change' });
        const moved = Object.keys(settings).filter((k) => settings[k] !== before[k]);
        assert(moved.length === 1,
          `#${box.id} moved ${moved.length} settings (${moved.join(', ') || 'none'}) — a control that `
          + 'writes nothing is the defect this check exists for, and one that writes two is worse');
        assert(settings[moved[0]] === box.checked,
          `#${box.id} is ${box.checked} and it wrote ${settings[moved[0]]} to ${moved[0]}`);
        assert(moved[0] in DEFAULT_SETTINGS,
          `#${box.id} writes ${moved[0]}, which is not a key of DEFAULT_SETTINGS — a setting with no `
          + 'default is invisible to both of controls.mjs\'s dead-control guards');
        rows.push(`#${box.id} → ${moved[0]}`);
        box.checked = !box.checked;
        box.dispatchEvent({ type: 'change' });
      }
      assert(menu._bound.size > 0, 'sanity: the menu is still the one that was built');
      return `${boxes.length} switch(es) in the Co-op tab, each writing exactly one setting: `
        + rows.join(', ');
    } finally { close(); }
  });

  check('menu: the roster prints a name, not whatever the wire sent', () => {
    const { menu, doc, close } = menuOn();
    try {
      menu.netRoster([{ name: '<img src=x onerror=alert(1)>', host: true }, { name: 'Ben' }]);
      const rows = doc.getElementById('net-roster').children;
      assert(rows.length === 2, `${rows.length} roster rows`);
      assert(!rows[0].querySelectorAll('img').length, 'a peer name became markup in the roster');
      assert(rows[0].textContent.includes('<img'), 'the name was dropped rather than escaped');
      assert(rows[1].textContent.includes('Ben'), 'an ordinary name did not survive');
      return 'a scripted name renders as text; an ordinary one renders as itself';
    } finally { close(); }
  });

  check('menu: co-op has a name, and it reaches the wire', () => {
    const { settings, hooks, doc, close } = menuOn();
    try {
      const field = doc.getElementById('opt-name');
      assert(field, 'there is still no name field in the co-op panel');
      field.value = 'Ahsoka';
      field.dispatchEvent({ type: 'input' });
      assert(settings.playerName === 'Ahsoka', `the field wrote ${JSON.stringify(settings.playerName)}`);
      assert(hooks.fired.some(([n, v]) => n === 'onName' && v === 'Ahsoka'), 'the name change told nobody');
      // …and the three seams that used to pass net.name back into itself
      const main = MAIN;
      assert(/const playerName = \(\)/.test(main), 'main.js has no name seam');
      const uses = (main.match(/playerName\(\)/g) || []).length;
      assert(uses >= 3, `only ${uses} of host/join/spawn read the player's name`);
      assert(!/net\.name \|\| 'Jedi'/.test(main), "main.js still passes net.name back into net.host/join");
      return `field → settings.playerName → ${uses} call sites`;
    } finally { close(); }
  });

  check('menu: the Codex quotes the game the player is in', () => {
    const { doc, close } = menuOn();
    try {
      const codex = doc.getElementById('codex-grid').textContent;
      const focusRow = codex.split('\n').join(' ');
      assert(/Focus/.test(focusRow), 'the Codex has no Focus row');
      // The round that deepened the slow-motion moved FOCUS.heldScale 0.35 →
      // 0.18 and left the only page that teaches the game saying "a third".
      assert(!/slows to a third/i.test(codex), 'the Codex still says the world slows to a third');
      assert(codex.includes(`${(FOCUS.heldScale * 100).toFixed(0)}%`),
        `the Codex does not name the real ratio (${(FOCUS.heldScale * 100).toFixed(0)}%)`);
      assert(codex.includes(String(FOCUS.drain)), 'the Codex does not name what Focus costs');
      // The dojo was deleted with no alias; two hints still sent players there.
      const panels = doc.querySelectorAll('.panel');
      const all = panels.map(p => p.textContent).join(' ');
      assert(!/\bdojo\b/i.test(all), 'the menu still sends the player to the Dojo');
      // and the dead `L.training` signpost, which no level has carried since
      // the flag was removed from Levels.js
      assert(!/start here/i.test(all), 'the "start here" pill is back, on a flag no level sets');
      return `Focus quoted as ${(FOCUS.heldScale * 100).toFixed(0)}% / ${FOCUS.drain} Force/s, no dojo, no dead signpost`;
    } finally { close(); }
  });

  check('menu: the Codex prices the kit off the price list, not off prose', () => {
    /**
     * ELEVEN FORCE POWERS, ELEVEN CODEX ROWS, AND NOT ONE NUMBER ON ANY OF
     * THEM. "Force push." was the whole of what the page that teaches this game
     * said about a 20-Force power, next to "Unleash — … costs more than any
     * other power", which is a claim ABOUT THE PRICE LIST typed beside it in a
     * file that cannot read one.
     *
     * `Powers.js` exists precisely so two surfaces can share one price list —
     * its header records the HUD's private duplicate carrying lightning at 14
     * against a real 30 — and the Codex was the third surface, which had solved
     * the problem by saying nothing. Every price on the page is now
     * `POWER_COST[id]`, keyed on the row's own action id, and the two gated
     * powers name their card off `boonById` instead of typing "Force Lightning"
     * into prose.
     *
     * The bound is BOTH DIRECTIONS: every priced thing appears, and nothing
     * appears that is not in a table. A twelfth power with no chip fails here,
     * and so does a chip somebody typed.
     */
    const html = codexHtml(defaultBindings());
    const chips = [...html.matchAll(/<em class="cost">([^<]*)<\/em>/g)].map((m) => m[1]);
    const gates = [...html.matchAll(/<em class="cost gate">([^<]*)<\/em>/g)].map((m) => m[1]);

    const missing = Object.entries(POWER_COST)
      .filter(([, cost]) => !chips.includes(`${cost} Force`));
    assert(!missing.length,
      `powers the Codex documents with no price: ${missing.map(([id]) => id).join(', ')}`);
    /**
     * A SUPPORT CALL IS PRICED IN SUPPORT AND NOT IN FORCE, and this check used
     * to demand the opposite.
     *
     * `Stratagems._open` has spent `world.support` since the player asked for
     * it by name — "strategems should not cost force how does that even
     * fucking make sense?" — and the Codex chip went on printing `s.cost`
     * followed by the word Force for a currency nothing charges. That is a page
     * quoting a price list the game does not use, which is the exact failure
     * this check's own header is about, pointing the other way. `supportCost`
     * is the one derivation and is asked rather than re-derived here.
     */
    const strats = STRATAGEMS.filter((S) => !chips.includes(`${supportCost(S)} support`));
    assert(!strats.length,
      `support calls the Codex documents with no price: ${strats.map((S) => S.id).join(', ')}`);
    /* THE THIRD PRICED TABLE. `COMMAND_FORCE`'s two verbs — Rally and Dread —
     * were in NO list a player could read: they exist only as captions on the
     * order wheel, and the Codex's own Command block counted `ORDER_ACTIONS`
     * (the orders that have a key, which is formations only) and therefore
     * said "the 7 orders" about a wheel with ten slots. They are documented
     * rows now, so they are held to the same both-directions bound as a power
     * and a stratagem. */
    const verbs = Object.values(COMMAND_FORCE).filter((P) => !chips.includes(`${P.cost} Force`));
    assert(!verbs.length,
      `command Force orders the Codex does not price: ${verbs.map((P) => P.id).join(', ')}`);
    /* Nothing typed: every chip's number is somebody's `cost` field. */
    const priced = new Set([
      ...[...Object.values(POWER_COST),
        ...Object.values(COMMAND_FORCE).map((P) => P.cost)].map((c) => `${c} Force`),
      ...STRATAGEMS.map((S) => `${supportCost(S)} support`),
    ]);
    const stray = chips.filter((c) => !priced.has(c));
    assert(!stray.length, `price chips that came from no table: ${[...new Set(stray)].join(', ')}`);
    const want = Object.keys(POWER_COST).length + STRATAGEMS.length + Object.keys(COMMAND_FORCE).length;
    assert(chips.length === want,
      `${chips.length} price chips against ${Object.keys(POWER_COST).length} powers, `
      + `${STRATAGEMS.length} support calls and ${Object.keys(COMMAND_FORCE).length} Force orders — `
      + 'one of them is priced twice or not at all');

    /* The gates are the two boon-locked powers plus whatever the support-call
     * table marks `commandOnly`, and they name the CARD rather than a string.
     * A THIRD KIND joined them with the release ladder: eleven of the eighteen
     * calls are held until the battle has earned them, which is neither "it is
     * expensive" nor "you need an army" and needs a chip of its own. See
     * RELEASE in src/game/Stratagems.js. */
    const wantGates = Object.values(POWER_BOON).length
      + STRATAGEMS.filter((S) => S.commandOnly).length
      + STRATAGEMS.filter((S) => (S.earn ?? 0) > 0).length
      // …and both Force orders, which need an army by definition: there is
      // nobody to rally and nothing to lead without one.
      + Object.keys(COMMAND_FORCE).length;
    assert(gates.length === wantGates,
      `${gates.length} gate chips against ${wantGates} gated calls`);
    assert(!/\bForce Lightning\b/.test(html.replace(/<em class="cost gate">[^<]*<\/em>/g, '')),
      'the Codex still types a boon name into its prose');
    return `${chips.length} prices and ${gates.length} gates, all off POWER_COST / STRATAGEMS; `
      + `push ${POWER_COST.push} · unleash ${POWER_COST.unleash} with nothing typed`;
  });

  check('menu: no page-facing number competes with the generated one that owns it', () => {
    /**
     * A HAND-TYPED NUMBER BESIDE ITS GENERATED TWIN — HANDOFF §2.3, on the one
     * screen whose whole job is to be believed.
     *
     * The Codex grid's parry row said "inside 0.2 s". That is `PARRY_GRADE.window`
     * BEFORE `parryScale(difficulty)` touches it, and the shipped windows are
     * padawan 320 ms, knight 250 (the default), master 200, grandmaster 172 —
     * so it was wrong on three tiers of four and 25% pessimistic on the tier
     * most players are on. Thirteen lines below it, in the same panel,
     * `codexTeaching` printed 250 ms and 125 ms off the same two constants.
     * One screen, two numbers, and the typed one was the wrong one.
     *
     * So: the GRID may not quote a duration at all — the panel that knows the
     * difficulty owns that — and the PANEL's numbers must move with the tier.
     */
    const grid = codexHtml(defaultBindings());
    const times = [...grid.matchAll(/(\d+(?:\.\d+)?)\s*(?:&nbsp;)?\s*(ms|s)\b/g)];
    /* Every duration left in the grid has to be DERIVABLE from a table this
     * file can also read — that is the whole test. The parry window is not,
     * because `codexHtml` is handed bindings and a pad and has no difficulty to
     * scale it with; CATCH's three, the two Force orders' timers and the
     * stratagem gap all are, so the allowed set is built from those tables
     * rather than from a list of numbers, and a typed one has nowhere to hide. */
    const derivable = new Set([
      `${Math.round(CATCH.hold * 1000)}`, `${CATCH.maxOpen.toFixed(2)}`,
      `${CATCH.autoGuard.toFixed(2)}`, `${CODE_GAP}`,
      ...Object.values(COMMAND_FORCE).flatMap(P => [`${P.seconds}`, `${P.cd}`]),
      /* THE WITHDRAWAL'S TWO. Neither is scaled by difficulty — the ship holds
       * its ramp for the same time on every tier, which is what makes them
       * safe on a page that has no difficulty to read. They come off
       * Extraction.js for the same reason everything else in this set does:
       * tune either and the row retunes, and a typed one still has nowhere to
       * hide. */
      `${WITHDRAW_HOLD}`, `${Math.round(LAST_CALL)}`,
      /* THE FIRE MISSION'S TWO, and they are the same case as the withdrawal's.
       * The Codex row for AUTHORISE prints what reading a mark costs — on foot
       * and under Force sense — and both come off `FireMission.js` at the row
       * (`READ_SECONDS`, and it divided by `SENSE_RATE`). Neither is scaled by
       * difficulty. This set is the half of the contract that lives out here:
       * a row derived from a table nothing in this file reads is indistinguish-
       * able from a typed one, which is why the 4 was flagged while the 12
       * beside it happened to collide with a Force order's timer and was not. */
      `${READ_SECONDS}`, `${(READ_SECONDS / SENSE_RATE).toFixed(0)}`,
      /* THE WARD'S WAIT AND THE RESTORE'S. Both rows print their cooldown off
       * the table the power reads (`Player.ALLY_WARD`, `Player.RESTORE`), and
       * neither is scaled by difficulty — a cooldown is a cooldown on every
       * tier — so they are the same case as the withdrawal's two. */
      `${ALLY_WARD.cooldown}`, `${RESTORE.cooldown}`,
    ]);
    const stray = times.map(m => m[1]).filter(v => !derivable.has(v));
    assert(!stray.length,
      `the Codex grid types the durations ${[...new Set(stray)].join(', ')} — a duration that is not `
      + 'read off a table is a number that will be right on one difficulty');
    // …and the window really does differ across tiers, so "the panel owns it"
    // is a fact and not a slogan.
    const win = (d) => Number((codexTeaching({ difficulty: d }).match(/inside (\d+) ms/) || [])[1]);
    const tiers = Object.keys(DIFFICULTY);
    const windows = tiers.map(win);
    assert(windows.every(Number.isFinite), 'the teaching panel stopped printing a parry window');
    assert(new Set(windows).size === tiers.length,
      `${tiers.length} difficulties produce ${new Set(windows).size} distinct parry windows`);
    for (let i = 0; i < tiers.length; i++) {
      const want = Math.round(PARRY_GRADE.window * parryScale(DIFFICULTY[tiers[i]]) * 1000);
      assert(windows[i] === want, `${tiers[i]} reads ${windows[i]} ms and the game gives ${want} ms`);
    }
    return `grid: 0 typed durations left (${times.length} all derived); panel: `
      + tiers.map((t, i) => `${t} ${windows[i]}ms`).join(', ');
  });

  check('menu: the wheel, the two Force orders and the dive are all on a page', () => {
    /**
     * THREE THINGS THE GAME HAD AND NO SCREEN MENTIONED.
     *
     *   THE WHEEL'S COUNT   `HUD.OrderWheel` is constructed with `ORDERS` =
     *                       `{...FORMATIONS, ...COMMAND_FORCE}` — nine — plus a
     *                       hold-ground slot, so it has ten. The Codex said
     *                       "the 7 orders", because it counted `ORDER_ACTIONS`,
     *                       the registry of orders that have a KEY, and only
     *                       formations do. The block's own comment claimed its
     *                       rows come off the table "so a seventh entry appears
     *                       the day it is authored"; it read the wrong table.
     *   RALLY AND DREAD     existed in no list a player could read — not the
     *                       grid, not the teaching panel, nowhere but a wheel
     *                       caption they have to hold the wheel open to see.
     *   THE DIVE            `Player._tryDive` is real and checked, and had no
     *                       key of its own, no row and no sentence anywhere.
     *
     * Held against the TABLES, so a third Force verb has to be documented the
     * day it is authored — which is what the block always claimed to do.
     */
    const grid = codexHtml(defaultBindings());
    const text = grid.replace(/<[^>]*>/g, ' ');
    const wheelRow = grid.split('</div>').find(r => /Order wheel/.test(r)) || '';
    assert(wheelRow.includes(String(Object.keys(COMMAND_ORDERS).length)),
      `the wheel row does not name ${Object.keys(COMMAND_ORDERS).length} — the size of the table `
      + `the wheel is handed — it says "${wheelRow.replace(/<[^>]*>/g, ' ').trim().slice(0, 90)}"`);
    for (const P of Object.values(COMMAND_FORCE)) {
      const row = grid.split('</div>').find(r => r.includes(`<b>${P.name}</b>`));
      assert(row, `${P.id} is on the order wheel and in no list a player can read`);
      for (const [what, want] of [['radius', P.radius], ['recovery', P.cd], ['duration', P.seconds]]) {
        assert(row.includes(String(want)),
          `${P.id}'s row never states its ${what} (${want}) — it is a caption, not a page`);
      }
      assert(row.includes(`${P.cost} Force`), `${P.id}'s row is not priced`);
    }
    // The dive: named, and named where the input that fires it is described.
    assert(/\bdive\b/i.test(text), 'the aerial dive is taught on no screen at all');
    return `wheel says ${Object.keys(COMMAND_ORDERS).length} orders; `
      + `${Object.keys(COMMAND_FORCE).length} Force orders documented with cost, reach, `
      + 'duration and recovery; the dive has a sentence';
  });

  check('menu: catch-and-throw — the answer to the loudest complaint — is taught', () => {
    /**
     * `Combat.js`'s CATCH block states outright that it exists to remove the
     * contradiction the player reported in their own words: "I don't understand
     * how you're supposed to block and also aim at an enemy in the same motion
     * because when you're moving the blade to specifically deflect the cursor
     * can't move." A search of every player-facing string in the project —
     * index.html plus both halves of the Codex, 25 236 characters — for
     * `stick`, `caught`, `catch`, `holds the bolt`, `camera comes back`,
     * `auto-guard` and `six bolts` found NONE of them. The mechanic shipped and
     * no screen said it existed, and a player who lets go of the guard on
     * contact — which every other sentence on the page teaches — never meets it.
     *
     * Every number is held to CATCH so the teaching cannot drift from the
     * mechanic, and the Codex's own "four answers to a bolt" is held to
     * mentioning the fifth.
     */
    const page = codexHtml(defaultBindings()) + '\n' + codexTeaching({});
    assert(/\bcatch(es)?\b/i.test(page), 'nothing on either half of the Codex says a bolt can be held');
    for (const [what, want] of [
      ['the hold', `${Math.round(CATCH.hold * 1000)}`],
      ['how many at once', `${CATCH.maxHeld}`],
      ['the ceiling', `${CATCH.maxOpen.toFixed(2)}`],
      ['the auto-guard', `${CATCH.autoGuard.toFixed(2)}`],
      ['the cone', `${Math.round(CATCH.autoCone * 360 / Math.PI)}`],
    ]) {
      assert(page.includes(want), `the Codex never states ${what} (${want}) from CATCH`);
    }
    // …and the half that answers the complaint: the camera comes back to you.
    assert(/camera comes back/i.test(page),
      'the page teaches the catch without the reason it exists — that you aim AFTER the block');
    const four = codexTeaching({});
    assert(/answers to a bolt/.test(four) && /\bcatch(es)?\b/i.test(four),
      '"The four answers to a bolt" still never mentions that a bolt can be held');
    return `catch taught with all five CATCH numbers: ${Math.round(CATCH.hold * 1000)}ms hold, `
      + `${CATCH.maxHeld} bolts, ${CATCH.maxOpen.toFixed(2)}s ceiling, `
      + `${CATCH.autoGuard.toFixed(2)}s cone at ${Math.round(CATCH.autoCone * 360 / Math.PI)}°`;
  });

  check('menu: a mode that throws the run rules away greys the column and says so', () => {
    /**
     * index.html promises, unconditionally, that the run rules "are in force
     * from the first wave". Measured against the shipped composer:
     * `legalRuleSet` accepts them in all EIGHT modes and exactly FIVE honour
     * them. `_compose` returns into `_composeDuel` twenty-seven lines before
     * the rules are unioned in, so a duel's wave-6 conditions are `[]`;
     * `start()` returns before `_compose` at all in sandbox; and training runs
     * a `DojoDirector`, which has no composer to reach at all. So in three
     * modes a player lights up to four cards, watches them written to
     * settings, and fights a run that has never heard of them.
     *
     * `_syncTheatre` already had the answer in its own words — "a card that is
     * lit, written to settings and then thrown away reads as the picker being
     * randomly broken" — and this is the same switch on the same shape:
     * `MODES[key].fixedRules` is declared by the mode and read here. The
     * STRINGS belong on MODES in src/game/Waves.js, which this lane does not
     * own; what is held here is the reader, driven with a mode that declares
     * one, so the day the three strings land the column greys with no edit in
     * Menu.js.
     */
    // Which modes actually honour a rule, asked of the shipped composer rather
    // than listed here — the list is the thing that would go stale.
    const honours = (mode) => {
      const d = new WaveDirector(
        { enemies: [], players: [], settings: {}, takenBoons: new Set(), spawnEnemy: () => ({}) },
        { mode, pool: LEVELS[LEVEL_ORDER[0]].pool, rules: [] });
      d.rules = d.legalRuleSet([...CONDITION_KEYS]);
      if (!d.rules.length) return false;
      /* Through `start()`, not straight into `_compose()`: sandbox's refusal is
       * a `return` in start() twenty lines ABOVE the composer, so a probe that
       * calls the composer directly reports sandbox as honouring rules it will
       * never see. Training is deaf a layer further out again — main.js builds
       * a `DojoDirector` there, which has no composer at all — and no probe
       * that holds a WaveDirector can see that one. */
      try { d.start(6); } catch { return false; }
      return (d.conditions || []).length > 0;
    };
    const deaf = Object.keys(MODES).filter(m => !honours(m));
    assert(deaf.length, 'every mode now honours the rules — this check has nothing left to guard');

    const { menu, doc, close } = menuOn();
    try {
      const list = doc.getElementById('rule-list');
      const note = doc.getElementById('rule-note');
      const promise = note.textContent;
      // A mode that honours them: live column, the shipped promise intact.
      menu.s.mode = Object.keys(MODES).find(m => honours(m));
      menu._syncRules();
      assert(!list.classList.contains('inert'),
        `the column is greyed in ${menu.s.mode}, which honours the rules`);
      assert(note.textContent === promise, 'the shipped note was overwritten by a mode that is fine');

      /* THE READER, driven with a declared refusal. Injected onto the real
       * MODES record rather than faked, and removed again: this is the exact
       * field src/game/Waves.js is being asked to carry, and pinning the
       * reader is the half this lane can hold. */
      const target = deaf[0];
      const REASON = 'Not in a duel: the run is composed one opponent at a time.';
      /* PUT BACK WHAT WAS THERE, which is not the same as deleting.
       *
       * The `finally` below used to `delete MODES[target].fixedRules`
       * unconditionally, and `deaf[0]` is `duel` — a mode that SHIPS one. So
       * this check removed a real field from a module-scope record for the rest
       * of the process, and `runrules`'s "a mode whose composer never sees a
       * rule declares it" — which runs after `menu` in readdir order — then read
       * duel as deaf and undeclared and failed on it. Green alone, red in the
       * gate; `tools/_seq.mjs menu runrules` is the two-suite reproduction. */
      const had = Object.prototype.hasOwnProperty.call(MODES[target], 'fixedRules');
      const was = MODES[target].fixedRules;
      MODES[target].fixedRules = REASON;
      try {
        menu.s.mode = target;
        menu._syncRules();
        assert(list.classList.contains('inert'),
          `${target} declares it throws the rules away and the column is still live`);
        assert(note.textContent === REASON,
          `the column still promises "${note.textContent}" in a mode that ignores it`);
        const cards = [...list.children];
        assert(cards.length && cards.every(c => c.classList.contains('barred')),
          `${cards.filter(c => !c.classList.contains('barred')).length} cards are still pickable`);
        assert(cards.every(c => c.getAttribute('aria-disabled') === 'true' && c.tabIndex === -1),
          'a greyed card is still on the keyboard path');
        assert(cards.every(c => c.querySelector('.txt span').textContent === REASON),
          'a barred card does not say WHY — that is the silent dead control again');
      } finally { if (had) MODES[target].fixedRules = was; else delete MODES[target].fixedRules; }

      // …and it comes back when the mode does.
      menu.s.mode = Object.keys(MODES).find(m => honours(m));
      menu._syncRules();
      assert(!list.classList.contains('inert') && note.textContent === promise,
        'the column stayed greyed after moving back to a mode that honours the rules');
      return `${Object.keys(MODES).length} modes, ${deaf.length} deaf to the rules `
        + `(${deaf.join(', ')}); the reader greys, names the reason on every card, and comes back`;
    } finally { close(); }
  });

  check('menu: the seed box plays the number it is showing', () => {
    /**
     * THE WHOLE POINT OF THE FIELD is that the number you read out is the
     * number that composed the waves. It stored `Number(clean) >>> 0` against a
     * ten-digit box, so 9999999999 was played as 1410065407 while the box went
     * on showing 9999999999 — two typed seeds, one run, and nothing on screen
     * saying so.
     *
     * Held as an IDENTITY between what is shown and what is stored, over the
     * boundary values of the 32-bit stream `main.js` seeds, so it cannot be
     * satisfied by a different truncation next time.
     */
    const { menu, settings, doc, close } = menuOn();
    try {
      const field = doc.getElementById('opt-seed');
      assert(field, 'index.html has no #opt-seed');
      const type = (v) => { field.value = v; field.dispatchEvent({ type: 'input' }); };
      const MAX = 0xFFFFFFFF;
      for (const typed of ['1234', String(MAX), String(MAX + 1), '9999999999', '12x34', '']) {
        type(typed);
        const shown = field.value;
        assert(settings.seed === (shown === '' ? null : Number(shown)),
          `the box shows "${shown}" and the run will be seeded ${settings.seed}`);
        if (settings.seed !== null) {
          assert(Number.isInteger(settings.seed) && settings.seed >= 0 && settings.seed <= MAX,
            `"${typed}" stored ${settings.seed}, which is not a 32-bit seed`);
          assert((settings.seed >>> 0) === settings.seed,
            `"${typed}" stored a value the stream will change under the player`);
        }
      }
      // and the two seeds that used to collide no longer do
      type(String(MAX + 1)); const a = settings.seed; const aShown = field.value;
      type('9999999999'); const b = settings.seed;
      assert(a === b ? aShown === field.value : true,
        'two typed seeds still map to one run while showing different numbers');
      return `1234, ${MAX}, ${MAX + 1}, 9999999999, "12x34" and empty — the box and the run `
        + 'agree on every one';
    } finally { close(); }
  });

  check('menu: a stored setting of the wrong TYPE cannot reach the engine', () => {
    /**
     * `loadSettings` normalised three fields — the blade ceiling, the face
     * sheet, the wardrobe — and type-checked none of the other 73. Nothing
     * reachable through today's controls writes the wrong shape, which is
     * exactly what makes it the next schema change's trap: measured, a stored
     * `fov: "wide"` went straight through to `camera.fov` and produced a NaN
     * projection matrix — a black screen with no error — and
     * `bladeLength: "long"` came back NaN through the ceiling clamp already
     * standing there.
     *
     * Driven over EVERY key in DEFAULT_SETTINGS with a value of the wrong
     * shape, so a setting added tomorrow is covered by the same clause on the
     * day it is added. The expectation is derived from the DEFAULT's own type,
     * not from a schema typed here.
     */
    const store = new Map();
    const real = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    try {
      const scalars = Object.entries(DEFAULT_SETTINGS)
        .filter(([, v]) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string'
          || Array.isArray(v));
      assert(scalars.length > 60, `only ${scalars.length} scalar settings — the fixture found nothing`);
      const POISON = ['wide', {}, [], NaN, null, undefined, Infinity, '12'];
      let cases = 0;
      for (const [key, def] of scalars) {
        for (const bad of POISON) {
          store.clear();
          store.set(STORE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, [key]: bad }));
          const s = loadSettings();
          cases++;
          const v = s[key];
          if (Array.isArray(def)) {
            assert(Array.isArray(v) && v.every(x => typeof x === 'string'),
              `${key}: ${JSON.stringify(bad)} survived as ${JSON.stringify(v)}`);
          } else {
            assert(typeof v === typeof def, `${key}: ${JSON.stringify(bad)} came back as `
              + `${typeof v} ${JSON.stringify(v)} against a ${typeof def} default`);
            if (typeof def === 'number') {
              assert(Number.isFinite(v), `${key}: ${JSON.stringify(bad)} came back as ${v}`);
            }
          }
        }
      }
      // …and the specific one that was measured, end to end.
      store.clear();
      store.set(STORE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, fov: 'wide', bladeLength: 'long' }));
      const s = loadSettings();
      assert(Number.isFinite(s.fov) && Number.isFinite(s.bladeLength),
        `fov ${s.fov} and bladeLength ${s.bladeLength} still reach the camera`);
      // A legal blob is untouched — this is a type guard, not a reset button.
      store.clear();
      const chosen = { ...DEFAULT_SETTINGS, fov: 78, sfxVolume: 0.31, popups: false, quality: 'low' };
      store.set(STORE_KEY, JSON.stringify(chosen));
      const kept = loadSettings();
      for (const k of ['fov', 'sfxVolume', 'popups', 'quality']) {
        assert(kept[k] === chosen[k], `a legal ${k} of ${chosen[k]} was reset to ${kept[k]}`);
      }
      return `${scalars.length} scalar settings x ${POISON.length} wrong shapes = ${cases} loads, `
        + 'every one the type its default is; four deliberate choices untouched';
    } finally { globalThis.localStorage = real; }
  });

  check('menu: the Codex teaches the ladder and the purse in the numbers the game uses', () => {
    /**
     * "The four things that make a master" was four hand-written paragraphs
     * with not one number in them, under a keybind grid, in a game whose skill
     * curve IS four graded outcomes separated by measured thresholds and whose
     * progression IS a price series. Every threshold is an exported constant
     * two other suites already measure the game against; the page that teaches
     * the game was the only reader that did not have them.
     *
     * Two properties are worth holding and neither is "the string says X":
     *
     *   IT MOVES WITH THE TRIAL. Both parry windows scale by `parryScale`, so
     *   Padawan and Grandmaster must produce DIFFERENT pages and each must
     *   carry its own arithmetic. A page that quoted 200 ms to everybody would
     *   pass any single-tier assertion.
     *
     *   IT MOVES WITH THE MODE. `insightRate` pays the Trial four times what
     *   Path of the Blade is paid and the Trial drafts nothing, so one typed
     *   rate would be wrong in whichever mode it was not written for.
     */
    const dir = (mode) => new WaveDirector(
      { enemies: [], players: [], settings: {}, takenBoons: new Set() },
      { mode, pool: ['b1'], rules: [] });
    const text = (o) => codexTeaching(o).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ');

    /* The four rungs are named off GRADE_NAME, so a fifth grade in Combat.js
     * cannot appear in the game and stay off the page that teaches it. */
    const path = text({ difficulty: 'knight', director: dir('roguelite') });
    for (const g of GRADE_NAME) {
      assert(path.includes(g), `the ladder does not name the ${g} grade`);
    }
    for (const [what, v] of [['driven', SPEED_GRADE.driven], ['closing', SPEED_GRADE.closing],
      ['return', SPEED_GRADE.return], ['perfect', SPEED_GRADE.perfect]]) {
      assert(path.includes(String(v)), `the ladder never states the ${what} gate (${v})`);
    }

    /* THE WINDOWS MOVE WITH THE TIER, and they are the tier's own arithmetic. */
    const windows = {};
    for (const key of ['padawan', 'grandmaster']) {
      const t = text({ difficulty: key, director: dir('roguelite') });
      const scale = parryScale(DIFFICULTY[key]);
      const want = Math.round(PARRY_GRADE.window * scale * 1000);
      const sharp = Math.round(PARRY_GRADE.perfect * scale * 1000);
      assert(t.includes(`${want} ms`),
        `at ${key} the parry window is ${want} ms and the Codex does not say so`);
      assert(t.includes(`${sharp} ms`),
        `at ${key} a perfect needs ${sharp} ms and the Codex does not say so`);
      assert(t.includes(DIFFICULTY[key].name), `the page does not say which trial it is quoting`);
      windows[key] = want;
    }
    assert(windows.padawan !== windows.grandmaster,
      `every trial reads ${windows.padawan} ms — the page is not scaling with the tier at all`);

    /* THE PURSE MOVES WITH THE MODE. */
    const trial = text({ difficulty: 'knight', director: dir('waves') });
    for (const [mode, page] of [['roguelite', path], ['waves', trial]]) {
      const d = dir(mode);
      const rate = insightRate(d.drafts);
      assert(page.includes(`+${rate.per} Insight`),
        `${MODES[mode].name} pays ${rate.per} a wave and its page does not say so`);
      assert(page.includes(String(insightAfter(40, BOSS_EVERY, rate))),
        `${MODES[mode].name} has earned ${insightAfter(40, BOSS_EVERY, rate)} by wave 40 and the `
        + 'page does not say so');
      assert(page.includes(MODES[mode].name), 'the purse table does not name the mode it describes');
    }
    assert(!trial.includes(`+${insightRate(true).per} Insight,`),
      'the Trial page is quoting the drafting mode\'s rate');
    /* The draft cadence is COUNTED off `isDraftWave` — HANDOFF §2.4 is a whole
     * section about an instrument that restated that rule and manufactured a
     * defect out of the difference. */
    let cards = 0;
    for (let w = 1; w <= 20; w++) if (dir('roguelite').isDraftWave(w)) cards++;
    assert(path.includes(String(cards)),
      `${cards} cards are drafted by wave 20 and the page does not say so`);
    assert(/none in this mode/.test(trial), 'the Trial page does not say that it drafts nothing');

    /* And the prices: the base tiers and the escalator, off LivingForce. */
    for (const r of ['common', 'rare', 'epic']) {
      assert(path.includes(String(FACET_COST[r])), `the page never states the ${r} price`);
    }
    assert(path.includes(`+${COST_STEP}`), 'the page never states the escalator');

    /* A mode that never clears a wave must not be shown a purse table at all —
     * `World._earnInsight` hangs off `onWaveClear` and the sandbox never fires
     * one, so every number in that block would be a rate nothing is paid at. */
    const box = text({ difficulty: 'knight', director: dir('sandbox') });
    assert(/never clears one/.test(box) && !box.includes('The escalator'),
      'the sandbox is shown a purse table for a loop it does not have');
    return `ladder off GRADE_NAME with ${GRADE_NAME.length} rungs; parry window `
      + `${windows.padawan} ms padawan / ${windows.grandmaster} ms grandmaster; `
      + `purse ${insightRate(true).per}/wave with ${cards} cards by w20, Trial `
      + `${insightRate(false).per}/wave with none; sandbox shown no purse`;
  });

  check('menu: the way into the Holocron is a button, not a strip', () => {
    // Pure cascade, so it is read off the cascade. `.primary/.secondary/.ghost`
    // are `display:block; width:100%` because they are laid out in a column, so
    // a bare .ghost fills whatever line it is on: this button was once 100vw
    // wide, hanging 22px off the right edge, a live click target across the
    // whole screen at z-index 41 over the menu's 40. `width:auto` is what fixed
    // that and is the whole of what this check is still for.
    //
    // IT NO LONGER ASSERTS `position:fixed`, and the reason is the defect that
    // followed. Fixed at left:22 bottom:20, the button was positioned against
    // the VIEWPORT while the #gpu-line it landed on lives inside the centred
    // `.menu-wrap` — measured overlap in Chromium 1366x768 2482 px², 1280x720
    // 3084 px², 1152x648 3300 px², with the button painting no background, so
    // the two strings interleaved and neither was readable. It is now an
    // in-flow item of the footer's flex row, which is checked properly (as a
    // structural fact about the two boxes' shared parent) in
    // tools/checks/front-screen.mjs. Asserting `fixed` here would hold the
    // collision in place.
    const css = CSS;
    const html = INDEX_HTML;
    const btn = html.match(/<button id="btn-commune"[^>]*class="([^"]*)"/);
    assert(btn, '#btn-commune is gone from index.html');
    const classes = btn[1].split(/\s+/);
    const full = css.match(/\.primary,\.secondary,\.ghost\{([^}]*)\}/);
    assert(full && /width:\s*100%/.test(full[1]), 'the button base rule changed shape; re-read this check');
    const rule = css.match(/\.commune-entry\{([^}]*)\}/);
    assert(rule, '.commune-entry has no rule at all');
    assert(classes.some(c => ['primary', 'secondary', 'ghost'].includes(c)) === true,
      'the button no longer takes the full-width base rule; this check can retire');
    assert(/width:\s*auto/.test(rule[1]),
      'a .ghost with no width of its own fills its line — and once filled the whole viewport');
    assert(/display:\s*inline-block/.test(rule[1]), 'it is still a block, so it fills its line');
    return 'width:auto + inline-block: the box is its label, not the line it sits on';
  });

  check('menu: the death card does not keep the crown\'s congratulation', () => {
    /**
     * THE CARD IS SHARED DOM WRITTEN ON TWO PATHS. `showDeath(stats, title)`
     * read `if (title) this.el.deathTitle.textContent = title;` — total when
     * given, absent when not — and `main.js` has exactly two callers:
     * `gameOver()` passes no title, `crowned()` passes "You stand above the
     * storm". The element's starting text was a literal in index.html that
     * nothing ever restored.
     *
     * So: finish the Descent once, and every death for the rest of the
     * session, in any mode, is announced with the crown's congratulation
     * printed over the stats of a run the player just lost. Driven here in
     * the order that produces it — lose, win, lose — because a check that only
     * calls it once cannot see a defect that is about state left behind.
     */
    const { menu, doc, close } = menuOn();
    try {
      const title = () => doc.getElementById('death-title').textContent;
      const seed = title();
      assert(seed === DEATH_TITLE,
        `index.html seeds the death title as "${seed}" and Menu.js defaults to "${DEATH_TITLE}" — `
        + 'two owners of one string is how this drifts back');

      menu.showDeath([['Waves', '3']]);
      assert(title() === DEATH_TITLE, `an ordinary death reads "${title()}"`);

      menu.showDeath([['Waves', '12']], 'You stand above the storm');
      assert(title() === 'You stand above the storm', 'the crown lost its own title');

      menu.showDeath([['Waves', '2']]);
      assert(title() === DEATH_TITLE,
        `after one crowned run every later death still reads "${title()}" — the card keeps the `
        + 'congratulation over the stats of a run the player lost');
      return `lose "${DEATH_TITLE}" → crown "You stand above the storm" → lose "${title()}"`;
    } finally { close(); }
  });

  check('menu: the death card names the fallen, and never a man the log does not know', async () => {
    /**
     * PLAN.md §4.9's after-action report, at the end of the run.
     *
     *     "The after-action report — who killed whom, from what direction, at
     *      what minute. No death is mysterious, so no death is the AI's fault."
     *
     * The RECORD has been complete for a while — `_deathOf` writes the killer's
     * name, the bearing and the minute onto every `fell` entry, and the muster
     * interlude renders them between engagements. What no ending carried was
     * the WHOLE RUN'S list, so a player who finished a crossing was told
     * "Troops lost 6" over the one mode whose subject is named people dying for
     * good, and the six names went out with the director.
     *
     * ── WHAT THIS ASSERTS, AND WHY IT IS NOT "THE NAMES APPEAR" ─────────────
     *
     * The defect this card has a history of is INVENTION, not omission:
     * `World.runStats`' own note records that two rows were fabricated for
     * years — `stats.areas ?? 5` printed "Areas taken 5" on every won run ever
     * played, a literal with no subject. So the bar here is in both directions.
     * Every man in the roll must be named, and NOTHING may be said about a man
     * that his record does not know: a death with no source says only when.
     *
     * And the two renderings must agree. `fellLine` is shared with
     * `interludeBeats` deliberately — two renderings of one record would
     * eventually disagree about a man, and a report that contradicts itself is
     * worse than no report because the player cannot tell which half to argue
     * with. This drives BOTH and requires the same sentence out of each.
     */
    const { menu, doc, close } = menuOn();
    try {
      const { fellLine, interludeBeats } = await import('../../src/game/Session.js');
      const host = doc.getElementById('death-roll');
      assert(host, 'index.html has no #death-roll for the card to write');

      /* A MODE WITH NO ARMY SENDS NULL AND GETS NOTHING — the distinction
       * `runStats` reports null rather than [] for. A heading over nothing is a
       * screen that looks like it failed. */
      menu.showDeath([['Waves', '9']], undefined, null);
      assert(host.classList.contains('hidden'),
        'a run with no army drew a roll — null means "this mode has no company", not "nobody died"');

      /* …AND AN ARMY THAT LOST NOBODY IS A DIFFERENT AND TRUE STATEMENT. */
      menu.showDeath([['Ground taken', '5']], undefined, []);
      assert(!host.classList.contains('hidden') && /came home/.test(host.textContent),
        `an army that lost nobody got "${host.textContent.slice(0, 60)}" — [] is not null`);

      /* THE REAL SHAPE, off the fields `_deathOf` writes. The third man is the
       * load-bearing one: no killer and no bearing, which is what a fall or a
       * bleed-out with nothing near records. */
      const roll = [
        { name: 'CT-1109', rank: 'CPL', unit: 'Trooper', area: 2, wave: 3,
          killer: 'a B2 super battle droid', bearing: 137, at: 154.3 },
        { name: 'CT-4471', rank: 'PVT', unit: 'Marksman', area: 3, wave: 5,
          killer: 'a walker', bearing: 4, at: 402.0 },
        { name: 'CT-7688', rank: 'SGT', unit: 'Trooper', area: 3, wave: 6,
          killer: null, bearing: null, at: 455.9 },
      ];
      menu.showDeath([['Ground taken', '4'], ['Troops lost', '3']], undefined, roll);
      const text = host.textContent;
      assert(!host.classList.contains('hidden'), 'the roll stayed hidden with three names in it');
      for (const e of roll) {
        assert(text.includes(e.name), `${e.name} fell and is not on the roll`);
        assert(text.includes(fellLine(e)),
          `${e.name}'s line reads something other than "${fellLine(e)}" — the card and the `
          + 'interlude have stopped saying the same sentence about one man');
      }
      /* NOTHING INVENTED. The man with no source may not acquire one, and the
       * card may not put a compass point on a bearing that is null — which is
       * the "?? 5" defect wearing a different costume. */
      const third = text.slice(text.indexOf('CT-7688'));
      assert(!/\bby\b|from the/.test(third),
        `a death with no source was given one: "${third.slice(0, 80)}"`);
      assert(third.includes('at 7:35'),
        'the minute is the one thing that death DOES know and it is not on the card');

      /* AND THE COUNT AND THE NAMES CANNOT DISAGREE — the row above the roll is
       * `runStats().fallen` and the roll is `runStats().roll`, off the same log. */
      const beats = interludeBeats(
        roll.map((e) => ({ t: 'fell', ...e })), 0, { name: 'The Spire Approach', brief: '' }, {});
      const fromInterlude = beats.beats.filter((b) => b.kind === 'fell').map((b) => b.sub);
      assert(fromInterlude.length === roll.length,
        `the interlude rendered ${fromInterlude.length} of ${roll.length} deaths`);
      for (let i = 0; i < roll.length; i++) {
        assert(fromInterlude[i] === fellLine(roll[i]),
          `the interlude says "${fromInterlude[i]}" and the card says "${fellLine(roll[i])}"`);
      }
      return `3 named, 1 of them with no source and no direction invented for it; `
        + 'the card and the interlude say the same sentence for all three; null hides, [] speaks';
    } finally { close(); }
  });

  check('menu: a session can be left, and a client is not offered the host\'s button', () => {
    /**
     * TWO BUTTONS WRONG IN OPPOSITE DIRECTIONS.
     *
     * There was no way to LEAVE a co-op session at all. `Net.close` existed,
     * was complete, and had zero callers in the repository; `quitToMenu()` now
     * calls it, but a player who has connected and NOT deployed has no run to
     * quit — so the only exit from a session was to start a run and abandon
     * it.
     *
     * And Restart was offered to a co-op client, where `World.restartWave()`
     * refuses because only the host owns the wave. A button that answers "no"
     * is a worse answer than no button: it reads as a bug in the session
     * rather than as a rule of it.
     *
     * Driven on the real page and the real Menu, both directions, because the
     * defect in each case is a control whose visibility never changes.
     */
    const { menu, doc, close } = menuOn();
    try {
      const leave = doc.getElementById('btn-leave');
      const restart = doc.getElementById('btn-restart');
      assert(leave, 'index.html has no Leave button, so a connected player still cannot get out');
      assert(restart, 'the pause card lost its Restart button');
      const hidden = (el) => el.classList.contains('hidden');

      assert(hidden(leave), 'Leave is offered before there is a session to leave');
      assert(!hidden(restart), 'Restart is hidden outside co-op, where it works');

      menu.netSession('host');
      assert(!hidden(leave), 'a host cannot leave their own session');
      assert(!hidden(restart), 'the host owns the wave and was not offered Restart');

      menu.netSession('client');
      assert(!hidden(leave), 'a joined client cannot leave');
      assert(hidden(restart),
        'a co-op client is still offered Restart, and World.restartWave() refuses it — the button '
        + 'reads as a broken session rather than as a rule of one');

      menu.netSession(null);
      assert(hidden(leave) && !hidden(restart), 'leaving did not put the controls back');

      // …and the button is wired to a hook rather than being decoration.
      let left = 0;
      menu.hooks.onLeave = () => left++;
      leave.dispatchEvent({ type: 'click' });
      assert(left === 1, `the Leave button fired onLeave ${left} times`);
      return 'solo: leave hidden, restart shown · host: both · client: leave only; onLeave fires';
    } finally { close(); }
  });
  check('menu: Trust in the Force rolls the whole wardrobe, through the real controls', () => {
    /**
     * "there should also be a randomize button that randomizes every single
     *  customization for the people who prefer it that way … maybe call it
     *  something cool like 'Trust in the Force' or something of that nature
     *  instead of randomize"
     *
     * TWO PROPERTIES, and the second is the one worth a check.
     *
     * It exists and it is not called "randomize" — trivial, asserted below in
     * one line because the player named it.
     *
     * AND IT MOVES A LOT OF SETTINGS AT ONCE. `_trustInTheForce` deliberately
     * does not know what a robe is: it walks the panel, finds every row of
     * choices and every slider, and CLICKS them, so a wardrobe row added later
     * is rolled by nobody's effort. The failure that would follow from writing
     * it the other way — a private table of appearance keys drifting from the
     * page — is invisible to a check that only looks at the button. So this
     * counts how many settings actually changed value across one press.
     */
    const { menu, settings, doc, close } = menuOn();
    try {
      const btn = doc.getElementById('btn-trust');
      assert(btn, 'no Trust in the Force button on the wardrobe page');
      assert(!/random/i.test(btn.textContent),
        `the button reads "${btn.textContent.trim()}" — he asked for it NOT to say randomize`);
      /* Every appearance-ish key, snapshotted by value. `face` is an object —
       * the character sheet — so it is compared as JSON. */
      const snap = () => JSON.stringify(settings);
      const before = snap();
      const rows = [...doc.querySelectorAll('.cards, .swatches')].filter((r) => r.children.length > 1);
      assert(rows.length >= 8,
        `only ${rows.length} rows of choices on the page — the fixture is not building the wardrobe`);
      btn.click();
      const after = snap();
      assert(after !== before, 'a press changed nothing at all');
      /* HOW MUCH it moved, counted key by key, because "something changed" is
       * satisfied by one swatch and the ask was every row. */
      const a = JSON.parse(before), b = JSON.parse(after);
      const moved = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      assert(moved.length >= 5,
        `one press moved ${moved.length} settings (${moved.join(', ')}) — it is meant to roll the page`);
      return `${rows.length} rows of choices on the page; one press moved ${moved.length} settings `
        + `(${moved.slice(0, 6).join(', ')}${moved.length > 6 ? ', …' : ''})`;
    } finally { close(); }
  });

  check('menu: the deploy card says who is coming with you, in every mode that takes them', () => {
    /**
     * "I tried to play trial of waves and noticed that I still had troops in
     *  that mode, is that a feature or bug?"
     *
     * A feature, and an invisible one. `settings.allies` is a PERSISTED GLOBAL
     * — one slider on the Army tab — and `commandConfig` fields it in every
     * mode that does not declare `solo` or `dojo`. Set it once on any card and
     * it follows you onto all of them, and until now no screen said so before
     * Ignite. `_syncAlliesRow` was already written for the mirror image (a lit
     * control the mode overrules in silence); this is the mode HONOURING it in
     * silence, which is the same surprise from the other side.
     *
     * Asserted on the two directions that matter and off the mode's own
     * fields, never off a mode's name.
     */
    const { menu, settings, doc, close } = menuOn({ allies: 6, mode: 'waves' });
    try {
      menu.selectMode?.('waves');
      const el = doc.getElementById('mode-need');
      assert(el, 'the deploy card has no line to say it on');
      const said = el.textContent || '';
      assert(/\b6\b/.test(said) && /troop/i.test(said),
        `six allied troopers are coming and the Trial's card says "${said.trim() || '(nothing)'}"`);

      /* NOBODY COMING, NOTHING SAID — a card that always carries a sentence is
       * a card nobody reads. */
      settings.allies = 0;
      menu.selectMode?.('waves');
      assert(!/troop/i.test(doc.getElementById('mode-need').textContent || ''),
        'it promises troopers when the slider is at zero');

      /* AND THE TWO MODES THAT REFUSE A CONTINGENT DO NOT CLAIM ONE. They have
       * their own sentence, in the slider's own readout. */
      settings.allies = 6;
      menu.selectMode?.('duel');
      assert(!/troop/i.test(doc.getElementById('mode-need').textContent || ''),
        'the Duel is solo and its card offers to take six men in');
      return 'the Trial names the six it is taking, says nothing at zero, and the Duel — which '
        + 'refuses a contingent — never claims one';
    } finally { close(); }
  });

  /**
   * ══════════════════════════════════════════════════════════════════════
   *  TRUST IN THE FORCE, ON BOTH PAGES, AND ONLY ON ITS OWN
   * ══════════════════════════════════════════════════════════════════════
   *
   * The check above proves the Jedi's button exists, is not called "randomize",
   * and moves at least five settings. Three things it does not prove, and each
   * of them is what the player actually asked for:
   *
   *   "add the same randomize button for NPC TROOP customization as well" —
   *     a second button, on a different page, wired to a different store.
   *   "randomizes EVERY SINGLE customization" — five settings out of a page of
   *     twenty-three rows and five sliders is not every, and the slider pass in
   *     particular was doing nothing at all here until `tools/checks/_page.mjs`
   *     learned that `min`/`max`/`step` are properties on a real input.
   *   and the one nobody asks for until it bites: IT STOPS AT ITS OWN ROOT.
   *     Both buttons are on one page — index.html builds every panel at once —
   *     so a walk that took `document` instead of the panel would re-roll the
   *     player's own wardrobe from a trooper's page, and the only symptom
   *     would be a player who cannot keep a face.
   *
   * HOW "EVERY CONTROL" IS MEASURED, and why not by counting what moved.
   * `_trustInTheForce` picks with `Math.random()`, so a row that was reached
   * can land on the value it already had and a row that was skipped looks
   * identical to it. Counting moved settings therefore cannot tell "it reached
   * all 23 rows" from "it reached 6 and got lucky". So the roll is PINNED
   * instead: with `Math.random` returning ~1 every row must end on its LAST
   * child and every slider at its maximum, and with it returning 0 every row
   * must end on its FIRST child and every slider at its minimum. A row the
   * walk never touched fails both, whatever it was showing when it started.
   */

  /** Run `fn` with `Math.random` pinned, and give the real one back. */
  const rolled = (v, fn) => {
    const real = Math.random;
    Math.random = () => v;
    try { return fn(); } finally { Math.random = real; }
  };
  /** Every row of choices under `root` that has something to choose between. */
  const choiceRows = (root) => [...root.querySelectorAll('.cards, .swatches, .kit-chips')]
    .filter((r) => r.children.length > 1);
  const selectedIndex = (row) => [...row.children].findIndex((c) => c.classList.contains('sel'));

  /**
   * A man on the roll, on his page, with the store put back afterwards.
   *
   * SYNCHRONOUS for the reason `tools/checks/company.mjs` gives at length: the
   * company roll is one localStorage key and the runner starts every check as
   * soon as the one before it suspends, so a body that awaited anything here
   * would be sharing its roll — and its `document` — with whatever ran next.
   */
  const onTroopPage = (fn, overrides = {}) => {
    const KEY = 'saber.company.v1', SLATE = 'saber.muster.v1';
    const had = localStorage.getItem(KEY), hadSlate = localStorage.getItem(SLATE);
    localStorage.removeItem(KEY);
    localStorage.removeItem(SLATE);
    try {
      const army = ARMIES.republic;
      const roll = new CommandRoster(army);
      for (let i = 0; i < 3; i++) roll.enlist(army.tiers[0].type);
      Company.keep(roll.all, { army: 'republic', deployed: roll.all, ground: 'geonosis' });
      const him = roll.all[0];
      const fix = menuOn(overrides);
      try {
        fix.menu._showCompany(`republic/${him.designation}`);
        const look = () => Company.load('republic').men
          .find((m) => m.designation === him.designation)?.look || {};
        return fn({ ...fix, him, look });
      } finally { fix.close(); }
    } finally {
      if (had == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, had);
      if (hadSlate == null) localStorage.removeItem(SLATE); else localStorage.setItem(SLATE, hadSlate);
    }
  };

  check('menu: Trust in the Force moves EVERY control on the wardrobe — all 23 rows and all 5 sliders', () => {
    const { doc, close } = menuOn();
    try {
      const btn = doc.getElementById('btn-trust');
      assert(btn, 'no Trust in the Force button on the wardrobe page');
      /* THE BUTTON'S OWN ROOT, taken the way the button takes it. */
      const panel = btn.closest('[data-panel="saber"]');
      assert(panel, 'the button is not inside the wardrobe panel it walks');
      const rows = () => choiceRows(panel);
      const ranges = () => [...panel.querySelectorAll('input[type="range"]')];
      assert(rows().length >= 15,
        `only ${rows().length} rows of choices under the button — the fixture is not building the wardrobe`);
      assert(ranges().length >= 5,
        `only ${ranges().length} sliders under the button — the wardrobe has the frame, the muscle, `
        + 'the years and the two blade dimensions');

      /* ── pinned high: last child of every row, top of every slider ──── */
      rolled(0.999, () => btn.click());
      const missedHi = rows().filter((r) => selectedIndex(r) !== r.children.length - 1);
      assert(!missedHi.length,
        `${missedHi.length} of ${rows().length} rows were not rolled at all — the walk does not reach `
        + `${missedHi.map((r) => r.className).join(', ')}`);
      const hi = ranges().map((el) => [el.id, Number(el.value), Number(el.max)]);
      const stuckHi = hi.filter(([, v, max]) => v !== max);
      assert(!stuckHi.length,
        `sliders the roll left where they were: ${stuckHi.map(([id, v, m]) => `${id}=${v} (max ${m})`).join(', ')}`);

      /* ── pinned low: first child of every row, bottom of every slider ── */
      rolled(0, () => btn.click());
      const missedLo = rows().filter((r) => selectedIndex(r) !== 0);
      assert(!missedLo.length,
        `${missedLo.length} rows did not follow the second roll — ${missedLo.map((r) => r.className).join(', ')}`);
      const lo = ranges().map((el) => [el.id, Number(el.value), Number(el.min)]);
      const stuckLo = lo.filter(([, v, min]) => v !== min);
      assert(!stuckLo.length,
        `sliders that ignored the second roll: ${stuckLo.map(([id, v, m]) => `${id}=${v} (min ${m})`).join(', ')}`);
      return `${rows().length} rows and ${ranges().length} sliders, every one of them driven to both ends `
        + `(${hi.map(([id, v]) => `${id} ${v}`).join(', ')} → ${lo.map(([, v]) => v).join(', ')})`;
    } finally { close(); }
  });

  check('menu: the troopers have the same button, and it rolls every rack on the man\'s page', () => onTroopPage(({ doc, look }) => {
    /**
     * "add the same randomize button for npc troop custimization as well"
     *
     * The same walk, on a page whose controls are a different shape: a
     * trooper's page has no `.cards` and no sliders at all, it has `.kit-chips`
     * and `.swatches`, and every write goes through `Company.dress` rather than
     * through the settings blob. So this asserts on the STORE — what the man is
     * actually wearing afterwards — rather than on the DOM, which is the only
     * evidence that survives the page re-rendering itself after every write.
     *
     * The two pinned rolls read cleanly on this page because of what sits at
     * each end of a rack: the LAST chip in a kit row is "As issued" and the
     * FIRST swatch in a paint row is "as issued", so a roll pinned high strips
     * every kit field and paints all three channels, and a roll pinned low
     * fills every kit field and strips the paint. Two presses, and every field
     * on the page has to move in both directions.
     */
    const btn = doc.getElementById('company-trust');
    assert(btn, 'the trooper page has no Trust in the Force button');
    assert(!/random/i.test(btn.textContent),
      `the trooper's button reads "${btn.textContent.trim()}" — the same name was asked for`);
    const kitFields = [...new Set([...doc.querySelectorAll('.kit-chips .kit-chip')].map((c) => c.dataset.kit))];
    const paintFields = [...new Set([...doc.querySelectorAll('.company-paints .swatch')].map((c) => c.dataset.paint))];
    assert(kitFields.length >= 6 && paintFields.length >= 3,
      `${kitFields.length} kit rows and ${paintFields.length} paint rows on the page — the fixture is `
      + 'not building the dressing room');

    rolled(0.999, () => btn.click());
    const hi = look();
    const keptKit = kitFields.filter((f) => (hi.kit || {})[f] !== undefined);
    const noPaint = paintFields.filter((f) => !(hi.paint || {})[f]);
    assert(!keptKit.length, `the roll never reached ${keptKit.join(', ')} — those rows kept their chip`);
    assert(!noPaint.length, `the roll never reached the ${noPaint.join(', ')} paint rack`);

    rolled(0, () => btn.click());
    const lo = look();
    const noKit = kitFields.filter((f) => (lo.kit || {})[f] === undefined);
    const keptPaint = paintFields.filter((f) => (lo.paint || {})[f]);
    assert(!noKit.length, `the second roll never reached ${noKit.join(', ')}`);
    assert(!keptPaint.length, `the second roll left ${keptPaint.join(', ')} painted`);
    return `${kitFields.length} kit rows and ${paintFields.length} paint racks on his page, every one of `
      + `them rolled both ways (${paintFields.map((f) => `${f} ${hi.paint[f]}`).join(', ')} → as issued)`;
  }));

  check('menu: a Trust in the Force button rolls its own page and nothing else on the screen', () => onTroopPage(({ menu, settings, doc, look }) => {
    /**
     * THE ONE THAT WOULD NOT BE NOTICED FOR A WEEK.
     *
     * Both buttons live on one document — the menu builds every panel at
     * construction, so a trooper's dressing room and the player's own wardrobe
     * are on screen together whether or not the tab is showing. `_wireTrust`
     * scopes its walk to `[data-panel="saber"]`; the trooper's walks
     * `.kit-list`, which is the wrapper the dressing room puts around each
     * rack. Neither is a document-wide walk today, and this is the check that
     * goes red the day one becomes one — or the day a `.kit-list` is used for
     * something on the Jedi's page, which is the same accident from the other
     * direction.
     *
     * Compared by VALUE on both sides: the whole settings blob (the wardrobe's
     * every choice, the face sheet included) and the man's stored look. A walk
     * that reached across would move one of the two, and there is no roll of
     * the dice that produces "changed nothing at all" across 23 rows.
     */
    const before = JSON.stringify(settings);
    const beforeLook = JSON.stringify(look());

    /* His button first: the wardrobe must not feel it. */
    rolled(0.999, () => doc.getElementById('company-trust').click());
    assert(JSON.stringify(look()) !== beforeLook, 'his own button changed nothing — the guard below is vacuous');
    assert(JSON.stringify(settings) === before,
      'the TROOPER\'s Trust in the Force re-rolled the player\'s own appearance: '
      + `${Object.keys(settings).filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(JSON.parse(before)[k])).join(', ')}`);

    /* And the player's button: the man on the page must not feel it. */
    const hisLook = JSON.stringify(look());
    rolled(0, () => doc.getElementById('btn-trust').click());
    assert(JSON.stringify(settings) !== before, 'the wardrobe button changed nothing — the guard below is vacuous');
    assert(JSON.stringify(look()) === hisLook,
      `the PLAYER's Trust in the Force redressed a trooper: ${hisLook} → ${JSON.stringify(look())}`);
    return 'his button rolled his kit and left all of the wardrobe alone; the wardrobe button rolled '
      + 'the wardrobe and left his kit alone';
  }));

  check('menu: the deploy card discloses the contingent in every mode that fields one, and in no mode that refuses one', () => {
    /**
     * "I tried to play trial of waves and noticed that I still had troops in
     *  that mode, is that a feature or bug?"
     *
     * The check above proves the sentence on three cards — the Trial with six,
     * the Trial with none, and the Duel. This is the same claim taken across
     * the WHOLE mode table, because the sentence is generated off `M.solo` and
     * `M.dojo` and the failure that matters is a mode nobody thought to look
     * at: a twelfth mode added tomorrow either fields a contingent and says so,
     * or refuses one and stays quiet, and this is what makes that automatic.
     *
     * The number is checked against `commandConfig` rather than against the
     * slider, because the slider is what the player asked for and the config is
     * what the run actually fields — a card that promised six while the world
     * built four would be the same silence in a new place.
     */
    const modes = playableModes();
    assert(modes.length >= 8, `only ${modes.length} playable modes — the table did not load`);
    const said = (menu, doc, id) => {
      menu.selectMode?.(id);
      return (doc.getElementById('mode-need')?.textContent || '');
    };
    const { menu, settings, doc, close } = menuOn({ allies: 6 });
    const told = [], quiet = [], wrong = [], leaked = [];
    try {
      for (const id of modes) {
        const M = MODES[id];
        const line = said(menu, doc, id);
        const says = /\btroop/i.test(line);
        const refuses = !!(M.solo || M.dojo);
        if (refuses) {
          if (says) leaked.push(id); else quiet.push(id);
          continue;
        }
        if (!says) { wrong.push(`${id} said nothing`); continue; }
        /* AND IT NAMES THE NUMBER THE RUN WILL ACTUALLY FIELD. */
        const n = commandConfig({ ...settings, mode: id }).contingent;
        if (!new RegExp(`\\b${n}\\b`).test(line)) wrong.push(`${id} promised "${line.trim()}" against ${n}`);
        else told.push(id);
      }
      assert(!leaked.length,
        `${leaked.join(', ')} declare solo/dojo — they refuse a contingent — and their card offers one anyway`);
      assert(!wrong.length, `the disclosure is wrong on: ${wrong.join('; ')}`);
      assert(told.includes('waves'), 'the Trial of Waves — the mode he asked about — does not say it');
      assert(told.length >= 6 && quiet.length >= 1,
        `${told.length} modes disclosed and ${quiet.length} refused — one side of this is not being measured`);

      /* NOBODY COMING, NOTHING SAID, in every mode rather than in one. */
      settings.allies = 0;
      const noisy = modes.filter((id) => /\btroop/i.test(said(menu, doc, id)));
      assert(!noisy.length, `with the slider at zero these cards still promise troopers: ${noisy.join(', ')}`);
      return `${told.length} modes name the six they field (${told.join(', ')}); ${quiet.length} refuse a `
        + `contingent and stay quiet (${quiet.join(', ')}); at zero allies all ${modes.length} say nothing`;
    } finally { close(); }
  });

}
