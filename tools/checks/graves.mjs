/**
 * BATTLEFRONT BORZ — the ground keeps your dead.
 *
 * `src/world/Graves.js` is PLAN.md §4.7's last item. Its own header carries the
 * design; what this file holds is the three properties that make a grave a
 * memorial rather than a decal, and the one that makes it affordable:
 *
 *   IT IS THE RECORD AND NOT THE BODY. A grave holds a name, a rank, a unit, a
 *   killer and a minute — the same five facts the `fell` log takes — and no
 *   reference to anything. A marker that held an Enemy would keep a whole rig,
 *   a garment and a cloth solver alive for the length of a sitting, which is
 *   the mistake the log itself is written to avoid.
 *
 *   IT OUTLIVES THE GROUND IT IS DRAWN ON. The run is longer than the scene, so
 *   a man who fell in engagement one is still standing on that spot in
 *   engagement three. That is the same rule the crater log follows and it is
 *   what the whole feature is for.
 *
 *   IT SAYS WHO IT WAS ONCE. A marker that announced itself every time the line
 *   walked past would be a memorial that becomes noise, and noise is the one
 *   way this can fail.
 *
 * And it is TWO DRAW CALLS however many there are, which is the difference
 * between this and the corpse budget it must not compete with.
 */

import * as THREE from 'three';
import { GraveField, GRAVE_MAX, GRAVE_READ } from '../../src/world/Graves.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const man = (name, x, z, extra = {}) => ({ name, rank: 'Cpl', unit: 'Clone Trooper',
  killer: 'a B2', at: 372, x, y: 0, z, ...extra });

