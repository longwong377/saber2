/**
 * THE RULE: A THING IN MOTION AFFECTS WHAT IT MEETS, WHOEVER SET IT MOVING.
 *
 * The brief says everything is simulated. It very nearly was. What was missing
 * was the last clause: an object meeting another object and that MEANING
 * something. `RapierWorld` stored `Body.onContact` from the day it replaced the
 * sphere solver and dispatched it nowhere, so for the whole life of the Rapier
 * engine nothing in the game was ever told that two things touched.
 *
 * The visible consequence was narrow and specific and easy to miss: only the
 * PLAYER'S OWN THROWS ever hurt anything, because the thrower ran a private
 * sphere sweep. A crate dropped on a droid by a collapsing gantry, a barrel
 * thrown by a blast, a droid shoved into the droid behind it — every one of
 * those passed through and did nothing, not because anybody decided it should
 * but because there was no wire between the physics and the damage.
 *
 * ── what this file asserts ─────────────────────────────────────────────
 *
 * 1. The channel exists and fires, and it fires for a contact NO PLAYER
 *    CAUSED. That is the whole point and it is the first check for that
 *    reason — a suite that only ever tested the thrown crate would have passed
 *    against the broken build.
 * 2. It prices a hit rather than merely reporting one, and prices it through
 *    the function the game already uses, so a contact and a throw agree.
 * 3. It can tell a HIT from a GRAZE. This is the property that a closing-speed
 *    reading fails and the one that decides whether the channel is usable: a
 *    crate skidding along the ground must not read as a crate hitting a wall.
 * 4. It costs nothing when nothing is happening. A settled level must not bill
 *    a contact a frame — the failure mode ROADMAP item 4 warns about by name.
 * 5. Nobody is billed twice. The thrown crate has two systems that could claim
 *    it and exactly one that may.
 *
 * A check that cannot fail is worse than no check (HANDOFF 2.3), so each one
 * below states a property a coincidence could not satisfy: a number that has
 * to move in a direction, or a count that has to be zero while a sibling count
 * is not.
 */

import { clocked } from './_shared.mjs';

