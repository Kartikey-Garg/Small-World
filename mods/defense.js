/* Defense: guards, watchtower, palisade and armed raiders who walk in from the edge of the map. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { mv } = api.util;
  const { DAY, W, H } = api;
  const MAX_WALL = 3;

  const D = w => w.m.def;
  const guards = w => w.agents.filter(a => a.job === 'guard');
  const towers = w => w.sOf('tower').length;
  const wallLv = w => D(w).wall;
  const isAdult = a => a.age >= api.ADULT_AGE;

  // combined fighting strength of everyone standing near the storehouse
  function defense(w) {
    let s = 0;
    for (const a of w.agents) {
      if (!isAdult(a) || a.sick > 0 || a.injury > 50) continue;
      if (Math.hypot(a.x - w.store.x, a.y - w.store.y) > 9 && a.job !== 'guard') continue;
      s += (a.job === 'guard' ? 2.2 : 0.7) * (1 + 0.12 * w.skillLv(a, 'fighting')) * (0.6 + a.health / 250);
    }
    return s + towers(w) * 3 + wallLv(w) * 2.5;
  }

  // ---- buildings
  api.needs.push(w => {
    if (w.day < 22 || w.agents.length < 16) return null;
    const out = [];
    if (!towers(w) && !w.sites.some(s => s.for === 'tower')) out.push({ kind: 'tower', cost: 30, ticks: 140, label: 'raising a watchtower' });
    if (towers(w) && wallLv(w) < MAX_WALL && w.agents.length >= 20 + wallLv(w) * 10 && !w.sites.some(s => s.for === 'wall'))
      out.push({
        kind: 'wall', cost: 22, ticks: 130, label: 'raising the palisade', nosite: true,
        done: (w2, a) => { D(w2).wall++; w2.log(`${a.name} finished palisade section ${D(w2).wall}/${MAX_WALL}.`, 'good'); }
      });
    return out;
  });

  // ---- guard job
  api.jobs.guard = {
    color: '#7f8fa6', group: 'defense', skill: 'fighting',
    weight: (w, c) => (c.pop >= 14 && w.day > 15 ? 0.05 + Math.min(0.2, D(w).raids * 0.05) : 0),
    min: (w, c) => (c.pop >= 28 && D(w).raids > 0 ? 1 : 0),
    cap: (w, c) => c.pop >= 14 ? 1 + Math.floor(c.N / 14) : 0,
    plan(w, a) {
      const cx = w.store.x, cy = w.store.y, t = w.sOf('tower')[0];
      const px = t ? t.x : Math.round(cx + (w.rng() - 0.5) * 8), py = t ? t.y + 1 : Math.round(cy + (w.rng() - 0.5) * 8);
      if (!w.walkable(px, py)) return null;
      return {
        steps: [mv(px, py, 'patrolling'), { t: 'work', ticks: 60, label: 'standing watch', done: a2 => w.gain(a2, 'fighting', 0.4) }],
        claims: [], kind: 'work'
      };
    },
  };

  // ---- raiders
  function spawnRaid(w) {
    const n = Math.min(8, 1 + Math.floor(w.day / 55) + w.rint(0, 1));
    const edge = w.rint(0, 3), list = [];
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const x = edge < 2 ? (edge ? W - 2 : 1) : w.rint(2, W - 3), y = edge < 2 ? w.rint(2, H - 3) : (edge === 2 ? 1 : H - 2);
        if (w.walkable(x, y)) { list.push({ x: x + 0.5, y: y + 0.5, dx: 0, hp: 1 }); break; }
      }
    }
    if (!list.length) return false;
    D(w).raiders = list; D(w).raidUntil = w.tick + 2.5 * DAY; D(w).raids++;
    w.log(`Armed raiders (${list.length}) approach the village from the ${['west', 'east', 'north', 'south'][edge]}!`, 'bad');
    // muster defenders
    const pool = w.agents.filter(a => isAdult(a) && a.injury < 40 && a.sick === 0 && a.health > 45)
      .sort((p, q) => (q.job === 'guard') - (p.job === 'guard') || Math.hypot(p.x - w.store.x, p.y - w.store.y) - Math.hypot(q.x - w.store.x, q.y - w.store.y))
      .slice(0, 5 + list.length * 2);
    for (const a of pool) {
      const steps = [mv(w.store.x, w.store.y + 1, 'rallying to defend')];
      for (let i = 0; i < 16; i++) steps.push({ t: 'work', ticks: 12, label: 'defending the village', optional: true, check: () => D(w).raiders.length > 0 });
      w.forcePlan(a, { steps, kind: 'fight' });
    }
    return true;
  }

  function resolve(w, why) {
    const R = D(w).raiders, n = R.length; if (!n) return;
    const strength = n * (3.2 + w.day / 28), def = defense(w);
    const p = def / (def + strength), won = w.rng() < p;
    const defenders = w.agents.filter(a => a.label === 'defending the village' || a.job === 'guard');
    const harm = (amount, chance) => {
      for (const a of defenders.slice()) if (a.alive && w.rng() < chance) w.injure(a, amount * (0.6 + w.rng() * 0.8) * (1 - 0.08 * wallLv(w)), 'raiders');
    };
    D(w).raiders = [];
    if (won) {
      D(w).repelled++; w.stock.food += 6 * n;
      harm(20, 0.3);
      for (const a of defenders) if (a.alive) { w.gain(a, 'fighting', 3); a.mood = Math.min(100, a.mood + 6); }
      w.log(`The raiders are driven off (${Math.round(p * 100)}% odds)! Their supplies are seized.`, 'good');
    } else {
      D(w).losses++;
      const f = Math.floor(w.stock.food * (0.3 + w.rng() * 0.25)), wd = Math.floor(w.stock.wood * 0.15);
      w.stock.food -= f; w.stock.wood -= wd;
      harm(34, 0.55);
      for (const a of w.agents) a.mood = Math.max(0, a.mood - 8);
      w.log(`The raiders overwhelm the defenders and loot ${f} food and ${wd} wood!`, 'bad');
    }
    for (const a of w.agents) if (a.planKind === 'fight' && a.label !== 'fighting wolves') w.endPlan(a);
  }

  api.events.push({
    id: 'raid', label: 'Raiders', cat: 'bad',
    w: w => Math.min(1.4, 0.35 + w.day / 160),
    ok: w => w.day > 14 && w.agents.length >= 8 && !D(w).raiders.length,
    run(w) { return spawnRaid(w); },
  });

  api.mods.push({
    init(w) { w.m.def = { wall: 0, raiders: [], raidUntil: 0, raids: 0, repelled: 0, losses: 0 }; },
    // guards and walls stop petty thieves
    raidBlock(w) {
      const g = guards(w).length, t = towers(w);
      if (!g && !wallLv(w)) return null;
      if (w.rng() < Math.min(0.9, g * 0.28 + t * 0.2 + wallLv(w) * 0.12)) { w.log('Guards spot thieves lurking and chase them away.', 'good'); return true; }
      return null;
    },
    fightMult(w) { return 1 + guards(w).length * 0.2; },
    tick(w) {
      const Rr = D(w).raiders; if (!Rr.length) return;
      let arrived = 0;
      for (const r of Rr) {
        const dx = w.store.x + 0.5 - r.x, dy = w.store.y + 0.5 - r.y, d = Math.hypot(dx, dy);
        if (d < 2.6) { arrived++; continue; }
        const sx = dx / d * 0.1, sy = dy / d * 0.1;
        if (w.walkable(Math.floor(r.x + sx), Math.floor(r.y + sy))) { r.x += sx; r.y += sy; r.dx = sx; }
        else if (w.walkable(Math.floor(r.x + sx), Math.floor(r.y))) { r.x += sx; r.dx = sx; }
        else if (w.walkable(Math.floor(r.x), Math.floor(r.y + sy))) r.y += sy;
        else { r.x += sx * 0.5; r.y += sy * 0.5; }   // squeeze past obstacles
      }
      if (arrived >= Math.ceil(Rr.length / 2) || w.tick > D(w).raidUntil) resolve(w, 'arrived');
    },
  });

  // ---- drawing
  api.sprites.tower = (G, s) => {
    const { ctx, ts } = G, x = G.gx(s.x), y = G.gy(s.y);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + ts * 0.1, y + ts * 0.86, ts * 0.85, ts * 0.12);
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x + ts * 0.22, y + ts * 0.3, ts * 0.1, ts * 0.62); ctx.fillRect(x + ts * 0.68, y + ts * 0.3, ts * 0.1, ts * 0.62);
    ctx.fillStyle = '#8a6238'; ctx.fillRect(x + ts * 0.14, y + ts * 0.18, ts * 0.72, ts * 0.2);
    ctx.fillStyle = '#a0522d'; ctx.beginPath(); ctx.moveTo(x + ts * 0.08, y + ts * 0.2); ctx.lineTo(x + ts * 0.5, y - ts * 0.12); ctx.lineTo(x + ts * 0.92, y + ts * 0.2); ctx.fill();
    ctx.fillStyle = '#c0392b'; ctx.fillRect(x + ts * 0.5, y - ts * 0.3, ts * 0.04, ts * 0.2); ctx.fillRect(x + ts * 0.54, y - ts * 0.3, ts * 0.16, ts * 0.1);
  };
  api.draw.ground.push(G => {
    const w = G.world, L = w.m.def && w.m.def.wall; if (!L) return;
    const { ctx, ts } = G;
    let x0 = w.store.x, x1 = w.store.x, y0 = w.store.y, y1 = w.store.y;
    for (const h of w.houses) { x0 = Math.min(x0, h.x); x1 = Math.max(x1, h.x); y0 = Math.min(y0, h.y); y1 = Math.max(y1, h.y); }
    const pad = 2;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2 + L; ctx.setLineDash([ts * 0.22, ts * 0.12]);
    ctx.strokeRect(G.gx(x0), G.gy(y0), (x1 - x0 + 1) * ts, (y1 - y0 + 1) * ts); ctx.setLineDash([]);
  });
  api.draw.top.push(G => {
    const w = G.world, { ctx, ts } = G, d = w.m.def; if (!d) return;
    for (const r of d.raiders) {
      const x = G.gx(r.x), y = G.gy(r.y);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(x, y + ts * 0.15, ts * 0.22, ts * 0.08, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#7a1f1f'; ctx.fillRect(x - ts * 0.14, y - ts * 0.3, ts * 0.28, ts * 0.42);
      ctx.fillStyle = '#d9b99b'; ctx.beginPath(); ctx.arc(x, y - ts * 0.38, ts * 0.13, 0, 7); ctx.fill();
      ctx.fillStyle = '#2b2b30'; ctx.fillRect(x - ts * 0.15, y - ts * 0.5, ts * 0.3, ts * 0.1);
      ctx.fillStyle = '#c9ced6'; ctx.fillRect(x + ts * 0.14, y - ts * 0.45, ts * 0.05, ts * 0.4);
    }
  });
  api.icons.push(a => a.label === 'defending the village' || a.label === 'fighting wolves' ? ['!!', '#ff7a6b'] : (a.job === 'guard' ? ['G', '#aab8d0'] : null));
  api.alerts.push(w => (w.m.def && w.m.def.raiders.length) ? `RAIDERS approaching! ${w.m.def.raiders.length} attackers` : null);
  api.hud.push({ id: 'guards', label: 'Guards', get: w => guards(w).length });
  api.panels.push({
    id: 'defense', title: 'Defense',
    html(w) {
      const d = w.m.def; if (!towers(w) && !d.raids && !d.wall && !guards(w).length) return null;
      return `<div class="sub">Strength <b>${defense(w).toFixed(1)}</b> - towers ${towers(w)} - palisade ${d.wall}/${MAX_WALL}</div>` +
        `<div class="sub">Raids <b>${d.raids}</b> - repelled ${d.repelled} - lost ${d.losses}</div>`;
    },
  });
})();
