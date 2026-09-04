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
 *
 * `Station.dressKeepers` is what finally reads `keeper`: it stands a real body
 * behind each counter, drawn from the station's own census, wearing whatever
 * the row asks for. It was declared here and read by NOBODY for a whole lane —
 * `ARMOURER.keeper` said `{role:'smith', species:'human', helm:true}` and the
 * Forge had no smith in it at all, while #10's gazetteer row still promised
 * *"a Wookiee smith"*. A field nothing reads is the dead control this tree
 * keeps deleting.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  AND EVERY `value` BELOW IS ONE THE GAME CAN ACTUALLY WEAR
 * ══════════════════════════════════════════════════════════════════════════
 *
 * This is the second thing the audit found and it was a whole class rather
 * than a typo. TWENTY-THREE of the forty-one keepsake rows named a slot or a
 * value nothing in the tree has:
 *
 *   `home-cloth`, `home-banner`, `trophy-skull` — three of the four `home`
 *     rows named furniture that is not in `Home.CATALOGUE`'s ten ids.
 *   `cut-sith` named cape cut `'wrap'`; `CAPE_CUTS` is cloak/none/mantle/
 *     travel/court. There IS a `wrap`, and it is a HOOD.
 *   every armourer paint carried a raw hex; `wardrobe.armour` stores a
 *     `PAINTS` id, and `Cloth.armourSheet` drops anything else on the floor.
 *   `pauldron`, `crest`, `brace`, `kama`, `gear`, `under`, `scorch` are
 *     TROOPER KIT fields. The player's wardrobe has four armour fields — the
 *     kit, the bucket, the cape and three paints — and no place to put any of
 *     those, so the rows could not have been worn even once the wiring landed.
 *   `hilt-scav` and `hilt-old` named emitters `'scav'` and `'old'` against ten
 *     real `HILT_STYLES`.
 *
 * `Keepsakes.WEARERS` is now the one table that says what a slot means and
 * what values it takes, read off `Cloth`, `Bodies`, `Saber`, `Home` and
 * `Kennel`'s own tables, and `counter.mjs` holds every row here against it. A
 * row that names nothing fails the suite instead of taking 3200 credits.
 *
 * ── AND THE ANIMAL FINALLY HAS ROWS ───────────────────────────────────────
 *
 * *"you can buy a bunch of shit for your compansions too."* There were zero:
 * not a collar, not a blanket, not a mark, on any of the seven counters. A
 * `pet` row carries a one-key patch onto the look `Kennel.dressCompanion`
 * already takes — its own colour slots and its own mark table — so nothing
 * here invents a customisation system either.
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
 * a robe tone, a hilt style, a piece of furniture, a colour on an animal.
 * Nothing here invents a new customisation system — every slot named is one
 * `Keepsakes.WEARERS` can write, and every value is out of that slot's own
 * table.
 *
 * THE TONE NUMBERS ARE INDICES INTO `Cloth.GARMENT_TONES`, in its order:
 * 0 bone, 1 cream, 2 sand, 3 tan, 4 leather, 5 umber, 6 soot, 7 slate,
 * 8 ash, 9 oxblood, 10 deep olive. They are written as numbers rather than
 * looked up by name because the table has no ids — and `wearable()` clamps
 * the range, so a bolt dyed 14 fails at the suite.
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
 *
 * The longest table in the tree, and deliberately: *"a very very long list of
 * items you can purchase"*, and a shelf is `SHELF_SHARE` of the stock, so a
 * long table is also the only thing that makes the reroll mean anything.
 */
