/**
 * ══════════════════════════════════════════════════════════════════════════
 *  THE LIVE FEED — the race itself, on the room's screen, from a long way off
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The player: *"I want to see feeds of the actual pod racing live feed, not
 * just the representations … you should see the actual race from a screen,
 * every race different procedurally … the feed can be not perfect since it's
 * broadcasting all the way from Tatooine."*
 *
 * So this is a CAMERA, not a diagram. A second, private scene holds a track
 * built for THIS race off its own seed — a closed course of sand, canyon
 * walls, spires, gate pylons and a start arch — and a pod per entrant built
 * out of the kit's own primitives in the entrant's own colour. Every frame the
 * pods are put where the simulation says they are (`shotOf`'s runner rows,
 * smoothed between the feed's ticks), a director picks a broadcast camera —
 * the chase behind the leader, a trackside camera at the gate a moment
 * happened at, a high wide at the start — and the scene is rendered into a
 * texture. The screen's material is a shader that shows that texture through
 * a long-haul link: scanlines, a little chroma bleed, a roll of grain, a tear
 * now and then and, once in a while, a second of static. The caption strip
 * the 2-D painter draws stays along the foot, so the announcer is still read.
 *
 * ── WHAT IT COSTS, AND WHEN ────────────────────────────────────────────────
 * One extra render of a ~15 k-triangle scene at 512 × 288, at most 24 times a
 * second, ONLY while a race is running AND the player is within `NEAR` of a
 * screen showing it. Between races, or from across the deck, the screen is
 * the painted picture and this file does nothing. Headless there is no
 * renderer and it is never constructed; the 2-D painter is the whole feed
 * there, so every check that reads the canvas still reads it.
 *
 * ── AND IT IS THE SAME SIMULATION ──────────────────────────────────────────
 * Nothing here decides the race. A pod's place on the track is the sim's
 * progress and standing; the cut the director makes is the moment the sim
 * announced. Two rooms showing the same race show the same race.
 */

import * as THREE from '../../vendor/three/three.module.js';
import { entrantHue } from './Spectacle.js';

export const FEED_W = 512, FEED_H = 288;
/** How near a screen the player has to be for the camera to run. */
export const NEAR = 45;
/** The link's frame rate; a broadcast is not the game's frame rate. */
export const FPS = 24;
/** Laps of the built loop that one race covers. */
const LAPS = 2;

const TAU = Math.PI * 2;

function rngOf(seed) {
  let a = (seed >>> 0) || 1;
  const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  return r;
}
function hash32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/* ── THE SHADER: a picture arriving over a long link ─────────────────────── */
const FEED_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FEED_FRAG = /* glsl */`
uniform sampler2D tFeed;
uniform sampler2D tCap;
uniform float uTime;
uniform float uSeed;
uniform float uLive;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  /* the caption strip the painter draws stays along the foot */
  if (uv.y < 0.18) { gl_FragColor = texture2D(tCap, uv); return; }
  float t = uTime;
  /* a tear: a band that slides the picture sideways for a moment */
  float tear = step(0.985, hash(vec2(floor(t * 3.0), 1.0)));
  float band = smoothstep(0.02, 0.0, abs(uv.y - fract(t * 0.7)) - 0.03);
  uv.x += tear * band * 0.06;
  /* the roll: the whole frame sags a hair on a slow cycle */
  uv.y += 0.004 * sin(t * 1.3 + uv.x * 3.0);
  /* chroma bleed: the reds arrive a little to the right */
  float ab = 0.0025 + 0.002 * sin(t * 0.9);
  vec3 c;
  c.r = texture2D(tFeed, uv + vec2(ab, 0.0)).r;
  c.g = texture2D(tFeed, uv).g;
  c.b = texture2D(tFeed, uv - vec2(ab, 0.0)).b;
  /* scanlines and grain */
  float scan = 0.88 + 0.12 * sin(uv.y * 288.0 * 3.14159);
  float grain = (hash(uv * 200.0 + fract(t * 7.0)) - 0.5) * 0.08;
  c = c * scan + grain;
  /* static: a second of it every twenty-odd */
  float drop = step(0.955, hash(vec2(floor(t / 1.3), 7.0)));
  vec3 snow = vec3(hash(uv * 90.0 + t * 13.0)) * 0.7 + 0.15;
  c = mix(c, snow, drop * uLive);
  /* vignette, and the phosphor's own tint */
  float v = smoothstep(0.95, 0.35, length(uv - 0.5) * 1.15);
  c *= 0.75 + 0.35 * v;
  c = mix(c, c * vec3(0.9, 1.0, 1.08), 0.5);
  gl_FragColor = vec4(c, 1.0);
}`;

