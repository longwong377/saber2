/**
 * ══════════════════════════════════════════════════════════════════════════
 *  BATTLEFRONT BORZ — #28, THE HABITAT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * "A management screen, reached only at the habitat. Not a menu tab. You walk
 *  to #28, and each companion's own place in it is where you manage that
 *  companion." (V15 §4.)
 *
 * ── WHAT THIS FILE IS ─────────────────────────────────────────────────────
 *
 * Two things and deliberately not three.
 *
 *   1  THE SIX PLAQUES. `StationKit.js` has built six blank slabs on the
 *      habitat's back wall since the room landed, with a comment on them
 *      saying this file writes the names. Until now nothing did, and nothing
 *      read `st.habitat` either — a room with a wall of blanks in it and a
 *      note pointing at a file that did not exist.
 *
 *   2  THE DATA LAYER FOR THE MANAGEMENT SCREEN. Every row the panel shows and
 *      every control it offers, as plain values, with NO DOM in this file at
 *      all. That split is not tidiness: `main.js`'s `Screens.clear()` runs
 *      every registered card's hide on every clear and boot ends with a clear
 *      (main.js:1703-1718), so a panel that is indistinguishable from "hide
 *      the menu" makes the game unreachable. The overlay that renders this
 *      belongs beside `openMeditation` (main.js:1751), which is the shipped
 *      precedent for a bespoke overlay with its own DOM root — and it is not
 *      written here because this file does not own main.js.
 *
 * ── AND IT IS AN ADDITIONAL DOOR, NEVER A REPLACEMENT ─────────────────────
 *
 * `companions: the delete door has a caller` asserts `kennelClear()` is called
 * in `Menu.js` and that `companion-release` exists in Menu.js AND in
 * index.play.html. Nothing in this file moves either. The Kennel page in the
 * menu stays exactly where it is and stays the place an animal is released;
 * the habitat is where it is LOOKED AFTER. Two doors, one record, and the
 * check that guards the first is untouched — a management screen that moved
 * the release control would have taken that check with it and left a player
 * with no way to release an animal except by walking to a room on a station
 * that only exists in one mode.
 *
 * ── THE HOOK THIS FILE NEEDS AND DOES NOT HAVE ────────────────────────────
 *
 * `StationKit.js` publishes `ctx.habitat = { deck, x, z, yaw }` and the
 * assembler copies it to `st.habitat` verbatim. That is enough to know WHERE
 * the room is and not enough to draw anything in it: the six slabs are merged
 * into the room's own geometry with no per-slab handle, their positions are
 * computed from `w` and `d` which are not published, and there is no scene
 * node to parent to — `st.obelisk` gets a `group` and `st.habitat` does not.
 *
 * So `writePlaques` is written to take what it is given and to say what is
 * missing rather than to guess: it wants `group` (the room's node, so plaque
 * positions are LOCAL and no yaw arithmetic happens here at all) and either
 * `plaques` (six local positions) or `w`/`d` to compute them from. Given
 * neither it does nothing, returns 0, and the reason is on the return value.
 * The panel and the plaque TEXT do not depend on any of it, which is why they
 * are separate functions: the words are right whether or not there is a wall
 * to put them on.
 */
import * as THREE from 'three';
import { signPanel } from './StationKit.js';
import { load as loadKennel, notSaving, canCare, careFor, CARE_ACTS, temperById } from './Kennel.js';
import {
  COMPANION_KINDS, GROWTH_STAGES, GROWTH_MARKS, bodyScaleOf, careOf, careWordsOf,
  maturityOf, nextStage, rungOf, stageOf,
} from './CompanionKinds.js';

/** How many plaques the room has. The slab loop in StationKit.js is six. */
export const PLAQUES = 6;

/**
 * THE STATION'S HABITAT RECORD, OR NULL — asked defensively at every level,
 * because this file is reachable from a mode with no station, a station with
 * no #28, and a build in which the hook above has not landed yet. Three
 * different absences, one answer, and none of them a crash.
 */
export function habitatOf(world) {
  const st = world?._station;
  const h = st?.habitat;
  return (h && typeof h === 'object') ? h : null;
}

/**
 * ── WHAT THE SIX PLAQUES SAY ──────────────────────────────────────────────
 *
 * The living animal on the first, and the fallen on the other five, newest
 * first. That order is the room's whole argument: you walk in, the animal you
 * have is at the left of the wall, and the ones you did not bring home are
 * beside it in the order you lost them.
 *
 * A NAME AND A FATE AND NOTHING ELSE. No xp, no rung, no counts — those are on
 * the panel, which you have to stand at. `Company.js`'s own wall of the fallen
 * keeps the same two facts for the same reason: a plaque is a name, and a
 * plaque with statistics on it is a leaderboard.
 *
 * AN EMPTY SLOT IS BLANK RATHER THAN ABSENT. Six slabs exist in the geometry
 * whatever the Kennel holds, so six rows come back always — a wall with two
 * plaques and four holes in it would read as damage.
 */
export function plaqueLines(k = null) {
  const kn = k || loadKennel();
  const out = [];
  const live = kn.live;
  if (live) {
    const K = COMPANION_KINDS[live.kind];
    out.push([live.name || (K?.label || '').toUpperCase(), GROWTH_STAGES[stageOf(live)].label]);
  } else {
    out.push(['', 'EMPTY']);
  }
  for (const f of (kn.fallen || []).slice(0, PLAQUES - 1)) {
    const K = COMPANION_KINDS[f.kind];
    out.push([f.name || (K?.label || '').toUpperCase(), f.fate === 'left' ? 'LEFT BEHIND' : 'KILLED']);
  }
  while (out.length < PLAQUES) out.push(['', '']);
  return out;
}

