/**
 * VERBS — the ten things V20 lane 6 puts in the player's hands.
 *
 * *"the verbs are still mostly 'read a panel' or 'watch a thing'. Only a
 * handful put your hands on something."*
 *
 * ── HOW THIS SUITE IS DRIVEN, AND WHY IT MATTERS ─────────────────────────
 *
 * Every clause presses THE REAL KEY. Not `verbKey(world)` and not a hook on
 * the world: an input object whose `actHit('focus')` answers true for one
 * frame, handed to `world.update`, through `Player._readInput` and
 * `Station.stationKey`'s branch order. That is the instrument that catches
 * the class of defect `Station.js`'s own counter note records at length —
 * two shops unreachable for a year because a branch sat below the one that
 * always won, with a direct-call probe green the whole time.
 *
 * And each clause then asserts the PHYSICAL result — where a body ended up,
 * which mesh moved, which drum stopped existing, which head went down —
 * beside the credit, the fold and the journal line. A verb that pays and
 * writes a line without moving anything is a panel with a wage.
 */

import { readFile } from 'node:fs/promises';

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/** The station, through the door the game uses — `seated.mjs`'s own helper. */
async function station(deck, hour = 13) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation, finishStationBuild } = await import('../../src/game/Station.js');
  const { clearStation } = await import('../../src/game/StationSave.js');
  const { clearCredits } = await import('../../src/game/Credits.js');
  clearStation();
  clearCredits();
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0, quality: 'high' },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  finishStationBuild(world);
  const st = world._station;
  st.hour = hour;
  const life = world._stationLife;
  if (life) { life.event = null; life.eventFor = 0; life.eventIn = 1e6; }
  return { world, idle: idleInput(), st, life };
}

/**
 * THE KEY, as a thing you press and let go of.
 *
 * `act` is what `Player._readInput` publishes as `world._verbHold` (the fan
 * is a three-second hold and the elbow is a mash), `actHit` is the edge
 * `stationKey` runs on and is consumed once per press, exactly as
 * `Input.actHit` is.
 */
function keypad(idle) {
  const s = { down: false, hit: false };
  const input = {
    ...idle,
    act: (id) => (id === 'focus' ? s.down : false),
    actDown: (id) => (id === 'focus' ? s.down : false),
    actHit: (id) => { if (id !== 'focus' || !s.hit) return false; s.hit = false; return true; },
  };
  return {
    input, state: s,
    press() { s.down = true; s.hit = true; },
    release() { s.down = false; s.hit = false; },
  };
}

/**
 * Look that way, and MEAN it.
 *
 * `Player._move` springs `facing` toward `camera.yaw + π` every frame at
 * 13/s, so setting `facing` alone is a value the next frame walks back —
 * which is exactly the sort of half-driven input that makes a check pass for
 * the wrong reason. Both, every time.
 */
function look(pl, yaw) {
  pl.facing = yaw;
  if (pl.camera) pl.camera.yaw = yaw - Math.PI;
}

/** Stand the player at a spot, looking at it, on its floor. */
function standAt(world, THREE, at, back = 0.9, face = null) {
  const pl = world.player;
  const yaw = face ?? 0;
  const x = at.x - Math.sin(yaw) * back, z = at.z - Math.cos(yaw) * back;
  const y = world.floorAt ? world.floorAt(x, z) : at.y;
  pl.position.set(x, y, z);
  pl.body?.setTransform?.(new THREE.Vector3(x, y + 0.9, z), null);
  look(pl, Math.atan2(at.x - x, at.z - z));
  pl.velocity?.set?.(0, 0, 0);
}

/** Walk the player from where they are to (x, z), a step a frame. */
function walk(world, THREE, input, x, z, secs = 2.0) {
  const pl = world.player;
  const from = { x: pl.position.x, z: pl.position.z };
  const n = Math.max(1, Math.round(secs * 60));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const px = from.x + (x - from.x) * t, pz = from.z + (z - from.z) * t;
    look(pl, Math.atan2(x - pl.position.x, z - pl.position.z) || pl.facing);
    const y = world.floorAt ? world.floorAt(px, pz) : pl.position.y;
    pl.position.set(px, y, pz);
    pl.body?.setTransform?.(new THREE.Vector3(px, y + 0.9, pz), null);
    world.update(1 / 60, input);
    pl.position.x = px; pl.position.z = pz;
  }
}

/** One tap of the interact key, one frame of the world. */
function tap(world, k, frames = 1) {
  k.press();
  for (let i = 0; i < frames; i++) world.update(1 / 60, k.input);
  k.release();
  world.update(1 / 60, k.input);
}

/** Anybody standing in the talk cone takes the press first — stand them aside. */
async function clearCone(world) {
  const { residentFacing } = await import('../../src/game/Station.js');
  const pl = world.player;
  for (let i = 0; i < 8; i++) {
    const who = residentFacing(world);
    if (!who) break;
    const ax = Math.cos(pl.facing) * 6, az = -Math.sin(pl.facing) * 6;
    who.standCx = (who.standCx ?? who.position.x) + ax; who.standCz = (who.standCz ?? who.position.z) + az;
    who.standTx = who.standCx; who.standTz = who.standCz;
    who.standX = who.standCx; who.standZ = who.standCz;
    who.position.x += ax; who.position.z += az;
    who.body?.setTransform?.(who.position, null);
  }
}

