/**
 * THROWAWAY PROBE — does a guest's companion stand in their apartment on the
 * OTHER machine? Deleted when the lane lands.
 *
 *   node --import ./tools/register.mjs tools/_petvisit.mjs
 */
import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';

function diskFetch() {
  if (globalThis.fetch && globalThis.__stationFetch) return;
  const root = new URL('../', import.meta.url);
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

const P = (...a) => console.log(...a);

async function boot(n) {
  const { bootSession } = await import('./checks/_coop.mjs');
  const Coop = await import('../src/game/Coop.js');
  const s = await bootSession({
    n, level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = 44; },
  });
  for (const nd of s.nodes) {
    nd.notes = [];
    nd.net.on('home', (from, msg) => nd.notes.push(Coop.noteApartment(nd.world, from, msg)));
  }
  s.safePump = (t) => { try { s.pump(t); } catch (e) { P(`(pump: ${e.message})`); } };
  s.safePump(0.5);
  return s;
}

async function main() {
  const { prepareStation } = await import('../src/game/Station.js');
  const Coop = await import('../src/game/Coop.js');
  const H = await import('../src/game/Home.js');
  const K = await import('../src/game/Kennel.js');
  const S = await import('../src/game/StationSave.js');
  const Net = await import('../src/net/Net.js');
  const CK = await import('../src/game/CompanionKinds.js');
  const THREE = await import('../vendor/three/three.module.js');

  diskFetch();
  await prepareStation();
  S.clearStation();
  K.clear();

  /* ═══ PART ONE — A GUEST WALKS INTO THE HOST'S CABIN ══════════════════ */
  const s = await boot(2);
  const host = s.host, guest = s.clients[0];
  const hostId = host.net.peer.id;

  /* THE HOST'S ANIMAL, seated deterministically: a tooka kit that has done
   * eight runs and been looked after six times, which is SEASONED (stage 2) —
   * so "the right growth stage" is a claim with a wrong answer available. */
  const rec = K.readOne({ id: 'probe-1', kind: 'tooka', name: 'PIP', xp: 40,
    runs: 8, meals: 3, grooms: 2, plays: 1 });
  K.save({ ...K.blank(), live: rec });
  P(`kennel: ${rec.kind} runs=${rec.runs} care=${rec.meals + rec.grooms + rec.plays} `
    + `stage=${CK.stageOf(rec)}/${CK.GROWTH_STAGES.length - 1} `
    + `(${CK.GROWTH_STAGES[CK.stageOf(rec)].label}) scale=${CK.bodyScaleOf(rec.kind, rec).toFixed(3)} `
    + `suit=${H.padSuit(rec.kind)}`);

  /* BEFORE: the packet with no fixture and no animal on it, which is what this
   * wire carried until this lane. */
  P(`BEFORE  home packet ${JSON.stringify(Coop.packHome(host.world._home.state, 1)).length} B: `
    + JSON.stringify(Coop.packHome(host.world._home.state, 1)));

  /* THE HOST CHOOSES A FIXTURE at the habitat — the shipped verb, which
   * re-dresses their own room on the same call. */
  const t0 = Date.now();
  H.setPad('basket', host.world);
  P(`setPad('basket') on the host: ${Date.now() - t0} ms (fixture + one seating)`);
  s.safePump(0.6);

  const msg = Coop.packHome(host.world._home.state, 1, H.homePetIdent());
  P(`AFTER   home packet ${JSON.stringify(msg).length} B: ${JSON.stringify(msg)}`);
  const st = Coop.coopState(host.world);
  P(`session so far: ${st.sends} home packets, ${st.bytes} B, ${st.refused} refused`);

  /* THE SNAPSHOT, which this lane must not have grown. `e: []` for a stable
   * number — the enemy rows are whoever happens to be walking past. */
  const snap = Net.packSnapshot(host.world);
  P(`snapshot: ${JSON.stringify(snap).length} B with ${snap.e.length} enemy rows, `
    + `${JSON.stringify({ ...snap, e: [] }).length} B with none`);

  const mine = host.world._home;
  P(`host's own cabin #${mine.place.id} pad=${mine.state.pad} `
    + `body=${mine.pad?.body ? mine.pad.body.rec.kind : 'NOTHING'}`);

  /* THE SHARED FOLD IS THE TRAP: `localStorage` is one store per process, so
   * both simulated players read ONE Kennel. Emptying it before the guest
   * dresses the host's room means anything standing in there came off the wire
   * and could not have come from a local read. */
  K.clear();
  P(`kennel cleared on this process: live=${K.load().live}`);

  const row = Coop.apartment(guest.world, hostId);
  P(`the guest holds the host's home: place=#${row?.place} seq=${row?.seq} `
    + `pad=${row?.rec?.pad ?? 'none'} pet=${JSON.stringify(row?.pet ?? null)}`);
  if (row?.h) { H.undressApartment(guest.world, row.h); row.h = null; row.drawn = -1; }
  const tD = Date.now();
  const drew = Coop.dressApartments(guest.world);
  P(`dressApartments on the guest: ${drew} room(s), ${Date.now() - tD} ms`);

  const theirs = Coop.apartment(guest.world, hostId)?.h;
  if (!theirs) P("THE GUEST HAS NOT DRESSED THE HOST'S APARTMENT AT ALL");
  else {
    /* WALK IN. Real position, real `homeUnder`. */
    guest.world.player.position.set(theirs.spot.x, theirs.y + 1.6, theirs.spot.z);
    const under = H.homeUnder(guest.world);
    P(`the guest stands in #${under?.spot.id} (mine=${under?.mine}) owner=${under?.owner?.name}`);
    const pad = theirs.pad;
    P(`fixture: ${pad ? pad.id : 'NONE'}`
      + (pad ? ` at (${pad.at.x.toFixed(2)}, ${pad.at.y.toFixed(2)}, ${pad.at.z.toFixed(2)}) rest=${pad.rest}` : ''));
    const root = pad?.root;
    if (!root) P('WHAT IS STANDING ON IT: NOTHING');
    else {
      let meshes = 0, tris = 0;
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        meshes++;
        const idx = o.geometry?.index;
        tris += idx ? idx.count / 3 : (o.geometry?.attributes?.position?.count || 0) / 3;
      });
      const box = new THREE.Box3().setFromObject(root);
      P(`WHAT IS STANDING ON IT: ${pad.body.rec.kind} at stage ${pad.body.rec.stage} — `
        + `${meshes} meshes, ${Math.round(tris)} tris`);
      P(`  world position (${root.position.x.toFixed(3)}, ${root.position.y.toFixed(3)}, ${root.position.z.toFixed(3)})`);
      P(`  feet y=${box.min.y.toFixed(4)}, fixture surface y=${(theirs.y + pad.rest).toFixed(4)}, `
        + `feet above fixture ${((box.min.y - (theirs.y + pad.rest)) * 1000).toFixed(2)} mm`);
      P(`  ${(Math.hypot(root.position.x - pad.at.x, root.position.z - pad.at.z) * 1000).toFixed(2)} mm off it in plan`);
      P(`  size ${(box.max.x - box.min.x).toFixed(2)} × ${(box.max.y - box.min.y).toFixed(2)} × ${(box.max.z - box.min.z).toFixed(2)} m`);
    }
  }

  /* AND A HOST WITH NO ANIMAL PUBLISHES NOTHING TO SEAT. */
  P(`with the kennel empty the host would publish: `
    + JSON.stringify(Coop.packHome(host.world._home.state, 9, H.homePetIdent())));

  for (const nd of s.nodes) nd.world.dispose?.();
  s.close();

  /* ═══ PART TWO — WHAT FOUR APARTMENTS COST ════════════════════════════ */
  S.clearStation();
  K.save({ ...K.blank(), live: rec });
  const s4 = await boot(4);
  const H4 = s4.host;
  const fixtures = ['basket', 'perch', 'charge', 'basket'];
  for (let i = 0; i < s4.nodes.length; i++) H.setPad(fixtures[i], s4.nodes[i].world);
  s4.safePump(0.8);
  const st4 = Coop.coopState(H4.world);
  P(`four players: ${st4.homes.size} guest homes held, ${st4.sends} sends, ${st4.bytes} B, `
    + `${st4.refused} refused`);
  P(`  held: ${[...st4.homes.values()].map((r) => `${r.rec.pad}/${r.pet?.kind || 'none'}@${r.pet?.stage ?? '-'}`).join(', ')}`);

  const redress = (withPet) => {
    const kept = [];
    for (const r of st4.homes.values()) {
      if (r.h) { H.undressApartment(H4.world, r.h); r.h = null; }
      r.drawn = -1;
      kept.push([r, r.pet]);
      if (!withPet) r.pet = null;
    }
    const t = Date.now();
    const n = Coop.dressApartments(H4.world);
    const ms = Date.now() - t;
    for (const [r, pet] of kept) r.pet = pet;
    let seated = 0;
    for (const r of st4.homes.values()) if (r.h?.pad?.root) seated++;
    return { n, ms, seated };
  };
  for (let i = 0; i < 2; i++) {
    const cold = redress(false);
    P(`3 guest apartments dressed with NO animal: ${cold.ms} ms, ${cold.seated} seated`);
  }
  for (let i = 0; i < 3; i++) {
    const hot = redress(true);
    P(`3 guest apartments dressed WITH an animal: ${hot.ms} ms, ${hot.seated} seated`);
  }
  /* …and the fourth is the host's own, seated when the fixture is chosen. */
  const own = H4.world._home;
  const t2 = Date.now();
  H.setPad('perch', H4.world);
  P(`the host's own (the 4th): ${Date.now() - t2} ms, seated=${!!own.pad?.root}`);

  for (const nd of s4.nodes) nd.world.dispose?.();
  s4.close();
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
