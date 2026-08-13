/**
 * THE ORDER — Jedi, Sith, or Grey.
 *
 * The game had exactly one identity: ten crystals, five hilts and six robe
 * palettes, none of which meant anything. You could build a red-bladed figure in
 * black and the game called you a Jedi, gave you the Jedi's numbers, and drew
 * the Jedi's blade. This file is what makes the choice cost something.
 *
 * IT IS DELIBERATELY NOT A DIFFICULTY SLIDER AND NOT A PALETTE. Three things
 * carry the difference and every one of them lands on code that was already
 * being read every frame before this file existed:
 *
 *   THE CRYSTAL   Each order can reach a different set of the ten, and the sets
 *                 are decided by where a crystal comes from rather than by
 *                 taste. A Jedi's is attuned — it is alive and it picked them.
 *                 A Sith's is bled — a stolen crystal made to scream, which is
 *                 why every one of theirs is in the red family and why the one
 *                 that was bled too hard (Void) is nearly black. A Grey has
 *                 neither: they take a bled crystal off a body and HEAL it, and
 *                 a healed crystal comes back white. That is why Ivory belongs
 *                 to the Grey alone — a Jedi's crystal was never bled and so
 *                 cannot be purified, and a Sith would not — and it is why the
 *                 Grey has no blue and no green at all. They never went to a
 *                 temple. Every blade they carry is salvage.
 *
 *   THE BLADE     Saber.BLADE_TUNING, which is the physics half and lives with
 *                 the physics. Measured, per lobe, in tools/checks/order.mjs.
 *
 *   THE NUMBERS   applyOrder() below. Every field it writes already had a reader
 *                 in Player, World, Duel or Combat before this file was written
 *                 — `forceCost` in Player._spend, `cutPower` in the blade
 *                 solver, `returnCone` in gradeCaught, `lifesteal` on a severed
 *                 limb, `lightning` on the key that fires it. Nothing here
 *                 invents a field and hopes somebody reads it; that is the one
 *                 bug this project keeps having and there are five checks about
 *                 it. The order writes the same boonMods a boon card writes,
 *                 through the same shape (`apply(p)`), because that seam is
 *                 proven.
 *
 * WHAT MAKES THE GREY A THIRD THING AND NOT A MIDPOINT.
 *
 * The Jedi's and the Sith's numbers are constants. The Grey's are not: they are
 * a function of the blade's TEMPER (Saber.temper), which rises when the player
 * swings hard and falls when they hold still. So the Grey is a different KIND of
 * object from the other two — a line, where they are points — and the line does
 * not lie between them:
 *
 *              cutPower      guard cone (returnCone)
 *   Jedi         0.85            0.56
 *   Sith         1.40            0.32
 *   Grey calm    0.80            0.638      <- worse cutter than a Jedi,
 *   Grey fury    1.55            0.218         better guard than one
 *                                            <- harder cutter than a Sith,
 *                                               worse guard than one
 *
 * At every temper the Grey is outside the segment those two points span: hold
 * still and you out-guard a Jedi while cutting worse than one; commit and you
 * out-cut a Sith while guarding worse than one. There is no setting of the
 * temper at which you are "a bit of both". It is asserted, at both ends, in
 * tools/checks/order.mjs.
 *
 * The honest caveat, written down rather than dressed up: the Grey's THIRD-ness
 * is entirely in that dynamic. Its individual axes are the same two axes the
 * other orders move, because those are the axes this game has readers for. What
 * is genuinely new is that they move under the player's hands, in opposite
 * directions, at a rate the player controls — not that the Grey has a mechanic
 * nobody else could have.
 *
 * HOW IT REACHES THOSE READERS WITHOUT A LINE IN Player.js OR World.js: with an
 * accessor pair on boonMods, which is the same "a boon whose effect is a
 * TECHNIQUE installs something on the instance" seam that Waves.cleavingThrow
 * established. See liveMod().
 *
 * CONSIDERED AND REFUSED: a Sith core that keeps some of its red.
 *
 * Dropping the Sith blade's uCoreWhite from the shipped 0.85 to 0.78 is the
 * obvious flourish — a bled crystal ought to bleed all the way down its middle —
 * and the guard that would be expected to stop it does not: measured on the
 * shipped smear model, the bloom veil of a Sith trail goes 3.33:1 → 3.84:1 on
 * Crimson against the 6.25:1 channel-filter bound, and it does not reach that
 * bound until about 0.55. So the smear is not the reason.
 *
 * The blade is. CORE_WHITE exists because of a measurement recorded in
 * tools/checks/saber-light.mjs: the DRAWN blade's bloom halo — not the light it
 * throws — does 88% of the damage to the figure holding it, and 0.85 is what
 * took that halo from 22:1 blue-to-red down to about 2:1 and gave the wielder
 * their material back. Lowering it for one order re-opens that fault for every
 * player who picks that order, and the only instrument that can measure the
 * wielder is tools/_wielder.mjs, which needs a browser and was not run by this
 * lane. Refusing to re-open a fix that cannot be re-measured is the whole reason
 * every order's coreWhite is >= 0.85, and the Grey's composed blade goes the
 * other way to 0.94 rather than any of them going down.
 */

