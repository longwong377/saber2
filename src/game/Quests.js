/**
 * ══════════════════════════════════════════════════════════════════════════
 *  WORK — V16 Lane C3, and the rule the player stated is the whole design
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"you can talk to npcs there so maybe give you certain quests (very long
 * list of potential ones and totally random and not always there and the npcs
 * aren't always in the same place either so it's a chance thing) … maybe the
 * npcs give you certain quests like kill X number of X or make sure that a
 * specific trooper survives a run and returned home … when you complete a
 * certain quest it is recorded and you go back to that npc who will be there
 * since you compelted the quest."*
 *
 * ── THE GIVER IS A CHANCE ENCOUNTER; THE PAYER IS GUARANTEED ──────────────
 *
 * That sentence matters more than any of the quests. Everyone on the station
 * rerolls — *"the same shop owner doesnt always look the same"* — but the
 * moment you TAKE a job, that person is pinned to the station until you come
 * back for the money. Nothing else in the game makes a stranger persist, and
 * it is the cheapest possible way to make one matter.
 *
 * Three things never reroll: your home, your companion, and anyone who owes
 * you money.
 *
 * ── AND EVERY JOB IS A NUMBER THE GAME ALREADY COUNTS ─────────────────────
 *
 * No new telemetry. A quest that needed a new counter would be a second
 * scoring system beside the real one, and the first thing to disagree with it.
 * Every shape below reads something a run already reports:
 *
 *   A NUMBER    kill N of a type, in one run
 *   A NAME      bring a specific man home alive — `Company.js` keeps the roll
 *   A PLACE     reach an area, or hold one
 *   A MANNER    without the Force; nothing comes off him; no man lost
 *   A HAND      pull one of yours off the floor
 *   A MERCY     do not kill a particular kind, all run
 *
 * ── AND THAT SENTENCE WAS NOT TRUE WHEN IT WAS WRITTEN ───────────────────
 *
 * A hostile pass drove the six against `World.runStats` — the object every
 * ending actually hands out — and four of the six were reading fields that do
 * not exist on it. `run.bolts` is the worst of them: the PLAYER cannot fire a
 * bolt in this game at all (`bolts.fire` has two callers, `Enemy.js` and the
 * net's replication), so *"with the blade and nothing else"* was already
 * satisfied before you deployed, and a run that quit at four seconds finished
 * the job. `run.forceCasts`, `run.killedKinds` and `run.recovered` were the
 * same defect facing the other way: absent, read as 0 or `[]`, so a mercy was
 * kept by a run that killed three hundred of them and a recovery could never
 * be made at all.
 *
 * So the rule is now ENFORCED rather than asserted, in two places:
 *
 *   `needs`   every shape names the fields THIS JOB judges on — a function of
 *             the rolled job, because a manner asks about limbs or the Force or
 *             the roll and not about all three — and `settleRun` LEAVES A JOB
 *             OPEN when the run did not report one of them. A missing field is
 *             not a zero; that is §2.3's "a missing thing answered with a
 *             plausible default", which is exactly how four of these shipped.
 *   THE TWO   `forceCasts` and `killedKinds` are counted at the one door each
 *             already has (`Player._spend`, `World.onEnemyKilled`) and reported
 *             by `runStats` beside `kills`; `limbs`, `saves` and `fallen` were
 *             already there and nothing had asked them a question. The manner
 *             that read a gun the player has not got is now "nothing comes off
 *             him", and the recovery is a MAN off the floor rather than a case
 *             nothing in any run has ever dropped.
 *
 * ── WHAT THEY PAY ─────────────────────────────────────────────────────────
 *
 * Credits and KEEPSAKES. Never a stat, never a facet, never a card — see the
 * amendment at the top of `Progress.js`. A job is a reason to go somewhere and
 * a reason to come back, and it is not a second Holocron.
 */

import { makeRng } from '../engine/MathUtil.js';
import { makeStore } from './Store.js';

const KEY = 'saber.work.v1';
const store = makeStore(KEY);

/** How many jobs may be open at once. A board, not a backlog. */
export const OPEN_MAX = 3;

/**
 * ══ THE SHAPES ════════════════════════════════════════════════════════════
 *
 * `test(run, job)` is handed the run's own summary — the same object
 * `recordRun` is written from — and answers whether the job is done. Pure, so
 * a check can drive a hundred of them without a world.
 *
 * `pay` is a base; the roll below scales it by how hard the job asked.
 */
