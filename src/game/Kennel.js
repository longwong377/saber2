/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — THE KENNEL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "if they surive they need to persist between runs/games like your troops do"
 *
 * ── WHY THIS IS ITS OWN STORE AND NOT A FIELD ON THE COMPANY ──────────────
 *
 * `Company.js` is keyed by ARMY. `load()` keys on army, and `keep()` refuses a
 * foreign manifest outright (Company.js:683) — the roll belongs to the force
 * you fight for. A companion belongs to the PLAYER: he takes the same animal
 * into a Republic campaign and a Separatist skirmish, and it is the same
 * animal. Hanging it off the army record would mean either twelve records for
 * one dog or reopening the one refusal that keeps the two rolls honest.
 *
 * So: Company.js's SHAPE is copied and Company.js is NOT extended. Same store
 * policy, same clamp-on-the-way-in discipline, same field whitelist on the way
 * out, same fallen list. A different key and a different owner.
 *
 * ── THE TWO SCANS THAT DO NOT SEE THIS FILE, EXTENDED ON THIS COMMIT ──────
 *
 * `tools/checks/company.mjs` runs the six-word currency scan
 * (points|currency|purchase|upgrade|unlock|buy) on Company.js and Muster.js BY
 * PATH; `session.mjs` counts `localStorage.setItem` inside five NAMED files.
 * A new file is invisible to both and therefore legal by default, and
 * COMPANY.md:377 already states the rule for exactly this class of silence:
 * "That silence is a hazard, not a permission."
 *
 * Both scans are extended to this file and to Companions.js on the commit that
 * creates them, or the next person adds a currency here and nothing goes red.
 * This is the single most important sentence in the file.
 *
 * ── AND THERE IS NO ATOMIC MULTI-KEY WRITE ────────────────────────────────
 *
 * Store.js writes one JSON object under one key, so a fold that touches the
 * roll and the Kennel is two independent `setItem` calls, either of which can
 * be refused alone. The mitigation is ordering, stated rather than hoped for:
 * the companion fold runs FIRST and INDEPENDENTLY, so a partial failure costs
 * a companion record and never a man. The Kennel is the only writer of its key,
 * exactly as Company is of its.
 */
import { makeStore } from './Store.js';
import { markById } from './Command.js';
/* THE BODY PALETTE, and it is NOT the squad-mark palette. `PAINTS` is the
 * fifteen colours a chassis is painted in and `paintById` answers null for
 * "leave the chassis its own", which is exactly the default every companion
 * colour slot needs; `MARKS` is the nine squad marks and is right for the one
 * `mark` a companion wears. Two palettes because they are two things, and both
 * are the roll's own rather than a third copy. */
import { paintById } from './Bodies.js';
/* `cleanCallsign` is the roll's own name-cleaner and it already strips the six
 * characters five screens would otherwise have to escape correctly. One
 * cleaner in the tree — HANDOFF §2.4 — so it is imported and never copied,
 * even though this is the only thing this file takes from Company.js. */
import { cleanCallsign } from './Company.js';
import { COMPANION_KINDS, rungOf } from './CompanionKinds.js';

const KEY = 'saber.kennel.v1';

/**
 * THE STORE, with the same policy the roll uses and for the same reason: a
 * refused write is REMEMBERED for the life of the page rather than thrown away
 * under a comment saying losing a record is not a crash. It is not a crash and
 * it is worse than one — the animal stays on screen, the player keeps fighting
 * for it, and it is already gone.
 */
const STORE = makeStore(KEY);

/** True when a write has been refused. Every room that shows a companion reads this. */
export const notSaving = () => STORE.broken;

/**
 * HOW MANY LINES OF ITS OWN HISTORY THE RECORD KEEPS — the same cap the roll
 * uses, called rather than restated. Most of the felt growth lives here,
 * because it is the only layer that costs nothing: nothing that fights reads a
 * word of `story`.
 */
export const STORY_KEEP = 8;

/** How many epitaphs are kept. Short on purpose: a wall, not a ledger. */
export const FALLEN_KEEP = 6;

