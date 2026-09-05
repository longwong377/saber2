/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE REPEATING ROOM — V16 Lane A2, and it is not a tab with a door on it
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player's ask, in full:
 *
 * > *"a holodeck/dojo that replaces the training and sandbox menus — you walk
 * > into a room and program it rather than picking a tab."*
 *
 * Read the verb: **replaces**. A room that also does training, with the tab
 * still sitting second in the bar, is the thing being asked against — you
 * would walk past the room forever, because the tab is two clicks from the
 * title screen and the room is a lift and a walk. So the tab and the panel are
 * gone from `Menu.js` and both modes are `hidden` in `MODES`, which is the
 * flag that already means *"reached by a door rather than by picking them"*
 * (`playableModes`). `#57` is that door and there is no other.
 *
 * ── WHAT WAS ACTUALLY ON THE TAB, ENUMERATED RATHER THAN REMEMBERED ───────
 *
 * `Menu._buildTraining` built three columns, and this file has to carry every
 * one of them or the replacement is a deletion:
 *
 *   THE ROOM      `sandboxCount` (0…40) and `sandboxFire` (0…2)
 *   OPPONENT      `sandboxType` — what the remainder is — and `sandboxMix`,
 *                 the counts you asked for by name
 *   BLADE         `unlimitedBlade`, `unlimitedFocus`, `bladeLength`
 *   THE LADDER    a button that started `LESSONS` at rung 0, and a second
 *                 button that entered the same room with no coach in it
 *   THE GROUND    not on the tab at all — the theatre came off **Deploy**,
 *                 two tabs away, which is why the lessons' own copy had to
 *                 say "in whatever theatre you have picked under Deploy"
 *
 * Seven dials, a ladder and a ground, spread over three screens. That is the
 * actual defect the player is describing, and it is not fixed by moving the
 * three screens into a room.
 *
 * ── SO A PROGRAM IS THE UNIT, AND IT IS ONE ADDRESSABLE VALUE ─────────────
 *
 * A PROGRAM names a ground, an opponent set and every one of the seven dials
 * at once. `programSettings` turns one into the settings blob `deploy()`
 * already takes, so the room launches THE SAME WORLDS THROUGH THE SAME DOOR —
 * `mode: 'training'` builds the `DojoDirector` it always did, `mode: 'sandbox'`
 * builds the `WaveDirector` on its `_sandboxUpdate` path. Nothing about what a
 * lesson is has changed; what changed is that choosing one is a thing you do
 * standing in a room, with the whole choice visible at once.
 *
 * That is also the whole argument for the value being ONE object rather than
 * seven writes. `sandboxConfig` already reads the four room dials as a unit and
 * says so in its own note; a program is that unit extended over the ground and
 * the leash, so "what is this room" has a single answer that can be printed,
 * compared, and handed to two readers with the guarantee they get the same
 * room. `tools/checks/holodeck.mjs` measures that guarantee rather than
 * asserting it.
 *
 * ── AND THE GROUND IS THE WHOLE ROSTER, NOT A SHORTLIST ──────────────────
 *
 * The ask says the room replaces the SANDBOX menu as well, and the sandbox
 * menu's own ground column offered `Levels.theatresFor('sandbox')` — every
 * theatre the mode can load. The ladder and the hand-written rooms name five
 * of the seven between them, so a rack of curated programs alone is a
 * REDUCTION of the tab it replaces: the White Pass and Mustafar were on the
 * tab and were reachable nowhere in the room.
 *
 * So `programs()` takes the roster as its second argument and appends one
 * program per ground, `dials: null` — the ground you asked for, with the
 * numbers the console is set to. The six curated rooms stay, first, as what
 * they always were: a featured ordering on top of the roster, each a complete
 * answer for one lesson's exam. `open:own` is gone from that list because the
 * roster IS it — a second copy of "the Ember Shelf with your own numbers" is
 * the twin this file's header refuses everywhere else.
 *
 * The roster is HANDED IN for the same reason `LESSONS` is: the display name
 * of a theatre lives in `Levels.js`, `Levels.js` imports THREE, and a second
 * copy of seven level names in here would be wrong the day one is renamed.
 *
 * ── AND NOTHING IN HERE FILES A RUN ───────────────────────────────────────
 *
 * `Progress.js`'s `RECORDED` set leaves training and the sandbox out, with the
 * reason stated: *"nothing in the lessons can kill you, and the sandbox is a
 * room with a slider."* Both halves stay true when the slider is in a room:
 * `programSettings` may only ever write `'training'` or `'sandbox'` into
 * `mode`, so `recordRun` returns on its second line whatever the program did.
 * The check asserts it against the real `saber.progress.v1`.
 *
 * ── PURE, FOR WARP'S REASON ───────────────────────────────────────────────
 *
 * No THREE, no world, no DOM, no store, and — this is the one that decides the
 * shape below — **no import of `Dojo.js`**. `LESSONS` is the authority on what
 * training teaches and this file must not hold a second copy of it (the
 * hand-written twin beside its generated original is this codebase's signature
 * defect, and `Waves.js`'s `SANDBOX_ORDER` note counts seven times it has been
 * paid for). But `Dojo.js` imports THREE, `Props.js` and `Audio.js`, so
 * importing it would make the room's own rules unloadable without a canvas.
 *
 * So the ladder is HANDED IN, exactly as `Warp`'s `sink` is: `programs(LESSONS)`
 * generates one program per rung from the rung itself. There is no list of
 * lesson names in this file; a lesson added to `Dojo.js` is a program in the
 * rack on the same commit, and the check holds the two to each other.
 */

