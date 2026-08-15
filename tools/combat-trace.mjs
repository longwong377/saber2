/**
 * SABER — what a FIGHT contains, as opposed to what a wave does.
 *
 *   node --import ./tools/register.mjs tools/combat-trace.mjs [--waves 8] [--level colosseum]
 *   node --import ./tools/register.mjs tools/combat-trace.mjs --json > combat.json
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `tools/trace.mjs` measures the wave GENERATOR — what a run is offered and
 * what is queued against it. Four independent judges read its output and every
 * one of them ended with the same sentence: it contains no player telemetry, so
 * no amount of analysis of those files can answer "does anyone ever press
 * rend". That is the question the whole ability economy turns on, and it was
 * unmeasurable.
 *
 * This drives the REAL World, with the REAL Player, through the REAL director,
 * and records what the game itself already counts: kills, deflects, health,
 * Force, the seconds a wave takes to clear.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──────────────────────────────────────
 *
 * IT DOES NOT MODEL A PLAYER PRESSING POWERS. It would be easy to write a
 * "kit user" that fires each power the moment it is affordable, and the output
 * would look exactly like a measurement of whether the kit is worth using. It
 * would be a measurement of the script. This session has already produced two
 * findings that were harness artefacts wearing a game defect's clothes, and a
 * fabricated player is the largest available version of that mistake.
 *
 * So the powers are reported as an OPPORTUNITY, not a usage: at each sampled
 * moment, what a power could reach and what it would cost. `push` costs 20 of a
 * 100 pool; how many bodies are inside its radius right now? That is a fact
 * about the game. "The player would have pressed it" is not.
 *
 * The one input this drives is the blade, because a wave that is never fought
 * never clears and the run stops being a run. That is stated rather than
 * hidden: `swings` is in the output, and every number here is "what happens
 * when a player does nothing but swing".
 *
 * ── WHAT THE FIRST RESULTS SAY, AND WHERE THEY STOP ───────────────────────
 *
 * Colosseum, swing-only, stationary, full health each wave:
 *
 *     wave 1   cleared in 16.1 s, 1 kill, 17.5 hp lost
 *     wave 2   died in 17.4 s, 0 kills, 1 deflect
 *     waves 3-8  died in 8-11 s every time
 *
 * Read that as a FLOOR and nothing more. This player never moves — `axis` is
 * pinned at zero — never dodges, never blocks deliberately and never spends a
 * point of Force (the pool never leaves its maximum, which is the proof that
 * no power fired). "Standing still and swinging stops working at wave 2" is a
 * fact about the game and a reasonable one; it is not a difficulty curve.
 *
 * THE LIMITATION THAT MATTERS: because the player dies in nine seconds, the
 * field never fills, so `peakAlive` is 3-4 on waves the composer built for 20+
 * bodies. Everything the opportunity table says about deep waves is therefore
 * about a THIN field, and the honest next step is a player that moves —
 * kiting is what keeps a wave alive long enough to be measured. Until that
 * exists, do not read the wave-8 column as "what wave 8 offers the kit".
 */

import './dom-shim.mjs';
import * as THREE from 'three';

if ((await import('three')) !== THREE) {
  console.error('\n  combat-trace.mjs was started without its module loader.\n\n'
    + '  Run: node --import ./tools/register.mjs tools/combat-trace.mjs\n');
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (n, d) => {
  const eq = args.find((a) => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const has = (n) => args.includes('--' + n);

const WAVES = parseInt(flag('waves', '8'), 10);
const LEVEL = flag('level', 'colosseum');
const SECS = parseFloat(flag('cap', '60'));
const KITE = has('kite');          // seconds of game time per wave

const { initPhysics } = await import('../src/physics/Rapier.js');
const { World } = await import('../src/game/World.js');
const { LEVELS, LEVEL_ORDER } = await import('../src/game/Levels.js');
const { DEFAULT_SETTINGS } = await import('../src/ui/Menu.js');
const { POWER_COST } = await import('../src/game/Powers.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const { seedWaves } = await import('../src/game/Waves.js');

if (!LEVELS[LEVEL]) {
  console.error(`no level "${LEVEL}" — the game lists ${LEVEL_ORDER.join(', ')}`);
  process.exit(2);
}
await initPhysics();

/* ── the smallest engine a World runs on ────────────────────────────────── */

function stubEngine() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 900);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.shadow.camera.updateProjectionMatrix();
  const hemi = new THREE.HemisphereLight(0x88aaff, 0x886644, 1);
  scene.add(sun, hemi);
  return {
    scene, camera, sun, hemi,
    sunDir: new THREE.Vector3(0.4, 0.7, 0.5).normalize(),
    renderer: { info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } } },
    profiler: { begin() {}, end() {}, beginDraw() {}, endDraw() {}, dispose() {} },
    applyAtmosphere() {}, fitShadows() {}, flash() {}, hurt() {}, addHeat() {},
    setFocus() {}, setRadial() {}, setGrain() {}, setBloom() {}, setSense() {},
    setQuality() {}, setResolutionScale() {}, render() {},
  };
}

