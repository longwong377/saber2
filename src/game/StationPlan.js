/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE GAZETTEER — 55 places, and nothing else decides where anything is
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `SHARK.md` §3.2 is a table of 55 places with, for each, its shape and look,
 * who is there and on what rhythm, what happens without you, and the verb you
 * have there. This file IS that table, transcribed, and §15's rule stands over
 * it: **a place not in §3.2 is not built**.
 *
 * ── WHY IT IS DATA AND NOT FIFTY-FIVE FUNCTIONS ───────────────────────────
 *
 * Four separate things have to agree about where a place is, and the deck this
 * station is bolted to has the scar to prove what happens when they each keep
 * their own copy: `Hangar.js` §"WHERE THINGS MAY AND MAY NOT STAND" records
 * four files that each had their own idea of the deck's partition, and men
 * walking into a hole as the result.
 *
 *   `StationKit.js`   builds the geometry and the colliders
 *   `StationLife.js`  routes residents between places and populates them
 *   `Station.js`      culls a place when its door is beyond 80 m (§12.3)
 *   `station.mjs`     walks every door and measures rule 4 on every pair
 *
 * So the partition is HERE, once, and all four read it.
 *
 * ── THE FRAME ─────────────────────────────────────────────────────────────
 *
 * The drum's axis is the origin. +Z runs down the Concourse. A place's `x`
 * and `z` are the centre of its floor and its `yaw` turns it about that
 * centre; `door` is where you walk in, in world XZ, and is what the cull
 * radius and the reachability walk both measure from.
 *
 * `deck` is the LEVEL NUMBER on the lift's readout, not a height. `DECK_Y`
 * below is the height, and the two are deliberately different numbers: the
 * readout counts levels of a hull whose machinery decks nobody walks, and a
 * 28 m ceiling would make every room in here a canyon.
 *
 * ── SHAPE IS A PROMISE, AND IT IS MEASURED ────────────────────────────────
 *
 * §3.1 rule 4: no two places the same shape. Every row names one, and
 * `station.mjs` measures the pairwise silhouette distinguishability of every
 * place from its own door — the IoU instrument `characters.mjs` already uses
 * on bodies — and fails any pair over 0.85. A pair that fails is a place to
 * redesign; §13.3 says so explicitly, and raising the threshold instead is
 * the one response that is not available.
 */

/**
 * The three habitable decks of the drum, the two below it and the one above,
 * as heights in metres above the Concourse floor.
 *
 * 12.5 m a deck: the Concourse's imported vault is 7.5 m to its soffit, and
 * the five metres over it are the services and the structure the next deck
 * stands on. Three decks put deck 48's floor 25 m over the market, which is
 * the fall §14 says is a ragdoll and a story line rather than a death.
 */
export const DECK_Y = {
  12: -46,   // the Cobra bay, hung under the drum
  32: -22,   // the flight deck — its own level, this is where its shaft lands
  40: 0,     // the Concourse deck
  44: 12.5,  // the Living deck
  48: 25,    // the Working deck
  60: 40,    // the Observation dome
};

/** The drum, in metres. §3.1: "a three-deck drum ~180 m across". */
export const DRUM = {
  /** Outer radius of the habitable drum. 180 m across (§3.1). */
  R: 90,
  /** The atrium void: a cylinder from the Concourse floor to over deck 48. */
  atrium: 18,
  /** The BALCONY onto the void, on every deck. §3.1 rule 1: "every deck has a
   * balcony onto it, so from anywhere near the middle you see two other decks
   * and the people on them." */
  balcony: 26,
  /** The outer RING walk: against the skin, the full turn, on every deck. Its
   * outer face IS the drum's skin, so the ring is where a window onto space
   * goes and the promenade (deck 44) is this ring with the glass in it. */
  ringR: 85.5,
  ringW: 9,
  /** A room's outer face: the ring's inner edge. Rooms hang inboard of the
   * ring and open onto it, which is what makes "every place reachable on foot
   * from a lift" a walk round one corridor rather than a maze. */
  get roomR() { return this.ringR - this.ringW / 2; },
  /** The four radial SPINE corridors, and how wide they are. §3.1 rule 3. */
  spines: [0, 90, 180, 270],
  spineW: 7,
  /** Deck-to-deck height, and the height of a walkable storey inside it. */
  pitch: 12.5,
  storey: 8.2,
  /** The tram loop, outside the drum's skin at deck 44 (§3.1). */
  tramR: 97,
};

/**
 * THE THREE CORRIDOR TYPES, one per deck and never shared (§3.1 rule 2).
 * `Station.js` reads this to decide what a deck's ring and spine are built
 * from; a deck that took another deck's corridor would be the "one corridor
 * generator for 70 decks" the other repo's own post-mortem names as its
 * worst defect (§1).
 */
export const CORRIDOR = {
  40: 'transit',    // the imported ribbed corridor: signage, shopfronts, a lit floor channel
  44: 'promenade',  // a continuous window wall to space, doors inboard, the tram outside
  48: 'serviceway', // grating floors, conduit, cutaways into machinery
};

/**
 * The three lift shafts (§3.1). `Station.js` dresses a lobby at each and
 * `DeckLift`'s car stops at whichever floor was chosen.
 */
export const SHAFTS = [
  { id: 'arrivals', label: 'ARRIVALS', x: 0, z: -74, decks: [40, 44, 48] },
  { id: 'atrium', label: 'ATRIUM', x: -26, z: 0, decks: [40, 44, 48, 60] },
  { id: 'flight', label: 'FLIGHT', x: 26, z: 0, decks: [12, 32, 40, 44, 48] },
];

/**
 * ══ THE 55 ════════════════════════════════════════════════════════════════
 *
 * id      the number in §3.2, which is the number every other file uses
 * deck    the lift's floor number (DECK_Y has the height)
 * name    §3.2's name, exactly
 * shape   rule 4's promise, and what `StationKit` builds
 * look    §3.2's "shape / look" column, which is what a screenshot is judged
 *         against by eye (§13.1) — not a comment, an acceptance criterion
 * who     §3.2's "who / rhythm"
 * idle    §3.2's "happens without you"
 * verb    §3.2's "your verb", and the interact prompt's text (§14)
 * x,z     the centre of the floor, world metres
 * w,d,h   footprint and interior height
 * yaw     radians about the centre
 * door    [x, z] you walk in at — the cull distance and the walk both use it
 * kiosk   the Menu panel a kiosk here opens (§5.2), if any
 * peak    the station hour this place is busiest — §13.2's contact sheet is
 *         shot at 13:00 and `stationlife.mjs` populates every place at its own
 * heads   how many people are THERE at the peak (§12.3: not how many are live)
 */
