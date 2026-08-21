/**
 * BATTLEFRONT BORZ — SUPPORT CALLS: the things you call down rather than do.
 *
 * Player note #29: support calls entered as a short WASD code, and abilities
 * directed at a unit.
 *
 * ── THE WORD, BECAUSE IT WAS SOMEBODY ELSE'S ────────────────────────────
 *
 * These were called stratagems, in the code and on the screen. The player:
 * *"they should not be called strategems in game obviously as that's a
 * helldiver's thing so in case we ever said strategem in game you need to come
 * up with something appropriate to our game"*.
 *
 * They are **SUPPORT CALLS**, made on **the comm**, and paid for out of **war
 * support**. The three names are one sentence and that is why this one was
 * chosen over anything more decorative: the pool a call is drawn from is
 * `WarSupport` and has been since the player asked for it, the preamble the
 * player's own mouth speaks is "Command, this is Borz actual, authenticate",
 * and the object in the Jedi's hand is a comlink. A word invented for the
 * category would have had to be taught; this one is already true of everything
 * on screen. The cool names live where the player asked for them — on the
 * calls themselves, which is where an orbital bombardment, a tractor beam and
 * a thermal fence say what they are.
 *
 * WHAT IS STILL CALLED A STRATAGEM AND WHY. This file, `STRATAGEMS`, the
 * `#stratagem` DOM node and the `stratagem` action id in Bindings.js. All four
 * are identifiers a player cannot see, and the last one is more than that: it
 * is the KEY a rebind is saved under in `localStorage`, so renaming it would
 * silently discard the binding of every player who has ever moved it off
 * CapsLock. `tools/checks/stratagems.mjs` measures the boundary — anything a
 * player can READ is scanned for the word, and the four identifiers are the
 * named exceptions.
 *
 * ── WHY A CODE AND NOT A KEY ────────────────────────────────────────────
 *
 * Every other verb in this game is one press, and that is right for every
 * other verb: a deflection is a reflex and a reflex cannot be spelled. A
 * stratagem is the opposite kind of decision. It is a thing you commit to
 * while somebody is shooting at you, it arrives seconds later, and the cost
 * of it is that you were not fighting while you called it. A code makes that
 * cost REAL and legible — four keystrokes with a rifle line 40 m away is a
 * risk you took, and the same call on a bound key is free.
 *
 * It also solves a problem this project already has and had no answer for:
 * the keyboard is out of keys and the pad is out of buttons (see
 * ORDER_PAD_POOL's note in Bindings.js, which retired six chords to make room
 * for one attack). A code costs ONE binding and scales to as many calls as
 * anyone cares to author, on both devices — the pad's D-pad spells the same
 * four letters the keyboard's WASD does, which is why the codes are stored as
 * directions and not as key names.
 *
 * ── WHAT DECIDES WHAT, and it is three owners and not one ───────────────
 *
 * This file owns WHEN a call fires and WHAT IT COSTS: the code table, the
 * entry state machine, the cooldowns, the refusals. It owns none of the
 * effects. Every effect is a call into the system that already owns that
 * verb — `ArrivalDirector.request` lands troops, `Terrain.crater` breaks
 * ground, `Player._shockwave` throws bodies, `Particles` draws — because a
 * stratagem that reimplemented any of those would be a second copy of a rule
 * that could disagree with the first, which is the defect this codebase keeps
 * removing (HANDOFF §2.3).
 *
 * The consequence to hold on to: adding a stratagem should be adding a ROW,
 * and if it ever needs more than a row plus a call into somebody else's
 * system, the effect belongs in that other system.
 */

import * as THREE from 'three';
import { audio } from '../engine/Audio.js';
import { SUPPORT_MAX, DEAREST_SHARE } from './Support.js';

/** How many canisters a smoke screen lays. Named once: `canisters` walks them
 *  and the check counts them, and two numbers for one payload is §2.3. */
export const SMOKE_CANS = 6;
import { clamp } from '../engine/MathUtil.js';
import { addSmoke, updateSmoke, clearSmoke } from './Smoke.js';
import { SortieDirector } from './Sorties.js';
import { TOUGHNESS } from './Combat.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const TAU = Math.PI * 2;

/**
 * THE FOUR DIRECTIONS, AS DIRECTIONS.
 *
 * A code is `'WSAD'`, not `['KeyW','KeyS','KeyA','KeyD']`, and the difference
 * is the whole reason a pad can enter one. The letters name a DIRECTION; the
 * bindings table names the keys and the pad buttons that mean that direction,
 * and `Stratagems.feed` is handed the direction rather than reading either.
 * A player who has rebound movement to ESDF spells the same codes with the
 * same fingers, which a code written in key names could not survive.
 */
export const DIRS = ['W', 'A', 'S', 'D'];
/** The action id whose axis a direction is read off. One place, both devices. */
export const DIR_ACTION = { W: 'moveF', A: 'moveL', S: 'moveB', D: 'moveR' };
/**
 * HOW A DIRECTION IS WRITTEN, and it is an ARROW and not a letter.
 *
 * The letters are the internal token — `'WSWD'` is legible in a stack trace in
 * a way `'↑↓↑→'` is not — but a player never sees them, because the code is
 * not made of keys. It is made of DIRECTIONS, and W is only what a direction
 * happens to be bound to on a keyboard. An arrow says the thing itself: it is
 * right on a pad, right after a rebind to ESDF, and right in a screenshot.
 *
 * This also settles a question the Codex had answered the other way. Printing
 * the live binding chip for each letter followed a rebind, which sounds like
 * the correct instinct and is the wrong one here — it made the code look like
 * four separate controls instead of one word.
 */
export const DIR_GLYPH = { W: '↑', A: '←', S: '↓', D: '→' };
/** A whole code, as the player reads it. One reader for the HUD and the Codex. */
export const spell = (code) => [...(code || '')].map(c => DIR_GLYPH[c] || c).join('');

/**
 * HOW LONG A CODE MAY TAKE, in seconds since the last letter.
 *
 * Not since the FIRST letter: a timeout measured from the start would punish a
 * long code for being long, and the codes are not all the same length. What
 * this is for is abandoning an entry the player has walked away from — they
 * pressed W to dodge and never meant to call anything — and for that, silence
 * is the signal.
 *
 * 1.6 s is slow enough to spell four letters while strafing and fast enough
 * that a code cannot still be half-entered by the time the fight has moved.
 */
export const CODE_GAP = 1.6;

/**
 * HOW FAR YOU CAN MARK, in metres. See `_aimSite`, which is also the
 * line-of-sight test — a beam cannot reach ground it did not fly over.
 */
export const AIM_REACH = 90;
/**
 * HOW LONG THE BEAM MAY BE HELD before it sends itself.
 *
 * It FIRES on expiry rather than cancelling, because the Force was spent when
 * the code was spoken. Five seconds is long enough to swing the beam across a
 * field and short enough that a designation cannot become a place to hide.
 */
export const DESIGNATE_MAX = 5.0;
/**
 * HOW CLOSE THE BEAM HAS TO PASS A BODY TO LATCH ONTO IT, in metres.
 *
 * Six is a little over two body-widths at the crosshair, so a deliberate aim
 * takes the thing and a beam swept past it does not. Bigger and you cannot
 * mark the GROUND next to a crowd, which is half of what the mechanic is for.
 */
export const LOCK_CONE = 6.0;
/** The warning ring where a row does not say how wide its own effect is. */
export const MARK_RADIUS = 7.5;

/**
 * THE TABLE. Every stratagem is a row and nothing else.
 *
 *   code      the directions, in order — and it is NOT written here. It is
 *             dealt by `rollCodes` at the start of every run, because a code
 *             the player has memorised is not a code, it is a second binding
 *             with more keystrokes. See that function.
 *   words     THE PHRASE, as a tail. Every keystroke is a spoken word (see
 *             `callPhrase`), so a row says the two or three words that are
 *             ITS own and the shared preamble supplies the rest. Written as a
 *             tail rather than as a whole line because the code length is
 *             derived from the price and a hand-written line of the wrong
 *             length would be a silent fault.
 *   cost      Force. Also decides how LONG the code is, which is the whole
 *             reason the length is not a field either — see `codeLength`.
 *             Stratagems are a Force-user's calls, so they bill the same pool
 *             every power does rather than inventing a currency.
 *   cooldown  seconds, per stratagem. Each has its own, so a cheap smoke does
 *             not gate an orbital strike.
 *   deliver   a key of `Sorties.PROFILES` — the craft or the beam that carries
 *             it, and therefore THE LEAD. A row with a delivery does not
 *             author its own lead: the lead IS the flight time, derived by
 *             `leadOf`, so a bomb can never be released at a place its ship is
 *             not. See src/game/Sorties.js.
 *   lead      seconds — only for the calls with nothing in the sky. An
 *             artillery battery is genuinely off-map and a resupply pod is
 *             thrown rather than flown.
 *   cadence   (ctx, site, S) → [{ t, fn }] — what leaves the craft, in seconds
 *             relative to the moment it is over the site. A run that lays its
 *             damage along its own track has no single instant to fire at, so
 *             the cadence IS the effect and there is no `fire`.
 *   fire      (ctx, site, S) → void. Runs when the lead expires, for the calls
 *             that DO land at one point.
 *   at        'aim'  — you designate the ground or the body. See `_designate`.
 *             'self' — lands on you.
 *   track     'aim' rows only: may the designation latch onto a BODY and
 *             follow it? True for the lance, which is fired at a thing;
 *             false for a gun run, which is flown along a line and cannot be
 *             re-tasked once the pilot has committed to it.
 *
 *   earn      HOW MUCH WAR EFFORT THIS SIDE HAS TO HAVE PUT IN before the
 *             fleet will answer this call at all. See `RELEASE` below, which
 *             is the ladder, and `WarSupport.effort`, which is the climb.
 *             Omitted means zero, which is the seven calls you open with.
 *
 * `commandOnly` marks the calls that only make sense with an army behind you.
 * The reinforcement drop is not a thing a lone Jedi in a horde run can ask
 * for, and offering it there would be a menu item that always refuses.
 *
 * ── WHY THE NUMBERS BELOW ARE WHAT THEY ARE ─────────────────────────────
 *
 * Player note #31: *"each of the stratagem attacks is a little poof of
 * nothing"*. Measured, on a REAL wave 26 of Geonosis (22 bodies — 3 BX, 2
 * droidekas, 3 AATs, 9 MagnaGuards, a spider walker, a B1, 2 rocket droids and
 * a Hailfire; 7 666 hp on the field), with the blast centred on the DENSEST
 * 7.5 m disc it could find, which held 13 of those bodies and 2 774 hp:
 *
 *     shipped orbital strike   r 7.5, 150 dmg   →   1 body killed, 868 hp
 *
 * One. `tools/balance.mjs` prices the blade against the same roster — a B1
 * dies in 1.28 s, a MagnaGuard in 5.34, an AAT in 5.75, plus the walk between
 * them — and clearing that wave with the blade alone comes to about 195
 * seconds, one body every 8.9 s. So the shipped strike bought ONE body for 34
 * Force, a 26 s cooldown and several seconds standing still in the open, when
 * standing still and swinging buys one every nine seconds for free. The player
 * is not describing a feeling; they are describing the arithmetic.
 *
 * What a call is priced at NOW is stated as a share of that wave, measured the
 * same way and printed by `tools/checks/stratagems.mjs` every run:
 *
 *     orbital strike   r 12, core 0.35, 300 dmg   →   7 bodies, 2 490 hp
 *
 * — a third of a deep wave's bodies and a third of its health, which is about
 * sixty seconds of blade work delivered in one instant at a place you chose.
 * It is deliberately MORE than the 26 s cooldown is worth per second, because
 * a stratagem is not a damage-per-second race: you only ever collect the full
 * figure if the enemy is packed, and the number above is the best disc on the
 * field rather than a typical one. The call rewards letting them gather, which
 * is the decision the mechanic exists to offer.
 */
/**
 * How many shells the artillery barrage walks across the position. Named
 * because three things read it and none of them may drift: the loop that
 * fires them, the spark allowance each shell takes of the shared ring
 * (`1/sqrt(SHELLS)` — see `blast`), and the blurb the player is shown.
 */
const SHELLS = 12;
const SHELL_WORD = 'Twelve';

/* ══ THE PAYLOAD NUMBERS, NAMED ONCE EACH ═════════════════════════════════
 *
 * Same rule `SHELLS` above already follows and for the same reason: the loop
 * that fires a payload, the spark allowance it takes of the shared ring, the
 * blurb the player reads and the check that measures it are four readers, and
 * two numbers for one payload is HANDOFF §2.3. Every one of these is exported
 * so `tools/checks/stratagems.mjs` measures the shipped figure rather than a
 * copy of it.
 */

/** The concussion wall: five airbursts on a 12 m pitch, 14 m each, so the line
 *  overlaps and has no gap to walk through. */
export const WALL_BURSTS = 5;

/** The thermal fence: seven nodes on a 9 m pitch is a 54 m wall; at 5.5 m each
 *  the nodes overlap, so there is no seam in it. */
export const FENCE_NODES = 7, FENCE_R = 5.5, FENCE_LIFE = 18;
/**
 * 20 hp a second, priced against the ROSTER rather than against the other
 * calls. Measured: a clone trooper (46 hp) is dead 2.3 s after stepping in, a
 * B1 (24) in 1.2 s, and a MagnaGuard's 260 would take thirteen — longer than
 * any body will stand in a fire. That is the fence working as it should: it is
 * not a damage call, it is a piece of ground nobody uses. A body CROSSING one
 * node at a walking pace spends about 2.8 s in it and pays 55.
 */
export const FENCE_DPS = 20;
/** …and plate walks through it. See `blast`'s `hard`: a fire does not go
 *  through 40 mm of durasteel, so an AAT loses 5% of its hull crossing. */
export const FENCE_HARD = 0.06;

/** The ion pulse: seven seconds of a machine standing still, and 110 off it.
 *  The stun is the call and the damage is the change — measured, 19 machines
 *  stopped at once and 3 of 22 bodies killed. */
export const ION_STUN = 7.0, ION_DAMAGE = 110;

/** Seismic charges: twelve, live for 45 s, armed 1.2 s after they land so one
 *  cannot go off on the ship that dropped it, and tripped at 3.2 m. Measured
 *  on the packed Geonosis field, where six of the twelve land within tripping
 *  distance of something: 2 459 hp and 5 bodies, over the thirty seconds it
 *  takes them to be walked into. */
export const MINE_COUNT = 12, MINE_LIFE = 45, MINE_ARM = 1.2, MINE_TRIP = 3.2;

/** Cluster munitions: 26 bomblets, and 12% of the blow to anything plated —
 *  which is what fragmentation is. See `blast`'s `hard`. Measured: 1 760 hp on
 *  the packed field, of which 77 came off the 4 810 hp of plate standing in it. */
export const CLUSTER_N = 26, CLUSTER_HARD = 0.12;

/**
 * The tractor beam: 3.4 s, 16 pulls, and no damage at all. `TRACTOR_PULL` is
 * the closing speed the field HOLDS rather than one it adds to — see the servo
 * in `tractor`, and the 46 m/s that measured before it was one. At 7 m/s a
 * sixteen-body line spread over a 17.8 m mean radius is at 2.4 m when the beam
 * lets go, which is the number this call is priced on.
 */
export const TRACTOR_TIME = 3.4, TRACTOR_BEATS = 16, TRACTOR_PULL = 7.0, TRACTOR_LIFT = 1.4;

/** The gunship on station: 22 s, 18 bursts, and it will not shoot at anything
 *  more than 45 m from the ground it was called onto. Measured: 2 727 hp and 6
 *  bodies, against the strafing run's 1 334 and 3 for 29.5 of support — twice
 *  the work for not quite twice the price, spread over twenty-two seconds
 *  during which the player is doing something else. */
