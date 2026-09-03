/**
 * THE TWELVE VERBS, DRIVEN. One wheel slot means twelve things, and every one
 * of them is given here on a real body in a real world and the thing it
 * PROMISES is measured — because an order that is accepted and does nothing is
 * worse than one that is refused, which is the line `tools/_cmporders.mjs`
 * opens with and the exact state this slot was in before this lane.
 *
 * SIX OF THE TWELVE KINDS HAVE NO BODY YET (b1c, wook, hawk, astro, medic,
 * varac — another lane is building them), so those verbs are given to a body
 * that DOES exist with the kind set on it. `_cmpKind` is the row the wheel and
 * the work table both join on and nothing else about a kind reaches the verb;
 * `tools/checks/companions.mjs` already drives a kind that way. What is
 * measured is the VERB. The shape of the animal wearing it is another lane.
 */
import './dom-shim.mjs';
import * as THREE from 'three';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const C = await import('../src/game/Companions.js');
const K = await import('../src/game/CompanionKinds.js');
const { ARCHETYPES } = await import('../src/game/Enemy.js');
const { ORDER_REACH } = await import('../src/game/Command.js');
const { makeCrate } = await import('../src/world/Props.js');

const STEP = 1 / 30;
const idle = idleInput();
const say = (n, ok, d) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n.padEnd(28)} ${d}`);

async function stage(settings = {}) {
  const { world } = await bootWorld({
    level: 'geonosis',
    settings: { mode: 'waves', level: 'geonosis', allies: 0, quality: 'low', ...settings },
    runSeed: 21,
  });
  const p = world.player;
  for (let i = 0; i < 30; i++) world.update(STEP, idle);
  const run = (n, each) => {
    for (let i = 0; i < n; i++) { p.hp = p.maxHp ?? 100; world.update(STEP, idle); each?.(i); }
  };
  const put = (ang, r, type = 'b1', from = p.position) => {
    const x = from.x + Math.sin(ang) * r, z = from.z + Math.cos(ang) * r;
    const f = world.spawnEnemy(type, new THREE.Vector3(x, world.terrain.height(x, z), z));
    if (f) f.team = 1;
    return f;
  };
  const clear = () => {
    for (const e of world.enemies) {
      if (!e.dead && !e.companion && e.team !== (p.team ?? 0)) e.damage(e.hp + 999, e.position, null, 'bolt');
    }
  };
  /** A companion wearing `kind` — its own body if the kind has one, a massiff's
   *  if it does not. Sworn, so every slot is licensed. */
  const field = (kind) => {
    const A = ARCHETYPES[K.COMPANION_KINDS[kind]?.archetype];
    const e = C.fieldCompanion(world, p, A ? kind : 'massiff', { rec: { xp: 99, runs: 3, tempers: [] } });
    if (e) e._cmpKind = kind;
    return e;
  };
  /**
   * WALK THE PAIR OF THEM SOMEWHERE, and never teleport.
   *
   * `Destruction._impactScan` bills `0.5 m v²` to any structure a body with
   * mass arrives at above `impactSpeed` (7.5 m/s), and a body set 30 m in one
   * frame arrives at 900. Measured with a straight `position.set`: the nearest
   * revetment went from 70 hp to −1 944 509 and `collapsed` on the frame the
   * fixture moved the player next to it, BEFORE any order was given — so every
   * WRECK number taken that way was a measurement of the teleport.
   */
  const walkTo = (e, at, back = 6, frames = 90) => {
    const T = world.terrain;
    const s0 = p.position.clone();
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const x = s0.x + (at.x + back - s0.x) * t, z = s0.z + (at.z - s0.z) * t;
      p.position.set(x, T.height(x, z) + 0.05, z);
      p.velocity.set(0, 0, 0);
      if (e) {
        const ex = x - 1.2;
        e.position.set(ex, T.height(ex, z), z);
        e.velocity.set(0, 0, 0);
        if (e.body) { e.body.position.copy(e.position); e.body.velocity.set(0, 0, 0); }
      }
      p.hp = p.maxHp ?? 100;
      world.update(STEP, idle);
    }
  };
  return { world, p, run, put, clear, field, walkTo };
}

/* ══ the shared field: everything that does not need its own world ══════ */
const S = await stage();
const { world, p, run, put, clear, field, walkTo } = S;
/* The open ground the fixture starts on. WRECK, BREACH and SLICE walk the pair
 * of them to a wall, and a medic asked to cross seven metres of blast door is a
 * medic measured against architecture. */
const OPEN = p.position.clone();

/* ── BLOCK: hits taken by the animal instead of by you ────────────────── */
{
  const dog = field('massiff');
  const foe = put(0, 9);
  C.orderCompanion(dog, 'verb', null);
  run(30 * 4);
  const gap = dog.position.distanceTo(p.position);
  const off = Math.acos(Math.min(1, dog.position.clone().sub(p.position).setY(0).normalize()
    .dot(foe.position.clone().sub(p.position).setY(0).normalize()))) * 57.3;
  /* A frame between blows, because `Player.damage` opens an `invuln` window
   * and ten calls inside one frame measure the window rather than the guard. */
  const volley = (from, n = 6) => {
    let onYou = 0, onIt = 0;
    for (let i = 0; i < n; i++) {
      const h0 = p.hp, d0 = dog.hp;
      p.damage(9, p.position, from, 'bolt');
      onYou += Math.max(0, h0 - p.hp);
      onIt += Math.max(0, d0 - dog.hp);
      p.hp = p.maxHp ?? 100;
      world.update(STEP, idle);
    }
    return { onYou, onIt };
  };
  const front = volley(foe);
  say('BLOCK eats what is aimed at you', front.onIt > 0 && front.onYou === 0,
    `${front.onIt.toFixed(0)} hp onto the animal, ${front.onYou.toFixed(0)} onto you; it stands `
    + `${gap.toFixed(1)} m off you, ${off.toFixed(0)}° off the line to what it is blocking`);
  /* …AND ONLY INSIDE THE CONE. A shooter behind you is still your problem. */
  const back = put(Math.PI, 9);
  const rear = volley(back);
  say('BLOCK is a cone, not a shield', rear.onYou > 0 && rear.onIt === 0,
    `from behind: ${rear.onYou.toFixed(0)} onto you, ${rear.onIt.toFixed(0)} onto it`);
  C.orderCompanion(dog, 'heel');
  const lifted = volley(foe);
  say('and it stops when you lift it', lifted.onYou > 0 && lifted.onIt === 0,
    `${lifted.onYou.toFixed(0)} hp back onto you, ${lifted.onIt.toFixed(0)} onto it`);
  dog.damage(dog.hp + 999, dog.position, null, 'bolt');
  clear();
  run(30);
}

/* ── CRY: every hostile inside 25 m looks at the cat ──────────────────── */
{
  const cat = field('tooka');
  const all = [];
  for (let k = 0; k < 4; k++) all.push(put(k * 1.57, 8));
  for (let k = 0; k < 2; k++) all.push(put(k * 3.14, 48));
  run(30 * 2);
  const live = all.filter((f) => !f.dead);
  /* THE RING IS MEASURED FROM THE CAT AND AT THE MOMENT OF THE SHOUT, not
   * from where the fixture put anything: B1s walk, and a hostile placed at
   * 34 m was inside 25 by the time the order was given. */
  const inside = live.filter((f) => f.position.distanceTo(cat.position) <= C.CRY.ring);
  const outside = live.filter((f) => f.position.distanceTo(cat.position) > C.CRY.ring);
  const before = inside.filter((f) => f.target === cat).length;
  C.orderCompanion(cat, 'verb', null);
  const pulled = inside.filter((f) => f.compelled?.target === cat).length;
  const spared = outside.filter((f) => f.compelled?.target === cat).length;
  /* ONE FRAME, and not one second: four B1s at 8 m put 27 damage a burst into
   * a 24 hp animal, so a second later the thing they were looking at is a
   * corpse and `compelled` has cleared itself on `target.dead`. That is the
   * design — "bait it will probably not survive" — and it is why the pull is
   * read on the first frame the brain runs after the shout. */
  run(1);
  const looking = inside.filter((f) => f.target === cat).length;
  say('CRY pulls them onto itself', pulled === inside.length && spared === 0 && looking > before,
    `${pulled}/${inside.length} inside ${C.CRY.ring} m compelled and ${spared}/${outside.length} outside it; `
    + `${before} → ${looking} of them looking at the cat on the next frame`);
  run(30 * 4);
  const held = live.filter((f) => !f.dead && f.compelled).length;
  say('and it lasts three seconds', held === 0,
    `${(C.CRY.hold + 1).toFixed(0)} s later: ${held} still compelled, and the cat `
    + `${cat.dead ? 'did not survive being used' : 'lived'}`);
  say('CRY is a shout, not a posture', !cat._cmpDuty, `duty after the order: ${cat._cmpDuty?.id ?? 'none'}`);
  cat.damage(cat.hp + 999, cat.position, null, 'bolt');
  clear();
  run(30);
}

/* ── FLUSH: a body knocked flat, not killed ───────────────────────────── */
{
  const whelp = field('tuk');
  const foe = put(0.6, 7);
  run(30);
  const hp0 = foe.hp;
  const why = C.orderCompanion(whelp, 'verb', foe);
  let flat = false, at = -1;
  for (let i = 0; i < 30 * 14 && !flat; i++) {
    p.hp = p.maxHp ?? 100; world.update(STEP, idle);
    if (foe.actor?.ragdolled || foe._flatten) { flat = true; at = i / 30; }
  }
  say('FLUSH knocks it flat', !why && flat,
    `${why || `on its back at ${at.toFixed(1)} s, ${(hp0 - foe.hp).toFixed(0)} hp taken by the flush and the bite together`}`);
  say('and the order ends itself', !whelp._cmpDuty, `duty after: ${whelp._cmpDuty?.id ?? 'none'}`);
  whelp.damage(whelp.hp + 999, whelp.position, null, 'bolt');
  clear();
  run(30);
}

/* ── WRECK: the cover goes, through the path that already breaks cover ── */
{
  const pup = field('pup');
  run(30);
  /* A CRATE BESIDE IT — "a scaled slam that shatters the crate a shooter is
   * behind", in the design's own words, and the `Prop` half of `coverAt`. */
  const spot = pup.position.clone().add(new THREE.Vector3(3.2, 0, 0));
  spot.y = world.terrain.height(spot.x, spot.z);
  const crate = makeCrate(world, spot.clone(), 0.9, { exactSize: true });
  world.addProp ? world.addProp(crate) : world.props.push(crate);
  run(30);
  const at = (crate.body?.position || crate.mesh.position).clone();
  const hp0 = crate.hp;
  const why = C.orderCompanion(pup, 'verb', at);
  let broke = -1;
  for (let i = 0; i < 30 * 14 && broke < 0; i++) {
    p.hp = p.maxHp ?? 100; world.update(STEP, idle);
    if (crate.dead || crate.hp <= 0) broke = i / 30;
  }
  say('WRECK puts the cover through the floor', !why && broke >= 0,
    `${why || `${hp0.toFixed(0)} hp of crate gone in ${pup._cmpWrecked || 0} slams at `
      + `${broke.toFixed(1)} s — and the pup's own damage is ${pup.A.damage}`}`);
  const nowhere = C.orderCompanion(pup, 'verb', new THREE.Vector3(at.x + 400, at.y, at.z + 400));
  say('and nothing to wreck is refused', !!nowhere, `"${nowhere}"`);
  pup.damage(pup.hp + 999, pup.position, null, 'bolt');
  run(30);
}

/* ── BREACH: a piece of the building, all of it at once ──────────────── */
{
  const wook = field('wook');
  const cover = [...(world.destruction?.structures || [])]
    .filter((s) => s.state !== 'gone' && s.state !== 'collapsed')
    .sort((a, b) => a.centre.distanceTo(p.position) - b.centre.distanceTo(p.position))[0];
  const at = cover.centre.clone();
  walkTo(wook, at, 5);
  const hp0 = cover.hp, state0 = cover.state;
  const why = C.orderCompanion(wook, 'verb', at);
  let down = -1;
  for (let i = 0; i < 30 * 14 && down < 0; i++) {
    p.hp = p.maxHp ?? 100; world.update(STEP, idle);
    if (cover.state === 'collapsed' || cover.state === 'gone') down = i / 30;
  }
  say('BREACH rips it apart', !why && down >= 0 && wook._cmpBreached,
    `${why || `"${state0}" (${hp0.toFixed(0)} hp) → "${cover.state}" at ${down.toFixed(1)} s, `
      + `every cell detached at once`}`);
  wook.damage(wook.hp + 999, wook.position, null, 'bolt');
  run(30);
}

/* ── SPOT: every hostile within 60 m painted, for 8 s ─────────────────── */
{
  const hawk = field('hawk');
  for (let k = 0; k < 5; k++) put(k * 1.25, 18 + k * 7);
  put(0.4, 85);
  run(30);
  /* ONLY THE VERB'S OWN MARKS. `notifyFloating` is a shared path — PARRY,
   * PATCHED UP and the companion's own "that was you" all ride it — so a
   * count of everything that floated measures the fight and not the reading;
   * the first cut of this read a stray mark at 9.1 s and called an 8 s window
   * long. */
  let painted = 0;
  world.onFloating = (pos, text, colour) => { if (colour === '#a8f0ff' && hawk._cmpDuty) painted++; };
  const why = C.orderCompanion(hawk, 'verb', null);
  /* THE TRUTH IS COUNTED ON THE FRAME THE BEAT LANDS, because bodies walk: a
   * count taken a second later is a count of a different field. */
  /* CLOCKED ON `world.time` AND NOT ON FRAMES. `World.update` scales its own
   * dt by `timeScale * focus.scale` before anything downstream sees it — a
   * Force focus is a slow-motion — so 240 fixture frames are not eight
   * seconds of game time when the animals are fighting. Measured on frames the
   * 8 s reading read as 9.6; the verb's clock was right and the ruler was not,
   * and every other clock in the game (`stateTime`, `bleed`, `compelled.t`)
   * is on this same scaled second. */
  const t0 = world.time;
  let beats = 0, agreed = 0, lastT = 0, over = 0;
  for (let i = 0; i < 30 * 12; i++) {
    const was = painted;
    p.hp = p.maxHp ?? 100; world.update(STEP, idle);
    if (painted === was) continue;
    beats++;
    lastT = world.time - t0;
    const truth = world.enemies.filter((f) => !f.dead && !f.downed && !f.companion
      && f.team !== (p.team ?? 0) && f.position.distanceTo(p.position) <= C.SPOT.ring).length;
    const beyond = world.enemies.filter((f) => !f.dead && !f.companion
      && f.team !== (p.team ?? 0) && f.position.distanceTo(p.position) > C.SPOT.ring).length;
    if (hawk._cmpSpotted === truth) agreed++;
    over += beyond;
  }
  world.onFloating = null;
  say('SPOT paints what is inside 60 m', !why && beats > 0 && agreed === beats,
    `${agreed}/${beats} beats painted exactly the hostiles inside ${C.SPOT.ring} m `
    + `(${painted} marks through the HUD's own floating path); ${over} body-beats sat outside it and none were painted`);
  say('and the reading ends at eight seconds', lastT <= C.SPOT.hold && !hawk._cmpDuty,
    `last mark at ${lastT.toFixed(1)} s of world time against a ${C.SPOT.hold} s reading; `
    + `duty after: ${hawk._cmpDuty?.id ?? 'none'}`);
  hawk.damage(hawk.hp + 999, hawk.position, null, 'bolt');
  clear();
  run(30);
}

