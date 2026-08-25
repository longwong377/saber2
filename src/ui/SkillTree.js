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

/* `LATTICE` and `zoneOf` are gone from this import and that is deliberate:
 * they are the coordinate space of the star chart, and a rack has no
 * coordinates. They still exist in LivingForce.js because `facetView` publishes
 * an x/y off them and two checks read it; nothing here does. */
import { latticeView, facetView, shapeOf, currentName, creedOf, CURRENTS, LOCKED, COST_STEP }
  from '../game/LivingForce.js';
import { audio } from '../engine/Audio.js';

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
      purse: doc.getElementById('med-purse'),
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

  /**
   * ONE CURRENT'S FACETS, IN READING ORDER, WITH THEIR DEPTH.
   *
   * The lattice is a GRAPH and a plate is a STACK, so this is the flattening,
   * and it is the only place the two shapes meet. Breadth-first from the root,
   * which is the right traversal for exactly one reason: the depth it assigns
   * is the SHORTEST number of facets you must wake to reach this one, which is
   * the number a player planning a purchase is actually asking for. A
   * depth-first walk would put a facet two joins away at indent five because of
   * the order the table happens to list it in.
   *
   * `via` is what a stack loses and a graph keeps. A facet joined to two
   * already-woken neighbours is reachable through either, and the drawing can
   * only hang it under one of them — so the others are named on the rung as
   * words. There are four such facets in the shipped table and every one of
   * them is a mastery, which is the case where knowing the second route
   * matters most.
   *
   * A facet with no path to the root at all still appears, at depth 0, after
   * everything reachable. That is a table error rather than a state — a facet
   * nothing joins is unreachable for ever — and the old drawing hid it by
   * placing it wherever its dx/dy said. Here it is simply on the plate with no
   * bracket, visibly hanging off nothing.
   */
  _tiers(mine, byId) {
    const here = new Set(mine.map((v) => v.id));
    const out = [];
    const depth = new Map();
    const parent = new Map();
    const roots = mine.filter((v) => v.root);
    const queue = [];
    for (const r of roots) { depth.set(r.id, 0); queue.push(r); }
    while (queue.length) {
      const v = queue.shift();
      out.push(v);
      for (const id of v.to) {
        if (!here.has(id) || depth.has(id)) continue;
        const w = byId.get(id);
        if (!w) continue;
        depth.set(id, depth.get(v.id) + 1);
        parent.set(id, v.id);
        queue.push(w);
      }
    }
    for (const v of mine) if (!depth.has(v.id)) { depth.set(v.id, 0); out.push(v); }
    return out.map((v) => {
      const p = parent.get(v.id);
      const via = v.to
        .filter((id) => id !== p && here.has(id) && depth.get(id) <= depth.get(v.id))
        .map((id) => byId.get(id)?.name.replace(/^Mastery — /, ''))
        .filter(Boolean);
      return { v, depth: Math.min(depth.get(v.id) ?? 0, 4), via };
    });
  }

  /* ── drawing ───────────────────────────────────────────────────────── */

  /**
   * THE HOLOCRON, DRAWN AS A RACK OF PLATES — and the constellation is gone.
   *
   * The player, for at least the third time: "I've already told you a million
   * times to completely get rid of the attunement star chart shit and start
   * from scratch with something that has nothing to do with stars and is more
   * in keeping with the game's aesthetic and I still see the same exact star
   * chart bullshit… get fucking rid of it and redo the whole thing, also make
   * it less confusing."
   *
   * WHY IT SURVIVED THREE RENAMINGS. `LivingForce.js`'s own header says it
   * plainly and is worth quoting, because it is the whole diagnosis: "This was
   * a CONSTELLATION… The player asked what stars had to do with becoming
   * attuned to the Force, which was a fair question with an embarrassing answer
   * — a node graph happens to look like a star chart, so the picture was chosen
   * first and the fiction was bent around it. THE DRAWING DID NOT CHANGE; every
   * word around it did." Stars became facets, the sky became a lattice, and the
   * SVG still drew 190 motes, 46 discs and the lines between them. Renaming a
   * star chart does not stop it being one.
   *
   * ── WHAT IT IS NOW ────────────────────────────────────────────────────
   *
   * Six PLATES, one per current, each a stack of RUNGS. A rung is a cut-corner
   * bar carrying the facet's name, its rank, and its price, drawn in the same
   * flat-and-inked language as every other box in this interface. Depth in the
   * join graph is INDENTATION, and a bracket joins a rung to the rung it hangs
   * off — so the reachability rule ("a facet may be woken if it is the root of
   * its current, or if a facet it is joined to is already woken") is not a rule
   * you have to be told, it is the shape of the drawing.
   *
   * ── AND WHY THAT IS THE "LESS CONFUSING" HALF ─────────────────────────
   *
   * The old drawing put the name UNDER the disc in 9 px type and the price
   * ABOVE it, and had a 60-line label solver whose whole job was stopping
   * forty-six of those from landing on each other. A price was drawn only for
   * facets the purse alone stood between you and — so on the first open of a
   * run, purse 0 against six roots at 9, the chart carried NOT ONE NUMBER.
   *
   * A rung is a row. Rows do not collide, so there is no solver; every rung
   * carries its name and price at a readable size ALWAYS, including the ones
   * you cannot reach, because "9, and you have 4" is a plan and a blank circle
   * is not. The one thing the graph could show that a stack cannot is a facet
   * joined to two parents — `_tiers` lists those on the rung itself ("or via
   * …"), which is a sentence rather than a line you have to trace.
   *
   * ── AND IT IS HTML, NOT SVG ───────────────────────────────────────────
   *
   * The old field was an SVG because a node graph needs arbitrary coordinates.
   * A rack is rows in columns, which is what the box model is for: the type
   * hyphenates, the panels take the same `--cut` clip as every other panel in
   * the product, and the whole thing reflows at a narrow viewport instead of
   * scaling a 1000x720 viewBox down until the labels vanish.
   */
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

    const doc = this.doc;
    const div = (cls, text) => {
      const el = doc.createElement('div');
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    };

    for (const c of CURRENTS) {
      const mine = this.view.filter((v) => v.axis === c.axis);
      if (!mine.length) continue;
      const plate = div('hol-plate');
      plate.dataset.axis = c.axis;

      /* ── the plate's head: what the current is, and how much of it is yours ─
       * `shapeOf` already counts this for the sidebar; counting it again here
       * would be HANDOFF §2.3, so the numbers come off the same view the rungs
       * are drawn from. */
      const woken = mine.filter((v) => v.held).length;
      const head = div('hol-head');
      head.appendChild(div('hol-name', currentName(c.axis, order).toUpperCase()));
      head.appendChild(div('hol-count', `${woken}/${mine.length}`));
      plate.appendChild(head);

      const bar = div('hol-bar');
      const fill = div('hol-fill');
      fill.style.width = `${Math.round((woken / mine.length) * 100)}%`;
      bar.appendChild(fill);
      plate.appendChild(bar);

      const rungs = div('hol-rungs');
      for (const { v, depth, via } of this._tiers(mine, byId)) {
        const cls = ['hol-rung'];
        if (v.held) cls.push('held');
        if (v.can && live) cls.push('can');
        if (v.root) cls.push('root');
        if (v.mastery) cls.push('mastery');
        if (v.locked === LOCKED.spent) cls.push('spent');
        if (v.locked === LOCKED.reach) cls.push('far');
        /* A legal facet the deal is withholding reads like a distant one rather
         * than like a live one: same dimming, and the line under it says which
         * of the two it is. See `_stateLine`. */
        if (v.locked === LOCKED.offer) cls.push('far');
        if (history?.get(v.id)) cls.push('known');
        const el = div(cls.join(' '));
        el.style.setProperty('--depth', String(depth));
        /* setAttribute AND NOT `el.tabIndex = 0`. The property and the
         * attribute are the same thing in a browser and are not in
         * `tools/checks/_page.mjs`'s DOM, which reads attributes — and that
         * stub is what drives the keyboard check. Writing the attribute is
         * correct in both. */
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'button');
        /* WHICH FACET THIS RUNG IS, on the element. It was carried only in the
         * closure, so nothing outside the click handler — a check, a screen
         * reader's test, a future keyboard map — could say which card a rung
         * stood for. One attribute, and it is the id the ledger is asked
         * about. */
        el.dataset.facet = v.id;

        /* THE BRACKET. A short elbow drawn in CSS off `--depth`, standing in
         * for the line the graph used to draw — the difference being that this
         * one cannot cross another one. A root has none: it hangs off nothing,
         * which is exactly what makes it a root. */
        if (depth > 0) el.appendChild(div('hol-elbow'));

        el.appendChild(div('hol-glyph', v.icon || '·'));
        const body = div('hol-body');
        body.appendChild(div('hol-label', v.name.replace(/^Mastery — /, '')));
        const meta = [];
        if (v.mastery) meta.push('mastery');
        /* AN ATTUNEMENT HAS NO CEILING, and `maxRank` says so with `Infinity`.
         * Printed straight, that read "to rank Infinity" on all six roots —
         * which is the truth stated in the one way that makes it look like a
         * bug. It is the defining property of a current's heart, so it gets a
         * word: a root can never be exhausted, which is why a current can never
         * close. */
        if (!Number.isFinite(v.max)) meta.push(v.rank > 0 ? `rank ${v.rank} · repeatable` : 'repeatable');
        else if (v.max > 1) meta.push(v.rank > 0 ? `rank ${v.rank}/${v.max}` : `to rank ${v.max}`);
        else if (v.held) meta.push('woken');
        if (via.length) meta.push(`or via ${via.join(', ')}`);
        if (meta.length) body.appendChild(div('hol-meta', meta.join(' · ')));
        el.appendChild(body);

        /**
         * THE PRICE IS ALWAYS ON THE RUNG, which is the change the "make it
         * less confusing" half of the note is mostly about. The old chart drew
         * one only when the purse was the sole obstacle; everything else was a
         * bare circle. Here the number is always there and the STATE is what
         * changes — struck through when it is already yours, greyed when the
         * thing standing in the way is not money.
         */
        const tag = div('hol-cost');
        /* BETWEEN RUNS THERE IS NO PURSE, so there are no prices. `live` is the
         * same flag that decides the title and the backdrop: the Temple's
         * Holocron is a chart of what a run reached, and quoting a price on a
         * screen that cannot sell anything is the one thing on it that would
         * be a lie. It carries the holding instead. */
        if (v.held && (v.rank >= v.max || !live)) tag.textContent = '✓';
        else if (!live) { tag.textContent = '·'; tag.classList.add('chart'); }
        else if (v.locked === LOCKED.gated) tag.textContent = '—';
        else tag.textContent = Number.isFinite(v.cost) ? String(v.cost) : '—';
        /* `!v.can` ALONE, and not `!v.can && !v.held`. A facet you already
         * hold can still be un-buyable — it may be maxed, or already bought
         * this run — and the second clause lit those as if the purse would take
         * them. `can` is the ledger's own single answer to "would this go
         * through", which is the only question the tag is asking. */
        if (!v.can) tag.classList.add('short');
        el.appendChild(tag);

        const select = () => { audio.ui('hover'); this._select(v.id); };
        el.addEventListener('click', select);
        el.addEventListener('dblclick', () => this._buy(v.id));
        el.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar' && e.code !== 'Space') return;
          e.preventDefault();
          if (this.selected === v.id) this._buy(v.id); else select();
        });
        rungs.appendChild(el);
        this._nodes.set(v.id, el);
      }
      plate.appendChild(rungs);
      field.appendChild(plate);
    }

    /* the ledger line */
    if (this.el.insight) this.el.insight.textContent = String(Math.floor(ledger?.insight ?? 0));
    /**
     * WHAT THE NUMBER IS FOR, under the number.
     *
     * A purse is only a currency if the player can see what it is short of.
     * This said `28` and `INSIGHT` and nothing else, so the one thing the
     * screen never answered was the only question a player standing in front
     * of it has: is that a lot? The answer is a fact about THIS lattice at
     * THIS moment and it is counted off the view that was just drawn — how
     * many of the facets within reach are already yours to take, or, when none
     * are, exactly how far off the nearest one is.
     *
     * `reach` is the same set the price badges are drawn on, deliberately:
     * whatever this line counts, the player can point at.
     */
    if (this.el.purse) this.el.purse.textContent = this._purseLine(live);
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
      /**
       * TWO CLAUSES, AND IT USED TO BE ONE OR THE OTHER.
       *
       * The escalator note and the way out shared this line through a ternary,
       * so buying a single facet DELETED "Escape returns you to the fight" for
       * the rest of the run — the only sentence on the screen that says how to
       * leave it, removed by the act of using the screen.
       *
       * The escalator clause also states the step and not the STANDING
       * SURCHARGE, which is the number that decides anything: "+2 each" is a
       * rule, "everything is 6 over base right now" is a price. Both are read
       * off the ledger (`bought.length` is the escalator, exactly as
       * `Communion.costOf` reads it) rather than being counted here.
       */
      const n = ledger?.bought?.length ?? 0;
      const out = live
        ? 'Escape returns you to the fight.'
        : 'Escape returns you to the Temple. Plan here; the run is where you spend.';
      const climb = !live ? ''
        : n ? `${n} facet${n === 1 ? '' : 's'} woken · every price is ${n * COST_STEP} over its base, `
            + `and the next one you wake adds ${COST_STEP} more`
          : `Nothing woken yet · prices are at their base, and each facet you wake adds ${COST_STEP} `
            + 'to every price after it';
      this.el.hint.textContent = climb ? `${climb} · ${out}` : out;
    }
    this._drawShape();
  }

  /**
   * The line under the purse: what this many Insight is, in facets.
   *
   * Counted off `this.view`, which `_draw` has just built out of `latticeView`
   * — so the answer cannot disagree with the badges on the map or with the
   * button, because all three are reading one array. Deriving it a second time
   * from `FACETS` and the ledger would be the shape HANDOFF §2.4 is about.
   */
  _purseLine(live) {
    const view = this.view || [];
    if (!live) {
      /* Between runs the purse is 0 and always will be — Insight does not
       * survive a run (Progress.js: "no unlocks, no currency, no cross-run
       * power"). What the number under it can honestly count is the RECORD,
       * which is the thing the Temple's Holocron is actually for: what have I
       * ever tried. `history` is the map main.js draws the faint facets from,
       * so the count and the drawing are the same source. */
      const seen = this.ctx?.history;
      if (!seen) return `${view.length} facets`;
      const ever = view.filter((v) => seen.get(v.id)).length;
      return `${ever} of ${view.length} facets ever held`;
    }
    /* The same set the price badges are drawn on: what the purse alone stands
     * between you and. A `gated` mastery or a facet nothing joins is not a
     * thing this line can promise anything about. */
    const reach = view.filter((v) => !v.held && (v.can || v.locked === LOCKED.insight));
    /* Effectively unreachable — every heart of a current is a root, needs no
     * neighbour and is uncapped, so there is normally always something here.
     * The wording is the one that stays true whichever reason emptied it. */
    if (!reach.length) return 'nothing the purse alone can open';
    const now = reach.filter((v) => v.can).length;
    if (now) return `${now} of ${reach.length} within reach, yours now`;
    const short = Math.min(...reach.map((v) => v.cost)) - Math.floor(this.ctx?.ledger?.insight ?? 0);
    return `${short} short of the cheapest within reach`;
  }

  /**
   * How far off a price is, in Insight and in WAVES.
   *
   * The wave figure is the whole point and it is why this is not just
   * "4 more": the rate is 1 a wave in Path of the Blade and 4 a wave in the
   * Trial, and a player cannot be expected to know either. Rather than import
   * a rate and then have to know which mode is being played, it is read off
   * THIS RUN'S OWN LEDGER — `earned` over the waves that earned it — so the
   * mode, the boss bonus and any future rate are all already in the number and
   * none of them is restated here.
   *
   * Silent for the first wave of a run, where `earned` is 0 and there is no
   * pace to report. A guess in that gap would be the plausible default this
   * project keeps deleting.
   */
  _wavesAway(short) {
    const { ledger, wave = 1 } = this.ctx || {};
    const earned = ledger?.earned ?? 0;
    if (!(earned > 0) || !(wave >= 1) || !(short > 0)) return '';
    const pace = earned / wave;
    const w = Math.ceil(short / pace);
    return `, about ${w} more wave${w === 1 ? '' : 's'}`;
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
      /* "you have not earned it yet" is a refusal. What a player deciding
       * whether to SAVE needs is the distance, and living-force.mjs's own note
       * says the system rewards saving "and nothing in the game tells the
       * player that" — the escalator counts purchases MADE, not Insight HELD,
       * so a shut purse reaches a mastery a spender never gets to. This is the
       * sentence that says so, in the two units the player has. */
      case LOCKED.insight: {
        const short = Math.max(0, v.cost - Math.floor(this.ctx?.ledger?.insight ?? 0));
        return `${rank}${v.cost} Insight — ${short} more${this._wavesAway(short)}.`;
      }
      case LOCKED.reach: return `${rank}Nothing you hold reaches this far.`;
      /* THE OFFER — PLAN.md §4.6. A player has to be able to tell "not yet
       * shown" from "cannot afford" and from "nothing reaches it", because
       * those three ask for three different things: wait, save, or go the long
       * way round. This one is the only one of the three that answers itself:
       * take something and the Force shows you three more. */
      case LOCKED.offer:
        return `${rank}${v.cost} Insight — the Force is not showing you this one yet. Wake `
          + 'something and it deals again.';
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
