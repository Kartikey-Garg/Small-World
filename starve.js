// node starve.js <seed> <maxDay> -- reports days where people starve although food is in stock
const api = require('./sim.js');
const seed = +process.argv[2] || 1003, max = +process.argv[3] || 400;
const w = new api.World({ seed });
let reported = 0, lastDay = -1;
while (w.day < max && !w.gameOver) {
  w.step();
  if (w.day !== lastDay && w.tick % api.DAY === 5) {
    lastDay = w.day;
    const st = w.agents.filter(a => a.satiety <= 0);
    if (st.length && w.hasFood() && reported < 6) {
      reported++;
      console.log(`day ${w.day} ${w.season} pop=${w.agents.length} food=${Math.round(w.stock.food)} bread=${w.stock.bread} starving=${st.length} policy=${JSON.stringify(w.policy)}`);
      for (const a of st.slice(0, 5)) console.log('  ', a.name, 'age', a.age.toFixed(0), 'job', a.job, 'plan', a.planKind, 'label', a.label, 'hp', a.health.toFixed(0), 'en', a.energy.toFixed(0), 'inj', a.injury.toFixed(0), 'sick', a.sick, 'jail', a.jailUntil, 'carry', JSON.stringify(a.carry), 'planLen', a.plan.length);
    }
  }
}
console.log('end day', w.day, 'pop', w.agents.length, w.stats.causes);
