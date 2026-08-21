/* Probe: the watchdog check's own scenario — cover, a commander who keeps
 * walking, 90 s — with the commander's survival as the ONE variable. */
import './dom-shim.mjs';
import * as THREE from 'three';
if ((await import('three')) !== THREE) { console.error('needs --import ./tools/register.mjs'); process.exit(2); }

const ALIVE = !!process.env.HOLD_ALIVE;
const SECONDS = +(process.argv[2] || 90);
const Cmd = await import('../src/game/Command.js');
const H = await import('./checks/_coop.mjs');
const { world } = await H.bootWorld({ level: 'geonosis',
  settings: { mode: 'command', level: 'geonosis', order: 'jedi' } });
const d = world.command;
d.order('cover');
world.director.start(1);
const input = H.idleInput();
input.moveAxis = (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; };
const STEP = 1 / 30;
const mine = new Set(d.army.tiers.map((t) => t.type));
let overAt = -1;
for (let i = 0; i < Math.round(SECONDS / STEP); i++) {
  if (ALIVE && world.player) world.player.hp = world.player.maxHp;
  world.player.camera.yaw += 0.055 * STEP;
  world.update(STEP, input);
  if (world.over && overAt < 0) overAt = i * STEP;
  if (i % 300 === 0) {
    const log = d.rescues || [];
    console.log(`  t=${(i * STEP).toFixed(0)}s fallen=${d.roster.fallen.length} living=${d.roster.living.length} `
      + `rescuesOnMine=${log.filter((r) => mine.has(r.type)).length} rescuesTotal=${log.length} over=${!!world.over} hp=${world.player.hp.toFixed(0)}`);
  }
}
const log = d.rescues || [];
const onMine = log.filter((r) => mine.has(r.type));
let away = 0;
for (const t of d.roster.living) {
  const e = t.body; if (!e || e.dead) continue;
  away = Math.max(away, Math.hypot(e.position.x - world.player.position.x, e.position.z - world.player.position.z));
}
console.log(`HOLD_ALIVE=${ALIVE} overAt=${overAt.toFixed(1)} fallen=${d.roster.fallen.length}/${Cmd.OPENING_STRENGTH} `
  + `onMine=${onMine.length} (${onMine.map((r) => r.what).join(',')}) total=${log.length} away=${away.toFixed(0)}`);
world.unload();
