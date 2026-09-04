/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE BOARDS — the station's name, and the obelisk with the rolls on it
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── THE LEADERBOARD IS A PLACE, WHICH IS THE POINT OF IT ──────────────────
 *
 * V15: *"can we have some kind of leaderboard that persists between runs? it
 * should really motivate players to do better and better and compete. However
 * the leaderboard will be a physical place and/or thing you visit on the
 * station."*
 *
 * A screen on a wall would satisfy the first sentence and miss the second
 * entirely — a screen is a menu with a wall behind it, and the game already
 * has a menu. `#56 The Standing` is the answer: a black obelisk three decks
 * high in a hall too small for it, running up through a cut in the soffit so
 * you see the top of it from the Living deck's balcony and the whole of it
 * from the Concourse floor. It turns. Your own row is lit and everyone else's
 * is engraved.
 *
 * ── FOUR FACES, BECAUSE ONE SCORE IS THE ONE NOBODY CAN CHASE ─────────────
 *
 * A single number ranks a player against a number. Four ranked axes let a
 * player who is bad at one be proud of another, and — more usefully — tell
 * them what to try next. They are drawn from what the game ALREADY records,
 * not from new plumbing:
 *
 *   DEPTH    `Progress.recent[].depth`, the deepest any run has been
 *   SCORE    `Progress.recent[].score`
 *   THE ROLL `Company`'s living men, and the fallen behind them — the number
 *            §3.2 #45's memorial wall is already about
 *   RUNS     the totals at the top of the progress fold
 *
 * ── AND IT IS WRITTEN WHEN A RUN FILES ────────────────────────────────────
 *
 * *"a run that betters a row cuts it in on the spot — you see it happen if
 * you are standing there when a run files."* The rolls are re-read whenever
 * the fold's run count changes, which is once per filed run and never per
 * frame.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { signPanel } from './StationKit.js';
import { stationName } from './StationSave.js';
import { loadProgress } from './Progress.js';
import { loadAll as loadCompany } from './Company.js';
import { boardAt, boardLine, BOARD } from './FlightOps.js';

/**
 * The four faces, as text. Every number comes off a store that already
 * exists; nothing here writes one.
 */
export function rolls(progress, company) {
  const recent = progress?.recent || [];
  const best = (key) => recent.reduce((a, r) => Math.max(a, Number(r?.[key]) || 0), 0);
  const bestRun = recent.reduce((a, r) => ((Number(r?.score) || 0) > (Number(a?.score) || 0) ? r : a), null);
  const living = company?.men?.filter?.((m) => m.alive !== false).length ?? 0;
  const fallen = company?.fallen?.length ?? 0;
  const runs = progress?.runs ?? recent.length;
  const wins = progress?.wins ?? recent.filter((r) => r?.won === true).length;
  return [
    { key: 'depth', head: 'DEEPEST', rows: [
      'DEEPEST', best('depth') ? `AREA ${best('depth')}` : 'NO RUN YET',
      bestRun?.mode ? String(bestRun.mode) : '—',
    ] },
    { key: 'score', head: 'SCORE', rows: [
      'SCORE', best('score') ? String(best('score')) : '—',
      bestRun?.won === true ? 'WON' : bestRun ? 'FELL' : '—',
    ] },
    { key: 'roll', head: 'THE ROLL', rows: [
      'THE ROLL', `${living} STANDING`, `${fallen} FALLEN`,
    ] },
    { key: 'runs', head: 'RUNS', rows: [
      'RUNS', String(runs), `${wins} WON`,
    ] },
  ];
}

/**
 * Build the column. Four tapering segments on a plinth with a lit face-plate
 * on each side, and it is ONE object with four materials — a face is a plane,
 * which is four draws for the whole landmark.
 */
