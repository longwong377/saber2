/**
 * BATTLEFRONT BORZ — reading a function out of a file, without guessing how long it is.
 *
 * THE DEFECT THIS FILE EXISTS FOR, caught by running the whole suite on a tree
 * with nothing else moving in it:
 *
 *   ✗ living force: a communion crosses the wire and lands on the receiver
 *       World.spawnPlayer does not install the bond receiver
 *   ✗ run: a landing carries the run across loadLevel, which disposes players
 *       the run's boons are not re-applied to the new player
 *
 * Both were false. `World.spawnPlayer` runs from line 481 to line 569 and every
 * line the two checks demand is inside it — `applyOrder` at 516, `applyBoon` at
 * 533, `hpFrac` at 535, `bondReceive` and `bondGuardIn` at 553. What had
 * happened is that both checks read the function like this:
 *
 *     const body = world.slice(world.indexOf('  spawnPlayer('), … + 2600);
 *
 * and `spawnPlayer` had grown past 2600 characters. The window was written when
 * the function was shorter, was never a property of anything, and expired
 * silently the day somebody added a line — reporting the growth of the function
 * as the absence of its contents.
 *
 * NINETEEN of these were in the suite when this file was written, across nine
 * files, with windows from 140 to 3600 characters. Two were red. The other
 * seventeen are not safe, they are merely not expired yet, and a window can
 * fail the OTHER way too: overshoot into the next method and the check passes
 * on a line that belongs to a different function entirely, which is worse
 * because nobody investigates a green check.
 *
 * This is the eighth and ninth time this codebase has been bitten by a
 * hand-written number standing in for something the machine could compute — a
 * HUD price list, an announcer voice map, a sandbox roster, a level card's unit
 * count, a garment length, a wire record, a wave-boundary rule, and now twice
 * over the length of a function. The fix has the same shape every time: the
 * hand-written thing stops being the authority.
 *
 * WHAT THIS DOES INSTEAD is count braces. It is not a parser and does not need
 * to be: it needs to find the end of a method in a file this repo controls,
 * written in a style this repo controls, and it refuses rather than guesses
 * when it cannot — which is the whole point, since a guess is what broke.
 */

/**
 * The body of `name` as it is actually written, from its signature to its
 * matching close brace.
 *
 * `src`    the file's text
 * `sig`    the signature as it appears, e.g. `'  spawnPlayer('` or
 *          `'function pickTarget('`. The leading indent matters and is how a
 *          method is told from a call to it.
 *
 * Throws if the signature is absent or the braces do not close, because both
 * mean the check cannot answer its question and MUST NOT answer it anyway.
 * That is the defect above stated as a rule: a missing thing gets an error, not
 * a plausible default.
 */
export function functionBody(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error(`${JSON.stringify(sig)} is not in this file — it was renamed or removed`);

  /**
   * FINDING THE BRACE THAT OPENS THE BODY, which is not simply the first one.
   * `loadLevel(key, opts = {})` opens and closes a brace in its own parameter
   * list, and taking that one returns twenty-six characters of signature —
   * which is the same class of wrong as the window it replaces, so it is worth
   * being exact about.
   *
   * A body brace is preceded by `)` or `=>`, ignoring whitespace. That covers
   * every shape this repo asks for: methods, `function` declarations, arrow
   * callbacks passed as arguments (`net.on('x', (m) => {`), and destructured
   * parameters (`({ a, b }) => {`, whose pattern brace follows `(` and is
   * therefore not a candidate).
   *
   * The one remaining ambiguity is a default that is itself an arrow —
   * `f(cb = () => {})` — which is locally indistinguishable from a callback
   * body, because both sit at the same paren depth behind the same `=>`. It is
   * separated on the one property that always differs: such a default is
   * EMPTY, and a body a check wants to read never is. Note what happens if that
   * is ever wrong — the body comes back as `{}` and every assertion against it
   * fails loudly. The failure mode of the window this replaces was the
   * opposite, and much worse: overshoot the end of the function and the check
   * passes on a line belonging to something else.
   */
  for (let i = at + 1; i < src.length; i++) {
    const c = src[i];
    if (c !== '{') { i = skipNonCode(src, i); continue; }
    let p = i - 1;
    while (p > at && /\s/.test(src[p])) p--;
    const opener = src[p] === ')' || (src[p] === '>' && src[p - 1] === '=');
    if (!opener) continue;
    const close = matchBrace(src, i);
    if (close < 0) break;
    if (!src.slice(i + 1, close).trim()) { i = close; continue; }    // `() => {}`, a default
    return src.slice(at, close + 1);
  }
  throw new Error(`${JSON.stringify(sig)} has no body that closes — the brace counter is wrong or the file is`);
}

/**
 * The index of the `}` matching the `{` at `open`, counting only braces that
 * are code — not the ones inside strings, template literals or comments. All
 * three appear in this codebase's method bodies, and `${…}` in a template both
 * appears constantly and nests.
 */
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; if (depth === 0) return i; continue; }
    i = skipNonCode(src, i);
  }
  return -1;
}

/**
 * If `i` starts a comment, string or template, the index of its last character;
 * otherwise `i` unchanged. Written to be used as `i = skipNonCode(src, i)`
 * inside a `for` that increments.
 */
function skipNonCode(src, i) {
  const c = src[i];
  const n = src[i + 1];
  if (c === '/' && n === '/') { const e = src.indexOf('\n', i); return e < 0 ? src.length : e; }
  if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); return e < 0 ? src.length : e + 1; }
  if (c === '"' || c === "'") return endOfString(src, i, c);
  if (c === '`') return endOfTemplate(src, i);
  return i;
}

/** Index of the closing quote of the string starting at `i`. */
function endOfString(src, i, q) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q || src[j] === '\n') return j;   // an unterminated line ends it
  }
  return src.length;
}

/**
 * Index of the closing backtick, stepping over `${…}` — which may contain
 * another template, and does in several places in this repo.
 */
function endOfTemplate(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '`') return j;
    if (src[j] === '$' && src[j + 1] === '{') {
      let d = 1;
      j += 2;
      for (; j < src.length && d > 0; j++) {
        if (src[j] === '\\') { j++; continue; }
        if (src[j] === '`') { j = endOfTemplate(src, j); continue; }
        if (src[j] === '"' || src[j] === "'") { j = endOfString(src, j, src[j]); continue; }
        if (src[j] === '{') d++;
        else if (src[j] === '}') d--;
      }
      j--;
    }
  }
  return src.length;
}

/**
 * The `n` lines of a file starting at the line `sig` is on — for the cases that
 * genuinely want a neighbourhood rather than a function: a single statement, or
 * the couple of lines around a call. Still not a character count: lines are a
 * unit the reader can see, so `head(src, 'x', 3)` says what it means and a
 * comment added above the line does not silently push the target out.
 */
export function lines(src, sig, n) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error(`${JSON.stringify(sig)} is not in this file`);
  const start = src.lastIndexOf('\n', at) + 1;
  let end = start;
  for (let k = 0; k < n; k++) {
    const nl = src.indexOf('\n', end);
    if (nl < 0) return src.slice(start);
    end = nl + 1;
  }
  return src.slice(start, end);
}
