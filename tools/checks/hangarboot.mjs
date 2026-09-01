export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  check('hangarboot: the deck builds', async () => {
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'hangar',
      settings: { mode: 'hangar', level: 'hangar' },
    });
    assert(world, 'no world');
    assert(world.terrain, 'no terrain');
    assert(!world.command, 'the deck built a CommandDirector — bank() would wipe the roll');
    const meshes = [];
    world.scene.traverse((o) => { if (o.isMesh || o.isInstancedMesh) meshes.push(o); });
    const out = `terrain ${world.terrain.size} · ${meshes.length} meshes · statics ${world.statics.length}`
      + ` · lights ${world.levelLights.length} · director ${world.director?.constructor?.name}`;
    world.unload();
    return out;
  });
}
