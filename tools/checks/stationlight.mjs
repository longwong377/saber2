/**
 * V20 LANE 1 — LIGHT MOODS, KEY SHADOWS, EMISSIVES THAT LIGHT THE FLOOR.
 *
 *   (a) the cantina's key is a different colour and a different intensity at
 *       02:00 than at 12:00, by measurable amounts, and crossing its door
 *       crossfades the two over about `FADE` seconds rather than cutting;
 *   (b) at 'high' the drum has ONE shadow-casting light at a 1024 map, the
 *       room itself does not cast, and the caster sweep holds ≤ `CASTERS`;
 *       at 'low' the whole pass is off and the engine gets its cascades back
 *       when the station is taken down;
 *   (c) at most `LAMPS` point lights are alive at once and they follow the
 *       player from room to room;
 *   (d) every strip within `GLOW_CEIL` of its own floor on deck 40 has a glow
 *       decal under it;
 *   (e) nothing here rolls.
 *
 * THE ENGINE STUB HAS NO CASCADES, so clause (b) hands it three real
 * `DirectionalLight`s through `onWorld` before the level is dressed — the same
 * three `Engine._setupLights` makes, in the same order. A check that cannot
 * see the member under test agrees with any caller, including a broken one
 * (`_coop.stubEngine`'s own note about `skyDome`).
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

/** The station, through the door the game uses — `morning.mjs`'s own helper. */
async function station(deck = 40, quality = 'high', onWorld = null) {
  const { bootWorld, idleInput } = await import('./_coop.mjs');
  const { prepareStation, finishStationBuild } = await import('../../src/game/Station.js');
  diskFetch();
  await prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0, quality },
    onWorld: (w) => { w._stationFloor = deck; onWorld?.(w); },
  });
  finishStationBuild(world);
  return { world, idle: idleInput() };
}

const step = (world, seconds, input) => {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds / dt); i++) world.update(dt, input);
};

/** Stand the player at a point on the active deck's floor. */
function stand(world, x, z) {
  const p = world.player;
  const y = (world.floorAt ? world.floorAt(x, z) : 0) + 1.7;
  p.position.set(x, y, z);
  p.body?.position?.set?.(x, y, z);
}

/** Sum of the absolute channel differences between two `THREE.Color`s. */
const dcol = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