export const STATION_TIME = 22, STATION_BURSTS = 18, STATION_REACH = 45;

/** The ion storm: 18 s at about three strikes a second, each grounding in a 3 m
 *  circle for 48. Measured: 54 discrete bolts, 8 bodies killed, 2 880 hp — and
 *  it does not ask what anything is made of, including the caller. */
export const STORM_HZ = 3, STORM_R = 3.0, STORM_DAMAGE = 48;

/** The bombardment: 22 detonations walked outward across 21 m of radius over
 *  9 s. The spiral IS the counter-play — see `bombardment`. Measured: 21 of 22
 *  bodies killed, 9 265 hp and 22 craters. Nothing else in the game clears a
 *  field. */
export const SIEGE_N = 22, SIEGE_R = 21, SIEGE_TIME = 9;

/**
 * ══ THE RELEASE LADDER — WHAT UNLOCKS, AND WHEN, AND WHY IT IS NOT A SAVE ══
 *
 * The player: *"expand the available strategems and/or the strategems that you
 * can unlock as you progress through a run… you should be able to unlock some
 * really cool shit"*. The two halves of that sentence pull in opposite
 * directions and the second half is the load-bearing one: **as you progress
 * through a RUN**, not between them.
 *
 * `src/game/Progress.js` is the written law here and it is worth quoting rather
 * than paraphrasing: "no unlocks — every crystal, cut, species and order is
 * available from the first run… no currency… no cross-run power — a run is
 * still built from its own drafts, so the hundredth run starts exactly where
 * the first did." A ladder of support calls bought with a profile number would
 * be the exact thing that file exists to refuse, and it would be the worst
 * instance of it: the calls are the most powerful things in the game.
 *
 * So the ladder is climbed INSIDE one battle and reset by the next, and the
 * thing it is climbed with is `WarSupport.effort` — the total credit the side
 * has been OFFERED this battle, summed over every kill, every cleared wave,
 * every piece of ground held and every objective. Three properties make it the
 * right number and no other candidate has all three:
 *
 *  · IT ALREADY EXISTS AND IS ALREADY HOOKED. `World` credits kills and waves,
 *    `Command` credits held ground; nothing new has to be called from anywhere,
 *    which is the difference between a ladder that works in all eight modes and
 *    one that works in the mode somebody remembered.
 *  · IT IS NOT A WAVE COUNT. A campaign has areas, a skirmish has an ending and
 *    a horde run has waves; effort is the one quantity all three produce.
 *  · IT CANNOT BE BANKED. A `WarSupport` is built per World and serialised
 *    nowhere. Measured: `grep -n support src/game/Progress.js` finds nothing,
 *    and `tools/checks/support.mjs` asserts that it stays that way.
 *
 * ── WHY THESE FIVE NUMBERS ──────────────────────────────────────────────
 *
 * Priced against what a wave actually credits, which is `SUPPORT_EARN`: a
 * cleared wave is 9 and each body in it is 0.55, so a ten-body wave is about
 * 14.5 of effort and a deep twenty-two-body wave about 21. In Command a held
 * area is 22 on its own and an objective 14.
 *
 *     OPEN       0    the seven calls this game shipped with. Nothing the
 *                     player already had is taken away and put behind a gate —
 *                     the opening minute of a run is exactly what it was.
 *     FORWARD   55    about wave 4. The first three you EARN, and they are the
 *                     three that change how you hold ground rather than how
 *                     much damage you do.
 *     HEAVY    130    about wave 9. The ordnance that discriminates: a carpet
 *                     that shreds infantry, a spike that kills one enormous
 *                     thing, a beam that gathers a wave into one circle.
 *     DEEP     230    about wave 14, or an area held plus a good wave count.
 *                     The calls that persist — a gunship that stays, a landing
 *                     on ground you are not standing on, a storm over the field.
 *     SIEGE    360    about wave 20. One call, and it is the biggest thing in
 *                     the game.
 *
 * A run that ends at wave 8 sees three of the eleven. A run that reaches the
 * twenties sees all of them, once, late, and has to have earned each. That is
 * the shape "unlock as you progress through a run" describes.
 */
export const RELEASE = { OPEN: 0, FORWARD: 55, HEAVY: 130, DEEP: 230, SIEGE: 360 };

/** What a rung is called when the fleet announces it. Derived from RELEASE so
 *  a sixth rung cannot be added without a name. */
export const RELEASE_NAME = {
  [RELEASE.OPEN]: 'standing orders',
  [RELEASE.FORWARD]: 'forward support',
  [RELEASE.HEAVY]: 'heavy ordnance',
  [RELEASE.DEEP]: 'fleet assets',
  [RELEASE.SIEGE]: 'siege authority',
};

export const STRATAGEMS = [
  {
    id: 'strike', name: 'Orbital strike',
    cost: 40, cooldown: 26, at: 'aim', track: true, radius: 12,
    deliver: 'lance', words: ['orbital', 'strike'],
    blurb: 'A lance from orbit, on the thing you painted. It follows what you '
      + 'marked. Five seconds of warning, for you and for them.',
    fire: (ctx, site, S, s) => S.blast(ctx, site, s.radius, 150, 300,
      { core: 0.35, shake: 1.0, size: 3.6, crater: 2.1 }),
  },
  {
    id: 'strafe', name: 'Strafing run',
    cost: 22, cooldown: 20, at: 'aim', track: false, radius: 30,
    deliver: 'strafe', words: ['gun', 'run'],
    blurb: 'A gunship down the line you painted, cannons open. Twelve impacts '
      + 'across sixty metres, and it does not know whose side you are on.',
    cadence: (ctx, site, S) => S.gunRun(ctx, site),
  },
  {
    id: 'barrage', name: 'Artillery barrage',
    cost: 26, cooldown: 22, lead: 2.6, at: 'aim', radius: 22,
    words: ['fire', 'mission'],
    blurb: `${SHELL_WORD} shells walked across the position. Wider than the lance `
      + 'and much less certain about where anything is.',
    fire: (ctx, site, S) => {
      /* WALKED, not dropped in a ring. A battery firing at a map reference
       * has an error along its own line of fire and almost none across it,
       * so the pattern is a LINE with scatter, laid along the bearing from
       * the caller — which is also what makes it readable: the shells come
       * toward you or away from you, and standing to one side is a real
       * answer.
       *
       * NOTHING FLIES IN FOR THIS ONE, and that is not an omission. A battery
       * is genuinely off the map; a gunship that appeared to deliver artillery
       * would be telling the player the wrong thing about where it came from
       * and about why standing to one side works. What arrives is the SOUND of
       * it arriving — see `blast`'s incoming whistle. */
      const bear = _v1.subVectors(site, S.owner.position).setY(0);
      if (bear.lengthSq() < 1e-4) bear.set(0, 0, 1);
      bear.normalize();
      for (let i = 0; i < SHELLS; i++) {
        const t = (i - (SHELLS - 1) / 2) * 3.4 + (S.rand() - 0.5) * 2.4;
        const across = (S.rand() - 0.5) * 5.2;
        /* CLONED HERE AND NOT INSIDE THE CLOSURE. `_v2` is a module-level
         * scratch vector shared by everything in this file, so a `p.clone()`
         * deferred into a timer cloned whatever the LAST caller had left in it
         * — twelve shells all landing wherever `blast` happened to be looking.
         * Latent for as long as nothing else touched `_v2` between the call
         * and the shell; `blast` now does. Take the copy while the value is
         * still the one this line computed. */
        const at = _v2.copy(site).addScaledVector(bear, t)
          .addScaledVector(_v3.set(-bear.z, 0, bear.x), across).clone();
        S.after(i * 0.17, () => S.blast(ctx, at, 6.5, 70, 120,
          { core: 0.25, shake: 0.30, size: 1.7, crater: 0.9,
            /* Twelve shells share one explosion's spark allowance — SHELLS is
             * this loop's own bound, so the two can never disagree. */
            sparkShare: 1 / Math.sqrt(SHELLS) }));
      }
    },
  },
  {
    id: 'smoke', name: 'Smoke screen',
    /**
     * WAY BIGGER, on the player's word: "the smoke screen needs to be way
     * bigger and more useful". The radius here is the DESIGNATION ring — how
     * much ground the reticle paints — and it moves with the payload: six
     * canisters at 12 m across a 9 m spacing is a bank about 57 m long and 24
     * deep, against the four-at-8.5-on-7 that made a 31 m one. See `canisters`.
     */
    cost: 12, cooldown: 14, at: 'aim', radius: 26,
    deliver: 'smoke', words: ['smoke', 'screen'],
    blurb: 'A gunship walks six canisters across the ground you painted — a bank '
      + 'you cannot see over. Nothing on either side shoots what it cannot see, '
      + 'and anything half-blinded by it sprays.',
    cadence: (ctx, site, S) => S.canisters(ctx, site),
  },
  {
    id: 'reinforce', name: 'Reinforcements', commandOnly: true,
    cost: 30, cooldown: 34, lead: 0.4, at: 'self',
    words: ['send', 'bodies'],
    blurb: 'A gunship, and four more of yours off the ramp. They come down beside '
      + 'you, not at the edge of the field.',
    fire: (ctx, site, S) => S.reinforce(ctx, 4),
  },
  {
    id: 'rally', name: 'Rally', commandOnly: true,
    cost: 18, cooldown: 20, lead: 0, at: 'self',
    words: ['hold', 'the', 'line'],
    blurb: 'Steady the line. Everyone of yours inside the shout stops breaking and '
      + 'stands up.',
    fire: (ctx, site, S) => S.rally(ctx, 22),
  },
  {
    id: 'resupply', name: 'Resupply',
    cost: 16, cooldown: 24, lead: 2.0, at: 'self',
    words: ['drop', 'supply'],
    blurb: 'A pod on your position: health for you, and it wakes the wounded around '
      + 'you back onto their feet.',
    fire: (ctx, site, S) => S.resupply(ctx, site, 9),
  },

  /* ══ FORWARD SUPPORT — released at 55 of war effort, about wave 4 ══════
   *
   * Three calls that change WHERE a fight happens rather than how much damage
   * is in it. None of them is a bigger version of anything above: one moves
   * bodies and does not hurt them, one makes a piece of ground unusable for
   * eighteen seconds, and one does nothing at all to a man and takes a droid
   * army off the field for seven seconds. */

  {
    id: 'concussion', name: 'Concussion wall', earn: RELEASE.FORWARD,
    cost: 20, cooldown: 24, at: 'aim', radius: 26,
    deliver: 'bomb', words: ['concussion', 'wall'],
    blurb: 'Five airbursts in a line across your front. It barely scratches anything '
      + 'and it throws everything — a charge broken, a line put on its back, forty '
      + 'metres of ground given back to you.',
    /**
     * THE ONE CALL ON THE TABLE THAT IS NOT TRYING TO KILL ANYTHING, and that
     * is the whole design of it. `blast` takes `force` and `damage` as two
     * independent numbers and every other row spends both; this spends 300 of
     * impulse against 9 of damage, which is a shove of about 19 m/s at the
     * centre and a bruise.
     *
     * Measured on the packed Geonosis field (22 bodies, 15 of them inside
     * 12 m): the wall throws them away from it at a mean 66.7 m/s — the SAME
     * mean the orbital strike produces — for 229 hp of damage against the
     * strike's 3 023, and it kills NOBODY. Half the strike's price, all of its
     * shove, none of its bodies. That is the answer to a droideka line closing
     * on you that an orbital strike is not: you cannot afford a strike every
     * time somebody walks at you, and you can afford this.
     */
    cadence: (ctx, site, S) => S.wall(ctx, site),
  },
  {
    id: 'fence', name: 'Thermal fence', earn: RELEASE.FORWARD,
    cost: 24, cooldown: 30, at: 'aim', radius: 30,
    deliver: 'smoke', words: ['thermal', 'fence'],
    blurb: 'A gunship lays a burning line fifty-four metres across the ground you '
      + 'painted. It stands for eighteen seconds and it kills anything soft that '
      + 'tries to cross. Armour walks through it.',
    /**
     * GROUND DENIAL, and it is denial rather than damage: the number that
     * matters is not what it kills but for how long a piece of ground cannot be
     * used. Eighteen seconds is longer than any cooldown on the table below the
     * orbital calls, so a fence laid across the approach is a decision about
     * the whole engagement.
     *
     * IT DISCRIMINATES, and this is what stops it being "the barrage but
     * slower". `FENCE_DPS` is charged in full to flesh and plastoid and at
     * `FENCE_HARD` to anything plated. Measured, one node against one body of
     * each: a clone trooper (46 hp) is dead 2.3 s after stepping into it, and
     * an AAT (1 050 hp) standing in it for the whole eighteen seconds loses 21
     * — two per cent of its hull. A trooper sixty metres away loses nothing,
     * which is the other thing a fence has to be able to say.
     *
     * The fence is the answer to infantry and the mass driver is the answer to
     * the tank; owning one does not answer the other.
     */
    cadence: (ctx, site, S) => S.fenceLine(ctx, site),
  },
  {
    id: 'ion', name: 'Ion pulse', earn: RELEASE.FORWARD,
    cost: 28, cooldown: 32, at: 'aim', track: true, radius: 22,
    deliver: 'ion', words: ['ion', 'pulse'],
    blurb: 'A charge off the ship, straight down. Every machine inside twenty-two '
      + 'metres stops dead for seven seconds and takes a hundred and ten with it. '
      + 'Flesh does not notice it at all.',
    /**
     * THE CALL WHOSE VALUE DEPENDS ON WHO YOU ARE FIGHTING, which is a thing no
     * other row on this table does and the reason it is worth 37.5 of support.
     *
     * WHAT COUNTS AS A MACHINE IS THE MATERIAL TABLE'S ANSWER and not a list of
     * type names. `Combat.TOUGHNESS` already says what every body in this game
     * is made of — flesh 0.9, cloth 0.5, plastoid 1.5 (a clone's armour over a
     * man), droid 2.0, armour 4.5, heavy 14, durasteel 42 — so "is there a
     * machine in there" is `toughness >= TOUGHNESS.droid`, and it is right for
     * every one of the 31 archetypes and for the next one somebody writes. A
     * regex over `/droid|b1|b2|walker/` would be HANDOFF §2.4's restated rule,
     * and it is already in Enemy.js once.
     *
     * Measured on the packed Geonosis field (22 bodies, every one of them a
     * machine): 19 of them standing still at once and 2 420 hp removed, for a
     * call that would do LITERALLY NOTHING on the Republic side of the same
     * fight. Compare the orbital strike on the same field — 3 023 hp for 53.5
     * of support — and the trade is legible: the pulse is cheaper, it does not
     * break the ground, it kills almost nothing (3 bodies), and for seven
     * seconds the enemy is furniture.
     */
    fire: (ctx, site, S, s) => S.ionPulse(ctx, site, s.radius),
  },

  /* ══ HEAVY ORDNANCE — released at 130, about wave 9 ═══════════════════
   *
   * Four calls that each answer ONE kind of target and are wasted on the
   * others. That is deliberate and it is the argument against a table of
   * damage numbers: a cluster canister is worthless against a tank, a mass
   * driver is worthless against a swarm, a minefield does nothing until
   * something walks, and a tractor beam does no damage at all. */

  {
    id: 'mines', name: 'Seismic charges', earn: RELEASE.HEAVY,
    cost: 27, cooldown: 34, at: 'aim', radius: 30,
    deliver: 'bomb', words: ['seismic', 'charges'],
    blurb: 'Twelve charges scattered across thirty metres, armed where they land. '
      + 'They wait forty-five seconds for something to walk within three, and they do '
      + 'not care whose it is.',
    /**
     * THE ONLY CALL THAT DOES NOTHING WHEN IT ARRIVES, and the only one whose
     * effect is decided by the enemy rather than by the player. Everything else
     * on this table happens at a time you chose; this happens when something
     * steps on it, which is what makes it the call for ground you are about to
     * leave, a flank you cannot watch and a door you want closed behind you.
     *
     * FORTY-FIVE SECONDS is deliberately longer than two waves' worth of
     * cooldown: a minefield that expired before the next push would be a
     * delayed barrage. It is also why they are visible — see `_paintCharge` —
     * because a hazard the player forgets they laid is a hazard that kills the
     * player.
     */
    cadence: (ctx, site, S) => S.scatterMines(ctx, site),
  },
  {
    id: 'cluster', name: 'Cluster munitions', earn: RELEASE.HEAVY,
    cost: 33, cooldown: 30, at: 'aim', radius: 26,
    deliver: 'bomb', words: ['cluster', 'munitions'],
    blurb: 'One canister, opened at three hundred metres. Twenty-six bomblets across '
      + 'twenty-six metres of ground in a second and a half. It empties a line of '
      + 'infantry and does almost nothing to a hull.',
    /**
     * THE ANTI-INFANTRY ANSWER, and the exact inverse of the mass driver.
     *
     * Fragmentation is a swarm of small fast pieces: it shreds cloth, flesh and
     * plastoid and it does not go through 40 mm of durasteel. That is a real
     * physical statement and it is stated once, as `blast`'s `hard` share, so
     * every bomblet answers it the same way.
     *
     * Measured on the packed Geonosis field: 5 bodies killed and 1 760 hp
     * removed, of which everything plated on the field — three AATs, a walker
     * and a hailfire, 4 810 hp between them — contributed 77. The mass driver
     * on the same field is the mirror image: 2 200 hp out of ONE hull and 77 of
     * it out of everything plated. Two calls, one field, opposite answers.
     */
    cadence: (ctx, site, S) => S.cluster(ctx, site),
  },
  {
    id: 'tractor', name: 'Tractor beam', earn: RELEASE.HEAVY,
    cost: 31, cooldown: 40, at: 'aim', radius: 26, hold: TRACTOR_TIME,
    deliver: 'tractor', words: ['tractor', 'beam'],
    blurb: 'A hold field off the ship. For three and a half seconds everything inside '
      + 'twenty-six metres is dragged to the middle of it and lifted off its feet. It '
      + 'does no damage whatsoever. That is what it is for.',
    /**
     * THE SET-UP CALL, and the only one on the table whose worth is measured in
     * what the NEXT call gets to do.
     *
     * Zero damage, by design. What it produces is a number no other row moves:
     * the radius of the enemy. Measured on a SPREAD line — sixteen MagnaGuards
     * on rings at 11, 15.5, 20 and 24.5 m, which is the formation this call is
     * for — the mean radius goes from 17.8 m to 2.4 m over the beam's 3.4 s,
     * closing at a steady 4.8 m/s, and every one of the sixteen ends up inside
     * the orbital strike's 12 m circle where eight of them started outside it.
     * Total damage dealt: zero.
     *
     * `gentle` on every pull: `applyKnockback`'s hard path breaks a cast, cries
     * out and stuns past 12 m/s, and a beam applied sixteen times over three
     * seconds would do all three sixteen times. A tractor field is a steady
     * pull, not sixteen shoves.
     */
    fire: (ctx, site, S, s) => S.tractor(ctx, site, s.radius),
  },
  {
    id: 'driver', name: 'Mass driver', earn: RELEASE.HEAVY,
    cost: 47, cooldown: 40, at: 'aim', track: true, radius: 4.2,
    deliver: 'spike', words: ['mass', 'driver'],
    blurb: 'A tungsten rod dropped from orbit at the one thing you painted. Four metres '
      + 'wide and nothing inside it survives — a walker, a tank, a general. Wasted on '
      + 'anything smaller.',
    /**
     * ONE ENORMOUS THING, DEAD. The orbital strike is 12 m and 300 damage with a
     * 0.35 core; this is 5.5 m and 1 700 with a 0.6 core, which is not "the
     * strike but bigger" — it is a different transaction with a different
     * failure mode. Measured with both aimed at the SAME AAT on the packed
     * Geonosis field: the driver kills 3 bodies, puts 2 200 hp into one of
     * them and the tank is gone; the strike kills 6, its largest single hit is
     * 300, and the tank drives away. The driver is the only call in the game
     * that takes a 1 050 hp AAT off the board in one round, and the only one
     * that leaves a 4.2 m hole in the ground.
     *
     * IT TRACKS, because it is fired AT a thing rather than at a place, and the
     * 4.4 s spike gives that thing time to walk out of five metres. The player
     * who marks a walker and holds it gets the walker; the player who marks a
     * B1 has spent 62.5 of support on a B1.
     */
    fire: (ctx, site, S, s) => S.blast(ctx, site, s.radius, 300, 2200,
      { core: 0.70, shake: 1.4, size: 4.0, crater: 4.2 }),
  },

  /* ══ FLEET ASSETS — released at 230, about wave 14 ════════════════════
   *
   * Three calls that do not finish when they land. Each occupies the field for
   * twenty seconds or more, which is the property none of the ordnance above
   * has: you call them BEFORE you need them and then fight around them. */

  {
    id: 'overwatch', name: 'Gunship on station', earn: RELEASE.DEEP,
    cost: 38, cooldown: 46, at: 'aim', radius: 34, hold: STATION_TIME,
    deliver: 'loiter', words: ['gunship', 'on', 'station'],
    blurb: 'A gunship takes up a circle over the ground you painted and stays there '
      + 'for twenty-two seconds, working down whatever is nearest. It knows whose side '
      + 'you are on. You do not have to watch it.',
    /**
     * THE ONE CALL THAT PICKS ITS OWN TARGETS, and the reason it is worth more
     * than a strafing run that deals more damage in one second.
     *
     * A gun run is 12 impacts along a line the pilot committed to before it
     * arrived; twelve bodies standing somewhere else take nothing. This is 18
     * bursts over 22 seconds, each aimed at whatever is closest to the mark at
     * that moment, which means it follows the fight. Measured on the packed
     * Geonosis field: the strafing run is 1 334 hp and 3 bodies inside a second
     * and a half; the station is 2 727 hp and 6 bodies over twenty-two seconds,
     * 1 779 of it out of the three tanks and the walker, because it kept
     * picking the thing that was still standing.
     *
     * AND IT IS THE ONE PAYLOAD THAT READS TEAMS. `blast`'s own note is that a
     * gun run "does not know whose side you are on" — correct for a pass that
     * was aimed by a player. A craft choosing its own targets and choosing your
     * own troops would not be dangerous, it would be broken, so the target
     * search asks `e.team !== owner.team`.
     */
    cadence: (ctx, site, S) => S.station(ctx, site),
  },
  {
    id: 'beachhead', name: 'Beachhead', commandOnly: true, earn: RELEASE.DEEP,
    cost: 35, cooldown: 48, lead: 0.4, at: 'aim',
    words: ['take', 'that', 'ground'],
    blurb: 'Six of yours off a ramp on the ground you painted, up to ninety metres '
      + 'away. Not beside you — where you want the line to be.',
    /**
     * REINFORCEMENTS ARE 'self' AND THIS IS 'aim', AND THAT IS THE WHOLE
     * DIFFERENCE. Four more bodies beside you is a way to survive; six bodies
     * on a ridge you are not standing on is a way to TAKE it, and it is the
     * only call in the game that moves the line somewhere rather than topping
     * it up.
     *
     * It lands them through `Command.reinforce` — the same verb the order wheel
     * uses, so the recruitment cost, the point ledger, the gunship and the
     * muster broadcast are all the ones that already exist. The only thing this
     * adds is WHERE, and it says so by moving the commander's own `anchor` for
     * the duration of one synchronous call and putting it straight back. See
     * `beachhead`.
     */
    fire: (ctx, site, S) => S.beachhead(ctx, site, 6),
  },
  {
    id: 'storm', name: 'Ion storm', earn: RELEASE.DEEP,
    cost: 44, cooldown: 60, lead: 3.2, at: 'aim', radius: 34,
    words: ['ion', 'storm'],
    blurb: 'The fleet dumps a charge into the upper atmosphere over the ground you '
      + 'painted and the sky comes down on it for eighteen seconds. It does not care '
      + 'what anything is made of, and it does not care where you are standing.',
    /**
     * THE WEATHER, WHICH IS A DIFFERENT KIND OF CALL FROM ANYTHING ELSE HERE.
     *
     * Nothing flies in for it — there is no craft and no round, which is why it
     * carries a `lead` rather than a `deliver`; what arrives is the sky
     * changing. It is drawn through `world.lightning`, the real `LightningVfx`
     * ribbon pool that Force lightning uses, because a storm drawn out of the
     * spark ring is the "row of dots" that file's own header is about.
     *
     * INDISCRIMINATE, AND THAT IS THE PRICE OF IT. The ion pulse above is
     * precise and does nothing to flesh; this hits whatever is under it,
     * including the player and including the player's line, for eighteen
     * seconds, over ground the player cannot retake in that time. Measured on
     * the packed Geonosis field: 54 discrete bolts, 8 bodies killed and 2 880
     * hp removed — comparable to the orbital strike's 3 023, spread over
     * eighteen seconds instead of one instant, and over ground nothing can
     * stand on for the duration.
     */
    fire: (ctx, site, S, s) => S.ionStorm(ctx, site, s.radius, 18),
  },

  /* ══ SIEGE AUTHORITY — released at 360, about wave 20 ═════════════════ */

  {
    id: 'bombard', name: 'Orbital bombardment', earn: RELEASE.SIEGE,
    cost: 60, cooldown: 75, at: 'aim', radius: 42, hold: SIEGE_TIME,
    deliver: 'siege', words: ['begin', 'the', 'bombardment'],
    blurb: 'Everything the ship has, walked across forty-two metres of ground for nine '
      + 'seconds. Seven seconds of warning, because you will need them too. There is '
      + 'nothing above this.',
    /**
     * THE BIGGEST THING IN THE GAME, and every number on it is chosen so that
     * it cannot become the answer to everything.
     *
     * 80 of a 100-point bar — you cannot make this call at the opening of a
     * battle, because a battle opens at 55. A 75 s cooldown and 12.8 s of
     * rearm on top. Released only at 360 of war effort, which is about wave 20.
     * A player sees it once or twice in a deep run and never in a short one,
     * which is exactly what "unlock some really cool shit" should mean.
     *
     * Measured on the packed Geonosis field: 21 of 22 bodies killed, 9 265 hp
     * removed and 22 craters left in the ground — the whole of a deep wave, and
     * about a hundred and ninety seconds of blade work by `tools/balance.mjs`'s
     * own pricing, delivered in nine. It is the only call in the game that
     * clears a field. The seven-second lead is the longest here and the ring is
     * 42 m wide; standing in it when it starts is survivable for about two
     * seconds.
     */
    cadence: (ctx, site, S) => S.bombardment(ctx, site),
  },
];

