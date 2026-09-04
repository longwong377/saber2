/**
 * ══════════════════════════════════════════════════════════════════════════
 *  WHO IS BEHIND THE COUNTERS — V16 Lane B, as tables
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `Counter.js` is the system; this is the content. Every shop, stall, cage and
 * shutter in V16's Lane B is a row here, which is the whole point of writing
 * the system first: a tenth vendor is twenty lines of data and no code.
 *
 * ── WHERE THEY STAND ──────────────────────────────────────────────────────
 *
 * All of them are in rooms the gazetteer already has. V16 §1's table is the
 * argument — the station's buildings were built by SHARK and this list is what
 * finally gives some of them a job:
 *
 *   #9  The Concourse   the general vendors and the food stalls
 *   #10 The Forge       the saber, and V16 §A4 makes it the ONLY door to one
 *   #11 Quartermaster   kit and paint (it already carries `kiosk: 'kit'`)
 *   #17 Food court      cheap and many
 *   #15 The Fresh Air   sit down and be cooked for
 *   #16 Galley          the crew's, free, plain, and it buffs least
 *   #32 Narn quarter    things a human should not eat
 *   #58 The Underlift   the black market — Sith and Separatist stock, no
 *                       receipts, and it is not open every day
 *
 * ── THE KEEPERS REROLL AND THE DEBTS DO NOT ───────────────────────────────
 *
 * *"the same shop owner doesnt always look the same like between runs or maybe
 * deaths idk everything other than your apartment/companion should be
 * refreshed/randomized."* A keeper is a SEED here rather than a person —
 * `StationCast.resident(seed)` builds the body — so the population turns over
 * without a line of new content. Three things never reroll: your home, your
 * companion, and anyone who owes you money.
 */

import { KINDS, TIERS } from './Counter.js';

/* ══════════════════════════════════════════════════════════════════════════
 *  KEEPSAKES — cosmetic, permanent, and they may not carry a number
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `Counter.saneRow` REFUSES a keepsake with `grants`, `mods` or `effect` on
 * it, so the only way to ship a cosmetic that buys power is to lie about its
 * kind — which `tools/checks/counter.mjs` then catches by building the body.
 *
 * `slot` and `value` are what a bought row hands to the thing that wears it:
 * a robe tone, a hilt part, a piece of furniture, a collar. Nothing here
 * invents a new customisation system — every slot named is one that already
 * exists in `Cloth.WARDROBE`, `Bodies.PAINT_SLOTS`, `Home.CATALOGUE` or
 * `Kennel`'s look table.
 */
const K = (id, name, tier, base, slot, value, blurb, extra = {}) => ({
  kind: 'keepsake', id, name, tier, base, slot, value, blurb, ...extra,
});

/* ── PROVISIONS — a run's worth, and `runOnly` is refused if absent ──────── */
const P = (id, name, tier, base, effect, blurb, extra = {}) => ({
  kind: 'provision', id, name, tier, base, runOnly: true, effect, blurb, ...extra,
});

/**
 * THE GENERAL VENDORS. Cloth, tone and trim — the things that change how you
 * read at thirty metres, which is the range the whole art direction is set at.
 */