/**
 * A BLADE BEING SWEPT, and nothing else.
 *
 * There is no attack button in this game. `Player._update` hands the input to
 * `SaberController.applyInput`, which drives the blade off the MOUSE DELTA —
 * you swing by moving the mouse, and `mouse.left` is read by nothing anywhere
 * in the source. The first cut of this file held `left: true` and would have
 * reported a wave of zero kills as if a blade had been swinging through it.
 * What it actually measured was a player standing still while one stalker
 * killed them. Caught before it was believed, which is the only reason this is
 * a comment and not a retraction.
 *
 * The sweep is two frequencies rather than one, so the tip covers an arc
 * instead of retracing a line: a blade that only ever moves left-to-right
 * meets a body at exactly one height. `actHit` stays false for every power —
 * see the note at the top about why this file does not press them.
 */
const swinging = () => ({
  axis: { x: 0, y: 0 },
  frame: 0,
  act: () => false, actHit: () => false, actDown: () => false,
  moveAxis(o) { if (o) { o.x = this.axis.x; o.y = this.axis.y; return o; } return { ...this.axis }; },
  mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
  delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 },
  step() {
    this.frame++;
    this.mouse.dx = 62 * Math.sin(this.frame * 0.41);
    this.mouse.dy = 38 * Math.cos(this.frame * 0.29);
  },
  end() { this.mouse.dx = 0; this.mouse.dy = 0; },
});

/**
 * KEEP YOUR DISTANCE, so that the wave lasts long enough to be looked at.
 *
 * `--kite` only. Standing still, this player dies in nine seconds and the
 * field never fills: `peakAlive` came back 3-4 on waves the composer had built
 * for twenty-plus, so every number about a deep wave was really a number about
 * a thin one. Backing off is the minimum that fixes that, and it is the one
 * thing a human does constantly and this harness did not do at all.
 *
 * It is DELIBERATELY not tactics. It faces the nearest body so the blade
 * sweeps toward something, and walks backwards when that body is closer than
 * `HOLD` metres. There is no dodging, no blocking, no target priority, and
 * still no power ever pressed — this exists to keep a measurement alive, not
 * to play well, and the moment it starts choosing it stops being an instrument
 * and becomes the thing it measures.
 *
 * ── AND IT DID NOT WORK. READ THIS BEFORE USING IT. ───────────────────────
 *
 * The whole point was to let the field fill. Measured on the Colosseum, eight
 * waves, against the stationary run:
 *
 *                   peakAlive        kills        survived
 *     stationary     1, 4, 4, 3…     1 on w1      w1 only
 *     --kite         1 every wave    0 every wave w6 only (timeout)
 *
 * Backing off made the field THINNER, not fatter — one body alive at a time on
 * every wave — and killed the blade's only contact, so the kiting run lands
 * zero kills across eight waves. Whatever keeps the queue flowing, giving
 * ground defeats it: the retreat may be outrunning the spawn cadence, or the
 * bodies may be failing to path after a moving target. That is a real question
 * about the game and it is NOT answered here.
 *
 * So `--kite` is kept, off by default, as the record of an attempt that failed
 * and the starting point for the next one. Do not read it as the better
 * instrument. The stationary run remains the honest floor, and the thin-field
 * caveat at the top of this file still stands unresolved.
 */
const HOLD = 7;
function kite(world, p, input) {
  let near = null, best = Infinity;
  for (const e of world.enemies) {
    if (e.dead || !e.position) continue;
    const d = e.position.distanceToSquared(p.position);
    if (d < best) { best = d; near = e; }
  }
  if (!near) { input.axis.x = 0; input.axis.y = 0; return; }
  // Face it: the sweep is relative to where the camera is pointing.
  p.camera.yaw = Math.atan2(near.position.x - p.position.x, near.position.z - p.position.z) + Math.PI;
  // …and give ground while it is inside the hold, straight back from the facing.
  input.axis.x = 0;
  input.axis.y = Math.sqrt(best) < HOLD ? -1 : 0;
}

/* ── what the kit could reach, right now ────────────────────────────────── */

/**
 * Reach per power, in metres, read off the game where it is a constant and
 * stated here where it is not. Anything this file cannot source honestly is
 * reported as `null` rather than guessed — an unknown reach that becomes a
 * plausible number is exactly the shape of defect this repo keeps finding.
 */
const REACH = {
  push: 9, pull: 14, grip: 12, throw: 22, sense: null,
  lightning: 11, stasis: 10, heal: 0, compel: 16, rend: 10,
};

