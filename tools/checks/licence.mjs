/**
 * BATTLEFRONT BORZ — A RANK IS A PERMISSION, NOT A HEALTH BAR.
 *
 * `RANKS` used to run 1.00 → 1.78 health, 1.34 damage and 1.10 pace across five
 * rungs, and `AIM_BY_RANK` matched that climb. A veteran was not a different
 * kind of soldier; he was the same soldier with bigger numbers, and a ladder
 * shaped like that does two bad things at once:
 *
 *   IT IS A RATCHET. `Company.js`'s own header refuses cross-run power on the
 *     same terms `Progress.js` refuses currency. A roll of survivors that is
 *     worth twice a fresh one is exactly that power, arriving by the one road
 *     nobody complains about.
 *   IT MAKES THE SLATE FURNITURE. If the answer to every question is "field
 *     the veterans", the ten named men the barracks just rolled for you are a
 *     screen you scroll past.
 *
 * So the numbers were compressed and a LICENCE was put in their place: a duty
 * each rung grants that the rung below does not have. This file is the proof
 * that the trade actually happened — that the numbers really did come down,
 * that every duty is read by something in the fight, and that losing the man
 * who holds one takes the capability off the field and says so.
 *
 * WHAT IS ASSERTED, and each one is the shape of a specific way this could be
 * a lie:
 *
 *   THE LADDER IS FLAT NOW.    Measured off `RANKS` and `AIM_BY_RANK`, with a
 *                              ceiling on every channel. A future edit that
 *                              re-steepens it goes red here.
 *   ONE TABLE, ONE READER.     `holds()` answers for a record, a body and a
 *                              bare rung, refuses a corpse, and every duty in
 *                              `DUTIES` is cumulative.
 *   EVERY DUTY IS READ.        Four consumers, driven on a real director:
 *                              `LEADS` in front of `leaderOf`, `HOLDS` on the
 *                              plant, `CREWS` on the shovel, `RELAYS` in the
 *                              morale channel. A licence nothing reads is the
 *                              "rank that only exists in a list" this codebase
 *                              keeps deleting.
 *   THE VACANCY IS SPOKEN.     And is not spoken on an ordinary death, which
 *                              is the half that keeps it worth reading.
 *   THE SEAT PERSISTS.         Through the real store, and the licence is
 *                              re-tested on the way back onto a roll.
 */

import * as THREE from 'three';
import * as Cmd from '../../src/game/Command.js';
import { MORALE } from '../../src/game/Morale.js';
import { LEVELS } from '../../src/game/Levels.js';
import { ARCHETYPES } from '../../src/game/Enemy.js';
import * as Company from '../../src/game/Company.js';
import * as Muster from '../../src/game/Muster.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * A world with the fields the director reads, and stub bodies — command.mjs's
 * own fixture and its argument: what this file is about is the ROSTER and the
 * rules, and a real `Enemy` drags a rig, a ragdoll and cloth in for every one
 * of ten troops to measure a boolean.
 */
function cmdWorld() {
  const w = {
    scene: new THREE.Scene(),
    terrain: {
      height: () => 0, normalAt: (x, z, o) => o.set(0, 1, 0), raycast: () => null,
      size: 400, half: 200, surfaceAt: () => 'sand', slopeAt: () => 0, flush() {},
      crater() { w.craters = (w.craters | 0) + 1; },
      inBounds: (x, z) => Math.hypot(x, z) < 200,
    },
    settings: {}, difficulty: null, hpScale: 1, dmgScale: 1, time: 0,
    players: [], enemies: [], statics: [], props: [], doors: [],
    physics: { staticBoxes: [], bodies: [], add() {}, remove() {},
      addStaticBox() { return null; }, removeStaticBox() {}, raycast: () => null },
    level: LEVELS.geonosis, run: null, takenBoons: new Set(),
    notes: [],
    notify(a, b) { this.notes.push([a, b]); },
    report() {},
    spawnEnemy(type, pos) {
      const A = ARCHETYPES[type];
      const e = {
        id: 'e' + (w._n = (w._n | 0) + 1), type, A, world: w, team: 1,
        position: pos.clone ? pos.clone() : V(pos.x, pos.y, pos.z),
        velocity: new THREE.Vector3(), dead: false, hp: A.hp, maxHp: A.hp,
        speed: A.speed, attackDamage: A.damage ?? 0, mod: null, rig: null,
        group: null, wish: null, toTarget: null, facing: 0,
        _wallN: new THREE.Vector3(), _wallT: 0, _stuckT: 0,
        _prevPos: new THREE.Vector3(),
        burstLeft: 0, burstTimer: 0, attackTimer: 0, aimCharge: 0,
        _move() {}, damage(n) { this.hp -= n; return this.hp <= 0; }, _syncBody() {},
      };
      w.enemies.push(e);
      return e;
    },
  };
  return w;
}

