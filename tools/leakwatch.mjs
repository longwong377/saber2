/**
 * BATTLEFRONT BORZ — where does a long session go wrong?
 *
 * "The longer you play the more laggy it gets until it completely freezes."
 * That is unbounded growth, and no quality setting fixes it. Nothing in the
 * repo watched for it: smoke.mjs samples renderer.info.render.calls and
 * .triangles, but those are PER-FRAME counters that reset every frame. The
 * numbers that actually accumulate — allocated geometries, allocated textures,
 * compiled programs, scene-graph size, physics bodies, heap — were never
 * sampled by anything.
 *
 * This drives the REAL game loop in-page and samples those on a cadence. It
 * deliberately does not render most steps: the growth we are hunting is driven
 * by simulation events, not by frames drawn, and skipping the draw makes a
 * multi-minute session take seconds under SwiftShader. It renders occasionally
 * anyway, because renderer.info only learns about a geometry when something
 * draws it.
 *
 *   node tools/leakwatch.mjs [--level arena] [--seconds 240] [--samples 12]
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const LEVEL = opt('level', 'arena');
const SECONDS = Number(opt('seconds', 240));
const SAMPLES = Number(opt('samples', 12));
// Rendering every frame is the honest reproduction of a real session; it is far
// slower under SwiftShader, so it is opt-in.
const RENDER = args.includes('--render');
const PORT = 8129;

const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(PORT)], {
  stdio: 'ignore',
});
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const url = `http://127.0.0.1:${PORT}/`;
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.evaluate((level) => {
  localStorage.setItem('saber.settings.v2', JSON.stringify({
    level, quality: 'low', resolutionScale: 0.5, difficulty: 'knight', mode: 'roguelite',
    volume: 0, music: 0, grassScale: 0.5, particleScale: 0.6,
  }));
}, LEVEL);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#menu:not(.hidden)', { timeout: 90000 });
await page.click('#btn-deploy');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 60000 });
await page.waitForTimeout(1500);

console.log(`\n  level ${LEVEL}, ${SECONDS}s simulated, ${SAMPLES} samples\n`);

const rows = await page.evaluate(async ({ seconds, samples, render }) => {
  const S = window.SABER;
  const out = [];
  const DT = 1 / 60;
  const stepsPerSample = Math.max(1, Math.round((seconds / samples) / DT));

  // Count what the scene actually holds, and how many DISTINCT geometries and
  // materials hang off it. Distinct matters: a thousand meshes sharing one
  // geometry is fine, a thousand meshes each with their own is the bug.
  const walk = () => {
    let nodes = 0, meshes = 0;
    const geos = new Set(), mats = new Set(), texs = new Set();
    S.engine.scene.traverse((o) => {
      nodes++;
      if (o.geometry) { meshes++; geos.add(o.geometry.uuid); }
      const m = o.material;
      if (m) for (const mm of (Array.isArray(m) ? m : [m])) {
        mats.add(mm.uuid);
        for (const k of Object.keys(mm)) {
          const v = mm[k];
          if (v && v.isTexture) texs.add(v.uuid);
        }
      }
    });
    return { nodes, meshes, geos: geos.size, mats: mats.size, texs: texs.size };
  };

  const sample = (t) => {
    const w = S.world, info = S.engine.renderer.info;
    const g = walk();
    return {
      t: Math.round(t),
      // allocated GPU resources — these must plateau
      rGeo: info.memory.geometries,
      rTex: info.memory.textures,
      prog: info.programs ? info.programs.length : -1,
      // scene graph
      nodes: g.nodes, meshes: g.meshes, geos: g.geos, mats: g.mats, texs: g.texs,
      // simulation
      bodies: w.physics.stats.bodies,
      colliders: w.physics.stats.colliders,
      enemies: w.enemies.length,
      props: w.props.length,
      debris: w.debris.length,
      statics: w.statics.length,
      bolts: w.bolts ? w.bolts.bolts.filter((b) => b.active).length : -1,
      wave: w.director ? (w.director.wave ?? -1) : -1,
      // Every bolt that hits the ground craters it, which dirties a patch of
      // heightfield and forces the Rapier collider to be rebuilt. Both are
      // per-frame costs that a long firefight could grow without ever growing
      // an object count, which is exactly the shape of "it gets slower".
      craters: w.terrain ? (w.terrain.deformSeq ?? -1) : -1,
      // live particles, summed over every pool the world owns
      parts: (() => {
        const P = w.particles; if (!P) return -1;
        let n = 0;
        for (const k of Object.keys(P)) {
          const v = P[k];
          if (v && typeof v.count === 'number') n += v.count;
          else if (v && Array.isArray(v.items)) n += v.items.filter((x) => x && x.alive).length;
        }
        return n;
      })(),
      // JS heap, in MB
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
    };
  };

  out.push({ ...sample(0), updMs: -1, updP95: -1, rndMs: -1 });
  let t = 0;
  for (let s = 0; s < samples; s++) {
    const ups = [], rends = [];
    for (let i = 0; i < stepsPerSample; i++) {
      // Keep the player swinging and the enemies shooting — the events that
      // drive particles, deflections, craters and audio are what we are here
      // to watch, and a world nobody is fighting in proves nothing.
      S.input.mouse.dx += 40 * Math.sin(t * 7.3);
      S.input.mouse.dy += 22 * Math.cos(t * 5.1);
      S.input.mouse.down = (i % 90) < 45;
      const t0 = performance.now();
      try { S.world.update(DT, S.input); } catch (e) { return { error: String(e.message || e), out }; }
      const t1 = performance.now();
      ups.push(t1 - t0);
      // Absolute frame time under SwiftShader is meaningless, but frame time
      // DEGRADING AGAINST ITSELF over a session is exactly the symptom being
      // chased, and software rendering is perfectly honest about that.
      if (render) {
        try { S.engine.render(DT); } catch (e) { /* SwiftShader hiccup */ }
        rends.push(performance.now() - t1);
      }
      t += DT;
    }
    // renderer.info only counts a geometry once something has drawn it
    if (!render) { try { S.engine.render(DT); } catch (e) {} }
    const med = (a) => { if (!a.length) return -1; a.sort((x, y) => x - y); return +a[a.length >> 1].toFixed(2); };
    const p95 = (a) => { if (!a.length) return -1; a.sort((x, y) => x - y); return +a[Math.floor(a.length * 0.95)].toFixed(2); };
    out.push({ ...sample(t), updMs: med(ups), updP95: p95(ups), rndMs: med(rends) });
    await new Promise((r) => setTimeout(r, 0));
  }
  return { out };
}, { seconds: SECONDS, samples: SAMPLES, render: RENDER });

