/**
 * THE HOLONET, MEASURED.
 *
 * The player: *"galactic television of some kind with 24/7 tv (also
 * procedural, never the same)."* What this file holds the channel to:
 *
 *   A DAY SHOWS EVERY KIND — a rota that happened to skip the sport desk on
 *     Tuesday reads fine as source; the schedule is walked over five days at
 *     every half hour and every kind must turn up.
 *   TWO DAYS ARE TWO LINE-UPS — "never the same" is a claim about tomorrow.
 *   THE ANCHOR IS A PERSON — the same resident on the same station across
 *     days, and a different one on a station with a different name.
 *   THE NEWS IS ABOUT YOU — with the standing driven negative through the
 *     store's own door the headline must say so; nothing here writes to a
 *     store it does not clear afterwards.
 *   THE DRUM IS LIVE — the small hours and the top of the hour are the
 *     wheel, and the wheel at rest agrees with `Games.drumAt`.
 *   NOTHING THROWS ON A STUB CANVAS — every kind, several cuts, with and
 *     without a world. `dom-shim`'s canvas does not hold pixels, so the
 *     picture is measured as the RECORD of what was drawn: two cuts of one
 *     programme must record different draws, and two programmes must not be
 *     the same picture with the bug changed.
 *   NOTHING ROLLS — no `Math.random` in the module, by reading it.
 */

import { readFile } from 'node:fs/promises';
import * as H from '../../src/game/Holonet.js';
import * as SS from '../../src/game/StationSave.js';
import { drumAt, DRUM } from '../../src/game/Games.js';

/** A context that remembers what was drawn on it, so a stub canvas has a picture. */
function recorder() {
  const log = [];
  const fills = new Set();
  const rec = (k) => (...a) => { log.push(k + ':' + a.map((v) => (typeof v === 'number' ? v.toFixed(1) : String(v))).join(',')); };
  const ctx = {
    canvas: { width: H.TV_W, height: H.TV_H },
    log, fills,
    measureText: (s) => ({ width: String(s).length * 9 }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  };
  for (const k of ['fillRect', 'strokeRect', 'clearRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'arcTo', 'rect', 'ellipse', 'fill', 'stroke', 'clip', 'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'drawImage', 'strokeText']) ctx[k] = rec(k);
  ctx.fillText = (s, x, y) => { log.push(`fillText:${s},${x.toFixed(1)},${y.toFixed(1)}`); fills.add(String(s)); };
  /* a colour change is part of the picture too */
  for (const k of ['fillStyle', 'strokeStyle', 'font']) Object.defineProperty(ctx, k, { set(v) { log.push(`${k}=${v}`); this['_' + k] = v; }, get() { return this['_' + k]; } });
  return ctx;
}

/** A real canvas if the environment has one that keeps pixels; null otherwise. */
function realCanvas() {
  try {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 8, 8);
    const px = ctx.getImageData(0, 0, 8, 8).data;
    return px[0] === 255 ? c : null;
  } catch { return null; }
}

const HOURS = [];
for (let s = 0; s < 48; s++) HOURS.push(s / 2 + 0.25, s / 2);

