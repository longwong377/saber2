/**
 * BATTLEFRONT BORZ — the databank.
 *
 * WHAT THIS IS FOR. The game fields thirty-one bodies and, until this file, told
 * the player what none of them was. The "Codex" tab is a keybind reference; the
 * HUD prints `ARCHETYPES[t].label` and nothing else. So a player meets a B1, a
 * BX commando, a hailfire droid, a droideka, an acklay and a reek, and the
 * product never once says what any of them is, whose army it belongs to, or what
 * it is carrying — while the research to say all three is already written, in
 * comments, five files away. This is that research made visible.
 *
 * ── WHAT IS AUTHORED HERE AND WHAT IS NOT ──────────────────────────────
 *
 * ONE row per archetype, and each row carries only what the game cannot derive:
 * a FACTION, the real name of the WEAPON, and a paragraph. Everything else on a
 * databank page — the display name, the threat, the health, the speed, which
 * levels a body is met on — is read off `ARCHETYPES` and the level pools at
 * render time and is never typed here. A page is generated; its prose is data.
 *
 * That split is deliberate and it is HANDOFF §2.3's rule applied honestly. A
 * second copy of a number is a lie waiting to happen; a paragraph has no
 * generated twin to disagree with. What a hand-written table CAN still do is go
 * stale — an archetype registered tomorrow gets no entry — so
 * `tools/checks/databank.mjs` fails on any archetype this table does not name,
 * on any name it invents, and on any faction that disagrees with the two places
 * the game already states one (`ARMIES[*].tiers` in Command.js and
 * `VEHICLE_SIDE` in Vehicles.js). The table is the authority for faction; those
 * two are the authority for what an army may BUY, and the check pins that an
 * army never musters a body that fights for the other side.
 *
 * ── ONE IMPORT, AND THE RULE IT IS MEASURED AGAINST ────────────────────
 *
 * This file used to have NONE, and the reason is load-bearing: `Waves.js`
 * reads `factionOf` to split a battlefield into two armies, and `Menu.js`
 * reads the whole table to draw the pages. Waves.js must not acquire a static
 * edge to Levels.js (a cycle — Levels imports SET_PIECE from Waves and uses it
 * at module-eval time) or to Vehicles.js (which reaches Textures.js and bakes
 * onto a canvas, so every check importing Waves would need the DOM shim —
 * HANDOFF §2.1).
 *
 * The rule was never "no imports"; it is THOSE TWO EDGES, and the cheapest way
 * to keep them was to have no edges at all. `StationSave.js` is neither: its
 * whole static graph is `Store.js`, which imports nothing, touches no canvas
 * and reaches no level. So the edge added here — for the one thing V15 §1.1
 * asks of this file, the station's own name on its own page — costs Waves.js
 * a `localStorage` wrapper and nothing else, and the two forbidden edges are
 * still absent. Anything else wanting an import here should be weighed the
 * same way rather than waved through on this precedent.
 */
import { stationName } from './StationSave.js';

/* ══════════════════════════════════════════════════════════════════════ */
/*  The factions                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * FOUR, AND TWO OF THEM ARE ARMIES.
 *
 * `army: true` means this faction fields a line on a battlefield and can be one
 * side of a level's war — see `LEVELS.geonosis.armies` and
 * `WaveDirector.sideFor`. The Order is a faction and is not an army: a Jedi
 * fights for the Republic without being a soldier of it, and the three dojo
 * bodies are the Order's own training gear. The creatures are nobody's; an
 * arena buys them and they fight whatever is nearest.
 *
 * The two army ids are the SAME STRINGS `ARMIES` uses in Command.js and
 * `VEHICLE_SIDE` uses in Vehicles.js, which is what lets the check compare them
 * without a translation table in the middle.
 */
export const FACTIONS = {
  republic: {
    name: 'The Galactic Republic',
    short: 'Republic',
    army: true,
    /* WHICH ORDER LEADS IT, and it lives here rather than in Command.js so that
     * `Waves.js` can ask the question too. Command imports Waves, so Waves
     * cannot import Command; this file is the one both of them already read,
     * and a second copy of this mapping in each is the hand-maintained twin
     * HANDOFF §2.3 is about. `Command.ARMIES` reads it from here. */
    order: 'jedi',
    note: 'A thousand years without a standing army, and then an army that was '
      + 'already grown and paid for by the time anybody voted on it. Its soldiers '
      + 'are one man copied a million times; its generals are monks.',
  },
  separatist: {
    name: 'The Confederacy of Independent Systems',
    short: 'Confederacy',
    army: true,
    order: 'sith',
    note: 'A trade alliance with a fleet. Every soldier it fields was built to a '
      + 'unit cost, which is its whole strategy and its whole weakness: the '
      + 'Confederacy does not lose a droid, it spends one.',
  },
  order: {
    name: 'The Jedi Order',
    short: 'Jedi Order',
    army: false,
    note: 'Peacekeepers with no rank structure and no soldiers, handed a war and '
      + 'the command of it. A Jedi on a battlefield is a general who was trained '
      + 'as a diplomat and armed as a duellist.',
  },
  /**
   * THE FIFTH BANNER, AND IT IS NOT A SIDE — IT IS AN ADDRESS.
   *
   * Twenty-three archetypes arrived with the station: fifteen species who live
   * on it and eight of the company's own off duty. Every one of them is
   * `resident: true, threat: 0, unlockAt: 99` — no wave may compose one — so
   * none of them fights for anybody, and filing a shopkeeper under the
   * Republic because the company is Republic would be worse than a nicety.
   * `factionOf` is what `WaveDirector.sideFor` reads to decide which side a
   * body belongs on, and this faction is `army: false` for the same reason
   * `wild` is: there is no side of a battle it can be put on.
   *
   * A clone crewman drinking in the cantina IS Republic and that is not what
   * this field asks. It asks whose body this is on the ground it is met on,
   * and the answer here is the drum: everyone in this group is off duty,
   * unarmed and in somebody else's neutral space.
   */
  station: {
    /**
     * ── AND THIS PAGE CARRIES THE NAME THE PLAYER GAVE IT (V15 §1.1) ────
     *
     * *"shown everywhere the station names itself: … the Databank's station
     * page"*. This IS that page: the one entry in `FACTIONS` that is a place
     * rather than a side, and the header `Menu.databankGroups` prints over the
     * twenty-three residents. It read `The station`, which is what a station
     * is called by somebody who has not named it.
     *
     * A GETTER, for the same reason `Levels.js`'s lift floors use one:
     * `FACTIONS` is a module-level object evaluated once at import and the
     * name is typed later, in the world, so a string here would be a snapshot
     * of whatever the fold held the first time anything imported this file.
     * `short` stays `Station` — it is a column heading in a count line, not a
     * name.
     */
    get name() { return stationName(); },
    short: 'Station',
    army: false,
    get note() {
      return `${stationName()} is fifty-five rooms turning in neutral space, and the only `
        + 'ground in the game where nobody is shooting. Fifteen peoples keep fifteen '
        + 'different days here and the war pays for all of them; what you meet on '
        + 'this deck is a crowd, not an enemy.';
    },
  },
  wild: {
    name: 'Unaligned',
    short: 'Unaligned',
    army: false,
    note: 'Animals, and the people who sell them to arenas. Nothing here has a '
      + 'side, a rank or a reason to be on the field beyond the one that put it '
      + 'in a cage.',
  },
};

