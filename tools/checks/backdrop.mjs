/**
 * BATTLEFRONT BORZ — what is behind a screen, and what is not allowed to be.
 *
 * THE DEFECT. Escape mid-run raised the pause card over a brown wall. `.screen`
 * in styles.css painted two tinted diagonals over
 * `linear-gradient(180deg,#231a13 0%,var(--void) 66%)`, opaque, and every one
 * of the eleven screens in index.html carries that class — so the pause card,
 * the death card, the boon draft, the deploy card, the muster, the scoreboard
 * (which added its own `rgba(4,7,12,.72)` and a 5 px blur INLINE) and the
 * mid-run Holocron all stood in front of a wall. The player:
 *
 *   "when pressing esc in game the pause menu has that brown filled
 *    background, I want the background to be just the game paused. No
 *    background in any ui or menu should have that solid background anymore —
 *    it should either always be the background image from the main menu or
 *    the game paused."
 *
 * THE FRAME WAS THERE THE WHOLE TIME. main.js's `frame()` calls
 * `engine.render(dt)` in every state and gates only `world.update` on
 * `paused` (World.update's first line is `if (!this.running || this.paused)
 * return;`), and nothing clears the canvas when a card goes up. Measured in
 * headless Chromium at 960x540 — sandbox on the Scoria, instant spawn, HUD
 * hidden, sixty rendered frames in, then `SABER.pause()` three frames later —
 * the mean colour of a 210x160 region LEFT of the card (x 20–230, y 190–350):
 *
 *     playing         r 159.4  g 151.8  b 118.0    world.time 2.83
 *     paused          r 135.6  g 138.5  b 110.3    world.time 3.00, card up
 *     paused, +3 fr   r 134.3  g 137.7  b 111.3    world.time 3.00 — held
 *
 * That is the same field through an 18% scrim: 15%, 9% and 7% down per
 * channel, under the 25% a changed picture would show (the camera composes
 * for three more frames before the state lands, which is where the rest of
 * the difference is — a region RIGHT of the card had a rock swing into it and
 * moved 59–77%). Three frames later the world's clock has not moved and the
 * region has not either: nothing clears the canvas, and the renderer went on
 * drawing (info.render.calls 2780 → 2782). Against the wall's own `#231a13` =
 * (35, 26, 19) the paused region is +100, +112, +91. The shots were looked
 * at: the card sits on the Ember Shelf the player was standing in, with the
 * blade still lit behind it.
 *
 * THE RULE, in two halves, both read out of the shipped files:
 *
 *   OVER A LIVE WORLD  a screen paints at most one flat black scrim at ≤ 18%.
 *     No opaque colour, no gradient, no url() at full opacity, and no
 *     backdrop-filter — a blur takes the game away as surely as a wall does.
 *     The CARD carries the panel fill and the 2 px ink, which is what keeps
 *     the type readable; it is asserted here too, because the old wash was
 *     what the pause card's hint line was legible against.
 *   WITH NO WORLD BEHIND IT  a screen carries the menu plate as a child.
 *
 * WHY MECHANICALLY. The wall was on a BARE selector, so nothing that grepped
 * for `#pause{background` would have found it, and a second one can come back
 * on any of a dozen selectors — `#pause`, `.screen.x`, `#death::before`, an
 * inline `style=` (the scoreboard's). So the stylesheet is walked rule by
 * rule; every selector whose SUBJECT — the last compound, the element the
 * rule paints — is a screen or a screen's pseudo-element is kept; and every
 * background declaration on it is parsed rather than pattern-matched: `var()`
 * is resolved from `:root`, alpha is read out of rgba()/hsla()/#rrggbbaa, an
 * unknown bare word is presumed to be a named colour (which is opaque), and a
 * url() is allowed only where the same rule sets `opacity` at or under the
 * ceiling (that is the 3.5% grain). The same parser runs over every `style=`
 * attribute on a `.screen` in index.html.
 *
 * WHICH SCREENS ARE WHICH is the one list typed here, and it is the short one:
 * the four the game shows with no world are boot (before main.js has run),
 * loading (inside buildWorld, after the old world is disposed), menu, and
 * unsupported (no WebGL2, so no world ever). Every other `.screen` in
 * index.html is an overlay BY CONSTRUCTION — the safe default, since a new
 * screen that is really a menu fails only the plate check, while a new overlay
 * that had been assumed to be a menu would ship a wall. The overlay list is
 * derived from the markup for that reason, and never typed.
 *
 * Every check below that describes the fix fails on the tree as it shipped —
 * run against `git show HEAD:styles.css` and `HEAD:index.html` before the
 * change, four of five were red: the scrim ceiling alone fails `.screen`, the
 * scoreboard fails the inline pass, #unsupported had no plate, and no card had
 * a fill. The fifth pins the render call the whole fix depends on.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { makeDocument } from './_page.mjs';
import { functionBody } from './_source.mjs';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/** The ceiling on a scrim's alpha over a live world. */
export const SCRIM_ALPHA = 0.18;
/** …and a scrim is BLACK: no channel above this, or it is a tint. */
export const SCRIM_CHANNEL = 32;
/** The screens the game shows with no world behind them. See the header. */
export const MENU_SCREENS = ['boot', 'loading', 'menu', 'unsupported'];

