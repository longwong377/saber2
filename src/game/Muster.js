/**
 * BATTLEFRONT BORZ — THE MUSTER SLATE: the men you have not met yet.
 *
 * "when you go into the troop tab you should see the troops that you're going
 *  to spawn with in your next game, isn't that the entire point of the troop
 *  tab?" — and the fresh half of every muster used to be a sentence: "6 fresh,
 *  drawn at the muster". Six men with no names, no faces and nothing to do
 *  with them until they had survived a run — which for most runs is never.
 *
 * This file gives the next muster its names IN ADVANCE. The slate is the fresh
 * half of the next deployment, minted deterministically, per army: real
 * designations in the army's own grammar, standing on the tab's parade ground,
 * open to a callsign, a mark, a band and a squad before they have fired a
 * shot. At deploy they ride the SAME veterans pipe a saved company rides
 * (`veteransToField` → `World {veterans}` → `enlistRecord`), fight under the
 * name the player gave them, and either walk off the ground onto the company
 * roll or into its casualty list — wearing that name either way.
 *
 * WHAT IS DELIBERATELY NOT HERE, because each absence closes a door:
 *
 *   NO ATTRIBUTES. A recruit's numbers do not exist yet. They are rolled the
 *   day he musters, by the Trooper constructor's hash of (run seed, army,
 *   type, designation) — the run seed is minted at deploy, so there is nothing
 *   to scout, nothing to reroll, and nothing in this store a hand-edit could
 *   improve. The recruit's page says exactly this. A slate that showed the
 *   numbers would be a reroll button with extra steps: deploy, glance, quit.
 *
 *   NO ENTROPY. The salt is a hash of the company's own state (runs, losses,
 *   headcount), so deleting this store re-mints the SAME men — clearing
 *   localStorage is not a shuffle — and every banked run moves the company and
 *   therefore the slate. The only way to meet new men is to spend a run.
 *
 *   NO TYPES TO CHOOSE. An army mode's opening is rung-0 identical strangers
 *   by design (Command.js argues it where it decides it); the slate mints the
 *   cheapest rung and composition stays the between-areas muster's job.
 *
 * ONE RESOLVER. `lineup()` is the whole answer to "who deploys next run":
 * veterans first in `fieldable` order, the slate's recruits behind them, the
 * player's picks honoured, never more than the plan wants. The Company tab
 * renders it and `veteransToField` fields it, so the page and the ground can
 * no longer disagree — which is the defect the tab was rebuilt to kill.
 */

import {
  ARMIES, ARMY_IDS, OPENING_STRENGTH, designateWith, markById, commandConfig,
} from './Command.js';
import * as Company from './Company.js';

/** Where it lives. Versioned like every other store in the tree. */
export const KEY = 'saber.muster.v1';

/**
 * How many recruits one army's slate may hold. `OPENING_STRENGTH` is every
 * army mode's want, so the slate never needs more — and a cap is what keeps a
 * hand-edited store from handing the tab ten thousand rows to render.
 */
export const SLATE_CAP = OPENING_STRENGTH;

/* ── the store ───────────────────────────────────────────────────────── */

function readAll() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return v;
  } catch { return {}; }
}

function writeAll(v) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch { /* private browsing, a full quota — losing a slate is not a crash */ }
}

/** A designation in this army's own grammar, or nothing. */
const DESIGNATION_RE = {
  republic: /^CT-\d{3,6}$/,
  separatist: /^(?:OOM|TC|PK|BX|DFS|OM)-\d{2}$/,
};

/** One stored recruit, made safe. Unreadable rows are dropped, not repaired. */
function readRecruit(r, armyId) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.designation !== 'string') return null;
  const re = DESIGNATION_RE[armyId];
  if (re && !re.test(r.designation)) return null;
  const tiers = ARMIES[armyId]?.tiers || [];
  const type = tiers.some((t) => t.type === r.type) ? r.type : (tiers[0]?.type ?? null);
  if (!type) return null;
  const look = r.look && typeof r.look === 'object' && !Array.isArray(r.look) ? {} : null;
  if (look) {
    const cs = Company.cleanCallsign(r.look.callsign);
    if (cs) look.callsign = cs;
    const mk = markById(r.look.mark);
    if (mk.color != null) look.mark = mk.id;
    const bd = markById(r.look.band);
    if (bd.color != null) look.band = bd.id;
  }
  return {
    designation: r.designation,
    type,
    squad: Number.isInteger(r.squad) && r.squad >= 0 && r.squad <= 4 ? r.squad : null,
    look: look && Object.keys(look).length ? look : null,
  };
}

