/**
 * BATTLEFIELD BORZ — WHAT IS IN A BODY'S HAND, AND WHETHER IT GLOWS.
 *
 * The player, on their own line: "sometimes I see my own troops and they have
 * light sabers and I don't know why, unless they are other jedi or sith that
 * are helping you it doesn't make sense for a fucking droid to be holding a
 * lightsaber."
 *
 * They were reading the roster correctly, and the defect is a good example of
 * one flag doing two jobs. `saber: true` is what routes a body through
 * `DuelBrain` — it means "this thing duels" — and it was ALSO deciding what the
 * weapon looked like. Three droids declare it: the BX commando, the MagnaGuard
 * and the IG bodyguard. Two of those three are rungs of the SEPARATIST ladder,
 * so a Sith player, whose army is the Separatists (`Command.sideForOrder`),
 * musters a line carrying plasma.
 *
 * Both archetype tables had already written the gap down and neither could act
 * on it. Command.js: the BX carries "a VIBROSWORD. It is melee: true, saber:
 * true today, which puts a glowing blade in a commando droid's hand." Levels.js
 * on the bodyguard: "An electrostaff, not a lightsaber" — and then reached for
 * `saberColor: 5`, which is a lightsabre in a colder colour.
 *
 * `weaponStyle` separates the two jobs. This suite holds the separation:
 *
 *   1. every sabered archetype is either a FORCE USER or carries a physical
 *      weapon, with no third case;
 *   2. a physical weapon shows no plasma, posts no light and plays no hum;
 *   3. the blade GEOMETRY the fight reads is untouched by the style, so a
 *      vibrosword cuts exactly as a lightsabre of the same length does. That
 *      is the property that makes this a change of appearance rather than a
 *      balance change nobody asked for.
 */

/** Who is allowed a lightsabre: a body that uses the Force. */
const FORCE_USERS = new Set([
  'acolyte', 'jedi', 'sentinel', 'guardian', 'master', 'sparring',
]);

