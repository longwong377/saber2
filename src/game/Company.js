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

import { ARMIES, ARMY_IDS, RANKS, rankFor, MARKS, markById } from './Command.js';
import {
  ATTR_IDS, traitById, attrName, BOND_AREAS, liveBonds, isBonded, applyTrait, shedTraits,
} from './Attributes.js';
/* FOR THE ONE WORD THAT SAYS WHAT HE DOES. `dossier` printed `m.type` raw for
 * a long time, so a page about a person had "clone_heavy" on it; `ARCHETYPES`
 * already carries the label every other screen uses and this file must not
 * grow a second copy of it. */
import { ARCHETYPES } from './Enemy.js';
import { makeStore } from './Store.js';

/**
 * An attribute block off disk, clamped and complete.
 *
 * Returns null for anything unrecognisable rather than a half-filled object, so
 * `Trooper` rolls the man fresh instead of fielding one with three of his eight
 * numbers missing — a soldier who is 50 at everything he was not saved with is
 * a soldier the save has quietly changed.
 */
function saneAttrs(a) {
  if (!a || typeof a !== 'object') return null;
  const out = {};
  for (const id of ATTR_IDS) {
    const v = Number(a[id]);
    if (!Number.isFinite(v)) return null;
    out[id] = Math.max(0, Math.min(100, Math.round(v)));
  }
  return out;
}

/** The order a man's bonds are kept and shown in. Stable across a reload. */
const strongestFirst = (a, b) => ((b.areas | 0) - (a.areas | 0))
  || (a.with < b.with ? -1 : a.with > b.with ? 1 : 0);

/**
 * A MAN'S BONDS OFF DISK, made safe.
 *
 * The failure this exists to stop is not a crash, it is a save file with fifty
 * entries in it: `bonds` is the only field on a record that names ANOTHER
 * record, so it is the only one where a hand edit buys something — a man
 * bonded to forty people, or to a name that is not on the roll, or to himself,
 * or with a tally of 1e9 that sorts him to the top of every list for ever.
 *
 * Everything a save can assert about a bond is checked here except the one
 * thing this function cannot see, which is whether the other man is still
 * alive. That is `settleBonds`, which runs once the whole roll has been read.
 */
function saneBonds(list, self) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    const who = typeof b.with === 'string' ? b.with : null;
    if (!who || who === self || seen.has(who)) continue;
    const n = Number(b.areas);
    if (!Number.isFinite(n) || n <= 0) continue;
    seen.add(who);
    out.push({ with: who, areas: Math.min(BOND_TALLY_MAX, Math.max(0, Math.round(n))) });
  }
  return out.sort(strongestFirst).slice(0, BONDS_MAX);
}

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

/** What one man carries across a session. Nothing derived is stored. */
const MAN_FIELDS = [
  'id', 'army', 'type', 'designation', 'nickname', 'squad',
  'xp', 'kills', 'wounds', 'morale', 'areas', 'joined',
  /* WHO HE IS, and it has to persist or he is a different man every run. The
   * rank is what he has earned; these are what he was rolled as. See
   * src/game/Attributes.js. */
  'kind', 'attrs', 'traits',
  /* THE CAMPAIGN HISTORY, and it only exists once a man has one. `runs` is
   * withdrawals survived and `since` is the run he first walked up a ramp on,
   * so the tab can say "nine runs, since Geonosis" rather than a bare number.
   * Neither is read by anything that fights. */
  'runs', 'since', 'story',
  /* AND WHO HE HAS BEEN THROUGH IT WITH. The one field on this list that is
   * about two men rather than one; see `settleBonds`. It is a TALLY of shared
   * grounds per partner, not a flag — a bond that could only be on or off
   * would have to be decided in the one frame it crossed the line, and the
   * roster screen could never show a pair three grounds short of one. */
  'bonds',
  /* AND WHAT THE PLAYER CHOSE TO DO WITH HIM. See `look`. */
  'look',
];

