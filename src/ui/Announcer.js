/**
 * BATTLEFRONT BORZ — what the fight says about itself.
 *
 * Two complaints, one system. The game was silent about the player's own body
 * — you could swing a metre of plasma through four people, fall six metres onto
 * duracrete and die without making a sound — and it was silent about what had
 * just HAPPENED, so a four-kill exchange and a one-kill exchange felt identical.
 *
 * ── why it observes rather than being told ──────────────────────────────
 *
 * There is no call site anywhere in src/game that says "the player grunted".
 * Adding twenty of them would put the announcer's business inside the combat
 * code, and every future trigger would be another edit in a file that has
 * nothing to do with sound. So this reads the same numbers the HUD already
 * draws — kills, deflects, perfects, health, ground contact, tip speed, the
 * enemy list — and DIFFERENCES them. `HUD.update` already runs once a frame
 * with the world, the player and the camera in hand; that is the whole hook.
 *
 * The cost of that choice is that everything here has to survive a partial
 * world (the HUD is driven by checks with a five-field stub), so every read is
 * defensive and every trigger is a change in a number rather than a state a
 * caller had to remember to set.
 *
 * ── rate limits are the feature ─────────────────────────────────────────
 *
 * A voice line on every kill is unbearable within ninety seconds. The limits
 * below are not a safety net around the feature, they ARE the feature: one quip
 * per `QUIP_GAP` seconds whatever happens, a separate and much shorter budget
 * for the wordless efforts, one enemy line per `ENEMY_GAP`, and under all of it
 * AudioEngine.speak's own hard cap of three concurrent utterances with the
 * newest ducking the rest.
 */

import { audio as defaultAudio } from '../engine/Audio.js';
import { ENEMY_VOICES, voiceAt, EACH_LINES, ENEMY_LINES, hasLine } from '../engine/Voice.js';
import { bodyOf } from '../engine/Presence.js';
import { clamp } from '../engine/MathUtil.js';

/**
 * Is this a contour that exists?
 *
 * `utterance()` falls back to LINES.effort for anything it does not recognise,
 * which is right for the game — a trigger must never be able to throw mid-fight
 * — and wrong for a caller handing over a name from a table. A wheel slot
 * pointing at a contour that has been renamed would silently play the grunt for
 * every emote, and every one of them would sound identical, which is precisely
 * the failure src/engine/Voice.js is shaped around.
 *
 * IT ASKS Voice.js RATHER THAN `LINE_KINDS`, AND THE DIFFERENCE IS THE FORCE
 * POOLS. `LINE_KINDS` is the announcer's and the emote wheel's shared
 * vocabulary — src/ui/HUD.js builds one wheel slot per member of it — and the
 * thirty-seven lines a Force power can say are deliberately NOT in it, because
 * thirty-seven wheel slots is not an emote wheel. `hasLine` answers for both
 * tables, which is what lets `say()` carry `push.2` for `Player._forceVoice`
 * — on the same forced quip budget as an emote, for the same reason: a rate
 * limit written to stop the game talking over itself may not swallow a key the
 * player pressed — without the wheel growing a slot for every one of them. See
 * `contourFor` in src/engine/Voice.js for why they are a second table.
 */
const LINES_HAS = (kind) => hasLine(kind);

/**
 * The two questions a room line is asked, both answered off src/engine/Voice.js
 * and neither of them written down twice.
 *
 * `EACH` — is every speaker its own event? That decides which budget the line
 * spends (see `_spend`), and it is the `each` flag on the contour.
 * `ROOM`  — is this something a body on the field says rather than something the
 * player says? That is `ENEMY_LINES`, which the emote wheel already derives its
 * own half from.
 *
 * Sets rather than `Array.includes` because the alarm call asks the first
 * question of every body on the field on every frame.
 */
const EACH = new Set(EACH_LINES);
const ROOM = new Set(ENEMY_LINES);

/** Seconds between quips (kill, streak, boss, low health) whatever happens. */
export const QUIP_GAP = 4.5;
/** Seconds between the wordless efforts — swings, landings, hits taken. */
export const EFFORT_GAP = 0.85;
/** Seconds between anything the ENEMIES say, across all of them. */
export const ENEMY_GAP = 0.45;
/**
 * …AND A SEPARATE, SHORTER BUDGET FOR THE BATTLE.
 *
 * Player note #21's last sentence is "I want to hear their screams and cheers,
 * in general make the game MORE AUDIBLE as far as voices", and the shared 0.45 s
 * enemy budget is what would silently refuse most of it: a Force push that
 * throws six bodies at once is six `flung` calls on one frame, and five of them
 * would be swallowed and thrown away by the same budget that is meant to stop
 * the room chattering.
 *
 * So a throw and a cheer are on their OWN budget, and it is short. That is not
 * a hole in the rate limit, it is the recognition that the limit was written
 * for lines the room says about ITSELF — an alarm, a panic call, idle banter —
 * where one is representative and six are noise. A body being flung is a thing
 * the PLAYER just did, one per body, and hearing only one of six is hearing the
 * power wrong. WHICH LINES THOSE ARE is `each`, declared on the contour in
 * src/engine/Voice.js and read in exactly one place here (`_spend`); it used to
 * be this paragraph, and being a paragraph is why every death cry in the game
 * was on the wrong side of it.
 *
 * THE SENTENCE THAT USED TO END THIS NOTE WAS FALSE, and it is worth leaving
 * the correction in. It said "0.14 s lets a six-body push produce four or five
 * voices stacked over each other, which is what a six-body push sounds like".
 * It does not and it never did: `forcePush` knocks every body in the cone back
 * on ONE frame, so all six calls are raised inside 16 ms and 0.14 s is eight
 * frames. Driven, six thrown bodies produced ONE voice and five refusals. **No
 * value of this constant can fix that** — a gap between lines cannot let
 * simultaneous lines through, whatever it is set to, and the smaller it gets
 * the closer it comes to having no rate limit at all on the frames when nothing
 * is happening.
 *
 * What fixes it is holding the refused lines instead of dropping them, which is
 * LINE_LIFE. The gap then means what it always should have: not "one line per
 * 0.14 s" but "the room lets one out every 0.14 s until the backlog is clear",
 * so a push is a ripple of six voices over three quarters of a second.
 *
 * `AudioEngine.speak`'s own hard cap of three concurrent utterances is still
 * under all of it, so this cannot become a wall of sound. Measured over a real
 * Geonosis minute with 24 bodies on the field: three lines alive at once at the
 * worst moment, and 30% of the minute with any voice in it at all.
 */
