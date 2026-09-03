/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — THE TWELVE KINDS
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "the companions all play differently from one another, possible ones are an
 *  R2/Astromech unit, an alien hawk/owl thing that only flys, a cat like alien,
 *  an armored dog beast, something incredibly cute and adorable that is useless
 *  in battle and needs constant protecting but is incredibly cute, a rancor
 *  pup, a reprogrammed battle droid, a medical droid, a large wookie (with
 *  melee and ranged weapons potentially), a Tauntaun you ride/mount … a Blurgg
 *  … and a Varactyl"
 *
 * ── WHAT THIS FILE IS, AND WHAT IT IS DELIBERATELY NOT ────────────────────
 *
 * It is the twelve ROWS. Everything a kind is — how fast it is allowed to be,
 * how far its ward reaches, what an area weapon does to it, which verb it owns
 * and what that verb is called on the wheel, whether you can ride it, how it
 * is represented on the deck, and which colours its own builder will actually
 * read — is a field on a row here.
 *
 * It is NOT a switch on a kind's name. Nothing in `Companions.js`, `HUD.js`,
 * `Kennel.js` or `CompanionDeck.js` may compare `kind === 'massiff'`; they read
 * a field off `COMPANION_KINDS[id]` and act on it. That is the single rule this
 * file exists to make possible, and it is the difference between twelve kinds
 * and twelve reskins. `Enemy.js` already has EIGHT names switched on in
 * `custom`, which is why a companion carries a `companion: true` FLAG on its
 * archetype and never `custom: 'companion'` — a ninth would be the defect the
 * mode table's own note (Waves.js) spends four paragraphs refusing.
 *
 * ── WHY THE ARCHETYPES ARE ASSIGNED FROM HERE ─────────────────────────────
 *
 * `world.spawnEnemy` is the single door every body in the game comes through,
 * and it indexes `ARCHETYPES`. A companion that did not live in that table
 * would need a second spawn door, and a second spawn door is a second place
 * for the LOD ladder, the death path, the corpse budget and the blade's broad
 * phase to be got wrong. So the rows are `Object.assign`ed in, exactly as
 * `COMMAND_UNITS`, `GEONOSIAN_UNITS` and the vehicles already are.
 *
 * THE ORDERING HAZARD IS REAL AND IT IS WRITTEN DOWN RATHER THAN REDISCOVERED.
 * Levels.js:100 records what happens when a module that does
 * `Object.assign(ARCHETYPES, …)` is reachable from `Enemy.js`'s own import
 * graph: the assignment runs inside `ARCHETYPES`' temporal dead zone and boot
 * is a ReferenceError. This file imports Enemy.js and Bodies.js and NOTHING in
 * this file may ever be imported BY either of them. Its one consumer is
 * `Companions.js`, which is reached from `main.js` at deploy.
 *
 * ── AND `roster.mjs` LEARNS A FIFTH DOOR RATHER THAN AN EXEMPTION ─────────
 *
 * `roster: every archetype the game has is an archetype a player can meet`
 * fails on a body that no level pool, set-piece rung or saddle names — and it
 * failed on the massiff the moment that row landed, which is the check working.
 * A companion IS meetable; it is met through the Kennel. So the check reads
 * `COMPANION_KINDS` as a fifth door and asserts the archetype is named there.
 * That is a door, not an exemption: a companion archetype nobody can pick is
 * still content that shipped and cannot be met, and it still goes red.
 */
import { ARCHETYPES } from './Enemy.js';
import { TOUGHNESS } from './Combat.js';
import { buildQuadruped } from './Bodies.js';

/**
 * THE PACE CAP, WHICH IS THE MECHANISM AND NOT A FLAVOUR NOTE.
 *
 * "obviously they're going to be less mobile than you so protecting the
 * companions and keeping them safe is another thing the player can choose to
 * worry about" — the whole protection loop rests on the animal being unable to
 * simply leave a fight with you, and a companion that matches your sprint can
 * always disengage when you do.
 *
 * The player's own paces are measured and stated at Player.js:4557 — walk
 * 1.56, crouch 2.21, ordinary 4.60, sprint 7.45 m/s. 0.85 of the sprint is
 * 6.33 m/s, and NO rung, temper, phase or setting may raise a companion past
 * it. The fastest kind in the set (the tuk'ata whelp) sits exactly on the cap,
 * which is what "the only one fast enough to follow a sprint" means precisely:
 * it keeps up with a sprint you have already started and cannot open ground.
 */
export const PLAYER_SPRINT = 7.45;
export const PACE_CAP = 0.85;

