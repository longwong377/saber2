import './dom-shim.mjs';
import * as THREE from 'three';
const Waves = await import('../src/game/Waves.js');
const { LEVELS } = await import('../src/game/Levels.js');
const { DIFFICULTY } = await import('../src/game/Combat.js');
const tableWorld = () => ({
  scene: new THREE.Scene(), enemies: [], players: [], props: [], statics: [],
  terrain: { height: () => 0, inBounds: () => true, slopeAt: () => 0, surfaceAt: () => 'sand',
    normalAt: (x, z, o) => o.set(0, 1, 0), size: 400, half: 200 },
  difficulty: DIFFICULTY.knight, settings: {}, time: 0,
  notify() {}, report() {}, spawnEnemy() { return null; }, pickSpawn() { return new THREE.Vector3(); },
});
for (const key of ['wood', 'colosseum']) {
  const d = new Waves.WaveDirector(tableWorld(), { mode: 'roguelite', pool: LEVELS[key].pool });
  const out = [];
  for (const w of [20, 40, 70, 100, 140]) {
    const shapes = new Set();
    for (let i = 0; i < 24; i++) {
      Waves.seedWaves(1000 + i, 0); d.wave = w; d._compose();
      shapes.add(d.conditions.slice().sort().join('+') + '|'
        + [...new Set(d.spawnQueue.map(Waves.spawnType))].sort().join(','));
    }
    out.push(`w${w}: ${shapes.size}`);
  }
  console.log(key.padEnd(10), out.join('  '));
}
