/**
 * BATTLEFRONT BORZ — THE LINE, ON A SCREEN, PLAYED THE WAY A PLAYER PLAYS IT.
 *
 *   node --import ./tools/register.mjs tools/_lineeye.mjs [--seed 5] [--secs 46]
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * Everything proven about `MODES.theline` — the win rule, the seeded ground,
 * the generated heightfield, the marching front, the levy of forty, the LOD
 * ladder — was measured HEADLESS. `frontdoor.mjs` is the only check in the tree
 * that boots the real page and it deploys onto whatever the default profile
 * picks, which is never this mode. So the flagship mode had never been drawn.
 *
 * That matters more here than it would elsewhere because the mode's content is
 * things you are meant to SEE: FLAGSHIP §3 calls the front "the one-way visible
 * variable", §12.4 prices the wrecks as the biggest draw-call item on Geonosis,
 * and §13 argues that if the front fails to read, the name list is the fallback
 * spine. A headless check cannot see a black silhouette, a hull under the
 * terrain, a nameplate on nothing, or a front dressed behind the player.
 *
 * ── HOW IT REACHES THE MODE ─────────────────────────────────────────────
 *
 * Through the front end, exactly as a player does: the Play panel, the Mode
 * list, the card that says The Line, the seed box, Ignite, the deploy card,
 * Drop. Nothing is set through `localStorage` except the two volume sliders,
 * because the route IS the thing under test — a mode that cannot be picked with
 * a mouse is not a mode, however green its checks are.
 *
 * ── EVERY WAIT IS IN FRAMES OR GAME-SECONDS, NEVER IN WALL CLOCK ────────
 *
 * HANDOFF §2.6: one frame through swiftshader on an empty field is 4151 ms, and
 * `main.js` clamps dt to 0.1 s, so a rendered frame is at most a tenth of a
 * game-second. The insertion alone is ORBIT 7 + ENTRY 6.5 + FALL 9 + DESCENT 6
 * + UNLOAD 2 ≈ 30 game-seconds ≈ 300 frames, which is twenty minutes here. The
 * probe therefore reports as it goes and shoots at every beat, so a run that is
 * killed halfway still leaves the plates it had reached.
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler } from './serve.mjs';
import { chromiumPath, CHROME_ARGS } from './checks/_browser.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SEED = flag('seed', '5');
const SECS = Number(flag('secs', '46'));
const W = Number(flag('width', '1280'));
const H = Number(flag('height', '720'));
const TAG = flag('tag', `seed${SEED}`);
/* The shipped `opt-instant-spawn` checkbox, ticked the way a player ticks it.
 * It makes `Extraction.beginInsertion` decline (Extraction.js:423), so the run
 * opens standing on the ground instead of 2 400 m over it. Thirty game-seconds
 * of insertion is three hundred rendered frames here, which is the difference
 * between a probe that finishes and one that does not — and the flight itself
 * is what `frontdoor.mjs` already asserts, so this arm spends its frames on the
 * thing nothing has ever looked at. */
const INSTANT = argv.includes('--instant');
const OUT = join(ROOT, '.line', TAG);
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);
const T0 = Date.now();
const record = {};
const shots = [];

await mkdir(OUT, { recursive: true });
const server = createServer(handler);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROME_ARGS });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(600000);
page.setDefaultNavigationTimeout(600000);
const errs = [];
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
page.on('response', (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });

/* NO WALL-CLOCK CEILING ON A SCREENSHOT. Playwright's default is 30 s and a
 * menu frame through swiftshader on a loaded box measured over that — the first
 * run of this probe died on `page.screenshot: Timeout 30000ms exceeded` with
 * the game working perfectly. HANDOFF §2.6's rule, in the one place it is easy
 * to forget because the wait is inside somebody else's library. */
const shot = async (name) => {
  const p = join(OUT, `${name}.png`);
  await page.screenshot({ path: p, timeout: 0 });
  shots.push(`${TAG}/${name}.png`);
  log('shot', name);
};

