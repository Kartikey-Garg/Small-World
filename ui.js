/* Small World - UI / renderer */
(function () {
  'use strict';
  const API = window.SmallWorld;
  const { World, DAY, W, H, SEASON_DAYS, YEAR } = API;
  const $ = id => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d');
  const chart = $('chart'), cctx = chart.getContext('2d');

  const jobCol = j => (API.jobs[j] && API.jobs[j].color) || API.jobColors[j] || '#999';
  const JOB_COL = new Proxy({}, { get: (_, j) => jobCol(j) });
  // helper bundle handed to mod drawing code
  const G = {
    ctx, get ts() { return ts; }, gx: x => gx(x), gy: y => gy(y), hash: (x, y) => hash(x, y),
    get world() { return world; }, get night() { return darkness(); }, get season() { return world.season; },
    get time() { return performance.now(); },
  };
  const SKIN = ['#f3d2b3', '#e2b48b', '#c68c62', '#8d5a3b'];
  const HAIR = ['#2b1d12', '#5a3a1e', '#a06a2c', '#d8b25a', '#7d7d7d'];
  const GRASS = { Spring: [96, 158, 74], Summer: [104, 168, 78], Autumn: [162, 142, 72], Winter: [226, 234, 240] };

  let world, speed = 1, paused = false, selId = null, hoverId = null, mouse = null;
  let acc = 0, last = performance.now(), ts = 20, ox = 0, oy = 0, dpr = 1;
  let best = +(localStorage.getItem('smallworld.best') || 0);
  let overShown = false, lastListAt = 0, lastLogKey = '';

  function newWorld() {
    world = new World({});
    selId = null; overShown = false; lastLogKey = '';
    $('over').classList.add('hidden');
    $('banner').style.display = 'none';
    renderLog(true);
  }

  // ------------------------------------------------------------------ layout
  function resize() {
    const r = $('stage').getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    ts = Math.max(8, Math.floor(Math.min(r.width / W, r.height / H) * 100) / 100);
    ox = (r.width - ts * W) / 2; oy = (r.height - ts * H) / 2;
  }
  window.addEventListener('resize', resize);

  // ------------------------------------------------------------------ helpers
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const rgb = (c, d) => `rgb(${Math.max(0, Math.min(255, c[0] + d))},${Math.max(0, Math.min(255, c[1] + d))},${Math.max(0, Math.min(255, c[2] + d))})`;
  const gx = x => ox + x * ts, gy = y => oy + y * ts;
  function darkness() {
    const f = world.dayFrac;
    if (f >= 0.7) return Math.min(1, (f - 0.7) / 0.08);
    return Math.max(0, Math.min(1, (0.12 - f) / 0.08));
  }
  const hourStr = () => {
    const h = (world.dayFrac * 24 + 3.6) % 24;
    return String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0');
  };
  function agentPos(a, alpha) {
    return { x: a.px + (a.x - a.px) * alpha, y: a.py + (a.y - a.py) * alpha };
  }

  // ------------------------------------------------------------------ drawing
  // era index: 0=stone,1=neo,2=bronze,3=iron,4=medieval,5=industrial,6=modern
  function eraIdx() {
    const s = API.eras && world && API.eras.state(world);
    return s ? s.era : 0;
  }

  function drawTerrain(season, time) {
    const g = GRASS[season];
    const ei = eraIdx();
    // How detailed the terrain looks grows with era (0=crude blocky, 6=smooth rich)
    // detail: 0-1 drives number of sub-tile passes
    const detail = ei / 6;                 // 0..1
    const winter = season === 'Winter';

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const px = gx(x), py = gy(y);
      const t = world.terrain[y * W + x];

      if (t >= 1) {
        // Water / flood
        const flood = t === 2;
        ctx.fillStyle = flood
          ? (winter ? '#b5d3e2' : '#5b95c4')
          : (winter ? '#9cc3d9' : '#3f7fb8');
        ctx.fillRect(px, py, ts + 0.5, ts + 0.5);
        if (!winter && detail > 0.1) {
          // Early eras: a simple static ripple line; later: animated sinusoidal glints
          const ph = time * (0.0006 + detail * 0.001) + hash(x, y) * 6.28;
          ctx.strokeStyle = `rgba(255,255,255,${(0.1 + detail * 0.18).toFixed(2)})`; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px + ts * 0.18, py + ts * (0.5 + Math.sin(ph) * (0.06 + detail * 0.08)));
          ctx.lineTo(px + ts * 0.82, py + ts * (0.5 + Math.sin(ph + 1.2) * (0.06 + detail * 0.08)));
          ctx.stroke();
          if (detail > 0.55) {        // iron age+: second ripple
            ctx.beginPath();
            ctx.moveTo(px + ts * 0.28, py + ts * (0.65 + Math.sin(ph + 2) * 0.06));
            ctx.lineTo(px + ts * 0.72, py + ts * (0.65 + Math.sin(ph + 3.1) * 0.06));
            ctx.stroke();
          }
        }
      } else {
        // Land tile — base colour with era-progressive variation
        const nv = Math.floor((hash(x, y) - 0.5) * 14);
        ctx.fillStyle = rgb(g, nv);
        ctx.fillRect(px, py, ts + 0.5, ts + 0.5);

        if (!winter) {
          // Stone age: no detail (flat pixelated map)
          if (ei === 0) {
            // sparse dark dot only every ~14 tiles — very crude look
            if (hash(y + 3, x + 7) < 0.06) {
              ctx.fillStyle = 'rgba(0,0,0,.12)';
              ctx.fillRect(px + ts * 0.3, py + ts * 0.3, ts * 0.4, ts * 0.4);
            }
          } else if (ei === 1) {
            // Neolithic: slightly more dirt patches, still blocky
            if (hash(y, x) < 0.14) {
              ctx.fillStyle = 'rgba(0,0,0,.08)';
              ctx.fillRect(px + ts * hash(x + 1, y) * 0.7, py + ts * hash(x, y + 1) * 0.7, ts * 0.1, ts * 0.22);
            }
          } else if (ei <= 3) {
            // Bronze–Iron: scattered grass tufts, small stones
            if (hash(y, x) < 0.16) {
              ctx.fillStyle = `rgba(0,0,0,${(0.07 + detail * 0.06).toFixed(2)})`;
              ctx.fillRect(px + ts * hash(x + 1, y) * 0.65, py + ts * hash(x, y + 1) * 0.65, ts * 0.08, ts * 0.2);
            }
            if (hash(x + 5, y + 3) < 0.08) {   // occasional stone
              ctx.fillStyle = 'rgba(120,115,105,.28)';
              const sx = px + ts * (0.15 + hash(x, y + 4) * 0.6), sy = py + ts * (0.2 + hash(x + 2, y) * 0.55);
              ctx.beginPath(); ctx.ellipse(sx, sy, ts * 0.1, ts * 0.07, 0, 0, 7); ctx.fill();
            }
          } else if (ei === 4) {
            // Medieval: rich grass variation, worn dirt paths
            const t2 = time * 0.00004 + hash(x, y);
            ctx.fillStyle = `rgba(${40 + (hash(x + 7, y) * 28) | 0},${60 + (hash(x, y + 5) * 22) | 0},0,0.09)`;
            ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
            if (hash(y + 1, x) < 0.11) {   // dirt path suggestion
              ctx.fillStyle = 'rgba(80,60,30,.15)';
              ctx.fillRect(px + ts * 0.2, py + ts * 0.35, ts * 0.6, ts * 0.3);
            }
          } else if (ei === 5) {
            // Industrial: paved edges, soot tinge, slightly darker variation
            const gv = nv - 8;
            ctx.fillStyle = `rgb(${Math.max(0, g[0] + gv - 6)},${Math.max(0, g[1] + gv)},${Math.max(0, g[2] + gv - 4)})`;
            ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
            if (hash(x + 9, y + 2) < 0.07) {   // cobblestone edge hints
              ctx.fillStyle = 'rgba(80,75,68,.22)';
              ctx.fillRect(px, py + ts - 2, ts, 2);
              ctx.fillRect(px + ts - 2, py, 2, ts);
            }
          } else {
            // Modern: clean smooth-looking tiles, subtle green variation + thin grid
            ctx.fillStyle = rgb(g, nv + 4);
            ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
            if (ts > 14) {   // only draw grid lines when tiles are big enough to see them
              ctx.strokeStyle = 'rgba(0,0,0,.04)'; ctx.lineWidth = 0.5;
              ctx.strokeRect(px + 0.5, py + 0.5, ts, ts);
            }
          }
        } else {
          // Winter snow — era-progressive: early=uniform, late=footpaths visible
          if (ei >= 4 && hash(y + 2, x + 1) < 0.08) {
            ctx.fillStyle = 'rgba(180,170,155,.35)';  // worn snow / dirt track
            ctx.fillRect(px + ts * 0.15, py + ts * 0.3, ts * 0.7, ts * 0.4);
          }
        }
      }
    }
  }

  function drawTree(t, season) {
    const cx = gx(t.x + 0.5), by = gy(t.y + 0.92);
    if (t.wood <= 0) {
      ctx.fillStyle = '#6b4a2a'; ctx.fillRect(cx - ts * 0.12, by - ts * 0.18, ts * 0.24, ts * 0.18); return;
    }
    const s = 0.8 + t.v * 0.1 + t.wood * 0.03;
    ctx.fillStyle = '#5c3d22'; ctx.fillRect(cx - ts * 0.07, by - ts * 0.3, ts * 0.14, ts * 0.3);
    const col = season === 'Winter' ? ['#e7eff2', '#c8d8dc'] : season === 'Autumn' ? ['#c97a2b', '#a85f1f'] : ['#3f8a3a', '#2f6e2d'];
    ctx.fillStyle = col[1];
    ctx.beginPath(); ctx.arc(cx, by - ts * 0.55 * s, ts * 0.34 * s, 0, 7); ctx.fill();
    ctx.fillStyle = col[0];
    ctx.beginPath(); ctx.arc(cx - ts * 0.05, by - ts * 0.62 * s, ts * 0.27 * s, 0, 7); ctx.fill();
  }

  function drawBush(b, season) {
    const cx = gx(b.x + 0.5), cy = gy(b.y + 0.62);
    ctx.fillStyle = season === 'Winter' ? '#cfdde0' : '#2f7a3a';
    ctx.beginPath(); ctx.arc(cx, cy, ts * 0.3, 0, 7); ctx.fill();
    ctx.fillStyle = '#d6384a';
    for (let i = 0; i < b.food; i++) {
      ctx.beginPath(); ctx.arc(cx + (i - 1) * ts * 0.15, cy - ts * 0.04 + (i % 2) * ts * 0.1, ts * 0.06, 0, 7); ctx.fill();
    }
  }

  function drawPlot(p, season) {
    const x = gx(p.x), y = gy(p.y);
    const f = Math.max(0, Math.min(1, ((p.fert == null ? 1 : p.fert) - 0.2) / 0.8));   // exhausted soil looks pale and dry
    ctx.fillStyle = season === 'Winter' ? '#d9d4cc' : `rgb(${Math.round(150 - f * 28)},${Math.round(125 - f * 35)},${Math.round(92 - f * 34)})`;
    ctx.fillRect(x + 1, y + 1, ts - 2, ts - 2);
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + 2, y + ts * i / 4); ctx.lineTo(x + ts - 2, y + ts * i / 4); ctx.stroke(); }
    if (p.state === 'empty') return;
    const h = p.state === 'ready' ? 1 : 0.25 + p.p * 0.6;
    ctx.fillStyle = p.state === 'ready' ? '#e8c43c' : `rgb(${90 - p.p * 30},${150 + p.p * 20},60)`;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const sx = x + ts * (0.2 + i * 0.3), sy = y + ts * (0.28 + j * 0.28);
      ctx.fillRect(sx - ts * 0.04, sy - ts * 0.16 * h, ts * 0.08, ts * 0.16 * h + 1);
    }
  }

  function drawHouse(h, season, night) {
    const x = gx(h.x), y = gy(h.y);
    const look = API.eraLook && API.eraLook(world), hx = c => '#' + c.toString(16).padStart(6, '0');
    ctx.fillStyle = look ? hx(look.wall) : '#b79a72'; ctx.fillRect(x + ts * 0.1, y + ts * 0.42, ts * 0.8, ts * 0.5);
    ctx.fillStyle = season === 'Winter' ? '#f2f6f8' : look ? hx(look.roof) : '#a23f36';
    ctx.beginPath(); ctx.moveTo(x, y + ts * 0.46); ctx.lineTo(x + ts / 2, y + ts * 0.05); ctx.lineTo(x + ts, y + ts * 0.46); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5c3d22'; ctx.fillRect(x + ts * 0.42, y + ts * 0.62, ts * 0.16, ts * 0.3);
    const lit = night > 0.3 && h.occupants.length;
    ctx.fillStyle = lit ? '#ffd86b' : '#8fb4d0'; ctx.fillRect(x + ts * 0.18, y + ts * 0.55, ts * 0.16, ts * 0.14);
    ctx.fillRect(x + ts * 0.66, y + ts * 0.55, ts * 0.16, ts * 0.14);
    if (h.heated && season === 'Winter') {
      ctx.fillStyle = 'rgba(220,220,220,.6)';
      const t = performance.now() / 600;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + ts * 0.75 + Math.sin(t + i) * 2, y - i * ts * 0.18 + ts * 0.1, ts * (0.06 + i * 0.03), 0, 7); ctx.fill(); }
    }
    for (let i = 0; i < h.occupants.length; i++) {
      ctx.fillStyle = '#fff'; ctx.fillRect(x + ts * (0.15 + i * 0.2), y + ts * 0.95, ts * 0.12, ts * 0.06);
    }
  }

  function drawStore(s) {
    const x = gx(s.x), y = gy(s.y);
    ctx.fillStyle = '#7b5a35'; ctx.fillRect(x + ts * 0.05, y + ts * 0.3, ts * 0.9, ts * 0.65);
    ctx.fillStyle = '#5a3f22'; ctx.fillRect(x, y + ts * 0.2, ts, ts * 0.18);
    ctx.fillStyle = '#d9b56a'; ctx.fillRect(x + ts * 0.3, y + ts * 0.5, ts * 0.4, ts * 0.45);
    ctx.strokeStyle = '#5a3f22'; ctx.strokeRect(x + ts * 0.3, y + ts * 0.5, ts * 0.4, ts * 0.45);
    const fill = Math.min(1, world.stock.food / Math.max(1, world.targets.food));
    ctx.fillStyle = '#0e1014'; ctx.fillRect(x, y - ts * 0.12, ts, ts * 0.1);
    ctx.fillStyle = '#e8b84a'; ctx.fillRect(x, y - ts * 0.12, ts * fill, ts * 0.1);
  }

  function drawSite(s) {
    if (s.nosite) return;
    const x = gx(s.x), y = gy(s.y);
    ctx.strokeStyle = '#e8b84a'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 2, y + 2, ts - 4, ts - 4); ctx.setLineDash([]);
  }

  function drawAgent(a, alpha, night) {
    if (a.indoors && a.sleeping) return;
    if (a.indoors && a.plan.length === 0) return;
    const p = agentPos(a, alpha);
    const cx = gx(p.x), cy = gy(p.y), u = ts / 20 * (a.age < 12 ? 0.75 : 1);
    const bob = a.sleeping ? 0 : Math.sin((world.tick + a.id * 7) * 0.9) * 0.8 * (Math.hypot(a.x - a.px, a.y - a.py) > 0.01 ? 1 : 0);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(cx, cy + 3 * u, 5 * u, 2 * u, 0, 0, 7); ctx.fill();
    if (a.sleeping) {
      ctx.fillStyle = JOB_COL[a.job] || '#999'; ctx.fillRect(cx - 5 * u, cy - 2 * u, 8 * u, 4 * u);
      ctx.fillStyle = SKIN[a.skin]; ctx.beginPath(); ctx.arc(cx + 5 * u, cy, 2.6 * u, 0, 7); ctx.fill();
      ctx.fillStyle = '#cfe3ff'; ctx.font = `bold ${Math.max(8, 7 * u)}px sans-serif`; ctx.fillText('z', cx + 4 * u, cy - 6 * u); ctx.fillText('Z', cx + 8 * u, cy - 10 * u);
    } else {
      ctx.fillStyle = JOB_COL[a.job] || '#999';
      ctx.fillRect(cx - 3 * u, cy - 6 * u + bob, 6 * u, 8 * u);
      ctx.fillStyle = '#2d3440'; ctx.fillRect(cx - 3 * u, cy + 1.5 * u + bob, 2.4 * u, 2.5 * u); ctx.fillRect(cx + 0.6 * u, cy + 1.5 * u + bob, 2.4 * u, 2.5 * u);
      ctx.fillStyle = SKIN[a.skin]; ctx.beginPath(); ctx.arc(cx, cy - 8.5 * u + bob, 3 * u, 0, 7); ctx.fill();
      ctx.fillStyle = HAIR[a.hair]; ctx.beginPath(); ctx.arc(cx, cy - 9.3 * u + bob, 3 * u, Math.PI, 0); ctx.fill();
      if (a.gender === 'F') ctx.fillRect(cx - 3 * u, cy - 9.3 * u + bob, 1.2 * u, 4 * u);
      if (a.carry) { ctx.fillStyle = a.carry.type === 'wood' ? '#8a5a2b' : '#e8b84a'; ctx.fillRect(cx + 3 * u, cy - 4 * u + bob, 3.5 * u, 3.5 * u); }
    }
    // status icons
    let icon = null;
    for (const f of API.icons) { icon = f(a, world); if (icon) break; }
    if (!icon) {
      if (a.cold) icon = ['*', '#9ad7ff']; else if (a.sick > 0) icon = ['+', '#8fe07a']; else if (a.satiety < 20) icon = ['!', '#ffb347']; else if (a.energy < 15) icon = ['~', '#aab'];
    }
    // health bar
    const bw = Math.max(14, ts * 0.8), bx = cx - bw / 2, by = cy - 18 * u - 2;
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 5);
    const hp = Math.max(0, a.health) / 100;
    ctx.fillStyle = hp > 0.6 ? '#58c46a' : hp > 0.3 ? '#e8b84a' : '#e0554c';
    ctx.fillRect(bx, by, bw * hp, 3);
    if (icon) { ctx.fillStyle = icon[1]; ctx.font = `bold ${Math.max(10, 10 * u)}px sans-serif`; ctx.fillText(icon[0], bx + bw + 3, by + 5); }
    if (a.id === selId) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(cx, cy + 2 * u, 9 * u, 4.5 * u, 0, 0, 7); ctx.stroke();
    }
  }

  function drawLabel(a, alpha, always) {
    const p = agentPos(a, alpha);
    const t = a.name + ' - ' + a.label;
    ctx.font = '11px "Segoe UI", sans-serif';
    const w = ctx.measureText(t).width + 8, x = gx(p.x) - w / 2, y = gy(p.y) - ts * 1.45;
    ctx.fillStyle = 'rgba(10,12,16,.85)'; ctx.fillRect(x, y - 11, w, 15);
    ctx.fillStyle = '#fff'; ctx.fillText(t, x + 4, y);
  }

  function drawSnow(time) {
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    const w = ox * 2 + ts * W;
    for (let i = 0; i < 90; i++) {
      const sx = (hash(i, 1) * w + Math.sin(time / 900 + i) * 12) % w;
      const sy = (hash(i, 2) * (oy * 2 + ts * H) + time * (0.02 + hash(i, 3) * 0.03)) % (oy * 2 + ts * H);
      ctx.fillRect(sx, sy, 2, 2);
    }
  }

  function render(alpha, time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#0e1014'; ctx.fillRect(0, 0, cv.width, cv.height);
    const season = world.season, night = darkness();
    drawTerrain(season, time);
    for (const p of world.plots) drawPlot(p, season);
    for (const g of world.graves) {
      const x = gx(g.x), y = gy(g.y);
      ctx.fillStyle = '#9aa0a8'; ctx.fillRect(x + ts * 0.45, y + ts * 0.3, ts * 0.1, ts * 0.5); ctx.fillRect(x + ts * 0.3, y + ts * 0.42, ts * 0.4, ts * 0.1);
    }
    for (const s of world.sites) drawSite(s);
    for (const b of world.bushes) drawBush(b, season);
    for (const f of API.draw.ground) f(G);
    // y-sorted objects & agents
    const items = [];
    for (const t of world.trees) items.push([t.y + 1, 0, t]);
    for (const h of world.houses) items.push([h.y + 1, 1, h]);
    for (const s of world.structs) if (API.sprites[s.kind]) items.push([s.y + 1, 4, s]);
    items.push([world.store.y + 1, 2, world.store]);
    for (const a of world.agents) { const p = agentPos(a, alpha); items.push([p.y + 0.3, 3, a]); }
    items.sort((a, b) => a[0] - b[0]);
    for (const [, k, o] of items) {
      if (k === 0) drawTree(o, season);
      else if (k === 1) drawHouse(o, season, night);
      else if (k === 2) drawStore(o);
      else if (k === 4) API.sprites[o.kind](G, o);
      else drawAgent(o, alpha, night);
    }
    for (const f of API.draw.top) f(G, alpha);
    // selected path
    const sel = world.agents.find(a => a.id === selId);
    if (sel && sel.path) {
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(gx(sel.x), gy(sel.y));
      for (let i = sel.pi; i < sel.path.length; i++) ctx.lineTo(gx(sel.path[i].x), gy(sel.path[i].y));
      ctx.stroke(); ctx.setLineDash([]);
    }
    // night overlay + warm window glow
    if (night > 0) {
      ctx.fillStyle = `rgba(10,16,48,${0.62 * night})`;
      ctx.fillRect(ox, oy, ts * W, ts * H);
      if (night > 0.3) for (const h of world.houses) if (h.occupants.length) {
        const gr = ctx.createRadialGradient(gx(h.x + 0.5), gy(h.y + 0.7), 1, gx(h.x + 0.5), gy(h.y + 0.7), ts * 1.6);
        gr.addColorStop(0, `rgba(255,200,90,${0.45 * night})`); gr.addColorStop(1, 'rgba(255,200,90,0)');
        ctx.fillStyle = gr; ctx.fillRect(gx(h.x - 1.5), gy(h.y - 1), ts * 4, ts * 4);
      }
    }
    if (season === 'Winter') drawSnow(time);
    if (world.droughtDays > 0) { ctx.fillStyle = 'rgba(230,170,40,.09)'; ctx.fillRect(ox, oy, ts * W, ts * H); }
    const hv = world.agents.find(a => a.id === (hoverId || selId));
    if (hv) drawLabel(hv, alpha);
  }

  // ------------------------------------------------------------------ HUD
  const el = {};
  ['s-day', 's-season', 's-time', 's-pop', 's-food', 's-wood', 's-fish', 's-best'].forEach(k => el[k] = $(k));
  const hudEls = {};
  // ---- generic side panels contributed by mods: API.panels = [{id,title,html(world,ui)}]
  const panelEls = {};
  function buildPanels() {
    const host = $('panels'); host.innerHTML = '';
    for (const p of (API.panels || [])) {
      const d = document.createElement('div'); d.className = 'panel'; d.id = 'pn-' + p.id;
      d.innerHTML = `<h2>${p.title}</h2><div class="pb"></div>`;
      host.appendChild(d); panelEls[p.id] = { root: d, body: d.lastChild, last: '' };
    }
  }
  function updatePanels() {
    for (const p of (API.panels || [])) {
      const e = panelEls[p.id]; if (!e) continue;
      const h = p.html(world, ui);
      if (h === null || h === undefined || h === false) { e.root.style.display = 'none'; continue; }
      e.root.style.display = '';
      if (h !== e.last) { e.body.innerHTML = h; e.last = h; }
    }
  }
  // click delegation: any element with data-act calls API.actions[act](world, arg, ui)
  document.addEventListener('click', ev => {
    const t = ev.target.closest && ev.target.closest('[data-act]'); if (!t) return;
    const f = (API.actions || {})[t.dataset.act]; if (f) { f(world, t.dataset.arg, ui); ui.refresh(); }
  });
  const ui = {
    get sel() { return world.get(selId); }, select: id => { selId = id; },
    paused: () => paused, speed: () => speed,
    refresh: () => { updateList(); updateSelected(); renderLog(); updatePanels(); },
    newWorld: () => newWorld(), modal: (html) => showModal(html),
  };
  function showModal(html) {
    let m = $('modal');
    if (!html) { if (m) m.remove(); return; }
    if (!m) { m = document.createElement('div'); m.id = 'modal'; $('stage').appendChild(m); }
    m.innerHTML = `<div class="mcard"><button class="sm mclose" data-act="closeModal">Close</button>${html}</div>`;
  }
  API.actions = API.actions || {};
  API.actions.closeModal = () => showModal(null);
  function buildHud() {
    const host = $('hud-extra'); host.innerHTML = '';
    for (const h of API.hud) {
      const d = document.createElement('div'); d.className = 'stat';
      d.innerHTML = `<span class="k">${h.label}</span><span class="v" id="hx-${h.id}">0</span>`;
      host.appendChild(d); hudEls[h.id] = d.lastChild;
    }
  }

  function updateHUD() {
    for (const h of API.hud) { const v = h.get(world); if (hudEls[h.id].textContent !== String(v)) hudEls[h.id].textContent = v; }
    el['s-day'].textContent = world.day;
    el['s-season'].textContent = world.season + (world.droughtDays ? ' (drought)' : '');
    el['s-time'].textContent = hourStr();
    el['s-pop'].textContent = world.agents.length;
    el['s-food'].textContent = Math.floor(world.stock.food);
    el['s-wood'].textContent = Math.floor(world.stock.wood);
    el['s-fish'].textContent = Math.round(world.fish);
    el['s-best'].textContent = Math.max(best, world.day) + ' d';
    const bn = $('banner');
    const n = world.agents.length, starving = world.agents.filter(a => a.satiety <= 0).length;
    let msg = null;
    for (const f of API.alerts) { msg = f(world); if (msg) break; }
    if (!msg && starving > 0) msg = starving + ' villager' + (starving > 1 ? 's' : '') + ' starving';
    if (!msg && !world.hasFood() && n) msg = 'The storehouse is out of food';
    if (msg) { bn.style.display = 'block'; bn.textContent = msg; } else bn.style.display = 'none';
  }

  const bar = (cls, v) => `<div class="bar"><div class="${cls}" style="width:${Math.max(0, Math.min(100, v))}%"></div></div>`;

  function updateSelected() {
    const body = $('sel-body'), a = world.agents.find(x => x.id === selId);
    if (!a) {
      if (selId) {
        const d = world.dead.find(x => x.name && x.name === (world._selName || ''));
        body.innerHTML = '<div class="muted">This villager has died.</div>';
      } else body.innerHTML = '<div class="muted">Click a villager on the map or in the list.</div>';
      return;
    }
    world._selName = a.name;
    body.innerHTML =
      `<div class="name">${a.name}</div>` +
      `<div class="meta">${a.gender === 'M' ? 'Man' : 'Woman'}, ${a.age.toFixed(0)} yrs - ${a.job} - ${a.home ? 'has a home' : 'homeless'}</div>` +
      `<div class="row"><span>Health</span>${bar('hp', a.health)}<span>${a.health.toFixed(0)}</span></div>` +
      `<div class="row"><span>Hunger</span>${bar('fd', a.satiety)}<span>${a.satiety.toFixed(0)}</span></div>` +
      `<div class="row"><span>Energy</span>${bar('en', a.energy)}<span>${a.energy.toFixed(0)}</span></div>` +
      `<div class="doing">Doing: <b>${a.label}</b>${a.carry ? ' (carrying ' + a.carry.n + ' ' + a.carry.type + ')' : ''}${a.sick > 0 ? ' - ' + (a.sickKind || 'ill') : ''}${a.cold ? ' - freezing' : ''}</div>` +
      API.info.map(f => f(a, world) || '').join('');
  }

  function updateList() {
    const list = world.agents.slice().sort((a, b) => a.health - b.health);
    $('vcount').textContent = '(' + list.length + ')';
    $('vlist').innerHTML = list.map(a =>
      `<div class="vr${a.id === selId ? ' sel' : ''}" data-id="${a.id}"><span class="nm">${a.name}</span><span class="jb">${a.job}</span>${bar('hp', a.health)}</div>`).join('');
    const c = world.counts();
    $('jobs').innerHTML = Object.keys(c).filter(k => c[k]).map(k => `<span style="border-left:3px solid ${JOB_COL[k]}">${k} ${c[k]}</span>`).join('');
  }

  function renderLog(force) {
    const L = world.logs, last = L[L.length - 1];
    const key = L.length + '|' + (last ? last.text : '');
    if (!force && key === lastLogKey) return;
    lastLogKey = key;
    $('log').innerHTML = L.slice(-80).reverse().map(l => `<div class="log-i ${l.type}"><b>D${l.day}</b>${l.text}</div>`).join('');
  }

  function drawChart() {
    const w = chart.width, h = chart.height, hist = world.history;
    cctx.clearRect(0, 0, w, h);
    if (hist.length < 2) return;
    const n = hist.length, mx = Math.max(10, ...hist.map(p => p.pop));
    const mf = Math.max(50, ...hist.map(p => Math.max(p.food, p.wood)));
    const line = (key, color, max) => {
      cctx.strokeStyle = color; cctx.lineWidth = 1.5; cctx.beginPath();
      hist.forEach((p, i) => { const x = (i / (n - 1)) * (w - 4) + 2, y = h - 4 - (p[key] / max) * (h - 10); i ? cctx.lineTo(x, y) : cctx.moveTo(x, y); });
      cctx.stroke();
    };
    line('food', '#e8b84a', mf); line('wood', '#9a6b3a', mf); line('pop', '#6cc6ff', mx);
    cctx.fillStyle = '#8691a0'; cctx.font = '10px sans-serif'; cctx.fillText('max pop ' + mx + '  |  day ' + hist[n - 1].day, 4, 10);
  }

  function showOver() {
    overShown = true;
    const d = world.day, cheat = world.godUsed;
    if (d > best && !cheat) { best = d; localStorage.setItem('smallworld.best', String(best)); }
    $('over-days').textContent = 'Survived ' + d + ' days';
    $('over-sub').textContent = cheat ? 'God mode was used - this run does not count for the record' : (d >= best && d > 0 ? 'A new record!' : 'Best: ' + best + ' days');
    const s = world.stats, causes = Object.entries(s.causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ': ' + v).join(', ');
    const extra = (API.overHtml || []).map(f => f(world) || '').join('');
    $('over-stats').innerHTML = `Peak population: ${s.peak}<br>Births: ${s.births} - Deaths: ${s.deaths}${s.arrivals ? ' - Arrivals: ' + s.arrivals : ''}<br>Causes of death: ${causes || 'none'}` +
      (extra ? `<div class="btns" style="justify-content:center;margin-top:10px">${extra}</div>` : '');
    $('over').classList.remove('hidden');
    el['s-best'].textContent = best + ' d';
  }

  // ------------------------------------------------------------------ loop
  function frame(now) {
    const dt = Math.min(100, now - last); last = now;
    if (!paused && !world.gameOver) {
      acc += dt * speed * 10 / 1000;       // 10 ticks/sec at 1x  (a day = 24 s) — slowed so LLM thinking fits within one day
      const budget = performance.now() + 40;
      let steps = 0;
      while (acc >= 1 && !world.gameOver) {
        world.step(); acc--; steps++;
        if ((steps & 15) === 0 && performance.now() > budget) { acc = 0; break; }
      }
    }
    if (world.gameOver && !overShown) showOver();
    const al = paused || speed > 3 ? 1 : Math.min(1, acc);
    if (API.view3d && API.view3d.active) API.view3d.render(world, al, now); else render(al, now);
    updateHUD();
    if (now - lastListAt > 250) {
      lastListAt = now; updateList(); updateSelected(); renderLog(); drawChart(); updatePanels();
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ input
  function pick(ev) {
    const r = cv.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let bestA = null, bd = 0.9;
    for (const a of world.agents) {
      const d = Math.hypot((mx - ox) / ts - a.x, (my - oy) / ts - (a.y - 0.35));
      if (d < bd) { bd = d; bestA = a; }
    }
    return bestA;
  }
  cv.addEventListener('click', e => { const a = pick(e); selId = a ? a.id : null; updateSelected(); updateList(); });
  cv.addEventListener('mousemove', e => { const a = pick(e); hoverId = a ? a.id : null; cv.style.cursor = a ? 'pointer' : 'default'; });
  cv.addEventListener('mouseleave', () => hoverId = null);
  $('vlist').addEventListener('click', e => {
    const row = e.target.closest('.vr'); if (!row) return;
    selId = +row.dataset.id; updateSelected(); updateList();
  });

  function setSpeed(s) {
    speed = s; paused = false; $('b-pause').textContent = 'Pause';
    window.SmallWorldSpeed = s;
    document.querySelectorAll('.spd').forEach(b => b.classList.toggle('on', +b.dataset.s === s));
  }
  document.querySelectorAll('.spd').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.s)));
  $('b-pause').addEventListener('click', () => { paused = !paused; $('b-pause').textContent = paused ? 'Resume' : 'Pause'; });
  $('b-new').addEventListener('click', newWorld);
  $('b-again').addEventListener('click', newWorld);

  const bSound = $('b-sound');
  if (bSound) {
    const updateSoundBtn = () => {
      const isMuted = API.audio && API.audio.isMuted();
      bSound.textContent = isMuted ? '🔇' : '🔊';
      bSound.classList.toggle('muted', isMuted);
    };
    updateSoundBtn();
    bSound.addEventListener('click', () => {
      if (API.audio) {
        API.audio.ensure();
        API.audio.toggleMute();
        updateSoundBtn();
      }
    });
  }

  const bSave = $('b-save');
  if (bSave) {
    bSave.addEventListener('click', () => {
      if (API.saveLoad && world) {
        const ok = API.saveLoad.saveLocal(world);
        if (ok) {
          bSave.textContent = 'Saved! ✓';
          setTimeout(() => bSave.textContent = 'Save', 1500);
        }
      }
    });
  }

  const bLoad = $('b-load');
  if (bLoad) {
    bLoad.addEventListener('click', () => {
      if (API.saveLoad) {
        const loaded = API.saveLoad.loadLocal();
        if (loaded) {
          world = loaded;
          selId = null; overShown = false; lastLogKey = '';
          $('over').classList.add('hidden');
          $('banner').style.display = 'none';
          renderLog(true);
          bLoad.textContent = 'Loaded! ✓';
          setTimeout(() => bLoad.textContent = 'Load', 1500);
        } else {
          alert('No saved game found in browser storage.');
        }
      }
    });
  }
  window.addEventListener('keydown', e => {
    const inInput = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (!inInput && e.code === 'Space') { e.preventDefault(); $('b-pause').click(); }
    const map = { Digit1: 1, Digit2: 3, Digit3: 8, Digit4: 25, Digit5: 80 };
    if (!inInput && map[e.code]) setSpeed(map[e.code]);
  });

  // debug hook
  window.__world = () => world;

  window.__ui = ui;
  buildHud(); buildPanels(); resize(); newWorld(); setSpeed(1);
  if (API.view3d) API.view3d.attach({
    stage: $('stage'),
    sel: () => selId, hover: () => hoverId,
    select: id => { selId = id; updateSelected(); updateList(); },
    setHover: id => { hoverId = id; },
    onMode: on => { cv.style.display = on ? 'none' : 'block'; },
  });
  requestAnimationFrame(frame);
})();
