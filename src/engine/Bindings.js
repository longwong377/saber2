/**
 * SABER — key bindings.
 *
 * Gameplay asks for ACTIONS, never for key codes. That indirection is what lets
 * every control be rebound without a single `if (input.hit('KeyF'))` surviving
 * anywhere in the game code, and it is also what lets a binding carry more than
 * one key — so Force pull can be both Shift+F and its own dedicated key without
 * either of them being special-cased.
 *
 * A binding is a list of chords. A chord is one main key plus optional
 * modifiers. The most specific chord wins: with Push on F and Pull on Shift+F,
 * holding shift must fire Pull and NOT Push, so a chord with modifiers is
 * matched before a chord without.
 */

const STORE_KEY = 'saber.bindings.v1';

/** Mouse buttons live in the same namespace as keys. */
export const MOUSE = { 0: 'Mouse1', 1: 'Mouse3', 2: 'Mouse2', 3: 'Mouse4', 4: 'Mouse5' };

/**
 * …and so does the WHEEL, which until now lived outside the table entirely.
 *
 * It was read raw in two places — `rollInput += input.mouse.wheel * 0.55` in
 * SaberController and `this._wheel = input.mouse.wheel` in Player — with the
 * second having to STEAL the device from the first, frame by frame, to get a
 * notch of its own. That is the same disease as KeyB/KeyN and the arrow keys,
 * in the one input the project had never put in a table: not rebindable, not
 * listed, and invisible to findConflicts, so the collision could only be fixed
 * by one reader knowing about the other.
 *
 * A notch is an edge, not a state, so both `act` and `actHit` answer the same
 * question — `mouse.wheel` is accumulated over the frame and cleared by
 * Input.end(), which makes it a one-frame press by construction.
 */
export const WHEEL = { up: 'WheelUp', down: 'WheelDown' };
export const WHEEL_CODES = [WHEEL.up, WHEEL.down];

/**
 * Every rebindable action, in the order the options screen lists them.
 * `hold` marks an action read continuously rather than on the press edge.
 */
