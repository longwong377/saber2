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
 */
const RESIDUE = [
  'Arrivals.js::deliveryIsAnnounced',
  'Attributes.js::attrById', 'Attributes.js::profileMean',
  'Bodies.js::topCut',
  'Cloth.js::capeCut', 'Cloth.js::tabardCut', 'Cloth.js::sashCut', 'Cloth.js::fleshMotion',
  'Cohorts.js::poseMatrix',
  'Combat.js::zoneTolerance', 'Combat.js::gradeDeflection',
  'Command.js::paintReport',
  'Company.js::trooperOf', 'Company.js::bondWorth',
  'Coop.js::apartment',
  'Counter.js::stockedEnough',
  'Databank.js::isSoldier',
  'DeckBattle.js::deckBattleState',
  'DeckCast.js::astromechLeg',
  'DeckEdit.js::renameMan', 'DeckEdit.js::paintMan', 'DeckEdit.js::attachPart',
  'DeckFlight.js::rampFoot', 'DeckFlight.js::flightPhase',
  'DeckLift.js::liftPick', 'DeckLift.js::liftBusy',
  'Dojo.js::buildDummy',
  'Duel.js::guardToWorld',
  'Extraction.js::extractionSeconds',
  'Food.js::kitchens', 'Food.js::gearFor',
  'Games.js::playDejarik', 'Games.js::drumTicketEdge', 'Games.js::drumEdge',
  'Hangar.js::inZone',
  'Holodeck.js::blankHold', 'Holodeck.js::heldPrograms',
  'Home.js::homeRecord',
  'Impact.js::disarmKinetic',
  'Kennel.js::priceTemper',
  'Levels.js::templeColonnade',
  'Medbay.js::tankLocal',
  'Order.js::crystalAt', 'Order.js::orderReadout', 'Order.js::temperTime',
  'Outside.js::survey',
  'Parade.js::gripFrame',
  'Powers.js::unboundOf',
  'Progress.js::progressLines',
  'Quests.js::pinnedGivers',
  'SaberController.js::zoneOfDir',
  'Smoke.js::smokeClouds', 'Smoke.js::airDepth',
  'Spectacle.js::researchedProbabilities', 'Spectacle.js::formBook', 'Spectacle.js::momentsOf',
  'Starfury.js::mountTable',
  'Station.js::forgetStationMats', 'Station.js::finishStationBuild',
  'StationCast.js::addResidents',
  'StationMesh.js::roomReady',
  'Stratagems.js::phraseFaults', 'Stratagems.js::codeFaults',
  'Tote.js::racesOn',
];

/** What the sweep read on the day this file was written. It may only fall. */
const CENSUS = 64;

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
