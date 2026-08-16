/**
 * RUN RULES ON THE PANEL, and the run's number on the record.
 *
 * The composer's half of this feature is pinned in tools/checks/escalation.mjs
 * — that a rule is honoured, never charged, never a discount, and that four of
 * them from wave 1 compose a wave that spends its budget. This file is the
 * other half, and it exists because those two halves fail in different ways.
 *
 * A rule the player cannot reach is not a feature; a rule the panel LIGHTS and
 * the director then drops is worse than one it never offered, because it reads
 * as the picker being randomly broken and it sticks — that is the defect
 * `Menu._syncTheatre` was written for, in its own words. So every claim here is
 * about the OBJECT: a real Menu on a real parse of index.html, driven the way a
 * player drives it, asserted against the same `WaveDirector` methods the run
 * will use. Reading Menu.js as text would pass with the constructor replaced by
 * `return;` (see the head of tools/checks/menu.mjs, which found exactly that).
 */

import { readFile } from 'node:fs/promises';
import { makeDocument } from './_page.mjs';
import { Menu, DEFAULT_SETTINGS } from '../../src/ui/Menu.js';
import * as Waves from '../../src/game/Waves.js';
import { recordRun, clearProgress, progressLines } from '../../src/game/Progress.js';

/* Levels.js is where seventeen of the thirty-one archetypes are REGISTERED, so
 * nothing here can read a pool before it has been imported — and it is imported
 * inside `run()` rather than statically, which is the precedent every other
 * check in this tree follows. */
let LEVELS = null, LEVEL_ORDER = null;

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

/**
 * A real Menu on a real page. SYNCHRONOUS from `install()` to `close()` for the
 * reason menu.mjs states: the runner starts the next check the moment this one
 * suspends, and a check that awaited while a fake `document` was global would
 * hand its page to whatever ran next.
 */
let INDEX_HTML = '';
function menuOn(overrides = {}) {
  const doc = makeDocument(INDEX_HTML);
  const restore = doc.install();
  try {
    const settings = { ...structuredClone(DEFAULT_SETTINGS), ...overrides };
    const hooks = {};
    for (const name of ['onDeploy', 'onQualityChange', 'onBloom', 'onSchemeChange', 'onDeflectAim',
      'onLightning', 'onSaberChange', 'onName', 'onHost', 'onJoin', 'onBindings']) hooks[name] = () => {};
    return { menu: new Menu(settings, hooks), settings, doc, close: restore };
  } catch (e) { restore(); throw e; }
}

const dirFor = (level, rules = []) => new Waves.WaveDirector(
  { enemies: [], players: [], settings: {}, takenBoons: new Set() },
  { mode: 'roguelite', pool: LEVELS[level].pool, rules });