export const CLOTHIER = {
  id: 'clothier', place: 9, name: 'Sen Ashai, cloth and dye',
  keeper: { role: 'trader', species: 'any' },
  stock: [
    K('tone-ash', 'Ash grey bolt', 'common', 40, 'capeTone', 2, 'A grey that does not read as black at range.'),
    K('tone-oxide', 'Oxide red bolt', 'common', 40, 'tabardTone', 5, 'Narn dye. It does not fade.'),
    K('tone-bone', 'Bone bolt', 'common', 36, 'tunicTone', 1, 'Undyed, and the Temple prefers it.'),
    K('cut-mantle', 'Shoulder mantle', 'fine', 180, 'cape', 'mantle', 'A yoke rather than a cape. Nothing hides your stance.'),
    K('cut-kama', 'Kama', 'fine', 210, 'waist', 'kama', 'Heavy square cloth over both hips, to mid-thigh.'),
    K('cut-half', 'Half kama', 'fine', 190, 'waist', 'half', 'One side only, off the right hip, and longer for it.'),
    K('cut-fall', 'Back fall', 'rare', 420, 'waist', 'fall', 'A narrow fall off the back of the belt, to the knee.'),
    K('tone-mid', 'Midnight bolt', 'rare', 520, 'capeTone', 7, 'Dyed nine times. It has depth in it.'),
    K('cut-sith', 'Acolyte\'s wrap', 'rare', 640, 'cape', 'wrap', 'Cut for someone who does not want the shape read.', { side: 'sith' }),
    K('tone-drazi', 'Drazi green', 'common', 42, 'sashTone', 4, 'This year it is green. Do not ask.'),
    K('cut-tabard', 'Temple tabards', 'fine', 165, 'tabard', 'temple', 'The cut the Order has used for nine hundred years.'),
    K('tone-glove', 'Oiled leather', 'common', 38, 'gloveTone', 3, 'It will darken with wear and look better for it.'),
    K('tone-boot', 'Field boots', 'common', 38, 'bootTone', 2, 'Resoled twice. Cheaper than new ones.'),
    K('tone-vorlon', 'Vorlon iridescent', 'singular', 2600, 'capeTone', 9, 'Nobody will tell you what it is made of.'),
  ],
};

export const ARMOURER = {
  id: 'armourer', place: 10, name: 'Bo Vhett, beskar and blade',
  /* V16 §A4: *"the shopseller should be someone who would know stuff about
   * lightsabers maybe a mandalorian."* Right on every axis — beskar, the
   * Forge's own name, and a people who would sell to either side. */
  keeper: { role: 'smith', species: 'human', helm: true },
  stock: [
    K('paint-legion', 'Legion stripe', 'common', 60, 'accent', 0x2f6fd0, 'The 501st wear it. Nobody stops you.'),
    K('paint-sand', 'Desert wash', 'common', 55, 'plate', 0xd8c9a8, 'Sand gets into everything anyway.'),
    K('pauldron', 'Pauldron', 'fine', 240, 'pauldron', 'both', 'One shoulder or two. Two is a statement.'),
    K('crest', 'Officer\'s crest', 'fine', 260, 'crest', true, 'So they can find you in the smoke.'),
    K('visor-gold', 'Gold visor', 'rare', 700, 'visor', 0xffc24a, 'You can see out. They cannot see in.'),
    K('paint-ash', 'Ash weathering', 'common', 50, 'plate', 0x9aa0a6, 'It has been somewhere.'),
    K('paint-jaig', 'Jaig eyes', 'fine', 300, 'crest', 'jaig', 'You do not paint these on yourself.'),
    K('kama-long', 'Long kama', 'fine', 280, 'kama', 'long', 'To the shin. It gets in the way and it is worth it.'),
    K('brace', 'Vambrace', 'fine', 230, 'brace', true, 'Somewhere to put the things you need in a hurry.'),
    K('paint-blood', 'Blood stripe', 'rare', 660, 'accent', 0x9c1b1b, 'Earned, in the old regiments.'),
    K('visor-black', 'Blacked visor', 'rare', 640, 'visor', 0x101216, 'Nothing at all comes back out of it.', { side: 'sith' }),
    K('helm-off', 'Go without the helmet', 'common', 30, 'helm', false, 'Some of them never wear it. Some of them never take it off.'),
    K('beskar', 'Beskar plate', 'singular', 3200, 'plate', 0x8f949c, 'It is not paint. It is the metal.'),
  ],
};

export const QUARTERMASTER = {
  id: 'quarter', place: 11, name: 'The Quartermaster\'s cage',
  keeper: { role: 'clerk' },
  stock: [
    P('stim-focus', 'Focus stim', 'common', 70, { flowGain: 1.25 }, 'Everything earns a quarter more Flow, this run.'),
    P('stim-wind', 'Second wind', 'common', 80, { staminaRegen: 1.35 }, 'Stamina comes back faster, this run.'),
    P('stim-plate', 'Field plating', 'fine', 210, { ward: 0.86 }, 'A blow gets less of you through, this run.'),
    P('charge-strat', 'Stratagem charge', 'fine', 240, { stratagem: 1 }, 'One more call, this run.'),
    P('stim-steady', 'Steadying draught', 'common', 75, { deflectDamage: 1.15 }, 'A return carries more, this run.'),
    P('stim-quick', 'Quickthread', 'fine', 195, { moveSpeed: 1.12 }, 'You move faster, this run.'),
    P('stim-mend', 'Field mend', 'fine', 220, { healOnKill: 4 }, 'Every kill gives a little back, this run.'),
    P('charge-second', 'Second charge', 'rare', 460, { stratagem: 2 }, 'Two more calls, this run.'),
    K('paint-line', 'Line issue', 'common', 40, 'under', 0x2a2f36, 'The colour everything comes in.'),
    K('gear-pouches', 'Full pouches', 'common', 55, 'gear', 0x4a4034, 'It looks like you brought enough.'),
    K('paint-quarter', 'Quartermaster\'s tally', 'common', 45, 'gear', 0x3a4048, 'Someone counted this and signed for it.'),
  ],
};