/** The blank slate: no salt yet, nobody minted, no picks. */
export const blankSlate = (army = ARMY_IDS[0]) => ({
  army, salt: null, recruits: [], picks: null,
});

/** One army's slate off disk, sanitized, without minting anything. */
export function slateFor(army = ARMY_IDS[0]) {
  const id = ARMIES[army] ? army : ARMY_IDS[0];
  const v = readAll()[id];
  if (!v || typeof v !== 'object') return blankSlate(id);
  const recruits = Array.isArray(v.recruits)
    ? v.recruits.map((r) => readRecruit(r, id)).filter(Boolean).slice(0, SLATE_CAP)
    : [];
  /* Duplicate designations in one slate are a hand-edit; first one stands. */
  const seen = new Set();
  const unique = recruits.filter((r) => (seen.has(r.designation) ? false : (seen.add(r.designation), true)));
  return {
    army: id,
    salt: Number.isFinite(v.salt) ? (v.salt >>> 0) : null,
    recruits: unique,
    picks: Array.isArray(v.picks)
      ? v.picks.filter((p) => typeof p === 'string').slice(0, SLATE_CAP * 2)
      : null,
  };
}

function saveSlate(slate) {
  if (!slate || !ARMIES[slate.army]) return slate;
  const all = readAll();
  all[slate.army] = {
    army: slate.army,
    salt: Number.isFinite(slate.salt) ? (slate.salt >>> 0) : null,
    recruits: (slate.recruits || []).slice(0, SLATE_CAP),
    picks: Array.isArray(slate.picks) && slate.picks.length ? slate.picks : null,
  };
  writeAll(all);
  return slate;
}

/* ── determinism ─────────────────────────────────────────────────────── */

/**
 * THE SALT IS THE COMPANY'S OWN STATE, hashed — never a clock, never a random.
 *
 * Three consequences, each load-bearing: the same company always mints the
 * same men, so two reads agree and a determinism check can hold them to it;
 * deleting the store reproduces the slate instead of rerolling it; and every
 * banked run (a withdrawal moves `runs`, a wipe moves `lost`, a rescue moves
 * `men.length`) moves the salt, so the next slate is new names. FNV-1a over
 * the id and three counters, the same arithmetic `designate` uses.
 */
export function saltOf(company) {
  let h = 0x811C9DC5 >>> 0;
  const eat = (v) => { h = Math.imul(h ^ (v + 0x9E3779B1), 0x01000193) >>> 0; };
  const id = String(company?.army ?? '');
  for (let i = 0; i < id.length; i++) eat(id.charCodeAt(i));
  eat(company?.runs | 0);
  eat(company?.lost | 0);
  eat((company?.men?.length | 0) + 17);
  return h >>> 0;
}

/**
 * The designations a slate must not collide with: every living man on the
 * roll and every remembered name on the casualty list. A name evicted off
 * `FALLEN_KEEP`'s forty CAN come round again — accepted, and the same reuse
 * `designate` itself allows once a record is gone; an unbounded ledger of
 * every designation ever issued is exactly the archive the fallen list
 * refuses to be.
 */
function takenOf(company, slate = null) {
  const taken = new Set();
  for (const m of (company?.men || [])) taken.add(m.designation);
  for (const f of (company?.fallen || [])) taken.add(f.designation);
  for (const r of (slate?.recruits || [])) taken.add(r.designation);
  return taken;
}

/**
 * A ONE-LINE CHARACTER, hashed off who he is — the something-to-meet on a page
 * about a man with no history yet. Prose, not numbers: none of these lines is
 * read by anything that fights, and the player's own read of "which one is he"
 * is the entire payload. Two tables because the two armies speak differently
 * about their men, exactly as the nickname tables do.
 */