export function dressObelisk(world, st, M) {
  const spec = st.obelisk;
  if (!spec) return null;
  const g = new THREE.Group();
  g.name = 'station-obelisk';
  g.position.set(spec.x, spec.y + 0.6, spec.z);
  g.rotation.y = spec.yaw;

  const H = spec.h;
  /* The taper: five stacked boxes narrowing to a cap, so the silhouette is a
   * needle rather than a post. A cone would read as a rocket. */
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const w0 = 3.0 * (1 - i / (seg + 1.6));
    const y = (H * i) / seg;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w0, H / seg, w0), M.dark);
    box.position.y = y + H / (seg * 2);
    box.castShadow = true; box.receiveShadow = true;
    g.add(box);
  }
  /* The cap, which is the one bright thing at the top of a three-deck shaft
   * and is what you see from the balcony two decks up. */
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 4), M.strip);
  cap.position.y = H + 0.6;
  cap.rotation.y = Math.PI / 4;
  g.add(cap);

  /* THE FOUR FACES. One plane each, at eye height and rising, so a reader
   * standing at the plinth has one in front of them. */
  const faces = [];
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 2) * i;
    const panel = signPanel(['', '', ''], { name: `roll${i}`, px: 384, pyx: 256, bg: '#0a0a0c' });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.35), panel.material);
    mesh.position.set(Math.sin(a) * 1.42, 2.1, Math.cos(a) * 1.42);
    mesh.rotation.y = a;
    g.add(mesh);
    faces.push(panel);
  }

  world.scene.add(g);
  world.statics.push(g);
  st.obelisk.group3 = g;
  st.obelisk.faces = faces;
  st.obelisk.stamp = -1;
  return g;
}

/**
 * Turn it, and re-cut the rolls when a run has filed.
 *
 * The turn is slow — a quarter of a degree a second — because a landmark that
 * spins is a fairground ride and one that is still is furniture. Nothing here
 * allocates; the rolls are re-read only when the run count moves.
 */
export function stepBoards(world, st, dt) {
  /**
   * THE TRAFFIC BOARD FIRST, and on the STATION MINUTE rather than the frame.
   * `st.hour` advances by dt/120, so a minute of station time is two seconds
   * of real time and the board changes about thirty times an hour — which is
   * the rate the traffic actually moves at. Redrawing per frame would be a
   * canvas fill and a texture upload sixty times a second for a picture that
   * is identical fifty-nine of them; `signPanel.draw` early-outs on identical
   * text anyway, so the stamp is here to skip building the strings at all.
   */
  const tb = st.traffic;
  if (tb) {
    const stamp = Math.floor(((st.day ?? 0) * 24 + (st.hour ?? 0)) * 60) + (st.mine ? 1e7 : 0);
    if (stamp !== tb.stamp) { tb.stamp = stamp; tb.panel.draw(trafficRows(st)); }
  }
  const o = st.obelisk;
  if (!o?.group3) return;
  o.group3.rotation.y += dt * 0.045;
  /**
   * Re-read at most twice a second, and re-CUT only when the fold has moved.
   * `loadProgress` is a localStorage read and a parse, which is nothing at 2 Hz
   * and is a real cost at 60. The stamp is what makes the second half true:
   * standing at the obelisk when a run files is the moment the player is meant
   * to see, and it is the only moment anything is redrawn.
   */
  o.pollIn = (o.pollIn ?? 0) - dt;
  if (o.pollIn > 0) return;
  o.pollIn = 0.5;
  let p = null, co = null;
  try { p = loadProgress(); } catch {}
  try { co = companyOf(); } catch {}
  const stamp = (p?.runs ?? 0) * 1000 + (p?.recent?.length ?? 0)
    + (co?.men?.length ?? 0) * 7 + (co?.fallen?.length ?? 0) * 13;
  if (stamp === o.stamp) return;
  o.stamp = stamp;
  const rows = rolls(p, co);
  for (let i = 0; i < o.faces.length && i < rows.length; i++) o.faces[i].draw(rows[i].rows);
}

/**
 * The player's own company, whichever army they are playing. `Company.loadAll`
 * returns every army's roll keyed by name; the station wants the one that is
 * being played, and failing that the one with men in it.
 *
 * EXPORTED FOR V16 §C2, and exported rather than copied. `StationLife` needs
 * the same roll to seat troops on leave into the bars, and "which of the
 * player's companies is THE company, from the station's point of view" is a
 * judgement that must have exactly one answer — two would put a different set
 * of men on the departures board and in the cantina on the same evening.
 */
export function companyOf() {
  const all = loadCompany?.();
  if (!all) return null;
  const rolls_ = Object.values(all).filter((a) => a && Array.isArray(a.men));
  if (!rolls_.length) return null;
  return rolls_.reduce((a, b) => ((b.men.length > (a?.men?.length ?? -1)) ? b : a), null);
}

/**
 * ══ THE STATION'S NAME, ON THE THINGS THAT NAME IT ════════════════════════
 *
 * V15: *"you should be able to name your station."* One string, and the value
 * of it is entirely in how many places it turns up: the departures board in
 * Arrivals, the four tram platforms, and the readout in the lift.
 *
 * A board per place rather than one global sign, because a station tells you
 * where you are at the door of every place you can leave from.
 */
