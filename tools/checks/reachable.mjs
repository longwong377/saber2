/**
 * ══════════════════════════════════════════════════════════════════════════
 *  REACHABLE — an exported function nothing calls is a feature nobody has
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE DEFECT CLASS, AND WHAT IT HAS ACTUALLY COST ──────────────────────
 *
 * A function can be written, reviewed, documented at length, covered by a
 * green check and still be absent from the game, because the one thing none
 * of that establishes is that anything CALLS it. The audit that produced this
 * file found four in one sweep, and every one of them was a sentence the
 * player had asked for:
 *
 *   `StationLife.servedHere`   SHARK §11: *"the kiosks refuse you for a
 *                              day."* The number was dropped, stored and read
 *                              — and no counter ever asked, so you could put
 *                              the concourse in the medbay and still buy a
 *                              hilt off the man watching you do it.
 *   `StationSave.markSeen`     SHARK §14's once-only guide. `seen` was a
 *                              store with no writer, so nothing on this
 *                              station had ever been "seen" — and
 *                              `stationDay` read `seen.length` as part of its
 *                              arithmetic, which is how a dead export became
 *                              a frozen calendar.
 *   `Medbay.conditionRow`      V16 §C1, written in `Company.dossier`'s shape
 *                              with a comment saying so. A man at a tenth of
 *                              his health had a roll page that listed every
 *                              number about him except that one.
 *   `FlightOps.certLines`      the three cert rungs "for a banner or a page"
 *                              — a page SHARK §14 forbids. Deleted, with the
 *                              argument written into `FlightOps.js`.
 *
 * The same shape has bitten this tree before and left its scars in other
 * files: `main.js`'s `closeKiosk` note (*"had ZERO CALLERS in the whole tree,
 * which is how the keystone item of V16 §A1 came to be finished, checked,
 * green and unreachable"*), and `tools/checks/_shipped.mjs`, which walks the
 * module graph from `main.js` because `Games.js` and `Quests.js` were both
 * finished and both absent from every build ever shipped.
 *
 * `_shipped.mjs` asks whether a FILE is in the bundle. This asks the question
 * one level down: whether a FUNCTION in that file is reached from anywhere at
 * all. A module can be in the graph for one export and carry six dead ones.
 *
 * ── NOTHING BELOW IS A LIST OF NAMES TO KEEP IN STEP ─────────────────────
 *
 * Both halves are derived by parsing `src/`. The exports come out of the
 * `export function` / `export const f = () =>` forms in `src/game/*.js`; the
 * callers are every other mention of that identifier anywhere under `src/`,
 * with comments stripped first so a docstring ABOUT a function does not count
 * as a call. Rename a function and both sides move together, which is the
 * only reason a check like this survives contact with a refactor.
 *
 * A MENTION AND NOT A CALL GRAPH, deliberately. Resolving `Company.dossier`
 * through `import * as Company`, `import { dossier as companyDossier }` and
 * `M[name]()` properly means writing a resolver, and a resolver that is
 * slightly wrong fails in the direction that costs the most: it reports live
 * code as dead and gets ignored. The identifier scan cannot do that — a name
 * that appears NOWHERE under `src/` outside its own declaration is dead under
 * any resolver — and it is the assertion this file makes.
 *
 * ── THE LIST, AND WHY IT IS TWO LISTS ────────────────────────────────────
 *
 * `SEAMS` is the deliberate half: doors that exist for the harness and for
 * nothing else. `Bodies.seedBodies` and its eight siblings are the seams
 * `determinism.mjs` tells suites to use by name; the `clear*` family is how a
 * check gets a clean store. Each carries its reason.
 *
 * `RESIDUE` is the honest half. It is what the sweep found and this pass did
 * not have the standing to wire or delete — sixty-odd exports across files
 * owned by other lanes. It is written down rather than quietly excluded so
 * that the number is visible, and it is bounded: `CENSUS` may only fall. A
 * NEW dead export is not in either list and fails on the commit that writes
 * it, which is the whole point and the only moment it is cheap.
 */

import { readdir, readFile } from 'node:fs/promises';

const SRC = new URL('../../src/', import.meta.url);

/** Comments are prose and may name anything. `flightops.mjs` strips the same
 *  way and for the same reason: only code counts as a caller. */
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every `.js` under `src/`, as [path, code]. */
async function sources(dir = SRC, out = []) {
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) await sources(u, out);
    else if (e.name.endsWith('.js')) out.push([u.pathname.slice(SRC.pathname.length), code(await readFile(u, 'utf8'))]);
  }
  return out;
}

