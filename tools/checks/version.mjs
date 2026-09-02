/**
 * THE VERSION ON THE TITLE SCREEN keeps up with the playtest log.
 *
 * "there should be a small version number in the upper right of the main
 *  menu (small barely visible) … updated every time the playtest link is
 *  updated/pushed"
 *
 * The rule: the major in `src/version.js` is the newest round logged in
 * PLAYTEST.md ("SABER GAME NOTES AND IMPROVEMENTS V12" → 12). A session that
 * logs the next round and forgets the number goes red here, and the tag is
 * asserted onto the title screen so it cannot quietly go back to being a
 * diagnostic hidden behind the frame counter.
 */
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);

export async function run({ check, assert }) {
  check('version: the title screen carries the newest playtest round', async () => {
    const { VERSION } = await import('../../src/version.js');
    assert(/^\d+\.\d+$/.test(VERSION), `VERSION is "${VERSION}", not major.minor`);
    const log = await readFile(new URL('PLAYTEST.md', ROOT), 'utf8');
    const rounds = [...log.matchAll(/IMPROVEMENTS V(\d+)/g)].map((m) => +m[1]);
    const newest = Math.max(...rounds);
    const major = +VERSION.split('.')[0];
    assert(major === newest, `src/version.js says ${VERSION}; PLAYTEST.md's newest round is V${newest}`);
    const html = await readFile(new URL('index.html', ROOT), 'utf8');
    assert(html.includes('id="version-tag"'), 'index.html has no #version-tag');
    const menu = await readFile(new URL('src/ui/Menu.js', ROOT), 'utf8');
    assert(menu.includes("getElementById('version-tag')") && menu.includes('`v${VERSION}`'),
      'Menu.js does not stamp VERSION onto #version-tag');
    const css = await readFile(new URL('styles.css', ROOT), 'utf8');
    const rule = css.match(/\.version-tag\{([^}]*)\}/);
    assert(rule, 'styles.css has no .version-tag rule');
    const op = +(rule[1].match(/opacity:([\d.]+)/) || [])[1];
    assert(op > 0 && op <= 0.4, `the tag should be barely visible: opacity ${op}`);
    assert(/top:\d+px;right:\d+px/.test(rule[1]), 'the tag is not pinned top right');
    return `v${VERSION} against V${newest}, opacity ${op}`;
  });
}