/* ── SLICE: a door that was shut is open ──────────────────────────────── */
{
  const astro = field('astro');
  const door = (world.doors || []).find((d) => !d.opened);
  const at = door.mesh.position.clone();
  walkTo(astro, at, 4.5);
  const why = C.orderCompanion(astro, 'verb', at);
  let opened = -1;
  for (let i = 0; i < 30 * 30 && opened < 0; i++) {
    p.hp = p.maxHp ?? 100; world.update(STEP, idle);
    if (door.opened) opened = i / 30;
  }
  say('SLICE turns the door', !why && door.opened,
    `${why || `open at ${opened.toFixed(1)} s against ${C.SLICE.work} s at the panel, and the `
      + `collider is ${door.collider?.disabled ? 'gone' : 'still there'} — the same breach `
      + `twenty seconds of held blade buys`}`);
  const nothing = C.orderCompanion(astro, 'verb', new THREE.Vector3(at.x + 300, at.y, at.z));
  say('and nothing to turn is refused', !!nothing, `"${nothing}"`);
  astro.damage(astro.hp + 999, astro.position, null, 'bolt');
  run(30);
}

/* ── TEND: the bleed-out clock is worked ──────────────────────────────── */
{
  const medic = field('medic');
  walkTo(medic, OPEN, 0);
  const mate = world.spawnEnemy('b1', new THREE.Vector3(
    p.position.x + 7, world.terrain.height(p.position.x + 7, p.position.z), p.position.z));
  mate.team = p.team ?? 0;
  mate.downed = true; mate.bleed = 14; mate.hp = 0; mate._downHelp = 0;
  medic.position.set(p.position.x + 1, p.position.y, p.position.z);
  const why = C.orderCompanion(medic, 'verb', mate);
  let up = -1, closest = 99;
  for (let i = 0; i < 30 * 16 && up < 0; i++) {
    p.hp = p.maxHp ?? 100; world.update(STEP, idle);
    closest = Math.min(closest, medic.position.distanceTo(mate.position));
    if (!mate.downed && !mate.dead) up = i / 30;
  }
  say('TEND works the bleed-out clock', !why && up >= 0,
    `${why || `on his feet at ${up.toFixed(1)} s with ${mate.hp.toFixed(0)} hp; the droid knelt at ${closest.toFixed(2)} m`}`);
  const well = world.spawnEnemy('b1', new THREE.Vector3(
    p.position.x + 3, world.terrain.height(p.position.x + 3, p.position.z), p.position.z));
  well.team = p.team ?? 0;
  const no = C.orderCompanion(medic, 'verb', well);
  say('and a man with nothing wrong is refused', !!no, `"${no}"`);
  medic.damage(medic.hp + 999, medic.position, null, 'bolt');
  mate.damage(9999, mate.position, null, 'bolt');
  well.damage(9999, well.position, null, 'bolt');
  clear();
  run(30);
}

