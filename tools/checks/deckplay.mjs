/**
 * BATTLEFRONT BORZ — WHAT YOU CAN ACTUALLY DO ON THE FLIGHT DECK.
 *
 * `hangar.mjs` holds the SHAPE of the room — one wall, no ceiling, a deck that
 * ends — and the two ways walking onto it could destroy a save. This holds the
 * other half of HANGAR-SPEC's PLAY section, which is four sentences and every
 * one of them is a claim a machine can check:
 *
 *   "Force powers work in here: shove the line over, they get up and re-form."
 *   "Pick up crates and ships, throw them at the shield."
 *   "Walk to the shield edge and stand there."
 *   "Physics on everything, in the hangar and on every troop."
 *
 * ── AND THE FIFTH THING, WHICH IS NOT IN THE SPEC ────────────────────────
 *
 * `Player.js` is one of the most-checked files in this repository and the deck
 * is a branch inside its input path. So the first check here is not about the
 * hangar at all: it is that a world which is NOT the hangar cannot tell the
 * difference. A mode that leaks is a mode that has taken the blade off every
 * player in the game.
 */

import { MODES } from '../../src/game/Waves.js';
import { POWER_COST } from '../../src/game/Powers.js';
import { DECK } from '../../src/game/Hangar.js';
import { LAYER } from '../../src/physics/RapierWorld.js';
import { SHOVE, STATE, Shovable } from '../../src/physics/Shovable.js';

/**
 * THE ALLOW-LIST, WRITTEN ONCE. `Player._readInput`'s deck branch reads these
 * five Force verbs (plus `hurl`, which is the release for two of them, `view`
 * and `dash`); `OFF_THE_DECK` in that file carries the eight refusals and their
 * reasons. Here the complement is DERIVED off `POWER_COST` rather than typed
 * out, so a thirteenth power added to the game lands on the refused side and
 * has to be argued onto the deck rather than arriving on it silently.
 */
const ON_THE_DECK = ['push', 'pull', 'grip', 'stasis', 'unleash'];
/** …and which of the refused ones stamp a cooldown, which is how a fire is seen. */
const OFF_DECK_COOLDOWNS = Object.fromEntries(
  Object.keys(POWER_COST).filter((k) => !ON_THE_DECK.includes(k)).map((k) => [k, true]));

/** Boot the deck through the same door `enterHangar` uses. */
async function deck(extra = {}) {
  const { bootWorld } = await import('./_coop.mjs');
  return bootWorld({
    level: 'hangar',
    settings: { mode: 'hangar', level: 'hangar', allies: 0, ...extra },
  });
}

/** An input with exactly one action pressed this frame. */
function press(idle, name) {
  return { ...idle, actHit: (id) => id === name, act: (id) => id === name };
}

/** An input walking forward, toward the lip. */
function walk(idle) {
  return { ...idle, moveAxis: (o) => { if (o) { o.x = 0; o.y = 1; return o; } return { x: 0, y: 1 }; } };
}

/**
 * STAND THE PLAYER SOMEWHERE AND POINT HIM AT SOMETHING.
 *
 * `aimDir` is `(0,0,-1)` through `YXZ(pitch, yaw)`, which is
 * `(-cos p·sin y, sin p, -cos p·cos y)` — so the yaw that looks along a
 * horizontal `d` is `atan2(-dx, -dz)`. Getting this backwards is the whole
 * reason a first cut of this file measured a Force push moving a crate 0.00 m:
 * the player was standing four metres from it with his back to it.
 *
 * It is ITERATED because the ray leaves `camera.pos`, which in third person is
 * about three metres behind the head and moves as the yaw does — so the first
 * aim is aimed from where the camera was. Four passes settle it to under a
 * degree. The last two frames are there because `aimDir` is written by
 * `_updateBody`, at the END of the frame, from the `aimQuat` `syncAim` set
 * after `_readInput` — so a power cast on the frame the yaw changes reads the
 * previous frame's aim.
 */
