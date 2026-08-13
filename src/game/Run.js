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
 * ── THE SPIRE ──────────────────────────────────────────────────────────
 *
 * The engine cannot build a literal tower. Terrain is a single heightfield
 * `h(x, z)` — no floors, no overhangs — and the gait solver, the spawn picker,
 * the cloak colliders and the enemy nav all assume it. So the ascent is not
 * geometry. It is ALTITUDE, told by the air.
 *
 * Every tier is its own arena at its own height, and the weather carries the
 * story, because the weather system already couples fog, sun colour, wind and
 * fill to one number:
 *
 *    the foundations   fog so thick there is no sky at all, and no horizon
 *    the flanks        inside the storm — wind screaming, visibility 40 m
 *    the shoulders     breaking through: the cloud deck level with your eyes
 *    the crown         above it. Thin clear light, and the storm is a FLOOR
 *
 * That progression is authored, not built, and it does something no wall could:
 * the bound of the world stops being an invisible edge and becomes cloud. A
 * player who can see the weather they climbed out of, below them, knows how far
 * they have come without being told.
 */

import { maxRank } from './Waves.js';

/**
 * One rung. `level` is a key into LEVELS; `air` is merged over that level's own
 * atmosphere, so a tier borrows a place and changes only its height.
 *
 * `waves` is how many waves this tier asks for before the way up opens. It is
 * deliberately short at the bottom — the first rung is where a run is learned,
 * not where it is decided.
 */
export const SPIRE = [
  {
    id: 'foundations', name: 'The Foundations', waves: 3,
    level: 'canyon', altitude: 0,
    brief: 'Below the weather. Nothing above you but rock.',
    air: { fogDensity: 0.0125, fogHeight: 60, sunIntensity: 2.6, ambient: 0.52,
      cloudCover: 0.95, exposure: 0.80, horizon: false },
    weather: { peak: 0.55, period: 96, duration: 34 },
  },
  {
    id: 'flanks', name: 'The Flanks', waves: 4,
    level: 'alpine', altitude: 340,
    brief: 'Inside the storm. It gets a vote on where your blade goes.',
    air: { fogDensity: 0.0092, fogHeight: 44, sunIntensity: 4.2, ambient: 0.44,
      cloudCover: 0.88, exposure: 0.86 },
    weather: { peak: 1.0, period: 74, duration: 38 },
  },
  {
    id: 'shoulders', name: 'The Shoulders', waves: 4,
    level: 'drifts', altitude: 720,
    brief: 'The cloud deck is level with your eyes.',
    air: { fogDensity: 0.0058, fogHeight: 30, sunIntensity: 6.4, ambient: 0.34,
      cloudCover: 0.72, exposure: 0.92 },
    weather: { peak: 0.72, period: 88, duration: 30 },
  },
  {
    id: 'crown', name: 'The Crown', waves: 5, boss: true,
    level: 'meadow', altitude: 1180,
    brief: 'Above it. The storm you climbed through is the floor.',
    air: { fogDensity: 0.0026, fogHeight: 22, sunIntensity: 8.2, ambient: 0.24,
      cloudCover: 0.34, exposure: 1.0 },
    weather: { peak: 0.42, period: 130, duration: 26 },
  },
];

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
    /** The seed EVERYTHING random in this run derives from, so a run is a
     *  shareable number rather than an unrepeatable accident. */
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

  get rung() { return SPIRE[Math.min(this.tier, SPIRE.length - 1)]; }
  get last() { return this.tier >= SPIRE.length - 1; }

  /** Waves completed across the whole climb, which is what "depth" means. */
  get depth() {
    let n = this.wave;
    for (let i = 0; i < this.tier && i < SPIRE.length; i++) n += SPIRE[i].waves;
    return n;
  }

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

  /** Survived a rung. Returns false when that was the last one. */
  ascend() {
    this.hpFrac = Math.min(1, this.hpFrac + LANDING_HEAL);
    /**
     * THE CROWN KEEPS ITS WAVES. `wave` is zeroed because the next rung starts
     * at its first wave — but there is no next rung here, and zeroing it threw
     * the crown's own five waves out of `depth`. A sixteen-wave climb recorded
     * itself as eleven, on the one screen that exists to say how far you got.
     */
    if (this.last) { this.done = true; this.won = true; return false; }
    this.wave = 0;
    this.tier++;
    return true;
  }

  end() { this.done = true; }

  /** What a record wants to remember. Small on purpose — see Progress.js. */
  summary() {
    return {
      seed: this.seed, tier: this.tier, depth: this.depth, score: this.score,
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