export function dressBoards(world, st, M) {
  const name = stationName();
  const made = [];
  const put = (place, rows, opts) => {
    if (!place) return;
    const panel = signPanel(rows, { name: `board${place.id}`, ...opts });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(opts?.w || 5.2, opts?.h || 1.6), panel.material);
    /* On the place's back wall, facing the door. */
    const c = Math.cos(place.yaw), s = Math.sin(place.yaw);
    const lz = place.d / 2 - 0.45;
    mesh.position.set(place.x + lz * s, (world._station.deckY ?? 0) + (opts?.y ?? 3.4), place.z + lz * c);
    mesh.rotation.y = place.yaw + Math.PI;
    world.scene.add(mesh);
    world.statics.push(mesh);
    made.push({ panel, mesh });
  };
  const at = (id) => [...st.places.values()].find((r) => r.place.id === id)?.place || null;

  /* #7 Arrivals: the departures board, which is where a station says its own
   * name to somebody who has just walked off a shuttle. */
  put(at(7), [name, 'ARRIVALS', 'ALL BAYS OPEN'], { w: 7.2, h: 2.2, y: 4.2 });
  /* The four platforms (#40 and its three), each naming its own stop. */
  const stops = [[40, 'ARRIVALS'], [40.2, 'CONCOURSE EAST'], [40.3, 'QUARTERS'], [40.4, 'COMMAND']];
  for (const [id, label] of stops) put(at(id), [name, label], { w: 4.4, h: 1.3, y: 3.2 });
  st.boards = made;
  /* ── AND #2's, WHICH IS THE ONLY ONE THAT MOVES ─────────────────────── */
  dressFlightBoard(world, st, at(2));
  return made;
}

/**
 * ══ THE TOWER'S TRAFFIC BOARD — SHARK §7 #2 ═══════════════════════════════
 *
 * §3.2 #2 Deck control tower: *"consoles, the traffic board"*, and the verb is
 * *"read the board: what is inbound"*. A verb that reads something needs the
 * something to exist, so this is it: eight movements, on the glass, in the
 * room, redrawn on the station's own minute.
 *
 * ── WHY IT IS A BOARD AND NOT A BANNER ────────────────────────────────────
 *
 * §14 is firm that the station adds no interface, and the answer this file
 * already gives to that is the one the departures board in Arrivals gives: put
 * the words on a PANEL IN THE ROOM. A traffic board that only existed as a
 * line of text when you pressed a key would be a menu with a tower around it,
 * and the tower is the better half of the idea — you can stand at the glass
 * and watch a movement go from EXPECTED to ON FINAL without touching anything.
 *
 * ── AND IT IS THE SAME BOARD THE VERB READS ───────────────────────────────
 *
 * Both come off `FlightOps.boardAt(day, hour)`, which is a pure function of
 * the station clock — so the banner cannot say something the glass does not,
 * which is the failure mode of every second copy in this tree.
 */
export function dressFlightBoard(world, st, place) {
  if (!place) return null;
  const panel = signPanel(['', '', ''], {
    name: 'traffic', px: 768, pyx: 384, bg: '#07090c', align: 'left',
    head1: '#9fd0ff', ink2: '#6f9fc8',
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 1.7), panel.material);
  const c = Math.cos(place.yaw), s2 = Math.sin(place.yaw);
  /* On the tower's back wall, 0.2 m proud of the slab `StationKit.cantilever`
   * already builds there, facing the stair you come up. */
  const lz = place.d / 2 - 0.45;
  mesh.position.set(place.x + lz * s2, (st.deckY ?? 0) + 2.2, place.z + lz * c);
  mesh.rotation.y = place.yaw + Math.PI;
  world.scene.add(mesh);
  world.statics.push(mesh);
  st.traffic = { panel, mesh, place, stamp: -1 };
  return st.traffic;
}

/** The rows as the glass prints them: a head, then the movements. */
export function trafficRows(st) {
  /* `mine` is the player's own launch, which `Launch.Sortie` files through
   * `Station.sortieSink` — so a sortie you flew is on the tower's glass with
   * the rest of the day's traffic, which is the whole reason `movementsIn`
   * takes one. */
  const rows = boardAt(st.day ?? 0, st.hour ?? 0,
    { theatre: st.theatre, rows: BOARD.rows, mine: st.mine });
  return [`${st.name || 'STATION'} — MOVEMENTS`, ...rows.map(boardLine)];
}
