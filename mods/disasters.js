/* Natural disasters: floods, earthquakes and wolf packs. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { mv } = api.util;
  const { DAY, W, H } = api;

  // ------------------------------------------------------------------ flood
  api.events.push({
    id: 'flood', label: 'Flood', cat: 'bad', w: 0.8,
    ok: w => (w.season === 'Spring' || w.season === 'Autumn') && !w.m.nat.flood,
    run(w) {
      const R = 2 + w.rint(0, 1), tiles = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (w.terrain[y * W + x] !== 0) continue;
        let near = false;
        for (let dy = -R; dy <= R && !near; dy++) for (let dx = -R; dx <= R; dx++) {
          if (w.inb(x + dx, y + dy) && w.terrain[(y + dy) * W + x + dx] === 1 && dx * dx + dy * dy <= R * R) { near = true; break; }
        }
        if (!near) continue;
        const o = w.occ[y * W + x];
        if (o && o.kind === 'plot') { if (o.state !== 'empty') { o.state = 'empty'; o.p = 0; } o.fert = Math.min(1.2, o.fert + 0.3); continue; }  // silt
        if (o) continue;
        if (w.agents.some(a => Math.floor(a.x) === x && Math.floor(a.y) === y)) continue;
        tiles.push(y * W + x);
      }
      for (const t of tiles) w.terrain[t] = 2;
      w.m.nat.flood = { until: w.day + w.rint(3, 5), tiles };
      w.fish = Math.min(api.FISH_MAX, w.fish + 15);
      w.log(`The lake bursts its banks! ${tiles.length} tiles are flooded and low fields are washed out.`, 'bad');
      for (const a of w.agents) if (a.path) w.endPlan(a);          // re-route everyone
    },
  });
  function recede(w) {
    const f = w.m.nat.flood; if (!f) return;
    for (const t of f.tiles) if (w.terrain[t] === 2) w.terrain[t] = 0;
    w.m.nat.flood = null;
    // anyone caught on a tile that is now free is fine; tiles never turn into water under people
    w.log('The flood waters recede, leaving fertile silt.', 'good');
  }

  // ------------------------------------------------------------------ earthquake
  api.events.push({
    id: 'earthquake', label: 'Earthquake', cat: 'bad', w: 0.35, ok: w => w.day > 15 && w.houses.length >= 3,
    run(w) {
      const n = Math.max(1, Math.min(w.houses.length - 1, Math.round(w.houses.length * (0.1 + w.rng() * 0.15))));
      const lost = w.houses.slice().sort(() => w.rng() - 0.5).slice(0, n);
      let hurt = 0;
      for (const h of lost) {
        for (const a of h.occupants.slice()) if (a.indoors && w.rng() < 0.5) { w.injure(a, w.rint(10, 35), 'a collapsing house'); hurt++; }
        w.hook('houseLost', h, 'earthquake'); w.destroyHouse(h);
      }
      for (const s of w.structs.slice()) if (w.rng() < 0.12) { w.removeStruct(s); w.log(`The ${s.kind} is wrecked by the quake.`, 'bad'); }
      for (const a of w.agents) a.mood = Math.max(0, a.mood - 10);
      w.log(`EARTHQUAKE! ${lost.length} houses collapse, ${hurt} people are hurt.`, 'bad');
    },
  });

  // ------------------------------------------------------------------ wolves
  const wolves = w => w.m.nat.wolves;
  api.events.push({
    id: 'wolves', label: 'Wolf pack', cat: 'bad', w: 0.9,
    ok: w => w.day > 10 && w.agents.length >= 5 && wolves(w).length === 0 && (w.season === 'Winter' || w.season === 'Autumn' || w.rng() < 0.4),
    run(w) {
      const n = w.rint(1, 2 + (w.agents.length > 40 ? 1 : 0));
      const edge = w.rint(0, 3);
      for (let i = 0; i < n; i++) {
        const x = edge < 2 ? (edge ? W - 2 : 1) : w.rint(2, W - 3), y = edge < 2 ? w.rint(2, H - 3) : (edge === 2 ? 1 : H - 2);
        if (w.walkable(x, y)) wolves(w).push({ x: x + 0.5, y: y + 0.5, hp: 28, cd: 0, until: w.tick + 3 * DAY, dx: 0 });
      }
      if (!wolves(w).length) return false;
      w.log(`A pack of ${wolves(w).length} wolves prowls near the village!`, 'bad');
      w.hook('wolves', wolves(w));
      callFighters(w);
    },
  });
  function callFighters(w) {
    const wf = wolves(w)[0]; if (!wf) return;
    const pool = w.agents.filter(a => a.age >= api.ADULT_AGE && a.planKind !== 'fight' && a.injury < 40 && a.health > 45)
      .sort((p, q) => Math.hypot(p.x - wf.x, p.y - wf.y) - Math.hypot(q.x - wf.x, q.y - wf.y)).slice(0, 4 + wolves(w).length);
    for (const a of pool) {
      const steps = [mv(Math.floor(wf.x), Math.floor(wf.y), 'hunting the wolves')];
      for (let i = 0; i < 12; i++) steps.push({ t: 'work', ticks: 10, label: 'fighting wolves', optional: true, check: () => wolves(w).length > 0 });
      w.forcePlan(a, { steps, kind: 'fight' });
    }
  }

  api.mods.push({
    init(w) { w.m.nat = { flood: null, wolves: [], wolfKills: 0 }; },
    day(w) {
      const f = w.m.nat.flood;
      if (f && w.day >= f.until) recede(w);
      const q = wolves(w);
      if (q.length && !q.some(o => o.until > w.tick)) { w.m.nat.wolves = []; w.log('The wolves drift away.', 'info'); }
    },
    tick(w) {
      const Q = wolves(w); if (!Q.length) return;
      const fighters = w.agents.filter(a => a.label === 'fighting wolves');
      for (const wf of Q.slice()) {
        // target: nearest person who is outdoors
        let tg = null, td = 12;
        for (const a of w.agents) {
          if (a.indoors || a.sleeping && a.indoors) continue;
          const d = Math.hypot(a.x - wf.x, a.y - wf.y); if (d < td) { td = d; tg = a; }
        }
        if (tg && td > 0.9) {
          const sx = (tg.x - wf.x) / td * 0.11, sy = (tg.y - wf.y) / td * 0.11;
          if (w.walkable(Math.floor(wf.x + sx), Math.floor(wf.y + sy))) { wf.x += sx; wf.y += sy; wf.dx = sx; }
          else if (w.walkable(Math.floor(wf.x + sx), Math.floor(wf.y))) { wf.x += sx; wf.dx = sx; }
          else if (w.walkable(Math.floor(wf.x), Math.floor(wf.y + sy))) wf.y += sy;
        }
        if (wf.cd > 0) wf.cd--;
        if (tg && td <= 1.1 && wf.cd <= 0) {
          wf.cd = 45;
          w.injure(tg, w.rint(10, 24), 'wolves');
          if (tg.alive) { tg.mood = Math.max(0, tg.mood - 10); }
        }
        // people nearby beat it back
        let near = 0; for (const a of fighters) if (Math.hypot(a.x - wf.x, a.y - wf.y) < 2) near++;
        if (near) wf.hp -= 0.12 * near * w.hookProd('fightMult');
      }
      const dead = Q.filter(o => o.hp <= 0);
      if (dead.length) {
        w.m.nat.wolves = Q.filter(o => o.hp > 0); w.m.nat.wolfKills += dead.length;
        w.stock.food += 6 * dead.length;
        w.log(`Villagers kill ${dead.length} wolf${dead.length > 1 ? 'es' : ''}! The meat is stored.`, 'good');
        if (!w.m.nat.wolves.length) for (const a of w.agents) if (a.planKind === 'fight') w.endPlan(a);
      }
    },
  });

  // ------------------------------------------------------------------ drawing
  api.draw.top.push(G => {
    const w = G.world, { ctx, ts } = G, N = w.m.nat; if (!N) return;
    for (const wf of N.wolves) {
      const x = G.gx(wf.x), y = G.gy(wf.y);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y + ts * 0.15, ts * 0.3, ts * 0.09, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#6b6f78'; ctx.fillRect(x - ts * 0.26, y - ts * 0.2, ts * 0.5, ts * 0.22);
      ctx.fillRect(x + (wf.dx < 0 ? -ts * 0.38 : ts * 0.16), y - ts * 0.3, ts * 0.2, ts * 0.17);
      ctx.fillStyle = '#e0554c'; ctx.fillRect(x + (wf.dx < 0 ? -ts * 0.34 : ts * 0.27), y - ts * 0.26, ts * 0.05, ts * 0.05);
      ctx.fillStyle = '#41444b'; ctx.fillRect(x - ts * 0.22, y + ts * 0.02, ts * 0.06, ts * 0.15); ctx.fillRect(x + ts * 0.14, y + ts * 0.02, ts * 0.06, ts * 0.15);
    }
  });
  api.alerts.push(w => w.m.nat && w.m.nat.wolves.length ? `Wolves! ${w.m.nat.wolves.length} prowling near the village` : (w.m.nat && w.m.nat.flood ? 'Flood - the lake has burst its banks' : null));
})();
