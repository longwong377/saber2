/**
 * A PAGE THE FRONT END CAN ACTUALLY BE BUILT ON, UNDER NODE.
 *
 * The audit that produced this file found that nothing in the ~940-check suite
 * had ever constructed a Menu. Every guarantee about the largest UI file in the
 * repo (src/ui/Menu.js, 2835 lines) was a regex run over its own source text —
 * including the flagship one, "every control in the menu is bound to a
 * setting", which matches `_slider('opt-…', '…'` against `id="opt-…"` in
 * index.html. Both of those strings are in their files whether or not a single
 * line of either ever runs, and `_slider`/`_check` return silently when
 * `getElementById` misses, so the whole set would have passed unchanged if the
 * constructor were replaced with `return;`. That is the same "nothing ever
 * constructed a World" hole this project already closed once, one layer up, and
 * it is what let a duplicate group heading, a listener registered four times
 * over, and 120 controls with no keyboard path all ship at once.
 *
 * So: a small DOM, real enough that the real Menu runs on it.
 *
 * It parses index.html rather than faking ids, because the ids ARE the contract
 * between the markup and the menu — a shim built from a list of strings can
 * only ever agree with itself. Everything the menu touches is here and nothing
 * else is: elements with children and parents, text nodes (the wave counter
 * reaches through `firstChild` into one), classes, dataset, attributes,
 * innerHTML that PARSES rather than storing a string (so "did this interpolate
 * a peer's name as markup" is answerable by looking for an element, not by
 * looking for a substring), listeners that can be dispatched, and focus.
 *
 * What it deliberately is not: a layout engine. Nothing here computes a box.
 * Geometry claims are checked against styles.css directly — see the frame
 * counter's overlap check in tools/checks/hud-events.mjs.
 */

