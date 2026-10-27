/* Governance: the oldest wise villager is elder; a council votes each season on priorities and rationing. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;

  const score = (w, a) => Math.min(a.age, 50) * 0.6 + Object.values(a.skills).reduce((s, v) => s + v, 0) * 0.15 + (a.trait === 'honest' ? 8 : a.trait === 'kind' ? 5 : 0)
    + Object.values(a.rel).reduce((s, v) => s + (v > 30 ? 1 : 0), 0) * 2 + a.mood * 0.1;

  function elect(w) {
    const G = w.m.gov, cand = w.agents.filter(a => a.age >= 20 && a.age < a.lifespan * 0.85 && a.health > 30 && a.mood > 25).sort((p, q) => score(w, q) - score(w, p));
    const council = cand.slice(0, Math.min(5, Math.max(1, Math.floor(w.agents.length / 6)))).map(a => a.id);
    const old = G.elder;
    G.council = council; G.elder = council.includes(old) && w.get(old) ? old : (council[0] || null);
    if (G.elder && G.elder !== old) { const e = w.get(G.elder); w.log(`${e.name} is chosen as village elder.`, 'mile'); G.elections++; }
  }

  function vote(w) {
    const G = w.m.gov, c = w.ctx || {};
    const T = w.targets || { food: 100, wood: 60 };
    const members = G.council.map(id => w.get(id)).filter(Boolean);
    if (!members.length) return;
    const tally = { food: 0, wood: 0, build: 0, balanced: 0 }, rat = { yes: 0, no: 0 };
    const foodLow = w.foodEq() < T.food * 0.55, woodLow = w.stock.wood < T.wood * 0.5, housing = c.houseShort || c.plotShort;
    for (const m of members) {
      let v = 'balanced', wgt = m.id === G.elder ? 1.5 : 1;
      if (foodLow && !(m.trait === 'greedy' && w.rng() < 0.3)) v = 'food';
      else if (woodLow && w.season !== 'Spring') v = 'wood';
      else if (housing && m.job === 'builder') v = 'build';
      else if (w.rng() < 0.12) v = ['food', 'wood', 'build'][w.rint(0, 2)];
      tally[v] += wgt;
      const wantRation = w.foodEq() < w.agents.length * 4 + 10 && !(m.trait === 'greedy' && w.rng() < 0.5);
      rat[wantRation ? 'yes' : 'no'] += wgt;
    }
    const win = Object.keys(tally).sort((p, q) => tally[q] - tally[p])[0];
    const rationOn = rat.yes > rat.no;
    const changed = w.policy.priority !== win || w.policy.ration !== rationOn;
    w.policy.priority = win; w.policy.ration = rationOn; G.votes++;
    G.last = { day: w.day, win, rationOn, tally };
    if (changed) w.log(`The council votes: priority <b>${win}</b>, rationing ${rationOn ? 'ON' : 'off'}.`.replace(/<\/?b>/g, ''), 'info');
  }

  api.mods.push({
    init(w) { w.m.gov = { elder: null, council: [], elections: 0, votes: 0, last: null, manual: false }; elect(w); },
    day(w) {
      const G = w.m.gov;
      if (G.elder && !w.get(G.elder)) elect(w);
      if (w.day % api.SEASON_DAYS === 0 || (w.day % 5 === 0 && w.foodEq() < (w.targets ? w.targets.food * 0.35 : 40))) {
        if (w.day % api.SEASON_DAYS === 0) elect(w);
        if (!G.manual) vote(w);
      }
    },
    die(w, a) { const G = w.m.gov; if (G && G.council.includes(a.id)) { G.council = G.council.filter(id => id !== a.id); if (G.elder === a.id) { w.log(`Elder ${a.name} has died. The council will choose a successor.`, 'mile'); elect(w); } } },
  });

  api.actions.policy = (w, arg) => {
    const [k, v] = arg.split(':'); w.m.gov.manual = true;
    if (k === 'pri') w.policy.priority = v; else if (k === 'ration') w.policy.ration = v === 'on'; else if (k === 'auto') w.m.gov.manual = false;
  };
  api.info.push((a, w) => { const G = w.m.gov; return G.elder === a.id ? '<div class="doing"><b>Village elder</b></div>' : (G.council.includes(a.id) ? '<div class="doing">Council member</div>' : ''); });
  api.panels.push({
    id: 'gov', title: 'Governance',
    html(w) {
      const G = w.m.gov, e = G.elder && w.get(G.elder), P = w.policy;
      const btn = (k, v, label, on) => `<button class="sm${on ? ' on' : ''}" data-act="policy" data-arg="${k}:${v}">${label}</button>`;
      return `<div class="sub">Elder: <b>${e ? e.name : 'none'}</b> - council ${G.council.length} - votes ${G.votes}${G.manual ? ' (you are ruling)' : ''}</div>` +
        `<div class="btns">${['balanced', 'food', 'wood', 'build'].map(v => btn('pri', v, v, P.priority === v)).join('')}</div>` +
        `<div class="btns">${btn('ration', 'on', 'Ration ON', P.ration)}${btn('ration', 'off', 'Ration off', !P.ration)}${btn('auto', '1', 'Let council decide', !G.manual)}</div>`;
    },
  });
  api.hud.push({ id: 'pol', label: 'Policy', get: w => w.policy.priority + (w.policy.ration ? '+R' : '') });
})();