export const CLOTHIER = {
  id: 'clothier', place: 9, name: 'Sen Ashai, cloth and dye',
  keeper: { role: 'trader', species: 'any' },
  stock: [
    K('tone-ash', 'Ash grey bolt', 'common', 40, 'capeTone', 8, 'A grey that does not read as black at range.'),
    K('tone-oxide', 'Oxide red bolt', 'common', 40, 'tabardTone', 9, 'Narn dye. It does not fade.'),
    K('tone-bone', 'Bone bolt', 'common', 36, 'tunicTone', 0, 'Undyed, and the Temple prefers it.'),
    K('tone-cream', 'Cream bolt', 'common', 36, 'tunicTone', 1, 'Half a shade off white, which is the half that matters.'),
    K('tone-sand', 'Sand bolt', 'common', 34, 'tunicTone', 2, 'The colour of every road out of here.'),
    K('tone-tan', 'Tan bolt', 'common', 34, 'tabardTone', 3, 'It was this colour before it was dyed, too.'),
    K('tone-soot', 'Soot bolt', 'common', 44, 'tabardTone', 6, 'Dyed over something that did not come out.'),
    K('tone-drazi', 'Drazi green', 'common', 42, 'sashTone', 10, 'This year it is green. Do not ask.'),
    K('tone-glove', 'Oiled leather', 'common', 38, 'gloveTone', 4, 'It will darken with wear and look better for it.'),
    K('tone-boot', 'Field boots', 'common', 38, 'bootTone', 5, 'Resoled twice. Cheaper than new ones.'),
    K('tone-boot-ash', 'Grey boots', 'common', 36, 'bootTone', 8, 'Off a quartermaster who did not count them.'),
    K('tone-glove-soot', 'Smith\'s gloves', 'common', 42, 'gloveTone', 6, 'Burnt at the fingers. They came like that.'),
    K('tone-sash-slate', 'Slate obi', 'common', 46, 'sashTone', 7, 'Wide, and it holds a knot all day.'),
    K('tone-cape-umber', 'Umber bolt', 'common', 48, 'capeTone', 5, 'Brown, and it does not look poor.'),
    K('cut-mantle', 'Shoulder mantle', 'fine', 180, 'cape', 'mantle', 'A yoke rather than a cape. Nothing hides your stance.'),
    K('cut-travel', 'Travelling cloak', 'fine', 195, 'cape', 'travel', 'Cut for a road and a night on it.'),
    K('cut-court', 'Court cloak', 'fine', 260, 'cape', 'court', 'Too long to fight in, and everyone knows it.'),
    K('cut-none', 'Go without the cape', 'common', 28, 'cape', 'none', 'Some of them never wear one. It is a choice.'),
    K('cut-kama', 'Kama', 'fine', 210, 'waist', 'kama', 'Heavy square cloth over both hips, to mid-thigh.'),
    K('cut-half', 'Half kama', 'fine', 190, 'waist', 'half', 'One side only, off the right hip, and longer for it.'),
    K('cut-fall', 'Back fall', 'rare', 420, 'waist', 'fall', 'A narrow fall off the back of the belt, to the knee.'),
    K('cut-tabard', 'Temple tabards', 'fine', 165, 'tabard', 'temple', 'The cut the Order has used for nine hundred years.'),
    K('cut-tabard-long', 'Long tabards', 'fine', 185, 'tabard', 'long', 'To the shin, front and back. It moves well.'),
    K('cut-tabard-double', 'Double tabards', 'fine', 230, 'tabard', 'double', 'Two layers, and the under one shows at the hem.'),
    K('cut-sash-long', 'Long sash', 'fine', 150, 'sash', 'long', 'Wound three times and left hanging.'),
    K('cut-sash-double', 'Double sash', 'fine', 175, 'sash', 'double', 'Two colours, one over the other.'),
    K('cut-top-wrap', 'Wrapped top', 'fine', 160, 'top', 'wrap', 'Crossed and tied at the side. Nothing to unbutton.'),
    K('cut-hood-cowl', 'Cowl', 'fine', 170, 'hood', 'cowl', 'It sits on the shoulders whether it is up or not.'),
    K('cut-hood-cloak', 'Hooded cloak', 'fine', 240, 'hood', 'cloak', 'The hood is part of the cloak, so it moves with it.'),
    K('cut-sith', 'Acolyte\'s wrap', 'rare', 640, 'hood', 'sith', 'Cut for someone who does not want the shape read.', { side: 'sith' }),
    K('cut-braid', 'A braid that swings', 'rare', 380, 'hair', 'live', 'Plaited so it moves. It costs you nothing and it is not free.'),
    K('tone-mid', 'Midnight bolt', 'rare', 520, 'capeTone', 7, 'Dyed nine times. It has depth in it.'),
    K('tone-blood', 'Oxblood, deep', 'rare', 480, 'capeTone', 9, 'The dye is Narn and the cloth is not.'),
    K('tone-vorlon', 'Vorlon iridescent', 'singular', 2600, 'capeTone', 10, 'Nobody will tell you what it is made of.'),
  ],
};

/**
 * ══ THE FORGE — AND THE SMITH IS A MANDALORIAN ════════════════════════════
 *
 * V16 §A4: *"the shopseller should be someone who would know stuff about
 * lightsabers maybe a mandalorian."* Right on every axis — beskar, the Forge's
 * own name, and a people who would sell to either side. `keeper` is what
 * `Station.dressKeepers` builds the body from and it says all three things:
 * the species, the job and the bucket.
 *
 * WHAT HE SELLS IS THE FOUR FIELDS THE WARDROBE ACTUALLY HOLDS — which kit,
 * whether the bucket is on, and the three paints. The old table sold pauldrons
 * and vambraces and jaig eyes, which are trooper-kit fields the player's own
 * costume has no room for; a paint that `Cloth.armourSheet` drops is a paint
 * nobody wears. `Keepsakes` puts a bare-robed player into the line kit when
 * they buy a paint, because otherwise the beskar goes onto nothing.
 */
