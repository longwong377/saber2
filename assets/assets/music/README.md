# Soundtrack

Drop the music file in this folder as **`theme.mp3`** and it will be picked up
automatically — the loader looks for that exact name.

## A limit worth knowing before you try

**GitHub's web uploader refuses files over 25 MB.** A 45-minute track at
128 kbps is about 44 MB, so it cannot go in through the browser. Two ways
around it:

1. **Split it.** Export the track as `theme.mp3` and `theme2.mp3`, each under
   25 MB (roughly 22 minutes each at 128 kbps). Both upload through the web UI
   fine. This keeps full quality, and costs **one line**: the loader plays a
   LIST, so add the second name to `TRACKS` in `src/main.js` —

   ```js
   const TRACKS = ['theme.mp3', 'theme2.mp3'].map(…);
   ```

   `playMusic` then hands the element the next url when the current one ends
   and wraps back to the first, and steps over any name that is not actually
   there. Without that line only `theme.mp3` plays, and it loops — which is
   what this page used to promise happened by itself, and did not: `theme2`
   appeared exactly once in the whole repository, in this sentence.

2. **Push it from a terminal**, which has no size limit under 100 MB:

   ```bash
   git clone -b claude/lightsaber-combat-game-lxw391 https://github.com/longwong377/saber2.git
   cd saber2
   cp /path/to/your/track.mp3 assets/music/theme.mp3
   git add assets/music/theme.mp3 && git commit -m "Soundtrack" && git push
   ```

Dropping the bitrate to fit 25 MB in one file would mean about 64 kbps, which
is audibly rough on music. Splitting is the better trade.

## Notes

- It streams through an `<audio>` element rather than being decoded into
  WebAudio. Decoding 45 minutes would expand to roughly 950 MB of float32 in
  memory and kill the tab; streaming costs nothing.
- Volume and mute come from the existing **Music** slider in Options — and at
  **0 the file is never fetched at all**. Whatever goes here is a download every
  player pays for on their first load, so "off" has to mean off rather than
  28 MB of silence; moving the slider off zero is what starts the stream.
- Whatever goes here is permanent in git history, so be happy with the mix
  before pushing — replacing it later leaves both copies in the repository
  forever.