const CLONE_LINES = [
  'Keeps his rifle cleaner than his bunk.',
  'Talks through every drop. Nobody minds any more.',
  'Second off the ship, always. Nobody has seen him first.',
  'Carries a dead brother\'s dice in his chest plate.',
  'Reads the terrain briefing twice. Trusts it once.',
  'Hums in the dropship. Stops the moment the ramp opens.',
  'Never learned to duck properly. Still here anyway.',
  'Counts his shots out loud when it gets bad.',
  'Volunteered. Nobody remembers the question.',
  'Sleeps standing up. Wakes before the alarm.',
  'Writes the names of the fallen inside his vambrace.',
  'Laughs at the wrong moments. It helps more than it should.',
  'Swears the dust tastes different on every ground.',
  'Field-strips anything with a trigger. Twice, to be sure.',
  'Stands closest to the general. Says it is a coincidence.',
  'Has walked away from two crashes. Does not talk about the third.',
  'Learned every callsign on the roll by the second day.',
  'Shoots left-handed. The armourer has given up asking.',
  'Saves half of every ration. Will not say for what.',
  'Whistles the extraction tone in his sleep.',
  'Asked for the oldest rifle in the crate. Keeps it shooting.',
  'Memorised the withdrawal route before the drop route.',
  'Draws the terrain in the dust and stares at it.',
  'Has never once ridden in the middle of the dropship.',
];
const DROID_LINES = [
  'Boot sequence two seconds slow. Compensates by never stopping.',
  'Photoreceptor flickers when artillery lands. Logged as a feature.',
  'Recites its own serial number under fire. For morale.',
  'Refused a memory wipe once. The report was never filed.',
  'Walks point without being ordered. The others let it.',
  'Keeps count of every bolt fired. The number is enormous.',
  'Salvaged from three chassis. Answers to all three serials.',
  'Its vocabulator drops a word a week. Chooses which one.',
  'Marches a half-step off the cadence. Always the same half-step.',
  'Polishes its plating with hydraulic fluid. Against regulation.',
  'Asked once what the war was about. Was told to hold the line.',
  'Files casualty reports nobody requested. In triplicate.',
  'Aims low on principle. Legs do not shoot back.',
  'Has outlived four commanding units. Draws no conclusion.',
  'Hums a maintenance tone in standby. The others sync to it.',
  'Marked "return to foundry" twice. Returned to the line twice.',
  'Requisitioned one (1) paintbrush. Purpose: unlogged.',
  'Its left knee squeaks on the advance. Never on the retreat.',
  'Stores fallen units\' serials in a partition nobody assigned.',
  'Calculates odds aloud. Rounds them up for the others.',
  'Turns to face the artillery. Says the data is better.',
  'Has a designated rock on three separate battlefields.',
  'Reboots facing the enemy. Standing orders, it says.',
  'Its targeting laser is a degree warm. It calls this style.',
];

