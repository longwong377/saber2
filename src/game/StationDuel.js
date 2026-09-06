/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE FIGHT COMES HOME — V20 lane 7
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player, 2.0 item 8: *"Sabers on the station: a duel in the arena with a
 * crowd betting, a Sith who drinks in the cantina and follows you out. The
 * best system in the game currently lives in a separate mode."*
 *
 * The best system in the game is the physics saber fight, and on the station
 * it was unreachable: nothing on the drum has ever been a fight, and a lit
 * blade in the concourse is a shoplifting with a light show. So this file does
 * not add combat. It adds the two OCCASIONS on which the station's own rule —
 * the blade stays down — is lifted, and hands the fight that already exists to
 * the rooms the gazetteer already built for it.
 *
 * ── THE THREE THINGS THIS FILE IS ────────────────────────────────────────
 *
 *   THE SABER GATE. The drum's peace, stated once and enforced in one place:
 *     `bladeAllowed(world)` is false everywhere on the station except inside
 *     #20's well during a bout and on the ring during the Sith's fight.
 *     `Player._readInput` asks it before the ignite key turns anything on, and
 *     `stepDuel` douses a blade that got lit some other way. There is no
 *     second copy of the rule and no place that quietly disagrees with it.
 *
 *   THE ARENA BOUT (#20, deck 40). At two seeded hours a named duellist — a
 *     real saber archetype off `Enemy.ARCHETYPES`, not a repainted resident —
 *     stands in the sand and waits. The interact key at the kerb takes the
 *     bout: you are dropped in, the gate opens, and it is first to three
 *     touches with the game's own hit and parry. The crowd comes down onto the
 *     tiers, roars on every touch and half of it puts an arm up. The tote
 *     takes bets on it through `Tote.duelRace`, which is the same race shape
 *     the three venues already price, so tickets and odds are not reinvented.
 *
 *   THE SITH IN THE CANTINA (#14). A named acolyte at a booth from 22:00, a
 *     cup in his hand and a red hilt on the table. Talk to him on three
 *     different days — the `regulars` ledger, which already counts talks — and
 *     he offers; or walk out after midnight and he FOLLOWS, silent, six to
 *     eight metres back, stopping whenever you turn round. On the ring's dark
 *     stretch he ignites. First to two touches, or the guards break it up at
 *     forty seconds; he yields with a line and is gone until tomorrow. Win and
 *     his hilt is on your desk.
 *
 * ── WHY IT IS NOT CALLED `Duel.js` ───────────────────────────────────────
 *
 * `src/game/Duel.js` is taken, and by the thing this lane is built ON: the
 * duelling brain — declared arcs, telegraphs, forms, the blade lock. A second
 * file with that name would be the two halves of one subject pretending to be
 * one file. This is the STATION's duel: where and when and what it costs. The
 * fighting is `Duel.js`, `Melee.js` and `SaberController.js`, and not a line of
 * it is restated here.
 *
 * ── DETERMINISM ──────────────────────────────────────────────────────────
 *
 * No `Math.random` anywhere in this file. The bout hours, the duellist, the
 * card, which of the crowd cheers, the Sith's nights and every line either of
 * them says are `hashF` off the station day, the hour and the slot — the same
 * hash `StationCast`, `Follower` and `Regulars` seed on — so two machines
 * watching the same evening see the same bout.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { PLACE, floorOf, junctionsOn, DECK_Y } from './StationPlan.js';
import { wayPlacesOn } from './StationLife.js';
import { nameFor } from './StationCast.js';
import { makeEntrant } from './Spectacle.js';
import { duelRace, duelResult, boardFor } from './Tote.js';
import { regularOf, recordTalk, REGULAR_AT } from './Regulars.js';
import { seatsNear, seatTop, seatYaw, seatUpright, tableBefore, tableTop, holdSeat, makeCup, cupInHand, cupDown } from './Bars.js';
import { duelsState, setDuelsState, trophiesState, setTrophies } from './StationSave.js';
import { note } from './Journal.js';
import { pay, spend } from './Credits.js';
import { audio } from '../engine/Audio.js';

/* ══════════════════════════════════════════════════════════════════════════
 *  THE NUMBERS
 * ══════════════════════════════════════════════════════════════════════════ */

/** #20 The Arena, #14 The Cantina, and the deck both stand on. */
export const ARENA = 20, CANTINA = 14, DECK = 40;

/** First to this many touches takes the bout, and the Sith's fight. */
export const TOUCHES = 3, SITH_TOUCHES = 2;

/** What the marshal pays a winner, and what a loser leaves on the table. */
export const PURSE = 30, STAKE = 20;

/** Seconds a beaten fighter sits on the bench before the kerb answers again. */
export const SIT_OUT = 20;

/** How many come down for a bout — the tiers hold this many and no more. */
export const CROWD = { min: 16, max: 24 };

/** A touch is worth this much noise, and half the room puts an arm up for a second. */
export const CHEER = { hold: 1.0, share: 0.5 };

/** The well: the sand's radius, the kerb the key answers on, and the drop. */
export const WELL = { sand: 7, kerb: [9.0, 13.5], depth: 2.1 };

/** He sits from this hour; from this one he will follow you out. */
export const SITH_FROM = 22, SITH_FOLLOWS = 0;

/** How far behind he keeps, how fast he closes, and how far off your nose he
 *  has to be for you not to have turned round on him. */
export const FOLLOW = { near: 6, far: 8, pace: 5.4, turn: 4.0, seen: 0.62, lose: 26,
  /* HE DOES NOT DO IT AT THE DOOR. Twenty seconds of somebody behind you is
   * the whole of the sequence — the ignition is what it is because of the walk
   * that came before it — so the dark stretch cannot be jumped even when the
   * cantina happens to open onto it. */
  before: 20 };

/** The guards are sent at this many seconds and break it up at this many. */
export const GUARDS_AT = 30, GUARDS_BY = 40;

/** The four saber archetypes a marshal can put in the sand. Ids off
 *  `Enemy.ARCHETYPES` — `duel.mjs` holds them to it rather than trusting
 *  this list, because a renamed archetype would spawn nothing at all. */
export const DUELLISTS = Object.freeze([
  { type: 'acolyte', style: 'Makashi' },
  { type: 'jedi', style: 'Ataru' },
  { type: 'sentinel', style: 'Soresu' },
  { type: 'guardian', style: 'Djem So' },
]);

/** The archetype the Sith at the booth fights out of. */
export const SITH_TYPE = 'acolyte';

/* ══════════════════════════════════════════════════════════════════════════
 *  THE HASH — `Regulars`'s and `StationCast`'s, not a third
 * ══════════════════════════════════════════════════════════════════════════ */

function hashF(seed, salt = '') {
  const s = `${seed}|${salt}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pick = (arr, seed, salt) => arr[Math.floor(hashF(seed, salt) * arr.length) % arr.length];
const wrapPi = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

/* ══════════════════════════════════════════════════════════════════════════
 *  1. THE CARD — when a bout is on, and who is in the sand
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * THE TWO HOURS A BOUT IS ON TODAY.
 *
 * Inside the Arena's own opening hours (`Tote.VENUES`' row says 10–20), one in
 * the morning half and one in the evening half, so a player who walks past at
 * noon and a player who walks past after work each have one to find. Seeded on
 * the day alone: everybody on the station is at the same bout.
 */
export function boutHoursOn(day = 0) {
  const d = day | 0;
  return [11 + Math.floor(hashF(`duel:hours:${d}`, 'a') * 4),
    17 + Math.floor(hashF(`duel:hours:${d}`, 'b') * 3)];
}

/** The bout hour running at this clock, or null — a bout is the hour it is on. */
export function boutAt(day = 0, hour = 0) {
  for (const h of boutHoursOn(day)) if (hour >= h && hour < h + 1) return h;
  return null;
}

/**
 * TODAY'S DUELLIST AT THAT HOUR — a name, an archetype and a rating.
 *
 * The archetype is a real fighting body and the rating is what the tote prices
 * him at; both are the same every time anybody asks, which is what lets the
 * card be published before the man is spawned.
 */
export function duellistFor(day = 0, hour = 0) {
  const seed = `duel:who:${day | 0}:${hour | 0}`;
  const row = pick(DUELLISTS, seed, 'type');
  return {
    id: 'duellist',
    seed,
    type: row.type,
    style: row.style,
    name: nameFor('human', seed),
    rating: 58 + Math.floor(hashF(seed, 'rate') * 30),
  };
}

/**
 * THE TWO ON THE CARD: him, and you.
 *
 * Your own rating is the one thing on it that is not a hash — it is what you
 * have done in the sand, off the `duels` fold — so a player who has won four
 * is a shorter price than one who has never taken a bout, and the board says
 * so before a credit is staked.
 */
export function duelEntrants(who, fold = duelsState()) {
  const won = fold.won | 0, lost = fold.lost | 0;
  const mine = Math.max(40, Math.min(96, 60 + won * 6 - lost * 3));
  const hid = (salt) => Math.round((hashF(who.seed, salt) - 0.5) * 2 * 100) / 100;
  return [
    makeEntrant({
      id: who.id, name: who.name, kind: 'companion', rating: who.rating,
      hidden: { nerve: hid('n'), heart: hid('h'), vice: hid('v'), footing: hid('f') },
    }),
    makeEntrant({ id: 'you', name: 'You', kind: 'companion', rating: mine, hidden: {} }),
  ];
}

/**
 * THE BOUT AS A RACE THE TOTE CAN PRICE. Memoised per day and hour, because a
 * board that moved between two reads of the same bout would be a slot machine
 * wearing a card's clothes — `Tote.cardAt` keeps its day for the same reason.
 */
const _races = new Map();
export function duelRaceFor(day = 0, hour = 0) {
  const key = `${day | 0}:${hour | 0}`;
  const hit = _races.get(key);
  if (hit) return hit;
  const race = duelRace({ day: day | 0, hour: hour | 0, entrants: duelEntrants(duellistFor(day, hour)) });
  if (_races.size >= 8) _races.delete(_races.keys().next().value);
  _races.set(key, race);
  return race;
}

/** Only a check calls this. */
export function clearDuelCards() { _races.clear(); }

/* ══════════════════════════════════════════════════════════════════════════
 *  2. THE GROUND — the well, the kerb, the tiers, the dark stretch
 * ══════════════════════════════════════════════════════════════════════════ */

/** #20's centre and its floors, in world coordinates. */
export function wellOfArena() {
  const p = PLACE.get(ARENA);
  if (!p) return null;
  const y = floorOf(p);
  return { place: p, x: p.x, z: p.z, y, sandY: y - WELL.depth, r: WELL.sand };
}

/** How far the player is from the middle of the arena, on the flat. */
function radiusOf(world) {
  const w = wellOfArena(), p = world?.player?.position;
  if (!w || !p) return Infinity;
  return Math.hypot(p.x - w.x, p.z - w.z);
}

/** Standing in the sand. */
export function inWell(world) { return radiusOf(world) <= WELL.sand + 0.6; }

/** Standing at the kerb: on the room's floor, at the lip of the well. */
export function atKerb(world) {
  const r = radiusOf(world);
  return r >= WELL.kerb[0] && r <= WELL.kerb[1];
}

/**
 * A SEAT ON THE TIERS, for the i-th of the crowd. Two rings of benches step
 * down to the sand (`StationKit.SUNK.sunkenring`: 7–9 m at −1.4, 9–11 at
 * −0.7), so the crowd is put on them by index rather than scattered through
 * the room's box the way `StationLife.slotIn` scatters a quiet afternoon.
 */
export function tierSpot(i, out = _v) {
  const w = wellOfArena();
  if (!w) return null;
  const ring = i % 2;
  const r = ring ? 10.0 : 8.0;
  const n = ring ? 15 : 13;
  const a = ((i / 2) | 0) * (Math.PI * 2 / n) + (ring ? 0.21 : 0);
  out.set(w.x + Math.sin(a) * r, w.y - (ring ? 0.7 : 1.4), w.z + Math.cos(a) * r);
  return out;
}

/**
 * THE RING'S DARK STRETCH — where the Sith stops walking and turns round.
 *
 * Not a bearing typed in here: it is the walk stretch on the deck whose
 * middle is furthest from every junction, which is the longest run of corridor
 * with no crossing on it and therefore the one with nobody coming the other
 * way. Derived, so a deck whose junctions move moves this with them.
 */
export function darkStretch(deck = DECK) {
  let walks = [];
  try { walks = wayPlacesOn(deck).filter((p) => p.way === 'walk'); } catch { walks = []; }
  if (!walks.length) return null;
  const js = junctionsOn(deck) || [];
  let best = null, bestGap = -1;
  for (const p of walks) {
    const a = Math.atan2(p.x, p.z);
    let gap = Math.PI;
    for (const j of js) {
      const d = Math.abs(wrapPi((j.at * Math.PI / 180) - a));
      if (d < gap) gap = d;
    }
    /* Ties go to the lower id, so the answer is a function of the plan and
     * never of iteration order. */
    if (gap > bestGap + 1e-9 || (Math.abs(gap - bestGap) < 1e-9 && best && p.id < best.id)) { bestGap = gap; best = p; }
  }
  return best ? { place: best, x: best.x, z: best.z, y: DECK_Y[deck] ?? 0, gap: bestGap } : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  3. THE SABER GATE — the drum's peace, in one place
 * ══════════════════════════════════════════════════════════════════════════
 *
 * §11 makes the station a sandbox with consequences: hurt a resident and the
 * guards come. What it never said was that a lightsaber may be lit in a
 * concourse full of people at all — and it may not. The rule is that the blade
 * stays down on the station, and the two exceptions are the whole of this
 * lane: the well while a bout is live, and the ring while the Sith is on you.
 *
 * ONE PREDICATE, TWO READERS. `Player._readInput` asks before the ignite key
 * lights anything (so the refusal is a sentence and not a mystery), and
 * `stepDuel` asks every frame and douses a blade that arrived lit — off a
 * lift, out of a sortie, or through any door this file has not thought of.
 */
export function bladeAllowed(world) {
  const D = world?._duel;
  /* Not the station at all: every other level in the game is a fight. */
  if (!D) return true;
  if (D.bout?.live && inWell(world)) return true;
  if (D.sith?.state === 'fight') return true;
  return false;
}

/** What the ignite key says when it refuses. One string, one reader. */
export const BLADE_REFUSAL = 'not on the drum — the peace holds everywhere but the well';

/**
 * `Player._readInput`'s one line: true when the press was refused here.
 * Answers false off the station, so nothing about a battlefield changes.
 */
export function refuseBlade(world) {
  return !!world?._duel && !bladeAllowed(world);
}

/** Put a lit blade away — the player's, wherever it came from. */
function douse(world, why = null) {
  const p = world?.player;
  if (!p?.saber?.lit) return false;
  p.saber.retract?.();
  p.hum?.retract?.();
  if (why) world.notify?.('BLADE DOWN', why);
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  4. THE FOLD — what the station remembers about your fighting
 * ══════════════════════════════════════════════════════════════════════════ */

/** The record the plaque prints: bouts, wins, losses, touches, the last name. */
export function duelRecord() {
  const f = duelsState();
  return {
    bouts: f.bouts | 0, won: f.won | 0, lost: f.lost | 0,
    touches: f.touches | 0, against: f.against | 0,
    last: typeof f.last === 'string' ? f.last : null,
    day: f.day | 0,
  };
}

function recordBout({ won, name, mine, theirs, day }) {
  const f = duelRecord();
  setDuelsState({
    bouts: f.bouts + 1,
    won: f.won + (won ? 1 : 0),
    lost: f.lost + (won ? 0 : 1),
    touches: f.touches + (mine | 0),
    against: f.against + (theirs | 0),
    last: name, day: day | 0,
  });
}

/** The trophies on the desk — a hilt taken off somebody who yielded. */
export function trophies() { return trophiesState(); }

function takeTrophy(rec) {
  const all = trophies();
  if (all.some((t) => t.id === rec.id)) return all;
  const next = [...all, rec].slice(-6);
  setTrophies(next);
  return next;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  5. THE BODIES
 * ══════════════════════════════════════════════════════════════════════════ */

/** Take a body out of the world — `StationLife.removeBody`'s two lines. */
function putAway(world, body) {
  if (!body) return;
  try { body.dispose?.(); } catch { /* already gone */ }
  const i = world.enemies?.indexOf(body) ?? -1;
  if (i >= 0) world.enemies.splice(i, 1);
}

/**
 * A FIGHTER, STOOD SOMEWHERE, NOT YET FIGHTING.
 *
 * `stationResident` is doing two jobs and both are load-bearing: `World.
 * pickTarget` refuses a resident as a target, so a man waiting for a bout does
 * not open one, and `Enemy.update` pins him to the merged rung, so he costs
 * four draws like everybody else in the drum. `__stationTouched` is set from
 * the first frame so `StationLife.witness` can never blame the player for
 * hitting him: a bout is not an assault, and a duel in a dark corridor is
 * between the two of you.
 */
function spawnFighter(world, type, x, y, z, { name, role, species = 'human' }) {
  if (!world?.spawnEnemy) return null;
  let b = null;
  try { b = world.spawnEnemy(type, new THREE.Vector3(x, y + 0.1, z), { team: world.player?.team ?? 0 }); } catch { return null; }
  if (!b) return null;
  b.team = world.player?.team ?? 0;
  b.stationResident = true;
  b.noAmbientHarm = true;
  b.__stationTouched = true;
  b.stationName = name;
  b.stationRole = role;
  b.stationSpecies = species;
  b.stationDuel = true;
  return b;
}

/** Off the leash: he is fighting you now. */
function makeHostile(body) {
  if (!body) return;
  body.stationResident = false;
  body.team = 1;
  body.__duelHp = body.hp;
}

/** Hold a body where it is, facing a point — `StationKit.poseKeeper`'s pin. */
function pin(body, x, z, faceX, faceZ, dt) {
  if (!body?.position) return;
  const dx = x - body.position.x, dz = z - body.position.z;
  const hips = body.rig?.hipsBone?.obj;
  if (hips) { hips.position.x += dx; hips.position.z += dz; }
  body.position.x = x; body.position.z = z;
  body.velocity?.set?.(0, 0, 0);
  body._poseAt?.copy?.(body.position);
  body._syncBody?.();
  const want = Math.atan2(faceX - x, faceZ - z);
  body.facing = (body.facing ?? want) + wrapPi(want - (body.facing ?? want)) * Math.min(1, dt * 4);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  6. THE PROPS — the plaque at the kiosk, the hilt on the table and the desk
 * ══════════════════════════════════════════════════════════════════════════ */

let _mats = null;
function mats() {
  if (_mats) return _mats;
  _mats = {
    plate: new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.5, metalness: 0.6 }),
    lit: new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb347, emissiveIntensity: 1.2, roughness: 0.5 }),
    hilt: new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.4, metalness: 0.75 }),
    red: new THREE.MeshStandardMaterial({ color: 0xff4436, emissive: 0xd8241a, emissiveIntensity: 1.4, roughness: 0.5 }),
  };
  _mats.plate.name = 'prop-duel-plate';
  _mats.lit.name = 'prop-duel-lit';
  _mats.hilt.name = 'prop-duel-hilt';
  _mats.red.name = 'prop-duel-red';
  return _mats;
}

/** A saber hilt, as a prop: a grip, a band and an emitter. 0.26 m of it. */
export function makeHilt() {
  const M = mats();
  const g = new THREE.Group();
  g.name = 'duel-hilt';
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.021, 0.20, 8), M.hilt);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 8), M.red);
  band.position.y = 0.07;
  const emit = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.019, 0.035, 8), M.plate);
  emit.position.y = 0.118;
  g.add(grip, band, emit);
  return g;
}

/** Where the arena's kiosk stands — the plaque is bolted to its face. */
export function arenaKiosk(deck = DECK) {
  let ks = [];
  try { ks = wayPlacesOn(deck).filter((p) => p.way === 'kiosk'); } catch { ks = []; }
  if (!ks.length) return null;
  const w = wellOfArena();
  if (!w) return ks[0];
  let best = ks[0], bd = Infinity;
  for (const k of ks) {
    const d = Math.hypot(k.x - w.x, k.z - w.z);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

/**
 * THE PLAQUE. A plate on the arena kiosk with a lit strip along it — what a
 * room that has a record hanging in it looks like from across the ring. What
 * it SAYS is the interact key's, because a canvas nobody can read at four
 * metres is a texture and not a plaque.
 */
function dressPlaque(world, D) {
  const k = arenaKiosk(D.deck);
  if (!k || !world.scene) return null;
  const M = mats();
  const g = new THREE.Group();
  g.name = 'duel-plaque';
  const yaw = Math.atan2(k.x, k.z) + Math.PI;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.42, 0.05), M.plate);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.02), M.lit);
  strip.position.set(0, -0.14, 0.035);
  g.add(plate, strip);
  g.position.set(k.x, (DECK_Y[D.deck] ?? 0) + 1.5, k.z);
  g.rotation.y = yaw;
  world.scene.add(g);
  D.plaque = { group: g, x: k.x, z: k.z, kiosk: k.id };
  return D.plaque;
}

/**
 * WHAT A TROPHY LOOKS LIKE ON YOUR OWN DESK — `Home.dressHome`'s one line.
 *
 * Called with the dressed home, so it needs no world of its own beyond the
 * group the room already owns. A cabin dressed in a room with no desk gets
 * nothing, which is the same answer the journal gives there.
 */
export function dressTrophies(world, h) {
  const list = trophies();
  if (!h?.desk || !list.length) return 0;
  let n = 0;
  for (const t of list.slice(0, 3)) {
    const g = makeHilt();
    /* The desk top is 0.76 m (`Home.PIECES`' desk row) over the room's floor,
     * which is what `h.desk.at.y` is; a hilt LIES on it, so it is turned onto
     * its side and set a hand's breadth from its neighbour. */
    g.position.set(h.desk.at.x + (n - 1) * 0.18, h.desk.at.y + 0.79, h.desk.at.z);
    g.rotation.z = Math.PI / 2;
    g.rotation.y = 0.4 * n;
    g.name = `duel-trophy-${t.id}`;
    (h.group || world?.scene)?.add(g);
    h.built?.push(g);
    n++;
  }
  return n;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  7. DRESS AND UNDRESS
 * ══════════════════════════════════════════════════════════════════════════ */

/** `Station.dressStation`'s one line. */
export function dressDuel(world) {
  const st = world?._station;
  if (!st) return null;
  const D = {
    deck: st.deck,
    plaque: null,
    bout: null,
    sith: null,
    cheer: [],
    sitOut: 0,
  };
  world._duel = D;
  if (st.deck === DECK) dressPlaque(world, D);
  return D;
}

/** `Station.undressStation`'s one line. */
export function undressDuel(world) {
  const D = world?._duel;
  if (!D) return;
  if (D.plaque?.group) {
    D.plaque.group.parent?.remove(D.plaque.group);
    D.plaque.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose?.(); });
  }
  if (D.bout?.body) putAway(world, D.bout.body);
  if (D.sith?.body) putAway(world, D.sith.body);
  for (const g of D.sith?.guards || []) putAway(world, g);
  if (D.sith?.hilt) D.sith.hilt.parent?.remove(D.sith.hilt);
  world._duel = null;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  8. THE KEY — one press, three things it can mean at #20
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * `Station.stationKey`'s one line, ABOVE the pit and the tote branches: the
 * kerb during a bout hour is the most specific thing in that room, and the
 * plaque is a fixture on the walkway that neither of those two ever reaches.
 * Answers false everywhere else, so #20's card and its pit door are untouched.
 */
export function duelKey(world) {
  const D = world?._duel;
  const st = world?._station;
  if (!D || !st) return false;
  /* THE PLAQUE, first: it is a metre and a half of kiosk out on the ring,
   * where nothing else answers at all. */
  if (D.plaque) {
    const p = world.player?.position;
    if (p && Math.hypot(p.x - D.plaque.x, p.z - D.plaque.z) < 2.2) {
      const r = duelRecord();
      world.notify?.('THE ARENA · THE BOARD',
        r.bouts
          ? `${r.won}–${r.lost} in ${r.bouts} bout${r.bouts === 1 ? '' : 's'}, ${r.touches} touches for and ${r.against} against. Last: ${r.last}.`
          : 'no bouts on the board yet. Take one at the kerb — the marshal keeps the score.');
      return true;
    }
  }
  if (st.deck !== DECK) return false;
  const B = D.bout;
  if (!atKerb(world)) return false;
  if (B?.live) { world.notify?.('THE ARENA', 'you are in the bout — get down there'); return true; }
  if (D.sitOut > 0) {
    world.notify?.('THE ARENA', `sit it out — ${Math.ceil(D.sitOut)} s`);
    return true;
  }
  if (!B?.waiting) return false;
  /* THE PRESS IS SPENT EITHER WAY. `takeBout` refuses only for a reason the
   * player is standing in the middle of (a bout already running, the bench),
   * and both of those have said so above — a branch that claimed the press
   * and then answered nothing is the defect `stationKey`'s own note names. */
  takeBout(world);
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  9. THE BOUT
 * ══════════════════════════════════════════════════════════════════════════ */

/** The duellist comes down into the sand and waits to be taken up on it. */
function openWell(world, D, st) {
  const hour = boutAt(st.day | 0, st.hour);
  if (hour == null) return;
  const w = wellOfArena();
  if (!w) return;
  const who = duellistFor(st.day | 0, hour);
  const race = duelRaceFor(st.day | 0, hour);
  const body = spawnFighter(world, who.type, w.x, w.sandY, w.z + 1.6, {
    name: who.name, role: `duellist — ${who.style}`,
  });
  if (!body) return;
  D.bout = {
    hour, who, race, body, waiting: true, live: false, over: false,
    t: 0, out: 0, mine: 0, theirs: 0, hp: body.hp, myHp: world.player?.hp ?? 100,
    stand: { x: w.x, z: w.z + 1.6, y: w.sandY },
  };
  world.notify?.(`${who.name.toUpperCase()} · THE WELL`,
    `${who.style}, and the marshal has the book. Take the bout at the kerb.`);
}

/** The player takes it. The gate opens, the crowd is already in. */
export function takeBout(world) {
  const D = world?._duel;
  const B = D?.bout;
  if (!B || !B.waiting || B.live) return false;
  if (D.sitOut > 0) return false;
  const w = wellOfArena();
  const p = world.player;
  if (!w || !p) return false;
  /**
   * THE STAKE IS PUT UP AT THE KERB, and this is the whole of what losing
   * costs. `Credits.spend` is the one spend door in the game and it refuses
   * rather than going negative, so a player who cannot cover it is turned
   * away by the wallet and not by a number written here.
   */
  const paid = spend(STAKE, 'a bout at the Arena');
  if (!paid.ok) {
    world.notify?.('THE ARENA', `the marshal wants ${STAKE} on the table — ${paid.why}`);
    return false;
  }
  /* Dropped in, on the far side of the sand from him. */
  const x = w.x, z = w.z - 2.6;
  p.position.set(x, w.sandY + 0.1, z);
  p.body?.setTransform?.(p.position, null);
  p.velocity?.set?.(0, 0, 0);
  B.waiting = false;
  B.live = true;
  B.t = 0;
  B.hp = B.body.hp;
  B.myHp = p.hp;
  makeHostile(B.body);
  world.notify?.('THE BOUT', `first to ${TOUCHES} touches. ${B.who.name} salutes; the blade is allowed in the well.`);
  audio.ui?.('good');
  return true;
}

/**
 * A TOUCH IS A LANDED BLOW AND NOTHING ELSE.
 *
 * The bout does not implement hitting: it WATCHES the two bodies' hit points,
 * which is where the game's own blade, parry, guard and fist already write
 * their answer. A parried swing costs nothing, so it is not a touch; a cut
 * that lands is one, whatever landed it. Then both are put back — a bout is
 * fought to touches, not to a body on the sand — so nobody can die in the well
 * and no amount of a long bout is a way to lose the game at a kerb.
 */
function scoreTouches(world, D, B, dt) {
  const p = world.player;
  const e = B.body;
  if (!p || !e) return;
  let land = null;
  if (e.hp < B.hp - 0.01) { B.mine++; land = 'me'; }
  if (p.hp < B.myHp - 0.01) { B.theirs++; land = land ? 'both' : 'them'; }
  /* Both back on their feet for the next pass. */
  e.hp = Math.min(e.maxHp, Math.max(e.maxHp * 0.5, B.hp));
  p.hp = Math.max(p.hp, Math.min(p.maxHp, B.myHp));
  B.hp = e.hp; B.myHp = p.hp;
  if (!land) return;
  const head = land === 'them' ? `${B.who.name.toUpperCase()} SCORES` : 'A TOUCH';
  world.notify?.(head, `${B.mine}–${B.theirs}`);
  roar(world, D, B.mine + B.theirs);
  if (B.mine >= TOUCHES || B.theirs >= TOUCHES) endBout(world, D, B.mine >= TOUCHES);
}

/** The room comes up off the benches. */
function roar(world, D, n) {
  const w = wellOfArena();
  if (!w) return;
  const life = world._stationLife;
  _v.set(w.x, w.y + 1.2, w.z);
  const voices = D.crowdN || CROWD.min;
  audio.crowd?.({ voices, temper: 0.9, swell: 0.85, level: 0.5, pos: _v });
  D.cheer = [];
  if (!life?.live) return;
  for (const [key, body] of life.live) {
    if (!body || body.dead || !body.rig) continue;
    if (body.stationPlace !== ARENA) continue;
    /* Half of them, and the same half every time this touch lands: the hash
     * is on the body's own pool key and on which touch it is. */
    if (hashF(`${key}|${n}`, 'cheer') >= CHEER.share) continue;
    D.cheer.push({ body, t: CHEER.hold });
  }
}

/** One frame of the arms that are up. */
function stepCheer(world, D, dt) {
  if (!D.cheer.length) return;
  const keep = [];
  for (const c of D.cheer) {
    c.t -= dt;
    const b = c.body;
    if (c.t <= 0 || !b || b.dead || !b.rig?.get?.('armR')) continue;
    /* Straight up and a little outboard, both segments, so it reads as an arm
     * and not as a shoulder shrug. `aimBoneWorld` is the same door
     * `Enemy._poseWristGun` writes an arm through, on the same seam: the gait
     * has already run this frame and this lands on top of it. */
    _v2.set(0.28, 1, 0).normalize();
    b.rig.aimBoneWorld('armR', _v2, null);
    b.rig.aimBoneWorld('foreR', _v2, null);
    keep.push(c);
  }
  D.cheer = keep;
}

/** The bout is over: the purse or the bench, the fold, the journal, the card. */
function endBout(world, D, won) {
  const B = D.bout;
  if (!B || B.over) return;
  B.over = true; B.live = false; B.waiting = false;
  const day = world._station?.day | 0;
  douse(world);
  recordBout({ won, name: B.who.name, mine: B.mine, theirs: B.theirs, day });
  /* THE RESULT IN THE TOTE'S OWN SHAPE, so a ticket struck on the bout pays
   * exactly as a ticket on a race does — `Station.payAtTote` is the window and
   * it is not opened here. */
  B.result = duelResult(B.race, won ? 'you' : B.who.id);
  if (won) {
    /* The stake back and the purse on top of it — one payment, through the
     * one pay door, so `Credits.PER_RUN_CAP` still governs it. */
    B.purse = PURSE;
    pay(PURSE + STAKE, 'the bout at the Arena');
    world.notify?.('THE BOUT — YOURS', `${B.mine}–${B.theirs}. The marshal counts out your ${STAKE} and ${PURSE} on top.`);
    note('duel', `took the bout at the Arena — beat ${B.who.name} ${B.mine}–${B.theirs}`, world);
  } else {
    B.purse = 0;
    D.sitOut = SIT_OUT;
    benchPlayer(world);
    world.notify?.('THE BOUT — HIS', `${B.mine}–${B.theirs}. You leave the ${STAKE} on the table and sit down.`);
    note('duel', `lost the bout at the Arena to ${B.who.name} ${B.theirs}–${B.mine}`, world);
  }
  roar(world, D, 99);
  if (B.body) { putAway(world, B.body); B.body = null; }
}

/** A beaten fighter is put on the nearest bench for `SIT_OUT` seconds. */
function benchPlayer(world) {
  const pl = world?.player;
  const p = pl?.position;
  if (!pl || !p || pl.seat) return false;
  const life = world._stationLife;
  const near = seatsNear(world, p.x, p.y, p.z, 8, life?.seats).filter(seatUpright);
  const prop = near[0];
  if (!prop) return false;
  const q = prop.body.position;
  const w = wellOfArena();
  let yaw = seatYaw(prop);
  if (yaw === null) yaw = w ? Math.atan2(w.x - q.x, w.z - q.z) : pl.facing;
  const table = tableBefore(world, q.x, q.z, yaw);
  if (life && !life.seats) life.seats = new Map();
  const claim = {
    prop, table, yaw, state: 'sit', blend: 0,
    pos: q.clone(), quat: prop.body.quaternion.clone(),
    y: q.y + seatTop(prop), tableY: table ? tableTop(table) : null,
    cup: false, cupObj: null,
    feet: { x: q.x + Math.sin(yaw) * 0.10, z: q.z + Math.cos(yaw) * 0.10 },
  };
  life?.seats?.set(prop, pl);
  pl.sitOn(claim);
  return true;
}

/** One frame of the arena. */
function stepArena(world, D, st, dt) {
  const B = D.bout;
  const hour = boutAt(st.day | 0, st.hour);
  const w = wellOfArena();
  if (!w) return;
  const p = world.player?.position;
  const near = p ? Math.hypot(p.x - w.x, p.z - w.z) : Infinity;

  /* ── THE CROWD. `Station.stepCrowd` has already written the tote's twelve
   * into `life.crowd` this frame; a bout is a fuller room than a card, so
   * the count is raised and the pool seats to it on the next re-seat. */
  if (hour != null && near < 60) {
    const n = CROWD.min + Math.floor(hashF(`duel:crowd:${st.day | 0}:${hour}`, 'n') * (CROWD.max - CROWD.min + 1));
    D.crowdN = n;
    const life = world._stationLife;
    if (life) {
      if (!life.crowd) life.crowd = new Map();
      life.crowd.set(ARENA, Math.max(life.crowd.get(ARENA) || 0, n));
    }
    seatTiers(world);
  } else D.crowdN = 0;

  /* ── THE MAN IN THE WELL. He is there for the hour and gone after it. */
  if (hour == null) {
    if (B) {
      if (B.live) endBout(world, D, false);
      if (B.body) putAway(world, B.body);
      D.bout = null;
    }
  } else if (!B && near < 40) openWell(world, D, st);
  else if (B && B.hour !== hour) { if (B.body) putAway(world, B.body); D.bout = null; }

  const cur = D.bout;
  if (!cur) return;
  cur.t += dt;
  if (cur.waiting && cur.body) {
    pin(cur.body, cur.stand.x, cur.stand.z, w.x, w.z, dt);
    /* Nobody within reach of the sand and the hour is running out: he waits.
     * A player who walks away and comes back finds him where he was. */
    return;
  }
  if (!cur.live) return;
  /* THE GATE IS THE GROUND. Out of the sand the blade goes down, and five
   * seconds out of it is a walk-out — the bout is his. */
  if (!inWell(world)) {
    douse(world, 'out of the well — the peace holds up here');
    cur.out += dt;
    if (cur.out >= 5) { endBout(world, D, false); return; }
  } else cur.out = 0;
  if (!cur.body || cur.body.dead || cur.body.alive === false) { endBout(world, D, true); return; }
  scoreTouches(world, D, cur, dt);
}

/** Move the crowd off the room's scatter and onto the benches round the well. */
function seatTiers(world) {
  const life = world._stationLife;
  if (!life?.live) return;
  let i = 0;
  for (const body of life.live.values()) {
    if (!body || body.dead || body.stationPlace !== ARENA) continue;
    if (body.wayR || body.standX === undefined) continue;
    const spot = tierSpot(body.stationSlot ?? i, _v);
    i++;
    if (!spot) continue;
    if (body.__duelTier) continue;
    body.__duelTier = true;
    body.standX = spot.x; body.standZ = spot.z;
    body.standCx = spot.x; body.standCz = spot.z;
    body.standTx = spot.x; body.standTz = spot.z;
    body.position.set(spot.x, spot.y + 0.05, spot.z);
    body.body?.setTransform?.(body.position, null);
    const w = wellOfArena();
    body.standYaw = body.standFace = Math.atan2(w.x - spot.x, w.z - spot.z);
    body.facing = body.standFace;
    body.standStill = true;
    body.standIn = 6;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 *  10. THE SITH
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * HIS NAME, AND IT IS NOT `nameFor('human')`.
 *
 * The cast's human generator is a colonist's name — "Aisha Franklin" — which is
 * right for the eighty people in the concourse and wrong for the one man in
 * the room everybody is not sitting near. Two syllables and an epithet, off
 * the same hash as everything else, so a nameplate at 2.4 m says what he is
 * before he says anything at all.
 */
const SITH_ON = ['Kar', 'Vesh', 'Dro', 'Mal', 'Zar', 'Sev', 'Tal', 'Orn', 'Kae', 'Vor', 'Ith', 'Nyx'];
const SITH_END = ['ath', 'okh', 'vex', 'ir', 'ax', 'un', 'eth', 'oss', 'ar', 'yn', 'ul', 'esh'];
const SITH_EPITHET = ['the Quiet', 'of the Ninth', 'Ashfall', 'the Late', 'of Bosk', 'Two-Hilts', 'the Patient', 'Blackmoor'];
export function sithName(seed) {
  return `${pick(SITH_ON, seed, 'on')}${pick(SITH_END, seed, 'end')} ${pick(SITH_EPITHET, seed, 'ep')}`;
}

/** Whether he is in tonight, and who he is. Seeded on the day. */
export function sithFor(day = 0) {
  const seed = `duel:sith:${day | 0}`;
  return {
    seed,
    name: sithName(seed),
    /* Six nights in seven — a man who is at the same table every night of the
     * year is a fixture, and a fixture is not somebody you notice. */
    in: hashF(seed, 'in') > 0.14,
  };
}

/** His hours: from 22:00 to 02:00, which is two days of the clock. */
export function sithHour(hour = 0) {
  const h = ((hour % 24) + 24) % 24;
  return h >= SITH_FROM || h < 2;
}

/** The booth: a free seat in #14 furthest from the room's middle. */
function boothSeat(world) {
  const p = PLACE.get(CANTINA);
  if (!p) return null;
  const life = world._stationLife;
  const y = floorOf(p) - 2.2;
  const seats = seatsNear(world, p.x, y, p.z, Math.max(p.w, p.d) / 2, life?.seats);
  if (!seats.length) return null;
  let best = seats[0], bd = -1;
  for (const s of seats) {
    const q = s.body.position;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d > bd) { bd = d; best = s; }
  }
  return best;
}

/** He sits down with a cup, and the hilt goes on the table in front of him. */
function seatSith(world, D, st) {
  const who = sithFor(st.day | 0);
  if (!who.in) { D.sith = { state: 'away', day: st.day | 0 }; return; }
  const prop = boothSeat(world);
  const p = PLACE.get(CANTINA);
  if (!prop || !p) return;
  const q = prop.body.position;
  let yaw = seatYaw(prop);
  if (yaw === null) yaw = Math.atan2(p.x - q.x, p.z - q.z);
  const table = tableBefore(world, q.x, q.z, yaw);
  const body = spawnFighter(world, SITH_TYPE, q.x + Math.sin(yaw) * 0.1, q.y, q.z + Math.cos(yaw) * 0.1, {
    name: who.name, role: 'drinking alone',
  });
  if (!body) return;
  const life = world._stationLife;
  if (life && !life.seats) life.seats = new Map();
  const claim = {
    prop, table, yaw, state: 'sit', blend: 1,
    pos: q.clone(), quat: prop.body.quaternion.clone(),
    y: q.y + seatTop(prop), tableY: table ? tableTop(table) : null,
    cup: true, cupObj: prop.seatCup || (prop.seatCup = makeCup()),
  };
  life?.seats?.set(prop, body);
  body.seat = claim;
  body.facing = yaw;
  body.standStill = true;
  /* The hilt on the table, where anybody who sits down opposite can see it. */
  const hilt = makeHilt();
  const top = table ? tableTop(table) : q.y + 0.74;
  const tx = table ? table.body.position.x : q.x + Math.sin(yaw) * 0.5;
  const tz = table ? table.body.position.z : q.z + Math.cos(yaw) * 0.5;
  hilt.position.set(tx, top + 0.025, tz);
  hilt.rotation.z = Math.PI / 2;
  hilt.rotation.y = yaw;
  world.scene?.add(hilt);
  D.sith = {
    who, body, hilt, claim, state: 'sit', day: st.day | 0,
    t: 0, mine: 0, theirs: 0, hp: body.hp, myHp: world.player?.hp ?? 100,
    guards: [], guardT: 0, said: 0,
  };
}

/**
 * THE TALK. `Regulars.talkHook` counts the talk and answers warmly from the
 * third one on; what this adds is the OFFER, and it is not on the count alone:
 * three talks on three DIFFERENT days, which is the player's own sentence —
 * *"talk to him three times over three days"* — and a thing you cannot do in
 * one evening by pressing a key three times.
 *
 * `Station.talkTo` reaches this through `duelKey`'s sibling line: the body is
 * an ordinary resident to everything else in the station, which is what makes
 * walking up to him work at all.
 */
export function sithTalk(world, body) {
  const D = world?._duel;
  const S = D?.sith;
  if (!S || !S.body || S.body !== body || S.state !== 'sit') return false;
  const rec = recordTalk(body) || regularOf(body);
  const days = rec ? (rec.lastDay | 0) - (rec.firstDay | 0) + 1 : 1;
  const n = rec?.n | 0;
  note('talk', `spoke to ${S.who.name} at the cantina — talk ${n}, over ${days} day${days === 1 ? '' : 's'}`, world);
  if (n >= REGULAR_AT && days >= 3) {
    world.notify?.(S.who.name.toUpperCase(), 'three times you have stood at this table. Outside, then. I will follow.');
    beginFollow(world, D, S, 'offered');
    return true;
  }
  const lines = [
    'I drink alone. That was not an invitation.',
    'you carry one too. Does it burn you, or only them?',
    'the drum is full of people who have never been afraid. Sit down.',
    'no. Not tonight.',
  ];
  world.notify?.(S.who.name.toUpperCase(), pick(lines, `${S.who.seed}|${n}`, 'line'));
  return true;
}

/** Up from the table, the hilt off it, and out after you. */
function beginFollow(world, D, S, why) {
  if (S.state !== 'sit') return;
  const b = S.body;
  S.state = 'follow';
  S.why = why;
  S.t = 0;
  /* The seat and the cup go back the way `StationLife.seatRelease` puts them
   * back — a chair left claimed by a body that has walked off is a chair
   * nobody can ever sit on again. */
  const life = world._stationLife;
  if (S.claim) {
    if (life?.seats?.get(S.claim.prop) === b) life.seats.delete(S.claim.prop);
    if (S.claim.cupObj) cupDown(S.claim.cupObj, S.claim.table, S.claim.pos.x, S.claim.pos.z);
    if (S.claim.prop?.body && !S.claim.prop.dead) S.claim.prop.body.wake?.();
  }
  if (b) { b.seat = null; b.standStill = false; b.standCx = b.position.x; b.standCz = b.position.z; }
  if (S.hilt) { S.hilt.parent?.remove(S.hilt); S.hilt = null; }
}

/** One frame of the man behind you. */
function stepFollow(world, D, S, st, dt) {
  const b = S.body;
  const P = world.player?.position;
  if (!b?.position || !P) { endSith(world, D, S, 'gone'); return; }
  S.t += dt;
  const dx = P.x - b.standCx, dz = P.z - b.standCz;
  const d = Math.hypot(dx, dz) || 1e-3;
  if (d > FOLLOW.lose) { endSith(world, D, S, 'lost'); return; }
  /* ── HE STOPS WHEN YOU TURN. `player.facing` is the way you are looking;
   * inside 52° of it he is being looked at, and a man who is being looked at
   * is standing still with his hands empty. That is the whole of the trick,
   * and it is why he is silent: nothing about him is ever announced. */
  const f = world.player.facing ?? 0;
  const seen = (Math.sin(f) * -dx + Math.cos(f) * -dz) / d > FOLLOW.seen;
  let mx = 0, mz = 0;
  if (!seen && d > FOLLOW.near) {
    const want = Math.min(FOLLOW.pace, (d - FOLLOW.near) * 2.2 + (d > FOLLOW.far ? 1.0 : 0));
    const step = Math.min(d - FOLLOW.near, want * dt);
    mx = dx / d * step; mz = dz / d * step;
    b.standCx += mx; b.standCz += mz;
  }
  b.position.x = b.standCx; b.position.z = b.standCz;
  b.body?.setTransform?.(b.position, null);
  if (b.velocity && dt > 0) b.velocity.set(mx / dt, 0, mz / dt);
  const want = (mx * mx + mz * mz) > 1e-9 ? Math.atan2(mx, mz) : Math.atan2(dx, dz);
  b.facing = (b.facing ?? want) + wrapPi(want - (b.facing ?? want)) * Math.min(1, dt * FOLLOW.turn);
  S.seen = seen;
  S.gap = d;

  /* ── THE DARK STRETCH. He lets you get there and then he stops walking. */
  const dark = D.dark || (D.dark = darkStretch(st.deck));
  if (!dark) return;
  const onIt = Math.hypot(P.x - dark.x, P.z - dark.z) < 14;
  if (onIt && S.t >= FOLLOW.before && d <= FOLLOW.far + 1.5) igniteSith(world, D, S);
}

/** He ignites. Everything else in this file is so that this line can happen. */
function igniteSith(world, D, S) {
  if (S.state === 'fight') return;
  S.state = 'fight';
  S.t = 0;
  S.mine = 0; S.theirs = 0;
  S.hp = S.body.hp; S.myHp = world.player?.hp ?? 100;
  makeHostile(S.body);
  world.notify?.(S.who.name.toUpperCase(), 'you should not have let me walk behind you.');
  world.notify?.('THE RING', `first to ${SITH_TOUCHES} touches — and the patrol will be here.`);
}

/** The patrol that breaks it up: two bodies, walked in from up the ring. */
function sendGuards(world, D, S, st) {
  const P = world.player?.position;
  if (!P || S.guards.length) return;
  const y = DECK_Y[st.deck] ?? 0;
  /* TWENTY-TWO METRES ALONG THE RING, which is `StationLife.GUARD_FROM` and
   * its measurement: near enough to arrive inside the fight and far enough
   * that they are seen coming. Both on the same bearing, a stride apart
   * across it, so a patrol arrives as a pair and not as one body inside
   * another — the same shape `StationLife.dispatch` puts them down in. */
  const r = Math.hypot(P.x, P.z) || 1;
  const a = Math.atan2(P.x, P.z);
  const swept = Math.min(22 / r, Math.PI / 3);
  const aa = a + swept;
  const cx = r * Math.sin(aa), cz = r * Math.cos(aa);
  const nx = Math.cos(aa), nz = -Math.sin(aa);
  for (let g = 0; g < 2; g++) {
    const s2 = g ? 1.1 : -1.1;
    const b = spawnFighter(world, 'res_human', cx + nx * s2, y, cz + nz * s2, {
      name: 'Station guard', role: 'security',
    });
    if (b) { b.stationGuard = true; b.standCx = b.position.x; b.standCz = b.position.z; S.guards.push(b); }
  }
  world.notify?.('SECURITY', 'a patrol has been called to the ring');
}

/** They march at the fight, and the fight is over when they reach it. */
function stepGuardsIn(world, S, dt) {
  const P = world.player?.position;
  if (!P) return Infinity;
  let near = Infinity;
  for (const g of S.guards) {
    if (!g?.position || g.dead) continue;
    const dx = P.x - g.standCx, dz = P.z - g.standCz;
    const d = Math.hypot(dx, dz) || 1e-3;
    const step = Math.min(d, 3.8 * dt);
    g.standCx += dx / d * step; g.standCz += dz / d * step;
    g.position.x = g.standCx; g.position.z = g.standCz;
    g.body?.setTransform?.(g.position, null);
    if (g.velocity && dt > 0) g.velocity.set(dx / d * step / dt, 0, dz / d * step / dt);
    g.facing = Math.atan2(dx, dz);
    near = Math.min(near, d);
  }
  return near;
}

/** One frame of the fight on the ring. */
function stepSithFight(world, D, S, st, dt) {
  const b = S.body;
  const p = world.player;
  if (!b || b.dead || b.alive === false) { yieldSith(world, D, S, true); return; }
  S.t += dt;
  /* The same touch accounting the well uses, at two. */
  let land = null;
  if (b.hp < S.hp - 0.01) { S.mine++; land = 'me'; }
  if (p && p.hp < S.myHp - 0.01) { S.theirs++; land = land ? 'both' : 'them'; }
  b.hp = Math.min(b.maxHp, Math.max(b.maxHp * 0.5, S.hp));
  if (p) p.hp = Math.max(p.hp, Math.min(p.maxHp, S.myHp));
  S.hp = b.hp; if (p) S.myHp = p.hp;
  if (land) world.notify?.(land === 'them' ? S.who.name.toUpperCase() : 'A TOUCH', `${S.mine}–${S.theirs}`);
  if (S.t >= GUARDS_AT) sendGuards(world, D, S, st);
  const near = S.guards.length ? stepGuardsIn(world, S, dt) : Infinity;
  if (S.mine >= SITH_TOUCHES) { yieldSith(world, D, S, true); return; }
  if (S.theirs >= SITH_TOUCHES) { yieldSith(world, D, S, false); return; }
  if (S.t >= GUARDS_BY || near <= 3.5) { yieldSith(world, D, S, null); return; }
}

/**
 * HE YIELDS, AND HE IS GONE UNTIL TOMORROW.
 *
 * `won` true is yours, false is his, null is the patrol arriving on two men
 * with blades lit — which nobody wins and which is still an ending, because
 * the guards do not care whose evening it was.
 */
function yieldSith(world, D, S, won) {
  if (S.state === 'done') return;
  S.state = 'done';
  S.won = won;
  const day = world._station?.day | 0;
  douse(world);
  const lines = {
    yes: 'enough. The hilt is yours — I have another, and you will see it.',
    no: 'you are not ready. Drink somewhere else tomorrow.',
    guards: 'the patrol. Another night, then — they always come.',
  };
  const key = won === true ? 'yes' : won === false ? 'no' : 'guards';
  world.notify?.(S.who.name.toUpperCase(), lines[key]);
  S.line = lines[key];
  if (won === true) {
    takeTrophy({ id: `sith:${day}`, name: S.who.name, day, what: 'a red hilt' });
    note('duel', `beat ${S.who.name} on the ring — his hilt is on the desk`, world);
  } else {
    note('duel', won === false ? `${S.who.name} put you down on the ring` : `the patrol broke up the fight on the ring`, world);
  }
  /* A FIGHT THE PATROL ENDED IS NOT A RESULT. The record is what you have
   * beaten and been beaten by; putting a broken-up fight on it as a loss
   * would price your side of tomorrow's card off something nobody won. */
  if (won !== null) recordBout({ won, name: S.who.name, mine: S.mine, theirs: S.theirs, day });
  if (S.body) { putAway(world, S.body); S.body = null; }
  for (const g of S.guards) putAway(world, g);
  S.guards = [];
}

/** He goes: the hour turned, you lost him, or the world took his body. */
function endSith(world, D, S, why) {
  S.state = 'done';
  S.why = why;
  if (S.hilt) { S.hilt.parent?.remove(S.hilt); S.hilt = null; }
  if (S.body) { putAway(world, S.body); S.body = null; }
  for (const g of S.guards || []) putAway(world, g);
  S.guards = [];
}

/** One frame of #14's booth. */
function stepSith(world, D, st, dt) {
  const S = D.sith;
  const day = st.day | 0;
  const on = sithHour(st.hour);
  /* A new day is a new night: the record is dropped and he may be back. */
  if (S && S.day !== day && S.state !== 'follow' && S.state !== 'fight') { endSith(world, D, S, 'day'); D.sith = null; return; }
  if (!on) {
    if (S && (S.state === 'sit' || S.state === 'away')) { endSith(world, D, S, 'hour'); D.sith = null; }
    return;
  }
  const p = world.player?.position;
  const room = PLACE.get(CANTINA);
  if (!S) {
    if (!p || !room) return;
    if (Math.hypot(p.x - room.x, p.z - room.z) > 26) return;
    seatSith(world, D, st);
    return;
  }
  if (S.state === 'away' || S.state === 'done') return;
  if (S.state === 'sit') {
    const b = S.body;
    if (!b || b.dead) { endSith(world, D, S, 'gone'); return; }
    /* He is held at the table: the chair pinned, the cup in his hand and his
     * shoulders on the seat's bearing. `StationLife.stepStanding` does this
     * for everybody in the pool and he is not in the pool. */
    if (S.claim) {
      holdSeat(S.claim);
      if (S.claim.cupObj) cupInHand(S.claim.cupObj, b.rig, 'R');
      b.position.x = S.claim.pos.x + Math.sin(S.claim.yaw) * 0.10;
      b.position.z = S.claim.pos.z + Math.cos(S.claim.yaw) * 0.10;
      b.body?.setTransform?.(b.position, null);
      b.velocity?.set?.(0, 0, 0);
      b.facing = S.claim.yaw;
    }
    /* ── AND HE FOLLOWS YOU OUT AFTER MIDNIGHT. The hour, and the door: you
     * are the one who left, so he goes when you are out of the room. */
    const h = ((st.hour % 24) + 24) % 24;
    const past = h >= SITH_FOLLOWS && h < 2;
    const out = !p || !room || Math.hypot(p.x - room.x, p.z - room.z) > Math.max(room.w, room.d) / 2 + 2;
    if (past && out) beginFollow(world, D, S, 'midnight');
    return;
  }
  if (S.state === 'follow') { stepFollow(world, D, S, st, dt); return; }
  if (S.state === 'fight') { stepSithFight(world, D, S, st, dt); }
}

/* ══════════════════════════════════════════════════════════════════════════
 *  11. THE STEP — `Station.stepStation`'s one line
 * ══════════════════════════════════════════════════════════════════════════ */

export function stepDuel(world, st, dt) {
  const D = world?._duel;
  if (!D || !st || !(dt > 0)) return;
  if (D.sitOut > 0) {
    D.sitOut -= dt;
    if (D.sitOut <= 0) { D.sitOut = 0; world.notify?.('THE ARENA', 'you can stand. The kerb is open again.'); }
  }
  /* THE GATE, EVERY FRAME AND BEFORE ANYTHING ELSE. A blade lit by any door
   * this file does not know about is put away here — see `bladeAllowed`. */
  if (!bladeAllowed(world) && world.player?.saber?.lit) douse(world, BLADE_REFUSAL);
  if (st.deck === DECK) {
    stepArena(world, D, st, dt);
    stepSith(world, D, st, dt);
  }
  stepCheer(world, D, dt);
}

/* ══════════════════════════════════════════════════════════════════════════
 *  12. WHAT A CHECK AND A PANEL READ
 * ══════════════════════════════════════════════════════════════════════════ */

/** Everything about the arena right now, as data. No stake, no ticket in it. */
export function duelState(world) {
  const D = world?._duel;
  const st = world?._station;
  if (!D || !st) return null;
  const B = D.bout, S = D.sith;
  return {
    deck: D.deck, hour: st.hour, day: st.day | 0,
    boutHours: boutHoursOn(st.day | 0),
    on: boutAt(st.day | 0, st.hour),
    bout: B ? {
      hour: B.hour, who: B.who.name, style: B.who.style, type: B.who.type,
      waiting: !!B.waiting, live: !!B.live, over: !!B.over,
      mine: B.mine, theirs: B.theirs, purse: B.purse | 0, race: B.race?.id || null,
    } : null,
    sith: S ? {
      name: S.who?.name || null, state: S.state, gap: S.gap ?? null,
      /* `guards` and the rest are read defensively because a dark night is a
       * record with nothing in it but `{ state: 'away' }` — see `seatSith`. */
      mine: S.mine | 0, theirs: S.theirs | 0, guards: (S.guards || []).length,
      line: S.line || null, seen: !!S.seen, t: S.t | 0,
    } : null,
    crowd: crowdIn(world),
    sitOut: Math.max(0, Math.round(D.sitOut)),
    blade: bladeAllowed(world),
    record: duelRecord(),
  };
}

/** How many bodies are on the tiers right now. */
export function crowdIn(world) {
  const life = world?._stationLife;
  if (!life?.live) return 0;
  let n = 0;
  for (const b of life.live.values()) if (b && !b.dead && b.stationPlace === ARENA) n++;
  return n;
}

/** The board for the bout at this hour, for a room that wants to print it. */
export function duelBoard(day = 0, hour = 0) { return boardFor(duelRaceFor(day, hour)); }
