/* Probe: under HOLD FIRE, who is pulling the trigger? Counts every bolt whose
 * owner carries a roster record, and prints the owner's archetype, team, whose
 * roster the record is on, and whether _troops reached it that frame. */
import './dom-shim.mjs';
import * as THREE from 'three';
if ((await import('three')) !== THREE) { console.error('start with --import ./tools/register.mjs'); process.exit(2); }

const SECONDS = +(process.argv[2] || 45);
const FORM = process.argv[3] || 'holdfire';

const Cmd = await import('../src/game/Command.js');
const { enemyRng } = await import('../src/game/Enemy.js');
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');

enemyRng.seed(20250814);
const { world } = await bootWorld({
  level: 'geonosis',
  settings: { mode: 'command', level: 'geonosis', order: 'jedi' },
});
const d = world.command;
d.order(FORM);
world.director.start(1);
const input = idleInput();

const tally = new Map();
let now = 0;
const fire = world.bolts.fire.bind(world.bolts);
let out = 0, incoming = 0;
world.bolts.fire = (from, dir, opts = {}) => {
  const o = opts.owner;
  if (o?.trooper) {
    out++;
    const onMine = d.roster?.all?.some?.((t) => t === o.trooper);
    const key = `${o.type} team=${o.team} cmdr=${o.cmdr === d.commander ? 'mine' : (o.cmdr ? 'other' : 'none')}`
      + ` commandOf=${o.commandOf ? 'set' : 'null'} onMyRoster=${onMine}`
      + ` reaction=${o.reaction ? o.reaction.kind || 'yes' : 'no'} driven=${!!o.driven}`
      + ` atk=${(o.attackTimer ?? 0).toFixed(2)} burst=${o.burstLeft}`;
    const t = o.trooper;
    const inSquads = d.squadsOf(d.commander).some((sq) => sq.includes(t));
    const key2 = `alive=${t.alive} broken=${t.broken} rout=${t.rout} morale=${t.morale.toFixed(2)} inSquads=${inSquads} sinceStop=${(now - (o._stopAt ?? -99)).toFixed(2)}`;
    tally.set(key2, (tally.get(key2) || 0) + 1);
  } else incoming++;
  return fire(from, dir, opts);
};
const { Enemy } = await import('../src/game/Enemy.js');
let stops = 0, troops = 0;
const sf = Enemy.prototype.stopFiring;
Enemy.prototype.stopFiring = function () { if (this.trooper) { stops++; this._stopAt = now; } return sf.call(this); };

const tr = Cmd.CommandDirector.prototype._troops;
Cmd.CommandDirector.prototype._troops = function (...a) { troops++; return tr.apply(this, a); };

const STEP = 1 / 30;
for (let i = 0; i < Math.round(SECONDS / STEP); i++) {
  now = i * STEP;
  if (process.env.HOLD_ALIVE && world.player) world.player.hp = world.player.maxHp;
  world.update(STEP, input);
  if (i % 150 === 0) console.log(`  t=${(i * STEP).toFixed(0)}s form=${d.commander.formation} closing=${!!d._closing} stops=${stops} troops=${troops} extr=${!!world.extraction?.active} over=${!!world.over} phase=${world.extraction?.phase ?? '-'} out=${out} living=${d.roster.living.length} bodies=${d.roster.living.filter((t) => t.body && !t.body.dead).length}`);
}
console.log(`formation=${FORM} out=${out} incoming=${incoming} closing=${!!d._closing}`);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`);
console.log('roster living', d.roster.living.length, 'fallen', d.roster.fallen.length);
world.unload();
