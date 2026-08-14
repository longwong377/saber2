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
import { Menu, DEFAULT_SETTINGS, DEATH_TITLE } from '../../src/ui/Menu.js';
import { ACTIONS } from '../../src/engine/Bindings.js';
import { DESCENT } from '../../src/game/Run.js';
import { FOCUS } from '../../src/game/Focus.js';
import { QUALITY } from '../../src/engine/Engine.js';

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
      assert(kids(doc, 'level-list').length === 13, `${kids(doc, 'level-list').length} theatres`);
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
    const bg = hex(css.match(/--bg\s*:\s*(#[0-9a-fA-F]{6})/)[1]);
    const panel = css.match(/--panel\s*:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    const ground = over([+panel[1], +panel[2], +panel[3]], parseFloat(panel[4]), bg);
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
    // The Descent takes its level from the rung: main.js reads `run.rung.level`
    // whenever a Run exists, a fresh Run is tier 0, and DESCENT[0] is The
    // Intake. Every one of the thirteen cards used to stay live, write
    // settings.level, save it and light up — a control that is highlighted,
    // saved and thrown away, and the write leaked into the NEXT run of another
    // mode, so the level the player picked turned up somewhere they did not.
    const { menu, settings, doc, close } = menuOn({ mode: 'gauntlet', level: 'mustafar' });
    try {
      const list = doc.getElementById('level-list');
      assert(list.classList.contains('inert'), 'the Theatre column is live in The Descent');
      const focusable = [...list.children].filter(c => c.tabIndex >= 0);
      assert(!focusable.length, `${focusable.length} discarded cards are still in the tab order`);
      const note = doc.getElementById('level-note');
      assert(note, 'there is no note beside the Theatre column to say the mode owns the choice');
      assert(!note.classList.contains('hidden') && note.textContent.length > 20,
        'nothing on screen says the column is not this mode\'s to choose');
      for (const rung of DESCENT) {
        assert(note.textContent.includes(rung.name), `the ladder does not name ${rung.name}`);
      }
      // and a click on a card cannot write the setting the game will discard
      list.children[3].dispatchEvent({ type: 'click' });
      assert(settings.level === 'mustafar', `a discarded card wrote settings.level = ${settings.level}`);
      // …while every other mode keeps the column exactly as it was
      menu.selectMode('waves');
      assert(!list.classList.contains('inert'), 'the column stayed inert outside The Descent');
      assert(note.classList.contains('hidden'), 'the ladder is still on screen in a mode that has none');
      list.children[3].dispatchEvent({ type: 'keydown', key: 'Enter' });
      assert(settings.level !== 'mustafar', 'the column did not come back to life');
      return `gauntlet → inert, 0 focusable, ladder names ${DESCENT.length} rungs; waves → live and writes`;
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

  check('menu: the way into the constellation is a button, not a strip', () => {
    // Pure cascade, so it is read off the cascade. `.primary/.secondary/.ghost`
    // are `display:block; width:100%` because they are laid out in a column; for
    // a position:fixed box the containing block is the VIEWPORT, so this button
    // was 100vw wide, hanging 22px off the right edge, a live click target
    // across the whole screen at z-index 41 over the menu's 40.
    const css = CSS;
    const html = INDEX_HTML;
    const btn = html.match(/<button id="btn-commune"[^>]*class="([^"]*)"/);
    assert(btn, '#btn-commune is gone from index.html');
    const classes = btn[1].split(/\s+/);
    const full = css.match(/\.primary,\.secondary,\.ghost\{([^}]*)\}/);
    assert(full && /width:\s*100%/.test(full[1]), 'the button base rule changed shape; re-read this check');
    const rule = css.match(/\.commune-entry\{([^}]*)\}/);
    assert(rule, '.commune-entry has no rule at all');
    assert(/position:\s*fixed/.test(rule[1]), '.commune-entry is no longer fixed; re-read this check');
    assert(classes.some(c => ['primary', 'secondary', 'ghost'].includes(c)) === true,
      'the button no longer takes the full-width base rule; this check can retire');
    assert(/width:\s*auto/.test(rule[1]),
      'a fixed-position .ghost with no width of its own is 100vw wide — it spans the screen');
    assert(/display:\s*inline-block/.test(rule[1]), 'it is still a block, so it fills its line');
    return 'fixed + width:auto + inline-block: the box is its label, not the viewport';
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
}