/**
 * THE TWO FORMS AN EXPORTED FUNCTION IS WRITTEN IN, in this tree and no
 * others: `export function f` / `export async function f`, and
 * `export const f = (…) => …` / `= function` / `= x => …`. `export const` of
 * a TABLE is not a function and is not swept — a frozen array with no reader
 * is a different and much weaker complaint.
 */
const EXPORTED = new RegExp(
  'export\\s+(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)'
  + '|export\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?'
  + '(?:function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)', 'g');

/* ══════════════════════════════════════════════════════════════════════════
 *  THE DELIBERATE SEAMS — each one is a door the harness needs and the game
 *  does not, and each one says why it may stay.
 * ══════════════════════════════════════════════════════════════════════════ */
const SEAMS = new Map(Object.entries({
  /* THE SEEDING DOORS. `determinism.mjs` names this pattern in as many words:
   * "a suite that wants a repeatable wave still has to call `seedWaves`
   * itself". A stream that cannot be seeded from a check is a stream whose
   * measurements are whatever the previous suite left. */
  'Bodies.js::seedBodies': 'the harness seeds the body stream — determinism.mjs',
  'Bolts.js::seedBolts': 'the harness seeds the bolt stream — determinism.mjs',
  'Cloth.js::seedCloth': 'the harness seeds the cloth stream — determinism.mjs',
  'Extraction.js::seedExtraction': 'the harness seeds the extraction stream',
  'Games.js::seedGames': 'the harness seeds the card and wheel streams',
  'Player.js::seedPlayerRng': 'the harness seeds the player stream',
  'Ragdoll.js::seedRagdoll': 'the harness seeds the ragdoll stream',
  'Spectacle.js::seedSpectacle': 'the harness seeds the spectacle stream',
  'Vehicles.js::seedVehicles': 'the harness seeds the vehicle stream',
  'World.js::seedWorld': 'the harness seeds the world stream',

  /* THE V18 MEASUREMENT DOORS — each is the live state a check reads or the
   * pure function an assertion is about; none has a screen. */
  'Games.js::sabaccPays': 'the pay table games.mjs asserts the betting round against',
  'Holonet.js::scheduleFor': "a day's programme grid, which holonet.mjs asserts never repeats",
  'Follower.js::curiousPoint': "regulars.mjs reads where the day's curious walker stands",
  'Form.js::overroundOf': "form.mjs asserts the book's overround off the printed odds",
  'Healing.js::wardCount': 'healing.mjs reads the ward count falling as men walk out',
  'Regulars.js::isRegular': 'regulars.mjs asks the ledger directly',
  'StationSound.js::bedLevels': 'the gain nodes healing/sound checks assert the crossfade on',
  /* V20's measurement doors: the lanes' checks read these and nothing else does. */
  'Gestures.js::poseGesture': 'gestures.mjs poses one body to measure a gesture',
  'Music.js::scoreNow': 'voice.mjs reads the score state',
  'Music.js::scoreLog': 'voice.mjs reads the score transitions',
  'StationDuel.js::clearDuelCards': 'duel.mjs starts from no card',
  'StationDuel.js::duelState': 'duel.mjs reads the bout',
  'StationDuel.js::duelBoard': "duel.mjs reads the tote's duel board",
  'Verbs.js::verbsFold': 'verbs.mjs reads the fold',
  'Voice.js::pitchRange': 'voice.mjs measures a voice',
  'Voice.js::voiceFree': 'voice.mjs asserts the queue',
  'Voice.js::speechLog': 'voice.mjs reads what was said',
  'Voice.js::resetVoices': 'voice.mjs starts silent',
  'Music.js::inMode': 'music.mjs asserts every note of a tune is in its mode',
  'Music.js::barShape': 'music.mjs asserts the A A B A phrase shape',
  'Music.js::musicLevels': 'the band and busker gain nodes music.mjs measures the falloff on',

  /* THE CLEAN STORE. `StationSave.clearStation`'s own comment is the reason
   * for all six: "Start again. Only a check calls this." A durable key with
   * no reset makes every store check depend on the run before it. */
  'Bench.js::clearBench': 'a check starts from an empty bench',
  'Credits.js::clearCredits': 'a check starts from an empty purse',
  'Progress.js::clearProgress': 'a check starts from no progress',
  'Quests.js::clearWork': 'a check starts from an empty ledger',
  'StationSave.js::clearStation': 'a check starts from a fresh station',
  'Tote.js::clearTote': 'a check starts from an empty tote',

  /* THE CORRUPTION PROBES. A store that cannot be asked "did you come back
   * broken" is a store whose migration path is untested. */
  'Credits.js::creditsBroken': 'the harness asks whether the purse survived a bad write',
  'StationSave.js::stationBroken': 'the harness asks whether the fold survived a bad write',

  /* THE INSTRUMENTS. Off in the game by construction; the only caller is the
   * thing measuring. */
  'Bodies.js::setAssemblyProbe': 'the assembly probe, installed by a check and never by the game',
  'Reactions.js::resetReactionStats': 'the reaction census, zeroed between measurements',

  /* ══ AND FIVE MOVED OUT OF THE RESIDUE, ONE ARGUMENT EACH ═══════════════
   *
   * This list is uncapped and `CENSUS` does not count it, so moving a name
   * here is the cheapest way to make the number fall while nothing is fixed —
   * which is why the bar is not "a check calls it" (that is true of most of
   * the residue) but "the SHAPE of the thing is a measurement, and a player
   * reading it would be reading an instrument". Every export below is either
   * an assertion's own subject or a reader that exists so a check does not
   * have to carry a second copy of the arithmetic it is checking. Anything
   * whose stated purpose was a screen, a page or a line a player was meant to
   * see stayed in the residue, however harness-only its callers are today —
   * a feature nobody can reach is the debt this file was written to show, and
   * relabelling it a seam is how that debt would disappear.
   */

  /* THE PROPERTY ITSELF, exported for the reason its own header gives:
   * "a property that only exists inside a test is a property the game does
   * not have". `arrivals.mjs` asserts every arrival kind against it; nothing
   * in play needs to ask, because the placement code IS the answer. */
  'Arrivals.js::deliveryIsAnnounced': 'the arrival invariant, asserted by arrivals.mjs — its own header says why it is exported',

  /* THE CPU-SIDE READER OF WHAT THE GPU DRAWS. `cohortPose()` in `POSE_GLSL`
   * addresses the same texels with the same two terms; `frame-budget.mjs`
   * rasterises THROUGH this and fails if either term leaves the shader. A
   * check that computed the pose itself would be the defect `_glsl.mjs`
   * exists over — it would pass while the shader diverged. */
  'Cohorts.js::poseMatrix': 'the only way anything without a GL context can read a cohort\'s pose — frame-budget.mjs',

  /* A COMPARISON SHAPE AND NOT A READING. `worn-paint.mjs` diffs an Enemy
   * against a parade figure of the same man; this is the sorted
   * `slot:region=vertices` list it diffs. There is no screen this belongs on:
   * a player looking at a man sees the paint. */
  'Command.js::paintReport': 'the shape worn-paint.mjs compares an Enemy against a parade figure with',

  /* HANDED TO THE CHECK RATHER THAN REBUILT INSIDE IT. `starfury.mjs` holds
   * this file against `assets/station/starfury_manifest.json`, and its own
   * note names the rule: "a check that rebuilds the thing it is checking
   * cannot fail" (HANDOFF §2.3b). */
  'Starfury.js::mountTable': 'the nine mounts as the manifest names them, so starfury.mjs need not re-derive them',

  /* THE BUILD, DRAINED IN ONE GO, and the file says so where it stands: "For
   * a caller that wants the station as it stands when somebody has been
   * looking at it — a screenshot, a census, a check that asserts on the world
   * it just booted without stepping it. Play never calls this: play steps."
   * A declared seam that was filed as residue by mistake. */
  'Station.js::finishStationBuild': 'the whole build at once, for a check that asserts on a world it has not stepped — play steps',
  /* V19 addition 4, `coopgames.mjs`: the four readings its assertions are made
   * on. The guest's cards against the host's deal (`tableView`), the showdown each
   * machine saw (`lastHand`),
   * the crate on each machine and where it is on its journey (`crateOf`,
   * `carryState`). Every one is a reading; the key and the wire are the play. */
  'CoopGames.js::tableView': 'what seat 1 was dealt, on the host — coopgames.mjs compares it to the guest\'s hand',
  'CoopGames.js::lastHand': 'the showdown this machine saw — coopgames.mjs settles the two purses against it',
  'CoopGames.js::crateOf': 'the crate body on this machine — coopgames.mjs lifts it and watches it go',
  'CoopGames.js::carryState': 'hold / aboard, and whose hands are on — coopgames.mjs drives the journey by it',

  /* ══ AND TWELVE MORE, ON THE SAME BAR AND ONE ARGUMENT EACH ════════════
   *
   * The note above is the rule and it has not moved: a seam is an INSTRUMENT —
   * the subject of an assertion, or the arithmetic a check would otherwise
   * carry a second copy of — and anything whose stated purpose was a screen
   * stayed in the residue however harness-only its callers are. Twelve of the
   * thirty-seven were measurements wearing a docstring; the rest were wired or
   * deleted.
   */

  /* THE HOUSE'S EDGE, MEASURED RATHER THAN DECLARED, and their own headers say
   * so. `drumEdge` is what caught the Drum paying the player 63%; `drumTicketEdge`
   * measures the WINDOW rather than the wheel, and the two were 90 points apart
   * for the life of the panel because only one of them was ever run. A player
   * cannot read a Monte Carlo of twelve thousand spins; the PRICE is what the
   * room shows them and the price is already on the board. */
  'Games.js::drumTicketEdge': 'the edge along the path the window walks, measured over 12000 tickets — games.mjs',
  'Games.js::drumEdge': 'the edge on one kind of bet, measured rather than declared — games.mjs',

  /* THE ASSERTION'S OWN SUBJECT. `priceTemper` has one property — it MUST NOT
   * BE POSITIVE, or a temper is a free upgrade — and its note names the check
   * that drives it over the real table rather than transcribing four numbers. */
  'Kennel.js::priceTemper': 'what a temper is worth NET, which must never be positive — attributes.mjs drives it over the table',

  /* THE TRACK, MEASURED, and the header states the rule it exists to keep:
   * `flightops.mjs` prints the tightest clearance and the closest approach to
   * each of the five "rather than this file declaring that the circuit is
   * clear". A declaration is what it replaces. */
  'Outside.js::survey': 'the sortie track measured end to end, so flightops.mjs asserts rather than this file declaring',

  /* THE CLOSED FORM OF A DRIVER THAT RUNS ON THE FRAME. `Saber.stepTemper`
   * integrates x' = (want − x)·rate every frame; this is that ODE solved for t,
   * and a check that timed the blade by stepping it would be measuring the
   * integrator's step size. What a player reads is the WORD, which is now on
   * the HUD — see `Order.orderReadout` and `#hud-order`. */
  'Order.js::temperTime': 'the temper driver solved for time — the check quotes it and Saber.js runs the integral',

  /* THE FAULT LIST IS THE INVARIANT. Both headers say it outright: "exported
   * rather than asserted here so tools/checks can state it as a check over the
   * shipped table, and so a mod adding rows gets the same reading". A duplicate
   * or prefixed code is silent at runtime; the sentence this returns IS the
   * only form the defect has. */
  'Stratagems.js::codeFaults': 'every way the code table can be silently wrong, as sentences — stratagems.mjs asserts the list is empty',
  'Stratagems.js::phraseFaults': 'the same for the phrase table — a call that spells in five and says four',

  /* THE LIVE STATE THE SIGHT MODEL READS, and the reason it must be the live
   * one: `depthAlong` is the single answer to "what got through", and the whole
   * argument of `setAir` is that there is exactly ONE weather number. A check
   * holding its own copy of the cloud list, or its own idea of the air, would
   * be asserting about a second storm. */
  'Smoke.js::smokeClouds': 'the live cloud list the sight model reads — a copy would be a second storm',
  'Smoke.js::airDepth': 'the one number the storm writes and depthAlong reads — weather.mjs asserts it is zero in calm air and in every mode',

  /* THE PREDICATE THE PLACEMENT INVARIANTS ARE STATED IN. `Hangar.DECK_ZONES`
   * partitions the deck and `clearOf` — its padded sibling, which the game
   * uses — is built on the same test; `decklife.mjs` and `deckcast.mjs` assert
   * that no guard stands in the player's path and that every pad is on the
   * apron, in exactly these terms. `Command.paintReport`'s seam, one file over. */
  'Hangar.js::inZone': 'is this point in the named zone — the terms decklife.mjs and deckcast.mjs state every placement rule in',

  /* THE CONTROLLER'S OWN CLASSIFIER, from a world direction. `Bolts.js` keeps a
   * SECOND copy of the rose table so it needs no dependency on the controller,
   * and `directional.mjs` drives this against that copy down every zone's own
   * axis — "two copies of a table is exactly how a partition silently stops
   * partitioning". The partition is the invariant and this is one side of it. */
  'SaberController.js::zoneOfDir': 'the controller\'s rose read from a world direction, driven against Bolts\'s copy — directional.mjs',

  /* THE SEQUENCE'S OWN LENGTH. `beatSheet` is a table and this is the fold over
   * it; `endings.mjs` times a run's ending against the flight and would
   * otherwise carry a second copy of the beat table to do it. Nothing shows a
   * player a number of seconds: what they see is the flight. */
  'Extraction.js::extractionSeconds': 'the beat sheet folded to its own total, so endings.mjs need not re-fold it',
}));

