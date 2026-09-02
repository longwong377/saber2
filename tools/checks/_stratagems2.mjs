/**
 * ARMOUR and AVOIDANCE — the player's third note, measured. Appended to
 * stratagems.mjs's run.
 *
 *   "lets explore the idea of certain super enemies (like major ones
 *    mechs/monsters etc.) only be able to be killed by certain stratagems,
 *    right now there's not really a reason to ever use all the cool
 *    stratagems we have. Maybe make this a setting you can toggle while we
 *    see if it's a good idea. I assume this is already in the game but your
 *    troops should actively avoid being within the range of an incoming
 *    stratagem after you aimed it (dive out the way etc)."
 */
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const STEP = 1 / 30;

export function armour({ check, assert, bench }) {
  check('armour: with the setting on, the big ones take 15% of a bolt and double from the right call', async () => {
    const { Enemy, STRATAGEM_ONLY, armourClass, armourAnswer } = await import('../../src/game/Enemy.js');
    const { STRATAGEM_BY_ID } = await import('../../src/game/Stratagems.js');
    const { DEFAULT_SETTINGS } = await import('../../src/ui/Menu.js');
    const { SESSION_KEYS } = await import('../../src/net/Net.js');
    assert(DEFAULT_SETTINGS.stratagemOnly === false, 'the rule is on by default — it was asked for as a toggle "while we see"');
    assert(SESSION_KEYS.includes('stratagemOnly'), 'a rule about who can be hurt is not host-authoritative');
    for (const row of STRATAGEM_ONLY.answers) {
      for (const id of row.calls) assert(STRATAGEM_BY_ID[id], `${row.name} is answered by "${id}", which is not a call`);
    }
    const b = bench();
    const walker = new Enemy(b.world, 'walker', V(10, 0, 0));
    const beast = new Enemy(b.world, 'beast', V(20, 0, 0));
    const trooper = new Enemy(b.world, 'trooper', V(30, 0, 0));
    for (const e of [walker, beast, trooper]) { e.position.copy(e.position); b.world.enemies.push(e); e.team = 1; }
    assert(armourClass(walker.A) && armourClass(beast.A) && !armourClass(trooper.A), 'the class is not the roster\'s big/boss/beast');
    const hit = (e, amt, kind, call = null) => {
      const hp0 = e.hp;
      if (kind === 'stratagem') e.applyKnockback(null, amt, b.p, false, 'stratagem', call);
      else e.damage(amt, e.position, b.p, kind);
      const took = hp0 - e.hp; e.hp = hp0; return took;
    };
    /* OFF: everything is what it was. */
    b.world.settings.stratagemOnly = false;
    assert(Math.abs(hit(walker, 100, 'bolt') - 100) < 1e-6, 'with the rule off a bolt is blunted');
    assert(Math.abs(hit(walker, 100, 'stratagem', 'driver') - 100) < 1e-6, 'with the rule off a call is doubled');
    /* ON. */
    b.world.settings.stratagemOnly = true;
    const bolt = hit(walker, 100, 'bolt'), saber = hit(walker, 100, 'saber'), force = hit(walker, 100, 'force');
    assert([bolt, saber, force].every((x) => Math.abs(x - 100 * STRATAGEM_ONLY.other) < 1e-6),
      `a walker took bolt ${bolt}, saber ${saber}, force ${force} of 100 against ${STRATAGEM_ONLY.other}`);
    const driver = hit(walker, 100, 'stratagem', 'driver'), strike = hit(walker, 100, 'stratagem', 'strike');
    const ion = hit(walker, 100, 'stratagem', 'ion'), plain = hit(walker, 100, 'stratagem', null);
    assert(driver === 100 * STRATAGEM_ONLY.best && strike === 100 * STRATAGEM_ONLY.best,
      `the mass driver did ${driver} and the strike ${strike} to a walker — the table says ×${STRATAGEM_ONLY.best}`);
    assert(ion === 100 && plain === 100, `an ion pulse did ${ion} and an unnamed call ${plain} to a walker — full, not doubled`);
    const bomb = hit(beast, 100, 'stratagem', 'bombard'), cluster = hit(beast, 100, 'stratagem', 'cluster');
    const drv = hit(beast, 100, 'stratagem', 'driver');
    assert(bomb === 200 && cluster === 200 && drv === 100,
      `a beast took bombard ${bomb}, cluster ${cluster}, driver ${drv} — bombard and cluster are its answer`);
    assert(armourAnswer(walker.A, 'driver') === STRATAGEM_ONLY.best && armourAnswer(beast.A, 'driver') === 1, 'the table reads back wrong');
    assert(Math.abs(hit(trooper, 40, 'bolt') - 40) < 1e-6, 'a trooper was blunted — the rule is for the big ones');
    /* THE HUD SAYS SO, ONCE. */
    const said = b.hit.filter((h) => h.kind === 'notify' && /ARMOUR/.test(h.title));
    assert(said.length === 1, `the HUD said "ARMOUR" ${said.length} times over several blunted hits — once`);
    assert(/driver|strike/.test(said[0].sub), `the line does not say what to call in: "${said[0].sub}"`);
    return `off: 100/100 · on: bolt ${bolt} saber ${saber} force ${force}; walker ← driver ${driver} strike ${strike} ion ${ion}; `
      + `beast ← bombard ${bomb} cluster ${cluster} driver ${drv}; trooper 40/40; HUD once: "${said[0].title}"`;
  });

  check('avoidance: the line runs out of a marked ring — 0 of N inside at impact, and nobody runs from smoke', async () => {
    const R = await import('../../src/game/Reactions.js');
    const { STRATAGEM_BY_ID } = await import('../../src/game/Stratagems.js');
    const { bootWorld, idleInput } = await import('./_coop.mjs');
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(20260903);
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'theline', level: 'geonosis', order: 'jedi', quality: 'low', instantSpawn: true },
      runSeed: 7,
    });
    const d = world.command;
    d.start(1); d.spawnQueue.length = 0; d.active = false; d.intermission = Infinity; d.onMuster = () => {};
    const input = idleInput();
    for (let i = 0; i < 60; i++) world.update(STEP, input);
    const men = d.roster.living.map((t) => t.body).filter((b) => b && !b.dead);
    assert(men.length >= 6, `only ${men.length} men on the line`);
    const S = world.player.stratagems;
    assert(S, 'the player has no stratagems');
    const centre = men.reduce((v, m) => v.add(m.position), V(0, 0, 0)).multiplyScalar(1 / men.length);
    centre.y = world.terrain.height(centre.x, centre.z);
    const inside = (P) => men.filter((m) => !m.dead && Math.hypot(m.position.x - P.site.x, m.position.z - P.site.z) <= P.radius).length;
    const mark = (s, t) => {
      const P = { s, site: centre.clone(), t, mark: t, lock: null, radius: s.radius, owner: world.player };
      S.pending.push(P);
      return P;
    };
    /* SMOKE FIRST: a safe call. Nobody moves. */
    R.resetReactionStats();
    const smoke = mark(STRATAGEM_BY_ID.smoke, 2.0);
    const n0 = inside(smoke);
    for (let i = 0; i < 60 && S.pending.includes(smoke); i++) world.update(STEP, input);
    assert(R.REACTION_STATS.fled === 0, `${R.REACTION_STATS.fled} men ran from a smoke screen`);
    for (let i = 0; i < 60; i++) world.update(STEP, input);
    /* THE BARRAGE, from four seconds out, on the line. */
    const P = mark(STRATAGEM_BY_ID.barrage, 4.0);
    const N = inside(P);
    assert(N >= men.length * 0.6, `only ${N} of ${men.length} were inside the ring to begin with`);
    let last = N, atImpact = -1, shoutedAt = -1;
    for (let i = 0; i < 30 * 6; i++) {
      world.update(STEP, input);
      if (shoutedAt < 0 && R.REACTION_STATS.shouted > 0) shoutedAt = i * STEP;
      if (S.pending.includes(P)) last = inside(P); else { atImpact = last; break; }
    }
    assert(atImpact >= 0, 'the call never landed');
    assert(atImpact === 0, `${atImpact} of ${N} men were still inside a ${P.radius} m ring when the barrage landed`);
    assert(R.REACTION_STATS.fled >= N, `${R.REACTION_STATS.fled} men ran for ${N} inside the ring`);
    assert(shoutedAt >= 0 && shoutedAt < 1.0, `INCOMING was shouted at ${shoutedAt.toFixed(2)} s`);
    assert(men.some((m) => m._heardAt !== undefined), 'nobody heard the shout');
    return `smoke: ${n0} inside, 0 ran · barrage: ${N} of ${men.length} inside at 4 s, ${atImpact} at impact, `
      + `${R.REACTION_STATS.fled} ran, INCOMING at ${shoutedAt.toFixed(2)} s`;
  });
}
