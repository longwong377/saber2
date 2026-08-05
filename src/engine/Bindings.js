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
  { id: 'rollL',      group: 'Blade',    label: 'Roll wrist left',   keys: ['KeyQ'],       hold: true },
  { id: 'rollR',      group: 'Blade',    label: 'Roll wrist right',  keys: ['KeyE'],       hold: true },
  { id: 'ignite',     group: 'Blade',    label: 'Ignite / retract',  keys: ['KeyX'] },
  { id: 'grip2',      group: 'Blade',    label: 'One-handed grip',   keys: ['CapsLock'],   hold: true },

  { id: 'focus',      group: 'Force',    label: 'Focus (slow time)', keys: ['Mouse3', 'KeyT'], hold: true },
  { id: 'push',       group: 'Force',    label: 'Force push',        keys: ['KeyF'] },
  { id: 'pull',       group: 'Force',    label: 'Force pull',        keys: ['KeyR'] },
  { id: 'grip',       group: 'Force',    label: 'Force grip object', keys: ['KeyG'],       hold: true },
  { id: 'hurl',       group: 'Force',    label: 'Hurl gripped',      keys: ['Mouse2'] },
  { id: 'throw',      group: 'Force',    label: 'Throw / recall saber', keys: ['KeyH'] },
  { id: 'sense',      group: 'Force',    label: 'Force sense',       keys: ['KeyC'] },
  { id: 'lightning',  group: 'Force',    label: 'Force lightning',   keys: ['KeyZ'] },

  { id: 'scoreboard', group: 'Interface', label: 'Scoreboard',       keys: ['Tab'],        hold: true },
  { id: 'view',       group: 'Interface', label: 'First / third person', keys: ['KeyV'] },
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
  if (code.startsWith('Mouse')) return code.replace('Mouse', 'M');
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  return ({
    Space: 'Space', ShiftLeft: 'L Shift', ShiftRight: 'R Shift',
    ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', AltLeft: 'L Alt', AltRight: 'R Alt',
    CapsLock: 'Caps', Tab: 'Tab', Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=',
  })[code] || code;
}

/**
 * Which action, if any, a given key is already bound to — so the options screen
 * can warn about a conflict instead of silently producing one.
 */
export function findConflict(bindings, code, exceptId) {
  for (const id of ACTION_IDS) {
    if (id === exceptId) continue;
    if ((bindings[id] || []).includes(code)) return id;
  }
  return null;
}