/** By id, for the HUD and the Codex. Derived, so a row cannot be missed. */
export const STRATAGEM_BY_ID = Object.fromEntries(STRATAGEMS.map(s => [s.id, s]));

/**
 * HOW LONG IT TAKES TO ARRIVE, AND IT IS THE DELIVERY'S OWN FLIGHT TIME.
 *
 * A row with a `deliver` profile does not carry a `lead`, because the lead and
 * the flight are two statements of one thing and this project has a section of
 * its handover about what happens to two of those (§2.3). `Sorties` knows how
 * far out a pass starts and how fast the craft flies; the lead is that
 * division. Author a lead only where nothing is in the sky.
 */
export const leadOf = (s) => (s?.deliver ? SortieDirector.leadOf(s.deliver) : (s?.lead ?? 0));

/**
 * EVERY KEYSTROKE IS A WORD, AND THE PHRASE IS DERIVED.
 *
 * Player note #31: *"imagine you begin the process of calling one in, you hold
 * up your wrist and speak into it, every keystroke a word"*. So a code is not a
 * silent WASD sequence any more — it is a radio call, and the arrows are the
 * player's own mouth. `Player._stratagemInput` speaks `callPhrase(s)[i]` on the
 * i-th letter and `HUD` prints it, so the gesture, the voice and the code are
 * one thing rather than three.
 *
 * IT IS BUILT AND NOT WRITTEN, for the reason every derived thing in this file
 * is: the code length comes from the price (`codeLength`), so a hand-written
 * line would be the wrong length the day somebody re-prices a row, and a phrase
 * one word short means a keystroke with nothing to say. The row carries the two
 * or three words that are its own; the shared preamble supplies the rest, and
 * the phrase is the LAST `n` words of the two joined — so a cheap five-press
 * call is a clipped "Borz actual, authenticate, smoke screen" and the eight-press
 * lance gets the whole of it. The important half is always the tail, because
 * the tail is what you are asking for.
 *
 * `PREAMBLE.length + the shortest tail` must be at least `CODE_MAX`, or a long
 * code would run out of words. `phraseFaults` states that as a check rather
 * than as a comment.
 */
export const PREAMBLE = ['Command', 'this', 'is', 'Borz', 'actual', 'authenticate'];
export function callPhrase(s) {
  const all = [...PREAMBLE, ...(s?.words || [])];
  return all.slice(Math.max(0, all.length - codeLength(s)));
}

/** Every way the phrase table can be wrong, as sentences. See `callPhrase`. */
export function phraseFaults(rows = STRATAGEMS) {
  const out = [];
  for (const s of rows) {
    if (!s.words || !s.words.length) { out.push(`${s.id} has no words of its own`); continue; }
    const n = codeLength(s);
    const p = callPhrase(s);
    if (p.length !== n) out.push(`${s.id} spells in ${n} and says ${p.length} words`);
    if (PREAMBLE.length + s.words.length < CODE_MAX) {
      out.push(`${s.id}'s ${s.words.length} words plus a ${PREAMBLE.length}-word preamble `
        + `cannot fill a ${CODE_MAX}-direction code`);
    }
  }
  return out;
}

/**
 * HOW LONG A CODE IS, AND IT IS NOT A FIELD ON THE ROW.
 *
 * A stratagem's price is already the statement of how much it is worth, and
 * the code is the OTHER price — the seconds you spend standing still in the
 * open, not fighting, to ask for it. Two prices for one thing that a designer
 * has to keep in step by hand is the defect this codebase keeps removing, so
 * there is one: a keystroke per `PER_KEY` Force on top of a floor.
 *
 * The floor is five and not four. Four was too short in two ways at once —
 * every code in the table was the same length, so the panel taught nothing
 * about which call was the expensive one, and four directions is 256
 * spellings, which is a small enough space that two rows chosen at random
 * collide often.
 *
 * Measured over the shipped prices: smoke 12 → 5, resupply 16 → 5, rally
 * 18 → 5, barrage 26 → 6, reinforce 30 → 7, orbital strike 34 → 7. The
 * cheapest calls are a flick and the lance takes a moment, which is the
 * relationship the mechanic is for.
 */
export const CODE_MIN = 5, CODE_MAX = 8, PER_KEY = 8;
export const codeLength = (s) =>
  clamp(CODE_MIN + Math.floor(((s.cost ?? 0) - cheapest()) / PER_KEY), CODE_MIN, CODE_MAX);
const cheapest = () => STRATAGEMS.reduce((m, s) => Math.min(m, s.cost ?? 0), Infinity);

