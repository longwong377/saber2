export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  check('deckcost: where the deck spends its draw calls', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 } });
    try {
      /* PER DRESSING PASS, by building them one at a time on a bare scene —
       * the only way to get a number that names a caller. A traverse of the
       * finished room buckets everything into one anonymous `Mesh`. */
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

      const by = new Map();
      world.scene.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        let on = o.visible;
        for (let p = o.parent; on && p; p = p.parent) on = p.visible;
        if (!on) return;
        /* Name it by the nearest named ancestor, which is what a Kit stamps. */
        let tag = o.name || '';
        for (let p = o.parent; !tag && p; p = p.parent) tag = p.name || '';
        tag = tag || (o.material?.name) || o.type;
        by.set(tag, (by.get(tag) | 0) + 1);
      });
      const rows = [...by].sort((a, b) => b[1] - a[1]).slice(0, 18);
      const total = [...by.values()].reduce((a, b) => a + b, 0);
      world.unload();
      return `${total} visible · ${parts.join(' ')} · `
        + rows.slice(0, 6).map(([k, n]) => `${k || '(unnamed)'}=${n}`).join(' ');
    } catch (e) { try { world.unload(); } catch {} throw e; }
  });
}
