/* New jobs: hunter (deer), baker (oven), doctor (heals the sick), teacher (school trains children). */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { mv, nearestTo } = api.util;
  const { ADULT_AGE } = api;

  // ------------------------------------------------------------------ deer
  const walkOk = (w, x, y) => w.walkable(x, y);
  function spawnDeer(w, x, y) {
    const d = { kind: 'deer', x, y, claimed: null, dx: 0 };
    w.m.deer.push(d); return d;
  }
  api.mods.push({
    init(w) {
      w.m.deer = [];
      for (let i = 0, n = 0; i < 200 && n < 7; i++) {
        const x = w.rint(1, w.W - 2), y = w.rint(1, w.H - 2);
        if (walkOk(w, x, y) && Math.hypot(x - w.store.x, y - w.store.y) > 8) { spawnDeer(w, x + 0.5, y + 0.5); n++; }
      }
    },
    tick(w) {
      if (w.tick % 14) return;
      for (const d of w.m.deer) {
        if (d.claimed && w.rng() < 0.7) continue;
        const nx = Math.floor(d.x) + w.rint(-1, 1), ny = Math.floor(d.y) + w.rint(-1, 1);
        if (walkOk(w, nx, ny) && !w.occ[w.idx(nx, ny)] && Math.hypot(nx - w.store.x, ny - w.store.y) > 5) { d.dx = nx + 0.5 - d.x; d.x = nx + 0.5; d.y = ny + 0.5; }
      }
    },
    day(w) {
      const D = w.m.deer;
      if (D.length < 14 && D.length >= 2 && w.rng() < 0.1 + (D.length < 4 ? 0.1 : 0)) {
        const p = D[w.rint(0, D.length - 1)]; spawnDeer(w, p.x, p.y);
      }
      if (D.length < 2 && w.rng() < 0.12) {          // wanderers from the wilds
        const x = w.rint(1, w.W - 2), y = w.rint(1, w.H - 2);
        if (walkOk(w, x, y)) spawnDeer(w, x + 0.5, y + 0.5);
      }
    },
  });
  api.draw.ground.push(G => {
    const { ctx, ts } = G;
    for (const d of G.world.m.deer) {
      const x = G.gx(d.x), y = G.gy(d.y);
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(x, y + ts * 0.18, ts * 0.28, ts * 0.09, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#a9763f'; ctx.fillRect(x - ts * 0.24, y - ts * 0.18, ts * 0.46, ts * 0.22);
      ctx.fillRect(x + (d.dx < 0 ? -ts * 0.34 : ts * 0.16), y - ts * 0.32, ts * 0.17, ts * 0.17);
      ctx.fillStyle = '#6e4a26';
      ctx.fillRect(x - ts * 0.2, y + ts * 0.04, ts * 0.06, ts * 0.17); ctx.fillRect(x + ts * 0.12, y + ts * 0.04, ts * 0.06, ts * 0.17);
    }
  });

  api.jobs.hunter = {
    color: '#7a8f3a', group: 'food', skill: 'hunting',
    weight: (w, c) => w.m.deer.length > 2 ? c.fNeed * (c.winter ? 0.7 : 0.3) : 0,
    cap: (w, c) => Math.min(1 + Math.floor(c.pop / 15), Math.floor(w.m.deer.length / 2)),
    plan(w, a) {
      const d = nearestTo(w.m.deer, a.x, a.y, o => !o.claimed);
      if (!d) return null;
      return {
        steps: [mv(Math.floor(d.x), Math.floor(d.y), 'tracking a deer'), {
          t: 'work', ticks: w.wt(a, 'hunting', 30), label: 'hunting', check: () => w.m.deer.includes(d) && Math.hypot(d.x - a.x, d.y - a.y) < 4,
          done: a2 => {
            w.m.deer = w.m.deer.filter(o => o !== d);
            w.addCarry(a2, 'food', 5 + Math.floor(w.skillLv(a2, 'hunting') / 3));
            w.gain(a2, 'hunting', 2);
            if (w.rng() < 0.08) w.injure(a2, 12, 'a hunting accident');
          }
        }, ...w.deliverSteps()], claims: [d], kind: 'work'
      };
    },
  };

  // ------------------------------------------------------------------ baker
  const oven = w => w.sOf('oven')[0] || null;
  api.needs.push(w => (oven(w) || w.agents.length < 10 || w.day < 8) ? null : { kind: 'oven', cost: 20, ticks: 100, label: 'building a bakery oven' });
  api.jobs.baker = {
    color: '#e6c27a', group: 'food', skill: 'baking',
    weight: (w, c) => oven(w) && w.stock.food > c.pop * 2 ? 0.2 : 0,
    cap: (w, c) => oven(w) ? 1 + Math.floor(c.N / 30) : 0,
    plan(w, a) {
      const o = oven(w);
      if (!o || w.stock.food < w.agents.length * 2 || w.stock.wood < 4) return null;
      return {
        steps: [mv(o.x, o.y, 'heading to the oven'), {
          t: 'work', ticks: w.wt(a, 'baking', 55), label: 'baking bread', check: () => w.stock.food >= 3 && w.stock.wood >= 1,
          done: a2 => { w.stock.food -= 3; w.stock.wood -= 0.5; w.stock.bread += 2 + (w.skillLv(a2, 'baking') >= 5 ? 1 : 0); w.gain(a2, 'baking'); }
        }], claims: [], kind: 'work'
      };
    },
  };
  api.hud.push({ id: 'bread', label: 'Bread', get: w => Math.floor(w.stock.bread) });

  // ------------------------------------------------------------------ doctor
  const patients = w => w.agents.filter(p => p.sick > 0 || (p.injury > 25 && p.health < 80));
  api.jobs.doctor = {
    color: '#e8e8f0', group: 'health', skill: 'healing',
    weight: (w) => Math.min(0.5, patients(w).length * 0.08),
    cap: (w, c) => Math.min(patients(w).length, 1 + Math.floor(c.N / 20)),
    plan(w, a) {
      const p = nearestTo(patients(w), a.x, a.y, o => o !== a && !o.claimed);
      if (!p) return null;
      return {
        steps: [mv(Math.floor(p.x), Math.floor(p.y), `going to ${p.name}`), {
          t: 'work', ticks: w.wt(a, 'healing', 40), label: `treating ${p.name}`, check: () => p.alive && Math.hypot(p.x - a.x, p.y - a.y) < 3,
          done: a2 => {
            const lv = w.skillLv(a2, 'healing');
            if (p.sick > 0) { p.sick = Math.max(0, p.sick - (lv >= 4 ? 2 : 1)); if (!p.sick) { p.sickKind = null; w.log(`${a2.name} cured ${p.name}.`, 'good'); } }
            p.injury = Math.max(0, p.injury - 15); p.health = Math.min(100, p.health + 6 + lv);
            w.gain(a2, 'healing', 2);
          }
        }], claims: [p], kind: 'work'
      };
    },
  };

  // ------------------------------------------------------------------ teacher
  const school = w => w.sOf('school')[0] || null;
  const kids = w => w.agents.filter(k => k.age < ADULT_AGE && k.age >= 4);
  api.needs.push(w => (school(w) || kids(w).length < 3 || w.day < 12) ? null : { kind: 'school', cost: 25, ticks: 120, label: 'building a school' });
  api.jobs.teacher = {
    color: '#9a7de0', group: 'edu', skill: 'teaching',
    weight: (w) => school(w) && kids(w).length >= 3 ? 0.15 : 0,
    cap: (w, c) => school(w) ? 1 + Math.floor(kids(w).length / 12) : 0,
    plan(w, a) {
      const s = school(w), K = kids(w);
      if (!s || !K.length) return null;
      return {
        steps: [mv(s.x, s.y, 'heading to the school'), {
          t: 'work', ticks: 70, label: 'teaching the children',
          done: a2 => {
            const ks = ['farming', 'fishing', 'woodcutting', 'building', 'baking', 'healing'];
            const amt = 0.8 + w.skillLv(a2, 'teaching') * 0.12;
            for (const k of kids(w)) { const sk = ks[w.rint(0, ks.length - 1)]; if ((k.skills[sk] || 0) < 30) k.skills[sk] = (k.skills[sk] || 0) + amt; k.mood = Math.min(100, k.mood + 0.5); }
            w.gain(a2, 'teaching', 1);
          }
        }], claims: [], kind: 'work'
      };
    },
  };

  // ------------------------------------------------------------------ sprites
  api.sprites.oven = (G, s) => {
    const { ctx, ts } = G, x = G.gx(s.x), y = G.gy(s.y);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + ts * 0.05, y + ts * 0.82, ts * 0.95, ts * 0.14);
    ctx.fillStyle = '#b5683f'; ctx.beginPath(); ctx.ellipse(x + ts * 0.5, y + ts * 0.62, ts * 0.42, ts * 0.32, 0, Math.PI, 0); ctx.fillRect(x + ts * 0.08, y + ts * 0.6, ts * 0.84, ts * 0.24); ctx.fill();
    ctx.fillStyle = '#2a1a14'; ctx.fillRect(x + ts * 0.38, y + ts * 0.58, ts * 0.24, ts * 0.26);
    const fl = 0.6 + 0.4 * Math.sin(G.time / 140 + s.y);
    ctx.fillStyle = `rgba(255,${150 + 60 * fl | 0},50,.9)`; ctx.fillRect(x + ts * 0.42, y + ts * 0.7, ts * 0.16, ts * 0.12);
  };
  api.sprites.school = (G, s) => {
    const { ctx, ts } = G, x = G.gx(s.x), y = G.gy(s.y);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + ts * 0.05, y + ts * 0.84, ts * 0.95, ts * 0.12);
    ctx.fillStyle = '#d9c9a3'; ctx.fillRect(x + ts * 0.1, y + ts * 0.4, ts * 0.8, ts * 0.46);
    ctx.fillStyle = '#7a5aa8'; ctx.beginPath(); ctx.moveTo(x, y + ts * 0.42); ctx.lineTo(x + ts * 0.5, y + ts * 0.05); ctx.lineTo(x + ts, y + ts * 0.42); ctx.fill();
    ctx.fillStyle = '#3b2f22'; ctx.fillRect(x + ts * 0.42, y + ts * 0.6, ts * 0.16, ts * 0.26);
    ctx.fillStyle = '#7fc4ee'; ctx.fillRect(x + ts * 0.18, y + ts * 0.5, ts * 0.16, ts * 0.14); ctx.fillRect(x + ts * 0.66, y + ts * 0.5, ts * 0.16, ts * 0.14);
  };
})();
