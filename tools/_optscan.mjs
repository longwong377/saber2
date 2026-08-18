/**
 * WHAT A CALL SITE HANDS A BUILDER, read off the source.
 *
 * The other half of `Props.assertOpts`. The runtime guard knows what a builder
 * READS (derived from the builder's own source, so it cannot drift from it);
 * this reads what a call site PASSES, so the two can be held against each
 * other by `tools/checks/builder-options.mjs` without either of them being a
 * list somebody maintains.
 *
 * It is a brace scanner, not a parser — there is no parser in this tree and
 * this file is not the place to grow one. What it therefore CANNOT see is
 * stated rather than hidden, because a scanner that quietly skips half the
 * call sites is worth less than none:
 *
 *   · a call whose options are a variable (`addRock(world, p, o)`) — no keys
 *     to read, so the site is not reported at all;
 *   · an object built by spreading (`{ ...base, seed }`) — reported with
 *     `spread: true` and skipped by the check, since the missing half could
 *     legitimately carry any key;
 *   · a maker reached through an alias or a computed member.
 *
 * The runtime guard covers all three: it sees the object the builder was
 * actually handed. This exists to catch the ones no level ever runs — a
 * dressing pass with no caller, a branch behind a difficulty — which is where
 * the four `addCrateStack({ count })` sites would still be hiding if only one
 * of them had been on a level somebody dressed.
 */

/** Advance past whitespace and comments from `i`. */
function skipTrivia(s, i) {
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (s[i] === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2); i = i < 0 ? s.length : i + 2; continue; }
    return i;
  }
}

/** Advance past a string or template literal starting at `i`. */
function skipString(s, i) {
  const q = s[i++];
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === q) return i + 1;
    // a template's ${ … } can hold anything, including more strings
    if (q === '`' && s[i] === '$' && s[i + 1] === '{') {
      i = skipBalanced(s, i + 1);
      continue;
    }
    i++;
  }
  return i;
}

/** Given `i` at an opening bracket, return the index just past its match. */
function skipBalanced(s, i) {
  const open = '([{', close = ')]}';
  const stack = [close[open.indexOf(s[i])]];
  i++;
  while (i < s.length && stack.length) {
    const c = s[i];
    if (c === '"' || c === '\'' || c === '`') { i = skipString(s, i); continue; }
    if (c === '/' && (s[i + 1] === '/' || s[i + 1] === '*')) { i = skipTrivia(s, i); continue; }
    if (open.includes(c)) { stack.push(close[open.indexOf(c)]); i++; continue; }
    if (c === stack[stack.length - 1]) { stack.pop(); i++; continue; }
    i++;
  }
  return i;
}

/**
 * The top-level keys of the object literal whose `{` is at `start`.
 * Returns { keys, spread, end }.
 */
export function objectKeysAt(s, start) {
  const keys = [];
  let spread = false;
  let i = start + 1;
  let atKey = true;
  for (;;) {
    i = skipTrivia(s, i);
    if (i >= s.length) break;
    const c = s[i];
    if (c === '}') { i++; break; }
    if (atKey) {
      if (s.startsWith('...', i)) { spread = true; atKey = false; i += 3; continue; }
      let name = null;
      if (c === '"' || c === '\'') { const j = skipString(s, i); name = s.slice(i + 1, j - 1); i = j; }
      else if (c === '[') { i = skipBalanced(s, i); }               // computed — unreadable
      else {
        const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
        if (m) { name = m[0]; i += m[0].length; }
        else i++;
      }
      // `get x()`, `async x()` and `set x()` name a method, not the key
      if (name === 'get' || name === 'set' || name === 'async') {
        const j = skipTrivia(s, i);
        if (/^[A-Za-z_$]/.test(s[j] || '')) continue;
      }
      if (name !== null) keys.push(name);
      atKey = false;
      continue;
    }
    if (c === '"' || c === '\'' || c === '`') { i = skipString(s, i); continue; }
    if (c === '(' || c === '[' || c === '{') { i = skipBalanced(s, i); continue; }
    if (c === ',') { atKey = true; i++; continue; }
    i++;
  }
  return { keys, spread, end: i };
}

/**
 * Every call to one of `names` in `src` whose arguments include an object
 * literal, as { name, at, keys, spread, argIndex }. Only the LAST literal
 * argument is read: every builder in Props.js takes its options last, and a
 * literal earlier in the list is a different kind of thing (an openings list,
 * a size).
 */
/**
 * Blank out comments and string bodies, keeping every character position, so
 * the scan below cannot match a call written in prose. This file's own header
 * names four builders and the options they were wrongly handed, and without
 * this it reported them as live defects — an instrument finding its own
 * documentation, which is HANDOFF §2.4 in miniature.
 */
function blankNonCode(src) {
  const out = src.split('');
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
      continue;
    }
    if (c === '"' || c === '\'' || c === '`') {
      const end = skipString(src, i);
      for (let j = i + 1; j < end - 1; j++) if (src[j] !== '\n') out[j] = ' ';
      i = end;
      continue;
    }
    i++;
  }
  return out.join('');
}

export function callSites(source, names) {
  const src = blankNonCode(source);
  const out = [];
  const re = /(?:^|[^\w$.])((?:[A-Za-z_$][\w$]*\.)?)([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[2];
    if (!names.has(name)) continue;
    // the definition itself, not a call
    const before = src.slice(Math.max(0, m.index - 20), m.index + m[0].length - m[2].length - 1);
    if (/\bfunction\s*$/.test(before)) continue;
    const open = m.index + m[0].length - 1;
    let i = open + 1, last = null, arg = 0;
    for (;;) {
      i = skipTrivia(src, i);
      if (i >= src.length) break;
      const c = src[i];
      if (c === ')') break;
      if (c === '"' || c === '\'' || c === '`') { i = skipString(src, i); continue; }
      if (c === '{') { const o = objectKeysAt(src, i); last = { ...o, argIndex: arg }; i = o.end; continue; }
      if (c === '(' || c === '[') { i = skipBalanced(src, i); continue; }
      if (c === ',') { arg++; i++; continue; }
      i++;
    }
    if (last) out.push({ name, at: open, keys: last.keys, spread: last.spread, argIndex: last.argIndex });
    re.lastIndex = open + 1;
  }
  return out;
}
