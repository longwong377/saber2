/* TEMPORARY probe — level-swap leak hunt. Delete before finishing. */
export async function run({ check }) {
  check('probe', async () => {
    const H = await import('./_coop.mjs');
    const { LEVEL_ORDER } = await import('../../src/game/Levels.js');
    const { world } = await H.bootWorld({ level: LEVEL_ORDER[0], settings: { mode: 'roguelite', quality: 'low' } });
    const input = H.idleInput();
    const rows = [];
    const snap = (tag) => {
      let n = 0; world.scene.traverse(() => n++);
      rows.push({
        tag,
        sceneKids: world.scene.children.length,
        sceneAll: n,
        bodies: world.physics?.bodies?.length ?? world.physics?.bodies?.size ?? -1,
        statics: world.statics.length,
        props: world.props.length,
        enemies: world.enemies.length,
        players: world.players.length,
        targets: world._targets.length,
        foes: world._foes?.length ?? -1,
        caps: world._capsCache.length,
        corpses: world.corpses?.list?.length ?? -1,
        heapMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
      });
    };
    snap('boot ' + LEVEL_ORDER[0]);
    world.director.start(1);
    for (let i = 0; i < 300; i++) world.update(1 / 60, input);
    snap('after 5s of wave 1');
    for (let pass = 0; pass < 2; pass++) {
      for (const key of LEVEL_ORDER) {
        world.loadLevel(key);
        world.spawnPlayer({ name: 'Jedi', isLocal: true });
        world.director.start(1);
        for (let i = 0; i < 120; i++) world.update(1 / 60, input);
        snap(`p${pass} ${key}`);
      }
    }
    if (global.gc) global.gc();
    snap('after gc');
    return '\n' + rows.map(r => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' ')).join('\n');
  });
}