/** Bodies inside `r` of the player, and the share of the field's threat they carry. */
function reachable(world, p, r) {
  if (!(r > 0)) return { bodies: 0, threat: 0 };
  const r2 = r * r;
  let bodies = 0, threat = 0;
  for (const e of world.enemies) {
    if (e.dead || !e.position) continue;
    if (e.position.distanceToSquared(p.position) <= r2) {
      bodies++;
      threat += ARCHETYPES[e.type]?.threat ?? e.A?.threat ?? 0;
    }
  }
  return { bodies, threat };
}

/* ── drive it ───────────────────────────────────────────────────────────── */

seedWaves(4242);
const engine = stubEngine();
const world = new World(engine, { ...DEFAULT_SETTINGS, quality: 'low' });
await world.loadLevel(LEVEL);
world.spawnPlayer();
let p = world.player;
const input = swinging();

const rows = [];
for (let w = 1; w <= WAVES; w++) {
  p = world.player;
  world.director.start(w);
  const t0 = world.time;
  const hp0 = p.hp, kills0 = p.kills, defl0 = p.deflects;
  let peakAlive = 0, forceMin = p.force, swings = 0;
  const opportunity = {};   // power -> peak bodies reachable during the wave

  const frames = Math.round(SECS * 60);
  let f = 0;
  for (; f < frames; f++) {
    input.step();
    if (KITE) kite(world, p, input);
    world.update(1 / 60, input);
    swings++;
    peakAlive = Math.max(peakAlive, world.enemies.filter((e) => !e.dead).length);
    forceMin = Math.min(forceMin, p.force);
    if (f % 30 === 0) {
      for (const [k, r] of Object.entries(REACH)) {
        if (r === null) continue;
        const got = reachable(world, p, r);
        const cur = opportunity[k] ?? { bodies: 0, threat: 0 };
        if (got.bodies > cur.bodies) opportunity[k] = got;
      }
    }
    if (!p.alive) break;
    if (world.director.remaining === 0 && !world.enemies.some((e) => !e.dead)) break;
  }

  const cleared = p.alive && !world.enemies.some((e) => !e.dead);
  rows.push({
    wave: w,
    cleared,
    died: !p.alive,
    seconds: +(world.time - t0).toFixed(1),
    timedOut: f >= frames - 1,
    peakAlive,
    kills: p.kills - kills0,
    deflects: p.deflects - defl0,
    hpLost: +(hp0 - p.hp).toFixed(1),
    forceMin: Math.round(forceMin),
    swings,
    opportunity,
  });
  /* BACK ON YOUR FEET FOR THE NEXT WAVE, which is not what a run does.
   *
   * A real run ends at the first death, and a swing-only stationary player dies
   * early — wave 2 of the Colosseum. Stopping there would measure one wave and
   * report nothing about the eighteen after it, so each wave is a fresh fight
   * from full health rather than a continuation. Every row is therefore "what
   * this wave does to a full-health player who only swings", which is a floor
   * on the difficulty of that wave and not a statement about run survival. */
  if (!p.alive) {
    // A fresh body rather than resurrecting the old one: `dead` is a getter off
    // hp, and Player owns what being alive means. Let it say so.
    p.dispose(); world.players.length = 0; world.player = null;
    world.spawnPlayer();
  }
  const cur = world.player; cur.hp = cur.maxHp; cur.force = cur.maxForce; cur.invuln = 0;
}

const out = {
  level: LEVEL, waves: WAVES, capSeconds: SECS,
  powers: Object.fromEntries(Object.entries(POWER_COST).map(([k, c]) => [k, { force: c, reach: REACH[k] }])),
  run: rows,
};

if (has('json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`\nSABER — combat trace: ${LEVEL}, ${WAVES} waves, ${KITE ? 'swing + give ground' : 'swing-only, stationary'}\n`);
  console.log('  WAVE  CLEARED  SECS   PEAK  KILLS  DEFL  HP LOST  FORCE MIN');
  for (const r of rows) {
    console.log('  ' + pad(r.wave, 6) + pad(r.died ? 'DIED' : r.timedOut ? 'timeout' : 'yes', 9)
      + pad(r.seconds, 7) + pad(r.peakAlive, 6) + pad(r.kills, 7) + pad(r.deflects, 6)
      + pad(r.hpLost, 9) + r.forceMin);
  }
  console.log('\n  WHAT THE KIT COULD REACH (peak bodies inside each power\'s radius)');
  console.log('  power       force  reach   ' + rows.map((r) => 'w' + r.wave).join('  '));
  for (const [k, c] of Object.entries(POWER_COST)) {
    const r = REACH[k];
    const cells = rows.map((row) => String(row.opportunity[k]?.bodies ?? (r === null ? '?' : 0)).padStart(2)).join('  ');
    console.log('  ' + pad(k, 12) + pad(c, 7) + pad(r === null ? '—' : r + ' m', 8) + cells);
  }
  console.log('');
}