export const ACTIONS = [
  { id: 'moveF',      group: 'Movement', label: 'Move forward',      keys: ['KeyW'],       hold: true },
  { id: 'moveB',      group: 'Movement', label: 'Move back',         keys: ['KeyS'],       hold: true },
  { id: 'moveL',      group: 'Movement', label: 'Move left',         keys: ['KeyA'],       hold: true },
  { id: 'moveR',      group: 'Movement', label: 'Move right',        keys: ['KeyD'],       hold: true },
  { id: 'jump',       group: 'Movement', label: 'Force jump',        keys: ['Space'],      hold: true },
  { id: 'sprint',     group: 'Movement', label: 'Sprint',            keys: ['ShiftLeft'],  hold: true },
  { id: 'crouch',     group: 'Movement', label: 'Crouch',            keys: ['ControlLeft'], hold: true },
  { id: 'dash',       group: 'Movement', label: 'Dash / evade',      keys: ['AltLeft', 'Mouse4'] },

  { id: 'blade',      group: 'Blade',    label: 'Take the blade',    keys: ['Mouse1'],     hold: true },
  { id: 'thrust',     group: 'Blade',    label: 'Thrust',            keys: ['Mouse2'] },
  // The two halves of the attack rose, mirroring the guard rose: wheel up is an
  // overhead, wheel down is a stab. They are ordinary rows here rather than a
  // raw `mouse.wheel` read for exactly the reason the four rows below this one
  // exist — a control that is not in this table cannot be rebound, cannot be
  // listed, and cannot be seen to collide with the Force grip, which is the
  // other thing that wants the wheel.
  { id: 'attackOver', group: 'Blade',    label: 'Overhead attack',   keys: ['WheelUp'] },
  { id: 'attackStab', group: 'Blade',    label: 'Stab',              keys: ['WheelDown'] },
  { id: 'rollL',      group: 'Blade',    label: 'Roll wrist left',   keys: ['KeyQ'],       hold: true },
  { id: 'rollR',      group: 'Blade',    label: 'Roll wrist right',  keys: ['KeyE'],       hold: true },
  { id: 'ignite',     group: 'Blade',    label: 'Ignite / retract',  keys: ['KeyX'] },
  { id: 'grip2',      group: 'Blade',    label: 'One-handed grip',   keys: ['CapsLock'],   hold: true },
  // Digit1/Digit2, not KeyB/KeyN. These two were seeded onto B and N at runtime
  // by SaberController, which meant they were not in this table, so they never
  // reached the options screen, could not be rebound, and could not be seen to
  // COLLIDE: B already fired the stasis field and stepped the dojo lesson back,
  // N already fired rend and skipped the lesson. One press, three systems.
  // Every letter in the left-hand cluster is spoken for, and a guard stance is
  // a HOLD you keep while strafing, so it has to stay under the left hand: the
  // digit row is the only thing left there that nothing else claims. Mouse5 is
  // the thumb button and is the nicer way to hold it if you have one.
  { id: 'stance',     group: 'Blade',    label: 'Lateral guard',     keys: ['Digit1', 'Mouse5'], hold: true },
  { id: 'flourish',   group: 'Blade',    label: 'Flourish',          keys: ['Digit2'] },

  { id: 'focus',      group: 'Force',    label: 'Focus (slow time)', keys: ['Mouse3', 'KeyT'], hold: true },
  { id: 'push',       group: 'Force',    label: 'Force push',        keys: ['KeyF'] },
  { id: 'pull',       group: 'Force',    label: 'Force pull',        keys: ['KeyR'] },
  { id: 'grip',       group: 'Force',    label: 'Force grip object', keys: ['KeyG'],       hold: true },
  // KeyY, not Mouse2. Mouse2 is `thrust`, and it was ALSO the shipped default
  // here — a clash inside the defaults themselves, so a fresh profile had one
  // button firing two things and no rebind could separate them until you found
  // and moved one by hand. The options screen never said so either, because
  // findConflict only ever looked at the key you were TYPING, never at what was
  // already in the table. Y is free, and it sits with the other Force verbs
  // that live off the movement cluster (T focus, H throw).
  { id: 'hurl',       group: 'Force',    label: 'Hurl gripped',      keys: ['KeyY'] },
  { id: 'throw',      group: 'Force',    label: 'Throw / recall saber', keys: ['KeyH'] },
  { id: 'sense',      group: 'Force',    label: 'Force sense',       keys: ['KeyC'] },
  { id: 'lightning',  group: 'Force',    label: 'Force lightning',   keys: ['KeyZ'] },
  // Stasis and rend were read straight off KeyB and KeyN inside Player, past
  // this table, so they had the same disease: no menu row, no rebind, and no
  // way for findConflict to warn that something else wanted the key. Their
  // default keys are unchanged — what changes is that they are now sayable.
  { id: 'stasis',     group: 'Force',    label: 'Stasis field',      keys: ['KeyB'] },
  { id: 'heal',       group: 'Force',    label: 'Force heal',        keys: ['Digit3'] },
  { id: 'rend',       group: 'Force',    label: 'Rend apart',        keys: ['KeyN'] },
  // Digit4 rather than a letter: it sits beside `heal` on Digit3, and the two
  // powers that act on a MIND — yours and someone else's — should be neighbours
  // under the same hand. Every letter within reach of WASD is already spoken
  // for, and findConflict is what proves it rather than anyone's memory.
  { id: 'compel',     group: 'Force',    label: 'Force compel',      keys: ['Digit4'] },
  // One key for both halves of note 61: over a fallen hilt it takes, otherwise
  // it puts yours down.
  //
  // KeyM, and the first three letters I reached for were all taken — G is grip,
  // R is ignite, F is push. That is the binding table doing its job: the shipped
  // set already puts something under every letter within reach of WASD, and the
  // four checks that failed when this said `KeyG` are why nobody has to
  // remember which. M is free, it is under the same hand, and picking a weapon
  // up off the ground is a deliberate act rather than a combat reflex, so it
  // does not need to be the nearest key left.
  { id: 'swap',       group: 'Blade',    label: 'Drop / take a saber', keys: ['KeyM'] },

  { id: 'scoreboard', group: 'Interface', label: 'Scoreboard',       keys: ['Tab'],        hold: true },
  { id: 'view',       group: 'Interface', label: 'First / third person', keys: ['KeyV'] },

  // The dojo's lesson navigation. Last round moved stasis and rend into this
  // table so that B and N could be SEEN to collide — and then left main.js's
  // raw `e.code === 'KeyB' → director.back()` alive next to them, so in the
  // level the menu tags "start here" one press still did two things: B threw a
  // stasis field AND stepped the lesson back, N tore an enemy apart AND skipped
  // it. findConflict could not warn, because a raw keydown listener is not in
  // the table; and no rebind could separate them, because a raw keydown
  // listener does not read the table either.
  //
  // Brackets and backslash because lesson navigation is the one thing in the
  // game you do while NOT fighting: nothing wants those keys mid-swing, they
  // are nowhere near the movement cluster, and they read as "step through" on
  // any keyboard. The coach panel prints whatever they are actually bound to.
  { id: 'lessonNext',   group: 'Training', label: 'Next lesson',     keys: ['BracketRight'] },
  { id: 'lessonBack',   group: 'Training', label: 'Previous lesson', keys: ['BracketLeft'] },
  { id: 'lessonRepeat', group: 'Training', label: 'Restart lesson',  keys: ['Backslash'] },
];

