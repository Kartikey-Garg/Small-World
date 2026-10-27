/* Eras: the village develops from cave-dwelling hunter-gatherers to a modern society.
   Knowledge points (KP) are earned daily and spent on technologies. Technologies unlock buildings and jobs,
   boost yields and work speed, soften disasters, lengthen lives and speed up research itself.
   Enough technologies of an era open the next era. Switch off with new World({ eras: false }). */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;

  const on = w => w.opts.eras !== false;
  const COST_SCALE = 2.6;          // global research cost knob (pacing)

  // ------------------------------------------------------------------ eras
  // look: { wall, roof } colours (0xRRGGBB) used by the 2D and 3D renderers for houses
  const ERAS = [
    { id: 'stone',   name: 'Stone Age',      sub: 'cave dwellers and hunter-gatherers', home: 'cave shelters',        look: { wall: 0x7d746a, roof: 0x5e564d } },
    { id: 'neo',     name: 'Neolithic',      sub: 'the first farmers',                  home: 'mud-brick huts',       look: { wall: 0xb69b6e, roof: 0xc9b24a } },
    { id: 'bronze',  name: 'Bronze Age',     sub: 'metal, writing and trade',           home: 'timber houses',        look: { wall: 0xb79a72, roof: 0xa67c3f } },
    { id: 'iron',    name: 'Iron Age',       sub: 'cities, law and learning',           home: 'stone houses',         look: { wall: 0xa9a59c, roof: 0x8f4a2b } },
    { id: 'medieval', name: 'Middle Ages',   sub: 'castles, guilds and universities',   home: 'half-timbered houses', look: { wall: 0xc8b58f, roof: 0xa23f36 } },
    { id: 'industrial', name: 'Industrial Age', sub: 'steam, science and medicine',     home: 'brick houses',         look: { wall: 0xa5503f, roof: 0x4a4f58 } },
    { id: 'modern',  name: 'Modern Age',     sub: 'electricity and information',        home: 'modern homes',         look: { wall: 0xd9dde2, roof: 0x3d6a8c } },
  ];
  ERAS.forEach(E => { E.look.eraId = E.id; });   // renderers (e.g. buildings3d.js) pick era-specific models by this id

  // ------------------------------------------------------------------ technologies
  // fx: yield{farm,wood,fish,forage}  work{all|skill}  heat  ev{eventId}  kp  life(days)  mood
  //     unlock{build[],job[],event[]} - things that are locked until the tech is known
  const AREAS = { food: 'Food', build: 'Building', tools: 'Tools', health: 'Health', defense: 'Defense', know: 'Knowledge', trade: 'Trade', society: 'Society' };
  const T = (id, name, era, area, cost, req, desc, fx, start) => ({ id, name, era, area, cost, req, desc, fx: fx || {}, start: !!start });
  const TECHS = [
    // --- Stone Age
    T('fire', 'Control of fire', 0, 'society', 0, [], 'Warmth, light and cooked food.', {}, true),
    T('stone_tools', 'Flint tools', 0, 'tools', 0, [], 'Knapped flint blades and scrapers.', {}, true),
    T('foraging', 'Gathering lore', 0, 'food', 10, [], 'Knowing which plants to pick: berries feed more.', { yield: { forage: 1.3 } }),
    T('spears', 'Hunting spears', 0, 'defense', 12, ['stone_tools'], 'Hunters work faster; the first guards can be trained.', { work: { hunting: 1.15 }, unlock: { job: ['guard'] } }),
    T('fish_nets', 'Fishing nets', 0, 'food', 12, [], 'Woven nets bring in bigger catches.', { yield: { fish: 1.3 } }),
    T('hides', 'Hide clothing', 0, 'society', 12, ['fire'], 'Furs make winter nights less deadly.', { heat: 0.88 }),
    // --- Neolithic
    T('agriculture', 'Agriculture', 1, 'food', 20, ['foraging'], 'Selecting seed grain raises crop yields.', { yield: { farm: 1.15 } }),
    T('pottery', 'Pottery', 1, 'food', 20, ['fire'], 'Clay pots and ovens: bread can be baked.', { unlock: { build: ['oven'], job: ['baker'] } }),
    T('herbalism', 'Herbal medicine', 1, 'health', 22, ['foraging'], 'Healers can be trained; plague hits a little softer.', { unlock: { job: ['doctor'] }, ev: { plague: 0.85 }, life: 2 }),
    T('wells', 'Well digging', 1, 'health', 12, ['stone_tools'], 'Wells give clean water.', { unlock: { build: ['well'] } }),
    T('woodworking', 'Carpentry', 1, 'build', 22, ['stone_tools'], 'Axes and joinery: more wood per tree.', { yield: { wood: 1.2 } }),
    T('weaving', 'Weaving', 1, 'society', 24, ['hides'], 'Cloth and baskets: warmer, happier homes.', { heat: 0.92, mood: 1 }),
    T('watchtower', 'Watchtower', 1, 'defense', 24, ['spears'], 'A lookout post warns of raiders.', { unlock: { build: ['tower'] } }),
    // --- Bronze Age
    T('metalworking', 'Bronze casting', 2, 'tools', 36, ['pottery', 'stone_tools'], 'Smelting opens the forge and the blacksmith.', { unlock: { build: ['forge'], job: ['smith'] } }),
    T('writing', 'Writing', 2, 'know', 40, ['pottery'], 'Records and teaching: a school can be built. Research speeds up.', { unlock: { build: ['school'], job: ['teacher'] }, kp: 0.15 }),
    T('trade', 'Long-distance trade', 2, 'trade', 36, ['pottery'], 'Merchants begin to visit the village.', { unlock: { event: ['trader'] } }),
    T('plow', 'Ox plow', 2, 'food', 38, ['agriculture'], 'Deeper furrows, bigger harvests, faster farming.', { yield: { farm: 1.2 }, work: { farming: 1.1 } }),
    T('masonry', 'Stone masonry', 2, 'build', 36, ['woodworking'], 'Sturdy walls resist storms and fires.', { ev: { storm: 0.7, fire: 0.75, earthquake: 0.8 } }),
    T('calendar', 'Calendar', 2, 'know', 34, ['weaving'], 'Planting by the stars: fewer ruined seasons.', { ev: { drought: 0.8, blight: 0.85 } }),
    // --- Iron Age
    T('ironworking', 'Ironworking', 3, 'tools', 55, ['metalworking'], 'Iron tools: smiths, woodcutters and builders work faster.', { work: { smithing: 1.2, woodcutting: 1.1, building: 1.1 }, yield: { wood: 1.1 } }),
    T('fortification', 'Fortification', 3, 'defense', 55, ['watchtower', 'masonry'], 'Palisades can be raised; raiders think twice.', { unlock: { build: ['wall'] }, ev: { raid: 0.75 } }),
    T('mathematics', 'Mathematics', 3, 'know', 52, ['writing'], 'Counting, surveying and accounting.', { kp: 0.15, work: { building: 1.05 } }),
    T('public_baths', 'Public baths', 3, 'health', 55, ['wells', 'masonry'], 'Cleanliness keeps cholera and plague at bay.', { ev: { cholera: 0.5, plague: 0.85 }, mood: 1 }),
    T('crop_rotation', 'Crop rotation', 3, 'food', 58, ['plow'], 'Resting fields: higher yields.', { yield: { farm: 1.15 } }),
    T('currency', 'Coinage', 3, 'trade', 50, ['trade', 'writing'], 'Coins make trade easier; traders come more often.', { ev: { trader: 1.5 } }),
    // --- Middle Ages
    T('three_field', 'Three-field system', 4, 'food', 75, ['crop_rotation'], 'A medieval farming rotation.', { yield: { farm: 1.2 } }),
    T('watermill', 'Watermill', 4, 'tools', 75, ['ironworking'], 'Mills grind grain and saw timber.', { work: { farming: 1.1 }, yield: { wood: 1.15 } }),
    T('universities', 'Universities', 4, 'know', 80, ['mathematics'], 'Scholars share knowledge across the land.', { kp: 0.25 }),
    T('castles', 'Castles', 4, 'defense', 80, ['fortification'], 'Stone keeps and armoured knights.', { ev: { raid: 0.7 }, work: { fighting: 1.15 } }),
    T('guilds', 'Craft guilds', 4, 'trade', 78, ['currency'], 'Guilds raise quality and merchants flock in.', { ev: { trader: 1.3 }, work: { smithing: 1.1, baking: 1.1 }, mood: 1 }),
    T('hospitals', 'Hospitals', 4, 'health', 80, ['herbalism', 'public_baths'], 'Monks tend the sick.', { ev: { plague: 0.65 }, work: { healing: 1.2 }, life: 3 }),
    T('printing', 'Printing press', 4, 'know', 82, ['universities'], 'Books spread ideas quickly.', { kp: 0.2, work: { teaching: 1.2 } }),
    // --- Industrial Age
    T('steam_power', 'Steam power', 5, 'tools', 110, ['watermill'], 'Engines do the heavy lifting.', { work: { all: 1.15 } }),
    T('fertilizer', 'Chemical fertilizer', 5, 'food', 105, ['three_field'], 'Fields stay fertile year after year.', { yield: { farm: 1.3 } }),
    T('germ_theory', 'Germ theory', 5, 'health', 115, ['hospitals', 'printing'], 'Disease is understood: epidemics are tamed.', { ev: { plague: 0.4, cholera: 0.4 }, life: 5 }),
    T('railways', 'Railways', 5, 'trade', 110, ['steam_power', 'currency'], 'Goods and people move fast.', { ev: { trader: 1.4, migrants: 1.3 }, yield: { wood: 1.15 } }),
    T('sewers', 'Sewers', 5, 'health', 100, ['public_baths', 'ironworking'], 'Waste is carried away: cholera nearly vanishes.', { ev: { cholera: 0.1 }, life: 3 }),
    // --- Modern Age
    T('electricity', 'Electricity', 6, 'tools', 150, ['steam_power'], 'Light and power: warm nights, better moods.', { heat: 0.6, work: { all: 1.1 }, mood: 2 }),
    T('mechanization', 'Mechanized farming', 6, 'food', 150, ['fertilizer', 'steam_power'], 'Tractors and harvesters.', { yield: { farm: 1.4 }, work: { farming: 1.2 } }),
    T('antibiotics', 'Antibiotics', 6, 'health', 150, ['germ_theory'], 'Infections are cured.', { ev: { plague: 0.2 }, life: 8, work: { healing: 1.2 } }),
    T('computers', 'Computers', 6, 'know', 165, ['electricity', 'printing'], 'Information at the speed of light.', { kp: 0.4, mood: 1 }),
  ];
  const BY_ID = {}; TECHS.forEach(t => { t.cost = Math.round(t.cost * COST_SCALE); BY_ID[t.id] = t; });
  // what is locked behind which technology
  const LOCK = { build: {}, job: {}, event: {} };
  for (const t of TECHS) for (const k of ['build', 'job', 'event']) for (const x of (t.fx.unlock && t.fx.unlock[k]) || []) LOCK[k][x] = t.id;
  // an era opens once this many of the previous era's technologies are known
  const NEED = ERAS.map((_, e) => Math.ceil(TECHS.filter(t => t.era === e).length * 0.65));
  // a few disasters are milder while the matching defence is unknown (the village is small and hasn't met them yet)
  const PRE_EV = { cholera: ['wells', 0.08], raid: ['watchtower', 0.6] };

  // ------------------------------------------------------------------ state & helpers
  const S = w => w.m.eras;
  const known = (w, id) => !!(S(w) && S(w).known[id]);
  const available = w => {
    const s = S(w); if (!s) return [];
    return TECHS.filter(t => !s.known[t.id] && t.era <= s.era && t.req.every(r => s.known[r]));
  };
  const knownIn = (w, e) => TECHS.filter(t => t.era === e && S(w).known[t.id]).length;

  function recompute(w) {
    const s = S(w), fx = { yield: {}, work: {}, heat: 1, ev: {}, kp: 0, life: 0, mood: 0 };
    const mul = (o, k, v) => { o[k] = (o[k] || 1) * v; };
    for (const t of TECHS) if (s.known[t.id]) {
      const f = t.fx;
      for (const k in f.yield || {}) mul(fx.yield, k, f.yield[k]);
      for (const k in f.work || {}) mul(fx.work, k, f.work[k]);
      for (const k in f.ev || {}) mul(fx.ev, k, f.ev[k]);
      if (f.heat) fx.heat *= f.heat;
      fx.kp += f.kp || 0; fx.life += f.life || 0; fx.mood += f.mood || 0;
    }
    s.fx = fx;
  }
  function kpRate(w) {
    const s = S(w), pop = w.agents.length;
    const teachers = w.agents.filter(a => a.job === 'teacher').length;
    const base = 0.8 + 0.18 * pop + 0.5 * teachers + (w.sOf('school').length ? 1 : 0);
    return base * (1 + s.fx.kp);
  }
  // cheapest available technology, unless the player picked one
  function target(w) {
    const s = S(w), av = available(w);
    if (s.focus && av.some(t => t.id === s.focus)) return BY_ID[s.focus];
    return av.slice().sort((a, b) => a.cost - b.cost)[0] || null;
  }
  function learn(w, t) {
    const s = S(w);
    s.known[t.id] = w.day + 1; s.count++;
    if (s.focus === t.id) s.focus = null;
    const before = s.fx.life; recompute(w);
    const dl = s.fx.life - before; if (dl) for (const a of w.agents) a.lifespan += dl;
    w.log(`Discovery: ${t.name}. ${t.desc}`, 'good');
    // new era?
    while (s.era < ERAS.length - 1 && knownIn(w, s.era) >= NEED[s.era]) {
      s.era++; s.eraDay = w.day; s.eraStarts.push(w.day);
      w.log(`A new era begins: the ${ERAS[s.era].name} - ${ERAS[s.era].sub}. Villagers now live in ${ERAS[s.era].home}.`, 'mile');
    }
  }

  api.eras = { ERAS, TECHS, AREAS, state: S, has: known, available, rate: kpRate, current: w => (S(w) ? ERAS[S(w).era] : null) };
  // colours for house renderers (null when eras are off)
  api.eraLook = w => (on(w) && S(w) ? ERAS[S(w).era].look : null);

  // ------------------------------------------------------------------ hooks
  api.mods.push({
    init(w) {
      if (!on(w)) return;
      w.m.eras = { era: 0, known: {}, count: 0, pool: 0, focus: null, fx: null, eraDay: -1, eraStarts: [0], rate: 0 };
      for (const t of TECHS) if (t.start) { S(w).known[t.id] = 1; S(w).count++; }
      recompute(w);
      w.log('The settlers live as hunter-gatherers in cave shelters: the Stone Age.', 'info');
    },
    spawn(w, a) { if (S(w)) a.lifespan += S(w).fx.life; },
    // --- locks
    lockedBuild(w, nd) { const t = LOCK.build[nd.kind]; return !!(t && S(w) && !S(w).known[t]); },
    lockedJob(w, j) { const t = LOCK.job[j]; return !!(t && S(w) && !S(w).known[t]); },
    // --- multipliers
    yieldMult(w, a, kind) { return S(w) ? (S(w).fx.yield[kind] || 1) : 1; },
    workMult(w, a, k) { if (!S(w)) return 1; const f = S(w).fx.work; return (f.all || 1) * (f[k] || 1); },
    heatCost(w) { return S(w) ? S(w).fx.heat : 1; },
    eventMult(w, e) {
      const s = S(w); if (!s) return 1;
      if (LOCK.event[e.id] && !s.known[LOCK.event[e.id]]) return 0;
      let m = s.fx.ev[e.id] || 1;
      const p = PRE_EV[e.id]; if (p && !s.known[p[0]]) m *= p[1];
      return m;
    },
    // --- research
    day(w) {
      const s = S(w); if (!s) return;
      if (s.fx.mood) for (const a of w.agents) a.mood = Math.min(100, a.mood + 0.35 * s.fx.mood);
      s.rate = kpRate(w);
      if (s.count >= TECHS.length) return;
      s.pool += s.rate;
      for (let guard = 0; guard < 4; guard++) {
        const t = target(w);
        if (!t || s.pool < t.cost) break;
        s.pool -= t.cost; learn(w, t);
      }
    },
  });

  // ------------------------------------------------------------------ UI
  api.actions.research = (w, id) => {
    const s = S(w); if (!s) return;
    if (available(w).some(t => t.id === id)) s.focus = id;
  };
  api.actions.researchAuto = w => { if (S(w)) S(w).focus = null; };
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  const COL = { known: '#8fd18a', open: '#f1d36a', locked: '#59616d' };
  function treeHtml(w) {
    const s = S(w);
    const rows = ERAS.map((E, e) => {
      const ts = TECHS.filter(t => t.era === e);
      const head = `<div style="margin:10px 0 3px;color:${e <= s.era ? '#dfe4ea' : '#59616d'}"><b>${E.name}</b> <span class="muted">${E.sub} - ${E.home}</span>` +
        (e < ERAS.length - 1 ? ` <span class="muted">(${Math.min(NEED[e], knownIn(w, e))}/${NEED[e]} techs open the next era)</span>` : '') + '</div>';
      const items = ts.map(t => {
        const st = s.known[t.id] != null ? 'known' : (e <= s.era && t.req.every(r => s.known[r])) ? 'open' : 'locked';
        const need = t.req.filter(r => !s.known[r]).map(r => BY_ID[r].name);
        return `<div style="color:${COL[st]};padding:1px 0 1px 10px"><b>${t.name}</b> <span class="muted">[${AREAS[t.area]}${t.cost ? ', ' + t.cost + ' KP' : ''}]</span> - ${t.desc}` +
          (st === 'locked' && need.length ? ` <span class="muted">needs ${need.join(', ')}</span>` : '') + '</div>';
      }).join('');
      return head + items;
    }).join('');
    return `<h2>Technology - ${s.count}/${TECHS.length} discovered</h2>` +
      `<div class="muted" style="margin-bottom:4px"><span style="color:${COL.known}">discovered</span> - <span style="color:${COL.open}">can be researched</span> - <span style="color:${COL.locked}">locked</span></div>` +
      `<div class="tl" style="max-height:520px;min-width:560px">${rows}</div>`;
  }
  api.actions.showTech = (w, _, ui) => { if (S(w)) ui.modal(treeHtml(w)); };

  api.panels.push({
    id: 'eras', title: 'Civilization',
    html(w) {
      const s = S(w); if (!s) return null;
      const E = ERAS[s.era], next = ERAS[s.era + 1];
      const t = target(w), av = available(w);
      let html = `<div class="sub"><b>${E.name}</b> - ${E.sub}</div><div class="sub">Homes: ${E.home}</div>`;
      if (next) html += `<div class="sub">${next.name}: ${Math.min(NEED[s.era], knownIn(w, s.era))}/${NEED[s.era]} techs of this era</div>` +
        `<div class="bar"><div style="width:${Math.min(100, 100 * knownIn(w, s.era) / NEED[s.era]).toFixed(0)}%;background:#9a7de0"></div></div>`;
      if (t) html += `<div class="sub">Researching <b>${t.name}</b> ${s.pool.toFixed(0)}/${t.cost} KP (+${s.rate.toFixed(1)}/day)${s.focus === t.id ? '' : ' - auto'}</div>` +
        `<div class="bar"><div style="width:${Math.min(100, 100 * s.pool / t.cost).toFixed(0)}%;background:#6cc6ff"></div></div>`;
      else html += '<div class="sub">All technologies discovered.</div>';
      html += `<div class="btns">${av.slice().sort((a, b) => a.cost - b.cost).slice(0, 8).map(x =>
        `<button class="sm${t && t.id === x.id ? ' on' : ''}" title="${x.desc.replace(/"/g, '')}" data-act="research" data-arg="${x.id}">${x.name} (${x.cost})</button>`).join('')}</div>`;
      html += `<div class="btns"><button class="sm${s.focus ? '' : ' on'}" data-act="researchAuto">Auto</button><button class="sm" data-act="showTech">Tech tree</button></div>`;
      return html;
    },
  });
  api.hud.push({ id: 'era', label: 'Era', get: w => (S(w) ? ERAS[S(w).era].name : '-') });
  api.hud.push({ id: 'tech', label: 'Tech', get: w => (S(w) ? S(w).count + '/' + TECHS.length : '-') });
  api.alerts.push(w => (S(w) && S(w).eraDay >= 0 && w.day - S(w).eraDay < 2) ? `A new era: the ${ERAS[S(w).era].name}!` : null);
})();
