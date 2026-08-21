/**
 * BATTLEFRONT BORZ — FLAGSHIP.md §14 STEP 3: THE PUPPET LINE.
 *
 *     node --import ./tools/register.mjs tools/_puppetline.mjs
 *     node --import ./tools/register.mjs tools/_puppetline.mjs --settle 6 --quality high
 *
 * §14, verbatim: "40 `inert` bodies on a hand-authored 60-second timeline, no
 * AI at all. Isolates the only uncertain question — does the *output* read as a
 * battle: posture, silhouette, timing. **The script that reads well IS the role
 * taxonomy, written as acceptance criteria.**"
 *
 * So the deliverable of this file is not the pictures. It is the list at the
 * bottom of this header: the postures and roles the timeline TURNED OUT TO
 * NEED before forty bodies on a plain stopped reading as a crowd. The pictures
 * are the evidence that the list is right, and `assets/flagship/step3/` is
 * where they and the beat sheet go.
 *
 * ── WHAT "NO AI AT ALL" IS, MECHANICALLY ────────────────────────────────
 *
 * `Enemy.netDriven` — the branch a co-op CLIENT's copy of a body runs, whose
 * own comment is "the host owns where this thing is, we own how it looks". It
 * skips the brain, the steering, `_move` and every decision, damps the body
 * toward a `netTarget` somebody else wrote, slews `facing` toward a `netFacing`
 * somebody else wrote, and then runs `_pose` — the animator, the IK'd arms, the
 * cloth — off nothing but position, facing, velocity and `crouch`.
 *
 * That is exactly a puppet, and using it rather than inventing an `inert` flag
 * matters for the result: every posture in the timeline below is one the
 * shipped rig can already strike, reached through the shipped seam, so a beat
 * that reads well here is a beat the real thing can produce and a beat that
 * does not is a real gap. The one thing the timeline reaches past that branch
 * for is the trigger — `_shoot`, called directly, because a volley is the beat
 * and `netDriven` bodies do not fire.
 *
 * `World.pickTarget` is replaced with "whatever this body was told to look at",
 * which is the other half of no-AI: a puppet aims where the script points it
 * and never chooses. Nothing in the world is allowed to spawn — the mode is
 * `sandbox` with `sandboxCount: 0` — and any body that is not a puppet is
 * removed on the frame it appears.
 *
 * ── WHY THIS IS SIXTY SECONDS AND NINE FRAMES ───────────────────────────
 *
 * HANDOFF §2.6: one frame through SwiftShader is about four seconds, so sixty
 * seconds of rendered play is forty minutes of wall clock and a video is not
 * available at any price. But `world.update` is CPU and `engine.render` is what
 * costs — so the timeline is played CONTINUOUSLY at 1/30 s a step, all 1,800
 * steps of it, and the renderer is only asked for a frame at the beats. Every
 * plate is therefore a real sixty-second timeline sampled at the moment it was
 * authored for, not eight independent poses arranged to look like one.
 *
 * What that cannot show is TIMING, which is a third of §14's question. Stills
 * do not carry it. The beat sheet is where timing is stated and judged — how
 * long the advance takes, how long the line holds before it fires, how long the
 * hole in the rank stays a hole — and it is written into the manifest beside
 * the plates so the two are read together.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE ROLE TAXONOMY — §14's actual deliverable
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Written as acceptance criteria, which is what §14 asks for: each line is a
 * thing the real soldiers must be able to DO, and the beat that fails without
 * it. Nine postures and six roles. The order is the order the timeline needed
 * them in — every one of these was added because the frame before it read as a
 * crowd of identical white figures jogging, which is FLAGSHIP §10's own
 * diagnosis of the shipped game.
 *
 * ── THE SIX ROLES ───────────────────────────────────────────────────────
 *
 * 1. LINE. The rank-and-file body, and the only one there are many of. Must
 *    hold a DRESSED position — an interval and a rank it keeps to within
 *    something like half a body — because the difference between a line and a
 *    crowd is entirely the regularity of the spacing, and it survives being
 *    seen at 60 m where nothing else about a body does.
 *
 * 2. OFFICER. One per line. Must be the point every other body's slot is
 *    solved FROM, must stand when the line kneels, and must be a taller
 *    silhouette (§11's 1.15× scale carries rank at 6-19 px where hue does not).
 *    Without him the kneeling beat reads as forty men crouching for no reason;
 *    with him it reads as a line that has been given an order.
 *
 * 3. SUPPORT GUN. Two or three. Plants rather than advancing with the line,
 *    fires for longer, and is the LAST thing to move in the fall-back. It is
 *    what makes the line's movement read as covered rather than simultaneous.
 *
 * 4. MARKSMAN. One or two, OFF the line — detached to a flank, static,
 *    kneeling while the line is standing. The role exists to break the rank's
 *    own regularity at exactly one point, which is what stops the formation
 *    reading as wallpaper.
 *
 * 5. CASUALTY. Not an archetype — a state any of the above enters. Must go
 *    down where it stood, must STAY down, and the line must close over the hole
 *    rather than leaving a gap the eye reads as a bug. The closing is the part
 *    that carries it; a body simply vanishing is what the shipped game does.
 *
 * 6. RUNNER / BROKEN. One or two bodies moving at a different gait and on a
 *    different bearing from everyone else. A formation where every body agrees
 *    is a machine; a formation where one or two do not is an army.
 *
 * ── THE NINE POSTURES ───────────────────────────────────────────────────
 *
 *  1. STAND — weapon at low ready, facing downrange. The zero.
 *  2. ADVANCE — walk on a common bearing, dressed, at ONE pace. (The beat
 *     fails if bodies arrive at different times: a line arrives together or it
 *     is a crowd.)
 *  3. HALT — stop, weapon comes up. Needs to be distinguishable from STAND by
 *     the arms alone, because the feet are doing the same thing.
 *  4. KNEEL — `crouch: 1`, which the rig has always been able to do and which
 *     every enemy in the shipped game hands a literal 0 (FLAGSHIP §10's "one
 *     float"). Two heights in one line is the single strongest signal in any of
 *     these nine plates.
 *  5. FIRE — muzzle flash, and every barrel on ONE bearing. A volley where the
 *     bearings disagree reads as panic, not as a firing line.
 *  6. TAKE COVER — crouch AND move to a piece of the level, not just crouch.
 *     Cover is a position before it is a pose, AND A POSITION IS A SCARCE
 *     RESOURCE: the slots behind one rock are handed out, one man each, and the
 *     men who do not get one go flat in the open instead. This clause is here
 *     because the first run of this script did not have it — every man of the
 *     line asked for the nearest box, all eighteen were sent to the same point,
 *     and the plate came back with the line gone from the frame. A cover rule
 *     that allocates nothing deletes the formation it was meant to save.
 *  7. GO DOWN — ragdoll, in the rank, and stay there.
 *  8. FALL BACK — walk BACKWARD, facing the enemy. This is the posture the
 *     whole taxonomy stands on: a retreat animated as a walk in the other
 *     direction is a rout, and a rout is a different event. `netFacing` and the
 *     bearing of travel must be independent, and in the shipped game they are.
 *  9. DRESS — re-form on the officer after the line has been broken and has
 *     lost bodies. The last plate is the acceptance criterion for the whole
 *     list: if the line that re-forms reads as the same line, the taxonomy is
 *     complete.
 *
 * ── WHAT THE LIST DOES NOT NEED, and both are worth recording ───────────
 *
 * No gait blending, no transition animations and no per-body variation beyond
 * an interval jitter: the nine postures are switched between hard, on the beat,
 * and the animator's own damping is enough. And no faces, no rank paint, no
 * detail of any kind — every plate here is judged at 20-60 m where §11 says
 * only value and silhouette survive, and they do.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  THE VERDICT — does the output read as a battle
 * ══════════════════════════════════════════════════════════════════════════
 *
 * YES, AND IT IS THE SILHOUETTE THAT CARRIES IT. Forty bodies on a hand-written
 * script, with every brain switched off, produce a picture a person reads as an
 * engagement: a dressed line, a line walking in step, a rank at two heights,
 * an exchange of bolts across sixty metres, and — the strongest plate in the
 * set — a line walking backward while still facing the enemy. Nothing in any of
 * it is AI. §14's question is answered: the output is not the uncertain part.
 *
 * FOUR THINGS THE PLATES SAY THAT THE SCRIPT DID NOT SET OUT TO ASK:
 *
 * 1. THE LINE READS AS ONE FLAT BLACK SILHOUETTE, and clone armour authored at
 *    `0xe8e9ec` never appears. The eye is on the shadow side of the bodies, so
 *    the two-tone cel shading collapses to the dark tone and forty men become a
 *    paper cut-out. It is legible AS a line — which is the point of §11's
 *    "value, not hue, at scale" — but nothing in it carries rank, faction or
 *    role, and the officer's 1.15× is invisible. A flagship that means to read
 *    rank at 6-19 px cannot leave which side of a body the sun is on to chance.
 *    The eye-level plate is the control: the same men, 4.3 m lower, show their
 *    armour panels, because that eye catches the lit side.
 *
 * 2. §4's COMPRESSION CLAIM IS TRUE AND VISIBLE. From 6.4 m the near line at
 *    20 m and the far line at 60 m are two distinct bands; from 2.1 m they are
 *    one band and you cannot tell which bodies are which army. The flagship's
 *    camera cannot sit at a standing man's eye height on a plain.
 *
 * 3. A CASUALTY IS NOT AN EVENT YET. The body ragdolls where it stood and the
 *    line keeps firing, which is exactly what was asked for — and at 20 m,
 *    among eighteen other dark silhouettes, it is not legible as a man going
 *    down. The CASUALTY role needs something the ragdoll does not provide: the
 *    hole in the rank has to persist and be seen, or the fall has to be marked.
 *
 * 4. THE TIMELINE WALKED THE LINE INTO THE LEVEL. Seventeen metres of advance
 *    authored in world coordinates put the rank astride a boulder that the
 *    ground had dressed there. It cost nothing here — it gave TAKE COVER
 *    something real to hide behind — but it is the first thing that will break
 *    when this stops being a script: a formation on procedural ground has to
 *    solve its slots against the dressing, not against a straight line.
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const OUT = flag('out', join(ROOT, 'assets', 'flagship', 'step3'));
const QUALITY = flag('quality', 'medium');
const SETTLE = parseInt(flag('settle', '4'), 10);
const WIDTH = parseInt(flag('width', '1280'), 10);
const HEIGHT = parseInt(flag('height', '720'), 10);
const SEED = Number(flag('seed', '7'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.map': 'application/json', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
  '.webp': 'image/webp', '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const say = (s) => process.stderr.write(s + '\n');

say('booting…');
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate(([quality]) => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level: 'geonosis', quality, mode: 'sandbox', resolutionScale: 0.7,
    difficulty: 'knight', volume: 0, music: 0, sandboxCount: 0, sandboxFire: 0,
    allies: 0, instantSpawn: true,
  }));
}, [QUALITY]);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 180000 });
await page.click('#btn-deploy');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 180000 });
say('deployed.');

/* Nothing on the glass. Same list `_frontshot.mjs` uses and for the same
 * reason: an overlay in every plate cannot be what somebody orders them by,
 * but it can hide the thing that can. */