function aimAt(world, from, at, step, idle, THREE) {
  const p = world.player;
  p.position.copy(from);
  p.velocity.set(0, 0, 0);
  p.body?.setTransform?.(new THREE.Vector3(from.x, from.y + 0.9, from.z), null);
  /**
   * AIMED FROM THE CHEST, NOT FROM THE BOOM — AND THAT IS A FIX TO THIS
   * HELPER, NOT TO THE GAME.
   *
   * This solved the look direction from `camera.pos`, which in third person is
   * about three metres behind the head and MOVES IN RESPONSE to the pitch it
   * is being handed. That is a feedback loop, and at close range it diverges:
   * driven against a crate four metres away it walked the boom up to y = 3.14
   * and the pitch to -0.56 over four iterations, so the ray left the camera
   * steeply downward and passed over the crate entirely. Two of the six crates
   * on this deck could not be gripped by this helper and all six can be
   * gripped by hand.
   *
   * The chest does not move when the camera turns, so solving from it
   * converges in one step. It is also what a player is actually pointing with.
   */
  const look = () => {
    const eye = p.chest ?? p.camera.pos;
    const d = new THREE.Vector3().subVectors(at, eye).normalize();
    p.camera.yaw = Math.atan2(-d.x, -d.z);
    p.camera.pitch = Math.max(-1.28, Math.min(1.16, Math.asin(d.y)));
  };
  for (let i = 0; i < 4; i++) { look(); step(world, 0.12, idle()); }
  look();
  step(world, 2 / 60, idle());
  return p;
}

