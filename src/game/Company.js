/**
 * BATTLEFRONT BORZ — THE COMPANY, and why it can exist at all.
 *
 * "What would be the point in persisting the company? Aren't you assuming that
 *  I win every run? In reality you're either dying or quitting 99% of the time,
 *  so isn't the whole company dying anyway? Unless you have a way to retreat
 *  and recall/save your men instead of quitting outright."
 *
 * That question is the whole design, and it is right: a roster that carries
 * over only when you WIN is a roster that never carries over. So the withdrawal
 * came first — `World.withdraw`, held for `WITHDRAW_HOLD`, the ship down for
 * `LAST_CALL` — and this file is the other half of it. Nothing here decides who
 * lives. `Extraction.manifest` is the list of men who walked up the ramp before
 * it closed, `World._endWithdrawal` hands it over, and this remembers exactly
 * that list and nothing else.
 *
 * WHAT A COMPANY IS, AND WHAT IT IS NOT
 *
 * It is a NAMED ROLL that outlives runs: the men you got out, with their rank,
 * their kills, their wounds, the grounds they have crossed and the nickname
 * they earned doing it. It is the same `Trooper` record `Command.js` already
 * keeps between areas — this only makes the gap between areas as wide as the
 * gap between sessions.
 *
 * It is NOT a currency and it is NOT an unlock, on exactly the terms
 * `Progress.js` sets out at the top of its own file. Nothing here is bought,
 * nothing here gates a mode, a level, a crystal or an order, and the hundredth
 * run starts on the same ground the first one did. What a veteran company buys
 * you is a line that has been through it — the rank multipliers in
 * `Command.RANKS`, which a fresh muster earns inside a single campaign anyway —
 * and the specific, unrepeatable fact that the sergeant covering your left is
 * the one who has been covering it since Geonosis.
 *
 * THE COST IS ALWAYS REAL, WHICH IS WHY THIS IS NOT A RATCHET
 *
 * The men who did not reach the ramp are `lost`, and lost is permanent: a
 * withdrawal called two streets too late costs a name that has been with the
 * company for nine runs, and there is no continue and no reload. Dying does not
 * grow the company either — a wipe leaves nothing on the manifest, so the whole
 * roll is gone. The only way anything survives is to decide to leave, which is
 * the decision this entire mechanism exists to make expensive.
 *
 * ONE ROLL PER ARMY. The Republic's clones and the Separatist droids are two
 * companies and always have been — a designation is drawn from a different
 * table, a rank is painted on a different field (`ARMIES[].paint`), and a droid
 * who served under a Jedi general is not a thing this game says. `load()` keys
 * on `army` for that reason and `keep()` refuses a manifest whose army is not
 * the one being written.
 */

import { ARMIES, ARMY_IDS, RANKS, rankFor } from './Command.js';

/** Where it lives. Versioned like every other store in the tree. */
export const KEY = 'saber.company.v1';

/**
 * How many men one company may hold.
 *
 * Not a balance number — a HONESTY number. `LEVY_STRENGTH` is 40 and a
 * flagship muster deploys ten, so a company that grew without bound would after
 * twenty successful withdrawals be a roll of two hundred names of which the
 * game could field a twentieth, and the Company tab would be a phone book
 * describing men you will never see again. 60 is a roll you can read, six
 * musters deep, and it is above every deployment this game can make.
 */
export const CAP = 60;

/**
 * How many runs a man may be absent before he is struck off.
 *
 * A company you stopped playing four months ago should still be there — that is
 * the point of a save file. But a man left on the roll of an army you have not
 * fielded since is not a veteran, he is a leak, and `CAP` is a hard ceiling
 * that a leak eventually fills. `null` disables it; it is null today and the
 * field exists so that a future muster screen has somewhere to say so.
 */
export const STALE_AFTER = null;

/** What one man carries across a session. Nothing derived is stored. */
const MAN_FIELDS = [
  'id', 'army', 'type', 'designation', 'nickname', 'squad',
  'xp', 'kills', 'wounds', 'morale', 'areas', 'joined',
  /* THE CAMPAIGN HISTORY, and it only exists once a man has one. `runs` is
   * withdrawals survived and `since` is the run he first walked up a ramp on,
   * so the tab can say "nine runs, since Geonosis" rather than a bare number.
   * Neither is read by anything that fights. */
  'runs', 'since', 'story',
  /* AND WHAT THE PLAYER CHOSE TO DO WITH HIM. See `look`. */
  'look',
];

/**
 * The blank company. A company with no men is a real state and not an error:
 * it is what every player has before their first withdrawal, and the muster
 * has to be able to tell that from "no save file at all" — the first is a roll
 * that has been wiped and the second is a game that has not been played.
 */