await page.addStyleTag({ content:
  '#hud, #crosshair, .hud, #commune, #notify, #subtitles, #announce, #orders, '
  + '#roster, #stratagem, #objective, #damage, #vignette { display: none !important; }' });

/* ══════════════════════════════════════════════════════════════════════ */
/*  The puppet line, installed in the page                                */
/* ══════════════════════════════════════════════════════════════════════ */

const setup = await page.evaluate(async ([seed]) => {
  const S = window.SABER, w = S.world, p = w.player;
  const THREE = await import('three');

  /** The line runs along X; downrange is +Z. Geonosis is the flattest ground
   *  in the game out to 180 m, which is why §14 fights on it and why a rank
   *  can be laid out in world coordinates without a slope solve. */
  const O = { x: p.position.x, z: p.position.z + 18 };
  const gy = (x, z) => w.terrain.height(x, z);

  /**
   * THE ROSTER, BY ROLE — and the roles are ARCHETYPES the game already has,
   * because the taxonomy is worth nothing if it needs bodies nobody built.
   * `officer` is 1.15× and carries rank paint; `heavy` is the support gun;
   * `sniper` is the marksman; `trooper` is the line. The far side is `b1`,
   * which is what a Confederate line is made of.
   */
  const ROLES = [
    ['officer', 1], ['trooper', 18], ['heavy', 3], ['sniper', 2], ['trooper', 2],
  ];
  const FAR = 14;

  const puppets = [];
  const spawn = (type, x, z, role) => {
    const e = w.spawnEnemy(type, new THREE.Vector3(x, gy(x, z), z));
    if (!e) return null;
    e.__puppet = true;
    e.__role = role;
    e.netDriven = true;                    // the brain, the steering and _move are skipped
    e.netTarget = e.position.clone();
    e.netFacing = 0;
    e.crouch = 0;
    puppets.push(e);
    return e;
  };

  /* THE NEAR LINE: two ranks of nine, an officer three metres behind the
   * centre, three support guns on the right, two marksmen detached left, two
   * runners who will not stay dressed. Interval 1.9 m, rank depth 2.6 m. */
  const line = [], heavies = [], marks = [], runners = [];
  let officer = null;
  const INTERVAL = 1.9, RANK = 2.6;
  {
    let n = 0;
    for (const [type, count] of ROLES) {
      for (let i = 0; i < count; i++, n++) {
        let x = O.x, z = O.z, role = 'line';
        if (type === 'officer') { x = O.x; z = O.z - 3.4; role = 'officer'; }
        else if (type === 'heavy') { x = O.x + 9.4 + i * 2.4; z = O.z + 0.4; role = 'gun'; }
        else if (type === 'sniper') { x = O.x - 12.5 - i * 3.1; z = O.z - 1.2; role = 'marksman'; }
        else if (role === 'line' && n >= 21) { x = O.x - 6 + i * 3; z = O.z - 5.5; role = 'runner'; }
        else {
          const k = line.length;
          const rank = k % 2, file = (k - rank) / 2;
          x = O.x + (file - 4) * INTERVAL + rank * INTERVAL * 0.5;
          z = O.z - rank * RANK;
        }
        const e = spawn(type === 'officer' ? 'officer' : type, x, z, role);
        if (!e) continue;
        e.__home = { x, z };
        if (role === 'line') line.push(e);
        else if (role === 'gun') heavies.push(e);
        else if (role === 'marksman') marks.push(e);
        else if (role === 'runner') runners.push(e);
        else officer = e;
      }
    }
  }
  /* THE FAR LINE, at 62-78 m: what the near line is shooting AT, and the test
   * of §11's claim that two flat tones and an ink line hold at that range. */
  const far = [];
  for (let i = 0; i < FAR; i++) {
    const x = O.x - 13 + i * 2.1 + (i % 2) * 0.9;
    const z = O.z + 44 + (i % 3) * 4.2;
    const e = spawn('b1', x, z, 'far');
    if (e) { e.__home = { x, z }; far.push(e); }
  }

  /**
   * WHAT EVERY BODY IS LOOKING AT, and it is never a decision. `World.pickTarget`
   * is the one door a body asks "who am I fighting" through, and `netDriven`
   * asks it every frame; replacing it is the other half of "no AI at all".
   */
  const aimPoint = (e) => (e.__role === 'far'
    ? { x: O.x, y: gy(O.x, O.z) + 1.2, z: O.z }
    : { x: O.x, y: gy(O.x, O.z + 50) + 1.2, z: O.z + 50 });
  w.pickTarget = (e) => {
    if (!e.__puppet) return null;
    const a = aimPoint(e);
    e.__aim = e.__aim || { position: new THREE.Vector3(), chest: new THREE.Vector3(),
      velocity: new THREE.Vector3(), dead: false, alive: true, team: e.team === 1 ? 0 : 1 };
    e.__aim.position.set(a.x, a.y - 1.2, a.z);
    e.__aim.chest.set(a.x, a.y, a.z);
    return e.__aim;
  };

  /**
   * THE MODE STOPS MANAGING THE POPULATION — and this is the one thing that
   * had to be found by looking at a blank plate.
   *
   * `sandbox` with `sandboxCount: 0` composes nothing, which is why
   * `_frontshot.mjs` uses it for an empty field. It also KEEPS the field empty:
   * the sandbox director's job is to hold exactly N bodies alive, so forty
   * puppets spawned underneath it were retired inside two seconds of script and
   * the first plate came back as an empty plain. The director is silenced
   * rather than the mode changed, because every other mode composes waves and
   * a puppet line is not a wave — and silencing it also switches off the
   * liveness watchdog, which would otherwise retire forty bodies that never
   * move toward a target and never take damage.
   */
  const realDirector = w.director.update.bind(w.director);
  w.director.update = () => {};
  w.__realDirector = realDirector;

  /* MAIN.JS STOPS DRIVING THE WORLD AND GOES ON RENDERING IT. The rAF loop
   * calls `world.update` once a frame — four seconds a frame here — which is
   * the wrong clock for a sixty-second script. It gets a no-op; the script
   * below calls the real one 1,800 times between plates. */
  const realUpdate = w.update.bind(w);
  w.update = () => {};
  w.__realUpdate = realUpdate;

  /* The player is not in this picture. Put the body far off the shot, retract
   * the blade, and stop the camera rig writing over the eye. */
  p.position.set(O.x - 140, gy(O.x - 140, O.z - 140), O.z - 140);
  p.velocity.set(0, 0, 0);
  p.saber?.retract?.();
  p.camera.update = () => {};

  window.__PUP = {
    O, puppets, line, heavies, marks, runners, officer, far,
    INTERVAL, RANK, t: 0, log: [], down: [], shots: 0, misfires: [],
    gy: (x, z) => w.terrain.height(x, z),
  };
  return { spawned: puppets.length, onField: w.enemies.length, line: line.length, guns: heavies.length,
    marks: marks.length, runners: runners.length, far: far.length,
    officer: !!officer, origin: { x: +O.x.toFixed(1), z: +O.z.toFixed(1) } };
}, [SEED]);
say(`puppets: ${JSON.stringify(setup)}`);