export async function run({ check, assert, THREE }) {
  const { clocked } = await import('./_shared.mjs');
  check = await clocked(check);
  const { idleInput, run: step } = await import('./_coop.mjs');

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The mode, and that it is only in one room                         */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck: hosting is derived from the mode table and nowhere else', async () => {
    /**
     * ONE DERIVATION. `World.loadLevel` builds the `HangarDirector` off
     * `MODES[settings.mode]?.level === 'hangar'`; `Player` asks the same table
     * the same question. A second writer — a flag the deck sets at spawn —
     * could disagree with the first, and the two ways it could disagree are
     * "walking round a fight with your blade down" and "standing on the deck
     * able to throw it down your own line".
     */
    assert(MODES.hangar?.level === 'hangar', 'the deck is not a mode with a level');
    const { world } = await deck();
    try {
      assert(world.player.hosting === true, 'the player on the deck is not hosting');
      assert(world.director.constructor.name === 'HangarDirector',
        'the deck built a different director than the player derived its mode from');
      return `mode ${world.settings.mode} -> level ${MODES[world.settings.mode].level} -> hosting`;
    } finally { world.unload(); }
  });

  check('deck: no other mode can tell the branch is there', async () => {
    /**
     * THE ONE THAT MATTERS TO EVERY OTHER SUITE. A fight is unchanged: the
     * blade is lit at spawn and stays lit, `hosting` is false, and the scheme
     * the player chose is the scheme they are playing on.
     */
    const { bootWorld } = await import('./_coop.mjs');
    const { world } = await bootWorld({ settings: { scheme: 'free' } });
    try {
      const p = world.player;
      assert(p.hosting === false, 'a player on a battlefield thinks he is on the deck');
      assert(p.saber.lit, 'the blade is not lit at spawn on a battlefield');
      assert(p.control.scheme === 'free',
        `the deck's scheme pin reached a fight: scheme is ${p.control.scheme}`);
      step(world, 0.5, idleInput());
      assert(p.saber.lit, 'the blade went out on a battlefield');
      return 'fight: hosting false, blade lit, scheme untouched';
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The blade, and the eight refusals                                 */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck: the blade goes down and there is no key that lights it', async () => {
    /**
     * `World.spawnPlayer` ends with an unconditional `p.saber.ignite()` — it
     * has no notion of a destination that is not a fight — so the deck's own
     * branch is the first frame downstream of it that can answer. One frame is
     * 0.11 of an ignition ramp and it is retracted at 8.5/s from there.
     */
    const { world } = await deck();
    try {
      const p = world.player;
      assert(p.saber.lit, 'spawnPlayer stopped igniting the blade — this check is now measuring nothing');
      step(world, 1 / 60, idleInput());
      assert(!p.saber.lit, 'the blade is still lit on the deck after a frame');
      step(world, 0.5, idleInput());
      assert(p.saber.ignition < 0.02, `the blade is ${p.saber.ignition.toFixed(2)} out after half a second`);
      /* AND THE IGNITE KEY DOES NOT ANSWER IT. Held for a second. */
      const ignite = press(idleInput(), 'ignite');
      step(world, 1, ignite);
      assert(!p.saber.lit, 'the ignite key lit a blade in a room full of your own men');
      assert(!p.saberDown,
        'the deck disarmed the player — the hilt stays in the hand, `saberDown` is a different sentence');
      return `blade out in ${(1 / 60).toFixed(3)} s, ignite refused for 60 frames`;
    } finally { world.unload(); }
  });

  check('deck: the eight powers it refuses refuse OUT LOUD, and none of them fires', async () => {
    /**
     * A power that appears to do nothing reads as a broken button, and the HUD
     * wheel advertises all twelve whatever room the player is standing in. So
     * every key the deck does not want has to SAY so — `_refuse` puts a notice
     * up and plays the refusal blip — and, separately, has to not have run.
     *
     * The second half is the one worth driving rather than reading: the pool is
     * the witness. Eight powers priced from 14 to 40 Force, and if a single one
     * of them reached `_spend` the bar would move.
     */
    const { world } = await deck();
    try {
      const p = world.player;
      step(world, 0.2, idleInput());
      const notices = [];
      world.notify = (title, why) => notices.push([title, why]);
      const denied = ['ignite', 'throw', 'lightning', 'compel', 'rend', 'sense', 'heal', 'shield'];
      const force0 = p.force;
      for (const key of denied) {
        world.update(1 / 60, press(idleInput(), key));
        /* `_refuse` gates one notice per name per 0.7 s off `world.time`, so
         * the clock has to move between keys or seven of the eight are eaten. */
        world.time += 1;
      }
      const said = new Set(notices.map(([t]) => t.toLowerCase()));
      const silent = denied.filter((k) => !said.has(k));
      assert(silent.length === 0,
        `${silent.length} of the deck's refusals are SILENT (${silent.join(', ')}) — a key that `
        + 'does nothing at all reads as the game being broken, which is the defect `_refuse` exists for');
      assert(Math.abs(p.force - force0) < 0.01,
        `the pool moved ${(force0 - p.force).toFixed(1)} Force — one of the eight actually ran`);
      assert(!p.senseActive && !p.shield.up && !p.healing && !p.saberThrown && !p.channel,
        'a refused power left state behind: '
        + `sense ${p.senseActive} shield ${p.shield.up} heal ${!!p.healing} throw ${p.saberThrown}`);
      return `${notices.length} refusals spoken, 0 Force spent, cheapest denied power ${POWER_COST.throw}`;
    } finally { world.unload(); }
  });

  check('deck: every key in the game held for a second, and the allow-list holds', async () => {
    /**
     * `driving.mjs`'s "both hands are on the controls" instrument, pointed at
     * the other early return. Every action a player could press, HELD, driven
     * through `Player.update` rather than by calling the powers — calling them
     * would measure the powers, and what is being asserted is which keys reach
     * them at all.
     *
     * TWO-SIDED, which the driving one does not have to be: that branch's
     * answer is "nothing", and this branch's answer is "these five and no
     * others", so a check that only proved the refusals would pass just as well
     * on a deck where nothing worked.
     *
     * `cooldowns` is the honest reader for "did it fire", for the reason
     * `driving.mjs` gives: the pool also answers what is thrown AT you, and
     * every power in the file stamps its own cooldown on the way out.
     */
    const { world } = await deck();
    try {
      const p = world.player;
      step(world, 0.3, idleInput());
      p.force = 1e6; p.maxForce = 1e6;                    // price is not the question here
      p.boonMods.lightning = true; p.boonMods.compel = true;  // nor is a boon gate
      const polled = [];
      const all = { ...idleInput(), actHit: (id) => { polled.push(id); return true; }, act: () => true };
      step(world, 1, all);

      const fired = Object.entries(p.cooldowns).filter(([, v]) => v > 0).map(([k]) => k);
      const banned = fired.filter((k) => k in OFF_DECK_COOLDOWNS);
      assert(banned.length === 0, `these fired on the deck: ${banned.join(', ')}`);
      assert(!p.saber.lit, 'the blade came up with every key held');
      assert(p.throwState === 'held', `the saber left the hand: ${p.throwState}`);
      assert(!p.senseActive && !p.shield.up && p.healing == null && !p.channel,
        'a refused power is running with every key held');
      /* And the five that are welcome really did answer, or this passes on a
       * deck where the Force does nothing at all. */
      const want = ['push', 'pull', 'unleash'];
      const quiet = want.filter((k) => !(p.cooldowns[k] > 0));
      assert(quiet.length === 0,
        `${quiet.join(', ')} never fired with the key held — the allow-list has stopped letting things through`);
      assert(polled.length > 30, `only ${polled.length} actions were polled in a second`);
      return `${new Set(polled).size} distinct actions held for a second: `
        + `${fired.join(', ')} fired, 0 of the 8 refused ones did`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Walking, and the edge                                             */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck: you walk to the lip and the field stops you there', async () => {
    /**
     * "Walk to the shield edge and stand there — reward it with the best view
     * in the scene."
     *
     * Two halves and both are failures if either is missing: a player who
     * cannot walk is standing in a diorama, and a player who CAN walk off a
     * deck with no railing on it falls 128 m into a heightfield that has ended.
     * `Hangar.addField` puts four static boxes on the lip for exactly this and
     * this is the thing that drives them.
     */
    const { world } = await deck();
    try {
      const p = world.player;
      /* HALFWAY BETWEEN TWO STROBES. `addField` stands one every 16 m along
       * the lip, one of them at x=0, so a walk straight up the centreline
       * measures a marker rather than the edge. x=9 is the gap. (This said
       * `dressDeck`, a function deleted two rewrites ago along with the
       * stanchions it named; the strobes it describes did not exist at all for
       * a while, and this comment was the only record that they should.) */
      const start = new THREE.Vector3(9, world.terrain.height(9, DECK.start.z), DECK.start.z);
      p.position.copy(start);
      p.velocity.set(0, 0, 0);
      p.body?.setTransform?.(new THREE.Vector3(start.x, start.y + 0.9, start.z), null);
      p.camera.yaw = Math.PI; p.camera.pitch = 0;          // facing forward, at the aperture
      const z0 = p.position.z;
      step(world, 4, walk(idleInput()));
      const moved = p.position.z - z0;
      assert(moved > 8, `four seconds of forward moved the player ${moved.toFixed(1)} m — he cannot walk`);
      /**
       * LONG ENOUGH FOR THE WALK THIS ROOM ACTUALLY IS, DERIVED.
       *
       * This was a literal 40 s under a comment saying "long enough to cross
       * the whole deck twice at 4.6 m/s" — true of the 98 m walk this check
       * was written against, and false the moment the room was rescaled:
       * `DECK.start.z` went to -84 and `DECK.lip` to 144, so the walk is 228 m
       * and takes 49.6 s. The check would have reported the player stopping
       * 15 m short of an edge he simply had not reached yet.
       *
       * 4.6 m/s is `Player`'s own base walk with no sprint, no crouch and no
       * boon, which is all `walk(idleInput())` presses. The 1.2 is the damp
       * ramp plus room to be wrong.
       */
      const need = (DECK.lip - DECK.start.z) / 4.6 * 1.2;
      step(world, need - 4, walk(idleInput()));
      assert(p.position.z < DECK.lip + 1,
        `the player walked to z=${p.position.z.toFixed(1)} against a lip at ${DECK.lip} — he is off the ship`);
      /**
       * A METRE. The field's barrier is a box whose inner face stands ON the
       * lip and the body has a 0.34 m radius, so a player leaning on it is at
       * about 63.6 — and anything that stopped him further back than 63 is an
       * invisible wall in front of the one view the level is composed to
       * reward. `EDGE_MARGIN` in Player.js is the one that used to: measured at
       * 58.00 on four separate bearings before it was taken to nought here.
       */
      assert(p.position.z > DECK.lip - 1,
        `the player stopped ${(DECK.lip - p.position.z).toFixed(2)} m short of the lip — something is `
        + 'between him and the one view the room is composed to reward');
      assert(p.position.y > -2 && p.alive,
        `the player is at y=${p.position.y.toFixed(1)} and alive=${p.alive} — he fell off the deck`);
      return `walked ${(p.position.z - z0).toFixed(1)} m and stopped `
        + `${(DECK.lip - p.position.z).toFixed(2)} m inside the field`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  Crates                                                            */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck: you can pick a crate up and throw it', async () => {
    /**
     * "Pick up crates and ships, throw them at the shield."
     *
     * Driven through the real keys on a real World: grip, hold, hurl. No power
     * is called directly — the point is that the INPUT path a player has works
     * with the blade down, which is the one thing the `hosting` branch could
     * plausibly have broken.
     */
    const { world } = await deck();
    try {
      const p = world.player;
      step(world, 0.3, idleInput());
      const crates = world.props.filter((q) => q.kind === 'crate' && !q.dead);
      assert(crates.length >= 4,
        `${crates.length} loose crates on the deck — "a hangar you cannot pick anything up in is a diorama"`);
      assert(crates.every((c) => c.body.layer === LAYER.PROP && c.body.invMass > 0),
        'a loose crate is not a dynamic PROP body, so the Force cannot see it');
      assert(crates.every((c) => p._grippableBody(c.body)), 'the Force refuses a deck crate');

      /* Stand four metres from a crate and look at it. */
      const c = crates[0];
      const stand = new THREE.Vector3(c.body.position.x, 0, c.body.position.z + 4);
      stand.y = world.terrain.height(stand.x, stand.z);
      aimAt(world, stand, c.body.position, step, idleInput, THREE);

      const y0 = c.body.position.y;
      world.update(1 / 60, press(idleInput(), 'grip'));
      assert(p.gripBody === c.body,
        `grip took ${p.gripBody ? 'a different body' : 'nothing'} — ${p.lastGripRefusal?.why || 'no refusal given'}`);
      /* AND A HELD THING FOLLOWS THE AIM. `_updateGrip` walks it toward
       * `camera.pos + aimDir · gripDistance` — so "carried" is not a height, it
       * is the crate going where the player looks, and looking up is what
       * takes it off the deck. A first cut asserted a bare rise and measured
       * 0.05 m, which is exactly right for a crate held level. */
      p.camera.pitch = 0.42;
      step(world, 1.4, idleInput());
      const lift = c.body.position.y - y0;
      assert(p.gripBody === c.body, 'the grip dropped the crate while it was being carried');
      assert(lift > 0.8, `the held crate rose ${lift.toFixed(2)} m as the player looked up — it is `
        + 'being dragged along the deck, not carried');

      /* Throw it up the deck. `hurlGripped` sends it at whatever the aim is
       * pointing at, so the pitch it is being held at is the throw. */
      world.update(1 / 60, press(idleInput(), 'hurl'));
      const speed = c.body.velocity.length();
      assert(!p.gripBody, 'the hurl did not let go');
      assert(speed > 8, `the crate left the hand at ${speed.toFixed(1)} m/s — that is a drop, not a throw`);
      const from = c.body.position.clone();
      step(world, 0.8, idleInput());
      const flew = from.distanceTo(c.body.position);
      assert(flew > 4, `the crate travelled ${flew.toFixed(1)} m in 0.8 s`);
      return `lifted ${lift.toFixed(2)} m, left at ${speed.toFixed(1)} m/s, travelled ${flew.toFixed(1)} m`;
    } finally { world.unload(); }
  });

  check('deck: the five verbs the deck keeps all reach a body', async () => {
    /**
     * The allow-list, driven rather than read: push and unleash both move a
     * crate that nothing else touched, and both spend what `POWER_COST` says.
     * `pull`, `grip` and `stasis` share the same two loops over
     * `ctx.physics.bodies`, so what this is really pinning is that the branch
     * routes the keys at all.
     */
    const { world } = await deck();
    try {
      const p = world.player;
      step(world, 0.3, idleInput());
      const c = world.props.filter((q) => q.kind === 'crate' && !q.dead)[0];
      const stand = new THREE.Vector3(c.body.position.x, 0, c.body.position.z + 4);
      stand.y = world.terrain.height(stand.x, stand.z);
      aimAt(world, stand, c.body.position, step, idleInput, THREE);

      const before = c.body.position.clone();
      const force0 = p.force;
      world.update(1 / 60, press(idleInput(), 'push'));
      const spent = force0 - p.force;
      assert(spent > 1, `push spent ${spent.toFixed(1)} Force — the key never reached the power`);
      step(world, 0.6, idleInput());
      const shoved = before.distanceTo(c.body.position);
      assert(shoved > 0.5, `a push moved the crate ${shoved.toFixed(2)} m`);

      /* And the 360 one, which is what "shove the LINE over" needs: push is a
       * 0.72-radian cone and a formation is all round you. */
      p.force = p.maxForce;
      p.cooldowns.unleash = 0;
      const before2 = c.body.position.clone();
      world.update(1 / 60, press(idleInput(), 'unleash'));
      assert(p.maxForce - p.force > 20, 'unleash never fired');
      step(world, 0.6, idleInput());
      assert(before2.distanceTo(c.body.position) > 0.3, 'unleash moved nothing');
      return `push ${spent.toFixed(0)} Force and ${shoved.toFixed(2)} m, unleash fired`;
    } finally { world.unload(); }
  });

  /* ══════════════════════════════════════════════════════════════════ */
  /*  The line                                                          */
  /* ══════════════════════════════════════════════════════════════════ */

  check('deck: a man on the line can be shoved over, and gets himself back up', async () => {
    /**
     * "Shove the line over, they get up and re-form, annoyed."
     *
     * `src/physics/Shovable.js` is what a parade figure costs: ONE dynamic body
     * a man, on the PROP layer, asleep at his mark. This drives the whole cycle
     * on a real World with a real Force push — POST, DOWN, REST, RISE, BACK,
     * POST — and asserts the two properties the room lives on: the Force can
     * feel him with no change to `Player.js`, and he ends up back on his mark.
     */
    const { world } = await deck();
    try {
      const p = world.player;
      step(world, 0.3, idleInput());
      const mark = new THREE.Vector3(0, world.terrain.height(0, DECK.line), DECK.line);
      const man = new Shovable(world, mark, { facing: Math.PI });
      try {
        assert(man.state === STATE.POST, 'a man built at his mark is not at his post');
        assert(!man.body.awake, 'a man standing at attention is keeping a solver island awake');
        assert(p._grippableBody(man.body),
          'the Force cannot take hold of a man on the line — which is the whole point of the body');

        /* Twenty frames of him being left alone: he does not wander. */
        step(world, 0.4, idleInput());
        man.update(1 / 60);
        assert(man.state === STATE.POST && man.at.distanceTo(mark) < 0.02,
          `a man left alone drifted ${man.at.distanceTo(mark).toFixed(3)} m off his mark`);

        /* Now shove him, with the real power, from four metres away. */
        const stand = new THREE.Vector3(0, 0, DECK.line + 4);
        stand.y = world.terrain.height(stand.x, stand.z);
        const chest = man.at.clone().setY(man.at.y + SHOVE.halfH);
        aimAt(world, stand, chest, step, idleInput, THREE);
        p.force = p.maxForce;
        p.cooldowns.push = 0;
        man.update(1 / 60);
        world.update(1 / 60, press(idleInput(), 'push'));
        man.update(1 / 60);
        step(world, 0.4, idleInput(), () => man.update(1 / 60));
        assert(man.state === STATE.DOWN || man.state === STATE.REST,
          `a Force push left the man in state '${man.state}' — he was not shoved over`);
        assert(man.falls === 1, `the man logged ${man.falls} falls for one push`);

        /* And he gets up. `down` + `rise` + the walk home, plus slack. */
        let frames = 0;
        for (; frames < 60 * 20 && man.state !== STATE.POST; frames++) {
          world.update(1 / 60, idleInput());
          man.update(1 / 60);
        }
        assert(man.state === STATE.POST,
          `the man never re-formed: still '${man.state}' after ${(frames / 60).toFixed(1)} s`);
        assert(man.at.distanceTo(mark) < SHOVE.mark + 0.02,
          `he formed up ${man.at.distanceTo(mark).toFixed(2)} m off his mark`);
        assert(!man.body.awake, 'a man back at his post is still awake');
        assert(man.up === 1, 'he is standing on his mark and the pose handle still says he is down');
        return `pushed over, up and re-formed in ${(frames / 60).toFixed(1)} s, `
          + `${man.at.distanceTo(mark).toFixed(3)} m off his mark`;
      } finally { man.dispose(); }
    } finally { world.unload(); }
  });

  check('deck: a line of twenty-four men is twenty-four bodies and nothing else', async () => {
    /**
     * THE COST, STATED AS A NUMBER SO IT CANNOT DRIFT.
     *
     * `World` builds its solver with `maxBodies: 1100`. The alternative to this
     * file is `Ragdoll.Actor.goRagdoll`, which is 19 bodies and 18 joints a man
     * — 456 and 432 for a line going over at once, 41% of the budget for one
     * press of `unleash`, and incompatible with the merged skin the deck needs
     * to draw two dozen figures at all. This is the receipt for the cheaper
     * answer: one body each, no joints, and asleep when nobody is touching them.
     */
    const { world } = await deck();
    try {
      const n0 = world.physics.bodies.length;
      const men = [];
      for (let i = 0; i < 24; i++) {
        const x = -24 + i * 2.1;
        men.push(new Shovable(world, new THREE.Vector3(x, world.terrain.height(x, DECK.line), DECK.line)));
      }
      try {
        const added = world.physics.bodies.length - n0;
        assert(added === 24, `24 men cost ${added} bodies`);
        step(world, 1.5, idleInput(), () => { for (const m of men) m.update(1 / 60); });
        const awake = men.filter((m) => m.body.awake).length;
        assert(awake === 0, `${awake} of 24 men standing at attention are keeping an island awake`);
        assert(men.every((m) => m.state === STATE.POST), 'a man fell over on his own');
        return `24 men = ${added} bodies, 0 joints, ${24 - awake} of 24 asleep at attention`;
      } finally { for (const m of men) m.dispose(); }
    } finally { world.unload(); }
  });
}
