/* civilization.js — buildings that represent societal progress.
   Adds: castle (medieval+), university (iron+), hospital (medieval+), library (bronze+).
   Each building:
     - has a realistic need condition (population, era-lock, existing building checks)
     - provides concrete simulation bonuses (faster research, better healing, defense, KP)
     - has a 2D sprite and a 3D model registered in API.models3d
     - is era-locked behind the appropriate technology in eras.js
   Load order: after eras.js and buildings3d.js. */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { mv } = api.util;
  const T3 = typeof window !== 'undefined' && window.THREE;
  const ADULT_AGE = api.ADULT_AGE;

  const has = (w, kind) => w.sOf(kind).length > 0;
  const count = (w, kind) => w.sOf(kind).length;
  const known = (w, id) => !!(api.eras && api.eras.has && api.eras.has(w, id));
  const eraIdx = w => { const s = api.eras && api.eras.state && api.eras.state(w); return s ? s.era : 0; };

  // ------------------------------------------------------------------ LIBRARY  (Bronze Age+, writing tech)
  // A single library: helps research, boosts teaching, gives mild mood boost.
  // Unlocked by 'writing' tech (same era as school) — complements the school.
  api.needs.push(w => {
    if (!known(w, 'writing')) return null;
    if (w.agents.length < 18 || w.day < 30) return null;
    if (has(w, 'library') || w.sites.some(s => s.for === 'library')) return null;
    return { kind: 'library', cost: 28, ticks: 110, label: 'building a library' };
  });

  // Library effect: daily KP bonus proportional to teachers + books
  api.mods.push({
    init(w) { w.m.lib = { visits: 0 }; },
    day(w) {
      const libs = count(w, 'library');
      if (!libs) return;
      const s = api.eras && api.eras.state && api.eras.state(w);
      if (s) s.pool += libs * 1.8;   // extra KP per day from library
      // mood micro-boost for scholars
      const scholars = w.agents.filter(a => a.job === 'teacher' || a.job === 'doctor');
      for (const a of scholars) a.mood = Math.min(100, a.mood + 0.3);
    },
    built(w, s) { if (s.kind === 'library') w.log('A library opens — knowledge will accumulate faster.', 'good'); },
  });

  // ------------------------------------------------------------------ UNIVERSITY  (Iron Age+, mathematics tech)
  // Requires mathematics; much larger KP bonus + unlocks a scholar job.
  api.needs.push(w => {
    if (!known(w, 'mathematics')) return null;
    if (w.agents.length < 28 || w.day < 60) return null;
    if (has(w, 'university') || w.sites.some(s => s.for === 'university')) return null;
    // Need a library or school first — you can't skip straight to a university
    if (!has(w, 'library') && !has(w, 'school')) return null;
    return { kind: 'university', cost: 40, ticks: 160, label: 'building a university' };
  });

  api.mods.push({
    init(w) { w.m.uni = { graduates: 0 }; },
    day(w) {
      const unis = count(w, 'university');
      if (!unis) return;
      const s = api.eras && api.eras.state && api.eras.state(w);
      if (s) s.pool += unis * 5.5;   // larger KP bonus than library
      // all adults gain tiny skill increments from the university environment
      if (w.day % 3 === 0) {
        const skills = ['farming', 'building', 'fishing', 'woodcutting'];
        for (const a of w.agents) {
          if (a.age < ADULT_AGE) continue;
          const sk = skills[a.id % skills.length];
          if ((a.skills[sk] || 0) < 40) a.skills[sk] = (a.skills[sk] || 0) + 0.12;
        }
      }
    },
    built(w, s) { if (s.kind === 'university') w.log('A university stands — scholars flock to study and teach.', 'good'); },
  });

  // University job: scholar (researches faster)
  api.jobs.scholar = {
    color: '#6c9cd0', group: 'edu', skill: 'teaching',
    weight: (w) => has(w, 'university') ? 0.12 : 0,
    cap: (w, c) => has(w, 'university') ? Math.floor(c.N / 14) : 0,
    plan(w, a) {
      const u = w.sOf('university')[0];
      if (!u) return null;
      return {
        steps: [mv(u.x, u.y, 'heading to the university'), {
          t: 'work', ticks: 80, label: 'researching at the university',
          done: a2 => {
            const s = api.eras && api.eras.state && api.eras.state(w);
            if (s) s.pool += 4 + w.skillLv(a2, 'teaching') * 0.4;
            w.gain(a2, 'teaching', 1.2);
            w.m.uni.graduates++;
          }
        }], claims: [], kind: 'work'
      };
    },
  };

  // ------------------------------------------------------------------ HOSPITAL  (Medieval+, hospitals tech)
  // Requires hospitals tech; much better healing rates than doctors alone.
  api.needs.push(w => {
    if (!known(w, 'hospitals')) return null;
    if (w.agents.length < 30 || w.day < 80) return null;
    if (has(w, 'hospital') || w.sites.some(s => s.for === 'hospital')) return null;
    return { kind: 'hospital', cost: 35, ticks: 150, label: 'building a hospital' };
  });

  // Hospital healing boost: doctors working here heal faster; also auto-reduces sickness
  api.mods.push({
    init(w) { w.m.hosp = { cured: 0 }; },
    day(w) {
      if (!has(w, 'hospital')) return;
      // Hospital passively reduces sick duration each day
      for (const a of w.agents) {
        if (a.sick > 0) { a.sick = Math.max(0, a.sick - 0.35); if (!a.sick) { a.sickKind = null; w.m.hosp.cured++; } }
        if (a.injury > 0) a.injury = Math.max(0, a.injury - 2.5);
        a.health = Math.min(100, a.health + 0.4);
      }
    },
    built(w, s) { if (s.kind === 'hospital') w.log('A hospital opens — the sick recover faster and injuries heal.', 'good'); },
  });

  // ------------------------------------------------------------------ CASTLE  (Medieval+, castles tech)
  // Requires castles tech + a watchtower already built. Much stronger defense.
  // A castle upgrades the defense: counts as tower × 4 and raises max wall level.
  api.needs.push(w => {
    if (!known(w, 'castles')) return null;
    if (w.agents.length < 36 || w.day < 100) return null;
    if (has(w, 'castle') || w.sites.some(s => s.for === 'castle')) return null;
    if (!has(w, 'tower')) return null;   // need watchtower before castle
    return { kind: 'castle', cost: 60, ticks: 220, label: 'building a castle' };
  });

  api.mods.push({
    init(w) { w.m.castle = { built: false }; },
    built(w, s) {
      if (s.kind !== 'castle') return;
      w.m.castle.built = true;
      // Castle wall level caps higher — allow one more palisade upgrade
      if (w.m.def) w.m.def.wallCap = (w.m.def.wallCap || 3) + 2;
      w.log('A mighty castle rises — the village is now a fortified settlement!', 'mile');
    },
    // castle counts as extra defense strength (applied via fightMult)
    fightMult(w) { return has(w, 'castle') ? 2.2 : 1; },
  });

  // ------------------------------------------------------------------ SECOND SCHOOL
  // Once population exceeds 40 and first school is saturated, build a second.
  api.needs.push(w => {
    if (!known(w, 'writing')) return null;
    if (w.agents.length < 44 || w.day < 60) return null;
    const schools = count(w, 'school');
    if (schools >= 2) return null;
    if (schools === 0) return null;   // first school comes from jobs.js
    if (w.sites.some(s => s.for === 'school')) return null;
    const kids = w.agents.filter(k => k.age < ADULT_AGE && k.age >= 4).length;
    return kids > schools * 12 ? { kind: 'school', cost: 25, ticks: 120, label: 'building a second school' } : null;
  });

  // ------------------------------------------------------------------ 2D SPRITES
  api.sprites.library = (G, s) => {
    const { ctx, ts } = G, x = G.gx(s.x), y = G.gy(s.y);
    // base
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + ts * 0.05, y + ts * 0.84, ts * 0.95, ts * 0.12);
    ctx.fillStyle = '#c4b898'; ctx.fillRect(x + ts * 0.08, y + ts * 0.36, ts * 0.84, ts * 0.5);
    // roof
    ctx.fillStyle = '#7a5aa8';
    ctx.beginPath(); ctx.moveTo(x + ts * 0.04, y + ts * 0.38); ctx.lineTo(x + ts * 0.5, y + ts * 0.04); ctx.lineTo(x + ts * 0.96, y + ts * 0.38); ctx.fill();
    // columns
    ctx.fillStyle = '#e0d4b8';
    for (const cx of [0.22, 0.38, 0.54, 0.7]) ctx.fillRect(x + ts * cx, y + ts * 0.42, ts * 0.06, ts * 0.42);
    // door + scroll icon
    ctx.fillStyle = '#3b2f22'; ctx.fillRect(x + ts * 0.42, y + ts * 0.6, ts * 0.16, ts * 0.26);
    ctx.fillStyle = '#f5ecd0'; ctx.fillRect(x + ts * 0.55, y + ts * 0.5, ts * 0.28, ts * 0.12);
  };

  api.sprites.university = (G, s) => {
    const { ctx, ts } = G, x = G.gx(s.x), y = G.gy(s.y);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + ts * 0.04, y + ts * 0.84, ts * 0.96, ts * 0.12);
    // main hall
    ctx.fillStyle = '#d4c8b4'; ctx.fillRect(x + ts * 0.06, y + ts * 0.32, ts * 0.88, ts * 0.54);
    // large gable
    ctx.fillStyle = '#8a7aa8';
    ctx.beginPath(); ctx.moveTo(x, y + ts * 0.34); ctx.lineTo(x + ts * 0.5, y - ts * 0.06); ctx.lineTo(x + ts, y + ts * 0.34); ctx.fill();
    // bell tower on right
    ctx.fillStyle = '#bcb4a0'; ctx.fillRect(x + ts * 0.72, y + ts * 0.08, ts * 0.22, ts * 0.56);
    ctx.fillStyle = '#8a7aa8';
    ctx.beginPath(); ctx.moveTo(x + ts * 0.72, y + ts * 0.1); ctx.lineTo(x + ts * 0.83, y - ts * 0.1); ctx.lineTo(x + ts * 0.94, y + ts * 0.1); ctx.fill();
    // windows
    ctx.fillStyle = '#7fc4ee';
    for (const cx of [0.18, 0.36, 0.54]) ctx.fillRect(x + ts * cx, y + ts * 0.44, ts * 0.12, ts * 0.16);
    ctx.fillStyle = '#3b2f22'; ctx.fillRect(x + ts * 0.38, y + ts * 0.62, ts * 0.14, ts * 0.24);
  };

  api.sprites.hospital = (G, s) => {
    const { ctx, ts } = G, x = G.gx(s.x), y = G.gy(s.y);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + ts * 0.05, y + ts * 0.84, ts * 0.95, ts * 0.12);
    ctx.fillStyle = '#f0ebe0'; ctx.fillRect(x + ts * 0.1, y + ts * 0.3, ts * 0.8, ts * 0.56);
    ctx.fillStyle = '#c83a3a';
    ctx.beginPath(); ctx.moveTo(x + ts * 0.06, y + ts * 0.32); ctx.lineTo(x + ts * 0.5, y + ts * 0.02); ctx.lineTo(x + ts * 0.94, y + ts * 0.32); ctx.fill();
    // red cross
    ctx.fillStyle = '#e83a3a';
    ctx.fillRect(x + ts * 0.42, y + ts * 0.46, ts * 0.16, ts * 0.26);
    ctx.fillRect(x + ts * 0.34, y + ts * 0.54, ts * 0.32, ts * 0.1);
    ctx.fillStyle = '#3b2f22'; ctx.fillRect(x + ts * 0.44, y + ts * 0.64, ts * 0.12, ts * 0.22);
    ctx.fillStyle = '#7fc4ee'; ctx.fillRect(x + ts * 0.16, y + ts * 0.5, ts * 0.16, ts * 0.14); ctx.fillRect(x + ts * 0.68, y + ts * 0.5, ts * 0.16, ts * 0.14);
  };

  api.sprites.castle = (G, s) => {
    const { ctx, ts } = G, x = G.gx(s.x), y = G.gy(s.y);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x + ts * 0.04, y + ts * 0.86, ts * 0.96, ts * 0.1);
    // keep body
    ctx.fillStyle = '#8a8480'; ctx.fillRect(x + ts * 0.2, y + ts * 0.12, ts * 0.6, ts * 0.74);
    // battlements
    ctx.fillStyle = '#77726c';
    for (let i = 0; i < 5; i++) ctx.fillRect(x + ts * (0.22 + i * 0.14), y + ts * 0.06, ts * 0.1, ts * 0.12);
    // towers on sides
    ctx.fillStyle = '#9a9490'; ctx.fillRect(x + ts * 0.06, y + ts * 0.2, ts * 0.2, ts * 0.66); ctx.fillRect(x + ts * 0.74, y + ts * 0.2, ts * 0.2, ts * 0.66);
    // battlements on towers
    ctx.fillStyle = '#77726c';
    for (const [bx, n] of [[0.08, 2], [0.76, 2]]) for (let i = 0; i < n; i++) ctx.fillRect(x + ts * (bx + i * 0.1), y + ts * 0.14, ts * 0.08, ts * 0.1);
    // gate arch
    ctx.fillStyle = '#2a2220'; ctx.fillRect(x + ts * 0.4, y + ts * 0.56, ts * 0.2, ts * 0.3);
    ctx.beginPath(); ctx.arc(x + ts * 0.5, y + ts * 0.57, ts * 0.1, Math.PI, 0); ctx.fillStyle = '#2a2220'; ctx.fill();
    // flag
    const fl = 0.6 + 0.4 * Math.sin(G.time / 280 + s.x);
    ctx.fillStyle = '#c0392b'; ctx.fillRect(x + ts * 0.5, y - ts * 0.12, ts * 0.03, ts * 0.24); ctx.fillRect(x + ts * 0.53, y - ts * 0.12, ts * 0.16 * fl, ts * 0.1);
  };

  // ------------------------------------------------------------------ HUD alerts
  api.alerts.push(w => {
    if (!has(w, 'university') && known(w, 'mathematics') && w.agents.length >= 28 && !w.sites.some(s => s.for === 'university'))
      return 'Ready to build a university — assign builders!';
    return null;
  });
  api.alerts.push(w => {
    if (!has(w, 'castle') && known(w, 'castles') && w.agents.length >= 36 && !w.sites.some(s => s.for === 'castle'))
      return 'Ready to build a castle — this will greatly strengthen your defense!';
    return null;
  });

  // ------------------------------------------------------------------ 3D models (Three.js, browser only)
  if (typeof window !== 'undefined' && window.SmallWorld && window.SmallWorld.models3d && window.THREE) {
    const M = window.SmallWorld.models3d, T = window.THREE;
    const mats3 = {};
    const m3 = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return mats3[k] || (mats3[k] = new T.MeshLambertMaterial(Object.assign({ color: c }, o))); };
    const bm = (c) => mats3['b' + c] || (mats3['b' + c] = new T.MeshBasicMaterial({ color: c }));
    const G3 = { box: new T.BoxGeometry(1, 1, 1), cone4: new T.ConeGeometry(1, 1, 4), cyl: new T.CylinderGeometry(1, 1, 1, 8), gable: (() => { const s = new T.Shape(); s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath(); return new T.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5); })() };
    const p3 = (par, geo, mat, x, y, z, sx, sy, sz) => { const o = new T.Mesh(geo, mat); o.position.set(x, y, z); o.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz); o.castShadow = true; o.receiveShadow = true; par.add(o); return o; };
    const b3 = (par, w, h, d, c, x, y, z) => p3(par, G3.box, m3(c), x, y, z, w, h, d);

    M.library = () => {
      const g = new T.Group();
      b3(g, 1.0, 0.48, 0.8, 0xc4b898, 0, 0.24, 0);
      b3(g, 1.06, 0.06, 0.86, 0xa89878, 0, 0.02, 0);
      const r = p3(g, G3.gable, m3(0x7a5aa8), 0, 0.48, 0, 1.1, 0.44, 0.94); r.rotation.y = 0;
      for (const x of [-0.34, -0.12, 0.12, 0.34]) b3(g, 0.06, 0.46, 0.06, 0xe0d4b8, x, 0.26, 0.41);
      b3(g, 0.16, 0.28, 0.04, 0x3b2f22, 0, 0.14, 0.41);
      b3(g, 0.3, 0.1, 0.04, 0xf5ecd0, 0.36, 0.36, 0.41).rotation.z = 0.2;
      return { obj: g };
    };

    M.university = () => {
      const g = new T.Group();
      b3(g, 1.1, 0.58, 0.86, 0xd4c8b4, 0, 0.29, 0);
      b3(g, 1.14, 0.06, 0.9, 0xbcb4a0, 0, 0.02, 0);
      p3(g, G3.gable, m3(0x8a7aa8), 0, 0.58, 0, 1.18, 0.52, 0.94).rotation.y = 0;
      // bell tower
      b3(g, 0.24, 1.0, 0.24, 0xbcb4a0, 0.4, 0.5, -0.22);
      p3(g, G3.cone4, m3(0x8a7aa8), 0.4, 1.12, -0.22, 0.16, 0.28, 0.16).rotation.y = Math.PI / 4;
      for (const x of [-0.28, 0, 0.28]) b3(g, 0.14, 0.16, 0.04, 0x7fc4ee, x, 0.38, 0.44);
      b3(g, 0.16, 0.3, 0.04, 0x3b2f22, 0, 0.15, 0.44);
      b3(g, 0.06, 0.06, 0.06, 0xe0b858, 0.4, 0.82, -0.22);
      return { obj: g };
    };

    M.hospital = () => {
      const g = new T.Group();
      b3(g, 1.0, 0.52, 0.84, 0xf0ebe0, 0, 0.26, 0);
      b3(g, 1.06, 0.06, 0.9, 0xd4cec4, 0, 0.02, 0);
      p3(g, G3.gable, m3(0xc83a3a), 0, 0.52, 0, 1.08, 0.42, 0.9).rotation.y = 0;
      // red cross on front
      b3(g, 0.08, 0.3, 0.04, 0xe83a3a, 0, 0.34, 0.43);
      b3(g, 0.3, 0.08, 0.04, 0xe83a3a, 0, 0.34, 0.43);
      for (const x of [-0.28, 0.28]) b3(g, 0.14, 0.16, 0.04, 0x7fc4ee, x, 0.34, 0.43);
      b3(g, 0.16, 0.28, 0.04, 0x3b2f22, 0, 0.13, 0.43);
      return { obj: g };
    };

    M.castle = () => {
      const g = new T.Group();
      // keep
      b3(g, 0.72, 1.4, 0.72, 0x8a8480, 0, 0.7, 0);
      b3(g, 0.84, 0.1, 0.84, 0x77726c, 0, 1.43, 0);
      // battlements
      for (let i = 0; i < 5; i++) for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const k = -0.32 + i * 0.16;
        b3(g, 0.1, 0.18, 0.1, 0x77726c, dx ? dx * 0.38 : k, 1.56, dz ? dz * 0.38 : k);
      }
      // corner towers
      for (const [cx, cz] of [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]]) {
        b3(g, 0.22, 1.56, 0.22, 0x9a9490, cx, 0.78, cz);
        for (let i = 0; i < 3; i++) b3(g, 0.1, 0.14, 0.1, 0x77726c, cx + (i < 2 ? (i === 0 ? -0.06 : 0.06) : 0), 1.62, cz + (i === 2 ? 0 : 0));
      }
      // gate
      b3(g, 0.22, 0.4, 0.04, 0x2a2220, 0, 0.2, 0.37);
      p3(g, G3.cyl, m3(0x2a2220), 0, 0.42, 0.37, 0.11, 0.12, 0.05);
      // flag
      b3(g, 0.03, 0.5, 0.03, 0x6a5a3a, 0, 1.72, 0);
      const f = b3(g, 0.22, 0.12, 0.02, 0xc0392b, 0.14, 1.88, 0);
      return { obj: g, upd: t => { f.rotation.y = Math.sin(t / 280) * 0.35; } };
    };
  }
})();
