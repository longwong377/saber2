/**
 * BATTLEFRONT BORZ — THE THREE SABER SETS.
 *
 * *"I also want you to add A double-bladed lightsaber/saberstaff … and also
 * dual weilding (one lightsaber in each hand), these two differing player
 * fighting methods will require unique playstyles and have moves that are
 * unique to them, don't change anything with the default single blade usage."*
 *
 * The last clause is the hard one and it is what shapes this file. Both new
 * weapons are built as EXTRA `Saber` INSTANCES driven through the same public
 * two-call contract — `setHiltPose(pos, quat)` then `update(dt, time,
 * carrierVel)` — that `Enemy.installOffhand`, `Net`'s RemoteAvatar, the menu
 * preview and the thrown blade already drive. So `Saber.js` and `Combat.js`
 * have zero changed lines, which is checkable in one line of `git diff --stat`
 * rather than argued for: the two endpoint lines at Saber.js:1949-1950 that
 * feed the sweep, `speedAt`, `cutPowerAt`, `PROFILE` and `HILT_SPECS` are
 * untouched for every blade in the build, the ~30 enemy sabers included.
 *
 * ── WHY A SEGMENT PER BLADE, AND NEVER ONE LONG SHAFT ──────────────────
 *
 * This is the single most important structural decision here and it is not an
 * implementation detail. `Saber.speedAt(t) = lerp(|baseVelocity|,
 * |tipVelocity|, t)` and `captureSnapshot`'s identical `bladeSpeed` both assume
 * speed rises monotonically from a slow base to a fast tip. That is true of a
 * weapon pivoting near or below its grip and FALSE of a staff spun about its
 * middle, where both ends move at V and the centre at ~0 — the lerp would
 * report V along the whole shaft, the grip would sever flesh as hard as the
 * tip, and every contact would clear `SPEED_GRADE.perfect` (9.4 m/s) for free.
 *
 * Built as two segments each pivoting about its own base at the hands, the lerp
 * is correct on both halves with no change to `speedAt` for anybody, and
 * everything bladeT-indexed goes on meaning the same thing measured from the
 * hand outward on all four segments in the game: `returnBladeT` 0.42,
 * `perfectBladeT` 0.55, `bolts.hold`'s pin fraction and `intersectBladeSweep`'s
 * return value. `tools/checks/saberforms.mjs` holds that as an assertion — it
 * drives a real swing in every set and requires speedAt(0.25) ≤ speedAt(0.5) ≤
 * speedAt(0.9) on every blade — because it is exactly the property a future
 * "simplification" to one long segment would quietly destroy.
 *
 * ── WHAT THIS MODULE MAY AND MAY NOT IMPORT ────────────────────────────
 *
 * It imports `Saber` and THREE and nothing else, and in particular NOT
 * `SaberController`: the controller imports the envelope tables below, so an
 * import the other way is a cycle. That is why `ENVELOPES.single` is `null`
 * rather than a copy of SLASH — the controller resolves null to its own shipped
 * objects BY REFERENCE, so there is not a second copy of a single-blade number
 * anywhere in this diff and there is therefore nothing to drift. HANDOFF §2.4.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { clamp } from '../engine/MathUtil.js';
import { Saber } from './Saber.js';

const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3();
const _s4 = new THREE.Vector3(), _s5 = new THREE.Vector3(), _s6 = new THREE.Vector3();
const _sq = new THREE.Quaternion(), _sq2 = new THREE.Quaternion();
const _sm = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE THREE SETS                                                       */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * IT IS CALLED `saberSet`, NOT `saberForm`, AND THAT IS LOAD-BEARING RATHER
 * THAN A PREFERENCE. `FORMS` and `FORM_KEYS` are exported from Duel.js for the
 * five duelling styles, `Duel` picks one per duellist as `this.formKey`, and
 * `tools/checks/forms.mjs` already exists and is entirely about them. `stance`
 * is taken by the controller's lateral guard binding; `grip`, `style` and
 * `weaponStyle` are all taken in Saber.js and SaberController.js. Calling this
 * a "form" would collide in grep, in check names, and in every conversation
 * anyone ever has about it.
 *
 * Each row is the WHOLE of what a set is, so nothing anywhere else has to carry
 * a second half of the answer:
 *
 *   `grip`      which `GRIPS` row the controller drives the weapon on. `single`
 *               names `two`, which is the row it has always been on, so a
 *               single-blade player's `control.grip` never takes a new value.
 *   `offScale`  the second blade's length as a share of the player's own
 *               `bladeLength`. 1 for the staff — the reach is the player's own
 *               setting read twice — and 0.80 for the pair, which is 0.92 m on
 *               a stock blade, so it reads as a shoto and the pair's claim is
 *               BEARINGS rather than metres.
 *   `hands`     what `Player.handsOnHilt` answers. A saberstaff genuinely IS
 *               two hands on one hilt; the pair is one hand on the main hilt
 *               and the other on its own, which is 1 and not 2 — see
 *               `offHandOn()` beside it for the question this cannot express.
 *   `offDamage` the second blade's share of the cut. The staff's far end is the
 *               same weapon; the pair's shoto takes Enemy `_offhandStrike`'s
 *               shipped 0.55, ported rather than invented.
 *   `throwKey`  what `throw` means in this set. One key, one meaning at a time
 *               — the pattern `swap`, `drive`, `hurl` and `throw` already use
 *               four times over.
 */
export const SABER_SETS = [
  { id: 'single', name: 'One blade', blurb: 'The blade you know. The heavy, the bind, the whole ladder.',
    grip: 'two', offScale: 0, hands: 2, offDamage: 0, throwKey: 'throw' },
  { id: 'staff', name: 'Saberstaff', blurb: 'Two blades on one shaft. Answers a wider arc, and pays for it.',
    grip: 'staff', offScale: 1, hands: 2, offDamage: 1, throwKey: 'orbit' },
  { id: 'pair', name: 'Paired blades', blurb: 'Two blades, two bearings. Covers you while you are busy.',
    grip: 'pair', offScale: 0.80, hands: 1, offDamage: 0.55, throwKey: 'throwOff' },
];

/** The row, or the single blade's — never undefined, because sixty call sites
 *  read `player.saber` without a guard and this must be no worse. */
export function setById(id) {
  return SABER_SETS.find((s) => s.id === id) || SABER_SETS[0];
}

