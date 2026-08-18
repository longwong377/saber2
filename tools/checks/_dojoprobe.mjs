export async function run({ check }) {
  const H = await import('./_coop.mjs');
  const walkInput = () => ({
    act: () => false, actHit: () => false, actDown: () => false,
    moveAxis: (o) => { if (o) { o.x = 0; o.y = -1; return o; } return { x: 0, y: -1 }; },
    mouse: { dx: 0, dy: 0, wheel: 0, left: false, right: false },
    delta: { x: 0, y: 0 }, accel: { x: 0, y: 0 }, end() {},
  });

  check('A. still player: how long does the room take to stand up', async () => {
    const { LESSONS } = await import('../../src/game/Dojo.js');
    const { arrived } = await import('../../src/game/Waves.js');
    const { world } = await H.bootWorld({ level: 'drifts', settings: { mode: 'training', difficulty: 'knight' } });
    const d = world.director; const input = H.idleInput(); const P = () => world.player.position;
    const out = []; let total = 0;
    for (let i = 0; i < LESSONS.length; i++) {
      d.index = i; d.progress = 0; d._applyLesson();
      const d0 = world.enemies.map(e => e.position.distanceTo(P()).toFixed(1)).join('/');
      let t = 0;
      for (let f = 0; f < 60 * 30; f++) {
        world.player.hp = world.player.maxHp; world.update(1 / 60, input); t += 1 / 60;
        if (!world.enemies.length || world.enemies.every(e => arrived(e))) break;
      }
      total += t;
      const d1 = world.enemies.map(e => e.position.distanceTo(P()).toFixed(1)).join('/');
      out.push(`${LESSONS[i].id.padEnd(8)} n=${world.enemies.length} enters@[${d0}] -> ${t.toFixed(1)}s -> @[${d1}]`);
    }
    world.unload?.(); world.dispose?.();
    return `\n${out.join('\n')}\nTOTAL crossing across the eleven lessons: ${total.toFixed(1)} s`;
  });

  check('B. the player walks away mid-approach', async () => {
    const { LESSONS } = await import('../../src/game/Dojo.js');
    const { arrived } = await import('../../src/game/Waves.js');
    const { world } = await H.bootWorld({ level: 'drifts', settings: { mode: 'training', difficulty: 'knight' } });
    const d = world.director; const idle = H.idleInput(), walk = walkInput(); const P = () => world.player.position;
    const out = [];
    for (const id of ['block', 'cut', 'parry', 'free']) {
      d.index = LESSONS.findIndex(L => L.id === id); d.progress = 0;
      const start = P().clone(); d._applyLesson();
      let t = 0;
      for (let f = 0; f < 60 * 10; f++) { world.player.hp = world.player.maxHp; world.update(1 / 60, walk); t += 1 / 60; }
      const moved = P().distanceTo(start);
      const after = world.enemies.map(e => e.position.distanceTo(P()).toFixed(1)).join('/');
      for (let f = 0; f < 60 * 8; f++) { world.player.hp = world.player.maxHp; world.update(1 / 60, idle); }
      const settled = world.enemies.map(e => e.position.distanceTo(P()).toFixed(1)).join('/');
      out.push(`${id.padEnd(6)} player walked ${moved.toFixed(1)} m in ${t.toFixed(1)}s · then @[${after}] · +8 s standing @[${settled}]`);
    }
    world.unload?.(); world.dispose?.();
    return '\n' + out.join('\n');
  });

  check('C. the player leaves AFTER the room has stood up', async () => {
    const { LESSONS } = await import('../../src/game/Dojo.js');
    const { world } = await H.bootWorld({ level: 'drifts', settings: { mode: 'training', difficulty: 'knight' } });
    const d = world.director; const idle = H.idleInput(), walk = walkInput(); const P = () => world.player.position;
    d.index = LESSONS.findIndex(L => L.id === 'cut'); d.progress = 0; d._applyLesson();
    for (let f = 0; f < 60 * 6; f++) { world.player.hp = world.player.maxHp; world.update(1 / 60, idle); }
    const stood = world.enemies.map(e => e.position.distanceTo(P()).toFixed(1)).join('/');
    for (let f = 0; f < 60 * 15; f++) { world.player.hp = world.player.maxHp; world.update(1 / 60, walk); }
    const gone = world.enemies.map(e => e.position.distanceTo(P()).toFixed(1)).join('/');
    for (let f = 0; f < 60 * 10; f++) { world.player.hp = world.player.maxHp; world.update(1 / 60, idle); }
    const back = world.enemies.map(e => e.position.distanceTo(P()).toFixed(1)).join('/');
    world.unload?.(); world.dispose?.();
    return `cut: stood up @[${stood}] · walked 15 s @[${gone}] · +10 s standing @[${back}]`;
  });
}
