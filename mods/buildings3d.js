/* =============================================================================
   SMALL WORLD - buildings3d.js
   Era-aware 3D models for the three.js renderer (view3d.js). Browser only.

   Every building type has its own detailed procedural model per era:
     houses      7 models  (cave shelter -> mud hut -> timber -> stone -> half-timbered -> brick -> modern)
     storehouse  6 models  (pit store -> thatched barn -> timber barn -> granary -> warehouse -> depot)
     forge/oven/school/well/tower: 3 models each, switching at era boundaries
   When the era advances, existing buildings are rebuilt in place, so the village visibly develops.
   No image or model files: geometry is shared, textures are drawn on a canvas once and cached.

   Hooks used (see view3d.js): view.makeHouseFn / updHouseFn / makeStoreFn / updStoreFn,
   API.models3d[kind], and view.look.eraId (set from mods/eras.js).
   Load order in index.html: after view3d.js and eras.js, before ui.js.
   ============================================================================= */
(function () {
  'use strict';
  const API = window.SmallWorld, T = window.THREE;
  if (!API || !T || !API.view3d) return;
  const view = API.view3d, M = API.models3d;
  const FALLBACK_ERA = 'medieval';                       // used when eras are switched off
  const era = () => (view.look && view.look.eraId) || FALLBACK_ERA;

  // ------------------------------------------------------------------ materials & shared geometry
  const mats = {}, basics = {};
  const mat = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return mats[k] || (mats[k] = new T.MeshLambertMaterial(Object.assign({ color: c }, o))); };
  const bmat = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return basics[k] || (basics[k] = new T.MeshBasicMaterial(Object.assign({ color: c }, o))); };
  const glass = (c, op) => mat(c, { transparent: true, opacity: op == null ? 0.7 : op });

  // gable roof prism: ridge along z, unit size, base at y=0
  const gableGeo = (() => {
    const s = new T.Shape(); s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
    const g = new T.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g;
  })();
  const archGeo = new T.CylinderGeometry(0.08, 0.08, 0.04, 10, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
  const G = {
    box: new T.BoxGeometry(1, 1, 1), cyl: new T.CylinderGeometry(1, 1, 1, 10), cone4: new T.ConeGeometry(1, 1, 4),
    cone8: new T.ConeGeometry(1, 1, 8), sph: new T.SphereGeometry(1, 10, 7), hemi: new T.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    flame: new T.ConeGeometry(1, 1, 6), gable: gableGeo, arch: archGeo,
  };
  function put(parent, geo, m, x, y, z, sx, sy, sz, shadow) {
    const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    o.castShadow = shadow !== false; o.receiveShadow = true; parent.add(o); return o;
  }
  const box = (p, w, h, d, c, x, y, z) => put(p, G.box, mat(c), x, y, z, w, h, d);
  const cyl = (p, r, h, c, x, y, z) => put(p, G.cyl, mat(c), x, y, z, r, h, r);
  const cone = (p, r, h, c, x, y, z, hex) => { const m = put(p, hex ? G.cone8 : G.cone4, mat(c), x, y, z, r, h, r); if (!hex) m.rotation.y = Math.PI / 4; return m; };
  const sph = (p, r, c, x, y, z) => put(p, G.sph, mat(c), x, y, z, r, r, r);
  const gable = (p, w, h, d, c, x, y, z) => put(p, G.gable, mat(c), x, y, z, w, h, d);
  const lit = (p, w, h, d, c, x, y, z) => put(p, G.box, bmat(c), x, y, z, w, h, d, false);

  // ------------------------------------------------------------------ procedural textures (drawn once)
  const texCache = {};
  function canvasTex(key, w, h, draw, repeat) {
    if (texCache[key]) return texCache[key];
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h);
    const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4;
    if (repeat) t.repeat.set(repeat, repeat);
    return texCache[key] = t;
  }
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  const shade = (n, k) => { const c = new T.Color(n).multiplyScalar(k); return '#' + c.getHexString(); };
  const rnd = (() => { let s = 12345; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  function speckle(ctx, W, H, n, base) { for (let i = 0; i < n; i++) { ctx.fillStyle = shade(base, 0.82 + rnd() * 0.3); ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2); } }
  function brickTex(brick, mortar) {
    return canvasTex('brk' + brick + mortar, 64, 64, (c, W, H) => {
      c.fillStyle = hex(mortar); c.fillRect(0, 0, W, H);
      for (let r = 0; r < 9; r++) for (let q = -1; q < 5; q++) { c.fillStyle = shade(brick, 0.88 + rnd() * 0.2); c.fillRect(q * 16 + (r & 1 ? 8 : 0) + 1, r * 8 + 1, 14, 6); }
    }, 2);
  }
  function stoneTex(base) {
    return canvasTex('stn' + base, 64, 64, (c, W, H) => {
      c.fillStyle = shade(base, 0.55); c.fillRect(0, 0, W, H);
      for (const [x, y, w, h] of [[1,1,19,13],[22,1,20,13],[44,1,19,13],[1,15,29,13],[32,15,31,13],[1,29,17,13],[19,29,25,13],[46,29,17,13],[1,43,27,13],[30,43,20,13],[52,43,11,13]]) {
        c.fillStyle = shade(base, 0.9 + rnd() * 0.2); c.fillRect(x, y, w, h);
      }
      speckle(c, W, H, 70, base);
    }, 2);
  }
  function timberTex(plaster) {
    return canvasTex('tmb' + plaster, 64, 64, (c, W, H) => {
      c.fillStyle = hex(plaster); c.fillRect(0, 0, W, H); speckle(c, W, H, 40, plaster);
      c.strokeStyle = '#3b2510'; c.lineWidth = 5;
      c.strokeRect(2, 2, W - 4, H - 4);
      c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.moveTo(2, 2); c.lineTo(W / 2, H / 2); c.moveTo(W - 2, 2); c.lineTo(W / 2, H / 2); c.stroke();
    }, 1);
  }
  function plankTex(base) {
    return canvasTex('pln' + base, 64, 64, (c, W, H) => {
      c.fillStyle = hex(base); c.fillRect(0, 0, W, H);
      for (let i = 0; i < 8; i++) { c.fillStyle = shade(base, 0.8 + rnd() * 0.3); c.fillRect(i * 8 + 1, 0, 6, H); }
    }, 1);
  }
  function thatchTex(base) {
    return canvasTex('tha' + base, 64, 64, (c, W, H) => {
      c.fillStyle = hex(base); c.fillRect(0, 0, W, H);
      for (let i = 0; i < 160; i++) { c.fillStyle = shade(base, 0.7 + rnd() * 0.5); c.fillRect(rnd() * W, rnd() * H, 1, 6 + rnd() * 8); }
    }, 2);
  }
  function tileTex(base) {
    return canvasTex('til' + base, 64, 64, (c, W, H) => {
      c.fillStyle = shade(base, 0.6); c.fillRect(0, 0, W, H);
      for (let r = 0; r < 8; r++) for (let q = -1; q < 5; q++) { c.fillStyle = shade(base, 0.9 + rnd() * 0.2); c.fillRect(q * 16 + (r & 1 ? 8 : 0) + 1, r * 8 + 1, 14, 6); }
    }, 2);
  }
  const tmat = (tex, extra) => { const k = 'T' + tex.uuid + (extra ? JSON.stringify(extra) : ''); return mats[k] || (mats[k] = new T.MeshLambertMaterial(Object.assign({ map: tex }, extra))); };
  const tbox = (p, tex, w, h, d, x, y, z) => put(p, G.box, tmat(tex), x, y, z, w, h, d);
  const tgable = (p, tex, w, h, d, x, y, z) => put(p, G.gable, tmat(tex), x, y, z, w, h, d);

  // glow + smoke sprites
  let glowT, puffT;
  const radial = (key, inner, stops) => canvasTex(key, 64, 64, c => { const g = c.createRadialGradient(32, 32, inner, 32, 32, 32); for (const [o, col] of stops) g.addColorStop(o, col); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
  function glowSprite(parent, color, size, x, y, z) {
    glowT = glowT || radial('glow', 0, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]);
    const s = new T.Sprite(new T.SpriteMaterial({ map: glowT, color, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    s.scale.set(size, size, 1); s.position.set(x, y, z); parent.add(s); return s;
  }
  function disposeSprites(o) { o.traverse(c => { if (c.isSprite && c.material) c.material.dispose(); }); }

  // ------------------------------------------------------------------ HOUSES
  // A builder fills group g and returns the animated parts:
  //   body? roofs[] (snow/fire tint) roofMat  win[] (lit at night) winMat  glow
  // The common rig (smoke puffs, flames, fire glow) is added by rig().
  function rig(g, parts, glowColor, glowAt) {
    glowT = glowT || radial('glow', 0, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]);
    puffT = puffT || radial('puff', 2, [[0, 'rgba(255,255,255,.9)'], [1, 'rgba(255,255,255,0)']]);
    parts.glow = glowSprite(g, glowColor || 0xffc866, 2.3, glowAt[0], glowAt[1], glowAt[2]); parts.glow.visible = false;
    parts.puffs = [0, 1, 2].map(() => { const s = new T.Sprite(new T.SpriteMaterial({ map: puffT, color: 0xdddddd, transparent: true, depthWrite: false })); s.visible = false; g.add(s); return s; });
    parts.flames = new T.Group(); parts.flames.visible = false; g.add(parts.flames);
    for (let i = 0; i < 4; i++) put(parts.flames, G.flame, bmat(i % 2 ? 0xffd34a : 0xff6a1f), (i - 1.5) * 0.2, 0.9, (i % 2 - 0.5) * 0.2, 0.14, 0.5, 0.14, false);
    parts.fglow = glowSprite(g, 0xff8a30, 3, 0, 0.8, 0); parts.fglow.visible = false;
    parts.roofs = parts.roofs || []; parts.win = parts.win || [];
    return parts;
  }
  const chimney = (g, c, h, y) => { box(g, 0.11, h, 0.11, c, 0.22, y, -0.12); box(g, 0.15, 0.035, 0.15, 0x4a3a30, 0.22, y + h / 2, -0.12); };

  const HOUSE = {
    // Stone Age: boulder-roofed rock shelter with a dark cave mouth and a camp fire
    stone(g, h) {
      const rock = tmat(stoneTex(0x8a8178));
      const p = { body: put(g, G.box, rock, 0, 0.2, 0, 0.84, 0.4, 0.72) };
      put(g, G.hemi, tmat(stoneTex(0x7a7068)), 0, 0.36, -0.04, 0.5, 0.34, 0.44);
      put(g, G.hemi, mat(0x6c635b), -0.26, 0.38, -0.1, 0.24, 0.22, 0.24); put(g, G.hemi, mat(0x756c63), 0.28, 0.4, 0.04, 0.2, 0.2, 0.2);
      put(g, G.hemi, bmat(0x15100c), 0, 0.12, 0.35, 0.2, 0.26, 0.06);
      for (const [x, z, s] of [[-0.38, 0.4, 0.08], [0.36, 0.42, 0.065], [-0.2, 0.46, 0.05], [0.14, 0.47, 0.055]]) sph(g, s, 0x6a6058, x, s * 0.7, z);
      for (let i = 0; i < 4; i++) { const a = i * 1.57; put(g, G.box, mat(0x5a4328), 0.4 + Math.cos(a) * 0.06, 0.05, 0.4 + Math.sin(a) * 0.06, 0.02, 0.02, 0.1).rotation.y = a; }
      p.win = []; p.roofs = [];
      return rig(g, p, 0xff7a22, [0, 0.16, 0.36]);
    },
    // Neolithic: round mud-brick hut under a conical thatched roof
    neo(g, h) {
      const mud = [0xb69b6e, 0xac9466, 0xbea678][h.v % 3];
      const body = put(g, G.cyl, mat(mud), 0, 0.24, 0, 0.4, 0.48, 0.4);
      const roof = put(g, G.cone8, tmat(thatchTex(0xc9b24a)), 0, 0.66, 0, 0.5, 0.46, 0.5);
      put(g, G.cyl, mat(0x9d8559), 0, 0.02, 0, 0.44, 0.05, 0.44);
      const door = box(g, 0.15, 0.28, 0.03, 0x4a2f1a, 0, 0.14, 0.4);
      box(g, 0.22, 0.04, 0.05, 0x6b4a2b, 0, 0.3, 0.4);
      sph(g, 0.06, 0xc9b24a, 0.02, 0.9, 0);
      cyl(g, 0.05, 0.12, 0x6b6f76, 0.16, 0.66, -0.1);
      return rig(g, { body, roofs: [roof], win: [door], winMat: mat(0x4a2f1a) }, 0xffc866, [0, 0.4, 0.46]);
    },
    // Bronze Age: timber-framed long house, steep thatched gable
    bronze(g, h) {
      const body = tbox(g, timberTex(0xd9c5a2), 0.82, 0.5, 0.7, 0, 0.25, 0);
      box(g, 0.9, 0.04, 0.78, 0x7a5a38, 0, 0.02, 0);
      const roof = tgable(g, thatchTex(0xb59a4a), 0.98, 0.44, 0.84, 0, 0.5, 0);
      box(g, 0.14, 0.3, 0.03, 0x4a2f1a, 0, 0.15, 0.36);
      const win = [box(g, 0.13, 0.12, 0.03, 0x8fb4d0, -0.25, 0.3, 0.36), box(g, 0.13, 0.12, 0.03, 0x8fb4d0, 0.25, 0.3, 0.36)];
      for (const x of [-0.25, 0.25]) box(g, 0.17, 0.02, 0.04, 0x4a2f1a, x, 0.23, 0.37);
      chimney(g, 0x6b6f76, 0.28, 0.72);
      return rig(g, { body, roofs: [roof], win, winMat: mat(0x8fb4d0) }, 0xffc866, [0, 0.42, 0.5]);
    },
    // Iron Age: cut-stone house, terracotta hip roof, arched door
    iron(g, h) {
      const body = tbox(g, stoneTex(0xb3aea4), 0.84, 0.56, 0.74, 0, 0.28, 0);
      box(g, 0.9, 0.05, 0.8, 0x77726a, 0, 0.025, 0);
      const roof = put(g, G.cone4, tmat(tileTex(0xb5532f)), 0, 0.73, 0, 0.74, 0.4, 0.66); roof.rotation.y = Math.PI / 4;
      box(g, 0.17, 0.3, 0.04, 0x3d2c1e, 0, 0.15, 0.38); put(g, G.arch, mat(0x3d2c1e), 0, 0.3, 0.38, 1.05, 1, 1.05);
      box(g, 0.24, 0.025, 0.07, 0x8a867e, 0, 0.0125, 0.42);
      const win = [box(g, 0.13, 0.15, 0.04, 0x8fb4d0, -0.27, 0.34, 0.38), box(g, 0.13, 0.15, 0.04, 0x8fb4d0, 0.27, 0.34, 0.38)];
      for (const x of [-0.27, 0.27]) { box(g, 0.17, 0.03, 0.05, 0x77726a, x, 0.43, 0.38); box(g, 0.17, 0.03, 0.05, 0x77726a, x, 0.255, 0.38); }
      chimney(g, 0x8a867e, 0.4, 0.86);
      return rig(g, { body, roofs: [roof], win, winMat: mat(0x8fb4d0) }, 0xffc866, [0, 0.45, 0.5]);
    },
    // Middle Ages: two-storey half-timber house, overhanging upper floor, steep red roof, shutters
    medieval(g, h) {
      put(g, G.box, tmat(stoneTex(0xc4bfb8)), 0, 0.17, 0, 0.84, 0.34, 0.74);
      const body = tbox(g, timberTex(0xefe3c8), 0.92, 0.34, 0.82, 0, 0.51, 0);
      for (const x of [-0.44, 0.44]) box(g, 0.04, 0.34, 0.84, 0x3b2510, x, 0.51, 0);
      box(g, 0.94, 0.04, 0.84, 0x3b2510, 0, 0.35, 0);
      const roof = tgable(g, tileTex(0xa23f36), 1.0, 0.62, 0.92, 0, 0.66, 0);
      box(g, 0.17, 0.3, 0.04, 0x4a2f1a, 0, 0.15, 0.38); put(g, G.arch, mat(0x4a2f1a), 0, 0.3, 0.38, 1.05, 1, 1.05);
      const win = [box(g, 0.12, 0.14, 0.04, 0x8fb4d0, -0.27, 0.22, 0.38), box(g, 0.12, 0.14, 0.04, 0x8fb4d0, 0.27, 0.22, 0.38),
        box(g, 0.13, 0.15, 0.04, 0x8fb4d0, -0.25, 0.52, 0.43), box(g, 0.13, 0.15, 0.04, 0x8fb4d0, 0.25, 0.52, 0.43)];
      for (const x of [-0.37, -0.13, 0.13, 0.37]) box(g, 0.05, 0.16, 0.03, 0x2f5d3a, x, 0.52, 0.43);
      chimney(g, 0x8a5040, 0.5, 1.0);
      return rig(g, { body, roofs: [roof], win, winMat: mat(0x8fb4d0) }, 0xffc866, [0, 0.45, 0.55]);
    },
    // Industrial Age: tall brick terrace house, slate roof, sash windows, tall chimney stack
    industrial(g, h) {
      const body = tbox(g, brickTex(0xb05a45, 0x8a5a4a), 0.78, 0.86, 0.68, 0, 0.43, 0);
      box(g, 0.82, 0.05, 0.72, 0x6a6258, 0, 0.025, 0);
      box(g, 0.82, 0.03, 0.72, 0x8a8478, 0, 0.45, 0); box(g, 0.82, 0.04, 0.72, 0x8a8478, 0, 0.86, 0);
      const roof = tgable(g, tileTex(0x4a4f58), 0.88, 0.3, 0.78, 0, 0.88, 0);
      box(g, 0.18, 0.36, 0.04, 0x1f3a2e, 0, 0.18, 0.35); box(g, 0.24, 0.03, 0.08, 0x9a9488, 0, 0.015, 0.38);
      const win = []; for (const y of [0.26, 0.64]) for (const x of [-0.25, 0.25]) { win.push(box(g, 0.13, 0.2, 0.04, 0x9fd4ee, x, y, 0.35)); box(g, 0.17, 0.03, 0.05, 0xd9d4c8, x, y + 0.115, 0.35); }
      box(g, 0.1, 0.62, 0.1, 0x8a4a3a, 0.22, 1.2, -0.12); box(g, 0.15, 0.04, 0.15, 0x5a3a2a, 0.22, 1.52, -0.12);
      return rig(g, { body, roofs: [roof], win, winMat: mat(0x9fd4ee) }, 0xffd080, [0, 0.5, 0.45]);
    },
    // Modern Age: cubist white house with cantilevered upper floor, glazing, flat roof and solar panels
    modern(g, h) {
      const body = box(g, 0.88, 0.4, 0.78, [0xe3e6ea, 0xdfe3e8, 0xeceef0][h.v % 3], 0, 0.2, 0);
      const up = box(g, 0.66, 0.3, 0.66, 0xcfd4da, 0.1, 0.55, 0.05);
      const roof = box(g, 0.74, 0.04, 0.74, 0x6e747c, 0.1, 0.72, 0.05);
      box(g, 0.94, 0.04, 0.84, 0x8a9098, 0, 0.42, 0);
      const gl = glass(0x3d6a8c, 0.78), win = [];
      win.push(put(g, G.box, gl, -0.12, 0.2, 0.4, 0.5, 0.28, 0.02)); win.push(put(g, G.box, gl, 0.1, 0.56, 0.4, 0.5, 0.2, 0.02));
      box(g, 0.14, 0.3, 0.05, 0x242a32, 0.3, 0.15, 0.4);
      for (let i = 0; i < 3; i++) { const s = box(g, 0.18, 0.02, 0.26, 0x1f3550, -0.05 + i * 0.2, 0.77, 0.05); s.rotation.x = -0.35; }
      box(g, 0.2, 0.06, 0.14, 0x9aa0a8, 0.32, 0.76, -0.2);
      put(g, G.box, mat(0x7fb36a), -0.42, 0.04, 0.42, 0.12, 0.08, 0.12);
      return rig(g, { body, roofs: [roof], win, winMat: gl }, 0x9bd4ff, [0, 0.4, 0.5]);
    },
  };
  const buildHouse = (id, g, h) => (HOUSE[id] || HOUSE[FALLBACK_ERA])(g, h);

  function makeHouseB3d(h) {
    const g = new T.Group(), id = era(), e = Object.assign({ obj: g, h, era: id }, buildHouse(id, g, h));
    e.roofMat = e.roofs.length ? e.roofs[0].material : null;
    g.rotation.y = (h.v - 1) * 0.12; return e;
  }
  function updHouseB3d(e, h, t, night, season, look) {
    const id = look && look.eraId || FALLBACK_ERA;
    if (e.era !== id) {                                   // era advanced: rebuild this house in place
      disposeSprites(e.obj); e.obj.clear(); Object.assign(e, buildHouse(id, e.obj, h));
      e.roofMat = e.roofs.length ? e.roofs[0].material : null; e.era = id;
    }
    const on = night > 0.3 && h.occupants.length > 0;
    for (const w of e.win) w.material = on ? bmat(0xffd86b) : e.winMat;
    e.glow.visible = on; if (on) e.glow.material.opacity = 0.35 * night;
    const m = h.fire ? mat(0x2b2420) : season === 'Winter' ? mat(0xf2f6f8) : e.roofMat;
    for (const r of e.roofs) r.material = m;
    const smoke = h.heated && season === 'Winter' && !h.fire && id !== 'modern';
    e.puffs.forEach((s, i) => {
      s.visible = smoke; if (!smoke) return;
      const ph = ((t / 2400) + i / 3) % 1;
      s.position.set(0.22 + Math.sin(ph * 6 + i) * 0.06, 1.0 + ph * 0.9, -0.12); s.scale.setScalar(0.18 + ph * 0.3); s.material.opacity = 0.7 * (1 - ph);
    });
    e.flames.visible = e.fglow.visible = !!h.fire;
    if (h.fire) {
      e.flames.children.forEach((c, i) => { const f = 0.7 + 0.5 * Math.sin(t / 90 + i * 1.7); c.scale.set(0.14, 0.5 * f, 0.14); c.position.y = 0.85 + 0.25 * f; });
      e.fglow.material.opacity = 0.6 + 0.3 * Math.sin(t / 70);
    }
  }

  // ------------------------------------------------------------------ STOREHOUSE
  const STORE = {
    stone(g) { // pit store: earth mound, hide-and-pole roof
      put(g, G.hemi, tmat(stoneTex(0x7a6a58)), 0, 0.0, 0, 0.62, 0.42, 0.52).scale.x = 0.62;
      for (const s of [-1, 1]) { const r = box(g, 0.05, 0.05, 0.9, 0x5a3f22, s * 0.3, 0.3, 0); r.rotation.z = -s * 0.85; }
      box(g, 0.26, 0.28, 0.04, 0x1a120c, 0, 0.14, 0.42);
    },
    neo(g) { // thatched clay barn
      box(g, 1.0, 0.46, 0.8, 0xb09070, 0, 0.23, 0); tgable(g, thatchTex(0xc9b24a), 1.12, 0.5, 0.94, 0, 0.46, 0);
      box(g, 0.32, 0.36, 0.03, 0x5c3d22, 0, 0.18, 0.41);
    },
    bronze(g) { // timber barn
      tbox(g, plankTex(0xa88660), 1.02, 0.52, 0.82, 0, 0.26, 0); tgable(g, thatchTex(0xa68a45), 1.14, 0.46, 0.96, 0, 0.52, 0);
      box(g, 0.4, 0.4, 0.03, 0x5c3d22, 0, 0.2, 0.42); box(g, 0.44, 0.03, 0.04, 0x3b2510, 0, 0.4, 0.43);
    },
    iron(g) { // timber barn on a stone footing, tiled roof
      put(g, G.box, tmat(stoneTex(0x9a9288)), 0, 0.08, 0, 1.06, 0.16, 0.86); tbox(g, plankTex(0x9a7a56), 1.0, 0.42, 0.8, 0, 0.37, 0);
      tgable(g, tileTex(0xa0482a), 1.14, 0.46, 0.96, 0, 0.58, 0); box(g, 0.4, 0.38, 0.03, 0x4a2f1a, 0, 0.35, 0.41);
    },
    medieval(g) { // stone granary with steep roof and loading hatch
      tbox(g, stoneTex(0xa09080), 1.04, 0.58, 0.84, 0, 0.29, 0); tgable(g, tileTex(0xa23f36), 1.16, 0.56, 0.98, 0, 0.58, 0);
      box(g, 0.34, 0.4, 0.04, 0x4a2f1a, 0, 0.2, 0.43); put(g, G.arch, mat(0x4a2f1a), 0, 0.4, 0.43, 2.1, 1, 1.05); box(g, 0.14, 0.14, 0.04, 0x3b2510, 0, 0.72, 0.47);
    },
    industrial(g) { // brick warehouse, loading doors, chimney
      tbox(g, brickTex(0xb05a45, 0x8a5a4a), 1.08, 0.78, 0.88, 0, 0.39, 0); tgable(g, tileTex(0x4a4f58), 1.18, 0.3, 0.98, 0, 0.78, 0);
      box(g, 0.44, 0.5, 0.05, 0x2f3a34, 0, 0.25, 0.45); for (const x of [-0.36, 0.36]) box(g, 0.14, 0.2, 0.04, 0x9fd4ee, x, 0.52, 0.45);
      box(g, 0.1, 0.4, 0.1, 0x8a4a3a, 0.4, 1.0, -0.2);
    },
    modern(g) { // steel-and-glass distribution depot
      box(g, 1.06, 0.7, 0.88, 0xdadde0, 0, 0.35, 0); box(g, 1.1, 0.05, 0.92, 0x6e747c, 0, 0.72, 0);
      put(g, G.box, glass(0x9fd4ee, 0.62), -0.16, 0.5, 0.45, 0.56, 0.3, 0.02); box(g, 0.34, 0.46, 0.05, 0x3a4048, 0.28, 0.23, 0.45);
      box(g, 0.34, 0.02, 0.2, 0xc9c9c9, 0.28, 0.46, 0.55); for (const i of [0, 1, 2]) box(g, 0.2, 0.03, 0.28, 0x1f3550, -0.3 + i * 0.3, 0.76, -0.1).rotation.x = -0.3;
    },
  };
  function buildStore(g, id, e) {
    (STORE[id] || STORE[FALLBACK_ERA])(g);
    box(g, 0.04, 0.5, 0.04, 0x4a3a2a, 0.55, 0.25, 0.45);
    e.crates = [0, 1, 2, 3, 4, 5].map(i => box(g, 0.2, 0.2, 0.2, i % 2 ? 0xc9a04e : 0xe0b858, -0.62 + (i % 3) * 0.22, 0.1 + Math.floor(i / 3) * 0.2, 0.62));
    e.era = id;
  }
  function makeStoreB3d() { const g = new T.Group(), e = { obj: g }; buildStore(g, era(), e); return e; }
  function updStoreB3d(e, look) {
    const id = look && look.eraId || FALLBACK_ERA; if (!e || e.era === id) return;
    e.obj.clear(); buildStore(e.obj, id, e);
  }

  // ------------------------------------------------------------------ STRUCTURES  (era-banded)
  const flicker = (g, c, size, x, y, z, base, amp, rate) => { const s = glowSprite(g, c, size, x, y, z); return t => { s.material.opacity = base + amp * Math.sin(t / rate); }; };
  const band = (id, lo, hi) => ['stone', 'neo', 'bronze', 'iron', 'medieval', 'industrial', 'modern'].indexOf(id) <= hi && ['stone', 'neo', 'bronze', 'iron', 'medieval', 'industrial', 'modern'].indexOf(id) >= lo;
  const flag = (g, c, x, y, z) => box(g, 0.22, 0.12, 0.02, c, x, y, z);

  M.forge = () => {
    const g = new T.Group(), id = era();
    if (band(id, 0, 2)) { // open smithy
      box(g, 0.8, 0.22, 0.64, 0x6a6560, 0, 0.11, 0); put(g, G.hemi, tmat(stoneTex(0x6a6560)), 0, 0.22, 0, 0.36, 0.26, 0.3);
      lit(g, 0.2, 0.12, 0.05, 0xff7a22, -0.1, 0.2, 0.3); box(g, 0.2, 0.04, 0.1, 0x7a7e88, 0.28, 0.3, 0.44); box(g, 0.1, 0.18, 0.08, 0x4a4e58, 0.28, 0.14, 0.44);
      for (const x of [-0.38, 0.38]) box(g, 0.05, 0.6, 0.05, 0x5a3f22, x, 0.5, 0.3); gable(g, 0.9, 0.2, 0.7, 0x8a6a3a, 0, 0.8, 0.3);
      const f = flicker(g, 0xff7a22, 1.4, -0.1, 0.3, 0.4, 0.55, 0.3, 110); return { obj: g, upd: f };
    }
    if (band(id, 3, 4)) { // stone forge, chimney, bellows
      tbox(g, stoneTex(0x6a6f78), 0.84, 0.5, 0.7, 0, 0.25, 0); box(g, 0.92, 0.08, 0.78, 0x3a3e45, 0, 0.54, 0); box(g, 0.16, 0.6, 0.16, 0x4a4e56, 0.28, 0.88, -0.15);
      lit(g, 0.3, 0.16, 0.05, 0xff7a22, -0.12, 0.28, 0.36); put(g, G.hemi, mat(0x2a2a30), 0.3, 0.2, 0.5, 0.12, 0.1, 0.1); box(g, 0.2, 0.1, 0.16, 0x7a5a38, 0.3, 0.1, 0.5);
      box(g, 0.2, 0.04, 0.1, 0x7a7e88, -0.3, 0.36, 0.46);
      return { obj: g, upd: flicker(g, 0xff7a22, 1.6, -0.12, 0.35, 0.5, 0.55, 0.3, 110) };
    }
    tbox(g, brickTex(0x7a5448, 0x4a3230), 0.92, 0.66, 0.78, 0, 0.33, 0); gable(g, 1.0, 0.2, 0.84, 0x3f444c, 0, 0.66, 0); // factory
    box(g, 0.36, 0.26, 0.34, 0x4a4a52, -0.26, 0.6, -0.22); cyl(g, 0.1, 1.0, 0x6a4a40, 0.3, 1.1, -0.2); box(g, 0.2, 0.05, 0.2, 0x3a3030, 0.3, 1.62, -0.2);
    for (const x of [-0.25, 0.1]) box(g, 0.16, 0.18, 0.03, 0xffb060, x, 0.38, 0.4).material = bmat(0xffa040);
    box(g, 0.2, 0.34, 0.04, 0x2a2e34, 0.3, 0.17, 0.4);
    return { obj: g, upd: flicker(g, 0xff6020, 2.2, -0.26, 0.7, 0.0, 0.5, 0.4, 80) };
  };

  M.oven = () => {
    const g = new T.Group(), id = era();
    if (band(id, 0, 1)) { // clay dome
      box(g, 0.86, 0.12, 0.7, 0x8a7458, 0, 0.06, 0); put(g, G.hemi, mat(0xb5683f), 0, 0.12, 0, 0.42, 0.52, 0.36); lit(g, 0.24, 0.22, 0.05, 0x2a1a14, 0, 0.22, 0.31);
      cyl(g, 0.06, 0.2, 0x7a5a48, 0.18, 0.6, -0.1); return { obj: g, upd: flicker(g, 0xffa040, 0.9, 0, 0.22, 0.4, 0.5, 0.3, 130) };
    }
    if (band(id, 2, 4)) { // masonry bakehouse with shed roof
      tbox(g, stoneTex(0xa07e66), 0.9, 0.44, 0.76, 0, 0.22, 0); put(g, G.hemi, tmat(tileTex(0xb07248)), -0.08, 0.44, 0, 0.4, 0.36, 0.34);
      lit(g, 0.2, 0.18, 0.05, 0x2a1a14, -0.08, 0.26, 0.4); box(g, 0.13, 0.4, 0.13, 0x8a5a48, 0.26, 0.68, -0.14);
      box(g, 0.2, 0.03, 0.12, 0xe6c27a, 0.3, 0.46, 0.4);
      return { obj: g, upd: flicker(g, 0xffa040, 1.2, -0.08, 0.3, 0.44, 0.5, 0.3, 130) };
    }
    tbox(g, brickTex(0xb05a45, 0x8a5a4a), 0.9, 0.5, 0.76, 0, 0.25, 0); gable(g, 0.96, 0.2, 0.82, 0x4a4f58, 0, 0.5, 0); // industrial bakery
    box(g, 0.1, 0.55, 0.1, 0x8a4a3a, 0.3, 0.85, -0.18); lit(g, 0.22, 0.18, 0.04, 0xffa040, -0.22, 0.26, 0.39); box(g, 0.2, 0.34, 0.04, 0x2f3a34, 0.18, 0.17, 0.39);
    box(g, 0.2, 0.02, 0.1, 0xf3e6c8, -0.22, 0.4, 0.43);
    return { obj: g, upd: flicker(g, 0xffa040, 1.2, -0.22, 0.3, 0.44, 0.5, 0.3, 130) };
  };

  M.school = () => {
    const g = new T.Group(), id = era();
    if (band(id, 0, 2)) { // learning hut with banner
      box(g, 0.86, 0.46, 0.7, 0xd9c9a3, 0, 0.23, 0); tgable(g, thatchTex(0x7a5aa8), 0.98, 0.4, 0.82, 0, 0.46, 0);
      box(g, 0.14, 0.26, 0.03, 0x3b2f22, 0, 0.13, 0.36); for (const x of [-0.26, 0.26]) box(g, 0.14, 0.12, 0.03, 0x7fc4ee, x, 0.3, 0.36);
      box(g, 0.03, 0.46, 0.03, 0x6b4a2b, 0.5, 0.23, 0.38); const f = flag(g, 0x3b82d4, 0.6, 0.4, 0.38);
      return { obj: g, upd: t => { f.rotation.y = Math.sin(t / 300) * 0.3; } };
    }
    if (band(id, 3, 4)) { // scriptorium with bell tower
      tbox(g, stoneTex(0xd4c8b4), 0.92, 0.58, 0.78, 0, 0.29, 0); tgable(g, tileTex(0x7a5aa8), 1.02, 0.4, 0.88, 0, 0.58, 0);
      for (const x of [-0.3, 0.3]) { box(g, 0.14, 0.2, 0.04, 0x7fc4ee, x, 0.34, 0.4); put(g, G.arch, mat(0x7fc4ee), x, 0.44, 0.4, 0.9, 1, 1.05); }
      box(g, 0.16, 0.28, 0.03, 0x3b2f22, 0, 0.14, 0.4); tbox(g, stoneTex(0xc8beac), 0.2, 0.7, 0.2, 0.32, 0.82, -0.3); cone(g, 0.15, 0.24, 0x5c4a7a, 0.32, 1.29, -0.3);
      box(g, 0.1, 0.1, 0.03, 0xe0b858, 0.32, 1.0, -0.19); return { obj: g };
    }
    box(g, 0.94, 0.5, 0.8, 0xe3e6ea, 0, 0.25, 0); box(g, 0.7, 0.2, 0.6, 0xcfd4da, 0.1, 0.6, 0); box(g, 1.0, 0.04, 0.86, 0x6e747c, 0, 0.5, 0); box(g, 0.76, 0.04, 0.66, 0x6e747c, 0.1, 0.72, 0);
    put(g, G.box, glass(0x9fd4ee, 0.7), -0.1, 0.26, 0.41, 0.6, 0.34, 0.02); put(g, G.box, glass(0x9fd4ee, 0.7), 0.1, 0.6, 0.31, 0.5, 0.14, 0.02); box(g, 0.16, 0.34, 0.04, 0x2a2e34, 0.32, 0.17, 0.41);
    box(g, 0.02, 0.6, 0.02, 0x8a9098, 0.46, 0.8, 0.3); const f = flag(g, 0x3b82d4, 0.56, 1.0, 0.3);
    return { obj: g, upd: t => { f.rotation.y = Math.sin(t / 300) * 0.3; } };
  };

  M.well = () => {
    const g = new T.Group(), id = era();
    const water = () => put(g, G.cyl, bmat(0x2f6fb0), 0, 0.27, 0, 0.21, 0.02, 0.21, false);
    if (band(id, 0, 1)) { put(g, G.cyl, tmat(stoneTex(0x8a7a6a)), 0, 0.14, 0, 0.28, 0.28, 0.28); water(); for (const x of [-0.25, 0.25]) box(g, 0.05, 0.52, 0.05, 0x7a5a3a, x, 0.36, 0); box(g, 0.04, 0.04, 0.54, 0x6a4a2a, 0, 0.62, 0); box(g, 0.02, 0.2, 0.02, 0x4a3a2a, 0, 0.5, 0); return { obj: g }; }
    if (band(id, 2, 4)) { put(g, G.cyl, tmat(stoneTex(0x9a9ea6)), 0, 0.15, 0, 0.3, 0.3, 0.3); water(); for (const x of [-0.27, 0.27]) box(g, 0.05, 0.64, 0.05, 0x6b4a2b, x, 0.46, 0); gable(g, 0.72, 0.26, 0.52, 0xa0522d, 0, 0.78, 0).rotation.y = Math.PI / 2; box(g, 0.04, 0.04, 0.5, 0x4a3a2a, 0, 0.7, 0); cyl(g, 0.05, 0.1, 0x8a6a4a, 0, 0.58, 0); return { obj: g }; }
    cyl(g, 0.2, 0.06, 0x4a4e56, 0, 0.03, 0); cyl(g, 0.1, 0.56, 0x3d4852, 0, 0.3, 0); sph(g, 0.1, 0x3d4852, 0, 0.62, 0);
    box(g, 0.34, 0.05, 0.06, 0x2e3238, 0.12, 0.7, 0).rotation.z = 0.35; box(g, 0.07, 0.05, 0.16, 0x4a4e56, 0.1, 0.18, 0.12); put(g, G.cyl, bmat(0x2f6fb0), 0.1, 0.012, 0.26, 0.1, 0.02, 0.1, false);
    return { obj: g };
  };

  M.tower = () => {
    const g = new T.Group(), id = era();
    if (band(id, 0, 2)) { // timber lookout
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = box(g, 0.07, 1.3, 0.07, 0x6b4a2b, x * 0.28, 0.65, z * 0.28); p.rotation.z = -x * 0.04; p.rotation.x = z * 0.04; }
      for (const y of [0.4, 0.75]) { box(g, 0.56, 0.04, 0.04, 0x5a3f22, 0, y, 0.26); box(g, 0.56, 0.04, 0.04, 0x5a3f22, 0, y, -0.26); }
      box(g, 0.72, 0.08, 0.72, 0x8a6238, 0, 1.0, 0); tbox(g, plankTex(0x9a7140), 0.6, 0.3, 0.6, 0, 1.2, 0); cone(g, 0.56, 0.4, 0xa0522d, 0, 1.58, 0);
      box(g, 0.03, 0.4, 0.03, 0x4a3a2a, 0, 1.96, 0); const f = flag(g, 0xc0392b, 0.12, 2.06, 0); box(g, 0.05, 1.0, 0.05, 0x6b4a2b, 0, 0.5, 0.34).rotation.x = 0.22;
      return { obj: g, upd: t => { f.rotation.y = Math.sin(t / 300) * 0.3; } };
    }
    if (band(id, 3, 4)) { // stone keep
      tbox(g, stoneTex(0x8a8480), 0.74, 1.3, 0.74, 0, 0.65, 0); box(g, 0.86, 0.1, 0.86, 0x77726c, 0, 1.33, 0);
      for (let i = 0; i < 5; i++) for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const k = -0.34 + i * 0.17; box(g, 0.1, 0.16, 0.1, 0x77726c, dx ? dx * 0.4 : k, 1.46, dz ? dz * 0.4 : k); }
      put(g, G.box, mat(0x2a2220), 0, 0.17, 0.38, 0.2, 0.34, 0.04); put(g, G.arch, mat(0x2a2220), 0, 0.34, 0.38, 1.25, 1, 1.05);
      for (const x of [-0.2, 0.2]) box(g, 0.04, 0.2, 0.04, 0x1a1412, x, 0.8, 0.38); box(g, 0.03, 0.46, 0.03, 0x4a3a2a, 0, 1.7, 0); const f = flag(g, 0xc0392b, 0.12, 1.84, 0);
      return { obj: g, upd: t => { f.rotation.y = Math.sin(t / 280) * 0.35; } };
    }
    tbox(g, brickTex(0x8a8e98, 0x5e6268), 0.56, 1.3, 0.56, 0, 0.65, 0); box(g, 0.74, 0.07, 0.74, 0x9aa0a8, 0, 1.33, 0); box(g, 0.66, 0.26, 0.66, 0x8a9098, 0, 1.5, 0);
    put(g, G.box, glass(0x9fd4ee, 0.6), 0, 1.5, 0, 0.68, 0.18, 0.68); box(g, 0.7, 0.05, 0.7, 0x6a7080, 0, 1.66, 0);
    cyl(g, 0.012, 0.5, 0x6a7080, 0, 1.9, 0); const f = flag(g, 0x3b82d4, 0.12, 2.0, 0); box(g, 0.06, 1.2, 0.02, 0x4a4e56, 0, 0.6, 0.29);
    return { obj: g, upd: t => { f.rotation.y = Math.sin(t / 320) * 0.25; } };
  };

  // ------------------------------------------------------------------ MARKET STALL  (era-aware)
  // Each era builds a GROUP whose userData.awning is the canopy mesh (view3d tints it via STALL_AWNING).
  // Counter goods and structural details change per era.
  const STALL = {
    // Stone / Neolithic: a hide stretched over two forked sticks, goods are furs and berries
    stone(g) {
      // ground slab + forked-stick frame
      box(g, 1.0, 0.06, 0.56, 0x6b5a3a, 0, 0.03, 0);
      for (const [x, tilt] of [[-0.46, -0.14], [0.46, 0.14]]) {
        const post = box(g, 0.04, 0.52, 0.04, 0x5a3f22, x, 0.3, 0.22); post.rotation.z = tilt;
        box(g, 0.04, 0.22, 0.04, 0x5a3f22, x + tilt * 0.6, 0.6, 0.22).rotation.z = tilt * 2.2;
        box(g, 0.04, 0.22, 0.04, 0x5a3f22, x + tilt * 0.4, 0.7, 0.22).rotation.z = tilt * 0.4;
      }
      // hide canopy
      const c = box(g, 1.08, 0.04, 0.62, 0x8a6a48, 0, 0.76, 0.08); c.rotation.x = 0.22; g.userData.awning = c;
      // goods: fur pile, berry clusters
      put(g, G.hemi, mat(0x7a5a3a), -0.3, 0.06, 0.1, 0.2, 0.12, 0.2);
      for (const [x, z] of [[0.1, 0.05], [0.28, -0.06], [0.18, 0.14]]) sph(g, 0.045, 0xd6384a, x, 0.12, z);
    },
    neo(g) {
      // clay-brick slab table, reed-mat awning on two poles
      box(g, 1.1, 0.08, 0.6, 0xb09070, 0, 0.04, 0);
      box(g, 1.0, 0.26, 0.52, 0xa07860, 0, 0.21, 0);
      for (const x of [-0.52, 0.52]) box(g, 0.05, 0.62, 0.05, 0x8a6040, x, 0.57, 0.26);
      const c = box(g, 1.18, 0.04, 0.72, 0xc9a86a, 0, 0.84, 0.04); c.rotation.x = 0.18; g.userData.awning = c;
      // goods: grain mound, clay pots
      box(g, 0.26, 0.1, 0.2, 0xe0c870, -0.28, 0.37, 0.1);
      cyl(g, 0.07, 0.18, 0x9a6a48, 0.14, 0.44, 0.0); cyl(g, 0.06, 0.14, 0x8a5a3a, 0.3, 0.42, 0.08);
    },
    bronze(g) {
      // timber-plank counter, woven canopy on two posts with crossbar
      tbox(g, plankTex(0x9a7a56), 1.1, 0.34, 0.6, 0, 0.17, 0);
      for (const x of [-0.54, 0.54]) box(g, 0.06, 0.7, 0.06, 0x6e4a26, x, 0.53, 0.28);
      box(g, 1.2, 0.04, 0.04, 0x5a3a18, 0, 0.72, 0.28);
      const c = box(g, 1.28, 0.04, 0.78, 0xd9b45a, 0, 0.82, 0.02); c.rotation.x = 0.2; g.userData.awning = c;
      // goods: bronze ingots, amphorae
      box(g, 0.16, 0.06, 0.08, 0xc0903a, -0.3, 0.4, 0.12);
      for (const [x, c2] of [[0.1, 0x9a6a50], [0.32, 0xa07048]]) { const j = cyl(g, 0.07, 0.2, c2, x, 0.45, 0.06); j.scale.y = 1.5; }
    },
    iron(g) {
      // stone-slab counter on cut-stone legs, linen canopy
      tbox(g, stoneTex(0xb0a89c), 1.14, 0.06, 0.62, 0, 0.38, 0);
      for (const x of [-0.48, 0, 0.48]) box(g, 0.1, 0.38, 0.1, 0x8a8480, x, 0.19, -0.22);
      for (const x of [-0.54, 0.54]) box(g, 0.07, 0.52, 0.07, 0x6e4a2c, x, 0.68, 0.28);
      const c = box(g, 1.26, 0.04, 0.8, 0xb5473a, 0, 0.88, 0.02); c.rotation.x = 0.2; g.userData.awning = c;
      // goods: iron tools, fish, bread
      box(g, 0.22, 0.04, 0.08, 0x6a6a70, -0.3, 0.44, 0.12);
      box(g, 0.14, 0.08, 0.1, 0xe6c27a, 0.16, 0.42, 0.08); box(g, 0.1, 0.06, 0.14, 0x5a9ab0, 0.32, 0.42, 0.06);
    },
    medieval(g) {
      // half-timbered stall with hanging sign, cloth canopy, varied market goods
      tbox(g, timberTex(0xd4c8a0), 1.14, 0.42, 0.64, 0, 0.21, 0);
      box(g, 0.92, 0.06, 0.68, 0x4a3018, 0, 0.02, 0);
      for (const x of [-0.54, 0.54]) box(g, 0.06, 0.88, 0.06, 0x3b2510, x, 0.72, 0.3);
      box(g, 1.2, 0.05, 0.05, 0x3b2510, 0, 0.9, 0.3);
      const c = box(g, 1.32, 0.04, 0.88, 0xa83a3a, 0, 1.02, 0.02); c.rotation.x = 0.22; g.userData.awning = c;
      // hanging sign
      box(g, 0.18, 0.14, 0.03, 0xd9b56a, 0.0, 0.78, 0.32).rotation.y = 0;
      box(g, 0.02, 0.1, 0.02, 0x3b2510, 0.08, 0.85, 0.32); box(g, 0.02, 0.1, 0.02, 0x3b2510, -0.08, 0.85, 0.32);
      // goods: loaves, cloth bolts, barrel
      box(g, 0.14, 0.1, 0.14, 0xe6c27a, -0.28, 0.47, 0.1); box(g, 0.1, 0.08, 0.24, 0x6a4ad0, 0.1, 0.46, 0.08);
      cyl(g, 0.1, 0.22, 0x7a5a38, 0.36, 0.46, 0.06);
    },
    industrial(g) {
      // brick-and-iron market stall with awning frame, crates + canned goods
      tbox(g, brickTex(0xb05a45, 0x8a5a4a), 1.16, 0.44, 0.66, 0, 0.22, 0);
      box(g, 1.18, 0.06, 0.7, 0x5a5a5a, 0, 0.02, 0);
      for (const x of [-0.56, 0.56]) { box(g, 0.06, 1.0, 0.06, 0x4a4a52, x, 0.72, 0.3); box(g, 0.04, 0.08, 0.04, 0x8a8a90, x, 1.08, 0.3); }
      box(g, 1.26, 0.04, 0.04, 0x7a7a82, 0, 1.04, 0.3);
      const c = box(g, 1.34, 0.04, 0.9, 0x3d6b8a, 0, 1.12, 0.02); c.rotation.x = 0.2; g.userData.awning = c;
      // goods: stacked crates, tins
      box(g, 0.2, 0.2, 0.2, 0xb08040, -0.3, 0.55, 0.08); box(g, 0.2, 0.2, 0.2, 0x9a7030, -0.05, 0.55, 0.08);
      for (const [x] of [[-0.28], [0.28]]) cyl(g, 0.06, 0.12, 0x8a9098, x, 0.5, 0.14);
    },
    modern(g) {
      // aluminium-frame market stall with banner, packaged goods
      box(g, 1.18, 0.42, 0.68, 0xdadde0, 0, 0.21, 0);
      box(g, 1.2, 0.05, 0.72, 0x6e747c, 0, 0.02, 0);
      for (const x of [-0.56, 0.56]) { box(g, 0.04, 1.1, 0.04, 0xa0a4ac, x, 0.77, 0.3); cyl(g, 0.06, 0.04, 0x9aa0a8, x, 1.34, 0.3).rotation.z = Math.PI / 2; }
      box(g, 1.24, 0.03, 0.04, 0x9aa0a8, 0, 1.32, 0.3);
      const c = box(g, 1.32, 0.04, 0.96, 0x2f9d8f, 0, 1.38, 0.02); c.rotation.x = 0.18; g.userData.awning = c;
      // banner
      const f = box(g, 0.56, 0.2, 0.02, 0x3b82d4, 0, 1.16, 0.32);
      // goods: packaged boxes, produce
      box(g, 0.18, 0.12, 0.18, 0xf0f4f8, -0.28, 0.47, 0.1); box(g, 0.22, 0.08, 0.16, 0x4fa8f2, 0.08, 0.46, 0.1);
      sph(g, 0.06, 0x6aa84f, 0.32, 0.49, 0.1); sph(g, 0.05, 0xe8584a, 0.22, 0.48, 0.14);
      return f; // returned so view can wave the banner — not used currently but available
    },
  };
  function makeStallB3d(eraId) {
    const id = eraId || era();
    const g = new T.Group();
    (STALL[id] || STALL.medieval)(g);
    return g;
  }

  // ------------------------------------------------------------------ install
  view.makeHouseFn = makeHouseB3d;
  view.updHouseFn = updHouseB3d;
  view.makeStoreFn = makeStoreB3d;
  view.updStoreFn = updStoreB3d;
  view.makeStallFn = makeStallB3d;
})();