/**
 * ── THE TEMPERS ───────────────────────────────────────────────────────────
 *
 * Four earned, TWO-SIDED, shedding tempers, on the `bonded` precedent
 * (Attributes.js:325 — `earned: true` plus a real `sheds`).
 *
 * THEY LIVE HERE AND NOT IN Attributes.js, for two reasons that were both
 * checked rather than assumed. `attributes.mjs` requires every attribute id to
 * have a real sim consumer inside `enlistBody`, and a companion never enters
 * `enlistBody` at all. And `kindOfArmy` derives kind from an ARMY id a rancor
 * pup does not have, so `traitsFor` would deal a hawk the clone table.
 *
 * EACH SWINGS ONLY THE COMPANION'S OWN TWO BEHAVIOUR NUMBERS — how long it
 * holds an order (`hold`, seconds) and how far it will break from station to
 * take one (`brk`, metres). Neither is health, damage, armour or pace: see
 * COMPANION_RANKS' note on why no rung row carries a multiplier at all. A
 * temper that raised any of those four would be the ladder's refusal reopened
 * one table across.
 *
 * AND EVERY ONE IS PRICED NET ≤ 0. That is what "two-sided" has to mean to be
 * worth anything: the gain and the cost are both real, both felt, and the sum
 * is not a gift. `priceTemper` is the formula and the check drives it rather
 * than transcribing the numbers.
 */
export const TEMPERS = [
  {
    id: 'heeled', label: 'HEELED', earn: 'three runs at your heel',
    /* THE GAIN AND THE COST ARE THE SAME BEHAVIOUR READ FROM THE TWO ENDS,
     * which is the honest shape for this one: an animal that has learned to
     * come back is an animal that has learned not to go. */
    up: { recall: 3.0 }, down: { reach: 3.0 }, sheds: 'ranging',
    gain: 'returns to heel faster and from further',
    cost: 'will no longer range to a target past that tighter leash',
  },
  {
    id: 'scarred', label: 'SCARRED', earn: 'went down twice and lived',
    up: { hold: 1.5 }, down: { reach: 4.0 }, sheds: null,
    gain: 'slower to go down a second time in the same run',
    cost: 'breaks off an attack when it is hit',
  },
  {
    id: 'keen', label: 'KEEN', earn: 'twelve orders landed',
    /* THE ONE WHERE THE GAIN IS LITERALLY THE COST. Four more metres of reach
     * is four more metres from you when it is hurt, and the player's own
     * sentence for it — "which is exactly how it gets killed" — is not a
     * warning printed beside a free upgrade, it is the price. Priced on the
     * same axis at the same magnitude, so it nets to nothing: KEEN does not
     * make a companion better, it makes it braver. */
    up: { reach: 4.0 }, down: { exposure: 4.0 }, sheds: null,
    gain: 'acts sooner and takes a target a quarter further out',
    cost: 'which is exactly how it gets killed',
  },
  {
    id: 'ranging', label: 'RANGING', earn: 'five runs spent beyond twelve metres',
    /* WARD IS PRICED IN METRES AND NOT AS A FRACTION. Half again on the median
     * ward in the table (9 m on the massiff) is 4.5 m of extra ring, and 4.5 m
     * of ring is a thing that can be compared with 6 m of loosened heel. "+50%"
     * cannot be compared with anything, which is how a free temper gets past a
     * price check wearing a percentage. */
    up: { ward: 4.5 }, down: { recall: 6.0 }, sheds: 'heeled',
    gain: 'its ward reaches half again as far',
    cost: 'its heel tolerance loosens, so it drifts',
  },
];

