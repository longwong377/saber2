/** Scratch probe: what one deck companion costs per frame. Not a check. */
import './dom-shim.mjs';
const { bootWorld, idleInput } = await import('./checks/_coop.mjs');
const Kn = await import('../src/game/Kennel.js');
const D = await import('../src/game/CompanionDeck.js');
const K = await import('../src/game/CompanionKinds.js');
const STEP = 1 / 30;
Kn.clear(); Kn.adopt('massiff', 'Borz');
const { world } = await bootWorld({
  level: 'hangar', settings: { mode: 'hangar', level: 'hangar', allies: 0, quality: 'low' }, runSeed: 2,
});
const input = idleInput();
for (let i = 0; i < 60; i++) world.update(STEP, input);
const N = 600;
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : K.COMPANION_ORDER) {
  D.dismissCompanion(world);
  Kn.clear(); Kn.adopt(id, 'Borz');
  const fig = D.callTheCompanion(world);
  for (let i = 0; i < 30; i++) world.update(STEP, input);
  // walking
  const time = (sit) => {
    fig.sit = sit;
    fig.vel.set(0, 0, sit > 0.5 ? 0 : 2.1);
    let t = 0;
    for (let i = 0; i < N; i++) {
      const t0 = process.hrtime.bigint();
      D.poseCompanionDeck(fig, STEP);
      t += Number(process.hrtime.bigint() - t0);
    }
    return t / N / 1e6;
  };
  time(0); // warm
  const walk = time(0);
  const sat = time(1);
  console.log(`${id.padEnd(8)} ${fig.path.padEnd(7)} pose walking ${walk.toFixed(4)} ms  sat ${sat.toFixed(4)} ms`);
}
world.unload(); Kn.clear();
process.exit(0);
