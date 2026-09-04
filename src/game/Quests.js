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
 *   A MANNER    with the blade only; without the Force; no man lost
 *   A THING     recover something — which is the only reason `#25 Lost &
 *               found` has to exist
 *   A MERCY     do not kill a particular kind, all run
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
    id: 'number', name: 'a number',
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
    id: 'depth', name: 'a place',
    roll: (rng) => {
      const n = 6 + Math.floor(rng() * 14);
      return { n, word: `area ${n}`, pay: 90 + n * 22 };
    },
    test: (run, job) => (run.depth | 0) >= job.n,
    line: (job) => `Get as far as area ${job.n}. I do not care how.`,
  },
  {
    id: 'name', name: 'a name',
    /* BRING A MAN HOME. `Company.js` already keeps who went out and who came
     * back; this is the first thing that ever asked it a question. */
    roll: (rng, ctx) => {
      const men = ctx?.men || [];
      const who = men.length ? men[Math.floor(rng() * men.length)] : null;
      return { who: who?.id || null, name: who?.name || 'him', pay: 340 };
    },
    test: (run, job) => !job.who || (run.home || []).includes(job.who),
    line: (job) => `${job.name} goes out with you. ${job.name} comes back. That is the job.`,
  },
  {
    id: 'clean', name: 'a manner',
    roll: (rng) => {
      const how = ['blade', 'noforce', 'nolost'][Math.floor(rng() * 3)];
      const word = { blade: 'with the blade and nothing else', noforce: 'without touching the Force', nolost: 'and lose nobody' }[how];
      return { how, word, pay: 420 };
    },
    test: (run, job) => (job.how === 'blade' ? (run.bolts | 0) === 0
      : job.how === 'noforce' ? (run.forceCasts | 0) === 0
        : (run.lost | 0) === 0),
    line: (job) => `Do it ${job.word}. I will know.`,
  },
  {
    id: 'mercy', name: 'a mercy',
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
    id: 'thing', name: 'a thing',
    /* AND THE ONLY REASON `#25 Lost & found` HAS TO EXIST. */
    roll: (rng) => {
      const what = ['a case', 'a sealed tube', 'a data spike', 'a name-plate'][Math.floor(rng() * 4)];
      return { what, word: what, pay: 300 };
    },
    test: (run, job) => (run.recovered || []).length > 0,
    line: (job) => `Something of mine went down there. ${job.what[0].toUpperCase()}${job.what.slice(1)}. Bring it up.`,
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
    if (!shape?.test(run, j)) return true;
    s.done.push({ ...j, paid: false });
    finished.push(j);
    return false;
  });
  if (s.done.length > 24) s.done = s.done.slice(-24);
  write(s);
  return finished;
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
 * `StationLife`'s census asks this before it rerolls a body, which is the
 * whole of the player's *"who will be there since you compelted the quest"*.
 */
export function pinnedGivers() {
  const s = read();
  return new Set([...s.open, ...s.done.filter((j) => !j.paid)].map((j) => j.giver));
}

/** Start again. Only a check calls this. */
export function clearWork() { store.drop(); _cache = null; return read(); }