export const SHAPES = [
  {
    id: 'number', name: 'a number', needs: () => ['kills'],
    /* KILL N OF A KIND, in one run. The plainest job there is and the one a
     * player can tell they are making progress on without a tracker. */
    roll: (rng, ctx) => {
      const n = 30 + Math.floor(rng() * 90);
      return { n, word: `${n} of them`, pay: 60 + n * 2 };
    },
    test: (run, job) => (run.kills | 0) >= job.n,
    line: (job) => `Kill ${job.n} of them and come back.`,
  },
  {
    id: 'depth', name: 'a place', needs: () => ['depth'],
    roll: (rng) => {
      const n = 6 + Math.floor(rng() * 14);
      return { n, word: `area ${n}`, pay: 90 + n * 22 };
    },
    test: (run, job) => (run.depth | 0) >= job.n,
    line: (job) => `Get as far as area ${job.n}. I do not care how.`,
  },
  {
    id: 'name', name: 'a name', needs: () => ['home'],
    /* BRING A MAN HOME. `Company.js` already keeps who went out and who came
     * back; this is the first thing that ever asked it a question.
     *
     * NULL WHEN THERE IS NOBODY TO NAME, and `offersAt` drops a null roll
     * rather than offering it. The old body answered `{ who: null }` and the
     * test read `!job.who ||` as "done" — so a player with no roll was handed
     * a 340-credit job that was already finished, by the giver, before they
     * left the room. */
    roll: (rng, ctx) => {
      const men = ctx?.men || [];
      if (!men.length) return null;
      const who = men[Math.floor(rng() * men.length)];
      if (!who?.id) return null;
      return { who: who.id, name: who.name || 'him', pay: 340 };
    },
    test: (run, job) => (run.home || []).includes(job.who),
    line: (job) => `${job.name} goes out with you. ${job.name} comes back. That is the job.`,
  },
  {
    id: 'clean', name: 'a manner',
    /* PER JOB AND NOT PER SHAPE, which is the whole reason `needs` is a
     * function: this one asks a different question in each of its three
     * manners, and `lost` is null in every mode with no army. A "leave them in
     * one piece" job held open in the waves because the run could not say
     * whether anybody was lost would be the missing-field rule turned into a
     * second way to strand a job. */
    needs: (job) => [{ whole: 'limbs', noforce: 'forceCasts', nolost: 'lost' }[job.how] || 'limbs'],
    /* THREE MANNERS, AND EACH IS A COUNTER SOMETHING ELSE ALREADY KEEPS.
     * `whole` was `blade` — `run.bolts === 0`, a gun the player does not have
     * and therefore a job that was done before it was taken. `limbsRemoved` is
     * the honest version of the same sentence: you may kill them, and you may
     * not take them apart. */
    roll: (rng) => {
      const how = ['whole', 'noforce', 'nolost'][Math.floor(rng() * 3)];
      const word = {
        whole: 'and leave them in one piece',
        noforce: 'without touching the Force',
        nolost: 'and lose nobody',
      }[how];
      return { how, word, pay: 420 };
    },
    test: (run, job) => (job.how === 'whole' ? (run.limbs | 0) === 0
      : job.how === 'noforce' ? (run.forceCasts | 0) === 0
        : (run.lost | 0) === 0),
    line: (job) => `Do it ${job.word}. I will know.`,
  },
  {
    id: 'mercy', name: 'a mercy', needs: () => ['killedKinds'],
    /* THE ONE THAT IS NOT ABOUT KILLING. A player who has only ever been asked
     * for numbers has not been asked for anything. */
    roll: (rng, ctx) => {
      const kinds = ctx?.kinds?.length ? ctx.kinds : ['b1', 'trooper', 'droideka'];
      const kind = kinds[Math.floor(rng() * kinds.length)];
      return { kind, word: kind, pay: 380 };
    },
    test: (run, job) => !((run.killedKinds || {})[job.kind] > 0),
    line: (job) => `There will be ${job.word} down there. Leave them be. All of them.`,
  },
  {
    id: 'hand', name: 'a hand', needs: () => ['saves'],
    /**
     * AND THE OTHER ONE THAT IS NOT ABOUT KILLING — a man off the floor.
     *
     * This was `thing`: *"something of mine went down there, bring it up"*,
     * tested on `run.recovered`. Nothing in any run has ever put anything in
     * that field — there is no recovery in this game and no ending reports one
     * — so it was a job that could be taken and could not be finished, which
     * is the whole defect this pass is here for. What a run DOES report, and
     * has since the economy landed, is `saves`: `Player.saves`, one per man
     * pulled out of a ragdoll, summed over the players by `runStats` and priced
     * at 14 credits by `Credits.EARN`. It is the same sentence about the same
     * kind of act, and it is true.
     */
    roll: (rng) => {
      const n = 1 + Math.floor(rng() * 3);
      const who = ['a runner of mine', 'my brother', 'a man who owes me', 'one of the crew'][Math.floor(rng() * 4)];
      return { n, who, word: `${n} off the floor`, pay: 220 + n * 80 };
    },
    test: (run, job) => (run.saves | 0) >= job.n,
    line: (job) => `${job.who[0].toUpperCase()}${job.who.slice(1)} is down there. `
      + `Get ${job.n > 1 ? `${job.n} of them` : 'him'} back on ${job.n > 1 ? 'their' : 'his'} feet.`,
  },
];
const SHAPE_BY = new Map(SHAPES.map((s) => [s.id, s]));

