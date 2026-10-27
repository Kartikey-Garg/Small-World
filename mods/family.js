/* Marriage and families: replaces random births with couples; families share homes. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { ADULT_AGE, HOUSE_CAP } = api;
  const MARRY_AGE = 16;

  const related = (a, b) => a.parents.some(p => b.parents.includes(p)) || a.parents.includes(b.id) || b.parents.includes(a.id);
  const roomIn = h => h && h.occupants.length < HOUSE_CAP;

  function moveHome(w, a, h) {
    if (a.home === h) return;
    if (a.home) a.home.occupants = a.home.occupants.filter(o => o !== a);
    a.home = h; h.occupants.push(a);
  }

  function marry(w, m, f) {
    m.spouse = f.id; f.spouse = m.id;
    w.registry[m.id].spouse = f.id; w.registry[f.id].spouse = m.id;
    m.joy = (m.joy || 0) + 25; f.joy = (f.joy || 0) + 25; m.mood = Math.min(100, m.mood + 15); f.mood = Math.min(100, f.mood + 15);
    // move in together if a house has room for the mover
    const hm = roomIn(m.home) ? m.home : null, hf = roomIn(f.home) ? f.home : null;
    if (m.home && f.home && m.home === f.home) { /* already together */ }
    else if (f.home && m.home && m.home.occupants.length + 1 <= HOUSE_CAP) moveHome(w, f, m.home);
    else if (hf && m.home) moveHome(w, m, hf);
    else if (!f.home && hm) moveHome(w, f, hm);
    else if (!m.home && hf) moveHome(w, m, hf);
    w.log(`${m.name} and ${f.name} got married.`, 'good');
  }

  function widow(w, a) {
    const s = a.spouse && w.get(a.spouse);
    if (s) { s.spouse = null; }
    if (a.spouse && w.registry[a.spouse]) w.registry[a.spouse].spouse = null;
  }

  api.World.prototype.doBirths = function () {
    const pop = this.agents.length;
    if (pop >= 90 || this.stock.food < pop * 2.5) return;
    for (const m of this.agents.slice()) {
      if (m.gender !== 'F' || !m.spouse || m.age < 15 || m.age > 42 || this.day - m.lastBirth < 8) continue;
      const f = this.get(m.spouse); if (!f) continue;
      if (this.houses.length * HOUSE_CAP <= this.agents.length) break;
      if (m.health < 50 || m.satiety < 30 || m.mood < 30) continue;
      if (this.rng() > 0.27) continue;
      this.giveBirth(m, f);
    }
  };

  api.mods.push({
    day(w) {
      // courtship
      const single = g => w.agents.filter(a => a.gender === g && !a.spouse && a.age >= MARRY_AGE && a.age < 50 && a.mood > 40 && a.sick === 0);
      const ms = single('M').sort(() => w.rng() - 0.5), fs = single('F').sort(() => w.rng() - 0.5);
      for (const m of ms) {
        if (w.rng() > 0.2) continue;
        let best = null, bs = -1;
        for (const f of fs) {
          if (f.spouse || related(m, f)) continue;
          const s = (m.rel[f.id] || 0) + w.rng() * 20 - Math.abs(m.age - f.age) * 0.7;
          if (s > bs) { bs = s; best = f; }
        }
        if (best) marry(w, m, best);
      }
    },
    // a stranger turns up when marriages are impossible for lack of one gender
    dusk(w) {
      if (w.rng() > 0.2 || w.houses.length * HOUSE_CAP <= w.agents.length + 1) return;
      const sing = g => w.agents.filter(a => a.gender === g && !a.spouse && a.age >= MARRY_AGE && a.age < 45).length;
      const sm = sing('M'), sf = sing('F');
      if ((sm === 0 && sf >= 2) || (sf === 0 && sm >= 2)) {
        const g = sm === 0 ? 'M' : 'F';
        const a = w.spawnAgent(g, w.rint(18, 28)); w.assignHome(a); w.stats.arrivals++;
        w.log(`${a.name}, a wandering ${g === 'M' ? 'man' : 'woman'}, settles in the village.`, 'good');
      }
    },
    die(w, a) { widow(w, a); },
    leave(w, a) { widow(w, a); },
    homeFor(w, a) {
      const rel = [a.spouse, ...a.parents, ...a.kids].map(id => id && w.get(id)).filter(Boolean);
      for (const o of rel) if (roomIn(o.home) && w.houses.includes(o.home)) return o.home;
      return null;
    },
  });

  api.info.push((a, w) => {
    const s = a.spouse && w.get(a.spouse), k = a.kids.map(id => w.get(id)).filter(Boolean);
    const parts = [];
    if (s) parts.push('married to <b>' + s.name + '</b>');
    if (k.length) parts.push(k.length + ' child' + (k.length > 1 ? 'ren' : '') + ' alive');
    return parts.length ? '<div class="doing">Family: ' + parts.join(', ') + '</div>' : '';
  });
  api.hud.push({ id: 'couples', label: 'Couples', get: w => w.agents.filter(a => a.spouse && a.gender === 'M').length });
})();
