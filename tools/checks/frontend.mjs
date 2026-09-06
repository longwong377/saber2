/**
 * THE FRONT END IS DRAWN THE WAY THE STATION IS — V19 §9 (hole 9).
 *
 * "The menus and settings read as a different product." Four things this
 * file holds, every one of them measured off the shipped stylesheet and the
 * shipped page rather than asserted about their source:
 *
 *   a. CONTRAST. Every text colour the stylesheet defines, on every surface
 *      it defines, clears WCAG's 4.5:1 — computed, from the :root tokens,
 *      with var() references resolved. And every rule that pairs a `color`
 *      token with a `background` token is checked as the pair it is. The
 *      nine station tokens are the deck's own: read out of
 *      `Station.DECK_PALETTE[40]` by regex so the two files cannot drift.
 *   b. HIT TARGETS. Every button, slider, switch, tab, card and row on the
 *      page has a rule giving it at least 32 px of height — found by matching
 *      the page's real elements against the rules' selectors, so a control
 *      added to index.html with no rule fails here rather than shipping at
 *      the browser's 18 px.
 *   c. MOTION. One reduced-motion rule kills every animation and transition;
 *      and with motion on, nothing a panel or card does takes longer than
 *      160 ms.
 *   d. THE STATION ON THE MENU. The title carries the station's name and the
 *      day, painted by the real Menu from the hook main.js passes; each
 *      theatre card carries its ground's colour; and a reset button puts its
 *      own column back to DEFAULT_SETTINGS.
 */
import { readFile } from 'node:fs/promises';
import { makeDocument } from './_page.mjs';
import { Menu, DEFAULT_SETTINGS, levelSwatch } from '../../src/ui/Menu.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { TERRAIN_PRESETS } from '../../src/world/Terrain.js';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/* ── colour arithmetic (WCAG 2.x) ─────────────────────────────────────── */
const hex = (s) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s).trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const toHex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

/* ── the stylesheet, read structurally ────────────────────────────────── */
/** The :root token table, with var() references resolved to their values. */
function tokens(css) {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!root) throw new Error('styles.css has no :root block');
  const raw = new Map();
  for (const m of root[1].replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    raw.set(m[1], m[2].trim());
  }
  const resolve = (name, depth = 0) => {
    const v = raw.get(name);
    if (v == null || depth > 8) return null;
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    return ref ? resolve(ref[1], depth + 1) : v;
  };
  const out = new Map();
  for (const k of raw.keys()) out.set(k, resolve(k));
  return out;
}
/** Every `selector{body}` pair at the top level (and inside @media blocks). */
function rules(css) {
  const out = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sel = m[1].trim().replace(/^[^{}]*\}\s*/, '').trim();
    if (!sel || sel.startsWith('@')) continue;
    out.push({ selector: sel.replace(/\s*\n\s*/g, ' '), body: m[2] });
  }
  return out;
}
/** One declaration block by exact selector, as front-screen.mjs reads it. */
function rule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[},])\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : null;
}
const ms = (s) => (s.endsWith('ms') ? parseFloat(s) : parseFloat(s) * 1000);

/** A real Menu on a real parse of the page — front-screen.mjs's pattern. */
function menuOn(html, hooks = {}) {
  const doc = makeDocument(html);
  const restore = doc.install();
  try {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const fired = [];
    for (const n of ['onQualityChange', 'onSchemeChange', 'onDeflectAim', 'onBloom']) {
      hooks[n] = (v) => fired.push([n, v]);
    }
    const menu = new Menu(settings, hooks);
    return { menu, settings, doc, fired, close: restore };
  } catch (e) { restore(); throw e; }
}

