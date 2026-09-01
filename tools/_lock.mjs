/**
 * ONE HEAVY JOB AT A TIME, ENFORCED WHERE IT CANNOT BE BYPASSED.
 *
 * `tools/_render.sh` wraps a command in `flock`, and it only works if every
 * caller remembers to use it. Measured: they do not. Four Chromium jobs and
 * forty-four processes put this four-core container at load 25, at which point
 * a screenshot that takes ninety seconds takes twenty minutes and reads as a
 * hang — the failure is not an error, it is a job that stops finishing.
 *
 * So the tool takes the lock itself. `await hold()` at the top of a render
 * script and there is no way to forget.
 */
import { open } from 'node:fs/promises';

const LOCK = '/tmp/saber-render.lock.d';

/** Wait for the lock, take it, and release it when the process exits. */
export async function hold(name = 'job', waitMs = 2400000) {
  const { mkdir, rm, writeFile } = await import('node:fs/promises');
  const t0 = Date.now();
  for (;;) {
    try {
      /* `mkdir` is the atomic primitive every POSIX filesystem has: it either
       * creates the directory or fails with EEXIST, and there is no window
       * between the test and the take. A lock FILE opened with 'wx' would do
       * as well; a directory also survives a crash visibly. */
      await mkdir(LOCK);
      await writeFile(`${LOCK}/who`, `${name} pid ${process.pid}\n`).catch(() => {});
      const free = () => { try { rm(LOCK, { recursive: true, force: true }); } catch {} };
      process.on('exit', free);
      process.on('SIGINT', () => { free(); process.exit(130); });
      process.on('SIGTERM', () => { free(); process.exit(143); });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - t0 > waitMs) {
        /* A LOCK HELD BY A DEAD PROCESS IS NOT A LOCK. Past the deadline, take
         * it: the alternative is a queue that never drains because one job
         * crashed without releasing, which is worse than two jobs overlapping. */
        process.stderr.write(`▸ lock held ${Math.round((Date.now() - t0) / 1000)}s — taking it\n`);
        try { await rm(LOCK, { recursive: true, force: true }); } catch {}
        continue;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