/* ══════════════════════════════════════════════════════════════════════ */
/*  The timeline                                                          */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE BEAT SHEET, AND IT IS THE ARTEFACT.
 *
 * `at` is the second of the sixty-second script the plate is taken at. `reads`
 * is what the plate is SUPPOSED to say — written before the plate existed, so
 * that looking at it is a test and not an interpretation.
 */
const BEATS = [
  { at: 2, file: 'step3-a-form-up', name: 'FORM UP',
    reads: 'Two ranks of nine at a 1.9 m interval, an officer three metres behind the '
      + 'centre, three support guns on the right and two marksmen detached left. It must '
      + 'read as a LINE and not as a crowd, and the thing that makes it one is that the '
      + 'intervals are regular and the two ranks are offset rather than aligned.' },
  { at: 11, file: 'step3-b-advance', name: 'ADVANCE',
    reads: 'The line is walking on one bearing at one pace, still dressed, mid-stride. '
      + 'Every man of the line must be at roughly the same point in the gait cycle and at '
      + 'the same Z: a line arrives together or it is a crowd. The two runners are the '
      + 'exception and are visibly out of step, which is what stops it reading as a machine.' },
  { at: 21, file: 'step3-c-halt-kneel', name: 'HALT AND KNEEL',
    reads: 'The front rank is down on one knee (crouch 1.0), the rear rank is standing, '
      + 'and the officer is standing behind both. THREE HEIGHTS IN ONE SILHOUETTE. This is '
      + 'the single strongest signal in the set and it is one float per body in the shipped '
      + 'rig — FLAGSHIP §10\'s "a kneeling firing line is one float", tested.' },
  { at: 27, file: 'step3-d-volley', name: 'VOLLEY',
    reads: 'Muzzle flashes down the kneeling rank, every barrel on ONE bearing, bolts in '
      + 'the air toward the far line. A volley whose bearings disagree reads as panic; this '
      + 'must read as a firing line that was given an order.' },
  { at: 27.4, file: 'step3-e-volley-eye-level', name: 'VOLLEY, FROM A STANDING MAN\'S EYES',
    reads: 'The same second from 2.1 m instead of 6.4 m. FLAGSHIP §4 claims that at eye '
      + 'height on a plain both armies compress into a band at the horizon. This plate is '
      + 'that claim, tested against the puppet line: if the far line is unreadable here and '
      + 'legible in the plate above, the flagship needs its camera off the ground.' },
  { at: 34, file: 'step3-f-a-man-goes-down', name: 'A MAN GOES DOWN',
    reads: 'One body of the front rank is a ragdoll on the ground where he was kneeling; '
      + 'the rest of the rank is still firing and has not moved. The hole in the rank must '
      + 'be legible AS a hole — that is what makes a casualty an event rather than a body '
      + 'that stopped existing.' },
  { at: 42, file: 'step3-g-take-cover', name: 'TAKE COVER',
    reads: 'The line has broken toward the nearest cover and gone low; the support guns '
      + 'have NOT moved and are still firing. Cover is a position before it is a pose, so '
      + 'the plate has to show bodies at different places as well as different heights.' },
  { at: 52, file: 'step3-h-fall-back', name: 'FALL BACK',
    reads: 'The line is walking BACKWARD — travelling away from the far line while still '
      + 'facing it. This is the posture the whole taxonomy stands on: the same movement '
      + 'animated facing the direction of travel is a rout, which is a different event. '
      + 'The support guns are the last bodies still forward.' },
  { at: 58, file: 'step3-i-dress-the-line', name: 'DRESS THE LINE',
    reads: 'The survivors have re-formed on the officer, one man short, at the same '
      + 'interval. It must read as the SAME line, reduced. If it does, the nine postures '
      + 'in this file\'s header are the whole list.' },
];

