/**
 * BATTLEFRONT BORZ — the clock a timing check on THIS box has to use.
 *
 * ── THE PROBLEM, MEASURED ────────────────────────────────────────────────
 *
 * HANDOFF §2.6 and §2.6b say a millisecond taken on a loaded box is not a slow
 * result, it is no result — and the whole of the advice that follows is "run
 * `uptime` first and don't quote the number". That is right and it is not
 * enough: it leaves every timing check in the gate red whenever a peer lane is
 * working, which is most of the time, and a check that is red for a reason
 * nobody can act on is a check nobody reads.
 *
 * The measurement that fixes it. One fixed 200 000-iteration arithmetic loop,
 * alternate samples, taken while eleven peer node processes were live on this
 * four-core box at a load average of 41:
 *
 *     wall ms  0.441  0.456  0.431  0.471  28.551  0.457  0.416  …  24.881
 *     cpu  ms  0.441  0.453  0.428  0.467   0.559  0.454  0.416  …   0.443
 *
 * `performance.now()` says the same work got up to 60x more expensive. It did
 * not; the process was descheduled and the clock kept running.
 * `process.cpuUsage()` counts only the time this process was ON a core, so it
 * is nearly flat across the same samples. The residual — 0.44 to 0.56 on the
 * worst sample, about 25% — is cache pressure from the other tenants, and that
 * is the honest error bar left on anything measured this way.
 *
 * So: a check that wants to say "this subsystem costs N milliseconds a frame"
 * measures CPU. A check that wants to say "this box is busy" measures both and
 * divides, which is what `contention` is for.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 *
 * It is not a licence to put clocks in checks. The rule this project keeps
 * arriving at — in `cloth-cost.mjs`'s header, in `_framecost.mjs`'s, in §2.6 —
 * is that a COUNT is the same number on every machine and a millisecond is one
 * machine's. That still holds, and a check whose subject can be counted should
 * count it. This is for the cases where the quantity really is time: a budget
 * in milliseconds a frame is a claim about time and cannot be restated as a
 * count without restating the rule, which is §2.4's trap.
 *
 * ── COST ─────────────────────────────────────────────────────────────────
 *
 * `process.cpuUsage()` is a `getrusage` syscall: ~3.7 us a call on this box
 * under load, against ~0.5 us for `process.hrtime.bigint()`. Two calls per
 * wrapped call, so wrapping something invoked 40 times a frame over 400 frames
 * costs about 0.12 s in total and nothing that shows up in the reading itself.
 * Do not wrap a per-particle inner loop with it; wrap the subsystem.
 */

/** Total CPU this process has burned, user + system, in milliseconds. */
export function cpuMs() {
  const c = process.cpuUsage();
  return (c.user + c.system) / 1000;
}

/**
 * Start a window. `stop()` returns `{ cpu, wall, contention }` in milliseconds,
 * where `contention` is wall/cpu — 1.0 on an idle box, and the factor by which
 * every wall-clock figure taken in that window is inflated on a busy one.
 */
export function window_() {
  const c0 = cpuMs(); const w0 = performance.now();
  return {
    stop() {
      const wall = performance.now() - w0;
      const cpu = cpuMs() - c0;
      return { cpu, wall, contention: cpu > 0 ? wall / cpu : 1 };
    },
  };
}

/**
 * Wrap `obj[key]` so every call adds its CPU cost to `sink[name]`.
 *
 * Returns a function that puts the original method back — a check that patches
 * a shared prototype and does not is HANDOFF §2.9's defect, and this makes the
 * `finally` one line.
 */
export function meterCpu(obj, key, sink, name = key) {
  const real = obj[key];
  if (typeof real !== 'function') return () => {};
  if (!(name in sink)) sink[name] = 0;
  obj[key] = function (...a) {
    const t = cpuMs();
    try { return real.apply(this, a); } finally { sink[name] += cpuMs() - t; }
  };
  return () => { obj[key] = real; };
}

/**
 * How loaded the box is, for a check's own message.
 *
 * §2.6b asks for exactly this next to every millisecond that gets quoted, and a
 * check that prints it cannot have the number read out of context later.
 */
export async function boxLoad() {
  try {
    const os = await import('node:os');
    return { load: os.loadavg()[0], cores: os.cpus().length };
  } catch { return { load: NaN, cores: NaN }; }
}

/** `boxLoad` as one phrase, ready to append to an assertion message. */
export async function loadPhrase() {
  const { load, cores } = await boxLoad();
  return Number.isFinite(load) ? `load ${load.toFixed(1)} on ${cores} cores` : 'load unknown';
}
