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
import { buildQuadruped, buildB1, buildAstromech, buildMedic, buildWookiee } from './Bodies.js';
/* The bolt palette, so the reprogrammed B1's shot is the same red every other
 * E-5 in the game fires — one table, and a companion that fired a colour
 * nothing else fires would read as a different weapon. */
import { BOLT_COLORS } from './Bolts.js';
/* THE FLIGHT PLAN'S OWN NUMBERS, read rather than copied — the hawk's `float`
 * and its two engagement bands are `FLIGHT`'s and belong to the file that owns
 * the cruise/stoop cycle. Flight.js imports Enemy.js and Bodies.js and nothing
 * imports this file back, so the cycle the header warns about is not opened. */
import { FLIGHT } from './Flight.js';

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
 * THE RUNGS, AND WHAT A RUNG BUYS.
 *
 * ── THE POSITION THIS TABLE HELD UNTIL NOW, AND WHY IT WAS WRONG ──────────
 *
 * For four rounds this table carried NO numeric field at all, and its own
 * check asserted the ABSENCE — "not one multiplier field" — on the argument
 * that COMPANY.md's defence of the trooper ladder does not transfer: RANKS is
 * averaged across twenty-four bodies and a fresh muster re-earns it inside one
 * campaign, and a companion is one body carried between modes that have no
 * muster.
 *
 * THE ARGUMENT WAS REAL AND IT WAS SETTLED AGAINST THE WRONG SENTENCE. The
 * specification is the player's:
 *
 *   "the companion will get stronger over time just like you do imagine this
 *    almost like a mini-player like it's going to be a really good dynamic
 *    thing"
 *
 * "just like you do" is the clause the absence contradicted. A ladder that
 * buys only rope and vocabulary is a licence ladder, and a licence ladder is
 * the RIGHT SECOND HALF of this design — but it was standing in for the first
 * half rather than beside it. A SWORN massiff had the same 210 hp and the same
 * 26-point bite as one adopted a minute earlier, and no amount of leash makes
 * a player say the animal got stronger.
 *
 * ── AND BOTH HALVES OF THE OLD ARGUMENT CUT THE OTHER WAY WHEN DRIVEN ─────
 *
 * "TWENTY-FOUR BODIES AVERAGE OUT AND ONE DOES NOT." True, and it is a reason
 * the companion's spread should be SMALLER, not a reason it should be zero. A
 * trooper multiplier is spent twenty-four times a wave; a companion's is spent
 * once, by one body that is at most one in forty on the field. The blast
 * radius of this ladder is bounded by that body's share of the fight, which is
 * the smallest share any ladder in this repository has.
 *
 * "A FRESH MUSTER RE-EARNS THE WHOLE THING INSIDE ONE CAMPAIGN." This ladder
 * does that BETTER than RANKS does, and the check below the table is the proof
 * — SWORN is 20 xp and one flawless crossing pays exactly 20, so the top rung
 * is re-earnable inside a single run by an animal that has never been out
 * before. That is Company.js:28's amendment satisfied exactly: a thing may
 * cross runs when a single run could have produced it unaided. Persistence is
 * a shortcut to a ceiling and never a new ceiling.
 *
 * ── THE CURVE, AND WHY THIS SPREAD ───────────────────────────────────────
 *
 * `enlistBody` (Command.js:4673) reads `RANKS[i].hp/dmg/speed` off the record
 * and multiplies the archetype; this table is the same three fields read the
 * same way at `adopt`, so there is one shape in the repository and not two.
 *
 *   RANKS      5 rungs   hp 1.00 → 1.20   dmg 1.00 → 1.12   speed 1.00 → 1.04
 *   this       4 rungs   hp 1.00 → 1.15   dmg 1.00 → 1.09   speed 1.00 → 1.03
 *
 * STRICTLY UNDER THE TROOPER LADDER ON ALL THREE AXES, and the check pins that
 * relation against the imported RANKS rather than against three typed numbers,
 * so the day somebody compresses RANKS this table is compressed with it. Even
 * spacing, because there is nothing to bend the curve towards: the leash and
 * the order set already do the shaping, and a numeric ladder that also
 * accelerated would be two claims on one rung.
 *
 * WHAT 1.15 / 1.09 IS WORTH, DRIVEN rather than reasoned (`companions.mjs`,
 * "a SWORN animal out-fights a STRANGE one"): on a live massiff in a live
 * world, SWORN bills 1.09x the damage into an immortal hostile over the same
 * thirty seconds and takes 1.15x the aimed fire before it falls — 15 bolts of
 * 20 against 13. That is a companion you can feel got better and is nowhere
 * near a companion that solves a fight; a rung 3 massiff still loses to two
 * B2s and still dies if you leave it.
 *
 * ── AND THE PACE CAP IS UNTOUCHED, BY CONSTRUCTION AND NOT BY CARE ────────
 *
 * `speed` here is a multiplier on the ARCHETYPE and `adopt` applies it BEFORE
 * `paceOf`'s clamp, so the cap is the last word: the tuk'ata already sits on
 * 0.85 of your sprint and rung 3 moves it not one hundredth. "Obviously they
 * are going to be less mobile than you" holds at the top rung for every kind,
 * and `companions: it is slower than you` measures it there — that check
 * fields every kind at xp 99, which is what makes it the pin for this clause
 * rather than a restatement of it.
 *
 * ── WHAT IS STILL REFUSED, AND WHY THE LIST IS SHORTER BY EXACTLY ONE ─────
 *
 * armour, toughness, frag, ward, panic, scale and every other field a row
 * could grow: the check still asserts the ABSENCE of those, and it always
 * will. Three axes is what `enlistBody` reads and three is what this reads. A
 * fourth would be a ladder nobody has argued for.
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
  { id: 'strange', label: 'STRANGE', xp: 0, leash: 14, hp: 1.00, dmg: 1.00, speed: 1.00,
    orders: ['heel', 'away'] },
  { id: 'known', label: 'KNOWN', xp: 6, leash: 18, hp: 1.05, dmg: 1.03, speed: 1.01,
    orders: ['heel', 'away', 'ward'] },
  { id: 'trusted', label: 'TRUSTED', xp: 16, leash: 24, hp: 1.10, dmg: 1.06, speed: 1.02,
    orders: ['heel', 'away', 'ward', 'seek', 'verb'] },
  { id: 'sworn', label: 'SWORN', xp: 20, leash: 34, hp: 1.15, dmg: 1.09, speed: 1.03,
    orders: ['heel', 'away', 'ward', 'seek', 'verb', 'hold'] },
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
 *
 * AND THE ARITHMETIC ABOVE IS THE CAMPAIGN'S, WHICH IS THREE MODES OF ELEVEN.
 * The other eight have no area to cross and were paying at most one xp for a
 * whole run — six runs to WARD and sixteen to SEEK, in the modes most people
 * play. The boundary a deed is paid at is now the mode's own: an AREA where
 * there is a crossing, a cleared WAVE everywhere else. The argument, the
 * ledger it reads and the measured before-and-after are on `boundariesTaken`
 * in Companions.js, beside the code that does it. Nothing on this table moved
 * for it, which is the point — the gates are what they were measured to be.
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
 *             A kind that declares it must also declare `crew` on its
 *             archetype — that is the field `Driving` actually gates on, and
 *             the two are bound to each other by a check in both directions.
 *   panic     how much fear this kind will carry BEFORE IT THROWS YOU, in
 *             hostile-seconds (see `PANIC` in Companions.js). Absent on eleven
 *             of the twelve, and absent is the statement: only the tauntaun's
 *             card claims it, and only the tauntaun does it.
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
    /* THE CARD'S CLAIM IS ABOUT `scale`, AND IT SURVIVED THE RUNG LADDER
     * GETTING NUMBERS — because `scale` is not on that ladder. The rung buys
     * hp, dmg and speed and the same three for every kind; the pup's SIZE
     * reads off `runs` and buys nothing at all, which is the whole point of
     * putting the growth question on the one kind where a player would most
     * expect the trap to have been taken. The sentence says size rather than
     * damage so that it stays true either way round. */
    blurb: 'The only companion whose attacks change the LEVEL rather than the enemy. '
      + 'It gets visibly bigger across its life, and the size buys nothing.',
  },
  {
    id: 'wook', label: 'Wookiee', archetype: 'wook',
    pace: 0.64, ward: 15, heel: 1.2, frag: 0.8, mount: false, deck: 'row', look: 'wookiee',
    verb: { id: 'breach', label: 'BREACH', caption: 'Take that cover apart' },
    /**
     * THE CARD SAID "THE ONLY ONE WITH BOTH BANDS" OVER A ROW WITH ONE, AND
     * THE CARD IS WHERE THE PLAYER CHOOSES.
     *
     * COMPANIONS.md gives this kind a bowcaster at distance and a topple in
     * reach, the brief asks for "a large wookie (with melee and ranged weapons
     * potentially)", and this sentence was rendered straight into the picker
     * over `COMPANION_UNITS.wook`, which declares `melee: true` and no
     * `ranged` and no `weapon`. A player who picked this kind for its gun got
     * a body that has never fired one. That is the worst place in the feature
     * for a false sentence: every other lie costs a surprise, this one costs
     * the pick.
     *
     * SO THE SENTENCE IS NOW THE ROW, AND `companions: a card's band claim is
     * the row's band` binds the two in BOTH directions — a blurb that claims a
     * band over a row without one goes red, and a row that grows `ranged` or
     * `weapon` under a card that does not claim it goes red too. The day the
     * second band is real this sentence has to change in the same commit,
     * which is the whole reason the check reads the prose.
     *
     * ── AND THE SECOND BAND IS NOT A FIELD, IT IS A BEHAVIOUR ────────────
     *
     * THE GUN IS BUILT. `buildBlaster('bowcaster')` and `BLASTER_LENGTH`'s
     * 0.95 m landed while this was being written, and `rifle-hold.mjs` holds
     * it to the same stock/muzzle/hold-point reference as every other kind. So
     * the honest reason this row still carries no `weapon` is not the geometry
     * and is not a missing lane; it is that a gun in a hand is not a band, and
     * that was DRIVEN rather than reasoned about.
     *
     * ONE: THE BRAIN ONLY EVER PICKS ONE. `Enemy._brain` ends `if (A.melee)
     * this._meleeBrain(…); else this._rangedBrain(…)`, and `_meleeBrain` with
     * no saber falls straight into `_beastBrain`, which has no firing path at
     * all. Driven over the whole table with the companion rows loaded: **0 of
     * the 49 archetypes in this game carry a `weapon` without `ranged`**, and
     * none carries `melee` and `ranged` together. `weapon: 'bowcaster'` here
     * on its own is HANDOFF §2.3b in the most visible medium the game has — a
     * gun the player can SEE and the brain never pulls — and the check refuses
     * it in as many words.
     *
     * TWO, AND IT IS THE ONE THAT SETTLES IT: THE ANIMAL WOULD NOT USE IT
     * ANYWAY. Driven on a live world with the row handed the bowcaster, a
     * `ranged: true` flag, a fire rate and a bolt colour at runtime, and a
     * hostile put down at 9 m: the wookiee CLOSED to 1.7 m and bit it, 156
     * points over 6 blows, all of them melee. Wrapping `_think` to hand the
     * shipped `_rangedBrain` the frame whenever the target was outside the
     * melee band changed the answer by nothing — 154 over the same 6 blows —
     * because the body was never outside the band. A second band needs a
     * STAND-OFF RULE: a decision about when this animal closes and when it
     * holds its ground and shoots, which is a behaviour with its own argument,
     * its own tuning and its own check, and it is not a field on this row.
     *
     * WHAT IT WOULD TAKE, so the next person costs it instead of rediscovering
     * it: a both-bands branch in `_brain` (the army's hot path — its own commit
     * and its own check) or a companion-owned sidearm in this feature's own
     * pack (cheaper, a second firing door, and it must argue that it is not),
     * plus the stand-off rule above, plus a friendly-fire measurement, because
     * a companion that shoots past you is a companion that shoots you.
     */
    blurb: 'A partner rather than a pet — the only one big enough to block a doorway '
      + 'you are standing in. It fights in reach and nowhere else.',
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
    /* THE ONLY ROW WITH A THRESHOLD ON IT, and the number is argued over
     * `PANIC` in Companions.js: one shooter at fifteen metres is 4.5 s of
     * riding, three of them is 1.5, and 75 hp of aimed fire is the whole of it
     * on its own. Ride past a picket; do not ride into a fight. */
    panic: 4.5,
    verb: { id: 'bolt', label: 'BOLT', caption: 'Run, and take their eyes with you' },
    blurb: 'Pace on flat ground and nothing else. Ride it into a fight and it panics: '
      + 'above a threshold it bucks you off and bolts.',
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
    /**
     * "TAKE US UP THAT" WAS A PROMISE THE WORK ROW DID NOT KEEP.
     *
     * CLIMB is `A.grade = 1` held for as long as the order stands and put back
     * when it ends — that is the whole verb — and its station is the point you
     * gave it. Said "us", it read as a taxi: the animal walked to the point
     * ALONE while the player stood where he had been standing, and the caption
     * was the only thing in the game claiming otherwise.
     *
     * WHAT IS TRUE, AND IT IS NOW TRUE BOTH WAYS ROUND. The grade ceiling is
     * read by `_move`, and `Enemy.update`'s driven branch calls `_move` — so
     * the face opens for a ridden animal exactly as it does for one on its own
     * feet, and the order is accepted on a body you are sitting on (measured on
     * a live world: ordered from the saddle, `A.grade` reads 1). What it is not
     * is a lift you can call from the ground. So the caption says which is
     * which instead of assuming the flattering one.
     *
     * MEASURED, ONE HALF END TO END: unridden, +5.2 m up a face the player's
     * own controller pushes him off, with the ceiling back at 0.3 the moment
     * the order was lifted (`companions.mjs`). The ridden half is the same two
     * lines of `_move` reached through the same field and is asserted at the
     * order rather than at the top of a cliff; if that is ever worth more, it
     * wants a fixture that can find a face, and it is not this lane's.
     */
    verb: { id: 'climb', label: 'CLIMB', caption: 'Take that face — with me on your back or without me' },
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
 *
 * ── AND THE THREE MOUNTS CARRY TWO MORE FIELDS, WHICH IS ALL RIDING COSTS ──
 *
 * `crew: 1` AND WHY IT IS NOT A SECOND SPELLING OF `mount`. `Driving.crewOf`
 * is the game's one answer to "is there a seat in this and how many bodies fit
 * in it", `whyNotDrive` and `drivableNear` are its only gates, and the whole
 * argument at the top of Driving.js is that there is NO second list of drivable
 * things to fall out of step with it. A mount that announced itself with a
 * third predicate would BE that second list. So the three rideable archetypes
 * answer the question the roster already asks: one body fits, and it is you.
 * `mount: true` goes on saying the other thing — that this is an ANIMAL with a
 * saddle rather than a machine with a hatch — and four readers need exactly
 * that distinction and not the seat count: `Enemy._measurePlatform`'s gate,
 * `Crew.seat`'s saddle offset, `Crew.fire`'s outright refusal (a tauntaun has
 * no trigger) and the boarding notice's wording. `tools/checks/driving.mjs`
 * binds the pair in one direction and `companions.mjs` in the other, so
 * neither field can be added without the other.
 *
 * `steer` IS RADIANS A SECOND AND IT IS NOT `DRIVE.turn`. That number is 0.9 —
 * a twenty-five-metre Juggernaut, and its note says why it is deliberately
 * slower than the AI's own yaw: "pointing it somewhere is a decision you commit
 * to". An animal is the opposite claim. At 0.9 a ridden tauntaun running at
 * 6.1 m/s has a turning circle of 6.8 m, which on Geonosis's broken ground is
 * a body that cannot be aimed at a gap; the numbers below are chosen as turn
 * RADII (speed ÷ steer) rather than as rates, because the radius is the thing
 * the player feels:
 *
 *   taun    2.4 rad/s → 2.5 m at its 6.1 m/s. The fast one, and it turns.
 *   blurrg  1.2 rad/s → 4.2 m at its 5.1 m/s. Exactly half the tauntaun's
 *           rate, which is COMPANIONS.md's own line for this kind — "superb
 *           across open ground, useless in a trench" is this number and
 *           nothing else, and it is what it buys its teeth with.
 *   varac   1.8 rad/s → 2.4 m at its 4.3 m/s. Slowest on the flat and nimble,
 *           because a body whose whole contribution is a route up a face is a
 *           body that has to be able to point at the face.
 *
 * Read in ONE place — `Crew.update`, as `A.steer ?? DRIVE.turn` — so a machine
 * that declares nothing keeps the tank rate it was tuned with.
 */
export const COMPANION_UNITS = {
  /**
   * THE VARACTYL — the third mount, and the reason there are three rather than
   * one: it is NOT ABOUT SPEED. The tauntaun makes the map faster; this makes
   * the map a different SHAPE, because it takes a grade the player's own
   * character controller refuses.
   *
   * `grade` IS THE WHOLE ARCHETYPE. `_move` reads it as the steepest ground
   * the body is built for in `slopeAt`'s own units (1 − n.y, so 0 is a table
   * and 1 is a wall) and falls the pace off over the top 45% of it rather than
   * at a threshold. 0.82 is the highest in the game — an acklay is built for
   * broken ground and this is built for the rock beside it.
   *
   * SLOWEST OF THE THREE MOUNTS ON THE FLAT, at 4.3 against the tauntaun's
   * 6.1, and that is the trade stated as a number: pace on the level is what
   * it gives up for the only route in the game nothing else has.
   *
   * ITS ONLY ATTACK HURTS NOTHING — the shipped `sweep` row at `damage: 0`
   * through this archetype, so a tail that knocks a body flat and takes not
   * one point off it. That is the honest reading of "useless in battle" for an
   * animal that is two metres of muscle: it can move you, it cannot kill you.
   */
  varac: {
    label: 'Varactyl', build: (o) => buildQuadruped({ ...o, kind: 'varac' }),
    scale: 1.35, hp: 300, mass: 420,
    speed: 4.3, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 0, preferred: [1.8, 3.4],
    moves: ['sweep'],
    grade: 0.82,
    /* RIDEABLE, and the two fields are argued once over COMPANION_UNITS. */
    mount: true, crew: 1, steer: 1.8,
    companion: true, score: 0, threat: 0, unlockAt: 99,
  },

  /**
   * THE REPROGRAMMED B1 — CHEAPEST BODY IN THE SET BY A WIDE MARGIN, and the
   * one kind that borrows another's.
   *
   * `buildB1` verbatim: zero new body code, zero new pose path, BipedAnimator
   * works, `DROID_RANK_REGIONS` already paints it and Presence already voices
   * it. That is the whole reason this is the kind to prototype the RANGED path
   * on — it is the only companion with a rifle, so it is the only one on
   * `_shoot`, the cover hunt and the `preferred` band, and it never reaches
   * `_beastBrain` at all.
   *
   * WHY IT IS ITS OWN ARCHETYPE AND NOT `ARCHETYPES.b1`. A companion carries
   * `companion: true, score: 0, threat: 0` so no wave can ever compose it —
   * and pointing the kind row at `b1` would give the ENEMY's b1 those fields,
   * which is every B1 in the game falling out of the wave composer at once.
   * One shared BUILDER, two archetypes, and the flag on exactly one of them.
   *
   * IT IS A BAD GUN, deliberately: "it dies to two bolts and it will stand in
   * the open, because that is what a B1 does". Its accuracy is a third of the
   * line's — `spread` 0.075 → 0.22 — and its rate is slower, so what it
   * contributes is presence and a running commentary rather than damage.
   */
  b1c: {
    label: 'Reprogrammed B1', build: buildB1, scale: 1.02, hp: 40, mass: 52,
    speed: 4.3, toughness: TOUGHNESS.droid, ranged: true, weapon: 'e5',
    fireRate: 2.2, burst: 2, burstGap: 0.16, spread: 0.22, damage: 8,
    preferred: [7, 15], boltColor: BOLT_COLORS.red,
    hipHeight: 0.96,
    companion: true, score: 0, threat: 0, unlockAt: 99,
  },


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
   * body gets visibly bigger and the SIZE buys nothing. (The rung ladder does
   * buy hp, dmg and speed, and it buys the same three for every kind; `scale`
   * is not on it and never will be, which is what makes this kind the honest
   * place to have asked the growth question.) 0.55 is where that
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
   * `preferred` [0.5, 0.8] against the massiff's [1.4, 2.6], because the slam
   * is a radius and not a swing: 2.05 of scale is 1.13 m here, so the band has
   * to sit inside its own blast or the move never resolves. Jaws have to
   * arrive; this has to be already there.
   *
   * ── AND IT SAID [1.0, 2.2], WHICH IS THE SENTENCE ABOVE WITH THE NUMBERS
   *    DISAGREEING WITH IT ────────────────────────────────────────────────
   *
   * 2.2 is not inside 1.13. Measured through `_beastBrain` against a target
   * standing perfectly still for 90 seconds (tools/checks/beasts.mjs): the
   * animal held station at a median 1.65 m, planted for the slam's 0.95 s
   * wind-up from wherever it happened to be — 1.39 m at the closest of ten —
   * and detonated the move the whole kind is named after entirely outside its
   * own footprint. TEN SLAMS, ZERO HITS, on a target that never moved. The
   * WRECK verb is a radius centred on the animal; an animal that stands half a
   * metre outside it is not slamming, it is stamping.
   *
   * The band is the ring's now, not the massiff's. Its far edge is 0.8 m —
   * 71% of the 1.13 m footprint, where the adult Rancor's 6.0 m far edge is
   * 86% of its own 6.97 m — and its near edge is UNDER the sum of the two
   * bodies' radii (0.36 m of pup plus the player's), which is the tooka's
   * argument for its own band said about a different animal: this is not a
   * fighting distance, it is "as close as the collision allows". Measured, the
   * animal now holds 0.77 m and the same ten slams land 13 of 14 on a
   * motionless target, 14 of 14 on one circling at a sprint, and 0 of 14 on
   * one that breaks straight out — which is the move's whole design statement
   * ("answered by distance and by nothing else") finally being true of the
   * small one as well as of the big one.
   *
   * Nothing else on the row moves. In particular the SCALE does not: 0.55 is
   * COMPANIONS.md's number and the plan row's height argument depends on it,
   * and the honest reading of the miss was never that the animal is too small
   * — it is that its band was written against the massiff, which fights with
   * jaws that have to arrive, instead of against its own blast.
   */
  pup: {
    label: 'Rancor Pup', build: (o) => buildQuadruped({ ...o, kind: 'pup' }),
    scale: 0.55, hp: 240, mass: 150,
    speed: 3.6, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 12, preferred: [0.5, 0.8], score: 0, threat: 0,
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
    /* RIDEABLE. `crew: 1` is what `Driving.whyNotDrive` and `drivableNear`
     * read; `steer` is the turn rate a rider gets instead of a tank's. Both
     * are argued once over COMPANION_UNITS. */
    mount: true, crew: 1, steer: 2.4, companion: true, unlockAt: 99,
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
    /* RIDEABLE, and the slow turn is the whole of "useless in a trench" —
     * exactly half the tauntaun's rate. Argued over COMPANION_UNITS. */
    companion: true, mount: true, crew: 1, steer: 1.2, unlockAt: 99,
  },

  /**
   * THE VHAL'KIR HAWK — the only body a player owns that a blade cannot reach.
   *
   * `flight: 'hawk'` IS THE WHOLE MOVEMENT MODEL AND IT IS ONE FIELD.
   * `Flight.installFlight` adopts on the PRESENCE of `A.flight` and nothing
   * else — it copies the archetype per body, wraps `_move`, and from then on
   * the cruise, the stoop, the dive and climb rates, the six seconds on the
   * ground after a Force grip and the one-wing consequence are all its. The
   * string is not switched on anywhere; it is a flag with a name on it, which
   * is why a second flyer costs a line rather than a file.
   *
   * `float: FLIGHT.STOOP` and not `FLIGHT.CRUISE`, which is the Geonosian's
   * own choice and its note argues it once: this is the altitude a body holds
   * when NOTHING has installed a plan on it — a check fixture, a sandbox, a
   * spawn path nobody has thought of. The failure mode of the other choice is
   * a hawk permanently at 5.6 m that no player can ever touch. The degraded
   * case is a low-hovering bird, never weather.
   *
   * IT IS NOT IN `FLIGHT_CANON`. That table is a contract against a stated
   * reference dimension, and there is no plate of a Vhal'kir hawk with a
   * number on it. A row there would be asserting something invented, which is
   * the one thing that file says it will not do.
   *
   * ── THE NUMBERS ─────────────────────────────────────────────────────────
   *
   * 48 hp, which is under the B1's 28 doubled and above the tooka's 24. It is
   * the second most fragile thing you can own and the reason is the altitude,
   * not the animal: everything on the field with a gun has line of sight to a
   * body in the air, so a health pool is the wrong place to defend it from.
   * "Excellent in the open, suicidal in a crossfire" is a positional claim and
   * this number is what makes it one.
   *
   * 6 kg — twice the tooka and a fortieth of the massiff, the second lightest
   * body in ARCHETYPES. A hawk with a 2.6 m span is mostly feather.
   *
   * 5.9 m/s is `paceOf('hawk')` to within a hundredth (0.80 × the player's
   * 7.45 sprint), written here as well as there for the reason the massiff's
   * row sets: `fieldCompanion` clamps the spawned body to the kind row's pace
   * and this is what the archetype would field at on any other path.
   *
   * `damage: 5` ON `pounce`, AND THAT IS THE VERB DOING THE WORK RATHER THAN
   * THE NUMBER. BEAST_MOVES' pounce commits its landing point 0.55 s into the
   * wind-up and arrives at 0.95 — a stoop, decided in advance, that a player
   * can step out of. Five points is a quarter of the massiff's jaws: what the
   * stoop does is STAGGER, and a hawk that killed things would make the SPOT
   * verb the boring half of the kind.
   *
   * `preferred` is deliberately absent and `FLIGHT` writes it every frame:
   * `flightStep` sets `A.preferred` to `bandHigh` on the cruise and `bandLow`
   * on the stoop, which is the whole reason the low half of the cycle is a
   * PASS instead of a lower hover. A band declared here would be overwritten
   * on the first frame and would read as the archetype's when it is not — so
   * the fallback the un-flighted body uses is the low band, stated once.
   */
  hawk: {
    label: "Vhal'kir Hawk", build: (o) => buildQuadruped({ ...o, kind: 'hawk' }),
    scale: 1.0, hp: 48, mass: 6,
    speed: 5.9, toughness: TOUGHNESS.flesh, melee: true, custom: 'beast',
    damage: 5, preferred: FLIGHT.bandLow, score: 0, threat: 0,
    float: FLIGHT.STOOP, flight: 'hawk',
    /* Never composed into a wave, for the reason the massiff's row states. */
    companion: true, unlockAt: 99,
  },

  /**
   * THE ASTROMECH — it cannot fight at all, and every field here says so once.
   *
   * `moves: []` IS THE ENFORCEMENT AND `damage: 0` IS THE BELT. The tooka's
   * row already argues the pair and it is not restated; what is new is that
   * `_beastBrain` now READS an empty list (see Enemy.js) instead of falling
   * through to a lunge, so this droid does not throw itself at anything. The
   * arc-weld COMPANIONS.md gives it is a stun with no damage on it and lives
   * with the pack, not on this row: a `damage` above zero here would be the
   * one number a future contributor reads as permission.
   *
   * 2.9 m/s IS THE SLOWEST THING IN THE GAME THAT MOVES. `paceOf('astro')` is
   * 0.40 of the player's sprint — under the rancor pup's 3.6, under the
   * Rancor's own 3.4, and a third of what you cross ground at. That is the
   * whole cost of bringing it and it is deliberately felt on every metre of
   * every map rather than in a fight.
   *
   * 120 hp on 32 kg. Above the B1's 28 because it is a sealed steel drum and a
   * long way under the massiff's 210 because it does not fight: it is meant to
   * survive a stray bolt and lose to anything that means it.
   *
   * `preferred: [1.4, 3.0]` on a body with no attack is not a fighting band —
   * it is how close it wants to be to whatever it is following, which for a
   * machine that has to reach a door and work on it is arm's length plus the
   * width of the door.
   *
   * `hipHeight` is NOT declared: `buildAstromech` publishes a stance and
   * `_stance` prefers the builder's. One authority per body.
   */
  astro: {
    label: 'Astromech', build: (o) => buildAstromech(o),
    /* 1.0 is a real R-unit: the builder is authored at 1.05 m to the top of
     * the dome, which puts it at the player's hip and is the reason a bolt
     * meant for a man goes over it — the tooka's geometry argument, on a body
     * that cannot be picked up. */
    scale: 1.0, hp: 120, mass: 32,
    speed: 2.9, toughness: TOUGHNESS.droid, melee: true, custom: 'beast',
    moves: [], damage: 0, preferred: [1.4, 3.0], score: 0, threat: 0,
    companion: true, unlockAt: 99,
  },

  /**
   * THE 2-1B — the slowest thing you own after the astromech, and unarmed.
   *
   * WHAT MAKES IT UNARMED IS `melee: false` AND NO `weapon`, and that is worth
   * being exact about because the astromech's row above is unarmed a different
   * way. `melee: false` sends this body to `_rangedBrain`, which looks for a
   * gun, finds none, and never fires; the astromech is `melee: true` and is
   * disarmed by its empty move list instead. `moves: []` is here as the BELT:
   * COMPANIONS.md says this one "must never be given a weapon", and the row
   * that a future contributor flips to `melee: true` should not thereby
   * acquire the default beast move set. It is not read today, and it is the
   * one field on this row that is not.
   *
   * 3.1 m/s = 0.42 of your sprint. "It is deliberately the slowest thing you
   * own, so the whole tension is whether it arrives" — that sentence is this
   * number, and it is one hundredth over the astromech's because a droid that
   * walks is faster than a droid that rolls over broken ground and slower than
   * anything with a reason to hurry.
   *
   * 160 hp on 90 kg. Higher than the astromech because it is a bigger body
   * with more of it in the open, and still under a clone trooper: it walks
   * toward the wounded, which is by definition where the shooting just was,
   * and it has to be able to be killed there or the tension is theatre.
   *
   * IT IS HUMANOID — no `custom` — which is what buys `BipedAnimator`,
   * `POSTURES` and the parade path, and is also why it needs a `BODY_KITS`
   * row (see Bodies.js). `melee: false` sends it to `_rangedBrain` with no
   * weapon: it takes cover, it closes on nothing, and it never shoots, which
   * is the correct behaviour for a body whose whole job is `findPatient`.
   */
  medic: {
    label: '2-1B Medical Droid', build: (o) => buildMedic(o),
    scale: 1.10, hp: 160, mass: 90,
    speed: 3.1, toughness: TOUGHNESS.droid,
    melee: false, moves: [], damage: 0, preferred: [1.2, 2.4],
    score: 0, threat: 0,
    companion: true, unlockAt: 99,
  },

  /**
   * THE WOOKIEE — "the second soldier", and the most expensive body in this
   * design on the frame, which its card says out loud.
   *
   * `scale: 1.32` IS THE ROW, and it is the design's 1.28 corrected by a
   * measurement rather than a preference — see `buildWookiee`, which shortens
   * the legs for the ape proportion and therefore needs the extra four
   * hundredths to stand where COMPANIONS.md says this body stands. The built
   * box is 2.22 m: the tallest walking body on the roster short of a machine,
   * and the reason it can block a doorway you are standing in.
   *
   * 420 hp — twice the massiff, a third of a Reek. It is the only companion
   * that is meant to be TRADED with rather than protected, and the number is
   * the one that makes "a partner rather than a pet" true in a firefight.
   *
   * 200 kg at 1.28 scale, against a clone's 82 at 1.0. `guardFor` gives
   * nothing under 300 kg a turned pass, so this is deliberately UNDER the line
   * that would armour it against a lightsaber: your own blade cuts your own
   * wookiee in one pass, and `installTeamDamage`'s notice is what tells you
   * you did it.
   *
   * 4.8 m/s = 0.64 of your sprint. Slower than the massiff's 5.2 on much
   * longer legs, which is the honest reading of a two-and-a-third-metre body
   * that walks rather than trots.
   *
   * ── WHAT IS NOT HERE, AND IT IS THE HALF THIS ROW DOES NOT OWN ─────────
   *
   * NO `ranged`, NO `weapon`, AND THE CARD NO LONGER SAYS OTHERWISE. The full
   * argument — including the measurement that 0 archetypes in this game carry
   * both bands, because `_brain` picks one off `A.melee` and `_beastBrain` has
   * no firing path — is on this kind's `blurb` in the KINDS table, where the
   * false sentence was. In short: `buildBlaster` has no 'bowcaster' branch and
   * its final `else` is the clone HEAVY REPEATER, so a `weapon` field here
   * today is a Republic drum gun in a wookiee's hands; and a `ranged` field
   * here is a flag no code reads. The body is built, the gun is the weapons
   * lane's and the BAND is a branch nobody has costed; `melee: true` with the
   * default beast verbs is what it fields with, and the card says so.
   */
  wook: {
    label: 'Wookiee', build: (o) => buildWookiee(o),
    scale: 1.32, hp: 420, mass: 200,
    speed: 4.8, toughness: TOUGHNESS.flesh, melee: true,
    damage: 26, preferred: [1.6, 3.0], score: 0, threat: 0,
    companion: true, unlockAt: 99,
  },
};

Object.assign(ARCHETYPES, COMPANION_UNITS);