/* ── THE POD ─────────────────────────────────────────────────────────────── */
function podOf(hue, kind = 'pod') {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue / 360, 0.55, 0.5), roughness: 0.6, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.8, metalness: 0.2 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff7a20, emissiveIntensity: 2.2 });
  if (kind === 'pod') {
    /* the cockpit: a hull with a canopy, on a skid */
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 2.2), body); hull.position.y = 0.5; g.add(hull);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), dark); canopy.position.set(0, 0.95, -0.2); canopy.scale.set(1, 0.7, 1.3); g.add(canopy);
    /* two engines out front, cables back to the pod, a flame in each */
    for (const s of [-1, 1]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 4.0, 10), body);
      eng.rotation.x = Math.PI / 2; eng.position.set(s * 1.7, 0.7, 5.2); g.add(eng);
      const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 0.5, 10), dark);
      intake.rotation.x = Math.PI / 2; intake.position.set(s * 1.7, 0.7, 7.3); g.add(intake);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.6, 8), glow);
      flame.rotation.x = -Math.PI / 2; flame.position.set(s * 1.7, 0.7, 2.6); g.add(flame);
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 4), dark);
      cable.rotation.x = Math.PI / 2 + 0.06; cable.position.set(s * 1.0, 0.75, 1.9); cable.rotation.y = s * 0.2; g.add(cable);
      /* the coupling bar between the engines */
      if (s > 0) { const bar = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 0.12), dark); bar.position.set(0, 0.9, 5.2); g.add(bar); }
    }
  } else {
    /* a beast or a droid: a low hull with legs, the same colour */
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 2.6), body); hull.position.y = 0.9; g.add(hull);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.9), body); head.position.set(0, 1.2, 1.6); g.add(head);
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.9, 6), dark);
      leg.position.set((i % 2 ? 0.5 : -0.5), 0.45, i < 2 ? 0.8 : -0.8); g.add(leg);
    }
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return g;
}

/* ── THE COURSE, off the race's own seed ─────────────────────────────────── */
function courseOf(seed) {
  const R = rngOf(seed);
  const pts = [];
  const n = 14;
  const base = 140 + R() * 60;
  for (let i = 0; i < n; i++) {
    const a = TAU * (i / n);
    const r = base * (0.72 + R() * 0.5);
    const y = R() < 0.35 ? R.range(2, 14) : 0;
    pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a)));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.6);
  const sand = new THREE.Color().setHSL(R.range(0.06, 0.11), R.range(0.35, 0.6), R.range(0.42, 0.62));
  const rock = new THREE.Color().setHSL(R.range(0.03, 0.09), R.range(0.3, 0.5), R.range(0.22, 0.36));
  const sky = new THREE.Color().setHSL(R.range(0.08, 0.14), 0.5, R.range(0.6, 0.8));
  /* which thirds of the course run through a canyon */
  const canyon = [];
  for (let i = 0; i < 3; i++) if (R() < 0.7) canyon.push([i / 3 + R() * 0.08, i / 3 + 0.14 + R() * 0.12]);
  return { curve, sand, rock, sky, canyon, spires: 24 + Math.floor(R() * 24), R };
}