/** The line for one designation — a pure hash, stable for the man's life. */
export function flavorOf(armyId, designation) {
  const pool = armyId === 'separatist' ? DROID_LINES : CLONE_LINES;
  let h = 0x811C9DC5 >>> 0;
  const s = `${armyId}/${designation}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return pool[h % pool.length];
}

/* ── the lifecycle ───────────────────────────────────────────────────── */

/**
 * Whether this settings blob deploys into a meeting — the one shape of run
 * that fields an army and never banks it (versus refuses `bank()`), so slate
 * recruits must never ride into it: a man who cannot die on the record is a
 * man the parade ground is lying about. Decided from SETTINGS at deploy time,
 * never from the director's own flag — `standDownMeeting` clears that flag
 * mid-run when no second commander shows, and the run then banks after all.
 */
export function versusPlanned(settings) {
  return !!commandConfig(settings || {}).versus;
}

/**
 * MAKE THE SLATE TRUE, and write only if something was false.
 *
 * Called from every render of the Company tab and from the deploy path, so
 * the no-op case is the hot case and it allocates nothing it can avoid:
 * a slate whose salt matches the company and whose count matches the need is
 * returned as-is, unwritten. Stale means any of —
 *
 *   THE COMPANY MOVED (salt mismatch): every recruit is re-minted under the
 *     new salt. Names the player gave men who never fielded are let go with
 *     the slate that held them; the muster moved on, and the copy on the tab
 *     says so rather than pretending names are forever.
 *   A NAME WAS CLAIMED (roll or casualty collision): that recruit is dropped
 *     and the gap re-minted at the next ordinals, same salt — reconcile.
 *   THE SLATE IS SHORT (a deploy consumed men and the run has not folded
 *     yet — a failed deploy, a mid-run refresh): topped up, same salt.
 *   THE SLATE IS LONG for the need: trimmed from the tail. Looks survive a
 *     want wiggle because shrink-then-grow under one salt re-mints the same
 *     designations, and looks are keyed to them.
 *
 * @param plan     `musterPlan()`'s answer, or null. Null plans (no army mode,
 *                 no contingent) leave the store entirely alone.
 * @param company  the army's `Company.load` — passed in so menu code that
 *                 already holds one does not read the store twice per frame.
 * @returns the true slate for the plan's army, or null for a null plan.
 */
export function ensure(plan, company) {
  if (!plan || !plan.armyMode || !ARMIES[plan.army]) return null;
  const c = company && company.army === plan.army ? company : Company.load(plan.army);
  const salt = saltOf(c);
  const fresh = Math.max(0, Math.min(SLATE_CAP,
    (plan.want | 0) - Company.fieldable(c, plan.want).length));
  let slate = slateFor(plan.army);
  let moved = false;

  if (slate.salt !== salt) {
    slate = { ...blankSlate(plan.army), salt };
    moved = true;
  }

  /* Reconcile: a slate name now on the roll or the casualty list is gone. */
  const claimed = new Set();
  for (const m of (c.men || [])) claimed.add(m.designation);
  for (const f of (c.fallen || [])) claimed.add(f.designation);
  const before = slate.recruits.length;
  slate.recruits = slate.recruits.filter((r) => !claimed.has(r.designation));
  if (slate.recruits.length !== before) moved = true;

  if (slate.recruits.length > fresh) {
    slate.recruits = slate.recruits.slice(0, fresh);
    moved = true;
  }
  if (slate.recruits.length < fresh) {
    /**
     * Mint the gap. The taken set is walked from ordinal 0 with every prior
     * designation in it, so a shrink-then-grow reproduces the trimmed names:
     * `designateWith` derives from `taken.size`, and the sequence under one
     * salt is a function of nothing else.
     */
    const army = ARMIES[plan.army];
    const cheapest = army.tiers[0].type;
    const taken = takenOf(c, slate);
    /* Bounded, because `designateWith`'s own last resort does not consult
     * `taken` — a full namespace must produce a short slate, never a spin. */
    for (let guard = 0; slate.recruits.length < fresh && guard < SLATE_CAP * 20; guard++) {
      const designation = designateWith(slate.salt, army, taken);
      if (taken.has(designation)) continue;
      taken.add(designation);
      slate.recruits.push({ designation, type: cheapest, squad: null, look: null });
    }
    moved = true;
  }

  /* Picks are only ever a view over known names. */
  if (Array.isArray(slate.picks)) {
    const known = new Set([
      ...(c.men || []).map((m) => m.designation),
      ...slate.recruits.map((r) => r.designation),
    ]);
    const seen = new Set();
    const picks = slate.picks.filter((p) =>
      known.has(p) && !seen.has(p) && (seen.add(p), true)).slice(0, plan.want | 0);
    if (picks.length !== slate.picks.length) { slate.picks = picks.length ? picks : null; moved = true; }
  }

  if (moved) saveSlate(slate);
  return slate;
}

/**
 * A recruit as the veterans pipe expects him: the `Company.manOf` shape with
 * every career field at zero and NO attrs key at all — `enlistRecord` hands
 * an absent profile to the `Trooper` constructor, which rolls it from the run
 * itself. The zeros are not decoration: a slate that could carry xp in would
 * be a free Commander, and the check suite prices exactly that.
 */
export function materialize(r, armyId) {
  return {
    id: null, army: armyId, type: r.type, designation: r.designation,
    nickname: null, kind: armyId === 'separatist' ? 'steel' : 'flesh',
    squad: Number.isInteger(r.squad) ? r.squad : null,
    xp: 0, kills: 0, wounds: 0, morale: 0.72, areas: 0, joined: 1,
    runs: 0, since: null, story: [],
    bonds: [],
    look: r.look ? { ...r.look } : null,
  };
}

/**
 * WHO THE NEXT RUN FIELDS, exactly. Veterans in `fieldable` order, recruits
 * behind them, the player's picks honoured, capped at the plan's want.
 *
 * @param plan      `musterPlan()`'s answer, or null → null (no army, no line).
 * @param company   the army's loaded roll.
 * @param opts.versus  a meeting is being deployed: veterans only. See
 *                     `versusPlanned` for why this arrives as a flag.
 */
export function lineup(plan, company, opts = {}) {
  if (!plan) return null;
  const c = company && company.army === plan.army ? company : Company.load(plan.army);
  const want = Math.max(0, plan.want | 0);
  /* EVERY man is reachable by a pick, not only the prefix. The default line
   * is `fieldable`'s first `want`; a pick naming a RESERVE veteran must find
   * him too, or the tab's "field him next run" writes a name this resolver
   * silently drops — a button that lies. The whole roll goes in the map; the
   * WANT cap below is what keeps a pick from ever growing the line. */
  const all = Company.fieldable(c);
  const vets = all.slice(0, want);
  const slate = opts.versus ? null : ensure(plan, c);
  const recruits = slate ? slate.recruits.map((r) => materialize(r, plan.army)) : [];
  const byName = new Map([
    ...all.map((m) => [m.designation, m]),
    ...recruits.map((m) => [m.designation, m]),
  ]);
  /* Default order: veterans then recruits. Picks reorder within the same men —
   * they can bench a veteran for a recruit or a junior for a favourite, and
   * they can never ADD a man the default could not field. */
  const fallback = [...vets, ...recruits];
  const picked = [];
  const used = new Set();
  for (const p of (slate?.picks || [])) {
    const m = byName.get(p);
    if (m && !used.has(p)) { picked.push(m); used.add(p); }
  }
  for (const m of fallback) {
    if (picked.length >= want) break;
    if (!used.has(m.designation)) { picked.push(m); used.add(m.designation); }
  }
  return picked.slice(0, want);
}

/* ── what the player may change ──────────────────────────────────────── */

/**
 * WRITE ONE RECRUIT'S LOOK — `Company.dress`'s twin for a man not yet on any
 * roll, holding the same line: a callsign, a mark and a band, and nothing any
 * part of the fight reads. Field-validated exactly as `dress` validates.
 */
export function dressRecruit(army, designation, look = {}) {
  const slate = slateFor(army);
  const r = slate.recruits.find((x) => x.designation === designation);
  if (!r) return slate;
  const next = { ...(r.look || {}) };
  if ('mark' in look) {
    const mk = markById(look.mark);
    if (mk.color == null) delete next.mark; else next.mark = mk.id;
  }
  if ('band' in look) {
    const bd = markById(look.band);
    if (bd.color == null) delete next.band; else next.band = bd.id;
  }
  if ('callsign' in look) {
    const cs = Company.cleanCallsign(look.callsign);
    if (cs) next.callsign = cs; else delete next.callsign;
  }
  r.look = Object.keys(next).length ? next : null;
  return saveSlate(slate);
}

/** Deal one recruit a squad, or take it back with null. Organizational only. */
export function setRecruitSquad(army, designation, squad) {
  const slate = slateFor(army);
  const r = slate.recruits.find((x) => x.designation === designation);
  if (!r) return slate;
  r.squad = Number.isInteger(squad) && squad >= 0 && squad <= 4 ? squad : null;
  return saveSlate(slate);
}

/**
 * The player's hand-picked line, or null to restore the muster's own order.
 * Stored as given and re-validated on every `ensure` — a pick whose man has
 * died or been re-minted simply stops counting.
 */
export function setPicks(army, picks) {
  const slate = slateFor(army);
  slate.picks = Array.isArray(picks) && picks.length
    ? picks.filter((p) => typeof p === 'string').slice(0, SLATE_CAP * 2)
    : null;
  return saveSlate(slate);
}

export function clearPicks(army) { return setPicks(army, null); }

/**
 * A DEPLOY TOOK THESE MEN. Called once, from the deploy path, with exactly
 * the recruit designations the lineup fielded — never "everything on the
 * slate", because a contingent run fields no recruits and must consume none.
 * Their names leave the slate (they are on a roster now, and the fold will
 * put them on the roll or the casualty list); picks are spent with them.
 */
export function consume(army, designations) {
  const list = Array.isArray(designations) ? designations.filter((d) => typeof d === 'string') : [];
  if (!list.length) return slateFor(army);
  const slate = slateFor(army);
  const gone = new Set(list);
  slate.recruits = slate.recruits.filter((r) => !gone.has(r.designation));
  slate.picks = null;
  return saveSlate(slate);
}

/** Wipe the store — the player's own door, mirroring `Company.clear`. */
export function clear(army = null) {
  if (army === null) { writeAll({}); return; }
  const all = readAll();
  delete all[army];
  writeAll(all);
}
