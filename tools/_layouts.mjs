/**
 * WHERE A BENCHMARK PUTS ITS BODIES — one statement of it, for both instruments.
 *
 * `scale.mjs` sweeps a count and `floor.mjs` splits one frame by subsystem, and
 * a body's cost depends on where it is STANDING: `Enemy.update` reads L1 at
 * 30 m, the merged skin at 62, the instanced cohort at 137.8, and drops shadow
 * casting at 62. Two instruments answering questions about the same frame must
 * therefore place bodies the same way, or one of them is measuring a different
 * game — which is the defect this file was extracted to end. Neither tool holds
 * a copy.
 */
/**
 * WHERE THE BODIES STAND, AND IT WAS ONE LAYOUT PRETENDING TO BE THE GAME.
 *
 * Every reading this file has ever printed put every body between 14 and 46 m
 * of the camera. That is deliberate for the reason the note below the loop
 * gives — a ring of two armies is what makes the cross-army pass real — and it
 * is ALSO, silently, the configuration in which none of this game's three
 * level-of-detail rungs ever engages: `Enemy.update` reads L1 at 30 m, L2 (the
 * merged skin) at 62, L3 (the instanced cohort) at 137.8, and drops shadow
 * casting at 62. A ring at 46 m is LOD 0 and 1 only, every body carrying a full
 * skeletal solve, its own draw calls and a shadow.
 *
 * So "the frame goes over budget between 19 and 36 bodies" was a true sentence
 * about a mosh pit, and it was being read as a sentence about a battle. The
 * brief this project is measuring itself against — "dozens of force users
 * leading hundreds of troops… the frontline pushing forward and back" — has
 * almost none of its bodies inside 46 m.
 *
 *   `ring`   what this file has always done. KEPT, and still the default,
 *            because it is the worst case and a worst case is worth a number.
 *   `front`  two lines facing each other across a battlefield, from contact
 *            out to the ink's own far plane. This is the shape of the thing
 *            being planned, and the only layout in which the ladder that was
 *            built for it is switched on at all.
 *
 * `front` is not a kinder benchmark chosen to pass: it is the same bodies, the
 * same archetypes, the same cross-army pass, the same two teams. What changes
 * is that they are standing where a battle puts them.
 */
const LAYOUTS = {
  ring: (p, i, n) => {
    const a = (i / n) * Math.PI * 2;
    const r = 14 + (i % 9) * 4;
    return { x: p.position.x + Math.cos(a) * r, z: p.position.z + Math.sin(a) * r };
  },
  /**
   * TWO LINES, AND THE PLAYER IN ONE OF THEM.
   *
   * `Front.js` lays a real front on a bezier and `Command.VERSUS_SEPARATION` is
   * 120 m between two deployed armies, so the two ranks are 60 m either side of
   * a line through the player and the depth runs back from there. The far edge
   * is `INK.edgeFade[1]` — 130 m, where the outline has gone and a body is a
   * cohort instance — because a benchmark for a battlefield should reach the
   * distance at which the game stops drawing bodies as bodies.
   *
   * Alternating sides by `i` matches the team assignment in the loop below, so
   * one rank really is one army rather than a mixed crowd.
   */
  front: (p, i, n) => {
    const side = i % 2 ? 1 : -1;                 // …the same parity `e.team` uses
    const per = Math.max(1, Math.ceil(n / 2));
    const k = Math.floor(i / 2);
    /* Ranks of twelve, so a line is a line and not a single file: twelve men
     * on a 44 m frontage is `FORMATIONS.rank`'s own spacing, near enough. */
    const file = k % 12, rank = Math.floor(k / 12);
    const across = (file / 11 - 0.5) * 44;
    const back = 60 + rank * 14;                 // VERSUS_SEPARATION / 2, then depth
    return { x: p.position.x + across, z: p.position.z + side * Math.min(back, 130) };
  },
};

export const layoutNamed = (name) => LAYOUTS[name] || LAYOUTS.ring;
export { LAYOUTS };