function buildCourse(scene, C) {
  const sandMat = new THREE.MeshStandardMaterial({ color: C.sand, roughness: 1, metalness: 0 });
  const rockMat = new THREE.MeshStandardMaterial({ color: C.rock, roughness: 0.95, metalness: 0.05 });
  const darkMat = new THREE.MeshStandardMaterial({ color: C.sand.clone().multiplyScalar(0.55), roughness: 1 });
  const lit = new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffc060, emissiveIntensity: 1.6 });
  /* the ground */
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 48), sandMat); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.3; scene.add(ground);
  /* the track ribbon, as a strip of quads along the curve */
  const N = 160, W = 14;
  const pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const u = (i % N) / N;
    const p = C.curve.getPointAt(u), t = C.curve.getTangentAt(u);
    const side = new THREE.Vector3(-t.z, 0, t.x).normalize().multiplyScalar(W / 2);
    pos.push(p.x - side.x, p.y + 0.02, p.z - side.z, p.x + side.x, p.y + 0.02, p.z + side.z);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, darkMat));
  /* canyon walls: slabs either side through the chosen stretches */
  for (const [a, b] of C.canyon) {
    const steps = Math.round((b - a) * 60);
    for (let k = 0; k <= steps; k++) {
      const u = (a + (b - a) * (k / steps)) % 1;
      const p = C.curve.getPointAt(u), t = C.curve.getTangentAt(u);
      const side = new THREE.Vector3(-t.z, 0, t.x).normalize();
      for (const s of [-1, 1]) {
        const h = 18 + C.R() * 22, d = W / 2 + 6 + C.R() * 6;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(6 + C.R() * 6, h, 9), rockMat);
        wall.position.set(p.x + side.x * s * d, p.y + h / 2 - 2, p.z + side.z * s * d);
        wall.rotation.y = Math.atan2(t.x, t.z);
        scene.add(wall);
      }
    }
  }
  /* spires and mesas out in the desert */
  for (let i = 0; i < C.spires; i++) {
    const a = C.R() * TAU, r = 260 + C.R() * 500;
    const h = 20 + C.R() * 70;
    const m = new THREE.Mesh(C.R() < 0.5 ? new THREE.ConeGeometry(6 + C.R() * 12, h, 6) : new THREE.CylinderGeometry(10 + C.R() * 20, 14 + C.R() * 24, h * 0.5, 7), rockMat);
    m.position.set(r * Math.cos(a), h * 0.25, r * Math.sin(a)); m.rotation.y = C.R() * TAU; scene.add(m);
  }
  /* the start arch and the gate pylons */
  const gates = [];
  const arch = (u, tall) => {
    const p = C.curve.getPointAt(u), t = C.curve.getTangentAt(u);
    const side = new THREE.Vector3(-t.z, 0, t.x).normalize();
    const grp = new THREE.Group();
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, tall, 1.2), rockMat);
      post.position.set(p.x + side.x * s * (W / 2 + 1.5), p.y + tall / 2, p.z + side.z * s * (W / 2 + 1.5)); grp.add(post);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), lit);
      lamp.position.set(p.x + side.x * s * (W / 2 + 1.5), p.y + tall - 0.4, p.z + side.z * s * (W / 2 + 1.5)); grp.add(lamp);
    }
    if (tall > 9) { const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 1.0, 1.4), rockMat); beam.position.set(p.x, p.y + tall, p.z); beam.rotation.y = Math.atan2(t.x, t.z); grp.add(beam); }
    scene.add(grp);
    return { u, p, t, side };
  };
  gates.push(arch(0, 12));
  for (let k = 1; k < 8; k++) gates.push(arch(k / 8, 6));
  /* the sky, the sun and the fill */
  scene.background = C.sky;
  scene.fog = new THREE.Fog(C.sky, 300, 1400);
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.2); sun.position.set(200, 300, -100); scene.add(sun);
  scene.add(new THREE.HemisphereLight(C.sky, C.sand, 0.9));
  return { gates, W };
}