export async function run({ check, assert }) {
  check = await clocked(check);

  const THREE = await import('three');
  const { initPhysics } = await import('../../src/physics/Rapier.js');
  await initPhysics();
  const RW = await import('../../src/physics/RapierWorld.js');
  const { RapierWorld, Body, box } = RW;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  /** A flat world with a floor, and nothing else in it. */
  const bare = (opts = {}) => {
    const w = new RapierWorld({ gravity: -30, ...opts });
    w.addStaticBox(V(0, -0.5, 0), V(80, 0.5, 80));
    return w;
  };

  check('contacts: a collision nobody threw is reported, with both parties', () => {
    const w = bare();
    const seen = [];
    /* NOT thrown by a player, and no player in this world at all: a crate that
     * is simply falling, which is what a collapse produces. */
    const crate = new Body({ position: V(0, 9, 0), mass: 22, shape: box(0.4, 0.4, 0.4) });
    crate.onContact = (other, c) => seen.push({ other: !!other, world: c.world, speed: c.speed, mass: c.mass });
    w.add(crate);
    const anvil = new Body({ position: V(0, 0.4, 0), mass: 80, shape: box(0.4, 0.4, 0.4) });
    w.add(anvil);
    for (let i = 0; i < 200; i++) w.step(1 / 60);
    w.dispose();

    assert(seen.length > 0,
      'nothing was reported. A body fell nine metres onto another body and the game was not told — '
      + 'which is the state `Body.onContact` was in for the whole life of the Rapier engine');
    const onBody = seen.filter((h) => h.other);
    assert(onBody.length > 0, `${seen.length} contacts and none of them names the other party`);
    /* The reduced mass of 22 and 80 is 17.25, and it must be that rather than
     * either body's own mass — otherwise the pairing is not being computed. */
    const m = onBody[0].mass;
    assert(Math.abs(m - (22 * 80) / 102) < 0.5,
      `the mass of a 22 kg / 80 kg meeting reads ${m.toFixed(2)}; the reduced mass is 17.25, and a `
      + 'reading of 22 or 80 means the exchange is being priced against one body instead of the pair');
    return `${seen.length} contacts, ${onBody.length} body-on-body, reduced mass ${m.toFixed(2)} kg`;
  });

  check('contacts: a hit is priced, a graze is not', () => {
    /* THE PROPERTY THAT DECIDES WHETHER THE CHANNEL IS USABLE. Both crates are
     * travelling at the same 30 m/s. One drives into a wall; the other skids
     * along the floor and hits nothing. If the channel reads the closing speed
     * it cannot tell them apart — measured, the skid reported a 30.31 m/s
     * impact with the world every time the contact restarted. */
    const hit = [];
    {
      const w = bare();
      const c = new Body({ position: V(-6, 1, 0), mass: 22, shape: box(0.4, 0.4, 0.4),
        linearDamping: 0, gravityScale: 0 });
      c.onContact = (o, k) => hit.push(k.speed);
      w.add(c);
      w.addStaticBox(V(0, 1, 0), V(0.5, 2, 4));
      c.velocity.set(30, 0, 0);
      for (let i = 0; i < 120; i++) w.step(1 / 60);
      w.dispose();
    }
    const graze = [];
    {
      const w = bare();
      const c = new Body({ position: V(-20, 0.41, 0), mass: 22, shape: box(0.4, 0.4, 0.4),
        friction: 0.05, linearDamping: 0 });
      c.onContact = (o, k) => graze.push(k.speed);
      w.add(c);
      c.velocity.set(30, 0, 0);
      for (let i = 0; i < 180; i++) w.step(1 / 60);
      w.dispose();
    }
    const worst = graze.length ? Math.max(...graze) : 0;
    const best = hit.length ? Math.max(...hit) : 0;
    assert(best > 15, `a 30 m/s crate into a wall priced at ${best.toFixed(2)} m/s — the hit is not being seen`);
    assert(worst < best / 3,
      `a crate SKIDDING at 30 m/s priced at ${worst.toFixed(2)} m/s against a real wall hit of `
      + `${best.toFixed(2)}. A graze reading as a collision is the closing-speed defect returning, and it `
      + 'would make every sliding crate in the level a weapon');
    return `wall ${best.toFixed(1)} m/s, graze ${worst.toFixed(1)} m/s`;
  });

  check('contacts: a settled pile bills nothing', () => {
    /* The frame-budget disaster ROADMAP item 4 warns about, as a number. A
     * contact-FORCE channel fails this by construction — a resting body presses
     * on the ground with its own weight forever — which is why the dispatcher
     * is built on contact STARTS. */
    const w = bare();
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const b = new Body({ position: V((i % 7) - 3, 1.2 + Math.floor(i / 7), 0), mass: 22,
        shape: box(0.4, 0.4, 0.4) });
      b.onContact = () => { n++; };
      w.add(b);
    }
    let settling = 0;
    for (let i = 0; i < 240; i++) w.step(1 / 60);
    settling = n;
    for (let i = 0; i < 420; i++) w.step(1 / 60);
    const after = n - settling;
    const flagged = w.bodies.filter((b) => b._armed).length;
    w.dispose();

    assert(settling > 0, 'forty crates were dropped in a heap and not one contact was reported');
    assert(after === 0,
      `${after} contacts billed over seven seconds by a pile that had already stopped moving. A channel `
      + 'that talks while nothing is happening is the one this was built to avoid');
    assert(flagged === 0,
      `${flagged} settled bodies still carry the Rapier event flag — the arming gate is not letting go`);
    return `${settling} while settling, ${after} over the next 7 s, ${flagged} still flagged`;
  });

  check('contacts: the law prices a contact exactly as the throw it replaces would', async () => {
    /* HANDOFF 2.4 — the shipped rule is the authority. If Impact invented its
     * own arithmetic instead of calling the game's, a crate that hits a droid
     * because you threw it and one that hits because a roof fell on it would
     * drift apart, and nobody would find out for a year. */
    const { impactDamage } = await import('../../src/game/Combat.js');
    const I = await import('../../src/game/Impact.js');
    const mass = 17.25, speed = 30;
    const viaLaw = impactDamage(mass, speed, I.KINETIC);
    const direct = Math.min(140, Math.max(0, mass * speed * speed * 0.0006));
    assert(Math.abs(viaLaw - direct) < 1e-9,
      `Impact.KINETIC prices a 17.25 kg / 30 m/s meeting at ${viaLaw.toFixed(3)} where impactDamage's own `
      + `coefficients give ${direct.toFixed(3)} — the law has grown a second copy of the rule`);
    assert(I.KINETIC.k === 0.0006,
      `Impact.KINETIC.k is ${I.KINETIC.k}; the crate coefficient the throw uses is 0.0006, and the two `
      + 'have to be one number or a thrown crate and a dropped one stop agreeing');
    assert(I.KINETIC_MIN_SPEED > 0 && I.KINETIC_MIN_SPEED < 12,
      `KINETIC_MIN_SPEED is ${I.KINETIC_MIN_SPEED}; outside 0..12 either every nudge is a hit or nothing is`);
    return `17.25 kg at 30 m/s → ${viaLaw.toFixed(1)} damage, through the game's own curve`;
  });

  check('contacts: only strikers are armed, so one collision is billed once', async () => {
    /* Both sides of a pair are offered a handler. The rule that stops a double
     * bill needs no bookkeeping — arm the things that DELIVER a hit and never
     * the things that take one — and this is the check that the rule is being
     * kept, stated against the shipped constructors rather than against a list
     * somebody maintains by hand. */
    const H = await import('./_coop.mjs');
    const { world } = await H.bootWorld({ level: 'geonosis', settings: { mode: 'waves', quality: 'low' } });
    const input = H.idleInput();
    for (let i = 0; i < 30; i++) world.update(1 / 60, input);

    let props = 0, armedProps = 0, armedVictims = 0;
    const victims = [];
    for (const b of world.physics.bodies) {
      const u = b.userData;
      if (u.prop) { props++; if (b.onContact) armedProps++; }
      if (u.enemy || u.player) { if (b.onContact) { armedVictims++; victims.push(u.enemy ? 'enemy' : 'player'); } }
    }
    world.unload();

    assert(props > 0, 'no prop bodies on Geonosis — this check is not looking at anything');
    assert(armedProps === props,
      `${armedProps} of ${props} props carry the kinetic law. A prop that is not armed is a crate that `
      + 'falls on a droid and does nothing, which is the defect this whole channel exists to close');
    assert(armedVictims === 0,
      `${armedVictims} bodies that only ever TAKE hits are armed (${victims.join(', ')}). Both sides of a `
      + 'contact are called, so arming a victim bills one collision twice');
    return `${armedProps}/${props} props armed, 0 victims armed`;
  });

  check('contacts: a crate nobody threw hurts the droid it lands on', async () => {
    /**
     * THE HEADLINE, IN A REAL LEVEL, WITH NO PLAYER TOUCHING IT.
     *
     * This is the sentence the whole channel exists to make true, and it is
     * the one the build has been failing since the Rapier migration: a heavy
     * object put in motion by SOMETHING OTHER THAN THE PLAYER'S HAND — a
     * collapse, a blast, another droid — arriving on a living thing and
     * hurting it. `Player._updateHurled` cannot make this true, because it
     * only ever walks things the player threw.
     *
     * The crate is dropped from six metres with `hurledBy` deliberately unset,
     * so nothing in the game has any claim on it. If this check ever fails,
     * the game is back to a world where only your own throws are real.
     */
    const H = await import('./_coop.mjs');
    const { makeCrate } = await import('../../src/world/Props.js');
    /* SEEDED, because this check is about geometry and the level is not. The
     * crate factory varies its size from the shared stream and the colosseum
     * draws its dressing from it too, so run in a file where other checks have
     * already drawn, "over the droid's head" lands somewhere else and the drop
     * misses. Found the hard way: this check passed alone and failed sixth. */
    const { enemyRng } = await import('../../src/game/Enemy.js');
    enemyRng.seed(7);
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low', instantSpawn: true } });
    const input = H.idleInput();
    for (let i = 0; i < 40; i++) world.update(1 / 60, input);

    const p = world.player;
    const target = world.spawnEnemy('b1', new THREE.Vector3(p.position.x, p.position.y, p.position.z - 7));
    assert(target && !target.dead, 'could not spawn a droid — this check is not looking at anything');
    for (let i = 0; i < 20; i++) world.update(1 / 60, input);
    const hp0 = target.hp;

    /* The level's own crate factory, so this is the object the game ships and
     * not a special one built to pass.
     *
     * DRIVEN SIDEWAYS FROM CLOSE UP RATHER THAN DROPPED FROM A HEIGHT, and the
     * first version did drop it: six metres onto the droid's head. That passed
     * and then failed depending on what had run before it, because six metres
     * of falling is six metres of everything else in the level having an
     * opinion — measured, the same drop that took 11.7 hp in a fresh process
     * ended up BELOW the floor in a second world booted after the first was
     * unloaded, having gone past the droid entirely. The channel had fired
     * either way; the crate had simply missed. A check whose subject is "does
     * a contact do damage" must not also be a test of a six-metre trajectory.
     *
     * Two metres, horizontal, aimed at the capsule centre: same object, same
     * law, no flight time to accumulate anything. */
    const c0 = target.body.position.clone();
    const crate = makeCrate(world, c0.clone(), 0.8, { mass: 120 });
    assert(crate?.body, 'could not build a test crate');
    assert(!crate.body.userData.hurledBy,
      'the test crate arrived already attributed to somebody — this check would then be testing the throw');
    /* At the BODY's height, not `position`'s — an Enemy's `position` is its
     * feet and its capsule centre is most of a metre above that. */
    crate.body.position.set(c0.x - 2, c0.y, c0.z);
    crate.body.gravityScale = 0;
    crate.body.velocity.set(18, 0, 0);
    crate.body.wake();

    for (let i = 0; i < 60; i++) world.update(1 / 60, input);
    const lost = hp0 - target.hp;
    const dead = target.dead;
    world.unload();

    assert(lost > 0 || dead,
      `a 120 kg crate was driven into a droid at 18 m/s and it lost ${lost.toFixed(1)} hp. Nothing that is not `
      + 'thrown by the player has ever hurt anything in this game, and this is the check that says so');
    return dead ? 'the droid was killed by a crate nobody threw' : `the droid lost ${lost.toFixed(1)} hp to a crate nobody threw`;
  });

  check('contacts: a prop is not destroyed by the act of landing', async () => {
    /**
     * THE REGRESSION THIS CHANNEL ALREADY CAUSED ONCE, kept as a rule.
     *
     * The first version billed every armed body a share of the damage it dealt,
     * including against the world. `dropped.mjs` failed at once: a dropped
     * lightsaber is a `Prop`, landing is a contact with the world at a speed
     * that clears every gate, and the blade on the floor shattered on arrival.
     *
     * Breaking props on impact is a balance decision, so it is opt-in now
     * (`fragile: true`). This asserts the default, because the next person to
     * want thrown crates to break will reach for exactly the switch that broke
     * this, and the failure is silent — a prop that shatters as it lands looks
     * like a prop that was never there.
     */
    const I = await import('../../src/game/Impact.js');
    assert(I.KINETIC.fragile !== true,
      'the default kinetic tuning is `fragile` again. Every prop in every level now takes damage from its '
      + 'own landing, and a dropped weapon shatters on the floor');

    const H = await import('./_coop.mjs');
    const { makeCrate } = await import('../../src/world/Props.js');
    const { world } = await H.bootWorld({
      level: 'colosseum', settings: { mode: 'waves', quality: 'low' } });
    const input = H.idleInput();
    for (let i = 0; i < 20; i++) world.update(1 / 60, input);
    const p = world.player;
    const at = p.position.clone(); at.x += 3;
    const crate = makeCrate(world, at, 0.7, { mass: 40 });
    assert(crate?.body, 'could not build a test crate');
    crate.body.position.y += 5;
    crate.body.wake();
    for (let i = 0; i < 150; i++) world.update(1 / 60, input);
    const gone = crate.dead;
    world.unload();
    assert(!gone,
      'a 40 kg crate dropped five metres destroyed itself on the floor. Landing is not an attack, and a '
      + 'prop that cannot survive being put down is not a prop');
    return 'a five-metre drop leaves the crate intact';
  });

  check('contacts: every striker the tree builds is armed, including ones added later', async () => {
    /**
     * THE RULE THAT HAS TO SURVIVE THE NEXT PERSON, and the reason it is a
     * source scan rather than a list.
     *
     * `Impact.armKinetic` on a `Prop` covers every prop in every level for free,
     * because props are built by one constructor. Nothing else is: debris,
     * wrecked chassis and the chunks a building collapses into are each
     * constructed at their own `new Body(...)` site, and a fourth site added
     * next month would be a whole new class of object that silently does
     * nothing when it lands on somebody — which is precisely the defect this
     * channel was built to end, returning by the back door.
     *
     * A hand-kept list of sites is the thing HANDOFF 2.3 warns about, so the
     * subject is DERIVED: every `new Body(` in the tree whose options name the
     * DEBRIS or PROP layer is a striker, and every one of them has to be armed
     * within sight of its construction. Anything that genuinely should stay
     * inert says so with `kinetic: false` on the same line and is exempted by
     * that rather than by being forgotten.
     */
    const { readFileSync } = await import('node:fs');
    const { readdirSync, statSync } = await import('node:fs');
    const roots = ['src/game', 'src/world'];
    const files = [];
    for (const r of roots) {
      const dir = new URL(`../../${r}/`, import.meta.url);
      for (const f of readdirSync(dir)) if (f.endsWith('.js')) files.push([`${r}/${f}`, new URL(f, dir)]);
    }
    const strikers = [], unarmed = [];
    for (const [name, url] of files) {
      const src = readFileSync(url, 'utf8');
      let i = -1;
      while ((i = src.indexOf('new Body(', i + 1)) !== -1) {
        /* The construction plus what follows it, which is where arming happens.
         * 1200 characters is comfortably past the longest of these sites and
         * well short of the next one. */
        const window = src.slice(i, i + 1200);
        const opts = window.slice(0, window.indexOf('});') + 3);
        if (!/layer:\s*LAYER\.(DEBRIS|PROP)/.test(opts)) continue;
        const line = src.slice(0, i).split('\n').length;
        strikers.push(`${name}:${line}`);
        if (!/armKinetic\(|kinetic:\s*false/.test(window)) unarmed.push(`${name}:${line}`);
      }
    }
    assert(strikers.length >= 3,
      `only ${strikers.length} striker construction sites found across src/game and src/world — the scan is `
      + 'not finding them, and a scan that finds nothing passes forever');
    assert(unarmed.length === 0,
      `${unarmed.length} of ${strikers.length} striker sites build a body on the DEBRIS or PROP layer and `
      + `never arm it: ${unarmed.join(', ')}. A body that can land on somebody and does nothing is the `
      + 'defect this channel exists to close. Call `armKinetic(body)`, or say `kinetic: false` if it is '
      + 'genuinely meant to be inert');
    return `${strikers.length} striker sites, all armed — ${strikers.join(', ')}`;
  });

  check('contacts: debris and wrecks are armed the moment the world makes them', async () => {
    /* The source scan above proves the CALL is there; this proves it took, on
     * the objects the world actually hands out. Both are wanted: a scan cannot
     * see a call that runs on a branch nobody takes. */
    const H = await import('./_coop.mjs');
    const T = await import('three');
    const { world } = await H.bootWorld({ level: 'colosseum', settings: { mode: 'waves', quality: 'low' } });
    const input = H.idleInput();
    for (let i = 0; i < 20; i++) world.update(1 / 60, input);
    const at = world.player.position.clone(); at.y += 2; at.x += 3;

    const mesh = new T.Mesh(new T.BoxGeometry(0.3, 0.3, 0.3), new T.MeshBasicMaterial());
    world.spawnDebris(mesh, at.clone(), new T.Vector3(0, 1, 0), new T.Vector3(0.3, 0.3, 0.3));
    const deb = world.debris[world.debris.length - 1];
    assert(deb?.body, 'spawnDebris produced no body');
    const debArmed = !!deb.body.onContact;
    world.unload();
    assert(debArmed,
      'a fragment of a shattered prop is not armed. A crate broken over somebody\'s head showers them with '
      + 'pieces that pass straight through, which is the same defect the whole channel was rebuilt to fix');
    return 'spawnDebris hands out an armed body';
  });

  check('contacts: the thrown crate is claimed by exactly one system', async () => {
    /* The prop half of `Player._updateHurled` was retired when this channel
     * came back, because a prop's mask names ENEMY and the contact reaches the
     * droid against the real hull. Keeping both would bill the throw twice.
     * The body half was NOT retired and must not be quietly finished: a
     * ragdoll and a living enemy are not a collider pair at all. */
    const src = await import('node:fs').then((fs) => fs.readFileSync(
      new URL('../../src/game/Player.js', import.meta.url), 'utf8'));
    const upd = src.slice(src.indexOf('_updateHurled(dt, ctx) {'));
    const body = upd.slice(0, upd.indexOf('\n  }\n'));
    assert(/if \(!h\.isBody\)/.test(body),
      '`_updateHurled` no longer separates a prop record from a body record. A prop is handled by the '
      + 'contact channel now, and a sweep that still walks `ctx.enemies` for one bills it twice');
    assert(/hurledBy/.test(body),
      '`_updateHurled` no longer clears `userData.hurledBy`. That claim is what makes a kill yours, and '
      + 'a claim nothing releases credits you with a crate that killed somebody two minutes later');

    const { LAYER } = RW;
    const rag = await import('node:fs').then((fs) => fs.readFileSync(
      new URL('../../src/game/Ragdoll.js', import.meta.url), 'utf8'));
    assert(!/mask:\s*LAYER\.WORLD \| LAYER\.RAGDOLL \| LAYER\.DEBRIS \| LAYER\.PROP \| LAYER\.PLAYER \| LAYER\.ENEMY/.test(rag),
      'Ragdoll\'s mask now names ENEMY. That is the change that would let the contact channel reach a '
      + 'thrown body — which is good, but it means the body branch of `_updateHurled` is now a SECOND '
      + 'system billing the same hit, and it has to be retired in the same commit');
    assert(LAYER.ENEMY && LAYER.RAGDOLL, 'the layer table lost ENEMY or RAGDOLL');
    return 'prop through contacts, body through the sweep, masks unchanged';
  });
}