import { SABER_COLORS, HILT_STYLES, BLADE_TUNING, TEMPER } from './Saber.js';

/* ── the roster ──────────────────────────────────────────────────────── */

/**
 * Crystal sets, as indices into SABER_COLORS.
 *
 * Stated as indices and not as names because `colorIndex` — the thing the menu
 * stores, the thing World hands the Player, the thing Saber.setColor takes — is
 * an index, and a second vocabulary in between is a second place to be wrong.
 * tools/checks/order.mjs pins each index to the crystal it is meant to be, so
 * inserting a crystal into SABER_COLORS fails loudly instead of silently
 * handing the Sith a green blade.
 *
 * The union is all fifteen: no crystal is orphaned by the split, and a player
 * who has not chosen an order still sees the whole rack.
 *
 * WHERE THE FIVE NEW ONES WENT, because the placement says something and the
 * checks hold it to what it says:
 *
 *   Gold and Jade to the JEDI. Gold is the Temple Guard's colour and Jade is
 *     the other half of the green a temple grows; both are crystals that came
 *     out of Ilum and were never bled.
 *   Azure and Indigo to the JEDI as well — they sit either side of Cerulean
 *     and belong with it.
 *   Orchid to the GREY. It is a hue no temple issues and no Sith bleeds, which
 *     is exactly what the Grey's rack is for, and it does not break their one
 *     rule: they have no blue and no green because they never went to a temple.
 *
 * Nothing new goes on the SITH rack, and that is a rule rather than an
 * oversight: their rack is the bled family (plus the two the check names by
 * hand), and a crystal is not bled because someone liked the colour. Adding a
 * bled one now takes a `dark: true` in SABER_COLORS and an entry here, and
 * tools/checks/order.mjs will fail until both are done.
 */
const CRYSTALS = {
  //          Cerulean Verdant Amethyst Sunfire Cyanite | Gold Jade Azure Indigo
  jedi: [0, 1, 2, 3, 7, 10, 11, 12, 13],
  //          Crimson Bronze Rose Void
  sith: [4, 6, 8, 9],
  //          Ivory Rose Bronze | Orchid
  grey: [5, 8, 6, 14],
};

/**
 * WHAT THE ORDER DOES TO THE PLAYER, as multipliers and absolutes on fields that
 * already have readers.
 *
 *   mul       multiplied into boonMods — composes with every boon card, in
 *             either order, exactly as two boon cards compose with each other.
 *   set       assigned into boonMods. Only for fields that are an ABSOLUTE
 *             (returnCone is a cosine, not a scale) or a flag.
 *   add       added to a stat on the player.
 *   temper    the Grey's live schedule: [calm, fury] factors, installed as an
 *             accessor so every existing per-frame reader picks it up.
 *
 * Every key is checked against a real reader by tools/checks/order.mjs, which
 * greps Player/World/Duel/Combat for it exactly as controls.mjs does for boons.
 */
