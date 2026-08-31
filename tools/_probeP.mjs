import './dom-shim.mjs';
import * as THREE from 'three';
const Cmd = await import('../src/game/Command.js');
const { LEVELS } = await import('../src/game/Levels.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const V = (x,y,z) => new THREE.Vector3(x,y,z);
function cmdWorld() {
  const w = { scene: new THREE.Scene(),
    terrain: { height: () => 0, normalAt: (x,z,o)=>o.set(0,1,0), raycast: () => null, size: 400, half: 200, surfaceAt: () => 'sand', crater(){ w._craters=(w._craters|0)+1; }, flush(){}, slopeAt: () => 0, inBounds: (x,z) => Math.hypot(x,z) < 200 },
    settings: {}, difficulty: null, hpScale: 1, dmgScale: 1, time: 0,
    players: [], enemies: [], statics: [], props: [], doors: [],
    physics: { staticBoxes: [], bodies: [], add(){}, remove(){}, addStaticBox(){return null;}, removeStaticBox(){}, raycast: () => null },
    level: LEVELS.geonosis, run: null, takenBoons: new Set(), notes: [],
    notify(a,b){ this.notes.push([a,b]); }, report(){},
    spawnEnemy(type, pos) {
      const A = ARCHETYPES[type];
      const e = { id: 'e'+(w._n=(w._n|0)+1), type, A, world: w, team: 1,
        position: pos.clone ? pos.clone() : V(pos.x,pos.y,pos.z),
        velocity: new THREE.Vector3(), dead:false, hp:A.hp, maxHp:A.hp, speed:A.speed,
        attackDamage:A.damage??0, mod:null, rig:null, group:null, wish:null, toTarget:null, facing:0,
        _wallN:new THREE.Vector3(), _wallT:0, _stuckT:0, _prevPos:new THREE.Vector3(),
        burstLeft:0, burstTimer:0, attackTimer:0, aimCharge:0,
        _move(){}, damage(n){ this.hp-=n; return this.hp<=0; }, _syncBody(){} };
      w.enemies.push(e); return e;
    } };
  return w;
}
const w = cmdWorld();
const d = new Cmd.CommandDirector(w, { pool: LEVELS.geonosis.pool });
const me = { position: V(0,0,0), aimDir: V(0,0,1), facing: 0, alive: true, team: 0 };
w.players.push(me); w.player = me; d.commander.player = me;
d.deploy(); d._troops(1/30, {});
const c = d.commander;
const squads = d.squadsOf(c);
console.log('squads', squads.length, squads.map(s=>s.length));
const sq = squads[0];
// give the last man in squad 0 sergeant, a different one captain
sq[sq.length-1].award(Cmd.RANKS[2].xp);
sq[0].award(Cmd.RANKS[3].xp);
console.log('derived leader', d.leaderOf(sq).name, d.leaderOf(sq).rankRec.short);
const r = c.roster.appoint(sq[sq.length-1], true);
console.log('appoint', JSON.stringify({ok:r.ok, reason:r.reason}));
console.log('posted leader', d.leaderOf(sq).name, d.leaderOf(sq).rankRec.short);
// refusal on a trooper
console.log('appoint trooper', JSON.stringify(c.roster.appoint(sq[1], true)?.reason));
// --- the vacancy: plant ground, kill the leader, no HOLDS left
for (const t of sq) if (t.body) t.body.position.set(-60,0,0);
d.order('cover', c, 0);
console.log('planted?', !!c.squadPlanted?.get('0'));
// strip everyone else of HOLDS: they are rank 0 troopers already except sq[0] (captain)
sq[0].xp = 0;
w.notes.length = 0;
const lead = d.leaderOf(sq);
console.log('about to kill', lead.name, lead.rankRec.short, 'post', lead.post);
d.onDeath(lead.body, null);
console.log('planted after?', !!c.squadPlanted?.get('0'));
for (const n of w.notes) console.log(' NOTE:', n[0], '|', n[1]);
console.log('log tail', JSON.stringify(d.log.slice(-4)));

// ── RELAYS: a Commander steadies a man in ANOTHER squad ────────────────────
{
  const { MORALE } = await import('../src/game/Morale.js');
  const other = squads[1];
  const cmdr = other[0];
  cmdr.xp = Cmd.RANKS[4].xp;
  console.log('\nRELAYS holder', cmdr.name, cmdr.rankRec.short, Cmd.holds(cmdr, 'RELAYS'));
  const subject = squads[0].find((t) => t.alive && t !== cmdr);
  // put the whole world far from the player so only the relay term can fire
  me.position.set(9999, 0, 9999);
  for (const t of [...squads[0], ...squads[1]]) if (t.body) t.body.position.set(300, 0, 300);
  const run = (relayNear) => {
    subject.morale = 0.5;
    cmdr.body.position.set(relayNear ? 300 : 9999, 0, relayNear ? 300 : 9999);
    // keep the subject's own squad leader far so LEADER_NEAR cannot fire
    const lead = d.leaderOf(squads[0]);
    if (lead && lead !== subject && lead.body) lead.body.position.set(-9999, 0, -9999);
    subject.body.position.set(300, 0, 300);
    d._morale(1, c);
    return subject.morale;
  };
  const far = run(false), near = run(true);
  console.log('morale far', far.toFixed(4), 'near a Commander', near.toFixed(4),
              'delta', (near - far).toFixed(4), 'RELAY_NEAR', MORALE.RELAY_NEAR);
}
// ── CREWS: one licensed man digs alone ────────────────────────────────────
{
  const sq2 = squads[1];
  const lone = sq2[0];
  lone.xp = Cmd.RANKS[4].xp;
  console.log('\nCREWS?', Cmd.holds(lone, 'CREWS'), lone.rankRec.short);
  for (const t of sq2) if (t.body) t.body.position.set(-400, 0, 0);
  c.digs?.clear();
  d.order('digin', c, 1);
  d._digTick(1, c, 1, sq2);                       // fixes the anchor
  const rec = c.digs.get('1');
  console.log('anchor', rec.x.toFixed(1), rec.z.toFixed(1));
  // everyone off the position except the one man
  for (const t of sq2) if (t.body) t.body.position.set(rec.x + 500, 0, rec.z + 500);
  lone.body.position.set(rec.x, 0, rec.z);
  console.log('lone Commander digging?', d._digTick(1, c, 1, sq2));
  lone.xp = 0;
  console.log('lone trooper digging?', d._digTick(1, c, 1, sq2));
  // and two men with no licence still dig, exactly as before
  sq2[1].body.position.set(rec.x, 0, rec.z);
  sq2[2].body.position.set(rec.x, 0, rec.z);
  console.log('three unlicensed men digging?', d._digTick(1, c, 1, sq2), 'DIG_CREW ok');
}
