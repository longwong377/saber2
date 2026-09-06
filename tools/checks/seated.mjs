/**
 * THE SEAT — V18 hole 4: *"residents do not sit, eat, drink or hold anything."*
 *
 * Four clauses, in the order the feature is built:
 *
 *   · `Rig.poseSeated` puts a body ON a chair: pelvis at the seat, thighs
 *     level, shins down to the floor, trunk upright. Measured on the
 *     reference rig, no world.
 *   · The pool's sit verb: at 22:00 in the cantina (#14, verb "sit and
 *     drink") at least six bodies are sitting inside 60 s, each on a chair of
 *     its own, hips under 0.7 m, the chair pinned under them, a cup in the
 *     hand — and they stand back up when told, and the cups are put down.
 *   · The verb is seeded: nothing in it reads a clock or `Math.random`.
 *   · The step stays inside §12.2's 2.5 ms with people sitting.
 *
 * ── THE CHAIRS ARE ON THEIR SIDES, AND THAT IS PART OF THE TEST ────────
 *
 * The cantina's kit puts its ten chairs down at the well's depth and they
 * spawn INTO the concourse's floor, pop out and tumble: measured in the
 * shipped page, all ten on their sides two seconds after the room is built.
 * That is `StationKit`'s. The verb's answer is `Bars.seatStill`: a fallen
 * chair is claimable and the sitter stands it up on arrival, so this clause
 * runs on the room as it is and holds every sat-on chair upright.
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

/** The station, through the door the game uses — `stationlife.mjs`'s own helper. */
async function station(deck = 40) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation, finishStationBuild } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0, quality: 'high' },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  finishStationBuild(world);
  return { world, idle: idleInput() };
}

const CANTINA = 14;