/* A frame, or an error — never a wait with no bound (smoke.mjs's argument). */
await page.addInitScript(() => {
  /* FIVE MINUTES, and that is not a wall-clock budget dressed as a ceiling —
   * it is the only bound that keeps a stopped render loop from hanging the
   * probe for ever. The first run of this arm died at `no animation frame in
   * 60000 ms` on a game that was drawing perfectly: one frame of the flagship
   * mode with the levy on the field, at 1280x720 through swiftshader, on a box
   * carrying a load average of 40 from a dozen other lanes. HANDOFF §2.6. */
  window.__frame = (ms = 300000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no animation frame in ${ms} ms`)), ms);
    requestAnimationFrame(() => { clearTimeout(t); res(); });
  });
  window.__play = async (gameSeconds, maxFrames = 2000) => {
    const w = window.SABER?.world;
    if (!w) throw new Error('no world to play');
    const t0 = w.time; let n = 0; let worst = 0; let sum = 0;
    while (w.time - t0 < gameSeconds && n < maxFrames) {
      const a = performance.now();
      await window.__frame();
      const ms = performance.now() - a;
      sum += ms; worst = Math.max(worst, ms); n++;
    }
    return { frames: n, played: +(w.time - t0).toFixed(2),
      meanMs: +(sum / Math.max(1, n)).toFixed(0), worstMs: +worst.toFixed(0) };
  };
});

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  /* The two sliders only — everything else is picked with the mouse below. */
  await page.evaluate(() => localStorage.setItem('saber.settings.v2',
    JSON.stringify({ volume: 0, music: 0 })));
  await page.reload({ waitUntil: 'load' });
  log('navigated, waiting for the boot screen to go away');
  await page.waitForFunction(
    () => document.getElementById('boot')?.classList.contains('hidden')
      && document.querySelectorAll('.menu-tabs .tab').length >= 7, null, { timeout: 300000 });
  log('menu up');
  await shot('01-menu-default');

  /* ── CAN THE CARD BE CLICKED AT ALL? index.html's own note measures the
   * pinned Ignite button covering the bottom of this list at 1280x720, so ask
   * the browser what is on top of every mode card before clicking one. */
  record.modeCards = await page.evaluate(() => {
    const out = [];
    for (const card of document.querySelectorAll('#mode-list .diff')) {
      const r = card.getBoundingClientRect();
      let hit = 0, n = 0;
      for (let iy = 1; iy <= 3; iy++) {
        for (let ix = 1; ix <= 5; ix++) {
          const x = r.left + (r.width * ix) / 6, y = r.top + (r.height * iy) / 4;
          n++;
          const el = document.elementFromPoint(x, y);
          if (el && (el === card || card.contains(el))) hit++;
        }
      }
      out.push({ name: card.querySelector('b')?.textContent ?? '?',
        visible: +(hit / n).toFixed(2),
        top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) });
    }
    return out;
  });
  log('mode cards:', JSON.stringify(record.modeCards));

  if (INSTANT) {
    await page.click('.tab[data-tab="opts"]');
    const box = page.locator('#opt-instant-spawn');
    await box.scrollIntoViewIfNeeded();
    await box.check({ timeout: 400000 });
    await page.click('.tab[data-tab="play"]');
    log('instant spawn ticked in Options');
  }
  const card = page.locator('#mode-list .diff', { hasText: 'The Line' }).first();
  record.cardCount = await card.count();
  if (!record.cardCount) throw new Error('there is no card called The Line in the Mode list');
  await card.scrollIntoViewIfNeeded();
  /* NO 20-SECOND CEILING ON A CLICK EITHER. Playwright waits for an element to
   * be "stable" across two animation frames before it presses it, and two frames
   * here is over a minute — the first run reported `locator.click: Timeout
   * 20000ms exceeded` on a card that is perfectly clickable. Same trap as the
   * screenshot above, one library call further down. */
  await card.click({ timeout: 400000 });
  log('clicked The Line');
  /* The seed box, typed as a player types it. */
  await page.fill('#opt-seed', SEED);
  await shot('02-menu-theline');
  record.afterPick = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('#mode-list .diff')]
      .filter((d) => d.classList.contains('sel')).map((d) => d.querySelector('b')?.textContent);
    const note = document.getElementById('level-note');
    return { selected: sel, levelNoteHidden: note?.classList.contains('hidden') ?? null,
      levelNote: note?.textContent ?? null,
      levelCards: document.querySelectorAll('#level-list .card').length,
      seedBox: document.getElementById('opt-seed')?.value ?? null,
      saved: JSON.parse(localStorage.getItem('saber.settings.v2') || '{}') };
  });
  log('after pick:', JSON.stringify(record.afterPick).slice(0, 400));

  /* ── IGNITE. */
  await page.click('#btn-deploy');
  log('pressed Ignite; waiting for the deploy card');
  await page.waitForFunction(() => {
    const c = document.getElementById('deploy-card');
    return c && !c.classList.contains('hidden');
  }, null, { timeout: 600000 });
  await shot('03-deploy-card');
  record.card = await page.evaluate(() => {
    const c = document.getElementById('deploy-card');
    const w = window.SABER?.world;
    const cmd = w?.command;
    const txt = (sel) => [...c.querySelectorAll(sel)].map((e) => e.textContent.trim());
    return {
      text: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 1200),
      plan: document.getElementById('deploy-plan')?.textContent ?? null,
      ground: document.getElementById('deploy-ground')?.textContent ?? null,
      blurb: document.getElementById('deploy-blurb')?.textContent ?? null,
      stage: document.getElementById('deploy-stage')?.textContent ?? null,
      stages: txt('#deploy-stages li'),
      seed: document.getElementById('deploy-seed')?.textContent ?? null,
      strength: document.getElementById('deploy-strength')?.textContent ?? null,
      rollHead: document.getElementById('deploy-roll-head')?.textContent ?? null,
      names: [...c.querySelectorAll('#deploy-list .dep-row')]
        .map((r) => `${r.querySelector('b')?.textContent} / ${r.querySelector('span')?.textContent}`),
      html: c.innerHTML.length,
      world: {
        runSeed: w?.runSeed ?? null, levelKey: w?.levelKey ?? null,
        levelName: w?.level?.name ?? null,
        battlefield: w?.battlefield ? {
          reason: w.battlefield.reason, choke: w.battlefield.choke,
          bearing: w.battlefield.bearing ?? null,
          keys: Object.keys(w.battlefield).slice(0, 20),
        } : null,
        plan: cmd?.plan ?? null, stages: cmd?.stages ?? null,
        crossing: !!cmd?.crossing, holdTheLine: !!cmd?.holdTheLine,
        roster: cmd?.roster?.summary?.()?.roll?.map?.((m) => `${m.rank} ${m.name} (${m.unit})`) ?? null,
        paused: !!w?.paused,
      },
    };
  });
  log('deploy card:', JSON.stringify(record.card.world).slice(0, 700));
  log('card text:', record.card.text.slice(0, 500));

  /* ── DROP. */
  await page.click('#btn-deploy-drop');
  log('pressed Drop');
  await page.evaluate(() => window.__frame());
  record.afterDrop = await page.evaluate(() => {
    const w = window.SABER?.world;
    return { cardHidden: document.getElementById('deploy-card')?.classList.contains('hidden'),
      paused: !!w?.paused, phase: w?.extraction?.phase ?? null,
      hudHidden: document.getElementById('hud')?.classList.contains('hidden') ?? null };
  });
  log('after drop:', JSON.stringify(record.afterDrop));
  await shot('04-dropped');

  /* ── THE SURVEY. Where is the front, and can the player see it?
   *
   * The geometry is asked of `Front.engagementFront` — the shipped function
   * `marchTo` itself dresses off — and never restated here (HANDOFF §2.4). The
   * page can `import()` it because the server is serving the same tree.
   *
   * The camera is turned by writing `player.camera.yaw`, which is the field the
   * mouse writes; the rig reads it every frame off input deltas, so with no
   * input it holds. */
  record.survey = await page.evaluate(async () => {
    const S = window.SABER, w = S.world, cmd = w.command;
    const F = await import('/src/world/Front.js');
    const P = await import('/src/world/Props.js');
    const hull = P.propMaterials().hull;
    const front = F.engagementFront(w, cmd?.areaNumber ?? 1);
    const p = w.player.position;
    /* Which side of the line is the PLAYER on, and how far — through the
     * shipped reader rather than a second copy of the half-plane test. */
    const line = F.frontLine(front);
    const me = line.side ? line.side(p.x, p.z) : null;
    const wrecks = w.statics.filter((m) => m.material === hull);
    const near = (o) => Math.hypot(o.position.x - p.x, o.position.z - p.z);
    /* The bearing from the player to the front, so the shots below can look at
     * it: the camera yaw that faces +dir is atan2(dx, dz)-flavoured — taken off
     * the rig's own convention by asking what it currently looks at. */
    return {
      front: { bearing: front.bearing, distance: front.distance,
        offset: front.offset ?? null, engagement: front.engagement ?? null,
        dir: front.dir ? { x: +front.dir.x.toFixed(3), z: +front.dir.z.toFixed(3) } : null },
      player: { x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +p.y.toFixed(1),
        yaw: +(w.player.camera?.yaw ?? 0).toFixed(3), side: me },
      battlefield: w.battlefield ? { reason: w.battlefield.reason,
        choke: { x: +w.battlefield.choke.x.toFixed(1), z: +w.battlefield.choke.z.toFixed(1) },
        bearing: +w.battlefield.bearing.toFixed(3),
        distance: +w.battlefield.distance.toFixed(1) } : null,
      /* WHERE THE PLAYER IS LOOKING, against where the front is. The rig's
       * yaw is a rotation about +Y on a forward of -Z (`CameraRig.syncAim`
       * builds the aim from Euler(pitch, yaw, 0, 'YXZ')), so the yaw that faces
       * the advance is atan2(dir.x, -dir.z) and the difference is how far the
       * player has to turn to see the one-way visible variable. */
      offBy: (() => {
        const want = Math.atan2(front.dir.x, -front.dir.z);
        let d = (w.player.camera?.yaw ?? 0) - want;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return +(d * 180 / Math.PI).toFixed(0);
      })(),
      strewWrecks: typeof w.strewWrecks,
      smokeAir: !!w.smokeAir,
      wreckPieces: wrecks.length,
      wreckNearest: wrecks.length ? +Math.min(...wrecks.map(near)).toFixed(1) : null,
      wreckFarthest: wrecks.length ? +Math.max(...wrecks.map(near)).toFixed(1) : null,
      /* A hull whose lowest corner is under the terrain at its own centre is a
       * wreck buried in the ground — the class of defect no headless check can
       * see and the reason this probe exists. */
      wreckSunk: wrecks.filter((m) => {
        const g = w.terrain.height(m.position.x, m.position.z);
        return m.position.y + 0.5 < g;
      }).length,
      statics: w.statics.length,
      craters: w.craterLog?.marks?.length ?? w.craterLog?.log?.length ?? null,
    };
  });
  log('survey:', JSON.stringify(record.survey));

  /* Look at the front, then sweep the horizon: four bearings, so a front dressed
   * BEHIND the player is visible as such rather than inferred from a number. */
  const sweep = await page.evaluate(({ }) => {
    const w = window.SABER.world;
    return { yaw0: w.player.camera.yaw };
  }, {});
  record.sweepFrom = sweep;
  for (const [name, turn] of [['front', 0], ['right', Math.PI / 2],
    ['back', Math.PI], ['left', -Math.PI / 2]]) {
    await page.evaluate(async ([t]) => {
      const w = window.SABER.world;
      const F = await import('/src/world/Front.js');
      const front = F.engagementFront(w, w.command?.areaNumber ?? 1);
      /* FACE THE FRONT. The rig's yaw is a rotation about +Y applied to a
       * forward of -Z, so the yaw that looks along (dx, dz) is atan2(dx, -dz)
       * — taken from `CameraRig`'s own basis rather than guessed: `syncAim`
       * builds the aim from Euler(pitch, yaw, 0, 'YXZ'). */
      const dx = front.dir.x, dz = front.dir.z;
      w.player.camera.yaw = Math.atan2(dx, -dz) + t;
      w.player.camera.pitch = -0.08;
      await window.__frame();
    }, [turn]);
    await shot(`06-look-${name}`);
  }

  /* ── FRAME COST, with the levy on the field. Draw calls and triangles are
   * machine-independent; the millisecond is not, and the box's own load is
   * recorded beside it so the number can be read honestly. */
  record.cost = await page.evaluate(async () => {
    const S = window.SABER, w = S.world;
    const t = [];
    for (let i = 0; i < 6; i++) {
      const a = performance.now();
      await window.__frame();
      t.push(+(performance.now() - a).toFixed(0));
    }
    t.sort((x, y) => x - y);
    return { ms: t, median: t[t.length >> 1],
      draws: S.engine.renderer.info.render.calls,
      tris: S.engine.renderer.info.render.triangles,
      programs: S.engine.renderer.info.programs?.length ?? null,
      geometries: S.engine.renderer.info.memory.geometries,
      textures: S.engine.renderer.info.memory.textures,
      bodies: w.enemies.length, alive: w.enemies.filter((e) => !e.dead).length,
      quality: w.settings?.quality ?? null };
  });
  log('cost:', JSON.stringify(record.cost));

  /* ── THE FLIGHT AND THE FIGHT, in game-seconds. */
  record.beats = [];
  const beats = [6, 12, 20, 28, 34, 40, SECS].filter((s, i, a) => s <= SECS && a.indexOf(s) === i);
  let done = 0;
  for (const target of beats) {
    const chunk = target - done;
    if (chunk <= 0) continue;
    const r = await page.evaluate((s) => window.__play(s), chunk);
    done = target;
    const state = await page.evaluate(() => {
      const S = window.SABER, w = S?.world, cmd = w?.command;
      const scene = S?.engine?.scene;
      let fallen = 0, smoke = 0;
      scene?.traverse?.((o) => {
        if (o.name === 'fallen') fallen += (o.count ?? 0);
        if (o.name === 'smoke-columns') smoke++;
      });
      return {
        t: +(w?.time ?? 0).toFixed(1), phase: w?.extraction?.phase ?? null,
        flying: !!w?.extraction?.active,
        py: +(w?.player?.position?.y ?? 0).toFixed(1),
        enemies: w?.enemies?.length ?? -1,
        alive: w?.enemies?.filter?.((e) => !e.dead).length ?? -1,
        friends: w?.enemies?.filter?.((e) => !e.dead && e.team === w.player?.team).length ?? -1,
        area: cmd?.area ?? null, marched: cmd?._marched ?? null,
        living: cmd?.roster?.living?.length ?? null,
        strength: cmd?.roster?.strength ?? null,
        draws: S?.engine?.renderer?.info?.render?.calls ?? 0,
        tris: S?.engine?.renderer?.info?.render?.triangles ?? 0,
        statics: w?.physics?.staticBoxes?.length ?? -1,
        props: w?.props?.length ?? -1,
        fallenInstances: fallen, smokeMeshes: smoke,
        namePlates: document.getElementById('troopnames')?.children?.length ?? -1,
        nameText: [...(document.getElementById('troopnames')?.children ?? [])]
          .slice(0, 4).map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
        rosterHidden: document.getElementById('roster')?.classList.contains('hidden') ?? null,
        rosterRows: document.querySelectorAll('#rp-list .rp-row, #rp-list > *').length,
        rosterStrength: document.getElementById('rp-strength')?.textContent ?? null,
      };
    });
    record.beats.push({ target, ...r, ...state });
    log(`beat ${target}s:`, JSON.stringify({ ...r, ...state }));
    await shot(`05-t${String(target).padStart(2, '0')}`);
  }

  await writeFile(join(OUT, 'record.json'), JSON.stringify({ ...record, errs, shots }, null, 2));
  log('errors:', errs.length, errs.slice(0, 8));
} catch (e) {
  log('FAILED:', e.message);
  try { await shot('99-failure'); } catch {}
  await writeFile(join(OUT, 'record.json'),
    JSON.stringify({ ...record, fail: String(e.message), errs, shots }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
