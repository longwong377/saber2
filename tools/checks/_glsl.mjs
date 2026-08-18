/**
 * BATTLEFRONT BORZ — RUN THE SHIPPED GLSL.
 *
 * There is no GL context in this harness (tools/dom-shim.mjs is a canvas stub),
 * and for years that fact was answered the same way in every visual suite: the
 * shader's arithmetic was TRANSCRIBED INTO JS beside it and the JS was measured.
 * That is HANDOFF §2.4 — an instrument restating a rule — with the worst
 * possible blast radius, because the rule being restated is what the player
 * looks at.
 *
 * It was proven, not suspected. An audit changed the terminator in
 * `saberCelTone` to `smoothstep(0.0, 1.0, dotNL)` — every lit surface in the
 * game a smooth gradient, which is exactly what rule 1 of src/toon/REFERENCE.md
 * forbids — and `cel` reported 24/0, along with character-shading, materials,
 * lighting, appearance, saber-light and terrain-aerial. It widened the blade's
 * core and glow lobes five-fold — the fat white bar the player complained about
 * twice — and 61 checks across ten suites passed. In both cases the JS twin was
 * untouched, so nothing measured anything.
 *
 * A GPU is not needed to fix that. These shaders' hot arithmetic is scalar and
 * short, and an interpreter for the subset they use fits in one file. So:
 * EXTRACT THE SHIPPED GLSL FROM THE SHIPPED SOURCE, template interpolations and
 * all, and EVALUATE IT. A check that calls `glslFn(...)` is measuring the string
 * the compiler is handed; a check that calls its own JS copy is measuring its
 * own opinion.
 *
 * SCOPE, stated so nobody mistakes this for a GL implementation. Floats and
 * vec2/3/4 only, no matrices, no textures, no loops, no structs, no user types.
 * Enough for `src/toon/Cel.js`'s cel functions and `src/game/Saber.js`'s blade
 * fragment, which is what it is for. Anything outside that throws by name
 * rather than guessing — a silent wrong answer here would be the same defect
 * one layer down.
 */

/* ══ 1. Getting the GLSL out of the JS ═════════════════════════════════ */

/**
 * The template literal that follows `marker` in `src`, interpolations resolved
 * against `scope`.
 *
 * The cel GLSL is not a constant: `saberCelTone` reads
 * `${CEL.terminatorMax.toFixed(4)}`, so the string the compiler sees exists
 * only after Cel.js runs. Re-evaluating the SAME template text with the SAME
 * constants object reproduces it exactly, which is the only way to read the
 * shipped numbers rather than a copy of them.
 */
export function templateAfter(src, marker, scope = {}) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`_glsl: no \`${marker}\` in this source — the shader moved or was renamed`);
  const open = src.indexOf('`', at + marker.length);
  if (open < 0) throw new Error(`_glsl: \`${marker}\` is not followed by a template literal`);
  let i = open + 1, depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '$' && src[i + 1] === '{') { depth++; i++; continue; }
    if (depth > 0) { if (c === '{') depth++; else if (c === '}') depth--; continue; }
    if (c === '`') break;
  }
  const raw = src.slice(open + 1, i);
  const keys = Object.keys(scope);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `return \`${raw}\`;`)(...keys.map((k) => scope[k]));
}

/* ══ 2. Preprocessor ═══════════════════════════════════════════════════ */

/** #ifdef/#ifndef/#else/#endif against `defines`; #include and the rest dropped. */
export function preprocess(src, defines = []) {
  const on = new Set(defines);
  const out = [];
  const stack = [];
  const live = () => stack.every(Boolean);
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (t.startsWith('#')) {
      const m = /^#\s*(\w+)\s*(.*)$/.exec(t);
      const [, d, rest] = m || [, '', ''];
      if (d === 'ifdef') stack.push(on.has(rest.trim()));
      else if (d === 'ifndef') stack.push(!on.has(rest.trim()));
      else if (d === 'else') stack[stack.length - 1] = !stack[stack.length - 1];
      else if (d === 'endif') stack.pop();
      continue;                                   // #include, #define, #version
    }
    out.push(live() ? line : '');
  }
  return out.join('\n');
}

/* ══ 3. Tokens ═════════════════════════════════════════════════════════ */

const PUNCT = ['<<=', '>>=', '++', '--', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=',
  '(', ')', '{', '}', '[', ']', ',', ';', '.', '+', '-', '*', '/', '%', '<', '>', '=', '!', '?', ':'];

