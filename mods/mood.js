/* Mood, happiness and grief. Mood scales work speed (core wt), low mood makes people leave. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;

  function target(w, a) {
    let t = 58;
    if (a.satiety > 55) t += 10; else if (a.satiety < 25) t -= 18; else if (a.satiety < 40) t -= 6;
    t += a.home ? 6 : -12;
    if (a.cold) t -= 10;
    if (a.sick > 0) t -= 12;
    t -= a.injury * 0.15;
    if (a.energy < 20) t -= 6;
    if (!w.hasFood()) t -= 8;
    t -= a.grief * 0.45;
    t += a.joy || 0;
    if (a.spouse && w.get(a.spouse)) t += 8;
    if (a.age < api.ADULT_AGE) t += 10;
    return Math.max(0, Math.min(100, t));
  }

  api.mods.push({
    spawn(w, a) { a.joy = 0; a.lowDays = 0; },
    day(w) {
      for (const a of w.agents.slice()) {
        a.mood += (target(w, a) - a.mood) * 0.35;
        a.grief = Math.max(0, a.grief - 5);
        a.joy = Math.max(0, (a.joy || 0) - 4);
        a.lowDays = a.mood < 22 ? a.lowDays + 1 : 0;
        // despair: adults who stay miserable for days walk away
        if (a.lowDays >= 4 && a.age >= api.ADULT_AGE && w.rng() < 0.12 && w.agents.length > 1) {
          w.leave(a, 'left the village in despair');
        }
      }
    },
    die(w, a) {
      const kin = new Set([...(a.parents || []), ...(a.kids || [])]);
      if (a.spouse) kin.add(a.spouse);
      for (const id of kin) {
        const o = w.get(id); if (!o) continue;
        const g = id === a.spouse ? 55 : 35;
        o.grief = Math.min(100, o.grief + g); o.mood = Math.max(0, o.mood - g * 0.5);
      }
      // friends mourn too (rel is filled by the relations mod)
      for (const id in a.rel) { const o = w.get(+id); if (o && a.rel[id] > 40 && !kin.has(o.id)) { o.grief = Math.min(100, o.grief + 15); o.mood = Math.max(0, o.mood - 6); } }
      // everyone feels a little worse when someone dies
      for (const o of w.agents) o.mood = Math.max(0, o.mood - 1.5);
    },
  });

  const avg = w => w.agents.length ? w.agents.reduce((s, a) => s + a.mood, 0) / w.agents.length : 0;
  api.hud.push({ id: 'mood', label: 'Mood', get: w => Math.round(avg(w)) });
  api.icons.push((a) => a.mood < 20 ? [':(', '#ff8fa3'] : null);
  api.info.push(a => {
    const m = a.mood, face = m > 75 ? 'joyful' : m > 55 ? 'content' : m > 35 ? 'uneasy' : m > 20 ? 'unhappy' : 'miserable';
    return `<div class="row"><span>Mood</span><div class="bar"><div style="width:${m}%;background:#c58fe0"></div></div><span>${m.toFixed(0)}</span></div>` +
      `<div class="doing">Feels <b>${face}</b>${a.grief > 5 ? ', grieving' : ''}, ${a.trait}</div>`;
  });
  api.alerts.push(w => {
    const n = w.agents.filter(a => a.mood < 20).length;
    return n >= 3 && n >= w.agents.length * 0.3 ? 'Morale is collapsing - villagers are miserable' : null;
  });
})();