/**
 * ══ THE SEVEN DIALS ═══════════════════════════════════════════════════════
 *
 * Every setting the training/sandbox tab exposed, and nothing else. The value
 * is what the control WAS, so the check can hold this list to the panel that
 * used to carry it rather than to a memory of it.
 *
 * `bladeLength` is on this list and is NOT only a practice control — the forge
 * (`#opt-bladelen`, Saber tab) writes the same number and keeps its slider.
 * The other six bite in these two modes and nowhere else, which is exactly why
 * they had no business on a menu tab and every business on a program.
 */
export const DIALS = {
  sandboxCount:   'how many bodies are alive at once — 0 is an empty floor',
  sandboxFire:    'how fast they pull a trigger, 0…2× — 0 is a room that never fires',
  sandboxType:    'what the REMAINDER is drawn from; "mixed" is the theatre\'s own draw',
  sandboxMix:     'the counts you asked for BY NAME, `{ droideka: 2 }` — honoured first',
  bladeLength:    'the blade, in metres',
  unlimitedBlade: 'the leash off: the blade reaches BLADE_MAX instead of BLADE_CAP',
  unlimitedFocus: 'Focus costs nothing, so a volley can be sat inside and read',
};

/** The dial keys, in the order the panel carried them. */
export const DIAL_KEYS = Object.keys(DIALS);

/**
 * ══ THE GROUND A LESSON IS TAUGHT ON ══════════════════════════════════════
 *
 * The tab could not name one — it inherited whatever was picked under Deploy,
 * and its own copy admitted as much. A program names its ground, and these are
 * chosen for ONE property: whether the thing being taught is visible.
 *
 *   `drifts`     flat, pale, empty to the horizon. A bolt in flight reads
 *                against it; against clutter it is lost, and the four bolt
 *                lessons are all about watching where a bolt is GOING.
 *   `colosseum`  sand, a wall all round, nothing else in frame. The blade
 *                lessons — there is nothing to look at but the other blade.
 *   `wood`       close, dark, low. `cut` is about where on the blade contact
 *                happens, and the tip is the only lit thing in there.
 *   `scoria`     the sandbox rung's own ground: broken, mid-sized, the ordinary
 *                fight this room hands over to.
 *
 * Keyed by LESSON ID rather than by index, because an index is a promise about
 * the order of somebody else's array. A rung with no entry falls to `FALLBACK`
 * and the check names it, so a lesson added to `Dojo.js` gets a deliberate
 * ground on the commit that adds it instead of a silent default forever.
 */
export const LESSON_GROUND = {
  feel: 'colosseum',
  block: 'drifts',
  deflect: 'drifts',
  return: 'drifts',
  perfect: 'drifts',
  cut: 'wood',
  parry: 'colosseum',
  chamber: 'colosseum',
  lock: 'colosseum',
  sandbox: 'scoria',
};
const FALLBACK_GROUND = 'colosseum';

/**
 * What the lessons leave you holding. A lesson's own `setup` pins the room —
 * how many remotes, how fast they fire, whether there is a partner — so a
 * lesson program must NOT carry the four room dials: writing them would
 * overwrite the room a player built for themselves in exchange for nothing,
 * because `_applyLesson` clears the floor and rebuilds it from `setup` on the
 * next line anyway. The three it does carry are the three `setup` says nothing
 * about, and they are stock: a lesson is the same lesson for everybody.
 */
