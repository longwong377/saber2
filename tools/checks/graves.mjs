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
import { GraveField, GRAVE_MAX, GRAVE_READ, HELMETS, helmetKindOf } from '../../src/world/Graves.js';

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

  check('graves: however many there are, they are a handful of draw calls', () => {
    /**
     * IT WAS TWO, AND IT IS ONE PER HELMET KIND PLUS THE RIFLE — the player
     * asked for "whatever specific helmet/head that npc had on a stick", so
     * the helmet is an instanced mesh per kind (HELMETS) and a kind nobody
     * has died in costs a count of 0, which the renderer skips. Seventy-six
     * clone graves are still two calls; a mixed field is at most one more
     * per kind. Still nothing beside a corpse at twenty-six.
     */
    const scene = new THREE.Scene();
    const f = new GraveField().attach(scene);
    for (let i = 0; i < GRAVE_MAX + 12; i++) f.mark(man(`CT-${1000 + i}`, i * 3, 0));
    const drawn = [];
    scene.traverse((o) => { if (o.isMesh) drawn.push(o); });
    const live = drawn.filter((m) => m.count > 0);
    assert(live.length === 2,
      `${GRAVE_MAX + 12} clone graves cost ${live.length} live draw calls — the corpse budget is a few dozen `
      + 'bodies at 26 calls each and this must not compete with it');
    assert(drawn.length <= 1 + Object.keys(HELMETS).length,
      `${drawn.length} meshes for ${Object.keys(HELMETS).length} helmet kinds and a rifle`);
    assert(drawn.every((m) => m.isInstancedMesh), 'a grave is drawn as an ordinary mesh');
    assert(live.every((m) => m.count === GRAVE_MAX),
      `${live.map((m) => m.count).join('/')} instances against a ${GRAVE_MAX} cap — the oldest `
      + 'markers stop being DRAWN and the names stay on the record');
    assert(f.length === GRAVE_MAX + 12,
      `the record lost names to the drawing cap: ${f.length} of ${GRAVE_MAX + 12}`);
    assert(drawn.every((m) => !m.castShadow),
      'a grave casts a shadow — a memorial that costs a shadow map per casualty is one the frame '
      + 'budget deletes exactly when the run is going badly enough to have several');
    return `${GRAVE_MAX + 12} names, ${GRAVE_MAX} drawn, ${live.length} live calls of ${drawn.length} meshes`;
  });

  check('graves: the marker wears the man\'s own helmet, and it is the builder\'s helmet', () => {
    /**
     * "it should be whatever specific helmet/head that npc had on a stick,
     * right now it's generic blob on a stick". So: a clone's marker draws in
     * the clone bucket, an ARC's in the ARC bucket (the same bucket with the
     * rangefinder stalk), a B1's in the B1 snout, a B2's in the wedge — and
     * the clone bucket is not a sphere: it is `buildTrooper`'s own seven
     * plates, which is why it has a fin along the crown and cheeks wider
     * than the dome, neither of which a hemisphere has.
     */
    const scene = new THREE.Scene();
    const f = new GraveField().attach(scene);
    f.mark(man('CT-1', 0, 0, { kind: 'trooper', army: 'flesh' }));
    f.mark(man('CT-2', 3, 0, { kind: 'arc', army: 'flesh' }));
    f.mark(man('CC-3', 6, 0, { kind: 'officer', army: 'flesh' }));
    f.mark(man('B1-4', 9, 0, { kind: 'b1', army: 'steel' }));
    f.mark(man('B2-5', 12, 0, { kind: 'b2', army: 'steel' }));
    f.mark(man('X-6', 15, 0, { kind: 'somethingnew', army: 'steel' }));
    f.mark(man('CT-7', 18, 0, { kind: 'heavy', army: 'flesh', look: { kit: { rangefinder: 'stalk' } } }));
    const d = f.drawn();
    assert(d.clone === 1 && d.arc === 2 && d.commander === 1 && d.b1 === 2 && d.b2 === 1,
      `drawn as ${JSON.stringify(d)} — expected clone 1, arc 2 (the ARC and the heavy with a stalk on his kit), `
      + 'commander 1, b1 2 (the B1 and an unknown steel type), b2 1');
    assert(helmetKindOf({ kind: 'nobody', army: 'flesh' }) === 'clone', 'an unknown flesh type is not a clone');
    const helm = f.meshes.clone.geometry;
    helm.computeBoundingBox();
    const bb = helm.boundingBox;
    const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y, dd = bb.max.z - bb.min.z;
    assert(h > w * 1.05 && dd > w * 1.2,
      `the clone helmet is ${w.toFixed(3)} wide, ${h.toFixed(3)} tall, ${dd.toFixed(3)} deep — a helmet is `
      + 'taller than it is wide and longer than it is wide, and a hemisphere is neither');
    assert(helm.attributes.position.count > 200,
      `${helm.attributes.position.count} vertices — that is a blob, not seven plates`);
    const b1 = f.meshes.b1.geometry; b1.computeBoundingBox();
    const snout = b1.boundingBox.max.z - b1.boundingBox.min.z;
    assert(snout > 0.25, `the B1 head is ${snout.toFixed(2)} m front to back — a B1 is a snout`);
    return `clone ${w.toFixed(2)}×${h.toFixed(2)}×${dd.toFixed(2)} m, B1 snout ${snout.toFixed(2)} m; `
      + Object.entries(d).map(([k, v]) => `${k}:${v}`).join(' ');
  });

  check('graves: the markers are rebuilt onto whatever ground the run is on now', () => {
    const one = new THREE.Scene();
    const f = new GraveField().attach(one, { height: () => 4.25 });
    f.mark(man('CT-1147', 10, -10));
    let meshes = [];
    one.traverse((o) => { if (o.isInstancedMesh) meshes.push(o); });
    const live = () => meshes.filter((m) => m.count > 0).length;
    assert(meshes.length >= 2 && live() === 2, 'the first ground drew nothing');
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
    assert(meshes.length >= 2 && live() === 2,
      'the next ground does not carry the graves of the last one — a run that forgets its dead '
      + 'between engagements is the corpse budget with extra steps');
    return 'one name, two grounds, still standing on the same coordinates';
  });

  check('graves: a run that leads an army keeps its dead where they fell, and one that does not has none', async () => {
    /**
     * THE WIRE, END TO END, on a real World: a real trooper is killed through
     * the door every death in the game comes through. The ground does NOT
     * draw a marker for him any more — "graves for your dead allies
     * automatically appear but maybe it should be an active order" — it
     * keeps the body, and the commander keeps the record a burial will need
     * (`c.fallen`). The order itself is measured in `burial.mjs`.
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
    const body = t.body;
    const where = body.position.clone();
    const before = world.graves.length;
    world.onEnemyKilled(body, null, 'blaster');
    assert(world.graves.length === before,
      'a named man died and a marker appeared on its own — the grave is the burial detail\'s to make');
    const rec = d.commander.fallen?.[d.commander.fallen.length - 1];
    assert(rec && rec.name === t.name && !rec.buried,
      'the commander kept no record of the man he lost, so nobody can ever be sent for him');
    assert(body.keepBody === true,
      'the body is not flagged to stay — it would be gone in forty seconds like a droid');
    assert(Math.hypot(rec.x - where.x, rec.z - where.z) < 0.01,
      `the record says he fell ${Math.hypot(rec.x - where.x, rec.z - where.z).toFixed(1)} m from where he fell`);
    assert(rec.kind === t.type, `the record says he was a ${rec.kind} and he was a ${t.type} — the wrong helmet`);
    const g = rec;
    world.unload();

    /* …and a mode with no roll has no names to lose. */
    const { world: duel } = await bootWorld({
      level: 'geonosis', settings: { mode: 'duel', level: 'geonosis', quality: 'low' }, runSeed: 5,
    });
    assert(!duel.graves,
      'a duel builds a grave field — a grave is a name off a roll and that mode has no roll');
    duel.unload();
    return `${g.rank} ${g.name} is lying where he fell, unburied, ${g.kind} on the record; a duel has no field at all`;
  });

  check('graves: the line minds its own dead, and only so often', async () => {
    /**
     * PLAN.md §4.8's third bullet, second half: "a marker where each man of the
     * company fell, on that ground, in later runs, **with the surviving squad's
     * morale reacting when they walk past it**". The ground remembering and the
     * men minding are one mechanism — that bullet's own words are "one system
     * with §4.7's ground memory, not two" — so this is measured on the real
     * director, with the real grave field under it.
     *
     * TWO ARMS RATHER THAN A BEFORE AND AFTER, because morale is a live
     * quantity: `_morale` runs every frame and a line standing 280 m from its
     * general is drifting down on its own the whole time. The control is the
     * same fixture with no markers on the ground, stepped for the same seconds.
     */
    const { MORALE } = await import('../../src/game/Morale.js');
    const bare = await armedLine();
    const dug = await armedLine();
    /* One of their own went down on the ground both lines are standing on. */
    dug.world.graves = new GraveField();
    dug.world.graves.mark(man('CT-9001', 200, 200));

    const step = (a, secs) => { for (let i = 0; i < secs * 30; i++) a.d._troops(1 / 30, {}); };
    step(bare, 25); step(dug, 25);
    const meanOf = (a) => a.men.reduce((x, t) => x + t.morale, 0) / a.men.length;
    const flat = meanOf(bare), among = meanOf(dug);
    assert(among < flat - 1e-6,
      `a line standing among its own graves reads ${among.toFixed(3)} and the same line on clean `
      + `ground reads ${flat.toFixed(3)} — the marker is a decal if walking past it is free`);
    const drop = flat - among;
    assert(drop <= Math.abs(MORALE.PASSED_GRAVE) * 1.05,
      `the ground took ${drop.toFixed(3)} off a line in five seconds against a table entry of `
      + `${Math.abs(MORALE.PASSED_GRAVE)} — a squad ordered to hold a position among its own `
      + 'markers would rout on the ground alone');

    /* …AND ONLY SO OFTEN. Half a cooldown later, nothing more has been taken. */
    const held = meanOf(dug);
    step(bare, MORALE.GRAVE_COOLDOWN * 0.4); step(dug, MORALE.GRAVE_COOLDOWN * 0.4);
    const still = flat - meanOf(bare) + meanOf(dug);
    void still;
    assert(meanOf(dug) - meanOf(bare) >= (held - flat) - 1e-6,
      `the gap widened inside the ${MORALE.GRAVE_COOLDOWN}s cooldown — the ground is being felt `
      + 'again before a man has had time to walk out of it');

    /**
     * AND A MAN IS NOT HAUNTED BY HIS OWN MARKER — measured INSIDE ONE LINE.
     *
     * This arm used to stand a second `armedLine()` beside the first and
     * compare man 0 to man 0 across the pair. Two fixtures are two draws from
     * the roster stream, so the two lines were only the same line by luck:
     * alone the luck held, and in a full run — the stream at a different offset
     * (§2.11) — it did not, and the check reported a man haunted by his own
     * grave when what had actually happened was that the control was a
     * different roster.
     *
     * ONE LINE, AND READ OFF THE COOLDOWN RATHER THAN THE MORALE. Morale is
     * not comparable man to man even inside one roster: squad leaders carry
     * their own terms and sit far below their privates (measured on this
     * fixture, 0.343 and 0.286 against 0.840 for the eight others, with no
     * grave on the ground at all). So whether man 0 is a leader decides a
     * morale comparison, and which index is a leader is exactly what moves
     * when the roster stream moves — the flake, restated.
     *
     * `_graveT` is the mechanism itself and carries none of that: it is set to
     * `GRAVE_COOLDOWN` by the one line that shakes a man for a marker, and by
     * nothing else. Ten seconds is long enough for the cursor to have offered
     * the grave to every man (one a frame) and short enough that no cooldown
     * has run out, so the property is exact — everyone else is holding one,
     * and the man whose name is on the stone never took it.
     */
    const own = await armedLine();
    own.world.graves = new GraveField();
    own.world.graves.mark(man(own.men[0].name, 200, 200));
    step(own, 10);
    const shaken = own.men.slice(1).filter((t) => (t._graveT || 0) > 0).length;
    assert(shaken === own.men.length - 1,
      `${shaken} of ${own.men.length - 1} men standing on a grave were shaken by it — the rest `
      + 'never felt the ground, so this arm cannot tell a name being honoured from a marker that '
      + 'does nothing');
    assert(!(own.men[0]._graveT > 0),
      'a man was shaken by a grave carrying his own name — the name is the only identity a marker '
      + 'keeps, so it is the only thing that can say the grave is his');
    return `clean ground ${flat.toFixed(3)} · among their own ${among.toFixed(3)} `
      + `(−${drop.toFixed(3)}, once every ${MORALE.GRAVE_COOLDOWN}s)`;
  });

}

