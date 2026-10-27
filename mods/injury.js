/* Injury and healing: wounds slow people down, can get infected, work accidents happen; doctors and rest help. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { mv } = api.util;

  api.mods.push({
    init(w) { w.m.injury = { accidents: 0, infections: 0 }; },
    // hurt people move slowly and work badly
    speedMult(w, a) { return a.injury > 20 ? 1 - Math.min(0.45, a.injury / 200) : 1; },
    workMult(w, a) { return a.injury > 20 ? 1 - Math.min(0.4, a.injury / 220) : 1; },
    vitals(w, a, hit) {
      if (a.injury > 60) hit(0.03, a.lastCause || 'wounds');       // serious wounds bleed
      if (a.infected) hit(0.05, 'infection');
    },
    work(w, a, k) {
      const risk = k === 'woodcutting' ? 0.012 : k === 'building' ? 0.008 : k === 'smithing' ? 0.01 : 0.002;
      if (w.rng() < risk * (1 - 0.05 * w.skillLv(a, k))) {
        w.m.injury.accidents++;
        w.injure(a, w.rint(8, 28), 'an accident at work');
        if (a.alive && a.injury > 25) w.log(`${a.name} hurt themselves ${k === 'woodcutting' ? 'chopping wood' : 'at work'}.`, 'bad');
      }
    },
    hurt(w, a, n) {
      if (n >= 15 && !a.infected && w.rng() < 0.18) {              // dirty wound
        a.infected = true; w.m.injury.infections++;
        w.log(`${a.name}'s wound has become infected.`, 'bad');
      }
    },
    day(w) {
      for (const a of w.agents) {
        // rest and food speed healing; doctors do the rest (mods/jobs.js)
        if (a.injury > 0 && a.satiety > 40) a.injury = Math.max(0, a.injury - (a.sleeping || a.indoors ? 2 : 1));
        if (a.infected) {
          if (w.rng() < 0.28 + (w.agents.some(d => d.job === 'doctor') ? 0.12 : 0)) { a.infected = false; w.log(`${a.name}'s infection clears.`, 'good'); }
          else a.injury = Math.min(100, a.injury + 3);
        }
      }
    },
    // badly hurt people go home to recover
    urgent(w, a) {
      if (a.injury < 55 || a.planKind === 'fire' || a.planKind === 'fight' || !a.home || (a.satiety < 35 && w.hasFood())) return null;
      return { steps: [mv(a.home.x, a.home.y, 'going home to recover'), { t: 'sleep', nap: true, label: 'recovering' }], claims: [], kind: 'sleep' };
    },
  });

  // healing: doctors also clear infection
  api.mods.push({
    work(w, a, k) { if (k === 'healing') for (const o of w.agents) if (o.infected && Math.hypot(o.x - a.x, o.y - a.y) < 3) o.infected = false; },
  });

  api.icons.push(a => a.infected ? ['x', '#d6e86a'] : (a.injury > 50 ? ['+', '#ff6b6b'] : null));
  api.info.push(a => a.injury > 3 ? `<div class="row"><span>Injury</span><div class="bar"><div style="width:${a.injury}%;background:#ff6b6b"></div></div><span>${a.injury.toFixed(0)}</span></div>${a.infected ? '<div class="doing">Wound infected</div>' : ''}` : '');
  api.hud.push({ id: 'hurt', label: 'Injured', get: w => w.agents.filter(a => a.injury > 20).length });
})();
