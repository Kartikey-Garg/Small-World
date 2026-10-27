/* Market: village treasury, scarcity-based prices, visiting traders, personal coins. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const BASE = { food: 2, wood: 1.5, tools: 8, bread: 4 };

  function prices(w) {
    const T = w.targets || { food: 100, wood: 60 }, p = {};
    const sc = (have, target) => Math.max(0.5, Math.min(2.5, target / Math.max(1, have)));
    p.food = BASE.food * sc(w.foodEq(), T.food);
    p.wood = BASE.wood * sc(w.stock.wood, T.wood);
    p.tools = BASE.tools * sc(w.stock.tools * 6, w.agents.length);
    p.bread = BASE.bread * 0.9;
    return p;
  }
  api.market = { prices };

  function visit(w) {
    const M = w.m.market, p = prices(w), T = w.targets;
    M.visits++; M.until = w.day + 2;
    const sold = [], bought = [];
    // sell surplus
    const sellable = [['wood', w.stock.wood - T.wood * 1.1, 0.9], ['food', w.stock.food - T.food * 1.4, 0.9], ['tools', w.stock.tools - Math.max(3, w.agents.length * 0.5), 0.9]];
    let income = 0;
    for (const [k, surplus, f] of sellable) {
      const n = Math.floor(surplus); if (n < 2) continue;
      const take = Math.min(n, 60); w.stock[k] -= take; income += take * p[k] * f; sold.push(take + ' ' + k);
    }
    // buy food when short
    M.coins += income;
    const need = T.food * 0.8 - w.foodEq();
    if (need > 5 && M.coins > 4) {
      const buy = Math.min(Math.floor(need), Math.floor(M.coins / (p.food * 1.15)), 80);
      if (buy > 0) { w.stock.food += buy; M.coins -= buy * p.food * 1.15; bought.push(buy + ' food'); }
    }
    // a share of profits goes to the villagers
    if (income > 10 && w.agents.length) {
      const share = income * 0.3, per = share / w.agents.length;
      for (const a of w.agents) a.coins = (a.coins || 0) + per;
      M.coins -= share;
    }
    M.coins = Math.max(0, M.coins);
    w.log(`A trader visits: ${sold.length ? 'sold ' + sold.join(', ') : 'nothing sold'}${bought.length ? '; bought ' + bought.join(', ') : ''}.`, sold.length || bought.length ? 'good' : 'info');
    if (sold.length) w.chron.push({ day: w.day, text: `Trade: ${sold.join(', ')} sold`, type: 'good' });
  }

  api.mods.push({
    init(w) { w.m.market = { coins: 20, until: -1, visits: 0 }; },
    spawn(w, a) { a.coins = a.coins || (a.age >= api.ADULT_AGE ? 2 : 0); },
  });
  api.events.push({
    id: 'trader', label: 'Visiting trader', cat: 'good', w: 2.2,
    ok: w => w.day > 8 && w.m.market.until < w.day,
    run(w) { visit(w); },
  });

  api.draw.ground.push(G => {
    const w = G.world, M = w.m.market;
    if (!M || M.until < w.day) return;
    const { ctx, ts } = G, x = G.gx(w.store.x + 3.2), y = G.gy(w.store.y + 3.4);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x, y + ts * 0.8, ts * 1.4, ts * 0.14);
    ctx.fillStyle = '#7a4f2a'; ctx.fillRect(x, y + ts * 0.3, ts * 1.2, ts * 0.5);
    ctx.fillStyle = '#e8e0cc'; ctx.beginPath(); ctx.moveTo(x - 2, y + ts * 0.32); ctx.lineTo(x + ts * 0.6, y - ts * 0.15); ctx.lineTo(x + ts * 1.2 + 2, y + ts * 0.32); ctx.fill();
    ctx.fillStyle = '#2b2b30'; ctx.beginPath(); ctx.arc(x + ts * 0.25, y + ts * 0.82, ts * 0.14, 0, 7); ctx.arc(x + ts * 0.95, y + ts * 0.82, ts * 0.14, 0, 7); ctx.fill();
  });

  api.hud.push({ id: 'coins', label: 'Treasury', get: w => Math.floor(w.m.market.coins) });
  api.info.push(a => `<div class="doing">Coins: <b>${(a.coins || 0).toFixed(0)}</b></div>`);
  api.panels.push({
    id: 'market', title: 'Market',
    html(w) {
      const p = prices(w), M = w.m.market;
      return `<table class="tbl">${['food', 'wood', 'tools', 'bread'].map(k => `<tr><td>${k} (have ${Math.floor(w.stock[k])})</td><td>${p[k].toFixed(1)}c</td></tr>`).join('')}</table>` +
        `<div class="sub">${M.until >= w.day ? '<b>A trader is in town!</b>' : 'No trader right now'} - visits so far: ${M.visits}</div>`;
    },
  });
})();