/**
 * THE FOOD, and it is upside only.
 *
 * V16 §B5 argues the refusal and it is worth restating where the rows are:
 * *"you should IDEALLY have a full stomach before battle"* — ideally is the
 * word. A hunger bar that punishes you for not shopping turns a pleasure into
 * a chore and turns every run into a trip to the shops first. So a full
 * stomach is a BUFF and an empty one is no buff and nothing else.
 *
 * `hours` is how long it lasts on the station clock, which is the clock the
 * medbay's healing and the shelf's reroll already run on.
 */
export const FOOD_COURT = {
  id: 'foodcourt', place: 17, name: 'The food court',
  keeper: { role: 'cook' },
  stock: [
    P('f-noodle', 'Bowl of hot noodle', 'common', 18, { hours: 3, staminaRegen: 1.12 }, 'Cheap, fast, and it works.'),
    P('f-flatbread', 'Flatbread and oil', 'common', 14, { hours: 3, moveSpeed: 1.04 }, 'You can eat it walking.'),
    P('f-stew', 'Bowl of grey stew', 'common', 16, { hours: 4, ward: 0.96 }, 'Nobody asks what is in it.'),
    P('f-broth', 'Clear broth', 'common', 11, { hours: 2, staminaRegen: 1.08 }, 'Hot water with an opinion.'),
    P('f-roll', 'Fried roll', 'common', 15, { hours: 3, ward: 0.97 }, 'You will regret it in an hour. Not in the next one.'),
    P('f-pickle', 'Jar of pickle', 'common', 12, { hours: 3, flowGain: 1.06 }, 'Sharp enough to wake you up.'),
    P('f-dumpling', 'Steamed dumplings', 'fine', 38, { hours: 5, staminaRegen: 1.15 }, 'Six of them, and the sixth is the best.'),
    P('f-noodle-big', 'The big bowl', 'fine', 52, { hours: 6, staminaRegen: 1.18, moveSpeed: 1.04 }, 'You will not want to run afterwards.'),
    P('f-skewer', 'Spiced skewer', 'fine', 46, { hours: 5, flowGain: 1.10 }, 'The stall has one recipe and has had it for forty years.'),
  ],
};

export const FRESH_AIR = {
  id: 'freshair', place: 15, name: 'The Fresh Air',
  keeper: { role: 'cook', species: 'centauri' },
  stock: [
    P('f-plate', 'The plate of the day', 'fine', 90, { hours: 6, staminaRegen: 1.2, flowGain: 1.12 }, 'You sit down for this one.'),
    P('f-brandy', 'Centauri brandy', 'fine', 120, { hours: 5, ward: 0.9 }, 'Six of them and you will fight anything.'),
    P('f-soup', 'The soup', 'common', 34, { hours: 4, ward: 0.95 }, 'There is always soup. It is never the same soup.'),
    P('f-bread', 'Bread and salt', 'common', 20, { hours: 3, staminaRegen: 1.1 }, 'They bring it before you order.'),
    P('f-wine', 'A glass of the red', 'common', 30, { hours: 3, flowGain: 1.08 }, 'The house one. It is fine.'),
    P('f-roast', 'The roast', 'fine', 110, { hours: 7, ward: 0.92, staminaRegen: 1.15 }, 'It takes an hour. Sit down.'),
    K('home-cloth', 'A good tablecloth', 'common', 60, 'home', 'cloth', 'For the table you do not have yet.'),
    P('f-fish', 'Whatever came in on the shuttle', 'rare', 260, { hours: 8, staminaRegen: 1.3, moveSpeed: 1.06 }, 'It was alive this morning, somewhere else.'),
  ],
};

