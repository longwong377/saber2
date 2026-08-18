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
import { Menu, DEFAULT_SETTINGS, DEATH_TITLE, codexHtml, codexTeaching } from '../../src/ui/Menu.js';
import { ACTIONS, defaultBindings } from '../../src/engine/Bindings.js';
import { FOCUS } from '../../src/game/Focus.js';
import { QUALITY } from '../../src/engine/Engine.js';
import { MODES, WaveDirector, BOSS_EVERY } from '../../src/game/Waves.js';
import { LEVEL_ORDER } from '../../src/game/Levels.js';
/* The Codex's teaching half is generated off these, and the check reads the
 * same tables rather than a transcription of what they said on the day. */
import { DIFFICULTY, GRADE_NAME, SPEED_GRADE, PARRY_GRADE, parryScale } from '../../src/game/Combat.js';
import { POWER_COST, POWER_BOON } from '../../src/game/Powers.js';
import { STRATAGEMS } from '../../src/game/Stratagems.js';
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
    const strats = STRATAGEMS.filter((S) => !chips.includes(`${S.cost} Force`));
    assert(!strats.length,
      `stratagems the Codex documents with no price: ${strats.map((S) => S.id).join(', ')}`);
    /* Nothing typed: every chip's number is somebody's `cost` field. */
    const priced = new Set([...Object.values(POWER_COST), ...STRATAGEMS.map((S) => S.cost)]
      .map((c) => `${c} Force`));
    const stray = chips.filter((c) => !priced.has(c));
    assert(!stray.length, `price chips that came from no table: ${[...new Set(stray)].join(', ')}`);
    assert(chips.length === Object.keys(POWER_COST).length + STRATAGEMS.length,
      `${chips.length} price chips against ${Object.keys(POWER_COST).length} powers and `
      + `${STRATAGEMS.length} stratagems — one of them is priced twice or not at all`);

    /* The gates are the two boon-locked powers plus whatever the stratagem
     * table marks `commandOnly`, and they name the CARD rather than a string. */
    const wantGates = Object.values(POWER_BOON).length
      + STRATAGEMS.filter((S) => S.commandOnly).length;
    assert(gates.length === wantGates,
      `${gates.length} gate chips against ${wantGates} gated calls`);
    assert(!/\bForce Lightning\b/.test(html.replace(/<em class="cost gate">[^<]*<\/em>/g, '')),
      'the Codex still types a boon name into its prose');
    return `${chips.length} prices and ${gates.length} gates, all off POWER_COST / STRATAGEMS; `
      + `push ${POWER_COST.push} · unleash ${POWER_COST.unleash} with nothing typed`;
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
}