export async function run({ check, assert }) {
  const P = await import('../../src/game/StationPlan.js');
  const SL = await import('../../src/game/StationLight.js');

  /* ════════════════════════════════════════════════════════════════════════
   *  (a) THE MOOD — 02:00 IS NOT 12:00, AND THE DOOR IS A FADE
   * ════════════════════════════════════════════════════════════════════════ */
  check('station light: the cantina at 02:00 is a different key from 12:00, and the door crossfades', async () => {
    /* The table, first, with no world at all: the bands and the two rows. */
    assert(SL.bandOf(2) === 'night' && SL.bandOf(12) === 'day' && SL.bandOf(6) === 'dawn' && SL.bandOf(20) === 'evening',
      `bands ${SL.bandOf(2)}/${SL.bandOf(12)}/${SL.bandOf(6)}/${SL.bandOf(20)}`);

    const { world, idle } = await station(40, 'high');
    try {
      const st = world._station, L = st.light, rig = st.rig;
      assert(L, 'no st.light — dressStationLight did not run');
      const cantina = P.PLACE.get(14);
      assert(cantina && cantina.shape === 'sunkenround', `#14 is ${cantina?.shape}`);

      /* 02:00, standing in the middle of the room. */
      st.hour = 2;
      stand(world, cantina.x, cantina.z);
      step(world, 4, idle);
      assert(L.at === 14, `at 02:00 the mood is ${L.at}, not the cantina`);
      const nightI = rig.key.intensity, nightAmb = rig.amb.intensity;
      const nightC = rig.key.color.clone(), nightStrip = st.mats.strip.emissive.clone();

      /* 12:00, same spot. */
      st.hour = 12;
      step(world, 4, idle);
      const dayI = rig.key.intensity, dayAmb = rig.amb.intensity;
      const dayC = rig.key.color.clone(), dayStrip = st.mats.strip.emissive.clone();

      const dI = Math.abs(dayI - nightI) / Math.max(dayI, nightI);
      assert(dI > 0.25, `the key barely moves between 02:00 and 12:00: ${nightI.toFixed(2)} → ${dayI.toFixed(2)}`);
      assert(dcol(nightC, dayC) > 0.15, `the key is the same colour at both hours (Δ ${dcol(nightC, dayC).toFixed(3)})`);
      assert(dayAmb > nightAmb * 1.5, `the ambient does not flatten by day: ${nightAmb.toFixed(3)} → ${dayAmb.toFixed(3)}`);
      assert(dcol(nightStrip, dayStrip) > 0.05, `the strips are tinted the same at both hours`);

      /* THE DOOR. Stand out on the ring, where `placeUnder` finds no room and
       * the deck's own rig is what is on, then walk into the cantina and read
       * the key on the way. */
      st.hour = 2;
      stand(world, 0, P.DRUM.ringR);
      step(world, 4, idle);
      const outside = rig.key.intensity, outC = rig.key.color.clone();
      assert(L.at !== 14, `standing on the ring the mood is still the cantina`);
      stand(world, cantina.x, cantina.z);
      step(world, 1 / 60, idle);
      const t0 = rig.key.intensity;
      step(world, SL.FADE * 0.5, idle);
      const half = rig.key.intensity, halfC = rig.key.color.clone();
      step(world, SL.FADE * 0.75, idle);
      const done = rig.key.intensity;
      const span = Math.abs(outside - nightI);
      assert(Math.abs(t0 - outside) < span * 0.25, `the door CUT rather than faded (${outside.toFixed(2)} → ${t0.toFixed(2)} on one frame)`);
      assert(Math.abs(half - outside) > span * 0.2 && Math.abs(half - nightI) > span * 0.05,
        `half way through the fade the key is not between the two: ${outside.toFixed(2)} / ${half.toFixed(2)} / ${nightI.toFixed(2)}`);
      assert(Math.abs(done - nightI) < span * 0.08, `the fade did not arrive in ${(SL.FADE * 1.25).toFixed(1)} s: ${done.toFixed(2)} vs ${nightI.toFixed(2)}`);
      assert(dcol(outC, halfC) > 0.005, 'the key colour did not move with the fade');

      return `cantina key 02:00 ${nightI.toFixed(2)} #${nightC.getHexString()} amb ${nightAmb.toFixed(2)} · `
        + `12:00 ${dayI.toFixed(2)} #${dayC.getHexString()} amb ${dayAmb.toFixed(2)}; `
        + `door ${outside.toFixed(2)} → ${half.toFixed(2)} at ${(SL.FADE / 2).toFixed(1)} s → ${done.toFixed(2)} by ${(SL.FADE * 1.25).toFixed(1)} s`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (b) THE SHADOWS — ONE LIGHT, ONE 1024 MAP, ≤ 40 CASTERS, OFF AT 'low'
   * ════════════════════════════════════════════════════════════════════════ */
  check('station light: one shadow-casting light at 1024, the room does not cast, ≤ 40 casters, off at low', async () => {
    const THREE = await import('three');
    /* The three cascades `Engine._setupLights` makes, handed to the stub. */
    const cascades = () => {
      const out = [];
      for (let i = 0; i < 3; i++) {
        const L = new THREE.DirectionalLight(0xffffff, i === 0 ? 3.6 : 0);
        L.castShadow = true;
        L.shadow.mapSize.set(2560, 2560);
        out.push(L);
      }
      return out;
    };

    const hi = await station(40, 'high', (w) => {
      w.engine.cascades = cascades();
      w.engine.sun = w.engine.cascades[0];
    });
    let line = '';
    try {
      const world = hi.world, st = world._station, L = st.light, cas = world.engine.cascades;
      assert(L.shadows, "shadows are off at 'high'");
      assert(cas[0].castShadow && !cas[1].castShadow && !cas[2].castShadow,
        `cascades cast ${cas.map((c) => c.castShadow).join('/')} — the drum wants one`);
      assert(cas[0].shadow.mapSize.x === SL.SHADOW_MAP, `the map is ${cas[0].shadow.mapSize.x}, not ${SL.SHADOW_MAP}`);
      assert(L.statics > 20, `only ${L.statics} static meshes were taken off the shadow pass — the room still casts`);
      let casting = 0;
      for (const m of world.statics) if (m.castShadow) casting++;
      assert(casting === 0, `${casting} of the room's own meshes still cast`);

      /* The sweep, in the busiest room on the deck. */
      const conc = P.PLACE.get(9);
      stand(hi.world, conc.x, conc.z);
      step(world, 3, hi.idle);
      assert(L.casterCount <= SL.CASTERS, `${L.casterCount} casters, over the ${SL.CASTERS} budget`);
      const near = L.casters.length;

      /* AND THE ENGINE GETS ITS OWN BACK. A cantina left on the sun is the
       * next battlefield's light. */
      world.dispose?.();
      assert(cas[0].castShadow && cas[1].castShadow && cas[2].castShadow,
        `the cascades were not put back: ${cas.map((c) => c.castShadow).join('/')}`);
      assert(cas[0].shadow.mapSize.x === 2560, `the map was left at ${cas[0].shadow.mapSize.x}`);
      line = `high: 1 casting light, map ${SL.SHADOW_MAP}, ${L.statics} static meshes off the pass, ${near} casters`;
    } finally { hi.world.dispose?.(); }

    const lo = await station(40, 'low', (w) => {
      w.engine.cascades = cascades();
      w.engine.sun = w.engine.cascades[0];
    });
    try {
      const world = lo.world, st = world._station, L = st.light, cas = world.engine.cascades;
      assert(!L.shadows, "shadows are on at 'low'");
      assert(!cas[0].castShadow && !cas[1].castShadow && !cas[2].castShadow,
        `at low the cascades still cast ${cas.map((c) => c.castShadow).join('/')}`);
      stand(world, P.PLACE.get(9).x, P.PLACE.get(9).z);
      step(world, 3, lo.idle);
      assert(L.casterCount === 0, `at low ${L.casterCount} things cast`);
      assert(L.lamps.length === 0, `at low the lamp pool is ${L.lamps.length}`);
      return `${line}; low: no casting light, 0 casters, 0 lamps`;
    } finally { lo.world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (c) THE LAMPS — TWELVE AT MOST, AND THEY FOLLOW YOU
   * ════════════════════════════════════════════════════════════════════════ */
  check('station light: at most twelve emissive point lights, and they follow the player', async () => {
    const { world, idle } = await station(40, 'high');
    try {
      const st = world._station, L = st.light;
      assert(L.lamps.length <= SL.LAMPS, `the pool is ${L.lamps.length}, over ${SL.LAMPS}`);
      st.hour = 2;
      const cantina = P.PLACE.get(14);
      stand(world, cantina.x, cantina.z);
      step(world, 2, idle);
      const litA = L.lamps.filter((l) => l.intensity > 0);
      assert(litA.length > 0, 'nothing is lit in the cantina at 02:00');
      assert(litA.length <= SL.LAMPS, `${litA.length} lamps alive`);
      let farA = 0;
      for (const l of litA) farA = Math.max(farA, l.position.distanceTo(world.player.position));
      assert(farA <= SL.LAMP_REACH + 1, `a lamp is ${farA.toFixed(1)} m away, past the ${SL.LAMP_REACH} m reach`);
      const whereA = litA.map((l) => `${l.position.x.toFixed(1)},${l.position.z.toFixed(1)}`).join(' ');

      /* Cross the deck. The lamps must be somewhere else. */
      const arb = P.PLACE.get(23);
      stand(world, arb.x, arb.z);
      step(world, 2, idle);
      const litB = L.lamps.filter((l) => l.intensity > 0);
      assert(litB.length > 0, 'nothing is lit in the arboretum');
      let farB = 0;
      for (const l of litB) farB = Math.max(farB, l.position.distanceTo(world.player.position));
      assert(farB <= SL.LAMP_REACH + 1, `after moving, a lamp is ${farB.toFixed(1)} m away`);
      const whereB = litB.map((l) => `${l.position.x.toFixed(1)},${l.position.z.toFixed(1)}`).join(' ');
      assert(whereA !== whereB, 'the lamps did not move when the player did');
      return `${litA.length} lamps in #14 (furthest ${farA.toFixed(1)} m), ${litB.length} in #23 (furthest ${farB.toFixed(1)} m), pool ${L.lamps.length}`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (d) THE DECALS — UNDER EVERY STRIP ON DECK 40
   * ════════════════════════════════════════════════════════════════════════ */
  check('station light: a glow decal under every strip within reach of its own floor on deck 40', async () => {
    const { world } = await station(40, 'high');
    try {
      const st = world._station, L = st.light;
      let strips = 0, low = 0, missing = 0, high = 0, under = 0;
      const rooms = new Set();
      for (const f of L.fixtures) {
        if (f.kind !== 'strip') continue;
        strips++;
        const h = f.y - world.floorAt(f.x, f.z);
        if (h > SL.GLOW_CEIL) { high++; continue; }
        if (h < -0.5) { under++; continue; }
        low++;
        if (!f.glow) { missing++; continue; }
        rooms.add(f.place);
      }
      assert(strips > 60, `only ${strips} strip fixtures were found on the whole of deck 40`);
      assert(missing === 0, `${missing} of ${low} reachable strips have no decal under them`);
      assert(L.decals.length >= 8, `only ${L.decals.length} rooms carry a decal sheet`);
      assert(L.decalCount >= low, `${L.decalCount} decals for ${low} strips and their screens`);
      /* And they are on the floor and additive, which is what keeps them out
       * of the ink prepass — see `Ink.cutsItsOwnSilhouette`. */
      const { cutsItsOwnSilhouette } = await import('../../src/toon/Ink.js');
      assert(cutsItsOwnSilhouette(L.glowMat), 'the glow material would be inked — it would read as a sticker');
      return `${strips} strips (${low} within ${SL.GLOW_CEIL} m of a floor, ${high} above it, ${under} under one), `
        + `${L.decalCount} decals over ${L.decals.length} rooms, ${rooms.size} rooms with a lit floor`;
    } finally { world.dispose?.(); }
  });

  /* ════════════════════════════════════════════════════════════════════════
   *  (e) NOTHING ROLLS
   * ════════════════════════════════════════════════════════════════════════ */
  check('station light: no Math.random', async () => {
    const src = await readFile(new URL('../../src/game/StationLight.js', import.meta.url), 'utf8');
    assert(!/Math\.random/.test(src), 'StationLight.js calls Math.random');
    return 'src/game/StationLight.js';
  });
}