if (rows.error) console.log(`  world.update threw: ${rows.error}\n`);

const data = rows.out || [];
if (data.length) {
  const cols = Object.keys(data[0]);
  const w = cols.map((c) => Math.max(c.length, ...data.map((r) => String(r[c]).length)));
  console.log('  ' + cols.map((c, i) => c.padStart(w[i])).join('  '));
  for (const r of data) console.log('  ' + cols.map((c, i) => String(r[c]).padStart(w[i])).join('  '));

  // Anything that ends far above where it started, and never came back down,
  // is the thing to go and look at.
  console.log('\n  growth from first sample to last:');
  const a = data[0], b = data[data.length - 1];
  for (const c of cols) {
    if (c === 't' || a[c] < 0) continue;
    const d = b[c] - a[c];
    if (d === 0) continue;
    const pct = a[c] > 0 ? ` (${d > 0 ? '+' : ''}${Math.round((d / a[c]) * 100)}%)` : '';
    const flag = d > 0 && (a[c] === 0 || d / Math.max(1, a[c]) > 0.5) ? '   <-- look here' : '';
    console.log(`    ${c.padEnd(10)} ${String(a[c]).padStart(8)} -> ${String(b[c]).padStart(8)}${pct}${flag}`);
  }
}

if (errors.length) {
  console.log(`\n  ${errors.length} page error(s):`);
  for (const e of [...new Set(errors)].slice(0, 8)) console.log('   ✖ ' + e.slice(0, 300));
}

await browser.close();
stop();
