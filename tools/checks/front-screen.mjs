/**
 * THE FIRST SCREEN, AND THE THINGS ON IT THAT WERE NOT TRUE.
 *
 * Six defects, all found on the front screen of the game, and five of them are
 * the same defect wearing different clothes: a number or a list that was TYPED
 * where it could have been DERIVED, and then drifted from the thing it claims
 * to describe. So almost every assertion below computes what the screen ought
 * to say from the module that owns the answer, and compares — rather than
 * spelling the answer out a second time, which is how the originals got here.
 *
 *   THE BADGE      every level card printed `pool.length` and called it "unit
 *                  types". `pool` is a WEIGHTED BAG — src/game/Waves.js:910
 *                  says so and picks from it uniformly by index — so a repeat
 *                  is a weight. Twelve of thirteen cards overstated: temple
 *                  said 8 and fields 4, warship said 9 and fields 5, and three
 *                  cards all read "9" against true counts of 5, 7 and 8.
 *   THE WARDROBE   the creator offered 8 hairstyles and 7 beards to all seven
 *                  species, and five of them declare `hair: false`, which
 *                  src/game/Bodies.js turns into `if (!sp.hair) return;` before
 *                  a strand is built. 75 of 105 (species, card) pairs built an
 *                  identical figure.
 *   THE FOOTER     `#btn-commune` was `position:fixed` over a `#gpu-line` that
 *                  lives inside the centred `.menu-wrap`; measured overlap
 *                  1366x768 2482 px², 1280x720 3084 px², 1152x648 3300 px².
 *   THE COLUMN     the Ignite button was the last child of the scrolling Mode
 *                  column, `position:sticky` with a 22 px dark gradient above
 *                  it, so the list read as finished where the button began.
 *   THE TAB        the tab labelled Training had one button and it deployed
 *                  Sandbox; `selectMode('training')` had no caller in the
 *                  product except a mode card below the fold of that column.
 *   THE SERVER     tools/serve.mjs sent `Cache-Control: no-cache` with no ETag
 *                  and no Last-Modified, which is strictly worse than sending
 *                  nothing: it forbids heuristic freshness and then offers the
 *                  browser nothing to revalidate with.
 *
 * WHAT THIS FILE CANNOT DO is lay anything out. tools/checks/_page.mjs is a
 * real DOM and not a layout engine, so the two geometric claims are checked the
 * way the rest of this suite checks paint: STRUCTURALLY against the markup and
 * the cascade (two boxes in one flex row cannot overlap; a button that is not
 * inside the scroller cannot be painted over its contents), and behaviourally
 * by driving the real methods with a geometry stated in the test. The numbers
 * above were all measured in Chromium against the real page and are recorded
 * beside the code they belong to.
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { makeDocument } from './_page.mjs';
import { Menu, DEFAULT_SETTINGS, SCROLL_FADE } from '../../src/ui/Menu.js';
import { SPECIES, HAIR_STYLES, BEARD_STYLES, speciesOf } from '../../src/game/Bodies.js';
import { LEVELS, LEVEL_ORDER } from '../../src/game/Levels.js';
import { MODES } from '../../src/game/Waves.js';
import { LESSONS } from '../../src/game/Dojo.js';
import { handler } from '../serve.mjs';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

let INDEX_HTML = '';
let CSS = '';

/**
 * A real Menu on a real parse of index.html.
 *
 * SYNCHRONOUS from install() to close(), for the reason tools/checks/menu.mjs
 * gives: the runner starts the next check the moment this one suspends, and a
 * check that awaited anything while a fake `document` sat on globalThis would
 * hand its page to whatever ran next.
 */
function menuOn(overrides = {}) {
  const doc = makeDocument(INDEX_HTML);
  const restore = doc.install();
  try {
    const settings = { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
    const hooks = { fired: [] };
    for (const name of ['onDeploy', 'onQualityChange', 'onBloom', 'onSchemeChange', 'onDeflectAim',
      'onLightning', 'onSaberChange', 'onName', 'onHost', 'onJoin', 'onBindings', 'onBladeLength']) {
      hooks[name] = (v) => hooks.fired.push([name, v]);
    }
    const menu = new Menu(settings, hooks);
    return { menu, settings, hooks, doc, close: restore };
  } catch (e) { restore(); throw e; }
}

/** One CSS declaration block, by selector, exactly as written. */
function rule(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[},])\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(CSS);
  return m ? m[1] : null;
}

/**
 * Give a shim element the geometry a browser would have computed.
 *
 * `clientHeight` is a getter on the prototype and answers 0, so it is shadowed
 * with an own property; `scrollTop`/`scrollHeight` do not exist at all. This is
 * not a layout engine and does not pretend to be one — it is a stated geometry,
 * so that the real method under test does its real arithmetic on numbers the
 * check chose. The numbers used are the ones measured in Chromium.
 */
function geometry(el, { clientHeight, scrollHeight, scrollTop = 0, rect = null }) {
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  el.scrollHeight = scrollHeight;
  el.scrollTop = scrollTop;
  if (rect) el.getBoundingClientRect = () => rect;
  return el;
}
const box = (top, height) => ({ top, bottom: top + height, height, left: 0, right: 292, width: 292, x: 0, y: top });

