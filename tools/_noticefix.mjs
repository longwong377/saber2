/**
 * THROWAWAY PROBE — #25's reading pressed for real, and the three dead exports
 * this pass wired, each shown reached from the path a player is on.
 *
 *   node --import ./tools/register.mjs tools/_noticefix.mjs
 */
import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
function diskFetch() {
  if (globalThis.__stationFetch) return;
  globalThis.__stationFetch = true;
  globalThis.fetch = async (url) => {
    const buf = await readFile(new URL(String(url), root));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
}

/* Levels.js first: another lane has just made Station.js reach it through
 * StationLife → Companions → Player → Menu, so Station.js as the ENTRY is a
 * cycle and `LEVELS.station = STATION_LEVEL` runs in the TDZ. The game boots
 * through World.js, which pulls Levels first, so this is the game's order. */
await import('../src/game/Levels.js');
const St = await import('../src/game/Station.js');
const { PLACE } = await import('../src/game/StationPlan.js');

async function station(deck) {
  const { bootWorld } = await import('./checks/_coop.mjs');
  diskFetch();
  await St.prepareStation();
  const { world } = await bootWorld({
    level: 'station',
    settings: { mode: 'station', level: 'station', allies: 0 },
    onWorld: (w) => { w._stationFloor = deck; },
  });
  return world;
}

const DAYS = [0, 1, 2, 7, 30];

console.log('\n═══ 1. #25, PRESSED THROUGH stationKey, three presses a day ═══');
{
  const world = await station(40);
  const st = world._station;
  const p25 = PLACE.get(25);
  for (const d of DAYS) {
    st.day = d;
    for (let k = 0; k < 3; k++) {
      let said = null;
      world.notify = (h, l) => { said = [h, l]; };
      world.player.position.set(p25.x, st.deckY + 1.6, p25.z);
      const took = St.stationKey(world);
      console.log(`day ${String(d).padStart(2)} press ${k + 1}: took=${took} ${JSON.stringify(said)}`);
    }
  }
  world.dispose?.();
}

console.log('\n═══ 2. servedHere — the kiosk press, with main.js\'s own guard on it ═══');
{
  const { servedHere } = await import('../src/game/StationLife.js');
  const world = await station(40);
  const st = world._station;
  /* main.js's `openKiosk`, transcribed: the hook Station.stationKey raises. */
  let raised = null, refused = null;
  world.onKiosk = (id) => {
    if (id !== 'mirror' && !servedHere(world)) { refused = id; return; }
    raised = id;
  };
  const forge = PLACE.get(10);                       // kiosk: 'hilt'
  const press = () => {
    raised = refused = null;
    world.notify = () => {};
    world.player.position.set(forge.x, st.deckY + 1.6, forge.z);
    St.stationKey(world);
    return { raised, refused, standing: world._stationLife.standing };
  };
  console.log('in good standing :', JSON.stringify(press()));
  world._stationLife.standing = -10;                  // five residents cut
  console.log('after the brawl  :', JSON.stringify(press()));
  world.dispose?.();
}

console.log('\n═══ 3. markSeen — the arrival banner, told once ═══');
{
  const Medbay = await import('../src/game/Medbay.js');
  const { clearStation, hasSeen } = await import('../src/game/StationSave.js');
  clearStation();
  const men = [{ designation: 'CT-1', hp: 0.2 }, { designation: 'CT-2', hp: 1 },
    { designation: 'CT-3', hp: 1 }, { designation: 'CT-4', hp: 1 }];
  console.log('seen before      :', hasSeen(Medbay.GUIDE_ARRIVAL));
  console.log('first arrival    :', JSON.stringify(Medbay.arrivalNotice({ men })));
  console.log('seen after       :', hasSeen(Medbay.GUIDE_ARRIVAL));
  console.log('second arrival   :', JSON.stringify(Medbay.arrivalNotice({ men })));
  clearStation();
  console.log('a fresh player   :', JSON.stringify(Medbay.arrivalNotice({ men })));
}

console.log('\n═══ 4. conditionRow — on the roll page a player opens ═══');
{
  const { makeDocument } = await import('./checks/_page.mjs');
  const { Menu, DEFAULT_SETTINGS } = await import('../src/ui/Menu.js');
  const Company = await import('../src/game/Company.js');
  const Medbay = await import('../src/game/Medbay.js');
  const { CommandRoster, ARMIES } = await import('../src/game/Command.js');
  const INDEX = await readFile(new URL('../index.play.html', import.meta.url), 'utf8');
  localStorage.removeItem('saber.company.v1');
  const roster = new CommandRoster(ARMIES.republic);
  const all = [];
  for (let i = 0; i < 3; i++) all.push(roster.enlist('trooper'));
  all[0].body = { hp: 12, maxHp: 100, dead: false };
  for (const t of all.slice(1)) t.body = { hp: 100, maxHp: 100, dead: false };
  Company.keep(all, { army: 'republic', deployed: all, ground: 'geonosis' });
  Medbay.checkIn('republic', all[0].designation);
  const roll = Company.load('republic');
  const doc = makeDocument(INDEX);
  const restore = doc.install();
  try {
    const menu = new Menu(structuredClone(DEFAULT_SETTINGS), {});
    for (const m of [roll.men[0], roll.men[1]]) {
      menu._showCompany(`republic/${m.designation}`);
      const page = doc.getElementById('company-page').textContent.replace(/\s+/g, ' ');
      const row = Medbay.conditionRow(m, roll);
      console.log(`${m.designation}: conditionRow=${JSON.stringify(row)} `
        + `on the page=${row ? page.includes(row[1]) : !/Condition/.test(page)}`);
    }
  } finally { restore(); }
}