export const ARMOURER = {
  id: 'armourer', place: 10, name: 'Bo Vhett, beskar and blade',
  /* NAMED, AND HE IS THE ONE KEEPER WHO DOES NOT REROLL. The shop is called
   * after him — *"Bo Vhett, beskar and blade"* — and #10's gazetteer row now
   * says so too, so a seeded name would put a stranger behind a sign with
   * somebody else's name on it. `Station.dressKeepers` takes `name` when a row
   * carries one and seeds it when it does not, which is every other counter. */
  keeper: { role: 'smith', species: 'human', helm: true, mando: true, name: 'Bo Vhett' },
  stock: [
    K('kit-line', 'Phase-I plate', 'common', 90, 'kit', 'line', 'As issued. The shape everything else is read against.'),
    K('kit-marksman', 'Marksman\'s plate', 'fine', 240, 'kit', 'marksman', 'The scope along the temple. Narrow at the shoulder.'),
    K('kit-heavy', 'Gunner\'s rig', 'fine', 260, 'kit', 'heavy', 'The box on your back is the whole silhouette.'),
    K('kit-jet', 'Jet rig', 'fine', 290, 'kit', 'jet', 'Two nozzles between the bells. It does not fly here.'),
    K('kit-arc', 'ARC plate', 'rare', 620, 'kit', 'arc', 'Mantle, long kama, twin holsters. They let you keep it.'),
    K('kit-commander', 'Commander\'s plate', 'rare', 780, 'kit', 'commander', 'The crest and the half-cape. Somebody has to be found in the smoke.'),
    K('kit-none', 'Out of the plate', 'common', 30, 'kit', 'none', 'Back into robes. He will not ask why.'),
    K('helm-off', 'Go without the helmet', 'common', 30, 'helm', false, 'Some of them never wear it. Some of them never take it off.'),
    K('helm-on', 'Keep the bucket on', 'common', 30, 'helm', true, 'This is the way, he says, and does not explain.'),
    K('paint-legion', 'Legion blue', 'common', 60, 'accent', 'sky', 'The 501st wear it. Nobody stops you.'),
    K('paint-sand', 'Desert wash', 'common', 55, 'plate', 'sand', 'Sand gets into everything anyway.'),
    K('paint-ash', 'Ash weathering', 'common', 50, 'plate', 'ash', 'It has been somewhere.'),
    K('paint-bone', 'Bone white', 'common', 48, 'plate', 'bone', 'The colour it left the foundry.'),
    K('paint-char', 'Charcoal', 'common', 58, 'plate', 'char', 'Not black. Nothing is black at this range.'),
    K('paint-clay', 'Clay', 'common', 54, 'plate', 'clay', 'Mixed on a world with one river.'),
    K('paint-rust', 'Rust', 'common', 56, 'accent', 'rust', 'Applied. It was going to happen anyway.'),
    K('paint-sun', 'Sun flash', 'common', 62, 'accent', 'sun', 'Yellow, on the shoulder, where it is seen first.'),
    K('paint-jungle', 'Jungle flash', 'common', 60, 'accent', 'jungle', 'For somewhere with cover in it.'),
    K('paint-teal', 'Teal flash', 'fine', 150, 'accent', 'teal', 'A colour nobody else is wearing this year.'),
    K('paint-plum', 'Plum flash', 'fine', 160, 'accent', 'plum', 'It reads at ninety metres and that is the whole trick.'),
    K('visor-gold', 'Gold visor', 'rare', 700, 'visor', 'sun', 'You can see out. They cannot see in.'),
    K('visor-ice', 'Ice visor', 'fine', 300, 'visor', 'ice', 'Pale, and it makes the helmet look empty.'),
    K('visor-deep', 'Deep visor', 'fine', 280, 'visor', 'deep', 'Blue enough to tell from black in daylight.'),
    K('visor-black', 'Blacked visor', 'rare', 640, 'visor', 'char', 'Nothing at all comes back out of it.', { side: 'sith' }),
    K('paint-blood', 'Blood stripe', 'rare', 660, 'accent', 'blood', 'Earned, in the old regiments.'),
    K('paint-slate', 'Gunmetal', 'fine', 220, 'plate', 'slate', 'Not a colour. A finish.'),
    K('beskar', 'Beskar plate', 'singular', 3200, 'plate', 'ice', 'It is not paint. It is the metal.'),
  ],
};

