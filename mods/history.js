/* Family tree + village timeline, shown in a modal (from the sidebar or the game-over card). */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const MAX_LINES = 700;

  // ------------------------------------------------------------------ family tree
  function treeHtml(w) {
    const R = w.registry, seen = new Set(); let lines = 0, cut = false;
    const status = r => {
      const alive = w.byId.has(r.id);
      if (alive) return '<span style="color:#8fd18a">alive</span>';
      if (r.died) return `<span style="color:#c58fe0">d. day ${r.died.day} (${r.died.cause})</span>`;
      if (r.left) return `<span style="color:#ff9d8f">left day ${r.left.day}</span>`;
      return '';
    };
    const label = r => `<div class="family-node-core"><div class="family-name">${r.name}</div><div class="family-meta">${r.gender === 'M' ? 'man' : 'woman'} · ${r.born < 0 ? 'founder' : 'b. ' + r.born} ${status(r)}</div></div>`;
    function node(id) {
      const r = R[id]; if (!r || seen.has(id)) return '';
      if (lines >= MAX_LINES) { cut = true; return ''; }
      seen.add(id); lines++;
      const s = r.spouse != null ? R[r.spouse] : (r.lastSpouse != null ? R[r.lastSpouse] : null);
      const spouseHtml = s ? `<div class="family-spouse">&amp; ${s.name}</div>` : '';
      const kids = [...new Set([...(r.kids || [])])];
      const childHtml = kids.length ? `<div class="family-children">${kids.map(k => node(k)).filter(Boolean).join('')}</div>` : '';
      const combined = `<div class="family-node-wrap">${label(r)}${spouseHtml}${childHtml}</div>`;
      return combined;
    }
    const roots = Object.values(R).filter(r => !(r.parents && r.parents.length && r.parents.some(p => R[p])));
    let html = roots.map(r => (seen.has(r.id) ? '' : `<div class="family-root">${node(r.id)}</div>`)).join('');
    for (const r of Object.values(R)) if (!seen.has(r.id) && lines < MAX_LINES) html += `<div class="family-root">${node(r.id)}</div>`;
    const total = Object.keys(R).length;
    return `<h2>Family tree - ${total} people over ${w.day} days</h2><div class="family-tree-wrap"><div class="family-tree">${html}${cut ? '<div class="muted">... tree truncated</div>' : ''}</div></div>`;
  }

  function chartSvg(w) {
    const H = w.history; if (H.length < 2) return '';
    const Wd = 620, Ht = 130, pad = 22, n = H.length, mx = Math.max(10, ...H.map(p => p.pop));
    const x = i => pad + (i / (n - 1)) * (Wd - pad * 2), y = v => Ht - 18 - (v / mx) * (Ht - 34);
    const pts = H.map((p, i) => `${x(i).toFixed(1)},${y(p.pop).toFixed(1)}`).join(' ');
    let marks = '';
    const dayX = d => x(Math.min(n - 1, Math.max(0, H.findIndex(p => p.day >= d))));
    for (const e of w.chron) {
      if (e.type !== 'mile' && !/earthquake|raiders|wolves|flood|fire|cholera|plague|storm|drought|blight/i.test(e.text)) continue;
      if (!/!|arrive|new year|begins/i.test(e.text) && e.type !== 'mile') continue;
      const cx = dayX(e.day).toFixed(1);
      marks += `<line x1="${cx}" x2="${cx}" y1="${Ht - 18}" y2="14" stroke="${e.type === 'mile' ? '#3b4553' : '#6b3434'}" stroke-width="1" opacity=".55"/>`;
    }
    return `<svg width="${Wd}" height="${Ht}" style="background:#14171c;border-radius:4px">${marks}<polyline points="${pts}" fill="none" stroke="#6cc6ff" stroke-width="1.6"/>` +
      `<text x="${pad}" y="11" fill="#8691a0" font-size="10">population (peak ${mx}) - red lines: disasters, grey: new years</text>` +
      `<text x="${pad}" y="${Ht - 4}" fill="#8691a0" font-size="10">day 0</text><text x="${Wd - pad - 40}" y="${Ht - 4}" fill="#8691a0" font-size="10">day ${H[n - 1].day}</text></svg>`;
  }
  function timelineHtml(w) {
    const col = { bad: '#ff9d8f', good: '#8fd18a', mile: '#f1d36a' };
    const items = w.chron.filter(e => !/finished building|got married|was born|finished a new house/.test(e.text)).slice(-400).reverse();
    return `<h2>Timeline - the story of this village</h2>${chartSvg(w)}` +
      `<div class="tl" style="margin-top:10px;max-height:300px">${items.map(e => `<div class="log-i" style="color:${col[e.type] || '#cfd6df'}"><b>D${e.day}</b>${e.text}</div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------------ plumbing
  api.mods.push({
    // remember the last spouse so tree lines survive widowhood
    die(w, a) { if (a.spouse && w.registry[a.id]) { w.registry[a.id].lastSpouse = a.spouse; const s = w.registry[a.spouse]; if (s) s.lastSpouse = a.id; } },
    leave(w, a) { if (a.spouse && w.registry[a.id]) { w.registry[a.id].lastSpouse = a.spouse; const s = w.registry[a.spouse]; if (s) s.lastSpouse = a.id; } },
  });
  api.actions.showTree = (w, _, ui) => ui.modal(treeHtml(w));
  api.actions.showTimeline = (w, _, ui) => ui.modal(timelineHtml(w));
  const btns = '<button class="sm" data-act="showTree">Family tree</button><button class="sm" data-act="showTimeline">Timeline</button>';
  api.panels.push({ id: 'history', title: 'History', html: () => `<div class="btns">${btns}</div>` });
  (api.overHtml = api.overHtml || []).push(() => btns);
})();