export const blank = (army = ARMY_IDS[0]) => ({
  army,
  /** The men, oldest first. */
  men: [],
  /** Withdrawals this company has survived. */
  runs: 0,
  /** Names that did not reach the ramp, all-time. The cost, kept in view. */
  lost: 0,
  /** …and who they were, most recent first, capped. A casualty list. */
  fallen: [],
  /** The run this roll was founded on. Null until the first man is kept. */
  founded: null,
});

/** How many names the casualty list keeps. A list, not an archive. */
export const FALLEN_KEEP = 40;

/* ── the store ───────────────────────────────────────────────────────── */

/**
 * Everything on disk, by army id. Read defensively for `Progress.js`'s reason,
 * stated there: "a record is not worth a crash", and a player who cannot open
 * the game because a number they never saw is a string has lost more than a
 * roster.
 */
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
  } catch { /* private browsing, a full quota — losing a roll is not a crash */ }
}

/** A stored man, made safe. Anything unreadable becomes a fresh recruit's value. */
function readMan(m, army) {
  if (!m || typeof m !== 'object') return null;
  if (typeof m.type !== 'string' || !m.type) return null;
  if (typeof m.designation !== 'string' || !m.designation) return null;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return {
    id: typeof m.id === 'string' ? m.id : null,
    army,
    type: m.type,
    designation: m.designation,
    nickname: typeof m.nickname === 'string' ? m.nickname : null,
    squad: Number.isInteger(m.squad) ? m.squad : null,
    xp: Math.max(0, num(m.xp, 0)),
    kills: Math.max(0, num(m.kills, 0)),
    wounds: Math.max(0, num(m.wounds, 0)),
    /* CLAMPED, and this is the one field where a bad value would be felt in
     * the fight rather than on a screen: `_morale` reads it every frame and a
     * stored 9e9 would be a man who cannot break. */
    morale: Math.min(1, Math.max(0, num(m.morale, 0.72))),
    areas: Math.max(0, num(m.areas, 0)),
    joined: Math.max(1, num(m.joined, 1)),
    runs: Math.max(0, num(m.runs, 0)),
    since: typeof m.since === 'string' ? m.since : null,
    story: Array.isArray(m.story) ? m.story.filter((s) => typeof s === 'string').slice(-STORY_KEEP) : [],
    look: m.look && typeof m.look === 'object' && !Array.isArray(m.look) ? { ...m.look } : null,
  };
}

/** How many lines of a man's own history the record keeps. */
export const STORY_KEEP = 8;

/**
 * The company for one army.
 *
 * @param army  an army id. An unknown one gets the blank roll for the first
 *              army rather than null, because every caller wants a company to
 *              read and none of them wants to branch on whether one exists.
 */
export function load(army = ARMY_IDS[0]) {
  const id = ARMIES[army] ? army : ARMY_IDS[0];
  const all = readAll();
  const v = all[id];
  if (!v || typeof v !== 'object') return blank(id);
  const men = Array.isArray(v.men)
    ? v.men.map((m) => readMan(m, id)).filter(Boolean).slice(0, CAP) : [];
  const num = (x, d) => (Number.isFinite(x) ? Math.max(0, x) : d);
  return {
    ...blank(id),
    men,
    runs: num(v.runs, 0),
    lost: num(v.lost, 0),
    fallen: Array.isArray(v.fallen)
      ? v.fallen.filter((f) => f && typeof f.designation === 'string').slice(0, FALLEN_KEEP)
      : [],
    founded: typeof v.founded === 'string' ? v.founded : null,
  };
}

/** Write one army's company back, leaving the other armies' rolls alone. */
export function save(company) {
  if (!company || !ARMIES[company.army]) return company;
  const all = readAll();
  all[company.army] = {
    army: company.army,
    men: (company.men || []).slice(0, CAP).map((m) => {
      const out = {};
      for (const k of MAN_FIELDS) if (m[k] !== undefined && m[k] !== null) out[k] = m[k];
      return out;
    }),
    runs: company.runs | 0,
    lost: company.lost | 0,
    fallen: (company.fallen || []).slice(0, FALLEN_KEEP),
    founded: company.founded ?? null,
  };
  writeAll(all);
  return company;
}

/** Every army's roll at once — what the Company tab lists down its side. */
export function loadAll() {
  return ARMY_IDS.map((id) => load(id));
}

/** Wipe one army's roll, or all of them. The player's own door, never the game's. */
export function clear(army = null) {
  if (army === null) { writeAll({}); return; }
  const all = readAll();
  delete all[army];
  writeAll(all);
}

/* ── the two crossings ───────────────────────────────────────────────── */

/**
 * THE RECORD OF A LIVE TROOPER, FLATTENED. `Trooper` → stored man.
 *
 * `body` and `roster` are deliberately absent: one is an Enemy that is disposed
 * at every area boundary and the other is a cycle. `broken`, `rout` and
 * `detached` are absent too — all three are about a fight that is over, and a
 * man who walked onto the ship shaken walks off the next one steady, which is
 * the one place this file is allowed to be kind and says so out loud.
 */
