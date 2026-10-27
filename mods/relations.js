/* Friendships, rivalries, gossip and brawls. a.rel[otherId] in -100..100 */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const clamp = api.util.clamp;

  function bump(a, b, n) {
    a.rel[b.id] = clamp((a.rel[b.id] || 0) + n, -100, 100);
    b.rel[a.id] = clamp((b.rel[a.id] || 0) + n, -100, 100);
  }

  api.mods.push({
    die(w, a) { for (const o of w.agents) delete o.rel[a.id]; },
    leave(w, a) { for (const o of w.agents) delete o.rel[a.id]; },
    day(w) {
      const ag = w.agents.filter(a => a.age >= 8);
      // daily social contacts: housemates, family, workmates and random neighbours
      for (const a of ag) {
        const pool = [];
        if (a.home) for (const o of a.home.occupants) if (o !== a) pool.push(o);
        for (let i = 0; i < 2; i++) pool.push(ag[w.rint(0, ag.length - 1)]);
        for (const o of pool) {
          if (o === a || o.id < a.id) continue;
          let d = 0.8 + (a.mood + o.mood > 120 ? 1 : -0.5);
          if (a.job === o.job) d += 0.5;
          if (a.trait === 'kind' || o.trait === 'kind') d += 0.7;
          if (a.trait === 'hotheaded' && o.trait === 'hotheaded') d -= 3;
          if (a.trait === 'greedy' || o.trait === 'greedy') d -= 0.8;
          if (!w.hasFood()) d -= 1.5;
          if (w.rng() < 0.15) d -= 3;          // random quarrel
          bump(a, o, d);
        }
      }
      // gossip: rumours spread bad mood one step along friendships; good friends cheer each other up
      for (const a of ag) {
        let best = null;
        for (const id in a.rel) if (a.rel[id] > 45) { const o = w.get(+id); if (o && (!best || o.mood > best.mood)) best = o; }
        if (best) { a.mood = Math.min(100, a.mood + (best.mood - a.mood) * 0.06); }
      }
      // slow decay towards neutral
      for (const a of ag) for (const id in a.rel) { a.rel[id] *= 0.97; if (Math.abs(a.rel[id]) < 1) delete a.rel[id]; }
      // brawls between rivals
      if (w.rng() < 0.35) {
        const hot = ag.filter(a => a.trait === 'hotheaded' || a.mood < 25);
        const a = hot[w.rint(0, Math.max(0, hot.length - 1))];
        if (a) {
          let foe = null, fs = -40;
          for (const id in a.rel) { const o = w.get(+id); if (o && a.rel[id] < fs) { fs = a.rel[id]; foe = o; } }
          if (foe) {
            w.stats.brawls = (w.stats.brawls || 0) + 1;
            const dmg = w.rint(6, 18);
            w.log(`${a.name} and ${foe.name} get into a brawl.`, 'bad');
            w.injure(a, dmg * 0.6, 'a brawl'); w.injure(foe, dmg, 'a brawl');
            bump(a, foe, 10);                  // blowing off steam, grudge fades
            a.mood = Math.max(0, a.mood - 8); foe.mood = Math.max(0, foe.mood - 8);
          }
        }
      }
    },
  });

  const name = (w, id) => { const o = w.get(+id); return o ? o.name : null; };
  api.info.push((a, w) => {
    const ids = Object.keys(a.rel);
    const fr = ids.filter(i => a.rel[i] > 35).sort((p, q) => a.rel[q] - a.rel[p]).map(i => name(w, i)).filter(Boolean).slice(0, 3);
    const en = ids.filter(i => a.rel[i] < -35).sort((p, q) => a.rel[p] - a.rel[q]).map(i => name(w, i)).filter(Boolean).slice(0, 2);
    let s = '';
    if (fr.length) s += '<div class="doing">Friends: ' + fr.join(', ') + '</div>';
    if (en.length) s += '<div class="doing">Rivals: ' + en.join(', ') + '</div>';
    return s;
  });
})();