/* ── the fixture ──────────────────────────────────────────────────────── */

/**
 * A REAL `CommandDirector` OVER STUB BODIES, standing well away from anything.
 *
 * Same shape `objectives.mjs` and `dig-in.mjs` use. The men are put 280 m from
 * their general so nothing but the ground can move their nerve — `_morale`
 * pays `LEADER_NEAR` inside 14 m, and a line in its general's pocket sits at
 * the ceiling where nothing is measurable (see MORALE's own note on
 * saturation).
 */
async function armedLine() {
  const Cmd = await import('../../src/game/Command.js');
  const { LEVELS } = await import('../../src/game/Levels.js');
  const world = {
    scene: new THREE.Scene(), settings: {}, level: LEVELS.geonosis, run: null,
    takenBoons: new Set(), statics: [], props: [], doors: [], report() {}, notify() {},
    difficulty: null, hpScale: 1, dmgScale: 1, players: [], enemies: [], time: 0,
    physics: { staticBoxes: [], bodies: [], add() {}, remove() {}, raycast: () => null,
      addStaticBox() { return null; }, removeStaticBox() {} },
    terrain: { height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
      size: 400, half: 200, surfaceAt: () => 'sand', crater() {}, flush() {}, slopeAt: () => 0,
      inBounds: () => true },
  };
  let n = 0;
  world.spawnEnemy = (type, pos) => {
    const e = { id: 'b' + (++n), team: 0, dead: false, downed: false, position: pos.clone(),
      A: {}, type, world, speed: 4, hp: 100, maxHp: 100, velocity: new THREE.Vector3(),
      facing: 0, wish: null, toTarget: null, _wallN: new THREE.Vector3(), _wallT: 0, _stuckT: 0,
      _prevPos: new THREE.Vector3(), attackDamage: 0, mod: null, rig: null, group: null,
      burstLeft: 0, burstTimer: 0, attackTimer: 0, aimCharge: 0,
      _move() {}, _syncBody() {}, damage(v) { this.hp -= v; return this.hp <= 0; } };
    world.enemies.push(e);
    return e;
  };
  const d = new Cmd.CommandDirector(world, { pool: LEVELS.geonosis.pool });
  const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: 0 };
  world.players.push(me); world.player = me; d.commander.player = me;
  d.deploy();
  d._troops(1 / 30, {});
  const men = d.roster.living;
  for (const t of men) { if (t.body) t.body.position.set(200, 0, 200); t.morale = 1; }
  return { world, d, men };
}
