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
 * ── FOUR FACES, AND THE NAMES ARE CUT INTO THEM ───────────────────────────
 *
 * V15 §1.2: *"The names are cut into it, best at the top… Your own row is lit;
 * everyone else's is engraved."* and *"The dead are on it too… a name that
 * comes off the company goes onto the obelisk's fourth face."*
 *
 * This function used to read four counters off `Progress` and `Company` and
 * print them — measured on deck 40 the four faces were `["DEEPEST","NO RUN
 * YET","—"] ["SCORE","—","—"] ["THE ROLL","0 STANDING","0 FALLEN"] ["RUNS",
 * "0","0 WON"]`, which is ZERO NAMES. A four-panel stat readout wearing the
 * word leaderboard. Every face now carries rows, and every row is a name off
 * a store that already exists:
 *
 *   DEEPEST   your runs, deepest first, named by WHO YOU WERE on them — the
 *             order and species `Progress.recent[]` stores per run
 *   SCORE     the same runs, ranked by score
 *   THE ROLL  your living company by name, most kills at the top — §1.2's
 *             *"most saved (the company's living roll)"*
 *   FALLEN    the casualty list, which is the fourth face the player asked
 *             for. It reads `Company.fallen` — the one list in this tree that
 *             says who is dead, and the list §3.2 #45's memorial wall is
 *             about. #45 does not print names yet (`SHAPES.namewall` lays
 *             seven blank lit panels); when it does it reads THIS array, and
 *             then the two cannot disagree, which is the whole of *"the
 *             memorial roll (#45) and this share a source."*
 *
 * ── WHAT STANDS IN FOR EVERYONE ELSE, SAID PLAINLY ────────────────────────
 *
 * There is no second player's data. This game has no server, no account and
 * no shared store, so an obelisk of strangers' names would be an obelisk of
 * names somebody made up — which is worse than an empty one, because a
 * fabricated ladder is a ladder you cannot climb and cannot check.
 *
 * So the other names on the column are the ones this game genuinely has: THE
 * MEN OF YOUR OWN COMPANY, living and dead. They are real records, they are
 * earned by play, and two of the four axes §1.2 names — *"most saved"* and
 * the memorial — were always about them. Your own rows are on the two run
 * faces and the LATEST run is the lit one, which is what makes the arrival
 * prompt's *"find your own row"* a thing you can actually do: you walk up and
 * look for the line that is lit.
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
import { PLACE, DECK_Y, DRUM } from './StationPlan.js';

/**
 * HOW MANY ROWS A FACE CUTS UNDER ITS HEAD. Five, and it is a layout number
 * rather than a taste one: `signPanel` sizes a body row at `H / (n + 2.2)`,
 * so at six rows on a 384-pixel face the type is 37 px and a name at the
 * plinth is a smudge. Four names and one total is what fits.
 */
export const FACE_ROWS = 5;

/** How many characters a row holds. Courier at 47 px on a 512-wide face. */
const ROW_W = 18;

/** A row: a name on the left, its number on the right, cut to the stone. */
function row(left, right) {
  const l = String(left ?? '').toUpperCase();
  const r = String(right ?? '').toUpperCase();
  const room = Math.max(1, ROW_W - r.length - 1);
  const cut = l.length > room ? l.slice(0, room) : l;
  return `${cut}${' '.repeat(Math.max(1, ROW_W - r.length - cut.length))}${r}`;
}

/**
 * WHO A RUN WAS RUN BY — the only name a single-player ledger has for one.
 *
 * `Progress.recent[]` carries `order` and `species` on every entry, which is
 * who the player WAS on that run, and it is a different pair from run to run
 * — which is what makes four rows of it a ladder rather than four copies of
 * one word. Both are plain ids ('sith', 'zabrak'), so nothing is imported to
 * print them and no table can drift out of step with this one.
 */
function runner(r) {
  const bits = [r?.order, r?.species].filter((v) => typeof v === 'string' && v);
  return bits.length ? bits.join(' ') : 'unrecorded';
}

/**
 * A man's name as the column cuts it: the callsign the player gave him, else
 * the nickname he earned in the field, else his number. `Company.cleanCallsign`
 * has already made all three safe for a screen.
 *
 * TWO PLACES FOR ONE CALLSIGN, and both are read because the two rolls store
 * it differently: a LIVING man keeps his under `look.callsign` (`Company.dress`
 * writes it there), and a FALLEN record is flattened by `Company.keep` into a
 * bare `callsign` field so a casualty list can print a name without carrying a
 * whole appearance. Reading only one of them is how the roll face showed
 * `CT-1500` for a man the player had named Ladder.
 */
function cutName(m) {
  return m?.callsign || m?.look?.callsign || m?.nickname || m?.designation || 'unnamed';
}

/** The runs, ranked, keeping each one's index in `recent` so the entry that
 * filed LAST — `recent[0]`, which `recordRun` unshifts — can be found again
 * after the sort and lit. */
function ranked(recent, by) {
  return recent.map((r, i) => ({ r, i }))
    .sort((a, b) => (by(b.r) - by(a.r)) || (a.i - b.i))
    .slice(0, FACE_ROWS - 1);
}

/**
 * The four faces, as rows. Every number and every name comes off a store that
 * already exists; nothing here writes one.
 *
 * A row is a string (engraved) or `{ t, lit }` — see `StationKit.signPanel`.
 */
export function rolls(progress, company) {
  const recent = (progress?.recent || []).filter(Boolean);
  const men = (company?.men || []).filter((m) => m && m.alive !== false);
  const fallen = (company?.fallen || []).filter(Boolean);
  const runs = progress?.runs ?? recent.length;
  const wins = progress?.wins ?? recent.filter((r) => r?.won === true).length;

  const depth = ranked(recent, (r) => Number(r?.depth) || 0);
  const score = ranked(recent, (r) => Number(r?.score) || 0);
  /* `i === 0` is the run that filed last, wherever it has landed in the
   * ranking. THAT is the lit row — the one the player is looking for. */
  const runRows = (list, right) => (list.length
    ? [...list.map(({ r, i }) => ({ t: row(runner(r), right(r)), lit: i === 0 })),
      row(`${runs} run${runs === 1 ? '' : 's'}`, `${wins} won`)]
    : ['no run yet']);

  const byKills = men.slice()
    .sort((a, b) => ((b.kills | 0) - (a.kills | 0)) || ((b.runs | 0) - (a.runs | 0)))
    .slice(0, FACE_ROWS - 1);

  return [
    { key: 'depth', head: 'DEEPEST',
      rows: ['DEEPEST', ...runRows(depth, (r) => `A${Number(r?.depth) || 0}`)] },
    { key: 'score', head: 'SCORE',
      rows: ['SCORE', ...runRows(score, (r) => String(Number(r?.score) || 0))] },
    { key: 'roll', head: 'THE ROLL',
      rows: ['THE ROLL', ...(byKills.length
        ? [...byKills.map((m) => row(cutName(m), `${m.kills | 0}`)),
          `${men.length} standing`]
        : ['no company yet'])] },
    /* THE FOURTH FACE IS THE MEMORIAL, which is what §1.2 asks for in as many
     * words. It was RUNS — a repeat of the total that now sits at the foot of
     * the DEEPEST face, so nothing is lost by giving the face to the dead. */
    { key: 'fallen', head: 'FALLEN',
      rows: ['FALLEN', ...(fallen.length
        ? [...fallen.slice(0, FACE_ROWS - 1)
          .map((f) => row(cutName(f), f.fate === 'left' ? 'left' : 'kia')),
        `${fallen.length} fallen`]
        : ['none lost'])] },
  ];
}

/**
 * ══ FIND YOUR OWN ROW — what #56's verb actually does ═════════════════════
 *
 * The gazetteer's verb for #56 has always been *"read the rolls — find your
 * own row"*, and the key answered NAME THE STATION, which is a different
 * sentence about a different feature. This is the reading: the run that filed
 * last, where it stands on each of the two faces that rank your runs, and the
 * state of the company on the other two.
 *
 * Two lines, because `world.notify` takes a head and a line — the same shape
 * every other verb on the station answers in.
 *
 * `standingReading` is the door `Station.stationKey` presses, and it does the
 * two store reads HERE rather than in `Station.js`. That is not tidiness. This
 * file already imports `Progress.js` and `Progress.js` imports `Waves.js`, so
 * an `import { loadProgress }` in `Station.js` pulls the whole wave director
 * into the station's static graph for two lines of text — and it was written
 * that way first: `station.mjs` went red on `a face is the same all day` with
 * `PLACES is not defined`, a check nothing in this lane touches, and moving
 * the two reads to this side made it green again.
 */
export function standingReading() {
  let p = null, co = null;
  try { p = loadProgress(); } catch {}
  try { co = companyOf(); } catch {}
  return myRow(p, co);
}

export function myRow(progress, company) {
  const recent = (progress?.recent || []).filter(Boolean);
  if (!recent.length) {
    return ['THE STANDING', 'no run has filed yet — the two run faces are blank'];
  }
  const place = (by) => {
    const v = by(recent[0]);
    return recent.filter((r) => by(r) > v).length + 1;
  };
  const d = Number(recent[0]?.depth) || 0;
  const s = Number(recent[0]?.score) || 0;
  const men = (company?.men || []).filter((m) => m && m.alive !== false).length;
  const fallen = (company?.fallen || []).length;
  return [`YOUR ROW — ${runner(recent[0]).toUpperCase()}`,
    `area ${d}, ${nth(place((r) => Number(r?.depth) || 0))} of ${recent.length} on DEEPEST · `
    + `${s} points, ${nth(place((r) => Number(r?.score) || 0))} on SCORE · `
    + `${men} standing, ${fallen} on the fallen face`];
}

/** 1 -> "1st". The obelisk says where you stand, and it says it in words. */
function nth(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * Build the column. Four tapering segments on a plinth with a lit face-plate
 * on each side, and it is ONE object with four materials — a face is a plane,
 * which is four draws for the whole landmark.
 */
export function dressObelisk(world, st, M) {
  const spec = st.obelisk || throughSpec(st.deck);
  if (!spec) return null;
  st.obelisk = spec;
  const g = new THREE.Group();
  g.name = 'station-obelisk';
  g.position.set(spec.x, spec.y + 0.6, spec.z);
  g.rotation.y = spec.yaw;

  const H = spec.h;
  /**
   * WHERE THIS DECK'S FLOOR CROSSES THE COLUMN, in the group's own frame.
   *
   * Zero on deck 40, where the column stands on its plinth in #56's hall.
   * 11.9 on 44 and 24.4 on 48, because the SAME column at the SAME height is
   * being built again on a deck two storeys up its length — so everything
   * below that line is under the plate the player is standing on and is a
   * mesh nobody can ever see. Skipping those is why the landmark costs four
   * meshes on 44 and two on 48 rather than ten.
   */
  const yFloor = (DECK_Y[st.deck] ?? 0) - (spec.y + 0.6);

  /* The taper: five stacked boxes narrowing to a cap, so the silhouette is a
   * needle rather than a post. A cone would read as a rocket. */
  const seg = 5;
  for (let i = 0; i < seg; i++) {
    const y = (H * i) / seg;
    /**
     * ONE STOREY OF SLACK, and the number is what you can actually see.
     *
     * The well is a hole in the plate you look DOWN as well as up, and the
     * far side of it is the deck below — `DRUM.storey`. A segment whose top
     * is above that line is in the shot; anything under it is behind a floor
     * from every angle and was cut for that reason. Culling at the floor
     * itself was the first cut and it was wrong: deck 48 kept the cap and
     * nothing under it, so the needle's tip floated in its own shaft.
     */
    if (y + H / seg < yFloor - DRUM.storey) continue;
    const w0 = 3.0 * (1 - i / (seg + 1.6));
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

  /**
   * THE FOUR FACES, ON THE DECK THE HALL IS ON AND NOWHERE ELSE.
   *
   * A face sits at 2.2 m — reading height at the plinth — which on decks 44
   * and 48 is under the floor. Four more canvas textures per deck to draw
   * four pictures nobody can look at is the cost this skips; what those decks
   * get is the SILHOUETTE, which is the whole argument for a landmark.
   */
  const faces = [];
  if (!spec.above) {
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i;
      /* 512 x 384 rather than 384 x 256: the face carries six rows of names
       * now instead of three words, and `signPanel` sizes a row at H/(n+2.2)
       * — 47 px here, 31 px on the old canvas, which is a name you cannot
       * read from the plinth. The plane keeps the canvas's 4:3. */
      const panel = signPanel(['', '', ''], {
        name: `roll${i}`, px: 512, pyx: 384, bg: '#0a0a0c', align: 'left',
        head1: '#e8eef6', ink2: '#6e7a88', lit1: '#ffd9a0',
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.5), panel.material);
      mesh.position.set(Math.sin(a) * 1.42, 2.2, Math.cos(a) * 1.42);
      mesh.rotation.y = a;
      g.add(mesh);
      faces.push(panel);
    }
  }

  world.scene.add(g);
  world.statics.push(g);
  st.obelisk.group3 = g;
  st.obelisk.faces = faces;
  st.obelisk.stamp = -1;
  st.obelisk.draws = g.children.length;
  /* ON THE DECK'S BILL, because it is on the deck's screen. The column's
   * meshes went to `world.scene` and were counted by nothing, so §12.2's 400
   * was being measured against a deck with ten uncounted draws in it — and
   * this lane adds the same object on two more decks, which is exactly when
   * an unmeasured cost stops being small. Deck 40 pays 10, deck 44 6, deck 48
   * 3, against a bound of 400 and a shell of 123. */
  st.draws += g.children.length;
  return g;
}

/**
 * ══ THE COLUMN AS THE DECKS ABOVE IT SEE IT (V15 §1.2) ════════════════════
 *
 * *"you see the top of it from the Living deck's balcony and the whole of it
 * from the Concourse floor."* Measured before this existed: `deck 44:
 * st.obelisk NULL, 0 'station-obelisk' nodes`, and the same on 48 — so the
 * whole argument for an obelisk over a screen ("a thing you can see from two
 * other decks is a landmark") was undelivered on two decks of the three.
 *
 * The station builds ONE deck at a time, so there is no shared scene to hang
 * a three-deck object in. The cheapest honest answer is therefore to build
 * the same column again, from the same numbers, on each deck it passes —
 * `PLACE.get(56)` is the one row that says where and how tall, exactly as
 * `SHAPES.obelisk` reads it on deck 40, so the three cannot drift apart. What
 * makes it visible rather than buried is `Station.buildDeckPlate`'s WELL: the
 * plate and the soffit are cut round #56's footprint on the decks the shaft
 * passes, and railed, so you look down a lit shaft at a black needle.
 *
 * `above` marks a copy standing on a deck that is not its own — the one flag
 * `dressObelisk` needs, and the reason it does not cut four faces up there.
 */
function throughSpec(deck) {
  if (deck !== 44 && deck !== 48) return null;
  const p = PLACE.get(56);
  if (!p) return null;
  /* `h - 3` is `SHAPES.obelisk`'s own arithmetic for the column inside a hall
   * `h` tall, and it is repeated rather than exported because the shape hands
   * it back through `ctx` on deck 40 and there is nothing to hand it back
   * from up here. `station.mjs` asserts the three agree. */
  return { x: p.x, z: p.z, y: DECK_Y[p.deck] ?? 0, yaw: p.yaw, h: p.h - 3, above: deck };
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
  /* A COPY ON A DECK ABOVE ITS OWN HAS NO FACES — it turns and nothing else.
   * Returning here also skips the twice-a-second `localStorage` read on two
   * decks of the three, which is the whole cost of this feature up there. */
  if (!o.faces?.length) return;
  o.pollIn = (o.pollIn ?? 0) - dt;
  if (o.pollIn > 0) return;
  o.pollIn = 0.5;
  let p = null, co = null;
  try { p = loadProgress(); } catch {}
  try { co = companyOf(); } catch {}
  /* KILLS ARE IN THE STAMP because the ROLL face is ranked by them: a run
   * that kills nobody new changes neither count, and a run that does changes
   * the order of four names without changing either length. */
  const kills = (co?.men || []).reduce((a, m) => a + (m?.kills | 0), 0);
  const stamp = (p?.runs ?? 0) * 1000 + (p?.recent?.length ?? 0)
    + (co?.men?.length ?? 0) * 7 + (co?.fallen?.length ?? 0) * 13 + kills * 3;
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
  /* ── AND THE REGISTER IN #13, WHICH IS WHERE THE NAME IS SET ────────── */
  dressRegister(world, st, at(13));
  /* ── AND #2's, WHICH IS THE ONLY ONE THAT MOVES ─────────────────────── */
  dressFlightBoard(world, st, at(2));
  /* Every board is a plane on the deck's screen — see the note in
   * `dressObelisk` about what was going uncounted. */
  st.draws += made.length + (st.register ? 1 : 0) + (st.traffic ? 1 : 0);
  return made;
}

/**
 * ══ THE STATION REGISTER — #13, AND WHY NAMING LIVES HERE ═════════════════
 *
 * V15 §1.1: *"Where you set it: the Databank terminal (#13) and the plan table
 * in your own cabin."* It was set at #56 and NOWHERE ELSE, under a prompt that
 * said *"read the rolls — find your own row"* — so the one hall in the station
 * that promises a reading was the only place naming existed, and a player who
 * never pressed the key in it never learned the station could be named at all.
 *
 * `SHAPES.rotunda` already builds eight terminals in a ring. This is a PANEL
 * over the one nearest the door, naming what that terminal is for, because the
 * alternative — a hidden verb on an identical desk — is the shape §14 refuses:
 * a station adds no interface, it puts the words on a thing in the room. It is
 * one plane and one draw.
 *
 * The reach test that claims the key is `Station.atRegister`; the other seven
 * terminals still open the codex, which is what #13's own verb says they do.
 */
export function dressRegister(world, st, place) {
  if (!place) return null;
  /* The terminal nearest the door. `SHAPES.rotunda` lays eight at
   * `TAU * i / 8 + 0.2` on a radius of `min(w, d) / 2 - 1.6`; i = 4 is the one
   * facing the way you came in. The arithmetic is repeated rather than
   * exported because the shape draws in the place's own frame and has nothing
   * to hand back — `station.mjs` measures that the panel lands on a terminal. */
  const r = Math.min(place.w, place.d) / 2 - 1.6;
  const a = Math.PI + 0.2;
  const c = Math.cos(place.yaw), s = Math.sin(place.yaw);
  const lx = r * Math.sin(a), lz = r * Math.cos(a);
  const x = place.x + lx * c + lz * s, z = place.z - lx * s + lz * c;
  const panel = signPanel([stationName(), 'STATION REGISTER', 'press to rename'], {
    name: 'register', px: 512, pyx: 256, bg: '#07090c', head1: '#9fd0ff', ink2: '#6f9fc8',
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), panel.material);
  mesh.position.set(x, (st.deckY ?? 0) + 2.3, z);
  /* Facing the middle of the reading room, which is where a reader stands. */
  mesh.rotation.y = a + place.yaw + Math.PI;
  world.scene.add(mesh);
  world.statics.push(mesh);
  st.register = { panel, mesh, place, x, z, y: (st.deckY ?? 0) };
  return st.register;
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
