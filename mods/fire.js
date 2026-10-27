/* Fire and wildfire. House fires spread to neighbours; a bucket brigade of villagers can put them out. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { mv } = api.util;
  const BURN = 140;          // ticks until a burning house collapses
  const HP = 200;            // fire strength; each fighter removes ~1/tick (1.5 with a well)

  const burning = w => w.houses.filter(h => h.fire);

  function ignite(w, h, why) {
    if (!h || h.fire) return false;
    h.fire = { burn: 0, hp: HP };
    w.m.fire.count++;
    w.log(`Fire! A house ${why} is ablaze!`, 'bad');
    dispatch(w, h, 5);
    return true;
  }
  function dispatch(w, h, n) {
    const pool = w.agents.filter(a => a.age >= api.ADULT_AGE && a.planKind !== 'fire' && a.sick === 0 && a.injury < 40)
      .sort((p, q) => Math.hypot(p.x - h.x, p.y - h.y) - Math.hypot(q.x - h.x, q.y - h.y)).slice(0, n);
    for (const a of pool) {
      const steps = [mv(h.x, h.y, 'running to the fire')];
      for (let i = 0; i < 8; i++) steps.push({ t: 'work', ticks: 20, label: 'fighting the fire', optional: true, check: () => !!h.fire });
      w.forcePlan(a, { steps, kind: 'fire' });
      a.sleeping = false;
    }
  }

  api.mods.push({
    init(w) { w.m.fire = { count: 0, saved: 0, lost: 0, flames: [] }; },
    tick(w) {
      const F = w.m.fire;
      F.flames = F.flames.filter(f => f.until > w.tick);
      const hs = burning(w);
      if (!hs.length) return;
      const hasWell = w.sOf('well').length > 0;
      for (const h of hs) {
        const f = h.fire;
        f.burn++;
        let fighters = 0;
        for (const a of w.agents) if (a.label === 'fighting the fire' && Math.hypot(a.x - h.x, a.y - h.y) < 2.6) fighters++;
        f.hp -= fighters * (hasWell ? 1.5 : 1.0);
        if (f.hp <= 0) {
          h.fire = null; F.saved++;
          w.log('The fire is put out - the house is saved!', 'good');
          for (const a of w.agents) if (a.planKind === 'fire') { w.endPlan(a); }
          continue;
        }
        if (f.burn % 20 === 0) {                       // sparks
          for (const o of w.houses) if (o !== h && !o.fire && Math.hypot(o.x - h.x, o.y - h.y) < 2.4 && w.rng() < 0.14) ignite(w, o, 'next door');
          if (fighters + w.agents.filter(a => a.planKind === 'fire').length < 4) dispatch(w, h, 3);
        }
        if (f.burn >= BURN) {
          for (const a of w.agents.slice()) if (Math.hypot(a.x - h.x, a.y - h.y) < 1.2 && a.indoors) w.injure(a, 22, 'a house fire');
          F.lost++;
          w.stock.wood = Math.max(0, w.stock.wood - Math.min(8, w.stock.wood * 0.1));
          w.log('A burning house collapses.', 'bad');
          w.hook('houseLost', h, 'fire');
          w.destroyHouse(h);
          for (const a of w.agents) if (a.planKind === 'fire' && !burning(w).length) w.endPlan(a);
        }
      }
    },
  });

  api.events.push({
    id: 'fire', label: 'House fire', cat: 'bad', ok: w => w.houses.length >= 3 && !w.houses.some(h => h.fire),
    w: w => (w.droughtDays > 0 ? 2 : 0.8) + (w.season === 'Winter' ? 0.5 : 0),
    run(w) {
      const hs = w.houses.filter(h => h.occupants.length);
      if (!hs.length) return false;
      ignite(w, hs[w.rint(0, hs.length - 1)], 'with a sleeping family');
    },
  });
  api.events.push({
    id: 'wildfire', label: 'Wildfire', cat: 'bad', ok: w => w.season !== 'Winter' && w.trees.length > 10,
    w: w => w.droughtDays > 0 ? 2 : 0.35,
    run(w) {
      const t0 = w.trees[w.rint(0, w.trees.length - 1)];
      let n = 0;
      for (const t of w.trees) if (t.wood > 0 && Math.hypot(t.x - t0.x, t.y - t0.y) < 3.5) {
        t.wood = 0; t.regrowAt = w.tick + (8 + w.rng() * 6) * api.DAY; n++;
        w.m.fire.flames.push({ x: t.x, y: t.y, until: w.tick + api.DAY * 0.6 });
      }
      w.log(`A wildfire scorches a forest: ${n} trees burn.`, 'bad');
      for (const h of w.houses) if (!h.fire && Math.hypot(h.x - t0.x, h.y - t0.y) < 4.5 && w.rng() < 0.5) { ignite(w, h, 'near the forest'); break; }
    },
  });

  api.draw.top.push(G => {
    const w = G.world, { ctx, ts } = G, F = w.m.fire; if (!F) return;
    const flame = (x, y, s) => {
      const fl = 0.7 + 0.3 * Math.sin(G.time / 90 + x * 3 + y);
      ctx.fillStyle = `rgba(255,${90 + 80 * fl | 0},30,.9)`; ctx.beginPath(); ctx.moveTo(x - ts * 0.18 * s, y); ctx.lineTo(x, y - ts * 0.55 * s * fl); ctx.lineTo(x + ts * 0.18 * s, y); ctx.fill();
      ctx.fillStyle = 'rgba(255,230,120,.9)'; ctx.beginPath(); ctx.moveTo(x - ts * 0.08 * s, y); ctx.lineTo(x, y - ts * 0.3 * s * fl); ctx.lineTo(x + ts * 0.08 * s, y); ctx.fill();
    };
    for (const h of burning(w)) {
      const x = G.gx(h.x + 0.5), y = G.gy(h.y + 0.5);
      flame(x - ts * 0.25, y, 1.2); flame(x + ts * 0.2, y + ts * 0.05, 1); flame(x, y - ts * 0.2, 1.4);
      ctx.fillStyle = 'rgba(60,60,60,.35)'; ctx.beginPath(); ctx.arc(x + Math.sin(G.time / 400) * 4, y - ts * 0.9, ts * 0.3, 0, 7); ctx.fill();
    }
    for (const f of F.flames) flame(G.gx(f.x + 0.5), G.gy(f.y + 0.8), 1);
  });
  api.icons.push(a => a.label === 'fighting the fire' ? ['H2O', '#7fc4ee'] : null);
  api.alerts.push(w => { const n = burning(w).length; return n ? `FIRE! ${n} house${n > 1 ? 's' : ''} burning` : null; });
})();