function tokenize(src) {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const t = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(s.slice(i));
      t.push({ k: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      if (s[i] === 'f' || s[i] === 'F') i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(s.slice(i));
      t.push({ k: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    const p = PUNCT.find((q) => s.startsWith(q, i));
    if (!p) throw new Error(`_glsl: cannot tokenize ${JSON.stringify(s.slice(i, i + 12))}`);
    t.push({ k: 'p', v: p });
    i += p.length;
  }
  t.push({ k: 'eof', v: '' });
  return t;
}

/* ══ 4. Values ═════════════════════════════════════════════════════════ */
/* A float is a number; a vecN is an N-array. Nothing else exists. */

const isVec = Array.isArray;
const width = (v) => (isVec(v) ? v.length : 1);
const at = (v, i) => (isVec(v) ? v[i] : v);

function broadcast(a, b, f) {
  const n = Math.max(width(a), width(b));
  if (isVec(a) && isVec(b) && a.length !== b.length) throw new Error('_glsl: mismatched vector widths');
  if (n === 1) return f(a, b);
  return Array.from({ length: n }, (_, i) => f(at(a, i), at(b, i)));
}
const map1 = (a, f) => (isVec(a) ? a.map(f) : f(a));

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const smoothstep1 = (e0, e1, x) => {
  const t = clamp(e1 === e0 ? (x < e0 ? 0 : 1) : (x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * The constructors and the builtins this subset knows.
 *
 * `fwidth` is the one that cannot be honest: a derivative needs neighbouring
 * fragments and there is one fragment here. It reads `env.__fwidth`, which the
 * caller supplies as the screen-space step it wants the sample taken at — the
 * blade's pixel-width clamp is a real term with a real effect on the profile
 * (it is what keeps a 2 cm blade at 20 m from aliasing away) and dropping it,
 * which is what the JS twin did, silently changes the curve.
 */
const BUILTIN = {
  vec2: (...a) => ctor(2, a), vec3: (...a) => ctor(3, a), vec4: (...a) => ctor(4, a),
  float: (a) => (isVec(a) ? a[0] : a),
  length: (a) => Math.hypot(...(isVec(a) ? a : [a])),
  dot: (a, b) => (isVec(a) ? a.reduce((s, x, i) => s + x * b[i], 0) : a * b),
  normalize: (a) => { const L = Math.hypot(...(isVec(a) ? a : [a])); return map1(a, (x) => x / L); },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  abs: (a) => map1(a, Math.abs), floor: (a) => map1(a, Math.floor), ceil: (a) => map1(a, Math.ceil),
  fract: (a) => map1(a, (x) => x - Math.floor(x)),
  sqrt: (a) => map1(a, Math.sqrt), exp: (a) => map1(a, Math.exp), log: (a) => map1(a, Math.log),
  exp2: (a) => map1(a, (x) => 2 ** x), sin: (a) => map1(a, Math.sin), cos: (a) => map1(a, Math.cos),
  sign: (a) => map1(a, Math.sign),
  pow: (a, b) => broadcast(a, b, (x, y) => x ** y),
  mod: (a, b) => broadcast(a, b, (x, y) => x - y * Math.floor(x / y)),
  min: (a, b) => broadcast(a, b, Math.min), max: (a, b) => broadcast(a, b, Math.max),
  step: (e, x) => broadcast(e, x, (a, b) => (b < a ? 0 : 1)),
  saturate: (a) => map1(a, (x) => clamp(x, 0, 1)),
  clamp: (a, lo, hi) => {
    const n = Math.max(width(a), width(lo), width(hi));
    if (n === 1) return clamp(a, lo, hi);
    return Array.from({ length: n }, (_, i) => clamp(at(a, i), at(lo, i), at(hi, i)));
  },
  mix: (a, b, t) => {
    const n = Math.max(width(a), width(b), width(t));
    const f = (x, y, k) => x + (y - x) * k;
    if (n === 1) return f(a, b, t);
    return Array.from({ length: n }, (_, i) => f(at(a, i), at(b, i), at(t, i)));
  },
  smoothstep: (e0, e1, x) => {
    const n = Math.max(width(e0), width(e1), width(x));
    if (n === 1) return smoothstep1(e0, e1, x);
    return Array.from({ length: n }, (_, i) => smoothstep1(at(e0, i), at(e1, i), at(x, i)));
  },
};

function ctor(n, a) {
  if (a.length === 1 && !isVec(a[0])) return Array(n).fill(a[0]);
  const flat = [];
  for (const x of a) (isVec(x) ? flat.push(...x) : flat.push(x));
  if (flat.length < n) throw new Error(`_glsl: vec${n} built from ${flat.length} components`);
  return flat.slice(0, n);
}

const SWIZ = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3, s: 0, t: 1, p: 2, q: 3 };
function swizzle(v, key) {
  const idx = [...key].map((c) => {
    if (!(c in SWIZ)) throw new Error(`_glsl: not a swizzle: .${key}`);
    return SWIZ[c];
  });
  const src = isVec(v) ? v : [v];
  const out = idx.map((i) => {
    if (src[i] === undefined) throw new Error(`_glsl: .${key} off the end of a vec${src.length}`);
    return src[i];
  });
  return out.length === 1 ? out[0] : out;
}

/* ══ 5. Parser ═════════════════════════════════════════════════════════ */

const TYPES = new Set(['float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'void']);
const QUAL = new Set(['const', 'in', 'out', 'inout', 'uniform', 'varying', 'attribute', 'highp', 'mediump', 'lowp', 'precision', 'flat']);

function parser(tokens) {
  let i = 0;
  const peek = (o = 0) => tokens[i + o];
  const isP = (v, o = 0) => peek(o).k === 'p' && peek(o).v === v;
  const isId = (v, o = 0) => peek(o).k === 'id' && peek(o).v === v;
  const eat = (v) => {
    if (!isP(v) && !isId(v)) throw new Error(`_glsl: expected ${v}, got ${JSON.stringify(peek().v)}`);
    return tokens[i++];
  };

  function primary() {
    const t = peek();
    if (t.k === 'num') { i++; return { t: 'num', v: t.v }; }
    if (t.k === 'p' && t.v === '(') { i++; const e = expr(); eat(')'); return e; }
    if (t.k === 'id') {
      i++;
      if (isP('(')) {
        i++;
        const args = [];
        if (!isP(')')) { args.push(expr()); while (isP(',')) { i++; args.push(expr()); } }
        eat(')');
        return { t: 'call', name: t.v, args };
      }
      if (t.v === 'true' || t.v === 'false') return { t: 'num', v: t.v === 'true' ? 1 : 0 };
      return { t: 'var', name: t.v };
    }
    throw new Error(`_glsl: unexpected ${JSON.stringify(t.v)}`);
  }
  function postfix() {
    let e = primary();
    while (isP('.')) { i++; const f = tokens[i++]; e = { t: 'swiz', on: e, key: f.v }; }
    return e;
  }
  function unary() {
    if (isP('-')) { i++; return { t: 'neg', on: unary() }; }
    if (isP('+')) { i++; return unary(); }
    if (isP('!')) { i++; return { t: 'not', on: unary() }; }
    return postfix();
  }
  const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
  function bin(lv) {
    if (lv >= LEVELS.length) return unary();
    let l = bin(lv + 1);
    for (;;) {
      const t = peek();
      if (t.k !== 'p' || !LEVELS[lv].includes(t.v)) return l;
      i++;
      l = { t: 'bin', op: t.v, l, r: bin(lv + 1) };
    }
  }
  function expr() {
    const c = bin(0);
    if (isP('?')) { i++; const a = expr(); eat(':'); return { t: 'sel', c, a, b: expr() }; }
    return c;
  }

  function block() {
    eat('{');
    const out = [];
    while (!isP('}')) out.push(statement());
    eat('}');
    return { t: 'block', body: out };
  }
  function statement() {
    if (isP('{')) return block();
    if (isId('if')) {
      i++; eat('('); const c = expr(); eat(')');
      const a = statement();
      let b = null;
      if (isId('else')) { i++; b = statement(); }
      return { t: 'if', c, a, b };
    }
    if (isId('return')) { i++; const e = isP(';') ? null : expr(); eat(';'); return { t: 'ret', e }; }
    if (isId('discard')) { i++; eat(';'); return { t: 'discard' }; }
    if (isP(';')) { i++; return { t: 'block', body: [] }; }
    // declaration?
    let j = i;
    while (tokens[j].k === 'id' && QUAL.has(tokens[j].v)) j++;
    if (tokens[j].k === 'id' && TYPES.has(tokens[j].v) && tokens[j + 1].k === 'id') {
      i = j + 1;
      const name = tokens[i++].v;
      let e = null;
      if (isP('=')) { i++; e = expr(); }
      eat(';');
      return { t: 'decl', name, e };
    }
    const target = postfix();
    const op = peek().v;
    if (['=', '+=', '-=', '*=', '/='].includes(op)) {
      i++; const e = expr(); eat(';');
      return { t: 'assign', target, op, e };
    }
    // a bare expression statement (a call, say)
    const e = expr(); eat(';');
    return { t: 'expr', e };
  }

  /** Every top-level function, plus the file-scope variable declarations. */
  function unit() {
    const fns = {};
    const globals = [];
    while (peek().k !== 'eof') {
      let j = i;
      while (tokens[j].k === 'id' && QUAL.has(tokens[j].v)) j++;
      if (!(tokens[j].k === 'id' && TYPES.has(tokens[j].v) && tokens[j + 1].k === 'id')) {
        i++;                                            // something we do not model; skip a token
        continue;
      }
      i = j + 1;
      const name = tokens[i++].v;
      if (isP('(')) {
        i++;
        const params = [];
        while (!isP(')')) {
          while (tokens[i].k === 'id' && QUAL.has(tokens[i].v)) i++;
          if (isP(')')) break;
          if (tokens[i].k === 'id' && TYPES.has(tokens[i].v) && tokens[i + 1].k === 'id') {
            i++; params.push(tokens[i++].v);
          } else i++;
          if (isP(',')) i++;
        }
        eat(')');
        if (isP(';')) { i++; continue; }                 // prototype
        fns[name] = { params, body: block() };
      } else {
        let e = null;
        if (isP('=')) { i++; e = expr(); }
        if (isP(';')) i++;
        globals.push({ name, e });
      }
    }
    return { fns, globals };
  }
  return unit();
}

/* ══ 6. Evaluator ══════════════════════════════════════════════════════ */

const DISCARD = Symbol('discard');
export { DISCARD };

function makeUnit(src, defines) {
  return parser(tokenize(preprocess(src, defines)));
}

/**
 * Compile one GLSL source into a callable set of its functions.
 *
 * `unit.call(name, args, env)` runs a function with `env` laid over the file's
 * globals, so a check can drive `saberCelKey` / `saberCelCast` — which the
 * shader carries as mutable globals rather than parameters — exactly as the
 * light loop does.
 */
export function glslUnit(src, { defines = [], env = {} } = {}) {
  const { fns, globals } = makeUnit(src, defines);
  const base = Object.create(null);
  /* Predeclared so a `gl_FragColor = …` inside a nested block lands somewhere a
   * caller can read rather than in the block's own scope, where it dies. */
  base.gl_FragColor = [0, 0, 0, 0];
  base.gl_FragCoord = [0, 0, 0, 1];
  for (const g of globals) base[g.name] = g.e ? evalExpr(g.e, [base], fns) : 0;
  return {
    fns,
    names: Object.keys(fns),
    globals: base,
    /** The return value, or DISCARD. */
    call(name, args = [], over = {}) {
      return this.run(name, args, over).value;
    },
    /**
     * `{ value, discard, out }` — `out` is the scope the function left behind,
     * which is how a void `main()` is read: its result is `out.gl_FragColor`.
     */
    run(name, args = [], over = {}) {
      const f = fns[name];
      if (!f) throw new Error(`_glsl: no function ${name}() here — have ${Object.keys(fns).join(', ')}`);
      const scope = Object.create(null);
      Object.assign(scope, base, env, over);
      const local = Object.create(null);
      f.params.forEach((p, k) => { local[p] = args[k]; });
      const r = runBlock(f.body, [scope, local], fns);
      return {
        value: r === DISCARD ? DISCARD : (r && r.ret !== undefined ? r.ret : undefined),
        discard: r === DISCARD,
        out: scope,
      };
    },
  };
}

/** One function out of a GLSL source, as a plain JS function. */
export function glslFn(src, name, opts = {}) {
  const u = glslUnit(src, opts);
  const f = (...args) => {
    const over = (args.length > u.fns[name].params.length && typeof args[args.length - 1] === 'object'
      && !Array.isArray(args[args.length - 1])) ? args.pop() : {};
    return u.call(name, args, over);
  };
  f.unit = u;
  return f;
}

function lookup(scopes, name) {
  for (let k = scopes.length - 1; k >= 0; k--) if (name in scopes[k]) return scopes[k][name];
  throw new Error(`_glsl: ${name} is not defined — give it to the caller's env`);
}
function store(scopes, name, v) {
  for (let k = scopes.length - 1; k >= 0; k--) if (name in scopes[k]) { scopes[k][name] = v; return; }
  scopes[scopes.length - 1][name] = v;
}

function evalExpr(n, scopes, fns) {
  switch (n.t) {
    case 'num': return n.v;
    case 'var': return lookup(scopes, n.name);
    case 'neg': return map1(evalExpr(n.on, scopes, fns), (x) => -x);
    case 'not': return evalExpr(n.on, scopes, fns) ? 0 : 1;
    case 'swiz': return swizzle(evalExpr(n.on, scopes, fns), n.key);
    case 'sel': return evalExpr(n.c, scopes, fns) ? evalExpr(n.a, scopes, fns) : evalExpr(n.b, scopes, fns);
    case 'call': {
      const args = n.args.map((a) => evalExpr(a, scopes, fns));
      if (fns[n.name]) {
        const local = Object.create(null);
        fns[n.name].params.forEach((p, k) => { local[p] = args[k]; });
        const r = runBlock(fns[n.name].body, [scopes[0], local], fns);
        return r === DISCARD ? DISCARD : (r ? r.ret : undefined);
      }
      /* fwidth is the one builtin that cannot be honest — a derivative needs
       * neighbouring fragments and there is one fragment here. The caller
       * supplies the screen-space step it wants the sample taken at. */
      if (n.name === 'fwidth' || n.name === 'dFdx' || n.name === 'dFdy') return lookup(scopes, '__fwidth');
      if (BUILTIN[n.name]) return BUILTIN[n.name](...args);
      throw new Error(`_glsl: no builtin ${n.name}() — add it or the check is measuring nothing`);
    }
    case 'bin': {
      const a = evalExpr(n.l, scopes, fns);
      if (n.op === '&&') return a && evalExpr(n.r, scopes, fns) ? 1 : 0;
      if (n.op === '||') return a || evalExpr(n.r, scopes, fns) ? 1 : 0;
      const b = evalExpr(n.r, scopes, fns);
      switch (n.op) {
        case '+': return broadcast(a, b, (x, y) => x + y);
        case '-': return broadcast(a, b, (x, y) => x - y);
        case '*': return broadcast(a, b, (x, y) => x * y);
        case '/': return broadcast(a, b, (x, y) => x / y);
        case '%': return broadcast(a, b, (x, y) => x % y);
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return String(a) === String(b) ? 1 : 0;
        case '!=': return String(a) !== String(b) ? 1 : 0;
        default: throw new Error(`_glsl: operator ${n.op}`);
      }
    }
    default: throw new Error(`_glsl: expression node ${n.t}`);
  }
}

/** Returns undefined (fell through), {ret} or DISCARD. */
function runBlock(n, scopes, fns) {
  const local = Object.create(null);
  const st = [...scopes, local];
  for (const s of n.body) {
    const r = runStmt(s, st, fns);
    if (r !== undefined) return r;
  }
  return undefined;
}

function runStmt(n, scopes, fns) {
  switch (n.t) {
    case 'block': return runBlock(n, scopes, fns);
    case 'decl': scopes[scopes.length - 1][n.name] = n.e ? evalExpr(n.e, scopes, fns) : 0; return undefined;
    case 'assign': {
      let v = evalExpr(n.e, scopes, fns);
      if (n.target.t === 'var') {
        if (n.op !== '=') {
          const cur = lookup(scopes, n.target.name);
          v = broadcast(cur, v, ({ '+=': (x, y) => x + y, '-=': (x, y) => x - y, '*=': (x, y) => x * y, '/=': (x, y) => x / y })[n.op]);
        }
        store(scopes, n.target.name, v);
        return undefined;
      }
      if (n.target.t === 'swiz') {                       // v.x = …, c.rgb *= …
        const base = n.target.on;
        if (base.t !== 'var') throw new Error('_glsl: only a named vector can be written through a swizzle');
        const cur = lookup(scopes, base.name);
        const out = isVec(cur) ? cur.slice() : cur;
        [...n.target.key].forEach((c, k) => {
          const idx = SWIZ[c];
          const nv = n.op === '=' ? at(v, k)
            : ({ '+=': (x, y) => x + y, '-=': (x, y) => x - y, '*=': (x, y) => x * y, '/=': (x, y) => x / y })[n.op](out[idx], at(v, k));
          out[idx] = nv;
        });
        store(scopes, base.name, out);
        return undefined;
      }
      throw new Error('_glsl: unsupported assignment target');
    }
    case 'if': return evalExpr(n.c, scopes, fns) ? runStmt(n.a, scopes, fns) : (n.b ? runStmt(n.b, scopes, fns) : undefined);
    case 'ret': return { ret: n.e ? evalExpr(n.e, scopes, fns) : undefined };
    case 'discard': return DISCARD;
    case 'expr': evalExpr(n.e, scopes, fns); return undefined;
    default: throw new Error(`_glsl: statement ${n.t}`);
  }
}
