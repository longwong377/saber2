/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE WAR REACHES THE STATION — V19 hole 4 / addition 1
 * ══════════════════════════════════════════════════════════════════════════
 *
 * *"The station never feels the war outside."* The battle in the window is
 * `DeckBattle` (hulls, bolts, fighters) run off `SkyDome.battlePhase`, a pure
 * function of the orbit clock; the front the player is fighting on is
 * `Front.frontAt` at the campaign's engagement; and until this file the drum
 * read neither. Three things, each off the REAL state and not a timer of its
 * own:
 *
 *   (a) CASUALTIES. `StationLife.bringWounded` is the party off the transport
 *       — walking wounded at a limp, litter cases between two bearers — and it
 *       ran once per visit for your own company. `casualtyPlan(phase)` now
 *       schedules parties off the battle's phase: none while the lines are
 *       arriving or gone, a pair of walkers every eight station-minutes under
 *       broadside, litters every four once a hull is breaking up, one more
 *       litter when the hull that broke was ours. ONE hook: `stepStationLife`
 *       calls `stepStationWar`, which calls `bringWounded` with the party.
 *
 *   (b) THE ALERT. When the phase TURNS — a new round (`arrive`), a hull lost
 *       (`breakup`) — a klaxon sounds (`audio.shape`, three sawtooth blasts,
 *       the PA's own chime and a spoken line through `audio.radio`), the
 *       deck's strips go red for `ALERT_FOR` seconds (`M.strip`'s emissive,
 *       and `M.status` brightened; Morning keeps driving the intensity), and
 *       COMMAND CLOSES A ROOM on deck 48 or 44 for `ORDER_MIN` station-minutes:
 *       a guard pair at its door, the residents inside sent out through the
 *       same `setOut` an event's stir uses, the pool kept out of it through
 *       `life.crowd` (the same number the tote's crowd writes), and the key at
 *       its door refused with a line (`warKey`, asked first by
 *       `Station.stationKey`).
 *
 *   (c) THE BRIEFING FROM THE REAL MAP. #41's screen wall is a canvas
 *       (`dressStationWar`) painted from `campaignFront`: the theatre outside,
 *       the campaign that opens on it, how many of its missions the ledger
 *       says you have taken, the NEXT one by name and brief, and the front at
 *       the engagement you are on — its bearing from the deployment seed, its
 *       distance shortened as the lines outside close (`battlePhase.sep`).
 *       Repainted only when `stamp` changes, so a still front costs nothing.
 *
 * DETERMINISTIC. No `Math.random`: names, rooms and parties come off `h2` of
 * the alert count and the day; the phase comes off the orbit clock.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { battlePhase } from '../engine/SkyDome.js';
import { audio } from '../engine/Audio.js';
import { PLACE, DECK_Y, placesOn, floorOf } from './StationPlan.js';
import { bringWounded } from './StationLife.js';
/**
 * FOUR MODULES, NOT STATICALLY IMPORTED. `Station.js` imports this file (the
 * wall, the key) and `StationLife.js` does too (the step); `Hangar.js`,
 * `StationSound.js` and `DeckBattle.js` all import `Station.js`, and
 * `Levels.js` imports it for STATION_LEVEL. A static edge from here to any of
 * them is a cycle an entry that imports `StationLife.js` or `Station.js`
 * FIRST cannot evaluate — measured: `reachable.mjs` imports `StationLife.js`
 * first and died on `Station.js:2855`, `STOPS` in its TDZ. So the four are
 * fetched once, off the microtask queue; by the time a station is dressed
 * they have long been loaded by `World.js`, and every reader below answers
 * plainly on the frame one is somehow not there yet.
 */
const late = { Levels: null, Hangar: null, Sound: null, Battle: null };
for (const [k, p] of [['Levels', './Levels.js'], ['Hangar', './Hangar.js'], ['Sound', './StationSound.js'], ['Battle', './DeckBattle.js']]) {
  import(p).then((m) => { late[k] = m; }).catch(() => {});
}
import { frontAt } from '../world/Front.js';
import { loadProgress } from './Progress.js';
import { speak } from './Voice.js';

/** How long the strips stay red, real seconds. */
export const ALERT_FOR = 20;
/** How long Command's order closes a room, station minutes. */
export const ORDER_MIN = 10;
/** The wall's canvas. */
export const WALL_W = 512, WALL_H = 300;
/** How near the player must be for the wall to repaint. */
export const WALL_NEAR = 45;
/** Rooms Command never closes: the ring, your cabin, the barracks, the CIC,
 *  the two wards, the brig, the reactor, the tram. */
export const NEVER_CLOSED = Object.freeze(new Set([26, 27, 29, 40, 41, 43, 44, 47, 48]));

const NAMES = ['Rehn', 'Task', 'Vell', 'Oda', 'Brakk', 'Dunn', 'Sable', 'Trask', 'Kell', 'Mott', 'Iss', 'Pell'];

function h2(a, b) {
  let h = Math.imul(a * 374761393 + b * 668265263, 1) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const _v = new THREE.Vector3();

/* ══════════════════════════════════════════════════════════════════════════ */
/*  THE BATTLE, AS THE STATION READS IT                                       */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * The orbit clock the battle runs on. A check may pin it (`world._warT`);
 * otherwise the fleet's own, then the sky's.
 */
export function battleClock(world) {
  if (typeof world?._warT === 'number') return world._warT;
  const t = world?._deckBattle?.t;
  if (typeof t === 'number') return t;
  const s = world?.engine?.skyDome?._orbitT;
  return typeof s === 'number' ? s : 0;
}

/** What is happening outside: `battlePhase` plus the fleet's hull count. */
export function warPhase(world) {
  const t = battleClock(world);
  const ph = battlePhase(t);
  const B = late.Battle ? late.Battle.deckBattleState(world) : null;
  return { ...ph, clock: t, roundN: Math.floor(t / 360), shown: B ? B.shown : null };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  (a) CASUALTIES OFF THE FRONT'S REAL STATE                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

/**
 * How often a party comes and how big it is, by phase. `every` is station
 * minutes; a zero party is a quiet front.
 */
export function casualtyPlan(ph) {
  const ours = ph?.victimSide === 'republic' ? 1 : 0;
  switch (ph?.phase) {
    case 'broadside':  return { every: 8, walking: 2, litters: 0 };
    case 'dying':      return { every: 5, walking: 2, litters: 1 + ours };
    case 'breakup':    return { every: 4, walking: 3, litters: 2 + ours };
    case 'reinforced': return { every: 4, walking: 2, litters: 2 + ours };
    case 'withdraw':   return { every: 6, walking: 1, litters: 1 };
    default:           return { every: 2, walking: 0, litters: 0 };
  }
}

/** A man off the transport — a designation `nameOf` prints, and `war` so the
 *  medbay files him without a company. */
function warMan(k, salt) {
  const name = NAMES[Math.floor(h2(k, salt) * NAMES.length) % NAMES.length];
  return { designation: `CT-${4000 + ((k * 37 + salt) % 900)}`, nickname: name, war: true, hp: 0.25 + 0.3 * h2(k, salt + 1) };
}

/** The party for a phase: the shape `bringWounded` walks. `k` salts the names. */
export function casualtyParty(ph, k = 0) {
  const plan = casualtyPlan(ph);
  const walking = [], litters = [];
  let n = 0;
  for (let i = 0; i < plan.walking; i++) walking.push(warMan(k * 16 + n++, 11));
  for (let i = 0; i < plan.litters; i++) {
    litters.push({ man: warMan(k * 16 + n++, 23), bearers: [warMan(k * 16 + n++, 31), warMan(k * 16 + n++, 41)] });
  }
  return { walking, litters, size: walking.length + litters.length, every: plan.every };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  (b) THE ALERT AND THE ORDER                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

function warOf(life) {
  return life.war || (life.war = {
    key: null, alerts: 0, alert: 0, strip0: null, status0: null,
    order: null, nextParty: -1, parties: 0, wallIn: 0,
  });
}

const absMin = (st) => ((st.day | 0) * 24 + (Number(st.hour) || 0)) * 60;

/** The rooms Command may close on a deck. */
export function closableRooms(deck) {
  return placesOn(deck).filter((p) => !p.external && Array.isArray(p.door) && Number.isInteger(p.id)
    && !NEVER_CLOSED.has(p.id) && p.w > 0 && p.d > 0);
}

/** Three sawtooth blasts on the ambience bus. */
function klaxon(pos) {
  try {
    return audio.shape({
      dur: 2.6, gain: 0.5, pos, dest: audio.ambBus,
      build: (ctx, head, t0) => {
        const srcs = [];
        for (let i = 0; i < 3; i++) {
          const at = t0 + i * 0.85;
          const o = ctx.createOscillator(); o.type = 'sawtooth';
          o.frequency.setValueAtTime(420, at);
          o.frequency.linearRampToValueAtTime(640, at + 0.45);
          const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
          g.gain.setTargetAtTime(1, at, 0.01);
          g.gain.setTargetAtTime(0.0001, at + 0.55, 0.05);
          o.connect(g); g.connect(head);
          srcs.push(o);
        }
        return srcs;
      },
    });
  } catch { return false; }
}

function redden(st, war, on) {
  const M = st.mats;
  if (!M?.strip) return;
  if (on && war.strip0 === null) {
    war.strip0 = M.strip.emissive.getHex();
    M.strip.emissive.setHex(0xff2a1a);
    if (M.status) { war.status0 = M.status.emissiveIntensity; M.status.emissiveIntensity = war.status0 * 2.2; }
  } else if (!on && war.strip0 !== null) {
    M.strip.emissive.setHex(war.strip0);
    if (M.status && war.status0 !== null) M.status.emissiveIntensity = war.status0;
    war.strip0 = null; war.status0 = null;
  }
}

/** The door's outward unit vector and the guards' two stands. */
function doorFrame(room) {
  const [dx, dz] = room.door;
  let ux = dx - room.x, uz = dz - room.z;
  const d = Math.hypot(ux, uz) || 1;
  ux /= d; uz /= d;
  return { dx, dz, ux, uz, tx: -uz, tz: ux };
}

function postGuards(world, st, life, T, war) {
  const O = war.order;
  const room = PLACE.get(O.id);
  if (!room || room.deck !== st.deck || world.netMode === 'client' || !world.spawnEnemy) return 0;
  const F = doorFrame(room);
  const y = (DECK_Y[st.deck] ?? 0) + 0.1;
  let n = 0;
  for (let g = 0; g < 2; g++) {
    const s = g ? 0.9 : -0.9;
    _v.set(F.dx + F.ux * 0.7 + F.tx * s, y, F.dz + F.uz * 0.7 + F.tz * s);
    let b = null;
    try { b = world.spawnEnemy('res_human', _v.clone(), { team: world.player?.team ?? 0, armour: T.GUARD_KIT }); } catch {}
    if (!b) continue;
    b.stationGuard = true; b.stationResident = true; b.noAmbientHarm = true;
    b.stationName = 'the watch'; b.stationRole = 'security'; b.stationSpecies = 'human';
    b.stationPlace = 0; b.stationSlot = 0;
    b.wayAngle = Math.atan2(_v.x, _v.z); b.wayR = Math.hypot(_v.x, _v.z); b.wayPace = 1; b.wayLegs = [];
    /* Held at the door by `stepWalkers`' wait branch, and a body on a mission
     * is not the pool's to cull — the guide's own two rules. */
    b.wayMission = { wait: () => true };
    b.facing = Math.atan2(F.ux, F.uz);
    b.warPost = { x: _v.x, y, z: _v.z };
    life.live.set(`war:guard:${g}`, b);
    O.guards.push(`war:guard:${g}`);
    n++;
  }
  return n;
}

/** Everybody standing in the room walks out of its door — `stir`'s own eight
 *  writes and its `setOut`, from the threshold. */
function clearRoom(world, st, life, T, room) {
  const F = doorFrame(room);
  const y = (DECK_Y[st.deck] ?? 0) + 0.1;
  let out = 0;
  for (const [key, body] of life.live) {
    if (!body || key.startsWith('war:') || body.stationPlace !== room.id) continue;
    if (body.wayR || body.standStill || body.__stationTouched || body.alive === false || body.dead) continue;
    const x = F.dx + F.ux * 1.6, z = F.dz + F.uz * 1.6;
    body.position?.set(x, y, z);
    body.body?.setTransform?.(body.position, null);
    body.wayAngle = Math.atan2(x, z); body.wayR = Math.hypot(x, z);
    body.wayPace = 0.9 + ((body.stationSlot | 0) % 7) / 50;
    body.waySeedA = Math.round((body.stationPlace | 0) * 10); body.waySeedB = (body.stationSlot | 0) * 7 + 5;
    body.wayLegs = null; body.wayAt = 0; body.wayT = 0; body.wayTo = 0; body.wayTrips = 0; body.wayDwell = 0;
    if (T.setOut(st.deck, st.hour, body)) { body.stationStir = true; out++; }
    else { T.removeBody(world, body); life.live.delete(key); out++; }
  }
  return out;
}

function closeRoom(world, st, life, T, war) {
  const deck = (st.deck === 44 || st.deck === 48) ? st.deck : 48;
  const list = closableRooms(deck);
  if (!list.length) return null;
  const room = list[Math.floor(h2(war.alerts, st.day | 0) * list.length) % list.length];
  war.order = { id: room.id, deck, name: room.name, until: absMin(st) + ORDER_MIN, guards: [], out: 0 };
  if (room.deck === st.deck) {
    if (!life.crowd) life.crowd = new Map();
    war.crowd0 = life.crowd.get(room.id);
    life.crowd.set(room.id, -1e6);
    war.order.out = clearRoom(world, st, life, T, room);
    postGuards(world, st, life, T, war);
  }
  world.notify?.('COMMAND ORDER', `#${room.id} ${room.name} is closed for ${ORDER_MIN} minutes — the watch is on its door`);
  return war.order;
}

function reopen(world, st, life, T, war) {
  const O = war.order;
  if (!O) return;
  for (const key of O.guards) { const b = life.live.get(key); if (b) { T.removeBody(world, b); life.live.delete(key); } }
  if (life.crowd) { if (war.crowd0 === undefined) life.crowd.delete(O.id); else life.crowd.set(O.id, war.crowd0); }
  war.order = null;
  world.notify?.('COMMAND ORDER', `#${O.id} ${O.name} is open again`);
}

function alert(world, st, life, T, war, ph, why) {
  war.alerts++;
  war.alert = ALERT_FOR;
  redden(st, war, true);
  const p = world.player?.position;
  _v.set(p ? p.x : 0, (DECK_Y[st.deck] ?? 0) + 4, p ? p.z : 0);
  war.klaxon = klaxon(_v);
  late.Sound?.chime(_v);
  const line = why === 'lost'
    ? `${ph.victimSide === 'republic' ? 'a Venator' : 'a Providence'} is breaking up outside — battle stations`
    : `the lines are back — round ${war.alerts} — battle stations`;
  try { war.spoke = speak(`all hands. ${line}`, 'tannoy', { pos: _v, gain: 0.9 }) ? line : ''; } catch { war.spoke = ''; } // V20 lane 4
  world.notify?.('BATTLE STATIONS', line);
  /* A turn for the worse brings the next party sooner: within the new
   * phase's own cadence, not the old one's. */
  if (war.nextParty >= 0) war.nextParty = Math.min(war.nextParty, absMin(st) + casualtyPlan(ph).every);
  if (war.order) reopen(world, st, life, T, war);
  closeRoom(world, st, life, T, war);
}

/**
 * THE KEY AT A CLOSED DOOR — `Station.stationKey` asks this first. True when
 * the press was spent on the refusal.
 */
export function warKey(world) {
  const O = world?._stationLife?.war?.order;
  const st = world?._station;
  if (!O || !st || O.deck !== st.deck) return false;
  const room = PLACE.get(O.id);
  const p = world.player?.position;
  if (!room || !p) return false;
  const near = Math.hypot(p.x - room.door[0], p.z - room.door[1]) <= 4;
  if (!near) return false;
  const left = Math.max(1, Math.ceil(O.until - absMin(st)));
  world.notify?.('THE WATCH', `${room.name} is closed by order of the CIC — ${left} minute${left === 1 ? '' : 's'} more`);
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  (c) THE BRIEFING FROM THE REAL MAP                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

/** The key of a `LEVELS` row, or null. */
function levelKeyOf(lvl) {
  if (!lvl || !late.Levels) return null;
  for (const k of Object.keys(late.Levels.LEVELS)) if (late.Levels.LEVELS[k] === lvl) return k;
  return null;
}

/**
 * The campaign as the ledger and the window know it.
 * @returns {{ theatre, key, campaign, done, next, engagement, front, sep, phase, stamp }}
 */
export function campaignFront(world, st = world?._station) {
  const lvl = late.Hangar ? late.Hangar.outsideLevel(world) : null;
  const key = levelKeyOf(lvl);
  const L = late.Levels;
  const campaign = (L && (L.campaignAt(key) || L.CAMPAIGNS[L.CAMPAIGN_IDS[0]])) || { name: 'campaign pending', missions: [] };
  const missions = campaign.missions || [];
  let done = 0;
  try {
    for (const r of loadProgress().recent || []) {
      if (r.mode === 'campaign' && (r.depth | 0) > done) done = r.depth | 0;
    }
  } catch {}
  done = Math.min(done, missions.length);
  const next = missions[Math.min(done, missions.length - 1)] || null;
  let engagement = 1;
  for (let i = 0; i < Math.min(done, missions.length); i++) engagement += missions[i].engagements | 0;
  const ph = warPhase(world);
  const seed = (st?.day | 0) + 1;
  const f = frontAt(engagement, { seed });
  /* The line the window shows: the campaign's distance, shortened as the
   * fleets outside close on the station. */
  const distance = Math.round(f.distance * (0.55 + 0.45 * ph.sep));
  const bearingDeg = Math.round(f.bearing * 180 / Math.PI) % 360;
  const stamp = `${key || '-'}:${done}/${missions.length}:e${engagement}:${distance}m@${bearingDeg}:${ph.phase}:${ph.victimSide}`;
  return { theatre: lvl?.name || st?.theatre || 'the line', key, campaign, done, next, engagement,
    front: { bearing: f.bearing, distance, dir: f.dir }, sep: ph.sep, phase: ph.phase, victimSide: ph.victimSide, won: done >= missions.length, stamp };
}

function wrap(text, n) {
  const words = String(text || '').split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > n) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

/** Paint the wall. Returns the stamp it painted. */
export function paintWar(ctx, W, H, F) {
  ctx.fillStyle = '#07111c'; ctx.fillRect(0, 0, W, H);
  /* The grid. */
  ctx.strokeStyle = '#123047'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  /* The map: the station at the centre-left, the front a bar across at its
   * distance along its bearing, the enemy's side shaded beyond it. */
  const cx = W * 0.36, cy = H * 0.56, scale = (W * 0.3) / 200;
  const d = F.front.distance * scale;
  const bx = cx + F.front.dir.x * d, bz = cy + F.front.dir.z * d;
  const px = -F.front.dir.z, pz = F.front.dir.x;
  ctx.fillStyle = F.victimSide === 'republic' ? '#3a1414' : '#14261a';
  ctx.beginPath();
  ctx.moveTo(bx + px * 260, bz + pz * 260); ctx.lineTo(bx - px * 260, bz - pz * 260);
  ctx.lineTo(bx - px * 260 + F.front.dir.x * 400, bz - pz * 260 + F.front.dir.z * 400);
  ctx.lineTo(bx + px * 260 + F.front.dir.x * 400, bz + pz * 260 + F.front.dir.z * 400);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#ff6a3a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(bx + px * 140, bz + pz * 140); ctx.lineTo(bx - px * 140, bz - pz * 140); ctx.stroke();
  ctx.fillStyle = '#9fd0ff';
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#4a7fa8'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, bz); ctx.stroke();
  /* The text. */
  ctx.fillStyle = '#e8f1ff'; ctx.font = 'bold 20px monospace';
  ctx.fillText(String(F.theatre).toUpperCase(), 16, 28);
  ctx.font = '13px monospace'; ctx.fillStyle = '#9fd0ff';
  ctx.fillText(`${F.campaign.name || 'CAMPAIGN'} — ${F.done}/${F.campaign.missions.length} taken`, 16, 48);
  ctx.fillStyle = '#ff9a6a';
  ctx.fillText(`FRONT ${F.front.distance} m  brg ${Math.round(F.front.bearing * 180 / Math.PI) % 360}°  eng ${F.engagement}`, 16, H - 16);
  ctx.fillStyle = '#e8f1ff'; ctx.font = 'bold 14px monospace';
  const tx = W * 0.66;
  ctx.fillText(F.won ? 'CAMPAIGN WON' : `NEXT: ${F.next?.name || '—'}`, tx, 78);
  ctx.font = '12px monospace'; ctx.fillStyle = '#b8c8d8';
  let y = 98;
  for (const l of wrap(F.won ? 'The line holds. Stand the company down.' : (F.next?.brief || ''), 24)) { ctx.fillText(l, tx, y); y += 16; }
  ctx.fillStyle = F.victimSide === 'republic' ? '#ff6a3a' : '#7fd08a';
  ctx.fillText(`OUTSIDE: ${F.phase.toUpperCase()}`, tx, y + 10);
  return F.stamp;
}

/**
 * THE TACTICAL WALL — a canvas over #41's centre board, once per deck-48 visit.
 */
export function dressStationWar(world, st) {
  if (!world || !st || st.deck !== 48 || st.wall) return null;
  const p = PLACE.get(41);
  if (!p || p.deck !== 48) return null;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = WALL_W; canvas.height = WALL_H; }
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; }
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0x9fd0ff, toneMapped: false });
  mat.name = 'station-sign-warwall';
  mat.userData.key = 'sign';
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.0), mat);
  mesh.name = 'station-war-wall';
  const lx = 0, ly = p.h - 2.6, lz = p.d / 2 - 0.8;
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  mesh.position.set(p.x + lx * c + lz * s, floorOf(p) + ly, p.z - lx * s + lz * c);
  mesh.rotation.y = p.yaw + Math.PI;
  world.scene.add(mesh);
  st.wall = { mesh, canvas, texture: tex, material: mat, stamp: '', paints: 0 };
  st.draws = (st.draws || 0) + 1;
  paintWall(world, st, true);
  return st.wall;
}