/* ══════════════════════════════════════════════════════════════════════════
 *  THE BOARD — who is offering what today
 * ══════════════════════════════════════════════════════════════════════════ */

/** A stable 32-bit hash. Same idiom `Counter.js` uses, and for the same reason. */
function hashOf(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return (h >>> 0) || 1;
}

/**
 * What is on offer at a place today.
 *
 * Seeded from `(place, day)` exactly as a shelf is, so two players in one bar
 * see one stranger with one job, and tomorrow he is not there. A giver who
 * rerolled per look would be a slot machine with a face.
 */
export function offersAt(placeId, day = 0, ctx = null) {
  const rng = makeRng(hashOf(`work:${placeId}:${day | 0}`));
  /* NOT ALWAYS THERE. Two rooms in three have somebody in them with something
   * to ask, and the third is just a bar. */
  if (rng() > 0.62) return [];
  const n = 1 + (rng() > 0.78 ? 1 : 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    const shape = SHAPES[Math.floor(rng() * SHAPES.length)];
    const rolled = shape.roll(rng, ctx);
    /**
     * A ROLL THAT ANSWERS NULL IS A JOB THIS ROOM CANNOT ASK FOR TODAY, and it
     * is DROPPED rather than offered with a hole in it.
     *
     * `name` is the only shape that does it and the reason is the whole point:
     * it names a man off your own roll, and a player who has not got a roll
     * cannot be asked to bring one of them home. It used to answer `{ who:
     * null }` and its test read a null `who` as satisfied — 340 credits for a
     * job that was finished, by the giver, before the player left the room.
     *
     * The draw above has already happened, so the stream is unmoved: the same
     * day at the same place deals the same other jobs whether or not this one
     * could be asked.
     */
    if (!rolled) continue;
    const seed = hashOf(`giver:${placeId}:${day | 0}:${i}`);
    out.push({
      id: `${placeId}-${day | 0}-${i}`,
      shape: shape.id,
      place: placeId,
      /* THE GIVER IS A SEED, so `StationCast.resident(seed)` builds the body
       * and nothing here knows what a face is. */
      giver: seed,
      line: shape.line(rolled),
      ...rolled,
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  THE LEDGER — what you took, what you finished, who still owes you
 * ══════════════════════════════════════════════════════════════════════════ */

function blank() { return { v: 1, open: [], done: [] }; }
let _cache = null;
function read() {
  if (_cache) return _cache;
  const v = store.read();
  _cache = { ...blank(), ...(v && typeof v === 'object' ? v : {}) };
  if (!Array.isArray(_cache.open)) _cache.open = [];
  if (!Array.isArray(_cache.done)) _cache.done = [];
  /* Clamped on the way in. A job whose shape no longer exists is dropped
   * rather than left to throw the first time somebody reads its `test`. */
  _cache.open = _cache.open.filter((j) => j && SHAPE_BY.has(j.shape)).slice(0, OPEN_MAX);
  _cache.done = _cache.done.filter((j) => j && SHAPE_BY.has(j.shape)).slice(0, 24);
  return _cache;
}
function write(v) { _cache = v; store.write(v); return v; }

/** The jobs you are carrying. */
export function openJobs() { return read().open.slice(); }
/** The jobs you have finished and not yet been paid for. */
export function owedJobs() { return read().done.filter((j) => !j.paid); }

/** Take one. Refuses past `OPEN_MAX`, and refuses the same job twice. */
export function takeJob(job) {
  if (!job || !SHAPE_BY.has(job.shape)) return { ok: false, why: 'that is not a job' };
  const s = read();
  if (s.open.length >= OPEN_MAX) return { ok: false, why: `you are already carrying ${OPEN_MAX}` };
  if (s.open.some((j) => j.id === job.id)) return { ok: false, why: 'you already took that one' };
  s.open.push({ ...job, taken: true, paid: false });
  write(s);
  return { ok: true, why: null, carrying: s.open.length };
}

/**
 * A run ended. Which of the open jobs did it finish?
 *
 * Handed the run's own summary — the same object `recordRun` is written from —
 * so a job cannot be finished by anything the record does not also say
 * happened.
 */
export function settleRun(run = {}) {
  const s = read();
  const finished = [];
  s.open = s.open.filter((j) => {
    const shape = SHAPE_BY.get(j.shape);
    if (!shape) return true;
    /**
     * ── A FIELD THE RUN DID NOT REPORT IS NOT A ZERO ────────────────────
     *
     * `judged` is the guard, and it is here because four of the six shapes
     * shipped reading fields no ending has ever sent: `(run.bolts | 0) === 0`
     * and `!((run.killedKinds || {})[kind] > 0)` are both TRUE against an
     * empty object, so a mercy and a manner were kept by a run that did the
     * opposite of what was asked, and `(run.recovered || []).length > 0` was
     * false for ever. The shapes are mended above and the fields are reported
     * now; this is what stops the next one being wrong in silence.
     *
     * IT LEAVES THE JOB OPEN rather than failing it. A run that could not be
     * judged is not a run that was failed — you may take the same job out
     * again — and `dropJob` is there for the day a job is one this player's
     * mode will never report.
     */
    const judged = shape.needs(j).every((f) => run[f] !== undefined && run[f] !== null);
    if (!judged || !shape.test(run, j)) return true;
    s.done.push({ ...j, paid: false });
    finished.push(j);
    return false;
  });
  if (s.done.length > 24) s.done = s.done.slice(-24);
  write(s);
  return finished;
}

/**
 * ══ AND YOU MAY PUT ONE DOWN ══════════════════════════════════════════════
 *
 * `OPEN_MAX` is three and there was no way to be rid of one, so three jobs a
 * player could not finish — a mercy in a mode that never fields that kind, a
 * man on a roll that has since been wiped — answered every board in the
 * gazetteer with "you are already carrying 3" for the rest of the save.
 * Measured on the shipped build: take one, play a run, walk back, "carrying 1,
 * owed 0" for ever.
 *
 * A BOARD THAT CAN PERMANENTLY BRICK IS WORSE THAN ONE THAT FORGETS, and the
 * player's own words do not forbid dropping one: the sentence is about what
 * happens when you COMPLETE a job. Nothing is owed for it, nothing is
 * remembered about it, and the giver stops being pinned the moment you hand it
 * back — they are pinned by a debt, and there is no longer one.
 *
 * IT CANNOT DROP A FINISHED JOB. `done` is money somebody owes you; a control
 * that could throw that away would be a button that deletes credits.
 */
export function dropJob(jobId) {
  const s = read();
  const i = s.open.findIndex((j) => j.id === jobId);
  if (i < 0) return { ok: false, why: 'you are not carrying that one', carrying: s.open.length };
  const [j] = s.open.splice(i, 1);
  write(s);
  return { ok: true, why: null, carrying: s.open.length, job: j };
}

/**
 * Collect. THIS is why the giver is pinned: a job you finished is money
 * somebody owes you, and they are on the station until you take it.
 */
export function collect(jobId) {
  const s = read();
  const j = s.done.find((d) => d.id === jobId && !d.paid);
  if (!j) return { ok: false, why: 'nobody here owes you anything', pay: 0 };
  j.paid = true;
  write(s);
  return { ok: true, why: null, pay: Math.max(1, Math.round(j.pay || 100)), job: j };
}

/**
 * Is this giver pinned to the station? True while they owe you money.
 *
 * THE WHOLE STATION'S ANSWER, and `pinnedAt` below is the same fact asked one
 * room at a time — which is the question the census actually has, because it
 * is drawing slot `i` of one place. This comment used to say `StationLife`'s
 * census asked THIS one, and nothing anywhere called either: the giver rerolled
 * with everybody else the next morning and the money was owed to a room rather
 * than to a man. One body under both, so the two can never disagree about who
 * is standing there.
 */
export function pinnedGivers() {
  const s = read();
  return new Set(pinned(s).map((j) => j.giver));
}

/** The open jobs and the unpaid finished ones — everybody who is pinned. */
function pinned(s) { return [...s.open, ...s.done.filter((j) => !j.paid)]; }

/**
 * THE GIVERS WHO MUST BE STANDING IN THIS ROOM, in a stable order.
 *
 * `StationLife.occupant` calls this before it draws a stranger for a slot, and
 * it is the whole of the player's *"you go back to that npc who will be there
 * since you compelted the quest."* The census rerolls every resident every day
 * — `p{id}s{i}d{day}` — and this is the one exemption: a person who owes you
 * money, or who is waiting on a job you took, does not reroll.
 *
 * SEEDS AND NOT BODIES. `StationCast.resident(seed)` builds the face from the
 * number, exactly as `Notices.js` already does to print who is offering what,
 * so this file still does not know what a face is.
 *
 * ONE PER JOB AND DEDUPLICATED: two jobs from one giver is one person standing
 * there, not twins.
 */
export function pinnedAt(placeId) {
  const s = read();
  const out = [];
  const seen = new Set();
  for (const j of pinned(s)) {
    if (j.place !== placeId || seen.has(j.giver)) continue;
    seen.add(j.giver);
    out.push(j.giver);
  }
  return out;
}

/** Start again. Only a check calls this. */
export function clearWork() { store.drop(); _cache = null; return read(); }