/** Every set's id, for the menu, the orders and the checks. */
export const SET_IDS = SABER_SETS.map((s) => s.id);

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE PACE                                                             */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ── "INCREASED … MOBILITY", AS A NUMBER THE LEGS READ ────────────────────
 *
 * *"Dual-wielding lightsabers generally provides increased offensive
 * capabilities AND MOBILITY, making it effective against multiple
 * opponents."*
 *
 * THE HALF OF THAT SENTENCE THIS FILE USED TO ANSWER WAS ONE WORD OF IT.
 * Measured before this existed, on `tools/_setbench.mjs`'s pace arm — a player
 * holding forward and mashing the light cut for ten seconds on the colosseum
 * floor, ground covered per second of it:
 *
 *     single  4.600 m/s      staff  4.600 m/s      pair  4.600 m/s
 *
 * Three sets, one pace, to three decimals, because `Player._move` opens
 * `const base = 4.6 * this.boonMods.moveSpeed` and NOTHING downstream of it —
 * the slow walk, the sprint, the crouch, the stagger, the sense — has ever
 * asked what is in your hands. The offensive half of the clause was real and
 * measured (`saberforms`'s four-body check: the pair banks 86% more cut work
 * than one blade), the mobility half was prose.
 *
 * ── WHY IT IS KEYED OFF `hands` AND NOT OFF A FOURTH COLUMN ──────────────
 *
 * The column that already carries this fact is `hands`. It is the one field on
 * which the pair differs from BOTH of the others — the single blade and the
 * saberstaff are each two hands on one hilt and the pair is one — and
 * `saberforms: each set is a trade` already asserts `set.hands < single.hands`
 * for exactly this set. So the pace is a function of it, and three things
 * follow that a typed per-set column would not give:
 *
 *   THE SINGLE BLADE CANNOT MOVE, by construction rather than by an exception.
 *   `SABER_SETS[0].hands - set.hands` is 0 for the single blade, so `paceOf`
 *   returns `1 + k·0` — the literal 1 — and `4.6 * moveSpeed * 1` is the same
 *   IEEE-754 float `4.6 * moveSpeed` was. There is no tolerance to argue
 *   about and no way for a later hand to re-tune the pair's number into the
 *   single blade's.
 *
 *   THE SABERSTAFF DOES NOT MOVE EITHER, and that is deliberate. A polearm is
 *   a heavier weapon and the temptation is to charge its legs for it — but
 *   every one of the staff's costs in SABERFORMS.md is already paid in the
 *   weapon (a narrower arc, a slower guard, half the weapon surrendered to any
 *   hand you need free), and a walking penalty on top would be a fourth price
 *   for a set nobody asked to change. `hands: 2` says so without a clause.
 *
 *   AND IT IS THE SET'S OWN ROW, not the LIVE grip. `GRIPS.one` has inertia
 *   0.74 — LOWER than the pair's 0.80 — so a pace derived from whatever the
 *   hands are doing this frame would hand a single-blade player carrying a
 *   crate a bigger bonus than the pair gets, which moves the single blade.
 *
 * ── HOW BIG, AND THE BOUND THAT SETS IT ─────────────────────────────────
 *
 * 8%. `Player._move`'s own ladder is walk 1.56 / crouch 2.21 / ordinary 4.60 /
 * sprint 7.45 m/s, "each about half again the one below" — the smallest step
 * between two PACES a player chooses is +48%. A set-level term has to sit far
 * under that or it stops being a set and becomes a stance: at 8% the pair
 * walks at 4.97 m/s, so a dual wielder at an ordinary walk is still 2.5 m/s
 * slower than ANY set at a sprint and a crouched dual wielder (2.38) is still
 * slower than any set walking. It multiplies `base`, so it is 8% at every one
 * of the four paces rather than a bonus that only shows when you run — which
 * is what "mobility" means and what a flat addend would not have been.
 *
 * ── AND IT IS PAID FOR IN THE ENVELOPE, ONE FIELD AWAY ──────────────────
 *
 * See `DUAL_SLASH` below: `rise`/`drop` 0.74/0.76 → 0.72/0.74. The pair keeps
 * 90% of one blade's arc for 108% of its pace, which costs it a MEASURED 10%
 * of the cut work it banks against four bodies at once — the currency the note
 * over `STAFF_SLASH` says the two new sets are paid in, and a much dearer
 * currency than that note's tip-speed table makes it look.
 *
 * The cadence was tried first and withdrawn: `slash.cooldown` under 0.30 does
 * not reach the weapon at all, because every light press also opens the stab
 * and that line names `SLASH.cooldown` for every set. The measurement is over
 * `DUAL_SLASH`.
 */
export const FREE_HAND_PACE = 0.08;

/**
 * How fast this set walks, as a multiple of `Player._move`'s own base.
 *
 * `SABER_SETS[0]` is the single blade and it is the datum on purpose: the
 * question this answers is "how much of a hand does this set give back",
 * and the answer has to be measured against the weapon the game has always
 * given you rather than against a constant typed twice.
 */
export function paceOf(setId) {
  return 1 + FREE_HAND_PACE * (SABER_SETS[0].hands - setById(setId).hands);
}

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE ENVELOPES                                                        */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE TWO NEW ARCS, READ STRAIGHT OFF SLASH'S OWN SHIPPED WIDTH TABLE.
 *
 * SLASH's note measures three widths on `tools/checks/animation.mjs`'s ring of
 * eighteen bodies and records what each one's tip peaked at:
 *
 *     rise / drop      tip peak
 *     0.65 / 0.67      13.2 m/s
 *     0.80 / 0.82      16.9 m/s   ← SLASH, and it is NOT TOUCHED
 *     0.98 / 1.00      18.5 m/s
 *
 * A narrower arc is a slower tip is a softer contact, and that is the whole
 * currency the two new sets are paid for in. It is never a shorter
 * `PARRY.cooldown`, never a `SPEED_GRADE` move and never a damage multiplier:
 * every one of those would look like an improvement and land as a regression,
 * because they are shared by every blade in the game.
 *
 * THE STAFF trades width for repetition. 0.60/0.62 at a 0.22 s cooldown is
 * 4.55 presses a second against the single blade's 3.33 — 36% faster to repeat
 * and about 25% softer per contact — and the reason it can repeat that fast is
 * geometric rather than granted: the far end is rigidly opposite the near one,
 * so it is already chambered when the near one has finished. That is the
 * player's "the second blade is instantly ready for a follow-up strike",
 * delivered by the shaft rather than by a number.
 *
 * THE PAIR sits between them at 0.72/0.74 and 0.26, because it genuinely is
 * between them: two lighter weapons, each on its own bearing. Its arc is
 * narrower than it was first authored at — see `DUAL_SLASH` itself, where the
 * 0.02 is what its 8% of pace is paid for with, and where the measurement is
 * that the arc is a far dearer currency than a tip speed.
 *
 * `chain` is the window the third press has to arrive in. The staff's is longer
 * (0.72) because its own cooldown is shorter and a sequence you cannot reach is
 * not a sequence.
 *
 * `lunge` IS THE OTHER HALF OF THE REACH, and it is HEAVY's own 0.52 rather
 * than a fourth number: a polearm's light cut is a step-through, which is what
 * the two-handed weapon's committed swing already is, so the staff's light cut
 * travels as far as one blade's HEAVY does. It was dead until this pass —
 * `SaberController` named `SLASH.lunge` directly at the press, so every set
 * stepped exactly as far as the single blade — and wiring it to `setTables` is
 * what makes these three fields mean anything at all. The price is the price a
 * lunge always is: the body is committed forward and cannot give ground, and
 * on a weapon whose guard already settles 21% slower than one blade's that is
 * the window a duellist walks into.
 */