/** The faction ids that can be one side of a battle. Two, and derived. */
export const ARMY_FACTIONS = Object.keys(FACTIONS).filter((k) => FACTIONS[k].army);

/* ══════════════════════════════════════════════════════════════════════ */
/*  The entries                                                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * ONE ROW PER ARCHETYPE, IN ROSTER ORDER.
 *
 *   faction   an id in FACTIONS.
 *   weapon    what it is carrying, by its real name. Every ranged body and every
 *             body with a blade has one; a body with neither says so.
 *   heldMesh  present ONLY where the model in the body's hands is a different
 *             weapon from the one it is fighting with — two units, both in
 *             Command.js, and both stated out loud rather than papered over.
 *             The check pins it to the archetype's builder key, so fixing the
 *             game turns the declaration red and it gets deleted with the bug.
 *   text      the paragraph. Written to the same rule as the rest of this
 *             repository — specific, plain, and no sentence that would survive
 *             being said about a different body.
 *
 * The research is not invented. Almost all of it is already in the source, in
 * the comments that price these bodies: the B1's E-5, the Temple Guard's yellow
 * crystal, the OG-9's four thin legs, Djem So's 0.58 s recovery, the acklay's
 * reach, the wampa's telegraph. What this file does is put it where a player can
 * read it.
 */