/**
 * DEAL EVERY CODE, FROM A SEED.
 *
 * The codes were six literals and the player learns them in an evening; after
 * that the panel is furniture and the mechanic is six bindings that take four
 * presses each. Dealing them per run keeps the thing the mechanic is actually
 * made of — you stopped moving, in the open, to READ something and enter it —
 * alive for as long as the game is installed.
 *
 * SEEDED, and from the run's own seed, so it is not chaos: a code is fixed for
 * the whole of a run, two players in a co-op run spell the same thing, and a
 * replayed seed replays its codes. `Math.random` here would break all three.
 *
 * THREE CONSTRAINTS, and each is a way a dealt code can be unusable:
 *
 *  · UNIQUE, or one of the pair can never fire.
 *  · NO PREFIXES, or the short one fires the moment its last letter lands and
 *    the long one is unreachable — the failure `codeFaults` exists to catch,
 *    and dealing codes of different lengths is exactly how it would arise.
 *  · NO RUN OF THREE. `↑↑↑←↓` is not a code, it is a stuck key, and a player
 *    cannot tell their third press from their fourth without counting.
 *
 * Rejection sampling, which is the right tool when the constraints are cheap
 * to test and the space is enormous: the shortest code alone has 1024
 * spellings against six rows. `tries` is a backstop and not a budget — if it
 * ever ran out the table would have grown past what the space can hold, and
 * the caller is told rather than handed a broken deal.
 */
export function rollCodes(seed = 1, rows = STRATAGEMS) {
  let x = (Math.floor(seed) ^ 0x5f3759df) >>> 0 || 1;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const taken = [];
  for (const s of rows) {
    const n = codeLength(s);
    let code = null;
    for (let tries = 0; tries < 400 && !code; tries++) {
      let c = '';
      for (let i = 0; i < n; i++) {
        const d = DIRS[(rnd() * DIRS.length) | 0];
        // no run of three: reject the letter, not the whole code
        if (c.length >= 2 && c[c.length - 1] === d && c[c.length - 2] === d) { i--; continue; }
        c += d;
      }
      if (taken.some(t => t.startsWith(c) || c.startsWith(t))) continue;
      code = c;
    }
    if (!code) throw new Error(`rollCodes: no free ${n}-direction code left for ${s.id}`);
    taken.push(code);
    s.code = code;
  }
  return rows.map(s => s.code);
}

/* A table with no codes in it cannot be spelled, and nothing guarantees that a
 * Player is constructed before something reads one — the Codex is reachable
 * from the main menu. So the module deals itself an opening hand, and a run
 * replaces it. */
rollCodes(1);

/**
 * EVERYTHING WRONG WITH THE TABLE, as a list of sentences.
 *
 * Two faults are possible and both are silent at runtime, which is why they
 * are found here instead of being discovered in a fight:
 *
 *  · A DUPLICATE code. Two rows on one spelling means one of them can never
 *    fire and nothing would ever say so.
 *  · A PREFIX. If `WS` is a stratagem and `WSWD` is another, the short one
 *    fires the moment its last letter lands and the long one is unreachable.
 *    This is the failure that is easy to author by accident and impossible to
 *    diagnose from the outside — the player just finds that one call
 *    "sometimes does the wrong thing".
 *
 * Exported rather than asserted here so tools/checks can state it as a check
 * over the shipped table, and so a mod adding rows gets the same reading.
 */
export function codeFaults(rows = STRATAGEMS) {
  const out = [];
  for (const s of rows) {
    if (!s.code || !s.code.length) { out.push(`${s.id} has no code`); continue; }
    for (const c of s.code) if (!DIRS.includes(c)) out.push(`${s.id}: '${c}' is not a direction`);
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows.length; j++) {
      if (i === j) continue;
      const a = rows[i], b = rows[j];
      if (a.code === b.code && i < j) out.push(`${a.id} and ${b.id} share the code ${a.code}`);
      else if (a.code !== b.code && b.code.startsWith(a.code)) {
        out.push(`${a.id} (${a.code}) is a prefix of ${b.id} (${b.code}), so ${b.id} can never fire`);
      }
    }
  }
  return out;
}

/**
 * THE CALLER.
 *
 * One per player. `feed(dir)` takes a direction the input layer resolved,
 * `update(dt, ctx)` runs the pending calls, and `entry` is what the HUD paints.
 */
/**
 * WHAT A CALL COSTS IN SUPPORT, DERIVED FROM ITS FORCE PRICE.
 *
 * The `cost` on every row is kept — it is also what decides how LONG the code
 * is (`codeLen` reads it, and that is the mechanic the whole table is balanced
 * around), so replacing it with a second number would be HANDOFF §2.3's
 * hand-maintained twin in the one file that can least afford one.
 *
 * The scale is chosen so the most expensive call on the table lands at
 * `DEAREST_SHARE` of the bar (see src/game/Support.js, which owns that number
 * because it is a statement about the BAR and not about any one row). That
 * gives the shape the player asked for — "different strategems cost more
 * obviously" — and it re-derives itself if a row's price ever moves.
 *
 * Measured over the shipped eighteen rows, at `DEAREST_SHARE` 0.8 against a
 * dearest of 60 Force: smoke 16, resupply 21.5, rally 24, concussion 26.5,
 * strafe 29.5, fence 32, barrage 34.5, mines 36, ion 37.5, reinforce 40,
 * tractor 41.5, cluster 44, beachhead 46.5, overwatch 50.5, strike 53.5,
 * storm 58.5, driver 62.5, bombardment 80. A full bar is ONE of the top four,
 * or two of the middle, or six screens — and the bombardment cannot be made at
 * all at the opening of a battle, which starts at 55.
 */
let _dearest = 0;
export function supportCost(s) {
  if (!_dearest) _dearest = STRATAGEMS.reduce((m, x) => Math.max(m, x.cost ?? 0), 1);
  return Math.round((s.cost ?? 0) * (SUPPORT_MAX * DEAREST_SHARE / _dearest) * 2) / 2;
}

export class Stratagems {
  constructor(owner) {
    this.owner = owner;
    /* A NEW FIELD HAS NO SMOKE ON IT. The cloud registry is a module and
     * outlives a level by construction (see Smoke.js for why it is one), so
     * something has to say when the field is new — and a Player is built once
     * per level, which makes this the honest place rather than a hook the
     * teardown has to remember. */
    clearSmoke();
    /* AND A NEW RUN GETS NEW CODES, off the run's own seed so a replayed seed
     * replays its codes and a co-op guest spells what the host spells. Falls
     * back to a fixed deal where there is no run — the character creator and
     * the Codex are both reachable before one starts. */
    rollCodes(owner?.world?.runSeed ?? 1);
    /** Letters entered so far, as a string. Empty when nothing is being spelled. */
    this.entry = '';
    /** Seconds since the last letter, for CODE_GAP. */
    this.since = 0;
    /** Is the player holding the stratagem key? Entry only accumulates while true. */
    this.arming = false;
    /** id → seconds remaining. */
    this.cooldowns = {};
    /** Calls that have been made and have not landed. */
    this.pending = [];
    /** Deferred effects inside a single call — the barrage's six shells. */
    this._timers = [];
    /** What the last entry did, for the HUD's one line of feedback. */
    this.said = '';
    this.saidT = 0;
    this._seed = 0x9e3779b9;
    /**
     * THE DESIGNATION, and it is the second half of the mechanic.
     *
     * Player note #31: *"right now it's just where you're literally standing,
     * useless. you need to be able to place it where you want to specifically
     * or target what you want to target"*. The complaint is exact about the
     * consequence and slightly off about the cause — the call already landed
     * where you were LOOKING rather than where you stood — and the cause it
     * describes is the real one anyway: there was no moment in which the
     * player was placing anything. The last letter fired the call at whatever
     * the crosshair happened to be over on that frame, which under fire is
     * your own feet often enough that the difference does not exist.
     *
     * So finishing the code no longer fires the call. It opens a DESIGNATION:
     * the arm comes down, the beam finds the ground, and the site follows the
     * aim until the player lets go of the key. Null when nothing is being
     * placed; `{ s, site, lock, t }` while one is.
     */
    this.designating = null;
    /** The craft in the air. Built on first use — see `_sorties`. */
    this.sorties = null;
    /**
     * THE HIGHEST WAR EFFORT THIS OBJECT HAS SEEN, for `_release`. Not a copy
     * of the pool — the pool is the authority and is read every frame; this is
     * only the watermark that turns a continuous number into a discrete event.
     */
    this._effort = null;
    /** Live seismic charges and live fire nodes. Both are lists rather than
     *  one-shot timers because a pass lays them a fifth of a second apart, and
     *  one loop walks each list rather than one loop per item — see `sustain`.
     *  Both die with the level; see `reset`. */
    this._mines = [];
    this._fires = [];
    /** Is a list's loop already running? A second fence must add nodes to the
     *  list the first one's loop is already walking, not start a second walk. */
    this._burning = false;
    this._mining = false;
  }

  /**
   * THE CRAFT, LAZILY.
   *
   * A player who never spells a code should not pay for a scene group, and a
   * headless check that drives `blast` directly should not need a scene at
   * all. Both fall out of building the director the first time something
   * actually flies.
   */
  _sorties(ctx) {
    const world = ctx?.world || this.owner?.world;
    if (!this.sorties) this.sorties = new SortieDirector(world);
    else this.sorties.world = world || this.sorties.world;
    return this.sorties;
  }

  /* A stratagem's own scatter must not touch the world's RNG stream: an
   * artillery pattern is cosmetic variation and the world's seed is a
   * reproducibility contract. Own generator, own state. */
  rand() {
    this._seed = (this._seed * 1664525 + 1013904223) >>> 0;
    return this._seed / 4294967296;
  }

  /**
   * WHICH ROWS ARE OFFERABLE AT ALL RIGHT NOW.
   *
   * Two gates and they refuse for different reasons. `commandOnly` needs an
   * army behind you — a lone Jedi in a horde run has nobody to reinforce.
   * `earn` needs the battle to have got somewhere: see `RELEASE`, and
   * `WarSupport.effort`, which is the climb.
   *
   * A REFUSAL IS A ROW THAT IS NOT THERE, not a row that says no. The existing
   * check on `commandOnly` states the rule — "a code that can be spelled and
   * then refuses is a menu item that lies" — and the release ladder is held to
   * it: a locked call is absent from the panel, absent from `candidates`, and
   * its code does not resolve. What tells the player it exists is `_release`,
   * which announces each one at the moment it arrives.
   *
   * NO POOL MEANS NO LADDER. The character creator and the Codex preview both
   * construct a `Stratagems` with no World, and a page that showed a player
   * seven of eighteen calls because there is no battle running would be
   * describing a game that does not exist. `effort == null` is "there is no
   * battle to have progressed through", which is a different fact from zero.
   */
  available(ctx) {
    const world = ctx?.world || this.owner?.world;
    const army = !!world?.command;
    const effort = world?.support?.effort;
    return STRATAGEMS.filter(s =>
      (!s.commandOnly || army) && (effort == null || (s.earn ?? 0) <= effort));
  }

  /**
   * WHAT THE SIDE HAS EARNED THE RIGHT TO ASK FOR, and what it has not yet.
   *
   * Returns the rows still locked, cheapest first, so the HUD can print the
   * next one and the Codex can print the whole ladder. Exported as a method
   * rather than recomputed by two readers, for the reason every derived thing
   * in this file is one.
   */
  locked(ctx) {
    const world = ctx?.world || this.owner?.world;
    const effort = world?.support?.effort;
    if (effort == null) return [];
    return STRATAGEMS.filter(s => (s.earn ?? 0) > effort)
      .sort((a, b) => (a.earn ?? 0) - (b.earn ?? 0));
  }

  /**
   * THE FLEET ANSWERS — one notice, once, at the moment a call is released.
   *
   * A ladder nobody is told about is a ladder nobody climbs, and the panel
   * cannot carry it: the panel only exists while the key is held, and the
   * moment a call is released is almost never a moment the player is holding
   * the comm up. So it goes through `World.notify`, which is the same door a
   * refused Force power and a wave banner already use.
   *
   * BY RUNG AND NOT BY ROW. Three calls land at 55 and three at 230; three
   * notices in one frame is three notices nobody reads, so the rung is
   * announced with its calls named on the second line. `RELEASE_NAME` is the
   * rung's own word and comes off the ladder rather than being typed here.
   */
  _release(ctx) {
    const world = ctx?.world || this.owner?.world;
    const effort = world?.support?.effort;
    if (effort == null) return;
    if (this._effort == null) { this._effort = effort; return; }
    const was = this._effort;
    this._effort = effort;
    if (effort <= was) return;
    const opened = STRATAGEMS.filter(s => {
      const at = s.earn ?? 0;
      return at > was && at <= effort;
    });
    if (!opened.length) return;
    const rung = opened[0].earn ?? 0;
    world?.notify?.(String(RELEASE_NAME[rung] ?? 'support released').toUpperCase(),
      opened.map(s => s.name).join(' · '));
    audio.ui('good');
  }

  /** The rows still consistent with what has been typed. The HUD's whole job. */
  candidates(ctx) {
    if (!this.entry) return this.available(ctx);
    return this.available(ctx).filter(s => s.code.startsWith(this.entry));
  }

  /**
   * ARM OR DISARM — and RELEASE IS ALSO THE TRIGGER.
   *
   * One key does the whole call now, and the phase decides what letting go of
   * it means. That is deliberate: the mechanic already spends the player's
   * only spare finger, and a second binding for "confirm" would be a control
   * nobody could find while a rifle line is 40 m away (Bindings.js is out of
   * keys, which is why the code exists at all).
   *
   *   while SPELLING     letting go abandons a half-entered code, exactly as
   *                      it always did — the key going up is a clearer "I
   *                      changed my mind" than any timer, and a code left
   *                      standing would fire on the next W you pressed to walk.
   *   while DESIGNATING  letting go FIRES. The code is already spoken and the
   *                      Force is already spent; what is left is where, and
   *                      the release is the moment you stop choosing.
   *
   * So the gesture is one continuous thing: hold the comm up, speak the call,
   * paint the ground, let go.
   */
  setArming(on) {
    if (on === this.arming) return;
    this.arming = on;
    if (!on && this.designating) { this._launch(this.designating.ctx); return; }
    if (!on && this.entry) { this.entry = ''; this.since = 0; }
    if (on) audio.ui('hover');
  }

  /**
   * ONE LETTER — and one WORD.
   *
   * Returns the stratagem whose designation it opened, `false` if the letter
   * took the entry nowhere (which clears it — a wrong letter is a failed code,
   * not a character to backspace), and `null` while a code is still being
   * spelled.
   *
   * WHAT IT NO LONGER DOES IS FIRE. The last letter opens the designation
   * instead; `_launch` is what commits. Callers that used to read the return
   * value as "the call was made" still read it as "the call was made", because
   * from here on nothing can refuse it — the price and the cooldown are taken
   * at this moment, which is the moment the player finished asking.
   */
  feed(dir, ctx) {
    if (!this.arming || !DIRS.includes(dir)) return null;
    /* A LETTER DURING A DESIGNATION IS NOT A LETTER. The four directions are
     * how you aim on a pad, and a player nudging the mark must not be starting
     * a second code with the same press. */
    if (this.designating) return null;
    const next = this.entry + dir;
    const live = this.available(ctx).filter(s => s.code.startsWith(next));
    if (!live.length) {
      this.entry = '';
      this.since = 0;
      this._say('no such call');
      audio.ui('bad');
      return false;
    }
    this.entry = next;
    this.since = 0;
    audio.ui('click');
    const done = live.find(s => s.code === next);
    if (!done) return null;
    this.entry = '';
    return this._open(done, ctx) ? done : false;
  }

  /**
   * THE WORD THIS KEYSTROKE SAYS.
   *
   * Read by `Player._stratagemInput` (which speaks it) and by the HUD (which
   * prints it), off the one derivation in `callPhrase`, so the mouth and the
   * panel cannot disagree about what was just said. `index` is how many
   * letters are already down.
   *
   * WHICH ROW'S PHRASE, while several are still consistent with the entry? The
   * LEADING candidate's — the same row the HUD marks the next arrow on. Every
   * candidate shares the preamble by construction, so the words only diverge
   * once the entry has narrowed to one row, which is exactly when the player
   * has committed to what they are asking for.
   */
  wordAt(ctx, index = this.entry.length) {
    const rows = this.candidates(ctx);
    if (!rows.length) return '';
    return callPhrase(rows[0])[index] || '';
  }