const MODS = {
  jedi: {
    /* THE ORDER THAT PAYS IN LETHALITY FOR EVERYTHING ELSE.
     * A Jedi's Force is not a weapon they spend, so it costs them less and they
     * carry more of it; their guard is trained, so the cone that decides whether
     * a returned bolt finds a target is a third wider than stock. What they give
     * up is the cut. 0.85 on cutPower is felt in exactly the place it should be:
     * limbs take longer to come off and heavy materials take longer to part. */
    mul: { forceCost: 0.78, staminaRegen: 1.15, cutPower: 0.85 },
    set: { returnCone: 0.56 },
    add: { maxForce: 25 },
  },
  sith: {
    /* THE ORDER THAT HAS TO KEEP KILLING.
     * Twenty-two points of vitality gone and no way to get them back except by
     * taking someone apart — `lifesteal` fires on a severed limb and `healOnKill`
     * on a death, both already read in World. Lightning is theirs from the first
     * wave rather than a card they might never be offered. Everything about the
     * blade is harder and everything about the guard is worse: the return cone
     * closes to 0.32, so bolts have to be MET rather than waved at, and stamina
     * comes back a sixth slower because nobody taught them to breathe. */
    mul: { cutPower: 1.40, deflectDamage: 1.25, forceCost: 1.12, staminaRegen: 0.85 },
    set: { lightning: true },
    add: { maxHp: -22, lifesteal: 6, healOnKill: 4 },
    // The draft must not offer a card this order already owns. World.takenBoons
    // is what drawBoons() filters against — see the wiring note at the bottom.
    grants: ['lightning'],
  },
  grey: {
    /* THE ORDER WITH NO CONSTANTS.
     * The two live factors are the whole mechanic; see the header. flowGain is
     * the one flat thing they get and it is the right one — Flow is the only
     * meter in this game that both halves of a fight feed, and a Grey is the
     * only wielder who is trying to be paid by both. */
    mul: { flowGain: 1.30 },
    temper: {
      // × the player's own cutPower: 0.80 at rest, 1.55 at full temper.
      cutPower: [0.80, 1.55],
      // × their own guard cone. Off the stock 0.42 that is 0.638 → 0.218.
      returnCone: [1.519, 0.519],
    },
  },
};

export const ORDERS = [
  {
    id: 'jedi',
    name: 'Jedi',
    epithet: 'Guardian of the peace',
    blurb: 'A crystal that chose you, and a guard trained to send a bolt back where it came from. '
      + 'The Force costs you least and you carry the most of it. You are the worst cutter of the three, '
      + 'and that is the trade.',
    doctrine: 'There is no emotion, there is peace.',
    crystals: CRYSTALS.jedi,
    crystalOrigin: 'attuned — the crystal is alive and it picked you',
    hilts: ['Graflex', 'Guardian', 'Consular'],
    // ROBE_COLORS indices: Sand, Ivory, Ochre, Umber. Named in the check so
    // this file does not have to import a 3800-line module to hold four numbers.
    robes: [0, 3, 5, 1],
    robeDefault: 0,
    crystalDefault: 0,          // Cerulean
    hiltDefault: 'Graflex',
    mods: MODS.jedi,
    tuning: BLADE_TUNING.jedi,
  },
  {
    id: 'sith',
    name: 'Sith',
    epithet: 'The blade that was made to scream',
    blurb: 'A stolen crystal, bled until it turned. Lightning from the first wave, a cut that bites '
      + 'half again as hard, and a limb taken gives some of your own back — which you will need, '
      + 'because you start with a fifth less to lose and a guard that forgives nothing.',
    doctrine: 'Peace is a lie. There is only passion.',
    crystals: CRYSTALS.sith,
    crystalOrigin: 'bled — a crystal made to scream; over-bled, it cracks and goes dark',
    hilts: ['Sentinel', 'Crossguard', 'Graflex'],
    // ROBE_COLORS: Night, Ash.
    robes: [4, 2],
    robeDefault: 4,
    crystalDefault: 4,          // Crimson
    hiltDefault: 'Crossguard',
    mods: MODS.sith,
    tuning: BLADE_TUNING.sith,
  },
  {
    id: 'grey',
    name: 'Grey',
    epithet: 'Neither code, and both',
    blurb: 'No temple ever gave you a crystal. Every blade you have carried was taken off a body '
      + 'and healed — which is why yours can burn white and why it will never burn blue. It has no '
      + 'settled temper: hold still and it is the cleanest, steadiest guard in the game; swing and it '
      + 'becomes the hardest cut in the game and the worst guard. You decide which, with your hands, '
      + 'every second.',
    doctrine: 'There is no code. There is what the moment asks.',
    crystals: CRYSTALS.grey,
    crystalOrigin: 'healed — a bled crystal talked back; fully purified it is white',
    hilts: ['Guardian', 'Sentinel', 'Crossguard'],
    // ROBE_COLORS: Ash, Umber, Night.
    robes: [2, 1, 4],
    robeDefault: 2,
    crystalDefault: 5,          // Ivory — the purified crystal, theirs alone
    hiltDefault: 'Guardian',
    mods: MODS.grey,
    tuning: BLADE_TUNING.grey,
    // The one line the UI needs to explain the temper meter without knowing how
    // it works: what the blade is doing at each end of its own range.
    temperLabels: ['Composed', 'Furious'],
  },
];

export const ORDER_IDS = ORDERS.map((o) => o.id);

/** The order, or null. Null is a legal answer and means "no order at all". */
export function getOrder(id) {
  return ORDERS.find((o) => o.id === id) || null;
}

/* ── the menu's questions ────────────────────────────────────────────── */