/**
 * THE RUNGS, AND WHAT GROWS IS NOT A MULTIPLIER.
 *
 * COMPANIONS.md states the position in its own words and this table is the
 * enforcement: **the rank rows carry no numeric multiplier field at all** —
 * not a compressed one, not a 1.00 one. The field does not exist, and the
 * check asserts its ABSENCE rather than its value, because a field sitting at
 * 1.00 is an invitation with a comment on it.
 *
 * That is stricter than the law troopers live under and the asymmetry is
 * argued: COMPANY.md defends the RANKS ladder on two grounds — it is averaged
 * across twenty-four bodies, and a fresh muster re-earns the whole thing
 * inside one campaign. Neither half holds here. There is exactly ONE companion
 * and it is with you in modes that have no muster, no roster and no wave
 * budget to tune against.
 *
 * SO WHAT GROWS IS THE LEASH, THE ORDER SET, AND HOW LONG AN ORDER SURVIVES
 * YOU. Nothing it does hits harder.
 *
 * THE LEASH LADDER STARTS AT 14 AND NOT AT 8, AND THAT IS A MEASUREMENT.
 * The design's first draft opened at 8 m. `tools/_companion.mjs` ran a massiff
 * for a minute against four hostiles put down beside the player: at 8 m it held
 * a target on 13.2% of frames, dealt zero damage, and stood still for 508
 * frames while something shot at its owner from inside twenty metres — a dog
 * that starts every charge and finishes none, because the search radius and the
 * recall distance are the same number and 8 m is inside the band a firefight
 * actually occupies. At 14: a target on 68.2% of frames, ZERO frames idle with
 * a hostile in reach, 143 damage and two kills. A rung 0 companion is meant to
 * feel green; it is not meant to be furniture.
 */
export const COMPANION_RANKS = [
  { id: 'strange', label: 'STRANGE', xp: 0, leash: 14, orders: ['heel', 'away'] },
  { id: 'known', label: 'KNOWN', xp: 6, leash: 18, orders: ['heel', 'away', 'ward'] },
  { id: 'trusted', label: 'TRUSTED', xp: 16, leash: 24, orders: ['heel', 'away', 'ward', 'seek', 'verb'] },
  { id: 'sworn', label: 'SWORN', xp: 20, leash: 34, orders: ['heel', 'away', 'ward', 'seek', 'verb', 'hold'] },
];

/**
 * ── WHY THE TOP GATE IS 20 AND NOT THE 30 THE DESIGN WROTE ────────────────
 *
 * COMPANIONS.md set the gates at 0/6/16/30 and said, in the same sentence,
 * that two clauses were to be DRIVEN rather than transcribed: the top rung
 * must be reachable inside one run, and not before 40% of it — the trooper
 * ladder's own pins at `tools/checks/command.mjs:845`. They were driven, and
 * 30 fails the first one. THE MEASUREMENT IS 20.
 *
 * A crossing is 2, 3 or 5 engagements — `rollSession` rolls the length — so
 * "one long campaign" is a Grind at five. Driven on seed 2 (Grind: landing →
 * plain → hailfire → spires → foundry), with an order landing in every area,
 * the animal put down and picked up in every area, and it alive and inside
 * its leash at every boundary — a flawless crossing, not a typical one — the
 * record ended at
 *
 *     area 1  xp 4    STRANGE          area 4  xp 16   TRUSTED
 *     area 2  xp 8    KNOWN            area 5  xp 20   SWORN
 *     area 3  xp 12   KNOWN
 *
 * Four a boundary is the CEILING and not a sample: `crossed` is one per area,
 * `order` is one per area by design ("the FIRST time per area"), `recovered`
 * is two and cannot fire twice for one area either. 5 × 4 = 20, and there is
 * no fifth deed and no sixth area.
 *
 * THE FOURTH DEED PAYS NOTHING A RUN CAN BANK, and that is the whole of the
 * gap between 20 and the 30 the design assumed. `reached` (+2, "it reaches you
 * while you are downed") is real and it fires — but a player has no revivable
 * downed state anywhere in this game. `World._checkWipe` ends the run on the
 * frame the last player falls and `main.gameOver` folds the companion in that
 * same frame with `won` false, so the record the animal is running towards has
 * already been closed and cleared; and the one mode with a genuine down-and-
 * get-up, co-op's `_reviveDowned` on a wave clear, is the one mode
 * `keepCompanion` deliberately does not fold at all. 6 a boundary was the
 * arithmetic that made 30 look like 100% of a crossing; 4 is what a crossing
 * actually pays.
 *
 * SO THE GATE MOVES AND THE DEEDS DO NOT. The deed table is the design stated
 * verbatim and the four weights are not a balance dial; the gate is the number
 * whose only job is to sit correctly against them, and it was sitting against
 * an arithmetic nobody had run. At 20 the top rung is reachable in one long
 * crossing AND ONLY JUST — which is `command.mjs`'s own sentence for the
 * trooper ladder, "climbable in ONE campaign and only just, the top rung is
 * for the body that lived through all of it" — and 20 is 100% of the run
 * rather than the 40% floor's 8. An ordinary crossing — an order landing in
 * every area but the animal only going down and being picked up in two of the
 * five — pays 14, so SWORN is still a second crossing away and Company.js:28's
 * amendment holds: a thing may cross runs when a single run COULD have
 * produced it unaided.
 *
 * WHAT WOULD PUT IT BACK TO 30. Two things, and both are somebody's decision
 * rather than a tuning: a revivable downed state for the player, which would
 * make `reached` bankable and take the ceiling to 30; or a sixth deed. Until
 * one of those exists, `tools/checks/companions.mjs` drives the crossing and
 * fails on the number rather than on this comment.
 */

