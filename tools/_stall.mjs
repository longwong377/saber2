/**
 * THE FREEZE PROBE — drive a mode through its real transitions and report the
 * frame it stops making progress on.
 *
 * Every campaign/skirmish check in the tree passes `instantSpawn: true`, which
 * is precisely the flag that switches the extraction journey OFF. So the whole
 * transition — aftermath, call, inbound, boarding, liftoff, transit, the level
 * rotate that happens at altitude, descent, unload — has never been driven by
 * a check on the path the player actually plays. The player's report:
 *
 *     "in campaign mode the game completely freezes when you finish the first
 *      wave, never unfreezes"
 *     "in skirmish mode I'll start the map will immediately say cleared and we
 *      leave like there were never any enemies"
 *
 *   node --import ./tools/register.mjs tools/_stall.mjs --mode campaign
 */
import './dom-shim.mjs';
import { bootWorld, idleInput } from './checks/_coop.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const MODE = flag('mode', 'campaign');
const LEVEL = flag('level', null);
const SECONDS = parseFloat(flag('seconds', '240'));
const KILL = flag('kill', '1') !== '0';

const { enemyRng } = await import('../src/game/Enemy.js');
const { seedWaves } = await import('../src/game/Waves.js');
enemyRng.seed(7); seedWaves(7, 0);

const level = LEVEL || (MODE === 'campaign' ? 'geonosis' : 'colosseum');
const { world } = await bootWorld({
  level,
  settings: { mode: MODE, quality: 'low', difficulty: 'knight', instantSpawn: false },
});
world.runSeed = 7;
const input = idleInput();

if (MODE === 'skirmish') {
  world.beginSkirmish({ engagements: 3, strength: 12, pressure: 1, rotate: false });
} else if (MODE === 'campaign') {
  world.beginCampaign();
} else {
  world.director.start(1);
}
world.onRotate = null;      // take the synchronous door, like a front end that declines

const DT = 1 / 60;
let last = null, stuckFor = 0, t = 0;
const trail = [];
const seen = new Set();
while (t < SECONDS && !world.over) {
  try { world.update(DT, input); } catch (e) {
    console.log(`THROW at t=${t.toFixed(1)}: ${e.message}\n${(e.stack || '').split('\n').slice(1, 5).join('\n')}`);
    break;
  }
  t += DT;
  if (world.player) world.player.hp = world.player.maxHp;
  // kill the horde every half second, the way campaigns.mjs does
  if (KILL && Math.floor(t * 2) !== Math.floor((t - DT) * 2)) {
    for (const e of world.enemies) {
      if (e.team !== world.partyTeam && !e.dead) e.damage?.(99999, null, 'probe');
    }
  }
  const st = [
    world.levelKey,
    world.director?.wave ?? -1,
    world.director?.active ? 'A' : 'i',
    world.skirmish ? `sk${world.skirmish.cleared}/${world.skirmish.engagements}` : 'sk-',
    world.campaign ? `m${world.campaign.index}` : 'm-',
    world.extraction?.phase || '-',
    `q${world.director?.spawnQueue?.length ?? -1}`,
    `e${world.enemies.filter((e) => e.team !== world.partyTeam && !e.dead).length}`,
    `a${world.enemies.filter((e) => e.team === world.partyTeam && !e.dead).length}`,
    world.over ? 'OVER' : '',
  ].join(' ');
  if (st !== last) {
    if (!seen.has(st)) { seen.add(st); trail.push(`${t.toFixed(1)}s  ${st}`); }
    last = st; stuckFor = 0;
  } else {
    stuckFor += DT;
    if (stuckFor > 40) { trail.push(`${t.toFixed(1)}s  STUCK 40 s in: ${st}`); break; }
  }
}
console.log(trail.join('\n'));
console.log(`--- ended t=${t.toFixed(1)}s over=${world.over} phase=${world.extraction?.phase || '-'}`);