/**
 * The crystals an order can reach, in the shape a swatch row wants.
 *
 * `index` is the SABER_COLORS index and is the value that must end up in
 * `settings.colorIndex` — Menu._swatchRow writes the POSITION in the array it
 * was handed, which is not the same number for a filtered rack, so the caller
 * has to map through `.index` (or use crystalAt below). With no order the whole
 * rack comes back, positions and indices equal, and nothing changes.
 */
export function crystalPalette(orderId) {
  const o = getOrder(orderId);
  const idx = o ? o.crystals : SABER_COLORS.map((_, i) => i);
  return idx.map((i) => ({ ...SABER_COLORS[i], index: i }));
}

/** The SABER_COLORS index for the nth swatch of an order's rack. */
export function crystalAt(orderId, slot) {
  const p = crystalPalette(orderId);
  return (p[slot] || p[0]).index;
}

/**
 * Move a saved crystal into an order's rack.
 *
 * Called when the ORDER changes, because the stored `colorIndex` is very likely
 * to be a crystal the new order cannot reach — picking Sith with a green blade
 * saved from last session would otherwise leave the menu showing a selection
 * that is not in the rack and hand the world a crystal the order does not have.
 * The nearest crystal by hue is kept rather than snapping to the default, so
 * changing your mind about the order does not silently throw away your colour.
 */
