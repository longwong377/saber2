/**
 * BATTLEFRONT BORZ — the instrument that measures the frame has to be right about it.
 *
 * The player's first complaint about this game was that it ran badly and got
 * worse the longer they played. That complaint is weeks old and has never been
 * measured, because the only renderer this project's tooling can reach is a
 * software rasterizer at about one frame per second — so every performance
 * claim ever made here is a BUDGET (draw calls, instance counts, triangles) and
 * never a millisecond.
 *
 * The profiler exists so a two-minute playtest on real hardware produces the
 * number instead. Which means the profiler itself is now load-bearing: if it
 * reports a comfortable average while the player is hitching, it is worse than
 * having nothing, because it launders the complaint into "works on my machine".
 *
 * So these checks are about the statistics, not the plumbing. The one that
 * matters most is the last: a build that averages 8 ms and spikes to 40 four
 * times a second must NOT be able to look smooth here.
 */
import { Profiler } from '../../src/engine/Profiler.js';

/** A Profiler with no GL behind it — the stats path is pure arithmetic. */
function headless() {
  const info = { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 }, programs: [] };
  const p = new Profiler({ info, getContext: () => null });
  return p;
}

/** Feed a sequence of frame times, in ms, as if they were real frames. */
function feed(p, ms) {
  let clock = 1000;
  for (const dt of ms) {
    clock += dt;
    p.begin(clock);
    p.end();
  }
  return p;
}

export async function run({ check, assert }) {
  check('profiler: a steady frame rate reports itself honestly', () => {
    const p = feed(headless(), Array(400).fill(16.67));
    const s = p.stats();
    assert(s, 'no statistics after 400 frames');
    assert(Math.abs(s.mean - 16.67) < 0.2, `mean read ${s.mean.toFixed(2)} ms for a flat 16.67`);
    assert(Math.abs(s.fps - 60) < 1, `fps read ${s.fps.toFixed(1)} for a flat 16.67 ms`);
    return `${s.frames} frames, mean ${s.mean.toFixed(2)} ms, ${s.fps.toFixed(1)} fps`;
  });

  check('profiler: the first frames after a load cannot become the session worst', () => {
    // A load frame is hundreds of milliseconds and says nothing about how the
    // game runs. If it were allowed into `worst`, every session would report the
    // same meaningless spike and the number would stop meaning anything.
    const p = headless();
    feed(p, [900, 400, 250, 16.7, 16.7, 16.6, 16.8]);
    assert(p.worst < 100, `a load frame became the session worst: ${p.worst.toFixed(0)} ms`);
    return `worst after a 900/400/250 ms load is ${p.worst.toFixed(1)} ms`;
  });

  check('profiler: a hitch is visible in the 1% low even when the mean is fine', () => {
    // THE CHECK THIS SUITE EXISTS FOR. 4 hitches a second on top of a 120 fps
    // build: the mean barely moves, and the game feels broken. If the readout
    // cannot separate these two builds, it will confirm "runs fine" to a player
    // who is telling us it does not.
    const smooth = [], hitchy = [];
    for (let i = 0; i < 600; i++) {
      smooth.push(8.3);
      hitchy.push(i % 15 === 0 ? 42 : 8.3);
    }
    const a = feed(headless(), smooth).stats();
    const b = feed(headless(), hitchy).stats();
    const meanGap = b.mean - a.mean;
    const lowGap = b.low1 - a.low1;
    assert(lowGap > 25, `the 1% low moved only ${lowGap.toFixed(1)} ms for a 42 ms hitch every 15 frames`);
    assert(lowGap > meanGap * 4,
      `the mean moved ${meanGap.toFixed(1)} ms and the 1% low ${lowGap.toFixed(1)} — `
      + 'the readout cannot tell a hitching build from a smooth one');
    return `mean ${a.mean.toFixed(1)} -> ${b.mean.toFixed(1)} (+${meanGap.toFixed(1)}), `
      + `1% low ${a.low1.toFixed(1)} -> ${b.low1.toFixed(1)} (+${lowGap.toFixed(1)})`;
  });

  check('profiler: the window is bounded, so a long session cannot grow it', () => {
    // The complaint is specifically that it degrades over time, so this thing
    // will be left running for a long time. Its own history must not be the
    // leak. 600 samples is ten seconds at 60 Hz and three fixed typed arrays.
    const p = feed(headless(), Array(5000).fill(16.7));
    const s = p.stats();
    assert(s.frames <= 600, `the window grew to ${s.frames} samples over 5000 frames`);
    assert(p.frames.length === 600 && p.cpus.length === 600 && p.gpus.length === 600,
      'the history buffers are not fixed-size');
    return `5000 frames in, the window holds ${s.frames} samples in 3 fixed arrays`;
  });

  check('profiler: an unavailable GPU timer reports as unavailable, never as zero', () => {
    // A GPU that will not answer is common — Apple hardware, and anything that
    // treats timer queries as a fingerprinting vector. Reporting 0.00 ms would
    // read as "the GPU is free, it must be the CPU", which is the exact wrong
    // conclusion to hand someone.
    const p = feed(headless(), Array(50).fill(16.7));
    assert(p.gpuMs === null, `gpuMs is ${p.gpuMs} with no timer query available`);
    const text = p.report();
    assert(/gpu\s+unavailable/.test(text), `the report does not say the GPU time is unavailable:\n${text}`);
    assert(!/gpu\s+0\.00/.test(text), 'the report shows a GPU time of 0.00 ms when there is no timer');
    return 'gpuMs is null and the report says "unavailable"';
  });

  check('profiler: the report carries the context a diagnosis needs', () => {
    const p = feed(headless(), Array(200).fill(11.1));
    const text = p.report({ level: 'arena', quality: 'high' });
    for (const want of ['frame', '1% low', 'p99', 'cpu', 'gpu', 'draw', 'level', 'quality']) {
      assert(text.includes(want), `the report omits "${want}":\n${text}`);
    }
    assert(text.split('\n').length >= 6, 'the report is too short to be worth pasting');
    return `${text.split('\n').length} lines, carries level and quality`;
  });
}
