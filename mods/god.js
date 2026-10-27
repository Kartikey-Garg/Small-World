/* God mode: trigger any event, bless or smite the village. Using it flags the run as "godUsed". */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;

  const god = w => { w.godUsed = true; };

  api.actions.godEvent = (w, id) => { if (!w.gameOver) w.trigger(id); };
  api.actions.godMigrants = w => {
    if (w.gameOver) return; god(w);
    const n = 3;
    for (let i = 0; i < n; i++) { const a = w.spawnAgent(w.rng() < 0.5 ? 'M' : 'F', w.rint(16, 30)); w.assignHome(a); w.stats.arrivals++; }
    w.log(`${n} divine travellers appear in the village.`, 'good');
  };
  api.actions.godFood = w => { if (w.gameOver) return; god(w); w.stock.food += 150; w.stock.wood += 60; w.log('Food and wood rain from the sky.', 'good'); };
  api.actions.godSkip = w => { if (!w.gameOver) w.skipSeason(); };
  api.actions.godSmite = w => {
    if (w.gameOver || !w.agents.length) return; god(w);
    const a = w.agents[w.rint(0, w.agents.length - 1)];
    w.log(`Lightning strikes ${a.name}!`, 'bad'); w.die(a, 'lightning');
  };
  api.actions.godToggle = (w) => { w.m.godOpen = !w.m.godOpen; };

  const GOOD = ['harvest', 'rain', 'feast', 'heal', 'migrants', 'trader'];
  api.panels.push({
    id: 'god', title: 'God mode',
    html(w) {
      const open = !!w.m.godOpen;
      const head = `<div class="btns"><button class="sm${open ? ' on' : ''}" data-act="godToggle">${open ? 'Hide powers' : 'Show powers'}</button></div>`;
      if (!open) return head + (w.godUsed ? '<div class="sub">You have meddled in this world.</div>' : '');
      const evs = api.events.filter(e => !/!$/.test(e.id));
      const good = evs.filter(e => e.cat === 'good' || GOOD.includes(e.id)), bad = evs.filter(e => !good.includes(e));
      const b = (e, cls) => `<button class="sm ${cls}" data-act="godEvent" data-arg="${e.id}">${e.label}</button>`;
      return head +
        `<div class="sub">Blessings</div><div class="btns">${good.map(e => b(e, 'good')).join('')}` +
        `<button class="sm good" data-act="godMigrants">+3 settlers</button><button class="sm good" data-act="godFood">+150 food</button></div>` +
        `<div class="sub">Calamities</div><div class="btns">${bad.map(e => b(e, 'bad')).join('')}<button class="sm bad" data-act="godSmite">Smite one</button></div>` +
        `<div class="sub">Time</div><div class="btns"><button class="sm" data-act="godSkip">Skip season</button></div>`;
    },
  });
})();
