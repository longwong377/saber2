# How to talk to me

Be plain and brief. Lead with the answer or the point, then stop.

- No long preambles, no recaps of what I just asked.
- Cut supporting detail unless I ask for it. One number beats five.
- Say what matters and why it matters. Skip the mechanism.
- Short sentences. No nested clauses, no parentheticals stacked on each other.
- Don't list every caveat. Give the main one.
- Long, dense answers are harder for me to use than short ones, even when
  every line is true.

## Speak plainly

Plain words. No showing off, no long build-ups, no dramatic phrasing.
Say what happened, what it means for me, and what is left.

Say when you are done. If something is still running or still broken, say
that in one line instead of burying it.

## The play link

The play link is **https://longwong377.github.io/saber2/shark/**. The
station is switched off (`STATION_ENABLED = false`); do not switch it on
unless the player says so. That
is the only one. No artifacts, no clones, no second copy anywhere. The old
root link (`/saber2/`) is deliberately dark: `pages.yml` stages the site under
`PLAY_PATH` (with `index.play.html` as its index — the repo's `index.html` is
the stood-down notice) and puts nothing at the root.

It serves the repository's **default branch**, which is
`claude/lightsaber-combat-game-lxw391`. GitHub Pages refuses to deploy from any
other branch — every push to a feature branch fails the workflow in two
seconds. So work sitting on a feature branch is NOT on the link, however green
it is.

**Merging into the default branch is part of finishing.** Do it without asking.

## When I ask for the link / build

"link ready?", "link", "build" = build it and send it. Nothing else.

    node tools/pack.mjs /tmp/borz.html

Then send the file. No preamble, no summary, no explanation of what a
single-file build is. Just the file and one line saying what changed since the
last one — and merge, so the link above is the same game.

Do this without being asked again at the end of any work worth playing.

## Never report a state you have not observed

Checks, logs and docs are evidence about the code. They are not evidence about
what the player sees or plays. If the question is about the experience, the
only valid answer comes from deploying it and looking, including at anything
opt-in (a companion, a mount, a room). If you have not looked, say
"unverified" instead of "good". Screenshots cost minutes on this box; a wrong
"it's fine" costs a day.
