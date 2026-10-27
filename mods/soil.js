/* Soil fertility: core handles depletion/fallow; this adds compost (leftover wood ash/bread crusts) and visibility. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const avg = w => w.plots.length ? w.plots.reduce((s, p) => s + p.fert, 0) / w.plots.length : 1;

  api.mods.push({
    day(w) {
      // villagers spread household compost on the poorest empty field (only when food is plentiful)
      if (w.season === 'Winter' || w.stock.food < w.agents.length * 6) return;
      const worst = w.plots.filter(p => p.state === 'empty').sort((a, b) => a.fert - b.fert)[0];
      if (worst && worst.fert < 0.9) worst.fert = Math.min(1.2, worst.fert + 0.06);
    },
  });
  api.hud.push({ id: 'fert', label: 'Soil', get: w => Math.round(avg(w) * 100) + '%' });
  api.alerts.push(w => w.plots.length > 8 && avg(w) < 0.55 ? 'Soil is exhausted - fields need to lie fallow' : null);
})();