  /**
   * THE CODE IS SPOKEN — now put it somewhere.
   *
   * Charged and cooled HERE and not at the release, because the price of a
   * stratagem is the asking: you stood in the open and said the whole call out
   * loud. A player who then declines to place it has still spent it, which is
   * what stops the designation being a free look at the field.
   */
  _open(s, ctx) {
    const p = this.owner;
    if ((this.cooldowns[s.id] ?? 0) > 0) {
      this._say(`${s.name}: ${this.cooldowns[s.id].toFixed(0)}s`);
      audio.ui('bad');
      return false;
    }
    /**
     * IT COSTS WAR SUPPORT, NOT FORCE — and the player's question about the old
     * arrangement answers itself: "strategems should not cost force how does
     * that even fucking make sense?"
     *
     * It did not. `p._spend(s.cost)` is the Jedi's own pool, the one that buys
     * a push and a lift, so calling in an orbital strike was paid for out of a
     * connection to the Force. Beyond the fiction it had a real cost in play:
     * the comm and the powers competed for one bar, so a run that leaned on
     * stratagems could not lift a walker, and two systems meant to be different
     * ways of fighting were one resource with two spouts.
     *
     * `world.support` is the side's supply line — see src/game/Support.js. It
     * builds by itself, builds faster when the battle is going your way, and
     * stops building for a while after every call, which is the "carriers
     * rearming" the note asks for.
     *
     * THE FALLBACK IS THE OLD PATH and it is not dead code: `Stratagems` is
     * constructed by the character creator and by the Codex preview, neither of
     * which has a World, and a call there must still be refusable.
     */
    const support = p?.world?.support;
    const cost = supportCost(s);
    if (support) {
      if (!support.spend(cost)) {
        this._say(`${s.name}: ${Math.ceil(cost - support.value)} more support`);
        audio.ui('bad');
        return false;
      }
    } else if (p?._spend && !p._spend(s.cost)) {
      this._say(`${s.name}: not enough Force`);
      audio.ui('bad');
      return false;
    }
    this.cooldowns[s.id] = s.cooldown;
    /* A CALL THAT LANDS ON YOU IS NOT DESIGNATED. There is nothing to place —
     * a rally is a shout and a resupply pod is thrown at your own feet — so
     * those commit on the spot and the phase never opens. */
    if (s.at !== 'aim') { this._commit(s, p.position.clone(), null, ctx); return true; }
    this.designating = { s, ctx, site: new THREE.Vector3(), lock: null, t: DESIGNATE_MAX };
    this._designate(ctx);
    this._say(`${s.name} — mark it`);
    audio.ui('hover');
    return true;
  }

  /** The player let go, or ran out of time. Send it. */
  _launch(ctx) {
    const D = this.designating;
    if (!D) return false;
    this.designating = null;
    this._commit(D.s, D.site.clone(), D.lock, ctx || D.ctx);
    return true;
  }

  /**
   * THE CALL ITSELF — queued, marked, and put in the air.
   *
   * The Force was spent in `_open`, through the OWNER's own spender: `_spend`
   * is where the difficulty's drain multiplier and the boon cost modifier are
   * applied, and a caller that did its own arithmetic would be a stratagem
   * that ignored both.
   */
  _commit(s, site, lock, ctx) {
    const p = this.owner;
    const lead = leadOf(s);
    /* THE MARK IS PART OF THE MECHANIC and not decoration. A call with a lead
     * that landed with no warning would be a delayed instant-kill; a ring on
     * the ground is what makes standing somewhere else the counter-play — for
     * the player, and for anything that learns to read it. Carried on the
     * pending record rather than as a separate list, because it is a property
     * of the inbound call and dies with it. */
    const P = { s, site, t: lead, mark: lead > 0.4 ? lead : 0, lock: s.track ? lock : null };
    this.pending.push(P);
    /* AND NOW SOMETHING IS ACTUALLY COMING. See src/game/Sorties.js: the lead
     * used to be a number with nothing in it, and the whole of note #31's
     * third paragraph is about that emptiness. The craft is launched at the
     * commit rather than at the impact, so it occupies the entire lead — and
     * `leadOf` derives the lead FROM the flight, so the payload leaves the
     * craft at the instant the craft is over the mark. */
    if (s.deliver) {
      const cad = s.cadence ? s.cadence(ctx, site, this) : [];
      const bearing = this._bearing(site);
      /**
       * `hold` IS HOW LONG THE THING STAYS AFTER IT GETS HERE, and the row is
       * what says so.
       *
       * It was `lead + 0.25` for everything, which is right for a lance: the
       * column opens over the countdown and is gone the instant the ground
       * goes. It is wrong for every call that OCCUPIES the field. Measured
       * before the row carried it: the gunship-on-station left after 2.65
       * seconds of a twenty-two second station and delivered 3 of its 18
       * bursts (363 hp of a measured 2 090), and the tractor beam's column
       * vanished a quarter of a second into a three-and-a-half second pull.
       *
       * A row that says nothing gets the old number, so the seven calls that
       * shipped are untouched.
       */
      this._sorties(ctx).launch(s.deliver, site, bearing, cad,
        { hold: lead + 0.25 + (s.hold ?? 0), follow: s.track ? () => P.site : null });
    }
    this._say(lead > 0.2 ? `${s.name} — ${lead.toFixed(1)}s` : s.name);
    audio.force(p.chest ?? p.position, 'push');
    return true;
  }

  /**
   * WHICH WAY THE CRAFT COMES IN FROM.
   *
   * Over the player's own shoulder, so the run comes from behind them and goes
   * away — a gunship that flew in from the far side would cross the player's
   * view of the thing it is shooting at, and the whole point is watching it
   * work. Falls back to the site's own bearing when the two coincide.
   */
  _bearing(site) {
    const from = this.owner?.position;
    if (!from) return 0;
    const d = _v1.subVectors(site, from).setY(0);
    if (d.lengthSq() < 1e-4) return this.owner?.camera?.yaw ?? 0;
    d.normalize();
    return Math.atan2(-d.x, -d.z);
  }

  /** Say something, briefly, to whoever is painting the HUD. */
  _say(text) { this.said = text; this.saidT = 2.2; }

  /**
   * WHERE YOU ARE LOOKING, ON THE GROUND.
   *
   * Walked forward in steps and stopped at the first sample under the terrain,
   * rather than solved: the terrain is a heightfield with no closed form, and
   * the alternative — a physics raycast — answers a different question (it
   * would stop on a crate, and a stratagem is called on GROUND).
   *
   * ── THIS IS ALSO THE LINE-OF-SIGHT TEST, and it is one by construction ──
   *
   * The walk stops at the first point that is under the ground, so a mark can
   * never be placed through a ridge: aim over a hill and the beam lands on the
   * near face of it, which is the last ground you can actually see. There is
   * no second visibility rule to keep in step with this one, and nothing to
   * disagree with — the beam simply cannot reach anywhere it did not pass
   * through open air to get to.
   *
   * ── RANGE ───────────────────────────────────────────────────────────────
   *
   * `AIM_REACH`, and a call aimed at the sky lands at the cap, which is the
   * honest answer to "there is nothing there". 90 m is the whole of a level's
   * usable field on every shipped ground and about twice the range anything
   * shoots you from, so the limit is on the horizon rather than on the fight:
   * you can always mark the thing that is killing you, and you cannot mark the
   * far side of the map.
   */
  _aimSite(ctx, out) {
    const p = this.owner;
    const terrain = ctx?.terrain;
    const from = p.chest ?? p.position;
    const dir = p.aimDir;
    const STEP = 1.2;
    out.copy(from).addScaledVector(dir, AIM_REACH);
    for (let d = STEP; d <= AIM_REACH; d += STEP) {
      _v1.copy(from).addScaledVector(dir, d);
      const h = terrain ? terrain.height(_v1.x, _v1.z) : 0;
      if (_v1.y <= h) { out.copy(_v1).setY(h); return out; }
    }
    out.y = terrain ? terrain.height(out.x, out.z) : 0;
    return out;
  }

  /**
   * ONE FRAME OF PAINTING A TARGET.
   *
   * Two things, and the second is the answer to "what happens if the target
   * moves".
   *
   * THE GROUND is `_aimSite` — where you are looking, every frame, so the mark
   * follows the aim while the key is down.
   *
   * THE LATCH: if that line passes within `LOCK_CONE` of a living body, the
   * designator takes the BODY instead of the ground it is standing on, and
   * from then until impact the site is wherever that body is. That is the
   * difference between marking a place and marking a thing, and it is the
   * difference note #31 asks for in as many words ("place it where you want to
   * specifically OR target what you want to target").
   *
   * THE BIGGEST BODY IN THE CONE WINS, not the nearest. A cone six metres
   * across at fifty metres will hold a B1 in front of the walker you are
   * plainly aiming at, and a lance that latched onto the droid because it was
   * a foot closer to the ray would be the game overruling you. Ties go to the
   * nearer.
   *
   * IF THE LATCHED BODY DIES before the lance arrives, the site FREEZES where
   * it last stood — see `update`. Orbit does not get a refund and the ground
   * does not get a reprieve: you called it on a place, and by the time you
   * find out otherwise the round has left the ship.
   *
   * Only rows with `track` may latch. A gun run is flown along a line the
   * pilot has already committed to; being able to steer one after the fact
   * would make the strafing run a second, better lance.
   */
  _designate(ctx) {
    const D = this.designating;
    if (!D) return null;
    this._aimSite(ctx, D.site);
    D.lock = null;
    if (!D.s.track) return D.site;
    const p = this.owner;
    const from = p.chest ?? p.position;
    const dir = p.aimDir;
    let best = null, bestScore = -Infinity;
    for (const e of (ctx?.enemies || [])) {
      if (e.dead || !e.position) continue;
      const along = _v1.subVectors(e.position, from).dot(dir);
      if (along <= 0 || along > AIM_REACH) continue;
      const off = _v2.copy(from).addScaledVector(dir, along).distanceTo(e.position);
      if (off > LOCK_CONE) continue;
      /* Size first, proximity to the ray as the tie-break. `A.big` and
       * `A.boss` are the roster's own words for "this is the thing you meant",
       * and they are read rather than a health threshold invented here. */
      const size = (e.A?.boss ? 2 : 0) + (e.A?.big ? 1 : 0);
      const score = size * 1000 - off;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (best) { D.lock = best; D.site.copy(best.position); D.site.y = this._groundAt(ctx, D.site); }
    return D.site;
  }

  /** The ground under a point, or the point's own height where there is none. */
  _groundAt(ctx, at) {
    return ctx?.terrain ? ctx.terrain.height(at.x, at.z) : at.y;
  }

  /** Run `fn` in `t` seconds. Cleared with everything else on unload. */
  after(t, fn) { this._timers.push({ t, fn }); }

  /**
   * RUN `fn` EVERY `period` SECONDS FOR `duration`, and then stop.
   *
   * Six of the eleven calls added for the release ladder are not events, they
   * are OCCUPATIONS: a fence burning for eighteen seconds, a beam pulling for
   * three and a half, a storm for eighteen, a minefield for forty-five. Every
   * one of them wants the same loop, and six hand-rolled copies of "re-arm a
   * timer until a counter runs out" is HANDOFF §2.4 waiting to happen — one of
   * them will eventually forget to stop.
   *
   * BUILT ON `after` AND NOT ON A NEW LIST. `_timers` is already stepped by
   * `update` and already cleared by `reset`, so a sustained effect dies with
   * the level for free; a second registry would be a second thing to remember
   * to clear, and this file has a note about exactly that on `clearSmoke`.
   *
   * `fn(elapsed, k)` is handed the seconds since it started and the fraction of
   * its life that has run, so a caller can fade, thin out or accelerate without
   * keeping its own clock. Returning `false` ends it early.
   *
   * ── A DURATION OF 0 MEANS "UNTIL `fn` SAYS STOP", AND TWO CALLS NEED IT ──
   *
   * The fence and the minefield do not have one duration; they have a LIST of
   * things with their own clocks, laid a fifth of a second apart by a craft
   * flying over. Bounding the loop by a number measured from the FIRST one is
   * off by however long the pass took, and the failure is silent and
   * cumulative: measured, the fence's loop stopped 18.5 s after the first node
   * lit while the last node still had a second of life, so two nodes stayed in
   * `_fires` for the rest of the level — burning nothing, and holding
   * `_burning` true, which meant the NEXT fence the player called laid seven
   * nodes that never caught. The list is the authority for when it is over, so
   * the list is what ends it.
   *
   * Both callers that use it age their own list down and return `false` the
   * beat it empties, which is what makes the loop terminate. `reset` clears
   * `_timers` with the level either way, so nothing here can outlive a battle.
   */
  sustain(duration, period, fn) {
    let t = 0;
    const beat = () => {
      t += period;
      const k = duration > 0 ? clamp(t / duration, 0, 1) : 0;
      let go = true;
      try { go = fn(t, k) !== false; } catch { go = false; }
      if (go && (duration <= 0 || t < duration)) this.after(period, beat);
    };
    this.after(period, beat);
  }

  /**
   * IS THERE A MACHINE IN THERE — and the answer is the MATERIAL table's.
   *
   * `Combat.TOUGHNESS` already says what every body in this game is made of,
   * and `TOUGHNESS.droid` (2.0) is the rung above plastoid (1.5, which is a
   * clone's armour over a man) and flesh (0.9). So everything at or above it is
   * a machine — a B1, a B2, a droideka, a MagnaGuard, a BX, a walker, an AAT, a
   * hailfire, a spider — and everything below it is somebody. It is right for
   * all 31 archetypes and for the next one somebody writes, which a regex over
   * type names is not.
   */
  static isMachine(e) { return (e?.A?.toughness ?? TOUGHNESS.flesh) >= TOUGHNESS.droid; }

  /** Every living body within `r` of a point. One walk, six callers. */
  _near(ctx, at, r) {
    const out = [];
    const r2 = r * r;
    for (const e of (ctx?.enemies || [])) {
      if (e.dead || !e.position) continue;
      if (e.position.distanceToSquared(at) <= r2) out.push(e);
    }
    return out;
  }

  update(dt, ctx) {
    /* THE CLOUDS AGE HERE, and this is the only caller. A support call is the
     * only thing that lays smoke, so the thing that lays it is the thing that
     * ticks it — one owner, and no second place to forget. */
    updateSmoke(dt);
    /* AND THE LADDER IS WATCHED HERE, for the same reason: this is the one
     * object that is stepped every frame and already knows the table. */
    this._release(ctx);
    if (this.sorties) this.sorties.update(dt, ctx);
    for (const id in this.cooldowns) {
      if (this.cooldowns[id] > 0) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    }
    if (this.saidT > 0) this.saidT = Math.max(0, this.saidT - dt);
    if (this.entry) {
      this.since += dt;
      if (this.since > CODE_GAP) { this.entry = ''; this.since = 0; }
    }
    /**
     * THE DESIGNATION IS ON A CLOCK, and the clock fires rather than cancels.
     *
     * A player who is holding the key and being shot at is not deciding; the
     * call is already paid for, so the honest expiry is to SEND it at whatever
     * is under the beam. Cancelling would take the Force as well as the call,
     * and a mechanic whose failure mode is losing both is one nobody presses.
     */
    if (this.designating) {
      this.designating.ctx = ctx;
      this._designate(ctx);
      this.designating.t -= dt;
      if (this.designating.t <= 0) { this._say('mark expired — sending'); this._launch(ctx); }
      else if (ctx?.particles) this._paintDesignator(ctx, this.designating);
    }
    for (let i = this._timers.length - 1; i >= 0; i--) {
      const T = this._timers[i];
      T.t -= dt;
      if (T.t <= 0) { this._timers.splice(i, 1); T.fn(); }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const P = this.pending[i];
      P.t -= dt;
      /* A LATCHED CALL FOLLOWS ITS BODY, and lets go when the body does. The
       * site is the last place it stood, which is where the round is already
       * committed to — see `_designate`. */
      if (P.lock) {
        if (P.lock.dead) P.lock = null;
        else { P.site.copy(P.lock.position); P.site.y = this._groundAt(ctx, P.site); }
      }
      if (P.mark && ctx?.particles) this._paintMark(ctx, P);
      if (P.t <= 0) { this.pending.splice(i, 1); P.s.fire?.(ctx, P.site, this, P.s); }
    }
  }

  /**
   * THE BEAM, while the player is placing it.
   *
   * A dotted line from the chest to the mark and a bright reticle on the
   * ground, redrawn every frame — the point is that the player can SEE where
   * it will land before they let go, which is the whole of the second half of
   * note #31. A latched body gets a second, tighter ring so that "I have the
   * walker" and "I have the ground near the walker" are not the same picture.
   */
  _paintDesignator(ctx, D) {
    const P = ctx.particles;
    const from = _v3.copy(this.owner.chest ?? this.owner.position);
    const span = from.distanceTo(D.site);
    const beads = Math.min(26, Math.max(4, Math.round(span / 3.2)));
    for (let i = 1; i <= beads; i++) {
      const k = i / (beads + 1);
      _v1.lerpVectors(from, D.site, k);
      P.sparks.spawn(_v1, _v2.set(0, 0, 0),
        { life: 0.06, size: 0.045, drag: 0, gravity: 0, color: 0xff4030, alpha: 0.85 });
    }
    const r = D.lock ? 1.6 : 2.4;
    const n = D.lock ? 10 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (this.owner.world?.time ?? 0) * (D.lock ? 3.4 : 1.2);
      _v1.set(D.site.x + Math.cos(a) * r, D.site.y + 0.10, D.site.z + Math.sin(a) * r);
      P.sparks.spawn(_v1, _v2.set(0, 0.2, 0),
        { life: 0.10, size: D.lock ? 0.13 : 0.09, drag: 0, gravity: 0,
          color: D.lock ? 0xffe060 : 0xff5030, alpha: 1 });
    }
  }