/**
 * The script, evaluated per frame in the page. It is a pure function of `t`:
 * every body's position, facing and crouch at second `t`, with no state carried
 * except the one casualty and the cover spots, which are drawn once.
 */
await page.evaluate(() => {
  const S = window.SABER, w = S.world, P = window.__PUP;
  const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
  const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

  /**
   * COVER IS ALLOCATED, ONE MAN PER SPOT — and this is the criterion the first
   * run of this script had to fail to produce.
   *
   * The first version asked each man for the nearest static box and sent him to
   * a point on its far side. Every man of an eighteen-strong line has the SAME
   * nearest box, so all eighteen were sent to one point: the TAKE COVER plate
   * came back with the line gone from the frame, piled behind one rock. (It
   * was also arithmetically wrong on top of that — the cover points were solved
   * off each man's ORIGINAL station and then had the advance added back, so
   * they aimed 17.6 m past the rock they were hiding behind.)
   *
   * Both halves are worth keeping in the record, because they are the same
   * lesson from two directions: cover is a POSITION before it is a pose, and a
   * position is a scarce resource. The rule now solves off where a man is
   * standing at the moment the order lands, and hands out slots along the lee
   * face of the box — one man per slot, fanned 0.34 rad apart — so a rock that
   * can hide three men hides three and the fourth goes flat on the open ground
   * instead. On a plain with nothing on it, which is most of Geonosis by
   * design, they go flat and SPREAD, which is the other thing a line under fire
   * does and is legible as a change of shape.
   *
   * Solved once, at the moment the order lands, and not per frame: a body
   * walking to cover must not have its destination recomputed underneath it.
   */
  P.coverAt = null;
  P.lee = new Map();
  window.__takeCover = () => {
    const P2 = window.__PUP;
    if (P2.coverAt) return;
    const boxes = (w.physics?.staticBoxes || []).filter((b) => !b.disabled);
    P2.coverAt = P2.line.map((e, i) => {
      const at = e.netTarget;
      let best = null, bd = 20 * 20;
      for (const b of boxes) {
        const dx = b.center.x - at.x, dz = b.center.z - at.z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = b; }
      }
      /* THE LEE IS THE SIDE AWAY FROM THE ENEMY, who are at +Z for the whole
       * of this script — a body that takes cover on the near face of a rock is
       * a body standing in the open with a rock behind it. */
      const used = P2.lee.get(best) || 0;
      if (best && used < 3) {
        P2.lee.set(best, used + 1);
        const a = Math.PI + (used % 2 ? 1 : -1) * Math.ceil(used / 2) * 0.34;
        const r = best.radius + 1.1;
        return { x: best.center.x + Math.sin(a) * r, z: best.center.z + Math.cos(a) * r };
      }
      return { x: at.x + (i % 2 ? 3.1 : -3.1) + (i % 3) * 0.8, z: at.z - 3.6 - (i % 4) * 1.3 };
    });
  };

  /** ADVANCE distance, in metres, as a function of t. One pace: 1.35 m/s. */
  const advanceAt = (t) => (t <= 5 ? 0 : t >= 18 ? 17.6 : (t - 5) * 1.35);
  /** FALL BACK distance, backward, from t = 46. */
  const backAt = (t) => (t <= 46 ? 0 : Math.min(11.5, (t - 46) * 1.15));

  /**
   * PULL A TRIGGER — and it takes the world's OWN bolt pool, which is the one
   * thing this file got wrong that a screenshot could not show it.
   *
   * `Enemy._shoot(ctx)` reads exactly one field off its argument,
   * `ctx.bolts.fire(...)`, and the first version of this probe handed it `{}`
   * inside a try/catch. Every shot threw `Cannot read properties of undefined
   * (reading 'fire')`, the catch swallowed all eighteen, and the VOLLEY plate
   * came back looking exactly like the HALT plate — a kneeling rank and no
   * bolts. It read as a finding about the game (bolts too thin to see at 20 m
   * on an orange ground) and it was a defect in the instrument, which is
   * HANDOFF §2.5's whole subject: four of one day's apparent game defects were
   * harnesses lying. It was caught by driving `_shoot` on a bench and printing
   * the exception instead of believing the picture.
   *
   * So the trigger takes the real pool and NOTHING is swallowed: a throw is
   * counted and surfaced in the manifest, because a silent catch around the
   * one call this script makes into the game is the only place a beat can fail
   * without the beat sheet noticing.
   */
  const fire = (e) => {
    if (!e || e.dead) return;
    try { e._shoot({ bolts: w.bolts }); window.__PUP.shots++; }
    catch (err) { window.__PUP.misfires.push(String(err && err.message || err)); }
  };

  window.__pose = (t) => {
    const P2 = window.__PUP;
    P2.t = t;
    const adv = advanceAt(t);
    const back = backAt(t);
    const kneel = t >= 19 && t < 46 ? 1 : 0;
    /* The order lands at 37 and the slots are handed out on that frame. */
    if (t >= 37 && !P2.coverAt) window.__takeCover();
    const coverK = ease((t - 37) / 3.2) * (t < 46 ? 1 : 0);
    const dress = ease((t - 54) / 3);

    /* ── THE LINE ────────────────────────────────────────────────────── */
    P2.line.forEach((e, i) => {
      if (e.__downAt != null) return;                  // a casualty stays where he fell
      const rank = i % 2;
      const home = e.__home;
      /* DRESS: after the fall-back the survivors close up on the officer,
       * which is what makes the last plate the same line rather than a
       * different one. `slot` is recomputed over the LIVING, so the hole in
       * the rank closes. */
      const live = P2.line.filter((x) => x.__downAt == null);
      const k = live.indexOf(e);
      const r2 = k % 2, f2 = (k - r2) / 2;
      const dressedX = P2.O.x + (f2 - live.length / 4) * P2.INTERVAL + r2 * P2.INTERVAL * 0.5;
      const dressedZ = P2.O.z - r2 * P2.RANK + adv - back;
      let x = lerp(home.x, dressedX, dress);
      let z = lerp(home.z + adv - back, dressedZ, dress);
      if (coverK > 0 && P2.coverAt) {
        const c = P2.coverAt[i];
        x = lerp(x, c.x, coverK);
        z = lerp(z, c.z, coverK);
      }
      e.netTarget.set(x, P2.gy(x, z), z);
      /* FACING IS INDEPENDENT OF TRAVEL, always. That one property is what
       * makes FALL BACK a fall-back and not a rout. */
      e.netFacing = 0;
      e.crouch = Math.max(rank === 0 ? kneel : 0, coverK);
    });

    /* ── THE OFFICER: stands when the line kneels, advances with it. ──── */
    if (P2.officer) {
      const o = P2.officer;
      const x = P2.O.x, z = P2.O.z - 3.4 + adv - back;
      o.netTarget.set(x, P2.gy(x, z), z);
      o.netFacing = 0;
      o.crouch = 0;
    }

    /* ── THE SUPPORT GUNS: plant, do not advance, are the last to move. ─ */
    P2.heavies.forEach((e) => {
      const x = e.__home.x, z = e.__home.z + Math.min(adv, 4) - Math.max(0, back - 7);
      e.netTarget.set(x, P2.gy(x, z), z);
      e.netFacing = 0;
      e.crouch = t >= 19 ? 0.55 : 0;
    });

    /* ── THE MARKSMEN: detached, static, kneeling from the first beat. ── */
    P2.marks.forEach((e) => {
      e.netTarget.set(e.__home.x, P2.gy(e.__home.x, e.__home.z), e.__home.z);
      e.netFacing = 0.10;
      e.crouch = 1;
    });

    /* ── THE RUNNERS: a different gait on a different bearing. ────────── */
    P2.runners.forEach((e, i) => {
      const phase = t * (i ? 0.9 : 1.35);
      const x = e.__home.x + Math.sin(phase * 0.6) * 3.4;
      const z = e.__home.z + adv * (i ? 0.72 : 1.18) - back * 1.3;
      e.netTarget.set(x, P2.gy(x, z), z);
      e.netFacing = Math.sin(phase * 0.6) * 0.5;
      e.crouch = 0;
    });

    /* ── THE FAR LINE: holds, kneels when the volley starts. ──────────── */
    P2.far.forEach((e) => {
      e.netTarget.set(e.__home.x, P2.gy(e.__home.x, e.__home.z), e.__home.z);
      e.netFacing = Math.PI;
      e.crouch = t >= 24 ? 1 : 0;
    });

    /* ── FIRE. Not a decision — a cadence written into the script. ────── */
    if (t >= 24 && t < 46) {
      /**
       * A VOLLEY IS SYNCHRONISED — that is the whole difference between a
       * firing line and a crowd with rifles, and it is also what makes the
       * beat photographable. The line fires TOGETHER on a 1.5 s cadence from
       * t = 24, so 27.0 is the third volley to the frame; the support guns run
       * their own 0.22 s cadence with a per-gun offset, which is what a
       * sustained gun looks like beside a rank that fires on command.
       *
       * The still catches it because `world.update` is a no-op while the
       * renderer works (see the install): whatever the last script step left —
       * a 0.06 s muzzle flash, a plasma puff, eighteen bolts at 2.9 m off the
       * barrel — is frozen for the four settle frames and photographed intact.
       */
      const VOLLEY = 1.5;
      const rank = P2.line.filter((e) => e.__downAt == null);
      if ((t - 24) % VOLLEY < 1 / 30) for (const e of rank) fire(e);
      P2.heavies.forEach((e, i) => { if ((t + i * 0.05) % 0.22 < 1 / 30) fire(e); });
      P2.far.forEach((e, i) => { if ((t + i * 0.11) % 1.4 < 1 / 30) fire(e); });
    }

    /* ── A MAN GOES DOWN, at 32.0, in the front rank, in the middle. ──── */
    if (t >= 32 && !P2.down.length) {
      /* THE NEAR END OF THE FRONT RANK, so the body that goes down is the one
       * the camera can actually see go down: the line is dressed along X and
       * the eye is off its −X flank, so index 2 is the second file in and the
       * front rank. A casualty mid-rank is a casualty behind seventeen other
       * silhouettes, which is a different beat. */
      const victim = P2.line[2] || P2.line[0];
      if (victim) {
        victim.__downAt = t;
        P2.down.push(victim.name || 'a trooper');
        try {
          victim.die(victim.position.clone(), null, 'bolt');
        } catch (err) { victim.dead = true; victim.hp = 0; }
      }
    }
  };
});