/* ══════════════════════════════════════════════════════════════════════════
 *  THE RESIDUE — what the sweep found and this pass did not wire or delete
 * ══════════════════════════════════════════════════════════════════════════
 *
 * These are NOT approved. They are recorded, so the number is a number and
 * not a shrug, and every one of them is the same question the four fixed
 * exports were: what did somebody ask for that this was written to serve, and
 * why does no player reach it? Each is owned by a lane this pass may not
 * edit. Wiring one, or deleting it with the argument written into its file,
 * means taking its line out of this list — which is the only direction
 * `CENSUS` moves.
 *
 * ── AND THE FOUR THAT ARE LEFT, EACH WITH THE REASON IT IS STILL HERE ────
 *
 * `Progress.progressLines` IS THE ONLY ONE OF THE THIRTY-SEVEN THAT WAS
 * DELIBERATELY UNWIRED, and it is why it may not simply be re-wired. It says
 * "for the menu" and the menu DID call it: `showRecord()` wrote it under the
 * title on every return to the front screen, and it was cut on instruction —
 * *"under the name of the game in the main menu you have a bunch of little
 * white text describing a bunch of bullshit like your progress … I want you to
 * remove it completely"* (the whole argument is in `main.js` where the writer
 * stood). Putting it back on the front screen would undo that; putting it on a
 * second screen instead is the shape §14 forbids — the station adds no
 * interface. The record HAS a surface the player asked for and it is a place:
 * `#56 The Standing`, the obelisk, which reads `Progress` and cuts the rows
 * into stone. What is owed here is either a reading on that column or the
 * deletion of the six fields `progressLines` alone renders, and neither is a
 * line of code — so it stays counted.
 *
 * `Levels.templeColonnade` IS A DECLARED ORPHAN and `roster.mjs` requires the
 * word by name, so that the next orphan has to be declared instead of found.
 * Its room — the Temple — was deleted in the roster cull; the 126 lines of
 * instanced order are the only shaft/base/capital/entablature vocabulary in the
 * tree and §4's list of permitted interiors has not shrunk. Deleting it fights
 * a check that exists on purpose; wiring it means building a room. It is the
 * one entry here whose debt is a ROOM and not a line.
 *
 * `DeckFlight.flightPhase` and `Duel.guardToWorld` are the two this pass could
 * not honestly place. `flightPhase` is a getter over a private state machine —
 * no arithmetic, so the seam bar's "a second copy of the arithmetic" does not
 * reach it, and the only screen it could feed is the ramp, where `Hangar.js`
 * would have to import `DeckFlight.js`, which imports `Hangar.js`.
 * `guardToWorld` is `dir.applyQuaternion(guardQuat(yaw, spin)).normalize()` and
 * `guardQuat` is exported beside it — a second door by the letter of the
 * sixteen deletions — but `Duel.shape` hoists the quaternion out of a
 * per-vertex loop, so wiring it costs a frame budget and deleting it means
 * respelling four sites in two duel suites for one point. Written down rather
 * than dressed up.
 */