export function crystalForOrder(orderId, colorIndex) {
  const o = getOrder(orderId);
  if (!o) return colorIndex;
  if (o.crystals.includes(colorIndex)) return colorIndex;
  const want = SABER_COLORS[colorIndex];
  if (!want) return o.crystalDefault;
  const hue = (hex) => {
    const r = (hex >> 16 & 255) / 255, g = (hex >> 8 & 255) / 255, b = (hex & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d < 1e-6) return -1;                       // neutral: no hue to match
    let h = mx === r ? (g - b) / d % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
  };
  const hw = hue(want.hex);
  let best = o.crystalDefault, bestD = Infinity;
  for (const i of o.crystals) {
    const hi = hue(SABER_COLORS[i].hex);
    // A neutral crystal has no hue; it is the fallback for a neutral request and
    // is otherwise never the "nearest" to a coloured one.
    const d = (hw < 0 || hi < 0) ? (hw < 0 && hi < 0 ? 0 : 400)
      : Math.min(Math.abs(hw - hi), 360 - Math.abs(hw - hi));
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** The hilt styles an order builds, filtered to ones that still exist. */
export function hiltsForOrder(orderId) {
  const o = getOrder(orderId);
  return (o ? o.hilts : HILT_STYLES).filter((h) => HILT_STYLES.includes(h));
}

/* ── applying it ─────────────────────────────────────────────────────── */

/**
 * Install a factor on a field that everything else keeps reading normally.
 *
 * The problem: the Grey's cutPower has to be a function of the blade's temper,
 * and the four places that read it — the blade solver, the door burn, the duel
 * shove, the boon table — live in files this lane does not own and are called
 * every frame. The seam that already exists for this is the one
 * Waves.cleavingThrow uses: a boon whose effect is a TECHNIQUE installs
 * something on the player rather than leaving a number behind.
 *
 * So: an accessor pair with a hidden base. The getter multiplies the base by
 * the live factor; the setter DIVIDES the same factor back out. That is what
 * makes `p.boonMods.cutPower *= 1.55` still mean what it says — the read and
 * the write are one synchronous statement, so the factor cannot move between
 * them, and the base comes out multiplied by exactly 1.55. A boon taken while
 * furious is worth the same as one taken while composed, which is the property
 * that matters and the one a plain per-frame overwrite would destroy.
 *
 * enumerable, because Object.keys(boonMods) is how tools/checks/controls.mjs
 * finds which fields a boon touched. configurable, so a respawn can reinstall.
 */
function liveMod(obj, key, factor) {
  if (!obj) return false;
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (d && d.get) return false;                 // already live; do not stack
  let base = obj[key];
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: true,
    get() { return base * factor(); },
    set(v) { base = v / factor(); },
  });
  return true;
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * MAKE A PLAYER A MEMBER OF AN ORDER.
 *
 * @param target  a Player, or anything Player-shaped: it needs `boonMods`, and
 *                it uses `saber`, `control` and the stat fields if they are
 *                there. Everything is guarded, because the menu preview and the
 *                checks build partial ones.
 * @param orderId 'jedi' | 'sith' | 'grey' | null
 * @returns a record of what actually changed — `{ id, name, mul, set, add,
 *          grants, temper, saber }`, where mul/set/add are only the keys that
 *          really moved — or null if there is no such order. The record is not
 *          decoration: World needs `grants` to keep the draft from offering a
 *          card the order already gave, and the HUD needs `temper` to know
 *          whether to draw the meter. It is also left on the player as
 *          `player.orderRecord`, so anything downstream can read it later.
 *
 * SPAWN-TIME, ONCE. The player-side half is not reversible — it multiplies into
 * shared fields — so a second call with a different order is refused rather than
 * compounded, and re-applying the SAME order is a no-op. Changing your order is
 * changing your character: it happens in the menu, and the menu respawns.
 * (The BLADE half is live and switchable on its own: `saber.order = id`, which
 * is what the forge preview drives.)
 */
export function applyOrder(target, orderId) {
  const o = getOrder(orderId);
  if (!target || !o) return null;
  if (target.order === orderId) return target.orderRecord || null;
  if (target.order) {
    throw new Error(`this player is already ${target.order}; an order is chosen once, at spawn`);
  }

  const M = o.mods;
  const rec = {
    id: o.id, name: o.name, mul: {}, set: {}, add: {}, grants: (M.grants || []).slice(),
    temper: !!M.temper, saber: null,
  };

  // ── the blade
  if (target.saber) {
    target.saber.order = o.id;
    rec.saber = { order: o.id, tempered: !!target.saber.tempered };
  }

  // ── the numbers. boonMods first, because the live factors below have to be
  // installed OVER the multiplied base, not under it.
  const bm = target.boonMods;
  if (bm) {
    for (const [k, v] of Object.entries(M.mul || {})) {
      const before = bm[k] ?? 1;
      bm[k] = before * v;
      rec.mul[k] = v;
    }
    for (const [k, v] of Object.entries(M.set || {})) { bm[k] = v; rec.set[k] = v; }
  }
  for (const [k, v] of Object.entries(M.add || {})) {
    if (bm && k in bm) { bm[k] = (bm[k] || 0) + v; rec.add[k] = v; continue; }
    if (typeof target[k] !== 'number') continue;
    target[k] = target[k] + v;
    rec.add[k] = v;
    // A max that moved has to take the pool with it, or a Sith spawns on 100 of
    // 78 and a Jedi spawns on 100 of 125 with a quarter of the bar missing.
    const pool = { maxHp: 'hp', maxForce: 'force', maxStamina: 'stamina' }[k];
    if (pool && typeof target[pool] === 'number') {
      target[pool] = v > 0 ? target[pool] + v : Math.min(target[pool], target[k]);
    }
  }

  // ── the live half
  if (M.temper && bm && target.saber) {
    const saber = target.saber;
    for (const [k, [calm, fury]] of Object.entries(M.temper)) {
      liveMod(bm, k, () => lerp(calm, fury, saber.temper));
    }
  }

  target.order = o.id;
  target.orderRecord = rec;
  return rec;
}

/**
 * What the HUD should say about the order right now.
 *
 * `temper` is null for the two orders that do not have one, so a meter that
 * exists for the Grey alone has a single thing to test. `t` is the raw 0..1 in
 * case the HUD wants a bar rather than a word.
 */
export function orderReadout(target) {
  const o = getOrder(target?.order);
  if (!o) return null;
  const t = target.saber?.tempered ? target.saber.temper : null;
  const labels = o.temperLabels;
  return {
    id: o.id,
    name: o.name,
    epithet: o.epithet,
    t,
    temper: t === null || !labels ? null : (t < 0.34 ? labels[0] : t > 0.66 ? labels[1] : 'Rising'),
    // The two live numbers, for a tooltip that wants to be specific rather than
    // atmospheric. Read straight off the player, so they cannot be stale.
    cutPower: target.boonMods?.cutPower,
    returnCone: target.boonMods?.returnCone,
  };
}

/**
 * How long, in seconds of steady swinging, a Grey blade takes to get from one
 * temper to another. Exported because it is the answer to "how responsive is
 * it" and the check quotes it — TEMPER lives in Saber.js with the driver.
 */
export function temperTime(from, to, swingSpeed) {
  const want = Math.max(0, Math.min(1, (swingSpeed - TEMPER.floor) / TEMPER.span));
  const rate = to > from ? TEMPER.rise : TEMPER.fall;
  // x(t) = want + (from - want)·e^(-rate·t), so the time to reach `to` is
  // -ln((want-to)/(want-from))/rate — which only exists when `to` is strictly
  // between where you are and where you are heading. Infinity is the honest
  // answer for "swinging at that speed will never get you there".
  const r = (want - to) / (want - from);
  if (!(r > 0 && r < 1)) return Infinity;
  return -Math.log(r) / rate;
}
