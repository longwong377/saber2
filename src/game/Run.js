/**
 * SABER — the run, and the thing it climbs.
 *
 * WHAT WAS MISSING, stated plainly: this game had no shape. `WaveDirector`
 * escalates a spawn budget forever — `update()` ends by calling
 * `start(this.wave + 1)` and there is no win condition, no final wave and no
 * ending. `gauntlet` has been in the mode list since the menu was written, with
 * a blurb promising "a fixed ladder of set-pieces, ending in a boss", and had
 * ZERO implementation: it fell straight through to the generic path, so it was
 * byte-identical to the thing it claimed to be an alternative to.
 *
 * And nothing survived a level change. `World.loadLevel` opens with `unload()`,
 * which disposes every player — so `boonMods`, `maxHp`, the taken-boon set and
 * the score all died with it. That single fact is why every level in this game
 * is a separate arena rather than a place in a longer journey: there was no
 * object that outlived a level, so there was nowhere to put a run.
 *
 * This is that object.
 *
 * ── THE DESCENT ────────────────────────────────────────────────────────
 *
 * WHAT THIS REPLACES, and why. The ladder used to be THE SPIRE: four outdoor
 * arenas at four altitudes, with the weather telling the story — fog thinning,
 * sun strengthening, the cloud deck sinking past your eyes until the storm you
 * climbed through was the floor. It was a good idea and it did not read. The
 * player's verdict on it was flat: "it reads as a canyon and does not work."
 * The failure is structural rather than a matter of tuning. Nothing about
 * standing in a meadow tells you it is a thousand metres above the gorge you
 * started in; altitude is a fact about a place that a place cannot show you
 * from the inside, and four unrelated landscapes in a row is a tour, not a
 * climb.
 *
 * So: the same machinery, pointed DOWN.
 *
 * The engine still cannot build a literal tower or a literal stair. Terrain is
 * one heightfield `h(x, z)` — no floors, no overhangs — and the gait solver,
 * the spawn picker, the cloak colliders and the enemy nav all assume it. The
 * descent does not need one. Going down has two things going up never had:
 *
 *   IT IS ONE BUILDING. The intake, the foundry and the cut share a palette,
 *   a shell and a bay grid (see Levels.js), so arriving somewhere new that is
 *   made of the same cold grey concrete as the last place is itself the
 *   evidence that you went down a level rather than travelled.
 *
 *   AND THE LIGHT GOES. That is the part altitude could never do. Depth has a
 *   monotone, unambiguous, entirely visible consequence: less and less of
 *   somebody else's light, until on the last rung there is none of it at all
 *   and the only thing lighting the room is the blade in your hand. A player
 *   who has to fight by their own weapon knows exactly how far down they are.
 *
 *    the intake    daylight, straight down a hole in the roof
 *    the foundry   no daylight. A canal of melt, lighting the room from the
 *                  floor, which is a light source you can be pushed into
 *    the cut       whatever was left switched on. Four lamps, and rock
 *    the deeps     the same room with the power off — lit only by lightsabers
 *
 * The last two rungs are THE SAME LEVEL, entered twice. That is not a saving,
 * it is the point: a room you have already fought in and can no longer see is
 * a stronger statement about depth than a fifth room would be, and it is
 * exactly the mechanism the ladder was built on — "a rung borrows a level and
 * changes only its air" (World.loadLevel).
 */

import { maxRank } from './Waves.js';

/**
 * One rung. `level` is a key into LEVELS; `air` is merged over that level's own
 * atmosphere, so a rung borrows a place and changes only how it is lit.
 *
 * `waves` is how many waves this rung asks for before the way down opens. It is
 * deliberately short at the top — the first rung is where a run is learned, not
 * where it is decided.
 *
 * `altitude` is metres relative to the surface and is therefore NEGATIVE all
 * the way down. main.js hands it straight to the landing card, which prints it
 * with a unit; "−480 m" is the whole story that card has to tell.
 */