export const DATABANK = {

  /* ── Confederate line ─────────────────────────────────────────────── */

  b1: {
    faction: 'separatist',
    weapon: 'E-5 blaster rifle',
    text: 'The Trade Federation\'s line infantry and the most numerous soldier in '
      + 'the war. A B1 is thin-limbed, hollow-voiced and cheap, and one clean pass '
      + 'through the waist leaves two halves of one. It is built that way on '
      + 'purpose — the foundries turn out more of them in a week than Kamino grew '
      + 'clones in a decade — and it fights in ranks because a rank is the only '
      + 'thing that makes one of them matter. Meeting a B1 is nothing. Meeting '
      + 'forty at once is the Confederacy\'s entire argument.',
  },
  conscript: {
    faction: 'separatist',
    weapon: 'E-5 blaster rifle',
    text: 'A B1 that never finished being built. No unit flash, no paint, half a '
      + 'charge in the eye and a rifle it fires once every three seconds at nothing '
      + 'in particular. The foundries turn these out when a front needs a number '
      + 'rather than an army, and the number is the whole of the point: a conscript '
      + 'is not sent to win the ground, it is sent to be standing on it. Six points '
      + 'of health, one pass, and it is worth nothing — no bounty, no study, no '
      + 'record. Cutting through forty of them costs you the time it takes and buys '
      + 'you the time it takes. They are not an enemy. They are weather with legs.',
  },
  b2: {
    faction: 'separatist',
    weapon: 'Integrated wrist blaster',
    text: 'What the Trade Federation built after Naboo, where its line infantry met '
      + 'soldiers who shot back. The B2 is the same droid with the armour welded on '
      + 'over it: a hunched, heavy chassis at three times the health, a shoulder '
      + 'line that turns a bolt, and no rifle to knock out of its hands because the '
      + 'blaster is inside the right forearm. It pays for that in pace — 2.6 metres '
      + 'a second against a B1\'s 3.5 — so a B2 does not chase you. It keeps firing '
      + 'at where you went.',
  },
  rocket: {
    faction: 'separatist',
    weapon: 'Shoulder-launched rocket tube',
    /* AND THE GAME PUTS AN E-5 IN ITS HANDS. `weapon` on an archetype is a
     * BUILDER KEY into `buildBlaster`, and Command.js hands this one `'e5'` —
     * the B1 carbine — for a unit whose whole design is one 44-damage round on
     * a 0.9 s telegraph. `heldMesh` states the disagreement rather than letting
     * the page and the model quietly differ, and the check fails the day the
     * builder key changes, so the note cannot outlive the defect. Command.js
     * belongs to another lane; see the handover. */
    heldMesh: 'e5',
    text: 'A B1 with a tube on its shoulder, and the silhouette is the point: it is '
      + 'a B1 right up until it fires. The Confederacy\'s answer to the Republic\'s '
      + 'heavy gunner is the opposite answer — one slow, telegraphed round of 44 '
      + 'damage every 3.4 seconds instead of a stream you cannot cross. A rocket '
      + 'droid is a thing you watch rather than a thing you hide from. Dark plastoid '
      + 'over the standard chassis and a cold orange photoreceptor, so at fifty '
      + 'metres the read is the colour.',
  },
  droideka: {
    faction: 'separatist',
    weapon: 'Twin repeating blaster cannons, deflector shield',
    text: 'A destroyer droid: Colicoid work, sold to the Trade Federation rather '
      + 'than built by it, and the only thing in the Confederate line designed by a '
      + 'species that eats its own failures. It arrives rolled into a wheel, unfolds '
      + 'onto three legs and raises a deflector shield a blaster bolt cannot cross. '
      + 'Then six rounds a burst, continuously, until you are down. The shield is '
      + 'the whole fight — a lightsaber goes through it and a blaster does not — so '
      + 'the answer to a droideka is to be closer than it wants you.',
  },
  bx: {
    faction: 'separatist',
    weapon: 'Vibrosword',
    text: 'The Confederacy\'s best infantry and nothing like the rest of it. A BX is '
      + 'a bare gunmetal skeleton with a single white photoreceptor, built to '
      + 'infiltrate rather than to fill a rank: 5.6 metres a second, a blade in its '
      + 'hands, and a duellist\'s brain behind it — it feints, it chambers against '
      + 'your arc, and it punishes a recovery. It is the one unit the Confederacy '
      + 'has that makes a Jedi\'s own game unsafe. A wave pays six times for one of '
      + 'these what it pays for a B1, which is why you meet a BX and never a rank.',
  },
  magna: {
    faction: 'separatist',
    weapon: 'Electrostaff',
    text: 'IG-100, built to stand at General Grievous\'s shoulder and to keep '
      + 'standing after he has left. An electrostaff is not a lightsaber: it is two '
      + 'metres of arc weapon swung two-handed by a machine built to stand beside a '
      + 'four-armed general, and it fights Djem So — three heavy attacks and one '
      + 'that cannot be parried at all, and the longest recovery any form has. It carries the same rally aura a clone commander '
      + 'does, so it improves the droids around it. The tabard is a marking and not '
      + 'armour.',
  },

  /* ── Confederate machines ─────────────────────────────────────────── */

  walker: {
    faction: 'separatist',
    weapon: 'Dorsal heavy laser',
    text: 'Baktoid\'s siege platform, and the silhouette that says Geonosis before '
      + 'anything else in frame does: a command sphere carried on four very tall, '
      + 'very thin legs with one beam weapon off the top. The legs are the design — '
      + 'it walks over its own infantry rather than through it, and it can stand in '
      + 'a crowd its own army made. Three legs have to go before the sphere comes '
      + 'down, and it keeps shooting through the first two. Cutting one is not '
      + 'enough. Neither is cutting two.',
  },
  dwarfspider: {
    faction: 'separatist',
    weapon: 'Underslung laser cannon',
    text: 'Commerce Guild property before the war — a mining and security walker '
      + 'with one cannon slung under a four-legged frame, requisitioned wholesale '
      + 'when the Guild joined the Confederacy. It is the only Confederate machine '
      + 'that comes to you: its band is five to fourteen metres, which is inside a '
      + 'blade\'s walk, so unlike the armour behind it this one can be reached and '
      + 'cut. A fast double tap, and the thinnest hull of the four machines the '
      + 'Confederacy walks onto a field.',
  },
  aat: {
    faction: 'separatist',
    weapon: 'Main shell cannon, two shells a ripple',
    text: 'The Trade Federation\'s hover tank, and the machine the blockade of Naboo '
      + 'was won and then lost on. A repulsorlift hull, which is the important fact '
      + 'about fighting one: there are no legs to cut, so the way in is the armour. '
      + 'It fires two shells in a ripple 0.44 seconds apart at 52 damage each, and '
      + 'that gap is deliberate — it is long enough to be two events rather than a '
      + 'burst, which is how you tell an AAT from a hailfire without looking. It is '
      + 'past the top of the Force grip, and with no legs to cut there was never a '
      + 'shortcut to take.',
  },
  hailfire: {
    faction: 'separatist',
    weapon: 'Twin missile racks, seven a volley',
    text: 'InterGalactic Banking Clan hardware, and it looks like exactly what it '
      + 'is: a command pod slung between two enormous hoop wheels with a missile '
      + 'rack on each shoulder. Seven missiles in half a second at eleven damage '
      + 'apiece — the biggest volley either side has and the loosest, so what it '
      + 'costs you depends entirely on whether you were standing still when it '
      + 'fired. Then 4.2 seconds of reload. That is the only window it gives and '
      + 'the whole answer to it.',
  },
  tridroid: {
    faction: 'separatist',
    weapon: 'Three chain-fed laser cannons, one a facing',
    text: 'Techno Union artillery, and the tallest thing either army walks onto '
      + 'a field: a bulbous head fourteen and a half metres up on three enormously '
      + 'long thin legs, with the ammunition stored inside the head itself. Three '
      + 'photoreceptors and three cannons, both sets a third of a turn apart, so it '
      + 'has no front and no blind spot and never needs to face you — it shoots '
      + 'DOWN, from twelve metres, while you walk to it. And then it goes over. One '
      + 'leg is enough. A tripod that loses a leg is not a tripod, and this is the '
      + 'only body of its size on the roster that a single pass brings down.',
  },
  snailtank: {
    faction: 'separatist',
    weapon: 'Twin heavy repeating blasters and concussion launchers',
    text: 'A Corporate Alliance droid tank, and the only machine in the war that '
      + 'runs on ONE tread — a single high-traction belt down its own centreline '
      + 'with two outrigger pontoons on arms to stop it tipping. Sixty kilometres '
      + 'an hour in a straight line and eleven and a half seconds to turn round, '
      + 'which is the whole fight: it picks a line, it commits to it, and stepping '
      + 'off that line buys you longer than anything else on the field will give '
      + 'you. And it is balanced on three points — the tread and two pontoons on '
      + 'arms — so any one of them puts it on its side and stops it for good. The '
      + 'pontoons are the low ones.',
  },
  bodyguard: {
    faction: 'separatist',
    weapon: 'Electrostaff',
    text: 'The same IG chassis a MagnaGuard is built on, at four times the health '
      + 'and a tenth again the size: the machine a Confederate general keeps at the '
      + 'door rather than in the line. The torso is plated in durasteel and that is '
      + 'the whole of the counter-play — you '
      + 'are not going to cut this one in half across the chest, and you do not have '
      + 'to. The legs are still legs. It fights Djem So, and its recovery is the '
      + 'longest opening anything on the roster offers.',
  },
  acolyte: {
    faction: 'separatist',
    weapon: 'Lightsaber, Makashi',
    text: 'Not a Sith. There are only ever two of those, and the Confederacy is run '
      + 'by one of them. An acolyte is one of Count Dooku\'s students — a fallen '
      + 'Jedi, a Dark Jedi taken young, or a duellist who was never in the Order at '
      + 'all — given a red blade and sent to do the work the Rule of Two leaves '
      + 'over. The crystal is red because it was bled: broken to its wielder\'s will '
      + 'rather than grown to it. A bled crystal that is later healed comes back '
      + 'white, which is the crystal a Grey carries and the only end to this that is '
      + 'not a body on a floor. It fences Makashi, which is what Dooku taught, and it has lightning '
      + 'and the choke and will spend both before it goes back to fencing.',
  },

  /* ── Republic line ────────────────────────────────────────────────── */

  trooper: {
    faction: 'republic',
    weapon: 'DC-15A blaster rifle',
    /* THE CODEX MAY NOT SELL A VERB THE UNIT DOES NOT HAVE. This sentence read
     * "grenades, cover, and the judgement to use both" while `grenades: true`
     * on the archetype was read by nothing anywhere in `src/` — see the note
     * where that field used to be. Cover is real and is the half worth naming,
     * because it is the half a player can watch happen: under your own command
     * a clone goes to the lee of the nearest thing big enough to stop a bolt
     * (`CommandDirector._coverSite`), and a droid never does. */
    text: 'Grown on Kamino from one bounty hunter\'s genome, aged at twice the '
      + 'ordinary rate and trained from the tank. Phase I plastoid over a black body '
      + 'glove, a DC-15 fired in disciplined three-round bursts, and — this is what '
      + 'separates a clone from a droid — cover, and the judgement to use it: told to '
      + 'go to ground he picks the nearest thing that will stop a bolt and puts it '
      + 'between himself and the firing. He is issued a number, CT and four '
      + 'digits, and he does not get a name until the men beside him give him one.',
  },
  heavy: {
    faction: 'republic',
    weapon: 'Z-6 rotary blaster cannon',
    /* AND THE GAME NOW PUTS ONE IN HIS HANDS. This entry used to carry
     * `heldMesh: 'dc15'` because `buildBlaster`'s repeater branch — three
     * barrels in a shroud, drum magazine, carry handle, 1.20 m — was
     * unreachable: Command.js declared `weapon: 'dc15'` here, one word in
     * another lane's file. The archetype says `'heavy'` now, so the model and
     * the page name the same gun and the declaration is gone with the defect. */
    text: 'A trooper who has been handed a Z-6 and told to hold a line. A rotary '
      + 'cannon is not a rifle that hits harder, it is a rifle that does not stop — '
      + 'nine rounds at 0.07 seconds against a line trooper\'s three at 0.11 — and '
      + 'what it changes about a firefight is that you cannot cross open ground '
      + 'while one is looking at you. He is slower and heavier for it, 2.9 metres a '
      + 'second against 4.1, so a heavy who has picked his spot has committed to it.',
  },
  sniper: {
    faction: 'republic',
    weapon: 'DC-15x sniper rifle',
    text: 'A clone sharpshooter in dark plate, working from twenty-two to forty-two '
      + 'metres — further out than anything else on either side chooses to stand. '
      + 'One round at a time, 34 damage, and a full second of targeting line laid '
      + 'across you before it comes. That second is the fight: it is the only shot '
      + 'in the game you are shown in advance, and the answer to it is to not be '
      + 'where it is pointing when it arrives.',
  },
  jet: {
    faction: 'republic',
    weapon: 'DC-15S blaster carbine, jump pack',
    text: 'Republic airborne, used to take ground that has nothing underneath it. A '
      + 'jet trooper sits a metre and a third off the deck, which puts him over '
      + 'cover, over the crowd, and inside your blade\'s arc from an angle nothing '
      + 'else on either side attacks from. Fast at 6.2 metres a second and thin '
      + 'enough that one pass ends him, because a man with a jump pack is a raider '
      + 'and not a line unit.',
  },
  arc: {
    faction: 'republic',
    weapon: 'DC-15S blaster carbine, twin sidearms',
    text: 'Advanced Recon Commando: trained by Jango Fett himself, off the standard '
      + 'clone template rather than the flattened one, and very nearly destroyed in '
      + 'the batch for it — they came out independent, which was the point and also '
      + 'the problem. Blue markings, a pauldron and a kama. He works the line rifle '
      + 'on a 0.95 second cycle against a line trooper\'s 1.35, and his preferred '
      + 'band is four to eleven metres '
      + 'while every other shooter on the field is trying to stay out at twenty. An '
      + 'ARC closes.',
  },
  officer: {
    faction: 'republic',
    weapon: 'DC-15 rifle',
    text: 'Yellow, because every plate of this battle agrees that yellow is what a '
      + 'commander wears. His worth is not his own numbers: everything inside his '
      + 'rally aura fires faster, hits harder and moves quicker for as long as he is '
      + 'standing, and there is a ring on the ground saying so. Killing the enemy\'s '
      + 'commander is a tactical act with a visible result. Losing your own is felt '
      + 'across the whole line rather than as one body fewer.',
  },
  atte: {
    faction: 'republic',
    weapon: 'Mass-driver siege cannon',
    text: 'All Terrain Tactical Enforcer — thirteen metres of six-legged siege '
      + 'armour, walked off a gunship\'s undercarriage straight into '
      + 'a droid line that outnumbers it. One shell every 4.6 seconds at 58 damage — '
      + 'over half a Jedi in one round, and only the siege artillery behind it hits '
      + 'harder — behind a 1.1 second telegraph. It is too heavy for the Force '
      + 'to lift and the grip says so out loud rather than doing nothing. Its '
      + 'footpads are magnetised, which is why it walks up things nothing else on '
      + 'tracks or wheels can follow it onto. Take the legs: three of the six and it '
      + 'comes down.',
  },

  spha: {
    faction: 'republic',
    weapon: 'Heavy turbolaser, one shell every fourteen seconds',
    text: 'Self-Propelled Heavy Artillery — the largest ground weapon the Republic '
      + 'owns, and a gun with a chassis under it rather than a vehicle carrying a '
      + 'gun. Twelve legs, and the reference is blunt about what they are for: it '
      + 'walks between firing positions and it stands still to shoot, because a '
      + 'turbolaser that size is aimed by not moving. It is the heaviest single hit '
      + 'in the game and it gives the longest warning of anything on the field: two '
      + 'and a half seconds of charge. That is the opening. While it '
      + 'is charging it cannot walk, cannot come about and cannot depress the gun, '
      + 'and there are three metres of clearance under the hull with twelve legs '
      + 'standing in it. Five of them and the whole thing comes down. Thirty clone '
      + 'gunners crew one.',
  },
  juggernaut: {
    faction: 'republic',
    weapon: 'Dorsal heavy laser turret, ten rounds a burst',
    text: 'The HAVw A6, and everyone calls it the Turbo Tank: forty-nine metres of '
      + 'ten-wheeled assault transport with three hundred troopers inside it, a '
      + 'cockpit at each end so it never has to turn round, and an observation '
      + 'tower over the spine that is the tallest structure on the field. It is '
      + 'also the fastest heavy in the game — you cannot outrun it in the open, so '
      + 'do not try. It cannot climb and it cannot come about. Anything you can put '
      + 'between you and it is a wall it has to drive the long way round, and while '
      + 'it does that it is showing you five wheels at knee height. Four of the ten '
      + 'and it is off them.',
  },

  /* ── the Order ────────────────────────────────────────────────────── */

  jedi: {
    faction: 'order',
    weapon: 'Lightsaber, Ataru',
    text: 'A Knight has passed the Trials and cut the padawan braid off. This one '
      + 'fights Ataru, the acrobatic form — chains of two to four attacks and the '
      + 'shortest wind-up on the field at a quarter of a second — and carries the '
      + 'pull, which exists to undo the one answer a flurry has: backing out of it. '
      + 'The outer robe is off. A Jedi who expects to fight takes it off, and that '
      + 'is how you tell one at range from the hooded thing with the red blade.',
  },
  sentinel: {
    faction: 'order',
    weapon: 'Lightsaber, Soresu',
    text: 'The Order\'s third path, between the Guardian\'s blade and the Consular\'s '
      + 'study: a Jedi who learns the skills the Temple does not teach and works '
      + 'where the Republic\'s law does not reach. Soresu is the form — three '
      + 'attacks, every one of them parryable, thrown at the lowest aggression '
      + 'anything has — and the health to outlast you while it waits. It '
      + 'will not walk onto your blade. Every opening it gives you it gives you on '
      + 'purpose.',
  },
  guardian: {
    faction: 'order',
    weapon: 'Lightsaber, Djem So',
    text: 'A Jedi who has taken the mask and given up their name to stand watch over '
      + 'the Temple on Coruscant. The blade is yellow and nobody else in the Order '
      + 'carries that colour — which is the whole reason for it, because in a hall '
      + 'where both sides hold a lightsaber the blade is how you know which way to '
      + 'swing. Djem So: three heavy attacks and one that cannot be parried at all. '
      + 'There is no parry-shaped answer to this one. There is footwork and the '
      + 'counter-swing, and its recovery is the longest window on the roster.',
  },
  master: {
    faction: 'order',
    weapon: 'Lightsaber, Makashi',
    text: 'The rank above Knight, given for taking a padawan through to the Trials '
      + 'or for work the Council would rather not name. Four powers, and the only '
      + 'Unleash anything on the field '
      + 'has — it fires once, under a third health, with a blade already inside its '
      + 'guard. It fences Makashi, and every attack it throws can be parried, which '
      + 'is not a weakness: it is reading you, and the thrust arrives the moment you '
      + 'overcommit. The answer is to stop swinging first.',
  },
  remote: {
    faction: 'order',
    weapon: 'Low-power training sting',
    text: 'The sphere every initiate learns the blade against. It hovers a metre and '
      + 'a half up, drifts, and fires a sting worth three damage — enough to be '
      + 'worth avoiding and not enough to matter. It comes apart the instant you '
      + 'actually meet it. It exists so that the first '
      + 'bolt you ever turn is one that will not kill you, and there is no other '
      + 'reason to build one.',
  },
  dummy: {
    faction: 'order',
    weapon: 'None — it does not fight back',
    text: 'A battle droid chassis with the drive train pulled out and more health '
      + 'poured in than you will ever get to the end of, standing exactly where it '
      + 'was left. It does not move, does not shoot and does not fall over. What it is '
      + 'for is the one thing every other body in the game is too busy to let you '
      + 'learn: where the tip of your blade actually is, and what it costs to put it '
      + 'somewhere.',
  },
  sparring: {
    faction: 'order',
    weapon: 'Training lightsaber, Soresu',
    text: 'A duelling partner with the blade turned down to three damage. It fights '
      + 'Soresu and only Soresu: everything it throws can be parried, it waits '
      + 'instead of rushing, and it takes the opening the instant you swing wildly '
      + 'at it. That last part is the lesson and the reason the form is fixed — a '
      + 'partner that picked a different style every visit would be a room that '
      + 'taught a different blade every visit.',
  },

  geonosian: {
    faction: 'separatist',
    weapon: 'Sonic blaster',
    text: 'The species whose planet this is, and the only thing you will fight here '
      + 'that is not standing on the ground. A warrior-caste Geonosian is 1.75 metres '
      + 'of chitin on a frame that is mostly limb, and it fights from five and a half '
      + 'metres up where nothing you are holding can reach it — until it stoops. It '
      + 'cannot stay up: every few seconds it drops to head height, empties its '
      + 'blaster into you at knife range and labours back up, and the climb is three '
      + 'times slower than the dive. That window is the fight. Take a WING off it in '
      + 'that window and it never leaves the sand again; it flies on two and it does '
      + 'not fly on one. Failing that, it weighs 68 kilos — less than a clone trooper '
      + '— so the Force will simply pull it down, and it stays down for six seconds '
      + 'afterwards, which is longer than it takes to kill.',
  },

  /* ── the menagerie ────────────────────────────────────────────────── */

  beast: {
    faction: 'wild',
    weapon: 'Bladed forelimbs',
    text: 'An acklay: three metres of Vendaxan crustacean walking on six bladed '
      + 'legs, shipped to Geonosis to execute prisoners in the Petranaki arena and '
      + 'used that way ever since. The reach is the problem: it fights out to five '
      + 'metres, four times the length of the blade you are holding, so it opens you '
      + 'up from a distance where you have nothing to answer with. It has no '
      + 'interest in what either army is doing here.',
  },
  charger: {
    faction: 'wild',
    weapon: 'Horns and mass',
    text: 'A reek: Ithorian range cattle gone to the arena, a horned quadruped '
      + 'that spends most of a fight walking and the '
      + 'rest of it running you down at six metres a second. Meeting it head-on is '
      + 'the one thing that does not work — the frill and the horns are carried in '
      + 'front of its eyes and the charge does 54. The work is its legs; three of '
      + 'the four brings it down. In the arena a reek is usually ridden, and this '
      + 'one carries a gunner three metres up where a blade cannot reach him.',
  },
  stalker: {
    faction: 'wild',
    weapon: 'Claws',
    text: 'A nexu: a forest cat off Cholganna with four eyes, the second pair for '
      + 'heat, brought to the sand because it is the fastest thing anyone could get '
      + 'into a cage. Eight and a half metres a second — nothing else in the game is '
      + 'close — on the thinnest body of the five. It '
      + 'does not out-trade you and does not try to. It is at your back before the '
      + 'animal you were watching has finished its swing.',
  },
  brute: {
    faction: 'wild',
    weapon: 'Jaws and fists',
    text: 'A rancor, Dathomirian, the heaviest body in the arena and the slowest '
      + 'at three and a half metres a second. Neither the '
      + 'size nor the slowness is what makes it hard: the slam covers seven metres '
      + 'of ground centred on the animal, which is wider than the band it fights at, '
      + 'so every metre you spend beside it is a metre you have to give back. It '
      + 'carries a marksman in a howdah three and a half metres up. The animal\'s '
      + 'answer is to leave the ring, and out of the ring is where the rifle wants '
      + 'you.',
  },
  pouncer: {
    faction: 'wild',
    weapon: 'Claws',
    text: 'A wampa: a Hoth predator, white-shagged, horns curving sideways out of '
      + 'the skull and the head sunk between the shoulders — sold to a desert arena '
      + 'because an arena that imports its animals imports whatever it can get. It '
      + 'crosses twelve metres in four tenths of a second, so backing away is not an '
      + 'answer to it. It also has the thinnest health pool of the five, which means '
      + 'it reaches its most dangerous state within seconds of the gate. The answer '
      + 'is the last tenth of the telegraph.',
  },

  /* ── THE COMPANION KINDS ────────────────────────────────────────────────
   *
   * Eight bodies that reached ARCHETYPES through `COMPANION_UNITS` rather than
   * through a level's creature list, and the check that made this block
   * necessary is the right one: `factions.mjs` walks ARCHETYPES, not the wave
   * pools, because a body the game can PUT ON THE FIELD by any door is a body
   * the databank owes a page. A companion is on the field more than most
   * enemies are — it is out for the whole deployment — so this is the last
   * table it should have been missing from.
   *
   * `wild` for all eight, the b1c included. The faction reads "Nothing here
   * has a side, a rank or a reason to be on the field beyond the one that put
   * it in a cage", which is a companion exactly: it is out because YOU brought
   * it. Filing the droid as separatist was the alternative and it is a real
   * bug rather than a nicety — `factionOf` is what the wave director reads to
   * decide which side a body belongs on, and a Confederacy tag on a machine
   * that walks at your heel is the one label that could put it in a wave
   * against you.
   *
   * The text is written for the player who has one, not for a bestiary: what
   * it does, what it costs, and the one thing it will not do. `COMPANION_KINDS
   * [id].blurb` is the card in the kennel and says the same thing in one
   * sentence; this is the page behind it. Neither is generated from the other,
   * and that is deliberate — the blurb is a pitch and this is the manual.
   */
  massiff: {
    faction: 'wild',
    weapon: 'Jaws',
    text: 'A massiff: the Geonosian guard animal, plated along the spine and '
      + 'built low. It is the companion everything else is measured against, and '
      + 'the only kind that can stand in front of you and still be there '
      + 'afterwards. What it does is not damage, it is occupation — a B1 with a '
      + 'massiff on it is a B1 shooting at a massiff. It is slower than your '
      + 'sprint, which is the whole bargain: you can always leave it behind, and '
      + 'it will always be a moment late.',
  },
  tooka: {
    faction: 'wild',
    weapon: 'Nothing',
    text: 'A tooka kit: the smallest thing you can own, no attack at all, and '
      + 'the only companion you can pick up. Carrying it costs you a hand — the '
      + 'blade stays lit, but the off-hand work stops — and what you buy is a '
      + 'noise that every hostile inside its radius turns to look at. It is the '
      + 'cheapest way in the game to make a firing line face the wrong way, and '
      + 'a single bolt ends it while it does.',
  },
  tuk: {
    faction: 'wild',
    weapon: 'Fangs',
    text: "A tuk'ata whelp, Korriban-bred, and the fastest thing you can own — "
      + 'the one kind quicker than your own sprint. It outruns you into the '
      + 'fight, which is both what it is for and how it dies: it does not carry '
      + 'the health to survive a crossfire, so the leash setting matters more on '
      + 'this animal than on any other. Sent long, it arrives alone.',
  },
  pup: {
    faction: 'wild',
    weapon: 'Fists',
    text: 'A rancor pup: half a metre at the shoulder, the toughest companion '
      + 'in the game and the slowest. What it hits for is nothing. What it hits '
      + 'AT is the point — it is the only companion whose attacks break the '
      + 'level rather than the enemy, so a firing line behind a wall is a firing '
      + 'line until the pup is told about the wall. It will not keep up with you '
      + 'and it does not try.',
  },
  taun: {
    faction: 'wild',
    weapon: 'Nothing',
    text: 'A tauntaun: quick, heavy, and carrying no attack whatsoever — it '
      + 'will not bite, and it cannot be ordered to. It is a mount, and arriving '
      + 'somewhere is the entire contribution. Get on it and the map gets '
      + 'smaller; get off it and you have left a large warm animal standing in '
      + 'the open where anything can shoot at it. Ride it into a fight and it '
      + 'panics — the hostiles it can see and the fire it is taking for you '
      + 'both count — and past a threshold you are on the ground, stunned, '
      + 'watching it go.',
  },
  blurrg: {
    faction: 'wild',
    weapon: 'Jaws',
    text: 'A blurrg: the other mount, and the only one that fights. It bites, '
      + 'hard, so what closes on you while you are riding gets answered without '
      + 'your dismounting. It pays for that in the turn — it comes round at half '
      + 'the rate a tauntaun does, which makes it superb across open ground and '
      + 'a bad thing to be sitting on in a trench.',
  },
  varac: {
    faction: 'wild',
    weapon: 'Nothing',
    text: 'A varactyl: a green-feathered lizard that does no damage and climbs '
      + 'anything. It does not make the map faster the way a tauntaun does — it '
      + 'makes it a different shape. Walls, cliffs and the outside of structures '
      + 'are all ground to a varactyl, so the approach nobody is covering is '
      + 'usually the one it can take. On the flat it is the slowest of the three '
      + 'mounts and has nothing at all to defend itself with.',
  },
  b1c: {
    faction: 'wild',
    weapon: 'E-5 blaster rifle',
    text: 'A reprogrammed B1: an E-5 it fires two bolts at a time, a chassis '
      + 'that two bolts come back through, and a voice. It is the only companion '
      + 'with a gun and the only one you can send with a message — orders it '
      + 'carries reach men out of your own shouting range. Everything about '
      + 'owning one is deciding how far from cover it is allowed to be, and it '
      + 'will volunteer an opinion about that the entire time.',
  },

  /* ── AND THE FOUR THAT LANDED LAST ──────────────────────────────────────
   *
   * Written on the same commit as the check that caught them, which is the
   * only reason they exist: `factions.mjs` and `databank.mjs` both walk
   * ARCHETYPES, four new bodies arrived through `COMPANION_UNITS` after the
   * other eight entries were written, and both files went red naming all four
   * by id. That is the instrument doing exactly what it is for — a body the
   * game can put on the field is a body the player is owed a page for, and
   * nobody has to remember to write one.
   *
   * `wild` for all four, on the argument the block above makes: the faction
   * reads "Nothing here has a side, a rank or a reason to be on the field
   * beyond the one that put it in a cage", and a companion is out because YOU
   * brought it. Filing the two droids and the wookiee under a banner they
   * have a plausible claim to would be worse than a nicety — `factionOf` is
   * what the wave director reads to decide which side a body belongs on.
   */
  hawk: {
    faction: 'wild',
    weapon: 'Talons',
    text: 'A vhal\'kir: a raptor the size of a large dog that never lands while '
      + 'you are fighting. It is the only companion that cannot be shot at by '
      + 'anything without a raised barrel, and the only one whose whole '
      + 'contribution is SIGHT — sent up, it paints what it can see, including '
      + 'the bodies behind the wall you were about to walk round. What it costs '
      + 'is that a bird circling over you is a bird telling everyone where you '
      + 'are. It fights with its feet and it does not fight for long.',
  },
  astro: {
    faction: 'wild',
    weapon: 'Nothing',
    text: 'An astromech: the slowest thing you can own, and the only one that '
      + 'gets stuck on terrain you would vault without thinking. It has no '
      + 'attack of any kind. What it has is a scomp link — sent at a blast '
      + 'door it opens it, and the nine seconds it spends at the panel are nine '
      + 'seconds you are standing over it with a blade. Everything about owning '
      + 'one is knowing which door is worth those nine seconds.',
  },
  medic: {
    faction: 'wild',
    weapon: 'Nothing',
    text: 'A 2-1B surgical droid: the most valuable companion in a long '
      + 'campaign and the least use in a duel. It walks to a man who is down '
      + 'and works on him, which is the difference between a name on the wall '
      + 'and a name on the roll, and it will do it under fire because nothing '
      + 'in its programming knows what fire is. Two things follow: it is always '
      + 'in the worst place on the field, and it cannot defend itself when it '
      + 'gets there.',
  },
  wook: {
    faction: 'wild',
    weapon: 'Fists and a bandolier',
    text: 'A wookiee: the heaviest thing that walks at your shoulder, and the '
      + 'only companion that is a person. It does not take orders the way an '
      + 'animal does — it takes them the way a soldier does, which in practice '
      + 'means it arrives late to the ones it disagrees with. It hits harder '
      + 'than anything else you can bring and it is the slowest of the four '
      + 'that fight. What it is really for is the fights you should not have '
      + 'taken: it is the only companion that can lose one and walk away.',
  },

  /* ── The station: fifteen peoples ──────────────────────────────────── */

  /**
   * TWENTY-THREE PAGES, AND THE ARGUMENT FOR WRITING THEM RATHER THAN
   * DECLARING THEM AWAY.
   *
   * `characters.mjs` met these same twenty-three names one commit ago and did
   * NOT give them rows: a `BODY_KITS` row for a resident would be dead data,
   * because a resident's appearance is drawn per body from a seed and every
   * instance would override it. So the archetype declares `resident: true` and
   * the check holds the same property by measurement instead. That was right
   * there and it is the wrong move here, because the two failures are not the
   * same shape: NOTHING OVERRIDES A DATABANK PAGE. It is read exactly as it is
   * written, by a player standing in front of the body, and the only thing that
   * can make one dead is nobody writing it.
   *
   * The eight off-duty rows are not duplicates of pages the codex already has,
   * either. Four of them — the medic, the pilot, the guard and the engineer —
   * have no counterpart archetype anywhere in the roster to point at; the
   * station is the only place in the game those jobs exist. The four that do
   * have one are met somewhere else doing something else, which is the whole
   * of what a page is for.
   *
   * WHAT IS NOT TYPED HERE, as everywhere above: the name, the stature, the
   * pace and the mass are the archetype's, and WHERE a resident is met is read
   * off the manifest that houses it — `residentPlaces` in StationCast.js turns
   * a home and a haunt into the gazetteer's own names, so rehousing a species
   * moves its page with it.
   */
  res_human: {
    faction: 'station',
    weapon: 'None',
    text: 'Three meals and one long sleep, and the entire drum is set to it: the '
      + 'concourse clock keeps this species\' day because this species built the '
      + 'drum and hung the clock. They are the reference figure here in the most '
      + 'literal sense — every stature, arm, jaw and gait on the station is a '
      + 'ratio against theirs, including the fourteen below. Off duty they are '
      + 'the crowd you push through in the market and the queue at the food '
      + 'court. Nothing about them is remarkable, which on a deck of fifteen '
      + 'peoples is the one genuinely strange thing about them.',
  },
  res_narn: {
    faction: 'station',
    weapon: 'None',
    text: 'Heavy through the shoulders, a hand taller than the station average, '
      + 'and hided in a reticulation — dark cells in a pale raised net, which is '
      + 'not the same thing as spots and reads differently at ten metres. The '
      + 'jaw is narrow against a wide temple, the opposite of the human '
      + 'proportion, and it is why the face reads as a predator\'s from the '
      + 'front. They keep the earliest and most regimented day on the drum: up '
      + 'before six, three meals at fixed hours, work. A people who were '
      + 'occupied for a century and came out of it organised, and you can see it '
      + 'in a market queue before you see it anywhere else.',
  },
  res_centauri: {
    faction: 'station',
    weapon: 'None',
    text: 'The crest is the whole silhouette: a fan of groomed hair standing off '
      + 'the crown, most of a head wide again, flat to the sides and rising more '
      + 'than half a face above the skull. Breadth is rank, so it is the widest '
      + 'per-individual spread of any species here and it is worn as such. They '
      + 'retire near dawn and their social life is nocturnal and drink-centred, '
      + 'which puts them in the cantina at the hours the day shift is asleep. An '
      + 'empire in a long decline, dressed for the version of itself that is not '
      + 'in decline.',
  },
  res_minbari: {
    faction: 'station',
    weapon: 'None',
    text: 'A broad upright bone fin rises behind the crown, wider than the skull '
      + 'itself — bone, not hair, not horn, and it is the one head on the deck '
      + 'that a silhouette test can pick out at any range. Slender under the '
      + 'robes and slightly taller than the station average. The interesting '
      + 'thing is the sleep: it is BROKEN, a waking hour set in the middle of '
      + 'the rest block, so this is the species you meet in an empty corridor at '
      + 'the dead of station-night with nothing wrong. Formal to the point of '
      + 'ritual, and no more explanation than that is ever offered.',
  },
  res_drazi: {
    faction: 'station',
    weapon: 'None',
    text: 'The heaviest humanoid frame on the station: short in the neck to the '
      + 'point of having almost none, wide in the shoulder, thick through the '
      + 'limbs, and standing with a slight forward set that reads as about to do '
      + 'something. They take most of the physical work on the drum and two '
      + 'large meals rather than three, and both facts are the same fact. Blunt '
      + 'in a way that other species read as rudeness and they do not read as '
      + 'anything at all.',
  },
  res_brakiri: {
    faction: 'station',
    weapon: 'None',
    text: 'Traders, and the reason station-night has a crowd of its own. They '
      + 'sleep through the day shift and work from the evening meal through to '
      + 'the small hours, so the market that closes at nineteen hundred is a '
      + 'different market, with different stalls and different money, by '
      + 'midnight. Build and stature are close enough to the reference figure '
      + 'that the clock is the only reliable way to tell the two crowds apart. '
      + 'If you have been on the drum a week and never met one, you have been '
      + 'asleep when they are awake.',
  },
  res_pakmara: {
    faction: 'station',
    weapon: 'None',
    text: 'A high domed skull carried on almost no neck, and a mouth that is '
      + 'four tentacles rather than a jaw — the head is the largest on the deck '
      + 'in proportion and the face is the least legible on it. They are carrion '
      + 'eaters, which is a fact about diet that has turned into a fact about '
      + 'geography: theirs is the only species on the station with a segregated '
      + 'food economy, its own suppliers and its own counters. The long sleep '
      + 'and the two meals at four and sixteen hundred keep them feeding at the '
      + 'hours the concourse is emptiest. Nobody wrote that rule and everybody '
      + 'keeps it.',
  },
  res_vree: {
    faction: 'station',
    weapon: 'None',
    text: 'A metre and a half tall, thin, and carrying a head a fifth larger '
      + 'than the reference figure\'s on a frame two-thirds its weight — the '
      + 'smallest people on the drum and the ones a crowd shot has to be framed '
      + 'for. Traders, working human-facing market hours, which is unusual here: '
      + 'most species keep their own clock and let the station work around it. '
      + 'Their ships are disc-shaped and this has been the subject of a very '
      + 'long and very unfunny joke for as long as either species has known the '
      + 'other one.',
  },
  res_abbai: {
    faction: 'station',
    weapon: 'None',
    text: 'Amphibian, and the only residents whose rest is taken in water rather '
      + 'than at an hour — the sleep block is a PLACE for them, which is why '
      + 'their quarter is the humid one and why they are the people you never '
      + 'see between twenty-two hundred and five. A mask is worn in the standard '
      + 'atmosphere out of preference rather than need. Diplomats and '
      + 'administrators by inclination, mediating arguments the other fourteen '
      + 'would rather escalate, and quietly the reason the transient hostel is '
      + 'not on fire more often.',
  },
  res_gaim: {
    faction: 'station',
    weapon: 'None',
    text: 'Insectile, hive-organised and suited: the atmosphere they breathe is '
      + 'methane, so on this deck they are always inside a mask, and their two '
      + 'meals BRACKET the work shift because eating means going home to the '
      + 'quarter that has their air. The individual scatter is the smallest of '
      + 'any species here by a factor of three — a hive has very little '
      + 'variation to scatter — so a group of them moves like one thing and '
      + 'sleeps at one hour. Castes are visible in stature and nowhere else, and '
      + 'they do not explain them.',
  },
  res_hyach: {
    faction: 'station',
    weapon: 'None',
    text: 'Formality made legible: they eat at six thirty, twelve and eighteen '
      + 'hundred with almost no individual spread, so a dining hall of them '
      + 'fills and empties in one motion and the effect on a stranger is '
      + 'unnerving. Tall, narrow, long-necked, and elderly-looking at every age. '
      + 'An old people with a long history and a piece of it they will not '
      + 'discuss, whose discipline reads as manners right up until you notice '
      + 'how uniform it is.',
  },
  res_llort: {
    faction: 'station',
    weapon: 'None',
    text: 'Short, thick-armed, scaled, and the reason the lost and found on this '
      + 'station is a real room with a real queue. They sleep through the '
      + 'morning and work the margins of the market day and the small hours — '
      + 'the rhythm IS the crime layer, and it is deliberate on their part and '
      + 'known to everybody. Nothing they take is worth reporting on its own, '
      + 'which is the whole strategy. Security tolerates them at a level that is '
      + 'itself a negotiated figure.',
  },
  res_grome: {
    faction: 'station',
    weapon: 'None',
    text: 'The tallest people on the drum and among the heaviest, working the '
      + 'agricultural shift — four thirty, eleven thirty, eighteen hundred — '
      + 'which is not an office day and puts them in the arboretum and the '
      + 'galley when nobody else is. Broad-shouldered, blunt-jawed, slow to '
      + 'speak. They are the quietest crowd on the station and the least often '
      + 'in anybody\'s way, and a stranger tends to notice them only after '
      + 'walking into one.',
  },
  res_other: {
    faction: 'station',
    weapon: 'None',
    text: 'The remainder of the census, and it is a real category rather than a '
      + 'shrug: on a drum with a docking throat open to anyone paying, some of '
      + 'the crowd is one of a kind and going somewhere else tomorrow. This row '
      + 'carries the widest individual scatter of any on the station — three '
      + 'times the reference figure\'s spread in stature, and every hour of the '
      + 'day loosened to match — precisely so that it never reads as one more '
      + 'species with one more look. If two of them seem to be the same thing, '
      + 'the table is broken.',
  },
  res_vorlon: {
    faction: 'station',
    weapon: 'None',
    text: 'There is one, it lives behind a door on the residential deck, and '
      + 'nobody on this station has seen what is inside the suit. Two metres of '
      + 'encounter suit, an undisclosed atmosphere, no meal ever taken in public '
      + 'and twenty hours a day in seclusion — the census share rounds to '
      + 'nobody, so the right number of them here is exactly one and it is '
      + 'placed by hand rather than rolled for. It answers questions with other '
      + 'questions. It was on the drum before the drum had a quartermaster.',
  },

  /* ── The station: the company off duty ─────────────────────────────── */

  res_borz_crew: {
    faction: 'station',
    weapon: 'None — off duty and unarmed',
    text: 'The men who move the cargo, in fatigues rather than plastoid: the '
      + 'same face as every other man in the company, the same voice, and no '
      + 'armour on it at all. They work the docking throat on the day shift with '
      + 'muster surges at six and fourteen hundred, sleep in the barracks and '
      + 'drink in the cantina, and the walk between those three is most of what '
      + 'a life is here. Meeting one out of armour is the thing that makes the '
      + 'line troopers people rather than a colour.',
  },
  res_borz_medic: {
    faction: 'station',
    weapon: 'None — a field kit',
    text: 'Whites with a red flash at the collar, in the medbay and on the way '
      + 'to it. A surgical droid does the same job on a battlefield and cannot '
      + 'do this one: the drum\'s casualties are crush injuries, decompression '
      + 'and the results of an argument in a bar, and none of those are '
      + 'triage-on-a-line work. Off shift they eat late in the galley, because '
      + 'the rota that covers the small hours is the one nobody else wants.',
  },
  res_borz_pilot: {
    faction: 'station',
    weapon: 'None — a flight helmet under one arm',
    text: 'Orange, and the orange is not decoration — it is a flight suit, it '
      + 'reads as one at any distance, and it is the only colour on the drum '
      + 'that means one specific job. Traffic control and the ready room off the '
      + 'flight deck: clamps, approach lanes, and the standing argument with the '
      + 'docking throat about who gets the near berth. They are the loudest '
      + 'people on the station and by some margin the ones most likely to be '
      + 'still awake when the day shift musters.',
  },
  res_borz_jedi: {
    faction: 'station',
    weapon: 'None — the blade stays in the quarters',
    text: 'Robes, which is the one costume on this deck that is not a change of '
      + 'clothes: the Order dresses the same on duty and off, so what marks this '
      + 'one as off duty is the empty belt. The station keeps a chapel and this '
      + 'is who is in it, along with anybody else who wants the quietest room on '
      + 'the drum. The work is diplomatic — arguments between fifteen peoples '
      + 'who each have their own hours, their own food and their own idea of an '
      + 'insult. It is the same job the Order does in a war, with the shooting '
      + 'taken out of it.',
  },
  res_borz_acolyte: {
    faction: 'station',
    weapon: 'None — off duty and unarmed',
    text: 'Black, drinking alone, in the cantina at hours that overlap with no '
      + 'crowd on the drum. A transient: the hostel rather than the barracks, no '
      + 'berth of their own and no stated business on the station, which is '
      + 'noted by security and acted on by nobody. The other residents give the '
      + 'table a wide berth without being able to say what it is they are '
      + 'reading. They are not wrong, and nothing about the evening is going to '
      + 'confirm it either.',
  },
  res_borz_officer: {
    faction: 'station',
    weapon: 'None — a datapad',
    text: 'Command staff, in dress blue with a gold trim, between the operations '
      + 'centre and the quarters on the deck above the barracks. On a field this '
      + 'rank carries a rally aura and a company that fails without it; on the '
      + 'drum it carries a duty roster and the argument about berth fees. The '
      + 'second half is the interesting one — somebody signs for the water, the '
      + 'air and the fuel, and a station is the only ground in this game where '
      + 'that is visible at all.',
  },
  res_borz_guard: {
    faction: 'station',
    weapon: 'None — a stunner, holstered',
    text: 'Grey, on a post, and the only body on this deck whose job could turn '
      + 'into a fight. Security is one booth on the concourse and a walk between '
      + 'the market, the hostel and the cantina, which is to say the three '
      + 'places an argument starts. The work is almost entirely a matter of '
      + 'standing where the argument would otherwise have happened. Fifteen '
      + 'peoples with fifteen different ideas of a provocation makes that a '
      + 'harder trade than it looks.',
  },
  res_borz_engineer: {
    faction: 'station',
    weapon: 'None — a hydrospanner',
    text: 'Ochre coveralls, and the person the entire drum quietly depends on: '
      + 'the reactor hall, the fabrication shop and whatever on this rotating '
      + 'hull is currently making a noise it should not be making. Fifty-five '
      + 'rooms, four decks, one atmosphere plant and a methane quarter that must '
      + 'never be joined to it. Off shift they are in the barracks or asleep. A '
      + 'station is a machine that kills everyone aboard on the day it stops, '
      + 'and this is the crew that does not let it.',
  },
};