const RESIDUE = [
  'DeckFlight.js::flightPhase',
  'Duel.js::guardToWorld',
  'Levels.js::templeColonnade',
  'Progress.js::progressLines',
];

/**
 * What the sweep read on the day this file was written. It may only fall.
 *
 * 64 → 37 → 4.
 *
 * ── THE PASS THAT TOOK 37 TO 4 ───────────────────────────────────────────
 *
 * THIRTEEN WERE WIRED, and the two the previous pass named as owing a decision
 * are both among them:
 *
 *   `Spectacle.formBook` +          the tote's whole measured form-reader edge
 *   `researchedProbabilities`       — +4.11 / +8.33 / +7.15% at the three
 *                                   windows — ran only inside `_tote-edge.mjs`,
 *                                   so the game's strongest claim about its own
 *                                   betting room was true of a bettor who did
 *                                   not exist in it. `Tote.boardFor` now carries
 *                                   `book` and `readP` on every row and the
 *                                   window prints both: the form book's own
 *                                   rows (record and public strength included,
 *                                   which the hand-spelled line threw away) and
 *                                   the reader's probability beside the house's.
 *                                   Information, never an auto-bet.
 *   `Medbay.tankLocal`              the ward's glass had two spellings and the
 *                                   one that could be checked was the one
 *                                   nothing drew. THE CHECK MOVED FIRST:
 *                                   `medbay.mjs` used to regex `tankrow`'s loop
 *                                   out of StationKit's source, which is what
 *                                   made the one-line fix unparseable and got it
 *                                   reverted once already. It now BUILDS the
 *                                   room and reads the glass back out of the
 *                                   kit, so the row may be spelled any way at
 *                                   all — and `tankrow` calls `tankLocal`.
 *   `Order.orderReadout`            "what the HUD should say about the order
 *                                   right now", with no caller: the Grey blade
 *                                   tempers as you swing, moves `cutPower` and
 *                                   `returnCone` as it goes, and nothing on the
 *                                   screen said so. `#hud-order` says it.
 *   `Company.bondWorth`             the one page that talks about bonding could
 *                                   not say what a bond is worth. It says it now,
 *                                   both halves, in the army's own words.
 *   `Holodeck.heldPrograms`         "the list the door is allowed to use" — and
 *                                   the door was asking `rack()`, which
 *                                   deliberately includes what you have not
 *                                   earned.
 *   `Holodeck.blankHold`            `main.js` was building the hold as an object
 *                                   literal of its own.
 *   `Spectacle.momentsOf`           the window told you who won and by how much;
 *                                   it now tells you how, at `called` and never
 *                                   before it.
 *   `Food.kitchens`                 the larder said "there is a food court on
 *                                   deck 40" — a room number typed into a screen,
 *                                   which is the exact thing `kitchens`' own
 *                                   note refuses.
 *   `Quests.pinnedGivers`           nothing told the player the giver who owes
 *                                   them money does not reroll in the morning.
 *   `Home.homeRecord` +             `Coop.apartments` was spelling three fields
 *   `Coop.apartment`                of `world._home` itself and `noteApartment`
 *                                   was spelling the one-peer lookup itself.
 *   `DeckLift.liftPick`             the words in the car's notification and the
 *                                   words on its plate were two readings.
 *
 * EIGHT WERE DELETED, and every one was the shape the sixteen before them
 * were — a SECOND DOOR onto something that already had one:
 * `Combat.gradeDeflection` over the capture-then-grade pair `World.js` runs
 * separately (and must, because a contact is frozen and graded frames later),
 * `Company.trooperOf` over `roster.enlistRecord` for a caller that could not
 * exist because it took the roster as an argument, `DeckFlight.rampFoot` over
 * `rampSpot(world, 0)`, `DeckEdit.renameMan`/`paintMan`/`attachPart` over the
 * one generic `applyEdit` line the deck actually spends every edit through,
 * `Order.crystalAt` over a row every caller already holds, and
 * `Attributes.profileMean`, whose two named consumers were a screen that orders
 * by `fieldable` and a `bestFirst` that does not exist — and which could not be
 * wired to the one ordering left, because deciding who deploys off a mean of
 * eight attributes is the "rating that decides who is best" its own second
 * sentence forbids.
 *
 * TWELVE MOVED TO `SEAMS`, on the bar the note over that list sets and with an
 * argument each: the two `drum*Edge` measurements, `priceTemper`, `survey`,
 * `temperTime`, `codeFaults`, `phraseFaults`, `smokeClouds`, `airDepth`,
 * `inZone`, `zoneOfDir` and `extractionSeconds`. Not one of them has a screen
 * in its docstring; every one is either an assertion's own subject or the live
 * state a measurement reads.
 *
 * ── AND THE PASS BEFORE IT ───────────────────────────────────────────────
 *
 * Seventeen were closed on the pass that wrote 37 down —
 * sixteen deleted with the argument left standing in the file where the
 * function was, and one WIRED: `Combat.zoneTolerance` was "one function so the
 * ladder cannot drift", and `SaberController` was doing the multiplying and
 * the adding itself, so the sentence described a coincidence and
 * `directional.mjs` was measuring the game against a formula the game did not
 * run. It runs it now.
 *
 * Five more came off because they had already been wired by other passes and
 * this list had not caught up (`Games.playDejarik`, `Food.gearFor`,
 * `Impact.disarmKinetic`, `Tote.racesOn`, `DeckBattle.deckBattleState`), and
 * five moved to `SEAMS` with an argument each — the note over them explains
 * what had to be true to allow it and what deliberately was not allowed.
 *
 * THE SIXTEEN DELETIONS WERE ALL ONE SHAPE and it is worth naming, because it
 * is the shape that keeps arriving: a SECOND DOOR ONTO SOMETHING THAT ALREADY
 * HAD ONE. `attrById` over `ATTR_BY_ID.get` (which three functions beneath it
 * were already calling), `capeCut`/`tabardCut`/`sashCut`/`fleshMotion`/`topCut`
 * over five maps every builder reads directly, `gripFrame` over `man.grip`,
 * `isSoldier` over a field this file tests four other ways, `roomReady` over
 * `Station.roomOf` — and `roomReady` is the one to remember, because it was
 * not merely redundant: it returned `_cache.has(url)`, which is true from the
 * FIRST byte of the fetch, under a docstring promising it was true from the
 * last. A level that had trusted it would have dressed itself against
 * geometry still on the wire. The only reason that never happened is that
 * nothing called it, which is the argument for this whole file in one line: a
 * function nothing calls is not a function that works.
 *
 * WHAT IS LEFT IS NOT THE SAME SHAPE. Most of the thirty-seven below have a
 * harness caller and a stated purpose that names a screen — `progressLines`
 * ("for the menu"), `homeRecord` ("§3.2's parcels desk"), `formBook` and
 * `researchedProbabilities` (the tote's whole measured edge, implemented only
 * in `_tote-edge.mjs`). Those are features nobody can reach, and the number
 * stays honest only while they are counted as such.
 */