/**
 * WHICH RUNG A RECORD IS ON, AND WHETHER IT MAY BE GIVEN A DUTY.
 *
 * The exact shape of `holds()` (Command.js:731) — one table, one reader, and
 * nothing anywhere compares a rung index to a magic number. `rungOf` walks the
 * table backwards so a record whose xp was hand-edited past the top of the
 * ladder lands on the top rung rather than off the end of the array.
 */
export function rungOf(rec) {
  const xp = Math.max(0, Number(rec?.xp) || 0);
  for (let i = COMPANION_RANKS.length - 1; i >= 0; i--) {
    if (xp >= COMPANION_RANKS[i].xp) return COMPANION_RANKS[i];
  }
  return COMPANION_RANKS[0];
}

export function holdsCompanion(rec, duty) {
  if (!duty) return false;
  return rungOf(rec).orders.includes(duty);
}

/**
 * THE LOOK VOCABULARY, KEYED PER CHASSIS AND NOT PER KIND.
 *
 * Each row names ONLY the fields that chassis's builder actually reads, and
 * that is the whole point of the table existing at all.
 *
 * IT CANNOT BE THE EXISTING DOOR. `KIT_FIELDS` and `PAINT_FIELDS` have exactly
 * two keys, `flesh` and `steel`, and a creature is neither — `kitOptsFrom`
 * would drop a saved creature colour before it ever reached the builder. Worse,
 * `WEARS` is deliberately PERMISSIVE: a type not in the table gets its kind's
 * whole vocabulary, so a companion routed through it would be offered nine
 * clone-armour rows that store a value, light up and change nothing — the exact
 * dead control that table was written to prevent.
 *
 * AND THIS TABLE LIGHTS CODE THAT HAS SHIPPED FOR MONTHS UNREACHED.
 * `buildQuadruped` accepts `opts.hide`, `opts.plate`, `opts.belly` and
 * `opts.eye` — `hideMat(opts.hide ?? P.hide, 0.92)` and three siblings — and
 * NOTHING in the tree has ever passed it anything but the plan's own defaults.
 * Every creature in the game is wearing its factory colours because there is no
 * door. The companion is the door.
 *
 * IDS ARE STORED, NEVER COLOURS, so a re-tuned palette reaches the companions
 * already wearing it. `PAINTS`, `paintById`, `markById` and `cleanCallsign` are
 * reused verbatim — one palette and one name-cleaner in the tree.
 *
 * REGION PAINTING IS DELIBERATELY NOT ATTEMPTED. `regionDist` (Command.js:1192)
 * measures against a HUMANOID frame — size, limb length, side — and
 * `paintKindOf` routes to two tables plus a fallback, so a hawk, a cat, a pup
 * and a tauntaun would all land on the fallback and paint in the wrong places
 * on all four. Flat paint through the four already-written override slots is
 * honest and is what ships.
 */
export const COMPANION_LOOK = {
  creature: ['hide', 'plate', 'belly', 'eye'],
  droid: ['shell', 'trim', 'photoreceptor', 'panels'],
  wookiee: ['pelt', 'braid'],
  mount: ['hide', 'blanket'],
};

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE TWELVE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * FIELDS, and every one of them is read somewhere rather than described here:
 *
 *   id        the Kennel record's `kind`, the settings value, the wheel's key
 *   label     what the player sees, once, in every room
 *   archetype the ARCHETYPES key `spawnEnemy` is handed. Usually `id`; the
 *             reprogrammed B1 borrows a shipped body and says so.
 *   pace      a FRACTION of the player's sprint, clamped to PACE_CAP on the
 *             way out by `paceOf` so a hand-edited row cannot outrun you.
 *   ward      the radius of the WARD order, in metres, for THIS kind. 0 means
 *             the kind cannot ward at all, which is a statement about the
 *             astromech and not a missing number.
 *   heel      how loosely it holds its station, as a multiple of HEEL.slack.
 *   frag      a multiplier on incoming AREA damage only — grenade, quake,
 *             blast, fall — and never on aimed fire. A tooka dies to a thermal
 *             you did not see; it does not die to the bolt you were supposed to
 *             have blocked. Every death stays explicable.
 *   verb      the kind's own order: { id, label, caption }. ONE slot, twelve
 *             meanings, resolved off the row and never off a switch.
 *   mount     can be ridden, through `Driving.Crew` and never `Riders.js`.
 *   deck      how it is represented in the hangar: 'knockable' (a DeckCast
 *             prop, nearly free), 'row' (a Hangar humanoid row) or 'walker'
 *             (a stance-driven gait stepper).
 *   look      which COMPANION_LOOK row its builder will actually read.
 *   blurb     one sentence, the player's, for the card.
 */
