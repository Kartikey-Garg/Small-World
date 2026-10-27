// Determinism fingerprint: node fingerprint.js [seeds] [days] [--save file | --check file]
// Prints one hash per seed covering the whole end state, so any behaviour change is detected.
const fs = require('fs');
const { World } = require('./sim.js');
const args = process.argv.slice(2);
const flag = args.findIndex(a => a === '--save' || a === '--check');
const mode = flag >= 0 ? args[flag] : null, file = flag >= 0 ? args[flag + 1] : null;
const pos = args.filter((a, i) => flag < 0 || (i !== flag && i !== flag + 1));
const seeds = +pos[0] || 6, days = +pos[1] || 150;

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
function fp(seed) {
  const w = new World(Object.assign({ seed }, process.env.NOFREE ? { free: false } : {}, process.env.NOREC ? { rec: false } : {}, process.env.NOERAS ? { eras: false } : {}));
  while (!w.gameOver && w.day < days) w.step();
  const st = {
    day: w.day, tick: w.tick, over: w.gameOver,
    ag: w.agents.map(a => [a.id, a.job, +a.x.toFixed(2), +a.y.toFixed(2), Math.round(a.age * 100), Math.round(a.satiety), a.spouse && a.spouse.id]),
    stock: Object.fromEntries(Object.entries(w.stock).map(([k, v]) => [k, +v.toFixed(2)])),
    stats: w.stats, houses: w.houses.length, plots: w.plots.length, rng: w.rng()
  };
  return hash(JSON.stringify(st)) + ' pop=' + w.agents.length + ' day=' + w.day;
}
const out = {};
for (let s = 1; s <= seeds; s++) out[s] = fp(s);
if (mode === '--check') {
  const base = JSON.parse(fs.readFileSync(file, 'utf8')); let bad = 0;
  for (const s in out) { if (base[s] !== out[s]) { bad++; console.log('DIFF seed', s, base[s], '->', out[s]); } }
  console.log(bad ? 'FINGERPRINT MISMATCH' : 'FINGERPRINT SAME (' + seeds + ' seeds x ' + days + ' days)');
  process.exit(bad ? 1 : 0);
}
if (mode === '--save') fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(out);