export const PLACES = [
  /* ── DECK 32, THE FLIGHT DECK ─────────────────────────────────────────── */
  {
    id: 1, deck: 32, name: 'Flight deck', shape: 'exists',
    look: 'the hangar, unchanged — Hangar.js builds it and nothing here touches it',
    who: '—', idle: '—', verb: null,
    external: true, peak: 8, heads: 0,
  },
  {
    id: 2, deck: 32, name: 'Deck control tower', shape: 'cantilever',
    look: 'a glass box cantilevered over the hangar mouth, up a stair from the gallery; consoles, the traffic board',
    who: '4 controllers, 3 shifts', idle: 'calls every launch and arrival you hear on the PA',
    verb: 'read the board: what is inbound',
    band: 'deck32', x: 34, z: -14, yaw: -0.42, w: 14, d: 10, h: 4.2, door: [30, -8], peak: 14, heads: 4,
  },
  {
    id: 3, deck: 32, name: "Pilots' ready room", shape: 'lowroom',
    look: 'low room under the tower: lockers, briefing screen, cots, coffee urn',
    who: '8 pilots between sorties', idle: 'briefings before a launch cycle, sleepers, a card game',
    verb: 'sign the Starfury cert',
    band: 'deck32', x: 36, z: -34, yaw: -0.42, w: 16, d: 11, h: 3.1, door: [29, -31], peak: 6, heads: 8,
  },
  {
    id: 4, deck: 32, name: 'Fighter maintenance bay', shape: 'deeppit',
    look: 'a pit two decks deep beside the flight deck, a fighter on a lift in it, gantries at three levels',
    who: '12 techs, droids', idle: 'a fighter stripped and rebuilt across the day',
    verb: 'walk the gantries',
    band: 'deck32', x: 54, z: -56, yaw: 0, w: 26, d: 22, h: 16, door: [42, -50], peak: 10, heads: 12,
  },
  /* ── DECK 12, THE LAUNCH WELL ─────────────────────────────────────────── */
  {
    id: 5, deck: 12, name: 'Cobra bay', shape: 'shaft',
    look: 'the launch well: a vertical shaft with the Starfury on a rail, catapult rams, hazard chevrons, a blast wall you look through',
    who: '3 ground crew, a launch officer', idle: 'test cycles; a fighter racked and unracked',
    verb: 'board and launch',
    band: 'deck12', x: 26, z: -18, yaw: 0, w: 18, d: 18, h: 34, door: [26, -8], peak: 9, heads: 4,
  },
  {
    id: 6, deck: 12, name: 'Fighter rack', shape: 'cellar',
    look: 'a cellar off the bay: two spare airframes on cradles, engines on stands, a parts wall',
    who: '4 techs', idle: 'an engine test-fires on the stand',
    verb: 'grip an engine bell and throw it',
    band: 'deck12', x: 50, z: -18, yaw: 0, w: 22, d: 14, h: 5.4, door: [38, -18], peak: 11, heads: 4,
  },

  /* ══ DECK 40 — THE CONCOURSE DECK. Warm: brass, terracotta, amber. ════ */
  {
    id: 7, deck: 40, name: 'Arrivals hall', shape: 'curvedhall',
    look: 'curved; one long window onto the docking throat; a customs line of three gates; departures board; benches; a kiosk',
    who: '20 movements an hour, 2 customs officers, a guard',
    idle: 'shuttles dock; new residents walk in with bags; a queue forms and clears',
    verb: 'read the departures board',
    band: 'outer', at: 176, w: 46, d: 20, h: 6.4, peak: 11, heads: 24,
  },
  {
    id: 8, deck: 40, name: 'Docking throat', shape: 'collar',
    look: 'outside Arrivals: a shuttle nosed into a pressure collar, umbilicals, fuel line, loading ramp',
    who: '3 dockhands, a mouse-droid convoy', idle: 'a shuttle every 6 min; cargo down the ramp',
    verb: 'walk aboard a docked shuttle',
    band: 'skin', at: 180, w: 30, d: 16, h: 9, peak: 11, heads: 4,
  },
  {
    id: 9, deck: 40, name: 'The Concourse', shape: 'vault',
    look: 'the imported Zocalo vault: 67 m barrel vault, galleries both sides, 14 stalls, opening onto the atrium at its inner end',
    who: '60–90 at the busy hours, 20 at night',
    idle: 'market cries, shift-change floods, a busker, a pickpocket chased by a guard, a spill cleaned by a droid',
    verb: 'browse — every kiosk is a real menu',
    room: 'zocalo', band: 'radial', at: 0, w: 22, d: 67.4, h: 7.5, r0: 19, peak: 13, heads: 80,
  },
  {
    id: 10, deck: 40, name: 'The Forge', shape: 'alcoveshop',
    look: 'a stall grown into a shop: hilt parts on pegboard, a bench with a vice, a kyber cabinet lit from inside',
    who: 'Bo Vhett, a Mandalorian smith', idle: 'hammering, sparks', verb: 'work the hilt and blade',
    kiosk: 'hilt', band: 'concourse', side: -1, along: 14, w: 13, d: 10, h: 4.4, peak: 15, heads: 2,
  },
  {
    id: 11, deck: 40, name: "Quartermaster's cage", shape: 'cage',
    look: 'a wire cage under the gallery, racks of kit, a counter with a hatch',
    who: 'a clone QM and a droid', idle: 'kit issued to men queuing', verb: 'draw kit and paint',
    kiosk: 'kit', band: 'concourse', side: 1, along: 14, w: 13, d: 9, h: 3.6, peak: 7, heads: 3,
  },
  {
    id: 12, deck: 40, name: 'Recruiting office', shape: 'glassfront',
    look: 'glass-fronted, the Republic crest, a holoscreen of the war',
    who: 'a recruiter, a queue', idle: 'recruits sworn in', verb: 'read the Muster slate',
    kiosk: 'muster', band: 'concourse', side: -1, along: 33, w: 14, d: 11, h: 4.0, peak: 9, heads: 5,
  },
  {
    id: 13, deck: 40, name: 'The Databank', shape: 'rotunda',
    look: 'a round reading room, terminals in a ring, a holo globe at the centre',
    who: 'a librarian droid, 6 readers', idle: 'the globe cycles the war’s fronts',
    /* AND THE REGISTER, which is one of the eight terminals and is where V15
     * §1.1 says the station is named. A verb that does not say so is a feature
     * nobody finds — see `Station.beginStationName`. */
    verb: 'read the Databank — or the register, to name the station',
    kiosk: 'databank', band: 'concourse', side: 1, along: 33, w: 18, d: 18, h: 5.6, peak: 16, heads: 7,
  },
  {
    id: 14, deck: 40, name: 'Cantina "The Long Night"', shape: 'sunkenround',
    look: 'sunk half a deck below the concourse; a bar in the round, booths in the wall, a band’s dais, coloured lights',
    who: 'a Drazi barkeep, 24 drinkers, a band',
    idle: 'songs; a brawl once an hour the guards break up; a Sith acolyte drinking alone',
    verb: 'sit and drink', band: 'outer', at: 52, w: 26, d: 24, h: 6.5, peak: 21, heads: 26,
  },
  {
    id: 15, deck: 40, name: 'The Fresh Air', shape: 'terrace',
    look: 'a terrace over the atrium: white cloth, plants, a kitchen seen through the pass',
    who: 'a Centauri maître d’, 16 diners, 4 cooks', idle: 'service at meal hours, plates carried, the pass rings',
    verb: 'eat', band: 'inner', at: 112, w: 20, d: 12, h: 4.6, peak: 19, heads: 21,
  },
  {
    id: 16, deck: 40, name: 'Galley', shape: 'workroom',
    look: 'the working kitchen behind it: ranges, hanging pots, a walk-in cold room, steam',
    who: '6 cooks on shifts', idle: 'prep, the meal rush, cleaning', verb: 'throw pots',
    band: 'inner', at: 148, w: 15, d: 11, h: 3.4, peak: 18, heads: 6,
  },
  {
    id: 17, deck: 40, name: 'Food court', shape: 'lowcounters',
    look: 'counters in a row under a low ceiling, stools, neon, steam vents',
    who: '3 vendors, 20 eaters', idle: 'the shift-change queue', verb: 'eat cheap',
    band: 'outer', at: -52, w: 22, d: 9, h: 3.0, peak: 14, heads: 23,
  },
  {
    id: 18, deck: 40, name: 'The Pit', shape: 'lowden',
    look: 'a lower room off the cantina: sabacc tables, a dice cage, a cashier behind bars, one exit',
    who: 'a Brakiri house, 12 players, a bouncer', idle: 'games; a cheat thrown out',
    verb: 'watch and bet', band: 'outer', at: 76, w: 18, d: 14, h: 3.2, peak: 23, heads: 14,
  },
  /**
   * ── #60 THE WHEELHOUSE (V16 §D1) ──────────────────────────────────────
   *
   * *"you should be able to play some of the casino games these should be
   * actual games within games … in certain games you play against actual npcs
   * like it could be anyone on the ship on any day."*
   *
   * `Games.js` — sabacc, the Dejarik Column and the Drum — has been finished
   * and 4/4 green since Lane D landed, and it was in NO SHIPPED BUILD: the
   * only occurrence of the string "Games.js" anywhere under `src/` was a
   * sentence in a comment in `Bars.js`, so `tools/pack.mjs` walked the module
   * graph from `main.js` and never reached it. Three games nobody could play.
   * §D1 asks for the room they are in and this is it.
   *
   * ── 89.85 DEGREES, AND THE NUMBER IS THE WHOLE OF THE SITING ──────────
   *
   * §D1 says "deck 40 outer, next to `#18 The Pit` so the whole gambling
   * quarter is one walk", and deck 40's outer band is the fullest on the
   * station. A probe that imports `PLACES` and runs `station.mjs`'s own two
   * tests — the separating-axis test on the yawed rectangles at 0.5 m slack,
   * and the door-arc clearance against every walkway fixture — over every
   * bearing at every size found EXACTLY ONE WINDOW in the whole 360:
   *
   *   w=26  nothing   w=22  nothing   w=18  nothing   w=16  89.5..89.75
   *   w=14 d=16  **89.20 .. 90.50**   w=12 d=16  88.50 .. 91.25
   *
   * Everything wider is refused: `#18 The Pit` at 76 runs its corners out to
   * 89.1 and `Chandler & lamps` at 100 is a span-8 shopfront whose edge is at
   * 96, and a room is a rectangle at a radius, so a 16-metre front swings its
   * corners past both. 14 by 16 at 89.85 is the middle of the only window
   * there is, with 0.65 degrees of clearance on each side — measured, not
   * chosen. `#58` took three attempts for want of this probe.
   *
   * DEEP RATHER THAN WIDE is therefore forced, and it is also the right room:
   * you come off the ring through a narrow front and the hall runs AWAY from
   * you with the wheel at the far end of it, which is what a casino does to a
   * person walking in.
   *
   * `peak: 1` and `heads: 22`. The gambling quarter is a night quarter — the
   * cantina peaks at 21, the Pit at 23 — and this is the last thing still
   * open. It is also the only room on deck 40 whose hour is past midnight,
   * so `headcount` genuinely empties it in the afternoon.
   */
  {
    id: 60, deck: 40, name: 'The Wheelhouse', shape: 'wheelhall',
    look: 'a narrow front off the ring opening into a tall hall: the Drum itself — a twenty-segment '
      + 'wheel eleven metres across, stood on edge and lit from behind — fills the far end over a '
      + 'raised dais; sabacc tables in the low half, a lit dejarik column on the floor between them, '
      + 'a cage of a cashier by the door and a rail of standing drinkers along one wall',
    who: 'a Brakiri house, three at each table, dancers on the dais when the wheel is not turning',
    idle: 'the wheel is spun on the hour whether anybody is there or not; hands are dealt between',
    verb: 'take a seat — sabacc, dejarik or the Drum',
    band: 'outer', at: 89.85, w: 14, d: 16, h: 7.4, peak: 1, heads: 22,
  },
  {
    id: 19, deck: 40, name: 'Holo-theatre', shape: 'fanauditorium',
    look: 'a fan-shaped auditorium of 60 seats facing a stage where the last run plays as a battle holo',
    who: '20–40 watching', idle: 'shows on the hour', verb: 'watch your last run',
    band: 'outer', at: -75, w: 28, d: 22, h: 7.2, peak: 20, heads: 30,
  },
  {
    id: 20, deck: 40, name: 'The Arena', shape: 'sunkenring',
    look: 'a sunken ring with tiered benches, training remotes overhead, racks of practice sabers',
    who: '2 sparring, 12 watching, a marshal', idle: 'bouts on a schedule', verb: 'fight a bout',
    band: 'outer', at: -104, w: 30, d: 28, h: 9.0, peak: 17, heads: 15,
  },
  {
    id: 21, deck: 40, name: 'Gym', shape: 'runninggallery',
    look: 'bars, weights, a running gallery round the atrium',
    who: '10', idle: 'drills', verb: 'take a beat',
    band: 'inner', at: -105, w: 20, d: 12, h: 4.4, peak: 6, heads: 10,
  },
  {
    id: 22, deck: 40, name: 'Chapel', shape: 'darkdrum',
    look: 'a dark drum with a single skylight to space, candles, mats, a Force shrine',
    who: 'a chaplain, kneelers', idle: 'vigils; a memorial for the dead', verb: 'kneel and connect',
    band: 'outer', at: -126, w: 18, d: 18, h: 10.5, peak: 5, heads: 6,
  },
  {
    id: 23, deck: 40, name: 'Arboretum', shape: 'cutthrough',
    look: 'a cut through decks 40–44: real trees, a stream, benches, birds',
    who: '12', idle: 'watering droids; the hawk perches', verb: 'walk, sit',
    band: 'outer', at: -150, w: 30, d: 26, h: 20, peak: 12, heads: 12,
  },
  {
    id: 24, deck: 40, name: 'Security post', shape: 'booth',
    look: 'a booth at the atrium bridge, screens, a cell behind glass',
    who: '2 guards', idle: 'patrol pairs leave from here', verb: 'report',
    band: 'atrium', at: 62, w: 9, d: 7, h: 3.2, peak: 22, heads: 2,
  },
  {
    id: 25, deck: 40, name: 'Lost & found', shape: 'noticewall',
    look: 'a wall of paper and holo notes, a droid',
    who: '1', idle: 'notices change daily', verb: 'read the notices',
    band: 'concourse', side: -1, along: 52, w: 11, d: 6, h: 3.4, peak: 10, heads: 2,
  },

  {
    /**
     * ══ #56, ADDED BY V15 ═══════════════════════════════════════════════
     *
     * The player asked for a leaderboard that persists between runs and said
     * it should be a PLACE you visit rather than a screen. `V15.md` §1.2 and
     * `SHARK.md` §16 carry the argument; the short of it is that a screen is
     * a menu with a wall behind it, and a thing you walk round that is taller
     * than the room it is in and visible from two other decks is a landmark —
     * which is what §3.1 rule 1 says this station needs more of.
     */
    id: 56, deck: 40, name: 'The Standing', shape: 'obelisk',
    look: 'a tall narrow hall off the Concourse’s east gallery with a black obelisk three decks high running up through a cut in the soffit; four cut faces, turning slowly; your own row lit and everyone else’s engraved',
    who: 'a few reading it at any hour, a crowd after a run files',
    idle: 'rows change as runs file', verb: 'read the rolls — find your own row',
    band: 'concourse', side: 1, along: 52, w: 12, d: 11, h: 26, peak: 15, heads: 6,
  },
  /* ══ DECK 44 — THE LIVING DECK. Cool: white, timber, blue-white. ═════ */
  {
    id: 26, deck: 44, name: 'The Promenade', shape: 'windowring',
    look: 'the living deck’s ring: window wall to space, the tram guideway outside',
    who: 'walkers on rhythm', idle: 'the tram passes; the battle outside', verb: 'walk',
    ring: true, band: 'ring', at: 0, w: 0, d: 0, h: 5.4, peak: 18, heads: 20,
  },
  {
    id: 27, deck: 44, name: 'Your cabin', shape: 'twinroom',
    look: 'two rooms, a real window, a saber stand, a trophy wall, a mirror, a bunk, and whatever you have put in it',
    who: 'you; the companion sleeping', idle: 'the trophies grow; a note on the desk',
    /* V15 §1.3 made this a home rather than a room, and the verb is the whole
     * of §14's prompt — so the three things `Home.js` added to it are named
     * here or a player is never told they can do them. */
    verb: 'sleep, dress, read — move the furniture, wheel to choose, the mirror to change your '
      + 'face, the plan table to name the station',
    band: 'inner', at: 0, w: 15, d: 11, h: 3.4, peak: 23, heads: 1,
  },
  {
    id: 28, deck: 44, name: 'The Kennel habitat', shape: 'mezzanine',
    look: 'a high room with a mezzanine, straw, perches, a pool, a run onto the arboretum',
    who: 'every companion you ever kept; a handler', idle: 'animals play, eat, sleep; plaques for the dead',
    verb: 'feed, play, groom', band: 'inner', at: -42, w: 22, d: 18, h: 9.4, peak: 9, heads: 3,
  },
  {
    id: 29, deck: 44, name: 'Company barracks', shape: 'bunkhall',
    look: 'a long bunk hall split by lockers into bays, a slate on the wall, a stove',
    who: 'your company off duty', idle: 'cards, sleep, kit cleaning, a sergeant’s inspection',
    verb: 'read the Muster slate', kiosk: 'muster',
    band: 'inner', at: 46, w: 32, d: 13, h: 3.6, peak: 22, heads: 18,
  },
  {
    id: 30, deck: 44, name: "Officers' quarters", shape: 'doorcorridor',
    look: 'a curved corridor of doors, one open; wood and brass',
    who: '6 officers', idle: 'comings and goings', verb: 'knock',
    band: 'outer', at: 40, w: 26, d: 8, h: 3.2, peak: 21, heads: 6,
  },
  {
    id: 31, deck: 44, name: 'Human residential', shape: 'lightwell',
    look: 'a stacked two-level cabin block round a light well',
    who: '30', idle: 'laundry lines, children, an argument', verb: 'walk',
    band: 'outer', at: 68, w: 26, d: 24, h: 9.6, peak: 20, heads: 30,
  },
  {
    id: 32, deck: 44, name: 'Narn quarter', shape: 'stonelow',
    look: 'red stone, braziers, a shrine, low ceilings',
    who: '16 Narn', idle: 'prayer at dawn; a market of their own', verb: 'walk, trade',
    band: 'outer', at: 102, w: 24, d: 22, h: 3.0, peak: 6, heads: 16,
  },
  {
    id: 33, deck: 44, name: 'Centauri quarter', shape: 'giltcourt',
    look: 'white, gilt, a fountain, portraits, a card room',
    who: '14 Centauri', idle: 'intrigue; a duel of words', verb: 'walk',
    band: 'outer', at: 140, w: 22, d: 20, h: 6.2, peak: 22, heads: 14,
  },
  {
    id: 34, deck: 44, name: 'Minbari quarter', shape: 'triangular',
    look: 'crystal, blue light, a triangular hall, silence',
    who: '12 Minbari', idle: 'ritual at set hours', verb: 'walk quietly',
    band: 'outer', at: -172, w: 24, d: 21, h: 7.6, peak: 4, heads: 12,
  },
  {
    id: 35, deck: 44, name: 'Drazi quarter', shape: 'fightingpit',
    look: 'a fighting pit, colours, noise',
    who: '14 Drazi', idle: 'the green/purple brawl', verb: 'get pulled in',
    band: 'outer', at: -140, w: 22, d: 22, h: 5.0, peak: 15, heads: 14,
  },
  {
    id: 36, deck: 44, name: 'The methane quarter', shape: 'walkwaypools',
    look: 'behind an airlock: yellow haze, walkways over pools',
    who: '10 in suits (Gaim, Pak’ma’ra)', idle: 'suit checks', verb: 'walk in a suit',
    band: 'outer', at: -108, w: 24, d: 20, h: 5.8, peak: 13, heads: 10,
  },
  {
    id: 37, deck: 44, name: "The Vorlon's door", shape: 'deadend',
    look: 'a sealed door at the end of a dead corridor: organic, a hum, one light',
    who: '—', idle: 'the light changes', verb: 'stand there',
    band: 'outer', at: -80, w: 6, d: 16, h: 3.4, peak: 3, heads: 0,
  },
  {
    id: 38, deck: 44, name: 'Transient hostel', shape: 'capsulewall',
    look: 'capsule bunks in a wall, a desk',
    who: '20 travellers', idle: 'turnover with each shuttle', verb: 'rent a bunk',
    band: 'outer', at: -56, w: 20, d: 12, h: 4.2, peak: 23, heads: 20,
  },
  {
    id: 39, deck: 44, name: 'Laundry & showers', shape: 'steamrows',
    look: 'steam, rows, a droid',
    who: '6', idle: 'cycles', verb: 'take a beat',
    band: 'outer', at: -26, w: 18, d: 10, h: 3.0, peak: 17, heads: 6,
  },
  /**
   * ── #61 THE UNDERLIFT PIT (V16 §G5) ───────────────────────────────────
   *
   * The illegal one. `#20 The Arena` up on deck 40 is licensed, refereed and
   * has a doctor at the rail; this is a cut in the deck plate in a SERVICE
   * GAP off the ring — the length of walkway between the laundry and the
   * officers' doors where the plating is up and nobody has a reason to be.
   *
   * ITS HOUR IS 02:00, WHICH IS THE ONLY PLACE ON DECK 44 WITH ONE. Every
   * other row on this deck peaks in the day or the evening; a `peak` in the
   * small hours is what makes "not always available or offered" a fact about
   * the station's day rather than a flag in a file, because `headcount` reads
   * `peak` and the gap is genuinely empty at noon.
   *
   * `heads` is 16 standing at the lip — no benches, no tiers, and nowhere to
   * sit is half of what makes it read as the wrong kind of room.
   */
  {
    id: 61, deck: 44, name: 'The Underlift Pit', shape: 'chainpit',
    look: 'a service gap with the deck plate up: a rectangular cut two and a half metres down, '
      + 'chain-link stretched over it on a bent frame, one hanging lamp, a spool of cable, '
      + 'and sixteen people standing on the grating at the lip',
    who: '16 at the lip, two handlers, a man taking the book',
    idle: 'a card runs from 22:00 on the nights it runs at all; money changes hands at the rail',
    verb: 'fight a bout — no referee',
    band: 'outer', at: 6, w: 16, d: 14, h: 4.4, peak: 2, heads: 16,
  },
  /**
   * ── #58 THE UNDERLIFT — V16 §B4's black market ────────────────────────
   *
   * *"the black market smuggler types only deal with sith."*
   *
   * THE COUNTER EXISTED AND THE ROOM DID NOT. `Vendors.UNDERLIFT` has named
   * place 58 since Lane B landed — a `refuse` list that turns a Jedi away in
   * words, a shelf dark two days in three, nine rows nobody else carries — and
   * `countersAt(58)` could never fire, because 58 was not in this table. One
   * of the seven shops in the game, and the only one gated on your order, had
   * no room to stand in.
   *
   * ON THE SERVICE DECK, BESIDE THE CARGO HOLD, and that is where the
   * measurement put it rather than where the name first suggested.
   *
   * THREE CUTS AND THE STATION REFUSED TWO OF THEM. The obvious place is the
   * living deck beside `#61 The Underlift Pit`, and deck 44's outer band has
   * no room left: clockwise of the pit, `#30`'s doors begin at 30.8 degrees
   * and `The star bay` stands at 20 in the middle of what is left;
   * anticlockwise, the `Night market` fixture holds -16 to -8 and the laundry
   * has the rest. The station said both in its own words — "#30 × #58 by 4.0
   * m", then "The star bay at 20 degrees is in the door of #58", then "Night
   * market at 348 degrees is in the door of #58". Moving somebody else's
   * window bay to make room would have been the wrong repair.
   *
   * Deck 48 has the widest unclaimed arc on either deck, between `The fab
   * bench` and `#52 The cargo hold`, and it is the better room anyway:
   * smuggled cargo arrives in the cargo hold, and a man working out of
   * containers on the service deck is where it goes next. The pit stays on 44
   * and this is one deck under it, which is what the underlift is — the space
   * around the lift core that nobody drew a room on.
   *
   * 84.5 DEGREES AND TWELVE METRES, and both numbers came off the station's
   * own two tests rather than off a ruler. A room is a rectangle at a radius,
   * not an arc, so its corners swing further round than its width suggests:
   * the separating-axis test leaves 77.5 to 85 clear for twelve metres and
   * only 79 to 83.5 for sixteen. And the door arc has to miss `The fab bench`
   * at 77, which needs 6.7 degrees of clearance for a twelve-metre door —
   * 83.8 at the earliest. The two windows overlap in about a degree, and this
   * sits in it.
   *
   * `peak: 1` — the small hours, the same as the pit, so a player who walks
   * down for one may as well try the other.
   *
   * `heads` is 2 — the smuggler and one other. A black market with a crowd in
   * it is a market.
   */
  {
    id: 58, deck: 48, name: 'The Underlift', shape: 'containerrow',
    look: 'a service gap with cargo containers stacked two high down one side and one down the '
      + 'other, an aisle between; every box shut but one, a plank across its mouth for a counter, '
      + 'a hand lamp clamped to the door frame and pointed in',
    who: '2 — a smuggler and whoever is ahead of you',
    idle: 'the shutter is down two days in three; when it is up he does not look at your face',
    verb: 'see what he has',
    band: 'outer', at: 84.5, w: 12, d: 12, h: 5.0, peak: 1, heads: 2,
  },
  /* #40 is FOUR platforms and they are four DIFFERENT rooms (§3.2). They keep
   * one id because the gazetteer gives them one; `station.mjs` measures rule 4
   * across all four as separate silhouettes, which is the point of them. */
  {
    id: 40, deck: 44, name: 'Tram station — Arrivals', shape: 'glassplatform', stop: 'arrivals',
    look: 'glass: a platform under a clear barrel, the guideway on both sides',
    who: 'waiting crowds', idle: 'trams every 90 s', verb: 'ride',
    band: 'tram', at: 180, w: 20, d: 9, h: 5.0, peak: 11, heads: 9,
  },
  {
    id: 40.2, deck: 44, name: 'Tram station — Concourse East', shape: 'brassplatform', stop: 'concourse',
    look: 'brass: a deep bay with a ribbed brass soffit and a bench island',
    who: 'waiting crowds', idle: 'trams every 90 s', verb: 'ride',
    band: 'tram', at: 90, w: 20, d: 9, h: 5.0, peak: 13, heads: 12,
  },
  {
    id: 40.3, deck: 44, name: 'Tram station — Quarters', shape: 'timberplatform', stop: 'quarters',
    look: 'timber: a low warm platform with slatted screens and hanging lamps',
    who: 'waiting crowds', idle: 'trams every 90 s', verb: 'ride',
    band: 'tram', at: 0, w: 20, d: 9, h: 4.4, peak: 18, heads: 8,
  },
  {
    id: 40.4, deck: 44, name: 'Tram station — Command', shape: 'steelplatform', stop: 'command',
    look: 'steel: a bare guarded platform, a checkpoint arch, one bench',
    who: 'waiting crowds', idle: 'trams every 90 s', verb: 'ride',
    band: 'tram', at: -90, w: 20, d: 9, h: 5.0, peak: 6, heads: 5,
  },

  /* ══ DECK 48 — THE WORKING DECK. Dark: steel, red-orange, exposed pipe. */
  {
    id: 41, deck: 48, name: 'Command / CIC', shape: 'daispit', room: 'cnc',
    look: 'the imported CnC: the console dais, a tactical wall showing the battle outside, the comms pit',
    who: 'a commander, 8 officers, 3 shifts', idle: 'the front moves on the wall; orders read out',
    verb: 'brief the next campaign', kiosk: 'campaign',
    band: 'outer', at: 180, w: 14.3, d: 13, h: 9.9, peak: 14, heads: 9,
  },
  {
    id: 42, deck: 48, name: 'Comms & sensor room', shape: 'screendrum',
    look: 'a dark drum of screens, a rotating dish through a window',
    who: '4', idle: 'traffic', verb: 'listen to the fleet channel',
    band: 'outer', at: -160, w: 16, d: 16, h: 4.6, peak: 2, heads: 4,
  },
  {
    id: 43, deck: 48, name: 'Medbay', shape: 'triagehall',
    look: 'a triage hall, six curtained bays, a surgery seen through glass, the 2-1B',
    who: '2 medics; the wounded from your last run', idle: 'surgeries; a crash-cart run when a fighter comes in damaged',
    verb: 'see your wounded', band: 'outer', at: -134, w: 26, d: 16, h: 4.4, peak: 10, heads: 8,
  },
  {
    id: 44, deck: 48, name: 'Bacta ward', shape: 'tankrow',
    look: 'a row of lit tanks with men suspended',
    who: '4', idle: 'tanks fill and drain', verb: 'look',
    band: 'outer', at: -112, w: 20, d: 10, h: 5.6, peak: 10, heads: 4,
  },
  {
    id: 45, deck: 48, name: 'Morgue & memorial', shape: 'namewall',
    look: 'cold drawers, a wall of names',
    who: 'a mortician', idle: 'the roll grows', verb: 'read the names',
    band: 'outer', at: -94, w: 18, d: 12, h: 3.6, peak: 3, heads: 2,
  },
  {
    id: 46, deck: 48, name: 'Armoury', shape: 'cagerange',
    look: 'cages of rifles, a saber vault, a bench, a range beyond a window',
    who: 'an armourer, 4', idle: 'issue; test-fire on the range', verb: 'draw a loadout; shoot the range',
    kiosk: 'loadout', band: 'outer', at: -70, w: 30, d: 13, h: 4.0, peak: 8, heads: 5,
  },
  {
    id: 47, deck: 48, name: 'The Brig', shape: 'cellring',
    look: 'a curved cell block round a guard desk, force-field doors',
    who: '2 guards, 6 prisoners', idle: 'meals; a transfer', verb: 'wake here after a crime',
    band: 'outer', at: -40, w: 22, d: 20, h: 4.2, peak: 12, heads: 8,
  },
  {
    id: 48, deck: 48, name: 'Reactor hall', shape: 'cathedral',
    look: 'a cathedral: the core a pulsing blue column three decks tall, catwalks spiralling round it, heat shimmer',
    who: '10 engineers, droids', idle: 'power surges dim the deck; a coolant vent', verb: 'walk the catwalks',
    band: 'outer', at: 0, w: 32, d: 32, h: 30, peak: 14, heads: 11,
  },
  {
    id: 49, deck: 48, name: 'Coolant & water plant', shape: 'wetgrating',
    look: 'a wet room of pipes and tanks, grating over water, turquoise light',
    who: '6', idle: 'pumps cycle', verb: 'throw things in the water',
    band: 'outer', at: 36, w: 24, d: 18, h: 6.2, peak: 16, heads: 6,
  },
  {
    id: 50, deck: 48, name: 'Fabrication', shape: 'machineshop',
    look: 'lathes, a plasma cutter, sparks, a droid being rebuilt',
    who: '8', idle: 'parts made', verb: 'cut with the blade',
    band: 'outer', at: 62, w: 26, d: 16, h: 5.0, peak: 11, heads: 8,
  },
  {
    id: 51, deck: 48, name: 'Droid pool', shape: 'chargingrows',
    look: 'astromechs in charging rows, a protocol droid on a bench',
    who: '30 droids', idle: 'droids leave for jobs and return', verb: 'call the astromech',
    band: 'inner', at: 0, w: 22, d: 12, h: 3.4, peak: 3, heads: 30,
  },
  {
    id: 52, deck: 48, name: 'Cargo hold', shape: 'canyon',
    look: 'a canyon of container stacks, a crane overhead, a lifter',
    who: '6', idle: 'stacks move', verb: 'the sandbox — everything here is a body',
    band: 'outer', at: 104, w: 34, d: 24, h: 14, peak: 9, heads: 6,
  },
  {
    id: 53, deck: 48, name: 'Waste & recycling', shape: 'compactor',
    look: 'a pit, a compactor, a smell',
    who: '3', idle: 'the compactor crushes', verb: 'throw a crate in and watch it die',
    band: 'outer', at: 136, w: 20, d: 16, h: 8.0, peak: 20, heads: 3,
  },
  /**
   * ── #57 THE REPEATING ROOM (V16 §A2) ──────────────────────────────────
   *
   * *"a holodeck/dojo that replaces the training and sandbox menus — you walk
   * into a room and program it rather than picking a tab."*
   *
   * IT IS ON THE WORKING DECK AND NOT THE LIVING ONE, because that is what it
   * is: a machine you operate. Deck 48 is the reactor, the fabricators, the
   * coolant plant and the droid pool; a projection room on the residential
   * deck would read as a leisure room, and the point of the ask is that it is
   * PROGRAMMED.
   *
   * AND IT IS ON THE BALCONY, WHICH IS THE ONE INTERESTING THING ABOUT WHERE
   * IT STANDS. The `inner` band is described one screen down as "the places
   * that want the void in the window" — and this is the room that has no
   * window at all. A sealed black box on the outer edge of the biggest open
   * space in the hull, on the deck's best frontage, is the room stating what
   * it is before you reach the door: everything else on this balcony looks at
   * two other decks and the people on them, and this one looks at nothing
   * because what is inside it is not here.
   *
   * The ring was tried first and the ring is full. Between `#50 Fabrication`
   * (ending at 72.1°) and `#52 The cargo hold` (starting at 90.2°) there are
   * 18.1° of ring, and `The fab bench` — a walkway fixture, §"the between-space
   * gets a gazetteer too" — stands at 77° in the middle of them. Measured with
   * `station.mjs`'s own door-clash arithmetic, no width of room and no bearing
   * for the bench clears both the two rooms and each other; the bench would
   * have had to be deleted to fit a cube in there, and a fixture deleted to
   * make room is exactly the walkway thinning that table exists to prevent.
   * The balcony has 12° of clear arc either side of it and no fixture on the
   * band at all.
   *
   * ITS HOUR IS 21:00. Every other room on this deck peaks on a shift; this
   * one fills after the last one, because practice is what you do when the
   * work is finished. `headcount` reads `peak`, so the room is genuinely empty
   * at ten in the morning — you have it to yourself, which is half of what a
   * practice room is for.
   *
   * `heads` is 3: two waiting their turn on the bench outside and the
   * technician who keeps the emitters trimmed. Not a crowd. A room with an
   * audience is `#20 The Arena`, and this one has no audience by design.
   *
   * SHAPE, and rule 4 measured rather than hoped for: `latticecell` is a CUBE
   * — 16 × 14 × 8.2 — studded on all six faces on one pitch and empty on the
   * floor but for the plinth. Nothing else on deck 48 is a cube and nothing
   * else on the station is regular in three axes at once. The number is in
   * `latticecell`'s own note and in `tools/checks/holodeck.mjs`, which
   * measures it on THIS deck with `station.mjs`'s own raster — that check
   * pairs deck 40 only, because `dressStation` builds one deck a boot.
   */
  {
    id: 57, deck: 48, name: 'The Repeating Room', shape: 'latticecell',
    look: 'a black cube with no window: every face — floor, walls and soffit — studded with '
      + 'emitters on one square pitch, an empty floor, and a single lit plinth dead centre; '
      + 'a rack of grey calibration blocks in the reveal by the door',
    who: 'a technician trimming the emitters; two waiting outside',
    idle: 'the room runs the last program it was given, empty, so the walls are never the same twice',
    verb: 'program the room — the lessons, and a room of your own',
    band: 'inner', at: 45, w: 16, d: 14, h: 8.2, peak: 21, heads: 3,
  },

  /* ══ DECK 60 — ABOVE THE DRUM ═══════════════════════════════════════════ */
  {
    id: 54, deck: 60, name: 'Observation dome', shape: 'glassdome', room: 'rotunda',
    look: 'the imported rotunda: a glass dome onto the planet and the battle, a bar, benches, a telescope',
    who: '20 off duty', idle: 'the reactor flash lights the room', verb: 'watch the battle',
    band: 'hub', at: 0, w: 14.4, d: 17.9, h: 7.5, peak: 22, heads: 20,
  },
  /* ══ AND THE OUTSIDE, which is a level and not a room ══════════════════ */
  {
    id: 55, deck: null, name: "The station's outside", shape: 'orbit',
    look: 'from the Starfury: the hull, the drum, the flight deck’s mouth, the docking throat, the dome',
    who: 'the fleet', idle: 'the war', verb: 'fly',
    external: true, peak: 12, heads: 0,
  },
];

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE LAYOUT PASS — a band and an angle become an (x, z, yaw, door)         */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHY THE COORDINATES ARE DERIVED AND NOT TYPED ═════════════════════════
 *
 * The first draft of this table carried an (x, z, yaw, door) on every row,
 * hand-placed. Checked, it had **fourteen pairs of rooms overlapping and nine
 * rooms sticking out through the drum's skin** — on a plan nobody could see,
 * because a number in a table looks the same whether or not the room next to
 * it is standing in the same volume.
 *
 * So a row declares WHERE IT BELONGS — a band and a bearing — and the
 * geometry falls out. The bands are the drum's own structure:
 *
 *   `outer`      hangs inboard off the ring walk, door on the ring. Most
 *                places. Depth `d` inward from `DRUM.roomR`.
 *   `inner`      stands on the atrium balcony's outer edge, door on the
 *                balcony. The places that want the void in the window.
 *   `radial`     runs from the balcony out to the skin, crossing the ring —
 *                the Concourse, which is deck 40's fourth spine.
 *   `concourse`  an alcove opening off the Concourse's own side wall, at
 *                `along` metres down the hall on `side` ±1.
 *   `atrium`     out over the void on the bridge.
 *   `ring`       IS the ring — the Promenade (#26).
 *   `tram`       outside the skin, on the guideway (#40 and its three).
 *   `skin`       through the skin — the docking throat (#8).
 *   `hub`        alone on its deck, on the axis — the dome (#54).
 *   `deck32` / `deck12`  the hangar's own frame, where an (x, z) IS the datum
 *                and the drum's polar frame means nothing.
 *
 * A bearing is DEGREES, zero down +Z (the Concourse), positive toward +X.
 * `station.mjs` checks that no two places on a deck overlap and that nothing
 * reaches through the skin — which is the check that found the fourteen.
 */
const D2R = Math.PI / 180;

function layout(p) {
  if (p.external) {
    p.x = 0; p.z = 0; p.yaw = 0; p.door = [0, 0];
    return p;
  }
  const a = (p.at || 0) * D2R;
  const sa = Math.sin(a), ca = Math.cos(a);
  const polar = (r) => [r * sa, r * ca];
  switch (p.band) {
    case 'deck32': case 'deck12':
      /* Already cartesian: the flight deck's frame is `Hangar.js`'s and the
       * drum's polar one would be a second answer to where its own pad is. */
      return p;
    case 'outer': {
      const rMid = DRUM.roomR - p.d / 2;
      [p.x, p.z] = polar(rMid);
      /* Local +Z points radially OUTWARD, so the room's far wall is the skin
       * side and its door is at local -Z, on the ring. */
      p.yaw = a;
      p.door = polar(DRUM.roomR - 0.4);
      p.rIn = DRUM.roomR - p.d; p.rOut = DRUM.roomR;
      return p;
    }
    case 'inner': {
      const rMid = DRUM.balcony + p.d / 2;
      [p.x, p.z] = polar(rMid);
      /* Local +Z points INWARD, at the void: an inner place is one that wants
       * the atrium in its window. */
      p.yaw = a + Math.PI;
      p.door = polar(DRUM.balcony + 0.4);
      p.rIn = DRUM.balcony; p.rOut = DRUM.balcony + p.d;
      return p;
    }
    case 'radial': {
      const r0 = p.r0 ?? DRUM.balcony;
      const rMid = r0 + p.d / 2;
      [p.x, p.z] = polar(rMid);
      p.yaw = a;
      p.door = polar(r0 + 0.4);
      p.rIn = r0; p.rOut = r0 + p.d;
      return p;
    }
    case 'concourse': {
      /* The Concourse runs down +Z from `r0`. An alcove opens through its side
       * wall at `along` metres from the inner end, on `side` ±1 (−1 is −X). */
      const hall = PLACE_DRAFT.get(9);
      const halfW = hall.w / 2;
      p.z = (hall.r0 ?? DRUM.balcony) + p.along;
      p.x = p.side * (halfW + p.d / 2);
      /* Local +Z points away from the hall, so the alcove's back wall is
       * outboard and its opening is the hall's own wall line. */
      p.yaw = p.side < 0 ? -Math.PI / 2 : Math.PI / 2;
      p.door = [p.side * (halfW - 0.3), p.z];
      return p;
    }
    case 'atrium': {
      const rMid = DRUM.atrium - 4;
      [p.x, p.z] = polar(rMid);
      p.yaw = a + Math.PI;
      p.door = polar(DRUM.balcony - 1);
      return p;
    }
    case 'ring': {
      /* The ring is not a room and has no centre. Its door is where the
       * atrium spine meets it, which is where a walk onto it starts. */
      p.x = 0; p.z = DRUM.ringR; p.yaw = 0;
      p.door = [0, DRUM.roomR - 1];
      p.w = 2 * Math.PI * DRUM.ringR; p.d = DRUM.ringW;
      return p;
    }
    case 'tram': {
      [p.x, p.z] = polar(DRUM.tramR);
      p.yaw = a;
      /* You reach a platform from the ring, through the skin. */
      p.door = polar(DRUM.R - 1);
      return p;
    }
    case 'skin': {
      [p.x, p.z] = polar(DRUM.R + p.d / 2 - 1);
      p.yaw = a;
      p.door = polar(DRUM.R - 1);
      return p;
    }
    case 'hub':
      p.x = 0; p.z = 0; p.yaw = 0; p.door = [0, -p.d / 2 + 0.5];
      return p;
    default:
      throw new Error(`StationPlan: place #${p.id} has no band`);
  }
}

/* The Concourse has to be laid out before its alcoves can ask where its wall
 * is, and `PLACES` is in gazetteer order, not dependency order. One pass for
 * the halls, one for what opens off them — which is two lines here and would
 * be a whole ordering rule if the alcoves each carried their own copy of the
 * hall's half-width. */
const PLACE_DRAFT = new Map(PLACES.map((p) => [p.id, p]));
for (const p of PLACES) if (p.band !== 'concourse') layout(p);
for (const p of PLACES) if (p.band === 'concourse') layout(p);

/** By id, for the four readers. Ids are numbers and `40.2` is a real one. */
export const PLACE = new Map(PLACES.map((p) => [p.id, p]));

/** The places actually built inside the drum — everything with a footprint. */
export function placesOn(deck) { return PLACES.filter((p) => p.deck === deck && !p.external); }

/** Every deck the drum itself has, in the order the lift passes them. */
export const DECKS = [12, 32, 40, 44, 48, 60];

/**
 * A place's floor height. One function, because a place's `y` is never stored
 * on the row: a row that carried both a deck and a height is a row that can
 * disagree with itself, which is §2.3's signature defect.
 */
export function floorOf(place) { return DECK_Y[place.deck] ?? 0; }

/**
 * The corner-to-corner footprint of a place in world XZ, yaw included. Used by
 * the cull (§12.3), the reachability walk and the overlap check.
 */
export function footprint(p, out = { x0: 0, z0: 0, x1: 0, z1: 0 }) {
  const c = Math.abs(Math.cos(p.yaw)), s = Math.abs(Math.sin(p.yaw));
  const hx = (p.w * c + p.d * s) / 2, hz = (p.w * s + p.d * c) / 2;
  out.x0 = p.x - hx; out.x1 = p.x + hx;
  out.z0 = p.z - hz; out.z1 = p.z + hz;
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE BETWEEN-SPACE — the walkways get a gazetteer too                      */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ WHY THIS TABLE EXISTS, MEASURED ═══════════════════════════════════════
 *
 * The player: *"the station really should not read as a series of connected
 * rooms … it should feel like a place at large, the in-between places, the
 * walkways … Every single inch of the station needs to be thought out."*
 *
 * He was right, and the instrument agrees. `tools/_walkprobe.mjs` stood forty
 * points on the walkways of each deck and ran rule 4's own raster down them:
 *
 *   deck 40 ring, shell only:  worst pair **1.000**, 60 of 780 pairs over 0.85
 *   deck 44 ring, shell only:  worst pair **1.000**, 57 of 780
 *   deck 48 spines, shell only: worst pair **1.000**, 27 of 276
 *
 * 1.000 is not "similar". The view along the ring at bearing 0 and the view
 * along it at bearing 90 were the SAME PICTURE, cell for cell, because
 * `buildRing` was a `for (i < 72)` loop whose only variation was `i % 2` and
 * the ring's own rotational symmetry landed the two samples on the same phase.
 * All four spines were one corridor built four times. Nothing in the whole
 * between-space took a bearing as an input.
 *
 * This is the fix, and it is the same fix `PLACES` is: an ADDRESS TABLE. A
 * fixture is at a bearing on a deck, it is of a kind, and it has a name — so
 * the ring is a street with addresses on it rather than an extrusion, and
 * `station.mjs`'s walkway rule holds it there.
 *
 * ── HOW A BEARING WAS CHOSEN ──────────────────────────────────────────────
 *
 * Every one sits in a GAP between the door arcs of that deck's places, which
 * are printed by `tools/_bearings.mjs`. A fixture in front of a door is a
 * fixture in a doorway; `station.mjs` checks the clearance rather than
 * trusting the arithmetic here.
 *
 * kind   one of `FIXTURES` in `StationKit.js` — each its own builder, on the
 *        same rule 4 basis as `SHAPES`: two fixtures may share a part, never
 *        a plan
 * at     bearing in degrees, zero down +Z, positive toward +X
 * name   what a person would call it, and what the wayfinding says
 * span   how many degrees of ring it occupies (for the clearance check)
 */
export const WAYS = [
  /* ── DECK 40, THE CONCOURSE RING. A market street: stalls, planters,
   *    awnings, and the noise spilling out of the Concourse mouth. ─────── */
  { deck: 40, at: 16, kind: 'market', name: 'Ring stalls — the overflow', span: 10 },
  { deck: 40, at: 26, kind: 'planter', name: 'The brass planters', span: 6 },
  { deck: 40, at: 35, kind: 'bench', name: 'Concourse-side seating', span: 6 },
  { deck: 40, at: 66, kind: 'service', name: 'Dock hatch 66', span: 4 },
  { deck: 40, at: 100, kind: 'shopfront', name: 'Chandler & lamps', span: 8 },
  { deck: 40, at: 110, kind: 'alcove', name: 'The letter alcove', span: 6 },
  { deck: 40, at: 120, kind: 'stair', name: 'The eight steps', span: 9 },
  { deck: 40, at: 132, kind: 'kiosk', name: 'Way-kiosk 132', span: 4 },
  { deck: 40, at: 142, kind: 'shopfront', name: 'Tea and noodles', span: 8 },
  { deck: 40, at: 151, kind: 'gantry', name: 'Arrivals gantry', span: 4 },
  { deck: 40, at: 224, kind: 'service', name: 'Chapel service hatch', span: 3 },
  { deck: 40, at: 271, kind: 'kiosk', name: 'The arena kiosk', span: 3 },
  { deck: 40, at: 298, kind: 'service', name: 'Food-court service hatch', span: 2 },
  { deck: 40, at: 322, kind: 'shopfront', name: 'Ironmonger', span: 8 },
  { deck: 40, at: 341, kind: 'bay', name: 'The long window', span: 5 },
  { deck: 40, at: 333, kind: 'bench', name: 'Forge-side seating', span: 5 },
  { deck: 40, at: 9, kind: 'kiosk', name: 'Way-kiosk 9', span: 3 },
  { deck: 40, at: 350, kind: 'gantry', name: 'Concourse gantry', span: 4 },

  /* ── DECK 44, THE PROMENADE. The window wall is the street's one side, so
   *    what stands on it faces the glass: benches, bays, hanging planting. ─ */
  { deck: 44, at: 20, kind: 'bay', name: 'The star bay', span: 6 },
  { deck: 44, at: 54, kind: 'bench', name: "Officers' bench", span: 6 },
  { deck: 44, at: 118, kind: 'planter', name: 'The hanging garden', span: 6 },
  { deck: 44, at: 126, kind: 'alcove', name: 'The Narn shrine niche', span: 6 },
  { deck: 44, at: 154, kind: 'shopfront', name: 'Tailor and cloth', span: 8 },
  { deck: 44, at: 161, kind: 'kiosk', name: 'Way-kiosk 161', span: 3 },
  { deck: 44, at: 169, kind: 'stair', name: 'The promenade step', span: 9 },
  { deck: 44, at: 204, kind: 'service', name: 'Airlock hatch 204', span: 4 },
  { deck: 44, at: 236, kind: 'bench', name: 'Drazi benches', span: 6 },
  { deck: 44, at: 288, kind: 'gantry', name: 'The Vorlon gantry', span: 4 },
  { deck: 44, at: 318, kind: 'planter', name: 'Hostel planters', span: 6 },
  { deck: 44, at: 348, kind: 'market', name: 'Night market', span: 8 },

  /* ── DECK 48, THE SERVICE WAY. Nothing here is for a visitor: hatches,
   *    conduit, a swap table, and one window nobody meant to be beautiful. ─ */
  { deck: 48, at: 20, kind: 'service', name: 'Reactor hatch 20', span: 4 },
  { deck: 48, at: 48, kind: 'kiosk', name: 'Plant control kiosk', span: 4 },
  { deck: 48, at: 77, kind: 'bench', name: 'The fab bench', span: 5 },
  { deck: 48, at: 122, kind: 'service', name: 'Cargo hatch 122', span: 4 },
  { deck: 48, at: 150, kind: 'stair', name: 'The grating step', span: 9 },
  { deck: 48, at: 159, kind: 'alcove', name: 'Smoke alcove', span: 6 },
  { deck: 48, at: 168, kind: 'gantry', name: 'Command gantry', span: 4 },
  { deck: 48, at: 190, kind: 'planter', name: 'The CIC planter', span: 5 },
  { deck: 48, at: 238.5, kind: 'service', name: 'Medbay service hatch', span: 3 },
  { deck: 48, at: 275.5, kind: 'bay', name: 'The morgue window', span: 4 },
  { deck: 48, at: 306, kind: 'shopfront', name: 'Parts window', span: 8 },
  { deck: 48, at: 338, kind: 'market', name: 'Swap stalls', span: 10 },

  /* ── THE FOUR SPINES, WHICH WERE ONE CORRIDOR BUILT FOUR TIMES ─────────
   *
   * `spine0@32 × spine180@32` measured 1.000 — the same picture. A spine is
   * 55 m of walk between the void and the ring and it is the second-most
   * walked surface in the drum, so each of the twelve now carries its own
   * arrangement of three or four things at its own radii. `r` is the radius
   * along the spine; `at` is which spine.
   */
  { deck: 40, at: 90, r: 34, band: 'spine', kind: 'niche', name: 'The east niche' },
  { deck: 40, at: 90, r: 46, band: 'spine', kind: 'portal', name: 'East bulkhead 46' },
  { deck: 40, at: 90, r: 62, band: 'spine', kind: 'ducts', name: 'East riser' },
  { deck: 40, at: 180, r: 38, band: 'spine', kind: 'ducts', name: 'Arrivals riser' },
  { deck: 40, at: 180, r: 52, band: 'spine', kind: 'portal', name: 'Customs bulkhead' },
  { deck: 40, at: 180, r: 68, band: 'spine', kind: 'niche', name: 'The waiting niche' },
  { deck: 40, at: 270, r: 36, band: 'spine', kind: 'portal', name: 'West bulkhead 36' },
  { deck: 40, at: 270, r: 48, band: 'spine', kind: 'niche', name: 'The arena niche' },
  { deck: 40, at: 270, r: 58, band: 'spine', kind: 'ducts', name: 'West riser' },
  { deck: 40, at: 270, r: 72, band: 'spine', kind: 'portal', name: 'West bulkhead 72' },
  { deck: 44, at: 0, r: 40, band: 'spine', kind: 'portal', name: 'Quarters bulkhead' },
  { deck: 44, at: 0, r: 58, band: 'spine', kind: 'niche', name: 'The cabin niche' },
  { deck: 44, at: 90, r: 34, band: 'spine', kind: 'ducts', name: 'Barracks riser' },
  { deck: 44, at: 90, r: 50, band: 'spine', kind: 'niche', name: 'The Narn niche' },
  { deck: 44, at: 90, r: 66, band: 'spine', kind: 'portal', name: 'East bulkhead 66' },
  { deck: 44, at: 180, r: 44, band: 'spine', kind: 'niche', name: 'The Minbari niche' },
  { deck: 44, at: 180, r: 60, band: 'spine', kind: 'ducts', name: 'Arrivals riser 44' },
  { deck: 44, at: 180, r: 72, band: 'spine', kind: 'portal', name: 'Platform bulkhead' },
  { deck: 44, at: 270, r: 38, band: 'spine', kind: 'portal', name: 'Kennel bulkhead' },
  { deck: 44, at: 270, r: 54, band: 'spine', kind: 'ducts', name: 'West riser 44' },
  { deck: 44, at: 270, r: 70, band: 'spine', kind: 'niche', name: 'The Vorlon niche' },
  { deck: 48, at: 0, r: 36, band: 'spine', kind: 'ducts', name: 'Reactor riser' },
  { deck: 48, at: 0, r: 50, band: 'spine', kind: 'portal', name: 'Containment bulkhead' },
  { deck: 48, at: 0, r: 64, band: 'spine', kind: 'ducts', name: 'Reactor riser 64' },
  { deck: 48, at: 90, r: 42, band: 'spine', kind: 'niche', name: 'The droid niche' },
  { deck: 48, at: 90, r: 56, band: 'spine', kind: 'ducts', name: 'Cargo riser' },
  { deck: 48, at: 90, r: 70, band: 'spine', kind: 'portal', name: 'Fab bulkhead' },
  { deck: 48, at: 180, r: 40, band: 'spine', kind: 'portal', name: 'CIC bulkhead' },
  { deck: 48, at: 180, r: 54, band: 'spine', kind: 'niche', name: 'The comms niche' },
  { deck: 48, at: 180, r: 68, band: 'spine', kind: 'ducts', name: 'Command riser' },
  { deck: 48, at: 270, r: 34, band: 'spine', kind: 'ducts', name: 'Medical riser' },
  { deck: 48, at: 270, r: 46, band: 'spine', kind: 'portal', name: 'Ward bulkhead' },
  { deck: 48, at: 270, r: 60, band: 'spine', kind: 'niche', name: 'The mourners\' niche' },
  { deck: 48, at: 270, r: 74, band: 'spine', kind: 'ducts', name: 'Morgue riser' },

  /* ── THE ATRIUM RIM, which was a rail 64 slabs long and nothing else ────
   *
   * `rim@0 × rim@180` measured 1.000. §3.1 rule 1 says the void is the
   * station's landmark and that "from anywhere near the middle you see two
   * other decks and the people on them" — which is exactly why the lip has to
   * be somewhere you STOP, and now is: an overlook bulges out over it, a
   * stairhead breaks the rail, a shrine faces the drop.
   */
  { deck: 40, at: 20, band: 'rim', kind: 'overlook', name: 'The east overlook' },
  { deck: 40, at: 34, band: 'rim', kind: 'shrine', name: 'The Forge shrine' },
  { deck: 40, at: 200, band: 'rim', kind: 'stairhead', name: 'Arboretum stairhead' },
  { deck: 40, at: 222, band: 'rim', kind: 'overlook', name: 'The chapel overlook' },
  { deck: 40, at: 300, band: 'rim', kind: 'shrine', name: 'The lamp of the lost' },
  { deck: 40, at: 320, band: 'rim', kind: 'stairhead', name: 'Forge stairhead' },
  { deck: 40, at: 340, band: 'rim', kind: 'overlook', name: 'The north overlook' },
  { deck: 44, at: 110, band: 'rim', kind: 'overlook', name: 'The Narn overlook' },
  { deck: 44, at: 130, band: 'rim', kind: 'shrine', name: 'The Centauri shrine' },
  { deck: 44, at: 150, band: 'rim', kind: 'stairhead', name: 'Centauri stairhead' },
  { deck: 44, at: 210, band: 'rim', kind: 'overlook', name: 'The Minbari overlook' },
  { deck: 44, at: 232, band: 'rim', kind: 'shrine', name: 'The Drazi standing-stone' },
  { deck: 44, at: 252, band: 'rim', kind: 'stairhead', name: 'Drazi stairhead' },
  { deck: 44, at: 290, band: 'rim', kind: 'overlook', name: 'The methane overlook' },
  { deck: 44, at: 342, band: 'rim', kind: 'shrine', name: 'The laundry lamp' },
  { deck: 48, at: 30, band: 'rim', kind: 'stairhead', name: 'Coolant stairhead' },
  { deck: 48, at: 60, band: 'rim', kind: 'overlook', name: 'The fab overlook' },
  { deck: 48, at: 110, band: 'rim', kind: 'shrine', name: 'The cargo lamp' },
  { deck: 48, at: 140, band: 'rim', kind: 'stairhead', name: 'Waste stairhead' },
  { deck: 48, at: 200, band: 'rim', kind: 'overlook', name: 'The comms overlook' },
  { deck: 48, at: 240, band: 'rim', kind: 'shrine', name: 'The memorial lamp' },
  { deck: 48, at: 290, band: 'rim', kind: 'stairhead', name: 'Armoury stairhead' },
  { deck: 48, at: 320, band: 'rim', kind: 'overlook', name: 'The brig overlook' },
];

/**
 * ══ WHERE A SPINE MEETS THE RING ══════════════════════════════════════════
 *
 * There was nothing here at all. `buildSpines` stopped its two walls at
 * `roomR` and `buildRing` ran past on the other side of the line, so the one
 * decision a person makes on a walk — *which way now* — happened at a corner
 * with no threshold, no sign and no change of anything. It measured as one of
 * the 1.000 pairs: the mouth of the +X spine and the mouth of the −X spine
 * were the same picture.
 *
 * A junction is now a PLACE, in the sense that matters: a portal you pass
 * under, a floor inlay you cross, a sign you read, and a pair of pylons that
 * are that junction's and no other's. `look` is the character — what the
 * junction is made of, so no two of the twelve are built the same — and
 * `sign` is the three directions, which is real geometry on a real board.
 */
export const JUNCTIONS = [
  { deck: 40, at: 0, name: 'Concourse mouth', look: 'brass', sign: ['THE CONCOURSE', 'ARRIVALS', 'CANTINA'], h: 6.4, splay: 0.86, bollards: 4, inlay: 'disc', outboard: false, sector: { rib: 2, channel: 'centre', coffer: 1, pilaster: 4 } },
  { deck: 40, at: 90, name: 'East gate', look: 'awning', sign: ['ATRIUM EAST', 'THE PIT', 'GALLEY'], h: 5.2, splay: 0.48, bollards: 2, inlay: 'bar', outboard: false, sector: { rib: 3, channel: 'outer', coffer: 0, pilaster: 3 } },
  { deck: 40, at: 180, name: 'Arrivals crossing', look: 'customs', sign: ['ARRIVALS HALL', 'ARBORETUM', 'CHAPEL'], h: 6.0, splay: 0.70, bollards: 3, inlay: 'chevron', outboard: true, sector: { rib: 4, channel: 'both', coffer: 2, pilaster: 6 } },
  { deck: 40, at: 270, name: 'West gate', look: 'lantern', sign: ['ATRIUM WEST', 'THE ARENA', 'HOLO-THEATRE'], h: 5.6, splay: 0.58, bollards: 2, inlay: 'disc', outboard: false, sector: { rib: 2, channel: 'inner', coffer: 0, pilaster: 5 } },
  { deck: 44, at: 0, name: 'Quarters landing', look: 'timber', sign: ['TRAM — QUARTERS', 'LAUNDRY', "OFFICERS'"], h: 5.4, splay: 0.52, bollards: 3, inlay: 'bar', outboard: true, sector: { rib: 2, channel: 'outer', coffer: 1, pilaster: 3 } },
  { deck: 44, at: 90, name: 'East platform', look: 'glass', sign: ['TRAM — CONCOURSE EAST', 'NARN QUARTER', 'HUMAN RESIDENTIAL'], h: 6.2, splay: 0.80, bollards: 4, inlay: 'disc', outboard: true, sector: { rib: 4, channel: 'centre', coffer: 2, pilaster: 6 } },
  { deck: 44, at: 180, name: 'Arrivals platform', look: 'stone', sign: ['TRAM — ARRIVALS', 'MINBARI QUARTER', 'CENTAURI QUARTER'], h: 5.0, splay: 0.44, bollards: 2, inlay: 'chevron', outboard: true, sector: { rib: 3, channel: 'inner', coffer: 0, pilaster: 4 } },
  { deck: 44, at: 270, name: 'Command platform', look: 'banner', sign: ['TRAM — COMMAND', "THE VORLON'S DOOR", 'METHANE QUARTER'], h: 5.8, splay: 0.66, bollards: 3, inlay: 'bar', outboard: true, sector: { rib: 5, channel: 'both', coffer: 1, pilaster: 5 } },
  { deck: 48, at: 0, name: 'Reactor crossing', look: 'hazard', sign: ['REACTOR HALL', 'BRIG', 'COOLANT PLANT'], h: 5.1, splay: 0.62, bollards: 4, inlay: 'chevron', outboard: false, sector: { rib: 3, channel: 'both', coffer: 2, pilaster: 5 } },
  { deck: 48, at: 90, name: 'Fab crossing', look: 'conduit', sign: ['ATRIUM EAST', 'CARGO HOLD', 'FABRICATION'], h: 6.3, splay: 0.44, bollards: 2, inlay: 'bar', outboard: false, sector: { rib: 2, channel: 'inner', coffer: 0, pilaster: 4 } },
  { deck: 48, at: 180, name: 'Command crossing', look: 'shutter', sign: ['COMMAND / CIC', 'COMMS', 'WASTE & RECYCLING'], h: 5.5, splay: 0.88, bollards: 3, inlay: 'disc', outboard: false, sector: { rib: 5, channel: 'outer', coffer: 1, pilaster: 6 } },
  { deck: 48, at: 270, name: 'Medical crossing', look: 'lamps', sign: ['ATRIUM WEST', 'BACTA WARD', 'MORGUE'], h: 6.0, splay: 0.56, bollards: 4, inlay: 'chevron', outboard: false, sector: { rib: 4, channel: 'centre', coffer: 2, pilaster: 3 } },
];

/** The fixtures on one deck's walkways, in bearing order. */
export function waysOn(deck) { return WAYS.filter((w) => w.deck === deck); }
/** The four junctions of one deck. */
export function junctionsOn(deck) { return JUNCTIONS.filter((j) => j.deck === deck); }

/**
 * ══ THE FOUR SECTORS OF A RING ════════════════════════════════════════════
 *
 * The junctions cut the ring into four arcs, and an arc is the natural unit a
 * person reads a circular building in — "the stretch between the east gate and
 * arrivals". Each junction row carries the treatment of the arc that STARTS at
 * it, and `Station.js`'s `buildRing` asks this which one a bay is in.
 *
 * That is what stopped the last of the 1.000s. A ring built by one loop has
 * the drum's own rotational symmetry, so a sample at bearing β and one at
 * β + 180° are the same picture by construction, whatever is standing in
 * front of them. Four sectors with four rhythms have no such symmetry.
 */
export function sectorAt(deck, deg) {
  const js = junctionsOn(deck);
  if (!js.length) return null;
  const a = ((deg % 360) + 360) % 360;
  let best = js[js.length - 1];
  for (const j of js) if (j.at <= a) best = j;
  /* Before the first junction's bearing is the last junction's arc, which is
   * the one that wraps through zero. */
  if (a < js[0].at) best = js[js.length - 1];
  return best.sector || null;
}