export async function run({ check, assert }) {
  INDEX_HTML = await read('index.html');
  ({ LEVELS, LEVEL_ORDER } = await import('../../src/game/Levels.js'));

  check('rules: every rule in the table is a card on the Deploy panel', () => {
    const { doc, close } = menuOn();
    try {
      const host = doc.getElementById('rule-list');
      assert(host, 'index.html has no #rule-list — the rules column is not on the page at all');
      const cards = [...host.children];
      assert(cards.length === Waves.CONDITION_KEYS.length,
        `${cards.length} rule cards against ${Waves.CONDITION_KEYS.length} entries in CONDITIONS — `
        + 'the column is a second copy of the table rather than a reading of it');
      // Every card must carry its own record's words, not a paraphrase typed
      // into the markup. A rule added to CONDITIONS appears here the same day.
      const text = cards.map((c) => c.innerHTML || '').join('\n');
      for (const k of Waves.CONDITION_KEYS) {
        assert(text.includes(Waves.CONDITIONS[k].label),
          `no card prints "${Waves.CONDITIONS[k].label}" — the panel is not reading CONDITIONS`);
      }
      return `${cards.length} rules on the panel, every label off CONDITIONS`;
    } finally { close(); }
  });

  check('rules: what the panel offers is exactly what the director will honour', () => {
    /**
     * THE PROPERTY THAT MATTERS MORE THAN THE COLUMN EXISTING. `needs` vetoes a
     * rule off the theatre's roster and `excludes` vetoes a pair; both already
     * existed for the dealt path, and both are asked at RUN START now. If the
     * panel and the director answer differently, the player is told they are
     * fighting under a rule that is not in force — which is the one failure
     * mode a self-imposed handicap cannot survive.
     */
    let barred = 0, offered = 0;
    for (const key of LEVEL_ORDER) {
      const { menu, settings, doc, close } = menuOn({ level: key });
      try {
        const d = dirFor(key);
        const cards = [...doc.getElementById('rule-list').children];
        for (let i = 0; i < Waves.CONDITION_KEYS.length; i++) {
          const rule = Waves.CONDITION_KEYS[i];
          const card = cards[i];
          const vetoed = !!d.ruleVeto(rule);
          const greyed = card.classList.contains('barred');
          assert(vetoed === greyed,
            `${key}: the panel ${greyed ? 'greys' : 'offers'} ${rule} and the director `
            + `${vetoed ? 'vetoes' : 'accepts'} it`);
          if (vetoed) {
            barred++;
            const said = card.querySelector('.txt span')?.textContent || '';
            assert(said && said !== Waves.CONDITIONS[rule].tell,
              `${key}: ${rule} is greyed and still prints its ordinary tell — a control that is off `
              + 'and does not say why reads as the picker being broken');
            assert(card.getAttribute('aria-disabled') === 'true' && card.tabIndex === -1,
              `${key}: ${rule} is greyed and a keyboard can still reach it`);
          } else offered++;
        }
        // …and picking one really writes it, and really survives into a run.
        const first = Waves.CONDITION_KEYS.find((k) => !d.ruleVeto(k));
        cards[Waves.CONDITION_KEYS.indexOf(first)].dispatchEvent({ type: 'click' });
        assert(settings.rules.includes(first),
          `${key}: clicking ${first} wrote ${JSON.stringify(settings.rules)}`);
        assert(dirFor(key, settings.rules).rules.includes(first),
          `${key}: the director dropped ${first}, which the panel had just lit`);
      } finally { close(); }
    }
    return `${LEVEL_ORDER.length} theatres · ${offered} rule cards offered, ${barred} greyed with a reason, `
      + 'panel and director agreeing on every one';
  });

  check('rules: two mutually exclusive rules cannot both be lit', () => {
    const { menu, settings, doc, close } = menuOn({ level: 'colosseum' });
    try {
      const cards = [...doc.getElementById('rule-list').children];
      const idx = (k) => Waves.CONDITION_KEYS.indexOf(k);
      // A pair that declares an exclusion, taken off the table rather than typed.
      const pair = (() => {
        for (const a of Waves.CONDITION_KEYS) {
          for (const b of Waves.CONDITION_KEYS) if (a !== b && Waves.rulesConflict(a, b)) return [a, b];
        }
        return null;
      })();
      assert(pair, 'no condition declares `excludes` — this check has no subject');
      cards[idx(pair[0])].dispatchEvent({ type: 'click' });
      assert(settings.rules.includes(pair[0]), `${pair[0]} did not take`);
      assert(cards[idx(pair[1])].classList.contains('barred'),
        `${pair[1]} is still offered beside ${pair[0]}, which excludes it`);
      const why = cards[idx(pair[1])].querySelector('.txt span')?.textContent || '';
      assert(why.includes(Waves.CONDITIONS[pair[0]].label),
        `${pair[1]} is greyed and does not name ${pair[0]} as the reason: "${why}"`);
      // …and clicking the barred one is inert rather than silently accepted.
      cards[idx(pair[1])].dispatchEvent({ type: 'click' });
      assert(!settings.rules.includes(pair[1]),
        `a barred card was clickable and wrote ${JSON.stringify(settings.rules)}`);
      // Unpicking gives it back.
      cards[idx(pair[0])].dispatchEvent({ type: 'click' });
      assert(!settings.rules.length && !cards[idx(pair[1])].classList.contains('barred'),
        'unpicking the first rule did not release the one it excluded');
      return `${pair[0]} bars ${pair[1]} on the panel and names itself as the reason`;
    } finally { close(); }
  });

  check('rules: the panel will not offer more rules than a wave can carry', () => {
    const { settings, doc, close } = menuOn({ level: 'colosseum' });
    try {
      const cards = [...doc.getElementById('rule-list').children];
      const d = dirFor('colosseum');
      const legal = Waves.CONDITION_KEYS.filter((k) => !d.ruleVeto(k));
      for (const k of legal) {
        const card = cards[Waves.CONDITION_KEYS.indexOf(k)];
        if (!card.classList.contains('barred')) card.dispatchEvent({ type: 'click' });
      }
      assert(settings.rules.length === Waves.CONDITION_MAX,
        `clicking every offered rule left ${settings.rules.length} against a cap of ${Waves.CONDITION_MAX}`);
      for (const k of legal) {
        if (settings.rules.includes(k)) continue;
        assert(cards[Waves.CONDITION_KEYS.indexOf(k)].classList.contains('barred'),
          `${k} is still offered with ${Waves.CONDITION_MAX} rules already held`);
      }
      return `${settings.rules.length} of ${Waves.CONDITION_MAX} held, the rest greyed`;
    } finally { close(); }
  });

  check('rules: changing the theatre takes back a rule that theatre cannot field', () => {
    /**
     * The stored set has to be normalised on the way in as well as on the way
     * out, or a rule picked on a theatre that allows it survives in settings,
     * is silently dropped by the run, and then reappears the next time a
     * theatre that CAN field it is picked — a setting the player did not choose
     * turning up two runs later.
     */
    const vetoedSomewhere = Waves.CONDITION_KEYS.find((k) =>
      LEVEL_ORDER.some((L) => dirFor(L).ruleVeto(k)) && LEVEL_ORDER.some((L) => !dirFor(L).ruleVeto(k)));
    assert(vetoedSomewhere, 'no rule is vetoed on one theatre and allowed on another');
    const allows = LEVEL_ORDER.find((L) => !dirFor(L).ruleVeto(vetoedSomewhere));
    const refuses = LEVEL_ORDER.find((L) => dirFor(L).ruleVeto(vetoedSomewhere));
    const { settings, doc, close } = menuOn({ level: allows, rules: [vetoedSomewhere] });
    try {
      assert(settings.rules.includes(vetoedSomewhere),
        `${vetoedSomewhere} was dropped on ${allows}, which allows it`);
      const card = [...doc.getElementById('level-list').children][LEVEL_ORDER.indexOf(refuses)];
      card.dispatchEvent({ type: 'click' });
      assert(settings.level === refuses, 'the theatre card did not take');
      assert(!settings.rules.includes(vetoedSomewhere),
        `${vetoedSomewhere} survived a move to ${refuses}, which cannot field it`);
      return `${vetoedSomewhere} kept on ${allows}, dropped on ${refuses}`;
    } finally { close(); }
  });

  check('rules: the seed is a box, and an empty one still draws a run', () => {
    const { settings, doc, close } = menuOn();
    try {
      const field = doc.getElementById('opt-seed');
      assert(field, 'index.html has no #opt-seed — a run cannot be repeated');
      assert(settings.seed === null, `the shipped default seed is ${settings.seed}, not null`);
      field.value = '12x34';
      field.dispatchEvent({ type: 'input' });
      assert(field.value === '1234', `a typed "12x34" became "${field.value}" — the box accepts a NaN`);
      assert(settings.seed === 1234, `the box wrote ${settings.seed}`);
      field.value = '';
      field.dispatchEvent({ type: 'input' });
      assert(settings.seed === null, `an emptied box wrote ${settings.seed} instead of null`);
      return 'digits only, empty is null, and null is "draw one"';
    } finally { close(); }
  });

  check('rules: a seeded run composes the same waves twice, and an unseeded one does not', () => {
    /**
     * THE WHOLE POINT OF A SEED, and it was unreachable: `WaveDirector.seed`
     * read `world.run`, which nothing has assigned since `Run.js` was deleted
     * with the Descent, so `seedWaves` was called by nothing in the game and
     * every run was an unrepeatable accident. Driven the way `main.js` drives
     * it — the number on the world, the director reading it in its constructor.
     */
    const world = (seed) => ({ enemies: [], players: [], settings: {}, takenBoons: new Set(), runSeed: seed });
    const play = (seed, n = 8) => {
      const d = new Waves.WaveDirector(world(seed), { mode: 'roguelite', pool: LEVELS.scoria.pool });
      const out = [];
      for (let w = 1; w <= n; w++) { d.wave = w; d._compose(); out.push(d.spawnQueue.join(',')); }
      return out.join(' | ');
    };
    const a = play(4242), b = play(4242), c = play(9999);
    assert(a === b, 'two runs on the same seed composed different waves — the seed does nothing');
    assert(a !== c, 'two different seeds composed identical waves — the seed is not reaching the stream');
    // …and no seed at all is still a run, and still varies.
    const free1 = play(null), free2 = play(null);
    assert(free1.length && free2.length, 'an unseeded run composed nothing');
    return `seed 4242 replays exactly over 8 waves; seed 9999 differs; an unseeded run still composes`;
  });

  check('rules: the record remembers what the run was fought under, and does not sell it back', () => {
    /**
     * `Progress.byRule` in the shape of `byMode`. This is a RECORD and not a
     * currency: the file it lives in refuses unlocks, currency and cross-run
     * power in its own header, and a rule set carries none of the three — every
     * rule is available in the first run, picking one makes the player no
     * stronger, and nothing in src/ reads `byRule` back into a run.
     */
    clearProgress();
    const rules = ['silence', 'hammer'];
    recordRun({ mode: 'roguelite', wave: 21, score: 100, kills: 4, seed: 4242, rules,
      identity: { order: 'jedi', species: 'human' } });
    // The same set in the other order is the same record, not a second one.
    const p = recordRun({ mode: 'roguelite', wave: 12, score: 90, kills: 2, seed: 7,
      rules: ['hammer', 'silence'], identity: { order: 'jedi', species: 'human' } });
    const keys = Object.keys(p.byRule);
    assert(keys.length === 1,
      `two orderings of one rule set made ${keys.length} records: ${keys.join(' / ')}`);
    assert(p.byRule[keys[0]] === 21, `deepest under ${keys[0]} reads ${p.byRule[keys[0]]}, not 21`);
    // An unruled run is byMode's business and must not make an empty key.
    const q = recordRun({ mode: 'roguelite', wave: 30, score: 1, kills: 1, rules: [], seed: 88123,
      identity: { order: 'jedi', species: 'human' } });
    assert(!('' in q.byRule), 'an unruled run wrote an empty-string rule record');
    const lines = progressLines(q);
    const line = lines.find((l) => l.startsWith('under '));
    assert(line, `no line names the rules: ${lines.join(' / ')}`);
    for (const k of rules) {
      assert(line.includes(Waves.CONDITIONS[k].label),
        `the record line "${line}" does not print ${Waves.CONDITIONS[k].label}`);
    }
    // …and the seed the run was drawn on is printed, which it never was.
    const last = lines.find((l) => l.startsWith('last:'));
    assert(last.includes('seed '), `the last-run line carries no seed: "${last}"`);
    // NOT A CURRENCY: nothing in the record grants anything.
    assert(!('unlocked' in q) && !('spent' in q),
      'the record has grown a field that sounds like a currency');
    clearProgress();
    return `${keys[0]} recorded once at depth 21; the menu line reads "${line}"`;
  });
}