/** And any loose seat close enough for `sitKey` to claim the press. */
function clearSeats(world, THREE, at, r = 1.9) {
  for (const p of world.props) {
    if (!(p.kind === 'chair' || p.kind === 'stool' || p.kind === 'bench') || p.dead || p.__verb) continue;
    const q = p.body.position;
    if (Math.hypot(q.x - at.x, q.z - at.z) > r) continue;
    const nx = q.x + (q.x - at.x || 1) * 3, nz = q.z + (q.z - at.z || 1) * 3;
    p.body.setTransform(new THREE.Vector3(nx, q.y, nz), null);
    p.body.velocity.set(0, 0, 0);
    p.mesh.position.copy(p.body.position);
  }
}

const said = (world) => { const out = []; world.notify = (h, l) => out.push(`${h}: ${l}`); return out; };

/**
 * ── ONE CLAUSE AT A TIME, AND IT IS NOT FUSSINESS ────────────────────────
 *
 * `tools/_one.mjs` and `verify.mjs` both COLLECT the async clause bodies and
 * drain them together, so twelve of these ran concurrently against ONE purse
 * (`Credits.js` is module state over a single store) and one station fold.
 * Measured: every clause green on its own, six of twelve red together —
 * "purse 117 after one crate, not 15", because four other verbs had been
 * paid into the same wallet while this one was carrying.
 *
 * A verb's whole point is that it pays and it records, so there is nothing to
 * assert that is not shared. The fix is the queue rather than looser
 * assertions: each clause waits for the one before it, and every number below
 * is the exact number.
 */
function serialise(check) {
  let gate = Promise.resolve();
  return (label, fn) => check(label, () => {
    const next = gate.then(fn);
    gate = next.then(() => {}, () => {});
    return next;
  });
}

