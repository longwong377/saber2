#!/bin/bash
# ONE HEAVY JOB AT A TIME ON A FOUR-CORE BOX.
#
# Measured the hard way: four concurrent Chromium render jobs plus a 2200-check
# verify put this container at load 13, and a verify that should have taken
# twenty minutes was still running after seventy-six with nothing to show. The
# jobs do not fail under contention, they just stop finishing — which reads as a
# hang and is really a queue with no queue.
#
#   bash tools/_render.sh node tools/_deckshot.mjs /tmp/deck
#
# flock on a single lock file. Waits, does not fail. 40 minutes is past the
# longest legitimate job (a full verify) so a genuine deadlock still breaks out.
exec flock -w 2400 /tmp/saber-render.lock "$@"