/**
 * ── THE AXES, AND WHY THIS IS NOT `priceSwing` ────────────────────────────
 *
 * `tools/checks/attributes.mjs` exports `priceSwing`, and the instinct is to
 * call it rather than write a second currency — HANDOFF §2.4 in one line. It
 * does not fit, and the reason is the same one that formula's own note gives:
 * "POINTS ARE NOT COMPARABLE ACROSS AXES." `priceSwing` prices ATTRIBUTE
 * points as a fraction of each attribute's own multiplier range, and a
 * companion's tempers do not move an attribute at all — they move seconds and
 * metres, on a body that never enters `enlistBody`.
 *
 * So this is the same FORMULA in a different currency, written in the same
 * shape (`up`/`down` as positive magnitudes, exactly as a trait declares them,
 * so `traitSwing`'s reader shape carries over) and stated rather than smuggled:
 * each magnitude is priced as the fraction of its own axis's span that it buys.
 *
 *   hold      seconds an order survives you walking away.       span 8 s
 *   reach     metres from station it will break to take a target. span 20 m
 *   recall    metres from which it comes home fast.              span 20 m
 *   ward      metres of standing ring round YOU.                 span 20 m
 *   exposure  metres of extra distance-from-you, as a liability. span 20 m
 *
 * `reach`, `recall`, `ward` and `exposure` share one span because they are all
 * metres on the same ground. That is the point of the table: they are
 * comparable, and a temper cannot buy four metres of one with a percentage of
 * another.
 *
 * NOT ONE OF THEM IS HEALTH, DAMAGE, ARMOUR OR PACE. See COMPANION_RANKS' note
 * on why no rung row carries a multiplier at all: a temper that raised any of
 * those four would be the ladder's refusal reopened one table across, and the
 * check asserts the axis list rather than trusting this sentence.
 */
export const TEMPER_AXES = { hold: 8, reach: 20, recall: 20, ward: 20, exposure: 20 };

function priceSide(side) {
  let net = 0;
  for (const a in (side || {})) {
    const span = TEMPER_AXES[a];
    /* AN UNKNOWN AXIS IS INFINITELY EXPENSIVE, not free. A temper that names
     * an axis this table does not price would otherwise contribute zero and
     * sail through a net-≤-0 check while doing whatever it liked. */
    if (!span) return Infinity;
    net += Math.abs(Number(side[a]) || 0) / span;
  }
  return net;
}

/**
 * WHAT A TEMPER IS WORTH, NET, AND IT MUST NOT BE POSITIVE.
 *
 * The shape is `attributes.mjs:353`'s own — `priceSwing(t.up)` against
 * `priceSwing(traitSwing({ down: t.down }))` — and the check drives this
 * function over the real table rather than transcribing four numbers.
 */
export function priceTemper(t) {
  if (!t) return 0;
  return priceSide(t.up) - priceSide(t.down);
}

const TEMPER_BY_ID = TEMPERS.reduce((o, t) => { o[t.id] = t; return o; }, {});
export const temperById = (id) => TEMPER_BY_ID[id] || null;


/* ── the record ──────────────────────────────────────────────────────── */

/** A blank Kennel. An absent key reads as this and never as a crash. */
export function blank() {
  return { live: null, fallen: [], runs: 0, lost: 0 };
}

const num = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * ONE COMPANION OFF DISK, MADE SAFE.
 *
 * Every field clamped on the way IN, exactly as `readMan` clamps the living
 * (Company.js:366) and for the same stated reason: a hand-edited save is where
 * this has to stop, not where it has to be trusted. Two clamps here are the
 * ones that would actually be FELT rather than merely wrong —
 *
 *   `xp`      a stored 5000 is a companion that starts SWORN, which is the
 *             whole ladder handed over by editing one number.
 *   `scale`   is NOT STORED AT ALL, and that is deliberate. The rancor pup's
 *             size reads off `runs`, so it is derived and a derived field in a
 *             save file is a second source of truth. A stored scale is a pup
 *             filling the screen.
 *
 * An unreadable record is `null` — no companion — rather than a repaired one.
 * A companion is a named thing the player will grieve; inventing one from
 * rubble is worse than saying it is gone.
 */
