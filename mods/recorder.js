/* Life recorder: one dossier per villager (who they were, what they did, how it ended) plus village-wide study stats.
   PASSIVE: it only reads the world, never writes to it, never calls rng -> turning it on or off cannot change a run.
   Sample budget: time use is sampled every SAMPLE ticks; events/jobs/decisions are capped per person.
   Node: new World({ recSink: d => ... }) receives each finished dossier and frees it (bounded memory for long runs).
   Disable with new World({ rec: false }). Data API: api.rec.{study, dossier, all, exportJSON}. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const SETTLE = 3;
  const SAMPLE = 20, EV_MAX = 120, JOB_MAX = 60, SER_EVERY = 5, SER_MAX = 40, DEC_MAX = 24, KEEP_DEAD = 1200;
  const on = w => w.opts.rec !== false;
  const R = w => w.m.rec || (w.m.rec = {
    lives: {}, deadQ: [], agg: { n: 0, ageSum: 0, causes: {}, time: {}, jobTime: {}, goalsSet: 0, goalsDone: 0, goalsFailed: 0, crimes: 0, jobChanges: 0, kids: 0, married: 0, moodSum: 0, moodN: 0, left: 0 },
  });

  function cat(a) {
    const k = a.planKind, l = a.label || '';
    if (a.sleeping || k === 'sleep') return 'sleep';
    if (k === 'eat') return 'eat';
    if (k === 'work') {
      if (/chatting|visiting/.test(l)) return 'social';
      if (/idling|resting|wander|playing/.test(l)) return a.age < api.ADULT_AGE ? 'play' : 'idle';
      return a.age < api.ADULT_AGE ? 'play' : 'work';
    }
    return k || (a.age < api.ADULT_AGE ? 'play' : 'idle');
  }
  const labelOf = p => ((p.steps && p.steps[0] && p.steps[0].label) || p.kind || 'idle').replace(/^(visiting|chatting with) .*/, '$1');

  function dossier(w, a) {
    const r = R(w);
    if (r.lives[a.id]) return r.lives[a.id];
    const reg = w.registry[a.id];
    return (r.lives[a.id] = {
      id: a.id, name: a.name, gender: a.gender, trait: a.trait, born: reg ? reg.born : w.day, founder: !a.parents.length && w.day === 0,
      parents: a.parents.slice(), seed: w.seed, events: [], jobs: [], series: [], time: {}, jobTime: {}, decisions: {}, recent: [],
      n: {}, end: null, _sk: {}, _crimes: 0, _spouse: null, _sick: 0, _hungry: -99,
    });
  }
  function ev(w, a, kind, text) {
    const d = dossier(w, a);
    d.n[kind] = (d.n[kind] || 0) + 1;
    d.events.push([w.day, kind, text]);
    if (d.events.length > EV_MAX) d.events.splice(1, 1);        // keep the first entry (birth/arrival), drop the oldest after it
  }

  function fold(g, d) {
    g.n++; g.ageSum += d.end ? d.end.age : 0;
    if (d.end) { if (d.end.left) g.left++; else g.causes[d.end.cause] = (g.causes[d.end.cause] || 0) + 1; }
    for (const k in d.time) g.time[k] = (g.time[k] || 0) + d.time[k];
    for (const k in d.jobTime) g.jobTime[k] = (g.jobTime[k] || 0) + d.jobTime[k];
    g.goalsSet += d.n.goal || 0; g.goalsDone += d.n['goal+'] || 0; g.goalsFailed += d.n['goal-'] || 0;
    g.crimes += d.n.crime || 0; g.jobChanges += Math.max(0, d.jobs.length - 1); g.kids += d.n.child || 0; g.married += d.n.wed ? 1 : 0;
    for (const p of d.series) { g.moodSum += p[1]; g.moodN++; }
  }
  function finish(w, a, end) {
    const r = R(w), d = dossier(w, a);
    d.end = end;
    const reg = w.registry[a.id];
    d.kids = reg ? reg.kids.length : a.kids.length;
    d.skills = Object.fromEntries(Object.entries(a.skills).map(([k, v]) => [k, +w.skillLv(a, k).toFixed(1)]));
    d.pref = a.pref ? Object.fromEntries(Object.entries(a.pref).map(([k, v]) => [k, +v.toFixed(2)])) : null;
    fold(r.agg, d);
    if (w.opts.recSink) { w.opts.recSink(d); delete r.lives[a.id]; return; }
    r.deadQ.push(a.id);
    if (r.deadQ.length > KEEP_DEAD) delete r.lives[r.deadQ.shift()];
  }

  api.mods.push({
    spawn(w, a) {
      if (!on(w)) return;
      const d = dossier(w, a);
      ev(w, a, 'start', a.parents.length ? 'born' : (w.day === 0 ? 'arrived with the founders' : 'arrived as a stranger'));
      d.jobs.push([w.day, a.parents.length && a.age < api.ADULT_AGE ? 'child' : a.job, 'start']);
    },
    decided(w, a, p) {
      if (!on(w)) return;
      const d = dossier(w, a), l = labelOf(p);
      d.decisions[l] = (d.decisions[l] || 0) + 1;
      d.recent.push([w.tick, l]); if (d.recent.length > DEC_MAX) d.recent.shift();
    },
    tick(w) {
      if (!on(w) || w.tick % SAMPLE) return;
      for (const a of w.agents) {
        const d = dossier(w, a), c = cat(a);
        d.time[c] = (d.time[c] || 0) + SAMPLE;
        if (c === 'work') d.jobTime[a.job] = (d.jobTime[a.job] || 0) + SAMPLE;
      }
    },
    jobsAssigned(w) {
      if (!on(w)) return;
      for (const a of w.agents) {
        const d = dossier(w, a), last = d.jobs[d.jobs.length - 1];
        if (last[1] === a.job) continue;
        const why = a.jobWhy || 'assigned';
        // the planner reshuffles twice a day; a job held under SETTLE days is a shift, not a career move
        if (last[1] !== 'child' && d.jobs.length > 1 && w.day - last[0] < SETTLE) {
          last[1] = a.job; last[2] = why;
          const e = d.events[d.events.length - 1];                 // keep the story consistent with the job list
          if (e && e[1] === 'job' && e[0] >= last[0]) e[2] = e[2].replace(/(started as|to) \S+$/, `$1 ${a.job}`);
          continue;
        }
        d.jobs.push([w.day, a.job, why]); if (d.jobs.length > JOB_MAX) d.jobs.splice(1, 1);
        if (last[1] === 'child') ev(w, a, 'job', `came of age, started as ${a.job}`);
        else if (a.job !== 'child') ev(w, a, 'job', `${why === 'quit' ? 'quit' : 'moved from'} ${last[1]} to ${a.job}`);
      }
    },
    lifeEvent(w, a, k, t) { if (on(w) && (k === 'goal' || k === 'goal+' || k === 'goal-')) ev(w, a, k, t); },
    vitals(w, a) {
      if (!on(w) || a.satiety >= 4) return;
      const d = dossier(w, a);
      if (w.day - d._hungry > 5) { d._hungry = w.day; ev(w, a, 'hunger', 'was starving'); }
    },
    hurt(w, a, n, cause) { if (on(w) && n >= 10) ev(w, a, 'hurt', `hurt by ${cause} (-${Math.round(n)})`); },
    birth(w, c, m, f) {
      if (!on(w)) return;
      ev(w, m, 'child', `${c.name} was born`); if (f) ev(w, f, 'child', `${c.name} was born`);
    },
    day(w) {
      if (!on(w)) return;
      const r = R(w);
      for (const a of w.agents) {
        const d = dossier(w, a);
        if (a.spouse !== d._spouse && a.spouse) { const s = w.get(a.spouse); ev(w, a, 'wed', `married ${s ? s.name : 'someone'}`); }
        d._spouse = a.spouse || null;
        if (a.crimes > d._crimes) { ev(w, a, 'crime', a.crimes > 1 ? `stole again (${a.crimes} crimes)` : 'stole from the storehouse'); d._crimes = a.crimes; }
        if (a.sick && !d._sick) ev(w, a, 'sick', `fell ill with ${a.sickKind || 'plague'}`);
        d._sick = a.sick || 0;
        for (const k in a.skills) {
          const lv = Math.floor(w.skillLv(a, k));
          if (lv >= 3 && lv > (d._sk[k] || 0)) { d._sk[k] = lv; ev(w, a, 'skill', `reached ${k} level ${lv}`); }
        }
        if ((w.day - d.born) % SER_EVERY === 0) {
          d.series.push([w.day, Math.round(a.mood), Math.round(a.health), Math.round(a.satiety)]);
          if (d.series.length > SER_MAX) d.series.splice(1, 1);
        }
      }
    },
    die(w, a, cause) {
      if (!on(w)) return;
      ev(w, a, 'end', `died of ${cause} aged ${a.age.toFixed(0)}`);
      finish(w, a, { day: w.day, age: +a.age.toFixed(1), cause, left: false });
    },
    leave(w, a, why) {
      if (!on(w)) return;
      ev(w, a, 'end', why);
      finish(w, a, { day: w.day, age: +a.age.toFixed(1), cause: why, left: true });
    },
  });

  // ---------------------------------------------------------------- data API
  const all = w => Object.values(R(w).lives);
  function study(w) {
    const r = R(w), g = JSON.parse(JSON.stringify(r.agg));
    const live = w.agents.map(a => dossier(w, a));
    for (const d of live) fold(g, d);
    const ended = r.agg.n, adults = ended - r.agg.left;
    g.lives = g.n; g.alive = live.length; g.ended = ended;
    g.avgLifespan = adults > 0 ? r.agg.ageSum / adults : null;
    g.avgMood = g.moodN ? g.moodSum / g.moodN : null;
    const tt = Object.values(g.time).reduce((s, v) => s + v, 0) || 1;
    g.timeShare = Object.fromEntries(Object.entries(g.time).sort((p, q) => q[1] - p[1]).map(([k, v]) => [k, v / tt]));
    const jt = Object.values(g.jobTime).reduce((s, v) => s + v, 0) || 1;
    g.jobShare = Object.fromEntries(Object.entries(g.jobTime).sort((p, q) => q[1] - p[1]).map(([k, v]) => [k, v / jt]));
    g.goalRate = g.goalsSet ? g.goalsDone / g.goalsSet : null;
    return g;
  }
  const rec = api.rec = {
    study, all, dossier: (w, id) => { const a = w.get(id); return R(w).lives[id] || null; },
    exportJSON: w => JSON.stringify({ seed: w.seed, day: w.day, study: study(w), lives: all(w) }),
  };

  // ------------------------------------------------------------------ views
  const pct = v => (v * 100).toFixed(0) + '%';
  const COL = { work: '#e08a2e', sleep: '#5b6b8c', eat: '#8fd18a', idle: '#8691a0', social: '#c58fe0', play: '#f1d36a', jail: '#ff9d8f', fight: '#ff6b6b', fire: '#ff9d4f' };
  const bar = share => '<div style="display:flex;height:10px;border-radius:3px;overflow:hidden;margin:3px 0">' +
    Object.entries(share).map(([k, v]) => `<div title="${k} ${pct(v)}" style="width:${v * 100}%;background:${COL[k] || '#6b7787'}"></div>`).join('') + '</div>';
  const legend = share => '<div class="sub">' + Object.entries(share).filter(([, v]) => v >= 0.01).map(([k, v]) => `<span style="color:${COL[k] || '#cfd6df'}">&#9632;</span> ${k} ${pct(v)}`).join(' &nbsp; ') + '</div>';
  const kindCol = { start: '#8691a0', end: '#c58fe0', job: '#e08a2e', wed: '#f1d36a', child: '#8fd18a', hurt: '#ff9d8f', sick: '#ff9d8f', crime: '#ff6b6b', hunger: '#ff9d8f', skill: '#6cc6ff', goal: '#8691a0', 'goal+': '#8fd18a', 'goal-': '#ff9d8f' };

  function studyHtml(w) {
    const g = study(w), top = Object.entries(g.causes).sort((p, q) => q[1] - p[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(', ');
    return `<div class="sub">${g.lives} lives recorded (${g.alive} alive, ${g.ended} ended) - avg lifespan <b>${g.avgLifespan ? g.avgLifespan.toFixed(1) : '-'}</b> days - avg mood <b>${g.avgMood ? g.avgMood.toFixed(0) : '-'}</b></div>` +
      `<div class="sub">Ends: ${top || 'none yet'}${g.left ? ', left ' + g.left : ''}</div>` +
      `<div class="sub" style="margin-top:6px">How villagers spend their time</div>${bar(g.timeShare)}${legend(g.timeShare)}` +
      `<div class="sub" style="margin-top:6px">What they work at</div>${bar(g.jobShare)}${legend(g.jobShare)}` +
      `<div class="sub" style="margin-top:6px">Goals ${g.goalsSet} set, ${g.goalsDone} achieved, ${g.goalsFailed} given up - job changes ${g.jobChanges} - crimes ${g.crimes}</div>`;
  }
  function listHtml(w) {
    const rows = all(w).sort((p, q) => (q.end ? 0 : 1) - (p.end ? 0 : 1) || p.born - q.born).reverse().slice(0, 60).map(d => {
      const a = w.get(d.id), st = d.end ? `d. day ${d.end.day}` : `age ${a ? a.age.toFixed(0) : '?'}`;
      return `<tr><td><span style="color:#6cc6ff;cursor:pointer;text-decoration:underline" data-act="showLife" data-arg="${d.id}">${d.name}</span></td><td>${d.trait}</td><td>${st}</td><td>${a ? a.job : '-'}</td><td>${d.events.length}</td></tr>`;
    }).join('');
    return `<h2>Life stories</h2>${studyHtml(w)}<div class="tl" style="margin-top:10px;max-height:280px"><table class="tbl"><tr><td><b>Name</b></td><td><b>Trait</b></td><td><b>State</b></td><td><b>Job</b></td><td><b>Events</b></td></tr>${rows}</table></div>` +
      `<div class="btns" style="margin-top:8px"><button class="sm" data-act="exportLives">Download all (JSON)</button></div>`;
  }
  function lifeHtml(w, id) {
    const d = rec.dossier(w, +id); if (!d) return `<h2>Life story</h2><div class="sub">No record.</div>`;
    const a = w.get(d.id), tt = Object.values(d.time).reduce((s, v) => s + v, 0) || 1;
    const share = Object.fromEntries(Object.entries(d.time).sort((p, q) => q[1] - p[1]).map(([k, v]) => [k, v / tt]));
    const dec = Object.entries(d.decisions).sort((p, q) => q[1] - p[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
    const jobs = d.jobs.map(j => `${j[1]} <span class="muted">(d${j[0]})</span>`).join(' &rarr; ');
    const evs = d.events.slice().reverse().map(e => `<div class="log-i" style="color:${kindCol[e[1]] || '#cfd6df'}"><b>D${e[0]}</b>${e[2]}</div>`).join('');
    const pr = (a && a.pref) || d.pref;
    const likes = pr ? Object.entries(pr).sort((p, q) => q[1] - p[1]) : [];
    return `<h2>${d.name} <span class="muted">${d.gender === 'M' ? 'm' : 'f'}, ${d.trait}, ${d.founder ? 'founder' : 'born day ' + d.born}</span></h2>` +
      `<div class="sub">${d.end ? 'Died day ' + d.end.day + ' (' + d.end.cause + ') aged ' + d.end.age : 'Alive'}${a && a.goal ? ' - goal: ' + api.goals.describe(a.goal) : ''}</div>` +
      (likes.length ? `<div class="sub">Likes: ${likes.slice(0, 2).map(x => x[0]).join(', ')} - dislikes: ${likes.slice(-2).map(x => x[0]).join(', ')}</div>` : '') +
      `<div class="sub" style="margin-top:6px">Time use</div>${bar(share)}${legend(share)}` +
      `<div class="sub" style="margin-top:6px">Jobs: ${jobs}</div><div class="sub">Most common decisions: ${dec || '-'}</div>` +
      `<div class="tl" style="margin-top:8px;max-height:260px">${evs}</div>` +
      `<div class="btns" style="margin-top:8px"><button class="sm" data-act="showLives">All lives</button></div>`;
  }

  api.actions.showLives = (w, _, ui) => ui.modal(listHtml(w));
  api.actions.showLife = (w, id, ui) => ui.modal(lifeHtml(w, id));
  api.actions.exportLives = w => {
    if (typeof document === 'undefined') return;
    const url = URL.createObjectURL(new Blob([rec.exportJSON(w)], { type: 'application/json' }));
    const el = document.createElement('a'); el.href = url; el.download = `small-world-lives-seed${w.seed}-day${w.day}.json`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  api.panels.push({
    id: 'recorder', title: 'Life recorder',
    html(w) {
      if (!on(w)) return null;
      const g = R(w).agg;
      return `<div class="sub">${g.n + w.agents.length} lives on record</div><div class="btns"><button class="sm" data-act="showLives">Life stories</button><button class="sm" data-act="exportLives">Export</button></div>`;
    },
  });
  api.info.push((a, w) => on(w) ? `<div class="btns"><button class="sm" data-act="showLife" data-arg="${a.id}">Life story</button></div>` : '');
  (api.overHtml = api.overHtml || []).push(() => '<button class="sm" data-act="showLives">Life stories</button>');
})();