export const STAFF_SLASH = {
  wind: 0.075, cut: 0.115, dur: 0.315,
  rise: 0.60, drop: 0.62, lift: 0.30, fall: 0.62,
  cooldown: 0.22, chain: 0.72, lunge: 0.52,
};

/**
 * THE WHIRL — the staff's third press, and it is flatter and lower than HEAVY.
 *
 * HEAVY lifts to 0.30 and falls to 0.75 because one blade has to cover the
 * high line on its way to the low one. A staff does not: the far end is on the
 * high line for the whole arc, for free. So the whirl keeps HEAVY's whole
 * CHARGE block — `hold`, `full`, `cutScale`, `rec`, `drain` and `reach` are all
 * read from HEAVY unchanged, because the chamber is the same chamber — and
 * differs only in where the arc goes.
 */
export const STAFF_HEAVY = {
  wind: 0.10, cut: 0.125, dur: 0.50,
  rise: 0.86, drop: 0.90, lift: 0.10, fall: 0.62,
};

/**
 * The pair's alternating cut. Between the single blade and the staff on every
 * term, which is what the form is.
 *
 * ── `rise`/`drop` 0.74/0.76 → 0.72/0.74 IS WHAT THE PAIR'S FEET COST IT ──
 *
 * `paceOf` above hands this set 8% of pace at every one of the four paces, and
 * nothing in this project is allowed to be only better. The price is charged
 * on the arc because the arc is THE currency this file trades in — the note
 * over `STAFF_SLASH` says so in as many words, and says why the alternatives
 * are refused: a shorter `PARRY.cooldown`, a `SPEED_GRADE` move or a damage
 * multiplier would every one of them be shared by every blade in the game.
 *
 * 0.72 is 90% of SLASH's 0.80 for 108% of its pace, which is the exchange
 * `saberforms: each set is a trade` now asserts as a BOUND rather than as a
 * direction: a set may keep no more of the single blade's arc than the pace it
 * was given leaves it.
 *
 * ── AND THE ARC IS FAR SHARPER THAN THE WIDTH TABLE MAKES IT LOOK ────────
 *
 * SLASH's own table reads the arc as tip speed, and on that reading 0.05 is
 * about 1.2 m/s — 8% of a contact, which is what the first cut of this took.
 * MEASURED, it is not what 0.05 does. A free swing on the real rig peaks the
 * tip at 18.39 m/s at 0.74, 18.10 at 0.72 and 17.67 at 0.69 — so the width
 * table's slope holds — but the arc is also HOW MUCH OF THE RING THE BLADE
 * CROSSES, and against four bodies at 1.20 m that second effect is an order of
 * magnitude louder. Cut work banked over the same 900 frames, same script,
 * same bodies:
 *
 *     rise 0.74   173     ← as it shipped
 *     rise 0.72   156     ← −10%, and this is the price
 *     rise 0.71   135
 *     rise 0.69   111     ← −36%, and TWO shipped checks go red
 *
 * At 0.69 `saberforms: against four bodies at once the pair does the most
 * work` falls under its own +20% floor and `throw one and you can still fight
 * with the other` falls under its 0.3 ratio — the set stops being the thing
 * the player asked for. **A price that deletes the feature is not a price**,
 * and the reason the first cut looked affordable is that it was priced off a
 * table of tip speeds and the arc is not only a tip speed.
 *
 * ── AND `cooldown` IS NOT THE PRICE, BECAUSE `cooldown` IS INERT HERE ────
 *
 * The first cut of this charged the pace to the cadence — 0.26 → 0.28 — and
 * measured NOTHING. `SaberController.applyInput` gates a light cut on
 * `slashCool <= 0 && thrustCooldown <= 0`, and every light press also opens
 * the stab, which sets `thrustCooldown = SLASH.cooldown / attackRate` — the
 * SINGLE BLADE's 0.30, in every set, because that line names `SLASH` directly.
 * So any set whose own `slash.cooldown` is at or under 0.30 repeats at 0.30
 * and its own number does not reach the weapon. Measured on
 * `tools/_setbench.mjs`'s pace arm, ten seconds of mashing, the pair:
 *
 *     cooldown 0.26   25 strikes accepted
 *     cooldown 0.30   25 strikes accepted      ← identical, to the strike
 *     cooldown 0.45   13
 *
 * 0.26 is therefore left exactly as it shipped: a number that describes the
 * form correctly and that the controller currently rounds up to 0.30. Moving
 * it to 0.28 would have been a price the game does not charge, which is worse
 * than no price at all. The masking itself is left alone deliberately — the
 * fix lives in a line that reads `SLASH` for all three sets, and touching it
 * moves the SABERSTAFF's tempo, which is measured and green.
 *
 * MEASURED EITHER SIDE, on `tools/_setbench.mjs`'s pace arm — ten seconds of
 * held-forward mashing, the same script in all three sets:
 *
 *     before   single 4.600 m/s · 17 presses    pair 4.600 m/s · 25 presses
 *     after    single 4.600 m/s · 17 presses    pair 4.967 m/s · 25 presses
 *
 * The single blade to three decimals and to the press, which is the point of
 * keying the term off `hands`.
 */
export const DUAL_SLASH = {
  wind: 0.075, cut: 0.115, dur: 0.315,
  rise: 0.72, drop: 0.74, lift: 0.30, fall: 0.72,
  cooldown: 0.26, chain: 0.62, lunge: 0.30,
};

/**
 * THE CROSS — and it is NOT A HEAVY, by construction rather than by a flag.
 *
 * The pair holds no hilt with two hands, so it cannot chamber: there is no
 * `heavy` row in its envelope set at all, and the controller's third press
 * therefore falls through to another light cut with both blades converging.
 * Two contacts at roughly 15.6 m/s each instead of one at HEAVY's measured 22.0
 * tapped. Severance is a work budget against TOUGHNESS, so that is worse
 * against one armoured body and better against two soft ones — which is the
 * trade the whole form is made of, arrived at by removing something rather than
 * by adding a multiplier.
 */