  /**
   * THE WARNING RING, tightening — and it is a warning and not a decoration.
   *
   * Twice as many marks as it had and a colour that goes from amber to white
   * as the last second runs out, because at the sizes note #31 asks for
   * (`STRATAGEMS`'s own numbers say a 12 m lance) a ring the player has to
   * squint at is a ring nobody steps out of. The radius is the BLAST's radius
   * rather than a constant: a mark that did not describe the thing it is
   * warning about is a lie the player only finds out about once.
   */
  _paintMark(ctx, P) {
    const k = clamp(P.t / P.mark, 0, 1);
    const R = P.s.radius ?? MARK_RADIUS;
    const r = R * (0.35 + k * 0.65);
    const hot = k < 0.25;
    const n = hot ? 16 : 10;
    for (let i = 0; i < n; i++) {
      const a = ((i / n) + (1 - k) * 1.7) * TAU;
      _v1.set(P.site.x + Math.cos(a) * r, P.site.y + 0.12, P.site.z + Math.sin(a) * r);
      ctx.particles.sparks.spawn(_v1, _v2.set(0, 0.4, 0),
        { life: 0.16, size: hot ? 0.16 : 0.11, drag: 2, gravity: 0,
          color: hot ? 0xffffff : 0xffb020, alpha: 0.95 });
    }
  }

  /** Nothing outlives a level. */
  reset() {
    this.entry = ''; this.pending.length = 0; this._timers.length = 0; this.cooldowns = {};
    this.designating = null;
    /* THE LADDER'S WATERMARK GOES WITH IT. A new field is a new battle and a
     * new `WarSupport`, so an old watermark would suppress the announcement of
     * every rung the last battle had already passed. `null` is "nothing seen
     * yet", which `_release` reads as "record where we are and say nothing" —
     * the correct behaviour for the first frame of a battle. */
    this._effort = null;
    this._mines.length = 0;
    this._fires.length = 0;
    this._burning = false;
    this._mining = false;
    this.sorties?.clear();
    clearSmoke();
  }

  /* ── the effects, and every one of them is somebody else's verb ────── */