/* ══════════════════════════════════════════════════════════════════════ */
/*  Readers                                                               */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHICH SIDE THIS BODY FIGHTS FOR, or `null` for one nobody has an entry for.
 *
 * Null rather than a default, and it is the same argument `teamOf` makes in
 * Player.js: a plausible default here would put an unregistered body silently on
 * the Republic's side of a battlefield, and HANDOFF §2.3's close relative is
 * exactly "a missing thing answered with a plausible default instead of an
 * error". A null is visible — `WaveDirector.sideFor` cannot place it and the
 * check names it.
 */
export function factionOf(type) {
  return DATABANK[type]?.faction ?? null;
}

/**
 * WHICH ARMY A PLAYER OF THIS ORDER LEADS, or null for one that leads neither.
 *
 * The player, having played it: "Ive noticed that many times when as a sith
 * i'll be fighting against mechs that are associated with the separtists which
 * doesnt' make sense, make sure that doesn't happen and also the other way
 * around too like when you're playing as the republic you shouldnt be fighting
 * against things that are canonically on your side, that goes for single npcs
 * too."
 *
 * Measured before the fix, over the shipped levels: SEVEN OF SEVEN fielded
 * bodies against the side they belong to. A Sith met B1s, B2s and droidekas on
 * every ground in the game, and a Jedi met clone troopers and marksmen.
 *
 * A Grey leads neither and gets null, which every caller has to handle — see
 * `factionOf`'s note about why a plausible default is worse than a null here.
 */
export function armyForOrder(orderId) {
  if (!orderId) return null;
  for (const [id, F] of Object.entries(FACTIONS)) {
    if (F.army && F.order === orderId) return id;
  }
  return null;
}

/** The army on the other side of the war from this one, or null. */
export function opposingArmy(armyId) {
  if (!armyId || !FACTIONS[armyId]?.army) return null;
  const others = Object.keys(FACTIONS).filter((id) => FACTIONS[id].army && id !== armyId);
  return others.length === 1 ? others[0] : null;
}

/** Is this body one of the two that fight a war, rather than a Jedi or a beast? */
export function isSoldier(type) {
  const f = factionOf(type);
  return !!f && !!FACTIONS[f]?.army;
}

/** The entry, or null. Callers must handle null; nothing here invents a page. */
export function entryFor(type) {
  return DATABANK[type] ?? null;
}