export function readOne(r) {
  if (!r || typeof r !== 'object') return null;
  if (typeof r.kind !== 'string' || !COMPANION_KINDS[r.kind]) return null;
  if (typeof r.id !== 'string' || !r.id) return null;
  return {
    id: r.id,
    kind: r.kind,
    name: cleanCallsign(r.name) || null,
    look: saneLook(r.look),
    xp: Math.max(0, Math.min(999, num(r.xp, 0))),
    runs: Math.max(0, num(r.runs, 0) | 0),
    areas: Math.max(0, num(r.areas, 0) | 0),
    kills: Math.max(0, num(r.kills, 0) | 0),
    saves: Math.max(0, num(r.saves, 0) | 0),
    downs: Math.max(0, num(r.downs, 0) | 0),
    orders: Math.max(0, num(r.orders, 0) | 0),
    ranged: Math.max(0, num(r.ranged, 0) | 0),
    since: typeof r.since === 'string' ? r.since : null,
    tempers: Array.isArray(r.tempers)
      ? [...new Set(r.tempers.filter((t) => typeof t === 'string' && TEMPER_BY_ID[t]))].slice(0, 4)
      : [],
    story: Array.isArray(r.story)
      ? r.story.filter((s) => typeof s === 'string').slice(-STORY_KEEP) : [],
    /* SCARS ARE NOT CHOSEN. They are what happened to it, on the `scorchUp`
     * precedent (Command.js:10466), and there is no door that removes one. A
     * companion the player designed is a costume; a companion the player named
     * and the game marked is a history. */
    scars: Array.isArray(r.scars)
      ? r.scars.filter((s) => typeof s === 'string').slice(0, 6) : [],
  };
}

/**
 * ITS LOOK, made safe. IDS ONLY — never colours — so a re-tuned palette
 * reaches the companions already wearing it, and an id from an older build
 * that this one does not have is DROPPED rather than silently painting
 * nothing. `markById` is the one validator and it is the roll's own.
 */
function saneLook(look) {
  if (!look || typeof look !== 'object') return {};
  const out = {};
  for (const k of ['hide', 'plate', 'belly', 'eye', 'shell', 'trim',
    'photoreceptor', 'panels', 'pelt', 'braid', 'blanket']) {
    if (typeof look[k] !== 'string') continue;
    /* `paintById` answers null for an id this build does not have, and a
     * dropped slot is the chassis's own colour — which is the honest failure.
     * A body that silently painted nothing would be a player's choice quietly
     * deleted, which is the sentence `Company.dress` uses for the same case. */
    const p = paintById(look[k]);
    if (p) out[k] = p.id;
  }
  if (typeof look.mark === 'string') {
    const m = markById(look.mark);
    if (m.color != null) out.mark = m.id;
  }
  return out;
}

/**
 * THE WHITELIST ON THE WAY OUT, AND IT KEEPS `false`.
 *
 * `save` drops `null` and `undefined` and nothing else, exactly as Company.js's
 * own field loop does (:563) — a `false` that got dropped because the loop
 * tested truthiness is a stored boolean that silently reverts to its default
 * on every load, and that is a bug this repository has already paid for once.
 *
 * NOTHING DERIVED IS STORED. The rung is derived from xp, the pace from the
 * kind, the scale from runs. A derived field on disk is a second source of
 * truth that goes stale the first time the formula changes.
 */
const COMPANION_FIELDS = ['id', 'kind', 'name', 'look', 'xp', 'runs', 'areas',
  'kills', 'saves', 'downs', 'orders', 'ranged', 'since', 'tempers', 'story', 'scars'];

