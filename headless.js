// Headless balance test: node headless.js [runs] [maxDays]
const { World, DAY } = require('./sim.js');
const runs = +process.argv[2] || 10, maxDays = +process.argv[3] || 400;
const res = [];
for (let i = 0; i < runs; i++) {
  const w = new World({ seed: 1000 + i });
  let peak = 0;
  while (!w.gameOver && w.day < maxDays) { w.step(); peak = Math.max(peak, w.agents.length); }
  res.push(w.day);
  console.log(`seed ${1000 + i}: days=${w.day} pop=${w.agents.length} peak=${peak} births=${w.stats.births} deaths=${w.stats.deaths} causes=${JSON.stringify(w.stats.causes)} houses=${w.houses.length} plots=${w.plots.length} food=${w.stock.food.toFixed(0)} wood=${w.stock.wood.toFixed(0)} fish=${w.fish.toFixed(0)}`);
}
res.sort((a, b) => a - b);
console.log('median', res[res.length >> 1], 'min', res[0], 'max', res[res.length - 1]);