export const ACTION_IDS = ACTIONS.map(a => a.id);

export function defaultBindings() {
  const out = {};
  for (const a of ACTIONS) out[a.id] = a.keys.slice();
  return out;
}

export function loadBindings() {
  const base = defaultBindings();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    // Only accept known actions, and only non-empty key lists — a corrupt or
    // half-written blob must never be able to leave the player unable to move.
    for (const id of ACTION_IDS) {
      if (Array.isArray(saved[id]) && saved[id].length && saved[id].every(k => typeof k === 'string')) {
        base[id] = saved[id].slice(0, 3);
      }
    }
  } catch { /* defaults */ }
  return base;
}

export function saveBindings(b) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(b)); } catch {}
}

/** Human-readable name for a key code, for the options screen. */
export function keyLabel(code) {
  if (!code) return '—';
  if (code === 'WheelUp') return 'Wheel ↑';
  if (code === 'WheelDown') return 'Wheel ↓';
  if (code.startsWith('Mouse')) return code.replace('Mouse', 'M');
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return ({
    Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt',
    CapsLock: 'Caps', Tab: 'Tab', Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: '\'',
    Comma: ',', Period: '.', Slash: '/',
  })[code] || code;
}

/**
 * EVERY action a given key is already bound to.
 *
 * Plural on purpose. The single-answer version could only ever describe a table
 * with at most one clash in it, and the shipped defaults had two actions on
 * Mouse2 — so it reported one of them, the caller took the key off that one,
 * and the binding it then wrote was still a duplicate. A resolver that settles
 * the first clash is a resolver that cannot settle a table that already has
 * one, which is the only kind of table that needs settling.
 */
export function findConflicts(bindings, code, exceptId) {
  const out = [];
  for (const id of ACTION_IDS) {
    if (id === exceptId) continue;
    if ((bindings[id] || []).includes(code)) out.push(id);
  }
  return out;
}

/**
 * Which action, if any, a given key is already bound to — so the options screen
 * can warn about a conflict instead of silently producing one. The first of
 * findConflicts; use that one when you intend to act on the answer.
 */
export function findConflict(bindings, code, exceptId) {
  return findConflicts(bindings, code, exceptId)[0] ?? null;
}

/**
 * Give `code` to `keepId` and to nothing else.
 *
 * Takes it off EVERY other action, not the first one found, and never leaves an
 * action with nothing at all — an action stripped down to its last key keeps
 * it, and the caller is told, so a conflict it cannot resolve is visible rather
 * than silently applied. Mutates `bindings` and returns
 * `{ taken, refused }`: the ids it took the key from, and the ids that would
 * have been left unbound.
 */
export function resolveConflicts(bindings, code, keepId) {
  const taken = [], refused = [];
  for (const id of findConflicts(bindings, code, keepId)) {
    const rest = (bindings[id] || []).filter(k => k !== code);
    if (rest.length) { bindings[id] = rest; taken.push(id); }
    else refused.push(id);
  }
  return { taken, refused };
}

/**
 * Every key that more than one action answers to, as `{ code, ids }` rows.
 *
 * The defaults must return [] — that is what tools/checks/controls.mjs pins,
 * and it is the only way "no rebind can separate them" stops being reachable
 * from a fresh profile.
 */
export function conflicts(bindings) {
  const byCode = new Map();
  for (const id of ACTION_IDS) {
    for (const code of bindings[id] || []) {
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(id);
    }
  }
  const out = [];
  for (const [code, ids] of byCode) if (ids.length > 1) out.push({ code, ids });
  return out;
}