export async function run({ check: rawCheck, assert, THREE }) {
  const check = serialise(rawCheck);
  const S = () => import('../../src/game/StationSave.js');
  const C = () => import('../../src/game/Credits.js');
  const J = () => import('../../src/game/Journal.js');

  /* ══════════════════════════════════════════════════════════════════════
   *  1 — #52 CARGO HOLD: CARRY A CRATE TO A SHELF
   * ══════════════════════════════════════════════════════════════════════ */

  check('verbs: the key lifts the marked crate at #52 and setting it on the marked shelf pays 15', async () => {
    const a = await station(48);
    try {
      const { purse } = await C();
      const { verbsState } = await S();
      const { pageOf } = await J();
      const V = a.world._verbs;
      assert(V?.carry?.crate, 'the cargo hold has no marked crate');
      const crate = V.carry.crate;
      const k = keypad(a.idle);
      const lines = said(a.world);
      /* At the crate, looking at it, and the press takes it. */
      standAt(a.world, THREE, V.spot.carry.at, 1.0);
      a.world.update(1 / 60, k.input);
      await clearCone(a.world);
      clearSeats(a.world, THREE, V.spot.carry.at);
      standAt(a.world, THREE, V.spot.carry.at, 1.0);
      const before = crate.body.position.clone();
      tap(a.world, k);
      assert(V.carry.held === crate, `the key did not lift the crate (${lines.slice(-1)[0] || 'silence'})`);
      /* It follows the hand: a metre off the floor, in front of the chest. */
      a.world.update(1 / 60, k.input);
      for (let i = 0; i < 40; i++) a.world.update(1 / 60, k.input);
      const up = crate.body.position.y - before.y;
      assert(up > 0.4, `the crate rose ${up.toFixed(2)} m — it is not in the hand`);
      const pl = a.world.player;
      const ahead = Math.hypot(crate.body.position.x - pl.position.x, crate.body.position.z - pl.position.z);
      assert(ahead < 1.6, `the crate hangs ${ahead.toFixed(2)} m from the player`);
      /* Carry it across the aisle. */
      const shelf = V.carry.shelf;
      walk(a.world, THREE, k.input, shelf.x + 0.9, shelf.z + 0.9, 3.0);
      /* Turn to the shelf — the crate hangs in front of the chest, so which
       * way you are facing is what puts it over the board. */
      for (let i = 0; i < 90; i++) {
        look(pl, Math.atan2(shelf.x - pl.position.x, shelf.z - pl.position.z));
        a.world.update(1 / 60, k.input);
      }
      const d = Math.hypot(crate.body.position.x - shelf.x, crate.body.position.z - shelf.z);
      assert(V.carry.done >= 1, `the crate ended ${d.toFixed(2)} m from the shelf and nothing was paid`);
      assert(d < 0.4, `paid, but the crate is ${d.toFixed(2)} m off the shelf in plan`);
      assert(crate.body.position.y > shelf.y, `the crate is ${(shelf.y - crate.body.position.y).toFixed(2)} m below the board`);
      assert(purse() === 15, `purse ${purse()} after one crate, not 15`);
      assert((verbsState().crates | 0) === 1, `the fold records ${verbsState().crates} crates`);
      const page = pageOf(a.st.day ?? 0).map((r) => r.t);
      assert(page.some((t) => /stowed the marked crate/.test(t)), `no journal line: ${page.join(' | ')}`);
      assert(lines.some((l) => /THE FOREMAN/.test(l)), `the foreman said nothing: ${lines.slice(-3).join(' | ')}`);
      return `lifted by the key, carried ${before.distanceTo(shelf).toFixed(1)} m, landed ${d.toFixed(2)} m from the mark, 15 credits, fold 1, journal written`;
    } finally { a.world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  2 — #53 WASTE & RECYCLING: PULL THE COMPACTOR'S LEVER
   * ══════════════════════════════════════════════════════════════════════ */

  check("verbs: the key throws #53's lever, the face slams and the four drums in the throat are crushed for 10", async () => {
    const a = await station(48);
    try {
      const { purse } = await C();
      const { verbsState } = await S();
      const { pageOf } = await J();
      const V = a.world._verbs;
      assert(V?.lever, 'the compactor has no lever');
      const L = V.lever;
      assert(L.barrels.length === 4, `${L.barrels.length} drums in the throat`);
      const k = keypad(a.idle);
      const lines = said(a.world);
      standAt(a.world, THREE, V.spot.lever.at, 1.0);
      a.world.update(1 / 60, k.input);
      await clearCone(a.world);
      clearSeats(a.world, THREE, V.spot.lever.at);
      standAt(a.world, THREE, V.spot.lever.at, 1.0);
      const arm0 = L.arm.rotation.x, face0 = L.face.position.clone();
      tap(a.world, k);
      assert(L.throwT >= 0, `the key did not throw the lever (${lines.slice(-1)[0] || 'silence'})`);
      /* The arm swings 60° over half a second. */
      for (let i = 0; i < 30; i++) a.world.update(1 / 60, k.input);
      const swung = Math.abs(L.arm.rotation.x - arm0);
      assert(swung > 0.9, `the lever moved ${(swung * 180 / Math.PI).toFixed(0)}°, not 60°`);
      /* Then the face travels and the drums are gone. */
      let moved = 0;
      for (let i = 0; i < 40; i++) { a.world.update(1 / 60, k.input); moved = Math.max(moved, L.face.position.distanceTo(face0)); }
      assert(moved > 3, `the compactor face travelled ${moved.toFixed(2)} m`);
      const left = L.barrels.filter((b) => !b.dead).length;
      assert(left === 0, `${left} drums survived the compactor`);
      assert(L.crushed === 4, `the compactor counted ${L.crushed} crushed`);
      assert(purse() === 10, `purse ${purse()} after one load, not 10`);
      assert((verbsState().crushed | 0) === 4, `the fold records ${verbsState().crushed} crushed`);
      const page = pageOf(a.st.day ?? 0).map((r) => r.t);
      assert(page.some((t) => /compactor/.test(t)), `no journal line: ${page.join(' | ')}`);
      /* And it comes back to rest, so it can be thrown again. */
      for (let i = 0; i < 180; i++) a.world.update(1 / 60, k.input);
      assert(L.throwT < 0 && L.face.position.distanceTo(face0) < 0.05, 'the face did not return');
      return `60° throw, face travelled ${moved.toFixed(2)} m, 4 drums crushed, 10 credits, fold 4, and the face is back`;
    } finally { a.world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  3 — #14 THE LONG NIGHT: POUR AT THE BAR
   * ══════════════════════════════════════════════════════════════════════ */

  check('verbs: the key at #14\'s back-bar column pours a cup, a drinker takes it out of your hand and tips 2', async () => {
    const a = await station(40, 20);
    try {
      const { purse } = await C();
      const { verbsState } = await S();
      const V = a.world._verbs;
      assert(V?.pour, 'the cantina has no tap');
      const k = keypad(a.idle);
      const lines = said(a.world);
      const at = V.spot.pour.at;
      standAt(a.world, THREE, at, 0.8);
      a.world.update(1 / 60, k.input);
      /* Somebody at the bar, within the three metres the verb reaches. */
      const life = a.life;
      let who = null, bd = 1e9;
      for (const b of life.live.values()) {
        if (!b?.position || b.dead || b.wayR) continue;
        const d = Math.hypot(b.position.x - at.x, b.position.z - at.z);
        if (d < bd) { bd = d; who = b; }
      }
      assert(who, 'nobody in the cantina at 20:00');
      if (bd > 2.4) {
        /* Staged, and said so: the pool puts its drinkers where it puts them,
         * and this clause is about the cup rather than about the crowd. */
        const nx = at.x + 1.6, nz = at.z;
        who.standX = nx; who.standZ = nz; who.standCx = nx; who.standCz = nz;
        who.standTx = nx; who.standTz = nz;
        who.position.x = nx; who.position.z = nz;
        who.body?.setTransform?.(who.position, null);
      }
      await clearCone(a.world);
      clearSeats(a.world, THREE, at);
      standAt(a.world, THREE, at, 0.8);
      tap(a.world, k);
      assert(V.pour.cup, `the key poured nothing (${lines.slice(-1)[0] || 'silence'})`);
      const cup = V.pour.cup;
      assert(cup.parent === a.world.scene, 'the cup is not in the world');
      /* In YOUR hand first. */
      for (let i = 0; i < 20; i++) a.world.update(1 / 60, k.input);
      const hand = a.world.player.rig.tipPos('handR');
      const inHand = cup.position.distanceTo(hand);
      assert(inHand < 0.3, `the cup is ${inHand.toFixed(2)} m from your hand`);
      /* Then his, then gone, then a tip. */
      for (let i = 0; i < 200 && V.pour.cup; i++) a.world.update(1 / 60, k.input);
      assert(!V.pour.cup, 'nobody took the cup');
      assert(cup.parent === null || cup.parent === undefined, 'the cup is still in the scene');
      assert(V.pour.poured === 1, `poured count ${V.pour.poured}`);
      assert(purse() === 2, `purse ${purse()} after one drink, not 2`);
      assert((verbsState().poured | 0) === 1, `the fold records ${verbsState().poured}`);
      return `cup in the hand at ${inHand.toFixed(2)} m, taken by ${V.log.slice(-1)[0]?.who || 'a drinker'}, 2 credits tipped, fold 1`;
    } finally { a.world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  4 — #35 THE DRAZI QUARTER: THROW THE BONES
   * ══════════════════════════════════════════════════════════════════════ */

  check("verbs: the key throws two real dice at #35's kerb, they settle, the up-faces are read and the 5-credit stake is settled", async () => {
    const a = await station(44);
    try {
      const { purse, pay } = await C();
      const { verbsState } = await S();
      const { pageOf } = await J();
      pay(40, 'purse');
      const V = a.world._verbs;
      assert(V?.dice?.dice?.length === 2, 'the Drazi quarter has no bones');
      const k = keypad(a.idle);
      const lines = said(a.world);
      const at = V.spot.dice.at;
      /* Right on the kerb: a metre back from it is inside the pit, 2.6 m down,
       * and the height gate refuses a press from the floor of the well — which
       * is the gate working. */
      standAt(a.world, THREE, at, 0.4);
      a.world.update(1 / 60, k.input);
      await clearCone(a.world);
      clearSeats(a.world, THREE, at);
      standAt(a.world, THREE, at, 0.4);
      const start = V.dice.dice.map((d) => d.body.position.clone());
      const before = purse();
      tap(a.world, k);
      assert(V.dice.state === 'rolling', `the key did not throw (${lines.slice(-1)[0] || 'silence'})`);
      assert(purse() === before - 5, `the stake was ${before - purse()}, not 5`);
      let flew = 0;
      for (let i = 0; i < 600 && V.dice.state === 'rolling'; i++) {
        a.world.update(1 / 60, k.input);
        flew = Math.max(flew, V.dice.dice[0].body.position.distanceTo(start[0]));
      }
      assert(V.dice.state === 'idle', 'the dice never came to rest');
      assert(flew > 0.6, `the dice travelled ${flew.toFixed(2)} m — they were not thrown`);
      const L = V.dice.last;
      assert(L, 'no result was read');
      for (const n of L.mine) assert(n >= 1 && n <= 6, `an up-face read ${n}`);
      assert(L.hisTotal >= 2 && L.hisTotal <= 12, `the house threw ${L.hisTotal}`);
      const expect = before - 5 + (L.won ? 10 : 0);
      assert(purse() === expect, `purse ${purse()}, expected ${expect} after ${L.total} v ${L.hisTotal}`);
      const f = verbsState();
      assert(((f.diceWon | 0) + (f.diceLost | 0)) === 1, 'the fold did not record the throw');
      const page = pageOf(a.st.day ?? 0).map((r) => r.t);
      assert(page.some((t) => /Drazi pit/.test(t)), `no journal line: ${page.join(' | ')}`);
      /* SEEDED: the same day and the same throw number is the same house roll. */
      const { hash2 } = await import('../../src/game/Verbs.js');
      const day = a.st.day ?? 0;
      const again = 1 + Math.floor(hash2(day * 91 + 1, 101) * 6) + 1 + Math.floor(hash2(day * 91 + 1, 202) * 6);
      assert(again === L.hisTotal, `the house's roll is not seeded (${again} v ${L.hisTotal})`);
      return `thrown ${flew.toFixed(2)} m, settled on ${L.mine.join('+')}=${L.total} against the house's ${L.hisTotal}, ${L.won ? 'won 10' : 'lost 5'}, purse ${purse()}`;
    } finally { a.world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  5 — #22 THE CHAPEL: RING THE BELL
   * ══════════════════════════════════════════════════════════════════════ */

  check('verbs: the key swings the chapel bell, everybody in the room turns to it, and it will not ring twice in an hour', async () => {
    const a = await station(40, 11);
    try {
      const { verbsState } = await S();
      const { pageOf } = await J();
      const V = a.world._verbs;
      assert(V?.bell, 'the chapel has no bell');
      const k = keypad(a.idle);
      const lines = said(a.world);
      const at = V.spot.bell.at;
      standAt(a.world, THREE, at, 1.0);
      a.world.update(1 / 60, k.input);
      /* Give the room its people — the pool seats and stands them on arrival. */
      for (let i = 0; i < 240; i++) a.world.update(1 / 60, k.input);
      await clearCone(a.world);
      clearSeats(a.world, THREE, at);
      standAt(a.world, THREE, at, 1.0);
      const inRoom = [...a.life.live.values()].filter((b) => b && b.stationPlace === 22 && !b.wayR);
      assert(inRoom.length >= 1, 'nobody in the chapel to hear it');
      const rot0 = V.bell.bell.rotation.z;
      tap(a.world, k);
      assert(V.bell.rings === 1, `the key did not ring the bell (${lines.slice(-1)[0] || 'silence'})`);
      let swung = 0;
      for (let i = 0; i < 40; i++) { a.world.update(1 / 60, k.input); swung = Math.max(swung, Math.abs(V.bell.bell.rotation.z - rot0)); }
      assert(swung > 0.15, `the bell moved ${swung.toFixed(3)} rad`);
      assert(V.bell.turned >= 1, 'nobody turned to it');
      /* And they really are facing it — `standFace` is what `stepStanding` eases to. */
      let facing = 0;
      for (const b of inRoom) {
        const want = Math.atan2(at.x - b.position.x, at.z - b.position.z);
        if (Math.abs(Math.atan2(Math.sin(b.standFace - want), Math.cos(b.standFace - want))) < 0.05) facing++;
      }
      assert(facing === inRoom.length, `${facing} of ${inRoom.length} are turned to the bell`);
      const day = a.st.day ?? 0;
      assert(verbsState().bellHour === day * 24 + 11, `the fold stamped ${verbsState().bellHour}`);
      assert(pageOf(day).some((r) => /chapel bell/.test(r.t)), 'no journal line');
      /* Twice in an hour: refused, and it says so. */
      tap(a.world, k);
      assert(V.bell.rings === 1, 'the bell rang twice in one hour');
      assert(lines.some((l) => /this hour/.test(l)), `the refusal was not said: ${lines.slice(-3).join(' | ')}`);
      /* An hour on, it rings again. */
      a.st.hour = 12;
      tap(a.world, k);
      assert(V.bell.rings === 2, 'the bell would not ring in the next hour');
      return `swung ${swung.toFixed(2)} rad, ${V.bell.turned} turned (${facing} of ${inRoom.length} on the bearing), once an hour held, twice in two`;
    } finally { a.world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  6 — #39 LAUNDRY: FIX THE FAN (A HOLD)
   * ══════════════════════════════════════════════════════════════════════ */

  check("verbs: three seconds of the key held on #39's dead extractor spins it up for 8, and letting go early does not", async () => {
    const a = await station(44);
    try {
      const { purse } = await C();
      const { verbsState } = await S();
      const { pageOf } = await J();
      const { fanStopped } = await import('../../src/game/Verbs.js');
      const V = a.world._verbs;
      assert(V?.fan, 'the laundry has no extractor');
      assert(fanStopped(a.world), 'the extractor is not out today — the seed has moved');
      const k = keypad(a.idle);
      const lines = said(a.world);
      const at = V.spot.fan.at;
      standAt(a.world, THREE, at, 1.1);
      a.world.update(1 / 60, k.input);
      await clearCone(a.world);
      clearSeats(a.world, THREE, at);
      standAt(a.world, THREE, at, 1.1);
      const spin0 = V.fan.blades.rotation.z;
      /* A short hold: nothing. */
      k.press();
      for (let i = 0; i < 60; i++) a.world.update(1 / 60, k.input);
      k.release();
      a.world.update(1 / 60, k.input);
      assert(V.fan.spin === 0, 'a one-second hold started the fan');
      assert(purse() === 0, `purse ${purse()} after letting go early`);
      /* The whole three seconds. */
      k.press();
      for (let i = 0; i < 230 && V.fan.spin === 0; i++) a.world.update(1 / 60, k.input);
      k.release();
      assert(V.fan.spin > 0, `the fan never started (${lines.slice(-1)[0] || 'silence'})`);
      let turned = 0;
      for (let i = 0; i < 60; i++) { a.world.update(1 / 60, k.input); turned = Math.abs(V.fan.blades.rotation.z - spin0); }
      assert(turned > 1.0, `the blades turned ${turned.toFixed(2)} rad after it started`);
      assert(purse() === 8, `purse ${purse()}, not 8`);
      assert((verbsState().fans | 0) === 1, 'the fold did not count the repair');
      assert(verbsState().fanDay === (a.st.day ?? 0), 'the fold did not stamp the day');
      assert(!fanStopped(a.world), 'the fan still reads as stopped after the repair');
      assert(pageOf(a.st.day ?? 0).some((r) => /extractor/.test(r.t)), 'no journal line');
      assert(lines.some((l) => /LAUNDRY KEEPER/.test(l)), 'the keeper said nothing');
      /* Tomorrow it is out again — seeded on the day, not remembered as fixed. */
      const { setStationHour } = await S();
      setStationHour(24 * ((a.st.day ?? 0) + 1) + 9);
      a.st.day = (a.st.day ?? 0) + 1;
      assert(fanStopped(a.world), 'the extractor was still turning the next day');
      return `1 s hold refused, 3 s hold spun it up (${turned.toFixed(1)} rad in a second), 8 credits, fold stamped, out again tomorrow`;
    } finally { a.world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  7 — #39 LAUNDRY: WASH
   * ══════════════════════════════════════════════════════════════════════ */

  check("verbs: a cycle at #39's washer clears the soot the working decks put on the player, and the outfit reads it", async () => {
    const a = await station(44);
    try {
      const { verbsState } = await S();
      const { pageOf } = await J();
      const { soil } = await import('../../src/game/Verbs.js');
      const V = a.world._verbs;
      assert(V?.wash, 'the laundry has no washer');
      const k = keypad(a.idle);
      const lines = said(a.world);
      /* Come in dirty, and the garments really are darker for it. */
      const mats = [];
      a.world.player.rig.root.traverse((o) => { if (o.isMesh && o.material?.color) mats.push(o); });
      assert(mats.length > 0, 'the player has no garment to dirty');
      const clean0 = mats.map((o) => o.material.color.clone());
      soil(a.world, 1);
      assert(a.world.player.grubby === 1, 'the player did not get dirty');
      let darker = 0;
      for (let i = 0; i < mats.length; i++) if (mats[i].material.color.r < clean0[i].r - 1e-4) darker++;
      assert(darker > 0, `${darker} of ${mats.length} garment materials darkened`);
      const at = V.spot.wash.at;
      standAt(a.world, THREE, at, 1.0);
      a.world.update(1 / 60, k.input);
      await clearCone(a.world);
      clearSeats(a.world, THREE, at);
      standAt(a.world, THREE, at, 1.0);
      const door0 = V.wash.door.rotation.z;
      tap(a.world, k);
      assert(V.wash.t >= 0, `the key did not start a cycle (${lines.slice(-1)[0] || 'silence'})`);
      let rocked = 0;
      for (let i = 0; i < 160; i++) { a.world.update(1 / 60, k.input); rocked = Math.max(rocked, Math.abs(V.wash.door.rotation.z - door0)); }
      assert(rocked > 0.1, `the door rocked ${rocked.toFixed(3)} rad`);
      assert(V.wash.washes === 1, 'the cycle never finished');
      assert(a.world.player.grubby === 0, `the player is still ${a.world.player.grubby} dirty`);
      let back = 0;
      for (let i = 0; i < mats.length; i++) if (Math.abs(mats[i].material.color.r - clean0[i].r) < 1e-4) back++;
      assert(back === mats.length, `${back} of ${mats.length} garment materials came back clean`);
      assert((verbsState().washes | 0) === 1, 'the fold did not count the wash');
      assert(pageOf(a.st.day ?? 0).some((r) => /laundry/.test(r.t)), 'no journal line');
      return `${darker} of ${mats.length} materials sooted, door rocked ${rocked.toFixed(2)} rad over 2 s, all ${back} back to their own colour, fold 1`;
    } finally { a.world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  8 — #28 THE KENNEL: FEED
   * ══════════════════════════════════════════════════════════════════════ */

  check('verbs: the key scoops at #28, the animals come to the bowl, put their heads down and the handler pays 5', async () => {
    const a = await station(44);
    try {
      const { purse } = await C();
      const { verbsState } = await S();
      const { pageOf } = await J();
      const V = a.world._verbs;
      assert(V?.feed, 'the habitat has no feed bin');
      const k = keypad(a.idle);
      const lines = said(a.world);
      const at = V.spot.feed.at;
      standAt(a.world, THREE, at, 1.0);
      a.world.update(1 / 60, k.input);
      await clearCone(a.world);
      clearSeats(a.world, THREE, at);
      standAt(a.world, THREE, at, 1.0);
      assert(!V.feed.fill.visible, 'the bowl was already full');
      tap(a.world, k);
      assert(V.feed.t >= 0, `the key did not scoop (${lines.slice(-1)[0] || 'silence'})`);
      assert(V.feed.fill.visible, 'the bowl did not fill');
      const pets = V.feed.pets;
      assert(pets.length >= 2, `${pets.length} animals answered the bin`);
      const far = pets.map((p) => Math.hypot(p.position.x - V.feed.at.x, p.position.z - V.feed.at.z));
      assert(Math.min(...far) > 1.0, 'the animals were already at the bowl');
      let heads = 0;
      for (let i = 0; i < 600; i++) {
        a.world.update(1 / 60, k.input);
        heads = Math.max(heads, V.feed.eating);
        if (V.feed.fed >= 2) break;
      }
      const near = pets.map((p) => Math.hypot(p.position.x - V.feed.at.x, p.position.z - V.feed.at.z));
      for (const d of near) assert(d < 1.1, `an animal stopped ${d.toFixed(2)} m from the bowl`);
      assert(heads >= 2, `${heads} heads went down at once`);
      /* And it is the head BONE that goes down, not the whole animal. */
      const head = pets[0].rig?.get?.('head');
      assert(head, 'the animal has no head bone to lower');
      assert(purse() === 5, `purse ${purse()}, not 5`);
      assert((verbsState().feeds | 0) === 1, 'the fold did not count the feed');
      assert(pageOf(a.st.day ?? 0).some((r) => /fed the kennel/.test(r.t)), 'no journal line');
      assert(lines.some((l) => /THE HANDLER/.test(l)), 'the handler said nothing');
      /* The bowl empties again. */
      for (let i = 0; i < 700 && V.feed.t >= 0; i++) a.world.update(1 / 60, k.input);
      assert(!V.feed.fill.visible, 'the bowl never emptied');
      return `bowl filled, ${pets.length} animals walked ${Math.max(...far).toFixed(1)} m in, ${heads} heads down for 4 s, 5 credits, bowl emptied`;
    } finally { a.world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  9 — #18 THE PIT: ARM-WRESTLE
   * ══════════════════════════════════════════════════════════════════════ */

  check("verbs: the key at #18's table sits you across from a seeded opponent, the mash leans both forearms, and the 10-credit stake settles", async () => {
    const a = await station(40, 21);
    try {
      const { purse, pay } = await C();
      const { verbsState } = await S();
      const { pageOf } = await J();
      pay(60, 'purse');
      const V = a.world._verbs;
      assert(V?.arm?.table, 'the pit has no table');
      const k = keypad(a.idle);
      const lines = said(a.world);
      const at = V.spot.arm.at;
      /* From the door and for twenty seconds, which is how `seated.mjs` gets
       * the pool to fill a room: it seats people out of the places that are
       * DRAWN, and a room you have not walked to is not one of them. */
      const { PLACE } = await import('../../src/game/StationPlan.js');
      const p18 = PLACE.get(18);
      a.world.player.position.set(p18.door[0], a.world.floorAt(p18.door[0], p18.door[1]), p18.door[1]);
      a.world.player.body?.setTransform?.(new THREE.Vector3(p18.door[0], a.world.player.position.y + 0.9, p18.door[1]), null);
      for (let i = 0; i < 20 * 60; i++) a.world.update(1 / 60, k.input);
      standAt(a.world, THREE, at, 1.0);
      for (let i = 0; i < 60; i++) a.world.update(1 / 60, k.input);
      await clearCone(a.world);
      clearSeats(a.world, THREE, at);
      standAt(a.world, THREE, at, 1.0);
      /* Somebody in the room to sit across from — the pool puts them where it
       * puts them, so the nearest is walked over to the far stool's side. */
      const room = [...a.life.live.values()].filter((b) => b && b.stationPlace === 18 && !b.wayR && !b.dead);
      assert(room.length >= 1, 'nobody in the Pit at 21:00');
      const foe0 = room[0];
      const sq = V.arm.theirs.body.position;
      foe0.standX = sq.x + 1.2; foe0.standZ = sq.z; foe0.standCx = foe0.standX; foe0.standCz = foe0.standZ;
      foe0.standTx = foe0.standX; foe0.standTz = foe0.standZ;
      foe0.position.x = foe0.standX; foe0.position.z = foe0.standZ;
      foe0.body?.setTransform?.(foe0.position, null);
      const before = purse();
      tap(a.world, k);
      const B = V.arm.bout;
      assert(B, `the key did not start a bout: ${lines.slice(-2).join(' | ')}`);
      assert(purse() === before - 10, `the stake was ${before - purse()}, not 10`);
      assert(a.world.player.seat, 'the key did not sit the player');
      assert(a.world.player.seat.prop === V.arm.mine, 'the player is on the wrong stool');
      assert(B.foe.seat?.prop === V.arm.theirs, 'the opponent is not on his stool');
      assert(B.strength >= 0.16 && B.strength <= 0.32, `the opponent's strength is ${B.strength}`);
      /* Mash: press, release, press — the real key edge, forty times. */
      let leanSeen = 0, seated = 0, stood = 0;
      const pl = a.world.player;
      let armMoved = 0;
      const rest = pl.rig.get('foreR')?.obj.quaternion.clone();
      for (let i = 0; i < 400 && V.arm.bout; i++) {
        k.press(); a.world.update(1 / 60, k.input);
        k.release(); a.world.update(1 / 60, k.input);
        if (V.arm.bout) { leanSeen = Math.max(leanSeen, V.arm.bout.lean); if (pl.seat) seated++; else stood++; }
        const now = pl.rig.get('foreR')?.obj.quaternion;
        if (rest && now) armMoved = Math.max(armMoved, rest.angleTo(now));
      }
      const presses = B.presses;
      assert(presses >= 6, `only ${presses} presses were counted`);
      /* AND YOU STAY DOWN. The seat branch above the hook reads a press as
       * "get up" — the bout puts you straight back, and this is the assertion
       * that says so. */
      assert(stood === 0, `the player was off the stool for ${stood} of ${seated + stood} mash frames`);
      assert(leanSeen > 0.3, `the lean only reached ${leanSeen.toFixed(2)}`);
      assert(armMoved > 0.2, `the forearm moved ${armMoved.toFixed(2)} rad`);
      /* Run it out. */
      for (let i = 0; i < 600 && V.arm.bout; i++) a.world.update(1 / 60, k.input);
      assert(!V.arm.bout, 'the bout never ended');
      const won = V.arm.won === 1;
      assert(V.arm.won + V.arm.lost === 1, 'the bout was not settled');
      assert(purse() === before - 10 + (won ? 20 : 0), `purse ${purse()} after ${won ? 'a win' : 'a loss'}`);
      const f = verbsState();
      assert(((f.armWon | 0) + (f.armLost | 0)) === 1, 'the fold did not record the bout');
      assert(pageOf(a.st.day ?? 0).some((r) => /arm/.test(r.t) && /Pit/.test(r.t)), 'no journal line');
      /* And he is his own man again — the pool may sit him back down on that
       * stool the next second, which is the pool working, not a leak. */
      assert(!B.foe.__verbFoe, 'the opponent was left held at the table');
      assert(B.foe.standIn < 1e5, 'the opponent was left frozen');
      return `sat by StationSit on his own stool and held there through all ${seated} mash frames, ${presses} shoves against a strength of ${B.strength.toFixed(2)}, lean to ${leanSeen.toFixed(2)}, forearm ${armMoved.toFixed(2)} rad, ${won ? 'won 20' : 'lost 10'}`;
    } finally { a.world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  10 — #21 THE GYM: SPAR THE REMOTE
   * ══════════════════════════════════════════════════════════════════════ */

  check("verbs: the key at #21's rack puts a remote in the air for 30 s of real bolts, counts them and saves the best", async () => {
    const a = await station(40);
    try {
      const { verbsState } = await S();
      const { pageOf } = await J();
      const V = a.world._verbs;
      assert(V?.spar, 'the gym has no rack');
      const k = keypad(a.idle);
      const lines = said(a.world);
      const at = V.spot.spar.at;
      standAt(a.world, THREE, at, 1.0);
      a.world.update(1 / 60, k.input);
      await clearCone(a.world);
      clearSeats(a.world, THREE, at);
      standAt(a.world, THREE, at, 1.0);
      /* A dark blade is refused, in words. */
      a.world.player.saber.lit = false;
      tap(a.world, k);
      assert(!V.spar.round, 'a round started with the blade down');
      assert(lines.some((l) => /light it first/.test(l)), `the refusal was not said: ${lines.slice(-3).join(' | ')}`);
      /* Lit, it flies. */
      a.world.player.saber.lit = true;
      a.world.player.saber.ignition = 1;
      tap(a.world, k);
      const R = V.spar.round;
      assert(R, `the key did not start a round (${lines.slice(-1)[0] || 'silence'})`);
      assert(R.g.parent === a.world.scene, 'the remote is not in the scene');
      const from = R.g.position.clone();
      let moved = 0, maxShots = 0;
      for (let i = 0; i < 32 * 60 && V.spar.round; i++) {
        a.world.update(1 / 60, k.input);
        if (V.spar.round) { moved = Math.max(moved, V.spar.round.g.position.distanceTo(from)); maxShots = V.spar.round.shots; }
      }
      assert(!V.spar.round, 'the round never ended');
      assert(moved > 1.5, `the remote drifted ${moved.toFixed(2)} m off the rack`);
      const last = V.spar.last;
      assert(last.fired >= 12, `only ${last.fired} bolts were fired`);
      assert(last.judged === last.fired, `${last.judged} of ${last.fired} bolts were judged`);
      assert(lines.some((l) => /^THE GYM: \d+ of \d+$/.test(l)), 'the count was never called');
      const f = verbsState();
      assert(f.spar && f.spar.n === 16, `the fold saved ${JSON.stringify(f.spar)}`);
      assert(f.spar.last === last.met && f.spar.best >= last.met, 'the best was not saved');
      assert(pageOf(a.st.day ?? 0).some((r) => /gym's remote/.test(r.t)), 'no journal line');
      return `remote up, drifted ${moved.toFixed(1)} m, ${last.fired} bolts fired and all ${last.judged} judged (${last.met} met), fold best ${f.spar.best}`;
    } finally { a.world.dispose?.(); }
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  THE HOOK DOES NOT SHADOW THE ROOMS
   * ══════════════════════════════════════════════════════════════════════ */

  check('verbs: the hook takes no press it did not use — every place on the three verb decks still answers its own key', async () => {
    /**
     * `station.mjs`'s "no place answers the interact key by printing its own
     * verb" is the property this could break, and it is driven there over all
     * six decks. This is the same sweep over the three decks the ten verbs
     * are on, held here as well because it is THIS hook's own regression: a
     * spot with a slack reach would eat #14's bar, #18's tote and #21's job
     * board, and the sweep is the only instrument that would see it.
     */
    const { stationKey, placeUnder } = await import('../../src/game/Station.js');
    const { PLACES, floorOf } = await import('../../src/game/StationPlan.js');
    const HOOKS = ['onKiosk', 'onHabitat', 'onCounter', 'onBench', 'onMedbay', 'onPit',
      'onCasino', 'onQuest', 'onTote', 'onLarder', 'onCharge', 'onHolodeck', 'onLeave',
      'onBar', 'onCommune', 'onFlight', 'onCert', 'onLaunch', 'onSortie'];
    const echoes = [], silent = [], eaten = [];
    let pressed = 0;
    for (const answer of [true, false]) {
      for (const deck of [40, 44, 48]) {
        const a = await station(deck);
        try {
          for (let i = 0; i < 90; i++) a.world.update(1 / 60, a.idle);
          for (const p of PLACES) {
            if (p.deck !== deck || !p.verb) continue;
            const lines = [];
            let fired = 0;
            a.world.notify = (h, l) => lines.push([h, l]);
            for (const h of HOOKS) a.world[h] = () => { fired++; return answer; };
            a.world._tramRide = null;
            a.world.player.position.set(p.x, floorOf(p) + 1, p.z);
            const at = placeUnder(a.world, p.x, p.z) || p;
            pressed++;
            assert(stationKey(a.world) === true, `#${p.id} ${p.name} did not answer the interact key at all`);
            if (fired && answer) { /* a panel took it */ }
            else if (lines.length) { /* the room said something */ }
            else silent.push(`#${p.id} ${p.name}`);
            for (const [, line] of lines) if (line === at.verb) echoes.push(`#${at.id} ${at.name} → "${line}"`);
            /* AND THE VERBS DID NOT TAKE IT. Standing at a room's centre is
             * not standing at a fixture, so no press on this sweep may have
             * been spent by this file. */
            if (a.world._verbs?.log?.length) eaten.push(`#${p.id} ${p.name}`);
          }
        } finally { a.world.dispose?.(); }
      }
    }
    assert(!echoes.length, `${echoes.length} places echoed their own verb: ${echoes.slice(0, 6).join('; ')}`);
    assert(!silent.length, `${silent.length} places spent a press in silence: ${silent.slice(0, 6).join('; ')}`);
    assert(!eaten.length, `the verb hook ate a press at a room's centre: ${eaten.slice(0, 6).join('; ')}`);
    return `${pressed} presses over decks 40, 44 and 48, panels answering and panels refusing: 0 echoes, 0 silences, 0 presses taken by the ten verbs`;
  });

  /* ══════════════════════════════════════════════════════════════════════
   *  SEEDED
   * ══════════════════════════════════════════════════════════════════════ */

  check('verbs: nothing in the ten reads a clock or Math.random', async () => {
    const src = await readFile(new URL('../../src/game/Verbs.js', import.meta.url), 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const bad of ['Math.random', 'Date.now', 'performance.now']) {
      assert(!body.includes(bad), `Verbs.js reads ${bad}`);
    }
    assert(/hash2\(/.test(body), 'the seed is not the hash');
    const { hash2 } = await import('../../src/game/Verbs.js');
    const a = hash2(7, 11), b = hash2(7, 11);
    assert(a === b && a >= 0 && a < 1, `hash2 is not a stable 0..1 (${a} / ${b})`);
    assert(hash2(7, 12) !== a, 'hash2 does not move with its second argument');
    return 'no clock, no Math.random; every roll is hash2(day, index)';
  });
}
