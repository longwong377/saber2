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
  { id: 'sworn', label: 'SWORN', xp: 30, leash: 34, orders: ['heel', 'away', 'ward', 'seek', 'verb', 'hold'] },
];

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
export const COMPANION_UNITS = {};

Object.assign(ARCHETYPES, COMPANION_UNITS);
