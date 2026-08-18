import './dom-shim.mjs';
const { MODES, WaveDirector, CONDITION_KEYS } = await import('../src/game/Waves.js');
const { CommandDirector } = await import('../src/game/Command.js');
const { DojoDirector } = await import('../src/game/Dojo.js');
const { LEVELS, LEVEL_ORDER } = await import('../src/game/Levels.js');
const stub = () => ({ enemies: [], players: [], settings: {}, takenBoons: new Set(),
  spawnEnemy: () => ({}), notify() {}, scene: { add(){}, remove(){} },
  terrain: { height: () => 0, normalAt: (x,z,o)=>o.set(0,1,0), raycast: () => null, size: 400, half: 200,
    inBounds: () => true, surfaceAt: () => 'sand', crater(){}, flush(){} },
  player: null, difficulty: null, hpScale: 1, dmgScale: 1, partyTeam: 0, level: {} });
for (const mode of Object.keys(MODES)) {
  const leadsArmy = mode === 'command' || !!MODES[mode].battles;
  const pool = LEVELS[LEVEL_ORDER[0]].pool;
  const w = stub(); w.settings = { mode };
  let d, kind;
  try {
    if (mode === 'training') { d = new DojoDirector(w); kind = 'DojoDirector'; }
    else if (leadsArmy) { d = new CommandDirector(w, { pool }); kind = 'CommandDirector'; }
    else { d = new WaveDirector(w, { mode, pool }); kind = 'WaveDirector'; }
  } catch (e) { console.log(mode, 'CONSTRUCT FAILED', e.message); continue; }
  let legal = null, conds = null, err = '';
  try { legal = d.legalRuleSet ? d.legalRuleSet([...CONDITION_KEYS]).length : 'no legalRuleSet'; } catch (e) { legal = 'threw'; }
  try { if (d.legalRuleSet) d.rules = d.legalRuleSet([...CONDITION_KEYS]); d.start(6); conds = (d.conditions || []).length; }
  catch (e) { err = e.message.slice(0, 60); conds = 'threw'; }
  console.log(`${mode.padEnd(10)} ${kind.padEnd(16)} legal=${legal} conditionsAtW6=${conds} ${err}`);
}