const LESSON_DIALS = { bladeLength: 1.15, unlimitedBlade: false, unlimitedFocus: false };

/**
 * ══ THE OPEN PROGRAMS — the sandbox half ══════════════════════════════════
 *
 * The tab's second button said "Enter the sandbox" and what you got was the
 * theatre from Deploy plus whatever the three columns were last left on. That
 * is one room, and it was the only one: every session started from the state
 * the last session ended in, which is why the opponent picker needed twelve
 * rows of prose explaining what the remainder was.
 *
 * These are ROOMS, named, each a complete answer. Every one carries all seven
 * dials — that is what makes a program addressable, and what lets the check
 * assert that no dial was lost with the tab.
 *
 * These five are FEATURED and nothing more: the roster below them offers every
 * ground with the console's own numbers, so nothing here is the only way to
 * reach anything. That is what makes gating them honest.
 *
 * `needs` is a lesson id that must have been CLEARED. It is not a paywall and
 * it is not difficulty gating: each of these four IS the exam for one lesson,
 * and offering the exam to somebody who has not been taught the verb is how a
 * practice room teaches a player that practice does not work. `empty` needs
 * nothing and no room on the roster below needs anything, so nothing a player
 * could reach on the tab has moved behind a gate.
 */
const OPEN = [
  {
    id: 'open:empty', name: 'An empty floor', ground: 'colosseum', needs: null,
    blurb: 'Nobody. Room to move in and a wall to run at — the setting the sandbox always had at zero.',
    dials: { sandboxCount: 0, sandboxFire: 0, sandboxType: 'mixed', sandboxMix: {},
      bladeLength: 1.15, unlimitedBlade: false, unlimitedFocus: false },
  },
  {
    id: 'open:volley', name: 'The volley', ground: 'drifts', needs: 'deflect',
    blurb: 'Eight guns and nothing to hide behind, on the flattest ground there is. Focus is free in here, so a volley can be sat inside until it reads.',
    dials: { sandboxCount: 8, sandboxFire: 1.4, sandboxType: 'mixed',
      sandboxMix: { b1: 6, sniper: 2 },
      bladeLength: 1.15, unlimitedBlade: false, unlimitedFocus: true },
  },
  {
    id: 'open:circle', name: 'The circle', ground: 'colosseum', needs: 'parry',
    blurb: 'Three duellists, no guns at all. Every attack is declared and every one of them can be answered.',
    dials: { sandboxCount: 3, sandboxFire: 0, sandboxType: 'sparring',
      sandboxMix: { sparring: 3 },
      bladeLength: 1.15, unlimitedBlade: false, unlimitedFocus: false },
  },
  {
    /* The one program that takes the leash off, and it is the `cut` exam: a
     * four-metre blade is a different weapon and the only honest way to learn
     * where its tip is, is against twelve things that stand still. */
    id: 'open:pike', name: 'The long blade', ground: 'wood', needs: 'cut',
    blurb: 'Twelve dummies and no leash. At four metres the capture window along the blade is ±212 cm instead of ±70 — a different weapon, and this is where you find out how different.',
    dials: { sandboxCount: 12, sandboxFire: 0, sandboxType: 'dummy',
      sandboxMix: { dummy: 12 },
      bladeLength: 4.0, unlimitedBlade: true, unlimitedFocus: false },
  },
  {
    id: 'open:press', name: 'The press', ground: 'geonosis', needs: 'lock',
    blurb: 'Sixteen bodies that walk onto you, in the open. Nothing here can kill you, which is the only reason it is worth standing in.',
    dials: { sandboxCount: 16, sandboxFire: 1, sandboxType: 'mixed',
      sandboxMix: { b2: 8, droideka: 2, trooper: 6 },
      bladeLength: 1.15, unlimitedBlade: false, unlimitedFocus: false },
  },
];

/**
 * ══ THE RACK ══════════════════════════════════════════════════════════════
 *
 * Every program the room can run: one per rung of the ladder, then the open
 * ones. `lessons` is `Dojo.LESSONS`, handed in — see the header.
 *
 * A LESSON PROGRAM'S `needs` IS THE RUNG BEFORE IT, derived from the array's
 * own order rather than authored, so the ladder is the ladder and cannot
 * disagree with itself. Rung 0 needs nothing.
 *
 * `mode` is the one field that decides which director builds: the ladder is
 * `'training'` (a `DojoDirector`, which is the only thing that knows what a
 * lesson is) and the open rooms are `'sandbox'`. Both are outside `RECORDED`,
 * which is the property the whole file is held to.
 */