export const DESCENT = [
  {
    id: 'intake', name: 'The Intake', waves: 3,
    level: 'intake', altitude: 0,
    brief: 'The roof is open to the sky. It is the last sky there is.',
    air: { fogDensity: 0.0042, sunIntensity: 5.6, ambient: 0.78,
      fillIntensity: 0.62, exposure: 1.16 },
    weather: { peak: 0.30, period: 120, duration: 26 },
  },
  {
    id: 'foundry', name: 'The Foundry', waves: 4,
    level: 'foundry', altitude: -210,
    brief: 'No daylight. What is lighting the room is running in the canal.',
    air: { fogDensity: 0.0072, sunIntensity: 2.4, ambient: 0.20,
      fillIntensity: 1.05, exposure: 1.10 },
    weather: { peak: 0.42, period: 104, duration: 30 },
  },
  {
    id: 'cut', name: 'The Cut', waves: 4,
    level: 'deeps', altitude: -480,
    brief: 'Four working lights left in a mile of excavation. Nobody left them for you.',
    air: { fogDensity: 0.0108, sunIntensity: 0.90, ambient: 0.10,
      fillIntensity: 0.34, exposure: 1.42 },
    weather: { peak: 0.34, period: 116, duration: 28 },
  },
  {
    /**
     * `boss: true` IS READ NOW. It sat on this rung with no reader anywhere in
     * src/ — every other `.boss` in the tree is an archetype flag — while the
     * set-piece ladder it exists to describe gated the acklay at wave 20 and
     * the walker at 10 against a descent sixteen waves long. So the bottom of
     * the only mode with an ending fielded the same two acolytes wave 5 opens
     * with, on a level whose pool names `beast` and `walker` outright.
     * `WaveDirector._setPiece` reads it: the rung that calls itself the bottom
     * fields the whole ladder its level can bring.
     */
    id: 'deeps', name: 'The Deeps', waves: 5, boss: true,
    level: 'deeps', altitude: -760,
    brief: 'The same cut with the power off. Whatever is down here can see better than you.',
    /**
     * THE BOTTOM OF THE LADDER, AS NUMBERS. 0.12 of key against the intake's
     * 5.6 — a factor of 47 — and 0.03 of ambient against 0.34. What is left is
     * the four lamps the level dresses itself with, the standing water
     * reflecting them, and the blade.
     *
     * `exposure` goes UP rather than the key being quietly raised, and the
     * difference matters: opening the curve keeps what light there IS readable
     * while leaving everything the light does not reach genuinely black. A
     * brighter key would have filled the room back in and undone the rung.
     */
    air: { fogDensity: 0.0146, sunIntensity: 0.12, ambient: 0.03,
      fillIntensity: 0.10, exposure: 1.74, bloom: 0.54 },
    weather: { peak: 0.26, period: 140, duration: 24 },
  },
];

/**
 * The name the rest of the codebase still imports. `World.loadLevel` and
 * `main.js` both `import { SPIRE }`, and neither is a file this change may
 * edit — so the ladder keeps its old export as an alias rather than the two
 * call sites keeping a name that no longer describes anything. Delete this the
 * moment those imports can be renamed.
 */
export const SPIRE = DESCENT;

/**
 * What a run's `mode` is CALLED — the reader that field never had.
 *
 * `main.js` constructs every run with `mode: 'spire'`, the ladder's old name,
 * and nothing in the tree compared the field against anything or showed it to
 * anybody. A record that keeps a depth of 16 and cannot say what it was 16 of
 * is a record of a number, so `Progress.progressLines` names the ladder a run
 * was on — and both spellings of this one resolve to the same place, exactly as
 * SPIRE and DESCENT do above.
 */
const LADDER_NAMES = { spire: 'the Descent', descent: 'the Descent' };
export function ladderName(mode) { return LADDER_NAMES[mode] || mode || null; }

/**
 * How much of your health a landing gives back.
 *
 * NOT a full heal, and not nothing. A full heal makes the tier you just
 * survived irrelevant to the one above it, and nothing at all means one bad
 * rung ends a run four tiers later for reasons the player cannot see. A
 * fraction keeps the cost of a rung visible without making it fatal.
 */
export const LANDING_HEAL = 0.45;