/* ══════════════════════════════════════════════════════════════════════ */
/*  Play it, and render at the beats                                      */
/* ══════════════════════════════════════════════════════════════════════ */

/**
 * THE EYE, AND IT TRACKS THE LINE — which the first set of plates is the
 * argument for.
 *
 * A fixed camera was the obvious choice and it is what `_frontshot.mjs` does,
 * for a good reason there: those plates are ABOUT the ground and have to be the
 * same viewpoint to the pixel or they cannot be put in order. These plates are
 * about BODIES, and the line walks 17.6 m downrange between the second beat and
 * the third. Shot from a fixed eye behind it, the men were 45 px tall at FORM
 * UP and would have been under 30 by the time they knelt — and §11's own number
 * is that below about 19 px only value survives, so the single most important
 * claim in the set (three heights in one silhouette) would have been taken at
 * exactly the range that cannot show it.
 *
 * So the eye holds a STANDOFF from the officer, who is the body every slot is
 * solved from anyway. Every plate is the same distance and the same bearing;
 * what moves is the ground under both.
 */
const EYE = { back: 16, side: -13, height: 4.6, low: 2.1 };

await page.evaluate((E) => {
  const w = window.SABER.world, P = window.__PUP;
  window.__eye = (height) => {
    const c = w.engine.camera;
    /* The line's own centre, read off the officer's live position rather than
     * off the script's arithmetic — one authority, and it is the body the
     * formation is dressed on. */
    const cz = (P.officer ? P.officer.position.z : P.O.z - 3.4) + 3.4;
    const x = P.O.x + E.side, z = cz - E.back;
    const y = P.gy(x, z) + height;
    const tx = P.O.x + 1, tz = cz + 6, ty = P.gy(tx, tz) + 1.2;
    c.position.set(x, y, z);
    c.lookAt(tx, ty, tz);
    c.fov = 55;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  };
}, EYE);

