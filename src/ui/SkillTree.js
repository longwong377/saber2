/**
 * SABER — the meditation: the constellation, drawn.
 *
 * THIS FILE DRAWS AND NOTHING ELSE. Every rule about what may be lit, what it
 * costs and what it is called lives in src/game/Constellation.js, which has no
 * DOM in it and can therefore be driven by a check without a browser. What is
 * here is the sky, the lines, the stars and one button — and the discipline
 * that keeps it that way is `starView`: this file asks for a star's state and
 * renders it, and never decides one.
 *
 * ── why it is not in Menu.js ──────────────────────────────────────────────
 *
 * Because it is not a menu. Menu.js owns the pre-run screens — deploy, forge,
 * options, codex — which are all "choose, then play". The meditation is raised
 * MID-RUN, over a stopped world, through the same `Screens.take` the draft goes
 * through, and it has to be able to come and go without the main menu existing
 * at all. It is an overlay in the game, not a page in the front end.
 *
 * ── the moment ───────────────────────────────────────────────────────────
 *
 * The world is not hidden. The overlay is translucent and the frozen frame sits
 * behind it — your own kneeling body, the wave you stopped in the middle of —
 * because the whole point of reaching this by kneeling rather than by pressing
 * Escape is that it is a thing that happens IN the place, not a thing that
 * happens instead of it.
 */

import { skyView, starView, shapeOf, constellationName, creedOf, CONSTELLATIONS, SKY, LOCKED, COST_STEP, zoneOf }
  from '../game/Constellation.js';
import { audio } from '../engine/Audio.js';

const NS = 'http://www.w3.org/2000/svg';