export async function run({ check, assert }) {

  check('graves: a marker is a record, and it holds nothing that can die', () => {
    const f = new GraveField();
    const body = { name: 'CT-1147', position: V(4, 0, 9), rig: {}, hp: 0 };
    const g = f.mark(man('CT-1147', body.position.x, body.position.z));
    assert(g, 'a named man fell and the ground kept nothing');
    assert(f.length === 1, `${f.length} markers for one casualty`);
    const holds = JSON.stringify(g);
    assert(!/rig|hp|position/.test(holds),
      `the marker carries ${holds} — a grave that holds a body keeps a rig, a garment and a cloth `
      + 'solver alive for the length of the run');
    assert(g.name === 'CT-1147' && g.killer === 'a B2' && g.at === 372,
      'the marker did not take the name, the killer and the minute the report took');
    assert(GraveField.epitaph(g).includes('6:12'),
      `the epitaph reads "${GraveField.epitaph(g)}" and he fell at 372 s`);
    assert(GraveField.epitaph(g).includes('by a B2'),
      'the epitaph does not say who did it — that is §4.9\'s whole claim, on the ground');
    return `"${g.name} — ${GraveField.epitaph(g)}"`;
  });

  check('graves: it says who it was once, and the once survives a change of ground', () => {
    const f = new GraveField();
    f.mark(man('CT-1147', 0, 0));
    f.mark(man('CT-2290', 60, 0));
    const player = { position: V(0, 0, 0), dead: false };
    const first = f.update(1 / 30, player);
    assert(first?.name === 'CT-1147', `standing on a grave read ${first?.name ?? 'nothing'}`);
    assert(!f.update(1 / 30, player), 'the same grave spoke twice in two frames');
    for (let i = 0; i < 200; i++) assert(!f.update(1 / 30, player), 'a grave spoke again');

    /* A GROUND CHANGE. The markers are rebuilt onto the new scene and the
     * record — including what has been read — is the run's. */
    f.attach(new THREE.Scene());
    assert(!f.update(1 / 30, player),
      'a grave the player had already stood over spoke again after the ground changed — `seen` is '
      + 'on the record for exactly this reason');

    /* …and the one he has not reached yet still has something to say. */
    player.position.set(60, 0, 0);
    const second = f.update(1 / 30, player);
    assert(second?.name === 'CT-2290', 'the second grave never spoke');
    assert(f.read === 2, `${f.read} graves read, two were stood over`);

    /* And the radius is a radius. */
    const g = new GraveField();
    g.mark(man('CT-3000', 0, 0));
    assert(!g.update(1 / 30, { position: V(GRAVE_READ + 1, 0, 0), dead: false }),
      `a grave read from ${GRAVE_READ + 1} m against a ${GRAVE_READ} m reach`);
    return `two graves, two readings, ${GRAVE_READ} m to hear one`;
  });

  check('graves: however many there are, they are two draw calls', () => {
    const scene = new THREE.Scene();
    const f = new GraveField().attach(scene);
    for (let i = 0; i < GRAVE_MAX + 12; i++) f.mark(man(`CT-${1000 + i}`, i * 3, 0));
    const drawn = [];
    scene.traverse((o) => { if (o.isMesh) drawn.push(o); });
    assert(drawn.length === 2,
      `${GRAVE_MAX + 12} graves cost ${drawn.length} draw calls — the corpse budget is a few dozen `
      + 'bodies at 26 calls each and this must not compete with it');
    assert(drawn.every((m) => m.isInstancedMesh), 'a grave is drawn as an ordinary mesh');
    assert(drawn.every((m) => m.count === GRAVE_MAX),
      `${drawn.map((m) => m.count).join('/')} instances against a ${GRAVE_MAX} cap — the oldest `
      + 'markers stop being DRAWN and the names stay on the record');
    assert(f.length === GRAVE_MAX + 12,
      `the record lost names to the drawing cap: ${f.length} of ${GRAVE_MAX + 12}`);
    assert(drawn.every((m) => !m.castShadow),
      'a grave casts a shadow — a memorial that costs a shadow map per casualty is one the frame '
      + 'budget deletes exactly when the run is going badly enough to have several');
    return `${GRAVE_MAX + 12} names, ${GRAVE_MAX} drawn, ${drawn.length} calls`;
  });

  check('graves: the markers are rebuilt onto whatever ground the run is on now', () => {
    const one = new THREE.Scene();
    const f = new GraveField().attach(one, { height: () => 4.25 });
    f.mark(man('CT-1147', 10, -10));
    let meshes = [];
    one.traverse((o) => { if (o.isInstancedMesh) meshes.push(o); });
    assert(meshes.length === 2 && meshes[0].count === 1, 'the first ground drew nothing');
    assert(Math.abs(f.entries[0].y - 4.25) < 1e-6,
      `the marker was planted at y=${f.entries[0].y} rather than on the ground it fell on`);

    /* The level ends. The markers come out of the scene and the names do not. */
    f.detach();
    meshes = [];
    one.traverse((o) => { if (o.isInstancedMesh) meshes.push(o); });
    assert(!meshes.length, 'the old scene still holds the markers after a detach');
    assert(f.length === 1, 'detaching the drawing threw away the record');

    const two = new THREE.Scene();
    f.attach(two);
    meshes = [];
    two.traverse((o) => { if (o.isInstancedMesh) meshes.push(o); });
    assert(meshes.length === 2 && meshes[0].count === 1,
      'the next ground does not carry the graves of the last one — a run that forgets its dead '
      + 'between engagements is the corpse budget with extra steps');
    return 'one name, two grounds, still standing on the same coordinates';
  });

  check('graves: a run that leads an army buries its dead, and one that does not has none', async () => {
    /**
     * THE WIRE, END TO END, on a real World: a real trooper is killed through
     * the door every death in the game comes through and the ground keeps him.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({
      level: 'geonosis',
      settings: { mode: 'theline', level: 'geonosis', quality: 'low' },
      runSeed: 5,
    });
    assert(world.graves, 'a world leading an army has no grave field at all');
    const d = world.command;
    d.deploy?.();
    const t = d.roster.living.find((x) => x.body && !x.body.dead);
    assert(t, 'the fixture mustered nobody to lose');
    const where = t.body.position.clone();
    const before = world.graves.length;
    world.onEnemyKilled(t.body, null, 'blaster');
    assert(world.graves.length === before + 1,
      'a named man died on a real world and the ground kept nothing');
    const g = world.graves.entries[world.graves.length - 1];
    assert(Math.hypot(g.x - where.x, g.z - where.z) < 0.01,
      `he is buried ${Math.hypot(g.x - where.x, g.z - where.z).toFixed(1)} m from where he fell`);
    assert(g.name && g.rank, `the marker reads "${g.rank} ${g.name}"`);
    world.unload();

    /* …and a mode with no roll has no names to lose. */
    const { world: duel } = await bootWorld({
      level: 'geonosis', settings: { mode: 'duel', level: 'geonosis', quality: 'low' }, runSeed: 5,
    });
    assert(!duel.graves,
      'a duel builds a grave field — a grave is a name off a roll and that mode has no roll');
    duel.unload();
    return `${g.rank} ${g.name} is standing where he fell; a duel has no field at all`;
  });

}