const playTo = (t) => page.evaluate((target) => {
  const w = window.SABER.world, P = window.__PUP;
  const dt = 1 / 30;
  let steps = 0;
  while (P.t < target - 1e-6 && steps < 4000) {
    const t = Math.min(target, P.t + dt);
    window.__pose(t);
    w.__realUpdate(dt, window.SABER.input);
    /* NOTHING ELSE IS ALLOWED ON THE FIELD. The sandbox composes nothing at
     * count 0, but a probe that assumes that is a probe that stops being true
     * the day something else spawns. */
    for (let i = w.enemies.length - 1; i >= 0; i--) if (!w.enemies[i].__puppet) w.enemies.splice(i, 1);
    steps++;
  }
  return { t: +P.t.toFixed(2), steps, alive: w.enemies.filter((e) => !e.dead).length,
    down: P.down.slice(), shots: P.shots, misfires: P.misfires.slice(0, 3),
    bolts: w.bolts?.bolts?.filter?.((b) => b && b.active).length ?? -1 };
}, t);

const manifest = { step: 3, seed: SEED, quality: QUALITY, settle: SETTLE,
  viewport: [WIDTH, HEIGHT], eye: EYE, roster: setup, beats: [] };

/* THE FIRST BEAT IS ALSO THE PROBE'S OWN TRIPWIRE. Nine plates is roughly six
 * minutes of SwiftShader, and the first version of this file spent all of it
 * photographing an empty plain because the mode's own director had retired the
 * cast. A run that has lost its puppets stops on the first beat and says so. */