/** A deterministic little PRNG, so the background sky is the same every time. */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const svg = (name, attrs = {}) => {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

export class SkillTree {
  /**
   * @param {Document} doc
   * @param {object} hooks
   * @param {(id: string) => void} hooks.onBuy   the player spent on this star
   * @param {() => void} hooks.onClose
   */
  constructor(doc, hooks = {}) {
    this.doc = doc;
    this.hooks = hooks;
    this.el = {
      root: doc.getElementById('meditation'),
      sky: doc.getElementById('med-sky'),
      insight: doc.getElementById('med-insight'),
      title: doc.getElementById('med-title'),
      sub: doc.getElementById('med-sub'),
      detail: doc.getElementById('med-detail'),
      buy: doc.getElementById('btn-med-buy'),
      shape: doc.getElementById('med-shape'),
      hint: doc.getElementById('med-hint'),
      close: doc.getElementById('btn-med-close'),
    };
    this.selected = null;
    this.view = null;
    this._nodes = new Map();

    this.el.close?.addEventListener('click', () => { audio.ui('click'); this.hooks.onClose?.(); });
    this.el.buy?.addEventListener('click', () => this._buy());
  }

  get open() { return !!this.el.root && !this.el.root.classList.contains('hidden'); }

  /**
   * Raise the sky.
   *
   * @param {object} ctx
   * @param {Set} ctx.taken     the run's taken-set (a RankSet)
   * @param {object} ctx.ledger a Communion
   * @param {number} ctx.wave
   * @param {string|null} ctx.order   'jedi' | 'sith' | 'grey' | null — the alignment
   *                                  every name in here is read in
   * @param {boolean} [ctx.live]      is there a run to spend in? Between runs
   *                                  the sky is a chart, not a shop.
   * @param {string} [ctx.subtitle]
   */
  show(ctx) {
    if (!this.el.root) return false;
    this.ctx = ctx;
    this.el.root.classList.remove('hidden');
    this._draw();
    this._select(this.selected && this._nodes.has(this.selected) ? this.selected : null);
    return true;
  }

  hide() { this.el.root?.classList.add('hidden'); }

  /** Redraw in place — after a purchase, the sky has changed shape. */
  refresh() { if (this.open) { this._draw(); this._select(this.selected); } }

  /* ── drawing ───────────────────────────────────────────────────────── */

  _draw() {
    const { taken, ledger, wave = 1, order = null, live = true, history = null } = this.ctx || {};
    const sky = this.el.sky;
    if (!sky) return;
    this.view = skyView({ taken, ledger, wave, order });
    const byId = new Map(this.view.map((v) => [v.id, v]));
    while (sky.firstChild) sky.removeChild(sky.firstChild);
    this._nodes.clear();
    // The heading says which of the two this is: a communion you can spend in,
    // or the chart you read between runs.
    if (this.el.title) this.el.title.textContent = live ? 'Connect to the Force' : 'The constellation';

    /* the field of far stars — atmosphere, and the reason it reads as a sky */
    const rnd = seeded(0x5ABE7);
    const field = svg('g', { class: 'med-field' });
    for (let i = 0; i < 190; i++) {
      const r = 0.4 + rnd() * 1.5;
      field.appendChild(svg('circle', {
        cx: (rnd() * SKY.w).toFixed(1), cy: (rnd() * SKY.h).toFixed(1),
        r: r.toFixed(2), opacity: (0.12 + rnd() * 0.5).toFixed(2),
      }));
    }
    sky.appendChild(field);

    /* the constellation names, behind their stars */
    // At the TOP OF THE ZONE, not near the group's own centre: a constellation
    // fills its zone, so anything drawn at the middle of it lands on a star.
    const labels = svg('g', { class: 'med-cnames' });
    for (const c of CONSTELLATIONS) {
      const z = zoneOf(c.axis);
      if (!z) continue;
      const t = svg('text', { x: z.x, y: z.y - z.halfH - 18, 'text-anchor': 'middle', class: 'cname' });
      t.textContent = constellationName(c.axis, order).toUpperCase();
      labels.appendChild(t);
    }
    sky.appendChild(labels);

    /* the lines, drawn once per pair and under every node */
    const lines = svg('g', { class: 'med-links' });
    const seen = new Set();
    for (const v of this.view) {
      for (const other of v.to) {
        const key = v.id < other ? `${v.id}|${other}` : `${other}|${v.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const w = byId.get(other);
        if (!w) continue;
        const cls = v.held && w.held ? 'lit' : (v.held || w.held) ? 'open' : 'dim';
        lines.appendChild(svg('line', { x1: v.x, y1: v.y, x2: w.x, y2: w.y, class: cls }));
      }
    }
    sky.appendChild(lines);

    /* and the stars themselves */
    const stars = svg('g', { class: 'med-stars' });
    for (const v of this.view) {
      const g = svg('g', {
        class: ['star', v.held ? 'held' : '', v.can && live ? 'can' : '', v.root ? 'root' : '',
          v.mastery ? 'mastery' : '', v.locked === LOCKED.spent ? 'spent' : '',
          history?.get(v.id) ? 'known' : ''].filter(Boolean).join(' '),
        transform: `translate(${v.x} ${v.y})`,
        tabindex: '0', role: 'button',
      });
      g.appendChild(svg('circle', { class: 'halo', r: v.root ? 21 : v.mastery ? 18 : 15 }));
      g.appendChild(svg('circle', { class: 'disc', r: v.root ? 15 : v.mastery ? 13 : 11 }));
      const icon = svg('text', { class: 'glyph', y: 5, 'text-anchor': 'middle' });
      icon.textContent = v.icon || '·';
      g.appendChild(icon);
      const label = svg('text', { class: 'label', y: (v.root ? 34 : 28), 'text-anchor': 'middle' });
      label.textContent = v.name.replace(/^Mastery — /, '');
      g.appendChild(label);
      // rank pips: how many times this star has been lit, drawn rather than
      // written, because "×3" in 9px type at this scale is unreadable.
      for (let i = 0; i < Math.min(v.rank, 5); i++) {
        g.appendChild(svg('circle', { class: 'pip', cx: (i - (Math.min(v.rank, 5) - 1) / 2) * 7, cy: -20, r: 2 }));
      }
      if (!v.held && v.can && live) {
        const c = svg('text', { class: 'cost', y: -22, 'text-anchor': 'middle' });
        c.textContent = String(v.cost);
        g.appendChild(c);
      }
      /* A STAR ALREADY CLAIMED TO BE A BUTTON. NOW IT BEHAVES LIKE ONE.
       *
       * `tabindex: '0', role: 'button'` above (and the `#med-sky .star:focus`
       * rule in styles.css) make every star focusable and announce it to a
       * screen reader as a button — and the only listeners were `click` and
       * `dblclick`, so Enter and Space did nothing at all. That is worse than
       * an unreachable control: it is the interface promising a keyboard path
       * it never built, and it was the ONE place in the whole front end that
       * had bothered to set tabindex. Enter selects, exactly as a click does;
       * Enter on the star already selected buys it, which is the keyboard's
       * version of the double-click. */
      const select = () => { audio.ui('hover'); this._select(v.id); };
      g.addEventListener('click', select);
      g.addEventListener('dblclick', () => this._buy(v.id));
      g.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar' && e.code !== 'Space') return;
        e.preventDefault();
        if (this.selected === v.id) this._buy(v.id); else select();
      });
      stars.appendChild(g);
      this._nodes.set(v.id, g);
    }
    sky.appendChild(stars);

    /* the ledger line */
    if (this.el.insight) this.el.insight.textContent = String(Math.floor(ledger?.insight ?? 0));
    if (this.el.sub) {
      this.el.sub.textContent = live
        ? (this.ctx.subtitle || 'Insight is earned by surviving. Light a star joined to one you already hold.')
        : 'Between runs the sky is a chart: nothing here is bought, and nothing is carried into the next run.';
    }
    if (this.el.hint) {
      const n = ledger?.bought?.length ?? 0;
      this.el.hint.textContent = n
        ? `${n} star${n === 1 ? '' : 's'} lit by communion this run · each one makes the next cost ${COST_STEP} more`
        : 'Escape returns you to the fight.';
    }
    this._drawShape();
  }

  _drawShape() {
    const host = this.el.shape;
    if (!host) return;
    const { taken, order = null } = this.ctx || {};
    const rows = shapeOf(taken).filter((r) => r.lit > 0).sort((a, b) => b.ranks - a.ranks);
    if (!rows.length) {
      host.innerHTML = '<div class="med-empty">Nothing lit yet. The Force offers cards; the sky is where you choose.</div>';
      return;
    }
    host.innerHTML = rows.map((r) => `
      <div class="med-row">
        <span>${constellationName(r.axis, order)}</span>
        <i><b style="width:${Math.round(100 * r.lit / r.total)}%"></b></i>
        <em>${r.lit}/${r.total}</em>
      </div>`).join('');
  }

  /* ── selection and spending ────────────────────────────────────────── */

  _select(id) {
    this.selected = id;
    for (const [key, g] of this._nodes) g.classList.toggle('sel', key === id);
    const host = this.el.detail;
    const { taken, ledger, wave = 1, order = null, live = true } = this.ctx || {};
    if (!host) return;
    if (!id) {
      const axis = CONSTELLATIONS[0].axis;
      host.innerHTML = `<h3>The sky</h3><p class="med-text">${creedOf(axis, order)}</p>`
        + '<p class="med-text">Pick a star to read it.</p>';
      if (this.el.buy) { this.el.buy.disabled = true; this.el.buy.textContent = 'Commune'; }
      return;
    }
    const v = starView(id, { taken, ledger, wave, order });
    if (!v) return;
    const seen = this.ctx?.history?.get(id) || 0;
    const canon = v.canon !== v.name ? `<span class="med-canon">${v.canon}</span>` : '';
    host.innerHTML = `
      <h3>${v.icon} ${v.name}</h3>
      ${canon}
      <div class="med-tags"><em>${v.tag}</em><em>${v.rarityLabel}</em>${v.root ? '<em>heart of the constellation</em>' : ''}${v.mastery ? '<em>mastery</em>' : ''}</div>
      <p class="med-text">${v.text}</p>
      <p class="med-state">${this._stateLine(v, live)}</p>
      ${seen ? `<p class="med-canon">carried in ${seen} run${seen === 1 ? '' : 's'} before this one</p>` : ''}`;
    if (this.el.buy) {
      this.el.buy.disabled = !(v.can && live);
      this.el.buy.textContent = v.can && live ? `Commune — ${v.cost} Insight` : 'Commune';
    }
  }

  _stateLine(v, live) {
    const rank = v.rank ? `Held${isFinite(v.max) ? ` at ${v.rank} of ${v.max}` : ` ×${v.rank}`}. ` : '';
    if (!live) return `${rank}Between runs nothing can be lit.`;
    if (v.can) return `${rank}${v.cost} Insight.`;
    // Keyed off LOCKED rather than off copies of its strings, so a reason that
    // is renamed cannot silently become an empty line here.
    switch (v.locked) {
      case LOCKED.spent: return `${rank}There is nothing left of this one to take.`;
      case LOCKED.insight: return `${rank}${v.cost} Insight — you have not earned it yet.`;
      case LOCKED.reach: return `${rank}Nothing you hold reaches this far.`;
      case LOCKED.gated: return `${rank}A mastery. Commit to the discipline first.`;
      case LOCKED.depth: return `${rank}Too early. This one comes later.`;
      default: return rank;
    }
  }

  _buy(id = this.selected) {
    const { taken, ledger, wave = 1, live = true } = this.ctx || {};
    if (!id || !live || !ledger) return;
    if (!ledger.canBuy(id, taken, wave)) { audio.ui('bad'); return; }
    audio.ui('good');
    this.hooks.onBuy?.(id);
  }
}
