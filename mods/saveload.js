/* ==========================================================================
   SMALL WORLD - Save/Load System & Challenge Scenarios
   Allows full saving and loading to localStorage and JSON file exports.
   Provides custom challenge scenarios: The Long Winter, Plague Colony, Famine.
   ========================================================================== */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;

  function serialize(w) {
    return JSON.stringify({
      version: 1,
      seed: w.seed,
      day: w.day,
      tick: w.tick,
      fish: w.fish,
      stock: Object.assign({}, w.stock),
      stats: JSON.parse(JSON.stringify(w.stats)),
      terrain: Array.from(w.terrain),
      trees: w.trees.map(t => ({ x: t.x, y: t.y, wood: t.wood })),
      bushes: w.bushes.map(b => ({ x: b.x, y: b.y, food: b.food })),
      houses: w.houses.map(h => ({ x: h.x, y: h.y, occ: h.occupants.map(o => o.id) })),
      plots: w.plots.map(p => ({ x: p.x, y: p.y, crop: p.crop, stage: p.stage, fert: p.fert })),
      structs: w.structs.map(s => ({ x: s.x, y: s.y, kind: s.kind })),
      agents: w.agents.map(a => ({
        id: a.id, name: a.name, age: a.age, gender: a.gender, trait: a.trait,
        x: a.x, y: a.y, px: a.px, py: a.py,
        satiety: a.satiety, health: a.health, energy: a.energy, mood: a.mood, injury: a.injury,
        job: a.job, skills: Object.assign({}, a.skills), rel: Object.assign({}, a.rel || {}),
        homeX: a.home ? a.home.x : null, homeY: a.home ? a.home.y : null
      })),
      m: JSON.parse(JSON.stringify(w.m || {}))
    });
  }

  function restore(jsonStr) {
    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    const w = new api.World({ seed: data.seed });
    w.day = data.day;
    w.tick = data.tick;
    w.fish = data.fish;
    w.stock = Object.assign({}, data.stock);
    w.stats = Object.assign({}, data.stats);

    if (data.terrain) {
      for (let i = 0; i < data.terrain.length; i++) w.terrain[i] = data.terrain[i];
    }

    w.trees = data.trees || [];
    w.bushes = data.bushes || [];
    w.plots = data.plots || [];
    w.structs = data.structs || [];
    w.m = data.m || {};

    // Rebuild houses and agents
    w.houses = (data.houses || []).map(h => ({
      kind: 'house', x: h.x, y: h.y, occupants: []
    }));

    w.agents = [];
    w.byId = new Map();
    for (const ad of data.agents) {
      const a = {
        id: ad.id, name: ad.name, age: ad.age, gender: ad.gender, trait: ad.trait,
        x: ad.x, y: ad.y, px: ad.px, py: ad.py,
        satiety: ad.satiety, health: ad.health, energy: ad.energy, mood: ad.mood, injury: ad.injury,
        job: ad.job, skills: ad.skills || {}, rel: ad.rel || {},
        alive: true, plan: [], claims: [], sleeping: false
      };
      if (ad.homeX != null) {
        const h = w.houses.find(house => house.x === ad.homeX && house.y === ad.homeY);
        if (h) { a.home = h; h.occupants.push(a); }
      }
      w.agents.push(a);
      w.byId.set(a.id, a);
    }

    // Re-index spatial occ map
    w.occ = new Array(w.W * w.H).fill(null);
    for (const t of w.trees) w.occ[w.idx(t.x, t.y)] = t;
    for (const b of w.bushes) w.occ[w.idx(b.x, b.y)] = b;
    for (const h of w.houses) w.occ[w.idx(h.x, h.y)] = h;
    for (const p of w.plots) w.occ[w.idx(p.x, p.y)] = p;
    for (const s of w.structs) w.occ[w.idx(s.x, s.y)] = s;
    if (w.store) w.occ[w.idx(w.store.x, w.store.y)] = w.store;

    w.log(`Game loaded. Welcome back on Day ${w.day}!`, 'good');
    return w;
  }

  // ---------------------------------------------------------------- Challenge Scenarios
  const SCENARIOS = {
    winter: {
      name: 'The Great Freeze',
      desc: 'Start in deep winter with scarce firewood and ravenous wolves.',
      setup(w) {
        w.day = 30; // Winter begins
        w.stock.food = 15;
        w.stock.wood = 10;
        w.log('Scenario: The Great Freeze. Winter is here. Stock firewood urgently!', 'bad');
      }
    },
    plague: {
      name: 'The Plague Colony',
      desc: 'Start with an active epidemic and low health. Doctors are essential.',
      setup(w) {
        for (const a of w.agents) {
          a.health = 45;
          if (w.rng() < 0.3) w.infect(a, 'plague');
        }
        w.log('Scenario: The Plague Colony. Prioritize doctors and sanitation!', 'bad');
      }
    },
    famine: {
      name: 'Famine & Flood',
      desc: 'Floods drown the fields. Rely on the lake and rationing to endure.',
      setup(w) {
        w.stock.food = 2;
        w.stock.wood = 8;
        w.trigger('flood');
        w.log('Scenario: Famine & Flood. Farmland is drowned!', 'bad');
      }
    }
  };

  api.saveLoad = {
    serialize,
    restore,
    saveLocal(w) {
      if (typeof localStorage === 'undefined') return false;
      const data = serialize(w);
      localStorage.setItem('smallworld.save', data);
      return true;
    },
    loadLocal() {
      if (typeof localStorage === 'undefined') return null;
      const data = localStorage.getItem('smallworld.save');
      return data ? restore(data) : null;
    },
    hasLocal() {
      return typeof localStorage !== 'undefined' && !!localStorage.getItem('smallworld.save');
    },
    exportJSON(w) {
      if (typeof document === 'undefined') return;
      const json = serialize(w);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SmallWorld-Day${w.day}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    startScenario(scenarioKey) {
      const sc = SCENARIOS[scenarioKey];
      if (!sc) return null;
      const w = new api.World({});
      sc.setup(w);
      return w;
    },
    scenarios: SCENARIOS
  };
})();
