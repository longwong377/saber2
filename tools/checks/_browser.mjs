/**
 * THE ONE PLACE THAT KNOWS WHERE CHROMIUM IS.
 *
 * Two suites drive the real browser — `front-screen.mjs` asks where a box
 * landed, which no stylesheet can be asked, and `packed.mjs` asks whether the
 * single-file build boots at all — and the executable has to be resolved
 * rather than typed, because the pinned build directory carries a version in
 * its name.
 *
 * IT MUST NOT BE SKIPPED WHEN IT IS MISSING. A check that quietly passes on a
 * box with no browser is the "0 passed, 0 failed" shape HANDOFF §2.3 files
 * under a missing thing answered with a plausible default: it says the page is
 * fine on exactly the machines that never looked. So this throws, and the
 * caller's `assert` turns that into a named red.
 */
import { existsSync, readdirSync } from 'node:fs';

export function chromiumPath() {
  const candidates = [process.env.CHROMIUM_PATH,
    ...(existsSync('/opt/pw-browsers')
      ? readdirSync('/opt/pw-browsers').map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`)
      : []),
    '/opt/pw-browsers/chromium'];
  const exe = candidates.find((p) => p && existsSync(p));
  if (!exe) throw new Error(`no chromium on this box — tried ${candidates.filter(Boolean).join(', ')}`);
  return exe;
}

/** The flags that make SwiftShader render at all in this container. */
export const CHROME_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
