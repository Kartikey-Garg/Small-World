/* ==========================================================================
   SMALL WORLD - Council Dilemmas & Policy Decrees
   Auto-resolves during fast simulation or headless testing so the sim stays
   stable while still exposing the current council issue in the sidebar.
   ========================================================================== */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { hash01 } = api.util;

  const S = w => w.m.dilemmas || (w.m.dilemmas = { active: null, lastDay: -99, resolvedCount: 0, recent: [] });

  const DILEMMA_POOL = [
    {
      id: 'refugees',
      title: 'Wandering Survivors',
      text: 'A ragged band of travelers knocks on the stockade gates, begging for refuge from raiders.',
      condition: w => w.day >= 6 && w.agents.length < 50,
      options: [
        {
          label: 'Welcome them with open arms',
          desc: '+2 settlers, -12 food, +5 mood',
          effect(w) {
            w.stock.food = Math.max(0, (w.stock.food || 0) - 12);
            const a1 = w.spawnAgent(hash01(w.seed, 'dilemma_m1', w.day) < 0.5 ? 'M' : 'F', 20);
            w.assignHome(a1); w.stats.arrivals = (w.stats.arrivals || 0) + 1;
            const a2 = w.spawnAgent(hash01(w.seed, 'dilemma_m2', w.day) < 0.5 ? 'M' : 'F', 22);
            w.assignHome(a2); w.stats.arrivals = (w.stats.arrivals || 0) + 1;
            for (const a of w.agents) a.mood = Math.min(100, a.mood + 5);
            w.log('The council welcomed the travelers as fellow villagers.', 'good');
          }
        },
        {
          label: 'Offer traveling rations and turn away',
          desc: '-4 food, no population change',
          effect(w) {
            w.stock.food = Math.max(0, (w.stock.food || 0) - 4);
            w.log('The council gave the travelers bread and sent them on.', 'info');
          }
        },
        {
          label: 'Turn them away at spearpoint',
          desc: '-10 village mood, preserves supplies',
          effect(w) {
            for (const a of w.agents) a.mood = Math.max(0, a.mood - 10);
            w.log('The travelers were turned away into the wilderness.', 'bad');
          }
        }
      ]
    },
    {
      id: 'frost_ration',
      title: 'Early Frost Warning',
      text: 'The elder notes a sharp drop in evening temperature. The storehouse firewood may not last.',
      condition: w => w.season === 'Autumn' || w.season === 'Winter',
      options: [
        {
          label: 'Ration the hearth fires',
          desc: 'Conserves wood, but villagers shiver (-8 mood)',
          effect(w) {
            w.stock.wood = (w.stock.wood || 0) + 10;
            for (const a of w.agents) a.mood = Math.max(0, a.mood - 8);
            w.log('Fires were rationed. The village saved firewood through chilly nights.', 'info');
          }
        },
        {
          label: 'Keep hearths burning bright',
          desc: '+10 village mood, consumes 18 wood',
          effect(w) {
            w.stock.wood = Math.max(0, (w.stock.wood || 0) - 18);
            for (const a of w.agents) a.mood = Math.min(100, a.mood + 10);
            w.log('The great hearths burned bright, keeping spirits high.', 'good');
          }
        }
      ]
    },
    {
      id: 'lake_festival',
      title: 'Blessing of the Waters',
      text: 'The villagers wish to hold a feast on the lakeshore to celebrate the ancestors and strengthen community bonds.',
      condition: w => (w.stock.fish || 0) >= 12 && w.day >= 10,
      options: [
        {
          label: 'Host the Lakeside Feast',
          desc: '-12 fish, +20 mood to all villagers',
          effect(w) {
            w.stock.fish = Math.max(0, (w.stock.fish || 0) - 12);
            for (const a of w.agents) {
              a.mood = Math.min(100, a.mood + 20);
              a.satiety = Math.min(100, a.satiety + 25);
            }
            w.log('The Lake Festival was held with joyful singing and dancing.', 'good');
          }
        },
        {
          label: 'Conserve the stores for hard times',
          desc: 'No fish spent, villagers grumble (-4 mood)',
          effect(w) {
            for (const a of w.agents) a.mood = Math.max(0, a.mood - 4);
            w.log('The council declined the festival to preserve fish reserves.', 'info');
          }
        }
      ]
    },
    {
      id: 'militia_drill',
      title: 'Defense Preparedness',
      text: 'Tracks of wild wolves have been spotted near the perimeter. Should we mandate combat training?',
      condition: w => w.day >= 15,
      options: [
        {
          label: 'Mandate militia drills for all adults',
          desc: '+15 village defense, slight fatigue (-10 energy)',
          effect(w) {
            for (const a of w.agents) {
              if (a.age >= 12) a.energy = Math.max(0, a.energy - 10);
            }
            if (w.m.def) w.m.def.guardBonus = (w.m.def.guardBonus || 0) + 15;
            w.log('Villagers completed rigorous militia drills.', 'good');
          }
        },
        {
          label: 'Rely on existing watch and hunters',
          desc: 'No fatigue, normal defense',
          effect(w) {
            w.log('The council decided against compulsory drills.', 'info');
          }
        }
      ]
    }
  ];

  function resolveDilemma(w, dilemma, optIdx) {
    const s = S(w);
    const opt = dilemma.options[optIdx] || dilemma.options[0];
    opt.effect(w);
    api.recordRecentDecision(w, {
      title: dilemma.title,
      choice: opt.label,
      summary: opt.desc,
      consequence: opt.label,
    });
    s.active = null;
    s.resolvedCount++;
    s.lastDay = w.day;
  }

  api.actions.resolveDilemmaChoice = (w, arg) => {
    const s = S(w);
    if (!s.active || !s.active.options) return;
    const idx = Number(arg);
    if (Number.isFinite(idx) && idx >= 0 && idx < s.active.options.length) {
      resolveDilemma(w, s.active, idx);
    }
  };

  api.panels.push({
    id: 'dilemma-watch',
    title: 'Council Watch',
    html(w) {
      const s = S(w);
      const recent = api.getRecentDecisions(w);
      const active = s.active ? `
        <div class="dilemma-inline">
          <div class="sub"><b>Active dilemma:</b> ${s.active.title}</div>
          <div class="dilemma-text">${s.active.text}</div>
          <div class="dilemma-options">${s.active.options.map((opt, i) => `
            <button class="dilemma-btn" data-act="resolveDilemmaChoice" data-arg="${i}">
              <strong>${opt.label}</strong>
              <span class="dilemma-desc">${opt.desc}</span>
            </button>
          `).join('')}</div>
        </div>
      ` : '<div class="sub">No active dilemma</div>';
      const list = recent.length ? recent.map(d => `
        <div class="decision-item">
          <div class="decision-head"><span class="chip">D${d.day}</span><strong>${d.title}</strong></div>
          <div class="decision-choice">${d.choice}</div>
          <div class="decision-summary">${d.summary || 'No additional note.'}</div>
        </div>
      `).join('') : '<div class="muted">The council has not made a ruling yet.</div>';
      return active + `<div class="decision-list">${list}</div>`;
    },
  });

  api.mods.push({
    day(w) {
      const s = S(w);
      if (w.day - s.lastDay < 12) return;

      const candidates = DILEMMA_POOL.filter(d => !d.condition || d.condition(w));
      if (!candidates.length) return;

      const idx = Math.floor(hash01(w.seed, 'dilemma', w.day) * candidates.length);
      const chosen = candidates[idx];
      s.active = chosen;
      s.lastDay = w.day;

      const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
      const isFast = typeof window !== 'undefined' && window.SmallWorldSpeed && window.SmallWorldSpeed > 3;

      if (!isBrowser || isFast) {
        const autoChoice = Math.floor(hash01(w.seed, 'choice', w.day) * chosen.options.length);
        resolveDilemma(w, chosen, autoChoice);
      }
    }
  });
})();
