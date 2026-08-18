/**
 * BATTLEFRONT BORZ — key bindings.
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

/* ══════════════════════════════════════════════════════════════════════ */
/*  THE PAD, WHICH WAS NOT IN THIS TABLE AT ALL                           */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * A GAMEPAD WAS A STICK YOU COULD WAVE.
 *
 * Measured before this: `grep -rn "vibrationActuator\|playEffect" src/` was
 * zero hits, and `Input._codeDown` resolved a binding as a wheel pseudo-key, a
 * `Mouse*` button or `keys.has(code)` — there was NO code form a pad button
 * could take, so not one of the 46 actions could be bound to one. What a pad
 * reached was the right stick (look), the left stick (move) and buttons 4 and 5
 * (wrist roll, read raw inside SaberController, past this table). A player
 * holding a controller could not attack, guard, jump, dodge, dash, use a power,
 * pause or open the emote wheel.
 *
 * So the pad joins the namespace the mouse and the wheel are already in, which
 * is the whole point of this file: one table, one conflict finder, one Codex,
 * and a control that is not in here cannot be rebound, listed, or seen to
 * collide.
 *
 * ── THE NAMES ARE THE STANDARD MAPPING'S, and they are POSITIONS ───────
 *
 * The Gamepad API's `standard` mapping fixes what button 3 is, and nothing
 * fixes what it is CALLED — it is Y on an Xbox pad, Triangle on a PlayStation
 * one and X on a Nintendo one. The code is therefore the index's Xbox name
 * (the mapping's own reference layout) and the LABEL is chosen at render time
 * from the pad that is plugged in; see padLabel().
 */
export const PAD = {
  0: 'PadA', 1: 'PadB', 2: 'PadX', 3: 'PadY',
  4: 'PadLB', 5: 'PadRB', 6: 'PadLT', 7: 'PadRT',
  8: 'PadBack', 9: 'PadStart', 10: 'PadL3', 11: 'PadR3',
  12: 'PadUp', 13: 'PadDown', 14: 'PadLeft', 15: 'PadRight',
};
/** index → code, and back. Button 16 (Guide/Home) is left to the OS. */
export const PAD_CODES = Object.values(PAD);
export const PAD_INDEX = new Map(Object.entries(PAD).map(([i, c]) => [c, +i]));

/**
 * THE LEFT STICK, AS FOUR CODES — because it was a second set of movement
 * bindings that no table knew about.
 *
 * `moveAxis` read `this.padLeft` directly and added it to whatever the table
 * said. That is precisely the defect the four `|| this.down('ArrowUp')` were
 * removed for one round ago, wearing a stick instead of an arrow key: the
 * codes were invisible to `findConflicts`, unrebindable, and on no screen.
 *
 * They are ANALOG and they stay analog. `Input.actAxis` returns the magnitude
 * rather than a boolean, so a stick pushed a third of the way still walks a
 * third of the pace — a threshold here would have thrown the one thing a pad
 * has that a keyboard does not. The deadzone is the boolean's threshold and
 * the analog's zero at once, so `act('moveF')` and `actAxis('moveF')` can never
 * disagree about whether the stick is being pushed.
 */
export const PAD_AXES = {
  PadLUp:    { axis: 1, sign: -1 }, PadLDown:  { axis: 1, sign: 1 },
  PadLLeft:  { axis: 0, sign: -1 }, PadLRight: { axis: 0, sign: 1 },
};
export const PAD_AXIS_CODES = Object.keys(PAD_AXES);

/**
 * A CHORD IS ONE CODE, JOINED BY '+'.
 *
 * The header of this file has promised chords since it was written — "a chord
 * is one main key plus optional modifiers; the most specific chord wins" — and
 * nothing implemented them, because a keyboard has 104 keys and never needed
 * one. A pad has sixteen buttons and 42 actions that want a code, so it does.
 *
 * A chord is a CODE and not a new kind of binding: `findConflicts`,
 * `resolveConflicts`, `conflicts`, `loadBindings` and the options list all go
 * on comparing strings and none of them had to learn anything. What has to
 * know is `Input`, which resolves it — and the "most specific wins" half, which
 * is that a bare code is suppressed while a chord containing it is satisfied.
 * Hold LB and press A and you push; you must not also jump.
 */
export const CHORD = '+';
export const chordParts = (code) => String(code).split(CHORD);
export const isChord = (code) => String(code).includes(CHORD);

/**
 * A CHORD IS A SET OF BUTTONS, NOT A STRING — and the difference was a bug.
 *
 * `PadLB+PadBack` and `PadBack+PadLB` are one physical pair of buttons and two
 * different strings, so every comparison in this file that used `===` or
 * `.includes(code)` read them as unrelated. Two actions shipped on that pair —
 * the flourish and the order wheel — and `conflicts()` reported the table as
 * clean, because it was comparing spellings.
 *
 * So a comparison key: the parts, sorted, rejoined. Sorting is what makes the
 * order stop mattering, and it is done HERE and read by `conflicts`,
 * `findConflicts` and `resolveConflicts` rather than at each of them, so a
 * fourth reader cannot get its own opinion. A plain key is its own key, which
 * is why this is safe to apply to every code and not only to chords.
 */
export const chordKey = (code) => (isChord(code)
  ? chordParts(code).slice().sort().join(CHORD) : String(code));

/**
 * THE TWO MODIFIERS, AND WHY THEY HOLD NOTHING OF THEIR OWN.
 *
 * LB is the Force layer and Back/View is the interface-and-orders layer. Both
 * are bound to no action at all, and that is a decision rather than an
 * oversight: a modifier that also fires something means every cast drops
 * whatever the modifier was holding for the frame the chord lands on, and the
 * two obvious candidates for LB's own job — the lateral guard and the
 * one-handed grip — are exactly the kind of HOLD you would be in the middle of
 * when you cast. tools/checks/controls.mjs asserts they stay unbound.
 *
 * Start is not here and is not an action: it is the way OUT, and it is
 * device-level for the same reason Escape is (see pauseHintsHtml). Chords on it
 * are legal — bare Start only opens the menu when no modifier is held.
 */
export const PAD_MODIFIERS = ['PadLB', 'PadBack'];

/**
 * Every rebindable action, in the order the options screen lists them.
 * `hold` marks an action read continuously rather than on the press edge.
 */
export const ACTIONS = [
  { id: 'moveF',      group: 'Movement', label: 'Move forward',      keys: ['KeyW'],       hold: true, pad: 'PadLUp' },
  { id: 'moveB',      group: 'Movement', label: 'Move back',         keys: ['KeyS'],       hold: true, pad: 'PadLDown' },
  { id: 'moveL',      group: 'Movement', label: 'Move left',         keys: ['KeyA'],       hold: true, pad: 'PadLLeft' },
  { id: 'moveR',      group: 'Movement', label: 'Move right',        keys: ['KeyD'],       hold: true, pad: 'PadLRight' },
  { id: 'jump',       group: 'Movement', label: 'Force jump',        keys: ['Space'],      hold: true, pad: 'PadA' },
  { id: 'sprint',     group: 'Movement', label: 'Sprint',            keys: ['ShiftLeft'],  hold: true, pad: 'PadL3' },
  // Backquote, and every other candidate was taken. A slow walk is a HOLD you
  // keep for tens of seconds while strafing on WASD, so it belongs under the
  // LEFT PINKY — the column that already carries Shift (sprint), Ctrl
  // (crouch), Caps (one-handed grip) and Tab (scoreboard). Backquote is the
  // only key left in that column, and the alternatives are all worse for the
  // same reason: 19 of the 26 letters are claimed and the seven that are free
  // (I J K L O P U) sit under the hand that is on the MOUSE, and the digit row
  // wants the index finger, which is on W.
  //
  // A modifier and not a toggle, because the whole point of the gait is that
  // it is a THING YOU ARE DOING — you hold it to walk into a room, and the
  // moment you let go you are moving normally again. A toggled walk is a mode
  // you forget you are in, and the first time you forget is a bolt in the back.
  /* KeyI, and it is the one row in this table deliberately placed where the
   * hand is NOT. The left hand has six keys a pinky or a thumb can hold —
   * Tab, CapsLock, Backquote, Shift, Ctrl, Alt — every one of them was spoken
   * for, and the stratagem key has to be one of them because it is held while
   * the same hand spells WASD (see `stratagem`). Something had to move, and
   * the honest question is which hold is least needed WHILE THE LEFT HAND IS
   * BUSY. That is this one: a slow walk is how you creep into a room, it is
   * never a reflex, and reaching over for a moment costs nothing. Its pad
   * binding and the left stick's own analog walk are untouched — see
   * WALK_SCALE, which is how most players will meet this at all. */
  { id: 'walk',       group: 'Movement', label: 'Slow walk',         keys: ['KeyI'],       hold: true, pad: 'PadBack+PadL3' },
  { id: 'crouch',     group: 'Movement', label: 'Crouch',            keys: ['ControlLeft'], hold: true, pad: 'PadR3' },
  { id: 'dash',       group: 'Movement', label: 'Dash / evade',      keys: ['AltLeft'], pad: 'PadB' },

  /**
   * RIGHT BUTTON GUARDS, LEFT BUTTON ATTACKS. Player note #15: "block should be
   * right click and attack should be left click".
   *
   * These two rows were the wrong way round and had been since the first
   * scheme: `blade` — which is the GUARD in the shipped directional scheme,
   * where holding it raises a zone — sat on LMB, and `thrust` — the only
   * attack on the mouse at all — sat on RMB. That is inverted from every
   * melee game the reference list names, and it is the whole of the note.
   *
   * Swapping the two KEYS is the entire fix, and it is a swap rather than a
   * scheme because the meaning of each button then becomes one sentence that
   * holds in all three schemes:
   *
   *   RMB (`blade`)   the guard. Directional raises a zone, Hold-to-Blade
   *                   takes the blade, Free PINS it — free is the one where
   *                   the blade is always live, so its guard button is the one
   *                   that stops it, and it is still the same button.
   *   LMB (`thrust`)  the attack. A stab in every scheme, with no scheme
   *                   condition left on it at all.
   *
   * That collapsed two `scheme === 'free' ? … : …` ternaries in
   * SaberController.applyInput into one expression each — see the notes there.
   *
   * The PAD is deliberately untouched. RT is not "left click on a controller":
   * it is the trigger you pull to engage, both hands are already committed to
   * the sticks, and `stance`'s own note above spends a paragraph on why the
   * holds live under the index fingers and the presses on the face buttons.
   * Re-deriving that layout from a mouse convention would undo it.
   */
  { id: 'blade',      group: 'Blade',    label: 'Guard / take the blade', keys: ['Mouse2'], hold: true, pad: 'PadRT' },
  // PadY and not PadRB, and `stance` has the bumper instead — see the note on
  // `stance` below. A thrust is a PRESS, so a face button costs the right thumb
  // one beat off the look stick; a lateral guard is a HOLD, and a hold on a face
  // button is a guard the player cannot aim from.
  { id: 'thrust',     group: 'Blade',    label: 'Attack (thrust)',   keys: ['Mouse1'], pad: 'PadY' },
  // The two halves of the attack rose, mirroring the guard rose: wheel up is an
  // overhead, wheel down is a stab. They are ordinary rows here rather than a
  // raw `mouse.wheel` read for exactly the reason the four rows below this one
  // exist — a control that is not in this table cannot be rebound, cannot be
  // listed, and cannot be seen to collide with the Force grip, which is the
  // other thing that wants the wheel.
  { id: 'attackOver', group: 'Blade',    label: 'Overhead attack',   keys: ['WheelUp'], pad: 'PadUp' },
  { id: 'attackStab', group: 'Blade',    label: 'Stab',              keys: ['WheelDown'], pad: 'PadDown' },
  /**
   * THE SPIN, and the reason it is on the THUMB BUTTON rather than a letter.
   *
   * There is no free key left under the left hand — every one of them is a
   * Force power, a roll, a stance or a gait — and putting the third attack in
   * the I/J/K/L block would be putting it where no hand is. The mouse has one
   * spare control and this is it: `dash` is the only action bound to two keys,
   * and the one it keeps (AltLeft) is under the left hand where movement
   * already lives, so the thumb button costs the dash nothing it needs.
   *
   * The pad takes a chord because the pad has genuinely run out: every bare
   * button and every LB/Back chord but six is spoken for, and of those six
   * this is the one a right thumb can reach without leaving the look stick for
   * longer than the wind-up. A pad player who disagrees can rebind it, which
   * is the whole reason this row is in the table rather than read raw.
   */
  { id: 'attackSpin', group: 'Blade',    label: 'Spinning attack',   keys: ['Mouse4'], pad: 'PadBack+PadB' },
  { id: 'rollL',      group: 'Blade',    label: 'Roll wrist left',   keys: ['KeyQ'],       hold: true, pad: 'PadLeft' },
  { id: 'rollR',      group: 'Blade',    label: 'Roll wrist right',  keys: ['KeyE'],       hold: true, pad: 'PadRight' },
  { id: 'ignite',     group: 'Blade',    label: 'Ignite / retract',  keys: ['KeyX'], pad: 'PadX' },
  /* Backquote, vacated by `walk` — see the note there for why the left hand's
   * holds were reshuffled at all. A one-handed grip is a STANCE you settle
   * into rather than a flick, so a pinky stretch above Tab is a home it can
   * live with; the stratagem key that took CapsLock cannot be anywhere else. */
  { id: 'grip2',      group: 'Blade',    label: 'One-handed grip',   keys: ['Backquote'],  hold: true, pad: 'PadBack+PadRB' },
  // Digit1/Digit2, not KeyB/KeyN. These two were seeded onto B and N at runtime
  // by SaberController, which meant they were not in this table, so they never
  // reached the options screen, could not be rebound, and could not be seen to
  // COLLIDE: B already fired the stasis field and stepped the dojo lesson back,
  // N already fired rend and skipped the lesson. One press, three systems.
  // Every letter in the left-hand cluster is spoken for, and a guard stance is
  // a HOLD you keep while strafing, so it has to stay under the left hand: the
  // digit row is the only thing left there that nothing else claims. Mouse5 is
  // the thumb button and is the nicer way to hold it if you have one.
  /* PadRB, and the reason is the same one that put this on the DIGIT ROW for a
   * keyboard: "a guard stance is a HOLD you keep while strafing, so it has to
   * stay under the left hand". On a pad the equivalent constraint is that both
   * THUMBS are on sticks — one moving, one aiming — for the whole time a guard
   * is up, so a hold has to live under an index finger. RT is `blade` and LT is
   * `focus`; RB is the one left, and `thrust` took the face button it vacated
   * because a press can afford to. */
  { id: 'stance',     group: 'Blade',    label: 'Lateral guard',     keys: ['Digit1', 'Mouse5'], hold: true, pad: 'PadRB' },
  /* MOVED OFF `PadLB+PadBack`, which is both modifiers at once and which
   * `orderwheel` also claimed under the other spelling: two rows on one
   * physical pair, and the conflict finder could not see it because it
   * compared chord STRINGS and 'PadLB+PadBack' is not 'PadBack+PadLB'. The
   * blindness is fixed in `chordKey`; this row is the half of the pair that
   * moved, onto a chord the retired order pool gave back. */
  { id: 'flourish',   group: 'Blade',    label: 'Flourish',          keys: ['Digit2'], pad: 'PadBack+PadRT' },
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
  { id: 'swap',       group: 'Blade',    label: 'Drop / take a saber', keys: ['KeyM'], pad: 'PadBack+PadX' },

  /* KeyT WENT TO THE ORDER WHEEL, and this is the trade. Focus keeps Mouse3,
   * which is where it is actually pressed — the second bind was a courtesy for
   * a mouse with no wheel click, and it was the only left-hand letter left in
   * a table where every key within reach of WASD is spoken for. Note #18 asks
   * for six order keys to become one, and the one has to be somewhere. */
  { id: 'focus',      group: 'Force',    label: 'Focus (slow time)', keys: ['Mouse3'], hold: true, pad: 'PadLT' },
  { id: 'push',       group: 'Force',    label: 'Force push',        keys: ['KeyF'], pad: 'PadLB+PadA' },
  { id: 'pull',       group: 'Force',    label: 'Force pull',        keys: ['KeyR'], pad: 'PadLB+PadB' },
  { id: 'grip',       group: 'Force',    label: 'Force grip object', keys: ['KeyG'],       hold: true, pad: 'PadLB+PadX' },
  // KeyY, not Mouse2. Mouse2 is `thrust`, and it was ALSO the shipped default
  // here — a clash inside the defaults themselves, so a fresh profile had one
  // button firing two things and no rebind could separate them until you found
  // and moved one by hand. The options screen never said so either, because
  // findConflict only ever looked at the key you were TYPING, never at what was
  // already in the table. Y is free, and it sits with the other Force verbs
  // that live off the movement cluster (T focus, H throw).
  { id: 'hurl',       group: 'Force',    label: 'Hurl gripped',      keys: ['KeyY'], pad: 'PadLB+PadY' },
  { id: 'throw',      group: 'Force',    label: 'Throw / recall saber', keys: ['KeyH'], pad: 'PadLB+PadRB' },
  { id: 'sense',      group: 'Force',    label: 'Force sense',       keys: ['KeyC'], pad: 'PadLB+PadLeft' },
  { id: 'lightning',  group: 'Force',    label: 'Force lightning',   keys: ['KeyZ'], pad: 'PadLB+PadUp' },
  /* KeyU, and the choice was made by ASKING rather than by guessing: KeyT is
   * `focus`, and the letters this table has not already spoken for are
   * I, J, K, L, O and U. U is the nearest of those to WASD, which matters for
   * a power whose entire use case is "I am surrounded and I have half a
   * second". A key typed here without checking is how two actions end up
   * sharing one — see the note on `hurl` above, which is that bug's scar. */
  { id: 'unleash',    group: 'Force',    label: 'Unleash (360° repulse)', keys: ['KeyU'], pad: 'PadLB+PadRT' },
  // Stasis and rend were read straight off KeyB and KeyN inside Player, past
  // this table, so they had the same disease: no menu row, no rebind, and no
  // way for findConflict to warn that something else wanted the key. Their
  // default keys are unchanged — what changes is that they are now sayable.
  { id: 'stasis',     group: 'Force',    label: 'Stasis field',      keys: ['KeyB'], pad: 'PadLB+PadRight' },
  { id: 'heal',       group: 'Force',    label: 'Force heal',        keys: ['Digit3'], pad: 'PadLB+PadDown' },
  { id: 'rend',       group: 'Force',    label: 'Rend apart',        keys: ['KeyN'], pad: 'PadLB+PadLT' },
  // Digit4 rather than a letter: it sits beside `heal` on Digit3, and the two
  // powers that act on a MIND — yours and someone else's — should be neighbours
  // under the same hand. Every letter within reach of WASD is already spoken
  // for, and findConflict is what proves it rather than anyone's memory.
  { id: 'compel',     group: 'Force',    label: 'Force compel',      keys: ['Digit4'], pad: 'PadLB+PadL3' },
  { id: 'scoreboard', group: 'Interface', label: 'Scoreboard',       keys: ['Tab'],        hold: true, pad: 'PadBack+PadY' },
  { id: 'view',       group: 'Interface', label: 'First / third person', keys: ['KeyV'], pad: 'PadBack+PadA' },
  // Digit5 for the wheel, on the same argument the guard stance made for
  // Digit1: the digit row is what is left under the left hand once every
  // letter within reach of WASD is spoken for, and `stance` already proves a
  // HOLD works there. It is a hold rather than a toggle because the mouse
  // picks the slot while the key is down and the release is the commit — the
  // same gesture every radial wheel in every game uses, and the one that
  // cannot leave the player stuck in a menu they did not mean to open.
  { id: 'emote',      group: 'Interface', label: 'Emote wheel',      keys: ['Digit5'],     hold: true, pad: 'PadBack+PadLT' },
  /**
   * THE ORDER WHEEL — note #18, "commanding your troops takes up too many
   * buttons so it needs to be a small popup mousewheel sort of thing".
   *
   * `KeyT` and not another digit, and the reason is the whole point of the
   * note: the six formation keys are Digit6 through Minus, and the fix for
   * "too many buttons on the digit row" cannot be a seventh button on the
   * digit row. T is inside the WASD hand's reach, it is a hold like the emote
   * wheel and for the same reason, and it is the one letter in that cluster
   * with nothing on it.
   *
   * THE SIX DIGITS STAY. They are in this table, they are rebindable, and a
   * player who has learned them has learned something real and faster than a
   * wheel. What the note asks for is that nobody HAS to.
   */
  { id: 'orderwheel', group: 'Command',   label: 'Order wheel',      keys: ['KeyT'],       hold: true, pad: 'PadBack+PadLB' },
  /**
   * ONE BINDING FOR EVERY SUPPORT CALL THERE WILL EVER BE.
   *
   * Hold it and the movement keys stop moving you and start SPELLING — see
   * src/game/Stratagems.js for why a code and not a key, and for the part that
   * matters here: a stratagem costs this table exactly one row however many
   * calls are authored. That is the only shape that fits. The keyboard has no
   * free letter under the left hand and the pad has forty-six places and had
   * filled all of them; a sixth support call on the sixth spare button was
   * never going to happen, and a sixth code costs nothing.
   *
   * A HOLD, and the hold is load-bearing rather than a style: it is what tells
   * `moveF` apart from the letter W. Nothing about movement changes when it is
   * up, and while it is down the player has deliberately stopped walking in
   * order to ask for something — which is the risk the mechanic is made of.
   *
   * `PadBack+PadUp` was one of the six chords the retired order pool gave back
   * (see ORDER_PAD_POOL): the D-pad spells the same four directions the
   * keyboard does, so the codes read identically on both devices without the
   * table knowing that either exists.
   */
  { id: 'stratagem',  group: 'Command',   label: 'Call a stratagem', keys: ['CapsLock'],   hold: true, pad: 'PadBack+PadUp' },
  // P for photo. This one may live under the right hand precisely BECAUSE it
  // is a press and not a hold: you take the mouse off the game the moment it
  // is on, and everything you do afterwards is flown with the movement keys.
  { id: 'freecam',    group: 'Interface', label: 'Free camera',      keys: ['KeyP'], pad: 'PadLB+PadR3' },

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
  { id: 'lessonNext',   group: 'Training', label: 'Next lesson',     keys: ['BracketRight'], pad: 'PadBack+PadRight' },
  { id: 'lessonBack',   group: 'Training', label: 'Previous lesson', keys: ['BracketLeft'], pad: 'PadBack+PadLeft' },
  { id: 'lessonRepeat', group: 'Training', label: 'Restart lesson',  keys: ['Backslash'], pad: 'PadLB+PadStart' },
];

export const ACTION_IDS = ACTIONS.map(a => a.id);

/* ══════════════════════════════════════════════════════════════════════ */
/*  A REGISTRATION SEAM, so a table upstream of this file cannot drift    */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * SIX ORDER KEYS THAT NOTHING COULD SEE — and why the fix is a seam.
 *
 * `FORMATIONS` (src/game/Command.js) carries the key each order wants —
 * Digit6…Digit0 and Minus — and main.js read them RAW: `input.hit(F.key)`.
 * Everything this file exists to guarantee was therefore false for six of the
 * game's controls at once. They were not rebindable, they were on no controls
 * card, they were in no Codex row, and `findConflicts` reported every one of
 * those seven codes as FREE — so the options screen would happily hand Digit6
 * to something else and produce a collision it could not warn about and no
 * rebind could separate. That is the KeyB/KeyN disease, twice over, in the one
 * mode where a mis-press means an order to your own army.
 *
 * THE OBVIOUS FIX IS THE WRONG ONE. Six literal rows in ACTIONS above —
 * `{ id: 'form.circle', keys: ['Digit6'] }` and five more — is a hand-written
 * table sitting beside the generated one it copies, which is HANDOFF §2.3 and
 * the single most repeated defect in this repository (eight instances found so
 * far). Change a formation's key in Command.js and the rows here go on
 * describing the old game, silently, with nothing able to notice.
 *
 * AND THE DIRECT IMPORT IS ALSO THE WRONG ONE. This file is `engine/`;
 * `FORMATIONS` is `game/`. An engine module that reaches up into game closes a
 * cycle whose shape this project has already paid for once as a boot-time TDZ
 * crash, and it would make the key table of every mode depend on the module
 * graph of one of them.
 *
 * So neither side imports the other. The GAME's table stays the only authority
 * for what an order is called and which key it wants; this file publishes the
 * shape of a binding and a door to push records through. `src/ui/Menu.js` — a
 * ui module, which is allowed to see both — calls `registerOrders(FORMATIONS)`
 * once at module scope, and everything downstream (defaultBindings, the
 * options list, the conflict finder, the Codex, main.js's own reader) sees six
 * ordinary actions it does not have to know anything special about.
 *
 * Nothing here is typed twice. `id`, `name`, `key` and `blurb` all come off the
 * formation record; `tools/checks/controls.mjs` re-derives the same set from
 * `FORMATIONS` and fails if one row disagrees or is missing.
 */
export const ORDER_GROUP = 'Command';

/** The action id a formation answers to. One rule, called by everyone. */
export const orderActionId = (formationId) => `form.${formationId}`;

/**
 * The registered orders, in the order they were declared, as
 * `{ id, action, label, blurb, key }` — `id` the formation's, `action` this
 * table's. Empty until `registerOrders` runs; a mode that is never loaded
 * costs nothing.
 */
export const ORDER_ACTIONS = [];

/**
 * THE PAD CODES AN ORDER MAY HAVE, as a POOL and not as six typed rows.
 *
 * The orders are generated from `FORMATIONS`, so their pad bindings have to be
 * generated too — six literal `{ 'form.circle': 'PadBack+PadA' }` entries beside
 * the generated table is HANDOFF §2.3's signature defect, and the note above
 * this seam already refuses it once for the keyboard.
 *
 * So a formation is DEALT the next code in this pool, in declaration order.
 * A formation past the end of the pool gets no pad code rather than a wrong
 * one, and tools/checks/controls.mjs prints the shortfall instead of hiding it.
 *
 * ── AND THE POOL IS NOW EMPTY, WHICH IS THE POINT ──────────────────────
 *
 * It held six chords — `Back` plus the four face buttons and the two vertical
 * D-pad presses — dealt one to each formation, and it was written before the
 * ORDER WHEEL existed. The wheel is on the pad (`orderwheel`, PadBack+PadLB),
 * it is built from `FORMATIONS` itself, and it carries every order plus the
 * hold toggle. So on a pad the orders already had two complete routes and the
 * second one was costing a sixth of the pad's remaining capacity.
 *
 * That capacity is not theoretical. The pad holds thirteen bare buttons, four
 * stick directions and twenty-nine modifier chords — forty-six places — and
 * the table had grown to fill every one of them, which is how two actions came
 * to share `LB+Back` under two spellings with nothing able to see it. A
 * spinning attack could not be added at all until something gave, and of
 * everything on the pad the least defensible was a second way to say a thing
 * the wheel already says better.
 *
 * A KEYBOARD IS UNTOUCHED. Digit6…Minus still fire the six orders directly,
 * because a keyboard has the room and a wheel on a mouse is slower than a key.
 * tools/checks/controls.mjs asserts the wheel is what carries them on a pad —
 * derived from `ORDER_ACTIONS` and the wheel's own binding, so retiring the
 * wheel would put the shortfall straight back on the screen.
 */
export const ORDER_PAD_POOL = [];

/**
 * Teach the bindings table about a set of orders.
 *
 * Idempotent and re-entrant BY DESIGN: called twice with a changed table, the
 * second call rewrites the rows rather than appending a second set of them.
 * That matters because the alternative — "first registration wins" — is how a
 * seam quietly becomes the stale twin it was built to abolish.
 *
 * `ACTIONS` and `ACTION_IDS` are mutated in place rather than replaced.
 * `ACTION_IDS` is a module-scope snapshot every consumer of this file already
 * holds a reference to (`loadBindings`, `findConflicts`, `conflicts`), so a
 * reassignment would leave all three of them iterating the old six-short list —
 * which is precisely the invisibility this seam exists to end.
 *
 * @param {object|Array} formations `FORMATIONS`, or any list of records with
 *        `{ id, name, key }` and optionally `blurb`.
 * @returns {Array} the registered rows.
 */
export function registerOrders(formations) {
  const list = Array.isArray(formations) ? formations : Object.values(formations || {});
  for (const F of list) {
    if (!F || !F.id || !F.key) continue;
    const action = orderActionId(F.id);
    const row = {
      id: action, group: ORDER_GROUP,
      // "Order:" so the options screen's Command group reads as a column of
      // orders rather than six nouns, and so the label follows a rename of the
      // formation without anybody editing this file.
      label: `Order: ${F.name}`,
      keys: [F.key],
      order: F.id, blurb: F.blurb || '',
    };
    // Dealt, not typed. Re-entrant: a formation keeps the slot its position in
    // the table gives it, so registering twice does not shuffle the pad map.
    const slot = ORDER_ACTIONS.findIndex(o => o.action === action);
    const nth = slot >= 0 ? slot : ORDER_ACTIONS.length;
    if (ORDER_PAD_POOL[nth]) row.pad = ORDER_PAD_POOL[nth];
    const at = ACTIONS.findIndex(a => a.id === action);
    if (at >= 0) ACTIONS[at] = row; else { ACTIONS.push(row); ACTION_IDS.push(action); }
    const seen = ORDER_ACTIONS.findIndex(o => o.action === action);
    const pub = { id: F.id, action, name: F.name, label: row.label, blurb: row.blurb, key: F.key };
    if (seen >= 0) ORDER_ACTIONS[seen] = pub; else ORDER_ACTIONS.push(pub);
  }
  return ORDER_ACTIONS;
}

/**
 * HOW MUCH OF THE ORDINARY PACE A HELD SLOW WALK LEAVES.
 *
 * 0.34 of the base, which is 1.56 m/s against the game's 4.6. That is not a
 * number picked to look small: 1.4 m/s is the pace a person walks down a
 * corridor, a crouch already takes the player to 2.21 m/s (0.48), and a gait
 * that is not clearly UNDER the crouch is not a gait, it is a rounding error
 * with a key on it. At 0.34 the four upright speeds a player can be at are
 *
 *     slow walk 1.56   crouch 2.21   walk 4.60   sprint 7.45   (m/s)
 *
 * — four steps that are each about half again the one below, which is the
 * spacing at which a player can actually feel which one they are in.
 *
 * Those four are not typed here from arithmetic; they are the line
 * tools/checks/spectacle.mjs prints, measured off the real integrator on every
 * run. Three of them belong to src/game/Player.js (the 4.6 base, the 0.48
 * crouch, the 1.62 sprint) and this file does not own any of them, so if one
 * moves the check's printed ladder moves with it and THIS comment is what has
 * to follow — the check holds the ORDER and the ratio, which is the part that
 * decides whether a player can feel the difference.
 *
 * It also has to survive the ANIMATOR. Rig.js stops solving a gait below
 * `0.35 × legRef` and drives stride frequency off ground speed, so a walk that
 * crept under that floor would slide the feet instead of stepping them; 1.56
 * is comfortably above it, and the stride solver simply reads a slower body.
 */
export const WALK_SCALE = 0.34;

/**
 * The multiplier a HELD SLOW WALK puts on the player's pace, this frame.
 *
 * It lives beside the table rather than at the site that multiplies by it for
 * the same reason `moveAxis` reads the table and not `down('KeyW')`: the gait
 * is a BINDING, and the one thing every version of this project's key bugs had
 * in common is a control that was read somewhere the table could not see.
 *
 * Sprint wins outright rather than the two multiplying. A player holding both
 * has asked for two contradictory things, and 0.34 × 1.62 is a fifth gait
 * nobody asked for and no readout describes; "let go of sprint and you are
 * walking" is a rule you can hold in your head. Note that this asks the two
 * ACTIONS and not the two KEYS, so it keeps meaning that after any rebind.
 */
export function walkScale(input) {
  if (!input || typeof input.act !== 'function') return 1;
  if (input.act('sprint')) return 1;
  return input.act('walk') ? WALK_SCALE : 1;
}

/**
 * The shipped table, keyboard AND pad.
 *
 * The pad code is a THIRD entry on the same list rather than a second table,
 * because "a binding is a list" is the one thing this file has always said and
 * a parallel pad map would be the hand-maintained twin HANDOFF §2.3 is about:
 * one conflict finder, one options row, one Codex line, whichever device the
 * player is holding. Every row already had room — the longest shipped binding
 * was two keys and `loadBindings` keeps three.
 */
export function defaultBindings() {
  const out = {};
  for (const a of ACTIONS) out[a.id] = a.pad ? a.keys.concat(a.pad) : a.keys.slice();
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

/* ══════════════════════════════════════════════════════════════════════ */
/*  GLYPHS — the same binding, named for the thing in the player's hands   */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * WHAT BUTTON 3 IS CALLED, and it depends on the pad.
 *
 * The standard mapping fixes the POSITION and nothing fixes the name: index 3
 * is Y on an Xbox pad, △ on a PlayStation one and X on a Nintendo one — and
 * Nintendo also swaps 0/1 and 2/3 relative to the letters printed on the shell.
 * A creator screen that says "Y" to somebody holding a DualSense is the same
 * lie as a Codex that says "M2 to hurl it" after the rebind, which is the
 * defect this whole file's no-typed-key-names rule exists for.
 *
 * Three families, keyed off `Gamepad.id` — which is a free-form vendor string,
 * so this matches on what is reliably IN it and falls back to the reference
 * layout rather than guessing. `PAD_FAMILY` is what the options screen offers
 * and what a check enumerates.
 */
export const PAD_FAMILY = ['xbox', 'playstation', 'nintendo'];
const PAD_FACE = {
  xbox:        { PadA: 'A', PadB: 'B', PadX: 'X', PadY: 'Y', PadBack: 'View', PadStart: 'Menu' },
  playstation: { PadA: '✕', PadB: '○', PadX: '□', PadY: '△', PadBack: 'Create', PadStart: 'Options' },
  nintendo:    { PadA: 'B', PadB: 'A', PadX: 'Y', PadY: 'X', PadBack: '−', PadStart: '+' },
};
const PAD_SHOULDER = {
  xbox:        { PadLB: 'LB', PadRB: 'RB', PadLT: 'LT', PadRT: 'RT', PadL3: 'LS', PadR3: 'RS' },
  playstation: { PadLB: 'L1', PadRB: 'R1', PadLT: 'L2', PadRT: 'R2', PadL3: 'L3', PadR3: 'R3' },
  nintendo:    { PadLB: 'L', PadRB: 'R', PadLT: 'ZL', PadRT: 'ZR', PadL3: 'LS', PadR3: 'RS' },
};
const PAD_COMMON = {
  PadUp: '↑', PadDown: '↓', PadLeft: '←', PadRight: '→',
  PadLUp: 'Stick ↑', PadLDown: 'Stick ↓', PadLLeft: 'Stick ←', PadLRight: 'Stick →',
};

/**
 * Which family a `Gamepad.id` belongs to. The reference layout when unsure.
 *
 * XBOX IS TESTED FIRST AND THAT IS NOT ARBITRARY. `Gamepad.id` is a free-form
 * vendor string and the families' names overlap: Chromium calls a DualShock 4
 * "Wireless Controller", and "Xbox Wireless Controller" contains that phrase
 * word for word. A generic pattern that fires on the shared half reads the
 * commonest pad on the platform as the other one, which is how this check
 * failed the first time it was run. The specific vendor words win.
 */
export function padFamily(id) {
  const s = String(id || '').toLowerCase();
  if (/xbox|xinput|microsoft/.test(s)) return 'xbox';
  if (/nintendo|switch|joy-?con|\bpro controller\b/.test(s)) return 'nintendo';
  if (/dualsense|dualshock|playstation|\bps[345]\b|sony|wireless controller/.test(s)) return 'playstation';
  return 'xbox';
}

/** Is this code a pad button, a pad stick direction, or neither. */
export const isPadCode = (code) => typeof code === 'string'
  && chordParts(code).every(p => PAD_INDEX.has(p) || p in PAD_AXES);

/**
 * The codes this action answers to ON A GIVEN DEVICE.
 *
 * "The Codex and every key prompt show pad buttons when a pad is the active
 * device" is one rule and this is it, so it cannot be implemented twice and
 * differently in the Codex, the power wheel, the coach panel, the scoreboard
 * and the free camera's own legend.
 *
 * It never returns nothing: an action with no binding for the active device
 * falls back to the whole list rather than printing a dash. A player on a pad
 * who has cleared every pad code off Force Push still needs to be told what
 * Force Push is on, and the honest answer is the keyboard one they left there.
 */
export function codesFor(bindings, id, device = 'key') {
  const all = (bindings && bindings[id]) || [];
  const want = device === 'pad';
  const hit = all.filter(c => isPadCode(c) === want);
  return hit.length ? hit : all;
}

/** The label for ONE pad code on ONE family of pad. */
export function padLabel(code, family = 'xbox') {
  const f = PAD_FACE[family] ? family : 'xbox';
  return PAD_FACE[f][code] || PAD_SHOULDER[f][code] || PAD_COMMON[code] || code;
}

/** Human-readable name for a key code, for the options screen. */
export function keyLabel(code, family = 'xbox') {
  if (!code) return '—';
  // A chord is its parts, joined the way it is written. The main code goes
  // last, which is the order it is stored in and the order a hand does it in.
  if (isChord(code)) return chordParts(code).map(p => keyLabel(p, family)).join('+');
  if (isPadCode(code)) return padLabel(code, family);
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
  // `chordKey` and not `includes`: the same two buttons in the other order are
  // the same chord. See the note over chordKey.
  const want = chordKey(code);
  for (const id of ACTION_IDS) {
    if (id === exceptId) continue;
    if ((bindings[id] || []).some(k => chordKey(k) === want)) out.push(id);
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
  const want = chordKey(code);
  for (const id of findConflicts(bindings, code, keepId)) {
    const rest = (bindings[id] || []).filter(k => chordKey(k) !== want);
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
      // Keyed by the SET of buttons and reported under the first spelling seen,
      // so a clash between `A+B` and `B+A` is one row naming both actions
      // rather than two rows naming neither. See chordKey.
      const k = chordKey(code);
      if (!byCode.has(k)) byCode.set(k, { code, ids: [] });
      byCode.get(k).ids.push(id);
    }
  }
  const out = [];
  for (const { code, ids } of byCode.values()) if (ids.length > 1) out.push({ code, ids });
  return out;
}