/* ── BOLT: a straight run that takes their eyes with it ───────────────── */
{
  const taun = field('taun');
  const foes = [];
  for (let k = 0; k < 4; k++) foes.push(put(k * 1.57, 10));
  run(30 * 4);
  const onYou = foes.filter((f) => !f.dead && f.target === p).length;
  const from = taun.position.clone();
  const why = C.orderCompanion(taun, 'verb', null);
  const heading = taun._cmpPoint.clone().sub(from).setY(0).normalize();
  const drew = foes.filter((f) => f.compelled?.target === taun).length;
  let path = 0;
  const prev = taun.position.clone();
  run(30 * 6, () => { path += taun.position.distanceTo(prev); prev.copy(taun.position); });
  const went = taun.position.clone().sub(from).setY(0);
  const straight = went.length();
  const along = straight > 0.01 ? went.clone().normalize().dot(heading) : 0;
  say('BOLT draws their eyes off you', drew > 0 && drew === onYou,
    `${onYou} of them were looking at you; ${drew} switched to it`);
  say('and it runs, in one direction', straight > 8 && along > 0.9,
    `${straight.toFixed(1)} m of ground in ${(straight / Math.max(0.01, path) * 100).toFixed(0)}% `
    + `of the metres it walked, ${(Math.acos(Math.min(1, along)) * 57.3).toFixed(0)}° off the heading `
    + `it chose at the order — and it took no target at all on the way`);
  say('and it comes back afterwards', !taun._cmpDuty,
    `duty ${C.BOLT.run} s after the order: ${taun._cmpDuty?.id ?? 'none'}`);
  taun.damage(taun.hp + 999, taun.position, null, 'bolt');
  clear();
  run(30);
}