export function programs(lessons, grounds = []) {
  const L = Array.isArray(lessons) ? lessons : [];
  const rack = L.map((l, i) => ({
    id: `lesson:${l.id}`,
    name: l.title,
    kind: 'lesson',
    /** Which rung `DojoDirector.start` opens on. See its note. */
    lesson: l.id,
    mode: 'training',
    ground: LESSON_GROUND[l.id] || FALLBACK_GROUND,
    /* Not the lesson's `brief` — that is written to the player standing in the
     * room with the blade already lit, and a rack is read before you commit.
     * `hint` is the same voice one step back. Both are functions on some rungs
     * (they branch on the control scheme), and a rack cannot resolve that, so
     * a function falls to the title. */
    blurb: typeof l.hint === 'string' ? l.hint : l.title,
    needs: i > 0 ? L[i - 1].id : null,
    dials: { ...LESSON_DIALS },
  }));
  for (const o of OPEN) {
    rack.push({
      id: o.id, name: o.name, kind: 'open', lesson: null, mode: 'sandbox',
      ground: o.ground, blurb: o.blurb, needs: o.needs,
      dials: o.dials ? { ...o.dials } : null,
    });
  }
  /**
   * ══ THE ROSTER ═════════════════════════════════════════════════════════
   *
   * One room per ground, and the ground is the only thing the program names —
   * `dials: null`, so the numbers are the ones on the console. This is the
   * sandbox tab's ground column and its dials, in the room, and it is why the
   * six above can be a shortlist without being a limit.
   *
   * `grounds` is `[{ key, name, blurb }]`, taken off `Levels.js` by the caller
   * (see the header). A bare string is accepted and named by its key, because
   * a check or a probe that only has the keys should not have to invent a
   * display name to use this.
   *
   * NOTHING IS GATED HERE. `needs: null` on every one: the tab let you enter
   * the sandbox on any theatre on a fresh profile, and a replacement that put
   * six of the seven behind a lesson would be a smaller game.
   */
  const seen = new Set();
  for (const g of (Array.isArray(grounds) ? grounds : [])) {
    const key = (typeof g === 'string') ? g : g?.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rack.push({
      id: `ground:${key}`,
      name: ((typeof g === 'string') ? null : g.name) || key,
      kind: 'ground',
      lesson: null,
      mode: 'sandbox',
      ground: key,
      blurb: ((typeof g === 'string') ? null : g.blurb)
        || 'The ground on its own, with the numbers you set on the console.',
      needs: null,
      dials: null,
    });
  }
  return rack;
}

