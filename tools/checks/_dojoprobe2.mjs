export async function run({ check }) {
  check('rings', async () => {
    const m = await import('../../src/game/Levels.js');
    const out = [];
    for (const k of m.LEVEL_ORDER) { const L = m.LEVELS[k]; if (L) out.push(`${k.padEnd(12)} ${JSON.stringify(L.spawnRadius || [34, 56])}  ${L.name}`); }
    return '\n' + out.join('\n');
  });
}
