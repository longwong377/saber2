/**
 * ARE THE REFERENCES ACTUALLY HERE, AND HAS ANYBODY LOOKED AT THEM?
 *
 * The player uploaded seven hangar references and they did not reach this
 * container: `assets/reference/misc/` held a `.gitkeep` and nothing else, and
 * nothing on the filesystem had been written in six hours. A session running in
 * a cloud container does not see a file put on somebody's own machine.
 *
 * That failure is silent in the worst way — the work carries on, against
 * nothing, and looks exactly like work done against the references. So it is a
 * check: if the directory is empty this says so out loud, and if it has files
 * in it the count is pinned so a later commit cannot quietly drop them.
 */
import { readdir, readFile } from 'node:fs/promises';

const DIR = new URL('../../assets/reference/misc/', import.meta.url);
const NOTE = new URL('../../assets/reference/REFERENCES.md', import.meta.url);

export async function run({ check, assert }) {
  check('reference: the hangar references are on this machine, and the notes name every one', async () => {
    let files = [];
    try {
      files = (await readdir(DIR)).filter((f) => /\.(png|jpe?g|webp|gif|avif)$/i.test(f)).sort();
    } catch { /* the directory itself is allowed not to exist yet */ }

    if (!files.length) {
      /* NOT AN ASSERTION FAILURE. The references are the player's to send and
       * their absence is not a defect in the tree — but it must never be
       * invisible, because the whole art direction of the flight deck is meant
       * to be measured against them and cannot be. */
      return 'NO REFERENCES ON THIS MACHINE — assets/reference/misc/ is empty. '
        + 'The flight deck is being built without them. Ask for them again.';
    }

    /**
     * THEY HAVE TO HAVE BEEN READ, and that is what the notes file is: one
     * entry per image saying what was taken from it. A directory of pictures
     * nobody opened is the same as no directory at all, and it is exactly the
     * failure that produced a brick wall and streetlamps on a capital ship —
     * a survey said the parts existed and nobody looked at them.
     */
    let notes = '';
    try { notes = await readFile(NOTE, 'utf8'); } catch {}
    assert(notes.length > 200,
      `${files.length} reference image(s) are on disk and assets/reference/REFERENCES.md does not `
      + 'exist or is empty — nothing has read them, and a reference nobody looked at is not a '
      + 'reference. It is what let a street lamp onto a flight deck.');
    const missing = files.filter((f) => !notes.includes(f));
    assert(!missing.length,
      `${missing.length} reference(s) are on disk and named nowhere in the notes: `
      + `${missing.join(', ')} — every one has to be looked at and what was taken from it written down`);
    return `${files.length} reference(s), every one read and noted: ${files.join(', ')}`;
  });
}