/** A deployed army with a body commanding it and its squad numbers stamped. */
function army() {
  const w = cmdWorld();
  const d = new Cmd.CommandDirector(w, { pool: LEVELS.geonosis.pool });
  const me = { position: V(0, 0, 0), aimDir: V(0, 0, 1), facing: 0, alive: true, team: 0 };
  w.players.push(me);
  w.player = me;
  d.commander.player = me;
  d.deploy();
  d._troops(1 / 30, {});
  return { w, d, me, c: d.commander };
}

/** Run `fn` against an empty company and an empty slate; put the player's back. */
function withCleanStore(fn) {
  const hadC = localStorage.getItem(Company.KEY);
  const hadM = localStorage.getItem(Muster.KEY);
  localStorage.removeItem(Company.KEY);
  localStorage.removeItem(Muster.KEY);
  try { return fn(); }
  finally {
    if (hadC == null) localStorage.removeItem(Company.KEY);
    else localStorage.setItem(Company.KEY, hadC);
    if (hadM == null) localStorage.removeItem(Muster.KEY);
    else localStorage.setItem(Muster.KEY, hadM);
  }
}

export async function run({ check, assert }) {
  const { clocked } = await import('./_shared.mjs');
  /* The morale clause drives `_morale`, and `Enemy`'s module stream is touched
   * by `deploy` through the stub's `spawnEnemy`. `clocked` also puts
   * localStorage back around each body, which the store clause needs. */
  check = await clocked(check);
  const AIM = (await import('../../src/game/Enemy.js')).AIM_BY_RANK;

  check('licence: the ladder is flat enough that a survivor is not a different army', () => {
    /**
     * THE CEILINGS ARE THE TRADE, WRITTEN DOWN.
     *
     * A ladder is allowed to be worth something — a Commander who has lived
     * through five areas should be better than the man who landed this morning
     * — and it is not allowed to be worth so much that the roll is the answer
     * to every question. These numbers are the line: a top rung inside +25%
     * health, +15% damage, +6% pace and a tenth off the aim cone.
     *
     * They are asserted as RATIOS AGAINST RUNG 0 rather than as literals, so a
     * re-tune that keeps the shape passes and a re-steepening does not — which
     * is the property, not the digits.
     */
    const R = Cmd.RANKS;
    const top = R[R.length - 1];
    const caps = { hp: 1.25, dmg: 1.15, speed: 1.06 };
    for (const k of Object.keys(caps)) {
      assert(R[0][k] === 1, `rung 0 is ${R[0][k]} on ${k} — the base is not the base`);
      assert(top[k] <= caps[k],
        `the top rung buys ${((top[k] - 1) * 100).toFixed(0)}% ${k} and the ceiling is `
        + `${((caps[k] - 1) * 100).toFixed(0)}% — a returning company is becoming a `
        + 'stronger army rather than a more capable one');
      /* AND IT ONLY GOES UP. A rung that is worth less than the one below it
       * is a promotion that hurts, which nothing in the fight would explain. */
      for (let i = 1; i < R.length; i++) {
        assert(R[i][k] >= R[i - 1][k],
          `${R[i].title} is ${R[i][k]} on ${k} and ${R[i - 1].title} is ${R[i - 1][k]}`);
      }
    }
    /* THE AIM TABLE IS THE SAME LADDER and it moved with it — a cone is a
     * multiplier the other way, so its ceiling is a floor. */
    assert(AIM.length === R.length, `${AIM.length} aim rungs against ${R.length} ranks`);
    assert(AIM[0] === 1, 'the aim table does not start at the raw cone');
    assert(AIM[AIM.length - 1] >= 0.85,
      `a Commander shoots at ${AIM[AIM.length - 1]} of a trooper's cone — the aim table was `
      + 'left on the old steep ladder while RANKS came down');
    for (let i = 1; i < AIM.length; i++) {
      assert(AIM[i] <= AIM[i - 1], `the aim table goes the wrong way at rung ${i}`);
    }
    return `top rung ×${top.hp} hp, ×${top.dmg} dmg, ×${top.speed} pace, `
      + `aim ×${AIM[AIM.length - 1]}`;
  });

  check('licence: one table, one reader, and it refuses a corpse', () => {
    /**
     * `holds()` is the whole taxonomy's only door. Everything below is a way it
     * could quietly stop being one: a duty that is not cumulative, a spelling
     * nobody validates, a body that answers differently from the record it is
     * wearing, or a dead man who still holds his licence — which is the one
     * that matters, because the entire vacancy mechanism is "the capability
     * leaves the field when he does".
     */
    const D = Cmd.DUTIES;
    assert(D.length === Cmd.RANKS.length, `${D.length} duties for ${Cmd.RANKS.length} rungs`);
    assert(new Set(D).size === D.length, `two rungs share a duty: ${D.join(',')}`);

    /* CUMULATIVE, on every rung, both ways round. */
    for (let r = 0; r < D.length; r++) {
      for (let i = 0; i < D.length; i++) {
        const want = i <= r;
        assert(Cmd.holds(r, D[i]) === want,
          `rung ${r} (${Cmd.RANKS[r].title}) ${Cmd.holds(r, D[i]) ? 'holds' : 'does not hold'} `
          + `${D[i]} and should ${want ? '' : 'not '}`);
      }
      assert(Cmd.dutiesAt(r).join() === D.slice(0, r + 1).join(),
        `dutiesAt(${r}) is ${Cmd.dutiesAt(r).join()}`);
    }
    assert(!Cmd.holds(4, 'FLIES'), 'a duty nobody defined was granted');
    assert(!Cmd.holds(null, 'STANDS') && !Cmd.holds(undefined, 'STANDS'),
      'nothing at all holds a licence');

    /* A RECORD, A BODY WEARING IT, AND A CORPSE. */
    const t = new Cmd.Trooper(Cmd.ARMIES.republic, 'trooper', 'CT-0001');
    t.award(Cmd.RANKS[2].xp);
    assert(Cmd.holds(t, 'LEADS'), 'a Sergeant does not hold LEADS');
    assert(!Cmd.holds(t, 'CREWS'), 'a Sergeant holds a Captain\'s licence');
    const body = { trooper: t, dead: false };
    assert(Cmd.holds(body, 'LEADS'), 'a body wearing a Sergeant does not hold LEADS');
    t.alive = false;
    assert(!Cmd.holds(t, 'LEADS') && !Cmd.holds(body, 'LEADS'),
      'a dead man still holds his licence — the whole vacancy rests on him not doing');
    return `${D.length} cumulative duties, ${D.join(' → ')}; a corpse holds none`;
  });

  check('licence: LEADS — the post the player names outranks the rule, and only above the rung', () => {
    /**
     * `leaderOf` derives a squad's leader from rank and then experience, which
     * is a good rule and is nobody's decision. The post is the player making
     * one: THIS man has the squad. It has to beat the derivation — or the
     * control is decoration — and it has to be gated on the rung, or "give him
     * the squad" is a thing you do to a man on his first morning.
     */
    const { d, c } = army();
    const squads = d.squadsOf(c);
    assert(squads.length >= 2, `the deployed army made ${squads.length} squads`);
    const sq = squads[0];
    const junior = sq[sq.length - 1];
    const senior = sq[0];
    senior.award(Cmd.RANKS[3].xp);          // Captain, and the rule's answer
    junior.award(Cmd.RANKS[2].xp);          // Sergeant, and the player's
    assert(d.leaderOf(sq) === senior, 'the derivation did not pick the highest rank');

    const ok = c.roster.appoint(junior, true);
    assert(ok.ok, `appointing a Sergeant was refused: ${ok.reason}`);
    assert(d.leaderOf(sq) === junior,
      'the man the player named is not leading — the post is decoration');

    /* THE RUNG IS A GATE, AND THE REFUSAL SAYS WHICH RUNG. */
    const bad = c.roster.appoint(sq[1], true);
    assert(!bad.ok, 'a trooper was given a squad\'s post');
    assert(/sergeant/i.test(bad.reason || ''),
      `the refusal does not name the rung that would do it: "${bad.reason}"`);
    assert(!sq[1].post, 'a refused appointment wrote the post anyway');

    /* ONE SEAT PER SQUAD. Two men holding it is `leaderOf` answering with
     * whichever came first in an array whose order is nobody's decision. */
    senior.post = true;                     // by hand, as a saved roll could
    const moved = c.roster.appoint(junior, true);
    assert(!senior.post, 'two men in one squad hold the post');
    assert(moved.was === senior, 'the appointment did not report who it took the seat off');

    /* AND TAKING IT BACK GIVES THE RULE ITS ANSWER AGAIN. */
    c.roster.appoint(junior, false);
    assert(!junior.post && d.leaderOf(sq) === senior,
      'taking the post back did not return the squad to the derivation');
    return 'a named Sergeant outranks a derived Captain; a trooper is refused by name; '
      + 'one seat per squad; giving it back restores the rule';
  });

  check('licence: HOLDS — the ground is given up when nobody left in the squad may keep it', () => {
    /**
     * ── THE VACANCY, AND THE SENTENCE THAT COSTS SOMETHING TO READ ────────
     *
     * A casualty line already said a man was down and who had the squad now.
     * Both are sentences about people and neither is one the player can act
     * on. This is the third: the squad was standing on ground of its own, the
     * man licensed to keep it is gone, and the position is given up — on this
     * frame, in the log, and out loud.
     *
     * Driven end to end through the real `order` and the real `onDeath`, not
     * by calling `_vacancy`: what is being asserted is that the wiring exists.
     */
    const { d, c } = army();
    const sq = d.squadsOf(c)[0];
    for (const t of sq) if (t.body) t.body.position.set(-60, 0, 0);
    /* A licensed leader, and nobody under him who is. `deploy` raises rung-0
     * troopers, so the rest of the squad is already unlicensed. */
    const lead = sq[0];
    lead.award(Cmd.RANKS[2].xp);
    assert(d.leaderOf(sq) === lead, 'the fixture did not put the licensed man in charge');
    d.order('cover', c, 0);
    assert(c.squadPlanted?.has('0'), 'the squad was never given ground to lose');

    d.world.notes.length = 0;
    d.onDeath(lead.body, null);
    assert(!c.squadPlanted?.has('0'),
      'the man who could keep the ground is dead and the squad is still holding it — '
      + 'the licence buys nothing');
    const said = d.world.notes.map(([a, b]) => `${a} ${b}`).join(' | ');
    assert(/GROUND IS GIVEN UP/.test(said), `nothing was said about the ground: ${said}`);
    assert(d.log.some((e) => e.t === 'ground-lost'), 'the ledger does not record the loss');

    /* …AND IT IS KEPT WHEN SOMEBODY LEFT IS LICENSED, which is the half that
     * makes the first half mean anything. */
    const { d: d2, c: c2 } = army();
    const sq2 = d2.squadsOf(c2)[0];
    for (const t of sq2) if (t.body) t.body.position.set(-60, 0, 0);
    sq2[0].award(Cmd.RANKS[2].xp);
    sq2[1].award(Cmd.RANKS[1].xp);          // a Veteran, who HOLDS
    d2.order('cover', c2, 0);
    d2.world.notes.length = 0;
    d2.onDeath(sq2[0].body, null);
    assert(c2.squadPlanted?.has('0'),
      'the ground was given up with a licensed man still standing in the squad');
    assert(!/GROUND IS GIVEN UP/.test(d2.world.notes.map(([a]) => a).join()),
      'the vacancy was announced for a capability that did not leave');
    return 'the position is dropped and announced with nobody licensed left; kept in silence '
      + 'with a Veteran still up';
  });

  check('licence: CREWS — one licensed man is a crew, and nobody else is', () => {
    /**
     * `DIG_CREW` men have to be standing on the position before earth moves.
     * That is the right rule for a line of troopers and is exactly the rule a
     * Captain who has done this in four campaigns should be allowed to break.
     *
     * ADDITIVE, and the third arm is what proves it: an unlicensed crew of
     * three still digs exactly as it did, so nothing that could be dug before
     * costs more now.
     */
    const { d, c } = army();
    const sq = d.squadsOf(c)[1];
    const lone = sq[0];
    lone.award(Cmd.RANKS[3].xp);
    assert(Cmd.holds(lone, 'CREWS'), 'the fixture did not license the man under test');
    for (const t of sq) if (t.body) t.body.position.set(-140, 0, 0);
    d.order('digin', c, 1);
    d._digTick(1, c, 1, sq);                       // the first tick fixes the anchor
    const rec = c.digs?.get('1');
    assert(rec, 'the squad was never given a position to dig');
    /* Everybody off it but the one man. */
    for (const t of sq) if (t.body) t.body.position.set(rec.x + 400, 0, rec.z + 400);
    lone.body.position.set(rec.x, 0, rec.z);
    assert(d._digTick(1, c, 1, sq), 'a licensed man alone on the position is not digging');

    lone.xp = 0;
    assert(!Cmd.holds(lone, 'CREWS'), 'the fixture failed to take the licence back');
    assert(!d._digTick(1, c, 1, sq),
      'one unlicensed man on the position is digging — the quorum is not a quorum');

    /* AND THE ORDINARY CREW IS UNTOUCHED. */
    for (let i = 1; i < Math.max(2, Cmd.DIG_CREW ?? 3); i++) {
      if (sq[i]?.body) sq[i].body.position.set(rec.x, 0, rec.z);
    }
    assert(d._digTick(1, c, 1, sq),
      'a full crew of unlicensed men cannot dig — the licence took something away');
    return 'a lone Captain digs; a lone trooper does not; a crew of troopers still does';
  });

  check('licence: RELAYS — the one voice that crosses a squad boundary, and its silence', () => {
    /**
     * `LEADER_NEAR` stops at the squad. The top rung's licence is "carries an
     * order onward to men you cannot reach", so a Commander steadies anybody
     * in the army standing near him — and when he is gone, every squad he was
     * standing among loses it on the same frame.
     *
     * MEASURED ON `_morale` ITSELF, with the Jedi and the subject's own leader
     * moved out of reach, so the only channel that can move the number is the
     * one under test.
     */
    const { d, c, me } = army();
    const squads = d.squadsOf(c);
    const voice = squads[1][0];
    voice.award(Cmd.RANKS[4].xp);
    assert(Cmd.holds(voice, 'RELAYS'), 'the fixture did not license the voice');
    const subject = squads[0].find((t) => t.alive && t !== voice);
    const FAR = 9000;

    me.position.set(FAR, 0, FAR);
    const sample = (voiceNear) => {
      for (const t of [...squads[0], ...squads[1]]) if (t.body) t.body.position.set(FAR, 0, FAR);
      subject.body.position.set(300, 0, 300);
      voice.body.position.set(voiceNear ? 300 : FAR, 0, voiceNear ? 300 : FAR);
      subject.morale = 0.5;
      d._morale(1, c);
      return subject.morale;
    };
    const alone = sample(false);
    const near = sample(true);
    assert(near > alone + 1e-6,
      `a man beside a Commander from another squad drifted to ${near.toFixed(4)} and a man `
      + `alone to ${alone.toFixed(4)} — the licence is not read`);
    assert(near - alone >= MORALE.RELAY_NEAR * 0.5,
      `the voice moved morale by ${(near - alone).toFixed(4)} against a term of `
      + `${MORALE.RELAY_NEAR} — it is being swallowed`);

    /* …AND IT DIES WITH HIM. Same geometry, the man killed through the real
     * `onDeath`, and the sentence said once. */
    /* HIS BODY, HELD: `fall` cuts `trooper.body`, so the reference has to be
     * taken before the death or the second sample has nothing to place. */
    const corpse = voice.body;
    corpse.position.set(300, 0, 300);
    d.world.notes.length = 0;
    d.onDeath(corpse, null);
    const after = (() => {
      for (const t of [...squads[0], ...squads[1]]) if (t.body) t.body.position.set(FAR, 0, FAR);
      subject.body.position.set(300, 0, 300);
      corpse.position.set(300, 0, 300);
      subject.morale = 0.5;
      d._morale(1, c);
      return subject.morale;
    })();
    assert(Math.abs(after - alone) < 1e-6,
      `the voice is dead and a man standing where he stood still drifted to ${after.toFixed(4)} `
      + `against ${alone.toFixed(4)}`);
    assert(d.world.notes.some(([a]) => /VOICE IS GONE/.test(a)),
      `nothing was said when the last relay fell: ${d.world.notes.map(([a]) => a).join(' | ')}`);
    return `+${(near - alone).toFixed(4)} morale/s beside a Commander in another squad, `
      + '0 when he is down, and the loss is announced';
  });

  check('licence: the vacancy is silent for an ordinary death', () => {
    /**
     * THE HALF THAT KEEPS THE OTHER HALF WORTH READING. A notification that
     * fires on every casualty is a notification the player learns to look
     * away from, and then the one that mattered goes past unread.
     */
    const { d, c } = army();
    const sq = d.squadsOf(c)[0];
    const nobody = sq[sq.length - 1];
    assert(d.leaderOf(sq) !== nobody, 'the fixture picked the man in charge');
    assert(!nobody.post && nobody.rank === 0, 'the fixture picked a man who holds something');
    d.world.notes.length = 0;
    d.onDeath(nobody.body, null);
    const said = d.world.notes.map(([a]) => a);
    for (const line of ['GROUND IS GIVEN UP', 'HELD THE POST', 'VOICE IS GONE']) {
      assert(!said.some((a) => a.includes(line)),
        `a rung-0 trooper's death announced "${line}"`);
    }
    assert(said.some((a) => /DOWN/.test(a)), `the death itself went unreported: ${said.join('|')}`);
    for (const t of ['ground-lost', 'post-lost', 'voice-lost']) {
      assert(!d.log.some((e) => e.t === t), `an ordinary death logged ${t}`);
    }
    return `${said.length} line(s) for an ordinary casualty, none of them a vacancy`;
  });

  check('licence: the seat survives the store, and comes back only if he may still hold it',
    () => withCleanStore(() => {
      /**
       * A company that forgets who had the squad between one press of play and
       * the next is a company you re-appoint every time. So the post persists
       * — and it is RE-TESTED against the licence on the way back onto a roll,
       * because the store is a JSON blob in the player's own browser and a
       * hand-edited one must not be able to put a fresh trooper in charge of a
       * squad. The store deliberately does not know what a rank is; the roster
       * does. This is the proof that the split holds.
       */
      const r = new Cmd.CommandRoster(Cmd.ARMIES.republic);
      for (let i = 0; i < 6; i++) r.enlist('trooper');
      r.all[0].award(Cmd.RANKS[2].xp);
      r.all[0].post = true;
      Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });
      const seated = r.all[0].designation;
      const plain = r.all[1].designation;

      const stored = Company.load('republic');
      assert(stored.men.find((m) => m.designation === seated)?.post === true,
        'the seat did not reach the store');
      assert(stored.men.find((m) => m.designation === plain)?.post !== true,
        'a man who was never appointed came back holding a post');

      /* BACK ONTO A ROLL, through the door a saved man actually takes. */
      const back = new Cmd.CommandRoster(Cmd.ARMIES.republic);
      for (const m of stored.men) back.enlistRecord(m);
      assert(back.all.find((t) => t.designation === seated)?.post === true,
        'a Sergeant who held the seat came back without it');

      /* AND A HAND-EDITED STORE CANNOT SEAT A TROOPER. */
      const forged = Company.load('republic');
      const him = forged.men.find((m) => m.designation === plain);
      him.post = true;
      him.squad = 5;                       // his own squad, so nothing is displaced
      Company.save(forged);
      const back2 = new Cmd.CommandRoster(Cmd.ARMIES.republic);
      for (const m of Company.load('republic').men) back2.enlistRecord(m);
      assert(back2.all.find((t) => t.designation === plain)?.post !== true,
        'a rung-0 trooper walked onto a roll holding a squad\'s post because a saved '
        + 'file said so');

      /* …AND THE SCREEN'S OWN DOOR REFUSES HIM TOO, with the licence decided
       * where the rank table is. The forged seat is cleared first, through the
       * same door, so what is measured is the WRITE being refused rather than
       * the forgery still sitting there. */
      Company.appoint('republic', plain, false);
      assert(Company.load('republic').men.find((m) => m.designation === plain)?.post !== true,
        'taking a post back left it written');
      Company.appoint('republic', plain, true, false);
      assert(Company.load('republic').men.find((m) => m.designation === plain)?.post !== true,
        'Company.appoint wrote a post for a man the caller said was unlicensed');
      Company.appoint('republic', plain, true, true);
      assert(Company.load('republic').men.find((m) => m.designation === plain)?.post === true,
        'Company.appoint refused a man the caller said was licensed — the gate is in the '
        + 'wrong file');
      return 'the seat round-trips for a Sergeant; a forged one is dropped at the roll and '
        + 'refused at the tab';
    }));
}