/**
 * WRITE THE WALL.
 *
 * Idempotent and cheap to call again: the panels are kept on the world under
 * one key and `signPanel.draw` early-outs on identical text, so a caller that
 * runs this every time the player enters the room redraws nothing on the
 * second visit. Returns `{ wrote, why }` — the count that reached geometry and,
 * when that is zero, which half of the hook was missing.
 */
export function writePlaques(world) {
  const rows = plaqueLines();
  const h = habitatOf(world);
  if (!h) return { wrote: 0, why: 'no habitat on this station', rows };
  const parent = h.group || null;
  if (!parent) return { wrote: 0, why: 'st.habitat carries no group to parent to', rows };
  const at = Array.isArray(h.plaques) && h.plaques.length >= PLAQUES
    ? h.plaques
    : (Number.isFinite(h.w) && Number.isFinite(h.d)
      /* The slab loop's own arithmetic, and it is here only because the room
       * does not publish the answer. `plaques` on the hook makes this branch
       * dead and it should. */
      ? Array.from({ length: PLAQUES }, (_, i) => ({ x: -h.w / 2 + 1.4 + i * 1.1, y: 2.4, z: -h.d / 2 + 0.3 }))
      : null);
  if (!at) return { wrote: 0, why: 'st.habitat carries neither plaques nor w/d', rows };

  let store = world._habitatPlaques;
  if (!store || store.length !== PLAQUES) {
    store = [];
    for (let i = 0; i < PLAQUES; i++) {
      const panel = signPanel(rows[i], { px: 256, pyx: 160, name: 'habitat', head: true });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.36), panel.material);
      m.name = `habitat-plaque-${i}`;
      m.position.set(at[i].x, at[i].y, at[i].z + 0.045);
      parent.add(m);
      store.push({ panel, mesh: m });
    }
    world._habitatPlaques = store;
  }
  for (let i = 0; i < PLAQUES; i++) store[i].panel.draw(rows[i]);
  return { wrote: PLAQUES, why: null, rows };
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE MANAGEMENT SCREEN, AS DATA
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Everything the panel puts on the glass, computed once, with no DOM and no
 * world — so it is driveable in a check, renderable from `main.js`, and
 * readable by whatever the next surface is without any of the three learning
 * how a stage gate works.
 *
 * THE TWO CARE CONTROLS COME BACK WITH THEIR OWN LIVENESS AND THEIR OWN
 * SENTENCE. A control that is offered and then does nothing is the dead
 * control `WEARS` was written to prevent one room across, and `canCare` is the
 * one reader both this and the write door ask — so the button is grey for
 * exactly the reason the write would have refused, and the reason is printed
 * beside it.
 */
export function habitatPanel(k = null) {
  const kn = k || loadKennel();
  const rec = kn.live;
  const out = {
    broken: notSaving(),
    fallen: (kn.fallen || []).slice(0, PLAQUES - 1),
    plaques: plaqueLines(kn),
    rec: null,
  };
  if (!rec) return out;
  const K = COMPANION_KINDS[rec.kind];
  const i = stageOf(rec);
  const words = careWordsOf(rec.kind);
  const nxt = nextStage(rec);
  out.rec = rec;
  out.label = K?.label || '';
  out.name = rec.name || null;
  out.rung = rungOf(rec);
  out.stage = { i, ...GROWTH_STAGES[i] };
  out.maturity = maturityOf(rec);
  /* WHAT IT LOOKS LIKE NOW, AND IT IS THE BODY'S OWN NUMBER. `bodyScaleOf` is
   * what both representations are built from, so the panel cannot claim a size
   * the animal is not. `marks` is the sentence off `GROWTH_MARKS`, absent on a
   * kind that does not change and absent below the first stage. */
  out.scale = bodyScaleOf(rec.kind, rec);
  out.grownBy = K?.grow ? bodyScaleOf(rec.kind, rec) / bodyScaleOf(rec.kind, null) : 1;
  out.marks = (K?.grow?.marks && i > 0) ? GROWTH_MARKS[K.grow.marks] || null : null;
  out.next = nxt && {
    label: nxt.stage.label,
    note: nxt.stage.note,
    runs: nxt.runs,
    care: nxt.care,
    /* THE ONE SENTENCE THAT MAKES THE STATION LOAD-BEARING. A stage that wants
     * both says both, in the room where only one of the two can be done. */
    both: nxt.runs > 0 && nxt.care > 0,
  };
  out.care = {
    at: words.at,
    done: careOf(rec),
    acts: CARE_ACTS.map((act) => ({
      act,
      label: words[act],
      done: (rec[act] | 0),
      can: canCare(rec, act),
      /* WHY NOT, IN THE PLAYER'S TERMS. There is exactly one reason and it is
       * the only rule the door has: it has already been looked after for this
       * run, and the next one is bought by taking it out again. */
      why: canCare(rec, act) ? null : `already ${words[act === 'meals' ? 'fed' : 'groomed']} since its last run`,
    })),
  };
  out.tempers = (rec.tempers || []).map((id) => temperById(id)).filter(Boolean)
    .map((t) => ({ id: t.id, label: t.label, earn: t.earn, gain: t.gain, cost: t.cost }));
  out.story = (rec.story || []).slice();
  return out;
}

/**
 * THE ONE ACTION THE SCREEN TAKES. A thin pass-through to the Kennel's own
 * write door — thin on purpose, so there is one writer of the record and the
 * grep-pin on it means what it says. Returns the fresh panel, so a caller
 * re-renders from one answer rather than reloading the store itself.
 */
export function careAt(id, act) {
  careFor(id, act);
  return habitatPanel();
}