export const BATTLE_GAP = 0.14;
/** Speed a body has to gain in one frame to have been THROWN rather than to be running. */
const FLUNG_SPEED = 8.5;
/** …and how often a droid is allowed to say nothing in particular. */
export const CHATTER_GAP = 6.5;
/**
 * HOW LONG A LINE IS STILL ABOUT THE MOMENT IT WAS ABOUT.
 *
 * A rate limit can only ever say "not now", and until now that is all this file
 * could do: a line the budget refused was counted and thrown on the floor. Two
 * measured consequences, and they pull in opposite directions, which is why one
 * number could not fix both.
 *
 *  · SIMULTANEOUS EVENTS WERE SILENCED BY A TIME GAP THEY CANNOT SATISFY.
 *    BATTLE_GAP's own note claims "0.14 s lets a six-body push produce four or
 *    five voices stacked over each other". It does not, and it never did: a
 *    push knocks six bodies back on ONE frame, so all six calls are raised
 *    inside the same 16 ms and 0.14 s is eight frames. Driven: six bodies dying
 *    on one frame produced ONE line and five refusals. A Force rend, a thrown
 *    blade down a corridor and one detonation all do exactly that.
 *  · THE ALARM RETRIED FOREVER. `st.spotted` is latched only when the call has
 *    actually been made — right, and the note beside it records that latching
 *    on the ATTEMPT gave a squad of five one alarm between them — so a body the
 *    budget refused re-offered the same line on every frame until it won.
 *    Measured on a Geonosis command wave, seed 4242, 60 s: **679 refused alarm
 *    attempts against 18 spoken**, with the last of them arriving twenty
 *    seconds after the body saw you.
 *
 * So a refused room line is HELD instead of dropped, and it expires. That one
 * change answers both: the wipe becomes a ripple of screams over three quarters
 * of a second, which is what six bodies falling together sounds like, and the
 * spin becomes one queue entry per body offered at most once a frame.
 *
 * 1.5 s is three swings of the shared budget — long enough for a squad that
 * spotted you together to get two or three voices out, short enough that
 * nobody ever announces something the player watched happen.
 */
export const LINE_LIFE = 1.5;
/** How many held lines is a battlefield and not a backlog. Oldest goes first. */
const PENDING_CAP = 24;
/**
 * HOW LONG AFTER A BODY FALLS ITS SIDE'S ENEMY CHEERS.
 *
 * Zero, until deaths moved onto the per-event budget — at which point the cheer
 * and the death cry it answers were two calls on ONE frame competing for one
 * 0.14 s gap, and the cheer (which is raised first) won every time. That is a
 * regression dressed as a fix, so the cheer waits.
 *
 * It is also simply what a crowd does. A cheer is a REACTION: the body falls,
 * and then the line around it shouts. 0.42 s is long enough to read as an
 * answer rather than a chorus, and short enough to still be about that death.
 */
export const CHEER_DELAY = 0.42;
/**
 * …and how often an officer shouts at the line it is holding together.
 *
 * `ENEMY_VOICES.officer`'s own note says what this is for: "the rally aura is
 * already drawn as a ring on the ground, and a ring with nothing audible in it
 * is half a tell". The ring has been drawn for a session and nothing on the
 * field ever spoke through it — `LINES.order` had exactly one emitter, the HUD,
 * and it fired on a formation key rather than on anything the enemy's officer
 * did. Rarer than the droids' banter by design: a commander who talks as often
 * as a B1 is not a commander.
 */
export const RALLY_GAP = 11;
/** A kill inside this many seconds of the last one extends the streak. */
export const STREAK_WINDOW = 3.6;
/** Tip speed (m/s) that counts as a swing worth grunting over. */
const EFFORT_SPEED = 21;
/** Falling faster than this at the moment of contact hurts to land. */
const HARD_LANDING = 11;

/**
 * The killstreak ladder.
 *
 * In-world words rather than arcade ones: this is a game about a person with a
 * sword, and "DOUBLE KILL" belongs to a different one. Each rung also carries
 * the line the voice says, so the popup and the quip cannot drift apart.
 */
export const STREAKS = [
  { at: 2, title: 'DOUBLE STRIKE', sub: 'two in one breath' },
  { at: 3, title: 'TRIPLE STRIKE', sub: '../../vendor/three/three.module.js' },
  { at: 4, title: 'ONSLAUGHT', sub: 'four without pause' },
  { at: 5, title: 'RELENTLESS', sub: 'five' },
  { at: 7, title: 'UNSTOPPABLE', sub: 'seven' },
  { at: 10, title: 'THE FORCE IS WITH YOU', sub: 'ten' },
];

/** The deflection ladder — the other half of the fight, and the harder half. */
export const RETURNS = [
  { at: 3, title: 'RETURN ×3', sub: 'three bolts sent back' },
  { at: 6, title: 'RETURN ×6', sub: 'six' },
  { at: 10, title: 'UNTOUCHED', sub: 'ten unbroken' },
  { at: 16, title: 'A WALL OF LIGHT', sub: 'sixteen' },
];

/**
 * The chamber ladder — meeting a declared arc INSIDE its window, which is the
 * hardest thing the duel offers and the only counter that was going by without
 * a word. Shorter rungs than the others: a chamber is rarer than a deflection
 * by an order of magnitude, so three of them in one exchange is already the
 * thing worth saying out loud.
 */
export const CHAMBERS = [
  { at: 2, title: 'CHAMBERED ×2', sub: 'two arcs met on the way in' },
  { at: 3, title: 'READING THE BLADE', sub: '../../vendor/three/three.module.js' },
  { at: 5, title: 'NOTHING GETS THROUGH', sub: 'five, unbroken' },
];

/**
 * THE HIGHEST RUNG THIS COUNT HAS JUST CROSSED — not the rung it landed on.
 *
 * This used to be `hit.at === n ? hit : null`, an exact match, and the effect
 * of that one comparison is the opposite of what the ladders are for. A count
 * does NOT climb one at a time: `player.kills` is differenced once a frame, and
 * a Force rend, a thrown blade down a corridor or one explosion take three,
 * four, six bodies inside a single frame. Measured against the shipped ladder,
 * the run of streaks a player could actually be told about was
 *
 *     0→2 DOUBLE STRIKE   0→3 TRIPLE STRIKE   0→4 ONSLAUGHT   0→5 RELENTLESS
 *     0→6 nothing at all  0→8 nothing at all  0→9 nothing at all
 *
 * — so a two-kill exchange announced itself and a SIX-kill exchange, the most
 * spectacular thing the game can produce, went by with the ordinary one-kill
 * grunt and no popup. The same hole sat under RETURNS (two bolts can land on
 * one frame) and under CHAMBERS.
 *
 * `from` is the count before the jump, so a rung is announced when it is passed
 * and never twice: 3→6 says RELENTLESS (5, the highest rung crossed), and the
 * next kill at 7 says UNSTOPPABLE rather than repeating it. A ladder that
 * cannot be jumped is a ladder that only rewards killing things slowly.
 */
const rung = (ladder, n, from = n - 1) => {
  let hit = null;
  for (const r of ladder) if (n >= r.at && from < r.at) hit = r;
  return hit;
};

export class Announcer {
  constructor(audio = defaultAudio) {
    this.audio = audio;
    this.reset();
  }

