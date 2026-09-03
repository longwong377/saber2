#!/bin/sh
# ══════════════════════════════════════════════════════════════════════════
#  THE STATION'S IMPORTED ROOMS — the exact command line for each
# ══════════════════════════════════════════════════════════════════════════
#
# SHARK.md §15 names the source: longwong377/Opus-5 at
# claude/aaa-game-development-j6y2ml (7c3df7e), the `handoff/` folder.
#
# Point HANDOFF at a checkout of it and run this. It rewrites everything under
# assets/station/, which is checked in — so a normal build never needs the
# other repo at all, and re-running this is what to do if a room is ever
# re-exported.
#
#   git clone --depth 1 -b claude/aaa-game-development-j6y2ml \
#     https://github.com/longwong377/opus-5 /tmp/opus5
#   HANDOFF=/tmp/opus5/handoff sh tools/station-assets.sh
#
# The UNCOMPRESSED copies in handoff/ are used, not handoff/draco/. They carry
# identical geometry and need no decoder — see tools/glbmesh.mjs's header for
# why that is the whole reason there is no draco wasm in this repo.
set -e
: "${HANDOFF:=../opus-5/handoff}"
OUT=assets/station

# #9 The Concourse — the barrel-vaulted market hall. 22.0 × 7.5 × 67.4 m.
node tools/glbmesh.mjs "$HANDOFF/zocalo.glb"           "$OUT/zocalo.smesh"

# Deck 40's corridor TYPE — ribbed, signage frames, shopfronts. Never all
# three decks (SHARK §3.1 rule 2). 9.4 × 7.6 × 120.6 m, cut into modules by
# Station.js rather than stood end to end.
node tools/glbmesh.mjs "$HANDOFF/central_corridor.glb" "$OUT/corridor.smesh"

# #41 Command / CIC. 14.3 × 9.9 × 13.0 m.
node tools/glbmesh.mjs "$HANDOFF/cnc.glb"              "$OUT/cnc.smesh"

# #54 The Observation dome. One rotunda of the export. 14.4 × 7.5 × 17.9 m.
node tools/glbmesh.mjs "$HANDOFF/obs_rotundas.glb"     "$OUT/rotunda.smesh"

# §4 The Starfury — 16 named sections, nine thruster mounts. 9.3 × 9.3 × 6.0 m.
# Its floor is NOT moved: an airframe's origin is its centre of mass and the
# manifest's mounts are in that frame.
node tools/glbmesh.mjs "$HANDOFF/starfury.glb"         "$OUT/starfury.smesh" --nofloor

cp "$HANDOFF/starfury_manifest.json" "$OUT/starfury_manifest.json"
ls -l $OUT