/** One program by id, or null. */
export function programById(lessons, grounds, id) {
  return programs(lessons, grounds).find((p) => p.id === id) || null;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  WHAT YOU HOLD                                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE HOLD IS A LIST OF LESSONS CLEARED, AND IT IS NOT IN `saber.progress` ═
 *
 * One field, because two would be able to disagree. Everything the rack gates
 * on is derivable from it: rung N is held when rung N−1 has been cleared, and
 * an open program is held when the lesson it examines has been.
 *
 * IT IS DELIBERATELY NOT A RUN RECORD. `Progress.js` keeps how deep you have
 * been and what you did it with, and its header is explicit that a mode that
 * cannot be lost is not a run. A lesson cleared is not a run and must not be
 * filed as one; this is a bookmark in a syllabus, the caller owns it, and this
 * file only ever reads and returns new copies of it.
 *
 * AND IT GATES THE DOOR, NOT THE LADDER. Inside a lesson the coach's own Skip
 * still walks the syllabus one rung at a time exactly as it always has
 * (`DojoDirector.skip`). What the rack decides is where you may START, which
 * is a thing the tab never decided at all — it always started at rung 0 — so
 * nothing a player could reach before has moved out of reach.
 */
export function blankHold() { return { cleared: [] }; }

/** A lesson finished. Returns a NEW hold; idempotent. */
export function clearLesson(hold, lessonId) {
  const had = (hold && Array.isArray(hold.cleared)) ? hold.cleared : [];
  if (!lessonId || had.includes(lessonId)) return { cleared: [...had] };
  return { cleared: [...had, lessonId] };
}

/** Is this program's key turned? A program with no `needs` is always held. */
export function isHeld(program, hold) {
  if (!program) return false;
  if (!program.needs) return true;
  const had = (hold && Array.isArray(hold.cleared)) ? hold.cleared : [];
  return had.includes(program.needs);
}

/**
 * The rack as the player sees it: everything, with `held` on each row.
 *
 * Everything, and not only what is held — a rack that hides what you have not
 * earned tells you nothing about where you are going, and the room's whole
 * subject is a syllabus. The console refuses to RUN an unheld row; it prints
 * every one of them.
 */
export function rack(lessons, grounds, hold) {
  return programs(lessons, grounds).map((p) => ({ ...p, held: isHeld(p, hold) }));
}

/** Only what can actually be run. This is the list the door is allowed to use. */
export function heldPrograms(lessons, grounds, hold) {
  return programs(lessons, grounds).filter((p) => isHeld(p, hold));
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE ONE ADDRESSABLE VALUE                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * A program → the settings blob `deploy()` takes.
 *
 * `base` is the player's own settings and IS NOT MUTATED — the room hands the
 * result to `Object.assign(settings, …)` on the main.js side, so the one write
 * is visible in one place instead of being scattered over seven assignments in
 * here. That also makes this function total and comparable, which is what the
 * check's "two readers of the same program get the same room" rests on: it
 * calls this twice with the same arguments and deep-compares the results.
 *
 * THE REFUSAL IS ENFORCED HERE AND NOT DOCUMENTED HERE. `mode` is taken off
 * the program, and `programs()` is the only thing that writes it, to one of two
 * literals. Neither is in `Progress.RECORDED`, so no run is filed however the
 * room is reached — which is the promise `Progress.js` makes about the lessons
 * and the sandbox, made by a room instead of by a tab.
 */
export function programSettings(program, base = {}) {
  if (!program) return { ...base };
  const s = { ...base };
  s.mode = program.mode;
  s.level = program.ground;
  /* The rung the ladder opens on. Null on an open program, and null is what
   * `DojoDirector.start` reads as "rung 0" — so the field is always written
   * rather than sometimes left behind from the last program. */
  s.lesson = program.lesson || null;
  const d = program.dials;
  if (d) {
    for (const k of DIAL_KEYS) {
      if (!(k in d)) continue;
      /* `sandboxMix` is the one dial that is an object, and handing the
       * program's own copy to a settings blob makes the rack mutable from
       * whatever the menu does to `settings.sandboxMix` next. One level is
       * enough: its values are counts. */
      s[k] = (k === 'sandboxMix') ? { ...d[k] } : d[k];
    }
  }
  return s;
}

/**
 * The seven dials as they stand on a settings blob — the value a `dials: null`
 * program is going to run with. Not a new fact: `DIAL_KEYS` is the list and
 * this only reads it, so a dial added there is read here on the same commit.
 */
function dialsOf(base) {
  const d = {};
  for (const k of DIAL_KEYS) d[k] = base[k];
  return d;
}

/**
 * What the console reads back before you commit, as lines.
 *
 * `groundName` is handed in because this file may not import `Levels.js` —
 * the display name of a theatre lives there, and a second copy of nine of them
 * in here would be wrong the day one is renamed. Same argument, same shape, as
 * `Warp`'s sink.
 */
export function rackLines(program, groundName, base = null) {
  if (!program) return ['NO PROGRAM'];
  const out = [program.name.toUpperCase(), groundName || program.ground];
  /* A PROGRAM WITH NO DIALS READS BACK THE CONSOLE'S OWN NUMBERS when it is
   * given them. `dials: null` means "whatever the blob says", and a rack row
   * that answered "your own numbers" while the console sat on 12 droidekas
   * would be the one row on the screen that does not say what you are about
   * to walk into. Handed nothing, it still says what it can. */
  const d = program.dials || (base ? dialsOf(base) : null);
  if (!d) { out.push('your own numbers'); return out; }
  const named = Object.entries(d.sandboxMix || {}).filter(([, n]) => n > 0);
  if (program.kind === 'lesson') out.push('a lesson — nothing in here can kill you');
  else if (!d.sandboxCount) out.push('nobody');
  else if (named.length) out.push(named.map(([k, n]) => `${n} ${k}`).join(', '));
  else out.push(`${d.sandboxCount} × ${d.sandboxType}`);
  const leash = [];
  if (d.unlimitedBlade) leash.push(`blade ${d.bladeLength.toFixed(2)} m, no leash`);
  if (d.unlimitedFocus) leash.push('focus free');
  if (d.sandboxFire === 0 && d.sandboxCount) leash.push('trigger held');
  if (leash.length) out.push(leash.join(' · '));
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  WHAT THE ROOM DOES WHILE A PROGRAM IS RUNNING                             */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * ══ THE CYCLE — three phases, and the room is never a loading screen ══════
 *
 * `Warp.js`'s shape, for `Warp.js`'s reason: a sequence reads as a procedure
 * and a procedure reads as a machine being operated, where one effect reads as
 * a wipe. It is shorter than the jump on purpose — a jump happens once a
 * session and this happens every time you change your mind about a room, so
 * 3.4 s against the jump's 9.0 s.
 *
 *   SET     the lattice lights, one rank of emitters at a time. The console
 *           has read the program back and you have committed to it.
 *   PAINT   the ground arrives on the six faces: the walls stop being walls.
 *   HOLD    the lattice goes out and the ground is all there is. `live` fires
 *           at the end of this phase and the world loads behind it.
 *
 * Nothing here is the load. `live(settings)` is the last thing it does and the
 * caller owns what happens next, exactly as `Warp`'s `arrived` does — which is
 * what keeps this file testable with no world in it at all.
 */
export const PHASES = [
  { id: 'set', t: 1.1, say: 'Program set.' },
  { id: 'paint', t: 1.5, say: null },
  { id: 'hold', t: 0.8, say: 'Room is live.' },
];

/** Total, in seconds. */
export const CYCLE_SECONDS = PHASES.reduce((a, p) => a + p.t, 0);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * One program starting, in progress.
 *
 * `sink` is everything this drives, handed in rather than imported:
 *
 *   lattice(k)         0 dark, 1 every emitter lit. The room's own light.
 *   paint(ground, k)   0 the room's six faces, 1 the ground. `ground` is the
 *                      program's level key, so a caller can pick a sky.
 *   say(line)          the room's voice — the banner, in the game.
 *   live(settings)     the last call, once: the blob to deploy with.
 */
export class Cycle {
  constructor(program, settings, sink = {}) {
    this.program = program;
    this.settings = settings;
    this.sink = sink;
    this.i = 0;
    this.t = 0;
    this.done = false;
    this._said = -1;
    this._lived = false;
  }

  /** Which phase, by id. `'done'` once the world has been asked for. */
  get phase() { return this.done ? 'done' : PHASES[this.i].id; }

  /** How far through, 0..1 — for a bar, if anything ever wants one. */
  get progress() {
    if (this.done) return 1;
    let before = 0;
    for (let k = 0; k < this.i; k++) before += PHASES[k].t;
    return clamp01((before + this.t) / CYCLE_SECONDS);
  }

  /**
   * One frame. Returns the phase id, so a caller can act on a transition
   * without keeping a second copy of the schedule.
   *
   * The whole sequence is driven off `dt` and nothing else — no clock is read
   * in here, which is what lets a check step it at 1/60 and get the same three
   * phases every time.
   */
  step(dt) {
    if (this.done) return 'done';
    const P = PHASES[this.i];
    if (this._said !== this.i) {
      this._said = this.i;
      if (P.say) this.sink.say?.(P.say);
    }
    this.t += dt;
    const k = clamp01(this.t / P.t);
    const s = smooth(k);
    /* The lattice comes up through SET, holds through PAINT, and goes out
     * through HOLD — so the brightest the room ever is, is the moment before
     * the ground arrives, and the last thing you see is the ground alone. */
    if (P.id === 'set') { this.sink.lattice?.(s); this.sink.paint?.(this.program?.ground, 0); }
    else if (P.id === 'paint') { this.sink.lattice?.(1); this.sink.paint?.(this.program?.ground, s); }
    else { this.sink.lattice?.(1 - s); this.sink.paint?.(this.program?.ground, 1); }

    if (this.t >= P.t) {
      this.t -= P.t;
      this.i++;
      if (this.i >= PHASES.length) {
        this.done = true;
        this.i = PHASES.length - 1;
        if (!this._lived) { this._lived = true; this.sink.live?.(this.settings); }
        return 'done';
      }
    }
    return PHASES[this.i].id;
  }

  /**
   * Walked away from the console. The room goes back to being a room and
   * `live` is never called — which is the difference between a sequence and a
   * loading screen, and the reason there is no way to cancel a jump.
   */
  abort() {
    if (this.done) return false;
    this.done = true;
    this._lived = true;               // whatever else happens, do not deploy
    this.sink.lattice?.(0);
    this.sink.paint?.(this.program?.ground, 0);
    return true;
  }
}