/* ── a CSS walk exactly as clever as it needs to be ──────────────────────
   Comments stripped, then braces counted. Nested at-rules that contain
   element rules (@media, @supports) are descended into; @keyframes and
   friends are not, because `from`/`to`/`50%` are not elements. No rule body
   in this stylesheet contains a brace — the grain's data: URI is
   percent-encoded, and `--cut` is a polygon. */
export function cssRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = [];
  walk(src, 0, src.length, out, null);
  return out;
}
function walk(src, from, to, out, media) {
  let i = from;
  while (i < to) {
    const open = src.indexOf('{', i);
    if (open < 0 || open >= to) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < to && depth) { const c = src[j]; if (c === '{') depth++; else if (c === '}') depth--; j++; }
    const bodyEnd = j - 1;
    if (prelude.startsWith('@')) {
      if (/^@(media|supports|layer|container)\b/.test(prelude)) walk(src, open + 1, bodyEnd, out, prelude);
    } else if (prelude) {
      const body = src.slice(open + 1, bodyEnd);
      out.push({ selector: prelude, body, media, decls: declarations(body) });
    }
    i = j;
  }
}

/** `prop:value` pairs, split on the semicolons outside parentheses and quotes. */
export function declarations(body) {
  const decls = [];
  let cur = '', depth = 0, q = null;
  const push = () => {
    const m = /^\s*([-\w]+)\s*:\s*([\s\S]*?)\s*$/.exec(cur);
    if (m) decls.push({ prop: m[1].toLowerCase(), value: m[2] });
  };
  for (const ch of body) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { push(); cur = ''; continue; }
    cur += ch;
  }
  push();
  return decls;
}

/** Split on the commas outside parentheses — a selector list, or background layers. */
export function splitTop(s) {
  const out = [];
  let cur = '', depth = 0, q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** The last compound of a complex selector: the element the rule actually paints. */
export function subjectOf(selector) {
  const s = selector.trim();
  let depth = 0, cut = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) cut = i + 1;
  }
  return s.slice(cut).trim();
}

/**
 * Which screens a subject compound can paint: the ids it names, or every
 * screen when it names the bare class. A pseudo-element paints OVER its
 * element, so `#pause::before` is #pause for this purpose.
 */
