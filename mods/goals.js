/* Memory & personal goals. Each villager keeps a short ring of memories (hunger, injuries, losses, marriage, births,
   goals met or failed) and, now and then, sets a goal of their own:
     master  - get really good at the job they would like to do     (leans the job planner towards it)
     friend  - befriend a particular person                        (visits them in spare time)
     court   - win over a particular single                        (visits them; feeds the marriage mod's rel score)
   A famine memory makes a person lean towards food jobs for a month; a recent loss makes them seek company.
   Spare-time visits happen at most once a day, never when food is short, and use no world rng (stateless hashing),
   so this mod only changes decisions, never the random stream. Disable with new World({ free: false }). */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { clamp, hash01, mv } = api.util;
  const MEM_MAX = 30, DUR = { master: 60, friend: 14, court: 24 }, MARRY_AGE = 16;
  const on = w => w.opts.free !== false;
  const S = w => w.m.goals || (w.m.goals = { set: 0, done: 0, failed: 0, visits: 0 });

  function remember(w, a, k, t, o) {
    a.mem.push({ d: w.day, k, t, o: o || null });
    if (a.mem.length > MEM_MAX) a.mem.shift();
    w.hook('lifeEvent', a, k, t, o || null);
  }
  const recent = (w, a, k, days) => a.mem.some(m => m.k === k && w.day - m.d <= days);
  const related = (a, b) => a.parents.some(p => b.parents.includes(p)) || a.parents.includes(b.id) || b.parents.includes(a.id);
  const rel = (a, b) => a.rel[b.id] || 0;
  const bump = (a, b, n) => { a.rel[b.id] = clamp(rel(a, b) + n, -100, 100); b.rel[a.id] = clamp(rel(b, a) + n, -100, 100); };

  // ------------------------------------------------------------------ choosing goals
  function pickTarget(w, a, kind) {
    let best = null, bs = -Infinity;
    for (const o of w.agents) {
      if (o === a || o.age < 8) continue;
      if (kind === 'court') {
        if (o.gender === a.gender || o.spouse || o.age < MARRY_AGE || o.age >= 50 || related(a, o)) continue;
      } else if (rel(a, o) < -20) continue;
      let s = rel(a, o) + hash01(w.seed, a.id, o.id, kind) * (kind === 'court' ? 20 : 30);
      if (kind === 'court') s -= Math.abs(a.age - o.age) * 0.7;
      if (s > bs) { bs = s; best = o; }
    }
    return best;
  }
  function feasibleJobs(w) {
    const c = w.ctx, out = [];
    for (const j in api.jobs) {
      const d = api.jobs[j];
      if (d.weight && d.weight(w, c) > 0 && (!d.cap || d.cap(w, c) > 0)) out.push(j);
    }
    return out;
  }
  function chooseGoal(w, a) {
    const single = !a.spouse && a.age >= MARRY_AGE && a.age < 50;
    const grieving = recent(w, a, 'loss', 20);
    const r = hash01(w.seed, a.id, w.day, 'kind');
    let kind = grieving ? (r < 0.6 ? 'friend' : 'master') : single ? (r < 0.45 ? 'court' : r < 0.75 ? 'master' : 'friend') : (r < 0.6 ? 'master' : 'friend');
    if (kind === 'master') {
      const js = feasibleJobs(w); let job = null, bs = -Infinity;
      for (const j of js) {
        const sk = api.jobs[j].skill;
        const s = (api.pers ? api.pers.pref(w, a, j) : 0) + (a.skills[sk] || 0) / 40 + hash01(w.seed, a.id, j, w.day) * 0.3;
        if (s > bs) { bs = s; job = j; }
      }
      if (!job) kind = 'friend'; else return { kind, job, skill: api.jobs[job].skill, since: w.day, until: w.day + DUR.master };
    }
    const t = pickTarget(w, a, kind);
    if (!t && kind === 'court') return chooseGoalFriend(w, a);
    if (!t) return null;
    return { kind, target: t.id, tname: t.name, since: w.day, until: w.day + DUR[kind], lastVisit: -1 };
  }
  function chooseGoalFriend(w, a) {
    const t = pickTarget(w, a, 'friend');
    return t ? { kind: 'friend', target: t.id, tname: t.name, since: w.day, until: w.day + DUR.friend, lastVisit: -1 } : null;
  }
  const describe = g => g.kind === 'master' ? `master ${g.job}` : g.kind === 'friend' ? `befriend ${g.tname}` : `win over ${g.tname}`;
  function finish(w, a, ok, why) {
    const g = a.goal, s = S(w); a.goal = null; a.goalNext = w.day + 3;
    if (ok) { s.done++; a.joy = (a.joy || 0) + 20; a.mood = Math.min(100, a.mood + 8); remember(w, a, 'goal+', `achieved: ${describe(g)}`); }
    else { s.failed++; remember(w, a, 'goal-', `gave up: ${describe(g)} (${why})`); }
  }

  api.mods.push({
    spawn(w, a) { a.mem = []; a.goal = null; a.goalNext = 0; a.famineUntil = -1; a.lastHungry = -99; a._sp = null; },
    // hunger and injuries are remembered
    vitals(w, a) {
      if (a.satiety < 4 && w.day - a.lastHungry > 5 && on(w)) {
        a.lastHungry = w.day; a.famineUntil = w.day + 30; remember(w, a, 'hunger', 'went hungry');
      }
    },
    hurt(w, a, n, cause) { if (on(w) && n >= 15) remember(w, a, 'hurt', `badly hurt by ${cause}`); },
    birth(w, c, m, f) {
      if (!on(w)) return;
      remember(w, m, 'child', `${c.name} was born`, c.id); if (f) remember(w, f, 'child', `${c.name} was born`, c.id);
    },
    die(w, a) {
      if (!on(w)) return;
      const grieve = new Set([...a.parents, ...a.kids]); if (a.spouse) grieve.add(a.spouse);
      for (const id in a.rel) if (a.rel[id] > 40) grieve.add(+id);
      for (const id of grieve) { const o = w.get(id); if (o) remember(w, o, 'loss', `${a.name} died`, a.id); }
    },
    // the people who matter to a job planner's choice
    jobAffinity(w, a, job) {
      if (!on(w)) return 0;
      let v = 0;
      if (a.goal && a.goal.kind === 'master' && a.goal.job === job) v += 6;
      if (a.famineUntil >= w.day && api.jobs[job].group === 'food') v += 4;
      return v;
    },
    day(w) {
      if (!on(w)) return;
      const s = S(w);
      for (const a of w.agents) {
        if (a.age < api.ADULT_AGE) continue;
        if (a.spouse && a._sp !== a.spouse) { if (a._sp === null) remember(w, a, 'wed', `married ${(w.get(a.spouse) || {}).name || 'someone'}`, a.spouse); }
        a._sp = a.spouse || null;
        const g = a.goal;
        if (g) {
          const t = g.target != null ? w.get(g.target) : null;
          if (g.kind === 'master') {
            if (w.skillLv(a, g.skill) >= 5) finish(w, a, true);
            else if (w.day > g.until) finish(w, a, false, 'took too long');
          } else if (!t) finish(w, a, false, 'they are gone');
          else if (g.kind === 'friend' && rel(a, t) >= 45) finish(w, a, true);
          else if (g.kind === 'court' && (a.spouse || rel(a, t) >= 70)) finish(w, a, !!a.spouse || rel(a, t) >= 70);
          else if (w.day > g.until) finish(w, a, false, 'no luck');
        } else if (w.day >= a.goalNext) {
          const p = recent(w, a, 'loss', 20) ? 0.6 : 0.25;
          if (hash01(w.seed, a.id, w.day, 'goal?') < p) {
            const ng = chooseGoal(w, a);
            if (ng) { a.goal = ng; s.set++; remember(w, a, 'goal', `new goal: ${describe(ng)}`); }
          }
        }
      }
    },
    // spare-time social visit for friend / court goals: at most one a day, never when food is short
    idle(w, a) {
      const g = a.goal;
      if (!on(w) || !g || g.kind === 'master' || w.day <= g.lastVisit) return null;
      if (a.satiety < 45 || a.energy < 35 || a.sick || a.injury >= 30 || w.ctx.fNeed > 0.55) return null;
      const t = w.get(g.target); if (!t) return null;
      g.lastVisit = w.day;
      return {
        steps: [mv(Math.floor(t.x), Math.floor(t.y), 'visiting ' + t.name), {
          t: 'work', ticks: 25, label: 'chatting with ' + t.name,
          done: a2 => {
            if (!t.alive || !a2.goal) return;
            bump(a2, t, g.kind === 'court' ? 5 : 4); a2.joy = (a2.joy || 0) + 5; t.joy = (t.joy || 0) + 5; S(w).visits++;
          }
        }], claims: [], kind: 'work'
      };
    },
  });
  api.goals = { remember, describe };

  api.info.push((a, w) => {
    if (!on(w) || !a.mem || a.age < api.ADULT_AGE) return '';
    let s = '';
    if (a.goal) {
      const g = a.goal, t = g.target != null ? w.get(g.target) : null;
      const prog = g.kind === 'master' ? ` (${w.skillLv(a, g.skill).toFixed(1)}/5)` : t ? ` (rel ${rel(a, t).toFixed(0)})` : '';
      s += `<div class="doing">Goal: <b>${describe(g)}</b>${prog}</div>`;
    }
    const last = a.mem.slice(-2).map(m => `${m.t} <span class="muted">(d${m.d})</span>`).join('; ');
    if (last) s += `<div class="doing">Remembers: ${last}</div>`;
    return s;
  });
  api.panels.push({
    id: 'goals', title: 'Ambitions',
    html(w) {
      if (!on(w)) return null;
      const s = S(w); if (!s.set) return null;
      const act = w.agents.filter(a => a.goal).length;
      return `<div class="sub">Goals set <b>${s.set}</b> - achieved ${s.done} - given up ${s.failed} - pursuing ${act}</div>` +
        `<div class="sub">Social visits ${s.visits}</div>`;
    },
  });
})();
