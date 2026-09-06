/**
 * BATTLEFRONT BORZ — THE WEATHER ON THE PLANET BELOW (V18 cool 16).
 *
 * `StationEvents.weatherAt(day, theatre)` is the one answer: the Holonet reads
 * it for the news, the orbit chart prints it, and this file puts THE SAME
 * ANSWER in the sky. `weatherUniforms` turns that record into the three
 * uniforms `SkyDome`'s planet reads — an id, a seed that places the day's
 * system on the disc, and a drift phase — and it is called from exactly two
 * places: the station's daily stamp (`StationEvents.stepStationEvents`) and
 * the flight deck's dressing (`Hangar.js`), both off `outsideLevel`'s name, so
 * the word on the screen and the cloud in the window cannot disagree.
 *
 * `stepPlanetLook` is the small thing to point at: the first time each day the
 * player looks up at the disc from the promenade (deck 44) or the Observation
 * dome (deck 60), one `world.notify` line says what the news says.
 *
 * Nothing here rolls: the seed is a hash of (day, theatre), the place of the
 * system is a function of the seed, and the once-a-day is a day-keyed row in
 * `StationSave.seen`.
 */

import { WEATHER } from './StationEvents.js';
import { hasSeen, markSeen } from './StationSave.js';

/** `uWeather` for a word: 1 + its row in `StationEvents.WEATHER`; 0 for none. */
export function weatherId(word) {
  const i = WEATHER.findIndex((w) => w.word === word);
  return i < 0 ? 0 : i + 1;
}

/** A string to a small integer. Same shape as StationEvents' own. */
function hashStr(s) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * Where on the disc the day's system sits, and which noise it reads. Kept
 * under a thousand so the shader's `float` has it to the fraction. Changes
 * every day and with the theatre, which is the point: the sky changes with
 * the news.
 */
export function weatherSeed(weather) {
  if (!weather) return 0;
  const d = weather.day | 0;
  const t = hashStr(String(weather.theatre || 'the line'));
  return ((t % 811) + d * 37 + 0.5) % 997;
}

/** The day's drift phase, in cloud-frame radians. */
export function weatherPhase(weather) {
  return weather ? ((weather.day | 0) * 0.73) % 6.2832 : 0;
}

/**
 * Which hemisphere the system sits over, as the shader places it: the seed's
 * golden-ratio fraction is its latitude, the same line the GLSL reads.
 */
export function weatherPlace(weather) {
  const seed = weatherSeed(weather);
  const wl = ((seed * 0.618034) % 1 - 0.5) * 1.4;
  if (wl > 0.16) return 'the northern hemisphere';
  if (wl < -0.16) return 'the southern hemisphere';
  return 'the equator';
}

/** The word, said the way a forecaster would. */
const PHRASE = {
  'clear': 'clear skies over', 'high cloud': 'high cloud over', 'overcast': 'overcast over',
  'rain': 'rain over', 'storm': 'storms over', 'dust': 'dust storms over',
  'fog': 'fog across', 'snow': 'snow over',
};

/** "Kessel: dust storms over the southern hemisphere". */
export function weatherLine(weather) {
  if (!weather) return '';
  return `${weather.theatre}: ${PHRASE[weather.word] || weather.word} ${weatherPlace(weather)}`;
}

/**
 * Push a `weatherAt` record into a SkyDome. Returns what was set, or null for
 * a sky without the uniforms (the check stub before the engine is built).
 */
export function weatherUniforms(sky, weather) {
  const u = sky?.mat?.uniforms;
  if (!u?.uWeather) return null;
  const id = weatherId(weather?.word);
  const seed = weatherSeed(weather);
  const t = weatherPhase(weather);
  u.uWeather.value = id;
  u.uWeatherSeed.value = seed;
  u.uWeatherT.value = t;
  return { id, seed, t, word: weather?.word || null };
}

/** cos 30°: the disc is 18° across, and the fleet sits beside it. */
export const LOOK_CONE = 0.866;

/** Decks with glass onto the planet: the promenade and the Observation dome. */
export const LOOK_DECKS = [44, 60];

/** The save row for "looked up today". */
export function lookKey(day) { return `planet-look:${day | 0}`; }

/**
 * Is the player looking up at the planet? The aim against the sky's own
 * planet and fleet directions — the same vectors the shader draws with.
 */
export function facingPlanet(world) {
  const sky = world?.engine?.skyDome;
  const u = sky?.mat?.uniforms;
  const aim = world?.player?.aimDir;
  if (!u || !aim || !sky._orbit) return false;
  const p = u.uPlanetDir.value, f = u.uFleetDir.value;
  const dp = aim.x * p.x + aim.y * p.y + aim.z * p.z;
  const df = aim.x * f.x + aim.y * f.y + aim.z * f.z;
  return Math.max(dp, df) > LOOK_CONE;
}

/**
 * One frame. The notify line, once a day, on a glass deck, facing the disc.
 * Returns the line it said or null.
 */
export function stepPlanetLook(world, st) {
  if (!st?.weather || !LOOK_DECKS.includes(st.deck)) return null;
  /* The stamp runs in StationLife's step, after this one: on the first frame
   * of a new day the record is still yesterday's, so wait for today's. */
  if ((st.weather.day | 0) !== (st.day | 0)) return null;
  const key = lookKey(st.day);
  if (hasSeen(key)) return null;
  if (!facingPlanet(world)) return null;
  markSeen(key);
  const line = weatherLine(st.weather);
  world.notify?.(st.deck === 60 ? 'OBSERVATION DOME' : 'THE PROMENADE', line);
  return line;
}