/* ── CHARGE: it bites what closes, and only that ──────────────────────── */
{
  const blurrg = field('blurrg');
  C.orderCompanion(blurrg, 'verb', null);
  const far = put(0, 9);
  let onFar = 0;
  run(30 * 5, () => { if (blurrg.target === far) onFar++; });
  const close = put(0.2, 2.2, 'b1', blurrg.position);
  const hp0 = close.hp;
  let onClose = 0;
  run(30 * 8, () => { if (blurrg.target === close) onClose++; });
  say('CHARGE bites what closes on you', onClose > 0 && close.hp < hp0,
    `${(hp0 - close.hp).toFixed(0)} hp off the one at 2 m over ${onClose} frames on it`);
  say('and ignores what has not closed', onFar === 0,
    `${onFar} frames on the one at 9 m — a mount does not leave the ground you are standing on`);
  blurrg.damage(blurrg.hp + 999, blurrg.position, null, 'bolt');
  clear();
  run(30);
}

/* ── CLIMB: a grade the player's own controller refuses ───────────────── */
{
  const varac = field('varac');
  const T = world.terrain;
  /* Find a face `Terrain.blockClimb` — the ONE thing in the game that refuses a
   * slope, and it is the player's alone — actually pushes a body off. */
  let face = null, foot = null;
  for (let i = 0; i < 6000 && !face; i++) {
    const a = i * 0.37, r = 12 + (i % 90);
    const x = p.position.x + Math.cos(a) * r, z = p.position.z + Math.sin(a) * r;
    if (!T.inBounds(x, z, 8)) continue;
    const h = T.height(x, z);
    if (!T.blockClimb(new THREE.Vector3(x, h - 0.35, z), null)) continue;
    /* AND THE APPROACH HAS TO BE FROM BELOW. A refused face has an uphill side
     * and a downhill one, and standing the animal on whichever side happened
     * to face the player measured a walk DOWN a hill (−0.36 m) on the run
     * where the search landed on the far side. The foot is stepped seven
     * metres down the gradient and the drop has to be real. */
    const e0 = T.step || 0.5;
    const gx = (T.height(x + e0, z) - T.height(x - e0, z)) / (2 * e0);
    const gz = (T.height(x, z + e0) - T.height(x, z - e0)) / (2 * e0);
    const g = Math.hypot(gx, gz);
    if (g < 1e-3) continue;
    const bx = x - (gx / g) * 7, bz = z - (gz / g) * 7;
    if (!T.inBounds(bx, bz, 8)) continue;
    const bh = T.height(bx, bz);
    if (h - bh < 2.5) continue;
    /* AND THE GROUND BETWEEN THE TWO HAS TO GO UP ALL THE WAY. The first
     * face this found had a hollow at its foot: the animal walked five metres
     * toward it, fell four into the dip and finished 1.7 m from the point in
     * plan and 7.4 m under it. A climb needs a RAMP of the refused steepness,
     * not a cliff with a hole at the bottom. */
    let ramp = true, prev = bh;
    for (let k = 1; k <= 8 && ramp; k++) {
      const t = k / 8;
      const hk = T.height(bx + (x - bx) * t, bz + (z - bz) * t);
      if (hk < prev - 0.2) ramp = false;
      prev = hk;
    }
    if (!ramp) continue;
    face = new THREE.Vector3(x, h, z);
    foot = new THREE.Vector3(bx, bh, bz);
  }
  if (!face) { say('CLIMB', false, 'no face on this level that the player is refused'); }
  else {
    const start = face.clone();
    varac.position.copy(foot);
    p.position.set(foot.x, foot.y + 0.05, foot.z);
    varac.A = { ...varac.A, grade: 0.3 };
    const y0 = varac.position.y;
    const why = C.orderCompanion(varac, 'verb', face);
    const lifted = varac.A.grade;
    /* THE PEAK AND NOT THE END. CLIMB finishes when the animal arrives, and
     * the ordinary heel then walks it back DOWN to an owner standing at the
     * bottom — measured at the end of a twelve-second run, −4.38 m, which is
     * the order having worked and then been over. The claim is that it got up
     * there on ground the player is pushed off. */
    let peak = 0;
    run(30 * 12, () => { peak = Math.max(peak, varac.position.y - y0); });
    say('CLIMB takes the refused grade', !why && lifted === 1 && peak > 0.5,
      `${why || `grade 0.30 → ${lifted} while the order stands; it got ${peak.toFixed(2)} m up a face `
        + `blockClimb pushes the player off (slope ${(1 - normalY(T, start)).toFixed(2)}), then heeled `
        + 'back down to its owner at the bottom'}`);
    C.orderCompanion(varac, 'heel');
    say('and the ceiling goes back', varac.A.grade === 0.3, `grade after the order: ${varac.A.grade}`);
  }
  varac.damage(varac.hp + 999, varac.position, null, 'bolt');
  run(30);
}