/**
 * THE QUARTERMASTER — the only counter that carries stims and stratagem
 * charges, which is why the door bug that made it unreachable meant no
 * provision in the game could be bought at all. See `Station.stationKey`.
 */
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
    K('paint-line', 'Line issue', 'common', 40, 'plate', 'bone', 'The colour everything comes in.'),
    K('paint-quarter', 'Quartermaster\'s grey', 'common', 45, 'accent', 'ash', 'Someone counted this and signed for it.'),
    K('kit-issue', 'A set off the rack', 'common', 85, 'kit', 'line', 'It fits nobody and it fits everybody.'),
    /* ── AND THE ANIMAL'S KIT, because a quartermaster issues for everything
     * on the strength and V16 asks for *"a bunch of shit for your compansions
     * too."* A `pet` row is one patch onto `Kennel`'s own look. ─────────── */
    K('pet-blanket', 'Issue blanket', 'common', 55, 'pet', { blanket: 'slate' }, 'Grey, heavy, and it will be chewed within a week.'),
    K('pet-blanket-sun', 'Yellow blanket', 'common', 60, 'pet', { blanket: 'sun' }, 'So you can find it in long grass.'),
    K('pet-mark-sky', 'Unit flash, blue', 'common', 65, 'pet', { mark: 'sky' }, 'It is on the strength now, so it gets the flash.'),
    K('pet-trim', 'Harness trim', 'fine', 130, 'pet', { trim: 'bone' }, 'Bone against whatever colour it is underneath.'),
    K('pet-panels', 'Repainted panels', 'fine', 145, 'pet', { panels: 'teal' }, 'For the ones that are more machine than animal.'),
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
    K('home-stool', 'A stool from the counter', 'common', 70, 'home', 'chair', 'He has forty of them and will not miss one.'),
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
    /* THE FURNITURE ROWS NAME `Home.CATALOGUE` IDS NOW. `home-cloth` was a
     * tablecloth, which is not a piece of furniture and never could be; the
     * table it was for is. */
    K('home-table', 'The table it comes on', 'fine', 220, 'home', 'table', 'He is selling you the table. The cloth is thrown in.'),
    K('home-plant', 'One of the plants', 'common', 95, 'home', 'plant', 'It has been on this terrace longer than he has.'),
    K('home-lamp', 'A standing lamp', 'common', 88, 'home', 'lamp', 'The light on the terrace, and it is the light that sells it.'),
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
    K('home-rack', 'A shelf rack', 'fine', 240, 'home', 'rack', 'Red stone shelves. He will not help you carry it.'),
    K('home-rug', 'A woven rug', 'fine', 210, 'home', 'rug', 'Woven on a world that is not there any more.'),
    K('tone-clay', 'Red clay dye', 'common', 34, 'tunicTone', 3, 'The colour of the ground at home.'),
    K('tone-narn', 'Narn weave', 'fine', 200, 'sashTone', 9, 'The dye is made from something he will not name.'),
    K('pet-hide-clay', 'Beast dye, red', 'fine', 140, 'pet', { hide: 'clay' }, 'They do it to their own. It does not hurt.'),
    K('pet-mark-blood', 'A blood mark', 'fine', 155, 'pet', { mark: 'blood' }, 'It means the animal has been somewhere with you.'),
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
    K('tone-void', 'Void black', 'rare', 480, 'capeTone', 6, 'Darker than the dye laws allow.', { side: 'sith' }),
    /* THE TWO HILTS NAME `Saber.HILT_STYLES` NOW. `'scav'` and `'old'` were
     * not styles and never had been — ten exist and two of them are exactly
     * these two sentences. */
    K('hilt-scav', 'Scavenged emitter', 'rare', 560, 'hilt', 'Warden', 'It came off someone.'),
    K('hilt-old', 'A very old emitter', 'rare', 720, 'hilt', 'Archaic', 'Older than the Order says it should be.'),
    K('hilt-cross', 'A guarded hilt', 'rare', 800, 'hilt', 'Crossguard', 'Two vents at the neck. He says they are meant to be there.'),
    K('hilt-shoto', 'A short hilt', 'fine', 300, 'hilt', 'Shoto', 'For the off hand, or for somebody small.'),
    P('stim-red', 'Red stim', 'rare', 380, { cutPower: 1.2, ward: 1.15 }, 'Hits harder. So does everything else.'),
    K('paint-nomark', 'No markings', 'fine', 150, 'accent', 'char', 'Nothing on it says where it is from.'),
    P('stim-black', 'Something in a black vial', 'rare', 420, { cutPower: 1.15, staminaRegen: 0.85 }, 'It works. You will pay for it later, this run.'),
    K('home-crate', 'An unmarked crate', 'common', 90, 'home', 'crate', 'He does not know what is in it either.'),
    K('home-locker', 'A locker with the plate filed off', 'fine', 180, 'home', 'locker', 'It locks. He will not say what it locked before.'),
    K('pet-eye', 'Something for its eyes', 'rare', 420, 'pet', { eye: 'blood' }, 'It is a dye. He says it is a dye.'),
    K('home-bunk', 'A bunk, somebody\'s', 'singular', 2100, 'home', 'bunk', 'He will not say whose.'),
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
