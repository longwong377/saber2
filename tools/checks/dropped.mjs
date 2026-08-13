/**
 * SABER — a hilt on the ground, and whose hilt it is.
 *
 * Note 61: "drop and pick up sabers, including a friend's."
 *
 * Before this there was no such object. A duellist that lost the arm holding
 * its weapon called `saber.retract()` and the hilt ceased to exist, so the most
 * legible thing that can happen in a swordfight produced nothing you could walk
 * over and take; and the player could not put theirs down at all.
 *
 * The half that is easy to get wrong is not the physics, it is the IDENTITY. A
 * dropped hilt that carries only a mesh gives you back a generic weapon when
 * you pick it up, which turns "take your friend's saber" into "take a saber",
 * and the difference is the whole point of the note: in co-op your partner's
 * hilt is built from THEIR order's tuning with THEIR crystal, and picking it up
 * should put their weapon in your hand — a Sith's bled red in a Jedi's, a
 * Consular's gold hilt in yours.
 *
 * So most of what is measured here is that the thing you pick up is the thing
 * that was dropped, and that a swap never destroys a weapon.
 */

import * as THREE from 'three';
import { Player } from '../../src/game/Player.js';
import { Saber, SABER_COLORS, HILT_STYLES } from '../../src/game/Saber.js';
import { dropSaber, hiltWithinReach, ageDropped, PICKUP_REACH, PICKUP_DELAY } from '../../src/game/Dropped.js';

let THREE_ = null;

function bench() {
  const world = {
    scene: new THREE.Scene(),
    settings: { fov: 60, bloom: false, forcePower: 1, forceDrain: 1 },
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), inBounds: () => true,
      half: 200, crater() {}, surfaceAt: () => 'sand', raycast: () => null,
    },
    particles: null, bolts: null, time: 0, combatIntensity: 0,
    physics: { add() {}, remove() {}, raycast: () => null, bodies: [], staticBoxes: [],
      addJoint() {}, removeJoint() {} },
    engine: { addHeat() {}, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.045, 1000) },
    props: [], notices: [],
    addProp(p) { this.props.push(p); return p; },
    notify(t, s) { this.notices.push({ t, s }); },
    report() {},
  };
  const p = new Player(world, { isLocal: true, colorIndex: 0, hiltStyle: 'Graflex' });
  p.position.set(0, 0, 0);
  p.aimDir.set(0, 0, -1);
  const ctx = { input: null, terrain: world.terrain, physics: world.physics, particles: null,
    camera: world.engine.camera, time: 0, groundColor: 0, enemies: [] };
  return { p, world, ctx };
}