export function manOf(t, meta = {}) {
  if (!t) return null;
  return {
    id: t.id ?? null,
    army: t.army,
    type: t.type,
    designation: t.designation,
    nickname: t.nickname ?? null,
    squad: Number.isInteger(t.squad) ? t.squad : null,
    xp: Math.max(0, t.xp | 0),
    kills: Math.max(0, t.kills | 0),
    wounds: Math.max(0, t.wounds | 0),
    morale: Math.min(1, Math.max(0, Number.isFinite(t.morale) ? t.morale : 0.72)),
    areas: Math.max(0, t.areas | 0),
    joined: Math.max(1, t.joined | 0),
    runs: Math.max(0, (t.runs | 0)),
    since: t.since ?? meta.ground ?? null,
    story: Array.isArray(t.story) ? t.story.slice(-STORY_KEEP) : [],
    look: t.look ?? null,
  };
}

/**
 * …AND BACK. A stored man → a live `Trooper` on a roll, through the roster's
 * own door.
 *
 * `CommandRoster.enlistRecord` is where the field copy lives and its note says
 * why: `Trooper` has getters every screen reads, the constructor is in
 * Command.js, and Command.js may not import this file back. So there is one
 * copy of that mapping and this is a name for it — a caller who has a roster
 * should say `roster.enlistRecord(m)` outright; this exists for the ones that
 * only have a company.
 */
export function trooperOf(m, army, roster) {
  if (!m || !roster?.enlistRecord) return null;
  return roster.enlistRecord({ ...m, army: m.army ?? army?.id ?? army });
}

/* ── what a run does to a company ────────────────────────────────────── */

/**
 * FOLD ONE FINISHED RUN INTO THE ROLL.
 *
 * @param manifest  the `Trooper` records who reached the ramp — exactly
 *                  `World.manifest`, which is `Extraction.manifest` at the
 *                  moment the ramp closed. An empty array is a legal, meaningful
 *                  call: it is what a wipe looks like.
 * @param opts.army     which roll this run belongs to. Defaults to the army the
 *                      manifest itself names, and refuses a mixed one.
 * @param opts.left     the men who did not get aboard, as `Trooper`s. Only their
 *                      names are kept; they are gone.
 * @param opts.ground   the level id the run ended on, for `since` and the story.
 * @param opts.ended    'withdrew' | 'wiped' | 'won' — what `runStats` reports.
 *
 * @returns the written company.
 */
export function keep(manifest, opts = {}) {
  const list = Array.isArray(manifest) ? manifest.filter(Boolean) : [];
  const army = opts.army ?? list[0]?.army ?? ARMY_IDS[0];
  if (!ARMIES[army]) return load(ARMY_IDS[0]);
  const c = load(army);

  /* A MANIFEST FROM ANOTHER ARMY IS DROPPED, NOT MERGED. Two rolls exist
   * because a designation, a rank colour and a unit word are all different on
   * the two sides; a droid folded into the clone company would be a name the
   * muster cannot draw and the tab cannot paint. */
  const mine = list.filter((t) => t && t.army === army);

  const byId = new Map(c.men.map((m) => [m.id, m]));
  const byName = new Map(c.men.map((m) => [m.designation, m]));
  const kept = [];
  for (const t of mine) {
    const had = (t.id && byId.get(t.id)) || byName.get(t.designation) || null;
    const m = manOf(t, opts);
    /* A MAN WHO WAS ALREADY ON THE ROLL KEEPS HIS OWN HISTORY. The run he just
     * finished carries the xp, the kills and the wounds it earned — those live
     * on the `Trooper` and came back with him — but `runs` and `since` are the
     * roll's own fields and the run has no opinion about them. */
    m.runs = (had ? had.runs | 0 : 0) + 1;
    m.since = had?.since ?? opts.ground ?? null;
    m.look = t.look ?? had?.look ?? null;
    const line = storyLine(t, opts);
    m.story = [...(had?.story || []), ...(line ? [line] : [])].slice(-STORY_KEEP);
    kept.push(m);
    if (had) { byId.delete(had.id); byName.delete(had.designation); }
  }

  /**
   * EVERY MAN WHO WAS ON THE ROLL AND IS NOT ON THE MANIFEST IS DEAD.
   *
   * Not "absent", not "in reserve" — the whole company deploys, so a name that
   * went out and did not come back did not come back. This is the line that
   * makes the mechanism cost something, and it is deliberately unconditional:
   * there is no branch here for a run that went badly, because a run that went
   * badly is precisely when a player would want one.
   *
   * The exception is a run this company was never IN. `opts.deployed` is the
   * roll as it stood when the run started; without it, a company is only ever
   * added to, and a session that ended some other way (a mode with no army, a
   * disconnection) would not quietly execute a roster it never fielded.
   */
  const wentOut = Array.isArray(opts.deployed)
    ? new Set(opts.deployed.map((t) => t?.id ?? t?.designation).filter(Boolean))
    : null;
  const gone = [];
  for (const m of c.men) {
    if (kept.some((k) => k.id === m.id || k.designation === m.designation)) continue;
    /* NOT ON THIS RUN'S ROLL, SO NOT THIS RUN'S CASUALTY. With no `deployed`
     * at all the answer is the same for every man: a call that cannot prove
     * anybody went out proves nobody did, and the roll is left alone. */
    if (!wentOut || (!wentOut.has(m.id) && !wentOut.has(m.designation))) { kept.push(m); continue; }
    gone.push(m);
  }
  for (const t of (opts.left || [])) {
    if (!t || t.army !== army) continue;
    if (gone.some((g) => g.designation === t.designation)) continue;
    gone.push(manOf(t, opts));
  }

  c.men = kept.slice(0, CAP);
  c.lost = (c.lost | 0) + gone.length;
  c.fallen = [
    ...gone.map((m) => ({
      designation: m.designation, nickname: m.nickname ?? null, type: m.type,
      rank: rankFor(m.xp | 0), kills: m.kills | 0, runs: m.runs | 0,
      where: opts.ground ?? null,
    })),
    ...(c.fallen || []),
  ].slice(0, FALLEN_KEEP);
  if (kept.length && !c.founded) c.founded = opts.ground ?? null;
  /* A RUN ONLY COUNTS IF SOMEBODY CAME HOME. `runs` on the company is
   * withdrawals survived — the number the tab prints beside its name — and a
   * wipe is not one of them however long it took. */
  if (kept.length) c.runs = (c.runs | 0) + 1;
  return save(c);
}