/* ── THE FEED ────────────────────────────────────────────────────────────── */
export class RaceFeed {
  constructor(world, f) {
    this.world = world;
    this.f = f;
    this.renderer = world?.engine?.renderer || null;
    this.scene = null;
    this.camera = new THREE.PerspectiveCamera(48, FEED_W / FEED_H, 0.5, 2000);
    this.target = new THREE.WebGLRenderTarget(FEED_W, FEED_H, { depthBuffer: true });
    this.material = new THREE.ShaderMaterial({
      uniforms: { tFeed: { value: this.target.texture }, tCap: { value: f.panel?.texture || null }, uTime: { value: 0 }, uSeed: { value: 0 }, uLive: { value: 1 } },
      vertexShader: FEED_VERT, fragmentShader: FEED_FRAG,
    });
    this.material.name = 'station-feed-live';
    this.pods = new Map();
    this.raceKey = null;
    this.course = null;
    this.built = null;
    this.acc = 0;
    this.time = 0;
    this.shot = { mode: 'chase', until: 0, gate: 0, who: null };
    this.on = false;
    this._p = new THREE.Vector3(); this._t = new THREE.Vector3(); this._s = new THREE.Vector3(); this._look = new THREE.Vector3();
    this.frames = 0;
  }

  /** Build (or rebuild) the course and the pods for THIS race. */
  ensure(reading) {
    const race = reading?.race;
    const key = race ? `${reading.venue}|${reading.day}|${reading.meet?.index ?? 0}|${race.index ?? race.id ?? 0}` : null;
    if (!race || key === this.raceKey) return !!race;
    this.raceKey = key;
    this.teardownScene();
    this.scene = new THREE.Scene();
    this.course = courseOf(hash32(key));
    this.built = buildCourse(this.scene, this.course);
    this.material.uniforms.uSeed.value = (hash32(key) % 1000) / 1000;
    for (const e of race.card?.entrants || []) {
      const pod = podOf(entrantHue(e.id), e.kind);
      this.scene.add(pod);
      this.pods.set(e.id, { g: pod, u: 0, target: 0, lane: 0, out: false, speed: 0 });
    }
    this.shot = { mode: 'high', until: 3.5, gate: 0, who: null };
    return true;
  }

