/* TEMPORARY diagnostic probe — deleted before the report. What happens to a
 * lesson's room when the player walks away while the bodies are still crossing? */
export async function run({ check }) {
  const H = await import('./_coop.mjs');
  const walkInput = () => ({
    act: () => false, actHit: () => false, actDown: () => false,
    moveAxis: (o) => { if (o) { o.x = 0; o.y = -1; return o; } return { x: 0, y: -1 }; },
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
  });

  check('the player walks away mid-approach', async () => {
    const { DojoDirector, LESSONS } = await import('../../src/game/Dojo.js');
    const { arrived } = await import('../../src/game/Waves.js');
    const { world } = await H.bootWorld({ level: 'drifts', settings: { mode: 'training', difficulty: 'knight' } });
    const d = world.director;
    const idle = H.idleInput(), walk = walkInput();
    const out = [];
    const P = () => world.player.position;
    for (const id of ['block', 'cut', 'parry']) {
      d.index = LESSONS.findIndex(L => L.id === id); d.progress = 0;
      const start = P().clone();
      d._applyLesson();
      const spawn = world.enemies.map(e => e.position.distanceTo(P()).toFixed(1)).join('/');
      // the player walks for the whole crossing
      let t = 0;
      for (let f = 0; f < 60 * 25; f++) {
        world.player.hp = world.player.maxHp;
        world.update(1 / 60, walk); t += 1 / 60;
        if (world.enemies.length && world.enemies.every(e => arrived(e))) break;
      }
      const moved = P().distanceTo(start);
      const after = world.enemies.map(e => e.position.distanceTo(P()).toFixed(1)).join('/');
      // then stand still for another 6 s and see if anything closes
      for (let f = 0; f < 60 * 6; f++) { world.player.hp = world.player.maxHp; world.update(1 / 60, idle); }
      const settled = world.enemies.map(e => e.position.distanceTo(P()).toFixed(1)).join('/');
      out.push(`${id}: spawn ${spawn} m · player walked ${moved.toFixed(1)} m in ${t.toFixed(1)}s · on arrival ${after} m · +6 s still ${settled} m`);
    }
    world.unload?.(); world.dispose?.();
    return '\n' + out.join('\n');
  });
}