const KINDS = [
  {
    id: 'massiff', label: 'Massiff', archetype: 'massiff',
    pace: 0.70, ward: 9, heel: 1.0, frag: 1.0, mount: false, deck: 'walker', look: 'creature',
    verb: { id: 'block', label: 'BLOCK', caption: 'Stand between me and the nearest of them' },
    blurb: 'An armoured dog beast. It does not kill things so much as occupy them, '
      + 'and the better it does that the faster you lose it.',
  },
  {
    id: 'tooka', label: 'Tooka kit', archetype: 'tooka',
    /* ZERO WARD AND ZERO VERBS THAT FIGHT. Its one order does the opposite of
     * fighting: CRY pulls everything onto ITSELF. */
    pace: 0.52, ward: 0, heel: 0.7, frag: 2.4, mount: false, deck: 'walker', look: 'creature',
    verb: { id: 'cry', label: 'CRY', caption: 'Make every one of them look at you' },
    blurb: 'Useless, and that is the entire point. You can pick it up, which spends '
      + 'a hand; its one use is being bait it will probably not survive.',
  },
  {
    id: 'tuk', label: "Tuk'ata whelp", archetype: 'tuk',
    /* ON THE CAP EXACTLY. See PACE_CAP: this is the one kind that can follow a
     * sprint you have already started, and it still cannot open ground on you. */
    pace: PACE_CAP, ward: 12, heel: 1.4, frag: 1.8, mount: false, deck: 'walker', look: 'creature',
    verb: { id: 'flush', label: 'FLUSH', caption: 'Knock that one flat for me' },
    blurb: 'The one that outruns you into trouble. Point it at a B2 and you have '
      + 'thrown it away, which is how it teaches the order system.',
  },
  {
    id: 'b1c', label: 'Reprogrammed B1', archetype: 'b1c',
    /* THE ONLY ONE WITH A RIFLE, so the only one on the trooper firing path —
     * `_shoot`, the cover hunt and the `preferred` band all apply and it never
     * reaches `_beastBrain` at all. */
    pace: 0.58, ward: 14, heel: 1.1, frag: 1.2, mount: false, deck: 'knockable', look: 'droid',
    verb: { id: 'relay', label: 'RELAY', caption: 'Carry that order to those men' },
    blurb: 'A bad gun with a running commentary. It dies to two bolts and it will '
      + 'stand in the open, because that is what a B1 does.',
  },
  {
    id: 'pup', label: 'Rancor pup', archetype: 'pup',
    pace: 0.46, ward: 8, heel: 0.9, frag: 0.7, mount: false, deck: 'walker', look: 'creature',
    verb: { id: 'wreck', label: 'WRECK', caption: 'Put that cover through the floor' },
    blurb: 'The only companion whose attacks change the LEVEL rather than the enemy. '
      + 'It gets visibly bigger across its life and hits not one point harder.',
  },
  {
    id: 'wook', label: 'Wookiee', archetype: 'wook',
    pace: 0.64, ward: 15, heel: 1.2, frag: 0.8, mount: false, deck: 'row', look: 'wookiee',
    verb: { id: 'breach', label: 'BREACH', caption: 'Take that cover apart' },
    blurb: 'A partner rather than a pet — the only one with both bands, and the only '
      + 'one big enough to block a doorway you are standing in.',
  },
  {
    id: 'hawk', label: "Vhal'kir hawk", archetype: 'hawk',
    /* IT NEVER LANDS, so it is the only companion a blade cannot reach and the
     * only one that never gets stuck on terrain — and every ranged body on the
     * field has line of sight to a thing in the air. */
    pace: 0.80, ward: 18, heel: 1.6, frag: 1.5, mount: false, deck: 'walker', look: 'creature',
    verb: { id: 'spot', label: 'SPOT', caption: 'Climb, and show me all of them' },
    blurb: 'It never lands. Its whole contribution is sight, and you trade exposure '
      + 'for it: excellent in the open, suicidal in a crossfire.',
  },
  {
    id: 'astro', label: 'Astromech', archetype: 'astro',
    /* WARD 0 IS A STATEMENT. It cannot fight at all, so a standing order to
     * meet what comes near you would be an order to die on a schedule. */
    pace: 0.40, ward: 0, heel: 0.8, frag: 1.0, mount: false, deck: 'knockable', look: 'droid',
    verb: { id: 'slice', label: 'SLICE', caption: 'Turn that door / turret / console' },
    blurb: 'The slowest thing you own, and it gets stuck on terrain you vault. Its '
      + 'death costs you a capability rather than a body.',
  },
  {
    id: 'medic', label: '2-1B medical droid', archetype: 'medic',
    pace: 0.42, ward: 0, heel: 0.9, frag: 1.1, mount: false, deck: 'row', look: 'droid',
    verb: { id: 'tend', label: 'TEND', caption: 'Work that man before he goes' },
    blurb: 'The most valuable companion in Command and worthless in a duel. It walks '
      + 'toward the wounded, which is by definition where the shooting just was.',
  },
  {
    id: 'taun', label: 'Tauntaun', archetype: 'taun',
    pace: 0.82, ward: 0, heel: 1.3, frag: 1.0, mount: true, deck: 'walker', look: 'mount',
    verb: { id: 'bolt', label: 'BOLT', caption: 'Run, and take their eyes with you' },
    blurb: 'Pace on flat ground and nothing else. It panics, and above a threshold it '
      + 'bucks you off and bolts.',
  },
  {
    id: 'blurrg', label: 'Blurrg', archetype: 'blurrg',
    pace: 0.68, ward: 7, heel: 1.2, frag: 0.9, mount: true, deck: 'walker', look: 'mount',
    verb: { id: 'charge', label: 'CHARGE', caption: 'Bite what closes on us' },
    blurb: 'The mount that is also a weapon — and the mount that turns badly. Superb '
      + 'across open ground, useless in a trench.',
  },
  {
    id: 'varac', label: 'Varactyl', archetype: 'varac',
    /* NOT SPEED — ACCESS, which is the reason three mounts exist rather than
     * one: it takes a grade the player's own character controller refuses. */
    pace: 0.58, ward: 0, heel: 1.3, frag: 0.9, mount: true, deck: 'walker', look: 'mount',
    verb: { id: 'climb', label: 'CLIMB', caption: 'Take us up that' },
    blurb: 'It does not make the map faster, it makes the map a different shape.',
  },
];