export async function run({ check, assert }) {
  const CSS = await read('styles.css');
  const HTML = await read('index.play.html');
  const MAIN = await read('src/main.js');
  const STATION = await read('src/game/Station.js');
  const T = tokens(CSS);
  const RULES = rules(CSS);

  /* The token roles this file's :root documents. TEXT sits on DARK; INK (the
   * stroke) sits on LIT — a selected tab, a pressed button, a held rung. */
  const TEXT = ['--ink', '--dim', '--dimmer', '--accent', '--accent-warm', '--strip', '--force', '--good', '--danger'];
  const DARK = ['--void', '--panel', '--panel-2', '--panel-hi'];
  const LIT = ['--accent', '--accent-warm', '--strip', '--force', '--good', '--danger'];
  const STATION_KEYS = ['hull', 'dark', 'deep', 'strip', 'status', 'wing', 'mark', 'screen', 'glass'];

  check('frontend: the nine station tokens are DECK_PALETTE[40], verbatim', () => {
    const block = /\n  40:\s*\{([\s\S]*?)\n  \},/.exec(STATION);
    assert(block, 'Station.js has no DECK_PALETTE row for deck 40');
    const missing = [];
    for (const k of STATION_KEYS) {
      const m = new RegExp(`\\b${k}:\\s*0x([0-9a-fA-F]{6})`).exec(block[1]);
      assert(m, `DECK_PALETTE[40] has no ${k}`);
      const want = '#' + m[1].toLowerCase();
      const got = (T.get(`--st-${k}`) || '').toLowerCase();
      if (got !== want) missing.push(`--st-${k} is ${got || 'undefined'}, the deck's ${k} is ${want}`);
    }
    assert(!missing.length, missing.join('\n'));
    assert(T.get('--strip') === T.get('--st-strip'), '--strip is not the deck\'s emissive strip');
    assert(T.get('--accent') === T.get('--st-screen'), '--accent is not the deck\'s screen light');
    return STATION_KEYS.map((k) => `${k} ${T.get('--st-' + k)}`).join(', ');
  });

  check('frontend: every text token on every surface token clears 4.5:1, computed', () => {
    const bad = [];
    let pairs = 0, worst = Infinity, worstPair = '';
    const pair = (fg, bg) => {
      const a = hex(T.get(fg)), b = hex(T.get(bg));
      assert(a, `${fg} is not a hex colour in :root (${T.get(fg)})`);
      assert(b, `${bg} is not a hex colour in :root (${T.get(bg)})`);
      const c = contrast(a, b);
      pairs++;
      if (c < worst) { worst = c; worstPair = `${fg} on ${bg}`; }
      if (c < 4.5) bad.push(`${fg} ${T.get(fg)} on ${bg} ${T.get(bg)}: ${c.toFixed(2)}:1`);
    };
    for (const fg of TEXT) for (const bg of DARK) pair(fg, bg);
    for (const bg of LIT) pair('--stroke', bg);
    assert(!bad.length, `${bad.length} pair(s) under 4.5:1:\n      ${bad.join('\n      ')}`);
    return `${pairs} pairs; the weakest is ${worstPair} at ${worst.toFixed(2)}:1`;
  });

  check('frontend: every rule that pairs a colour token with a background token is a readable pair', () => {
    const bad = [];
    let seen = 0;
    for (const { selector, body } of RULES) {
      const fg = /(?:^|;)\s*color\s*:\s*var\((--[\w-]+)\)\s*(?:;|$)/.exec(body);
      const bg = /(?:^|;)\s*background(?:-color)?\s*:\s*var\((--[\w-]+)\)\s*(?:;|$)/.exec(body);
      if (!fg || !bg) continue;
      const a = hex(T.get(fg[1])), b = hex(T.get(bg[1]));
      if (!a || !b) continue;
      seen++;
      const c = contrast(a, b);
      if (c < 4.5) bad.push(`${selector}: ${fg[1]} on ${bg[1]} = ${c.toFixed(2)}:1`);
    }
    assert(seen >= 12, `only ${seen} colour/background token pairs found — the walk is not reading the stylesheet`);
    assert(!bad.length, bad.join('\n      '));
    return `${seen} rules pair a text token with a surface token; all ≥ 4.5:1`;
  });

  /* ══════════════════════════════════════════════════════════════════
   *  b. HIT TARGETS
   * ══════════════════════════════════════════════════════════════════ */
  check('frontend: every interactive element on the page has a rule giving it 32 px of height', () => {
    const doc = makeDocument(HTML);
    const restore = doc.install();
    try {
      /* The rules that state a height, by selector, with the largest
       * min-height/height each declares. Only simple and descendant
       * selectors are matched — which is every selector the page's controls
       * are styled by. */
      const sized = [];
      for (const { selector, body } of RULES) {
        const hs = [...body.matchAll(/(?:^|;)\s*(?:min-)?height\s*:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
        if (!hs.length) continue;
        for (const sel of selector.split(',').map((s) => s.trim())) {
          if (/[>+~:\[]/.test(sel)) continue;
          sized.push({ sel, h: Math.max(...hs) });
        }
      }
      const els = doc.querySelectorAll('button, input, textarea, .tab, .card, .diff, .sw');
      const short = [];
      let n = 0;
      for (const el of els) {
        if (el.localName === 'input' && el.getAttribute('type') === 'hidden') continue;
        n++;
        /* A switch's hit area is its <label>: the whole row toggles it, and
         * the row is what carries the 32 px. So an input inside a label is
         * measured as the larger of the two. */
        let best = 0, by = null;
        const subjects = [el];
        if (el.localName === 'input' && el.parentElement?.localName === 'label') subjects.push(el.parentElement);
        for (const s of subjects) {
          for (const { sel, h } of sized) {
            if (h > best && s.matches(sel)) { best = h; by = sel; }
          }
        }
        if (best < 32) {
          const id = el.id ? `#${el.id}` : `${el.localName}.${el.className}`;
          short.push(`${id}: ${best ? `${best}px via ${by}` : 'no rule states a height'}`);
        }
      }
      assert(n >= 80, `${n} controls found on the page — the walk is not seeing it`);
      assert(!short.length, `${short.length} control(s) under 32 px:\n      ${short.join('\n      ')}`);
      return `${n} controls on the page, every one at ≥ 32 px by a rule that matches it`;
    } finally { restore(); }
  });

  check('frontend: the station panes\' own buttons and rows are 32 px too', () => {
    for (const sel of ['.pane button', '.pane .row', '.hol-rung', '.kit-chip', '.shots .shot', '.bindrow b']) {
      const body = rule(CSS, sel);
      assert(body, `${sel} has no rule`);
      const h = /(?:^|;)\s*min-height\s*:\s*(\d+)px/.exec(body);
      assert(h && Number(h[1]) >= 32, `${sel} declares ${h ? h[1] + 'px' : 'no min-height'}`);
    }
    return 'panes, rungs, chips, shots and key caps all carry min-height ≥ 32px';
  });

  /* ══════════════════════════════════════════════════════════════════
   *  c. MOTION
   * ══════════════════════════════════════════════════════════════════ */
  check('frontend: prefers-reduced-motion switches every animation and transition off', () => {
    const m = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{\s*\*\s*,\s*\*::before\s*,\s*\*::after\s*\{([^}]*)\}/.exec(CSS);
    assert(m, 'styles.css has no `@media (prefers-reduced-motion:reduce){*,*::before,*::after{…}}` rule');
    assert(/animation\s*:\s*none\s*!important/.test(m[1]), 'the reduced-motion rule does not kill animations');
    assert(/transition\s*:\s*none\s*!important/.test(m[1]), 'the reduced-motion rule does not kill transitions');
    return 'one universal rule: animation:none and transition:none, both !important';
  });

  check('frontend: no panel, card or control moves for longer than 160 ms', () => {
    const UI = ['.screen', '.panel.active', '.menu-wrap', '.load-wrap', '.draft-wrap,.pause-wrap,.death-wrap',
      '.muster-wrap', '.pane', '.med-wrap', '.card', '.diff', '.tab', '.primary,.secondary,.ghost',
      '.check input', '.check input::after', '.slider input::-webkit-slider-thumb', '.dc', '.mu', '.hol-rung',
      '.sw', '.bindrow', '.bindrow b', '.kit-chip', '.shots .shot', '#commune', '.pane button', '.boot-bar i'];
    const slow = [];
    let counted = 0;
    for (const sel of UI) {
      const body = rule(CSS, sel);
      assert(body, `${sel} has no rule`);
      for (const m of body.matchAll(/(?:^|;)\s*(animation|transition)\s*:\s*([^;]+)/g)) {
        const times = [...m[2].matchAll(/(?:^|[\s,])(\d*\.?\d+)(ms|s)\b/g)].map((t) => ms(t[1] + t[2]));
        if (!times.length) continue;
        counted++;
        /* A shorthand's first time is the duration; a second is a delay. */
        const parts = m[2].split(',');
        for (const p of parts) {
          const t = [...p.matchAll(/(?:^|[\s])(\d*\.?\d+)(ms|s)\b/g)].map((x) => ms(x[1] + x[2]));
          if (t.length && t[0] > 160) slow.push(`${sel} ${m[1]}: ${p.trim()} (${t[0]} ms)`);
        }
      }
    }
    assert(counted >= 15, `only ${counted} motion declarations read — the list is stale`);
    assert(!slow.length, `${slow.length} over 160 ms:\n      ${slow.join('\n      ')}`);
    return `${counted} animation/transition declarations across ${UI.length} selectors, all ≤ 160 ms`;
  });

  check('frontend: the focus ring is one rule, in the strip colour, on every control kind', () => {
    const m = /([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/.exec(CSS);
    assert(m, 'no :focus-visible rule');
    for (const cls of ['.card', '.diff', '.tab', '.primary', '.slider input', '.check input', '.hol-rung', '.pane button', '.kit-chip', '.shots .shot']) {
      assert(m[1].includes(`${cls}:focus-visible`), `${cls} is not in the focus rule`);
    }
    assert(/outline:\s*3px solid var\(--strip\)/.test(m[2]), `the ring is not 3px of --strip: ${m[2]}`);
    const later = CSS.slice(m.index + m[0].length).match(/:focus-visible[^{}]*\{[^}]*outline\s*:\s*[^n]/g) || [];
    assert(!later.length, `${later.length} later rule(s) paint a second focus ring: ${later.join(' | ')}`);
    return `${m[1].split(',').length} selectors, one ring`;
  });

  /* ══════════════════════════════════════════════════════════════════
   *  d. THE STATION ON THE MENU
   * ══════════════════════════════════════════════════════════════════ */
  check('frontend: the menu carries the station\'s name and the day, painted by the real Menu', () => {
    assert(/station:\s*\(\)\s*=>\s*\(\{\s*name:\s*stationName\(\),\s*day:\s*stationDay\(\)\s*\}\)/.test(MAIN),
      'main.js does not pass `station: () => ({ name: stationName(), day: stationDay() })` to the Menu');
    assert(/import \{[^}]*\bstationName\b[^}]*\} from '\.\/game\/StationSave\.js'/.test(MAIN),
      'main.js does not import stationName from StationSave');
    const { menu, doc, close } = menuOn(HTML, { station: () => ({ name: 'Tal Ridge', day: 7 }) });
    try {
      const line = doc.getElementById('menu-station');
      assert(line && line.closest('.menu-head'), '#menu-station is not in the menu header');
      const logo = line.parentElement.querySelector('.logo');
      assert(logo, 'the station line does not sit under the logo');
      menu.showMenu();
      assert(doc.getElementById('menu-station-name').textContent === 'Tal Ridge',
        `the name reads "${doc.getElementById('menu-station-name').textContent}"`);
      assert(doc.getElementById('menu-station-day').textContent === 'Day 7',
        `the day reads "${doc.getElementById('menu-station-day').textContent}"`);
      const body = rule(CSS, '.station-line');
      assert(body && /text-shadow/.test(body), '.station-line carries no ink halo and sits on the plate');
      return 'Tal Ridge · Day 7 under the wordmark, inked';
    } finally { close(); }
  });

  check('frontend: every theatre card carries a swatch of its ground\'s own colour', () => {
    const { doc, close } = menuOn(HTML);
    try {
      const cards = doc.getElementById('level-list').children;
      assert(cards.length === LEVEL_ORDER.length, `${cards.length} cards for ${LEVEL_ORDER.length} levels`);
      const said = [];
      LEVEL_ORDER.forEach((key, i) => {
        const sw = cards[i].querySelector('.swatch');
        assert(sw, `${key}'s card has no swatch`);
        const got = /background:\s*(#[0-9a-f]{6})/i.exec(sw.getAttribute('style') || '')?.[1]?.toLowerCase();
        const want = toHex(TERRAIN_PRESETS[LEVELS[key].terrain].sandColor);
        assert(got === want, `${key}'s swatch is ${got}, its terrain's sand is ${want}`);
        assert(levelSwatch(key) === want, `levelSwatch(${key}) = ${levelSwatch(key)}`);
        said.push(`${key} ${want}`);
      });
      assert(rule(CSS, '.card .swatch'), '.card .swatch has no rule — the chip would be invisible');
      return said.join(', ');
    } finally { close(); }
  });

  check('frontend: a settings column\'s reset button puts that column back to the defaults, and only that column', () => {
    const { menu, settings, doc, fired, close } = menuOn(HTML);
    try {
      const buttons = doc.querySelectorAll('button.reset-tab');
      assert(buttons.length >= 3, `${buttons.length} reset buttons on the page`);
      const control = buttons.find((b) => b.getAttribute('data-reset-col') === 'control');
      assert(control, 'no reset button for the control column');
      menu._set('fov', 85);
      menu._set('sensitivity', 2.5);
      menu._set('volume', 0.1);         // the sound column — must NOT reset
      menu.s.scheme = 'classic';
      menu._buildOptions();
      assert(settings.fov === 85 && settings.sensitivity === 2.5, 'the sliders did not take the test values');
      fired.length = 0;
      control.dispatchEvent(new (doc.defaultView?.Event || Event)('click'));
      assert(settings.fov === DEFAULT_SETTINGS.fov, `fov is ${settings.fov} after reset, default ${DEFAULT_SETTINGS.fov}`);
      assert(settings.sensitivity === DEFAULT_SETTINGS.sensitivity, `sensitivity is ${settings.sensitivity} after reset`);
      assert(settings.scheme === DEFAULT_SETTINGS.scheme, `scheme is ${settings.scheme} after reset`);
      assert(settings.volume === 0.1, `the sound column's master volume was reset too (${settings.volume})`);
      const pill = doc.getElementById('opt-fov').parentElement.querySelector('b');
      assert(pill && pill.textContent.includes(String(DEFAULT_SETTINGS.fov)),
        `the FOV pill reads "${pill?.textContent}" after the reset`);
      const lit = doc.querySelector('#opt-scheme .diff.sel');
      assert(lit && lit.dataset.scheme === DEFAULT_SETTINGS.scheme, 'the default scheme row is not the lit one');
      assert(fired.some(([n, v]) => n === 'onSchemeChange' && v === DEFAULT_SETTINGS.scheme),
        'the scheme hook did not fire for the reset');
      return `fov ${DEFAULT_SETTINGS.fov}, sensitivity ${DEFAULT_SETTINGS.sensitivity}, scheme ${DEFAULT_SETTINGS.scheme} restored; vol 0.1 kept`;
    } finally { close(); }
  });
}