export async function run({ check, assert }) {
  const src = await readFile(new URL('../../src/game/Holonet.js', import.meta.url), 'utf8');

  check('holonet: five days at every half hour show every kind of programme', () => {
    const seen = new Set();
    for (let d = 0; d < 5; d++) for (const h of HOURS) seen.add(H.programmeAt(d, h).kind);
    for (const k of H.KINDS) assert(seen.has(k), `no ${k} in five days`);
    assert(H.KINDS.length >= 6, `${H.KINDS.length} kinds`);
    return `${H.KINDS.length} kinds: ${[...seen].join(', ')}`;
  });

  check('holonet: two days are two line-ups, and one day is the same line-up twice', () => {
    const days = [];
    for (let d = 0; d < 5; d++) days.push(H.scheduleFor(d).join(','));
    const distinct = new Set(days).size;
    assert(distinct >= 3, `${distinct} distinct line-ups over five days`);
    assert(H.scheduleFor(2).join(',') === days[2], 'the same day scheduled twice differs');
    const p = H.programmeAt(3, 13.6);
    assert(p.seed === '3:27' && p.slot === 27, `slot ${p.slot} seed ${p.seed} at 13:36`);
    return `${distinct} of 5 days distinct`;
  });

  check('holonet: the test card runs 02:30–05:00 and nothing else does', () => {
    for (let h = 2.5; h < 5; h += 0.25) assert(H.programmeAt(0, h).kind === 'ident', `${h}: ${H.programmeAt(0, h).kind}`);
    assert(H.programmeAt(0, 5.25).kind !== 'ident' || H.programmeAt(0, 5.75).kind !== 'ident', 'ident straight after the test card twice');
    return 'ident from 02:30 to 05:00';
  });

  check('holonet: the drum is on through the small hours and on the hour, and the wheel agrees with the clock', () => {
    for (let h = 0; h < 2.5; h += 0.25) assert(H.programmeAt(1, h).kind === 'drum', `${h}: ${H.programmeAt(1, h).kind}`);
    for (let h = 5; h < 24; h += 1) {
      assert(H.programmeAt(1, h + 0.02).kind === 'drum', `${h}:01 is ${H.programmeAt(1, h + 0.02).kind}`);
      assert(H.programmeAt(1, h + 0.5).kind !== 'drum', `${h}:30 is the drum`);
    }
    const rest = H.drumAngle(9.5, 2);
    assert(!rest.spinning, 'spinning at 09:30');
    const seg = Math.PI * 2 / DRUM.SEGMENTS.length;
    assert(Math.abs(rest.angle + drumAt(9, 2) * seg) < 1e-9, `angle ${rest.angle} for stop ${drumAt(9, 2)}`);
    assert(rest.D.deck === DRUM.SEGMENTS[drumAt(9, 2)], 'the board and the wheel disagree');
    const live = H.drumAngle(9.005, 2);
    assert(live.spinning, 'not spinning at 09:00');
    assert(Math.abs(live.angle - rest.angle) > 1, 'the live wheel is already at rest');
    assert(rest.D.prev.length === 6, `${rest.D.prev.length} previous stops`);
    return `stop ${rest.D.at} = deck ${rest.D.deck ?? 'house'}, ${rest.D.prev.length} shown behind it`;
  });

  check('holonet: the anchor is one resident per station, the same across days', () => {
    const a = H.anchorFor('Crossroads'), b = H.anchorFor('Crossroads'), c = H.anchorFor('Borz');
    assert(a.seed === b.seed && a.name === b.name && a.species === b.species, 'the anchor changed between calls');
    assert(a.seed === 'holonet:anchor:Crossroads', a.seed);
    assert(a.name !== c.name || a.seed !== c.seed, 'two stations share an anchor');
    /* through the news itself, on two days */
    const ctx0 = recorder(), ctx3 = recorder();
    const P0 = { kind: 'news', slot: 20, into: 0, seed: '0:20', day: 0, hour: 10.25 };
    const P3 = { kind: 'news', slot: 20, into: 0, seed: '3:20', day: 3, hour: 10.25 };
    H.paintProgramme(ctx0, H.TV_W, H.TV_H, null, P0, 0, 1, 0, 10.25);
    H.paintProgramme(ctx3, H.TV_W, H.TV_H, null, P3, 0, 1, 3, 10.25);
    const tag = `${H.anchorFor().name.toUpperCase()} · ${H.anchorFor().species.toUpperCase()}`;
    assert(ctx0.fills.has(tag) && ctx3.fills.has(tag), `the lower third does not name the anchor: ${tag}`);
    return `${a.name} the ${a.species} on Crossroads; ${c.name} on Borz`;
  });

  check('holonet: the news reads the standing, and says so when it is negative', () => {
    const before = SS.standing();
    try {
      SS.clearStation();
      SS.setStanding(-4);
      const P = H.programmeAt(0, 9.25);
      let said = 0, total = 0;
      for (let cut = 0; cut < 6; cut++) {
        const N = H.newsAt(null, { ...P, kind: 'news' }, cut, 0, 9.25);
        total++;
        assert(N.facts.standing === -4, `facts read ${N.facts.standing}`);
        if (/standing|marks against|security/i.test(N.head) || /standing/i.test(N.ticker)) said++;
      }
      assert(said === total, `${said} of ${total} cuts mention the standing`);
      assert(H.HEADLINES.length >= 20, `${H.HEADLINES.length} headline templates`);
      /* and the brig */
      SS.setBrigPending(true);
      const N = H.newsAt(null, { ...P, kind: 'news' }, 0, 0, 9.25);
      assert(N.facts.brig === true && /brig/.test(N.ticker), 'the brig is not on the ticker');
      return `${H.HEADLINES.length} templates; ${said}/${total} cuts carry the standing at -4`;
    } finally {
      SS.clearStation();
      if (before) SS.setStanding(before);
    }
  });

  check('holonet: every programme paints on a stub canvas without throwing, with and without a world', () => {
    const shimCtx = document.createElement('canvas').getContext('2d');
    const world = {
      _pickedLevel: { name: 'Borz Ridge' },
      _deckBattle: { t: 12, hulls: [{ shown: true }, { shown: false }], bolts: { alive: 2 }, fighters: { n: 3 }, group: { children: [] } },
      _toteHeld: [{ stake: 40, race: 'x' }],
    };
    let paints = 0;
    for (let d = 0; d < 3; d++) for (const h of HOURS) {
      const P = H.programmeAt(d, h);
      for (const cut of [0, 1, 7]) for (const w of [null, world]) {
        assert(H.paintProgramme(shimCtx, H.TV_W, H.TV_H, w, P, cut, cut * 9 + 0.5, d, h) === true, `paint refused ${P.kind} at ${h}`);
        paints++;
      }
    }
    assert(H.paintProgramme(null, H.TV_W, H.TV_H, null, H.programmeAt(0, 9.25), 0, 0, 0, 9.25) === false, 'a null ctx did not return false');
    return `${paints} paints, every kind, three days`;
  });

  check('holonet: the picture changes between cuts and differs between kinds', () => {
    const c = realCanvas();
    const byKind = new Map();
    for (const h of HOURS) { const P = H.programmeAt(1, h); if (!byKind.has(P.kind)) byKind.set(P.kind, { P, h }); }
    const pictures = [];
    for (const [kind, { P, h }] of byKind) {
      const a = recorder(), b = recorder();
      H.paintProgramme(a, H.TV_W, H.TV_H, null, P, 0, 0.5, 1, h);
      H.paintProgramme(b, H.TV_W, H.TV_H, null, P, 1, 9.5, 1, h);
      assert(a.log.length > 25, `${kind} drew ${a.log.length} things`);
      assert(a.log.join('\n') !== b.log.join('\n'), `${kind}: cut 0 and cut 1 are the same picture`);
      assert(a.fills.has(`HOLONET·${kind.toUpperCase()}`), `${kind} has no channel bug`);
      assert([...a.fills].some((s) => /^\d\d:\d\d$/.test(s)), `${kind} has no corner clock`);
      pictures.push(a.log.filter((l) => !l.startsWith('fillText:HOLONET')).join('\n'));
      if (c) {
        c.width = H.TV_W; c.height = H.TV_H;
        const ctx = c.getContext('2d');
        H.paintProgramme(ctx, H.TV_W, H.TV_H, null, P, 0, 0.5, 1, h);
        const p0 = Array.from(ctx.getImageData(0, 0, H.TV_W, H.TV_H).data);
        H.paintProgramme(ctx, H.TV_W, H.TV_H, null, P, 1, 9.5, 1, h);
        const p1 = ctx.getImageData(0, 0, H.TV_W, H.TV_H).data;
        let diff = 0; for (let i = 0; i < p0.length; i += 4) if (p0[i] !== p1[i] || p0[i + 1] !== p1[i + 1] || p0[i + 2] !== p1[i + 2]) diff++;
        assert(diff > 100, `${kind}: ${diff} pixels moved between cuts on a real canvas`);
      }
    }
    assert(new Set(pictures).size === pictures.length, 'two kinds paint the same picture');
    return `${byKind.size} kinds, each changes between cuts${c ? ', pixels measured' : ', draw record measured (no pixel canvas here)'}`;
  });

  check('holonet: the same moment on two screens is the same picture', () => {
    const a = recorder(), b = recorder();
    const P = H.programmeAt(4, 17.25);
    H.paintProgramme(a, H.TV_W, H.TV_H, null, P, 3, 30, 4, 17.25);
    H.paintProgramme(b, H.TV_W, H.TV_H, null, P, 3, 30, 4, 17.25);
    assert(a.log.join('\n') === b.log.join('\n'), 'two screens at one moment disagree');
    return `${a.log.length} draws, identical`;
  });

  check('holonet: the advert is a real row at a real price, the talk is real lines, the orbit names the level', () => {
    const A = H.advertOf(H.programmeAt(0, 9.25), 0, 0);
    assert(A.item && /^\d+ CR$/.test(A.price), `${A.item} at "${A.price}"`);
    const T = H.talkOf(H.programmeAt(0, 9.25), 1, 0);
    assert(T.host.seed !== T.guest.seed && T.line.length > 3, `talk: ${T.line}`);
    const T2 = H.talkOf(H.programmeAt(1, 9.25), 1, 1);
    assert(T2.host.seed === T.host.seed && T2.guest.seed !== T.guest.seed, 'the host changed or the guest did not');
    const ctx = recorder();
    const P = { kind: 'orbit', slot: 22, into: 0, seed: '0:22', day: 0, hour: 11.25 };
    H.paintProgramme(ctx, H.TV_W, H.TV_H, { _pickedLevel: { name: 'Borz Ridge' } }, P, 0, 1, 0, 11.25);
    assert(ctx.fills.has('BORZ RIDGE'), 'the orbit chart does not name the level');
    return `${A.item} ${A.price} at ${A.counter}; ${T.speaker.name}: "${T.line.slice(0, 40)}"`;
  });

  check('holonet: nothing in the module rolls', () => {
    assert(!/Math\.random/.test(src), 'Math.random in Holonet.js');
    assert(/hashF\(`\$\{P\.seed\}:/.test(src), 'cuts are not seeded off the programme');
    return 'no Math.random; every pick hashes (day, slot, cut)';
  });
}
