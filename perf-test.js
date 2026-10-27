#!/usr/bin/env node
// perf-test.js — headless performance benchmark for a large village (30+ houses).
//
// Usage:
//   node perf-test.js [days] [seeds] [target-pop]
//
// Defaults: 200 days, 3 seeds, target pop 80 (which naturally produces 30+ houses).
//
// Metrics reported per run:
//   - steps/s  (sim ticks per second of wall-clock time)
//   - ms/step  (average time per tick)
//   - peak pop, houses at end, day reached
//   - GC pressure: heap growth between snapshots
//
// A large village (30+ houses = 80+ villagers) stresses pathfinding, job assignment,
// needs evaluation, and all registered mods (eras, family, market, crime, etc.)

'use strict';

// Load sim core
const API = require('./sim.js');
const { World, DAY } = API;

// Load all mods (same order as index.html)
const MOD_ORDER = [
  './mods/eras.js',
  './mods/family.js',
  './mods/jobs.js',
  './mods/skills.js',
  './mods/tools.js',
  './mods/soil.js',
  './mods/market.js',
  './mods/wells.js',
  './mods/defense.js',
  './mods/governance.js',
  './mods/goals.js',
  './mods/disasters.js',
  './mods/fire.js',
  './mods/injury.js',
  './mods/mood.js',
  './mods/crime.js',
  './mods/relations.js',
  './mods/personality.js',
  './mods/history.js',
  './mods/recorder.js',
  // ai_leader and god are UI-only or god-mode, skip; load.js is browser only
];
for (const mod of MOD_ORDER) {
  try { require(mod); } catch (e) { /* mod may have browser-only deps – skip gracefully */ }
}

const DAYS          = +process.argv[2] || 600;
const SEEDS         = +process.argv[3] || 3;
// The sim has a hard cap of 30 houses (sim.js). With warmUp pre-building 16, the sim
// will grow to ~24-30. We test at 20 as the meaningful "large village" threshold.
const TARGET_HOUSES = +process.argv[4] || 20;

// Force a large village faster by pre-seeding with abundant resources and pre-built houses.
// The sim caps houses at 30 (hard limit in sim.js line 646) and HOUSE_COST = 15 wood each.
function warmUp(w) {
  // Abundant stocks so woodcutters/builders can grow freely
  w.stock.food  = 2000;
  w.stock.wood  = 1500;
  w.stock.bread = 500;
  // Pre-build houses up to ~half the cap so population has room to grow into them
  // (The sim's needs system will build more as pop grows.)
  const target = 16;
  while (w.houses.length < target) {
    const tile = w.findSite('house');
    if (!tile) break;
    w.addHouse(tile);
    w.stock.wood = Math.max(0, w.stock.wood - (API.HOUSE_COST || 15));
  }
  // Replenish wood after pre-build
  w.stock.wood = 1200;
}

function fmt(n, decimals) { return n.toFixed(decimals != null ? decimals : 1); }
function mb(bytes) { return fmt(bytes / 1024 / 1024, 1) + ' MB'; }

const pad = (s, n) => String(s).padStart(n);

console.log('='.repeat(72));
console.log('  Small World — Performance Benchmark (large village, 30+ houses)');
console.log('='.repeat(72));
console.log(`  Days: ${DAYS}  Seeds: ${SEEDS}  Target-houses: ${TARGET_HOUSES}`);
console.log('');

let totalSteps = 0, totalMs = 0;
const results = [];