export const NARN_MARKET = {
  id: 'narnmarket', place: 32, name: 'The Narn market',
  keeper: { role: 'trader', species: 'narn' },
  stock: [
    P('f-breen', 'Breen', 'common', 22, { hours: 4, ward: 0.94 }, 'It is not for you. Eat it anyway.'),
    P('f-flarn', 'Flarn', 'fine', 70, { hours: 6, staminaRegen: 1.22 }, 'Prepared correctly. He will tell you if it was not.'),
    P('f-tuffle', 'Tuffle roots', 'common', 19, { hours: 4, moveSpeed: 1.05 }, 'Chew it. Do not swallow it whole.'),
    P('f-spoo', 'Live spoo', 'common', 26, { hours: 4, staminaRegen: 1.12 }, 'It is better if you do not watch.'),
    P('f-methane', 'Something from the methane quarter', 'rare', 300, { hours: 9, ward: 0.9, flowGain: 1.15 }, 'Sealed. Do not open it in here.'),
    K('home-banner', 'A Narn banner', 'fine', 240, 'home', 'banner', 'It is not a decoration to him.'),
    K('tone-clay', 'Red clay dye', 'common', 34, 'tunicTone', 5, 'The colour of the ground at home.'),
    K('tone-narn', 'Narn weave', 'fine', 200, 'sashTone', 6, 'Woven on a world that is not there any more.'),
  ],
};

/**
 * THE BLACK MARKET. *"the black market smuggler types only deal with sith."*
 * `refuse` is the counter-level gate and it SPEAKS; `side` on a row is the
 * per-item one.
 */
export const UNDERLIFT = {
  id: 'underlift', place: 58, name: 'The Underlift',
  keeper: { role: 'smuggler' },
  refuse: ['jedi'],
  refuseLine: 'he looks at the robe, and the shutter comes down',
  shut: 'the container is dark and the lock is new',
  /* NOT OPEN EVERY DAY — the shelf's own seed decides, so a day it is shut is
   * the same day for everyone and is not a roll you can re-take by walking
   * out and back in. */
  openDays: 2 / 3,
  stock: [
    K('tone-void', 'Void black', 'rare', 480, 'capeTone', 8, 'Darker than the dye laws allow.', { side: 'sith' }),
    K('hilt-scav', 'Scavenged emitter', 'rare', 560, 'hilt', 'scav', 'It came off someone.'),
    P('stim-red', 'Red stim', 'rare', 380, { cutPower: 1.2, ward: 1.15 }, 'Hits harder. So does everything else.'),
    K('paint-nomark', 'No markings', 'fine', 150, 'accent', 0x14161a, 'Nothing on it says where it is from.'),
    P('stim-black', 'Something in a black vial', 'rare', 420, { cutPower: 1.15, staminaRegen: 0.85 }, 'It works. You will pay for it later, this run.'),
    K('hilt-old', 'A very old emitter', 'rare', 720, 'hilt', 'old', 'Older than the Order says it should be.'),
    K('home-crate', 'An unmarked crate', 'common', 90, 'home', 'crate', 'He does not know what is in it either.'),
    K('paint-scorch', 'Scorch, applied', 'fine', 170, 'scorch', 0.4, 'It did not happen to you. It will look like it did.'),
    K('trophy-skull', 'A skull, mounted', 'singular', 2100, 'home', 'trophy-skull', 'He will not say whose.'),
  ],
};

/** Every counter the station has, in one list. */
export const COUNTERS = [CLOTHIER, ARMOURER, QUARTERMASTER, FOOD_COURT, FRESH_AIR, NARN_MARKET, UNDERLIFT];

/** The counters standing in a given place. */
export function countersAt(placeId) { return COUNTERS.filter((c) => c.place === placeId); }

/** One counter by id. */
export function counterById(id) { return COUNTERS.find((c) => c.id === id) || null; }

/** Every row any counter could ever carry — for a check, and for a codex. */
export function everyRow() { return COUNTERS.flatMap((c) => c.stock); }