/**
 * HOW MANY MEN ONE MAN CARRIES.
 *
 * Three, and it is the same kind of honesty number `CAP` is. A manifest is
 * about ten men, so a tally kept against everybody would give every survivor
 * nine entries after one withdrawal and sixty after six — a roster screen
 * listing nine names under "who he came home with" is a join table, not a
 * relationship, and a man with nine bonds has none.
 *
 * WHICH three is `settleBonds`'s decision and it is dealt per PAIR rather than
 * per man — see the note there for the measurement that says why, and for why
 * dealing them the obvious way left half a roll bonded to nobody.
 */
export const BONDS_MAX = 3;

/**
 * …AND HOW MUCH SHARED SERVICE ONE PAIR MAY BANK. `BOND_AREAS` × 8: enough
 * that "we have been through four times what it takes" is a thing a record can
 * say, and bounded so that a hand-edited save cannot hand a pair a number the
 * screen has to render or the sorter has to trust.
 */
export const BOND_TALLY_MAX = BOND_AREAS * 8;

/** The trait a live bond hangs on a man. Named once; `Attributes.js` owns it. */
const BOND_TRAIT = 'bonded';

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
  /**
   * ORDERS OF THE DAY — the moments of the LAST fold, overwritten every time.
   * A promotion, a name earned, a bond formed, a fifth run, a wound survived:
   * ceremony without a ceremony screen, read once off the index page the next
   * time the menu is raised. OVERWRITTEN and capped rather than appended,
   * because "since the last muster" is the whole meaning — an archive of old
   * honours would be a feed, and a feed is homework. A wipe writes none: the
   * dead get the memorial, not a bulletin.
   */
  honours: [],
});

/** How many names the casualty list keeps. A list, not an archive. */
export const FALLEN_KEEP = 40;

/** How many orders of the day one fold may write. A toast, not a feed. */
export const HONOURS_KEEP = 6;

/** The kinds an honour may be. Whitelisted on read like every stored enum. */
const HONOUR_KINDS = ['named', 'promoted', 'bonded', 'fifth', 'scarred'];

/**
 * One fallen record off disk, made safe. The three fields a record gained in
 * the epitaph pass — the callsign he answered to, who got him, and the minute —
 * arrive from old saves absent and from hand-edited ones hostile, so each is
 * clamped exactly as `readMan` clamps the living.
 */