import { readFile } from 'node:fs/promises';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class TextNode {
  constructor(text) { this.nodeType = 3; this.data = String(text); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get parentElement() { return this.parentNode; }
  get nextSibling() { return sibling(this, 1); }
  get previousSibling() { return sibling(this, -1); }
  _serialize() { return esc(this.data); }
}

function sibling(node, step) {
  const p = node.parentNode;
  if (!p) return null;
  const i = p.childNodes.indexOf(node);
  return i < 0 ? null : (p.childNodes[i + step] || null);
}

class Element {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.ownerDocument = doc;
    this.attrs = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    /**
     * A LIVE VIEW OVER THE data-* ATTRIBUTES, and it was a plain object.
     *
     * In a browser `dataset` IS the attributes — `el.dataset.panel = 'company'`
     * puts `data-panel="company"` on the element and a `[data-panel="company"]`
     * selector finds it. Here it was a bare `{}` that `setAttribute` happened
     * to also write into, so the traffic ran one way only: markup parsed from
     * index.html could be selected on, and anything a builder created in JS
     * could not. Every dynamically built panel in this game is built that way
     * — `Menu._buildDatabank` and `_buildCompany` both do `panel.dataset.panel
     * = ...` — so a check that asked for one by attribute got null and the only
     * honest reading of that was "the tab has no panel".
     *
     * A Proxy over `attrs` makes the two the same thing in both directions,
     * which is what the DOM does. Reads answer from the attribute map, writes
     * land in it, and `delete` removes the attribute — so `hasAttribute`,
     * `getAttribute`, `outerHTML` and the selector engine all agree with it
     * without any of them being taught about `dataset`.
     */
    const kebab = (k) => 'data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    const attrs = this.attrs;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? attrs.get(kebab(k)) : undefined),
      set: (_, k, v) => { attrs.set(kebab(k), String(v)); return true; },
      has: (_, k) => typeof k === 'string' && attrs.has(kebab(k)),
      deleteProperty: (_, k) => { attrs.delete(kebab(k)); return true; },
      ownKeys: () => [...attrs.keys()].filter((n) => n.startsWith('data-'))
        .map((n) => n.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())),
      getOwnPropertyDescriptor: (_, k) => (typeof k === 'string' && attrs.has(kebab(k))
        ? { value: attrs.get(kebab(k)), enumerable: true, configurable: true } : undefined),
    });
    this._listeners = new Map();
    if (this.localName === 'input' || this.localName === 'textarea') {
      this.value = '';
      this.checked = false;
      this.disabled = false;
    }
  }

  /* ── tree ─────────────────────────────────────────────────────────── */
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get parentElement() { return this.parentNode; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get nextSibling() { return sibling(this, 1); }
  get previousSibling() { return sibling(this, -1); }

  appendChild(node) {
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    this.ownerDocument?._index(node);
    return node;
  }
  insertBefore(node, ref) {
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    node.parentNode?.removeChild(node);
    node.parentNode = this;
    if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node);
    this.ownerDocument?._index(node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) { this.childNodes.splice(i, 1); node.parentNode = null; }
    return node;
  }
  remove() { this.parentNode?.removeChild(this); }
  /**
   * `el.after(node)` — the one insertion verb the menu uses that is not
   * appendChild or insertBefore. `Menu._buildPauseTraining` has always called
   * it (`this.el.pauseStats.after(box)`), which meant `showPause` threw the
   * moment it was driven on this page and NOTHING in the suite had ever driven
   * it: the pause card is the only card in the game that had never been raised
   * outside a browser. Sibling insertion, so it goes through the parent's own
   * insertBefore and inherits the indexing with it.
   */
  after(node) {
    const p = this.parentNode;
    if (!p) return node;
    const i = p.childNodes.indexOf(this);
    return p.insertBefore(node, p.childNodes[i + 1] || null);
  }

  /* ── attributes ───────────────────────────────────────────────────── */
  setAttribute(name, value) {
    const n = String(name).toLowerCase();
    this.attrs.set(n, String(value));
    /* No `dataset` write here any more: it IS `attrs` now — see the Proxy in
     * the constructor. The line that used to be here was the one-way half of
     * the traffic and its absence is the fix. */
    if (n === 'value' && 'value' in this) this.value = String(value);
    if (n === 'checked') this.checked = true;
    if (n === 'disabled') this.disabled = true;
  }
  getAttribute(name) {
    const n = String(name).toLowerCase();
    if (n === 'class') return this.attrs.get('class') ?? null;
    return this.attrs.has(n) ? this.attrs.get(n) : null;
  }
  hasAttribute(name) { return this.attrs.has(String(name).toLowerCase()); }
  removeAttribute(name) {
    const n = String(name).toLowerCase();
    this.attrs.delete(n);
    if (n === 'disabled') this.disabled = false;
  }

  get id() { return this.attrs.get('id') || ''; }
  set id(v) { this.setAttribute('id', v); this.ownerDocument?._index(this); }
  get className() { return this.attrs.get('class') || ''; }
  set className(v) { this.attrs.set('class', String(v)); }
  get classList() {
    const el = this;
    const list = () => (el.className ? el.className.split(/\s+/).filter(Boolean) : []);
    const write = (a) => { el.className = a.join(' '); };
    return {
      get length() { return list().length; },
      contains: (c) => list().includes(c),
      add: (...cs) => { const a = list(); for (const c of cs) if (!a.includes(c)) a.push(c); write(a); },
      remove: (...cs) => write(list().filter(c => !cs.includes(c))),
      toggle: (c, on) => {
        const has = list().includes(c);
        const want = on === undefined ? !has : !!on;
        if (want && !has) write([...list(), c]);
        else if (!want && has) write(list().filter(x => x !== c));
        return want;
      },
      toString: () => el.className,
    };
  }
  /**
   * −1 EXCEPT WHERE A BROWSER SAYS 0, and the exception is the whole point.
   *
   * `tabIndex` answered −1 for every element with no `tabindex` attribute,
   * which is right for a `<div>` and WRONG for a form control: a browser gives
   * `<input>`, `<button>`, `<select>`, `<textarea>` and `<a href>` a default of
   * 0 because they are focusable without being asked. `Menu._padFocusable`
   * filters on exactly this — `if (el.disabled || el.tabIndex < 0) return
   * false` — so on this page every slider and every checkbox in the game
   * dropped out of the pad's walk, and a check driving a controller measured
   * an empty list and could not tell that from a controller that cannot reach
   * them. Measured: #menu came back 453 controls and 0 of its 33 sliders.
   */
  get tabIndex() {
    if (this.attrs.has('tabindex')) return Number(this.attrs.get('tabindex'));
    if (this.localName === 'a') return this.attrs.has('href') ? 0 : -1;
    return ['input', 'button', 'select', 'textarea'].includes(this.localName) ? 0 : -1;
  }
  set tabIndex(v) { this.setAttribute('tabindex', String(v)); }
  get title() { return this.attrs.get('title') || ''; }
  set title(v) { this.setAttribute('title', v); }

  /* ── content ──────────────────────────────────────────────────────── */
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v != null) this.appendChild(new TextNode(v));
  }
  get innerHTML() { return this.childNodes.map(n => n._serialize()).join(''); }
  set innerHTML(html) {
    this.childNodes = [];
    for (const n of parseFragment(String(html), this.ownerDocument)) this.appendChild(n);
  }
  _serialize() {
    const a = [...this.attrs].map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    if (VOID.has(this.localName)) return `<${this.localName}${a}>`;
    return `<${this.localName}${a}>${this.innerHTML}</${this.localName}>`;
  }

  /* ── selectors ────────────────────────────────────────────────────── */
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const groups = String(sel).split(',').map(s => s.trim()).filter(Boolean);
    for (const node of descendants(this)) {
      if (groups.some(g => matchesDescendant(node, g)) && !out.includes(node)) out.push(node);
    }
    return out;
  }
  matches(sel) {
    return String(sel).split(',').some(g => matchesDescendant(this, g.trim()));
  }
  closest(sel) {
    for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n;
    return null;
  }

  /* ── events & focus ───────────────────────────────────────────────── */
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const a = this._listeners.get(type);
    if (!a) return;
    const i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
  }
  listenerCount(type) { return (this._listeners.get(type) || []).length; }
  dispatchEvent(event) {
    const ev = { type: event.type, target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {}, ...event };
    ev.preventDefault = () => { ev.defaultPrevented = true; };
    for (const fn of [...(this._listeners.get(ev.type) || [])]) fn.call(this, ev);
    return !ev.defaultPrevented;
  }
  /** Dispatch the way a mouse would: the same event every picker listens for. */
  click() { return this.dispatchEvent({ type: 'click' }); }
  /** Dispatch the way a keyboard would. `key` is the DOM key, e.g. 'Enter'. */
  press(key, extra = {}) {
    return this.dispatchEvent({ type: 'keydown', key, code: key === ' ' ? 'Space' : key, ...extra });
  }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null; }
  getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
  get clientWidth() { return 0; }
  get clientHeight() { return 0; }
  scrollIntoView() {}
}

