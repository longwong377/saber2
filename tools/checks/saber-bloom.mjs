/**
 * THE BLADE WAS A FAT WHITE BAR IN A WHITE FLURRY, AND A BLUE RING WAS GLUED
 * TO IT IN THIRD PERSON.
 *
 * Two reports, one file, because they are the two halves of "I cannot see the
 * game through the weapon" and both are measured on the same frame.
 *
 * ── 1. THE RING ─────────────────────────────────────────────────────────
 *
 * `#blade-cursor` answers one question — where is the BLADE pointing, as
 * distinct from where am I looking — and that question only exists when the
 * blade is off screen. HUD.update drove it in both views: it positioned the
 * ring at `control.screenGuard(...)`, which projects the guard point at the
 * BASE OF THE BLADE, so in third person the ring landed on the blade itself,
 * every frame, and read as a second reticle stuck to the weapon. Screenshotted
 * on the White Pass exactly like that.
 *
 * The fix is one branch, so the check is behavioural rather than textual: the
 * HUD is driven with a stub world in each view and asked what it did to the
 * node. In third person it must not have touched the transform at all — an
 * element the HUD stops MOVING but goes on drawing is the same bug one frame
 * later — and the centre reticle, which is the AIM and a different instrument,
 * must still be driven in both views.
 *
 * ── 2. THE FLURRY ───────────────────────────────────────────────────────
 *
 * Measured headless on the real game, first person, White Pass, one frozen
 * frame, reading the LINEAR buffer the bloom pass thresholds and then the
 * bytes that reach the screen:
 *
 *     snow, p50 0.240 / p90 0.389 linear     4.6x UNDER the 1.8 threshold
 *     ground pixels over the threshold        0.004 %
 *     frame with the blade HIDDEN, over it    0.003 %, max 2.41
 *     frame as shipped                        1.32 %, max 19.9
 *
 * So the snow is not a bloom source and never was. Raising the threshold — the
 * obvious move for "the bright level blooms too much" — buys nothing there and
 * costs the halo its colour, because the blade's own glow lobe is the thing
 * sitting just over the line (tools/checks/saber-light.mjs pins exactly that).
 * The blade is the entire source; the snow is what RECEIVES, and it receives
 * badly because bloom is added to the linear buffer before the tone curve, so
 * the halo spends whatever headroom the pixel had left and a high-albedo
 * surface has none. In display luminance on the same frame, bloom off vs on:
 *
 *     blown past 0.97          1.9 % -> 8.0 %      widest blown run 24 -> 77 px
 *     past 0.90               14.0 % -> 23.4 %     ground darkest tenth 0.128 -> 0.346
 *
 * versus 1.3 % -> 2.9 % and 17 -> 33 px for the same blade on the dune sea.
 *
 * Two things were therefore changed and both are pinned below. The emission
 * profile was PINCHED — sigma, not amplitude, because the blown radius only
 * goes as sqrt(ln amp) while it goes linearly with sigma, and because the core
 * amplitude is what keeps the core the majority of the flux. And the bloom
 * strength was trimmed across every level, with the levels that had never
 * authored one stopped from silently drawing the hottest setting in the build.
 *
 * WHAT PROVES IT IS GONE. Every bound below is a TIGHTENING of a bound that
 * already existed in tools/checks/vfx.mjs or tools/checks/order.mjs — white
 * core radius, coloured-to-white ratio, the width of the band the bloom pass
 * can see — re-derived on the new profile and re-stated against the stronger
 * side, never the weaker. Each one is shown to have teeth by re-running the
 * same arithmetic on the profile that shipped.
 */

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { templateAfter, glslUnit } from './_glsl.mjs';
import { Saber, SABER_COLORS } from '../../src/game/Saber.js';
import { ORDERS } from '../../src/game/Order.js';
import { LEVELS } from '../../src/game/Levels.js';
import { HUD } from '../../src/ui/HUD.js';

const ENGINE_SRC = new URL('../../src/engine/Engine.js', import.meta.url);

/** The profile as it shipped before this round, so every bound can be shown to bite. */
const SHIPPED = { width: [0.0110, 0.0330, 0.105], amp: [58.0, 6.50, 1.50], radius: 0.36 };