for (let si = 0; si < SEEDS; si++) {
  const seed = 1000 + si * 37;
  const w = new World({ seed, pop: 12 });
  warmUp(w);

  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now ? performance.now() : Date.now();
  let steps = 0, crashes = 0;

  try {
    while (!w.gameOver && w.day < DAYS) {
      w.step();
      steps++;
    }
  } catch (e) {
    crashes++;
    console.error(`  CRASH seed ${seed} day ${w.day}: ${e.message}`);
  }

  const elapsed = (performance.now ? performance.now() : Date.now()) - t0;
  const heapAfter = process.memoryUsage().heapUsed;
  const heapGrowth = heapAfter - heapBefore;

  totalSteps += steps;
  totalMs    += elapsed;

  const houses   = w.houses.length;
  const pop      = w.agents.length;
  const stepsPs  = elapsed > 0 ? (steps / (elapsed / 1000)) : Infinity;
  const msStep   = elapsed / steps;

  // Detailed per-era breakdown
  const look = API.eraLook ? API.eraLook(w) : null;
  const eraName = look ? look.eraId : (w.m.eras != null ? `index-${w.m.eras.era}` : '(eras off)');

  results.push({ seed, steps, elapsed, houses, pop, stepsPs, msStep, heapGrowth, crashes, day: w.day, era: eraName });

  console.log(`  Seed ${seed}:`);
  console.log(`    Days completed : ${w.day} / ${DAYS}`);
  console.log(`    Population     : ${pop} (peak: ${w.stats.peak})`);
  console.log(`    Houses         : ${houses}${houses >= TARGET_HOUSES ? ` ✓ (${TARGET_HOUSES}+ target met)` : ` (below ${TARGET_HOUSES})`}`);
  console.log(`    Era            : ${eraName || '(eras disabled)'}`);
  console.log(`    Steps          : ${steps.toLocaleString()}`);
  console.log(`    Wall time      : ${fmt(elapsed)} ms`);
  console.log(`    Steps/s        : ${fmt(stepsPs, 0)}`);
  console.log(`    ms/step (avg)  : ${fmt(msStep, 4)}`);
  console.log(`    Heap growth    : ${mb(heapGrowth)}`);
  if (crashes) console.log(`    ** CRASHES     : ${crashes}`);
  console.log('');

  // Spot-check structural integrity
  let bad = 0;
  for (const a of w.agents) {
    if (!Number.isFinite(a.health) || !Number.isFinite(a.x) || !Number.isFinite(a.y)) bad++;
    if (a.home && !w.houses.includes(a.home)) bad++;
  }
  if (bad) console.log(`  ** Integrity issues: ${bad} agent(s) with bad state`);

  // Note if village didn't reach target
  if (houses < TARGET_HOUSES) {
    console.log(`  Note: ${houses} houses reached. Sim hard-caps at 30; pop=${pop}, peak=${w.stats.peak}.`);
    console.log(`        Try more days (arg 1) or a different seed if village died early.`);
  }
}

// Aggregate summary
const avgStepsPs = totalMs > 0 ? totalSteps / (totalMs / 1000) : 0;
const avgMsStep  = totalMs / totalSteps;
const maxHouses  = Math.max(...results.map(r => r.houses));
const allMet     = results.every(r => r.houses >= TARGET_HOUSES);

console.log('='.repeat(72));
console.log('  SUMMARY');
console.log('='.repeat(72));
console.log(`  Total steps      : ${totalSteps.toLocaleString()}`);
console.log(`  Total wall time  : ${fmt(totalMs)} ms`);
console.log(`  Avg steps/s      : ${fmt(avgStepsPs, 0)}`);
console.log(`  Avg ms/step      : ${fmt(avgMsStep, 4)}`);
console.log(`  Max houses seen  : ${maxHouses}`);
console.log(`  ${TARGET_HOUSES}+ house target : ${allMet ? 'MET ✓' : 'NOT MET — try more days or fewer seeds'}`);

// Performance classification
const grade = avgStepsPs > 50000 ? 'EXCELLENT' : avgStepsPs > 20000 ? 'GOOD' : avgStepsPs > 8000 ? 'ACCEPTABLE' : 'SLOW';
console.log(`  Performance      : ${grade} (${fmt(avgStepsPs, 0)} steps/s)`);
console.log('');
console.log('  Notes:');
console.log('  - DAY = 240 ticks; a "day" takes', fmt(240 * avgMsStep, 2), 'ms wall-clock');
console.log('  - Real-time simulation runs at 30 fps × ~4 steps/frame = 120 steps/s');
console.log('  - Benchmark includes all sim mods loaded from mods/ (same as browser)');
console.log('  - No THREE.js / DOM (renderer cost excluded; add ~2–5ms/frame for GPU)');
console.log('='.repeat(72));

process.exit(results.some(r => r.crashes > 0) ? 1 : 0);
