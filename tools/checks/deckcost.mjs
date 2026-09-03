/**
 * WHERE THE DECK SPENDS ITS DRAW CALLS — a breakdown, printed, so the next
 * thing that forgets to compose is named rather than noticed.
 *
 * Two readings. The room's, by the nearest named ancestor of every visible
 * mesh, which is what a `DeckBuild` or a `Kit` stamps; and DeckLife's, by
 * FAMILY, walked off `world._deckLife`'s own state — droids, workers, hulls,
 * silhouettes, jobs, cranes, sleds, emitters — because a traverse of the
 * finished room buckets a worker's skinned mesh and a crane's load into the
 * same anonymous `Mesh`.
 *
 * The bound on DeckLife's share is `decklife.mjs`'s; this one only has to be
 * honest about what the number is made of. The one assertion here is that
 * the families it names all exist, so a family that stops being built is a
 * red line and not a smaller total.
 */
export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  check('deckcost: where the deck spends its draw calls, by family', async () => {
    const { bootWorld, idleInput, run } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 } });
    try {
      /* A second of frames, so the workers have baked. */
      run(world, 1, idleInput());
      const H = await import('../../src/game/Hangar.js');
      const THREE = await import('three');
      const { propMaterials } = await import('../../src/world/Props.js');
      const count = (fn) => {
        const w2 = { scene: new THREE.Scene(), statics: [], levelLights: [],
          physics: { addStaticBox() {}, staticBoxes: [], add() {}, remove() {} },
          terrain: world.terrain, notify() {}, particles: world.particles, settings: {} };
        try { fn(w2, propMaterials()); } catch (e) { return `THREW ${e.message.slice(0, 40)}`; }
        let n = 0;
        w2.scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) n++; });
        return n;
      };
      const parts = H.__deckParts ? Object.entries(H.__deckParts).map(([k, fn]) => `${k}=${count(fn)}`) : [];

      const on = (o) => { let v = o.visible; for (let p = o.parent; v && p; p = p.parent) v = p.visible; return v; };
      const by = new Map();
      world.scene.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        if (!on(o)) return;
        let tag = o.name || '';
        for (let p = o.parent; !tag && p; p = p.parent) tag = p.name || '';
        tag = tag || (o.material?.name) || o.type;
        by.set(tag, (by.get(tag) | 0) + 1);
      });
      const rows = [...by].sort((a, b) => b[1] - a[1]).slice(0, 8);
      const total = [...by.values()].reduce((a, b) => a + b, 0);

      /* DECKLIFE'S SHARE, BY FAMILY. */
      const life = world._deckLife;
      const fam = {};
      const add = (name, o) => {
        if (!o) return;
        let n = 0, t = 0;
        o.traverse?.((m) => {
          if (!(m.isMesh || m.isInstancedMesh) || !on(m)) return;
          n++;
          const g = m.geometry;
          t += (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1);
        });
        fam[name] = fam[name] || { meshes: 0, tris: 0 };
        fam[name].meshes += n; fam[name].tris += Math.round(t);
      };
      if (life) {
        add('haze', life.haze); add('emitters', life.glows);
        for (const r of life.rings) add('rings', r.mesh);
        for (const m of life.bay.meshes) add('jobs', m);
        for (const im of Object.values(life.droidMeshes)) add('droids', im);
        for (const im of Object.values(life.droidParts)) add('droid-parts', im);
        add('trolley', life.trolley.body);
        for (const c of life.cranes) add('cranes', c.body);
        add('sleds', life.sleds.mesh);
        for (const w of life.workers) add('workers', w.root);
        for (const im of Object.values(life.silMeshes)) add('crowd', im);
        for (const im of Object.values(life.kitMeshes)) add('crowd-kit', im);
        for (const im of Object.values(life.looseMeshes)) add('loose', im);
        if (life.beats) { add('beats', life.beats.rams); add('beats', life.beats.cable); add('beats', life.beats.load); if (life.beats.canopy) add('beats', life.beats.canopy); }
        if (life.boards) add('boards', life.boards.mesh);
        add('silhouettes', life.traffic.farF); add('silhouettes', life.traffic.farS);
        for (const Hh of life.traffic.plan.hulls) Hh.cast.group.traverse((m) => { if (m.isMesh) add('hulls', m); });
        for (const P of life.parked) { if (P.cast) P.cast.group.traverse((m) => { if (m.isMesh) add('parked', m); }); if (P.plat) add('parked', P.plat); }
        if (life.taxi) life.taxi.cast.group.traverse((m) => { if (m.isMesh) add('taxi', m); });
      }
      for (const k of ['droids', 'droid-parts', 'workers', 'crowd', 'crowd-kit', 'loose', 'beats', 'boards', 'hulls', 'parked', 'taxi', 'silhouettes', 'jobs', 'cranes', 'sleds', 'emitters']) {
        assert(fam[k] && fam[k].meshes > 0, `DeckLife built no ${k} — a family of the deck's life is gone`);
      }
      const mine = Object.values(fam).reduce((a, f) => a + f.meshes, 0);
      const tris = Object.values(fam).reduce((a, f) => a + f.tris, 0);
      /* THE ORDER-OF-MAGNITUDE PASS, measured: this line used to read
       * "DeckLife 58: … droids=23/8768t … workers=13/95472t" for fifteen
       * droids and thirteen men. The before/after is printed so the next
       * reader has both numbers in one place. */
      return `${total} visible · DeckLife ${mine} meshes / ${tris}t (was 58 / 118k before the order-of-magnitude pass): `
        + Object.entries(fam).map(([k, f]) => `${k}=${f.meshes}/${f.tris}t`).join(' ')
        + ` · room ${parts.join(' ')} · ` + rows.map(([k, n]) => `${k || '(unnamed)'}=${n}`).join(' ');
    } finally { try { world.unload(); } catch {} }
  });
}