function normalY(T, at) {
  const n = new THREE.Vector3();
  T.normalAt(at.x, at.z, n);
  return n.y;
}

/* ── RELAY: a squad that could not hear you takes the order ───────────── */
{
  /* THE ONE VERB THAT NEEDS AN ARMY, so it gets its own world — nine of the
   * eleven modes build no CommandDirector at all and the shared field above is
   * one of them. `command.start(1)` is what puts bodies under the roster;
   * without it `led()` returns ten records and ten null bodies. */
  const S2 = await stage({ mode: 'command', order: 'jedi', allies: 8, quality: undefined });
  S2.world.command?.start?.(1);
  S2.run(30 * 8);
  const d = S2.world.command;
  const c = d.commander;
  const squads = d.squadsOf(c);
  const away = squads.findIndex((sq) => sq.filter((t) => t.body && !t.body.dead).length >= 2);
  const men = squads[away].filter((t) => t.body && !t.body.dead);
  /* THE WHOLE SQUAD WALKED OFF, which is the case the reach rule exists for:
   * ORDER_REACH is 34 m and this puts them at ninety. */
  for (let i = 0; i < men.length; i++) {
    const x = S2.p.position.x + 90 + i * 1.5, z = S2.p.position.z + i * 1.5;
    men[i].body.position.set(x, S2.world.terrain.height(x, z), z);
  }
  S2.run(15);
  const want = d.formation;
  const deaf = men[0];
  const gap = deaf.body.position.distanceTo(S2.p.position);
  /* A: FROM YOUR OWN MOUTH. Refused, and the refusal is a distance. */
  const mine = d.order(want, c, away);
  const whyNot = d.orderRefused;
  const b1 = S2.field('b1c');
  b1.position.copy(S2.p.position);
  const why = C.orderCompanion(b1, 'verb', deaf.body);
  let took = 0;
  for (let i = 0; i < 30 * 90 && b1._cmpRelayed === undefined; i++) {
    S2.p.hp = S2.p.maxHp ?? 100;
    S2.world.update(STEP, idle);
    took = i / 30;
  }
  /* B: FROM THE DROID'S. The same order, the same squad, from a body standing
   * where your voice does not reach. */
  say('RELAY carries it past your voice', !why && mine === false && b1._cmpRelayed === true,
    `${why || `${men.length} men at ${gap.toFixed(0)} m of a ${ORDER_REACH} m reach: your own `
      + `"${want}" was refused (${whyNot}); the droid crossed in ${took.toFixed(0)} s and `
      + `${b1._cmpRelayed ? 'they took it' : 'did not deliver'}`}`);
  say('and it stops being an errand', !b1._cmpDuty, `duty after: ${b1._cmpDuty?.id ?? 'none'}`);
  S2.world.unload();
}

/* ── AND A VERB WITH NOTHING TO DO IS REFUSED IN A SENTENCE ───────────── */
{
  const b1 = field('b1c');
  const no = C.orderCompanion(b1, 'verb', p);
  say('RELAY with no army is refused', !!no, `"${no}"`);
  b1.damage(b1.hp + 999, b1.position, null, 'bolt');
}

world.unload();