/* ── BLADE_FRAG's radial profile — THE SHIPPED GLSL, RUN ─────────────────
 *
 * This was a JS transcription of the blade fragment, and it was not a faithful
 * one: it read the uniforms and then rewrote the three-lobe sum, dropping the
 * shader's width modulation (`w`), its sub-pixel width clamp (`keep`), its
 * amplitude term (flicker × instability × the tip lift), the ignition surge,
 * the discard, and — the one that mattered most here — the core's
 * neutralisation toward its own luminance (`uCoreWhite`), which is the entire
 * mechanism by which the core reads WHITE and is therefore the thing every
 * white-core bound below is about.
 *
 * An audit widened the shader's core and glow lobes about five-fold
 * (`exp(-dd.x*dd.x)` → `exp(-dd.x*dd.x*0.04)`), which is the fat white bar the
 * player reported twice, and 61 checks across saber-bloom, saber-light, vfx,
 * order, spectacle, first-person, held, throw-view, grip and hilts passed. Not
 * one of them looked at the shader.
 *
 * So `_glsl.mjs` interprets BLADE_FRAG itself, driven off a real Saber's real
 * uniforms. Where the sample is taken is stated rather than assumed:
 *
 *   ALONG   the blade's midpoint, t = 0.5, where the plasma's width modulation
 *           is exactly 1.0 (the emitter flare has decayed by e^-13 and the tip
 *           narrowing has not started) — so this is the blade's nominal width,
 *           not its widest or its narrowest.
 *   FLICKER `uFlicker` is `flick · punch` in Saber.update; at rest that is
 *           `punch`, which is exactly what the old twin multiplied by.
 *   PIXEL   `fwidth(vP.x)` is a derivative and there is one fragment here, so
 *           the caller states it: 1e-9 m is a blade filling the screen, where
 *           the sub-pixel clamp is inactive and the profile is the authored
 *           one. The clamp is measured separately, on its own, below.
 */
const SABER_SRC = new URL('../../src/game/Saber.js', import.meta.url);
const FRAG = glslUnit(templateAfter(readFileSync(SABER_SRC, 'utf8'), 'const BLADE_FRAG ='));

/** The colour BLADE_FRAG writes, d metres across the blade. [] where it discards. */
function fragRGB(s, d, { t = 0.5, time = 0, px = 1e-9, len = 1.0 } = {}) {
  const u = s.bladeMat.uniforms;
  const r = FRAG.run('main', [], {
    uHue: [s.hue.r, s.hue.g, s.hue.b],
    uWidth: u.uWidth.value.toArray(),
    uAmp: u.uAmp.value.toArray(),
    uRadius: u.uRadius.value,
    uFlicker: s.punch,
    uTime: time,
    uSurge: u.uSurge.value,
    uCoreWhite: u.uCoreWhite.value,
    uUnstable: u.uUnstable.value,
    vP: [d, t * len], vLen: len,
    __fwidth: px,
  });
  return r.discard ? [0, 0, 0] : r.out.gl_FragColor.slice(0, 3);
}
const emissionRGB = (s, d) => fragRGB(s, d);

const lum = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const chroma = (r, g, b) => {
  const M = Math.max(r, g, b), m = Math.min(r, g, b);
  return M < 1e-6 ? 0 : (M - m) / M;
};
/** three's ACESFilmicToneMapping, at the probe exposure vfx.mjs quotes on. */
function aces(rgb, exposure = 0.9) {
  const mul = (m, v) => [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
  const IN = [0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
  const OUT = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
  let v = rgb.map((c) => c * exposure / 0.6);
  v = mul(IN, v);
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081));
  return mul(OUT, v).map((x) => Math.min(1, Math.max(0, x)));
}

/**
 * White core radius, coloured-halo radius and over-the-bloom-line radius for
 * one built blade, on the same definitions vfx.mjs uses: "white" is where the
 * crystal's own chroma has been beaten down past three quarters of it by the
 * tone curve, "coloured" is where three quarters of it still survives, and
 * "over" is where the LINEAR luminance — what the pass actually thresholds —
 * is still above the line.
 */