/** Keyed, so nothing anywhere has to search the array to answer a question. */
export const COMPANION_KINDS = Object.freeze(
  KINDS.reduce((o, k) => { o[k.id] = Object.freeze(k); return o; }, {}),
);

/** The order the picker offers them in — declaration order, deliberately. */
export const COMPANION_ORDER = Object.freeze(KINDS.map((k) => k.id));

/**
 * A KIND'S PACE IN METRES PER SECOND, CLAMPED ON THE WAY OUT.
 *
 * The cap is applied HERE and not at the declaration, so a row edited by hand
 * — or by a future contributor who read `pace` as "a speed" — still cannot
 * produce a companion that outruns the player. One reader, one clamp, and the
 * check pins the cap rather than the rows.
 */
export function paceOf(kind) {
  const K = COMPANION_KINDS[kind];
  const f = Math.max(0.1, Math.min(PACE_CAP, Number(K?.pace) || 0.5));
  return PLAYER_SPRINT * f;
}

/** Does this kind own this duty at all? Separate from whether the RUNG allows it. */
export function kindHasDuty(kind, duty) {
  const K = COMPANION_KINDS[kind];
  if (!K) return false;
  if (duty === 'ward') return K.ward > 0;
  if (duty === 'verb') return !!K.verb;
  return true;
}

/**
 * THE ARCHETYPE ROWS.
 *
 * Filled in beside the bodies they name — see `CREATURE_PLANS` in Bodies.js.
 * Assigned rather than declared inline for the temporal-dead-zone reason at the
 * top of this file, and carrying `companion: true, score: 0, threat: 0,
 * unlockAt: 99` on every row so that NO wave can ever compose one: a wave that
 * could spend a companion archetype would put your own animal on the other side
 * of the field, which is the faction defect `factions.mjs` exists to stop.
 */