export async function run({ check, assert, THREE: T }) {
  THREE_ = T;

  check('dropped: a hilt put down is a real object, in the crystal it was built with', () => {
    const b = bench();
    const before = b.world.props.length;
    b.p.swapSaber(b.ctx);
    assert(b.world.props.length === before + 1,
      `dropping the blade added ${b.world.props.length - before} props to the level`);
    const put = b.world.props[b.world.props.length - 1];
    assert(put.saber, 'the dropped prop carries no saber identity, so picking it up gives back a generic blade');
    assert(put.saber.colorIndex === 0 && put.saber.hiltStyle === 'Graflex',
      `it was dropped as ${JSON.stringify(put.saber)} and the player was holding Graflex/0`);
    // …and it is a physical object, not a decoration
    assert(put.body && put.body.invMass > 0, 'the hilt is static — it cannot fall or be knocked about');
    assert(put.capsules && put.capsules().length > 0,
      'the blade is offered no contact on a hilt lying on the floor');
    assert(put.grippable !== false, 'a hilt on the ground cannot be pulled to you');
    return `${put.capsules().length} contacts, ${put.body.mass ?? '?'} kg, ${SABER_COLORS[put.saber.colorIndex].name}`;
  });

  check('dropped: you cannot pick your own back up before you have seen it leave', () => {
    /* Without the delay, dropping and stepping forward takes it straight back on
     * the next frame and nothing appears to have happened. It is the difference
     * between an action and a no-op. */
    const b = bench();
    b.p.swapSaber(b.ctx);
    const put = b.world.props[b.world.props.length - 1];
    put.body.position.copy(b.p.position);          // standing right on it
    assert(!hiltWithinReach(b.world, b.p),
      'the hilt was pickable on the frame it was dropped');
    for (let i = 0; i < 60 * (PICKUP_DELAY + 0.2); i++) ageDropped(b.world, 1 / 60);
    assert(hiltWithinReach(b.world, b.p) === put,
      `after ${PICKUP_DELAY}s the player still cannot pick up the hilt at their feet`);
    // and reach is a reach, not the whole level
    put.body.position.copy(b.p.position).setZ(PICKUP_REACH + 1);
    assert(!hiltWithinReach(b.world, b.p),
      `a hilt ${(PICKUP_REACH + 1).toFixed(1)} m away is within a ${PICKUP_REACH} m reach`);
    return `blocked for ${PICKUP_DELAY}s, then taken; reach ${PICKUP_REACH} m`;
  });

  check("dropped: picking up a friend's saber gives you THEIR weapon", () => {
    /* The note's real ask. The identity has to survive the round trip — crystal
     * AND hilt AND the order whose tuning machined it, because an order's
     * tuning is most of what a blade is here. A pick-up that hands back your
     * own colour on their hilt is a recolour, not a weapon. */
    const b = bench();
    const theirs = dropSaber(b.world, {
      position: new THREE.Vector3(0, 0, -0.5),
      colorIndex: 4, hiltStyle: 'Warden', order: 'sith',
    });
    for (let i = 0; i < 60; i++) ageDropped(b.world, 1 / 60);
    const mine = { colorIndex: b.p.saber.colorIndex, hiltStyle: b.p.saber.hiltStyle };
    assert(hiltWithinReach(b.world, b.p) === theirs, 'their hilt is not within reach at half a metre');

    b.p.swapSaber(b.ctx);
    assert(b.p.saber.colorIndex === 4,
      `picked up a Crimson blade and came up holding ${SABER_COLORS[b.p.saber.colorIndex].name}`);
    assert(b.p.saber.hiltStyle === 'Warden', `the hilt came back as ${b.p.saber.hiltStyle}`);
    assert(b.p.saber._order === 'sith',
      `their order's tuning did not travel — the blade reads as ${b.p.saber._order}`);
    assert(b.p.saber.isDark, 'a bled crystal in your hand does not read as one');

    // …and it did not cost them their weapon or you yours: the swap put mine
    // down where I stood, so both still exist in the world
    const still = b.world.props.filter((q) => q.saber && !q.dead);
    assert(still.length === 1 && still[0].saber.colorIndex === mine.colorIndex
      && still[0].saber.hiltStyle === mine.hiltStyle,
      `after the swap the ground holds ${JSON.stringify(still.map((q) => q.saber))} — mine should be there and theirs should not`);
    return `took Crimson/Warden/sith, put down ${SABER_COLORS[mine.colorIndex].name}/${mine.hiltStyle}`;
  });

  check('dropped: a disarmed duellist leaves its hilt where the blade crossed', async () => {
    /* The other end of the note, and the one that makes a fallen weapon
     * something that happens in a fight rather than something you set up. */
    const { Enemy } = await import('../../src/game/Enemy.js');
    const b = bench();
    b.ctx.pickTarget = () => b.p;
    const e = new Enemy(b.world, 'acolyte', new THREE.Vector3(0, 0, -3));
    e.position.set(0, 0, -3);
    b.ctx.enemies.push(e);
    e.update(1 / 60, b.ctx);
    assert(e.saber, 'the acolyte has no saber to lose');
    const hue = e.saber.colorIndex;

    const before = b.world.props.filter((q) => q.saber).length;
    e._loseLimbBehaviour('handR', new THREE.Vector3(0.3, 1.2, -3));
    const after = b.world.props.filter((q) => q.saber);
    assert(e.disarmed, 'losing the sword arm did not disarm it');
    assert(after.length === before + 1,
      'the acolyte was disarmed and no hilt hit the ground — the weapon ceased to exist');
    const fell = after[after.length - 1];
    assert(fell.saber.colorIndex === hue,
      `it dropped a ${SABER_COLORS[fell.saber.colorIndex].name} hilt and was carrying ${SABER_COLORS[hue].name}`);
    assert(fell.body.position.distanceTo(new THREE.Vector3(0.3, 1.2, -3)) < 0.5,
      'the hilt appeared somewhere other than where the blade crossed');
    return `${SABER_COLORS[hue].name} hilt on the floor at the cut`;
  });

  check('dropped: every hilt in the game can be dropped and picked up', () => {
    /* Cheap, and it is the check that would have caught a spec whose grip does
     * not survive being re-machined under a live weapon — `rebuildHilt` runs
     * the same spec walk the constructor does, and a style that throws there
     * throws in the player's hand mid-fight. */
    const scene = new THREE.Scene();
    const rows = [];
    for (const style of HILT_STYLES) {
      const s = new Saber(scene, { colorIndex: 0, hiltStyle: 'Graflex' });
      s.hiltStyle = style;
      s.setOrderTuning('sith');
      s.setColor(4);
      s.rebuildHilt();
      let n = 0;
      s.hilt.traverse((o) => { if (o.isMesh) n++; });
      assert(n >= 9, `${style} re-machines into only ${n} pieces`);
      assert(s.hiltSpec && s.hiltSpec === s.hiltSpec, `${style} lost its spec on rebuild`);
      rows.push(`${style} ${n}p`);
      s.dispose();
    }
    return rows.join(', ');
  });
}
