/**
 * ══════════════════════════════════════════════════════════════════════════
 *  KEEPSAKES — the half of the shop that was missing, and the defect it fixes
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT WAS MEASURED ─────────────────────────────────────────────────────
 *
 * A 9000-credit purse, the clothier at #9, one click on *Oiled leather*
 * (`gloveTone`, 38 cr), all of `localStorage` snapshotted either side of it.
 * Exactly ONE key moved: `saber.credits.v1` `{purse:9000}` →
 * `{purse:8962, spent:38}`. `settings.wardrobe.gloveTone` was −1 before and
 * −1 after. `grep -rn keepsake src/` outside `Counter.js` and `Vendors.js`
 * found four comments and one string, and the `slot`/`value` fields on all
 * forty-one keepsake rows were read by nobody at all.
 *
 * So the whole shop was a credit sink: you could spend 3200 on Beskar plate
 * and own nothing. `Counter.js` priced things, `Credits.js` took the money,
 * `Vendors.js` said what the row was for — and there was no fourth file to
 * put it on. This is the fourth file.
 *
 * ── WHAT A KEEPSAKE IS, WHICH IS NARROWER THAN "A THING YOU BOUGHT" ───────
 *
 * `Progress.js`'s amendment: cosmetic, permanent, MAY NOT CARRY A NUMBER.
 * `Counter.saneRow` refuses `grants`/`mods`/`effect` at the door and
 * `counter.mjs` buys every keepsake in the tree against a live `boonMods` and
 * fails on any movement at all. Nothing here weakens either: this file only
 * ever writes a garment cut, a tone index, a paint id, a hilt style, a piece
 * of furniture or a colour on an animal.
 *
 * ── AND IT IS NOT AN UNLOCK, WHICH IS THE OTHER HALF OF THE DOCTRINE ──────
 *
 * The header this file obeys refuses unlocks in the same breath as currency —
 * *"every crystal, cut, species and order is available from the first run"* —
 * and every tone the clothier sells is already free in the creator. That is
 * not a redundancy, it is the point: buying `tone-glove` does not UNLOCK glove
 * tone 4, it DYES YOUR GLOVES, now, without a menu. The shop is a second,
 * diegetic door onto the wardrobe the creator already opens, and the thing you
 * are paying for is a man in a room doing it for you and it staying done. A
 * keepsake that gated a creator row would be the unlock the doctrine refuses;
 * one that applies a creator row is a haircut.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  WHERE IT IS KEPT, AND WHY THERE IS NO NEW KEY
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `session.mjs` counts `localStorage.setItem` writers across five named files
 * and refuses a fourth, and it is right to: a new durable key is a new thing
 * that crosses a session and whoever adds one has to argue it. `Progress.js`'s
 * `lessons` is the precedent — a new durable FACT in a record that already
 * exists — and this file follows it three times over, because a keepsake is
 * three different kinds of fact wearing one word:
 *
 *   THE LEDGER — what you own — is `settings.keepsakes`, one array of ids in
 *     `saber.settings.v6`. That is the right record and not merely a
 *     convenient one: a keepsake is a COSMETIC PREFERENCE OF THIS PROFILE,
 *     which is the whole subject of that blob, and it is emphatically not a
 *     run record (`saber.progress.v1` refuses anything a run did not do) nor
 *     the station's business (`saber.station.v1` is the clock, the standing
 *     and the room). `coerceSettings` already validates a string list off a
 *     `[]` default, so it arrives sanitised with no new validator.
 *
 *   THE WEARING is written wherever that thing is ALREADY dressed from, and
 *     never anywhere else: cloth and armour paint into `settings.wardrobe`
 *     (`Cloth.wardrobeOf` launders it), the hilt into `settings.hiltStyle`,
 *     furniture into the home's own record inside the station fold, and a
 *     colour on an animal through `Kennel.dressCompanion`, which is the one
 *     door the kennel allows a screen and is grep-pinned to `name` and `look`.
 *
 * Three existing records, each given the kind of fact it already holds, and
 * the count of durable writers in the tree does not move. A `saber.keepsakes`
 * key would have been easier to write and would have been the fourth.
 *
 * ── THE SPLIT IS NOT ARBITRARY: "OWN" AND "WEAR" ARE DIFFERENT QUESTIONS ──
 *
 * You may buy a Narn banner and later put it in a cupboard; you may buy two
 * cape tones and only be wearing one. So the ledger says what the vendor sold
 * you and the dressing records say what you are currently in, and neither can
 * answer the other's question. `owns()` is what a shelf greys a row out with.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  AND EVERY SLOT NAMES A VOCABULARY, WHICH IS THE SECOND DEFECT FIXED HERE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The audit found four `slot:'home'` rows sold against a ten-id catalogue,
 * three of which named nothing — `cloth`, `banner`, `trophy-skull` — and it is
 * a whole CLASS: `cut-sith` named cape cut `'wrap'` (`CAPE_CUTS` is
 * cloak/none/mantle/travel/court), the armourer's paints carried raw hex where
 * `wardrobe.armour` stores a `PAINTS` id, `hilt-scav` named emitter `'scav'`
 * against ten real `HILT_STYLES`, and six of the armourer's rows named trooper
 * kit fields the player's wardrobe has no place to store at all. TWENTY-THREE
 * of the forty-one keepsake rows in the tree — measured by running the table
 * below over the shipped `Vendors.js` — could not have been worn by anybody
 * even once the wiring existed.
 *
 * The check for that could not have been written against a hand-typed list —
 * `counter.mjs` says so itself, one clause up, about slots. So `WEARERS` is
 * the table, it is the only thing that writes, its `ids()` come off the game's
 * own tables, and `counter.mjs` asserts every row in `Vendors.js` against it.
 * A row naming a value the game cannot wear now fails at the suite rather than
 * at the counter.
 */