function saneFallen(f) {
  if (!f || typeof f.designation !== 'string') return null;
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  return {
    designation: f.designation,
    nickname: typeof f.nickname === 'string' ? f.nickname : null,
    callsign: cleanCallsign(f.callsign),
    type: typeof f.type === 'string' ? f.type : null,
    rank: Math.max(0, num(f.rank, 0) | 0),
    kills: Math.max(0, num(f.kills, 0) | 0),
    runs: Math.max(0, num(f.runs, 0) | 0),
    where: typeof f.where === 'string' ? f.where : null,
    killer: typeof f.killer === 'string'
      ? f.killer.replace(/[<>&`\\]/g, '').slice(0, 40) : null,
    at: Number.isFinite(f.at) ? Math.max(0, Math.min(999, f.at | 0)) : null,
  };
}

/* ── the store ───────────────────────────────────────────────────────── */

/**
 * Everything on disk, by army id. Read defensively for `Progress.js`'s reason,
 * stated there: "a record is not worth a crash", and a player who cannot open
 * the game because a number they never saw is a string has lost more than a
 * roster.
 */
/**
 * THE STORE. One policy, shared with the muster slate — src/game/Store.js.
 *
 * This used to catch a refused write and throw the value away under a comment
 * saying "losing a roll is not a crash". It is not a crash and it is worse
 * than one: the roll stays on screen, the player keeps fighting for it, and it
 * is already gone. A refused write is remembered for the life of the page now,
 * and `notSaving` lets the tab say so.
 */
const STORE = makeStore(KEY);

/** True when a write has been refused. The Company tab reads this and warns. */
export const notSaving = () => STORE.broken;

const readAll = () => STORE.read();
const writeAll = (v) => STORE.write(v);

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
    /**
     * SANITISED ON THE WAY IN, because this comes off disk and a save from an
     * older build has none of it. An absent profile is rolled fresh by
     * `Trooper`; a present one is clamped, because a hand-edited save that
     * hands a man 5 000 Grit is a save that hands him an unkillable body and
     * the file that reads it is where that has to stop.
     */
    kind: m.kind === 'steel' ? 'steel' : 'flesh',
    attrs: saneAttrs(m.attrs),
    traits: Array.isArray(m.traits)
      ? m.traits.filter((t) => typeof t === 'string' && traitById(t)).slice(0, 4)
      : [],
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
    bonds: saneBonds(m.bonds, m.designation),
    look: m.look && typeof m.look === 'object' && !Array.isArray(m.look) ? { ...m.look } : null,
  };
}

/** How many lines of a man's own history the record keeps. */
export const STORY_KEEP = 8;

/* ── bonds ───────────────────────────────────────────────────────────── */

/**
 * MAKE THE WHOLE ROLL'S BONDS COHERENT, and hang or strip the trait to match.
 *
 * Run on every read and again after every fold, because a bond is the only
 * thing on a record whose truth depends on somebody ELSE's record. Three
 * clauses, and each of them is a way the pair can stop being a pair:
 *
 *   HE IS NOT ON THE ROLL ANY MORE. Which on this roll means one thing —
 *     `keep` strikes off every man who did not reach the ramp, so a name that
 *     is missing is a name that is dead. This is the clause that makes a bond
 *     cost something: the man you fought above yourself beside is gone, the
 *     trait comes off with `shedTraits`, and the 16 Loyalty it lent you goes
 *     with him. It is also the clause that stops a bond to a dead man paying
 *     out for ever, which is the one bug this whole mechanism could have that
 *     nobody would ever notice from the outside.
 *   HE DOES NOT CARRY IT BACK. A bond exists between two records or it does
 *     not exist; a tally only one of them has is a save file talking to itself.
 *   THERE IS NO ROOM. `BONDS_MAX` is three and a manifest is ten, so the slots
 *     have to be dealt somehow — and dealing them PER MAN is the obvious answer
 *     and the wrong one. Measured on eight men who held every ground together:
 *     each keeping "my three strongest, ties to the lower designation" left the
 *     first four men bonded to each other and the last four bonded to NOBODY,
 *     because none of their choices chose them back. So the slots are dealt per
 *     PAIR instead — every pair on the roll sorted by shared ground and taken
 *     greedily while both men still have room. Symmetric by construction, so
 *     there is no second clause tidying up the half-bonds it made, and on those
 *     same eight men it gives all eight three apiece.
 *   AND THE TRAIT FOLLOWS THE TALLY, never the other way round. `bonded` is
 *     hung on him by `applyTrait` the moment a tally crosses `BOND_AREAS` and
 *     taken off by `shedTraits` when the last one lapses — which also refunds
 *     its swing, so a man who outlives his friends is left with the numbers he
 *     was mustered with rather than a permanent 14 Nerve penalty and nothing
 *     on the page to explain it.
 *
 * IDEMPOTENT, which is load-bearing: this runs on every `load()` and the Menu
 * loads on every frame it is open. `applyTrait` refuses a trait a man already
 * carries, so the swing is baked exactly once however many times the roll is
 * read.
 */
function settleBonds(men) {
  const byName = new Map(men.map((m) => [m.designation, m]));
  /* EVERY PAIR ONCE, and only where both records agree it exists. The shared
   * ground is the SMALLER of the two tallies, which is the conservative read of
   * a disagreement — a hand-edited 1e9 against an honest 4 is four grounds. */
  const pairs = [];
  for (const m of men) {
    for (const b of (m.bonds || [])) {
      if (m.designation >= b.with) continue;
      const other = byName.get(b.with);
      const back = other && (other.bonds || []).find((x) => x.with === m.designation);
      if (!back) continue;
      pairs.push({ a: m, b: other, areas: Math.min(b.areas | 0, back.areas | 0) });
    }
  }
  pairs.sort((x, y) => (y.areas - x.areas)
    || (x.a.designation < y.a.designation ? -1 : x.a.designation > y.a.designation ? 1 : 0)
    || (x.b.designation < y.b.designation ? -1 : 1));
  for (const m of men) m.bonds = [];
  for (const p of pairs) {
    if (p.a.bonds.length >= BONDS_MAX || p.b.bonds.length >= BONDS_MAX) continue;
    if (!(p.areas > 0)) continue;
    p.a.bonds.push({ with: p.b.designation, areas: p.areas });
    p.b.bonds.push({ with: p.a.designation, areas: p.areas });
  }
  for (const m of men) {
    m.bonds.sort(strongestFirst);
    /* THE TRAIT IS DERIVED FROM THE TALLY EVERY TIME. A stored `bonded` on a
     * man with no live bond is a hand-edited save asking for 14 Nerve back;
     * `shedTraits` is what refuses it, and it is the same call that takes the
     * trait off a man whose friend has just been struck off. */
    if (!m.attrs) { m.traits = (m.traits || []).filter((id) => id !== BOND_TRAIT); continue; }
    const shed = shedTraits(m);
    m.attrs = shed.attrs;
    m.traits = shed.traits;
    if (isBonded(m) && !m.traits.includes(BOND_TRAIT)) {
      const worn = applyTrait(m, BOND_TRAIT);
      m.attrs = worn.attrs;
      m.traits = worn.traits;
    }
  }
  return men;
}

/**
 * ADD ONE RUN'S SHARED GROUND TO A PAIR'S TALLY.
 *
 * Called with the men as they stand after the fold, so `m.bonds` is already
 * the tally they came into this run with.
 */
function shareGround(m, who, n) {
  if (!(n > 0) || who === m.designation) return;
  const had = m.bonds.find((b) => b.with === who);
  if (had) had.areas = Math.min(BOND_TALLY_MAX, (had.areas | 0) + n);
  else m.bonds.push({ with: who, areas: Math.min(BOND_TALLY_MAX, n) });
}

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
  const men = settleBonds(Array.isArray(v.men)
    ? v.men.map((m) => readMan(m, id)).filter(Boolean).slice(0, CAP) : []);
  const num = (x, d) => (Number.isFinite(x) ? Math.max(0, x) : d);
  return {
    ...blank(id),
    men,
    runs: num(v.runs, 0),
    lost: num(v.lost, 0),
    fallen: Array.isArray(v.fallen)
      ? v.fallen.map(saneFallen).filter(Boolean).slice(0, FALLEN_KEEP)
      : [],
    founded: typeof v.founded === 'string' ? v.founded : null,
    honours: Array.isArray(v.honours)
      ? v.honours.filter((h) => h && HONOUR_KINDS.includes(h.kind)
          && typeof h.designation === 'string')
        .map((h) => ({
          kind: h.kind,
          designation: h.designation,
          detail: typeof h.detail === 'string' ? h.detail.slice(0, 40) : null,
        }))
        .slice(0, HONOURS_KEEP)
      : [],
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
    honours: (company.honours || []).slice(0, HONOURS_KEEP),
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
  if (army === null) { STORE.drop(); return; }
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
    kind: t.kind || 'flesh',
    attrs: t.attrs ? { ...t.attrs } : null,
    traits: Array.isArray(t.traits) ? t.traits.slice() : [],
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
    /* `Trooper` has no opinion about this — a bond is a fact about two men
     * across runs and the field only ever sees one run. `keep` carries the
     * tally forward off the record that was already on the roll. */
    bonds: saneBonds(t.bonds, t.designation),
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
 *                      Read by `storyLine`, which phrases a won run's line.
 * @param opts.roll     the run's own casualty rows (`stats.roll`), when the
 *                      ending had stats at all — a quit banks with none. Each
 *                      row carries the DISPLAY name (`CT-1500 "Ladder"`), the
 *                      killer and the second it happened; the epitaphs below
 *                      match by the designation prefix and keep the minute.
 *
 * @returns the written company.
 */
export function keep(manifest, opts = {}) {
  const list = Array.isArray(manifest) ? manifest.filter(Boolean) : [];
  const army = opts.army ?? list[0]?.army ?? ARMY_IDS[0];
  if (!ARMIES[army]) return load(ARMY_IDS[0]);
  const c = load(army);

  /**
   * THE PAIRS THAT WERE ALREADY BONDS, before this fold moves anything — so
   * the orders of the day can name the ones that FORMED tonight rather than
   * re-announcing every old friendship on every withdrawal.
   */
  const wasBonded = new Set();
  for (const m of c.men) {
    for (const b of liveBonds(m)) {
      wasBonded.add(m.designation < b.with
        ? `${m.designation}|${b.with}` : `${b.with}|${m.designation}`);
    }
  }

  /* A MANIFEST FROM ANOTHER ARMY IS DROPPED, NOT MERGED. Two rolls exist
   * because a designation, a rank colour and a unit word are all different on
   * the two sides; a droid folded into the clone company would be a name the
   * muster cannot draw and the tab cannot paint. */
  const mine = list.filter((t) => t && t.army === army);

  const byId = new Map(c.men.map((m) => [m.id, m]));
  const byName = new Map(c.men.map((m) => [m.designation, m]));
  const kept = [];
  /**
   * WHO CAME HOME ON THIS MANIFEST, AND HOW MUCH GROUND EACH HELD DOING IT.
   *
   * Both halves of a bond are here and neither is a new ledger. `home` is the
   * men who walked up the same ramp, which `keep` already knows. `held` is
   * DERIVED from a field that has always been on the record: `areas` is a
   * lifetime count, so what a man held on THIS run is simply what it has gone
   * up by since the roll last saw him. That is also the right answer for a man
   * the muster benched — his `areas` did not move, so he shared no ground with
   * anybody, which is true.
   */
  const home = [];
  for (const t of mine) {
    const had = (t.id && byId.get(t.id)) || byName.get(t.designation) || null;
    const m = manOf(t, opts);
    m.bonds = (had?.bonds || []).map((b) => ({ ...b }));
    home.push({ m, had, held: Math.max(0, (m.areas | 0) - (had?.areas | 0)) });
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
   * TWO MEN WHO HELD THE SAME GROUND AND BOTH GOT OFF IT SHARE IT.
   *
   * `min` of the two, because shared service is what they did TOGETHER: a man
   * who held four grounds and a man who joined for the last one have one
   * ground between them, not four. Both sides are written, so the tally is
   * symmetric by construction and `settleBonds` only ever has to break ties,
   * never invent the other half.
   *
   * O(n²) over the manifest, which is the ten or so men who came home — not
   * over `CAP`. At 60 it is 1 770 pairs once per withdrawal.
   */
  for (let i = 0; i < home.length; i++) {
    for (let j = i + 1; j < home.length; j++) {
      const shared = Math.min(home[i].held, home[j].held);
      if (shared <= 0) continue;
      shareGround(home[i].m, home[j].m.designation, shared);
      shareGround(home[j].m, home[i].m.designation, shared);
    }
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

  c.men = settleBonds(kept.slice(0, CAP));
  c.lost = (c.lost | 0) + gone.length;
  /**
   * THE EPITAPH FIELDS. A fallen record used to drop the callsign at exactly
   * the moment it mattered — a recruit the player named "dies wearing it" only
   * if the casualty list can still say it — and it never said who got him.
   * `opts.roll` is the run's own account and it speaks in DISPLAY names, so
   * the match is by designation prefix; `at` arrives in seconds and is kept as
   * the minute, which is how a person tells the story of a battle.
   */
  const rollByName = new Map();
  for (const r of (Array.isArray(opts.roll) ? opts.roll : [])) {
    if (r && typeof r.name === 'string') rollByName.set(r.name.split(' "')[0], r);
  }
  c.fallen = [
    ...gone.map((m) => {
      const r = rollByName.get(m.designation) || null;
      return {
        designation: m.designation, nickname: m.nickname ?? null, type: m.type,
        callsign: cleanCallsign(m.look?.callsign),
        rank: rankFor(m.xp | 0), kills: m.kills | 0, runs: m.runs | 0,
        where: opts.ground ?? null,
        killer: typeof r?.killer === 'string'
          ? r.killer.replace(/[<>&`\\]/g, '').slice(0, 40) : null,
        at: Number.isFinite(r?.at) ? Math.max(0, Math.min(999, Math.floor(r.at / 60))) : null,
      };
    }),
    ...(c.fallen || []),
  ].slice(0, FALLEN_KEEP);
  /**
   * THE ORDERS OF THE DAY, from the diff this fold just made. Only men who
   * actually came home are celebrated — a wipe or a quit writes an empty list,
   * because `home` is empty on both — and only what CHANGED tonight is worth a
   * line: the first nickname, a rank crossed, a bond formed, a fifth run, a
   * wound survived. Overwritten wholesale; see `blank`.
   */
  const honours = [];
  for (const h of home) {
    if (!h.had?.nickname && h.m.nickname) {
      honours.push({ kind: 'named', designation: h.m.designation, detail: h.m.nickname });
    }
    if (h.had && rankFor(h.m.xp | 0) > rankFor(h.had.xp | 0)) {
      honours.push({ kind: 'promoted', designation: h.m.designation,
        detail: RANKS[rankFor(h.m.xp | 0)].title });
    }
    if ((h.m.runs | 0) === 5) {
      honours.push({ kind: 'fifth', designation: h.m.designation, detail: null });
    }
    if ((h.m.wounds | 0) > ((h.had?.wounds | 0) || 0)) {
      honours.push({ kind: 'scarred', designation: h.m.designation, detail: null });
    }
  }
  for (const m of c.men) {
    for (const b of liveBonds(m)) {
      if (m.designation >= b.with) continue;
      if (wasBonded.has(`${m.designation}|${b.with}`)) continue;
      honours.push({ kind: 'bonded', designation: m.designation, detail: b.with });
    }
  }
  c.honours = honours.slice(0, HONOURS_KEEP);
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
  /* HOW THE DAY ENDED, on an eventful line only. A won ground is a different
   * sentence from a withdrawal and the record may as well say so — but eight
   * entries of "held to the end" with nothing else in them is not a history,
   * so a quiet run still writes no line. */
  if (opts.ended === 'won') bits.push('held to the end');
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