export class Run {
  constructor(opts = {}) {
    /**
     * The seed EVERYTHING random in this run derives from, so a run is a
     * shareable number rather than an unrepeatable accident.
     *
     * That sentence was false for the whole life of this field: it was
     * generated here, carried across every landing, handed to `summary()` and
     * read by nothing, while `Waves.js` built its stream from a `Math.random()`
     * drawn once at module load. Two runs on the same seed composed different
     * waves. `WaveDirector` reads it now (`Waves.seedWaves`), mixing the rung
     * index in so four rungs are four streams and the descent is still one
     * number. The enemy and duel streams still are not seeded — see the note
     * on `seedWaves`.
     */
    this.seed = opts.seed ?? ((Math.random() * 0x7fffffff) | 0);
    this.mode = opts.mode ?? 'spire';
    this.tier = 0;
    this.wave = 0;
    this.score = 0;
    this.kills = 0;
    /** The BOON OBJECTS taken, in order. Kept rather than the derived
     *  `boonMods`, because re-applying them to a freshly built player is
     *  exactly what carrying a run across a level change means — and a derived
     *  snapshot would drift the first time a boon's effect changed. */
    this.boons = [];
    /** Carried as a FRACTION: max hp itself is a thing boons move, so a raw
     *  number would silently undo Vitality across a landing. */
    this.hpFrac = 1;
    this.identity = opts.identity || null;
    this.startedAt = opts.now ?? 0;
    this.done = false;
    this.won = false;
    /**
     * THE CONSTELLATION'S LEDGER, carried for exactly the same reason the boons
     * are: `World.loadLevel` opens with `unload()`, so anything living on the
     * World dies at a landing. Insight earned on the flanks and not yet spent
     * would otherwise be confiscated by the climb — which is the same class of
     * bug as boons dying with the player, one currency later.
     *
     * A SNAPSHOT, not the Communion object itself: the ledger is plain numbers
     * and a list of ids, so it survives being handed to a freshly built world
     * without the run holding a reference to a world that has been disposed.
     * See Constellation.Communion.snapshot.
     */
    this.communion = { insight: 0, bought: [], earned: 0 };
  }

  get rung() { return DESCENT[Math.min(this.tier, DESCENT.length - 1)]; }
  get last() { return this.tier >= DESCENT.length - 1; }

  /**
   * WAVES THE RUN CLIMBED BEFORE THIS RUNG — the depth this rung starts from.
   *
   * `wave` is rung-local (World writes it from `onWaveClear`, and asks
   * `run.wave >= rung.waves` with it), so this is the other half of every
   * absolute number the run has. `WaveDirector.floor` reads it, which is what
   * stops the escalation restarting at wave 1 on every landing: the third rung
   * composes waves 8..11, not 1..4.
   */
  get floor() {
    let n = 0;
    for (let i = 0; i < this.tier && i < DESCENT.length; i++) n += DESCENT[i].waves;
    return n;
  }

  /** Waves cleared across the whole descent, which is what "depth" means. */
  get depth() { return this.wave + this.floor; }

  /**
   * Record one rank of a boon.
   *
   * A LIST WITH REPEATS, not a set: `World.spawnPlayer` replays this array into
   * a freshly built body, and `Player.applyBoon` counts its own ranks as it
   * goes, so two entries of `vitality` land as rank 1 then rank 2 and arrive at
   * exactly the hp the player had before the level changed. Deduplicating here
   * would quietly refund every rank above the first on every ascent.
   */
  take(boon) {
    if (!boon) return;
    const held = this.boons.reduce((n, b) => n + (b.id === boon.id ? 1 : 0), 0);
    if (held < maxRank(boon)) this.boons.push(boon);
  }

  /** Ranks of `id` this run holds. */
  rank(id) { return this.boons.reduce((n, b) => n + (b.id === id ? 1 : 0), 0); }

  /** Survived a rung. Returns false when that was the last one — `ascend` is
   *  the name main.js and Menu.js call, and it now means "went down one". */
  ascend() {
    this.hpFrac = Math.min(1, this.hpFrac + LANDING_HEAL);
    /**
     * THE LAST RUNG KEEPS ITS WAVES. `wave` is zeroed because the next rung
     * starts at its first wave — but there is no next rung here, and zeroing
     * it threw the bottom's own five waves out of `depth`. A sixteen-wave run
     * recorded itself as eleven, on the one screen that exists to say how far
     * you got.
     */
    if (this.last) { this.done = true; this.won = true; return false; }
    this.wave = 0;
    this.tier++;
    return true;
  }

  end() { this.done = true; }

  /**
   * What a record wants to remember. Small on purpose — see Progress.js.
   *
   * `mode` is here because it was the other half of a dead field: it was
   * written by `main.js` at construction, compared against nothing anywhere in
   * src/, and dropped on the floor by the one function that turns a run into
   * something that outlives it. A record that cannot say which ladder a depth
   * of 16 was climbed on is a record of a number.
   */
  summary() {
    return {
      seed: this.seed, mode: this.mode,
      tier: this.tier, depth: this.depth, score: this.score,
      kills: this.kills, won: this.won,
      boons: this.boons.map((b) => b.id),
      identity: this.identity,
      // The stars this run LIT, and how much of the sky it walked. A note about
      // what was done, never a currency — Progress.js keeps it as history and
      // nothing reads it back into a run. See the doctrine there.
      lit: this.communion.bought.slice(),
      insight: this.communion.earned,
    };
  }
}