function bands(s, threshold) {
  const own = chroma(s.hue.r, s.hue.g, s.hue.b);
  let white = 0, coloured = 0, over = 0;
  for (let d = 0; d < 0.30; d += 0.0002) {
    if (own > 0.15) {
      const L = lum(...aces(emissionRGB(s, d)));
      const kept = chroma(...aces(emissionRGB(s, d))) / own;
      if (kept < 0.25 && L > 0.05) white = d;
      if (kept > 0.75 && L > 0.05) coloured = d;
    }
    if (lum(...emissionRGB(s, d)) > threshold) over = d;
  }
  return { own, white, coloured, over };
}

/* ── a DOM the HUD can actually be driven through ─────────────────────────
 * tools/dom-shim.mjs gives every element a no-op classList and a querySelector
 * that answers null, which is fine for the texture foundry and useless here:
 * the question IS what is on the class list. So this is a second, smaller
 * shim, live only for the length of one check.
 */
function node(tag = 'div') {
  const classes = new Set();
  const n = {
    tagName: tag, style: {}, dataset: {}, children: [], parentElement: null,
    textContent: '', innerHTML: '', classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        const want = on === undefined ? !classes.has(c) : !!on;
        if (want) classes.add(c); else classes.delete(c);
        return want;
      },
    },
    appendChild(c) { n.children.push(c); c.parentElement = n; return c; },
    removeChild(c) { const i = n.children.indexOf(c); if (i >= 0) n.children.splice(i, 1); },
    // every selector answers a real element, because the HUD only ever asks
    // for children it just wrote
    querySelector() { return n._q || (n._q = node('i')); },
    querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    get firstElementChild() { return n.children[0] || (n.children[0] = node('i')); },
    get firstChild() { return n.children[0] || null; },
    get previousSibling() { return null; },
  };
  return n;
}