export function screensOf(subject, allIds) {
  const base = subject.replace(/::?(before|after|backdrop)\b/g, '');
  const ids = [...base.matchAll(/#([-\w]+)/g)].map((m) => m[1]);
  const classes = [...base.matchAll(/\.([-\w]+)/g)].map((m) => m[1]);
  if (ids.length) return ids.filter((id) => allIds.includes(id));
  if (classes.includes('screen')) return allIds.slice();
  return [];
}

/** `--name: value` from every `:root` rule. */
export function rootTokens(rules) {
  const t = new Map();
  for (const r of rules) {
    if (!splitTop(r.selector).some((s) => s.trim() === ':root')) continue;
    for (const d of r.decls) if (d.prop.startsWith('--')) t.set(d.prop, d.value);
  }
  return t;
}
export function resolveVars(value, tokens) {
  let v = value;
  for (let i = 0; i < 8 && /var\(/.test(v); i++) {
    v = v.replace(/var\(\s*(--[-\w]+)\s*(?:,\s*([^)]*))?\)/g, (m, name, fb) => tokens.get(name) ?? fb ?? m);
  }
  return v;
}

/* ── reading a colour out of a background layer ───────────────────────── */
const KEYWORDS = /^(no-repeat|repeat|repeat-x|repeat-y|round|space|cover|contain|center|top|left|right|bottom|fixed|scroll|local|border-box|padding-box|content-box|auto|none)$/i;
const CLEAR = /^(none|transparent|initial|inherit|unset|revert)$/i;
function channel(s, max = 255) {
  s = s.trim();
  if (s.endsWith('%')) return parseFloat(s) / 100 * max;
  return parseFloat(s);
}
function alphaOf(s) {
  if (s === undefined) return 1;
  s = s.trim();
  return s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
}
/** {r,g,b,a} for the colour a layer paints, or null when the layer paints none. */
export function colourOf(layer) {
  let m;
  if ((m = /rgba?\(([^)]*)\)/i.exec(layer))) {
    const parts = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alphaOf(parts[3]) };
  }
  if ((m = /hsla?\(([^)]*)\)/i.exec(layer))) {
    const parts = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
    const l = channel(parts[2], 255);
    return { r: l, g: l, b: l, a: alphaOf(parts[3]) };
  }
  if ((m = /#([0-9a-f]{3,8})\b/i.exec(layer))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  /* Whatever is left that is not a keyword, a length or a percentage is a
   * named colour, and every named colour is opaque. Presumed, not listed:
   * a check that has to know `peru` is a colour is a check that misses
   * `rebeccapurple`. */
  const words = layer.replace(/\b[-\w.]*\(.*?\)/g, ' ').split(/\s+/).filter(Boolean);
  const named = words.find((w) => !KEYWORDS.test(w) && !CLEAR.test(w) && !/^[-\d.]+(px|%|em|rem|vh|vw|deg)?$/.test(w));
  return named ? { r: 255, g: 255, b: 255, a: 1, named } : null;
}

const PAINT = new Set(['background', 'background-color', 'background-image', 'backdrop-filter', '-webkit-backdrop-filter']);

/**
 * Every way a set of declarations paints a backdrop, as a list of offences.
 * `overlay` false relaxes the rule to what a menu-type screen owes: no
 * gradient (the old wash's signature) and no opaque fill — a translucent veil
 * like `#boot::after`'s cream at .22 is allowed, because the plate is under it.
 */
export function judgePaint(decls, tokens, { overlay = true } = {}) {
  const out = [];
  const opacity = decls.filter((d) => d.prop === 'opacity').map((d) => parseFloat(d.value)).pop();
  for (const d of decls) {
    if (!PAINT.has(d.prop)) continue;
    const v = resolveVars(d.value, tokens).trim();
    if (d.prop.endsWith('backdrop-filter')) {
      if (!CLEAR.test(v)) out.push(`${d.prop}:${v} — a blur takes the game away as surely as a wall`);
      continue;
    }
    for (const layer of splitTop(v)) {
      if (CLEAR.test(layer)) continue;
      if (/-gradient\(/i.test(layer)) { out.push(`${d.prop} paints a gradient: ${layer}`); continue; }
      if (/url\(/i.test(layer)) {
        if (!(opacity <= SCRIM_ALPHA)) out.push(`${d.prop} paints an image at ${opacity ?? 'full'} opacity: ${layer.slice(0, 48)}…`);
        continue;
      }
      const c = colourOf(layer);
      if (!c) continue;
      const name = c.named ? `"${c.named}"` : layer;
      if (!overlay) {
        if (c.a >= 1) out.push(`${d.prop} paints ${name} opaque — under the plate that is a wall waiting for the plate to fail`);
        continue;
      }
      if (c.a > SCRIM_ALPHA + 1e-9) out.push(`${d.prop} paints ${name} at alpha ${c.a} — the ceiling over a live world is ${SCRIM_ALPHA}`);
      else if (Math.max(c.r, c.g, c.b) > SCRIM_CHANNEL) out.push(`${d.prop} paints ${name} — a scrim is black, not a tint`);
    }
  }
  return out;
}

/**
 * The whole audit on a pair of files, so it can be run on any version of
 * them. Returns what it looked at as well as what it found: a check that
 * examined nothing must be able to say so.
 */
export function audit({ css, html }) {
  const doc = makeDocument(html);
  const screens = doc.querySelectorAll('.screen');
  const allIds = screens.map((el) => el.id).filter(Boolean);
  const overlays = allIds.filter((id) => !MENU_SCREENS.includes(id));
  const rules = cssRules(css);
  const tokens = rootTokens(rules);

  const examined = [];                 // [selector, screens it paints]
  const problems = [];                 // { where, why }
  for (const r of rules) {
    for (const sel of splitTop(r.selector)) {
      const hit = screensOf(subjectOf(sel), allIds);
      if (!hit.length) continue;
      examined.push([sel, hit]);
      const overOverlay = hit.some((id) => overlays.includes(id));
      for (const why of judgePaint(r.decls, tokens, { overlay: overOverlay })) {
        problems.push({ where: `${r.media ? r.media + ' ' : ''}${sel}`, why, screens: hit });
      }
    }
  }

  const inline = [];                   // { id, style, why[] }
  for (const el of screens) {
    const style = el.getAttribute('style');
    if (!style) continue;
    const why = judgePaint(declarations(style), tokens, { overlay: overlays.includes(el.id) });
    inline.push({ id: el.id, style, why });
  }

  /* The plate, by the path `.menu-bg` names — one path in one place. */
  const bg = rules.find((r) => splitTop(r.selector).includes('.menu-bg'));
  const plateUrl = bg ? /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(bg.body)?.[1] ?? null : null;
  const plates = {};
  for (const id of MENU_SCREENS) {
    const el = doc.getElementById(id);
    if (!el) { plates[id] = null; continue; }
    const div = el.querySelector('.menu-bg');
    const img = el.querySelectorAll('img').find((i) => /\bboot-plate\b/.test(i.className)
      && (i.getAttribute('src') || '') === plateUrl);
    plates[id] = div ? '.menu-bg' : img ? 'img.boot-plate' : false;
  }

  /* The card each overlay raises: its first child that is not a plate. */
  const cards = {};
  for (const id of overlays) {
    const el = doc.getElementById(id);
    const wrap = el.children.find((c) => !/\bmenu-bg\b/.test(c.className));
    if (!wrap) { cards[id] = null; continue; }
    const classes = wrap.className.split(/\s+/).filter(Boolean);
    /* The cascade's answer for `background` and `border`: the LAST matching
     * declaration in source order wins, which is how a same-specificity
     * stylesheet resolves it. Only rules whose subject is the wrap itself. */
    let background = null, border = null;
    for (const r of rules) {
      for (const sel of splitTop(r.selector)) {
        const subj = subjectOf(sel).replace(/::?[-\w]+(\(.*?\))?/g, '');
        const subjClasses = [...subj.matchAll(/\.([-\w]+)/g)].map((m) => m[1]);
        if (!subjClasses.some((c) => classes.includes(c))) continue;
        if (/#[-\w]+/.test(subj) && !new RegExp(`#${id}\\b`).test(sel)) continue;
        for (const d of r.decls) {
          if (d.prop === 'background' || d.prop === 'background-color') background = resolveVars(d.value, tokens);
          if (d.prop === 'border') border = d.value;
        }
      }
    }
    cards[id] = { wrap: classes.join('.'), background, border };
  }

  return { allIds, overlays, menus: MENU_SCREENS, examined, problems, inline, plateUrl, plates, cards };
}

export async function run({ check, assert }, files = null) {
  const css = files?.css ?? await read('styles.css');
  const html = files?.html ?? await read('index.play.html');
  const main = files?.main ?? await read('src/main.js');
  const world = files?.world ?? await read('src/game/World.js');
  const A = audit({ css, html });

  check('backdrop: over a live world a screen paints nothing but an 18% scrim — every rule whose subject is a screen', () => {
    assert(A.allIds.length >= 8, `index.html has ${A.allIds.length} screens — the walk found too few to be reading the page`);
    assert(A.overlays.length >= 5, `${A.overlays.length} overlay screens — expected the pause, death, draft, deploy and muster cards at least`);
    /* A check that examined nothing cannot fail (HANDOFF §2.3b). The bare
     * `.screen` rule alone paints every overlay, so it must be in the set. */
    const bare = A.examined.filter(([sel]) => sel === '.screen');
    assert(bare.length >= 1, 'no rule with the bare `.screen` subject was examined — the walk is not seeing the stylesheet');
    const overOverlays = A.problems.filter((p) => p.screens.some((id) => A.overlays.includes(id)));
    assert(!overOverlays.length, `${overOverlays.length} wall(s) over a live world:\n`
      + overOverlays.map((p) => `      ${p.where}: ${p.why}`).join('\n'));
    const overMenus = A.problems.filter((p) => !p.screens.some((id) => A.overlays.includes(id)));
    assert(!overMenus.length, `${overMenus.length} fill(s) on a menu-type screen:\n`
      + overMenus.map((p) => `      ${p.where}: ${p.why}`).join('\n'));
    return `${A.examined.length} screen-subject selectors read over ${A.allIds.length} screens `
      + `(${A.overlays.length} overlays); no colour, gradient, image or blur past the scrim`;
  });

  check('backdrop: no inline style on a screen paints a wall either — the scoreboard had one', () => {
    const bad = A.inline.filter((s) => s.why.length);
    assert(!bad.length, bad.map((s) => `#${s.id} style="${s.style}": ${s.why.join('; ')}`).join('\n'));
    return A.inline.length
      ? `${A.inline.length} inline style(s) read: ${A.inline.map((s) => '#' + s.id).join(', ')}`
      : 'no screen carries an inline style';
  });

  check('backdrop: every screen with no world behind it carries the menu plate', () => {
    assert(A.plateUrl, 'styles.css has no `.menu-bg` rule with a url() — there is no plate to carry');
    assert(existsSync(new URL('../../' + A.plateUrl.replace(/^\.\//, ''), import.meta.url)),
      `.menu-bg names "${A.plateUrl}" and there is no such file`);
    const missing = Object.entries(A.plates).filter(([, how]) => !how);
    assert(!missing.length, missing.map(([id, how]) => how === null
      ? `#${id} is not in index.html — MENU_SCREENS names a screen that does not exist`
      : `#${id} has no plate: neither a .menu-bg child nor an img.boot-plate naming ${A.plateUrl}`).join('\n'));
    return Object.entries(A.plates).map(([id, how]) => `#${id} via ${how}`).join(', ');
  });

  check('backdrop: the card over a live world carries its own panel fill and ink, so the type reads on any frame', () => {
    /* The Holocron is the one overlay whose wrap is deliberately NOT a panel:
     * `.med-wrap` is the whole viewport and the place you knelt in is the
     * point of the screen. Its lattice (`#med-field`) and its detail column
     * (`.med-detail`) are the panels, and styles.css says so beside them. */
    const bad = [];
    for (const [id, card] of Object.entries(A.cards)) {
      if (id === 'meditation') continue;
      if (!card) { bad.push(`#${id} has no card element at all`); continue; }
      const c = card.background ? colourOf(card.background) : null;
      if (!c || c.a < 1) bad.push(`#${id}'s .${card.wrap} has no opaque fill (background: ${card.background ?? 'none'}) — its text sits on the game`);
      if (!card.border || !/\b2px\b/.test(card.border) || !/\bsolid\b/.test(card.border)) {
        bad.push(`#${id}'s .${card.wrap} has no 2 px ink (border: ${card.border ?? 'none'}) — law 1 of styles.css`);
      }
    }
    assert(!bad.length, bad.join('\n'));
    const done = Object.entries(A.cards).filter(([id]) => id !== 'meditation');
    return done.map(([id, c]) => `#${id} .${c.wrap}`).join(', ') + ' — filled and inked';
  });

  check('backdrop: the paused world is still drawn behind the card — render is not gated on the state', () => {
    /*
     * The whole fix rests on this: taking the wall away shows the game only
     * if the game is still on the canvas. `frame()` renders in every state
     * and steps the world in two; the numbers in the header were measured
     * against exactly this arrangement. A `renderer.clear()` on the pause
     * path, or an `if (state === 'playing') engine.render(dt)`, would put a
     * black screen where the wall was.
     */
    const frame = functionBody(main, 'function frame(');
    assert(/\n  engine\.render\(dt\);/.test(frame),
      'frame() does not call engine.render(dt) at its own top level — the renderer is inside a condition, '
      + 'and a paused world would stop being drawn');
    assert(!/\.clear\(\)/.test(frame), 'frame() clears the canvas — the paused frame would be black');
    const update = functionBody(world, '  update(rawDt, input) {');
    assert(/^\s*if \(!this\.running \|\| this\.paused\) return;/m.test(update),
      'World.update is not gated on `paused` at its first line — the world would keep moving under the card');
    for (const bad of [/renderer\.clear\(/, /setClearColor\(/]) {
      assert(!bad.test(main), `main.js ${bad} — something clears the canvas outside the engine`);
    }
    return 'engine.render(dt) unconditional in frame(); World.update returns on paused; nothing clears — '
      + 'measured (159,152,118) playing → (136,139,110) paused, left of the card, world.time held at 3.00';
  });
}
