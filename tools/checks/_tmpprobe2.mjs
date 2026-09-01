export async function run({ check, assert }) {
  check('probe', async () => {
    const H = await import('../../src/game/Hangar.js');
    const K = await import('../../src/game/DeckKit.js');
    const out = [];
    for (const f of K.FACTIONS) {
      const kit = new K.DeckBuild(f), paint = new K.Paint(f);
      H.__deckParts.structure(kit, paint);
      const names = [...kit.bins.keys()].map(m => m.name);
      out.push(f + ' -> ' + names.join(',') + ' | prims ' + kit.count);
    }
    return out.join('\n    ');
  });
}