  reset() {
    this.prev = { kills: 0, deflects: 0, perfects: 0, chambers: 0, hp: 1, alive: true, grounded: true, velY: 0, tip: 0 };
    this.started = false;
    this.quipT = 0;
    this.effortT = 0;
    this.enemyT = 0;
    this.battleT = 0;
    this.chatterT = CHATTER_GAP;
    this.streak = 0;
    this.streakT = 0;
    this.returns = 0;
    this.returnT = 0;
    this.chamberRun = 0;
    this.chamberT = 0;
    this.lowSaid = false;
    this.deaths = [];
    this.panicFor = 0;
    /**
     * ROOM LINES WAITING FOR AIR — `{spec, kind, who, pos, on, at, dies}`.
     *
     * One queue and not three. A cheer waiting out CHEER_DELAY, a death cry
     * that lost a 0.14 s gap to the five bodies that fell with it, and an alarm
     * that lost the shared budget are the same object with different clocks on
     * it, and holding them in one list is what stops the alarm's retry being a
     * per-frame sweep of every body on the field. See LINE_LIFE.
     */
    this.pending = [];
    this.rallyT = RALLY_GAP;
    /** Seconds of fight this announcer has watched. Its own, because the HUD
     *  drives it with a stub world in five different checks and `world.time`
     *  is not something a stub is required to carry. */
    this.clock = 0;
    this.enemies = new WeakMap();
    this.bosses = new WeakSet();
    this._level = null;
    /**
     * WHAT WAS SAID, AND WHAT WAS REFUSED — broken down by the budget that
     * refused it.
     *
     * `suppressed` was one number covering four different reasons, and a single
     * number cannot answer the only question worth asking about a rate limit:
     * *which* limit is the one biting. Measured on a real Colosseum wave with a
     * real director, the four are not remotely comparable — the room's shared
     * 0.45 s budget threw away four fifths of what the battlefield tried to say
     * while the quip and effort budgets refused almost nothing — and with one
     * counter that finding is invisible.
     *
     * `refused` is keyed by BUDGET (which gate said no) and `lines` by CONTOUR
     * (what was actually heard). Neither is a second copy of a rule: both are
     * written at the one place the corresponding decision is made, and
     * `tools/_voiceprobe.mjs` reads them rather than re-deriving anything.
     *
     * `suppressed` is kept and is still the sum, because it is the number the
     * existing readers use.
     */
    this.stats = {
      quips: 0, efforts: 0, enemyLines: 0, popups: 0, suppressed: 0,
      refused: { quip: 0, effort: 0, enemy: 0, battle: 0, off: 0, popup: 0, engine: 0, stale: 0 },
      held: 0,
      lost: Object.create(null),
      lines: Object.create(null),
    };
  }

  /**
   * One refusal, against the gate that made it — AND, separately, one contour
   * the player is never going to hear.
   *
   * THE TWO ARE NOT THE SAME NUMBER and conflating them is what made the
   * original single `suppressed` counter useless. A room line the budget turns
   * away is HELD (see `_room`) and usually said a moment later, so it is a
   * refusal and not a loss; a line that expires on the queue, or that the
   * player has switched off, is a loss and there is no gate to blame it on.
   *
   * `refused` answers "which limit is biting" and `lost` answers "what did the
   * player not hear", and on a real Geonosis wave the two disagree completely:
   * the budget refuses hundreds of alarm retries and loses almost none of them,
   * and it used to lose every death cry on the field while refusing each of
   * them exactly once. `tools/_voiceprobe.mjs` prints both.
   */
  _refuse(why, kind = null, gone = false) {
    this.stats.suppressed++;
    this.stats.refused[why] = (this.stats.refused[why] || 0) + 1;
    if (gone && kind) this._lost(kind);
    return false;
  }

  /** One contour raised and never heard. */
  _lost(kind) { this.stats.lost[kind] = (this.stats.lost[kind] || 0) + 1; }

  /** One line that actually reached the engine. */
  _spoke(kind) {
    this.stats.lines[kind] = (this.stats.lines[kind] || 0) + 1;
  }

  /** The voice the player has chosen, live off the settings blob. */
  voice(settings) { return voiceAt(settings?.voiceIndex ?? 0); }

  /**
   * SAY SOMETHING BECAUSE THE PLAYER ASKED, not because the game noticed.
   *
   * The whole of this file below here is OBSERVATION: it differences numbers
   * and speaks when one of them moves, and every budget in it exists to stop
   * the game talking over itself. None of that reasoning applies to a line the
   * player deliberately chose off the emote wheel, so this is the one entry
   * point that goes in with `force` — the quip gap may not swallow a key press.
   *
   * It still goes THROUGH `_say` rather than round it, which is the part that
   * matters: the utterance is built from the player's chosen larynx, it is
   * counted in `stats.quips`, it respects `voiceLines` (a player who has turned
   * their own voice off stays silent and gets the gesture instead), and — the
   * reason it is not simply `audio.speak` — it SETS the quip budget on the way
   * out, so the automatic line that would have followed waits for it instead of
   * landing on top of it.
   *
   * @returns true if it actually spoke.
   */
  say(settings, kind, pos = null) {
    if (!kind || !LINES_HAS(kind)) return false;
    if (ROOM.has(kind)) return this._relay(settings, kind);
    return this._say(this.voice(settings), kind, pos, 1.0, settings?.voiceLines !== false, true);
  }