import { CAPE_CUTS, TABARD_CUTS, SASH_CUTS, WAIST_CUTS, HAIR_TAILS, GARMENT_TONES,
  wardrobeOf } from './Cloth.js';
import { TOP_CUTS, HOOD_CUTS, ARMOUR_KITS, PAINTS } from './Bodies.js';
import { HILT_STYLES } from './Saber.js';
import { MARKS } from './Command.js';
import { CATALOGUE, deliverPiece } from './Home.js';
import { load as loadKennel, dressCompanion, LOOK_SLOTS } from './Kennel.js';

const ids = (rows) => rows.map((r) => r.id);

/** Every garment tone is an index into one table, and −1 is "the default". */
const TONE_MAX = GARMENT_TONES.length - 1;

/**
 * ══ THE TABLE ═════════════════════════════════════════════════════════════
 *
 * One row per slot a keepsake may name. `on` is which record dresses it, and
 * everything else is the vocabulary its `value` must be in — read off the
 * game's own tables at import, never typed, so a cut renamed in `Cloth.js`
 * fails the suite here instead of shipping a row nothing wears.
 *
 * `pet` is ONE slot and not eleven, because the kennel's colour slots collide
 * with the armour's by name (both have a `plate`) and a shop row is not the
 * place to disambiguate that. Its value is a one-key patch onto the animal's
 * look, which is exactly the shape `dressCompanion` already takes.
 */
export const WEARERS = {
  /* ── cloth: cuts, then tones. `Cloth.wardrobeOf` is the launderer. ────── */
  cape: { on: 'wardrobe', of: () => ids(CAPE_CUTS) },
  top: { on: 'wardrobe', of: () => ids(TOP_CUTS) },
  tabard: { on: 'wardrobe', of: () => ids(TABARD_CUTS) },
  sash: { on: 'wardrobe', of: () => ids(SASH_CUTS) },
  waist: { on: 'wardrobe', of: () => ids(WAIST_CUTS) },
  hood: { on: 'wardrobe', of: () => ids(HOOD_CUTS) },
  hair: { on: 'wardrobe', of: () => ids(HAIR_TAILS) },
  capeTone: { on: 'wardrobe', tone: true },
  tunicTone: { on: 'wardrobe', tone: true },
  tabardTone: { on: 'wardrobe', tone: true },
  sashTone: { on: 'wardrobe', tone: true },
  bootTone: { on: 'wardrobe', tone: true },
  gloveTone: { on: 'wardrobe', tone: true },
  /* ── armour: the four fields `Cloth.armourSheet` actually stores. ─────── */
  kit: { on: 'armour', field: 'id', of: () => ids(ARMOUR_KITS) },
  helm: { on: 'armour', field: 'helmet', bool: true },
  plate: { on: 'armour', field: 'plate', of: () => ids(PAINTS) },
  accent: { on: 'armour', field: 'accent', of: () => ids(PAINTS) },
  visor: { on: 'armour', field: 'visor', of: () => ids(PAINTS) },
  /* ── the hilt, which is one top-level setting and ten real styles. ────── */
  hilt: { on: 'saber', of: () => HILT_STYLES.slice() },
  /* ── furniture, delivered rather than worn. See `deliverPiece`. ───────── */
  home: { on: 'home', of: () => ids(CATALOGUE) },
  /* ── and the animal. One patch, validated again by `Kennel.saneLook`. ─── */
  pet: { on: 'pet', patch: true },
};

export const SLOTS = Object.keys(WEARERS);

/** Which paint ids a companion slot will take. `mark` is its own table. */
const PAINT_IDS = () => ids(PAINTS);
const MARK_IDS = () => ids(MARKS);

/**
 * Is this keepsake one the game can actually put on somebody?
 *
 * Returns null for "no", and the reason is worth having in the failure
 * message rather than a boolean, because every one of the twenty-three rows
 * caught was wrong in a different way.
 */