const CENSUS = 4;

/** Every exported function in `src/game/*.js` that nothing under `src/` names. */
async function uncalled() {
  const files = await sources();
  const game = files.filter(([p]) => /^game\/[^/]+\.js$/.test(p));
  const out = [];
  let total = 0;
  for (const [path, text] of game) {
    const name = path.slice('game/'.length);
    EXPORTED.lastIndex = 0;
    let m;
    while ((m = EXPORTED.exec(text))) {
      const fn = m[1] || m[2];
      total++;
      const re = new RegExp(`\\b${fn}\\b`, 'g');
      let seen = 0;
      for (const [q, body] of files) {
        const n = (body.match(re) || []).length;
        /* Its own declaration is not a caller; everything else in its own file
         * is — a function reached from the module's own entry point is reached
         * by whoever reaches the module. */
        seen += q === path ? Math.max(0, n - 1) : n;
      }
      if (seen === 0) out.push(`${name}::${fn}`);
    }
  }
  return { dead: out, total, files: game.length };
}

export async function run({ check, assert }) {
  check('reachable: every exported function in src/game reaches a caller or is a named seam', async () => {
    const { dead, total, files } = await uncalled();
    /* THE EMPTY-LIST REFUSAL. `determinism.mjs` files this shape under "a
     * missing thing answered with a plausible default": a readdir that
     * returned nothing, or a regex that stopped matching, would make this the
     * greenest check in the tree. */
    assert(files > 30, `only ${files} files read under src/game — this check is not reading the tree`);
    assert(total > 500, `only ${total} exported functions parsed — the export form has changed under this check`);

    const known = new Set([...SEAMS.keys(), ...RESIDUE]);
    const fresh = dead.filter((d) => !known.has(d));
    assert(fresh.length === 0,
      `${fresh.length} exported function${fresh.length === 1 ? '' : 's'} in src/game have no caller anywhere `
      + `under src/ and are in neither list: ${fresh.join(', ')} — either wire it to something a player `
      + 'reaches, delete it with the argument written into its file, or add it to SEAMS in '
      + 'tools/checks/reachable.mjs with the reason it is a door for the harness alone');

    /* THE RATCHET. The residue is a debt and the number is the whole of it. */
    const owed = dead.filter((d) => RESIDUE.includes(d));
    assert(owed.length <= CENSUS,
      `the uncalled-export residue is ${owed.length} against a census of ${CENSUS}, and it may only fall`);

    /* AND THE FOUR THIS SWEEP FIXED, PINNED BY NAME. They are the reason the
     * file exists; a regression that unwires one of them is the same defect
     * coming back, and it would otherwise be invisible because the export
     * would still be there and still be green everywhere else. */
    for (const pin of ['StationLife.js::servedHere', 'StationSave.js::hasSeen',
      'StationSave.js::markSeen', 'Medbay.js::conditionRow', 'Notices.js::noticeReading']) {
      assert(!dead.includes(pin), `${pin} has lost its caller again — it is back to being a feature nobody has`);
    }
    const stale = [...known].filter((k) => !dead.includes(k));
    return `${total} exported functions across ${files} files in src/game; ${dead.length} have no caller `
      + `(${SEAMS.size} named seams, ${owed.length} residue of ${CENSUS})`
      + (stale.length ? `; ${stale.length} listed name${stale.length === 1 ? ' has' : 's have'} since been `
        + `wired or removed and can leave the list: ${stale.slice(0, 6).join(', ')}` : '');
  });

  check('reachable: §11\'s refusal is on the kiosk door, and it is one door', async () => {
    /**
     * SHARK §11: *"You wake in the Brig (#47), your station `standing` drops
     * (one number in `Session`), the kiosks refuse you for a day."*
     *
     * `StationLife.stepConsequence` dropped the number, `StationSave` stored
     * it, and `servedHere` answered the question — with no caller. So the
     * third clause of §11 was written, persisted, checked and unreachable.
     *
     * ASSERTED ON THE SOURCE AND ON THE FUNCTION, because neither alone is the
     * claim. The function is driven over the real threshold; the source says
     * the guard sits BEFORE `screens.take`, since a counter that opens and
     * then refuses you has already served you.
     */
    const SL = await import('../../src/game/StationLife.js');
    assert(SL.servedHere({}) === true, 'a world with no station life is refused service');
    const w = { _stationLife: { standing: 0 } };
    assert(SL.servedHere(w), 'a resident in good standing is refused at the counter');
    let fell = null;
    for (let n = 0; n > -40; n--) {
      w._stationLife.standing = n;
      if (!SL.servedHere(w)) { fell = n; break; }
    }
    assert(fell !== null, 'no standing this station can reach ever closes a counter');

    const main = code(await readFile(new URL('../../src/main.js', import.meta.url), 'utf8'));
    const fn = main.slice(main.indexOf('function openKiosk('));
    const body = fn.slice(0, fn.indexOf('\n}') + 2);
    assert(/servedHere\(/.test(body), 'openKiosk no longer asks whether the counters serve you');
    assert(body.indexOf('servedHere(') < body.indexOf('screens.take('),
      'the standing is read AFTER the counter is raised — a panel that opens and then says no '
      + 'has already served you');
    return `the counters close at standing ${fell}; openKiosk asks before it raises the panel`;
  });

  check('reachable: FlightOps has no page it cannot open', async () => {
    /* `certLines` was "the three rows, for a banner or a page" and SHARK §14
     * forbids the page — `Station.signInReadyRoom` says so over the one press
     * that would have fed it. It is deleted and the argument is in the file;
     * this is the pin that keeps it deleted, and it names the two readings a
     * player CAN reach so the next person to want one finds them. */
    const F = await import('../../src/game/FlightOps.js');
    assert(typeof F.certLines !== 'function',
      'FlightOps.certLines is back. SHARK §14: the station adds no interface — see the note in '
      + 'FlightOps.js where it used to be, and use shortLine or readiness');
    assert(typeof F.shortLine === 'function' && typeof F.readiness === 'function',
      'the two cert readings a player can actually reach are gone');
    const f = F.blankFlight();
    assert(/1 of 3|0 of 3/.test(F.shortLine(f)), `the refusal at #5 reads "${F.shortLine(f)}"`);
    return `no certLines; shortLine says "${F.shortLine(f)}"`;
  });
}
