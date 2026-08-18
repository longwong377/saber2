export async function run({ check }) {
  check('build the ships', async () => {
    const H = await import('./_coop.mjs');
    const out = [];
    for (const key of ['hangar', 'warship']) {
      try {
        const t0 = Date.now();
        const { world } = await H.bootWorld({ level: key, settings: { quality: 'low', mode: 'roguelite' } });
        let nodes = 0; world.scene.traverse(() => nodes++);
        out.push(`${key}: ok in ${Date.now()-t0}ms  statics=${world.statics.length} props=${world.props.length} doors=${world.doors.length} lights=${world.levelLights.length} nodes=${nodes} kids=${world.scene.children.length} player=${world.player.position.toArray().map(v=>v.toFixed(1)).join(',')}`);
        world.dispose();
      } catch (e) { out.push(`${key}: THROWS ${e.message}\n   ${e.stack.split('\n')[1]}`); }
    }
    return '\n' + out.join('\n');
  });
}
