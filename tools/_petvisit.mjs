/**
 * THROWAWAY PROBE — does a guest's companion stand in their apartment on the
 * OTHER machine? Deleted when the lane lands.
 *
 *   node --import ./tools/register.mjs tools/_petvisit.mjs
 */
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

async function main() {
  const { bootSession } = await import('./checks/_coop.mjs');
  const { prepareStation } = await import('../src/game/Station.js');
  const Coop = await import('../src/game/Coop.js');
  const H = await import('../src/game/Home.js');
  const K = await import('../src/game/Kennel.js');
  const S = await import('../src/game/StationSave.js');
  const Net = await import('../src/net/Net.js');
  const CK = await import('../src/game/CompanionKinds.js');
  const Input = (await import('../src/engine/Input.js')).default
    || await import('../src/engine/Input.js');

  diskFetch();
  await prepareStation();
  S.clearStation();

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

  const s = await bootSession({
    n: 2, level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = 44; },
  });
  for (const nd of s.nodes) {
    nd.notes = [];
    nd.net.on('home', (from, msg) => nd.notes.push(Coop.noteApartment(nd.world, from, msg)));
  }
  s.pump(0.5);

  const host = s.host, guest = s.clients[0];
  const hostId = host.net.peer.id;

  /* THE HOST CHOOSES A FIXTURE at the habitat — the shipped verb, which
   * re-dresses their own room on the same call. */
  const t0 = Date.now();
  H.setPad('basket', host.world);
  P(`setPad('basket') on the host: ${Date.now() - t0} ms (fixture + one seating)`);
  s.pump(0.6);

  /* THE PACKET, as it actually crossed. */
  const msg = Coop.packHome(host.world._home.state, 1, H.homePetIdent?.() ?? null);
  P(`home packet: ${JSON.stringify(msg)}`);
  P(`home packet bytes: ${JSON.stringify(msg).length}`);
  const st = Coop.coopState(host.world);
  P(`session so far: ${st.sends} home packets, ${st.bytes} B`);

  /* THE SNAPSHOT, which this lane must not have grown. */
  const snap = Net.packSnapshot(host.world);
  P(`snapshot: ${JSON.stringify(snap).length} B, ${snap.e.length} enemy rows`);

  /* ── THE HOST'S OWN ROOM, on the host ─────────────────────────────────── */
  const mine = host.world._home;
  P(`host's own cabin #${mine.place.id} pad=${mine.state.pad} `
    + `body=${mine.pad?.body ? mine.pad.body.rec.kind : 'NOTHING'}`);

  /* ── AND NOW THE GUEST'S MACHINE ──────────────────────────────────────── */
  /* THE SHARED FOLD IS THE TRAP: `localStorage` is one store per process, so
   * both simulated players read ONE Kennel. Emptying it before the guest
   * dresses the host's room means anything standing in there came off the
   * wire and could not have come from a local read. */
  K.clear();
  P(`kennel cleared on this process: live=${K.load().live}`);

  const row = Coop.apartment(guest.world, hostId);
  P(`guest holds the host's home: place=#${row?.place} seq=${row?.seq} `
    + `pad=${row?.rec?.pad ?? 'none'} pet=${JSON.stringify(row?.pet ?? null)}`);
  /* Force the re-dress that the wire's new fields should drive. */
  if (row?.h) { H.undressApartment(guest.world, row.h); row.h = null; row.drawn = -1; }
  const tD = Date.now();
  const drew = Coop.dressApartments(guest.world);
  P(`dressApartments on the guest: ${drew} room(s), ${Date.now() - tD} ms`);

  const theirs = Coop.apartment(guest.world, hostId)?.h;
  if (!theirs) { P('THE GUEST HAS NOT DRESSED THE HOST\'S APARTMENT AT ALL'); }
  else {
    /* WALK IN. Real position, real `homeUnder`. */
    guest.world.player.position.set(theirs.spot.x, theirs.y + 1.6, theirs.spot.z);
    const under = H.homeUnder(guest.world);
    P(`the guest stands in #${under?.spot.id} (mine=${under?.mine}) owner=${under?.owner?.name}`);
    /* A real key press, spent where the game spends it. */
    try { Input.touchHitSet?.add?.('focus'); } catch {}
    const pad = theirs.pad;
    P(`fixture: ${pad ? pad.id : 'NONE'}${pad ? ` at (${pad.at.x.toFixed(2)}, ${pad.at.y.toFixed(2)}, ${pad.at.z.toFixed(2)}) rest=${pad.rest}` : ''}`);
    const rootB = pad?.root;
    if (!rootB) P('WHAT IS STANDING ON IT: NOTHING');
    else {
      let meshes = 0, tris = 0;
      rootB.updateMatrixWorld(true);
      rootB.traverse((o) => {
        if (!o.isMesh) return;
        meshes++;
        const idx = o.geometry?.index;
        tris += idx ? idx.count / 3 : (o.geometry?.attributes?.position?.count || 0) / 3;
      });
      const THREE = await import('../vendor/three/three.module.js');
      const box = new THREE.Box3().setFromObject(rootB);
      P(`WHAT IS STANDING ON IT: ${pad.body.rec.kind} — ${meshes} meshes, ${Math.round(tris)} tris`);
      P(`  world position (${rootB.position.x.toFixed(3)}, ${rootB.position.y.toFixed(3)}, ${rootB.position.z.toFixed(3)})`);
      P(`  feet at y=${box.min.y.toFixed(4)}, fixture rest surface y=${(theirs.y + pad.rest).toFixed(4)}, `
        + `feet above fixture = ${((box.min.y - (theirs.y + pad.rest)) * 1000).toFixed(2)} mm`);
      P(`  size ${(box.max.x - box.min.x).toFixed(2)} × ${(box.max.y - box.min.y).toFixed(2)} × ${(box.max.z - box.min.z).toFixed(2)} m`);
      P(`  stage on the wire ${JSON.stringify(row?.pet ?? null)}`);
      const d = Math.hypot(rootB.position.x - pad.at.x, rootB.position.z - pad.at.z);
      P(`  ${(d * 1000).toFixed(2)} mm off the fixture in plan`);
    }
  }

  /* ── AND WHAT FOUR APARTMENTS COST ────────────────────────────────────── */
  const K2 = { kinds: ['tooka', 'hawk', 'astro'] };
  for (const kind of K2.kinds) {
    const r2 = K.readOne({ id: `t-${kind}`, kind, runs: 8, meals: 6 });
    const KK = CK.COMPANION_KINDS[kind];
    const A = CK.COMPANION_UNITS[KK.archetype];
    const { companionOptsFrom } = await import('../src/game/Bodies.js');
    const t = Date.now();
    const b = A.build({ scale: CK.bodyScaleOf(kind, r2), ...companionOptsFrom(r2.look),
      ...CK.growthOptsFrom(kind, r2) });
    const ms = Date.now() - t;
    let n = 0; (b.rig?.root || b.group).traverse((o) => { if (o.isMesh) n++; });
    P(`build ${kind}: ${ms} ms, ${n} meshes`);
  }

  for (const nd of s.nodes) nd.world.dispose?.();
  s.close();
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