function* descendants(root) {
  for (const c of root.childNodes) {
    if (c.nodeType !== 1) continue;
    yield c;
    yield* descendants(c);
  }
}

/** `.card`, `#id`, `tag`, `[data-x="y"]`, and any run of them, in sequence. */
function matchesSimple(el, sel) {
  if (!sel || sel === '*') return true;
  const parts = sel.match(/(^[a-zA-Z][\w-]*)|(\.[\w-]+)|(#[\w-]+)|(\[[^\]]+\])|(:[\w-]+)/g) || [];
  for (const p of parts) {
    if (p[0] === '.') { if (!el.classList.contains(p.slice(1))) return false; }
    else if (p[0] === '#') { if (el.id !== p.slice(1)) return false; }
    else if (p[0] === '[') {
      const m = p.slice(1, -1).match(/^([\w-]+)(?:\s*=\s*"?([^"\]]*)"?)?$/);
      if (!m) return false;
      if (!el.hasAttribute(m[1])) return false;
      if (m[2] !== undefined && el.getAttribute(m[1]) !== m[2]) return false;
    } else if (p[0] === ':') { /* pseudo-classes are not modelled */ }
    else if (el.localName !== p.toLowerCase()) return false;
  }
  return true;
}

/** Descendant combinators only — the menu uses nothing else. */
function matchesDescendant(el, sel) {
  const seq = sel.split(/\s+/).filter(Boolean);
  if (!matchesSimple(el, seq[seq.length - 1])) return false;
  let node = el.parentElement;
  for (let i = seq.length - 2; i >= 0; i--) {
    while (node && !matchesSimple(node, seq[i])) node = node.parentElement;
    if (!node) return false;
    node = node.parentElement;
  }
  return true;
}

/* ── the parser ─────────────────────────────────────────────────────────
 *
 * Tag soup, not a spec parser: index.html is hand-written, well-formed and
 * checked into the same repo, so the only cases that need handling are the ones
 * it actually contains — comments, void elements, quoted attributes, and two
 * raw-text elements (<script>, <style>) whose contents must not be read as
 * markup. An unclosed tag closes at its parent's close, which is what a browser
 * does with the shapes this file uses.
 */
function parseFragment(html, doc) {
  const root = new Element('template', doc);
  let node = root;
  let i = 0;
  const text = (s) => { if (s) node.appendChild(new TextNode(s)); };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { text(html.slice(i)); break; }
    text(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt); i = e < 0 ? html.length : e + 3; continue; }
    if (html.startsWith('<!', lt)) { const e = html.indexOf('>', lt); i = e < 0 ? html.length : e + 1; continue; }
    if (html.startsWith('</', lt)) {
      const e = html.indexOf('>', lt);
      const name = html.slice(lt + 2, e).trim().toLowerCase();
      for (let n = node; n && n !== root; n = n.parentNode) {
        if (n.localName === name) { node = n.parentNode; break; }
      }
      i = e < 0 ? html.length : e + 1;
      continue;
    }
    const e = html.indexOf('>', lt);
    if (e < 0) { text(html.slice(lt)); break; }
    const raw = html.slice(lt + 1, e);
    const name = (raw.match(/^[a-zA-Z][\w-]*/) || [''])[0].toLowerCase();
    if (!name) { text(html.slice(lt, e + 1)); i = e + 1; continue; }
    const el = new Element(name, doc);
    for (const m of raw.slice(name.length).matchAll(/([:@\w-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
      let v = m[2] ?? '';
      if (v && (v[0] === '"' || v[0] === "'")) v = v.slice(1, -1);
      el.setAttribute(m[1], v);
    }
    if (el.hasAttribute('style')) {
      for (const d of el.getAttribute('style').split(';')) {
        const c = d.indexOf(':');
        if (c > 0) el.style[d.slice(0, c).trim().replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = d.slice(c + 1).trim();
      }
    }
    node.appendChild(el);
    i = e + 1;
    if (VOID.has(name) || raw.endsWith('/')) continue;
    if (RAW.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, i);
      const end = close < 0 ? html.length : close;
      el.appendChild(new TextNode(html.slice(i, end)));
      const gt = html.indexOf('>', end);
      i = gt < 0 ? html.length : gt + 1;
      continue;
    }
    node = el;
  }
  return root.childNodes.map(n => { n.parentNode = null; return n; });
}

/* ── a canvas that draws nothing but answers everything ───────────────── */
const CTX = new Proxy({}, {
  get(_t, k) {
    if (k === 'canvas') return null;
    if (k === 'measureText') return () => ({ width: 0 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'getImageData' || k === 'createImageData') {
      return (a, b, w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    }
    return () => {};
  },
  set() { return true; },
});

/**
 * A document, built from a page of markup.
 *
 * `install()` puts it on globalThis so module-scope UI code sees it, and
 * returns the restore function — always call it in a `finally`, because the
 * suite shares one process with checks that expect the plain dom-shim.
 */
export function makeDocument(html = '') {
  const doc = {
    nodeType: 9,
    activeElement: null,
    _ids: new Map(),
    _index(node) {
      if (node.nodeType !== 1) return;
      if (node.id) doc._ids.set(node.id, node);
      for (const c of node.childNodes) doc._index(c);
    },
    createElement(tag) {
      const el = new Element(tag, doc);
      if (el.localName === 'canvas') {
        el.width = 1; el.height = 1;
        el.getContext = (kind) => (kind === '2d' ? CTX : null);
        el.toDataURL = () => 'data:,';
      }
      return el;
    },
    createElementNS(_ns, tag) { return doc.createElement(tag); },
    createTextNode(t) { return new TextNode(t); },
    getElementById(id) {
      const hit = doc._ids.get(id);
      if (hit && isAttached(hit, doc)) return hit;
      doc._ids.delete(id);
      const found = [...descendants(doc.documentElement)].find(n => n.id === id) || null;
      if (found) doc._ids.set(id, found);
      return found;
    },
    querySelector(sel) { return doc.documentElement.querySelector(sel); },
    querySelectorAll(sel) { return doc.documentElement.querySelectorAll(sel); },
    addEventListener() {}, removeEventListener() {},
  };
  doc.documentElement = new Element('html', doc);
  const nodes = parseFragment(html, doc);
  for (const n of nodes) doc.documentElement.appendChild(n);
  doc.head = doc.documentElement.querySelector('head') || doc.documentElement.appendChild(new Element('head', doc));
  doc.body = doc.documentElement.querySelector('body') || doc.documentElement.appendChild(new Element('body', doc));
  doc._index(doc.documentElement);

  doc.install = () => {
    const prev = globalThis.document;
    globalThis.document = doc;
    return () => { globalThis.document = prev; };
  };
  return doc;
}

function isAttached(node, doc) {
  for (let n = node; n; n = n.parentNode) if (n === doc.documentElement) return true;
  return false;
}

/** The real page, parsed. This is the only reason any of the above exists. */
export async function loadIndexHtml() {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  return makeDocument(html);
}

export { Element, TextNode };
