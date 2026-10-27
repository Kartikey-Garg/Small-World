const { World } = require('./sim.js');
const seed = +process.argv[2] || 1004, every = +process.argv[3] || 4, maxDay = +process.argv[4] || 120;
const w = new World({ seed });
let last = -1;
while (!w.gameOver && w.day < maxDay) {
  w.step();
  if (w.day !== last && w.tick % 240 === 1 && w.day % every === 0) {
    last = w.day;
    const pl = s => w.plots.filter(p => p.state === s).length;
    const hungry = w.agents.filter(a => a.satiety < 25).length;
    console.log(`d${w.day} ${w.season.slice(0, 3)} pop=${w.agents.length} hungry=${hungry} food=${w.stock.food.toFixed(0)}/${w.targets.food} wood=${w.stock.wood.toFixed(0)} fish=${w.fish.toFixed(0)} jobs=${JSON.stringify(w.counts())} plots r/g/e=${pl('ready')}/${pl('growing')}/${pl('empty')} houses=${w.houses.length}`);
  }
}
console.log('ended day', w.day, w.stats.causes);