  /**
   * A ROOM LINE ASKED FOR THROUGH `say` IS SAID BY THE ROOM, not by the player.
   *
   * `ENEMY_LINES` is the list of contours the emote wheel refuses to offer,
   * which makes it exactly the list of contours that reaching `say` cannot be
   * an emote: the player pressed something and the answer is supposed to come
   * from the field. There is one such caller and it is the whole of Command's
   * feedback loop — `HUD.setOrder` plays `LINES.order` when you change
   * formation — and it was coming out of the JEDI'S OWN THROAT, non-positional,
   * on the quip budget, in a voice the player chose on the options screen.
   *
   * That is the wrong body twice over. src/engine/Voice.js authored `order` as
   * a shout from a body with a rank; and the player's note asks to hear the
   * BATTLEFIELD, of which their own line is half. A trooper twelve metres to
   * your left relaying the order is the answer to both, and it costs nothing
   * new: `_enemySpec` already knows what that body sounds like and the
   * position makes it a sound you can turn toward.
   *
   * NEAREST ON YOUR OWN SIDE, and nobody at all if you have no side — which is
   * every mode except Command, where there is also no formation key, so this
   * silently does nothing rather than inventing a squadmate. It is FORCED past
   * the room's budget for `say`'s own stated reason: a rate limit written to
   * stop the room chattering may not swallow a key press.
   */
  _relay(settings, kind) {
    const list = this._level?.enemies;
    const me = this._level?.player;
    const ear = me?.chest || me?.position || null;
    if (!list || !ear) return false;
    const mine = me?.team;
    let best = null, bestD = 40 * 40;
    for (const e of list) {
      if (!e || e.dead || !e.position || e.team === undefined || e.team !== mine) continue;
      const d = e.position.distanceToSquared(ear);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return false;
    return this._spend(this._enemySpec(best), kind, best.position,
      settings?.enemyVoices !== false, true);
  }

  /**
   * One frame.
   *
   * @param hud anything with `popup(title, sub, kind)`. The HUD passes itself.
   */
  update(dt, world, player, hud) {
    if (!(dt > 0)) return;
    const settings = world?.settings || {};
    this._mixer(settings);
    this.clock += dt;
    this.quipT -= dt; this.effortT -= dt; this.enemyT -= dt; this.battleT -= dt;
    if (this.streakT > 0 && (this.streakT -= dt) <= 0) this.streak = 0;
    if (this.returnT > 0 && (this.returnT -= dt) <= 0) this.returns = 0;
    if (this.chamberT > 0 && (this.chamberT -= dt) <= 0) this.chamberRun = 0;

    // A new level (or the first frame ever) is a baseline, not a hundred
    // events: `kills` going from 12 to 0 must not read as anything at all.
    if (!this.started || this._level !== world) { this._baseline(world, player); return; }

    if (player) this._player(dt, world, player, hud, settings);
    this._enemies(dt, world, player, hud, settings);
    /* AFTER the frame's own events, not before. Something happening now has
     * the better claim on the air than something that was already late; the
     * held lines take the gaps the new ones leave. */
    this._drain();
  }

  _baseline(world, player) {
    this.started = true;
    this._level = world;
    this.streak = 0; this.returns = 0; this.chamberRun = 0; this.deaths.length = 0;
    // A held line is about a body in the world that just went away. Nothing on
    // this queue survives a level change, and a `cheer` whose cheerer belongs
    // to the previous world would speak from wherever that body last stood.
    this.pending.length = 0;
    this.lowSaid = false;
    const p = player || {};
    this.prev = {
      kills: p.kills ?? 0, deflects: p.deflects ?? 0, perfects: p.perfects ?? 0,
      chambers: p.chambers ?? 0,
      hp: this._hpFrac(p), alive: p.alive !== false, grounded: p.grounded !== false,
      velY: p.velocity?.y ?? 0, tip: p.saber?.tipSpeed ?? 0,
    };
    for (const e of world?.enemies || []) if (e?.A?.boss || e?.A?.big) this.bosses.add(e);
  }

  _hpFrac(p) {
    const max = p.maxHp > 0 ? p.maxHp : 1;
    const hp = Number.isFinite(p.hp) ? p.hp : max;
    return clamp(hp / max, 0, 1);
  }

  /**
   * The one place `voiceLevel` reaches the mixer.
   *
   * Pushed rather than pulled, and only when it MOVES: setVoiceLevel schedules
   * a param ramp, and scheduling one sixty times a second is a ramp that never
   * arrives anywhere.
   */
  _mixer(settings) {
    const want = Number.isFinite(settings.voiceLevel) ? settings.voiceLevel : 0.9;
    if (want === this._lastLevel) return;
    this._lastLevel = want;
    this.audio.setVoiceLevel?.(want);
  }

  /* ── the player ────────────────────────────────────────────────────── */

  _player(dt, world, player, hud, settings) {
    const P = this.prev;
    const spk = settings.voiceLines !== false;
    const spec = this.voice(settings);
    const at = player.chest || player.position || null;

    /* death — everything else this frame is beside the point */
    const alive = player.alive !== false;
    if (P.alive && !alive) {
      this._say(spec, 'die', at, 1.0, spk, true);
      this.streak = 0; this.returns = 0;
      P.alive = alive;
      return;
    }
    P.alive = alive;
    if (!alive) return;

    /* kills, and the streak they build */
    const kills = player.kills ?? 0;
    if (kills > P.kills) {
      const got = kills - P.kills;
      const was = this.streakT > 0 ? this.streak : 0;
      this.streak = was + got;
      this.streakT = STREAK_WINDOW;
      const r = rung(STREAKS, this.streak, was);
      if (r) {
        this._popup(hud, settings, r.title, r.sub, 'streak');
        this._say(spec, 'streak', at, 1.0, spk);
      } else {
        this._say(spec, 'kill', at, 0.85, spk);
      }
    }
    P.kills = kills;

    /* deflections, and the run of them */
    const deflects = player.deflects ?? 0;
    if (deflects > P.deflects) {
      const was = this.returns;
      this.returns += deflects - P.deflects;
      this.returnT = STREAK_WINDOW * 1.6;
      const r = rung(RETURNS, this.returns, was);
      if (r) {
        this._popup(hud, settings, r.title, r.sub, 'return');
        this._say(spec, 'streak', at, 0.9, spk);
      }
    }
    P.deflects = deflects;

    const perfects = player.perfects ?? 0;
    if (perfects > P.perfects) this._popup(hud, settings, 'PERFECT RETURN', 'sent back through them', 'perfect');
    P.perfects = perfects;

    /**
     * CHAMBERS — the highest-skill act in the game, and it had no reader.
     *
     * `World._applyClash` has kept `player.chambers` since chambering shipped
     * and nothing anywhere read the number: not the HUD, not the run summary,
     * not this file, which announces kills, deflections and perfect returns.
     * Meeting a declared arc inside its window is harder than any of those and
     * was the only one of them that went by in silence after the first frame's
     * floating label.
     *
     * Counted rather than pulsed so a run of them builds, the way returns do —
     * `rung` is the same ladder, and chambering three in an exchange is a
     * different thing from chambering three across a level.
     */
    const chambers = player.chambers ?? 0;
    if (chambers > P.chambers) {
      const was = this.chamberT > 0 ? this.chamberRun : 0;
      this.chamberRun = was + (chambers - P.chambers);
      this.chamberT = STREAK_WINDOW * 1.6;
      const c = rung(CHAMBERS, this.chamberRun, was);
      if (c) {
        this._popup(hud, settings, c.title, c.sub, 'perfect');
        this._say(spec, 'streak', at, 0.95, spk);
      }
    }
    P.chambers = chambers;

    /* being hit, and being nearly finished */
    const hp = this._hpFrac(player);
    if (hp < P.hp - 0.012) this._effort(spec, 'hurt', at, 0.95, spk);
    if (hp <= 0.25 && P.hp > 0.25 && !this.lowSaid) {
      this.lowSaid = true;
      this._popup(hud, settings, 'CRITICAL', 'the Force is all that is holding you', 'danger');
      this._say(spec, 'low', at, 1.0, spk);
    }
    if (hp > 0.45) this.lowSaid = false;
    P.hp = hp;

    /* landing — measured off the fall, not off the contact, because the
     * contact is where the velocity has already been zeroed */
    const grounded = player.grounded !== false;
    if (grounded && !P.grounded && P.velY < -HARD_LANDING) {
      this._effort(spec, 'land', at, clamp(-P.velY / 22, 0.5, 1.2), spk);
    }
    P.grounded = grounded;
    P.velY = player.velocity?.y ?? 0;

    /* effort on a real swing: a RISING edge through the threshold, so holding
     * a fast blade is one grunt and not sixty */
    const tip = player.saber?.tipSpeed ?? 0;
    if (tip > EFFORT_SPEED && P.tip <= EFFORT_SPEED) {
      this._effort(spec, 'effort', at, clamp(tip / 34, 0.5, 1.1), spk);
    }
    P.tip = tip;
  }

  /* ── the room ──────────────────────────────────────────────────────── */

  _enemies(dt, world, player, hud, settings) {
    const list = world?.enemies;
    if (!list || !list.length) return;
    const on = settings.enemyVoices !== false;
    const ear = player?.chest || player?.position || this.audio._listenerPos;

    // deaths age out of the panic window
    for (let i = this.deaths.length - 1; i >= 0; i--) {
      this.deaths[i] -= dt;
      if (this.deaths[i] <= 0) this.deaths.splice(i, 1);
    }

    if (this.panicFor > 0) this.panicFor = Math.max(0, this.panicFor - dt);
    for (const e of list) {
      if (!e || !e.position) continue;
      let st = this.enemies.get(e);
      if (!st) { st = { dead: false, spotted: false }; this.enemies.set(e, st); }

      /* a boss stepping into the level is an event even before it moves */
      if ((e.A?.boss || e.A?.big) && !e.dead && !this.bosses.has(e)) {
        this.bosses.add(e);
        this._popup(hud, settings, String(e.A.label || 'SOMETHING LARGE').toUpperCase(),
          e.A.boss ? 'a master of the blade' : 'heavy contact', 'boss');
        this._say(this.voice(settings), 'boss', player?.chest || null, 1.0, settings.voiceLines !== false);
      }

      /**
       * THROWN — player note #21: "I want to hear the enemies scream as they get
       * force thrown or killed."
       *
       * OBSERVED, not told, and that is the whole reason this is six lines
       * rather than an edit to every power in Player.js. `forcePush` ends in
       * `e.applyKnockback(...)`, `forcePull` in a yank, `unleash` in a repulse
       * and a grip in a hurl — four call sites, in a file this lane does not
       * own, and a fifth would be added next month and forget to speak. What
       * every one of them has in common is the only thing that matters here: the
       * body's speed goes up by a great deal in one frame.
       *
       * 8.5 m/s of GAIN, and the number is chosen against what a body can do to
       * itself. The fastest archetype in the roster runs at 6.2 m/s and reaches
       * it over about a second (`_move` damps toward the wish at rate 8), so the
       * most a running body gains in one 60 Hz frame is on the order of 0.1 m/s.
       * A push applies 20·k·P along the aim with a 7·k+3 lift — twenty-odd m/s,
       * instantly. There is a factor of a hundred between the two, so this
       * cannot fire on a droid breaking into a run and cannot miss a throw.
       *
       * Gated on being ALIVE: a body that is thrown after it is dead is a
       * ragdoll being kicked, and a corpse does not scream. A droid does not
       * either — it has no throat and the whole point of ENEMY_VOICES is that a
       * droid's tell is an inharmonic partial rather than a larynx — so a droid
       * that is flung gives its `alarm`, which through a ring-modulated square
       * at cadence 1.9 is exactly the panicked chirp the source material has.
       */
      const sp = e.velocity ? e.velocity.length() : 0;
      /* `st.speed !== undefined` is the first-frame guard and it is load-bearing
       * rather than defensive: a body delivered by a dropship is put down with
       * the ship's own velocity on it, so its FIRST reading is already 20 m/s
       * and a bare `sp - (st.speed || 0)` would have every arrival scream on the
       * frame it landed. The gain is only meaningful once there is a previous
       * frame to gain over. */
      if (!e.dead && st.speed !== undefined && sp - st.speed > FLUNG_SPEED) {
        /**
         * A FLUNG DROID SAYS `flung`, and it used to say `alarm`.
         *
         * The branch was `spec.ring ? 'alarm' : 'flung'`, on the reasoning that
         * a droid has no throat and its alarm chirp is the right noise for one
         * being thrown. That swaps the two halves of this whole system's design
         * over, and src/engine/Voice.js's own header says which is which: "what
         * carries the character is the contour and the timbre — a rising
         * three-syllable line reads as a taunt and a falling one reads as a
         * curse, WHOEVER IS SPEAKING". The contour is the event; the larynx is
         * the character. A droid thrown across a courtyard is having the same
         * thing happen to it as a trooper, and `flung` through a ring-modulated
         * square at cadence 1.9 is already exactly the panicked chirp that
         * branch was reaching for — it is the droid's throat that makes it one.
         *
         * It also removed the one case where the same contour meant two
         * different events, which is what `each` (Voice.js) could not have
         * classified: six droids spotting you is one piece of news and six
         * droids in the air is six.
         */
        this._roomLine(e, 'flung', on);
      }
      st.speed = sp;

      if (e.dead && !st.dead) {
        st.dead = true;
        this.deaths.push(3.5);
        /**
         * …AND SOMEBODY CHEERS. The other half of the same sentence: "or cheer
         * when someone dies."
         *
         * WHO cheers is the whole of it, and it is derived rather than branched
         * on a mode: whoever is on the OPPOSITE side of the body that just fell,
         * is near enough to have seen it, and is alive. In an ordinary wave that
         * is nobody — there is nothing on your side but you — and this costs one
         * loop over a list that is already being walked. In Command it is your
         * own army, which is what makes a kill feel like a kill: you cut down a
         * B2 and eleven clones behind you shout about it.
         *
         * It also works in the other direction, which is the part that makes it
         * a battlefield rather than a cheer squad: a trooper of yours falls and
         * the DROIDS cheer. Nothing here knows which side the player is on.
         */
        /**
         * A squad breaking is a WANT, not an event.
         *
         * The third death in a second is also a death, so it takes the shared
         * enemy budget for its own scream — and a panic call tested against
         * that budget on the same frame is always refused and then thrown away.
         * Held for two seconds instead, and said by whoever is left the moment
         * there is room for it.
         */
        if (this.deaths.length >= 3) this.panicFor = 2;
        /**
         * THE DEATH CRY IS RAISED BEFORE THE CHEER THAT ANSWERS IT, and the
         * order is now load-bearing rather than incidental.
         *
         * Both are per-event lines on the same 0.14 s budget, so two of them on
         * one frame is one line and one refusal. Which one survives has to be
         * the one the other is ABOUT: cheering a fall nobody heard is the wrong
         * half of the pair. `_cheerFor` therefore queues rather than speaks —
         * see CHEER_DELAY.
         *
         * A droid does not scream, it powers down: the descending three-note
         * 'die' contour on a ring-modulated square reads as exactly that.
         */
        this._roomLine(e, this._enemySpec(e).ring ? 'die' : 'scream', on);
        this._cheerFor(e, ear, on);
        continue;
      }
      if (e.dead) continue;

      /* the alarm call — once per body, the first time it has both seen you
       * and is close enough for you to hear it say so */
      if (!st.spotted && e.target && ear && e.position.distanceToSquared(ear) < 42 * 42) {
        // Marked only once the call has actually been MADE — or once the whole
        // channel is off. Marking it on the attempt meant a squad of five that
        // spotted you on the same frame produced exactly one alarm: four of
        // them were refused by the shared budget and then recorded as having
        // already spoken, so they never called out at all.
        //
        // …AND IT EXPIRES. Without the window below the retry never stopped:
        // one Geonosis minute produced 679 refused attempts against 18 spoken,
        // which is a body still trying to tell you it has seen you twenty
        // seconds after you killed the two next to it, and a shared budget with
        // no room left in it for anything that matters. See LINE_LIFE.
        // …AND IT IS OFFERED EXACTLY ONCE. The latch used to wait for the line
        // to be MADE, so a body the shared budget refused re-offered it on
        // every frame until it won: 679 attempts a minute, the last of them
        // arriving twenty seconds after the sighting. It is offered once and
        // HELD now, which keeps the property that latch was protecting — a
        // squad spotting you together still gets two or three voices out,
        // because the queue delivers them as the budget opens — without the
        // sweep and without the stale call. See LINE_LIFE.
        this._roomLine(e, 'alarm', on);
        st.spotted = true;
      }
    }

    /**
     * IDLE CHATTER — the droids talking to each other.
     *
     * Not tied to an event, because that is the point: a battle droid line is
     * furniture, and furniture that only appears when something happens is not
     * furniture. One every `CHATTER_GAP` seconds at most, from a droid that has
     * already seen you and is close enough to be worth overhearing, and it goes
     * through the same shared budget as everything else the room says — so it
     * can never speak over a death or an alarm.
     *
     * The three names below are NOT the drifted key list that `_enemySpec` used
     * to carry — this one is deliberately narrower than "every droid". A
     * training remote and an inert dummy are dojo furniture with nobody to talk
     * to, a walker is a vehicle, and an IG general muttering B1 banter would be
     * a worse boss, not a better one. Battle droids chatter; the rest do not.
     */
    this.chatterT -= dt;
    if (this.chatterT <= 0 && this.enemyT <= 0 && ear) {
      this.chatterT = CHATTER_GAP;
      const talkers = [];
      for (const e of list) {
        if (!e || e.dead || !e.position || !e.target) continue;
        if (!this._chatty(e, list)) continue;
        if (e.position.distanceToSquared(ear) < 26 * 26) talkers.push(e);
      }
      if (talkers.length) {
        const who = talkers[(this._chatterAt = ((this._chatterAt | 0) + 1)) % talkers.length];
        // …AND IN ITS OWN THROAT. This handed `ENEMY_VOICES.droid` to whoever
        // it picked, which was safe only because the picker was a list of three
        // droid names; the moment the test became a property of the body, a
        // clone would have chattered as a B1. One classifier, as everywhere
        // else here.
        this._roomLine(who, 'chatter', on);
      }
    }

    /**
     * THE OFFICER SHOUTS AT THE LINE IT IS HOLDING TOGETHER.
     *
     * `commandAura` is the field that says a body carries the rally ring, and
     * `_enemySpec` already gives that body a voice built to carry across a
     * battle — a spec whose own note complains that "a ring with nothing
     * audible in it is half a tell". This is the audible half, and it is the
     * only thing on the field that ever emits `LINES.order`.
     *
     * Furniture, on the same terms as the droids' banter and rarer: a slow
     * cadence, a body that is alive and near enough to be worth overhearing,
     * and the shared budget under it so an order can never speak over a death.
     * `commandAura` rather than a rank or a type, for the reason `_enemySpec`
     * gives at length — it is the field that MEANS this, it is read by
     * `enlistBody` to install the modifier, and both armies have a body that
     * carries it, so the enemy's commander shouts exactly as yours does.
     */
    this.rallyT -= dt;
    if (this.rallyT <= 0 && this.enemyT <= 0 && ear) {
      this.rallyT = RALLY_GAP;
      let best = null, bestD = 40 * 40;
      for (const e of list) {
        if (!e || e.dead || !e.position || !e.A?.commandAura) continue;
        const d = e.position.distanceToSquared(ear);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) this._roomLine(best, 'order', on);
    }


    /* the squad breaking — three of them gone inside three and a half seconds */
    if (this.panicFor > 0 && this.enemyT <= 0) {
      let best = null, bestD = Infinity;
      for (const e of list) {
        if (!e || e.dead || !e.position || !ear) continue;
        const d = e.position.distanceToSquared(ear);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best && bestD < 32 * 32) {
        this.panicFor = 0;
        this.deaths.length = 0;
        this._roomLine(best, 'panic', on);
      }
    }
  }

  /**
   * WHAT A BODY SOUNDS LIKE WHEN IT IS HURT — derived, not listed.
   *
   * This was five branches over hard-coded archetype KEYS:
   *
   *     if (/^(b1|b2|droideka|remote|dummy)$/.test(type)) return ENEMY_VOICES.droid;
   *     if (type === 'walker') return ENEMY_VOICES.walker;
   *     if (type === 'beast') return ENEMY_VOICES.beast;
   *     if (/^(trooper|sniper)$/.test(type)) return ENEMY_VOICES.trooper;
   *     return ENEMY_VOICES.sith;
   *
   * — eleven names for a roster of fourteen. `bodyguard`, `charger` and
   * `stalker` are registered in src/game/Levels.js rather than in Enemy.js,
   * after this list was written, so all three fell past every branch onto the
   * Sith acolyte. Measured on the real method over `Object.keys(ARCHETYPES)`:
   * the Reek and the Nexu died at f0 97 on the two-syllable HUMAN scream, where
   * the Acklay — the one animal the list happened to name — dies at f0 58 on
   * the beast's; and the 1050 hp IG Bodyguard Droid, a guaranteed set-piece from
   * wave 10, screamed with a man's throat where every other droid powers down at
   * f0 300 with an inharmonic ring partial on the three-syllable 'die' contour.
   * The same three were wrong in their alarm and panic calls, which come through
   * here too, and charger + stalker are four of the colosseum's nine pool slots.
   *
   * The list is gone. `bodyOf` (src/engine/Presence.js) is the roster's one body
   * classifier — it reads the archetype record the enemy is carrying rather than
   * a copy of its name — and this maps its answer onto a voice. Presence.js was
   * already asking the identical question one layer down and getting the
   * identical three wrong; now there is one classifier and two readers, so the
   * next archetype somebody registers is voiced the day it is added instead of
   * the day someone remembers this function exists.
   */
  _enemySpec(enemy) {
    const body = bodyOf(enemy);
    const A = enemy?.A || {};
    if (body.walker) return ENEMY_VOICES.walker;
    if (body.beast) return ENEMY_VOICES.beast;
    /**
     * TWO MORE THROATS, AND BOTH SPLITS ARE DERIVED FROM A FIELD THAT MEANS
     * SOMETHING — never from a list of type names, which is the defect this
     * method's own header is four hundred words about.
     *
     * A DROID THAT FIGHTS WITH A BLADE IS NOT A B1. `ENEMY_VOICES.droid` is a
     * B1: f0 300, cadence 1.9, a 2.71 ring partial, and its whole character is
     * that it sounds SILLY. That is exactly right for the body it was written
     * for and exactly wrong for a BX commando droid, a MagnaGuard or the IG
     * general, which are the CIS bodies meant to frighten you. `A.melee` is the
     * real distinction and it is already load-bearing everywhere else in the
     * game — it is what puts a body through `DuelBrain`.
     *
     * (That change reaches `bodyguard` too, and it is an improvement rather
     * than a side effect. This method's header records the 1050 hp IG general
     * "screaming with a man's throat" as a bug and the fix as sending it to the
     * droid voice; the honest answer was always that a general is neither, and
     * `commando` is the machine that is taken seriously.)
     *
     * AN OFFICER IS A TROOPER WHO COMMANDS. `commandAura` is the field that
     * says a body carries the rally ring — it is read by `enlistBody` to install
     * the modifier and it is what makes the fifth rung of both ladders worth
     * buying. A body whose job is to make the line around it better is a body
     * that SHOUTS, and this is the one place in the game that can say so.
     */
    if (body.droid) return A.melee ? ENEMY_VOICES.commando : ENEMY_VOICES.droid;
    if (body.trooper) return A.commandAura ? ENEMY_VOICES.officer : ENEMY_VOICES.trooper;
    return ENEMY_VOICES.sith;
  }

  /**
   * HAS THIS BODY GOT SOMEBODY TO TALK TO — derived, like everything else here.
   *
   * The test was `/^(b1|b2|droideka)$/.test(e.type)`, which is a typed list of
   * archetype keys sitting beside a roster of 31 that grows every session, and
   * it is the exact shape `_enemySpec`'s own header is four hundred words about.
   * Its comment argued the right things and encoded them as names: "a training
   * remote and an inert dummy are dojo furniture with nobody to talk to, a
   * walker is a vehicle, and an IG general muttering B1 banter would be a worse
   * boss".
   *
   * Every one of those three clauses is a FIELD the archetype already carries,
   * so this asks for the fields instead. Measured over the whole roster with
   * Levels.js loaded, the two agree everywhere the old list had an opinion and
   * differ where it had none: the dojo three are excluded by `training`, the
   * IG general by `boss`, the machines by `bodyOf`, and the seven bodies the
   * name list had never heard of — every clone trooper, heavy, jet, ARC and
   * commander in Command mode, plus the B2's rocket and BX cousins — are IN.
   *
   * THAT IS THE POINT. The player's note is that the battlefield should be
   * audible, and the one thing your own army never did was talk: a clone squad
   * standing beside you was silent between deaths, because the only idle line
   * in the game was gated on three droid names.
   *
   * The last clause is what the old comment's "nobody to talk to" really meant
   * and could not express: banter needs a second body. A lone survivor does not
   * mutter to itself.
   */
  _chatty(enemy, list) {
    const A = enemy.A || {};
    if (A.training || A.boss || A.big || A.setPieceOnly) return false;
    const body = bodyOf(enemy);
    if (!body.droid && !body.trooper) return false;
    for (const o of list) {
      if (o === enemy || !o || o.dead || !o.position || o.team !== enemy.team) continue;
      if (o.position.distanceToSquared(enemy.position) < 9 * 9) return true;
    }
    return false;
  }

  /* ── the three budgets ─────────────────────────────────────────────── */

  /** A quip: rare, deliberate, and never on top of another one. */
  _say(spec, kind, pos, gain, enabled, force = false) {
    if (!enabled) return this._refuse('off', kind, true);
    if (!force && this.quipT > 0) return this._refuse('quip', kind, true);
    const dur = this.audio.speak(spec, kind, { pos, gain, self: true });
    if (!dur) return this._refuse('engine', kind);
    this.quipT = QUIP_GAP + dur;
    this.effortT = Math.max(this.effortT, dur * 0.6);
    this.stats.quips++;
    this._spoke(kind);
    return true;
  }

  /** An effort: frequent, wordless, and it does not eat the quip budget. */
  _effort(spec, kind, pos, gain, enabled) {
    if (!enabled) return this._refuse('off', kind, true);
    if (this.effortT > 0) return this._refuse('effort', kind, true);
    const dur = this.audio.speak(spec, kind, { pos, gain, self: true });
    if (!dur) return this._refuse('engine', kind);
    this.effortT = EFFORT_GAP + dur;
    this.stats.efforts++;
    this._spoke(kind);
    return true;
  }

  /**
   * SOMEBODY ON THE OTHER SIDE OF `fallen` CHEERS — the nearest one who saw it.
   *
   * Nearest rather than random for the same reason the panic call picks the
   * nearest: a cheer from a body forty metres behind a rock is a sound with no
   * source, and the whole point of positional voice is that you can look toward
   * it. 30 m is the same window the panic call uses.
   *
   * `team` and nothing else decides who is opposed, so this needs no mode
   * branch and cannot disagree with `canHarm` — it is the same field.
   */
  _cheerFor(fallen, ear, enabled) {
    const list = this._level?.enemies;
    if (!list || fallen.team === undefined || !ear) return false;
    let best = null, bestD = 30 * 30;
    for (const e of list) {
      if (!e || e.dead || !e.position || e.team === undefined) continue;
      if (e.team === fallen.team) continue;
      const d = e.position.distanceToSquared(fallen.position);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return false;
    // Only if the player is close enough to be in the moment. A cheer eighty
    // metres away is a sound the mixer will place and the player will not
    // connect to anything.
    if (best.position.distanceToSquared(ear) > 46 * 46) return false;
    // HELD, NOT SPOKEN. See CHEER_DELAY: the cry and the cheer are two calls
    // on one 0.14 s budget and the cheer is raised second, so speaking it here
    // would silence the death it is about. A crowd answers a fall anyway.
    return this._roomLine(best, 'cheer', enabled, CHEER_DELAY);
  }

  /**
   * A LINE THE BATTLE ITSELF MAKES — a body flung, an army cheering.
   *
   * Its own budget, and see the note on BATTLE_GAP for why that is a decision
   * rather than a loophole. It deliberately does NOT touch `enemyT`, so a push
   * that throws six droids cannot also silence the alarm call of the seventh —
   * those are two different things the room is saying and they are not competing
   * for the same air.
   */
  _battleLine(spec, kind, pos, enabled, force = false) {
    if (!enabled) return this._refuse('off', kind);
    if (!force && this.battleT > 0) return this._refuse('battle', kind);
    const dur = this.audio.speak(spec, kind, { pos, gain: 0.95 });
    if (!dur) return this._refuse('engine', kind);
    this.battleT = BATTLE_GAP;
    this.stats.enemyLines++;
    this._spoke(kind);
    return true;
  }

  /**
   * WHICH BUDGET A ROOM LINE SPENDS — the one place that decides, for all of
   * them. `_roomLine` is the door; this is the till.
   *
   * There are two, they mean different things, and until now every call site
   * picked one by hand. Measured with `tools/_voiceprobe.mjs` on a real
   * Geonosis command wave (seed 4242, 60 s, 18 bodies up), the hand-picking was
   * wrong in exactly one place and it was the place that mattered: **seven
   * bodies fell and the player heard none of them.** Deaths were on the shared
   * budget behind the alarm calls of bodies that were still standing, while
   * `cheer` — which was given the per-event budget when it was written, for
   * reasons that apply to a death word for word — was refused zero times.
   *
   * The rule is not restated here. `each` is declared on the contour in
   * src/engine/Voice.js, beside the paragraph that authored the contour, and
   * `EACH` is that flag. This is the reader.
   *
   * `force` is for a line the PLAYER asked for by pressing something. It skips
   * the gap and then sets it, exactly as `_say(force)` does, so the automatic
   * line that would have followed waits instead of landing on top of it.
   */
  _spend(spec, kind, pos, enabled, force = false) {
    return EACH.has(kind)
      ? this._battleLine(spec, kind, pos, enabled, force)
      : this._enemyLine(spec, kind, pos, enabled, force);
  }

  /**
   * A LINE THE ROOM MAKES: say it now, or hold it until there is air for it.
   * See LINE_LIFE.
   *
   * Every room line the game raises comes through here. The immediate attempt
   * is first, so a quiet field costs a queue push of nothing at all, and only a
   * line the BUDGET refused is held — a line refused because the channel is
   * switched off is not waiting for anything.
   *
   * The body is carried alongside the position for two reasons: a held line
   * speaks from where the body is when it is finally said rather than from
   * where it was, and a cheer whose cheerer has fallen in the meantime is not
   * said at all.
   */
  _roomLine(enemy, kind, enabled, delay = 0) {
    if (!enemy?.position) return false;
    const spec = this._enemySpec(enemy);
    if (delay <= 0 && this._spend(spec, kind, enemy.position, enabled)) return true;
    if (!enabled) { this._lost(kind); return false; }
    this._hold(spec, kind, enemy, enabled, delay);
    return false;
  }

  /** Put one line on the queue, oldest out if it is full. */
  _hold(spec, kind, who, enabled, delay = 0) {
    if (this.pending.length >= PENDING_CAP) {
      const drop = this.pending.shift();
      this._refuse('stale', drop.kind, true);
    }
    const p = who?.position;
    this.pending.push({ spec, kind, who, on: enabled,
      /* A death cry is said BY the body that just fell, so "the speaker died"
       * cannot be a blanket reason to drop a held line. It is only a reason
       * when the speaker was STANDING when the line was raised — a cheer, a
       * panic call, an order — which is a fact about the moment and not a list
       * of contour names. */
      wasAlive: !who?.dead,
      pos: p ? { x: p.x, y: p.y, z: p.z } : null,
      at: this.clock + delay, dies: this.clock + delay + LINE_LIFE });
    this.stats.held++;
  }

  /**
   * One pass over the held lines.
   *
   * AT MOST ONE ATTEMPT PER BUDGET PER FRAME, and that is the whole reason the
   * queue exists rather than a per-body retry: the two budgets are shared, so
   * once one of them has refused a line this frame it will refuse every other
   * line of that class this frame too, and asking it twenty more times is the
   * 679-refusals-a-minute spin this replaced. Dead entries and expired ones are
   * dropped on the way past.
   */
  _drain() {
    let eachShut = false, chorusShut = false;
    for (let i = 0; i < this.pending.length;) {
      const q = this.pending[i];
      if (this.clock < q.at) { i++; continue; }
      if (this.clock > q.dies || !(q.who?.position || q.pos) || (q.wasAlive && q.who?.dead)) {
        this.pending.splice(i, 1);
        this._refuse('stale', q.kind, true);
        continue;
      }
      const each = EACH.has(q.kind);
      if (each ? eachShut : chorusShut) { i++; continue; }
      if (this._spend(q.spec, q.kind, q.who?.position || q.pos, q.on)) { this.pending.splice(i, 1); continue; }
      if (each) eachShut = true; else chorusShut = true;
      i++;
    }
  }

  /**
   * A BODY ASKED TO SPEAK — the public door onto the room's voice.
   *
   * `Enemy.cry` raises `world.onEnemyVoice(enemy, kind)` and deliberately
   * decides nothing else: which larynx is `_enemySpec`'s job and how often the
   * room may speak is `_enemyLine`'s, and duplicating either is the defect this
   * project keeps a whole section of the handoff for. Until now the wire in
   * `src/main.js` had to reach through the class and call BOTH private methods
   * itself, and the note beside it says so in as many words — "Announcer wants
   * a public `enemyLine(enemy, kind)` that is exactly these two calls, and it is
   * owned by another pass".
   *
   * This is that method. It is exactly those two calls and it takes a BODY
   * rather than a spec, which is the whole point: a caller that has to pick the
   * spec is a caller that can pick the wrong one.
   */
  enemyLine(enemy, kind, enabled = true) {
    if (!enemy?.position || !LINES_HAS(kind)) return false;
    return this._roomLine(enemy, kind, enabled);
  }

  /** Anything an enemy says, on one shared budget for the whole room. */
  _enemyLine(spec, kind, pos, enabled, force = false) {
    if (!enabled) return this._refuse('off', kind);
    if (!force && this.enemyT > 0) return this._refuse('enemy', kind);
    const dur = this.audio.speak(spec, kind, { pos, gain: 0.9 });
    if (!dur) return this._refuse('engine', kind);
    this.enemyT = ENEMY_GAP + dur * 0.5;
    this.stats.enemyLines++;
    this._spoke(kind);
    return true;
  }

  _popup(hud, settings, title, sub, kind) {
    if (settings.popups === false) return this._refuse('popup');
    if (!hud || typeof hud.popup !== 'function') return false;
    hud.popup(title, sub, kind);
    this.stats.popups++;
    return true;
  }
}

/*
 * There was an `export const VOICE_NAMES = PLAYER_VOICES.map(v => v.name)` here,
 * under the docstring "The names the options screen prints. One list, one
 * owner". It was imported by nothing. The options screen prints
 * `voiceAt(v).name` straight off the table (src/ui/Menu.js), which IS one list
 * with one owner — src/engine/Voice.js — so the export was a second copy of the
 * answer that only claimed to be the source of it. A name table that drifts is
 * worse than no name table.
 */