/** Repaint if the front moved. Returns true when it painted. */
export function paintWall(world, st, force = false) {
  const wall = st?.wall;
  if (!wall) return false;
  const F = campaignFront(world, st);
  if (!force && F.stamp === wall.stamp) return false;
  const p = world.player?.position;
  if (!force && p && Math.hypot(p.x - wall.mesh.position.x, p.z - wall.mesh.position.z) > WALL_NEAR) return false;
  const ctx = wall.canvas?.getContext?.('2d');
  if (ctx) paintWar(ctx, WALL_W, WALL_H, F);
  if (wall.texture) wall.texture.needsUpdate = true;
  wall.stamp = F.stamp;
  wall.front = F;
  wall.paints++;
  return true;
}

export function undressStationWar(world) {
  const st = world?._station;
  const life = world?._stationLife;
  if (life?.war) redden(st || { mats: null }, life.war, false);
  if (st?.wall) {
    st.wall.mesh.parent?.remove(st.wall.mesh);
    st.wall.mesh.geometry?.dispose?.();
    st.wall.material?.dispose?.();
    st.wall.texture?.dispose?.();
    st.wall = null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  ONE FRAME                                                                 */
/* ══════════════════════════════════════════════════════════════════════════ */

export function stepStationWar(world, st, life, dt, T) {
  if (!st || !life || !(dt > 0)) return;
  const war = warOf(life);
  const ph = warPhase(world);
  const key = `${ph.roundN}:${ph.phase}`;
  /* The first frame sets the key and says nothing — a klaxon as the doors
   * open reads as a cutscene. */
  if (war.key === null) war.key = key;
  else if (key !== war.key) {
    war.key = key;
    if (ph.phase === 'breakup') alert(world, st, life, T, war, ph, 'lost');
    else if (ph.phase === 'arrive') alert(world, st, life, T, war, ph, 'round');
  }
  /* The strips. */
  if (war.alert > 0) { war.alert -= dt; if (war.alert <= 0) redden(st, war, false); }
  /* The order: hold the pair at the door, and lift it on the clock. */
  const O = war.order;
  if (O) {
    if (absMin(st) >= O.until) reopen(world, st, life, T, war);
    else if (O.deck === st.deck) {
      for (const k of O.guards) {
        const g = life.live.get(k);
        if (!g?.position || !g.warPost) continue;
        g.position.set(g.warPost.x, g.warPost.y, g.warPost.z);
        g.body?.setTransform?.(g.position, null);
        if (g.velocity) g.velocity.set(0, 0, 0);
      }
    }
  }
  /* The casualties, on the station clock. */
  const now = absMin(st);
  if (war.nextParty < 0) war.nextParty = now + casualtyPlan(ph).every;
  if (now >= war.nextParty && st.deck === 48 && !life.priming) {
    const P = casualtyParty(ph, war.parties);
    war.nextParty = now + P.every;
    if (P.size) { war.parties++; war.lastParty = bringWounded(world, st, life, P); }
  }
  /* The wall, polled once a second. */
  war.wallIn -= dt;
  if (war.wallIn <= 0) { war.wallIn = 1; paintWall(world, st); }
}