/* ── what the player may change about a man ──────────────────────────── */

/**
 * HOW LONG A CALLSIGN MAY BE, in characters.
 *
 * 14, and it is a layout number rather than a taste one: `Trooper.name` renders
 * as `CT-1500 "Ladder"` and the roster column, the casualty list, the HUD's
 * squad rows and the muster card all print that string in a fixed-width slot.
 * A player who types thirty characters does not get a long name, they get a
 * name that is cut off somewhere different on each of the four screens.
 */
export const CALLSIGN_MAX = 14;

/**
 * A callsign, made safe for a screen and for a save file.
 *
 * Trimmed, collapsed, capped, and stripped of the three characters that would
 * end up in `innerHTML` — the roster renders through the menu's own `escKey`,
 * but a name that has to be escaped correctly by every one of five call sites
 * is a name that will be printed raw by one of them. It is cheaper to refuse
 * the characters than to be right five times.
 *
 * An empty result is `null` and not `''`: null is "he answers to his earned
 * nickname", which is a different state from "the player named him nothing".
 */
export function cleanCallsign(s) {
  const t = String(s ?? '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, CALLSIGN_MAX) : null;
}

/**
 * WRITE ONE MAN'S APPEARANCE BACK TO THE ROLL.
 *
 * The one door the Company tab changes anything through, and it is deliberately
 * the only one: everything else on a record — rank, kills, wounds, grounds,
 * runs — is written by the game, from a run, and a screen that could edit those
 * would make the whole roster a cheat panel. This writes a mark and a name and
 * nothing that any part of the fight reads.
 *
 * @param army  which roll he is on.
 * @param key   his designation, which is unique across a roll by construction
 *              (`designate` loops and `enlistRecord` refuses a duplicate).
 * @param look  `{ mark, callsign }`; either may be omitted to leave it alone,
 *              and either may be explicitly null to clear it.
 * @returns the written company, or the unchanged one if there is no such man.
 */
export function dress(army, key, look = {}) {
  const c = load(army);
  const m = c.men.find((x) => x.designation === key);
  if (!m) return c;
  const next = { ...(m.look || {}) };
  if ('mark' in look) {
    /* Validated against the palette rather than stored as typed: a mark id
     * from an older build is a colour this one does not have, and a body that
     * silently painted nothing would be a player's choice quietly deleted. */
    const mk = markById(look.mark);
    if (mk.color == null) delete next.mark; else next.mark = mk.id;
  }
  if ('band' in look) {
    /* The same validation the mark gets and for the same reason: an id from an
     * older build is a colour this one does not have, and a body that silently
     * painted nothing would be a player's choice quietly deleted. */
    const bd = markById(look.band);
    if (bd.color == null) delete next.band; else next.band = bd.id;
  }
  if ('callsign' in look) {
    const cs = cleanCallsign(look.callsign);
    if (cs) next.callsign = cs; else delete next.callsign;
  }
  m.look = Object.keys(next).length ? next : null;
  return save(c);
}

/** What a man is called on a screen — the same rule `Trooper.name` uses. */
export function nameOf(m) {
  if (!m) return '';
  const called = m.look?.callsign || m.nickname;
  return called ? `${m.designation} "${called}"` : m.designation;
}

/**
 * EVERY LINE OF ONE MAN'S RECORD, as label/value pairs a screen renders.
 *
 * Built here rather than in Menu.js for the reason every other derived list in
 * this codebase is: the tab is one renderer of it and `tools/checks/company.mjs`
 * is another, and a page whose contents are assembled inside a DOM method can
 * only be tested by parsing HTML. Everything is DERIVED — there is no second
 * table of rank titles, archetype labels or army words anywhere in the UI.
 */
export function dossier(m, army = null) {
  if (!m) return [];
  const A = ARMIES[m.army] || (army && ARMIES[army]) || null;
  const R = RANKS[rankFor(m.xp | 0)];
  const rows = [
    ['Rank', `${R.title} (${R.short})`],
    ['Role', ARCHETYPES[m.type]?.label ?? m.type],
    ['Service', `${m.runs | 0} withdrawal${(m.runs | 0) === 1 ? '' : 's'}`],
    ['Kills', `${m.kills | 0}`],
    ['Wounds', `${m.wounds | 0}`],
    ['Grounds held', `${m.areas | 0}`],
  ];
  /* THE RANK'S OWN NUMBERS, because "Captain" is a word until somebody says
   * what it buys — and they are read off `RANKS` so a tuned ladder retunes the
   * page. Rung 0 has all three at 1.00 and prints nothing rather than three
   * lines of "no change", which is the honest way to say a Trooper is the
   * baseline. */
  if (R.hp !== 1 || R.dmg !== 1 || R.speed !== 1) {
    rows.push(['What the rank buys',
      `${Math.round((R.hp - 1) * 100)}% health · ${Math.round((R.dmg - 1) * 100)}% damage · `
      + `${Math.round((R.speed - 1) * 100)}% pace`]);
  }
  /* WHO HE WOULD CROSS A STREET FOR. Designations rather than callsigns: this
   * row is rendered through `escKey` on a page that is compared against this
   * table character for character, and a nickname arrives wrapped in quotes. */
  const bonded = liveBonds(m);
  if (bonded.length) rows.push(['Bonded to', bonded.map((b) => b.with).join(', ')]);
  if (m.since) rows.push(['Since', m.since]);
  if (m.nickname) rows.push(['Earned', `"${m.nickname}"`]);
  if (A) rows.push(['Army', A.name]);
  const mk = markById(m.look?.mark);
  if (mk.color != null) rows.push(['Mark', mk.name]);
  const bd = markById(m.look?.band);
  if (bd.color != null) rows.push(['Band', bd.name]);
  return rows;
}

/**
 * THE ORDERS OF THE DAY, as sentences a screen prints and does not think
 * about. Derived here for `dossier`'s reason — the index page renders these
 * and a check compares the page against this same function, so a page that
 * stopped saying one goes red rather than the check being taught to agree.
 *
 * Names resolve through the roll so a bonded pair prints the callsigns the
 * player actually reads; a man since struck off keeps his bare designation,
 * which is the truthful spelling of what remains of him.
 */
export function honoursOf(c) {
  if (!c?.honours?.length) return [];
  const by = new Map((c.men || []).map((m) => [m.designation, m]));
  const who = (d) => { const m = by.get(d); return m ? nameOf(m) : d; };
  return c.honours.map((h) => {
    switch (h.kind) {
      case 'named': return `${h.designation} came home with a name — "${h.detail}"`;
      case 'promoted': return `${who(h.designation)} made ${h.detail}`;
      case 'bonded': return `${who(h.designation)} and ${who(h.detail)} are bonded — `
        + `${BOND_AREAS} grounds side by side`;
      case 'fifth': return `${who(h.designation)}: five runs survived`;
      case 'scarred': return `${who(h.designation)} went down out there and got back up`;
      default: return null;
    }
  }).filter(Boolean);
}

/* ── what a roster screen prints about a bond ─────────────────────────── */

/**
 * ONE MAN'S BONDS, AS ROWS A SCREEN RENDERS AND DOES NOT THINK ABOUT.
 *
 * Here rather than in Menu.js for the reason `dossier` gives above and for one
 * more that is specific to this: a bond is the only thing on a record that
 * needs the REST of the roll to be printed at all — the other man's callsign,
 * whether he is still standing — and a tab that reached across the roster to
 * work that out would be a second model of the pairing living in a DOM method,
 * where the only way to test it is to parse HTML.
 *
 * @param m        a stored man.
 * @param company  his roll, for the other man's name. Omitted, the rows still
 *                 come back with designations in them and nothing else lost.
 *
 * Each row: `with` his designation, `name` what he is actually called,
 * `areas` the grounds the pair have held side by side, `bonded` whether that
 * has crossed `BOND_AREAS` yet, and `strength` the same fact as 0..1 for a bar.
 * Strongest first — the same order the record itself is kept in.
 *
 * WHAT A SCREEN SHOULD DO WITH IT: print every row, not just the bonded ones.
 * A pair two grounds short is the interesting one, because it is the only
 * thing on this entire tab that tells a player something about the NEXT run —
 * take those two out together and they come back changed. A page that showed
 * only finished bonds would hide the whole decision.
 */
export function bondRows(m, company = null) {
  const roll = company?.men || [];
  const by = new Map(roll.map((x) => [x.designation, x]));
  return (m?.bonds || []).slice().sort(strongestFirst).map((b) => {
    const other = by.get(b.with) || null;
    const areas = b.areas | 0;
    return {
      with: b.with,
      name: other ? nameOf(other) : b.with,
      type: other?.type ?? null,
      areas,
      bonded: areas >= BOND_AREAS,
      strength: Math.min(1, areas / BOND_AREAS),
      /* HOW FAR OFF, so the page can say "one more ground" rather than a bar
       * with no number under it. Zero once it is a bond. */
      toGo: Math.max(0, BOND_AREAS - areas),
    };
  });
}

/**
 * WHAT A BOND IS WORTH, as label/value rows, in the two armies' own words.
 *
 * Read straight off the trait table — `Attributes.js` owns the swing and this
 * file must not grow a second copy of it, which is the defect this codebase has
 * removed nine of. The names come from `attrName` so a droid's page says Uplink
 * and Reset where a clone's says Loyalty and Resolve.
 *
 * BOTH HALVES OR NEITHER. `Menu.js`'s trait renderer already refuses to print
 * the give without the take, and this returns them in one list for the same
 * reason: a page that showed "+16 Loyalty" alone would read as a reward for
 * playing a long time, which is exactly the cross-run power this file refuses
 * at the top.
 */
export function bondWorth(kind = 'flesh') {
  const t = traitById(BOND_TRAIT);
  if (!t) return [];
  const rows = [];
  for (const k in (t.up || {})) rows.push([attrName(k, kind), `+${t.up[k]}`]);
  for (const k in (t.down || {})) rows.push([attrName(k, kind), `−${t.down[k]}`]);
  return rows;
}

/** What the pairing costs to say in one line: the threshold, named once. */
export { BOND_AREAS };

/** The marks a screen may offer. Named here so the tab holds no second table. */
export { MARKS };

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
