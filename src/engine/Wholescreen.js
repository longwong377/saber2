/**
 * BATTLEFRONT BORZ — the whole screen.
 *
 * ── WHY THIS FILE IS NOT CALLED Fullscreen.js ───────────────────────────
 *
 * It was, for one day, and one player could not start the game at all: their
 * browser's content blocker killed the request for a same-origin module named
 * `Fullscreen.js` — a URL that reads exactly like the popup-and-overlay
 * scripts filter lists exist to block — and one blocked file takes the whole
 * module graph down with it. The boot doctor's verdict, verbatim: "the request
 * for …/src/engine/Fullscreen.js failed outright (Failed to fetch) — something
 * is blocking it before it reaches the site." Worked in every other browser,
 * failed in theirs from the day this file shipped.
 *
 * So the name says what the header always said instead. A boot-critical file
 * must not be named like blocker bait; `wiring.mjs` now holds every file the
 * browser loads to that rule, so the next Popup.js or Overlay.js cannot ship.
 *
 * "make sure there's a way to make the game full screen right now you still
 * see your browser/tabs/desktop but I think it would be cool to be able to be
 * completely full screen"
 *
 * A leaf module with no imports, for the same reason `Powers.js` is one: three
 * unrelated things need it — the menu's button, the deploy path's setting and
 * the touch pad's tool — and none of them should have to reach through another
 * to get it.
 *
 * ── THE ONE RULE THE FULLSCREEN API HAS ─────────────────────────────────
 *
 * It must be asked for inside a USER GESTURE. Every entry point here is
 * therefore called from a click, a tap or an Ignite, and a request made
 * anywhere else is refused by the browser with a rejected promise rather than
 * an exception — swallowed, because there is nothing useful to say to a player
 * about a request the page was not allowed to make.
 *
 * ── AND ON A PHONE IT IS NOT A LUXURY ───────────────────────────────────
 *
 * On a desktop this hides a tab strip. On a phone it hides the URL bar, which
 * is not decoration: the bar is drawn over the bottom of the page, it appears
 * and disappears as the page is touched, and every time it moves the viewport
 * resizes under a game that has already laid out its HUD against the old one.
 * A locked, full-height viewport is the difference between a playable phone
 * and one where the guard button slides under the browser chrome mid-fight.
 */

/** Whichever prefixed name this browser has, or null. */
function el() {
  if (typeof document === 'undefined') return null;
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function isFullscreen() { return !!el(); }

/** True where the API exists at all — iOS Safari on iPhone does not have it. */
export function canFullscreen() {
  if (typeof document === 'undefined') return false;
  const r = document.documentElement;
  return !!(r.requestFullscreen || r.webkitRequestFullscreen);
}

/**
 * Ask for it. Safe to call when already full screen, and safe to call outside
 * a gesture — it simply will not happen.
 *
 * THE ORIENTATION LOCK RIDES WITH IT, on the devices that have one. A phone
 * held sideways is the only shape this game is playable in — the HUD's two
 * bottom corners need the width — and `orientation.lock` is only permitted
 * while full screen, which is why it is here and not on its own.
 */
export function goFullscreen() {
  const r = typeof document !== 'undefined' ? document.documentElement : null;
  if (!r) return false;
  const fn = r.requestFullscreen || r.webkitRequestFullscreen;
  if (!fn) return false;
  try {
    const p = fn.call(r, { navigationUI: 'hide' });
    if (p && p.then) p.then(lockLandscape, () => {});
    else lockLandscape();
  } catch { return false; }
  return true;
}

function lockLandscape() {
  try { screen.orientation?.lock?.('landscape').catch?.(() => {}); } catch {}
}

export function exitFullscreen() {
  if (typeof document === 'undefined') return;
  try { screen.orientation?.unlock?.(); } catch {}
  try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch {}
}

/** The button's behaviour: in if out, out if in. Returns the new state. */
export function toggleFullscreen() {
  if (isFullscreen()) { exitFullscreen(); return false; }
  goFullscreen();
  return true;
}
