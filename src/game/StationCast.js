/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE CAST — fifteen species, their names, their day and who they stand with
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `SHARK.md` §15 names the source exactly: `longwong377/Opus-5` at
 * `claude/aaa-game-development-j6y2ml` (7c3df7e), and four files under
 * `station/npc/` — `body.py`, `names.py`, `schedule.py`, `faction.py` —
 * **ported as tables**. §1.1 is blunt about why those four and not the meshes:
 * *"the crowd meshes are worse than what this engine builds"*, and *"take the
 * TABLES: 15 species' measured body ratios, name generators, daily rhythms,
 * 40 jobs, factions"*.
 *
 * The player's own instruction, relayed for this session: **all the species.**
 * Not §3.3's Tier A four with the rest trailing — all fifteen, with a body, a
 * name, a rhythm, a job and a home. That is what is here.
 *
 * ── WHY THE PORT IS A ROW AND NOT A MESH ──────────────────────────────────
 *
 * `Bodies.js` already has the mechanism `body.py` describes. Its `SPECIES` is
 * a table of rows carrying `frame` (scale, head, arm and leg length), a
 * `face` of eight signed morph axes, head furniture (`horns`, `lekku`), and
 * flags for hair, brows, eyes, ears and mouth — and `speciesOf` already
 * accepts a row OBJECT rather than an id, so a species can be handed in from
 * outside the creator's list without being added to it.
 *
 * So `body.py`'s fifteen rows are fifteen rows here, arithmetic and all:
 *
 *   frame.scale    stature_m / 1.75          (HUMAN_STATURE_M, body.py:253)
 *   frame.head     scale × head_k            (`frame.head` is against the
 *                                             CALLER's scale, not the body's —
 *                                             see buildJedi's own note)
 *   frame.armLen   arm_k        frame.legLen  leg_k
 *   face.skull     from `cranium`, inverted through `vaultOf`'s own
 *                  coefficients: +1 is a tall narrow braincase and −1 a low
 *                  wide one, so a measured (width, height) pair solves for it
 *   face.jaw       (jaw_k − 0.78) / 0.10, the human row being 0.78
 *
 * Nothing is invented: every stature, girth, cranium and jaw number below is
 * the one in `body.py`, and the ones it marks MEASURED (the Narn's head off
 * `G'Kar more.jpg`, the Centauri crest off `more zocalo.png`, the pak'ma'ra's
 * neck off `more Pak'ma'ra.webp`) are the ones doing the most work.
 *
 * ── AND NO STATION FILE LEARNS A MODE'S NAME (§10) ────────────────────────
 *
 * A mode contributes a door and a RESIDENTS MANIFEST — builder name, species,
 * name generator, job, home place, rhythm. `residents()` reads them and knows
 * nothing else. `stationcast.mjs` greps for a mode's name in every station
 * file, which is the same "rows, not names" rule `CompanionKinds.js` keeps.
 */

/* ARCHETYPES lives in Enemy.js and TOUGHNESS in Combat.js — the same two
 * edges `CompanionKinds.js` has, and for its reason: `spawnEnemy` indexes
 * that table, so a body that is not in it cannot be spawned. */
/* CompanionKinds assigns four of the bodies this file's Borz rows point at —
 * the reprogrammed B1 and the tooka among them — so it has to have run before
 *  can resolve one. Imported for the side effect, which is the
 * same edge Levels.js has on Hangar.js and for the same reason. */
import './CompanionKinds.js';
import { ARCHETYPES } from './Enemy.js';
import { TOUGHNESS } from './Combat.js';
import { buildJedi } from './Bodies.js';
import { PLACE } from './StationPlan.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  BODY — station/npc/body.py, SPECIES                                       */
/* ══════════════════════════════════════════════════════════════════════════ */

/** `body.py:253`. Every `frame.scale` below is a stature over this. */
export const HUMAN_STATURE = 1.75;

/**
 * ══ THE FIFTEEN, AS ROWS ══════════════════════════════════════════════════
 *
 * `sp` is `body.py`'s own numbers, kept verbatim so a reader can hold this
 * against that file: `[stature_m, sigma, build, shoulder_k, leg_k, arm_k,
 * head_k, cranium(w,h,d), jaw_k, neck_k, stoop_deg]`. Everything after it is
 * this engine's shape, DERIVED from those numbers by the arithmetic in the
 * header — which is why the derivation is written down rather than the
 * results being typed as if they were measurements of their own.
 *
 * `body.py`'s own constraint is kept and is the reason nobody here is 2.4 m:
 * *"Every species in these folders except the Vorlon and the Gaim is an actor
 * in prosthetic makeup. On screen their stature distribution IS the human
 * one."* Plus the measurable one — a species that cannot use the station's
 * furniture or fit its doors is not a resident species.
 */
export const SPECIES = [
  {
    key: 'human', name: 'Human',
    sp: [1.75, 0.070, 1.00, 1.00, 1.00, 1.00, 1.00, [1.00, 1.00, 1.25], 0.78, 1.00, 0.0],
    note: 'The reference figure. Stature MEASURED via INV-020\'s ruler.',
    authority: 1,
    row: {
      id: 'st-human', name: 'Human', hair: true, brows: true, eyes: true,
      skin: 0xc79a76, eye: 0x2c1d12, sclera: 0xece7dd,
      frame: { scale: 1.000, head: 1.000, armLen: 1.00, legLen: 1.00, stature: 1.000 },
      face: {},
    },
    robe: { outer: 0x4a5462, inner: 0x8792a2, trim: 0x2a303a },
  },
  {
    key: 'narn', name: 'Narn',
    sp: [1.88, 0.075, 1.14, 1.08, 0.98, 1.00, 1.06, [1.12, 1.02, 1.22], 0.70, 0.90, 0.0],
    /* MEASURED off G'Kar more.jpg at 6.25×: the head is 1330 crop px tall and
     * 860 wide at the temples, 600 at the jaw — so jaw/cranium is 0.70 against
     * the human 0.78, which is the −0.8 on the jaw axis below. */
    note: 'Head proportions MEASURED off G\'Kar more.jpg. The skin is a RETICULATION — dark cells in a pale raised net — not spots on plain.',
    authority: 2,
    row: {
      id: 'st-narn', name: 'Narn', hair: false, brows: false, eyes: true, ears: false,
      skin: 0xb98a4e, eye: 0x8e2418, sclera: 0xd8c49a,
      frame: { scale: 1.074, head: 1.139, armLen: 1.00, legLen: 0.98, stature: 1.074 },
      face: { skull: -0.45, jaw: -0.80, brow: 0.90, cheek: 0.35, nose: -0.30 },
    },
    robe: { outer: 0x6b4a2c, inner: 0xa8794a, trim: 0x3a2716 },
  },
  {
    key: 'centauri', name: 'Centauri',
    sp: [1.78, 0.070, 1.03, 1.00, 1.00, 1.00, 1.00, [1.00, 1.00, 1.25], 0.78, 1.00, 0.0],
    /* The crest fan is MEASURED off `more zocalo.png`: 1.7× head width, rising
     * 0.55× face length above the crown, laterally flat. It is the HAIR here,
     * which is what the engine has for a thing that stands off the crown and
     * is groomed — and crest breadth signals rank, so it is the widest
     * per-individual spread of any species. */
    note: 'Crest MEASURED off more zocalo.png: 1.7x head width, 0.55x face length above the crown, laterally flat. Male only; females are shaven.',
    authority: 1,
    row: {
      id: 'st-centauri', name: 'Centauri', hair: true, defaultHair: 'crest', brows: true, eyes: true,
      skin: 0xd9b295, eye: 0x3a2a1c, sclera: 0xf0e8dc,
      frame: { scale: 1.017, head: 1.017, armLen: 1.00, legLen: 1.00, stature: 1.017 },
      face: { cheek: 0.2, chin: 0.15 },
    },
    robe: { outer: 0xe4dccb, inner: 0xf4efe4, trim: 0xb59a52 },
  },
  {
    key: 'minbari', name: 'Minbari',
    sp: [1.82, 0.065, 0.93, 0.97, 1.03, 1.01, 0.99, [1.00, 0.98, 1.22], 0.76, 1.05, 0.0],
    /* The crest is a broad upright bone fin rising behind and above the crown,
     * WIDER than the skull. Built through the `horns` mechanism — a ring of
     * bone standing off the vault is what that field already is — with few,
     * long, swept segments rather than a Zabrak's twelve short ones. */
    note: 'Crest read off rotunda.webp: a broad upright bone fin, wider than the skull. Shape sourced, dimensions EXTRAPOLATED. Slender build from the robed silhouette.',
    authority: 1,
    row: {
      id: 'st-minbari', headOf: 'zabrak', name: 'Minbari', hair: false, brows: false, eyes: true, ears: false,
      skin: 0xd9cdbc, eye: 0x4a5a68, sclera: 0xf2ece0,
      horns: { n: 7, seg: 5, nCovered: 7, segCovered: 4, gap: 0.0, at: [0, 0.104, -0.040], sink: 0.004, len: 0.085, lenVar: 0.020, r: 0.014 },
      frame: { scale: 1.040, head: 1.030, armLen: 1.01, legLen: 1.03, stature: 1.040 },
      face: { skull: -0.12, jaw: -0.20, cheek: -0.25, brow: -0.20, nose: -0.35 },
    },
    robe: { outer: 0x35506b, inner: 0x6c8bab, trim: 0x1c2c3d },
  },
  {
    key: 'drazi', name: 'Drazi',
    sp: [1.72, 0.060, 1.26, 1.12, 0.94, 0.98, 1.04, [1.06, 0.96, 1.18], 0.86, 0.55, 2.0],
    note: 'EXTRAPOLATED from "physically robust, blunt" — the League species most often doing the physical work. The heaviest humanoid here: short neck, wide shoulders, heavy limbs.',
    authority: 5,
    row: {
      id: 'st-drazi', name: 'Drazi', hair: false, brows: false, eyes: true, ears: false,
      skin: 0x7f8f5e, eye: 0x2a1c10, sclera: 0xc8c2a4,
      frame: { scale: 0.983, head: 1.022, armLen: 0.98, legLen: 0.94, stature: 0.983 },
      face: { skull: -0.52, jaw: 0.80, brow: 0.85, cheek: 0.55, nose: -0.25, chin: 0.3 },
    },
    robe: { outer: 0x4d6a2e, inner: 0x86a253, trim: 0x2b3a1a },
  },
  {
    key: 'brakiri', name: 'Brakiri',
    sp: [1.76, 0.065, 0.98, 0.98, 1.02, 1.00, 1.00, [1.04, 1.04, 1.24], 0.80, 1.00, 0.0],
    note: 'EXTRAPOLATED: traders and financiers, night dwellers. Built as an unremarkable humanoid so the crowd\'s night shift reads by dress and behaviour rather than by shape.',
    authority: 5,
    row: {
      id: 'st-brakiri', name: 'Brakiri', hair: true, brows: true, eyes: true,
      skin: 0x9a7f6a, eye: 0x1c1208, sclera: 0xdcd2c2,
      frame: { scale: 1.006, head: 1.006, armLen: 1.00, legLen: 1.02, stature: 1.006 },
      face: { skull: 0.05, jaw: 0.20, brow: 0.30 },
    },
    robe: { outer: 0x2b2f3d, inner: 0x555c72, trim: 0x8a6f3a },
  },
  {
    key: 'pakmara', name: "Pak'ma'ra",
    sp: [1.80, 0.070, 1.18, 1.05, 0.96, 0.98, 1.16, [1.10, 1.14, 1.42], 0.62, 0.35, 26.0],
    /* MEASURED: only 165 px of a 465 px head stands above the shoulder line,
     * so the head is carried very low — the shortest neck of any species here
     * at 0.35 — and the 26° stoop carries the crown 0.177 m FORWARD. The head
     * is over the toes, not over the hips. The tendrils are the `lekku`
     * mechanism: four, the outer pair longest, reaching 0.5× head height. */
    note: 'MEASURED off more Pak\'ma\'ra.webp. The lowest-carried head of any species here; head deep front-to-back and pitched down; four tendrils, outer pair longest.',
    authority: 2,
    row: {
      id: 'st-pakmara', headOf: 'nautolan', name: "Pak'ma'ra", hair: false, brows: false, eyes: true, ears: false, mouth: false,
      skin: 0x93a08c, eye: 0x2a2a20, sclera: 0x6a6a58,
      lekku: { at: [0.040, 0.052, -0.010], r: 0.021, len: 0.19, taper: 0.30 },
      frame: { scale: 1.029, head: 1.193, armLen: 0.98, legLen: 0.96, stature: 1.029 },
      face: { skull: 0.35, jaw: -1.00, brow: -0.45, cheek: 0.45, nose: -0.90, chin: -0.55 },
    },
    robe: { outer: 0x4c4a3e, inner: 0x7d7a68, trim: 0x2c2a22 },
  },
  {
    key: 'vree', name: 'Vree',
    sp: [1.50, 0.050, 0.72, 0.84, 0.92, 1.06, 1.22, [1.20, 1.10, 1.10], 0.58, 0.80, 0.0],
    note: 'EXTRAPOLATED and WEAK — the source gives only "traders; saucer craft". Built small and large-headed so the tail of the crowd has a small silhouette in it. Overturned by any frame showing a Vree beside a human.',
    authority: 5,
    row: {
      id: 'st-vree', headOf: 'keldor', name: 'Vree', hair: false, brows: false, eyes: true, ears: false, mouth: false,
      skin: 0xc9cfd4, eye: 0x14161c, sclera: 0x14161c,
      frame: { scale: 0.857, head: 1.045, armLen: 1.06, legLen: 0.92, stature: 0.857 },
      face: { skull: -0.36, jaw: -1.00, brow: -0.70, cheek: -0.40, nose: -1.00, chin: -0.70, eyes: 0.90 },
    },
    robe: { outer: 0x9aa4ac, inner: 0xc4ccd2, trim: 0x5e666e },
  },
  {
    key: 'abbai', name: 'Abbai',
    sp: [1.70, 0.060, 1.04, 0.99, 0.98, 0.99, 1.05, [1.06, 1.08, 1.20], 0.74, 0.85, 0.0],
    /* The amphibian note is the only shape information anywhere, so it gets
     * ONE attachment — a low swept head fin — and nothing else. */
    note: 'EXTRAPOLATED: League founders, mediators, amphibian. The amphibian note is the only shape information, so it gets one attachment and nothing else.',
    authority: 5,
    row: {
      id: 'st-abbai', headOf: 'zabrak', name: 'Abbai', hair: false, brows: false, eyes: true, ears: false,
      skin: 0x8fa9a2, eye: 0x1a2a28, sclera: 0xd0dcd8,
      horns: { n: 3, seg: 4, nCovered: 3, segCovered: 3, gap: 0.0, at: [0, 0.100, -0.020], sink: 0.006, len: 0.042, lenVar: 0.010, r: 0.010 },
      frame: { scale: 0.971, head: 1.020, armLen: 0.99, legLen: 0.98, stature: 0.971 },
      face: { skull: 0.19, jaw: -0.40, brow: -0.30, cheek: 0.30, nose: -0.55 },
    },
    robe: { outer: 0x2f6a68, inner: 0x63a29e, trim: 0x1a3b3a },
  },
  {
    key: 'gaim', name: 'Gaim',
    sp: [1.84, 0.045, 1.30, 1.14, 0.94, 0.96, 1.10, [1.10, 1.05, 1.15], 0.90, 0.30, 4.0],
    /* A SUIT, not a body. Rigid plates, hard edges, no soft taper, no exposed
     * skin, no face. Sigma is small because a suit is manufactured in sizes
     * rather than grown — which is why this is the cheapest and most distinct
     * of the fifteen (§3.3 says exactly that). */
    note: 'A SUIT, not a body: rigid plates, no exposed skin, no face. Sigma is small because a suit is made in sizes rather than grown. Everything about the shell is EXTRAPOLATED, constrained by the one encounter suit that IS attested.',
    authority: 5, suit: true,
    row: {
      id: 'st-gaim', headOf: 'zabrak', name: 'Gaim', hair: false, brows: false, eyes: false, ears: false, mouth: false,
      skin: 0xb0a271, eye: 0xff8a2a, sclera: 0xff8a2a,
      horns: { n: 5, seg: 4, nCovered: 5, segCovered: 3, gap: 0.0, at: [0, 0.086, 0.010], sink: 0.002, len: 0.050, lenVar: 0.006, r: 0.017 },
      frame: { scale: 1.051, head: 1.157, armLen: 0.96, legLen: 0.94, stature: 1.051 },
      face: { skull: -0.18, jaw: 1.00, brow: 0.60, cheek: 0.80, nose: -1.00, chin: -0.20 },
    },
    robe: { outer: 0x6d6444, inner: 0x9c9066, trim: 0x3c3724 },
  },
  {
    key: 'hyach', name: 'Hyach',
    sp: [1.80, 0.055, 0.94, 0.96, 1.02, 1.00, 1.02, [1.02, 1.06, 1.20], 0.72, 1.10, 3.0],
    note: 'EXTRAPOLATED: "long-lived, formal". Tall, thin and slightly stooped — age reads as posture at crowd distance far better than as a texture.',
    authority: 5,
    row: {
      id: 'st-hyach', name: 'Hyach', hair: false, brows: false, eyes: true, ears: false,
      skin: 0xc8ae92, eye: 0x40301c, sclera: 0xe8dcc8,
      frame: { scale: 1.029, head: 1.049, armLen: 1.00, legLen: 1.02, stature: 1.029 },
      face: { skull: 0.26, jaw: -0.60, cheek: -0.45, brow: 0.15, chin: -0.25 },
    },
    robe: { outer: 0x53406a, inner: 0x8a76a4, trim: 0x2c2138 },
  },
  {
    key: 'llort', name: 'Llort',
    sp: [1.64, 0.060, 1.10, 1.04, 0.92, 1.08, 1.02, [1.02, 0.96, 1.20], 0.84, 0.75, 6.0],
    note: 'EXTRAPOLATED: "a reputation as scavengers and thieves". Short, long-armed and habitually stooped, so a Llort reads differently in a corridor without a single new mesh.',
    authority: 5,
    row: {
      id: 'st-llort', name: 'Llort', hair: true, brows: true, eyes: true,
      skin: 0x8e8570, eye: 0x1a1408, sclera: 0xc8c0a8,
      frame: { scale: 0.937, head: 0.956, armLen: 1.08, legLen: 0.92, stature: 0.937 },
      face: { skull: -0.33, jaw: 0.60, brow: 0.55, cheek: 0.25, nose: 0.30 },
    },
    robe: { outer: 0x4a4238, inner: 0x7c7060, trim: 0x28231c },
  },
  {
    key: 'grome', name: 'Grome',
    sp: [1.93, 0.070, 1.34, 1.16, 1.00, 0.96, 1.00, [1.04, 0.94, 1.20], 0.88, 0.60, 3.0],
    note: 'EXTRAPOLATED: the source gives no character at all beyond "League members" and places them in hydroponics and labour. Built as the LARGEST humanoid; the door-height assertion is what stops this growing.',
    authority: 5,
    row: {
      id: 'st-grome', name: 'Grome', hair: false, brows: false, eyes: true, ears: false,
      skin: 0x7d7a63, eye: 0x241c0e, sclera: 0xbcb69c,
      frame: { scale: 1.103, head: 1.103, armLen: 0.96, legLen: 1.00, stature: 1.103 },
      face: { skull: -0.54, jaw: 1.00, brow: 0.75, cheek: 0.60, nose: -0.15, chin: 0.4 },
    },
    robe: { outer: 0x54502f, inner: 0x86814f, trim: 0x2e2c1a },
  },
  {
    key: 'other', name: 'Other',
    sp: [1.74, 0.140, 1.00, 1.00, 1.00, 1.00, 1.05, [1.05, 1.02, 1.20], 0.78, 0.90, 0.0],
    /* THE TAIL, and its sigma is deliberately ~2× every other row's: "so the
     * tail never looks like the same six aliens". It is a distribution, not a
     * species, and `individual()` below widens its build and cranium jitter
     * as well as its stature. */
    note: 'The tail: rare League species, unidentified traders, one-off visitors. A DISTRIBUTION, not a species — its per-individual spread is deliberately ~2x every other row\'s.',
    authority: 5,
    row: {
      id: 'st-other', name: 'Other', hair: true, brows: true, eyes: true,
      skin: 0xa98d72, eye: 0x2a1e12, sclera: 0xe0d6c6,
      frame: { scale: 0.994, head: 1.044, armLen: 1.00, legLen: 1.00, stature: 0.994 },
      face: { skull: -0.12 },
    },
    robe: { outer: 0x5c4f66, inner: 0x93849c, trim: 0x322a3a },
  },
  {
    key: 'vorlon', name: 'Vorlon',
    sp: [2.05, 0.000, 1.00, 1.00, 0.00, 0.00, 1.00, [1.00, 1.00, 1.00], 1.00, 0.00, 0.0],
    /* A SINGLETON, and `individual()` refuses to jitter it: sigma is 0.0,
     * there is exactly one, and it is the same every session. 2.05 m is not a
     * guess — it is the one hard constraint available, that the suit uses the
     * station's own doors. §3.2 #37 gives it one place and it never walks. */
    note: 'A SINGLETON. Kosh. 2.05 m because the suit uses the station\'s doors and nothing else constrains it. sigma 0.0: there is exactly one of these and it is the same every session.',
    authority: 2, suit: true, singleton: true,
    row: {
      id: 'st-vorlon', headOf: 'keldor', name: 'Vorlon', hair: false, brows: false, eyes: false, ears: false, mouth: false,
      skin: 0xc8a86a, eye: 0xffd48a, sclera: 0xffd48a,
      frame: { scale: 1.171, head: 1.171, armLen: 0.92, legLen: 0.96, stature: 1.171 },
      face: { skull: 0.6, jaw: 1.0, brow: 1.0, cheek: 1.0, nose: -1.0, mouth: -1.0 },
    },
    robe: { outer: 0x8a6f38, inner: 0xc8a86a, trim: 0x4a3a1c },
  },
];

/** By key, for everything that reads a species by name. */
export const SPECIES_BY = new Map(SPECIES.map((s) => [s.key, s]));

/** The fifteen keys, in `body.py`'s own order. §5.3: every one has a builder. */
export const SPECIES_KEYS = SPECIES.map((s) => s.key);

/* ══════════════════════════════════════════════════════════════════════════ */
/*  NAMES — station/npc/names.py                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE GRAMMARS, PORTED ══════════════════════════════════════════════════
 *
 * Fifteen generators, each with the stems `names.py` collected off the frames
 * it names. What they are for is one line in §14: *"Names from `names.py` on
 * a nameplate when you look at someone."*
 *
 * DETERMINISTIC ON A SEED, exactly as the Python is: a resident's name is a
 * function of who they are, so it survives a save, a reload and a return
 * visit later in the same day (§14's persistence line). A `Math.random()`
 * here would rename the whole station every time you walked back into a room.
 */
const NAMES = {
  narn: {
    prefix: ['G', 'Na', 'Ta', 'Du', 'Ka', 'Ha', 'Vi', 'Ra', 'Mi', 'Sh', 'To', 'Za'],
    stem: ['Kar', 'Toth', 'Lon', 'Quan', 'Far', 'Rog', 'Shal', 'Tok', 'Dan', 'Vok',
      'Reth', 'Mok', 'Lan', 'Sar', 'Thak', 'Ren', 'Dral', 'Kon', 'Vash', 'Tor'],
  },
  centauri: {
    given: ['Londo', 'Vir', 'Urza', 'Carn', 'Dius', 'Antono', 'Malachi', 'Turhan',
      'Cartagia', 'Elrik', 'Marrago', 'Durano', 'Vitari', 'Sollan', 'Casta'],
    house: ['Mollari', 'Cotto', 'Jaddo', 'Refa', 'Kiro', 'Tavari', 'Deradi', 'Sorina',
      'Vallo', 'Tirenne', 'Ossara', 'Belaro', 'Cassini', 'Loveni', 'Marrit'],
  },
  minbari: {
    onset: ['Del', 'Lenn', 'Ner', 'Dra', 'Duk', 'Rath', 'Shak', 'Turv', 'Kal', 'Sin',
      'Val', 'Mor', 'Ther', 'Bran', 'Sech', 'Nel', 'Cor', 'Ash'],
    coda: ['enn', 'ier', 'oon', 'al', 'at', 'iri', 'an', 'ath', 'ir', 'en', 'aan', 'ell'],
  },
  human: {
    given: ['Jeffrey', 'Michael', 'Stephen', 'Zack', 'Warren', 'Marcus', 'David', 'Mateo',
      'Piotr', 'Susan', 'Elizabeth', 'Lianna', 'Neeoma', 'Tessa', 'Aisha', 'Anna',
      'Nadia', 'Amis', 'Ko', 'Bo', 'Yuki', 'Ade'],
    surname: ['Sinclair', 'Ivanova', 'Garibaldi', 'Franklin', 'Allan', 'Keffer', 'Cole',
      'Corwin', 'Connally', 'Winters', 'Alexander', 'Redway', 'Okoro', 'Nakamura',
      'Silva', 'Haddad', 'Novak', 'Lindqvist', 'Mbeki', 'Rossi', 'Duval', 'Chowdhury',
      'Ericsson', 'Ramirez'],
  },
  drazi: {
    stem: ['Vok', 'Zhad', 'Grum', 'Tak', 'Bra', 'Nok', 'Dral', 'Kro', 'Zar', 'Thul'],
    tail: ['', 'ak', 'un', 'or', 'ith', 'az'],
  },
  /* The species word is this grammar's own reserved entry: `PAK` holds "pak",
   * "ma" and "ra", so it can spell `pak'ma'ra` — an individual whose personal
   * name is the word for their whole species — and the third syllable is
   * filtered to stop it. */
  pakmara: { syl: ['pak', 'ma', 'ra', 'tho', 'gul', 'sen', 'vak', 'lu', 'mor', 'esh', 'ka', 'rin'] },
  vorlon: { name: ['Kosh', 'Ulkesh', 'Ithik', 'Sherann', 'Vakhet', 'Zohar'] },
  brakiri: {
    given: ['Torbek', 'Krasil', 'Brakan', 'Dranek', 'Zhabir', 'Tessik', 'Mordak', 'Vrasim',
      'Halbek', 'Ostrek', 'Nakiri', 'Ferakh', 'Dobrin', 'Semikh', 'Turbal', 'Kravic',
      'Belsir', 'Ondrek', 'Tarnik', 'Vesbar'],
    house: ['Ashem', 'Vashal', 'Drenim', 'Kolbar', 'Tirakh', 'Semvar', 'Brannik', 'Oskeri',
      'Zhemal', 'Lubrin', 'Karsim', 'Hedrak', 'Norvim', 'Casbek', 'Elrash', 'Timbari'],
  },
  vree: {
    onset: ['Vr', 'Shr', 'Zh', 'Kr', 'Thr', 'Sr', 'Fl', 'Chr', 'Vl', 'Skr', 'Pr', 'Tr',
      'Gl', 'Sv', 'Zv', 'Str', 'Sn', 'Kl'],
    nucleus: ['ee', 'aa', 'ii', 'oo', 'uu'],
    coda: ['n', 'l', 'sh', 'th', 'k'],
  },
  abbai: {
    vowel: ['A', 'E', 'I', 'O', 'U'],
    stem: ['bba', 'mma', 'ssa', 'lla', 'nna', 'ddi', 'rri', 'kko', 'ppa', 'tti', 'ffe', 'zza'],
    tail: ['i', 'ra', 'li', 'shu', 'mi', 'na'],
  },
  /* NOT A PERSONAL NAME, AND THAT IS THE POINT: hive caste, so a Gaim is
   * identified by its line and an ordinal within it. */
  gaim: {
    onset: ['Zha', 'Kre', 'Mok', 'Vash', 'Thra', 'Ssu', 'Nge', 'Gai'],
    coda: ['maim', 'kesh', 'roth', 'shal', 'vekh', 'nurr'],
    ordinals: 99,
  },
  /* THE LINEAGE COMES FIRST, which is the inverse of the human order: a
   * species that outlives its own institutions identifies by the thing that
   * persists. It is the only row here whose two halves swap meaning. */
  hyach: {
    lineage: ['Hyavann', 'Nyoreth', 'Kyavesh', 'Tyaloch', 'Shyareth', 'Hyunneth', 'Myavach',
      'Lyoseth', 'Gyareth', 'Nyulech', 'Chyavan', 'Ryoneth', 'Hyalach', 'Kyunesh',
      'Tyaresh', 'Syovach'],
    personal: ['Tesh', 'Valach', 'Norech', 'Suvann', 'Ileth', 'Marech', 'Ossan', 'Yaleth',
      'Turach', 'Nevesh', 'Alech', 'Rivann', 'Sonach', 'Emeth', 'Kavesh', 'Uleth',
      'Dorach', 'Sevann'],
  },
  llort: {
    onset: ['Ll', 'Rr', 'Nn', 'Mm', 'Zz', 'Kk', 'Tt', 'Dd', 'Gg', 'Vv', 'Ss', 'Bb'],
    coda: ['ort', 'urk', 'ask', 'ist', 'ekt', 'unt', 'arg', 'osk', 'irt', 'ugh', 'akt',
      'esk', 'olt', 'ump', 'irk', 'ost', 'ans', 'ubb'],
  },
  grome: {
    onset: ['Gr', 'Br', 'Dr', 'Thr', 'Kr', 'Skr', 'Vr', 'Ghr', 'Tr', 'Chr', 'Pr', 'Shr', 'Zr', 'Str'],
    coda: ['om', 'ome', 'un', 'on', 'olo', 'ovek', 'orn', 'umal', 'oth', 'ogun', 'omek', 'ulo'],
  },
};

/** A stable 0..1 from a string and a salt — `names.py`'s `_rng`, ported. */
function hashF(seed, salt = '') {
  const s = `${seed}|${salt}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pick = (arr, seed, salt) => arr[Math.floor(hashF(seed, salt) * arr.length) % arr.length];

/**
 * A resident's name. Deterministic on `seed` — see the note over `NAMES`.
 *
 * `stationcast.mjs` holds two things about this: every species has one, and
 * **it never returns a Borz name**. A Narn called CT-1147 would be the
 * hub-of-worlds rule (§10) broken in the one place a player reads a name.
 */
export function nameFor(species, seed) {
  const N = NAMES[species];
  switch (species) {
    case 'narn': return `${pick(N.prefix, seed, '1')}'${pick(N.stem, seed, '2')}`;
    case 'centauri': return `${pick(N.given, seed, 'g')} ${pick(N.house, seed, 'h')}`;
    case 'minbari': return pick(N.onset, seed, 'o') + pick(N.coda, seed, 'c');
    case 'human': return `${pick(N.given, seed, 'g')} ${pick(N.surname, seed, 's')}`;
    case 'drazi': return pick(N.stem, seed, 's') + pick(N.tail, seed, 't');
    case 'pakmara': {
      const a = pick(N.syl, seed, '1'), b = pick(N.syl, seed, '2');
      let c = pick(N.syl, seed, '3');
      /* The filter: never the species' own word — see the note on the row. */
      if (a === 'pak' && b === 'ma' && c === 'ra') c = N.syl[(N.syl.indexOf(c) + 1) % N.syl.length];
      return `${a}'${b}'${c}`;
    }
    case 'vorlon': return pick(N.name, seed, 'v');
    case 'brakiri': return `${pick(N.given, seed, 'g')} ${pick(N.house, seed, 'h')}`;
    case 'vree': return pick(N.onset, seed, 'o') + pick(N.nucleus, seed, 'n') + pick(N.coda, seed, 'c');
    case 'abbai': return pick(N.vowel, seed, 'v') + pick(N.stem, seed, 's') + pick(N.tail, seed, 't');
    case 'gaim': return `${pick(N.onset, seed, 'o')}${pick(N.coda, seed, 'c')}-${1 + Math.floor(hashF(seed, 'n') * N.ordinals)}`;
    case 'hyach': return `${pick(N.lineage, seed, 'l')} ${pick(N.personal, seed, 'p')}`;
    case 'llort': return pick(N.onset, seed, 'o') + pick(N.coda, seed, 'c');
    case 'grome': return pick(N.onset, seed, 'o') + pick(N.coda, seed, 'c');
    /* THE TAIL ROTATES GRAMMARS, so it never reads as one more species. */
    default: {
      const g = ['vree', 'abbai', 'llort', 'grome', 'brakiri', 'minbari'];
      return nameFor(g[Math.floor(hashF(seed, 'grammar') * g.length) % g.length], `${seed}~`);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE DAY — station/npc/schedule.py                                         */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ RHYTHMS — when each species sleeps and eats ═══════════════════════════
 *
 * §3.4's clock is one game hour per two real minutes and everything reads it.
 * These are the rows that make the station's day a day rather than a loop:
 * the Brakiri sleep through it and trade through its night, which is *what
 * gives station-night a crowd of its own*; the Minbari's sleep is broken, so
 * they are abroad at hours nobody else is; the Llort's rhythm IS the crime
 * layer; and the Vorlon is secluded for twenty hours.
 *
 * `jitter` is the per-individual spread. 0.35 for the Gaim because a hive has
 * very little individual scatter, 3.0 for `other` because the whole point of
 * that row is that it must not read as one more species.
 */
export const RHYTHMS = {
  human: { sleep: 23.0, hours: 7.5, meals: [7.0, 12.5, 19.0], jitter: 1.0, atmos: 'standard', breather: 'none', note: 'Sets the station clock. Three meals, one long sleep.' },
  minbari: { sleep: 22.5, hours: 4.0, meals: [8.0, 18.0], jitter: 1.0, atmos: 'standard', breather: 'none', note: 'Sleep is BROKEN — a waking period mid-rest, so Minbari are abroad at hours no one else is.' },
  centauri: { sleep: 4.5, hours: 6.5, meals: [12.0, 17.0, 23.0], jitter: 1.0, atmos: 'standard', breather: 'none', note: 'Retires near dawn. Social life is nocturnal and drink-centred.' },
  narn: { sleep: 21.5, hours: 8.0, meals: [6.0, 13.0, 19.5], jitter: 1.0, atmos: 'standard', breather: 'none', note: 'Early and regimented.' },
  drazi: { sleep: 0.5, hours: 6.5, meals: [9.0, 20.0], jitter: 1.0, atmos: 'standard', breather: 'none', note: 'Two large meals rather than three.' },
  pakmara: { sleep: 20.0, hours: 9.0, meals: [4.0, 16.0], jitter: 1.1, atmos: 'standard', breather: 'none', note: 'Long sleep; feeding at low-traffic hours. The only species with a segregated food economy.' },
  brakiri: { sleep: 9.0, hours: 7.0, meals: [17.0, 22.5, 3.5], jitter: 1.0, atmos: 'standard', breather: 'none', note: 'NIGHT DWELLERS. Sleeps through the station day and trades through its night — this is what gives station-night a crowd of its own.' },
  vree: { sleep: 23.5, hours: 6.0, meals: [8.0, 19.0], jitter: 1.2, atmos: 'standard', breather: 'none', note: 'Traders on human-facing market hours.' },
  abbai: { sleep: 22.0, hours: 7.0, meals: [7.0, 12.0, 18.5], jitter: 1.0, atmos: 'humid', breather: 'mask', note: 'Amphibian. Rest is taken in water, so the sleep block is at a fixed PLACE and not merely a fixed hour.' },
  gaim: { sleep: 1.0, hours: 5.0, meals: [6.5, 17.5], jitter: 0.35, atmos: 'methane', breather: 'suit', note: 'A Gaim cannot eat outside its own atmosphere, so the two meals BRACKET the shift and are taken in the methane quarter.' },
  hyach: { sleep: 21.0, hours: 6.0, meals: [6.5, 12.0, 18.0], jitter: 0.4, atmos: 'standard', breather: 'none', note: 'Formality is legible in a crowd as everyone doing the same thing at once.' },
  llort: { sleep: 8.0, hours: 6.0, meals: [15.0, 1.5], jitter: 1.3, atmos: 'standard', breather: 'none', note: 'Sleeps through the morning and works the margins of the market day and the small hours — the rhythm IS the crime layer.' },
  grome: { sleep: 20.5, hours: 8.0, meals: [4.5, 11.5, 18.0], jitter: 1.0, atmos: 'standard', breather: 'none', note: 'Aligned to the agricultural shift, which is not an office day.' },
  other: { sleep: 23.0, hours: 7.0, meals: [7.5, 13.0, 19.0], jitter: 3.0, atmos: 'standard', breather: 'none', note: 'WIDE individual scatter is the point.' },
  vorlon: { sleep: 0.0, hours: 20.0, meals: [], jitter: 0.0, atmos: 'undisclosed', breather: 'suit', note: 'Seclusion for twenty hours. No meals: none is ever depicted.' },
};

/**
 * ══ THE JOBS — nineteen roles, each with a shift and a workplace ══════════
 *
 * `schedule.py`'s `ROLES`, with `where` re-pointed at a place id in §3.2's
 * gazetteer: the other station's `docking_bay` is this one's #8, its `zocalo`
 * is #9, its `cnc` is #41. That re-pointing is the whole port — the hours are
 * theirs and the geography is ours, and nothing else changes.
 */
export const ROLES = [
  { key: 'dockworker', start: 6.0, hours: 9.0, where: 8, note: 'Day shift 06:00–15:00; the two muster surges are 06:00 and 14:00.' },
  { key: 'traffic', start: 8.0, hours: 8.0, where: 2, note: 'Three watches; the tower is manned through the night.' },
  { key: 'security', start: 8.0, hours: 8.0, where: 24, note: 'Watches at 00/08/16. A patrol unit is two, always.' },
  { key: 'customs', start: 8.0, hours: 8.0, where: 7, note: 'Three shifts on the gates.' },
  { key: 'merchant', start: 9.0, hours: 11.0, where: 9, note: 'The Concourse\'s own hours.' },
  { key: 'financier', start: 9.0, hours: 8.0, where: 18, note: 'Rigid office hours in a station with no day — and the Brakiri keep the same hours in their own frame, which puts them on the night side of the same market.' },
  { key: 'engineer', start: 7.0, hours: 9.0, where: 48, note: '' },
  { key: 'industrial', start: 8.0, hours: 8.0, where: 50, note: '24 h, three shifts.' },
  { key: 'waste', start: 8.0, hours: 8.0, where: 53, note: '' },
  { key: 'hydroponics', start: 5.0, hours: 8.0, where: 23, note: 'Agricultural shift 05:00–13:00, not an office shift.' },
  { key: 'medical', start: 8.0, hours: 12.0, where: 43, note: '12-hour turnover at 08:00 and 20:00.' },
  { key: 'diplomat', start: 10.0, hours: 7.0, where: 41, note: '' },
  { key: 'command', start: 8.0, hours: 8.0, where: 41, note: 'Three watches.' },
  { key: 'cleric', start: 6.0, hours: 8.0, where: 22, note: 'Gives the chapel a destination it would not otherwise have.' },
  { key: 'service', start: 8.0, hours: 9.0, where: 15, note: '' },
  { key: 'envoy', start: 10.0, hours: 2.0, where: 37, note: 'Kosh. A two-hour public day; the rest is seclusion.' },
  { key: 'visitor', start: 0.0, hours: 0.0, where: 9, note: 'No job aboard: they shop, eat, queue and wait for a berth.' },
  { key: 'refugee', start: 0.0, hours: 0.0, where: 7, note: 'Queuing and waiting is not leisure and is not lurking.' },
  { key: 'lurker', start: 0.0, hours: 0.0, where: 52, note: 'No work hours at all.' },
];
export const ROLE_BY = new Map(ROLES.map((r) => [r.key, r]));

/**
 * Which jobs a species does, and in what proportion. `schedule.py`'s
 * `ROLE_WEIGHTS`, verbatim — this is the table that stops the station being
 * fifteen interchangeable crowds: the Narn are refugees and traders, the
 * Centauri are financiers, the pak'ma'ra do the waste, the Llort lurk, and
 * every one of those is a place they will be standing in at a given hour.
 */
export const ROLE_WEIGHTS = {
  human: { command: 120, security: 500, medical: 2800, dockworker: 1150, traffic: 400, engineer: 10430, hydroponics: 1100, waste: 300, customs: 900, industrial: 18000, merchant: 26000, service: 39000, financier: 9000, cleric: 300, diplomat: 500, visitor: 31000, lurker: 13500 },
  narn: { diplomat: 30, merchant: 6000, refugee: 13000, lurker: 2470, visitor: 1000 },
  centauri: { diplomat: 150, financier: 11000, visitor: 5000, lurker: 1350 },
  minbari: { cleric: 7000, engineer: 4000, diplomat: 680, visitor: 800, lurker: 20 },
  drazi: { dockworker: 4500, industrial: 3000, service: 1500, merchant: 1200, visitor: 1500, lurker: 800 },
  brakiri: { financier: 3000, merchant: 2500, service: 800, visitor: 1000, lurker: 200 },
  pakmara: { waste: 2200, dockworker: 1500, lurker: 1400, service: 600, visitor: 550 },
  vree: { merchant: 2000, dockworker: 1200, visitor: 1400, service: 400 },
  abbai: { hydroponics: 1400, diplomat: 350, service: 700, merchant: 600, visitor: 700 },
  gaim: { industrial: 900, dockworker: 800, visitor: 500, diplomat: 100, merchant: 200 },
  hyach: { financier: 700, diplomat: 250, merchant: 300, visitor: 500 },
  llort: { lurker: 500, dockworker: 300, merchant: 250, visitor: 200 },
  grome: { hydroponics: 350, industrial: 200, visitor: 120, service: 80 },
  other: { visitor: 500, merchant: 250, dockworker: 200, service: 150, lurker: 150 },
  vorlon: { envoy: 1 },
};

/**
 * The station's own mix. `schedule.py`'s `STATION_COUNTS` is a 250 000-soul
 * census; this station's live population is a POOL of sixty (§11), so the
 * counts are carried as SHARES and the pool is drawn from them. A share is
 * portable to any headcount; a count is not, and a count of 155 000 humans in
 * a room that holds ninety is a number nobody can use.
 */
const CENSUS = {
  human: 155000, narn: 22500, centauri: 17500, minbari: 12500, drazi: 12500,
  brakiri: 7500, pakmara: 6250, vree: 5000, abbai: 3750, gaim: 2500,
  hyach: 1750, llort: 1250, other: 1250, grome: 750, vorlon: 1,
};
const CENSUS_TOTAL = Object.values(CENSUS).reduce((a, b) => a + b, 0);
export const SHARE = Object.fromEntries(
  Object.entries(CENSUS).map(([k, v]) => [k, v / CENSUS_TOTAL]));

/* ══════════════════════════════════════════════════════════════════════════ */
/*  WHO STANDS WITH WHOM — station/npc/faction.py                             */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ FACTIONS, AND THE VERBS THAT MAKE THEM VISIBLE ════════════════════════
 *
 * A faction nobody can see is a table. What makes these legible in a corridor
 * is the VERB one takes when it meets another — and `faction.py`'s own
 * closing rule is that 95% of it is avoidance, which is why most of these are
 * a step aside rather than a fight.
 *
 * The two that are not avoidance are the pair the whole setting turns on:
 * *"the Centauri crosses to the far side"* and *"the Narn stops, turns, and
 * does not yield the corridor"*. `StationLife` reads this when two residents
 * of hostile factions meet on the ring, and §11's rule holds over all of it —
 * **residents never fight unless attacked.**
 */
export const VERBS = {
  widen: { yields: true, does: 'shifts across the corridor to leave the required room' },
  cross: { yields: true, does: 'crosses to the far side of the corridor and stays there' },
  hold: { yields: false, does: 'stops, turns, and holds the middle of the corridor' },
  aside: { yields: false, does: 'steps into the nearest doorway and waits for them to pass' },
  reverse: { yields: false, does: 'turns round and leaves the way they came' },
  clear: { yields: false, does: 'the corridor clears without being told to' },
  quieten: { yields: true, does: 'keeps walking and stops talking' },
  none: { yields: true, does: 'nothing — they pass' },
};

/**
 * The factions, with the places on THIS station they hold. `faction.py` has
 * twenty-eight; the ones below are the ones with a place in §3.2's gazetteer,
 * because a faction whose ground is not built is a row with nowhere to stand.
 * The rest are carried on the species rows as their `bloc`.
 */
export const FACTIONS = [
  { id: 'admin', name: 'Station administration', by: { role: 'customs' }, holds: [7, 11], hours: 'office; customs on all three watches' },
  { id: 'command', name: 'Command', by: { role: 'command' }, holds: [41, 42, 30], hours: 'three watches at 00/08/16' },
  { id: 'security', name: 'Security', by: { role: 'security' }, holds: [24, 47, 7, 9], hours: 'watches A/B/C; a patrol unit is two, always' },
  { id: 'guild', name: "The Dockers' Guild", by: { role: 'dockworker' }, holds: [8, 52], hours: 'fixed day shift; muster crowds at 06:00 and 14:00' },
  { id: 'medical', name: 'Medical service', by: { role: 'medical' }, holds: [43, 44, 45], hours: '12-hour turnover at 08:00 and 20:00' },
  { id: 'merchants', name: 'The Concourse merchants', by: { role: 'merchant' }, holds: [9, 10, 17], hours: 'the market shift, 09:00 for eleven hours' },
  { id: 'narn', name: 'The Narn', by: { species: 'narn' }, holds: [32], hours: 'sleep 21:30; the aid queue from 06:00; traders 09:00–20:00' },
  { id: 'centauri', name: 'The Centauri', by: { species: 'centauri' }, holds: [33, 15, 18], hours: 'late — the Pit is culturally theirs' },
  { id: 'minbari', name: 'The Minbari', by: { species: 'minbari' }, holds: [34, 22], hours: 'the chapel rota; caste turnover at 18:00' },
  { id: 'league', name: 'The League of Non-Aligned Worlds', by: { species: ['abbai', 'brakiri', 'drazi', 'gaim', 'grome', 'hyach', 'llort', 'pakmara', 'vree'] }, holds: [41, 36], hours: 'council hours' },
  { id: 'drazi', name: 'The Drazi', by: { species: 'drazi' }, holds: [35, 14], hours: 'dock-gang hours' },
  { id: 'brakiri', name: 'The Brakiri', by: { species: 'brakiri' }, holds: [18, 14], hours: 'night desks, 18:30–02:30' },
  { id: 'pakmara', name: "The pak'ma'ra", by: { species: 'pakmara' }, holds: [53, 36], hours: 'meal windows at 04:00 and 16:00' },
  { id: 'vorlon', name: 'The Vorlon', by: { species: 'vorlon' }, holds: [37], hours: 'almost never' },
  { id: 'lurkers', name: 'Downbelow', by: { role: 'lurker' }, holds: [52, 53], hours: 'salvage by day, fence by night' },
  { id: 'clerics', name: 'Religious orders', by: { role: 'cleric' }, holds: [22, 45], hours: 'the cleric shift from 06:00' },
];

/**
 * What one faction does when it meets another. The default is `none` — a
 * table of frictions that scored everything would be a station where nobody
 * simply walks past anybody, which is the opposite of what the source's own
 * closing rule says.
 */
export const FRICTION = {
  'narn|centauri': ['hold', 'cross'],
  'centauri|narn': ['cross', 'hold'],
  'lurkers|security': ['reverse', 'none'],
  'security|lurkers': ['none', 'reverse'],
  'vorlon|*': ['none', 'clear'],
  'minbari|*': ['widen', 'widen'],
  'pakmara|merchants': ['aside', 'none'],
};

/** The verbs two residents take when they meet. Never a fight (§11). */
export function frictionBetween(a, b) {
  return FRICTION[`${a}|${b}`] || FRICTION[`${a}|*`] || ['none', 'none'];
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  ONE RESIDENT                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * A resident, drawn deterministically from a seed: species, name, job, and
 * the per-individual jitter `body.py`'s `individual()` applies.
 *
 * `body.py`'s sigma column is the spread, and the two rows that matter are
 * `other` (0.140, ~2× everything else, "so the tail never looks like the same
 * six aliens") and `vorlon` (0.000 — a singleton, and `individual()` refuses
 * to jitter it).
 */
export function resident(seed, opts = {}) {
  const key = opts.species || speciesFor(seed);
  const S = SPECIES_BY.get(key) || SPECIES_BY.get('human');
  const [stature, sigma] = S.sp;
  /* Box–Muller off two hashes, so a resident's height is a real draw from the
   * species' own distribution rather than a uniform smear across it. */
  const u = Math.max(1e-6, hashF(seed, 'h1')), v = hashF(seed, 'h2');
  const g = S.singleton ? 0 : Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  const h = stature + g * sigma;
  const role = opts.role || roleFor(key, seed);
  return {
    seed,
    species: key,
    name: nameFor(key, seed),
    role,
    stature: h,
    /* The frame this individual is built at: the species' row scaled by how
     * far this one is from its own mean. */
    scale: h / stature,
    rhythm: RHYTHMS[key],
    faction: factionFor(key, role),
    home: homeFor(key, role),
  };
}

/** Which species, drawn from the census shares. */
export function speciesFor(seed) {
  let r = hashF(seed, 'species');
  for (const k of SPECIES_KEYS) {
    /* The Vorlon is never drawn: there is one, it is placed by hand at #37,
     * and a census share of 1 in 250 000 rounds to nobody anyway. */
    if (k === 'vorlon') continue;
    r -= SHARE[k];
    if (r <= 0) return k;
  }
  return 'human';
}

/** Which job, from `ROLE_WEIGHTS`. */
export function roleFor(species, seed) {
  const w = ROLE_WEIGHTS[species] || ROLE_WEIGHTS.human;
  let total = 0;
  for (const v of Object.values(w)) total += v;
  let r = hashF(seed, 'role') * total;
  for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; }
  return 'visitor';
}

/** Which faction this resident belongs to — species first, then job. */
export function factionFor(species, role) {
  for (const f of FACTIONS) {
    const s = f.by.species;
    if (s && (s === species || (Array.isArray(s) && s.includes(species)))) return f.id;
  }
  for (const f of FACTIONS) if (f.by.role === role) return f.id;
  return 'merchants';
}

/**
 * Where a resident lives. §3.3: quarters BY PEOPLE (#31–#37), mixing on deck
 * 40 — so the species decides the home and the job decides the day.
 */
const HOMES = {
  human: 31, narn: 32, centauri: 33, minbari: 34, drazi: 35,
  gaim: 36, pakmara: 36, vorlon: 37,
  brakiri: 38, vree: 38, abbai: 38, hyach: 38, llort: 38, grome: 38, other: 38,
};
export function homeFor(species, role) {
  const id = (role === 'refugee' || role === 'lurker') ? 38 : (HOMES[species] ?? 38);
  /* A home that is not a place in the gazetteer is a resident with nowhere to
   * sleep, and §15's rule is that a place not in §3.2 is not built — so the
   * table is held against the gazetteer here rather than by a check that runs
   * later. */
  if (!PLACE.has(id)) throw new Error(`StationCast: ${species} is housed at #${id}, which is not in the gazetteer`);
  return id;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE BODIES — STATION_UNITS on ARCHETYPES                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE FENCE, AND IT IS THE ONE `COMPANION_UNITS` ALREADY USES ═══════════
 *
 * §11: "Species are archetype rows in a `STATION_UNITS` table assigned onto
 * `ARCHETYPES` the way `COMPANION_UNITS` is, so they get `MergedSkin` LODs
 * and the frame ledger for free."
 *
 * `score: 0, threat: 0, unlockAt: 99, resident: true` is the same four fields
 * a companion carries and for the same reason: **no wave may ever compose
 * one.** `CompanionKinds.js` argues it once — a companion archetype is "the
 * only archetype in the game that a wave may never spend" — and these rows
 * carry it for the identical reason and do not restate it. A Narn shopkeeper
 * appearing in wave nine on Geonosis would be the hub-of-worlds rule (§10)
 * broken by a table, which is exactly how it would break.
 *
 * THEY ARE UNARMED (§3.3: "off duty and unarmed"). No `ranged`, no `weapon`,
 * no `moves`. A resident that could shoot is a resident a director could
 * mistake for an enemy.
 */
const STATION_UNITS = {};
for (const S of SPECIES) {
  const [stature, , build] = S.sp;
  STATION_UNITS[`res_${S.key}`] = {
    label: S.name,
    /**
     * ONE BUILDER FOR FIFTEEN SPECIES, and it is `buildJedi` — the engine's
     * most parameterised humanoid, and the one `dressHumanoid` path §9.1
     * requires ("species heads and costumes are built on `dressHumanoid` with
     * the same palette and band discipline `characters.mjs` and
     * `character-shading.mjs` already hold every body to").
     *
     * `speciesOf` already accepts a ROW rather than an id, so a species can be
     * handed in from outside the creator's list without being added to it —
     * which is what keeps `creator.mjs`'s "a species pays for itself out of
     * the hair it does not have" true of the seven species a player can build
     * while fifteen more stand on the station.
     */
    build: (o = {}) => buildJedi({
      ...o,
      species: S.row,
      robe: S.robe,
      /* `body.py`'s `build` column is a limb and torso GIRTH multiplier;
       * `buildOf` reads 0..1 with 0.5 as the identity, so the girth maps onto
       * the signed frame parameter that already exists. */
      build: Math.max(0, Math.min(1, 0.5 + (build - 1) * 1.4)),
      hood: false,
    }),
    scale: 1.0,
    hp: 60,
    mass: Math.round(70 * build * (stature / HUMAN_STATURE) ** 2),
    speed: 3.0,
    toughness: TOUGHNESS.flesh,
    melee: false,
    damage: 0,
    /* THE SPACING BAND, and it is not a weapon range. `Enemy._think` reads
     * `A.preferred` unguarded to decide how close a body stands to what it is
     * looking at, so an archetype without one throws on its first frame. A
     * resident's is conversational distance: this is what stops fifteen people
     * in a market standing in each other. */
    preferred: [1.4, 2.8],
    hipHeight: 0.95 * (stature / HUMAN_STATURE),
    /* THE FENCE. See the note above. */
    resident: true, score: 0, threat: 0, unlockAt: 99,
  };
}

/**
 * ══ AND THE BORZ CAST LIVES HERE TOO (§3.3) ═══════════════════════════════
 *
 * "Every humanoid kind in Borz is a resident off duty and unarmed — clone
 * crew, the company, Jedi, Sith acolytes, reprogrammed and off-duty droids,
 * the companions in the kennel — with a room, a job or a haunt, and a
 * rhythm."
 *
 * They need no new bodies: their archetypes already exist. What they need is
 * a MANIFEST ROW saying where each one lives and what it does here, which is
 * the same two things a mode contributes (§10). "Where it makes sense" is the
 * only filter, and a row that declines says why — a droideka does not drink
 * in the cantina.
 */
export const BORZ_RESIDENTS = [
  /**
   * ══ OFF DUTY IS A COSTUME, NOT A NEW BODY ═══════════════════════════════
   *
   * V15: *"all the cute droids and stuff we have in our hangar mixed in with
   * the species … not in jedi clothes obviously, they would have to have
   * unique non-jedi clothing."*
   *
   * So a row says which BODY it uses and, if it is a humanoid, what it is
   * wearing when it is not working. A clone off duty is not in plastoid — he
   * is a man in fatigues, which is `buildJedi` on the human row with a
   * different palette and nothing else. That is the whole cost of the ask.
   *
   * Four rows keep their own builder, because for those four the BODY IS THE
   * IDENTITY: a Wookiee off duty is still a Wookiee, an astromech is a droid
   * whatever it is doing, and a Geonosian is not a man in different clothes.
   * `own: true` marks them.
   */
  { id: 'crew', label: 'Clone crew', species: 'human', home: 29, job: 'dockworker', haunt: 14,
    robe: { outer: 0x54604a, inner: 0x8a967c, trim: 0x2e352a },
    why: 'off duty and unarmed — fatigues, not plastoid' },
  { id: 'medic', label: 'Medic', species: 'human', home: 29, job: 'medical', haunt: 43,
    robe: { outer: 0xe0e4e6, inner: 0xf2f4f5, trim: 0xb03434 } },
  { id: 'pilot', label: 'Pilot', species: 'human', home: 30, job: 'traffic', haunt: 3,
    robe: { outer: 0xd06a2a, inner: 0xe8974e, trim: 0x3a2a1c },
    why: 'the ready room’s orange, which is a flight suit and reads as one' },
  { id: 'jedi', label: 'Jedi', species: 'human', home: 30, job: 'diplomat', haunt: 22,
    robe: { outer: 0x9d8567, inner: 0xd8c9a8, trim: 0x5d4b34 },
    why: 'robes ARE a Jedi’s civilian dress — this row is the one exception and says so' },
  { id: 'acolyte', label: 'Sith acolyte', species: 'human', home: 38, job: 'visitor', haunt: 14,
    robe: { outer: 0x1a1b20, inner: 0x2e3038, trim: 0x0c0d10 },
    why: 'drinking alone — §3.2 #14 names them' },
  { id: 'officer', label: 'Officer', species: 'human', home: 30, job: 'command', haunt: 41,
    robe: { outer: 0x2c3340, inner: 0x4e5768, trim: 0x8a7038 } },
  { id: 'guard', label: 'Station guard', species: 'human', home: 29, job: 'security', haunt: 24,
    robe: { outer: 0x33383f, inner: 0x585f68, trim: 0x1a1d21 } },
  { id: 'engineer', label: 'Engineer', species: 'human', home: 29, job: 'engineer', haunt: 48,
    robe: { outer: 0x6a5a2e, inner: 0x9c8848, trim: 0x39301a } },
  /* ── AND THE FOUR WHOSE BODY IS THE IDENTITY. */
  { id: 'wookiee', label: 'Wookiee', own: 'wook', home: 38, job: 'merchant', haunt: 10,
    why: 'the Forge’s smith — §3.2 #10 names them' },
  { id: 'astro', label: 'Astromech', own: 'astro', home: 51, job: 'engineer', haunt: 51 },
  { id: 'b1c', label: 'Reprogrammed B1', own: 'b1c', home: 51, job: 'service', haunt: 25 },
  { id: 'geo', label: 'Geonosian worker', own: 'tuk', home: 38, job: 'industrial', haunt: 50 },
  /* ── THE ONES THAT DECLINE, and each says why (§3.3: "`resident: false` with
   * a reason"). A body that cannot be off duty is not a resident. */
  { id: 'droideka', resident: false, why: 'a droideka does not drink in the cantina — it has no off-duty state at all' },
  { id: 'b2', resident: false, why: 'a battle droid with no reprogrammed row is a weapon, and §3.3’s filter is "unarmed"' },
  { id: 'walker', resident: false, why: 'it does not fit the doors, which is body.py’s own test for a resident' },
];

/**
 * The archetype a Borz row builds through. The eight humanoid rows get one
 * each — same body, different clothes — and the four `own` rows point at the
 * archetype they already have.
 */
export function borzArchetype(row) { return row.own || `res_borz_${row.id}`; }

/** Every Borz row that actually lives here, by the place it is found in. */
export const BORZ_BY_PLACE = new Map();
for (const r of BORZ_RESIDENTS) {
  if (r.resident === false) continue;
  for (const where of [r.home, r.haunt]) {
    if (!where) continue;
    if (!BORZ_BY_PLACE.has(where)) BORZ_BY_PLACE.set(where, []);
    const list = BORZ_BY_PLACE.get(where);
    if (!list.includes(r)) list.push(r);
  }
}

/**
 * ══ THE MODE CONTRACT (§10) ═══════════════════════════════════════════════
 *
 * "A new mode is one world plus one manifest entry. No station file learns a
 * mode's name." So this is a list of manifests, keyed by nothing the station
 * reads, and `residents()` is the only reader.
 *
 * `stationcast.mjs` greps every station file for a mode's name and fails on a
 * hit, which is the same check `CompanionKinds.js` earns by keeping twelve
 * kinds and switching on none of them.
 */
const MANIFESTS = new Map();

/** Contribute a mode's residents. Called once, at module load, by the mode. */
export function addResidents(id, rows) { MANIFESTS.set(id, rows); }

/** Every resident row every mode has contributed, plus the station's own. */
export function residents() {
  const out = [];
  for (const S of SPECIES) {
    out.push({
      builder: `res_${S.key}`, species: S.key, names: S.key,
      job: null, home: homeFor(S.key, null), rhythm: S.key,
    });
  }
  for (const r of BORZ_RESIDENTS) {
    if (r.resident === false) continue;
    out.push({
      builder: borzArchetype(r), species: r.species || 'borz', names: 'human',
      job: r.job, home: r.home, haunt: r.haunt, rhythm: 'human',
    });
  }
  for (const rows of MANIFESTS.values()) for (const r of rows) out.push(r);
  return out;
}

/**
 * ══ AND THE BORZ CAST'S OWN EIGHT ═════════════════════════════════════════
 *
 * One archetype per humanoid Borz row: the same `buildJedi` chassis on the
 * human species row, with that row's off-duty palette. Not a new body, not a
 * new builder, and fenced exactly as the fifteen species are — a clone in
 * fatigues must be no more composable by a wave than a Narn is.
 */
for (const R of BORZ_RESIDENTS) {
  if (R.resident === false || R.own) continue;
  const sp = SPECIES_BY.get(R.species || 'human');
  STATION_UNITS[`res_borz_${R.id}`] = {
    label: R.label,
    build: (o = {}) => buildJedi({ ...o, species: sp.row, robe: R.robe, hood: false }),
    scale: 1.0, hp: 60, mass: 72, speed: 3.0,
    toughness: TOUGHNESS.flesh, melee: false, damage: 0,
    preferred: [1.4, 2.8],
    hipHeight: 0.95,
    resident: true, score: 0, threat: 0, unlockAt: 99,
  };
}

/**
 * The rows go on `ARCHETYPES` at module scope, which is how
 * `CompanionKinds.js` does it and why this file has to be reachable from
 * `Enemy.js`'s import graph for `spawnEnemy` to find them. See that file's
 * note on the temporal dead zone — the assignment is last in the module for
 * exactly that reason.
 */
Object.assign(ARCHETYPES, STATION_UNITS);

export { STATION_UNITS };