export async function run({ check, assert, THREE }) {
  /* ════════════════════════════════════════════════════════════════════════
   *  THE POSE
   * ════════════════════════════════════════════════════════════════════════ */

  check('seated: the pose — hips at the seat, thighs level, shins down, trunk upright', async () => {
    const { humanoidSkeleton, Rig, poseSeated } = await import('../../src/game/Rig.js');
    const rig = new Rig(humanoidSkeleton(1));
    const at = (n) => rig.worldPos(n);
    const tip = (n) => rig.tipPos(n);
    const out = [];
    for (const [label, o] of [['chair', { seatY: 0.48 }], ['stool', { seatY: 0.66 }], ['table', { seatY: 0.48, tableY: 0.74 }], ['cup', { seatY: 0.48, tableY: 0.74, cup: 'R' }]]) {
      const spec = poseSeated(rig, 1, { facing: 0, ...o });
      assert(spec, `${label}: no pose applied`);
      const hips = at('hips'), kL = tip('thighL'), kR = tip('thighR'), aL = tip('shinL'), aR = tip('shinR');
      const chest = at('chest'), head = tip('head');
      for (const b of rig.list) assert(Number.isFinite(b.obj.quaternion.w), `${label}: ${b.name} is not finite`);
      /* Pelvis a hand above the seat, and under 0.7 m on a chair. */
      assert(Math.abs(hips.y - (o.seatY + 0.07)) < 0.02, `${label}: hips at ${hips.y.toFixed(2)} for a seat at ${o.seatY}`);
      if (o.seatY <= 0.5) assert(hips.y < 0.7, `${label}: hips ${hips.y.toFixed(2)} are not under 0.7 m`);
      /* Thighs level: knees at hip height, forward of it. */
      for (const k of [kL, kR]) {
        /* On a chair the thigh is level; on a bar stool the shin cannot reach
         * the floor from hip height, so the knee drops and the thigh slopes. */
        if (o.seatY <= 0.5) assert(Math.abs(k.y - hips.y) < 0.10, `${label}: a knee at ${k.y.toFixed(2)} for hips at ${hips.y.toFixed(2)} — the thigh is not level`);
        else assert(k.y < hips.y && k.y > hips.y - 0.35, `${label}: a knee at ${k.y.toFixed(2)} for hips at ${hips.y.toFixed(2)}`);
        assert(k.z - hips.z > 0.30, `${label}: a knee only ${(k.z - hips.z).toFixed(2)} ahead of the hips`);
      }
      /* Shins down: ankles under the knees, on the floor. */
      for (const [a, k] of [[aL, kL], [aR, kR]]) {
        assert(a.y < 0.12, `${label}: an ankle at ${a.y.toFixed(2)} — the foot is off the floor`);
        assert(Math.hypot(a.x - k.x, a.z - k.z) < 0.08, `${label}: the shin leans ${Math.hypot(a.x - k.x, a.z - k.z).toFixed(2)} m`);
      }
      /* Trunk upright with a slight lean, head over the hips. */
      assert(chest.y - hips.y > 0.25, `${label}: the chest is ${(chest.y - hips.y).toFixed(2)} above the hips`);
      assert(Math.abs(head.z - hips.z) < 0.15, `${label}: the head is ${(head.z - hips.z).toFixed(2)} ahead of the hips`);
      const wR = tip('foreR'), wL = tip('foreL');
      if (o.tableY) assert(Math.abs(wL.y - (o.tableY + 0.05)) < 0.03, `${label}: the left hand is at ${wL.y.toFixed(2)}, not on a table at ${o.tableY}`);
      else assert(wL.y > hips.y && wL.y < hips.y + 0.25, `${label}: the left hand is at ${wL.y.toFixed(2)}, not in the lap`);
      if (o.cup) assert(wR.y > wL.y, `${label}: the cup hand is not raised`);
      out.push(`${label}: hips ${hips.y.toFixed(2)} knees ${kL.y.toFixed(2)}/${kR.y.toFixed(2)} ankles ${aL.y.toFixed(2)} head ${head.y.toFixed(2)}`);
    }
    /* Blend 0 leaves the rig alone. */
    const before = rig.get('thighL').obj.quaternion.clone();
    poseSeated(rig, 0, { seatY: 0.9 });
    assert(before.equals(rig.get('thighL').obj.quaternion), 'blend 0 moved a bone');
    return out.join('; ');
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  THE VERB
   * ════════════════════════════════════════════════════════════════════════ */

  check('seated: six bodies sit in the cantina at 22:00 inside 60 s, one to a chair, and stand back up', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { PLACE } = await import('../../src/game/StationPlan.js');
      const { seatUpright, SEAT_KINDS } = await import('../../src/game/Bars.js');
      const st = world._station, life = world._stationLife;
      const p = PLACE.get(CANTINA);
      st.hour = 22;
      /* The evening, with nobody stirred out of the room by an event — the
       * brawl is `stepEvents`' clause, not this one's. */
      life.event = null; life.eventFor = 0; life.eventIn = 1e6;
      /* From the door, so the pool seats the room. */
      world.player.position.set(p.door[0], 1.7, p.door[1]);
      world.player.body?.position?.set?.(p.door[0], 1.7, p.door[1]);
      step(world, 20, idle);
      const inRoom = () => [...life.live.values()].filter((b) => b && b.stationPlace === CANTINA && !b.wayR);
      const bodies = inRoom();
      assert(bodies.length >= 10, `${bodies.length} people standing in the cantina at 22:00`);
      const c = Math.cos(p.yaw || 0), s = Math.sin(p.yaw || 0);
      const inPlace = (q) => {
        const dx = q.x - p.x, dz = q.z - p.z;
        return Math.abs(dx * c - dz * s) <= p.w / 2 && Math.abs(dx * s + dz * c) <= p.d / 2;
      };
      const chairs = world.props.filter((q) => SEAT_KINDS.has(q.kind) && inPlace(q.body.position));
      const over = chairs.filter((q) => !seatUpright(q)).length;
      assert(chairs.length >= 6, `the cantina has ${chairs.length} seats — nothing to sit on`);

      const seatedNow = () => inRoom().filter((b) => b.seat && b.seat.state === 'sit' && b.seat.blend >= 0.99);
      let seated = [], at = -1, peak = 0;
      const ms = [];
      for (let t = 1; t <= 60; t++) {
        step(world, 1, idle, () => { if (life.stepMs) ms.push(life.stepMs); });
        seated = seatedNow();
        peak = Math.max(peak, seated.length);
        if (seated.length >= 6 && at < 0) at = t;
        if (at > 0 && t >= at + 3) break;
      }
      assert(seated.length >= 6, `${seated.length} people sitting in the cantina after 60 s (peak ${peak}), on ${chairs.length} chairs (${over} on their sides) with ${inRoom().length} in the room`);

      /* Each on a chair, low, one to a chair, the chair held under them. */
      const used = new Set();
      const hipsAbove = [];
      for (const b of seated) {
        const S = b.seat, q = S.prop.body.position;
        const h = b.rig.hipsBone.obj.position;
        const d = Math.hypot(h.x - q.x, h.z - q.z);
        assert(d <= 0.4, `${b.stationName}'s hips are ${d.toFixed(2)} m from the chair`);
        assert(h.y - q.y < 0.7, `${b.stationName}'s hips are ${(h.y - q.y).toFixed(2)} m over the chair — standing`);
        assert(!used.has(S.prop), `two people on one chair (${S.prop.id})`);
        used.add(S.prop);
        assert(seatUpright(S.prop), `${b.stationName} is sitting on a chair that is over`);
        assert(S.prop.body.position.distanceTo(S.pos) < 0.02, `${b.stationName}'s chair moved ${S.prop.body.position.distanceTo(S.pos).toFixed(2)} m under him`);
        const knee = b.rig.tipPos('thighL');
        /* 0.16: a chair standing a few centimetres proud of the well floor
         * (on a cup, a neighbour's leg) raises the seat and the shin cannot
         * reach, so the knee drops a little — still a sitter, not a stander. */
        assert(Math.abs(knee.y - h.y) < 0.16, `${b.stationName}'s thigh is not level: knee ${knee.y.toFixed(2)} hips ${h.y.toFixed(2)}`);
        assert(Math.abs(b.facing - S.yaw) < 0.05 || Math.abs(Math.abs(b.facing - S.yaw) - Math.PI * 2) < 0.05,
          `${b.stationName} faces ${b.facing.toFixed(2)} on a chair facing ${S.yaw.toFixed(2)}`);
        /* The cup: it is a bar. */
        assert(S.cupObj && S.cupObj.parent === world.scene, `${b.stationName} is sitting in a bar without a drink`);
        const hand = b.rig.tipPos('handR');
        assert(S.cupObj.position.distanceTo(hand) < 0.08, `${b.stationName}'s cup is ${S.cupObj.position.distanceTo(hand).toFixed(2)} m from the hand`);
        hipsAbove.push(h.y - q.y);
      }
      /* The step, with people sitting. */
      const mean = ms.reduce((a, x) => a + x, 0) / Math.max(1, ms.length);
      assert(mean <= 2.5, `the step averages ${mean.toFixed(2)} ms with people sitting, against §12.2's 2.5`);

      /* AND UP AGAIN. The hold ends; they rise; the seats are free and every
       * cup is on a table or gone — none left floating in the room. */
      const were = seated.slice();
      for (const b of were) { b.__wasOn = b.seat.prop; b.standIn = 0; }
      step(world, 3, idle);
      for (const b of were) {
        assert(!b.seat, `${b.stationName} is still on the chair`);
        const h = b.rig.hipsBone.obj.position.y - b.position.y;
        assert(h > 0.8, `${b.stationName} stood up to hips at ${h.toFixed(2)}`);
      }
      /* Free, or somebody else's already — the next drinker may have taken it. */
      for (const b of were) assert(life.seats.get(b.__wasOn) !== b, `chair ${b.__wasOn?.id} is still ${b.stationName}'s after he stood`);
      const held = new Set();
      /* EVERY BODY HOLDING ONE, not only the pool's. A cup in a hand is not a
       * cup in the air, and the pool is no longer the only thing that seats
       * somebody: V20 lane 7 sits a named acolyte at a booth in this room at
       * this hour with a drink in his hand, and he is a body of `StationDuel`'s
       * rather than a slot of `life.live`'s. Asking `world.enemies` — which
       * every seated body in the room is in, the pool's included — is the same
       * question with the right population under it. */
      for (const b of world.enemies) if (b?.seat?.cupObj) held.add(b.seat.cupObj);
      if (world.player?.seat?.cupObj) held.add(world.player.seat.cupObj);
      let floating = 0, onTables = 0;
      world.scene.traverse((o) => {
        if (o.name !== 'cup') return;
        if (o.parent === world.scene) { if (!held.has(o)) floating++; }
        else onTables++;
      });
      assert(floating === 0, `${floating} cups left in the air after everybody stood`);
      const lo = Math.min(...hipsAbove), hi = Math.max(...hipsAbove);
      return `${seated.length} seated by ${at} s (peak ${peak}) on ${chairs.length} chairs (${over} were on their sides), hips ${lo.toFixed(2)}–${hi.toFixed(2)} over the seat, every cup in a hand; step ${mean.toFixed(3)} ms; all up again in 3 s, ${onTables} cups on tables`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  THE PLAYER'S OWN SEAT — `StationSit`
   * ════════════════════════════════════════════════════════════════════════ */

  check('seated: the interact key beside a chair sits the player, and a move key stands them up', async () => {
    const { world, idle } = await station(40);
    try {
      const { run: step } = await import('./_coop.mjs');
      const { PLACE } = await import('../../src/game/StationPlan.js');
      const { seatUpright, SEAT_KINDS } = await import('../../src/game/Bars.js');
      const { seatAtHand } = await import('../../src/game/StationSit.js');
      const st = world._station, life = world._stationLife;
      const p = PLACE.get(CANTINA);
      /* Two in the morning: the cantina's chairs are free of the pool. */
      st.hour = 2;
      life.event = null; life.eventFor = 0; life.eventIn = 1e6;
      const pl = world.player;
      pl.position.set(p.door[0], 1.7, p.door[1]);
      pl.body?.position?.set?.(p.door[0], 1.7, p.door[1]);
      step(world, 5, idle);
      const c = Math.cos(p.yaw || 0), sn = Math.sin(p.yaw || 0);
      const inPlace = (q) => {
        const dx = q.x - p.x, dz = q.z - p.z;
        return Math.abs(dx * c - dz * sn) <= p.w / 2 && Math.abs(dx * sn + dz * c) <= p.d / 2;
      };
      const floorY = world.floorAt(p.x, p.z);
      const chairs = world.props.filter((q) => q.kind === 'chair' && inPlace(q.body.position));
      assert(chairs.length >= 4, `${chairs.length} chairs in the cantina`);
      /* The scaffold the pool's clause uses: the chairs on the floor, upright. */
      for (const q of chairs) {
        if (seatUpright(q) && Math.abs(q.body.position.y - floorY) < 0.3) continue;
        const yaw = Math.atan2(p.x - q.body.position.x, p.z - q.body.position.z);
        q.body.setTransform(new THREE.Vector3(q.body.position.x, floorY, q.body.position.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI));
        q.body.velocity.set(0, 0, 0); q.body.angularVelocity.set(0, 0, 0);
        q.mesh.position.copy(q.body.position); q.mesh.quaternion.copy(q.body.quaternion);
      }
      let chair = chairs.find((q) => !life.seats?.has(q));
      if (!chair) {
        /* Every chair taken by the crowd: the sitters are told to rise, and
         * the first chair that comes free is the one. */
        for (const b of life.live.values()) if (b?.seat && chairs.includes(b.seat.prop)) b.standIn = 0;
        step(world, 3, idle);
        chair = chairs.find((q) => !life.seats?.has(q)) || chairs[0];
        if (life.seats?.has(chair)) { const b = life.seats.get(chair); b.seatCool = 1e9; life.seats.delete(chair); if (b.seat?.prop === chair) b.seat = null; }
      }
      /* Stand a metre from it, facing it, and press the key. */
      const q = chair.body.position;
      const floorHere = world.floorAt(q.x, q.z);
      pl.position.set(q.x + 0.8, floorHere, q.z + 0.5);
      pl.body?.setTransform?.(new THREE.Vector3(pl.position.x, floorHere + 0.9, pl.position.z), null);
      pl.facing = Math.atan2(q.x - pl.position.x, q.z - pl.position.z);
      step(world, 0.2, idle);
      pl.facing = Math.atan2(q.x - pl.position.x, q.z - pl.position.z);
      /* A person standing in the talk cone takes the press before a chair
       * does (the talk branch is above the seat's in `stationKey`, by
       * design), so anybody in it is stood four metres aside first. */
      const { residentFacing } = await import('../../src/game/Station.js');
      for (let k = 0; k < 6; k++) {
        const who = residentFacing(world);
        if (!who) break;
        const ax = Math.cos(pl.facing) * 4, az = -Math.sin(pl.facing) * 4;
        who.standCx = (who.standCx ?? who.position.x) + ax; who.standCz = (who.standCz ?? who.position.z) + az;
        who.standTx = who.standCx; who.standTz = who.standCz;
        who.position.x += ax; who.position.z += az;
        who.body?.setTransform?.(who.position, null);
      }
      pl.facing = Math.atan2(q.x - pl.position.x, q.z - pl.position.z);
      assert(seatAtHand(world) === chair || SEAT_KINDS.has(seatAtHand(world)?.kind), `no seat at hand a metre from a chair (${seatAtHand(world)?.kind})`);
      const hit = new Set(['focus']);
      const press = { ...idle, act: (id) => hit.has(id), actHit: (id) => { const h = hit.has(id); hit.delete(id); return h; }, actDown: (id) => hit.has(id) };
      step(world, 0.1, press);
      assert(pl.seat, 'the key did not sit the player');
      assert(life.seats.get(pl.seat.prop) === pl, "the player's chair is not claimed in the pool's map");
      step(world, 1.5, idle);
      assert(pl.seat && pl.seat.blend >= 0.99, `blend ${pl.seat?.blend?.toFixed(2)} after 1.5 s`);
      const hips = pl.rig.hipsBone.obj.position;
      const sq = pl.seat.prop.body.position;
      const d = Math.hypot(hips.x - sq.x, hips.z - sq.z);
      assert(d <= 0.4, `the player's hips are ${d.toFixed(2)} m from the chair`);
      assert(hips.y - sq.y < 0.7, `hips ${(hips.y - sq.y).toFixed(2)} m over the seat — standing`);
      const knee = pl.rig.tipPos('thighL');
      assert(Math.abs(knee.y - hips.y) < 0.12, `thigh not level: knee ${knee.y.toFixed(2)} hips ${hips.y.toFixed(2)}`);
      assert(pl.velocity.lengthSq() < 1e-4, 'the seated player is moving');
      const eye = pl.camera?.eyeHeight ?? null;
      /* Nobody else takes the chair. */
      step(world, 3, idle);
      assert(pl.seat && life.seats.get(pl.seat.prop) === pl, 'the pool took the chair from under the player');
      /* A move key: up, and the chair is free. */
      const walk = { ...idle, moveAxis: (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; } };
      step(world, 0.1, walk);
      assert(pl.seat?.state === 'rise', `a move key did not stand the player (${pl.seat?.state})`);
      step(world, 1.0, idle);
      assert(!pl.seat, 'the player is still on the chair a second after rising');
      assert(!life.seats.has(chair), 'the chair is still claimed after the player stood');
      const up = pl.rig.hipsBone.obj.position.y - pl.position.y;
      assert(up > 0.8, `stood up to hips at ${up.toFixed(2)}`);
      return `sat by the key on a chair at ${(hips.y - sq.y).toFixed(2)} m, held it 3 s, up on a move key${eye !== null ? `, eye ${eye.toFixed(2)}` : ''}`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  SEEDED
   * ════════════════════════════════════════════════════════════════════════ */

  check('seated: the sit verb reads no clock and no Math.random', async () => {
    const src = await readFile(new URL('../../src/game/StationLife.js', import.meta.url), 'utf8');
    const from = src.indexOf('function standHere(');
    const to = src.indexOf('function stepWalkers(');
    assert(from > 0 && to > from, 'the standing section is not where it was');
    const body = src.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const bad of ['Math.random', 'Date.now', 'performance.now']) {
      assert(!body.includes(bad), `the sit verb reads ${bad}`);
    }
    assert(/h2\(a, n \* 5 \+ 7\)/.test(body), 'the sit roll is not off the slot seed');
    assert(/h2\(a, n \* 5 \+ 9\)/.test(body), 'the hold length is not off the slot seed');
    return 'posture, seatClaim and stepStanding: every roll is h2(slot seed, pose count)';
  });
}
