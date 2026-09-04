/**
 * THE VERSION ON THE TITLE SCREEN — and the rule for bumping it.
 *
 * "there should be a small version number in the upper right of the main
 *  menu (small barely visible) … make it something that is updated every time
 *  the playtest link is updated/pushed"
 *
 * The major is the playtest round in PLAYTEST.md (V12 = 12); the minor is
 * bumped on every build that goes to the link or is sent as a packed file
 * inside that round. `tools/checks/version.mjs` holds the major to the newest
 * round logged in PLAYTEST.md, so a session that logs V13 and forgets this
 * file goes red. `tools/pack.mjs` prints it, so the file you send says what
 * it is.
 */
export const VERSION = '16.0';