  /**
   * A HOLE IN THE GROUND AND EVERYTHING NEAR IT THROWN.
   *
   * `Player._shockwave` is centred on the player and this is not, so it cannot
   * be that call — but it must not be a second copy of it either. What it
   * shares is the RULE: `applyKnockback(impulse, damage, source)` is the one
   * door a blast goes through, it is what answers the target's own Force pool,
   * and it is called here exactly as the landing shockwave calls it.
   *
   * ── `core`, AND WHY A LANCE IS NOT A BALLOON ────────────────────────────
   *
   * Linear falloff from a single point is right for a shockwave and wrong for
   * a shell: a body two metres off the centre of a 12 m strike is not four
   * fifths hit, it is hit. `core` is the fraction of the radius that takes the
   * whole of the damage, with the linear taper running from there to nothing
   * at the rim. It defaults to 0, which is the shape every existing caller
   * already had, so nothing that does not ask for it moves.
   *
   * ── `shake`, `size`, `crater` ───────────────────────────────────────────
   *
   * The three halves of "massive" that are not damage. The camera shake is
   * scaled by the distance to the caller, because a detonation eighty metres
   * away that punched the frame as hard as one at your feet would tell the
   * player the wrong thing about where they are safe. Everything about the
   * ground is `Terrain.crater`'s, which deforms the real heightfield and keeps
   * it — the hole is still there next wave.
   */
  blast(ctx, site, radius, force, damage, opts = {}) {
    /**
     * WHO GETS THE CREDIT, and it is not always the person holding the comm.
     *
     * `this.owner` is the Player, which is right for every call that arrives
     * through a stratagem code: the Jedi spelled it, the Jedi is answerable for
     * it, and `onFriendlyHit` reading their own troops out of it is the whole
     * of "spelling eight directions and holding it on your own men is a
     * decision". It is WRONG for a blast this class did not choose — a grenade
     * a trooper threw, whose kills belong to that trooper's own record and
     * whose friendly fire is his mistake and not yours. Measured before it: ten
     * grenades thrown by an army over one wave, every kill credited to a Jedi
     * who was standing still.
     *
     * `opts.source` is that body. It changes attribution only: the arithmetic,
     * the falloff, the Force answer and the crater are the same call.
     */
    const p = opts.source ?? this.owner;
    const core = clamp(opts.core ?? 0, 0, 0.95);
    /**
     * `hard` — WHAT FRACTION OF THIS BLOW A PLATED MACHINE TAKES.
     *
     * Defaults to 1, so every caller that does not ask for it is unchanged.
     * Fragmentation is the one that does: a cluster bomblet and a thermal fence
     * are a swarm of small fast pieces and a fire, and neither goes through
     * 40 mm of durasteel. That is a statement about the WEAPON and not about
     * the target, which is why it is a term on the blow rather than a rule
     * inside `Enemy` — the same bomblet is charged the same way whatever it
     * lands on, and what changes is what it lands on.
     *
     * WHAT COUNTS AS PLATED IS `Combat.TOUGHNESS`, the table that already says
     * what every body in this game is made of, read at `TOUGHNESS.heavy` — a
     * walker, a tank, a hailfire, a spider droid. A B1 at `droid` 2.0 and a
     * clone at `plastoid` 1.5 both take the whole thing, which is right: a
     * fragment goes through both. A list of type names here would be HANDOFF
     * §2.4's restated rule and would be wrong the day somebody adds a tank.
     */
    const hard = clamp(opts.hard ?? 1, 0, 1);
    const size = opts.size ?? clamp(radius / 5, 0.6, 2.2);
    /* THE GROUND REMEMBERS. `crater` is a depth in metres and it is the number
     * that decides whether a player walks past the hole later and knows what
     * happened there. Measured on Geonosis: the shipped strike's 3.75 m × 0.34
     * crater moved the ground 0.11 m — a scuff. A 6 m × 2.1 m one moves it
     * 1.89 m, which is a hole with walls. */
    if (ctx?.terrain?.crater) ctx.terrain.crater(site.x, site.z, radius * 0.5, opts.crater ?? 0.34);
    if (ctx?.terrain?.burn) ctx.terrain.burn(site.x, site.z, radius * 0.6, 1);
    audio.explosion(site, clamp(size, 0.6, 3.6));
    /** The fraction of the blow a body at `d` takes. See `core`. */
    const falloff = (d) => {
      if (d > radius) return 0;
      const inner = radius * core;
      return d <= inner ? 1 : 1 - (d - inner) / Math.max(1e-3, radius - inner);
    };
    for (const e of (ctx?.enemies || [])) {
      if (e.dead) continue;
      const k = falloff(e.position.distanceTo(site));
      if (k <= 0) continue;
      /* PLATE ANSWERS THE FRAGMENT, once, at the same place the falloff does —
       * see `hard`. A shove is not blunted by armour and damage is, so the
       * share is on the damage term alone. */
      const plated = (e.A?.toughness ?? TOUGHNESS.flesh) >= TOUGHNESS.heavy;
      _v1.subVectors(e.position, site).setY(0.7).normalize().multiplyScalar(force * k);
      e.applyKnockback(_v1, damage * k * (plated ? hard : 1), p);
    }
    /**
     * AND IT DOES NOT SPARE YOU, OR ANYONE OF YOURS.
     *
     * A support call that could not hurt its caller is a button with no
     * downside, and the lead time only means something if standing in the
     * marked circle is a mistake. Halved for the CALLER, because you knew it
     * was coming — the enemy did not.
     *
     * YOUR OWN LINE IS NOT HALVED AND IS NOT SPARED. In Command mode the
     * troops around you are `Enemy` instances on your team, so they come
     * through the loop above and are billed at `teamDamage` by the wrapper
     * Command.js already puts in front of `Enemy.damage` — the same door a
     * stray blade stroke goes through. It also costs you the line's morale:
     * `applyKnockback` bills its damage as kind `'force'`, `onFriendlyHit`
     * reads that as the deliberate kind, and `MORALE.BETRAYED` fires. That is
     * the correct reading of what just happened. Spelling eight directions,
     * painting a mark and holding it on your own men is not an accident in a
     * melee; it is a decision, and it is exactly the decision that table's
     * "the Jedi used a Force power ON one of their own" was written for.
     */
    /* THE HALVING IS THE CALLER'S, not the source's: "you knew it was coming"
     * is true of the person who spelled the code and false of a man standing
     * next to a grenade somebody else threw. `this.owner` therefore, always. */
    const caller = this.owner;
    if (caller && !caller.dead && caller !== opts.source) {
      const k = falloff(caller.position.distanceTo(site));
      if (k > 0) caller.damage?.(damage * k * 0.5, site, null, 'explosion');
    }
    if (ctx?.physics) {
      for (const b of ctx.physics.bodies) {
        if (b.invMass === 0) continue;
        const k = falloff(b.position.distanceTo(site));
        if (k <= 0) continue;
        _v1.subVectors(b.position, site).setY(0.6).normalize();
        b.applyImpulse(_v1.multiplyScalar(force * k * b.mass * 0.5), b.position);
      }
    }
    /* THE FRAME KNOWS. Scaled by how far the caller is from it, and gated
     * through the camera rig — which is the one writer `applyFeelSettings`
     * wraps, so a player who turned motion feedback off is not shaken here
     * either (see Menu.js's note over `addShake`). */
    const shake = opts.shake ?? 0;
    if (shake > 0 && p?.camera?.addShake) {
      const d = p.position.distanceTo(site);
      const near = clamp(1 - d / (radius * 5), 0, 1);
      if (near > 0) {
        p.camera.addShake(shake * near);
        this.owner?.world?.engine?.punch?.(shake * near);
        this.owner?.world?.engine?.rumble?.(0.9 * near, 0.5 * near, 260);
      }
    }
    const P = ctx?.particles;
    if (!P) return;
    /* THE FIREBALL IS `Particles.explosion`, which already owns what a
     * detonation looks like — a lit smoke ball, chips, a scorch decal and
     * ground disturbance. What is added on top is the DUST WALL, because that
     * is the part that carries the scale and it is proportional to the hole. */
    P.explosion?.(site, clamp(size, 0.5, 4));
    /* ONE ALLOWANCE FOR EVERY SHARED RING THIS DETONATION TOUCHES — sparks,
     * dust and smoke alike. A single blast may have the pools to itself; a
     * walked barrage is twelve of them 0.17 s apart, all inside one particle's
     * lifetime, so they stack in the same rings. Measured before this existed:
     * 372 of 672 spark slots AND 348 of 256 smoke slots at the bottom of the
     * Particles slider — the smoke ring overflowing by 36% in one call, which
     * is work no frame can ever show.
     *
     * `sparkShare` is named for where it was first needed and governs all
     * three; a caller firing n rounds passes `1/sqrt(n)`, because perceived
     * density goes roughly as the square root of the count. */
    const share = clamp(opts.sparkShare ?? 1, 0.05, 1);
    const ring = Math.round(34 * clamp(size, 0.6, 3) * share);
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * TAU;
      _v1.set(Math.cos(a), 0.35 + this.rand() * 0.8, Math.sin(a)).multiplyScalar(radius * 1.7);
      P.dust.spawn(_v2.copy(site).setY(site.y + 0.15), _v1,
        { life: 1.5 + size * 0.5, size: 0.7 * size, drag: 2.0, gravity: 0.5,
          color: ctx.groundColor ?? 0xd8c8a8, alpha: 0.3, floor: site.y });
    }
    /* AND A COLUMN. A blast this size throws material UP, and a ring with no
     * column in it reads as a puff however wide it is. */
    /* THE COLUMN TAKES THE LINEAR SHARE, NOT THE SQUARE ROOT, because smoke
     * OUTLIVES THE BURST. A spark is gone before the next shell lands, so
     * twelve shells never hold twelve shells' worth of sparks at once and
     * `1/sqrt(n)` is the honest amortisation. Column smoke lives 2.2–4.2 s
     * against a barrage that takes 1.87 s to walk: every shell's column is
     * still in the ring when the last one fires, so the stack is the full
     * count and the share has to be too. Measured at the bottom of the
     * slider: 348 slots of 256 before any share, 144 on the square root,
     * 84 on this. */
    for (let i = 0; i < Math.round(14 * size * (share * share)); i++) {
      _v1.set((this.rand() - 0.5) * 4, 12 + this.rand() * 22 * size, (this.rand() - 0.5) * 4);
      P.smoke?.spawn(_v2.copy(site).setY(site.y + 0.4), _v1,
        { life: 2.2 + this.rand() * 2, size: 1.4 * size, drag: 1.5, gravity: -1.2,
          color: 0x50505a, alpha: 0.45 });
    }
    /* SPARKS ARE A SHARED RING, AND A WALKED BARRAGE IS TWELVE OF THESE.
     *
     * One detonation may have the pool to itself. Twelve shells 0.17 s apart
     * all land inside a spark's lifetime, so they stack in the same ring —
     * measured, 372 of the 672 slots at the bottom of the Particles slider,
     * 55% of every spark in the game from one call, on the tier the menu
     * offers to integrated graphics. Past capacity a ring overwrites what it
     * wrote a microsecond earlier, so the surplus cannot be seen; well before
     * that it erases every blade hit and bolt impact on the field.
     *
     * `share` is how much of one explosion's allowance this detonation may
     * take, and a multi-shell call divides it by the count it is about to
     * fire. Not linearly: perceived density goes as roughly the square root of
     * the count, so `1/sqrt(n)` keeps a single shell looking like a shell
     * while twelve of them together cost about what three used to. The caller
     * derives it from its own loop bound, so a barrage that grows a shell
     * cannot forget to re-divide. */
    P.sparkBurst?.(site, null, Math.round(40 * size * share),
      { speed: 16 * size, color: 0xffb877 });
  }

  /**
   * TWELVE IMPACTS ACROSS SIXTY METRES — the strafing run's payload.
   *
   * Returned as a CADENCE (see src/game/Sorties.js) rather than run here,
   * because the whole point of it is that the impacts happen where the ship
   * is, when the ship is there. `t` is seconds relative to the craft being
   * over the mark, so the run opens fire half a second before it arrives and
   * walks the fire out the other side.
   *
   * THE ONLY NEW CODE IS THE CADENCE. Each beat fires real bolts out of the
   * real `BoltPool` — the 460-bolt pool the whole game shoots from, at two
   * draw calls — and then cracks the ground with the same `blast` every other
   * call uses. Nothing here knows how to shoot or how to break ground.
   */
  gunRun(ctx, site) {
    const BEATS = 12, HZ = 8, HALF = 30;
    const b = this._bearing(site);
    /* OWN VECTORS, NOT THE MODULE'S SCRATCH. Everything a cadence entry does
     * calls back into this file — `_gunPair`, `blast` — and both of those use
     * `_v1.._v3`, so a point held in one of them is overwritten by the first
     * thing that reads it. The impacts are computed here, once, and each beat
     * carries its own vector. */
    const bear = new THREE.Vector3(Math.sin(b), 0, Math.cos(b));
    const side = new THREE.Vector3(-bear.z, 0, bear.x);
    const out = [];
    for (let i = 0; i < BEATS; i++) {
      /* The impacts walk from in front of the ship to behind it, along its own
       * track, which is what a gun run looks like from the ground. */
      const along = HALF - (i / (BEATS - 1)) * HALF * 2;
      const at = site.clone().addScaledVector(bear, along)
        .addScaledVector(side, (this.rand() - 0.5) * 2.6);
      out.push({
        t: (i / HZ) - (BEATS * 0.5) / HZ,
        fn: (from, c) => {
          at.y = this._groundAt(c, at);
          this._gunPair(c, from.clone(), at);
          this.blast(c, at, 5.5, 55, 130,
            { core: 0.25, shake: 0.22, size: 1.2, crater: 0.6 });
        },
      });
    }
    return out;
  }

  /**
   * ONE BURST FROM THE CHIN TURRETS.
   *
   * The bolts are real and carry real damage, so anything standing between the
   * ship and the ground it is shooting takes the round rather than the crater.
   * Their `life` is set to their own time of flight, which is what keeps the
   * visible round and the impact the cadence schedules on the same frame — a
   * bolt that outlived its impact would fly on through the ground.
   */
  _gunPair(ctx, from, at) {
    const pool = ctx?.world?.bolts || ctx?.bolts;
    if (!pool?.fire) return;
    const dir = new THREE.Vector3().subVectors(at, from);
    const dist = dir.length() || 1;
    dir.multiplyScalar(1 / dist);
    const wing = new THREE.Vector3(dir.z, 0, -dir.x);
    const SPEED = 190;
    for (const side of [-1, 1]) {
      const o = from.clone().addScaledVector(wing, side * 1.3);
      pool.fire(o, dir, { speed: SPEED, damage: 34, life: dist / SPEED, team: this.owner?.team ?? 0,
        owner: this.owner, color: 0x66ddff, big: true });
    }
  }

  /**
   * FOUR CANISTERS ACROSS THE MARK — the smoke drop's payload.
   *
   * A wall and not a ball. One cloud on the mark and three walked along the
   * craft's own track, which is how a screen is actually laid: what the player
   * wants is a LINE between themselves and whatever is shooting, and a single
   * round bank leaves both ends open.
   */
  canisters(ctx, site) {
    const b = this._bearing(site);
    // Own vectors, for the reason `gunRun` gives above.
    const across = new THREE.Vector3(Math.cos(b), 0, -Math.sin(b));
    const out = [];
    /* SIX AT 12 m ON A 9 m PITCH — a 57 m bank, against the 31 m the four-at-
     * 8.5 laid. The pitch is deliberately less than the diameter so consecutive
     * canisters OVERLAP: two clouds' optical depths add (see Smoke.js), so the
     * seams between them are the thickest part of the wall rather than the gaps
     * a line can shoot through. Twenty-two seconds rather than thirteen,
     * because a screen you have to re-lay before you have crossed it is a
     * screen that never did its job. */
    for (let i = 0; i < SMOKE_CANS; i++) {
      const at = site.clone().addScaledVector(across, (i - (SMOKE_CANS - 1) / 2) * 9.0);
      out.push({
        t: i * 0.22 - 0.55,
        fn: (from, c) => { at.y = this._groundAt(c, at); this.smoke(c, at, 12, 22); },
      });
    }
    return out;
  }

  /**
   * SMOKE, AND IT ACTUALLY BLINDS.
   *
   * The particles are the visible half; the half that matters is that a body
   * inside the cloud cannot see through it. Rather than teach every shooter
   * about smoke, the cloud is registered on the world as an OCCLUDER and the
   * one place that already asks "can I see my target" reads it — see
   * `world.smokeBlocks`. One question, one answer, both sides subject to it.
   */
  smoke(ctx, site, radius, life) {
    addSmoke(site, radius, life);
    audio.noise({ dur: 0.9, gain: 0.3, type: 'lowpass', freq: 1400, freqEnd: 300,
      pink: true, attack: 0.02, pos: site });
    const P = ctx?.particles;
    if (!P) return;
    for (let i = 0; i < 60; i++) {
      const a = this.rand() * TAU, r = Math.sqrt(this.rand()) * radius;
      _v1.set(site.x + Math.cos(a) * r, site.y + 0.2, site.z + Math.sin(a) * r);
      _v2.set((this.rand() - 0.5) * 1.2, 0.5 + this.rand(), (this.rand() - 0.5) * 1.2);
      P.dust.spawn(_v1, _v2, { life: life * (0.6 + this.rand() * 0.6), size: 2.6, drag: 1.1,
        gravity: -0.06, color: 0xb9c2cc, alpha: 0.34, floor: site.y });
    }
  }

  /** More of yours, through the director that already knows how to land them. */
  reinforce(ctx, n) {
    const cmd = (ctx?.world || this.owner?.world)?.command;
    if (!cmd?.reinforce) { this._say('no line to reinforce'); return; }
    cmd.reinforce(n, { byShip: true });
  }

  /** Steady the line — the commander's own morale verb, not a new one. */
  rally(ctx, radius) {
    const cmd = (ctx?.world || this.owner?.world)?.command;
    if (!cmd?.rallyNear) { this._say('nobody to rally'); return; }
    const n = cmd.rallyNear(this.owner.position, radius);
    this._say(n ? `rallied ${n}` : 'nobody in earshot');
  }

  /* ── the eleven released along the ladder ──────────────────────────── */

  /**
   * FIVE AIRBURSTS IN A LINE — the concussion wall's payload.
   *
   * Laid ACROSS the caller's own bearing, like the smoke bank and for the same
   * reason: what you want is a line between you and them, and a round pattern
   * leaves both ends open. 12 m apart at 14 m radius, so the bursts overlap and
   * there is no gap in the middle of the wall to walk through.
   *
   * 300 of impulse against 9 of damage. `blast` takes those as two independent
   * numbers and this is the one row that spends the first and not the second —
   * measured on the packed field, 15 bodies leave at a mean 11.4 m/s and one
   * dies. `sparkShare` is the same 1/sqrt(n) every multi-round call takes.
   */
  wall(ctx, site) {
    const b = this._bearing(site);
    const across = new THREE.Vector3(Math.cos(b), 0, -Math.sin(b));
    const out = [];
    for (let i = 0; i < WALL_BURSTS; i++) {
      const at = site.clone().addScaledVector(across, (i - (WALL_BURSTS - 1) / 2) * 12.0);
      out.push({
        t: i * 0.09 - 0.18,
        fn: (from, c) => {
          at.y = this._groundAt(c, at);
          this.blast(c, at, 14, 140, 9,
            { core: 0.45, shake: 0.34, size: 1.6, crater: 0.25,
              sparkShare: 1 / Math.sqrt(WALL_BURSTS) });
        },
      });
    }
    return out;
  }

  /**
   * A BURNING LINE — the thermal fence's payload.
   *
   * Seven nodes on a 9 m pitch across the bearing: a 54 m wall of fire and, at
   * `FENCE_R` 5.5 m each, no gap between them. Each node is registered on
   * `_fires` and burned by ONE sustained loop rather than seven, because seven
   * loops each walking the enemy list is seven walks a beat.
   */
  fenceLine(ctx, site) {
    const b = this._bearing(site);
    const across = new THREE.Vector3(Math.cos(b), 0, -Math.sin(b));
    const out = [];
    for (let i = 0; i < FENCE_NODES; i++) {
      const at = site.clone().addScaledVector(across, (i - (FENCE_NODES - 1) / 2) * 9.0);
      out.push({
        t: i * 0.16 - 0.48,
        fn: (from, c) => { at.y = this._groundAt(c, at); this._lightFire(c, at); },
      });
    }
    return out;
  }

  /**
   * ONE NODE OF THE FENCE, ALIGHT.
   *
   * The burn loop is started by the FIRST node and not by each of them — see
   * `_fires`, which is the shared list every node lands in. A body standing in
   * the fence is billed once a beat whichever node it is nearest, so a man
   * standing in the overlap between two of them does not take double.
   */
  _lightFire(ctx, at) {
    const node = { at: at.clone(), t: FENCE_LIFE };
    this._fires.push(node);
    if (ctx?.terrain?.burn) ctx.terrain.burn(at.x, at.z, FENCE_R * 1.2, 1);
    audio.noise({ dur: 1.2, gain: 0.24, type: 'lowpass', freq: 900, freqEnd: 260,
      pink: true, attack: 0.02, pos: at });
    if (this._burning) return;
    this._burning = true;
    /* FOUR BEATS A SECOND for the whole life of the longest node. Not sixty:
     * the fence is ground denial and a body is either in it or not, and
     * charging `FENCE_DPS * 0.25` four times a second is the same number of
     * hit points with a fifteenth of the work. */
    this.sustain(0, 0.25, () => {
      for (let i = this._fires.length - 1; i >= 0; i--) {
        const f = this._fires[i];
        f.t -= 0.25;
        if (f.t <= 0) { this._fires.splice(i, 1); continue; }
      }
      if (!this._fires.length) { this._burning = false; return false; }
      /* ONE PASS OVER THE BODIES, not one per node: a body is billed for the
       * nearest node it is inside and no other. */
      for (const e of (ctx?.enemies || [])) {
        if (e.dead || !e.position) continue;
        let inside = false;
        for (const f of this._fires) {
          if (e.position.distanceTo(f.at) <= FENCE_R) { inside = true; break; }
        }
        if (!inside) continue;
        const plated = (e.A?.toughness ?? TOUGHNESS.flesh) >= TOUGHNESS.heavy;
        e.damage?.(FENCE_DPS * 0.25 * (plated ? FENCE_HARD : 1), e.position, this.owner, 'explosion');
      }
      /* AND IT BURNS ITS CALLER. Same rule as `blast`: a hazard that could not
       * hurt the person who laid it is a button with no downside. Halved,
       * because you knew where you put it. */
      const p = this.owner;
      if (p && !p.dead) {
        for (const f of this._fires) {
          if (p.position.distanceTo(f.at) <= FENCE_R) {
            p.damage?.(FENCE_DPS * 0.25 * 0.5, f.at, null, 'explosion');
            break;
          }
        }
      }
      this._paintFire(ctx);
      return true;
    });
  }

  /** The flames, four times a second, out of the shared dust and plasma rings. */
  _paintFire(ctx) {
    const P = ctx?.particles;
    if (!P) return;
    for (const f of this._fires) {
      for (let i = 0; i < 3; i++) {
        const a = this.rand() * TAU, r = Math.sqrt(this.rand()) * FENCE_R;
        _v1.set(f.at.x + Math.cos(a) * r, f.at.y + 0.15, f.at.z + Math.sin(a) * r);
        _v2.set((this.rand() - 0.5) * 0.6, 2.2 + this.rand() * 2.4, (this.rand() - 0.5) * 0.6);
        P.plasma?.spawn?.(_v1, _v2, { life: 0.5, size: 0.34, drag: 1.4, gravity: -1.4,
          color: 0xff8828, alpha: 0.8 });
      }
      _v1.set(f.at.x, f.at.y + 0.4, f.at.z);
      P.smoke?.spawn?.(_v1, _v2.set((this.rand() - 0.5) * 1.2, 3.0, (this.rand() - 0.5) * 1.2),
        { life: 1.6, size: 1.5, drag: 1.4, gravity: -1.0, color: 0x2c2c30, alpha: 0.30 });
    }
  }

  /**
   * EVERY MACHINE INSIDE THE CIRCLE, STOPPED — the ion pulse.
   *
   * Two things to each machine and one of them is the point. The damage is a
   * third of a B1 line's health and would not be worth 37.5 of support on its
   * own; `stun(ION_STUN)` is what the call is for, and seven seconds is longer
   * than any fight in this game takes to turn around.
   *
   * FLESH IS NOT TOUCHED AT ALL, not "touched less". A clone standing in the
   * middle of it walks out untouched, which is the whole reason this call is a
   * decision rather than a strictly better strike — against the Republic it is
   * 37.5 of support spent on nothing.
   */
  ionPulse(ctx, site, radius) {
    audio.explosion(site, 2.0);
    audio.noise({ dur: 1.4, gain: 0.4, type: 'bandpass', freq: 2600, freqEnd: 420, q: 1.4,
      attack: 0.01, pos: site });
    let hit = 0, dealt = 0;
    for (const e of this._near(ctx, site, radius)) {
      if (!Stratagems.isMachine(e)) continue;
      const hp0 = e.hp;
      /* THROUGH `applyKnockback`, with almost no shove: it is the one door a
       * blow goes through in this game and it is what answers the target's own
       * Force pool. A pulse that billed `damage()` directly would be the one
       * hit in the game a Force user could not resist. */
      _v1.subVectors(e.position, site).setY(0.2).normalize().multiplyScalar(3);
      e.applyKnockback(_v1, ION_DAMAGE, this.owner);
      e.stun?.(ION_STUN);
      hit++;
      dealt += Math.max(0, hp0 - e.hp);
    }
    /* AND THE PLAYER'S OWN MACHINES TOO — a droid on your side is a droid.
     * There is nothing to special-case: the loop above is the enemy list, which
     * in Command mode is where your own line lives. */
    this._say(hit ? `${hit} disabled` : 'nothing to disable');
    const P = ctx?.particles;
    if (!P) return { hit, dealt };
    /* THE RING, in the pool the lightning uses rather than the spark ring —
     * an ion pulse is a discharge and the spark ring is 6 cm dots sized for
     * blade hits. */
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * TAU;
      _v1.set(Math.cos(a), 0.25 + this.rand() * 0.5, Math.sin(a)).multiplyScalar(radius * 1.4);
      P.plasma?.spawn?.(_v2.copy(site).setY(site.y + 0.3), _v1,
        { life: 0.8, size: 0.4, drag: 2.4, gravity: 0, color: 0x7fd0ff, alpha: 0.85 });
    }
    const L = (ctx?.world || this.owner?.world)?.lightning;
    if (L?.strike) {
      for (let i = 0; i < 7; i++) {
        const a = this.rand() * TAU, r = Math.sqrt(this.rand()) * radius;
        _v1.set(site.x + Math.cos(a) * r, site.y + 0.2, site.z + Math.sin(a) * r);
        L.strike(_v2.copy(site).setY(site.y + 26), _v1, { power: 1.3, life: 0.22, chaos: 1.4 });
      }
    }
    return { hit, dealt };
  }

  /**
   * TWELVE CHARGES ON THE GROUND — the seismic scatter's payload.
   *
   * The pass drops them; `_armCharge` is what makes each one a hazard. They are
   * scattered on a spiral rather than at random so the field has no hole in the
   * middle of it, with a metre of jitter so it does not read as a pattern.
   */
  scatterMines(ctx, site) {
    const out = [];
    for (let i = 0; i < MINE_COUNT; i++) {
      const a = i * 2.399, r = 2.0 + (i / MINE_COUNT) * 13.0;
      const at = site.clone().add(new THREE.Vector3(
        Math.cos(a) * r + (this.rand() - 0.5) * 2, 0, Math.sin(a) * r + (this.rand() - 0.5) * 2));
      out.push({
        t: i * 0.05 - 0.3,
        fn: (from, c) => { at.y = this._groundAt(c, at); this._armCharge(c, at); },
      });
    }
    return out;
  }

  /**
   * ONE CHARGE, ARMED AND WAITING.
   *
   * `MINE_ARM` of dead time first, so a charge cannot detonate on the ship that
   * dropped it or on a player standing where they marked. After that it is
   * checked five times a second — cheap, because the whole field shares ONE
   * loop started by the first charge, exactly as the fence does.
   */
  _armCharge(ctx, at) {
    this._mines.push({ at: at.clone(), t: MINE_LIFE, arm: MINE_ARM });
    audio.thud(at, 0.5);
    if (this._mining) return;
    this._mining = true;
    this.sustain(0, 0.2, () => {
      for (let i = this._mines.length - 1; i >= 0; i--) {
        const m = this._mines[i];
        m.t -= 0.2;
        if (m.arm > 0) { m.arm -= 0.2; continue; }
        if (m.t <= 0) { this._mines.splice(i, 1); continue; }
        /* ANYTHING LIVING, and it does not ask whose. A minefield that stepped
         * politely over your own troops would be a free wall; the mark told you
         * where you put it and the charges are visible from the moment they
         * land. */
        const trip = this._near(ctx, m.at, MINE_TRIP)[0]
          || (this.owner && !this.owner.dead
            && this.owner.position.distanceTo(m.at) <= MINE_TRIP ? this.owner : null);
        if (!trip) continue;
        this._mines.splice(i, 1);
        this.blast(ctx, m.at, 6.4, 150, 170,
          { core: 0.4, shake: 0.4, size: 1.5, crater: 1.1, sparkShare: 0.6 });
      }
      if (!this._mines.length) { this._mining = false; return false; }
      this._paintCharges(ctx);
      return true;
    });
  }

  /** A slow amber pulse on every live charge. A hazard the player forgot they
   *  laid is a hazard that kills the player. */
  _paintCharges(ctx) {
    const P = ctx?.particles;
    if (!P) return;
    for (const m of this._mines) {
      _v1.set(m.at.x, m.at.y + 0.12, m.at.z);
      P.sparks.spawn(_v1, _v2.set(0, 0.5, 0),
        { life: 0.4, size: m.arm > 0 ? 0.07 : 0.12, drag: 1.2, gravity: 0,
          color: m.arm > 0 ? 0x60a0ff : 0xffa020, alpha: 0.95 });
    }
  }

  /**
   * TWENTY-SIX BOMBLETS — the cluster canister's payload.
   *
   * Released 0.7 s before the ship is over the mark, because a canister opened
   * at height throws its bomblets FORWARD along the track: the pattern is
   * centred on the mark and the ship is past it by the time the last one lands.
   *
   * `hard: CLUSTER_HARD` on every one of them. See `blast`'s note: this is the
   * anti-infantry answer and it is stated as a property of the weapon, once.
   */
  cluster(ctx, site) {
    const out = [];
    for (let i = 0; i < CLUSTER_N; i++) {
      const a = this.rand() * TAU, r = Math.sqrt(this.rand()) * 13.0;
      const at = site.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      out.push({
        t: -0.7 + (i / CLUSTER_N) * 1.5,
        fn: (from, c) => {
          at.y = this._groundAt(c, at);
          this.blast(c, at, 4.4, 55, 105,
            { core: 0.35, shake: 0.14, size: 0.9, crater: 0.3, hard: CLUSTER_HARD,
              sparkShare: 1 / Math.sqrt(CLUSTER_N) });
        },
      });
    }
    return out;
  }

  /**
   * THE HOLD FIELD — everything inside dragged to the middle of it.
   *
   * `TRACTOR_BEATS` pulls over `TRACTOR_TIME`. Each pull adds a velocity toward
   * the centre proportional to how far out the body is, so the far edge closes
   * faster than the middle and the whole field arrives together rather than the
   * near bodies piling up first. A little lift on every pull, because a body
   * dragged along the ground is a body still standing on it.
   *
   * `gentle` on every one of them, and that is not a detail: `applyKnockback`'s
   * hard path breaks a cast, cries out, and stuns anything past 12 m/s. Sixteen
   * of those over three seconds would be sixteen screams and a permanent stun,
   * which is a different and much stronger call than the one this is priced as.
   *
   * ZERO DAMAGE. The whole worth of it is the number in `tractorReach`.
   */
  tractor(ctx, site, radius) {
    audio.noise({ dur: TRACTOR_TIME, gain: 0.3, type: 'bandpass', freq: 140, q: 2.2,
      attack: 0.3, pos: site });
    const period = TRACTOR_TIME / TRACTOR_BEATS;
    this.sustain(TRACTOR_TIME, period, () => {
      for (const e of this._near(ctx, site, radius)) {
        const d = e.position.distanceTo(site);
        if (d < 1.2) continue;
        /**
         * A SERVO AND NOT AN ACCUMULATOR, and this is the difference between a
         * tractor beam and a catapult.
         *
         * `applyKnockback` ADDS to velocity, and `Enemy._move` does not damp a
         * body while its knock timer is live — which the beam refreshes on
         * every pull by construction. So sixteen pulls of 7 m/s each is a body
         * leaving at 112 m/s: measured, the field closed on the mark at a mean
         * 46 m/s and shot out the far side. What a hold field does is carry
         * things at a speed, so each pull adds only the DIFFERENCE between the
         * body's current closing speed and the one the beam holds, and a body
         * already moving in fast is not pushed at all.
         */
        _v2.subVectors(site, e.position).setY(0).normalize();
        const closing = e.velocity.x * _v2.x + e.velocity.z * _v2.z;
        const want = TRACTOR_PULL * clamp(d / radius, 0.4, 1);
        _v1.copy(_v2).multiplyScalar(Math.max(0, want - closing));
        _v1.y = Math.max(0, TRACTOR_LIFT - e.velocity.y);
        if (_v1.lengthSq() < 1e-4) continue;
        e.applyKnockback(_v1, 0, this.owner, true);
      }
      const P = ctx?.particles;
      if (P) {
        for (let i = 0; i < 10; i++) {
          const a = this.rand() * TAU;
          _v1.set(site.x + Math.cos(a) * radius, site.y + 0.4 + this.rand() * 6,
            site.z + Math.sin(a) * radius);
          _v2.subVectors(site, _v1).setY(3).multiplyScalar(0.5);
          P.plasma?.spawn?.(_v1, _v2, { life: 0.7, size: 0.3, drag: 0.4, gravity: 0,
            color: 0x60ffc0, alpha: 0.7 });
        }
      }
      return true;
    });
  }

  /**
   * EIGHTEEN BURSTS OVER TWENTY-TWO SECONDS — the station's payload.
   *
   * Each beat picks the nearest LIVING HOSTILE to the mark and puts a pair of
   * cannon rounds into it out of the same `BoltPool` every other gun in this
   * game shoots from, then cracks the ground under it with the same `blast`.
   * Nothing here knows how to shoot or how to break ground.
   *
   * IT READS TEAMS, unlike every other payload in this file. `blast`'s note
   * says a gun run "does not know whose side you are on", which is correct for
   * a pass a player aimed; a craft choosing its own targets and choosing the
   * player's own troops would not be a risk, it would be a defect.
   */
  station(ctx, site) {
    const out = [];
    for (let i = 0; i < STATION_BURSTS; i++) {
      out.push({
        t: i * (STATION_TIME / STATION_BURSTS),
        fn: (from, c) => {
          const team = this.owner?.team ?? 0;
          let best = null, bestD = STATION_REACH;
          for (const e of (c?.enemies || [])) {
            if (e.dead || !e.position) continue;
            if (e.team === team) continue;
            const d = e.position.distanceTo(site);
            if (d < bestD) { bestD = d; best = e; }
          }
          if (!best) return;
          const at = best.position.clone();
          at.y = this._groundAt(c, at);
          this._gunPair(c, from.clone(), at);
          this.blast(c, at, 4.5, 70, 130,
            { core: 0.3, shake: 0.18, size: 1.1, crater: 0.5,
              sparkShare: 1 / Math.sqrt(STATION_BURSTS) });
        },
      });
    }
    return out;
  }

  /**
   * SIX OF YOURS ON THE GROUND YOU PAINTED — the beachhead.
   *
   * `Command.reinforce` is the verb and it is not reimplemented: it prices the
   * bodies out of the roster's own point ledger, flies them in on a gunship,
   * welds the trooper records to the bodies and broadcasts the muster. What
   * this adds is WHERE, and the only thing in Command that answers "where" is
   * the commander's own `anchor` — the field that made opposed deployment
   * possible, and whose whole meaning is "the ground this line comes down on".
   *
   * IT IS MOVED FOR EXACTLY ONE SYNCHRONOUS CALL AND PUT STRAIGHT BACK. The
   * `finally` is load-bearing: `reinforce` can refuse (no points left) and can
   * throw, and a commander left permanently anchored to a piece of ground the
   * player marked once would relocate every later deployment in the battle.
   */
  beachhead(ctx, site, n) {
    const cmd = (ctx?.world || this.owner?.world)?.command;
    if (!cmd?.reinforce) { this._say('no line to land'); return 0; }
    const c = cmd.commander;
    const had = c ? c.anchor : undefined;
    let got = 0;
    try {
      if (c) c.anchor = site.clone();
      got = cmd.reinforce(n, { byShip: true }) || 0;
    } finally {
      if (c) c.anchor = had;
    }
    this._say(got ? `${got} on the ground` : 'nobody left to send');
    return got;
  }

  /**
   * EIGHTEEN SECONDS OF SKY — the ion storm.
   *
   * Drawn through `world.lightning`, the real `LightningVfx` ribbon pool, for
   * the reason that file's own header gives at length: forty points out of the
   * shared spark ring is a dotted rule and not a discharge, and it competes
   * with every blade hit on the field for the same slots.
   *
   * WHAT IT PICKS. A living body inside the circle first — a storm that struck
   * empty ground while a walker stood in it would read as scenery — and bare
   * ground when there is nobody, so the thing keeps happening while the enemy
   * is walking into it. `STORM_HZ` is about three strikes a second, which over
   * eighteen seconds is roughly fifty-four discrete events.
   *
   * IT DOES NOT CARE WHAT ANYTHING IS MADE OF and it does not care where the
   * caller is standing. That is the price of the biggest area on the table
   * short of the bombardment.
   */
  ionStorm(ctx, site, radius, seconds) {
    const world = ctx?.world || this.owner?.world;
    audio.noise({ dur: 3.0, gain: 0.34, type: 'lowpass', freq: 300, freqEnd: 80,
      pink: true, attack: 0.6, pos: site });
    let struck = 0;
    const reached = new Set();
    this.sustain(seconds, 1 / STORM_HZ, () => {
      const live = this._near(ctx, site, radius);
      const target = live.length ? live[(this.rand() * live.length) | 0] : null;
      const a = this.rand() * TAU, r = Math.sqrt(this.rand()) * radius;
      _v1.copy(target ? target.position
        : _v3.set(site.x + Math.cos(a) * r, site.y, site.z + Math.sin(a) * r));
      _v1.y = this._groundAt(ctx, _v1) + (target ? 1.0 : 0.1);
      _v2.set(_v1.x + (this.rand() - 0.5) * 8, _v1.y + 60, _v1.z + (this.rand() - 0.5) * 8);
      world?.lightning?.strike?.(_v2, _v1, { power: 1.7, life: 0.20, chaos: 1.1 });
      audio.tone?.({ freq: 90 + this.rand() * 60, freqEnd: 40, dur: 0.35, gain: 0.2,
        type: 'sawtooth' });
      struck++;
      /* THE BOLT IS THE DAMAGE, in a 3 m circle around where it grounded, so a
       * body next to the one that was struck takes it too. Through
       * `applyKnockback` — one door, and it is what answers a Force pool. */
      for (const e of this._near(ctx, _v1, STORM_R)) {
        _v3.subVectors(e.position, _v1).setY(0.6).normalize().multiplyScalar(24);
        e.applyKnockback(_v3, STORM_DAMAGE, this.owner);
        e.stun?.(0.5);
        reached.add(e.id ?? e);
      }
      const p = this.owner;
      if (p && !p.dead && p.position.distanceTo(_v1) <= STORM_R) {
        p.damage?.(STORM_DAMAGE * 0.5, _v1, null, 'explosion');
      }
      if (ctx?.terrain?.burn) ctx.terrain.burn(_v1.x, _v1.z, 2.2, 1);
      return true;
    });
    return { struck, reached };
  }

  /**
   * TWENTY-TWO DETONATIONS ACROSS FORTY-TWO METRES — the bombardment.
   *
   * The pattern is a spiral out from the mark and NOT a random scatter, and
   * that is the counter-play: it starts in the middle and walks outward at a
   * knowable rate, so a body at the rim has most of the nine seconds to be
   * somewhere else and a body in the middle has none. A random pattern over the
   * same disc would kill the same number of things and would be nine seconds of
   * dice.
   *
   * `sparkShare` is `1/sqrt(22)` for the same reason the barrage takes
   * `1/sqrt(12)`: twenty-two of these inside one particle's lifetime would take
   * the whole of three shared rings and erase every blade hit on the field.
   */
  bombardment(ctx, site) {
    const out = [];
    for (let i = 0; i < SIEGE_N; i++) {
      const k = i / (SIEGE_N - 1);
      const a = i * 2.399;
      const r = k * SIEGE_R;
      const at = site.clone().add(new THREE.Vector3(
        Math.cos(a) * r + (this.rand() - 0.5) * 3, 0, Math.sin(a) * r + (this.rand() - 0.5) * 3));
      out.push({
        t: k * SIEGE_TIME,
        fn: (from, c) => {
          at.y = this._groundAt(c, at);
          this.blast(c, at, 13, 190, 240,
            { core: 0.35, shake: 0.8, size: 2.6, crater: 1.7,
              sparkShare: 1 / Math.sqrt(SIEGE_N) });
        },
      });
    }
    return out;
  }

  /** A pod: health for the caller, and the wounded around them back up. */
  resupply(ctx, site, radius) {
    const p = this.owner;
    audio.thud(site, 1.4);
    if (p && !p.dead) p.heal?.(45);
    const cmd = (ctx?.world || this.owner?.world)?.command;
    if (cmd?.reviveNear) cmd.reviveNear(site, radius);
    const P = ctx?.particles;
    if (!P) return;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU;
      _v1.set(Math.cos(a), 0.6, Math.sin(a)).multiplyScalar(3.4);
      P.sparks.spawn(_v2.copy(site).setY(site.y + 0.3), _v1,
        { life: 0.7, size: 0.09, drag: 1.6, gravity: 0.3, color: 0x8fffc0, alpha: 0.9 });
    }
  }
}