export async function run({ check, assert }) {
  check('weapons: only a force user carries plasma, and every other blade is a real weapon', async () => {
    const { ARCHETYPES } = await import('../../src/game/Enemy.js');
    /* Levels.js and Command.js register their own rows at module scope, and
     * 16 of the roster's archetypes are unreachable without them — HANDOFF §1
     * says so about `tools/state.mjs`, and it is true here for exactly the two
     * rows this check exists for. */
    await import('../../src/game/Levels.js');
    await import('../../src/game/Command.js');
    const sabered = Object.entries(ARCHETYPES).filter(([, A]) => A.saber);
    assert(sabered.length >= 8, `only ${sabered.length} archetypes duel — the roster has shrunk unexpectedly`);
    const glowing = [], physical = [];
    for (const [k, A] of sabered) {
      const isForce = FORCE_USERS.has(k);
      if (A.weaponStyle) {
        assert(!isForce,
          `${k} is a force user and carries a '${A.weaponStyle}' — a Jedi's weapon is a lightsabre`);
        assert(A.weaponStyle === 'vibro' || A.weaponStyle === 'staff',
          `${k} declares weaponStyle '${A.weaponStyle}', which Saber does not build`);
        physical.push(k);
      } else {
        assert(isForce,
          `${k} ("${A.label}") carries a lightsabre and is not a force user. That is the player's own note: `
          + '"it doesn\'t make sense for a fucking droid to be holding a lightsaber". Give it '
          + "weaponStyle: 'vibro' or 'staff', which changes the look and not the fight");
        glowing.push(k);
      }
    }
    assert(physical.length >= 3,
      `${physical.length} sabered bodies carry a physical weapon — the BX, the MagnaGuard and the IG `
      + 'bodyguard are all supposed to');
    return `${glowing.length} plasma (${glowing.join(', ')}) · ${physical.length} physical (${physical.join(', ')})`;
  });

  check('weapons: a physical weapon shows no plasma, lights nothing and does not hum', async () => {
    const THREE = await import('three');
    const { Saber } = await import('../../src/game/Saber.js');
    const scene = new THREE.Scene();
    const rows = [];
    for (const style of [null, 'vibro', 'staff']) {
      const s = new Saber(scene, { weaponStyle: style, bladeLength: 1.0 });
      s.ignite();
      if (!style) {
        assert(!s.physical, 'a plasma blade reported itself physical');
        assert(s.bladeGroup.visible, 'a lit lightsabre is not showing its blade');
        assert(!s.hardGroup, 'a lightsabre built alloy geometry it will never draw');
      } else {
        assert(s.physical, `${style} did not report itself physical`);
        assert(!s.bladeGroup.visible,
          `${style} is showing the plasma quad — this is the glow the player is complaining about`);
        assert(s.hardGroup && s.hardGroup.visible, `${style} built no visible weapon`);
        /* IGNITION IS THE OTHER HALF of "it does not glow". Every emissive path
         * downstream — the trail's strength, the bloom, the light intensity —
         * multiplies by it, and a sword that ramped from 0 to 1 over a fifth of
         * a second would be a sword growing out of a hilt. */
        assert(s.ignition === 1, `${style} ramps its ignition (${s.ignition}) — a sword does not extend`);
      }
      let meshes = 0;
      s.root.traverse((o) => { if (o.isMesh) meshes++; });
      rows.push(`${style || 'plasma'}:${meshes}`);
    }
    return `meshes ${rows.join(' ')}`;
  });

  check('weapons: the style changes the look and not one number the fight reads', async () => {
    /**
     * THE LOAD-BEARING ONE. `Enemy` hands `bladeLength` to `Saber` and every
     * consumer downstream works in blade space off `base`/`tip` — the contact
     * solver, `cutPowerAt`, the clash, the blade lock and the duel's own reach
     * table. If a style moved any of that, a BX would have been silently
     * rebalanced by a change that was supposed to be about appearance, and
     * nothing else in the suite would have said so.
     */
    const THREE = await import('three');
    const { Saber } = await import('../../src/game/Saber.js');
    const scene = new THREE.Scene();
    const sample = (style) => {
      const s = new Saber(scene, { weaponStyle: style, bladeLength: 1.07 });
      s.ignite();
      const pose = new THREE.Vector3(0, 1.2, 0);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4);
      s.setHiltPose(pose, q);
      /* SETTLED FIRST. A lightsabre EXTENDS — `ignition` ramps 0→1 over about
       * a fifth of a second and `base`/`tip` are scaled by it — where a sword
       * is out the instant it is drawn. Comparing frame two against frame two
       * measures that ramp and calls it a geometry change, which is the check
       * manufacturing its own defect (HANDOFF §2.4). Both are run to full
       * extension and compared there. */
      for (let i = 0; i < 90 && s.ignition < 0.9999; i++) s.update(1 / 60, i / 60);
      s.update(1 / 60, 1.6);
      return {
        len: s.bladeLength,
        lit: s.lit,
        base: s.base.clone(),
        tip: s.tip.clone(),
        reach: s.base.distanceTo(s.tip),
      };
    };
    const a = sample(null), b = sample('vibro'), c = sample('staff');
    for (const [name, x] of [['vibro', b], ['staff', c]]) {
      assert(x.len === a.len, `${name} changed bladeLength (${x.len} against ${a.len})`);
      assert(x.lit === a.lit, `${name} is not 'lit', so the contact solver will skip it entirely`);
      /* A MILLIMETRE, not a float epsilon. `ignition` approaches 1
       * exponentially and never arrives — the plasma settles at 0.9999 and its
       * blade is therefore a tenth of a millimetre short for ever. A tolerance
       * tight enough to catch that is a check that fails on arithmetic; a
       * millimetre is two orders below anything the cutting model can feel and
       * three below the smallest reach difference in the duel's own table. */
      assert(Math.abs(x.reach - a.reach) < 1e-3,
        `${name} reaches ${x.reach.toFixed(4)} m against plasma's ${a.reach.toFixed(4)} — the style moved `
        + 'the geometry the fight is decided on');
      assert(x.tip.distanceTo(a.tip) < 1e-3, `${name}'s tip is not where a blade of that length puts it`);
    }
    return `reach ${a.reach.toFixed(3)} m, identical across plasma / vibro / staff`;
  });
}
