// Study the lives of the villagers: node lives.js [seed] [days] [--out file.jsonl] [--who name|id]
// Runs a world headless and prints how people lived and died. --out streams every finished life to a JSON-lines file
// (bounded memory, good for very long runs). --who prints one person's full story.
const fs = require('fs');
const API = require('./sim.js');
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null; };
const out = opt('--out'), who = opt('--who');
const seed = +args[0] || 1, days = +args[1] || 300;
const fd = out ? fs.openSync(out, 'w') : null;
const w = new API.World({ seed, recSink: fd ? d => fs.writeSync(fd, JSON.stringify(d) + '\n') : undefined });
while (!w.gameOver && w.day < days) w.step();

const g = API.rec.study(w), pct = v => (v * 100).toFixed(0) + '%';
console.log(`seed ${seed}: ${w.day} days, ${g.lives} lives (${g.alive} alive, ${g.ended} ended)`);
console.log(`avg lifespan ${g.avgLifespan ? g.avgLifespan.toFixed(1) : '-'} days, avg mood ${g.avgMood ? g.avgMood.toFixed(0) : '-'}`);
console.log('ends:', JSON.stringify(g.causes), g.left ? `left ${g.left}` : '');
console.log('time:', Object.entries(g.timeShare).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
console.log('jobs:', Object.entries(g.jobShare).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
console.log(`goals: ${g.goalsSet} set, ${g.goalsDone} done, ${g.goalsFailed} given up | job changes ${g.jobChanges} | crimes ${g.crimes} | kids ${g.kids}`);
if (who != null) {
  const all = API.rec.all(w);
  const d = all.find(x => String(x.id) === who || x.name.toLowerCase() === who.toLowerCase());
  if (!d) console.log('no live record for', who, '(finished lives are in --out when a sink is used)');
  else { console.log('\n' + d.name, d.trait, 'born day', d.born, d.end ? `| died day ${d.end.day} (${d.end.cause})` : '| alive'); console.log('jobs:', d.jobs.map(j => `${j[1]}@${j[0]}`).join(' > ')); for (const e of d.events) console.log(`  D${e[0]} [${e[1]}] ${e[2]}`); }
} else {
  const d = API.rec.all(w).filter(x => x.end).sort((a, b) => b.events.length - a.events.length)[0] || API.rec.all(w)[0];
  if (d) { console.log('\nMost eventful life on record: ' + d.name, d.trait, '| born day', d.born, d.end ? `died day ${d.end.day} (${d.end.cause})` : ''); for (const e of d.events.slice(0, 25)) console.log(`  D${e[0]} [${e[1]}] ${e[2]}`); }
}
console.log(`json export size: ${(API.rec.exportJSON(w).length / 1024).toFixed(0)} KB`);
if (fd) { fs.closeSync(fd); console.log('wrote', out); }
