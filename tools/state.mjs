/**
 * WHAT THIS BUILD IS, IN NUMBERS — so HANDOFF §1 does not have to be believed.
 *
 * The State table used to be a hand-typed count of levels, modes and
 * archetypes, and it rotted exactly the way §2.3 says a hand-maintained table
 * beside its generated twin rots: it read "Levels 10, Modes 6" through a
 * session that deleted three levels and added two modes and two campaigns. A
 * reader who trusted it went looking for a level that is not there.
 *
 * So the table cites this, and this reads the registries. Run it whenever the
 * numbers in §1 look old:
 *
 *     node --import ./tools/register.mjs tools/state.mjs
 *
 * THE LOADER IS NOT OPTIONAL — see §2.1. Without it these imports pull a
 * second copy of three into the process and the failure is a stack trace, not
 * a wrong number, but it is still a wasted minute.
 */

import { LEVELS, LEVEL_ORDER, CAMPAIGNS } from '../src/game/Levels.js';
import { MODES } from '../src/game/Waves.js';
import { ARCHETYPES } from '../src/game/Enemy.js';

const rows = [
  ['Levels', Object.keys(LEVELS).length, LEVEL_ORDER.join(', ')],
  ['Modes', Object.keys(MODES).length, Object.keys(MODES).join(', ')],
  ['Campaigns', Object.keys(CAMPAIGNS).length,
    Object.entries(CAMPAIGNS).map(([k, c]) => `${k} (${c.missions?.length ?? 0})`).join(', ')],
  ['Archetypes', Object.keys(ARCHETYPES).length, ''],
];

/* THE ORDER IS A SEPARATE COUNT ON PURPOSE. `LEVEL_ORDER` is what the rotation
 * and the front end walk; `LEVELS` is what exists. A level built and never put
 * in the order is playable only by typing its key, which has happened, so the
 * two are printed apart rather than as one number. */
if (LEVEL_ORDER.length !== Object.keys(LEVELS).length) {
  const missing = Object.keys(LEVELS).filter((k) => !LEVEL_ORDER.includes(k));
  const ghost = LEVEL_ORDER.filter((k) => !LEVELS[k]);
  rows.push(['⚠ order', LEVEL_ORDER.length,
    [missing.length ? `not in the order: ${missing.join(', ')}` : '',
      ghost.length ? `in the order and not built: ${ghost.join(', ')}` : ''].filter(Boolean).join('; ')]);
}

const w = Math.max(...rows.map((r) => r[0].length));
for (const [name, n, detail] of rows) {
  console.log(`${name.padEnd(w)}  ${String(n).padStart(3)}${detail ? `   ${detail}` : ''}`);
}
