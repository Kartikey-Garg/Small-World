// Smoke / regression test: node smoke.js [days] [seeds]
// 1) runs several seeds for N days, 2) fires every registered event on its own world, 3) checks invariants.
const API = require('./sim.js');
const { World, DAY } = API;
const days = +process.argv[2] || 120, seeds = +process.argv[3] || 3;
let bad = 0;
function check(w, tag) {
  const ids = new Set();
  for (const a of w.agents) {
    if (ids.has(a.id)) { console.log(tag, 'duplicate agent', a.id); bad++; }
    ids.add(a.id);
    for (const k of ['health', 'satiety', 'energy', 'mood', 'injury', 'x', 'y']) {
      if (!Number.isFinite(a[k])) { console.log(tag, 'NaN', k, a.name); bad++; }
    }
    if (a.home && !w.houses.includes(a.home)) { console.log(tag, 'dangling home', a.name); bad++; }
  }
  for (const k of Object.keys(w.stock)) if (!Number.isFinite(w.stock[k])) { console.log(tag, 'NaN stock', k); bad++; }
  for (const h of w.houses) for (const o of h.occupants) if (!o.alive) { console.log(tag, 'dead occupant'); bad++; }
}
for (let s = 0; s < seeds; s++) {
  const w = new World({ seed: 500 + s });
  try {
    while (!w.gameOver && w.day < days) { w.step(); if (w.tick % 97 === 0) check(w, 'seed' + s); }
  } catch (e) { console.log('CRASH seed', s, 'day', w.day, e.stack); bad++; }
  console.log(`seed ${500 + s}: day ${w.day} pop ${w.agents.length} births ${w.stats.births} deaths ${w.stats.deaths} ${JSON.stringify(w.stats.causes)}`);
}
for (const e of API.events) {
  const w = new World({ seed: 77 });
  try {
    while (!w.gameOver && w.day < 40) w.step();
    const r = w.trigger(e.id);
    for (let i = 0; i < DAY * 6 && !w.gameOver; i++) { w.step(); if (i % 60 === 0) check(w, e.id); }
    console.log('event', e.id.padEnd(12), r === false ? 'refused' : 'ok', ' pop', w.agents.length);
  } catch (err) { console.log('CRASH event', e.id, err.stack); bad++; }
}
if (typeof API.recordRecentDecision !== 'function') { console.log('dilemmas: recent decision recorder missing'); bad++; }
// determinism + neutrality: same seed twice is identical; the passive recorder must not change a run;
// the freedom mods (personality/goals) must be switchable off without a trace
function sig(opts, d) {
  const w = new World(Object.assign({ seed: 321 }, opts));
  while (!w.gameOver && w.day < d) w.step();
  return JSON.stringify([w.day, w.agents.map(a => [a.id, a.job, +a.x.toFixed(2), +a.y.toFixed(2), Math.round(a.satiety)]), w.stock, w.stats, w.rng()]);
}
{
  const d = Math.min(days, 80), a = sig({}, d);
  if (a !== sig({}, d)) { console.log('NOT DETERMINISTIC: same seed gave different runs'); bad++; }
  if (a !== sig({ rec: false }, d)) { console.log('RECORDER IS NOT NEUTRAL: it changed the simulation'); bad++; }
  if (a === sig({ free: false }, d)) { console.log('freedom mods had no effect on behaviour'); bad++; }
  if (a === sig({ eras: false }, d)) { console.log('eras had no effect on behaviour'); bad++; }
  console.log('determinism / neutrality checks done');
}
// recorder bookkeeping: every dead villager has a closed dossier, every living one an open one
{
  const w = new World({ seed: 9 });
  while (!w.gameOver && w.day < Math.min(days, 100)) w.step();
  const g = API.rec.study(w);
  if (g.alive !== w.agents.length) { console.log('recorder: alive count mismatch', g.alive, w.agents.length); bad++; }
  if (g.ended !== w.stats.deaths + w.stats.left) { console.log('recorder: ended count mismatch', g.ended, w.stats.deaths + w.stats.left); bad++; }
  for (const a of w.agents) { const d = API.rec.dossier(w, a.id); if (!d || d.end) { console.log('recorder: living villager has no open dossier', a.name); bad++; break; } }
  for (const d of API.rec.all(w)) if (!d.end && !w.get(d.id)) { console.log('recorder: open dossier for a villager who is gone', d.name); bad++; break; }
  try { JSON.parse(API.rec.exportJSON(w)); } catch (e) { console.log('recorder: export is not valid JSON'); bad++; }
  for (const a of w.agents) {
    if (a.age >= API.ADULT_AGE && !Object.values(a.pref || {}).every(v => v >= -1 && v <= 1)) { console.log('pref out of range', a.name); bad++; break; }
    if (a.mem.length > 30) { console.log('memory not bounded', a.name); bad++; break; }
  }
}
// eras: locks hold until the tech is known, effects match the known set, eras only move forward, eras:false leaves no trace
{
  const E = API.eras, w = new World({ seed: 12 });
  const s = E.state(w);
  if (E.current(w).id !== 'stone') { console.log('eras: should start in the Stone Age'); bad++; }
  for (const t of E.TECHS) {
    if (t.req.some(r => !E.TECHS.some(x => x.id === r))) { console.log('eras: unknown prerequisite in', t.id); bad++; }
    if (t.req.some(r => E.TECHS.find(x => x.id === r).era > t.era)) { console.log('eras: prerequisite from a later era in', t.id); bad++; }
  }
  if (w.hookFirst('lockedBuild', { kind: 'forge' }) !== true || w.hookFirst('lockedJob', 'smith') !== true) { console.log('eras: forge/smith should start locked'); bad++; }
  if (w.hookFirst('lockedJob', 'farmer') || w.hookFirst('lockedJob', 'woodcutter') || w.hookFirst('lockedJob', 'fisher')) { console.log('eras: core jobs must never be locked'); bad++; }
  let era = 0;
  while (!w.gameOver && w.day < Math.min(days, 150) + 150) {
    w.step();
    if (s.era < era) { console.log('eras: era went backwards'); bad++; }
    era = s.era;
    if (w.tick % 97 === 0) {
      for (const j of w.agents) if (j.job === 'smith' && !E.has(w, 'metalworking')) { console.log('eras: smith without metalworking'); bad++; break; }
      if (w.sOf('forge').length && !E.has(w, 'metalworking')) { console.log('eras: forge built before metalworking'); bad++; }
      for (const t of E.TECHS) if (s.known[t.id] != null && !t.req.every(r => s.known[r] != null)) { console.log('eras: tech known without its prerequisites', t.id); bad++; }
      if (!Number.isFinite(s.pool) || s.pool < 0) { console.log('eras: knowledge pool invalid', s.pool); bad++; }
    }
  }
  if (!w.gameOver && s.count <= 3) { console.log('eras: no technology was ever discovered'); bad++; }
  const off = new World({ seed: 12, eras: false });
  if (off.m.eras || API.eraLook(off) !== null || off.hookFirst('lockedBuild', { kind: 'forge' })) { console.log('eras: eras:false still active'); bad++; }
  console.log(`eras checks done (era ${E.current(w).name}, ${s.count}/${E.TECHS.length} techs)`);
}
console.log(bad ? `FAILED (${bad} problems)` : 'ALL OK');
process.exit(bad ? 1 : 0);