/** One epitaph off disk, made safe — the `saneFallen` pattern (Company.js:317). */
function saneEpitaph(f) {
  if (!f || typeof f.kind !== 'string') return null;
  return {
    kind: f.kind,
    name: cleanCallsign(f.name) || null,
    where: typeof f.where === 'string' ? f.where : null,
    killer: typeof f.killer === 'string'
      ? f.killer.replace(/[<>&`\\]/g, '').slice(0, 40) : null,
    at: Number.isFinite(f.at) ? Math.max(0, Math.min(999, f.at | 0)) : null,
    runs: Math.max(0, num(f.runs, 0) | 0),
    /* HOW IT STOPPED BEING YOURS. `kia` is a death; `left` is the ramp sealing
     * with it standing on the ground. Those are different things to have done
     * to something, and a list that cannot tell them apart teaches neither.
     * The same two words the roll uses, for the same reason. */
    fate: f.fate === 'left' ? 'left' : 'kia',
  };
}

export function load() {
  const raw = STORE.read();
  const b = blank();
  return {
    live: readOne(raw?.live),
    fallen: Array.isArray(raw?.fallen)
      ? raw.fallen.map(saneEpitaph).filter(Boolean).slice(0, FALLEN_KEEP) : b.fallen,
    runs: Math.max(0, num(raw?.runs, 0) | 0),
    lost: Math.max(0, num(raw?.lost, 0) | 0),
  };
}

export function save(k) {
  const live = k?.live ? (() => {
    const out = {};
    for (const f of COMPANION_FIELDS) if (k.live[f] !== undefined && k.live[f] !== null) out[f] = k.live[f];
    return out;
  })() : null;
  STORE.write({
    live,
    fallen: (k?.fallen || []).slice(0, FALLEN_KEEP),
    runs: k?.runs | 0,
    lost: k?.lost | 0,
  });
  return k;
}

/**
 * A DELETE DOOR WITH A REAL CALLER, WHICH NOTHING DURABLE IN THIS TREE HAS.
 *
 * `Company.clear`, `Muster.clear` and `clearProgress` are all exported with
 * ZERO callers anywhere in `src/` — three delete doors nobody can open. A
 * companion is the first durable record a player will genuinely want to
 * destroy: one they regret naming, one they want to start over with. This
 * ships with a hold-to-confirm control on the Kennel page, and the check
 * asserts the caller exists rather than the export.
 *
 * `drop()` clears the mirror as well as the disk, so a player's own delete is
 * not undone by a memory of what used to be there.
 */
export function clear() {
  STORE.drop();
  return blank();
}

/* ── growth ──────────────────────────────────────────────────────────── */

/**
 * WHAT A DEED IS WORTH, on `Trooper.award()`'s shape (Command.js:3282).
 *
 * The gates are 0 / 6 / 16 / 30 and they put rung 3 at roughly 60-70% of one
 * long campaign. Two clauses are copied from `tools/checks/command.mjs:845` and
 * DRIVEN rather than transcribed: the top rung must be reachable inside one
 * run, and not before 40% of it. That satisfies Company.js:28's own amendment
 * exactly — a thing may cross runs if a single run could have produced it
 * unaided; persistence is a shortcut to a ceiling and never a new ceiling.
 */
export const DEEDS = {
  /** An area crossed with it alive and inside the leash at the transition. */
  crossed: 1,
  /** The first time per area that an order you gave it actually lands. */
  order: 1,
  /** It reached you while you were down. */
  reached: 2,
  /** It survived an area in which it went down and you picked it up. */
  recovered: 2,
};

export function award(rec, deed, n = 1) {
  if (!rec) return rec;
  const w = DEEDS[deed];
  if (!w) return rec;
  rec.xp = Math.max(0, Math.min(999, (Number(rec.xp) || 0) + w * n));
  return rec;
}

/** Which tempers this record has earned but is not yet wearing. */
export function earnedTempers(rec) {
  if (!rec) return [];
  const has = new Set(rec.tempers || []);
  const out = [];
  const want = {
    heeled: (r) => (r.runs || 0) >= 3 && (r.ranged || 0) < 3,
    scarred: (r) => (r.downs || 0) >= 2,
    keen: (r) => (r.orders || 0) >= 12,
    ranging: (r) => (r.ranged || 0) >= 5,
  };
  for (const t of TEMPERS) {
    if (has.has(t.id)) continue;
    if (want[t.id]?.(rec)) out.push(t);
  }
  return out;
}

/**
 * HANG WHAT IT HAS EARNED AND SHED WHAT THAT CONTRADICTS.
 *
 * `sheds` is the `bonded` precedent's own field and it is the reason two
 * tempers that mean opposite things cannot both be worn: HEELED is an animal
 * that has learned to stay, RANGING is one that has learned to go, and a
 * record wearing both would be describing nothing.
 */
export function applyTempers(rec) {
  if (!rec) return rec;
  const set = new Set(rec.tempers || []);
  for (const t of earnedTempers(rec)) {
    set.add(t.id);
    if (t.sheds) set.delete(t.sheds);
  }
  rec.tempers = [...set].slice(0, 4);
  return rec;
}

/**
 * THE TWO BEHAVIOUR NUMBERS, AFTER EVERY TEMPER IT WEARS.
 *
 * One reader, so nothing anywhere adds up a temper's swing itself. Returns the
 * DELTAS; the pack adds them to the kind's own numbers, which is where the
 * base belongs.
 */
export function temperSwing(rec) {
  const out = { hold: 0, reach: 0, recall: 0, ward: 0, exposure: 0 };
  for (const id of rec?.tempers || []) {
    const t = TEMPER_BY_ID[id];
    if (!t) continue;
    for (const a in (t.up || {})) out[a] = (out[a] || 0) + Math.abs(t.up[a]);
    for (const a in (t.down || {})) out[a] = (out[a] || 0) - Math.abs(t.down[a]);
  }
  return out;
}

/* ── the write door for cosmetics ────────────────────────────────────── */

/**
 * THE ONE DOOR THE SCREENS CHANGE A LOOK THROUGH — its own, and separate from
 * `Company.dress` on purpose.
 *
 * `tools/checks/company.mjs:1102` greps the BODY of `export function dress` and
 * pins its fields to exactly `band,callsign,kit,mark,paint`; a sixth goes red.
 * That pin is the cosmetics-only line for the roll, and routing a companion
 * through `dress` would either break it or force it open. So this is a
 * separate exported function with ITS OWN equivalent grep-pin, written on the
 * same commit — or the cosmetics-only line has a hole in it exactly the width
 * of this feature.
 *
 * WHAT IT MAY WRITE: a name, a mark, and the colour slots the kind's own
 * builder actually reads. Nothing else on the record — xp, runs, kills, downs,
 * tempers, scars — is reachable from a screen, for `dress`'s stated reason:
 * those are written by the game, from a run, and a screen that could edit them
 * would make the page a cheat panel.
 */
export function dressCompanion(id, look = {}) {
  const k = load();
  if (!k.live || k.live.id !== id) return k;
  const K = COMPANION_KINDS[k.live.kind];
  if (!K) return k;
  if ('name' in look) {
    const nm = cleanCallsign(look.name);
    if (nm) k.live.name = nm; else k.live.name = null;
  }
  /* WHOLE-OBJECT, like `dress`'s kit: the screen sends what it wears now and
   * this writes it, so clearing a slot is the same call as choosing one. And
   * `saneLook` drops any slot this kind's builder would not read, so a control
   * that cannot be offered cannot be stored either. */
  if ('look' in look) k.live.look = saneLook(look.look);
  return save(k);
}

/* ── the fold ────────────────────────────────────────────────────────── */

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  DID IT GET OUT?
 * ══════════════════════════════════════════════════════════════════════════
 *
 * THE TEST IS WRITTEN OUT IN FULL BECAUSE THE DEFAULT IS SILENT IMMORTALITY.
 *
 * `Company.keep` strikes off every DEPLOYED name not on the manifest
 * (Company.js:774) — but a companion is on no roster, so it is invisible to
 * that rule and would simply never die. That is precisely the defect
 * `company.mjs:430` names about bonds: a mechanism with its price quietly
 * removed and nothing on any screen to say so.
 *
 * SO THE RULE IS:
 *
 *     it persists IF AND ONLY IF it is ALIVE
 *     AND (the run was WON  OR  the pack's own `aboard` flag is set)
 *
 * Dead, downed at the fold, or standing on the ground when the ramp sealed —
 * gone, live record cleared, one epitaph kept. THERE IS NO BRANCH FOR A RUN
 * THAT WENT BADLY, because a run that went badly is exactly when a player
 * would want one.
 *
 * WHY THE `aboard` FLAG AND NOT THE MANIFEST. Verified: `Extraction.manifest`
 * is `this._seated.map((b) => b.trooper).filter(Boolean)` (Extraction.js:956),
 * so a companion boards the ship and then does not exist on the list that
 * decides who survived. That one `filter(Boolean)` is the whole gap between
 * "the companion got on the ship" and "the companion is there next run" — and
 * `keep()` reads exactly that array and may not be reopened. So the manifest
 * is left BYTE-IDENTICAL and the pack keeps its own flag.
 *
 * WHY IT CANNOT RIDE `bank()`. `bank()` returns early on
 * `!d || d.deck || d.versus || session` (main.js:1774), so it never fires in a
 * duel, the dojo, the sandbox, a roguelite with no contingent, the hangar or
 * co-op. The brief says the companion is with you the whole time; that sentence
 * and this guard cannot both be true through `bank()`. `record()`'s call site
 * is the right shape and is what this copies: it fires everywhere, once per
 * world, from BOTH endings.
 *
 * AND `quitToMenu` MUST FOLD. On the same terms `bank()` is called there with
 * no stats: if quitting is the safe way to keep a companion alive, the
 * withdrawal has been reopened by the back door, and REVIEW-V12.md:114 forbids
 * that in as many words. `leaveHangar` must NOT — walking off the deck is not
 * a run, exactly as it already skips `record()` and `bank()`.
 */
export function keepCompanion(world, stats = null) {
  /* `_companions` IS THE PACK'S NAME, and reading `_companion` was a silent
   * false: the guard passed on a truthy marker, `pack.body0` came back
   * undefined, and every surviving companion was folded as dead. The check
   * caught it as "alive and won: kept=false". One name. */
  const pack = world?._companions;
  if (!pack) return null;
  /* CO-OP DOES NOT FOLD, and it is said on the lobby card before you join
   * rather than discovered afterwards. No bond earned, no death recorded, no
   * epitaph, and a client's stored companion is untouched — it neither gains a
   * run nor loses its life. The conservative answer, and the only one that
   * cannot cause a durable loss the player did not cause. */
  if (world.netMode) return null;
  const k = load();
  const rec = k.live;
  if (!rec) return null;

  const body = pack.body0 || null;
  const alive = !!body && !body.dead && !body.downed;
  const won = !!stats?.won;
  const out = alive && (won || !!pack.aboard);

  k.runs = (k.runs | 0) + 1;
  if (out) {
    rec.runs = (rec.runs | 0) + 1;
    applyTempers(rec);
    save(k);
    return { kept: true, rec };
  }

  k.lost = (k.lost | 0) + 1;
  k.fallen.unshift(saneEpitaph({
    kind: rec.kind,
    name: rec.name,
    where: world?.settings?.level || null,
    killer: pack.lastKiller || null,
    at: Math.round((world?.elapsed || 0) / 60),
    runs: rec.runs,
    /* THE RAMP SEALED WITH IT STANDING THERE is `left`, and being killed is
     * `kia`. `alive` decides, because a companion that is alive and did not
     * get out was abandoned rather than lost. */
    fate: alive ? 'left' : 'kia',
  }));
  k.fallen = k.fallen.filter(Boolean).slice(0, FALLEN_KEEP);
  k.live = null;
  save(k);
  return { kept: false, rec };
}

/**
 * PUT A FRESH ANIMAL IN THE KENNEL. One live record, ever — there is no second
 * slot and there never will be, earned or bought: a companion that adds a body
 * to the line is `company.mjs`'s "rank, not headcount" defect with fur on it.
 */
export function adopt(kind, name = null, look = {}) {
  if (!COMPANION_KINDS[kind]) return null;
  const k = load();
  k.live = readOne({
    id: `c${Math.random().toString(36).slice(2, 10)}`,
    kind, name, look, xp: 0, runs: 0, since: new Date().toISOString().slice(0, 10),
  });
  save(k);
  return k.live;
}

/** The rung a live record stands on. Re-exported so no screen imports two files. */
export { rungOf };