export function wearable(row) {
  if (!row || row.kind !== 'keepsake') return null;
  const w = WEARERS[row.slot];
  if (!w) return null;
  const v = row.value;
  if (w.tone) return (Number.isInteger(v) && v >= 0 && v <= TONE_MAX) ? w : null;
  if (w.bool) return (v === true || v === false) ? w : null;
  if (w.patch) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const keys = Object.keys(v);
    if (keys.length !== 1) return null;
    const [k] = keys;
    if (k === 'mark') return MARK_IDS().includes(v.mark) ? w : null;
    if (!LOOK_SLOTS.includes(k)) return null;
    return PAINT_IDS().includes(v[k]) ? w : null;
  }
  return w.of().includes(v) ? w : null;
}

/** Why a row is not wearable, in words. Only a check and a warning use it. */
export function whyNotWearable(row) {
  if (!row || row.kind !== 'keepsake') return 'not a keepsake';
  const w = WEARERS[row.slot];
  if (!w) return `slot "${row.slot}" is not one anything wears`;
  if (w.tone) return `tone ${row.value} is outside 0..${TONE_MAX}`;
  if (w.bool) return `${row.value} is not true or false`;
  if (w.patch) return `${JSON.stringify(row.value)} is not one { lookSlot: paintId } pair`;
  return `"${row.value}" is not one of ${w.of().join('/')}`;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE LEDGER — one array, in the record that already holds your costume     */
/* ══════════════════════════════════════════════════════════════════════════ */

/** Everything the vendors have ever sold you. Never null. */
export function ownedIds(settings) {
  const v = settings?.keepsakes;
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

/** Do you already have this one? What a shelf greys a row out with. */
export function owns(settings, id) { return ownedIds(settings).includes(id); }

/**
 * ══ THE ONE DOOR ══════════════════════════════════════════════════════════
 *
 * Takes the live settings object rather than reaching for `loadSettings`, and
 * that is not a style choice: `main.js` holds ONE settings object for the life
 * of the page and writes it back with `saveSettings`, so a second reader that
 * loaded its own copy and saved it would be overwritten by the next thing the
 * player changed in the menu. One object, one owner, one save.
 *
 * The caller saves. This mutates and reports; `main.js` calls `saveSettings`
 * on the same line, which is where every other setting in the game is written.
 *
 * The two records this file does NOT hold — the home and the kennel — are
 * written through their own doors HERE, because they are not in `settings` and
 * a caller cannot save them for us. That asymmetry is real and is named rather
 * than smoothed over: a cape is a setting, a crate is furniture.
 */
export function takeKeepsake(settings, row) {
  if (!settings || typeof settings !== 'object') return { ok: false, why: 'no settings' };
  const w = wearable(row);
  if (!w) return { ok: false, why: whyNotWearable(row) };

  let said = null;
  if (w.on === 'wardrobe') {
    /* Laundered on the way in as well as on the way out: `wardrobeOf` is the
     * one authority on the shape, and a blob written by an older build is
     * missing keys this is about to index. */
    settings.wardrobe = wardrobeOf(settings.wardrobe);
    settings.wardrobe[row.slot] = row.value;
    said = 'you are wearing it';
  } else if (w.on === 'armour') {
    settings.wardrobe = wardrobeOf(settings.wardrobe);
    settings.wardrobe.armour = { ...settings.wardrobe.armour, [w.field]: row.value };
    /**
     * A PAINT ON NO ARMOUR IS A PAINT ON NOTHING, and the shipped figure wears
     * none — `WARDROBE.armour.id` is `'none'`, which is a Jedi in robes. So a
     * row that paints plate puts you in the line kit if you are not already in
     * one, because the alternative is a vendor taking 3200 credits for beskar
     * and the player seeing no change at all, which is the exact defect this
     * file exists to end. Choosing a KIT (`slot: 'kit'`) never does this: that
     * row is the player saying what they want to be in.
     */
    if (w.field !== 'id' && settings.wardrobe.armour.id === 'none') {
      settings.wardrobe.armour.id = 'line';
      said = 'painted onto the plate — and you are in plate now';
    } else said = 'painted on';
  } else if (w.on === 'saber') {
    settings.hiltStyle = row.value;
    said = 'it is on your belt';
  } else if (w.on === 'home') {
    /* Not placed here and deliberately: the parcel goes in the home's own
     * `store.parcels` — the field V16 §3.2 reserved for exactly this — and
     * `Home.dressHome` puts it on the floor when you next walk in, because
     * that is the only code in the tree that knows where the partition is. */
    const got = deliverPiece(row.value);
    if (!got.ok) return { ok: false, why: got.why };
    said = 'it will be in your cabin';
  } else if (w.on === 'pet') {
    const k = loadKennel();
    if (!k.live) return { ok: false, why: 'you have nothing to put it on' };
    dressCompanion(k.live.id, { look: { ...(k.live.look || {}), ...row.value } });
    said = `${k.live.name || 'it'} is wearing it`;
  }

  /* THE LEDGER LAST, so a refused delivery is not recorded as a sale. */
  const have = ownedIds(settings);
  if (!have.includes(row.id)) have.push(row.id);
  settings.keepsakes = have;
  return { ok: true, why: null, said, owned: have.length };
}