export function run({ check, assert, near, THREE }) {
  const scene = new THREE.Scene();
  const blade = (o) => new Saber(scene, o);

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  1. THE RING IS A FIRST-PERSON INSTRUMENT                              */
  /* ══════════════════════════════════════════════════════════════════════ */

  check('hud: the blade cursor is gone in third person, and the reticle is not', () => {
    const nodes = new Map();
    const root = {
      getElementById: (id) => {
        if (!nodes.has(id)) nodes.set(id, node('div'));
        return nodes.get(id);
      },
      querySelector: (sel) => root.getElementById(sel),
    };
    // the three bars read `.parentElement`, which in the page is the track
    for (const id of ['bar-hp', 'bar-force', 'bar-stam']) node('div').appendChild(root.getElementById(id));

    // _buildPowers goes through the global document, which the big shim owns
    const realDoc = globalThis.document;
    globalThis.document = { createElement: (t) => node(t), createElementNS: (_n, t) => node(t) };
    let hud;
    try { hud = new HUD(root); } finally { globalThis.document = realDoc; }

    const cursor = root.getElementById('blade-cursor');
    const reticle = root.getElementById('reticle');
    assert(cursor && reticle, 'the HUD no longer looks up #blade-cursor and #reticle by those ids');

    let guardCalls = 0;
    const player = {
      hp: 100, maxHp: 100, force: 50, maxForce: 100, stamina: 50, maxStamina: 100,
      flow: 0.4, combo: 1, score: 0, senseActive: false, throwState: 'held',
      gripBody: null, gripEnemy: null, lockState: null,
      cooldowns: { push: 0, pull: 0, throw: 0 },
      position: new THREE.Vector3(), chest: new THREE.Vector3(0, 1.4, 0),
      saber: { tipSpeed: 12 },
      camera: { firstPerson: false, aimQuat: new THREE.Quaternion() },
      control: {
        _grip: { guardR: 0.6 }, steering: 1,
        screenGuard: (camera, chest, quat, out) => { guardCalls++; return out.set(0.31, 0.17); },
      },
    };
    const world = {
      score: 0, enemies: [], training: false, focus: null,
      director: { wave: 1, remaining: 3, active: true, intermission: 0 },
    };
    const camera = new THREE.PerspectiveCamera();

    const drive = (firstPerson) => {
      player.camera.firstPerson = firstPerson;
      cursor.style.transform = 'SENTINEL';
      reticle.style.opacity = 'SENTINEL';
      const was = guardCalls;
      hud.update(1 / 60, world, player, camera);
      return { moved: cursor.style.transform !== 'SENTINEL', projected: guardCalls > was,
        hidden: cursor.classList.contains('hidden'),
        steering: cursor.classList.contains('steering'),
        reticleDriven: reticle.style.opacity !== 'SENTINEL' };
    };

    const third = drive(false);
    const first = drive(true);

    /* The ring is OFF in third person, and off in the only way that stays off:
     * hidden AND not driven. Leaving it positioned-but-transparent is how it
     * comes back — the opacity is written out of the grip branch, so the first
     * frame the player takes hold of the blade would put it on screen again. */
    assert(third.hidden,
      'in third person the blade cursor is still on screen — it is drawn at the projected guard '
      + 'point, which is the base of the blade, so it lands ON the blade');
    assert(!third.moved,
      'in third person the HUD still writes the blade cursor transform every frame; the node is '
      + 'hidden by a class today and one CSS edit away from being a ring on the blade again');
    assert(!third.projected,
      'in third person the HUD still calls control.screenGuard() to place a cursor it does not draw');
    assert(!third.steering,
      'in third person the blade cursor is still being given the "steering" state, which is the '
      + 'lit version of the same ring');

    // …and it is untouched where it is the only answer to the question
    assert(!first.hidden, 'the blade cursor is hidden in FIRST person too — the fix removed the feature');
    assert(first.moved && first.projected,
      'in first person the blade cursor is no longer being positioned, so it does not track the blade');
    assert(first.steering, 'in first person the blade cursor lost its steering state');

    // the AIM reticle is a different instrument and is drawn in both views
    assert(third.reticleDriven && first.reticleDriven,
      'the centre reticle stopped being driven — that is the aiming reticle, not the blade cursor');
    return 'third person: hidden, not positioned, screenGuard not called; '
      + 'first person: positioned and steering; centre reticle driven in both';
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  2. A THIN CORE IN A COLOURED HALO — AS NUMBERS                        */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * Every bound in this section is one of vfx.mjs's or order.mjs's, tightened.
   * They are stated as a pair — the bound, and the same arithmetic on the
   * profile that shipped — so a bound that has stopped biting says so instead
   * of going quietly green.
   */
  const measure = (P) => {
    const was = Saber.PROFILE;
    Saber.PROFILE = P;
    const out = { white: 0, ratio: Infinity, over: 0, coloured: Infinity, rows: [] };
    try {
      // the untuned blade, every crystal, at the shipped width and at full
      for (const cw of [0.7, 1.0]) {
        for (let i = 0; i < SABER_COLORS.length; i++) {
          const s = blade({ colorIndex: i, coreWidth: cw });
          const b = bands(s, 1.8);
          out.over = Math.max(out.over, b.over);
          if (b.own > 0.15) {
            out.white = Math.max(out.white, b.white);
            out.ratio = Math.min(out.ratio, b.coloured / b.white);
            if (cw === 1) out.coloured = Math.min(out.coloured, b.coloured);
          }
          if (cw === 1 && i < 5) out.rows.push(`${SABER_COLORS[i].name} ${(b.white * 1000).toFixed(1)}/${(b.coloured * 1000) | 0}mm`);
          s.dispose();
        }
      }
      // and every ORDER's blade, which re-weights all three lobes
      for (const o of ORDERS) {
        for (const idx of o.crystals) {
          for (const cw of [0.7, 1.0]) {
            for (const temper of (o.id === 'grey' ? [0, 1] : [0])) {
              const s = blade({ colorIndex: idx, coreWidth: cw, order: o.id });
              if (temper) { s.temper = 1; s._retune(); }
              const b = bands(s, 1.8);
              out.over = Math.max(out.over, b.over);
              if (b.own > 0.15) {
                out.white = Math.max(out.white, b.white);
                out.ratio = Math.min(out.ratio, b.coloured / b.white);
              }
              s.dispose();
            }
          }
        }
      }
    } finally { Saber.PROFILE = was; }
    const flux = P.amp.map((a, i) => a * P.width[i]);
    out.flux = flux.reduce((a, b) => a + b, 0);
    out.share = flux[0] / out.flux;
    return out;
  };

  const now = measure(Saber.PROFILE);
  const then = measure(SHIPPED);

  check('blade: the white core is a core, not a bar', () => {
    /* vfx.mjs allows a white core out to 42 mm of radius, which was the right
     * ceiling when the fault was a 3 mm hairline and the profile was being
     * pushed the other way. The shipped profile then went and used 37 mm of it
     * on Cyanite and 36.8 on Verdant — an 75 mm blown bar on a weapon whose
     * prop is 40 mm of glass, and the player's "covers way too much of the
     * screen", twice.
     *
     * 24 mm is the same bound re-derived on the pinched profile. Measured
     * through the shipped BLADE_FRAG rather than through the twin that dropped
     * its core neutralisation, the widest white core in the game is 20.8 mm
     * against the shipped profile's 37.0 mm, so this is that number plus a
     * seventh. It only ever moves DOWN. */
    assert(now.white <= 0.024,
      `the widest white core in the game is ${(now.white * 1000).toFixed(1)} mm of radius — `
      + 'a blown bar wider than the emitter, which is the "fat white bar" report');
    assert(then.white > 0.024,
      `the profile that shipped now passes this bound (${(then.white * 1000).toFixed(1)} mm), so it `
      + 'has stopped proving the blade was thinned at all');
    // and the thinning may not have been bought by dimming the core: the flux
    // share is what makes CORE_WHITE the right lever (see saber-light.mjs) and
    // it is not for sale.
    assert(now.share >= 0.63,
      `the core is down to ${(now.share * 100).toFixed(1)}% of the blade's flux (it was `
      + `${(then.share * 100).toFixed(1)}%) — a thinner blade may not be bought with the core's share`);
    return `widest white core ${(now.white * 1000).toFixed(1)} mm (was ${(then.white * 1000).toFixed(1)}), `
      + `core ${(now.share * 100).toFixed(1)}% of flux (was ${(then.share * 100).toFixed(1)}%); `
      + now.rows.join(', ');
  });

  check('blade: the halo is most of the blade, by a wider margin than before', () => {
    /* The design statement, and the one that has to get STRONGER when the
     * blade gets thinner or the thinning was just a dimmer blade. vfx.mjs asks
     * for 5x more coloured blade than white blade and order.mjs for 4x on a
     * re-tuned one.
     *
     * RE-DERIVED ON THE SHIPPED SHADER, and the number moved a long way. This
     * used to be measured on a JS twin that dropped `uCoreWhite` — the term
     * that neutralises the core toward its own luminance and is the whole
     * reason the core reads white at all — so the twin only ever found the
     * white the ACES curve clipped into existence, and it reported the pinched
     * profile at 8.75x against the shipped profile's 5.78x. Run through
     * BLADE_FRAG itself the same two profiles measure 4.84x and 3.72x: the
     * blade is a good deal whiter in the middle than the twin ever said,
     * because it is deliberately whitened there.
     *
     * 4.3 is that measured 4.84 less a ninth. It still fails on the profile
     * that shipped (3.72x), which is what stops it going quietly green, and it
     * only ever moves UP.
     *
     * The second clause is what stops the ratio being won by shrinking the
     * colour as well: vfx.mjs requires the crystal to still survive 120 mm out
     * at full width, and on the real shader the tightest is 120 mm. */
    assert(now.ratio >= 4.3,
      `the narrowest coloured-to-white ratio in the game is ${now.ratio.toFixed(2)}x — the blade is `
      + 'reading as a white bar with a rim rather than a core in a halo');
    assert(then.ratio < 4.3,
      `the shipped profile also clears this bound (${then.ratio.toFixed(2)}x), so it proves nothing`);
    assert(now.coloured > 0.115,
      `the crystal only survives ${(now.coloured * 1000).toFixed(0)} mm from the axis — the halo was `
      + 'thinned along with the core and the blade has lost its colour');
    return `worst coloured/white ${now.ratio.toFixed(2)}x (was ${then.ratio.toFixed(2)}x), `
      + `tightest coloured halo ${(now.coloured * 1000).toFixed(0)} mm`;
  });

  check('blade: the band the bloom pass can see is half what it was', () => {
    /* This is the one that reaches the screen. UnrealBloomPass takes every
     * texel over its threshold and spreads it through five mips, so the WIDTH
     * of the over-threshold band is the size of the thing being smeared —
     * doubling it does not make a brighter halo, it makes a halo twice as
     * wide, which is what "washes out the whole screen" means.
     *
     * vfx.mjs already bounds this, at 60 mm, and says why the ceiling is not
     * lower: the pass needs something to chew on or the blade has no halo at
     * all. The shipped profile ran to 46.6 mm on the untuned blade and 57.4 on
     * a Grey blade in fury — against the 60 mm ceiling, i.e. it had spent the
     * entire allowance. Pinched, the same measurements are 27.6 and 36.0 mm.
     * 44 mm is that worst case plus a fifth, and it is a TIGHTENING of vfx's
     * bound: anything that passes here passes there. */
    assert(now.over <= 0.044,
      `the blade is over the bloom threshold out to ${(now.over * 1000).toFixed(1)} mm of radius — the `
      + 'pass is being handed a bar to smear rather than a line');
    assert(then.over > 0.044,
      `the profile that shipped passes this bound too (${(then.over * 1000).toFixed(1)} mm), so it has `
      + 'stopped measuring the change');
    // and the blade still has to bloom AT ALL, which is the other half of the
    // vfx bound and the reason this is not simply zero
    assert(now.over > 0.008,
      `nothing on the blade clears the bloom threshold by more than ${(now.over * 1000).toFixed(1)} mm — `
      + 'the blade has stopped glowing');
    return `over the bloom line to ${(now.over * 1000).toFixed(1)} mm (was ${(then.over * 1000).toFixed(1)}), `
      + `total blade flux ${now.flux.toFixed(3)} vs ${then.flux.toFixed(3)} amp·m `
      + `(${(now.flux / then.flux * 100).toFixed(0)}%)`;
  });

  /* ══════════════════════════════════════════════════════════════════════ */
  /*  3. WHAT THE BLOOM PASS IS ALLOWED TO ADD                              */
  /* ══════════════════════════════════════════════════════════════════════ */

  /**
   * What Engine.js actually does with a level's bloom, read out of the source.
   *
   * Deliberately tolerant of the shape that shipped — a bare `?? 0.5` and no
   * table at all — so that every check below fails on the OLD tree with the
   * old NUMBERS in the message rather than with "the table is missing". A
   * check whose teeth are structural only proves that a refactor happened.
   */
  const engine = (async () => {
    const src = await readFile(ENGINE_SRC, 'utf8');
    const table = src.match(/const BLOOM = \{([\s\S]*?)\n\};/);
    const num = (body, key) => {
      const m = body && body.match(new RegExp(`\\n\\s*${key}:\\s*([\\d.]+)`));
      return m ? Number(m[1]) : undefined;
    };
    const ctor = src.match(
      /new UnrealBloomPass\(\s*new THREE\.Vector2\([^)]*\)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
    // the composed form, then the bare one it replaced
    const composed = /this\.bloom\.strength\s*=\s*\(a\.bloom\s*\?\?\s*BLOOM\.fallback\)\s*\*\s*BLOOM\.trim\s*;/.test(src);
    const bare = src.match(/this\.bloom\.strength\s*=\s*a\.bloom\s*\?\?\s*([\d.]+)\s*;/);
    return {
      hasTable: !!table, composed,
      // no trim in the source means every authored number reaches the pass as-is
      trim: (table && num(table[1], 'trim')) ?? 1,
      fallback: (table && num(table[1], 'fallback')) ?? (bare ? Number(bare[1]) : undefined),
      radius: (table && num(table[1], 'radius')) ?? (ctor ? Number(ctor[2]) : undefined),
      threshold: (table && num(table[1], 'threshold')) ?? (ctor ? Number(ctor[3]) : undefined),
      ctor: ctor && { strength: Number(ctor[1]), radius: Number(ctor[2]), threshold: Number(ctor[3]) },
    };
  })();

  check('bloom: one table owns the strength, and the pass is built with what a level gets', async () => {
    /* THE SECOND HALF OF THE SNOW FAULT, and it is a plain bug rather than a
     * matter of taste. The pass was constructed with 0.42 and then every level
     * that had never authored a bloom of its own — the White Pass, the Shifting
     * Waste and the meadow — was handed 0.5 by the `?? 0.5` in applyAtmosphere.
     * Two numbers for the same thing, and the one that actually shipped on
     * three levels was the larger. It was also larger than every authored OUTDOOR
     * level in the game (0.36 to 0.42): the only levels that ever asked for
     * more than 0.42 are the dojo and the hangar, both interiors, at 0.55.
     *
     * A default is not allowed to be the hottest setting in the build, and the
     * two places that state it are not allowed to disagree, so this pins them
     * to one table. */
    const e = await engine;
    assert(e.ctor, 'the UnrealBloomPass constructor call is no longer three literals — '
      + 'tools/checks/saber-light.mjs and tools/checks/order.mjs both learn the bloom threshold from it');
    assert(Number.isFinite(e.fallback),
      'nothing in Engine.js says what a level that authored no bloom of its own is handed');
    near(e.ctor.strength, e.fallback * e.trim, 1e-9,
      `the pass is constructed at strength ${e.ctor.strength} while a level that authored no bloom is `
      + `handed ${(e.fallback * e.trim).toFixed(4)} — one number written twice, differently, and the `
      + 'larger of the two is the one three levels actually shipped with');
    near(e.ctor.radius, e.radius, 1e-9, 'the constructed bloom radius is not BLOOM.radius');
    near(e.ctor.threshold, e.threshold, 1e-9, 'the constructed bloom threshold is not BLOOM.threshold');
    assert(e.hasTable, 'src/engine/Engine.js has no BLOOM table — the strength is a literal again');
    assert(e.composed,
      'applyAtmosphere no longer composes the level strength as (a.bloom ?? BLOOM.fallback) * BLOOM.trim, '
      + 'so the table is decoration and a level can be handed anything');
    return `BLOOM fallback ${e.fallback} x trim ${e.trim} = ${(e.fallback * e.trim).toFixed(4)}, `
      + `radius ${e.radius}, threshold ${e.threshold}, all three matched by the constructor`;
  });

  check('bloom: no level bloomed harder than the level that measured it', async () => {
    /* The trim, stated over the levels it actually reaches, because the
     * complaint is not level-specific and a fix that only touched the White
     * Pass would be a patch rather than a fix.
     *
     * The ceiling is measured, not chosen. On the White Pass, first person,
     * with the pinched profile already in, the widest run of blown-to-white
     * pixels across the blade goes 39 px at strength 0.50, 18 px at 0.34,
     * 16 px at 0.30 and 14 px at 0.26 against a floor of about 13 px with the
     * pass switched off entirely — so past roughly 0.30 the curve has flattened
     * onto the floor and there is nothing left to buy. 0.40 is the ceiling that
     * leaves the two interiors — the dojo and the hangar, with no daylight to
     * compete with and the only levels that ever authored above 0.42 — at the
     * top of the range.
     *
     * As shipped this was 0.55 for both interiors and 0.50 for three levels
     * that had authored nothing at all, the White Pass among them. */
    const e = await engine;
    assert(Number.isFinite(e.fallback), 'nothing in Engine.js says what an unauthored level is handed');
    const rows = [], authored = [];
    for (const [key, L] of Object.entries(LEVELS)) {
      const own = L.atmosphere?.bloom;
      const eff = (own ?? e.fallback) * e.trim;
      rows.push([key, own, eff]);
      if (own !== undefined) authored.push(own);
    }
    assert(rows.length >= 6, `only ${rows.length} levels found — LEVELS is not being read`);
    const hottest = rows.reduce((a, b) => (a[2] > b[2] ? a : b));
    assert(hottest[2] <= 0.40,
      `${hottest[0]} runs the bloom pass at ${hottest[2].toFixed(3)} — past 0.30 the blown-white run `
      + 'across the blade has already flattened onto the bloom-off floor, so this is spend with '
      + 'nothing bought');
    // teeth: the strengths that shipped fail exactly this bound
    const wasHottest = Math.max(...rows.map(([, own]) => own ?? 0.5));
    assert(wasHottest > 0.40,
      `the strengths as they shipped (hottest ${wasHottest}) already met this bound, so the trim `
      + 'is not being measured by it');
    // and the levels that authored nothing may not be the hottest ones
    const unauthored = rows.filter(([, own]) => own === undefined);
    assert(unauthored.length >= 2,
      'every level authors its own bloom now, so the fallback is untested — this check has gone blind');
    const authoredMax = Math.max(...authored) * e.trim;
    for (const [key, , eff] of unauthored) {
      assert(eff <= authoredMax,
        `${key} authored no bloom and is being run at ${eff.toFixed(3)}, above every level that did `
        + `author one (max ${authoredMax.toFixed(3)}) — a default is not a maximum`);
    }
    return rows.map(([k, own, eff]) => `${k} ${own === undefined ? '—' : own}→${eff.toFixed(3)}`).join(', ');
  });

  check('bloom: the threshold is the wrong lever for a bright level, and stays put', async () => {
    /* WHY THE THRESHOLD DID NOT MOVE, written down because it is the obvious
     * thing to reach for and it is wrong twice.
     *
     * Wrong once because a high-albedo ground is not a bloom source. Snow is
     * bright because its ALBEDO is high, not because the light is: a lambertian
     * surface of the level's own ground colour, under the level's own sun at
     * the level's own elevation, renders at the radiance below — every level in
     * the game lands a factor of two or more under the threshold, and the
     * measured White Pass frame agrees (ground p90 0.389 linear, 0.004% of
     * ground pixels over the line). Raising the line moves none of it.
     *
     * Wrong twice because the blade's GLOW lobe is what sits just over the
     * threshold, and it is the lobe that carries the crystal — the core has
     * given up its chroma by design (CORE_WHITE). tools/checks/saber-light.mjs
     * asserts glow > 1.5x the threshold for exactly that reason, so raising the
     * line does not merely fail to help the snow, it drains the colour out of
     * the halo. The strength was trimmed instead — and that is the assertion
     * with the teeth here: a build where the trim is absent is a build that has
     * gone back to handing the pass whatever each level wrote down. */
    const e = await engine;
    near(e.threshold, 1.8, 1e-9,
      `the bloom threshold moved to ${e.threshold}. Nothing in a level's ground reaches 1.8 in `
      + 'the first place, and the blade\'s glow lobe is the thing just above it');
    assert(e.trim < 1,
      'the bloom strength is not trimmed at all — every level\'s authored number reaches the pass '
      + 'unmodified, which is the state the "white flurry" was reported in, and the threshold is '
      + 'not a substitute for it');
    const rows = [];
    for (const [key, L] of Object.entries(LEVELS)) {
      const a = L.atmosphere;
      if (!a || a.elevation === undefined) continue;
      const g = new THREE.Color(L.groundColor ?? 0x808080);
      // Lambert, three's own BRDF normalisation, a horizontal surface under the
      // level's own key light. This is the brightest the GROUND itself can be.
      const L709 = 0.2126 * g.r + 0.7152 * g.g + 0.0722 * g.b;
      const rad = L709 / Math.PI * (a.sunIntensity ?? 5) * Math.sin(a.elevation * Math.PI / 180);
      rows.push([key, rad]);
      assert(rad < e.threshold * 0.5,
        `${key}'s own ground renders at ${rad.toFixed(3)} linear against a bloom threshold of `
        + `${e.threshold} — it is close enough to the line that raising the threshold would `
        + 'start to be a real lever, and this check has stopped saying what it says');
    }
    assert(rows.length >= 5, `only ${rows.length} levels had an atmosphere to meter`);
    const worst = rows.reduce((a, b) => (a[1] > b[1] ? a : b));
    return `threshold ${e.threshold}, trim ${e.trim}; brightest ground is ${worst[0]} at `
      + `${worst[1].toFixed(3)} linear, ${(e.threshold / worst[1]).toFixed(1)}x under the line `
      + `(${rows.length} levels)`;
  });
}