  teardownScene() {
    if (this.scene) this.scene.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); if (o.material?.dispose && !o.material.__shared) o.material.dispose(); } });
    this.scene = null;
    this.pods.clear();
  }

  /** Put the pods where the sim says, and pick the camera. */
  step(dt, shot, reading) {
    if (!this.renderer || !this.ensure(reading) || !this.scene) return false;
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    const C = this.course, B = this.built;
    /* targets off the shot's runner rows; smoothed toward them */
    const n = Math.max(1, shot.runners.length);
    let leader = null;
    for (const r of shot.runners) {
      const P = this.pods.get(r.id);
      if (!P) continue;
      P.target = r.x * LAPS;
      P.lane = (r.y - 0.5) * (B.W - 4);
      P.out = !!r.out;
      if (r.lead) leader = P;
    }
    for (const P of this.pods.values()) {
      const gap = P.target - P.u;
      /* a pod that is out stops where it went out; the rest close on the sim */
      const rate = P.out ? 0 : Math.max(0.02, gap * 2.5);
      P.speed += (rate - P.speed) * Math.min(1, dt * 3);
      P.u = Math.min(P.target, P.u + P.speed * dt);
      const u = ((P.u % 1) + 1) % 1;
      C.curve.getPointAt(u, this._p); C.curve.getTangentAt(u, this._t);
      this._s.set(-this._t.z, 0, this._t.x).normalize();
      P.g.position.set(this._p.x + this._s.x * P.lane, this._p.y + 1.2 + Math.sin(this.time * 9 + P.lane) * 0.08, this._p.z + this._s.z * P.lane);
      P.g.rotation.set(0, Math.atan2(this._t.x, this._t.z), 0);
      /* bank into the bend */
      const ahead = C.curve.getTangentAt((u + 0.01) % 1);
      const turn = this._t.x * ahead.z - this._t.z * ahead.x;
      P.g.rotation.z = -turn * 6;
    }
    /* THE DIRECTOR. Cuts on a moment to the gate it happened at; otherwise
     * alternates the chase and a trackside camera every few seconds. */
    this.shot.until -= dt;
    if (shot.flash && shot.flash.now && this.shot.who !== `${shot.flash.type}:${shot.flash.who}:${shot.flash.t}`) {
      this.shot = { mode: 'trackside', until: 4.5, gate: shot.gate, who: `${shot.flash.type}:${shot.flash.who}:${shot.flash.t}`, focus: shot.flash.who };
    } else if (this.shot.until <= 0) {
      const next = this.shot.mode === 'chase' ? 'trackside' : 'chase';
      this.shot = { mode: next, until: next === 'chase' ? 6 : 4, gate: shot.gate, who: this.shot.who, focus: null };
    }
    const L = (this.shot.focus && this.pods.get(this.shot.focus)) || leader || [...this.pods.values()][0];
    if (L) {
      const cam = this.camera;
      const lp = L.g.position;
      const u = ((L.u % 1) + 1) % 1;
      C.curve.getTangentAt(u, this._t);
      if (this.shot.mode === 'high') {
        cam.position.set(lp.x - this._t.x * 40, lp.y + 38, lp.z - this._t.z * 40);
        this._look.set(lp.x + this._t.x * 30, lp.y, lp.z + this._t.z * 30);
      } else if (this.shot.mode === 'chase') {
        cam.position.set(lp.x - this._t.x * 14 + this._s.x * 3, lp.y + 4.5, lp.z - this._t.z * 14 + this._s.z * 3);
        this._look.set(lp.x + this._t.x * 12, lp.y + 0.5, lp.z + this._t.z * 12);
      } else {
        /* trackside: fixed on the ground ahead, to one side, panning with him */
        const ua = (u + 0.02) % 1;
        const gp = C.curve.getPointAt(ua);
        const gt = C.curve.getTangentAt(ua);
        const gs = new THREE.Vector3(-gt.z, 0, gt.x).normalize();
        if (!this.shot.pos) this.shot.pos = new THREE.Vector3(gp.x + gs.x * 16, gp.y + 3, gp.z + gs.z * 16);
        cam.position.copy(this.shot.pos);
        this._look.set(lp.x, lp.y + 0.8, lp.z);
      }
      cam.lookAt(this._look);
    }
    /* render at the link's rate */
    this.acc += dt;
    if (this.acc < 1 / FPS) return true;
    this.acc = 0;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevXr = r.xr?.enabled;
    if (r.xr) r.xr.enabled = false;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
    if (r.xr) r.xr.enabled = prevXr;
    this.frames++;
    return true;
  }

  /** Put the live material on the screen, or take it off. */
  show(on) {
    const m = this.f.mesh;
    if (!m) return;
    if (on && !this.on) { this._painted = m.material; m.material = this.material; this.on = true; }
    else if (!on && this.on) { m.material = this._painted || m.material; this.on = false; }
  }

  dispose() {
    this.show(false);
    this.teardownScene();
    this.target.dispose();
    this.material.dispose();
  }
}

/**
 * The per-frame step for every screen with a live race in front of a player
 * near enough to watch it. Called by `StationKit.stepFeeds` every frame; the
 * painter's own tick is inside it.
 */
export function stepLiveFeeds(world, st, dt) {
  const list = st?.feeds;
  if (!list || !list.length || !(dt > 0)) return 0;
  const renderer = world?.engine?.renderer;
  if (!renderer || typeof renderer.setRenderTarget !== 'function') return 0;
  const p = world.player?.position;
  let live = 0;
  for (const f of list) {
    const shot = f.shot;
    const near = p && f.mesh ? Math.hypot(p.x - f.mesh.position.x, p.z - f.mesh.position.z) < NEAR : false;
    const running = shot && shot.mode === 'course' && shot.phase === 'running' && shot.runners?.length;
    const visible = !f.group || f.group.visible;
    if (running && near && visible) {
      if (!f.live) f.live = new RaceFeed(world, f);
      if (f.live.step(dt, shot, f.reading)) { f.live.show(true); live++; }
    } else if (f.live && f.live.on) {
      f.live.show(false);
    }
  }
  return live;
}

export function disposeLiveFeeds(st) {
  for (const f of st?.feeds || []) { if (f.live) { f.live.dispose(); f.live = null; } }
}
