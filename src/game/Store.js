/**
 * BATTLEFRONT BORZ — ONE STORAGE POLICY, FOR EVERY DURABLE RECORD.
 *
 * Two stores keep the things a player cannot get back — the company roll and
 * the muster slate — and until this file they answered two different questions
 * about the same failure. `Company.writeAll` caught a full quota and threw the
 * value away with a comment saying "losing a roll is not a crash"; `Muster`
 * kept an in-memory mirror and read it back whenever `getItem` returned
 * nothing, which meant a store CLEARED on purpose — by a player wiping site
 * data, or by the check harness restoring between suites — came back from the
 * dead.
 *
 * Both were wrong in the same direction: they guessed. This does not.
 *
 *   AN ABSENT KEY ON A WORKING STORE IS AN EMPTY RECORD. That is the whole of
 *   the first bug: "the browser has nothing under this key" and "the browser
 *   cannot store anything" are different facts and only the second one earns a
 *   fallback.
 *
 *   A REFUSED WRITE IS REMEMBERED, AND SAID OUT LOUD. Private browsing and a
 *   full quota both throw, and a permadeath game that silently stops saving is
 *   the worst failure this tree can have — the roll is still on screen, still
 *   being played for, and already gone. So the value is kept in memory for the
 *   life of the page (which is what a browser with no storage actually means)
 *   and `broken` goes true so a screen can say so.
 *
 * The mirror is READ only while `broken`. That is the line the old Muster code
 * did not draw, and drawing it is the fix.
 */

/**
 * A durable record under one key.
 *
 * @param key  the versioned storage key, e.g. 'saber.company.v1'.
 * @returns `{ key, broken, read(), write(v), drop() }` — `read` always answers
 *          a plain object, `write` returns whether it reached the disk, and
 *          `broken` is the one thing a UI needs to know to be honest.
 */
export function makeStore(key) {
  let broken = false;
  let mirror = null;
  const have = () => typeof localStorage !== 'undefined' && localStorage !== null;

  return {
    key,
    /** True once a write has been refused. The screen's cue to say so. */
    get broken() { return broken; },
    /** Everything under the key, as a plain object. Never throws. */
    read() {
      if (!have()) { broken = true; return mirror || {}; }
      let raw = null;
      try { raw = localStorage.getItem(key); }
      catch { broken = true; return mirror || {}; }
      /**
       * ── THE MIRROR OUTRANKS THE DISK, AND ONLY WHILE THE DISK IS REFUSING ─
       *
       * This tested `raw == null` first — "nothing under the key is an empty
       * record, not a reason to reach for what we remember" — and that reads
       * well and is the wrong order. It only reached the mirror when the key
       * was ABSENT, so a store that had ever saved successfully (which is
       * every store, after the first fold) went on parsing the STALE disk copy
       * for the rest of the session and the mirror was dropped on the floor.
       *
       * Which is precisely the failure this file was written to end. Quota
       * fills mid-session; the player renames a man; `setItem` throws; the
       * mirror holds the new roll; the player clicks the next man and the tab
       * re-reads the pre-rename JSON and the rename is simply gone. Every edit
       * after that bounces, silently, with the old roll on screen.
       *
       * So: while `broken`, the mirror IS the store — it is by construction
       * the newest thing we have, and the disk copy is by construction older
       * than the write that failed. A successful write clears both.
       *
       * A CLEARED STORE IS STILL CLEARED. `drop()` resets `broken` and the
       * mirror together, so the player's own delete is not undone by a
       * memory of what used to be there.
       */
      if (broken && mirror) return mirror;
      if (raw == null) return {};
      try {
        const v = JSON.parse(raw);
        if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
        return v;
      } catch { return {}; }
    },
    /** Write it. Returns false if it did not reach the disk. */
    write(v) {
      if (!have()) { broken = true; mirror = v; return false; }
      try {
        localStorage.setItem(key, JSON.stringify(v));
        /* It landed, so there is nothing left to remember and nothing left to
         * apologise for. A quota that frees up heals the store. */
        mirror = null;
        broken = false;
        return true;
      } catch {
        broken = true;
        mirror = v;
        return false;
      }
    },
    /** Remove the key outright — the player's own door, never the game's. */
    drop() {
      mirror = null;
      broken = false;
      if (!have()) return;
      try { localStorage.removeItem(key); } catch { /* nothing to undo */ }
    },
  };
}
