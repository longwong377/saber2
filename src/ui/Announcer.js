/**
 * SABER — what the fight says about itself.
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
import { PLAYER_VOICES, ENEMY_VOICES, voiceAt } from '../engine/Voice.js';
import { clamp } from '../engine/MathUtil.js';

/** Seconds between quips (kill, streak, boss, low health) whatever happens. */
export const QUIP_GAP = 4.5;
/** Seconds between the wordless efforts — swings, landings, hits taken. */
export const EFFORT_GAP = 0.85;
/** Seconds between anything the ENEMIES say, across all of them. */
export const ENEMY_GAP = 0.45;
/** …and how often a droid is allowed to say nothing in particular. */
export const CHATTER_GAP = 6.5;
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
  { at: 3, title: 'TRIPLE STRIKE', sub: 'three' },
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

const rung = (ladder, n) => {
  let hit = null;
  for (const r of ladder) if (n >= r.at) hit = r;
  return hit && hit.at === n ? hit : null;
};

export class Announcer {
  constructor(audio = defaultAudio) {
    this.audio = audio;
    this.reset();
  }

  reset() {
    this.prev = { kills: 0, deflects: 0, perfects: 0, hp: 1, alive: true, grounded: true, velY: 0, tip: 0 };
    this.started = false;
    this.quipT = 0;
    this.effortT = 0;
    this.enemyT = 0;
    this.chatterT = CHATTER_GAP;
    this.streak = 0;
    this.streakT = 0;
    this.returns = 0;
    this.returnT = 0;
    this.lowSaid = false;
    this.deaths = [];
    this.panicFor = 0;
    this.enemies = new WeakMap();
    this.bosses = new WeakSet();
    this._level = null;
    this.stats = { quips: 0, efforts: 0, enemyLines: 0, popups: 0, suppressed: 0 };
  }

  /** The voice the player has chosen, live off the settings blob. */
  voice(settings) { return voiceAt(settings?.voiceIndex ?? 0); }

  /**
   * One frame.
   *
   * @param hud anything with `popup(title, sub, kind)`. The HUD passes itself.
   */
  update(dt, world, player, hud) {
    if (!(dt > 0)) return;
    const settings = world?.settings || {};
    this._mixer(settings);
    this.quipT -= dt; this.effortT -= dt; this.enemyT -= dt;
    if (this.streakT > 0 && (this.streakT -= dt) <= 0) this.streak = 0;
    if (this.returnT > 0 && (this.returnT -= dt) <= 0) this.returns = 0;

    // A new level (or the first frame ever) is a baseline, not a hundred
    // events: `kills` going from 12 to 0 must not read as anything at all.
    if (!this.started || this._level !== world) { this._baseline(world, player); return; }

    if (player) this._player(dt, world, player, hud, settings);
    this._enemies(dt, world, player, hud, settings);
  }

  _baseline(world, player) {
    this.started = true;
    this._level = world;
    this.streak = 0; this.returns = 0; this.deaths.length = 0;
    this.lowSaid = false;
    const p = player || {};
    this.prev = {
      kills: p.kills ?? 0, deflects: p.deflects ?? 0, perfects: p.perfects ?? 0,
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
      this.streak = (this.streakT > 0 ? this.streak : 0) + got;
      this.streakT = STREAK_WINDOW;
      const r = rung(STREAKS, this.streak);
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
      this.returns += deflects - P.deflects;
      this.returnT = STREAK_WINDOW * 1.6;
      const r = rung(RETURNS, this.returns);
      if (r) {
        this._popup(hud, settings, r.title, r.sub, 'return');
        this._say(spec, 'streak', at, 0.9, spk);
      }
    }
    P.deflects = deflects;

    const perfects = player.perfects ?? 0;
    if (perfects > P.perfects) this._popup(hud, settings, 'PERFECT RETURN', 'sent back through them', 'perfect');
    P.perfects = perfects;

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

      if (e.dead && !st.dead) {
        st.dead = true;
        this.deaths.push(3.5);
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
        // A droid does not scream, it powers down: the descending three-note
        // 'die' contour on a ring-modulated square reads as exactly that.
        const spec = this._enemySpec(e);
        this._enemyLine(spec, spec.ring ? 'die' : 'scream', e.position, on);
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
        if (this._enemyLine(this._enemySpec(e), 'alarm', e.position, on) || !on) st.spotted = true;
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
     */
    this.chatterT -= dt;
    if (this.chatterT <= 0 && this.enemyT <= 0 && ear) {
      this.chatterT = CHATTER_GAP;
      const talkers = [];
      for (const e of list) {
        if (!e || e.dead || !e.position || !e.target) continue;
        if (!/^(b1|b2|droideka)$/.test(String(e.type || ''))) continue;
        if (e.position.distanceToSquared(ear) < 26 * 26) talkers.push(e);
      }
      if (talkers.length) {
        const who = talkers[(this._chatterAt = ((this._chatterAt | 0) + 1)) % talkers.length];
        this._enemyLine(ENEMY_VOICES.droid, 'chatter', who.position, on);
      }
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
        this._enemyLine(this._enemySpec(best), 'panic', best.position, on);
      }
    }
  }

  _enemySpec(enemy) {
    const type = String(enemy?.type || '');
    if (/^(b1|b2|droideka|remote|dummy)$/.test(type)) return ENEMY_VOICES.droid;
    if (type === 'walker') return ENEMY_VOICES.walker;
    if (type === 'beast') return ENEMY_VOICES.beast;
    if (/^(trooper|sniper)$/.test(type)) return ENEMY_VOICES.trooper;
    return ENEMY_VOICES.sith;
  }

  /* ── the three budgets ─────────────────────────────────────────────── */

  /** A quip: rare, deliberate, and never on top of another one. */
  _say(spec, kind, pos, gain, enabled, force = false) {
    if (!enabled) { this.stats.suppressed++; return false; }
    if (!force && this.quipT > 0) { this.stats.suppressed++; return false; }
    const dur = this.audio.speak(spec, kind, { pos, gain, self: true });
    if (!dur) return false;
    this.quipT = QUIP_GAP + dur;
    this.effortT = Math.max(this.effortT, dur * 0.6);
    this.stats.quips++;
    return true;
  }

  /** An effort: frequent, wordless, and it does not eat the quip budget. */
  _effort(spec, kind, pos, gain, enabled) {
    if (!enabled) { this.stats.suppressed++; return false; }
    if (this.effortT > 0) { this.stats.suppressed++; return false; }
    const dur = this.audio.speak(spec, kind, { pos, gain, self: true });
    if (!dur) return false;
    this.effortT = EFFORT_GAP + dur;
    this.stats.efforts++;
    return true;
  }

  /** Anything an enemy says, on one shared budget for the whole room. */
  _enemyLine(spec, kind, pos, enabled) {
    if (!enabled) { this.stats.suppressed++; return false; }
    if (this.enemyT > 0) { this.stats.suppressed++; return false; }
    const dur = this.audio.speak(spec, kind, { pos, gain: 0.9 });
    if (!dur) return false;
    this.enemyT = ENEMY_GAP + dur * 0.5;
    this.stats.enemyLines++;
    return true;
  }

  _popup(hud, settings, title, sub, kind) {
    if (settings.popups === false) { this.stats.suppressed++; return false; }
    if (!hud || typeof hud.popup !== 'function') return false;
    hud.popup(title, sub, kind);
    this.stats.popups++;
    return true;
  }
}

/** The names the options screen prints. One list, one owner. */
export const VOICE_NAMES = PLAYER_VOICES.map(v => v.name);
