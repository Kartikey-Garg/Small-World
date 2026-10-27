/* Wells, clean water and cholera. Without enough wells, lake water breeds cholera. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;

  const wells = w => w.sOf('well');
  const wellsNeeded = w => Math.ceil(w.agents.length / 18);
  // 0..1 share of the village that has clean water
  const coverage = w => Math.min(1, wells(w).length / Math.max(1, wellsNeeded(w)));
  api.water = { coverage, wellsNeeded };

  api.needs.push(w => {
    if (w.day < 10 || w.agents.length < 8) return null;
    const have = wells(w).length + w.sites.filter(s => s.for === 'well').length;
    return have < wellsNeeded(w) ? { kind: 'well', cost: 12, ticks: 90, label: 'digging a well' } : null;
  });

  api.events.push({
    id: 'cholera', label: 'Cholera outbreak', cat: 'bad',
    ok: w => w.agents.length >= 6 && coverage(w) < 1,
    w: w => 2.2 * (1 - coverage(w)),
    run(w) { outbreak(w); },
  });
  function outbreak(w) {
    const n = Math.max(1, Math.round(w.agents.length * (0.12 + 0.22 * (1 - coverage(w)))));
    const pool = w.agents.filter(a => !a.sick).sort(() => w.rng() - 0.5).slice(0, n);
    for (const a of pool) { a.sick = 5; a.sickKind = 'cholera'; }
    w.m.water.outbreaks++;
    w.log(`Cholera! Foul water sickens ${pool.length} villagers.`, 'bad');
  }
  // manual trigger for god mode
  api.events.push({ id: 'cholera!', label: 'Cholera (god)', cat: 'bad', manual: true, run(w) { outbreak(w); } });

  api.mods.push({
    init(w) { w.m.water = { outbreaks: 0 }; },
    day(w) {
      // contagion through dirty water
      const cov = coverage(w);
      if (cov >= 1) return;
      const sick = w.agents.filter(a => a.sickKind === 'cholera' && a.sick > 0);
      if (!sick.length) return;
      for (const a of w.agents) {
        if (a.sick || w.rng() > 0.05 * sick.length * (1 - cov) / Math.max(4, w.agents.length / 3)) continue;
        a.sick = 4; a.sickKind = 'cholera';
      }
    },
    built(w, s) { if (s.kind === 'well') w.log('A new well gives the village clean water.', 'good'); },
  });

  api.sprites.well = (G, s) => {
    const { ctx, ts } = G, x = G.gx(s.x), y = G.gy(s.y);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x + ts * 0.5, y + ts * 0.82, ts * 0.42, ts * 0.12, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#8f949c'; ctx.beginPath(); ctx.ellipse(x + ts * 0.5, y + ts * 0.62, ts * 0.36, ts * 0.22, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#2f6fb0'; ctx.beginPath(); ctx.ellipse(x + ts * 0.5, y + ts * 0.58, ts * 0.26, ts * 0.14, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x + ts * 0.18, y + ts * 0.15, ts * 0.06, ts * 0.5); ctx.fillRect(x + ts * 0.76, y + ts * 0.15, ts * 0.06, ts * 0.5);
    ctx.fillStyle = '#a0522d'; ctx.fillRect(x + ts * 0.12, y + ts * 0.1, ts * 0.76, ts * 0.1);
  };
  api.icons.push(a => a.sickKind === 'cholera' && a.sick > 0 ? ['+', '#7fe0b0'] : null);
  api.hud.push({ id: 'wells', label: 'Wells', get: w => wells(w).length + '/' + wellsNeeded(w) });
  api.alerts.push(w => {
    const n = w.agents.filter(a => a.sickKind === 'cholera' && a.sick > 0).length;
    return n >= 3 ? `Cholera is spreading (${n} sick) - dig wells!` : null;
  });
})();

