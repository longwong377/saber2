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
  window.__frame = (ms = 60000) => new Promise((res, rej) => {
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

  const card = page.locator('#mode-list .diff', { hasText: 'The Line' }).first();
  record.cardCount = await card.count();
  if (!record.cardCount) throw new Error('there is no card called The Line in the Mode list');
  await card.scrollIntoViewIfNeeded();
  await card.click({ timeout: 20000 });
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
