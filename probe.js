// node probe.js <seed> <days> <expr>  -- evaluates expr(w) at the end, e.g. "w.m.tools"
const api = require('./sim.js');
const [seed, days, expr] = [+process.argv[2] || 1, +process.argv[3] || 150, process.argv[4] || 'w.stats'];
const w = new api.World({ seed });
while (w.day < days && !w.gameOver) w.step();
const f = new Function('w', 'api', 'return (' + expr + ')');
console.log('day', w.day, 'pop', w.agents.length, JSON.stringify(f(w, api)));