/**
 * The one line a man's record gains for the run he just survived.
 *
 * Written from what actually happened rather than from a template with a mode
 * name in it: a run where he killed nobody and took no wounds gets no line at
 * all, because eight entries of "Geonosis" is not a history.
 */
export function storyLine(t, opts = {}) {
  if (!t) return null;
  const where = opts.ground || null;
  const bits = [];
  if (t.kills > 0) bits.push(`${t.kills} down`);
  if (t.wounds > 0) bits.push(t.wounds === 1 ? 'wounded' : `wounded ${t.wounds}×`);
  if (t.areas > 0) bits.push(t.areas === 1 ? 'held a ground' : `held ${t.areas} grounds`);
  if (!bits.length) return null;
  return where ? `${where}: ${bits.join(', ')}` : bits.join(', ');
}

/**
 * THE ROLL THIS COMPANY CAN FIELD, oldest and highest first.
 *
 * `n` is what the muster asked for. Fewer men than that is the normal case —
 * a company is what you have left, not what you would like — and the caller
 * fills the rest with fresh enlistments, which is `CommandRoster.enlist`'s job
 * and not this file's.
 *
 * SORTED BY RANK AND THEN BY SERVICE, so a company that outgrew a deployment
 * fields its veterans. The alternative, taking the roll in order, would field
 * whoever happened to be enlisted first and quietly bench a Commander behind
 * four recruits.
 */
export function fieldable(company, n = Infinity) {
  const men = (company?.men || []).slice();
  men.sort((a, b) => (rankFor(b.xp | 0) - rankFor(a.xp | 0))
    || ((b.runs | 0) - (a.runs | 0))
    || ((b.kills | 0) - (a.kills | 0)));
  return Number.isFinite(n) ? men.slice(0, Math.max(0, n | 0)) : men;
}

/** One line per company for a screen that lists them: what this roll is. */
export function companyLines(c) {
  if (!c) return [];
  const army = ARMIES[c.army];
  const unit = army?.unit ?? 'trooper';
  const out = [];
  out.push(`${army?.name ?? c.army} — ${c.men.length} ${unit}${c.men.length === 1 ? '' : 's'}`);
  if (!c.men.length) {
    out.push(c.lost ? `${c.lost} lost, nobody left` : 'no roll yet — get a man home');
    return out;
  }
  out.push(`${c.runs} withdrawal${c.runs === 1 ? '' : 's'} survived · ${c.lost} lost`);
  const ranked = fieldable(c);
  const top = ranked[0];
  if (top) {
    const r = RANKS[rankFor(top.xp | 0)];
    out.push(`senior: ${top.nickname ? `${top.designation} "${top.nickname}"` : top.designation}`
      + ` — ${r.title}, ${top.runs} run${top.runs === 1 ? '' : 's'}, ${top.kills} down`);
  }
  if (c.founded) out.push(`founded on ${c.founded}`);
  return out;
}
