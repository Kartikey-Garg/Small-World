/* Personality & job preferences. Every adult has a liking (-1..1) for each job: partly innate (stable hash of
   seed+id+job), partly the trait, partly inherited from the parents, and it drifts with experience.
   The job planner (core assignJobs) adds liking*PREF_W to its skill score and lets unhappy people quit.
   No world rng is used (stateless hashing), so switching the mod on only changes decisions, never the random stream.
   Disable with new World({ free: false }). */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { clamp, hash01 } = api.util;
  const PREF_W = 10;          // skill points a maximal liking is worth (12 points = 1 skill level)
  const MIN_TENURE = 6;       // days in a job before someone may quit it
  const BIAS = {
    diligent: { farmer: 0.3, builder: 0.3 }, kind: { doctor: 0.5, teacher: 0.5 },
    hotheaded: { guard: 0.5, hunter: 0.5 }, greedy: { baker: 0.3, smith: 0.3, fisher: 0.2 }, honest: { guard: 0.2 },
  };
  const on = w => w.opts.free !== false;
  const S = w => w.m.pers || (w.m.pers = { switches: 0, quits: 0 });

  // liking for a job, created on first use: innate + trait bias, blended with the parents' (inherited culture)
  function prefOf(w, a, job) {
    const p = a.pref || (a.pref = {});
    if (p[job] === undefined) {
      let v = (hash01(w.seed, a.id, job) - 0.5) * 1.2 + ((BIAS[a.trait] || {})[job] || 0);
      const ps = a.parents.map(id => w.get(id)).filter(o => o && o.pref && o.pref[job] !== undefined);
      if (ps.length) v = v * 0.5 + 0.5 * ps.reduce((s, o) => s + o.pref[job], 0) / ps.length;
      p[job] = clamp(v, -1, 1);
    }
    return p[job];
  }
  // the job a person would pick if the village let them
  function dream(w, a) {
    let best = null, bv = -2;
    for (const j in api.jobs) { const v = prefOf(w, a, j); if (v > bv) { bv = v; best = j; } }
    return best;
  }
  api.pers = { pref: prefOf, dream, on };

  api.mods.push({
    spawn(w, a) {
      a.pref = null; a.jobSince = w.day; a._pj = null; a._quitTick = -1; a.jobWhy = null;
      if (on(w)) for (const j in api.jobs) prefOf(w, a, j);
    },
    workMult(w, a) { return on(w) && a.trait === 'diligent' ? 1.08 : 1; },
    // called by assignJobs for each worker that would keep their job
    jobAffinity(w, a, job) { return on(w) ? prefOf(w, a, job) * PREF_W : 0; },
    quitJob(w, a) {
      if (!on(w) || a.job === 'child' || a.mood > 50 || w.day - a.jobSince < MIN_TENURE) return false;
      if (prefOf(w, a, a.job) > -0.3) return false;
      if (hash01(w.seed, 'quit', a.id, w.tick) >= 0.5) return false;
      a._quitTick = w.tick; return true;
    },
    jobsAssigned(w) {
      if (!on(w)) return;
      const s = S(w);
      for (const a of w.agents) {
        if (a._pj === a.job) continue;
        a.jobWhy = a._quitTick === w.tick ? 'quit' : 'assigned';
        if (a._pj && a._pj !== 'child' && a.job !== 'child') { s.switches++; if (a.jobWhy === 'quit') s.quits++; }
        a._pj = a.job; a.jobSince = w.day;
      }
    },
    day(w) {
      if (!on(w)) return;
      for (const a of w.agents) {
        if (a.age < api.ADULT_AGE || a.job === 'child') continue;
        const p = prefOf(w, a, a.job);
        a.pref[a.job] = clamp(p + (a.mood - 55) / 45 * 0.03, -1, 1);       // contentment makes you like your work
        a.mood = clamp(a.mood + p * 1.5, 0, 100);                         // and liking your work lifts the mood
      }
    },
    // getting hurt on the job sours people on it
    hurt(w, a, n, cause) {
      if (on(w) && a.job !== 'child' && /accident/.test(cause || '')) a.pref[a.job] = clamp(prefOf(w, a, a.job) - 0.12, -1, 1);
    },
  });

  api.info.push((a, w) => {
    if (!on(w) || !a.pref || a.age < api.ADULT_AGE) return '';
    const d = dream(w, a); let worst = null, wv = 2;
    for (const j in a.pref) if (a.pref[j] < wv) { wv = a.pref[j]; worst = j; }
    return `<div class="doing">Calling: <b>${d}</b>${a.job === d ? ' (living it)' : ''}, dislikes <b>${worst}</b></div>`;
  });
  api.panels.push({
    id: 'callings', title: 'Callings',
    html(w) {
      if (!on(w)) return null;
      const ad = w.agents.filter(a => a.pref && a.job !== 'child');
      if (!ad.length) return null;
      let like = 0, dis = 0, dr = 0;
      for (const a of ad) { const p = a.pref[a.job] || 0; if (p > 0.2) like++; else if (p < -0.2) dis++; if (dream(w, a) === a.job) dr++; }
      const s = S(w);
      return `<div class="sub">Working a liked job <b>${like}</b>/${ad.length} - disliked ${dis} - dream job ${dr}</div>` +
        `<div class="sub">Job changes ${s.switches} (quit ${s.quits})</div>`;
    },
  });
})();