export async function run({ check, assert }) {
  INDEX_HTML = await read('index.html');
  CSS = await read('styles.css');

  /* ══════════════════════════════════════════════════════════════════
   *  THE BADGE
   * ══════════════════════════════════════════════════════════════════ */

  check('front screen: a theatre card counts the KINDS it fields, not the size of its spawn bag', () => {
    // The check would be worth nothing on a roster whose pools have no repeats,
    // so first prove the two numbers are actually different somewhere. This is
    // the clause that makes printing `pool.length` fail.
    const drift = LEVEL_ORDER.filter(k => LEVELS[k].pool.length !== new Set(LEVELS[k].pool).size);
    assert(drift.length > 0,
      'no level pool repeats a key any more, so bag size and kind count agree and this check cannot fail');

    const { doc, close } = menuOn();
    try {
      const cards = doc.getElementById('level-list').children;
      assert(cards.length === LEVEL_ORDER.length,
        `${cards.length} cards for ${LEVEL_ORDER.length} levels`);
      const said = [];
      LEVEL_ORDER.forEach((key, i) => {
        const pill = cards[i].querySelector('.tagpill');
        assert(pill, `${key}'s card has no badge`);
        const n = Number((pill.textContent.match(/\d+/) || [])[0]);
        const kinds = new Set(LEVELS[key].pool).size;
        assert(n === kinds,
          `${key} advertises ${n} unit types and fields ${kinds} (its bag holds ${LEVELS[key].pool.length})`);
        said.push(`${key} ${n}`);
      });
      return `${said.length} cards, each the unique count of its own pool; ${drift.length} of them `
        + `would have overstated by ${drift.reduce((a, k) => a + LEVELS[k].pool.length - new Set(LEVELS[k].pool).size, 0)} types`;
    } finally { close(); }
  });

  /* ══════════════════════════════════════════════════════════════════
   *  THE WARDROBE
   * ══════════════════════════════════════════════════════════════════ */

  check('wardrobe: hair and beard are offered to the species that can grow them, and to no other', () => {
    // Same guard as above: five of seven species must declare `hair: false`,
    // or there is nothing here for the row to get wrong.
    const bald = SPECIES.filter(s => !s.hair);
    assert(bald.length > 0 && bald.length < SPECIES.length,
      `${bald.length} of ${SPECIES.length} species are hairless — this check is measuring nothing`);

    const rows = [];
    for (const sp of SPECIES) {
      const { doc, close } = menuOn({ species: sp.id });
      try {
        // The expectation is DERIVED from the species record — the same field
        // src/game/Bodies.js gates the whole hair-and-beard block on.
        const want = speciesOf(sp.id).hair;
        const hair = doc.getElementById('hairstyle-list');
        const beard = doc.getElementById('beard-list');
        assert(hair.children.length === (want ? HAIR_STYLES.length : 0),
          `${sp.id} (hair: ${want}) was offered ${hair.children.length} hairstyles`);
        assert(beard.children.length === (want ? BEARD_STYLES.length : 0),
          `${sp.id} (hair: ${want}) was offered ${beard.children.length} beards`);
        // …and the row does not leave a titled empty box behind it
        for (const [id, host] of [['h-hairstyle', hair], ['h-beard', beard]]) {
          const head = doc.getElementById(id);
          const hidden = head.style.display === 'none' && host.style.display === 'none';
          assert(hidden === !want, `${sp.id}: the ${id} heading is ${hidden ? 'hidden' : 'shown'}`);
        }
        // the control that already knew how to do this still does
        assert(doc.getElementById('skin-list').children.length === sp.skinTones.length,
          `${sp.id}'s skin rack is not its own`);
        rows.push(`${sp.id} ${hair.children.length}/${beard.children.length}`);
      } finally { close(); }
    }
    return rows.join(', ');
  });

  /* ══════════════════════════════════════════════════════════════════
   *  THE FOOTER
   * ══════════════════════════════════════════════════════════════════ */

  check('front screen: the way into the Force shares the footer\'s row instead of floating over it', () => {
    const { doc, close } = menuOn();
    try {
      const btn = doc.getElementById('btn-commune');
      const gpu = doc.getElementById('gpu-line');
      assert(btn && gpu, 'the button or the GPU line is gone from index.html');
      const foot = btn.parentElement;
      assert(foot && foot.classList.contains('menu-foot'),
        `#btn-commune's parent is ${foot ? foot.className || foot.localName : 'nothing'}, not the menu footer`);
      assert(gpu.parentElement === foot, '#gpu-line is not in the same row as the button');
      // Two in-flow items of one flex row cannot overlap at any viewport, which
      // is the whole of the fix — so THAT is what is asserted, rather than a
      // list of the sizes that used to collide.
      const footRule = rule('.menu-foot');
      assert(footRule && /display:\s*flex/.test(footRule), '.menu-foot is no longer a flex row');
      const entry = rule('.commune-entry');
      assert(entry, '.commune-entry has no rule at all');
      assert(!/position:\s*fixed/.test(entry),
        '.commune-entry is positioned against the viewport again, and the footer is not');
      assert(/width:\s*auto/.test(entry),
        'a .ghost with no width of its own fills its whole line — see the 100vw note in styles.css');
      // The long one gives way, rather than pushing the build id off the row.
      const line = rule('#gpu-line');
      assert(line && /overflow:\s*hidden/.test(line) && /text-overflow:\s*ellipsis/.test(line),
        '#gpu-line no longer truncates, so a long adapter string can push the row apart');
      return 'button and GPU line are siblings in one flex row; no fixed positioning left';
    } finally { close(); }
  });

  /* ══════════════════════════════════════════════════════════════════
   *  THE COLUMN
   * ══════════════════════════════════════════════════════════════════ */

  check('deploy: the Ignite button is outside the list it used to be painted over', () => {
    const { doc, close } = menuOn();
    try {
      const deploy = doc.getElementById('btn-deploy');
      const modes = doc.getElementById('mode-list');
      const diffs = doc.getElementById('diff-list');
      const scroller = modes.closest('.col-scroll');
      assert(scroller, 'the Mode list is not inside a .col-scroll any more');
      assert(diffs.closest('.col-scroll') === scroller, 'Trial and Mode are in different scrollers');
      assert(!deploy.closest('.col-scroll'),
        'Ignite is back inside the scrolling box, where it is painted over the cards below it');
      assert(deploy.parentElement === scroller.parentElement,
        'Ignite is no longer a sibling of the scroller it sits under');
      const col = scroller.parentElement;
      assert(col.classList.contains('narrow') && col.classList.contains('pinned'),
        `the column is ${col.className}, so none of the pinned rules apply to it`);

      // …and the cascade agrees: the box does not scroll, its body does, and
      // the button is static with no upward gradient left to fade the list out.
      const pinned = rule('.col.narrow.pinned');
      assert(pinned && /overflow:\s*hidden/.test(pinned), '.col.narrow.pinned scrolls again');
      const body = rule('.col.narrow.pinned>.col-scroll');
      assert(body && /overflow-y:\s*auto/.test(body), 'the pinned column\'s body does not scroll');
      const primary = rule('.col.narrow.pinned>.primary');
      assert(primary && /position:\s*static/.test(primary), 'the button is sticky again');
      assert(!/-14px/.test(primary),
        'the 22 px dark gradient above the button is back, and there is nothing behind it to fade');
      return 'Trial + Mode scroll inside .col-scroll; Ignite is a static sibling under it';
    } finally { close(); }
  });

  check('deploy: the column says when there is more below it, and stops saying so at the end', () => {
    const { menu, doc, close } = menuOn();
    try {
      const scroller = doc.getElementById('mode-list').closest('.col-scroll');
      const col = scroller.parentElement;
      // The geometry measured in Chromium at 1920x1080: 788 px of cards and
      // headings in a 466 px band. Stated here because _page.mjs computes no
      // boxes; everything after this line is the shipped method's own logic.
      geometry(scroller, { clientHeight: 466, scrollHeight: 788, scrollTop: 0 });
      menu._syncScrollHints();
      assert(col.classList.contains('more'),
        '322 px of cards below the fold and the column claims to be finished');
      assert(!col.classList.contains('less'), 'the top of an unscrolled column is faded');

      scroller.scrollTop = 160;
      menu._syncScrollHints();
      assert(col.classList.contains('more') && col.classList.contains('less'),
        'a column scrolled to the middle fades at neither end');

      scroller.scrollTop = 788 - 466;
      menu._syncScrollHints();
      assert(!col.classList.contains('more'),
        'the list is over and the fade is still telling the player there is more');
      assert(col.classList.contains('less'), 'a column scrolled to the end does not fade at the top');

      // A column that fits needs no affordance at all.
      geometry(scroller, { clientHeight: 900, scrollHeight: 788, scrollTop: 0 });
      menu._syncScrollHints();
      assert(!col.classList.contains('more') && !col.classList.contains('less'),
        'a column with nothing hidden is faded anyway');

      // The fade the CSS paints and the gap the reveal leaves are one number.
      const more = rule('.col.narrow.pinned.more>.col-scroll');
      assert(more && more.includes(`calc(100% - ${SCROLL_FADE}px)`),
        `the mask does not fade ${SCROLL_FADE}px — Menu.SCROLL_FADE has drifted from styles.css`);
      /**
       * …AND THE ROOM LEFT FOR IT IS THE SAME NUMBER.
       *
       * The fade covers the bottom 26 px WHILE there is more below; at the end
       * of the scroll there is nothing more, the mask comes off, and the last
       * card is legible. That held for as long as the last card could reach the
       * end — and it stopped the day an eleventh mode was added: `_revealMode`
       * asks for the card to sit clear of the fade, the scroller is already at
       * its maximum, and the card stays flush against the edge. `lineseen.1`
       * measured it at 1366x768: Campaign at 374..410 of a 410 px column.
       *
       * The scroller carries `padding-bottom` of exactly the fade for that
       * reason, and it is a THIRD copy of 26 — so it is read out of the
       * stylesheet here beside the other two rather than left to drift.
       */
      const scrollRule = CSS.match(/\n\.col\.narrow\.pinned>\.col-scroll\{([^}]*)\}/);
      assert(scrollRule, '.col.narrow.pinned>.col-scroll has no rule of its own');
      const pad = scrollRule[1].match(/padding-bottom:\s*([0-9.]+)px/);
      assert(pad && Math.abs(parseFloat(pad[1]) - SCROLL_FADE) < 0.5,
        `the scroller reserves ${pad ? pad[1] : 'no'}px under its content against a ${SCROLL_FADE}px `
        + 'fade — the last card in any of these columns cannot be scrolled clear of it');
      return `more/less toggled at 0, 160 and ${788 - 466} of 788-466, and the mask is ${SCROLL_FADE}px`;
    } finally { close(); }
  });

  check('menu: every scroller reserves a track, so a cut page reads as a scrolling one', () => {
    /**
     * MEASURED IN CHROMIUM AT 1100x620, EVERY TAB: fifteen of the menu's
     * seventeen scrollers reported `offsetWidth - clientWidth === 0`. The Codex
     * held 4310 px of text in a 355 px window and Options 4582 px — 92% of each
     * below the fold behind an overlay scrollbar with a TRANSPARENT track, over
     * a dark panel, at 0.16 alpha of white. Two outside readers, given the game
     * and no notes, both reported the same thing: every tab in the menu looks
     * like a page that has been cut off.
     *
     * This had already been diagnosed and fixed ONCE, on
     * `.col.narrow.pinned>.col-scroll`, and the fix never left that selector —
     * which is why this check is written against the whole stylesheet rather
     * than against the four scrollers that were on screen when it was written.
     * Every rule that turns scrolling on has to reserve the track, and no rule
     * anywhere may paint that track transparent again.
     */
    const bald = CSS.replace(/\/\*[\s\S]*?\*\//g, '');   // a comment holds braces
    const scrollers = [];
    for (const m of bald.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/overflow(-y)?:\s*(auto|scroll)/.test(m[2])) continue;
      scrollers.push({ sel: m[1].trim().split('\n').pop().trim(), body: m[2] });
    }
    assert(scrollers.length >= 10, `only ${scrollers.length} scrolling rules found — the scan is wrong`);

    /* The reservation may be stated on the scrolling rule itself or on a
     * grouped one — `.muster-units,.muster-list,#pause .pause-wrap,…` is one
     * rule for five scrollers and is the right way to write it — so the test is
     * membership in the set of selectors SOME rule reserves a track for. */
    const reserved = new Set();
    for (const m of bald.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/scrollbar-gutter:\s*stable/.test(m[2])) continue;
      for (const one of m[1].split(',')) reserved.add(one.trim().split('\n').pop().trim());
    }
    const bare = scrollers.filter((s) => !reserved.has(s.sel)).map((s) => s.sel);
    assert(!bare.length,
      `${bare.length} scrolling rule(s) reserve no track, so a full column reads as a cut one: `
      + bare.join(', '));

    const seeThrough = [...CSS.matchAll(/scrollbar-color:\s*[^;]*transparent[^;]*;/g)].map((m) => m[0]);
    assert(!seeThrough.length,
      'a scrollbar track painted transparent over a dark panel is a scrollbar nobody can see: '
      + seeThrough.join(' '));
    return `${scrollers.length} scrolling rules, every one with a reserved track, none transparent`;
  });

  check('deploy: the mode you are about to deploy into is scrolled into view, clear of the fade', () => {
    const { menu, doc, close } = menuOn();
    try {
      const scroller = doc.getElementById('mode-list').closest('.col-scroll');
      const cards = [...doc.getElementById('mode-list').children];
      assert(cards.length === Object.keys(MODES).length,
        `${cards.length} cards for ${Object.keys(MODES).length} modes`);

      /* The band and the card stack, as Chromium measured them at 1280x720:
       * a 368 px viewport on to 788 px of content, mode cards 65-79 px tall
       * starting 367 px down. The scroller sits at the top of the screen. */
      const BAND = 368;
      geometry(scroller, { clientHeight: BAND, scrollHeight: 788, scrollTop: 0,
        rect: box(0, BAND) });
      const top = (i) => 367 + i * 72;
      const place = () => cards.forEach((c, i) => {
        c.getBoundingClientRect = () => box(top(i) - scroller.scrollTop, 65);
      });
      place();

      // The shipped default. Off the bottom of the band by a long way.
      menu.s.mode = 'roguelite';
      menu._revealMode();
      const card = cards[Object.keys(MODES).indexOf('roguelite')];
      let r = card.getBoundingClientRect();
      assert(r.bottom <= BAND - SCROLL_FADE + 0.5,
        `the selected mode was revealed with its last ${Math.ceil(r.bottom - (BAND - SCROLL_FADE))}px under the fade`);
      assert(r.top >= 0, 'the reveal scrolled the selected mode off the top instead');
      const scrolled = scroller.scrollTop;
      assert(scrolled > 0, 'a card 439 px down a 368 px band did not need scrolling');

      // …and the minimum: something already on screen must not move the column.
      menu._revealMode();
      assert(scroller.scrollTop === scrolled,
        'a second reveal of a card already in view moved the column again');

      // The last mode in the list is the one the lessons live behind.
      menu.s.mode = 'training';
      menu._revealMode();
      r = cards[Object.keys(MODES).indexOf('training')].getBoundingClientRect();
      assert(r.bottom <= BAND - SCROLL_FADE + 0.5 && r.top >= 0,
        `Training was revealed at ${r.top}..${r.bottom} of a ${BAND}px band`);

      // A DOM with no layout engine must be left alone rather than guessed at.
      const plain = menuOn();
      try {
        plain.menu._revealMode();
        const s2 = plain.doc.getElementById('mode-list').closest('.col-scroll');
        assert(!s2.scrollTop, 'the reveal invented a scroll position on a page with no boxes');
      } finally { plain.close(); }
      return `roguelite revealed at scrollTop ${scrolled}, training too, both clear of the ${SCROLL_FADE}px fade`;
    } finally { close(); }
  });

  /* ══════════════════════════════════════════════════════════════════
   *  THE TAB
   * ══════════════════════════════════════════════════════════════════ */

  check('training: the tab named Training starts Training, and says how many lessons that is', () => {
    const { menu, doc, hooks, close } = menuOn();
    try {
      // By `dataset`, not by an attribute selector: _buildTraining assigns
      // `panel.dataset.panel` directly, which sets no attribute — in a browser
      // it does, and in tools/checks/_page.mjs's DOM it does not. The property
      // is what the menu's own tab wiring reads, so it is what is asked here.
      const panel = doc.querySelectorAll('.panel').find(p => p.dataset.panel === 'training');
      assert(panel, 'the Training panel is gone');
      const tab = doc.querySelectorAll('.tab').find(t => t.dataset.tab === 'training');
      assert(tab && /training/i.test(tab.textContent), 'the Training tab is gone');

      const go = doc.getElementById('btn-lessons');
      assert(go, 'the Training tab has no button that starts the lessons');
      assert(go.closest('.panel') === panel, 'the lessons button is not on the Training panel');
      assert(/lesson/i.test(go.textContent), `the button reads "${go.textContent}"`);

      assert(menu.s.mode !== 'training', 'the fixture already had Training selected; this proves nothing');
      go.click();
      assert(menu.s.mode === 'training',
        `pressing "${go.textContent}" left the mode at ${menu.s.mode}`);
      assert(hooks.fired.some(([n]) => n === 'onDeploy'), 'it selected the mode and never deployed');
      // The Deploy panel has to agree afterwards — it goes through selectMode.
      const card = menu._modeCards.get('training');
      assert(card && card.classList.contains('sel'),
        'the Mode list on the Deploy panel still shows something else as chosen');

      // The sandbox keeps its own honestly-labelled button, one step down.
      const sandbox = doc.getElementById('btn-sandbox');
      assert(sandbox && /sandbox/i.test(sandbox.textContent), 'the sandbox button lost its name');
      assert(!sandbox.classList.contains('primary'),
        'the sandbox is still the primary action on the tab named Training');
      sandbox.click();
      assert(menu.s.mode === 'sandbox', 'the sandbox button stopped selecting the sandbox');

      // …and the count in the panel's copy is the length of the list it starts.
      const text = panel.textContent;
      assert(text.includes(String(LESSONS.length)),
        `the panel never names how many lessons there are (${LESSONS.length})`);
      return `#btn-lessons → mode training + onDeploy, #btn-sandbox → sandbox, ${LESSONS.length} lessons named`;
    } finally { close(); }
  });

  /* ══════════════════════════════════════════════════════════════════
   *  GEOMETRY — the one thing nothing in this tree could see
   * ══════════════════════════════════════════════════════════════════ */

  check('layout: nothing on the front screen or the HUD leaves the frame', async () => {
    /**
     * THE CHECK TREE HAD NO LAYOUT ENGINE, AND THAT IS WHY TWO OF THESE SHIPPED.
     *
     * `tools/checks/_page.mjs` says it outright — "what this deliberately is
     * not: a layout engine. Nothing here computes a box." — so every geometric
     * claim in the suite is argued STRUCTURALLY off styles.css, which can say
     * "these two boxes are in one flex row so they cannot overlap" and can
     * never say "this row is 566 px wide in a 360 px frame". Both of the
     * defects below read perfectly as source and were invisible to all ~1450
     * checks:
     *
     *   THE TAB STRIP  `.menu-tabs` was `display:flex` with no wrap and no
     *                  overflow-x. Five tabs ship in the markup and
     *                  `_buildTraining`/`_buildDatabank` insert two more at
     *                  runtime, so the strip is SEVEN wide and the author never
     *                  saw it at full width. Measured: at 740x900 Deploy and
     *                  Options were off the edges, at 480 and 360 it was
     *                  Deploy, Training, Codex and Options — and with
     *                  `scrollWidth === clientWidth` and overflow visible there
     *                  was no scrollbar and no wheel scroll to reach them with.
     *   THE HUD        `.powers` was a bare `display:flex` and `.centermsg` was
     *                  `white-space:nowrap` at 38 px. Measured at 360x1080:
     *                  `.hud-br` spanned x -222…344 — 566 px of power wheel in
     *                  a 360 px frame — and the centre banner -113…473.
     *
     * So this one drives the REAL page in the real browser and asks the only
     * question a stylesheet cannot be asked: where did it land. It is the
     * cheapest honest version — three viewports, one measurement pass, no
     * frames rendered — because the alternative is another five checks that
     * read the file the box came from.
     *
     * The banner is FILLED before it is measured. An empty `.centermsg` is
     * zero wide and inside any frame, so measuring it at rest would be a check
     * that cannot fail; it is given the longest string the game puts in it —
     * which is a peer name arriving from another machine, `main.js`'s
     * 'A JEDI HAS FALLEN AWAY'.
     */
    const { chromium } = await import('playwright-core');
    /* Resolved rather than typed, and NOT skipped when it is missing — see the
     * header of `_browser.mjs`, which is the one place that knows where the
     * browser is now that a second suite drives one. */
    const { chromiumPath, CHROME_ARGS } = await import('./_browser.mjs');
    const exe = chromiumPath();

    const server = createServer(handler);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: exe, args: CHROME_ARGS });
    // Three: the shipped desktop shot, the width the tab strip broke at, and a
    // portrait phone, which is where every one of these fails first.
    const SIZES = [[1280, 720], [740, 900], [360, 1080]];
    const lines = [];
    try {
      for (const [width, height] of SIZES) {
        const page = await browser.newPage({ viewport: { width, height } });
        try {
          await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
          // Wait for the two RUNTIME tabs rather than for a clock: the whole
          // point is that the strip is seven wide, and a timeout that fires
          // early measures the five in the markup and passes.
          await page.waitForFunction(
            () => document.querySelectorAll('.menu-tabs .tab').length >= 7,
            null, { timeout: 30000 });
          const out = await page.evaluate(() => {
            document.getElementById('boot')?.classList.add('hidden');
            document.getElementById('menu')?.classList.remove('hidden');
            const hud = document.getElementById('hud');
            hud?.classList.remove('hidden');
            const cm = document.querySelector('.centermsg');
            if (cm) {
              cm.classList.add('on');
              cm.innerHTML = '<b>A JEDI HAS FALLEN AWAY</b><span>somebody left the fight</span>';
            }
            const escaped = [];
            const seen = [];
            const WATCH = ['.menu-tabs .tab', '.hud-br', '.hud-bl', '.hud-tl', '.hud-tr',
              '.centermsg', '.powers', '.menu-wrap'];
            for (const sel of WATCH) {
              for (const el of document.querySelectorAll(sel)) {
                const b = el.getBoundingClientRect();
                if (!b.width && !b.height) continue;
                seen.push(sel);
                if (b.left < -0.5 || b.right > innerWidth + 0.5) {
                  escaped.push(`${sel}${el.textContent.trim() ? ` "${el.textContent.trim().slice(0, 14)}"` : ''}`
                    + ` at x ${Math.round(b.left)}…${Math.round(b.right)}`);
                }
              }
            }
            return { escaped, boxes: seen.length, docW: document.documentElement.scrollWidth, w: innerWidth };
          });
          assert(!out.escaped.length,
            `${width}x${height}: ${out.escaped.length} box(es) outside the frame — ${out.escaped.join('; ')}`);
          // …and the page itself does not scroll sideways to hide it
          assert(out.docW <= out.w + 1,
            `${width}x${height}: the document is ${out.docW}px wide in a ${out.w}px frame`);
          lines.push(`${width}x${height} ${out.boxes} boxes in frame`);
        } finally { await page.close(); }
      }
      return lines.join(' · ');
    } finally {
      await browser.close();
      await new Promise(r => server.close(r));
    }
  });

  check('layout: a full HUD stays inside the frame, with the army column clear of the vitals', async () => {
    /**
     * MEASURED, BECAUSE THIS ONE SHIPPED FOR MONTHS AND READ FINE AS SOURCE.
     *
     * Reported: "all the icons for all your powerups cover the bottom left side
     * of your screen pushing up the troop management screen and stratagem
     * screens so far up that they are totally obscured". The stylesheet had no
     * defect in it. `.hud-bl` is a bottom-anchored column and every box in it
     * was correct on its own; what was wrong was the SUM. `#boon-strip` is its
     * last child and wraps, so with a full holocron it was eight rows of named
     * chips, and a bottom-anchored column pays for its own growth by lifting
     * everything above it. Driven in a real browser at 1280x720 with the roll,
     * the call list, the order panel and forty-four boons all up, `.hud-bl`
     * spanned y -811…702: eight hundred pixels of HUD above the top edge of the
     * window, exactly as described and invisible to every structural check in
     * this tree, because "these boxes are in one flow" was true the whole time.
     *
     * So the question this asks is the one only a browser can answer: with
     * everything the HUD can hold on screen at once, where did it land. Three
     * properties:
     *
     *   IN THE FRAME       Nothing may be off any edge. That is the report.
     *   NOT ON EACH OTHER  The two bottom columns are anchored to opposite
     *                      edges and are the two that grew; at any width the
     *                      game is actually played at they must not meet.
     *   THE FIX IS LOAD-   The roll stands down while the call list is held.
     *   BEARING            Without that the army column is ~420 px taller and
     *                      the cap starts eating the roll instead.
     *
     * The content is synthesised rather than played, because the state being
     * measured — a full company, a full call list, a live fire mission and a
     * complete holocron, all at once — is an hour of play to reach and is
     * exactly the state nobody reached before shipping it. The CLASSES are what
     * carry the sizes, and they are the real ones.
     */
    const { chromium } = await import('playwright-core');
    const { chromiumPath, CHROME_ARGS } = await import('./_browser.mjs');
    const { BOONS_NAMED } = await import('../../src/ui/HUD.js');

    const server = createServer(handler);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROME_ARGS });
    // The three the game is played on. The narrow pair the check above covers
    // are deliberately not here: at 360 px the ability wheel alone is the whole
    // width of the frame, so "the two bottom corners do not meet" is not a
    // property that frame has, and asserting it there would be asserting a lie.
    const SIZES = [[1920, 1080], [1366, 768], [1280, 720]];
    const lines = [];
    try {
      for (const [width, height] of SIZES) {
        const page = await browser.newPage({ viewport: { width, height } });
        try {
          await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
          await page.waitForFunction(
            () => document.querySelectorAll('.menu-tabs .tab').length >= 7,
            null, { timeout: 30000 });
          const out = await page.evaluate((named) => {
            document.getElementById('boot')?.classList.add('hidden');
            document.getElementById('menu')?.classList.add('hidden');
            document.getElementById('hud')?.classList.remove('hidden');
            const el = (id) => document.getElementById(id);
            const show = (id) => {
              const n = el(id);
              n?.classList.remove('hidden');
              n?.removeAttribute('aria-hidden');
            };
            show('firemission'); show('stratagem'); show('roster');
            show('minimap'); show('minimap-key');
            el('fm-told').textContent = 'ORBITAL STRIKE — RIDGE LINE';
            el('fm-verdict').textContent = 'ESTIMATE ONLY — GO AND LOOK';
            el('fm-foot').innerHTML = 'READ THE GROUND <b>0/3</b> <kbd>F</kbd>';
            /* Eighteen calls exist and `_stratagemPanel` shows ten of them
             * plus the phrase line, the leading row and the spill row. */
            el('stratagem').innerHTML =
              '<div class="sg-row sg-mark"><b>RESUPPLY</b><span class="sg-cost">30</span></div>'
              + '<div class="sg-words"><em class="on">down</em> <em class="next">up</em></div>'
              + Array.from({ length: 11 }, (_, i) =>
                `<div class="sg-row"><span class="sg-code">DDULR</span><b>CALL ${i}</b>`
                + '<span class="sg-cost">30</span></div>').join('');
            el('rp-army').textContent = '212TH ATTACK BN';
            el('rp-orders').innerHTML =
              Array.from({ length: 6 }, (_, i) => `<div class="rp-key">${i + 1}</div>`).join('');
            el('rp-list').innerHTML = Array.from({ length: 40 }, (_, i) =>
              `<div class="rp-row"><i></i><b>${i}</b><span>CT-${1000 + i} "LONGSHOT"</span>`
              + '<em>100</em></div>').join('');
            el('rp-foot').innerHTML = 'FALLEN 4 <b>MEDALS 2</b>';
            /* Past BOONS_NAMED the strip is icons — the same switch setBoons
             * makes, asserted here by driving the class it sets. */
            const BOONS = 44;
            el('boon-strip').classList.toggle('dense', BOONS > named);
            el('boon-strip').innerHTML =
              Array.from({ length: BOONS }, () => '<div class="bn">⚡</div>').join('');
            el('power-wheel').innerHTML = Array.from({ length: 11 }, () =>
              '<div class="pw"><span class="gl"><svg viewBox="0 0 24 24">'
              + '<path d="M2 2 L22 22"/></svg></span></div>').join('');
            const mm = el('minimap');
            mm.width = mm.height = 132; mm.style.width = mm.style.height = '132px';
            el('minimap-key').innerHTML = 'SENSE <b>V</b>';
            el('event-feed').innerHTML = Array.from({ length: 4 }, (_, i) =>
              `<div class="ev"><b>SOMETHING HAPPENED ${i}</b><span>a subtitle</span></div>`).join('');
            el('killfeed').innerHTML = Array.from({ length: 5 }, (_, i) =>
              `<div class="kf"><b>CT-1234</b> cut down <b>B1-${i}</b></div>`).join('');

            const R = (sel) => {
              const n = document.querySelector(sel);
              if (!n) return null;
              const b = n.getBoundingClientRect();
              if (!b.width && !b.height) return null;
              return { sel, t: Math.round(b.top), b: Math.round(b.bottom),
                l: Math.round(b.left), r: Math.round(b.right) };
            };
            const boxes = ['.hud-tl', '.hud-tr', '.hud-bl', '.hud-br'].map(R).filter(Boolean);
            const area = (a, c) => Math.max(0, Math.min(a.b, c.b) - Math.max(a.t, c.t))
              * Math.max(0, Math.min(a.r, c.r) - Math.max(a.l, c.l));
            const bl = boxes.find((x) => x.sel === '.hud-bl');
            const br = boxes.find((x) => x.sel === '.hud-br');
            return {
              boxes,
              W: innerWidth, H: innerHeight,
              blbr: bl && br ? area(bl, br) : 0,
              /* The load-bearing rule, asked of the live layout rather than of
               * the stylesheet: with the call list up the roll is not drawn. */
              rollDown: getComputedStyle(el('roster')).display === 'none',
              armyH: br ? br.b - br.t : 0,
            };
          }, BOONS_NAMED);

          const escaped = out.boxes.filter((b) =>
            b.t < -0.5 || b.b > out.H + 0.5 || b.l < -0.5 || b.r > out.W + 0.5);
          assert(!escaped.length,
            `${width}x${height}: ${escaped.length} HUD block(s) outside the frame — `
            + escaped.map((b) => `${b.sel} y ${b.t}…${b.b} x ${b.l}…${b.r}`).join('; ')
            + ' — this is the reported defect: a bottom-anchored column that grew past the top edge');
          assert(out.rollDown,
            `${width}x${height}: the roll is still drawn under a held call list — that is ~420 px `
            + 'the army column does not have, and the cap pays for it out of the roll');
          assert(out.blbr === 0,
            `${width}x${height}: the vitals column and the army column overlap by ${out.blbr} px² — `
            + 'two corners anchored to opposite edges have met, which is what moving the panels '
            + 'across was supposed to make impossible');
          lines.push(`${width}x${height} in frame, army column ${out.armyH}px`);
        } finally { await page.close(); }
      }
      return lines.join(' · ');
    } finally {
      await browser.close();
      await new Promise(r => server.close(r));
    }
  });

  /* ══════════════════════════════════════════════════════════════════
   *  THE SERVER
   * ══════════════════════════════════════════════════════════════════ */

  check('serve: a second load asks whether the file changed instead of downloading it again', async () => {
    const server = createServer(handler);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const at = (p, headers, method = 'GET') => fetch(`http://127.0.0.1:${port}${p}`, { headers, method });
    try {
      for (const path of ['/', '/styles.css', '/src/main.js']) {
        const first = await at(path);
        assert(first.status === 200, `${path} answered ${first.status}`);
        const etag = first.headers.get('etag');
        const modified = first.headers.get('last-modified');
        const body = await first.text();
        assert(etag, `${path} came back with no ETag, so 'no-cache' means 'send it all again'`);
        assert(modified && !Number.isNaN(Date.parse(modified)), `${path} has no usable Last-Modified`);
        assert(body.length > 0, `${path} served nothing`);

        // what a browser sends on the next visit
        const again = await at(path, { 'If-None-Match': etag });
        assert(again.status === 304, `${path} with a matching ETag answered ${again.status}`);
        assert(again.headers.get('etag') === etag, '304 came back with a different tag');
        assert((await again.text()).length === 0, 'a 304 carried a body');

        const byDate = await at(path, { 'If-Modified-Since': modified });
        assert(byDate.status === 304, `${path} with a matching date answered ${byDate.status}`);
        await byDate.text();

        // …and a client holding something else still gets the file
        const stale = await at(path, { 'If-None-Match': 'W/"not-this-one"' });
        assert(stale.status === 200, `${path} with a stale tag answered ${stale.status}`);
        assert((await stale.text()).length === body.length, 'a stale revalidation was answered short');

        // a list of tags, which is legal and is what a cache with two copies sends
        const list = await at(path, { 'If-None-Match': `W/"other", ${etag}` });
        assert(list.status === 304, 'a tag list containing the current tag answered 200');
        await list.text();

        // an ancient date is not a match
        const old = await at(path, { 'If-Modified-Since': new Date(0).toUTCString() });
        assert(old.status === 200, 'a 1970 If-Modified-Since answered 304');
        await old.text();
      }

      // Ranges still work, and a precondition that matches beats the range —
      // a client that already holds the bytes does not need them sent again.
      const head = await at('/index.html', undefined, 'HEAD');
      const tag = head.headers.get('etag');
      const part = await at('/index.html', { Range: 'bytes=0-1' });
      assert(part.status === 206, `a range request answered ${part.status}`);
      assert((await part.arrayBuffer()).byteLength === 2, 'the range came back the wrong length');
      const both = await at('/index.html', { Range: 'bytes=0-1', 'If-None-Match': tag });
      assert(both.status === 304, `a range request with a matching validator answered ${both.status}`);
      await both.text();

      // The tag is a fact about the file, not about the request.
      const a = await at('/styles.css'); await a.text();
      const b = await at('/styles.css'); await b.text();
      assert(a.headers.get('etag') === b.headers.get('etag'), 'the ETag changes between requests');
      const other = await at('/index.html'); await other.text();
      assert(other.headers.get('etag') !== a.headers.get('etag'),
        'two different files share one ETag, so one of them is served for the other');
      return 'ETag + Last-Modified on every response, 304 on If-None-Match / If-Modified-Since, '
        + '200 on a stale tag, 206 still 206';
    } finally { server.close(); }
  });
}
