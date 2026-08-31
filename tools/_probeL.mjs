import './dom-shim.mjs';
import { readFile } from 'node:fs/promises';
import { makeDocument } from './checks/_page.mjs';
const INDEX = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const Cmd = await import('../src/game/Command.js');
await import('../src/game/Levels.js');
const Company = await import('../src/game/Company.js');
const Muster = await import('../src/game/Muster.js');
const { Menu, DEFAULT_SETTINGS } = await import('../src/ui/Menu.js');

localStorage.removeItem(Company.KEY); localStorage.removeItem(Muster.KEY);
const r = new Cmd.CommandRoster(Cmd.ARMIES.republic);
for (let i = 0; i < 10; i++) r.enlist('trooper');
r.all[0].award(Cmd.RANKS[2].xp);      // Sergeant
r.all[1].award(Cmd.RANKS[4].xp);      // Commander
Company.keep(r.all, { army: 'republic', deployed: r.all, ground: 'geonosis' });

console.log('DUTIES', Cmd.DUTIES);
console.log('holds sgt LEADS', Cmd.holds(r.all[0], 'LEADS'), 'trp LEADS', Cmd.holds(r.all[2], 'LEADS'));
console.log('dutiesAt(2)', Cmd.dutiesAt(2));

const doc = makeDocument(INDEX); const restore = doc.install();
const menu = new Menu({ ...structuredClone(DEFAULT_SETTINGS), mode: 'command' }, {});
menu.showMenu(); menu._buildCompanyList();
const sgt = r.all[0].designation, trp = r.all[2].designation;
menu._showCompany(`republic/${sgt}`);
let page = doc.getElementById('company-page');
console.log('duty rows', page.querySelectorAll('.duty-row').length,
            'has', page.querySelectorAll('.duty-row.has').length);
let btn = doc.getElementById('company-post');
console.log('sgt btn disabled?', !!btn.disabled, JSON.stringify(btn.textContent.trim()));
btn.click();
console.log('post written?', Company.load('republic').men.find((m)=>m.designation===sgt)?.post);
menu._showCompany(`republic/${trp}`);
page = doc.getElementById('company-page');
btn = doc.getElementById('company-post');
console.log('trp btn disabled?', !!btn.disabled);
console.log('reason:', page.querySelector('.company-post .hint').textContent.trim().slice(0,110));
restore();