export const COMPANION_UNITS = {

  /**
   * THE TOOKA KIT — the second companion, and the one that is worth nothing.
   *
   * The massiff's row says a companion archetype is "the only archetype in
   * the game that a wave may never spend" and explains `companion: true`,
   * `score: 0`, `threat: 0` and `unlockAt: 99` once; this row carries the
   * same four for the same reasons and does not restate them. What is worth
   * writing down is the two places this animal is not a small massiff.
   *
   * SCALE 0.34 — the smallest number in the file by a factor of three, under
   * the massiff's 0.95, the training remote's 1.0 and the B1's 1.02. It puts
   * the back at 0.235 m and the crown near 0.30 m: below the knee of every
   * other body on the field, which is why a stray shot that was aimed at a
   * man goes over it and a grenade that was aimed at nobody kills it. That
   * asymmetry is COMPANIONS.md's `frag` rule made out of geometry before any
   * multiplier is applied — it dies to the thermal you did not see, not to
   * the bolt you were supposed to have blocked.
   *
   * 24 hp, AND THE HONEST VERSION OF "LOWEST IN THE GAME". It is the lowest
   * on anything that fights: under the B1's 28, an eighth of the massiff's
   * 210. Two lower numbers exist and neither is a body — the dojo's training
   * remote at 4 and the unpainted foundry shell at 6. A single B1 burst is
   * 3 x 9 = 27, so the first shooter that gets a line on this animal kills it
   * inside one trigger pull, with no phase to watch and no window to react
   * in. That IS the design: the fight does not give you time to notice, so
   * the only defence is the one you arranged beforehand — you picked it up.
   *
   * 3 kg, and it is load-bearing rather than flavour. The reek's row explains
   * that `force.mjs` holds the grip cap above the heaviest body in the table;
   * this is the other end of the same rule and the reason the carry mechanic
   * costs nothing to add. At 3 kg the existing Force grip lifts a tooka at
   * the bottom of its own range — the lightest mass in ARCHETYPES, level with
   * the training remote — so "you can pick it up" needs no new cost row and
   * no POWERS entry. The one thing carrying it spends is your off-hand.
   *
   * 4.6 m/s IS THE PLAYER'S WALK, exactly, and that is the number chosen
   * rather than a fraction of anything. COMPANIONS.md caps a companion at
   * 0.85 of your sprint; the massiff sits at 5.2 and is already left behind
   * by every good decision you make. This one is slower still and it is
   * slower at a legible speed: walk and it is at your heel, sprint and it is
   * gone. Caveat, stated rather than hidden — `_beastBrain` raises `speed` by
   * 22% per phase, so at phase 3 this reads 6.6 and briefly beats the cap. At
   * 24 hp phase 3 lasts about as long as the burst that caused it, and the
   * alternative was a special case in the brain for one archetype.
   *
   * `melee: true` WITH `damage: 0`, and the pair is not a contradiction.
   * `melee` is not "this thing attacks" — it is the routing flag: `_meleeBrain`
   * is the only door to `_beastBrain`, and a creature with `melee: false`
   * goes to `_rangedBrain` and looks for a weapon it does not have. So the
   * flag says "brain: beast" and the empty move set in CREATURE_PLANS says
   * "verbs: none". `damage: 0` is the belt to that braces: nothing reads it
   * while the move list is empty, and if anything ever does, the number it
   * finds is zero.
   *
   * `preferred: [0.8, 1.6]` is the tightest band in the game — the massiff's
   * 1.4-2.6 is jaws and has to arrive to matter. This has nothing to arrive
   * with, so the band is not a fighting distance at all; it is how close the
   * animal wants to be to you, which is as close as the collision allows.
   */
  tooka: {
    label: 'Tooka Kit', build: (o) => buildQuadruped({ ...o, kind: 'tooka' }),
    scale: 0.34, hp: 24, mass: 3,
    speed: 4.6, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 0, preferred: [0.8, 1.6], score: 0, threat: 0,
    companion: true, unlockAt: 99,
  },

  /**
   * THE TUK'ATA WHELP — the one that outruns you into trouble.
   *
   * `speed: 6.3` IS THE ARCHETYPE. The companion pace rule caps a kind at 0.85
   * of the player's own sprint, and the player's sprint is 7.45 m/s — measured
   * off a real Player by `tools/checks/dodgeable.mjs` and quoted in the
   * BEAST_MOVES header — so 6.33 is the ceiling and this sits one hundredth
   * under it. Nothing else in the set is near it: the massiff trots at 5.2 and
   * is left behind by every good decision you make with your own body, and
   * that is the massiff's design. This one arrives with you, which means it
   * also arrives at things you were not going to fight. The Nexu's 8.6 is the
   * other side of the same line — a creature that genuinely outruns the player
   * is an enemy, and no companion may be one.
   *
   * 90 hp is the second number and it pays for the first. The massiff's 210 is
   * already argued as "it dies if you leave it"; this is under half of that,
   * so a whelp that follows a sprint into a firefight is a whelp you lose. It
   * is NOT the floor — the tooka kit is designed to hold the lowest pool in
   * the game — and leaving room under it is the difference between a fragile
   * animal and a special case.
   *
   * `damage: 14` against the massiff's 22 and the Nexu's 26, and the rake
   * carries 0.62 of it: about nine points a swipe. It is not a weapon. The
   * pounce knocking a body flat is what you sent it for and the blade is still
   * yours. `preferred: [1.2, 2.4]` is inside the massiff's [1.4, 2.6] because
   * a claw at 0.85 scale reaches less far than jaws at 0.95 do.
   *
   * `moves` is deliberately absent: src/game/Bodies.js declares pounce and
   * rake on the plan and argues for them there, and a copy here would be the
   * twin HANDOFF §2.3 is about — the same reason the reek carries none.
   */
  tuk: {
    label: "Tuk'ata Whelp", build: (o) => buildQuadruped({ ...o, kind: 'tuk' }),
    /* 0.85 against the massiff's 0.95, and the plan's hip of 0.62 still stands
     * it 0.53 m — taller than the massiff at 0.42 on a smaller body, which is
     * where the pace is read from. Well under the player's eye line, which the
     * massiff's row states as the companion rule. */
    scale: 0.85, hp: 90, mass: 45,
    speed: 6.3, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 14, preferred: [1.2, 2.4], score: 0, threat: 0,
    /* NEVER COMPOSED INTO A WAVE — see the massiff's note; the flag is the
     * whole mechanism and nothing tests for the string 'tuk'. */
    companion: true, unlockAt: 99,
  },

  /**
   * THE RANCOR PUP — the second companion, and the one where the growth
   * question gets answered in the open.
   *
   * `scale` is the field the kind is about. COMPANIONS.md puts the pup's
   * scale on `runs`, and hp and damage do not move a point when it does — the
   * body gets visibly bigger and hits nothing harder. 0.55 is where that
   * starts, not where it stays, so it is the one number here a reader should
   * expect to see written over at runtime. At 0.55 the plan stands it 0.43 m
   * at the hip and near a metre at the crown: the massiff's height to within
   * a centimetre, for the massiff's reason.
   *
   * 240 hp against the massiff's 210, and the 30 is bought by geometry rather
   * than by wanting it to live. `slam` aims at ITSELF — see BEAST_MOVES —
   * so this is the only companion whose own attack is a reason to be standing
   * inside a fight rather than at the edge of one. It still dies if you leave
   * it, which is the half of the brief that has to survive.
   *
   * 150 kg on a body shorter than the massiff's 110 kg is the whole read: a
   * block, not a dog. Nowhere near the lift cap the big rows argue about.
   *
   * 3.6 m/s is a walk. The massiff's 5.2 is a trot and already below your
   * sprint; this is barely above the Rancor's own 3.4, so the pup is the one
   * companion that is always behind you and never catching up. That is the
   * cost of the verb.
   *
   * 12 damage is a little over half the massiff's 22 and the lowest melee
   * number on any body in the table. Deliberate, and stated in COMPANIONS.md:
   * the value is the terrain and the lift. A wrecker that also killed things
   * would make the crate it shattered beside the point.
   *
   * `preferred` [1.0, 2.2] against the massiff's [1.4, 2.6], because the slam
   * is a radius and not a swing: 2.05 of scale is 1.13 m here, so the band
   * has to sit inside its own blast or the move never resolves. Jaws have to
   * arrive; this has to be already there.
   */
  pup: {
    label: 'Rancor Pup', build: (o) => buildQuadruped({ ...o, kind: 'pup' }),
    scale: 0.55, hp: 240, mass: 150,
    speed: 3.6, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 12, preferred: [1.0, 2.2], score: 0, threat: 0,
    /* Never composed into a wave, for the reason stated on the massiff. */
    companion: true, unlockAt: 99,
  },

  /**
   * THE TAUNTAUN — the first mount in the companion set, and the first
   * archetype in the game that is rideable without being `big`.
   *
   * `mount: true` is the flag, for the reason `companion: true` is one on the
   * massiff above: the seat, the deck row and the licence ladder all filter on
   * it and nothing anywhere tests for the string 'taun'. It is inert on its
   * own — `_measurePlatform` gates on `A.big` today, and COMPANIONS.md argues
   * that line and its price rather than this row.
   *
   * AND `big` IS ABSENT ON PURPOSE, which is the one thing a reader will want
   * to add. `A.big` is four unrelated decisions wearing one name: the movement
   * proxy, `heavyLimit` in Waves, `armourClass` and STRATAGEM_ONLY. A
   * tauntaun wants none of them — it is not a heavy, it is not armoured, and
   * it can never be composed into a wave at all (see the massiff's note on
   * `companion`).
   *
   * The numbers are a fast, fragile animal that is not a weapon:
   *
   *   speed 6.1  = PLAYER_SPRINT × the kind row's `pace` of 0.82, the same
   *                arithmetic that makes the massiff's 0.70 into 5.2. Fastest
   *                companion in the set bar the tuk'ata, which is on the cap.
   *                Unridden it still cannot open ground on you; the point of
   *                it is what it does with you on top.
   *   hp 340     = above the massiff's 210 because it is three times the mass
   *                and because it comes apart underneath you, and nowhere near
   *                a reek's 1250 because it is not meant to survive contact.
   *                COMPANIONS.md's answer to being shot at is that it PANICS
   *                first, which is a behaviour and not a health bar.
   *   mass 420   = the nexu's, on a comparably sized body, and a long way
   *                under the 1760 kg lift cap the reek's note explains.
   */
  taun: {
    label: 'Tauntaun', build: (o) => buildQuadruped({ ...o, kind: 'taun' }),
    scale: 1.45, hp: 340, mass: 420,
    speed: 6.1, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    /* damage 0 AND NO `moves`. The verb list is declared once, on the plan row
     * in src/game/Bodies.js, and it is empty; `beastMoveSet` prefers an
     * archetype's list, so declaring one here — even a copy — would be the
     * twin the brute's note warns about, and declaring a non-empty one would
     * silently arm the mount. 0 is here so that a verb added later cannot
     * inherit a damage number nobody chose.
     *
     * `preferred` [6.0, 12.0] is the widest band in the game against the
     * massiff's [1.4, 2.6] — "it has to arrive to matter" is exactly what is
     * not true of this one. It is set outside the reach of every weapon on
     * the field, so the only thing it can do at the distance it holds is
     * exist, which is the whole of its contribution unridden. */
    damage: 0, preferred: [6.0, 12.0], score: 0, threat: 0,
    mount: true, companion: true, unlockAt: 99,
  },

  /**
   * THE BLURRG — the mount that is also a weapon, and the only one of the
   * three that can hurt anything.
   *
   * `mount: true` IS THE WHOLE NEW WORD ON THIS ROW, and it is not `big`.
   * `big` is what gives a body a measured deck today, and it also picks the
   * movement proxy, counts against Waves' heavy limit and forces an armour
   * class — none of which belongs on an animal a player owns. So the flag is
   * its own, exactly as `companion: true` is its own rather than a name test,
   * and `Enemy._measurePlatform`'s gate is the single line that has to read it.
   *
   * NO `saddle`. The reek and the rancor carry crew through Riders.js and are
   * priced with `saddleThreat`; this one is ridden by the PLAYER through
   * Driving, so there is no passenger to pay for and `threat` is 0 beside
   * `score` 0 for the reason the massiff's row already gives.
   *
   * 5.1 m/s is not chosen here — it is `paceOf('blurrg')`, which is 0.68 of
   * the player's sprint off the kind row in CompanionKinds.js, and the massiff
   * row sets the precedent of writing the same answer in both places. It is
   * below the tauntaun's 0.82 by design: this is the slow mount, and what it
   * buys with the difference is teeth.
   *
   * 340 hp against the massiff's 210 and the wampa's 560. Above the massiff
   * because a mount that dies under you takes the dismount decision away from
   * you, and well below the wampa because if it reached that the safest place
   * in a firefight would be on its back — which would make riding an answer to
   * combat rather than a trade against it.
   *
   * 20 damage is UNDER the massiff's 22, and that is the one number here a
   * reader will want to raise. The massiff's 22 is a dedicated fighting
   * animal's number, spent by a companion that has to arrive and survive to
   * use it. This bite is taken from a body you are already standing on, at no
   * risk to the thing biting and with no ground given by you. A free hit is
   * priced as one. `preferred` at [1.6, 3.0] is the massiff's jaws band
   * ([1.4, 2.6]) carried out by the extra scale — still jaws, still has to
   * arrive, and short of the nexu's [1.8, 3.4] because this animal has no
   * reach at all.
   *
   * 640 kg: the nexu is 420 at the identical scale and is a lean cat, and this
   * is that scale with two thirds again the barrel and the heaviest legs in
   * the table. It is nowhere near the 1760 kg force-grip ceiling the reek's
   * row explains, which matters more here than there — a mount you cannot pull
   * over is a mount an enemy Force user cannot answer.
   */
  blurrg: {
    label: 'Blurrg', build: (o) => buildQuadruped({ ...o, kind: 'blurrg' }),
    scale: 1.7, hp: 340, mass: 640,
    speed: 5.1, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 20, preferred: [1.6, 3.0], score: 0, threat: 0,
    /* Never composed into a wave, for the reason the massiff's row states. */
    companion: true, mount: true, unlockAt: 99,
  },
};

Object.assign(ARCHETYPES, COMPANION_UNITS);