export const DUAL_CROSS = null;

/**
 * WHAT EACH SET SWINGS, and `single` is `null` ON PURPOSE.
 *
 * The controller resolves a null row to its own shipped `SLASH` / `HEAVY`
 * OBJECT, by reference. So `tables('single').slash === SLASH` holds with `===`
 * and not with a deep-equal, there is no second copy of a single-blade number
 * in this diff, and no later pass can re-space the light cut for one set and
 * miss the other. See `SaberController.setTables`.
 */
export const ENVELOPES = {
  single: { slash: null, heavy: null, chamber: true },
  staff:  { slash: STAFF_SLASH, heavy: STAFF_HEAVY, chamber: true },
  /* `chamber: false` IS THE CROSS. It is what makes HEAVY and CHARGE
   * unreachable in this set — see DUAL_CROSS above — and it is a fact about
   * the weapon (no second hand on the hilt) rather than a difficulty flag. */
  pair:   { slash: DUAL_SLASH, heavy: DUAL_CROSS, chamber: false },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE SECOND BLADE                                                     */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * How far the off blade is carried below the main one, and how far its guard
 * mirrors — Enemy `_poseOffhand`'s own numbers, because a second blade carried
 * low and ready to come up under the first is the same pose whoever is holding
 * it. `lagStart` and `lagSpan` are the SAME rule that file states verbatim:
 * `lag = clamp((u - 0.35) / 0.65, 0, 1)`, zero until the main blade is a third
 * of the way through its arc and one at the end, so the two blades arrive on
 * two beats rather than reading as one weapon drawn twice.
 */
export const OFFHAND = { drop: 0.28, lagStart: 0.35, lagSpan: 0.65, settle: 12 };

/**
 * HOW FAR APART THE TWO FISTS ARE CARRIED IN THE PAIR, in metres on a
 * standard arm, before `reachScale` is applied.
 *
 * 0.42 m is a fighting stance rather than a shrug: the off hand is carried out
 * and low (see `OFFHAND.drop`), not tucked at the hip. It is deliberately
 * SMALLER than the saberstaff's shaft — measured at 0.20 m of grip either side
 * of centre plus two blades — because a quarterstaff answers a wider rose than
 * two short swords do, and what the pair buys instead is the free hand and a
 * blade it can throw without disarming itself.
 */
export const PAIR_CROSS = 0.42;

/**
 * ── THE LONG CENTRAL HILT, AND WHY THE STAFF HAD NO REACH WITHOUT IT ─────
 *
 * *"A double-bladed lightsaber/saberstaff (COMBINES A LONG CENTRAL HILT with
 * an energy blade on both ends, functioning similarly to a polearm or
 * quarterstaff) … THE DOUBLE BLADED USER WILL HAVE MORE REACH."*
 *
 * MEASURED BEFORE THIS EXISTED, against a stationary B1 walked outward from
 * 1.2 m to 3.0 m while the player swung: the single blade's furthest contact
 * was **1.83 m from its own feet and the saberstaff's was 1.78** — the staff
 * reached NO FURTHER, and marginally less, because a narrower arc is a shorter
 * throw of the hands. Tip to tip it spanned 2.78 m against one blade's 1.15,
 * and every centimetre of that was BEHIND the wielder. The second half of the
 * weapon was decoration on the reach question.
 *
 * WHY IT COULD NOT BE FIXED WITH A NUMBER. Reach is `|chest → tip|`, and the
 * tip is `saberRoot + (emitterY + bladeLength)` up the axis. Every set poses
 * `saberRoot` AT `control.handPos`, so hand-to-tip is 1.31 m for all three of
 * them whatever the table says, and the only levers on it are a longer blade
 * (that is a different sword wearing a staff's name) or hands held further out
 * (0.13 m at the very most, and it costs the guard). A quarterstaff does not
 * out-reach a sword by having a longer blade. It out-reaches it by being
 * GRIPPED IN THE MIDDLE OF A LONG SHAFT, so half the shaft is in front of the
 * hands before the blade even starts.
 *
 * SO THE SHAFT IS REAL METAL AND THE HANDS RIDE ITS MIDDLE. `gap` is the bar
 * of hilt between the two pommels — they used to meet — and the whole of the
 * reach it buys is `gap / 2`, because the hands sit at the centre of what it
 * makes. On the shipped rack that is a 0.78 m central hilt (0.48 m of the two
 * hilts' own metal, measured off the built meshes, plus this), which is a
 * saberstaff rather than two torches taped together, and it is the player's
 * own words rather than an invention.
 *
 * `radius` is the shaft's own radius and NOT a taste: `hiltSpec.r` is what the
 * two hilts are turned from, so the bar between them is the same bar. It takes
 * the main hilt's own metal material, so there is no new `MeshStandardMaterial`
 * and nothing recompiles — see `Props.js`'s note on `buildHiltGroup`.
 *
 * WHAT IT COSTS, AND IT IS PAID IN THE ONE CURRENCY THE SETS TRADE IN. A
 * longer, heavier bar about one pair of hands is more inertia: `GRIPS.staff`
 * goes 1.34 → 1.62, re-solved through THIS FILE'S OWN kD = 2ζ√(kP/I) at the
 * same ζ = 0.60, so the staff's guard now settles at ω 9.81 rad/s against the
 * single blade's 12.49 — 21% slower, where it was 14% slower. Reach and a slow
 * guard are the polearm's actual trade and neither is a multiplier.
 */
export const SHAFT = { gap: 0.30, radius: 1.0 };

/**
 * THE ORBIT — the saberstaff spun round the chest by pure telekinesis.
 *
 * *"the double bladed user can use pure telekinesis to spin the staff at high
 * speeds around your body like a protective barrier, keeping your hands free to
 * cast whatever."*
 *
 * `radius` IS GONE, AND THAT IS THE FIX RATHER THAN A TIDY-UP. It was 1.7 m
 * with the two hilts placed at `0.45 × radius` and their blades laid along the
 * TANGENT, which is not a staff spinning: it is two separate blades on a
 * carousel, 1.53 m apart on a shaft 0.78 m long, sweeping an ANNULUS from 0.77
 * m out to 1.51. MEASURED: 0.77 m of that annulus is a hole in the middle, and
 * a hole in the middle of a barrier is where the man is. Bolts crossed it.
 *
 * A staff spun about its own centre has no hole. Both halves pivot about the
 * ONE point the Force is holding — the middle of the shaft, at the chest — so
 * the swept disc runs from the emitter faces (0.31 m, just clear of the torso)
 * out to the tips at half the tip-to-tip span, and every line into the chest
 * crosses it. It is also strictly better for `speedAt`, which is the property
 * this file's header is about: a segment pivoting about its own base has a
 * still base and a fast tip, where the tangential version had both ends moving
 * at once — the exact case the header says the lerp gets wrong.
 *
 * So the ring's radius is now MEASURED off the weapon (`Sidearm.half`) instead
 * of typed, and a longer shaft is a wider barrier for free and for a reason.
 *
 * `rate` is the knob if it ever proves too strong, and it is the RIGHT knob:
 * lowering it lowers `speedAt` for every consumer at once and therefore lowers
 * the grade of every contact the ring makes — never a damage multiplier and
 * never a price. `cap` is the hard ceiling in seconds, on top of the Force it
 * drains, because this is a panic button and not a stance.
 */
export const ORBIT = { rate: 9.0, cap: 4.0, rise: 0.18, clear: 0.15 };

/**
 * THE WHOLE OF THE SECOND WEAPON — the blade, its pose, its own throw and the
 * orbit, in one object a Player owns or does not.
 *
 * ONE OBJECT AND NOT A SET OF FIELDS ON Player. `player.saber` exists in every
 * set and only `offSaber` is conditional, reached solely through here, so
 * Player.js:10118's honest note — "sixty call sites outside this file
 * dereference `player.saber` without a guard" — goes on being true.
 */
export class Sidearm {
  /**
   * @param owner   the Player. Read for its chest, its aim and its controller;
   *                never written except through the two published fields below.
   * @param setId   'staff' | 'pair'. 'single' never builds one of these.
   * @param opts    the SAME appearance the main blade was built from, so the
   *                second blade is genuinely the same weapon rather than a
   *                default one wearing its colour.
   */
  constructor(owner, setId, opts = {}) {
    this.owner = owner;
    this.set = setById(setId);
    const main = owner.saber;
    this.saber = new Saber(owner.world.scene, {
      colorIndex: opts.colorIndex ?? main.colorIndex ?? 0,
      bladeLength: (opts.bladeLength ?? main.bladeLength ?? 1.15) * this.set.offScale,
      coreWidth: opts.coreWidth ?? main.coreWidth ?? 1,
      hiltStyle: opts.hiltStyle ?? main.hiltStyle ?? 'Graflex',
      order: opts.order ?? main._order ?? null,
      engine: owner.world.engine,
      /**
       * ZERO, AND NEVER 1. `Engine.lightUp`'s pool is FIXED at eight precisely
       * so `NUM_POINT_LIGHTS` cannot move and no lit material recompiles; a
       * second LOCAL blade at priority 1 would take two of those eight off a
       * colosseum that already puts thirty enemy blades in it. The second blade
       * ranks on brightness and distance like anybody else's.
       */
      lightPriority: 0,
    });
    this.saber.setGripScale?.(main.gripScale ?? 1);

    /**
     * THE SPAN, MEASURED OFF THE BUILT MESHES RATHER THAN TYPED.
     *
     * Two hilts pommel-to-pommel: the lower one is the SAME hilt flipped π
     * about the hand's forward axis and slid down the shaft by twice that
     * hilt's own `hiltFloor()` — which `Saber` already measures from the
     * geometry, because the ten hilts do not agree about where their metal
     * stops (a Graflex bottoms out 85 mm below the origin and a Shoto 54).
     *
     * So every hilt in the rack becomes a saberstaff for free, with no new
     * `HILT_SPECS` row — the table's ±15 mm `emitter` bound and its ten-row
     * silhouette check are untouched — and the span is whatever that hilt's own
     * metal makes it. Measured on the shipped rack: Graflex 0.480 m, Warden
     * 0.551 (the longest), Shoto 0.392 (the shortest).
     */
    const gs = main.gripScale ?? 1;
    /* × `gs` THROUGHOUT, WHICH THE FIRST TERM WAS MISSING. `hiltFloor` is
     * measured BEFORE the grip scale is applied — Saber.js says so where it
     * takes it: "so the number comes out in the same space `GRIP_AT` is written
     * in, the caller multiplies by `gs`" — and this caller did not. Unscaled,
     * a smallfolk's two pommels are placed 0.17 m apart while their hilts are
     * 0.10 m long, which is a shaft with a hole in it. `SHAFT.gap` takes the
     * same scale for the same reason: the bar is part of the weapon, and the
     * weapon is machined to the hand holding it. */
    this.offset = this.set.id === 'staff'
      ? (2 * (main.hiltFloor ?? -0.085) - SHAFT.gap) * gs : 0;
    this.span = this.set.id === 'staff'
      ? (main.emitterY ?? 0) - (this.offset - (this.saber.emitterY ?? 0)) : 0;

    /**
     * ── WHERE THE HANDS ARE ON THE SHAFT, AND WHERE THAT PUTS THE WEAPON ──
     *
     * `half` is the ring the orbit sweeps and the reach the front end has: the
     * weapon runs from `offset - emitterY` to `+emitterY + bladeLength` in the
     * main hilt's own frame, and its middle is `offset / 2` because both ends
     * are the same length. That middle is what the fists close on.
     *
     * `lift` IS THE WHOLE OF THE REACH and it is one sign flip away from being
     * nothing. Every set poses `saberRoot` at `control.handPos`; a staff poses
     * it `lift` metres FURTHER UP THE SHAFT, so the hands end up where the
     * controller put them and the front blade starts from above them. Hand to
     * tip is `emitterY + bladeLength + lift` — 1.51 m on a stock Graflex
     * against the single blade's 1.31, measured below rather than asserted.
     *
     * `gripLocal` is the same point back in the UNSCALED hilt units `GRIP_AT`
     * is written in, because that is the frame the arm block's fists are placed
     * in and it multiplies by `gs` itself.
     */
    this.lift = this.set.id === 'staff' ? -this.offset / 2 : 0;
    this.gripLocal = -this.lift / gs;
    this.half = this.set.id === 'staff'
      ? (main.emitterY ?? 0) + (main.bladeLength ?? 1.15) + this.lift : 0;

    /**
     * THE BAR BETWEEN THE TWO POMMELS, in the main hilt's own metal.
     *
     * Not parented to `main.root`: a mesh hung on the player's own saber would
     * ride into `Saber.dispose`'s traversal, into `Dropped`'s hand-off and into
     * the menu preview, none of which have ever had to know that a saber might
     * have a passenger. It is posed in `_poseStaff` beside everything else this
     * class poses, and it is the only mesh in the file.
     */
    if (this.set.id === 'staff' && this.offset < 0) {
      const spec = main.hiltSpec || {};
      const metal = (main.hiltMetals && (main.hiltMetals[spec.metal] || main.hiltMetals.steel)) || null;
      if (metal) {
        /* MEASURED OFF THE TWO PLACED HILTS AND NOT TYPED `SHAFT.gap`: the
         * lower hilt is flipped, so its own floor is its TOP, and what is
         * bare between them is `2·floor·gs − offset`. That is `SHAFT.gap` by
         * construction today and it stays right the day a hilt's pommel
         * changes shape. */
        const len = 2 * (main.hiltFloor ?? -0.085) * gs - this.offset;
        this.shaft = new THREE.Mesh(
          new THREE.CylinderGeometry((spec.r ?? 0.022) * SHAFT.radius * gs,
            (spec.r ?? 0.022) * SHAFT.radius * gs, Math.max(len, 0.01), 12, 1), metal);
        this.shaft.castShadow = true;
        this.shaft.visible = false;
        owner.world.scene.add(this.shaft);
        this._shaftMid = this.offset / 2;
      }
    }

    /**
     * ── THE PAIR'S OWN SPAN, AND WHY IT IS A SEPARATE FIELD ──────────────
     *
     * "maybe with dual wielding blocking bolts is easier or area that you can
     *  cover is larger … Dual-wielding lightsabers generally provides
     *  increased offensive capabilities and mobility, making it effective
     *  against multiple opponents"
     *
     * MEASURED WITHOUT THIS, and it is the finding that put the field here:
     * against one blade, the pair's tip-to-tip span was **−30%** and its extra
     * guard rose was **+0.0°**. It had a shorter second blade cutting at 55%,
     * one hand instead of two, and NOTHING back — the set was the single blade
     * with a handicap and a second hilt, which is exactly the "only better or
     * only worse" collapse the trade check exists to prevent, in the worse
     * direction.
     *
     * A STAFF'S SPAN IS METAL AND A PAIR'S IS ARMS, and that is why the two
     * cannot share one number. The staff's is the shaft: fixed, rigid, and
     * measured off the two built hilts (above). The pair's is how far apart
     * the two FISTS are carried — `GRIP_PAIR.R - GRIP_PAIR.L` scaled by the
     * carrier's own arm, because a small frame covers less ground with two
     * blades than a tall one does and the whole point of `reachScale` in
     * `GRIPS` is that the guard is held at arm's length.
     *
     * IT IS NARROWER THAN THE STAFF'S, which is right and is the trade: a
     * quarterstaff answers a wider rose than two short swords, and what the
     * pair buys instead is the free hand (`hands: 1`) and the blade it can
     * throw without disarming itself.
     */
    this.cross = this.set.id === 'pair'
      ? Math.abs((owner?.limbs?.arm ?? 1) * PAIR_CROSS) : 0;

    /**
     * THE OFF BLADE'S OWN THROW STATE, and it is a NEW FIELD rather than a
     * rewritten one. `Player.throwState` is read by nine places and every one
     * of them means "the weapon in your right hand is gone" — `handsOnHilt`,
     * the `wantOne` derivation, `_updateBlade`'s pose and heat-haze gates, the
     * arm block's gate, the attack gate, `swapSaber`, `_dropSaber`,
     * `_maybeDisarm` and the HUD's active wheel border. Making a throw not
     * empty your hands is a one-word change there and it would silently re-arm
     * the single blade in all nine. So the pair does not touch it.
     */
    this.throwState = 'held';           // held | flying | returning
    this.throwPos = new THREE.Vector3();
    this.throwVel = new THREE.Vector3();
    this.throwTimer = 0;
    this.throwSpin = 0;

    /** Held ONLY while the staff's orbit is up. See `Player._updateThrow`.
     *  `pivot` is where the bar is being spun about — published because
     *  `Player.bladeGuard` needs the disc's own centre and must not compute a
     *  second opinion about it. */
    this.orbitAngle = 0;
    this.orbitT = 0;
    this.pivot = new THREE.Vector3();

    this.hand = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this._posed = false;
  }

  /** True when the off blade is a weapon in a hand — the question
   *  `handsOnHilt` cannot express and must not learn. */
  get inHand() { return this.throwState === 'held'; }

  /** Both blades of this weapon, main first — the order `_bladeEntries`
   *  depends on, so the main blade is always the one credited with `auto`. */
  blades() { return [this.owner.saber, this.saber]; }

  ignite() { this.saber.ignite?.(); }
  retract() { this.saber.retract?.(); }
  /** …and the bar goes with the hilts, because it is the same metal. */
  setVisible(v) { this.saber.setVisible?.(v); if (this.shaft) this.shaft.visible = !!v; }

  /**
   * WHICH SEGMENT OF A STAFF IS IN FRONT.
   *
   * `GUARD.reach` is 100°, which already says you cannot guard behind you, so a
   * staff pushes exactly ONE extra blade entry — whichever end has the greater
   * dot with the aim — and a blade eating bolts behind your own back is not a
   * feature. Returns the main blade for a pair, which never asks.
   */
  frontBlade(aimDir) {
    const main = this.owner.saber;
    if (this.set.id !== 'staff' || !aimDir) return this.saber;
    const a = _s1.subVectors(main.tip, main.base).normalize().dot(aimDir);
    const b = _s2.subVectors(this.saber.tip, this.saber.base).normalize().dot(aimDir);
    return b > a ? this.saber : main;
  }

  /**
   * ONE FRAME OF THE SECOND WEAPON, and it is the same two public calls
   * everything else in this game drives a Saber with.
   */
  update(dt, ctx) {
    const p = this.owner;
    if (this.set.id === 'staff') {
      if (p.throwState === 'orbit') this._poseOrbit(dt);
      else this._poseStaff();
    } else if (this.throwState === 'held') {
      this._posePair(dt);
    } else {
      this._flyOff(dt, ctx);
    }
    this.saber.carrierVel = p.velocity;
    this.saber.update(dt, ctx?.time ?? 0, p.velocity);
  }

  /**
   * THE STAFF'S LOWER BLADE — the same hand point, a π flip about the hand's
   * FORWARD axis, and a slide down the shaft.
   *
   * The flip is about forward and not about the blade's own axis for the reason
   * `handPoseOnHilt`'s 119.6° palm repair records: the hilt's roll has to be
   * carried through the composition rather than reinvented, or the lower hilt
   * comes out rolled relative to the upper one and the two halves of what is
   * supposed to be one shaft do not line up.
   */
  _poseStaff() {
    const c = this.owner.control;
    _sq.setFromAxisAngle(_s1.set(0, 0, 1), Math.PI);
    this.quat.copy(c.quat).multiply(_sq);
    /* EVERYTHING IS MEASURED FROM THE MAIN HILT'S ORIGIN, WHICH IS NO LONGER
     * THE HAND. `Player._updateBlade` poses the front half `lift` up the shaft
     * so the fists close on the middle of it (see `lift` above), so the far
     * hilt is `lift + offset` from the hand rather than `offset` — one term,
     * and leaving it out is a staff whose two halves are 0.24 m apart. */
    _s2.set(0, this.lift + this.offset, 0).applyQuaternion(c.quat);
    this.hand.copy(c.handPos).add(_s2);
    this.saber.setHiltPose(this.hand, this.quat);
    this.saber.setVisible(true);
    this._poseShaft(c.handPos, c.quat, this.lift + this._shaftMid);
  }

  /**
   * The bar between the two pommels, at `at` up the shaft from the hand.
   *
   * IT IS SHOWN EXACTLY WHEN THE FRONT HILT IS. `Saber.setVisible` writes
   * `root.visible`, and the shaft is the same piece of metal as the hilt on
   * either end of it — so a blade put down, a body in a cockpit, or a hilt
   * hidden for any reason this class has never heard of takes the bar with it,
   * through the flag the shipped code already set. The alternative is a list of
   * conditions here that has to be kept level with `_updateBlade`'s, and the
   * one it would have missed on day one is the retract: the hilt goes at once
   * and the blade takes 0.3 s, so a bar answering `stow` would hang in the air
   * on its own for that long.
   */
  _poseShaft(handPos, quat, at) {
    const sh = this.shaft;
    if (!sh) return;
    _s3.set(0, at, 0).applyQuaternion(quat);
    sh.position.copy(handPos).add(_s3);
    sh.quaternion.copy(quat);
    sh.visible = this.owner.saber.root.visible;
  }

  /**
   * THE PAIR'S OFF BLADE — the main guard mirrored about the body's right axis
   * and dropped, driven along the main blade's own arc on the second beat.
   *
   * Enemy's shipped `_poseOffhand` rule, ported: mirror, drop by 0.28 while the
   * blade is at guard, and close that drop as `lag` runs to 1 so the second
   * blade comes UP under the first. The lag itself is that file's own measured
   * expression and is not re-derived here.
   *
   * The mirror is a REFLECTION, which is not a rotation — reflecting all three
   * axes of a right-handed basis gives a left-handed one, and a quaternion
   * built from it is garbage. So the blade axis and the forward axis are
   * reflected and the third is taken as their cross product, which restores the
   * handedness and is what makes the off hilt read as a hilt held the other way
   * up rather than as a mirror-image model.
   */
  _posePair(dt) {
    const p = this.owner, c = p.control;
    const chest = _s1.copy(p.chest);
    const right = _s2.set(1, 0, 0).applyQuaternion(p.camera.aimQuat).setY(0).normalize();
    if (!Number.isFinite(right.x) || right.lengthSq() < 1e-6) right.set(1, 0, 0);

    /* HOW FAR THROUGH THE ARC THE MAIN BLADE IS. `slash` is the controller's
     * own 0..1 envelope — it is already smoothstepped up and back down — so
     * this needs no second clock and cannot disagree with the animation. */
    const u = clamp(c.slash ?? 0, 0, 1);
    const lag = clamp((u - OFFHAND.lagStart) / OFFHAND.lagSpan, 0, 1);

    // The hand: mirrored about the right axis, dropped, and the drop closing as
    // the second beat arrives.
    const rel = _s3.subVectors(c.handPos, chest);
    rel.addScaledVector(right, -2 * rel.dot(right));
    rel.addScaledVector(UP, -OFFHAND.drop * (1 - lag));
    const target = _s4.copy(chest).add(rel);
    if (!this._posed) { this.hand.copy(target); this._posed = true; }
    this.hand.lerp(target, clamp(dt * OFFHAND.settle, 0, 1));

    // …and the orientation, reflected in the same plane.
    const y = _s5.set(0, 1, 0).applyQuaternion(c.quat);
    const z = _s6.set(0, 0, 1).applyQuaternion(c.quat);
    y.addScaledVector(right, -2 * y.dot(right)).normalize();
    z.addScaledVector(right, -2 * z.dot(right)).normalize();
    const x = _s1.crossVectors(y, z).normalize();
    _s2.crossVectors(z, x).normalize();
    _sm.makeBasis(x, _s2, z);
    _sq2.setFromRotationMatrix(_sm);
    this.quat.slerp(_sq2, clamp(dt * OFFHAND.settle, 0, 1));

    this.saber.setHiltPose(this.hand, this.quat);
    this.saber.setVisible(true);
  }

  /**
   * THE SHOTO IN THE AIR — the shipped throw, on the off blade's own state.
   *
   * `_updateThrow`'s body is set-agnostic once you hand it a saber, a position
   * and a velocity: 26 m/s along the aim, turning home after 1.5 s, and the
   * horizontal-disc pose through `setHiltPose`. The argument the shipped
   * cooldown note makes — that it starts when the blade is BACK IN THE HAND
   * rather than at release, because a cooldown that runs while the power is
   * still going off is a decoration — is form-independent, so it carries over
   * unchanged and `Player` writes `cooldowns.throwOff` at the catch.
   */
  _flyOff(dt, ctx) {
    const p = this.owner;
    this.throwTimer += dt;
    this.throwSpin += dt * 27;
    if (this.throwState === 'flying') {
      _s1.copy(p.aimDir).multiplyScalar(26);
      this.throwVel.lerp(_s1, clamp(dt * 1.4, 0, 1));
      this.throwPos.addScaledVector(this.throwVel, dt);
      if (this.throwTimer > 1.5) this.throwState = 'returning';
    } else {
      _s1.subVectors(p.control.handPos, this.throwPos);
      const d = _s1.length();
      if (d < 0.45) {
        this.throwState = 'held';
        this._posed = false;
        this.caught = true;
        return;
      }
      _s1.multiplyScalar(1 / d);
      this.throwVel.lerp(_s2.copy(_s1).multiplyScalar(clamp(d * 7, 12, 34)), clamp(dt * 7, 0, 1));
      this.throwPos.addScaledVector(this.throwVel, dt);
    }
    /* AND IT DOES NOT GO UNDER THE FLOOR — the shipped skim, for the shipped
     * reason: `Saber.update` calls `ground.scar(prevTip, tip)` on every lit
     * frame, so a buried blade gouges a trench nobody can see. */
    const terrain = ctx?.terrain || p.world?.terrain;
    if (terrain) {
      const gh = terrain.height(this.throwPos.x, this.throwPos.z) + 0.34;
      if (this.throwPos.y < gh) {
        this.throwPos.y = gh;
        if (this.throwVel.y < 0) this.throwVel.y = 0;
      }
    }
    _sq.setFromAxisAngle(UP, this.throwSpin);
    _sq2.setFromAxisAngle(_s1.set(1, 0, 0), Math.PI / 2);
    this.hand.copy(this.throwPos);
    this.quat.copy(_sq.multiply(_sq2));
    this.saber.setHiltPose(this.throwPos, this.quat);
    this.saber.setVisible(true);
  }

  /**
   * THE SPIN BARRIER — the whole staff turned about its middle, hands free.
   *
   * The whole trick is that this is the THROW MACHINE and not a new one: the
   * blades are driven by `setHiltPose` exactly as the flying disc already is,
   * they stay in `_bladeEntries` and in the target sweep, and so they deflect
   * and cut through the ORDINARY paths at the ORDINARY prices. Not immunity,
   * and no bolt skips `gradeCaught`.
   *
   * WHAT THE SWEEP ALONE COULD NOT DO, because this note used to claim it did.
   * Driven — twenty-four bolts at the chest, full bar — the sweep answered ONE
   * of them, and the shape of that failure is worse than the number: a rotor
   * catches `ω / (π·f)` of what crosses it, so it protected twice as well at
   * 30 Hz as at 60. So the ring publishes the shipped auto-guard descriptor
   * through `Player.bladeGuard` — the same `{ origin, axis, cone, radius }`
   * `CatchWindow.guard()` has handed `guardIntercept` since long before any of
   * this, for the case of *a blade covering you while you look elsewhere*. Not
   * a new absorb shape: an existing one, sized to this weapon. 0 of 24 through
   * now, at the ordinary price and the worst rung, with no PARRY and no RETURN.
   *
   * "Hands free" costs nothing to build, and it is the part of the player's
   * brief the shipped code already answers: `handsOnHilt()` returns 0 for
   * `throwState !== 'held'`, so both fists come off the hilt through a reader
   * that shipped years ago, `_openPalm` opens the left palm through the path
   * that already exists, and all thirteen left-handed GESTURES become available
   * with the whole arm. Measured: 0 hands on the hilt, and a push cast mid-spin
   * spends its 16 Force and leaves the staff turning.
   *
   * The two halves are π apart on ONE pivot, which is what a rigid staff spun
   * about its middle is — so each is a segment turning about its own base, the
   * base is still and the tip is fast, and `speedAt` stays monotone exactly as
   * it is in the hand. See ORBIT for the two-blade carousel this replaced.
   */
  _poseOrbit(dt) {
    const p = this.owner;
    this.orbitT += dt;
    this.orbitAngle += dt * ORBIT.rate;
    const grow = clamp(this.orbitT / ORBIT.rise, 0, 1);
    const fwd = _s1.set(0, 0, -1).applyQuaternion(p.camera.aimQuat).setY(0).normalize();
    if (!Number.isFinite(fwd.x) || fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    const right = _s2.crossVectors(fwd, UP).normalize().negate();
    const a = this.orbitAngle;
    /**
     * ── THE DISC FACES THE THREAT, AND THE FIRST VERSION OF IT DID NOT ────
     *
     * MEASURED on the shipped arrangement: ten bolts fired at the chest from
     * ten bearings round the player, with the spin up and a full bar — **8.5 hp
     * through, against 8.5 hp with no spin at all.** The barrier stopped
     * nothing, and not because it was not in `_bladeEntries`: because a bar
     * spinning in the HORIZONTAL plane at chest height is COPLANAR with a bolt
     * flying flat at chest height. `intersectBladeSweep` gets a swept quad and
     * a segment lying inside it, and the two only ever meet if the bar happens
     * to be within a frame of crossing that one line. Everything else goes
     * between the ends.
     *
     * One rigid bar can only cover ONE plane, so the plane has to be the one
     * threats arrive through: the disc's normal is the SIGHTLINE, and the staff
     * turns like a propeller in front of you. Every bolt on its way to your
     * chest crosses it, which is the whole of what "a protective barrier" is
     * and it is now 0.0 hp through where it was 8.5. It also gives the thing a
     * shape a player can read and beat: come at a spinning staff from the side
     * and it is a bar edge-on, exactly as it looks.
     *
     * AND IT DOES NOT DIG. The disc is 1.54 m in radius about a chest 1.35 m
     * off the ground, so a third of it would be underground and both blades
     * would call `ground.scar` on every lit frame — the same defect `_flyOff`'s
     * skim exists for, with the trench in plain view this time. The pivot rides
     * up until the low tip clears by `ORBIT.clear`, which puts the spin about
     * the shoulders on flat ground and keeps the disc covering the whole body
     * rather than the head.
     */
    const gy = (p.world?.terrain?.height?.(p.chest.x, p.chest.z) ?? (p.position?.y ?? 0));
    const pivot = _s6.copy(p.chest);
    pivot.y = Math.max(pivot.y, gy + this.half + ORBIT.clear);
    pivot.lerpVectors(p.control.handPos, pivot, grow);
    this.pivot.copy(pivot);
    const blades = [p.saber, this.saber];
    for (let i = 0; i < 2; i++) {
      /* `lift + offset === -lift` by construction — the middle of a bar with
       * equal ends is equidistant from both — so the two hilt origins are
       * `pivot ± lift·dir` and this is symmetric rather than two cases. It is
       * the same `lift` `_poseStaff` uses, so the weapon spinning in the air
       * is dimensionally the weapon that was in the hands. */
      const dir = _s5.copy(right).multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a));
      if (i === 1) dir.negate();
      dir.normalize();
      _sq.setFromUnitVectors(UP, dir);
      const at = _s3.copy(pivot).addScaledVector(dir, this.lift);
      blades[i].setHiltPose(at, _sq);
      blades[i].setVisible(true);
      if (i === 1) { this.hand.copy(at); this.quat.copy(_sq); }
    }
    /* The bar itself is centred ON the pivot — that is what "gripped in the
     * middle" means — so it is posed there with the leading half's own frame
     * and no offset up the shaft. */
    _sq.setFromUnitVectors(UP, _s5.copy(right).multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a)).normalize());
    this._poseShaft(pivot, _sq, 0);
  }

  dispose() {
    this.saber?.dispose?.();
    this.saber = null;
    if (this.shaft) {
      this.shaft.parent?.remove(this.shaft);
      this.shaft.geometry?.dispose?.();
      /* THE MATERIAL IS THE MAIN HILT'S AND IS NOT DISPOSED HERE. It was
       * machined by `buildHiltGroup` for that weapon and `Saber.dispose` owns
       * it; freeing it from the passenger would take the hilt's metal out from
       * under the hilt. */
      this.shaft = null;
    }
  }
}
