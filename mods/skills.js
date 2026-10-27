/* Skills & experience: core handles gain/speed; this mod shows them and a village "master" panel. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const LV = ['novice', 'novice', 'apprentice', 'apprentice', 'skilled', 'skilled', 'expert', 'expert', 'master', 'master', 'grandmaster'];

  api.info.push((a, w) => {
    const ks = Object.keys(a.skills).filter(k => a.skills[k] >= 3).sort((p, q) => a.skills[q] - a.skills[p]).slice(0, 4);
    if (!ks.length) return '';
    return '<div class="doing">Skills: ' + ks.map(k => `${k} <b>${w.skillLv(a, k).toFixed(1)}</b>`).join(', ') + '</div>';
  });

  api.mods.push({
    work(w, a, k) {
      const lv = Math.floor(w.skillLv(a, k));
      if (lv >= 5 && lv > (a._lv && a._lv[k] || 0)) {
        (a._lv = a._lv || {})[k] = lv;
        if (lv === 5 || lv === 8) w.log(`${a.name} has become a ${LV[lv]} ${k.replace('ing', 'er')}.`, 'good');
      }
    },
  });

  api.panels.push({
    id: 'masters', title: 'Best skills',
    html(w) {
      const rows = [];
      for (const k of ['farming', 'fishing', 'woodcutting', 'building', 'hunting', 'baking', 'smithing', 'healing', 'teaching']) {
        let best = null;
        for (const a of w.agents) if ((a.skills[k] || 0) >= 6 && (!best || a.skills[k] > best.skills[k])) best = a;
        if (best) rows.push(`<tr><td>${k}</td><td>${best.name}</td><td>${w.skillLv(best, k).toFixed(1)}</td></tr>`);
      }
      return rows.length ? `<table class="tbl">${rows.join('')}</table>` : null;
    },
  });
})();
