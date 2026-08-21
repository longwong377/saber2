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
 * ── NO IMPORTS, AND THAT IS LOAD-BEARING ───────────────────────────────
 *
 * `Waves.js` reads `factionOf` to split a battlefield into two armies, and
 * `Menu.js` reads the whole table to draw the pages. Waves.js must not acquire
 * a static edge to Levels.js (a cycle — Levels imports SET_PIECE from Waves and
 * uses it at module-eval time) or to Vehicles.js (which reaches Textures.js and
 * bakes onto a canvas, so every check importing Waves would need the DOM shim —
 * HANDOFF §2.1). A table with no imports can be read by both without either
 * problem, and the cross-checks that would otherwise want those imports live in
 * the check, which loads everything anyway.
 */

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
    /* AND THE GAME PUTS A DC-15 IN HIS HANDS — see the note on `rocket`.
     * `buildBlaster` has a third branch and its own comment calls it "heavy
     * repeater: three barrels in a shroud, drum magazine, carry handle", which
     * is a Z-6; nothing reaches it, because Command.js declares `weapon:
     * 'dc15'` here. One word in another lane's file. */
    heldMesh: 'dc15',
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
    weapon: 'DC-15 rifle, jump pack',
    text: 'Republic airborne, used to take ground that has nothing underneath it. A '
      + 'jet trooper sits a metre and a third off the deck, which puts him over '
      + 'cover, over the crowd, and inside your blade\'s arc from an angle nothing '
      + 'else on either side attacks from. Fast at 6.2 metres a second and thin '
      + 'enough that one pass ends him, because a man with a jump pack is a raider '
      + 'and not a line unit.',
  },
  arc: {
    faction: 'republic',
    weapon: 'DC-15 rifle, twin sidearms',
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
      + 'a droid line that outnumbers it. One shell every 4.6 seconds at 58 damage, '
      + 'the heaviest single hit in the game, behind a 1.1 second telegraph that is '
      + 'the only warning of that size anybody gets. It is too heavy for the Force '
      + 'to lift and the grip says so out loud rather than doing nothing. Take the '
      + 'legs: three of the six and it comes down.',
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
