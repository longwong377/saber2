/**
 * BATTLEFRONT BORZ — the meditation: the Holocron, drawn.
 *
 * THIS FILE DRAWS AND NOTHING ELSE. Every rule about what may be woken, what it
 * costs and what it is called lives in src/game/LivingForce.js, which has no
 * DOM in it and can therefore be driven by a check without a browser. What is
 * here is the lattice, the lines, the facets and one button — and the
 * discipline that keeps it that way is `facetView`: this file asks for a
 * facet's state and renders it, and never decides one.
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

import { latticeView, facetView, shapeOf, currentName, creedOf, CURRENTS, LATTICE, LOCKED, COST_STEP, zoneOf }
  from '../game/LivingForce.js';
import { audio } from '../engine/Audio.js';

const NS = 'http://www.w3.org/2000/svg';

/** A deterministic little PRNG, so the motes behind the lattice never move. */
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
   * @param {(id: string) => void} hooks.onBuy   the player spent on this facet
   * @param {() => void} hooks.onClose
   */
  constructor(doc, hooks = {}) {
    this.doc = doc;
    this.hooks = hooks;
    this.el = {
      root: doc.getElementById('meditation'),
      field: doc.getElementById('med-field'),
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
   * Raise the Holocron.
   *
   * @param {object} ctx
   * @param {Set} ctx.taken     the run's taken-set (a RankSet)
   * @param {object} ctx.ledger a Communion
   * @param {number} ctx.wave
   * @param {string|null} ctx.order   'jedi' | 'sith' | 'grey' | null — the alignment
   *                                  every name in here is read in
   * @param {boolean} [ctx.live]      is there a run to spend in? Between runs
   *                                  the Holocron is a chart, not a shop.
   * @param {string} [ctx.subtitle]
   */
  show(ctx) {
    if (!this.el.root) return false;
    this.ctx = ctx;
    this.el.root.classList.remove('hidden');
    /*
     * WHAT IS BEHIND THE HOLOCRON DECIDES HOW MUCH OF IT SHOWS THROUGH.
     *
     * `#meditation` deliberately overrides `.screen`'s near-black wash with a
     * thin one and takes the blur off, and the reason is written above the
     * rule: you reach this by KNEELING, and the place you knelt in should
     * still be there behind it. That is right, and it is the whole feeling of
     * the screen — over a battlefield.
     *
     * The Temple button is the other way in, and over the MENU the same
     * translucency reads as a bug rather than as atmosphere: the theatre
     * cards, the difficulty list and Ignite come through the lattice and sit
     * among the facets, one interface legible through another. Measured in a
     * browser at 1200×760, thirty-eight menu elements were readable through
     * the open Holocron.
     *
     * `live` already distinguishes the two — it is what makes this a shop or a
     * chart — so it decides the backdrop too, and neither case needs a wash
     * chosen for the other.
     */
    this.el.root.classList.toggle('over-world', !!ctx.live);
    this._draw();
    this._select(this.selected && this._nodes.has(this.selected) ? this.selected : null);
    return true;
  }

  hide() { this.el.root?.classList.add('hidden'); }

  /** Redraw in place — after a purchase, the lattice has changed shape. */
  refresh() { if (this.open) { this._draw(); this._select(this.selected); } }

  /* ── drawing ───────────────────────────────────────────────────────── */

  _draw() {
    const { taken, ledger, wave = 1, order = null, live = true, history = null } = this.ctx || {};
    const field = this.el.field;
    if (!field) return;
    this.view = latticeView({ taken, ledger, wave, order });
    const byId = new Map(this.view.map((v) => [v.id, v]));
    while (field.firstChild) field.removeChild(field.firstChild);
    this._nodes.clear();
    // The heading says which of the two this is: a communion you can spend in,
    // or the chart you read between runs.
    if (this.el.title) this.el.title.textContent = live ? 'Commune with the Holocron' : 'The Holocron';

    /* the motes suspended in the crystal — atmosphere, and nothing reads them */
    const rnd = seeded(0x5ABE7);
    const motes = svg('g', { class: 'med-motes' });
    for (let i = 0; i < 190; i++) {
      const r = 0.4 + rnd() * 1.5;
      motes.appendChild(svg('circle', {
        cx: (rnd() * LATTICE.w).toFixed(1), cy: (rnd() * LATTICE.h).toFixed(1),
        r: r.toFixed(2), opacity: (0.12 + rnd() * 0.5).toFixed(2),
      }));
    }
    field.appendChild(motes);

    /* the teachings' names, behind their facets */
    // At the TOP OF THE ZONE, not near the current's own centre: a current
    // fills its zone, so anything drawn at the middle of it lands on a facet.
    const labels = svg('g', { class: 'med-cnames' });
    const cnames = [];
    for (const c of CURRENTS) {
      const z = zoneOf(c.axis);
      if (!z) continue;
      /*
       * −28 AND NOT −18, WHICH IS WHERE THE FACET LABELS GET THEIR ROOM BACK.
       * The topmost facet of a current sits just under its heading and its own
       * label hangs below it, so at −18 the heading and that label were in the
       * same 10 px of the drawing. Teaching the label solver to avoid headings
       * did not fix it — it only moved the collision, 2 / 3 / 4 across the
       * three window sizes before and 2 / 3 / 4 after, because the label was
       * pushed off the heading straight into a neighbour. The heading is the
       * thing with somewhere to go: it is the only mark above the zone.
       */
      const cy = z.y - z.halfH - 28;
      const t = svg('text', { x: z.x, y: cy, 'text-anchor': 'middle', class: 'cname' });
      t.textContent = currentName(c.axis, order).toUpperCase();
      labels.appendChild(t);
      // Kept so a facet's own label can be placed around them. A current name
      // is 10px type at .34em tracking, which is wide for its character count,
      // so its box is measured with the rest rather than guessed at.
      cnames.push({ el: t, x: z.x, y: cy, text: t.textContent });
    }
    field.appendChild(labels);

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
        const cls = v.held && w.held ? 'woken' : (v.held || w.held) ? 'open' : 'dim';
        lines.appendChild(svg('line', { x1: v.x, y1: v.y, x2: w.x, y2: w.y, class: cls }));
      }
    }
    field.appendChild(lines);

    /*
     * WHICH SIDE OF ITS NODE A LABEL SITS ON.
     *
     * Every label used to hang below its node at a fixed offset, and for
     * forty-one of the forty-six that is fine. The five that are not are all
     * the same shape of problem: the longest names in the game belong to the
     * ATTUNEMENTS, the attunements are the roots, and a root is the hub its
     * current is drawn around — so the one label that needs the most room is
     * the one with neighbours on every side. Measured in a browser before
     * this, identically at 1600×900, 1200×760 and 900×620:
     *
     *   Attunement of the Guard   under the Form III — Soresu node
     *   Attunement of the Force   under the Wellspring node
     *   Attunement of the Shadow  under the Sustenance node
     *   Attunement of the Shadow  under the Form VII — Vaapad Unbound node
     *   Focusing Crystal          across The Unbroken Stroke
     *
     * Moving the NODES is the wrong fix: their positions are the shape of the
     * current, `positionOf` fits that shape to its zone deliberately, and
     * there is already a check on how close two of them may come. The label is
     * the free variable, so it picks its side — below unless below is busier,
     * counting both the other nodes and the labels already placed.
     *
     * THE FIELD IS NOT A FIXED viewBox, and the first version of this said it
     * was. The three sizes above happened to produce the same five collisions,
     * which read as resolution-independence and is not: the field's aspect
     * ratio follows its container, so the drawing is re-fitted and a placement
     * that clears at 1200×760 can foul at 900×620. That is exactly what
     * happened — flipping The Unbroken Stroke up cleared Focusing Crystal at
     * two sizes and met Form VII — Vaapad at the third. So the candidates are
     * a set rather than a pair, and the first with nothing in it wins.
     *
     * AND THE WIDTHS ARE MEASURED, NOT ESTIMATED. `text.length × 2.7` was the
     * first version and it is wrong in the one place it matters: the names
     * that collide are the long ones, and the long ones are full of em-dashes
     * and capitals that no per-character average describes. Under-estimating a
     * width by a few units is enough to call a box clear that is not, which is
     * why one collision survived two rounds of this. The labels are drawn
     * first, `getComputedTextLength` is asked what they actually are, and only
     * then are they placed — `svg` is in the document by that point, so the
     * measurement is real. The estimate stays as the fallback for a DOM that
     * has no text metrics, which is what every check in tools/ runs under.
     *
     * Greedy and in draw order, which is enough: this is five collisions out
     * of 1035 pairs, not a general label-placement problem. Above clears the
     * cost badge at −22 and the rank pips at −20 by construction.
     *
     * WHERE IT ACTUALLY LANDS. The before figure above — five, at all three
     * sizes — counts label on label and label on node, which are the two kinds
     * the first probe measured. Label on current HEADING is a third kind, and
     * it was not measured until placement had already changed, so there is no
     * honest before number for it; what is known is that at least Tutaminis
     * and The Unforgivable Word sat on their headings in the original build,
     * because both are legible doing so in the screenshot that started this.
     *
     * Counting all three kinds, after: 1 collision at 1600×900, 1 at 1200×760,
     * 2 at 900×620.
     *
     * The survivor at every size is The Refused Lightning against The
     * Unforgivable Word: two long names on nodes stacked vertically, where
     * none of the six candidate positions is clear. It is left overlapping
     * rather than solved, because solving it properly means a real label
     * placement pass and this is not one. The halo in styles.css is what makes
     * the remainder readable, and it is why that halo is not decoration.
     */
    const overlaps = (a, b) => a.x < b.r && b.x < a.r && a.y < b.bo && b.y < a.bo;
    const pending = [];
    const placeLabels = () => {
      const spec = pending.map(({ v, el, text }) => {
        const halfW = (typeof el.getComputedTextLength === 'function' && el.getComputedTextLength()
          ? el.getComputedTextLength() : text.length * 5.4) / 2 + 3;
        const down = v.root ? 34 : 28, up = v.root ? -34 : -30, side = halfW + 12;
        return {
          v, el, halfW,
          box: (dx, dy) => ({ x: v.x + dx - halfW, r: v.x + dx + halfW, y: v.y + dy - 9, bo: v.y + dy + 2 }),
          // Ordered by how much each disturbs the drawing, so the layout is
          // unchanged wherever there was nothing wrong with it.
          tries: [[0, down], [0, up], [side, down], [-side, down], [side / 2, down], [-side / 2, down],
            [side, up], [-side, up]],
          at: [0, down],
        };
      });

      /*
       * Fixed obstacles: the nodes, which never move, and the CURRENT NAMES,
       * which were not in this list at first and should have been. A current
       * name sits above the top of its zone, and the topmost facet of that
       * current is right under it — so "Tutaminis" and "The Unforgivable Word"
       * were placed into their own headings by a solver that could not see
       * them. Nothing else on the field takes space, and the halo in
       * styles.css covers whatever this still cannot separate.
       */
      const nodeBoxes = this.view.map((w) => {
        const rw = w.root ? 15 : w.mastery ? 13 : 11;
        return { id: w.id, x: w.x - rw, r: w.x + rw, y: w.y - rw, bo: w.y + rw };
      });
      for (const c of cnames) {
        const halfW = (typeof c.el.getComputedTextLength === 'function' && c.el.getComputedTextLength()
          ? c.el.getComputedTextLength() : c.text.length * 6.2) / 2 + 3;
        nodeBoxes.push({ id: null, x: c.x - halfW, r: c.x + halfW, y: c.y - 9, bo: c.y + 3 });
      }

      /*
       * ONE PASS, GREEDY, IN DRAW ORDER — and the second pass was tried and
       * REMOVED. The argument for it is sound: an early label can take a slot
       * a later one needed, so re-solving against the finished layout should
       * only help. Measured, it did the opposite — 0 / 0 / 1 collisions at
       * 1600×900, 1200×760 and 900×620 became 1 / 1 / 1, because a second pass
       * re-solves each label against a layout that is still moving underneath
       * it and a settled pair can be walked back into each other. A stable
       * greedy answer beats an unstable better-argued one.
       */
      {
        for (let i = 0; i < spec.length; i++) {
          const s = spec[i];
          const crowd = ([dx, dy]) => {
            const b = s.box(dx, dy);
            let n = 0;
            for (const nb of nodeBoxes) if (nb.id !== s.v.id && overlaps(b, nb)) n++;
            /*
             * ONLY LABELS ALREADY SETTLED COUNT. Counting the ones still to
             * come — each sitting at its provisional default — was tried and
             * is worse: a label steps aside for a neighbour that then moves
             * away, and it is left displaced for a collision that never
             * happened. Measured, that turned 0 / 0 / 1 into 1 / 1 / 1.
             */
            for (let j = 0; j < i; j++) {
              const o = spec[j];
              if (overlaps(b, o.box(o.at[0], o.at[1]))) n++;
            }
            return n;
          };
          let best = s.tries[0], bestN = Infinity;
          for (const t of s.tries) {
            const n = crowd(t);
            if (n === 0) { best = t; bestN = 0; break; }
            if (n < bestN) { best = t; bestN = n; }
          }
          s.at = best;
        }
      }
      for (const s of spec) { s.el.setAttribute('x', s.at[0]); s.el.setAttribute('y', s.at[1]); }
    };

    /* and the facets themselves */
    const facets = svg('g', { class: 'med-facets' });
    for (const v of this.view) {
      const g = svg('g', {
        class: ['facet', v.held ? 'held' : '', v.can && live ? 'can' : '', v.root ? 'root' : '',
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
      const text = v.name.replace(/^Mastery — /, '');
      const label = svg('text', { class: 'label', x: 0, y: (v.root ? 34 : 28), 'text-anchor': 'middle' });
      label.textContent = text;
      g.appendChild(label);
      pending.push({ v, el: label, text });
      // rank pips: how many times this facet has been woken, drawn rather than
      // written, because "×3" in 9px type at this scale is unreadable.
      for (let i = 0; i < Math.min(v.rank, 5); i++) {
        g.appendChild(svg('circle', { class: 'pip', cx: (i - (Math.min(v.rank, 5) - 1) / 2) * 7, cy: -20, r: 2 }));
      }
      if (!v.held && v.can && live) {
        const c = svg('text', { class: 'cost', y: -22, 'text-anchor': 'middle' });
        c.textContent = String(v.cost);
        g.appendChild(c);
      }
      /* A FACET ALREADY CLAIMED TO BE A BUTTON. NOW IT BEHAVES LIKE ONE.
       *
       * `tabindex: '0', role: 'button'` above (and the `#med-field .facet:focus`
       * rule in styles.css) make every facet focusable and announce it to a
       * screen reader as a button — and the only listeners were `click` and
       * `dblclick`, so Enter and Space did nothing at all. That is worse than
       * an unreachable control: it is the interface promising a keyboard path
       * it never built, and it was the ONE place in the whole front end that
       * had bothered to set tabindex. Enter selects, exactly as a click does;
       * Enter on the facet already selected buys it, which is the keyboard's
       * version of the double-click. */
      const select = () => { audio.ui('hover'); this._select(v.id); };
      g.addEventListener('click', select);
      g.addEventListener('dblclick', () => this._buy(v.id));
      g.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar' && e.code !== 'Space') return;
        e.preventDefault();
        if (this.selected === v.id) this._buy(v.id); else select();
      });
      facets.appendChild(g);
      this._nodes.set(v.id, g);
    }
    field.appendChild(facets);
    // Only now are the labels in the document and their widths real. Placing
    // them before this would be placing them against an estimate, which is the
    // thing that let one collision survive two attempts at this.
    placeLabels();

    /* the ledger line */
    if (this.el.insight) this.el.insight.textContent = String(Math.floor(ledger?.insight ?? 0));
    if (this.el.sub) {
      this.el.sub.textContent = live
        ? (this.ctx.subtitle || 'Insight is earned by surviving. Wake a facet joined to one you already hold.')
        : 'Between runs the Holocron is a chart: nothing here is bought, and nothing is carried into the next run.';
    }
    if (this.el.hint) {
      /*
       * The subtitle two lines up branches on `live` and this did not, so the
       * Temple's read-only Holocron — reached by a button, with no run behind
       * it — told the player "Escape returns you to the fight." There is no
       * fight to return to; Escape returns them to the menu they came from.
       * Same defect as the backdrop above it and found in the same screenshot:
       * copy written for the kneel, shown on both ways in.
       */
      const n = ledger?.bought?.length ?? 0;
      this.el.hint.textContent = n
        ? `${n} facet${n === 1 ? '' : 's'} woken this run · each one makes the next cost ${COST_STEP} more`
        : live ? 'Escape returns you to the fight.'
          : 'Escape returns you to the Temple. Plan here; the run is where you spend.';
    }
    this._drawShape();
  }

  _drawShape() {
    const host = this.el.shape;
    if (!host) return;
    const { taken, order = null } = this.ctx || {};
    const rows = shapeOf(taken).filter((r) => r.woken > 0).sort((a, b) => b.ranks - a.ranks);
    if (!rows.length) {
      host.innerHTML = '<div class="med-empty">Nothing woken yet. The Force offers cards; the Holocron is where you choose.</div>';
      return;
    }
    host.innerHTML = rows.map((r) => `
      <div class="med-row">
        <span>${currentName(r.axis, order)}</span>
        <i><b style="width:${Math.round(100 * r.woken / r.total)}%"></b></i>
        <em>${r.woken}/${r.total}</em>
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
      const axis = CURRENTS[0].axis;
      host.innerHTML = `<h3>The Holocron</h3><p class="med-text">${creedOf(axis, order)}</p>`
        + '<p class="med-text">Pick a facet to read it.</p>';
      if (this.el.buy) { this.el.buy.disabled = true; this.el.buy.textContent = 'Commune'; }
      return;
    }
    const v = facetView(id, { taken, ledger, wave, order });
    if (!v) return;
    const seen = this.ctx?.history?.get(id) || 0;
    const canon = v.canon !== v.name ? `<span class="med-canon">${v.canon}</span>` : '';
    host.innerHTML = `
      <h3>${v.icon} ${v.name}</h3>
      ${canon}
      <div class="med-tags"><em>${v.tag}</em><em>${v.rarityLabel}</em>${v.root ? '<em>heart of the teaching</em>' : ''}${v.mastery ? '<em>mastery</em>' : ''}</div>
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
    if (!live) return `${rank}Between runs nothing can be woken.`;
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
