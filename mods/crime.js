/* Crime: desperate or greedy villagers steal from the storehouse; the elder (judge) hears cases and punishes. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;

  const C = w => w.m.crime;
  const guardsN = w => w.agents.filter(a => a.job === 'guard').length;

  function temptation(w, a) {
    let t = 0;
    if (a.satiety < 20) t += 0.35;
    if (!w.hasFood()) t += 0.2;
    if (a.mood < 30) t += 0.2;
    if (a.trait === 'greedy') t += 0.12;
    if (a.trait === 'honest') t -= 0.25;
    t += Math.min(0.2, (a.crimes || 0) * 0.04);
    if (a.home) t -= 0.05;
    t -= guardsN(w) * 0.04;
    return t;
  }

  function steal(w, a) {
    const hungry = a.satiety < 30;
    const n = Math.min(w.stock.food, hungry ? 4 : 6 + w.rint(0, 6));
    if (n < 1) return;
    w.stock.food -= n;
    a.satiety = Math.min(100, a.satiety + (hungry ? 35 : 0));
    a.crimes = (a.crimes || 0) + 1; a.stolen = (a.stolen || 0) + n;
    C(w).thefts++;
    const caught = w.rng() < 0.35 + guardsN(w) * 0.15 + (w.sOf('tower').length ? 0.1 : 0);
    if (!hungry) { a.coins = (a.coins || 0) + n * 1.5; }          // fenced for coins
    if (caught) { C(w).queue.push({ id: a.id, name: a.name, n, hungry, day: w.day }); w.log(`${a.name} was caught stealing ${n} food!`, 'bad'); }
    else if (w.rng() < 0.4) w.log(`Food is missing from the storehouse (${n}).`, 'bad');
  }

  function judge(w, c) {
    const a = w.get(c.id); if (!a) return;
    const G = w.m.gov, j = G && G.elder && w.get(G.elder);
    const J = C(w);
    // the elder weighs mercy vs. justice
    let sentence;
    if (c.hungry && (!j || j.trait === 'kind' || w.rng() < 0.7)) sentence = 'pardon';
    else if (a.crimes >= 4) sentence = w.rng() < 0.5 ? 'banish' : 'prison';
    else if (a.crimes >= 2) sentence = 'prison';
    else sentence = w.rng() < 0.6 ? 'fine' : 'prison';
    const by = j ? ` by Elder ${j.name}` : '';
    if (sentence === 'pardon') { w.log(`${a.name} is pardoned${by} - they were starving.`, 'info'); a.mood = Math.min(100, a.mood + 5); }
    else if (sentence === 'fine') {
      const f = Math.min(a.coins || 0, 10); a.coins -= f; w.stock.food += c.n;
      w.log(`${a.name} is fined and returns the food${by}.`, 'info'); a.mood -= 6; J.fines++;
    } else if (sentence === 'prison') {
      a.jailUntil = w.day + 3; J.jailed++; a.mood = Math.max(0, a.mood - 14); w.stock.food += Math.floor(c.n / 2);
      w.log(`${a.name} is jailed for 3 days${by}.`, 'bad');
    } else {
      J.banished++; w.stock.food += c.n; w.log(`${a.name} is banished from the village${by}.`, 'bad');
      w.leave(a, 'was banished');
      for (const o of w.agents) if (o.spouse === a.id || (a.kids || []).includes(o.id)) o.mood = Math.max(0, o.mood - 8);
    }
  }

  api.mods.push({
    init(w) { w.m.crime = { thefts: 0, queue: [], fines: 0, jailed: 0, banished: 0 }; },
    spawn(w, a) { a.crimes = 0; a.stolen = 0; a.jailUntil = 0; },
    day(w) {
      const J = C(w);
      // trials
      while (J.queue.length) judge(w, J.queue.shift());
      // temptation
      for (const a of w.agents.slice()) {
        if (a.age < api.ADULT_AGE + 2 || a.jailUntil > w.day || !a.alive) continue;
        const t = temptation(w, a);
        if (t > 0.1 && w.rng() < t * 0.35 && w.stock.food > 4) steal(w, a);
      }
    },
    // prisoners stay idle in a cell next to the storehouse
    urgent(w, a) {
      if (!a.jailUntil || a.jailUntil <= w.day || (a.satiety < 35 && w.hasFood())) return null;
      return { steps: [api.util.mv(w.store.x, w.store.y + 2, 'in jail'), { t: 'work', ticks: 60, label: 'in jail' }], claims: [], kind: 'jail' };
    },
  });
  api.info.push(a => (a.crimes ? `<div class="doing">Crimes: <b>${a.crimes}</b>${a.jailUntil > 0 ? ' (jailed)' : ''}</div>` : ''));
  api.hud.push({ id: 'thefts', label: 'Thefts', get: w => w.m.crime.thefts });
  api.panels.push({
    id: 'crime', title: 'Law & order',
    html(w) {
      const J = C(w); if (!J.thefts) return null;
      return `<div class="sub">Thefts <b>${J.thefts}</b> - fines ${J.fines} - jailed ${J.jailed} - banished ${J.banished}</div>`;
    },
  });
})();
