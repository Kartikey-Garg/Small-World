/* Tools that wear out + the blacksmith and his forge. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { mv } = api.util;
  const WOOD_PER_TOOL = 3;

  api.mods.push({
    init(w) { w.m.tools = { made: 0, broken: 0 }; },
    spawn(w, a) { a.tool = null; },
    // a good tool makes work 25% faster
    workMult(w, a) { return a.tool && a.tool > 0 ? 1.25 : 1; },
    work(w, a, k) {
      if (a.tool && a.tool > 0 && k !== 'smithing') {
        a.tool -= 6;
        if (a.tool <= 0) { a.tool = null; w.m.tools.broken++; }
      }
    },
    // fetch a tool from the storehouse
    idle(w, a) {
      if (a.job === 'child' || a.tool || w.stock.tools < 1 || a.job === 'smith') return null;
      return {
        steps: [mv(w.store.x, w.store.y, 'fetching a tool'), {
          t: 'work', ticks: 4, label: 'taking a tool', check: () => w.stock.tools >= 1,
          done: a2 => { w.stock.tools--; a2.tool = 100; }
        }], claims: [], kind: 'work'
      };
    },
  });

  const forge = w => w.sOf('forge')[0] || null;

  api.needs.push(w => {
    if (forge(w) || w.agents.length < 10 || w.day < 10) return null;
    return { kind: 'forge', cost: 25, ticks: 120, label: 'building a forge' };
  });

  api.jobs.smith = {
    color: '#c9733a', group: 'build', skill: 'smithing',
    weight: (w, c) => forge(w) && w.stock.tools < Math.max(2, c.pop * 0.35) && w.stock.wood > 25 ? 0.35 : 0,
    cap: (w, c) => forge(w) ? 1 + Math.floor(c.N / 25) : 0,
    plan(w, a) {
      const f = forge(w);
      if (!f || w.stock.wood < WOOD_PER_TOOL + 10 || w.stock.tools >= Math.max(2, w.agents.length * 0.4)) return null;
      return {
        steps: [mv(f.x, f.y, 'heading to the forge'), {
          t: 'work', ticks: w.wt(a, 'smithing', 70), label: 'forging a tool', check: () => w.stock.wood >= WOOD_PER_TOOL,
          done: a2 => { w.stock.wood -= WOOD_PER_TOOL; w.stock.tools++; w.m.tools.made++; w.gain(a2, 'smithing'); }
        }], claims: [], kind: 'work'
      };
    },
  };

  api.sprites.forge = (G, s) => {
    const { ctx, ts } = G, x = G.gx(s.x), y = G.gy(s.y);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + ts * 0.05, y + ts * 0.82, ts * 0.95, ts * 0.14);
    ctx.fillStyle = '#5a5f68'; ctx.fillRect(x + ts * 0.1, y + ts * 0.35, ts * 0.8, ts * 0.52);
    ctx.fillStyle = '#3a3e45'; ctx.fillRect(x + ts * 0.1, y + ts * 0.28, ts * 0.8, ts * 0.12);
    ctx.fillStyle = '#2b2d33'; ctx.fillRect(x + ts * 0.62, y + ts * 0.05, ts * 0.16, ts * 0.3);
    const fl = 0.6 + 0.4 * Math.sin(G.time / 120 + s.x);
    ctx.fillStyle = `rgba(255,${120 + 60 * fl | 0},40,${0.7 + 0.3 * fl})`; ctx.fillRect(x + ts * 0.22, y + ts * 0.5, ts * 0.32, ts * 0.22);
    ctx.fillStyle = '#9aa0a8'; ctx.fillRect(x + ts * 0.62, y + ts * 0.58, ts * 0.22, ts * 0.12);
  };

  api.hud.push({ id: 'tools', label: 'Tools', get: w => w.stock.tools });
  api.info.push(a => a.tool ? `<div class="row"><span>Tool</span><div class="bar"><div style="width:${a.tool}%;background:#c9733a"></div></div><span>${a.tool.toFixed(0)}</span></div>` : '');
})();