let firstBeat = true;
for (const b of BEATS) {
  const state = await playTo(b.at);
  if (firstBeat) {
    firstBeat = false;
    if (state.alive < 30) {
      say(`\nONLY ${state.alive} PUPPETS SURVIVED THE FIRST ${b.at} SECONDS — `
        + 'something in the world is retiring them. Nothing else is worth rendering.');
      await browser.close(); server.close();
      process.exit(1);
    }
  }
  await page.evaluate((h) => window.__eye(h), b.file.includes('eye-level') ? EYE.low : EYE.height);
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  }, SETTLE);
  const file = join(OUT, b.file + '.png');
  await page.screenshot({ path: file, timeout: 300000 });
  say(`  ${b.at.toFixed(1).padStart(5)}s  ${b.name}  →  ${b.file}.png  `
    + `(${state.alive} standing, ${state.shots} shots fired, ${state.bolts} bolts live`
    + `${state.misfires.length ? `, MISFIRE: ${state.misfires[0]}` : ''})`);
  manifest.beats.push({ ...b, standing: state.alive, fallen: state.down, steps: state.steps,
    shots: state.shots, boltsInAir: state.bolts, misfires: state.misfires });
}

const tail = await playTo(60);
manifest.played = tail.t;
manifest.errors = errors.slice(0, 12);
await writeFile(join(OUT, 'step3-manifest.json'), JSON.stringify(manifest, null, 2));
say(`\nplayed ${tail.t}s · ${BEATS.length} plates in ${OUT}`);
if (errors.length) say(`page errors: ${errors.length}\n  ${errors.slice(0, 6).join('\n  ')}`);

await browser.close();
server.close();
