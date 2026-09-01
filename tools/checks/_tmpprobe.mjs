export async function run({ check }) {
  check('survives', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({ level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0 } });
    const terrain = world.terrain;
    const st = world._deckAudio;
    const horns = JSON.stringify(st?.horns);
    const vents = JSON.stringify(st?.ventSites);
    const before = terrain.height(0,0).toFixed(4) + '/' + terrain.height(-52,-8).toFixed(3) + '/' + terrain.surfaceAt(0, 140);
    world.unload();
    let after = 'n/a';
    try { after = terrain.height(0,0).toFixed(4) + '/' + terrain.height(-52,-8).toFixed(3) + '/' + terrain.surfaceAt(0,140); } catch(e) { after = 'THREW ' + e.message; }
    return `horns=${horns} vents=${vents} before=${before} after=${after}`;
  });
}
