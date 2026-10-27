/* ==========================================================================
   SMALL WORLD - 3D view (three.js).  Renders the same World as ui.js's 2D canvas.
   - diorama terrain with lake, flood water, skirt, clouds, snow, day/night sky + sun shadows
   - low-poly models for houses, structs (forge/oven/school/well/tower), animals, raiders, people
   - orbit camera: drag = rotate, right-drag / shift-drag = pan, wheel = zoom, double-click villager = follow
   mods/buildings3d.js plugs era-specific procedural buildings in via view.makeHouseFn/updHouseFn/makeStoreFn/updStoreFn + view.look
   Mods can add/override 3D models through API.models3d[kind] = (T, struct, world) => { obj, upd?(t, world, night) }
   ========================================================================== */
(function () {
  'use strict';
  const API = window.SmallWorld, T = window.THREE;
  if (!API || !T) return;
  const { W, H } = API;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const X = x => x - W / 2, Z = y => y - H / 2;
  const angLerp = (a, b, t) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

  const SKIN = [0xf3d2b3, 0xe2b48b, 0xc68c62, 0x8d5a3b];
  const HAIR = [0x2b1d12, 0x5a3a1e, 0xa06a2c, 0xd8b25a, 0x7d7d7d];
  const GRASS = { Spring: [96, 158, 74], Summer: [104, 168, 78], Autumn: [162, 142, 72], Winter: [226, 234, 240] };
  const SKY = { // [top, bottom] by season (daytime)
    Spring: [0x6fb7ee, 0xd3ebff], Summer: [0x4fa8f2, 0xcbe8ff], Autumn: [0x8fb0cf, 0xf0dfc4], Winter: [0x9fb2c3, 0xe9eff3],
  };
  const NIGHT = [0x050918, 0x1a2346];

  // ------------------------------------------------------------------ view object
  const view = {
    available: false, active: false, follow: false,
    attach, render, setActive, reset, setFollow,
  };
  API.view3d = view;
  API.models3d = API.models3d || {};

  let host, stage, canvas, renderer, scene, camera, labelEl;
  let world = null, dyn = null, terrainGroup = null, tSig = '';
  const cam = { theta: 0.35, phi: 0.92, r: 44, tx: 0, tz: 1, moved: false };
  const Hh = new Float32Array((W + 1) * (H + 1));
  let sun, hemi, clouds = [], snow, snowPos, glowTex, puffTex;
  let waterMesh = null, waterTiles = [], terrainMesh = null;
  const maps = { houses: new Map(), structs: new Map(), sites: new Map(), agents: new Map(), deer: new Map(), wolves: new Map(), raiders: new Map(), flames: new Map() };
  let inst = null, extra = {};
  let selRing, stall, store, lastSeason = '', lastT = 0, skyKey = '';
  const dummy = new T.Object3D(), tmpC = new T.Color();

  // ------------------------------------------------------------------ geometry & material helpers
  const mats = {};
  function mat(c, o) { const k = c + (o ? JSON.stringify(o) : ''); return mats[k] || (mats[k] = new T.MeshLambertMaterial(Object.assign({ color: c }, o))); }
  const basic = {};
  function bmat(c, o) { const k = c + (o ? JSON.stringify(o) : ''); return basic[k] || (basic[k] = new T.MeshBasicMaterial(Object.assign({ color: c }, o))); }
  const G = {
    box: new T.BoxGeometry(1, 1, 1),
    boxTop: new T.BoxGeometry(1, 1, 1).translate(0, -0.5, 0),
    cyl6: new T.CylinderGeometry(1, 1, 1, 7), cone4: new T.ConeGeometry(1, 1, 4), cone7: new T.ConeGeometry(1, 1, 7),
    sph: new T.SphereGeometry(1, 10, 8), cap: new T.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    ico: new T.IcosahedronGeometry(1, 0), plane: new T.PlaneGeometry(1, 1).translate(0.5, 0, 0),
    trunk: new T.CylinderGeometry(0.06, 0.09, 0.4, 6).translate(0, 0.2, 0), ring: new T.RingGeometry(0.24, 0.31, 28).rotateX(-Math.PI / 2),
    crop: new T.ConeGeometry(0.05, 0.3, 4).translate(0, 0.15, 0), soil: new T.BoxGeometry(0.94, 0.07, 0.94).translate(0, 0.035, 0),
    edges: new T.EdgesGeometry(new T.BoxGeometry(0.9, 0.5, 0.9)).translate(0, 0.25, 0),
  };
  function put(parent, geo, m, x, y, z, sx, sy, sz, shadow) {
    const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    o.castShadow = shadow !== false; o.receiveShadow = true; parent.add(o); return o;
  }
  const box = (p, w, h, d, c, x, y, z) => put(p, G.box, mat(c), x, y, z, w, h, d);
  const cyl = (p, r, h, c, x, y, z) => put(p, G.cyl6, mat(c), x, y, z, r, h, r);
  function glowSprite(color, size) {
    const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    s.scale.set(size, size, 1); return s;
  }
  function makeTextures() {
    const mk = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')); return new T.CanvasTexture(c); };
    glowTex = mk(x => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
    puffTex = mk(x => { const g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  }

  // ------------------------------------------------------------------ terrain
  function hAt(x, y) {
    x = clamp(x, 0, W - 1e-6); y = clamp(y, 0, H - 1e-6);
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, i = iy * (W + 1) + ix;
    return Hh[i] * (1 - fx) * (1 - fy) + Hh[i + 1] * fx * (1 - fy) + Hh[i + W + 1] * (1 - fx) * fy + Hh[i + W + 2] * fx * fy;
  }
  function buildTerrain(w, season) {
    terrainGroup.clear(); waterTiles = [];
    const T0 = w.terrain, vw = W + 1;
    // era index (0=stone → 6=modern) drives terrain height roughness + colour richness
    const eraS = API.eras && API.eras.state(w);
    const ei = eraS ? eraS.era : 0;
    // Stone/Neolithic: rougher, more jagged heights; later eras: smoother (land is cultivated)
    const roughness = 0.08 + Math.max(0, (3 - ei) * 0.025);   // 0.155 stone → 0.08 modern
    const detailAmp = Math.max(0, (4 - ei) * 0.018);           // large humps only in early eras
    for (let vy = 0; vy <= H; vy++) for (let vx = 0; vx <= W; vx++) {
      let wn = 0, n = 0;
      for (let k = 0; k < 4; k++) {
        const tx = vx - 1 + (k & 1), ty = vy - 1 + (k >> 1);
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        n++; if (T0[ty * W + tx] === 1) wn++;
      }
      const noise = 0.05 + (hash(vx, vy) - 0.5) * roughness * 2 + Math.sin(vx * 0.4) * Math.cos(vy * 0.33) * (0.07 + detailAmp);
      Hh[vy * vw + vx] = (n && wn === n) ? -0.34 : wn ? -0.14 : noise;
    }
    const g = GRASS[season], pos = [], col = [];
    const vtx = (x, y) => [x, Hh[y * vw + x], y];
    const tri = (a, b, c, color) => { for (const p of [a, b, c]) { pos.push(p[0] - W / 2, p[1], p[2] - H / 2); col.push(color.r, color.g, color.b); } };
    // Era-specific ground colour tinting: early=dull muddy, later=richer greens, modern=bright
    // These are additive RGB offsets applied on top of GRASS
    const ERA_TINT = [
      [-14, -10, -8],   // 0 stone: muted grey-brown
      [-8,  -4,  -4],   // 1 neo: still a bit dull
      [-4,  -2,  -3],   // 2 bronze: starting to green up
      [0,    2,   0],   // 3 iron: neutral
      [4,    6,   2],   // 4 medieval: richer greens
      [-2,   2,  -4],   // 5 industrial: slight soot, less vibrant
      [6,   10,   4],   // 6 modern: bright, maintained landscape
    ];
    const tint = ERA_TINT[ei] || ERA_TINT[3];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = T0[y * W + x], c = new T.Color();
      if (t === 1) {
        let wn = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && T0[ny * W + nx] === 1) wn++; }
        c.set(wn === 4 ? 0x2d5878 : 0x86a18a);
      } else {
        const j = Math.floor((hash(x, y) - 0.5) * 16);
        c.setRGB(
          clamp(g[0] + j + tint[0], 0, 255) / 255,
          clamp(g[1] + j + tint[1], 0, 255) / 255,
          clamp(g[2] + j + tint[2], 0, 255) / 255
        );
        if (t === 2) c.lerp(new T.Color(0x6f6a4a), 0.45);
      }
      const a = vtx(x, y), b = vtx(x + 1, y), cc = vtx(x + 1, y + 1), d = vtx(x, y + 1);
      tri(a, d, b, c); tri(b, d, cc, c);
      if (t >= 1) waterTiles.push({ x, y, flood: t === 2 });
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    terrainMesh = new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: true }));
    terrainMesh.receiveShadow = true; terrainGroup.add(terrainMesh);

    // skirt around the diorama
    const sp = [], sc = [], top = new T.Color(0x7b5a38), bot = new T.Color(0x35241a), Y0 = -1.7;
    const quad = (p0, p1) => {
      const q = [[p0[0], p0[1], p0[2], top], [p1[0], p1[1], p1[2], top], [p1[0], Y0, p1[2], bot], [p0[0], p0[1], p0[2], top], [p1[0], Y0, p1[2], bot], [p0[0], Y0, p0[2], bot]];
      for (const v of q) { sp.push(v[0], v[1], v[2]); sc.push(v[3].r, v[3].g, v[3].b); }
    };
    for (let x = 0; x < W; x++) {
      quad([x - W / 2, Hh[x], -H / 2], [x + 1 - W / 2, Hh[x + 1], -H / 2]);
      quad([x - W / 2, Hh[H * vw + x], H / 2], [x + 1 - W / 2, Hh[H * vw + x + 1], H / 2]);
    }
    for (let y = 0; y < H; y++) {
      quad([-W / 2, Hh[y * vw], y - H / 2], [-W / 2, Hh[(y + 1) * vw], y + 1 - H / 2]);
      quad([W / 2, Hh[y * vw + W], y - H / 2], [W / 2, Hh[(y + 1) * vw + W], y + 1 - H / 2]);
    }
    const sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new T.Float32BufferAttribute(sc, 3)); sg.computeVertexNormals();
    terrainGroup.add(new T.Mesh(sg, new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide })));

    // water
    waterMesh = null;
    if (waterTiles.length) {
      const wg = new T.BufferGeometry();
      wg.setAttribute('position', new T.BufferAttribute(new Float32Array(waterTiles.length * 18), 3));
      waterMesh = new T.Mesh(wg, new T.MeshPhongMaterial({ color: season === 'Winter' ? 0xbfe0ee : 0x3f86c4, specular: 0xaaccee, shininess: 70, transparent: true, opacity: season === 'Winter' ? 0.92 : 0.8 }));
      waterMesh.receiveShadow = true; terrainGroup.add(waterMesh);
      animWater(0);
    }
  }
  function animWater(t) {
    if (!waterMesh) return;
    const p = waterMesh.geometry.attributes.position.array, still = lastSeason === 'Winter';
    const wy = (vx, vy, base) => base + (still ? 0 : Math.sin(vx * 1.7 + t * 0.0016) * 0.018 + Math.cos(vy * 1.9 + t * 0.0013) * 0.018);
    let i = 0;
    for (const w of waterTiles) {
      const base = w.flood ? 0.1 : -0.1, x = w.x, y = w.y;
      const a = [x, y, wy(x, y, base)], b = [x + 1, y, wy(x + 1, y, base)], c = [x + 1, y + 1, wy(x + 1, y + 1, base)], d = [x, y + 1, wy(x, y + 1, base)];
      for (const v of [a, d, b, b, d, c]) { p[i++] = v[0] - W / 2; p[i++] = v[2]; p[i++] = v[1] - H / 2; }
    }
    waterMesh.geometry.attributes.position.needsUpdate = true;
    waterMesh.geometry.computeVertexNormals();
  }

  // ------------------------------------------------------------------ instanced static scenery
  function mkInst(geo, material, cap, shadow, recv) {
    const m = new T.InstancedMesh(geo, material, cap); m.count = 0; m.castShadow = shadow; m.receiveShadow = !!recv; m.frustumCulled = false; dyn.add(m); return m;
  }
  function setI(m, i, x, y, z, sx, sy, sz, ry) {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, ry || 0, 0); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
  }
  function buildInstances() {
    inst = {
      trunk: mkInst(G.trunk, mat(0x5c3d22), 700, true),
      can1: mkInst(G.ico, mat(0xffffff, { flatShading: true }), 700, true),
      can2: mkInst(G.ico, mat(0xffffff, { flatShading: true }), 700, true),
      bush: mkInst(G.sph, mat(0xffffff), 60, true),
      berry: mkInst(G.sph, mat(0xd6384a), 200, false),
      soil: mkInst(G.soil, mat(0xffffff), 260, false, true),
      crop: mkInst(G.crop, mat(0xffffff), 2400, false),
      gv1: mkInst(G.box, mat(0x9aa0a8), 90, true), gv2: mkInst(G.box, mat(0x9aa0a8), 90, true),
      post: mkInst(G.cyl6, mat(0x7b5530), 800, true),
    };
  }
  // palisade look per era: post colour, radius, height factor, spacing
  // stone/neo: sharpened stakes; bronze: timber posts; iron: heavier timber; medieval: stone battlement blocks;
  // industrial: brick pillars; modern: concrete posts
  const WALL_STYLE = {
    default:    { col: 0x7b5530, r: 0.045, h: 1.00, step: 0.45 },
    stone:      { col: 0x6b5a3a, r: 0.030, h: 0.90, step: 0.55 },   // crude sharpened stakes
    neo:        { col: 0x7a6040, r: 0.035, h: 0.95, step: 0.50 },   // trimmed wooden stakes
    bronze:     { col: 0x6e4a26, r: 0.045, h: 1.00, step: 0.42 },   // squared timber posts
    iron:       { col: 0x5a4028, r: 0.060, h: 1.10, step: 0.35 },   // heavy timber palisade
    medieval:   { col: 0x8f949c, r: 0.150, h: 1.15, step: 0.30 },   // stone battlement blocks
    industrial: { col: 0x9c4f3a, r: 0.140, h: 1.10, step: 0.30 },   // brick pillars
    modern:     { col: 0xb9bdc4, r: 0.130, h: 1.20, step: 0.28 },   // concrete posts
  };
  function syncStatic(w, season, force) {
    const col = season === 'Winter' ? [0xe7eff2, 0xc8d8dc] : season === 'Autumn' ? [0xc97a2b, 0xa85f1f] : [0x3f8a3a, 0x2f6e2d];
    const I = inst;
    // trees
    const n = Math.min(w.trees.length, 700);
    for (let i = 0; i < n; i++) {
      const t = w.trees[i], gy = hAt(t.x + 0.5, t.y + 0.5), x = X(t.x + 0.5), z = Z(t.y + 0.5), ry = hash(t.x, t.y) * 6.28;
      const s = 0.8 + t.v * 0.1 + t.wood * 0.03;
      if (t.wood > 0) {
        setI(I.trunk, i, x, gy, z, s, s, s, ry);
        setI(I.can1, i, x, gy + 0.5 * s, z, 0.36 * s, 0.32 * s, 0.36 * s, ry);
        setI(I.can2, i, x + 0.02, gy + 0.82 * s, z, 0.25 * s, 0.24 * s, 0.25 * s, ry + 1);
      } else {
        setI(I.trunk, i, x, gy, z, 0.8, 0.45, 0.8, ry); setI(I.can1, i, x, gy, z, 0, 0, 0); setI(I.can2, i, x, gy, z, 0, 0, 0);
      }
      if (force) {
        const k = 0.88 + t.v * 0.07;
        I.can1.setColorAt(i, tmpC.set(col[1]).multiplyScalar(k)); I.can2.setColorAt(i, tmpC.set(col[0]).multiplyScalar(k));
      }
    }
    I.trunk.count = I.can1.count = I.can2.count = n;
    for (const m of [I.trunk, I.can1, I.can2]) m.instanceMatrix.needsUpdate = true;
    if (force) { I.can1.instanceColor.needsUpdate = true; I.can2.instanceColor.needsUpdate = true; }
    // bushes + berries
    let nb = 0;
    w.bushes.forEach((b, i) => {
      const gy = hAt(b.x + 0.5, b.y + 0.5), x = X(b.x + 0.5), z = Z(b.y + 0.5);
      setI(I.bush, i, x, gy + 0.18, z, 0.26, 0.2, 0.26, hash(b.x, b.y) * 6);
      if (force) I.bush.setColorAt(i, tmpC.set(season === 'Winter' ? 0xcfdde0 : 0x2f7a3a));
      for (let j = 0; j < b.food && nb < 200; j++) {
        const a = j * 2.1 + hash(b.x, b.y) * 6;
        setI(I.berry, nb++, x + Math.cos(a) * 0.17, gy + 0.26 + (j % 2) * 0.05, z + Math.sin(a) * 0.17, 0.045, 0.045, 0.045);
      }
    });
    I.bush.count = Math.min(60, w.bushes.length); I.berry.count = nb;
    I.bush.instanceMatrix.needsUpdate = I.berry.instanceMatrix.needsUpdate = true; if (force && I.bush.instanceColor) I.bush.instanceColor.needsUpdate = true;
    // plots + crops
    let nc = 0;
    const np = Math.min(260, w.plots.length);
    for (let i = 0; i < np; i++) {
      const p = w.plots[i], gy = hAt(p.x + 0.5, p.y + 0.5), x = X(p.x + 0.5), z = Z(p.y + 0.5);
      const f = clamp(((p.fert == null ? 1 : p.fert) - 0.2) / 0.8, 0, 1);
      setI(I.soil, i, x, gy - 0.02, z, 1, 1, 1);
      I.soil.setColorAt(i, season === 'Winter' ? tmpC.set(0xd9d4cc) : tmpC.setRGB((150 - f * 28) / 255, (125 - f * 35) / 255, (92 - f * 34) / 255));
      if (p.state === 'empty') continue;
      const hgt = p.state === 'ready' ? 1 : 0.25 + p.p * 0.6;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        if (nc >= 2400) break;
        setI(I.crop, nc, x - 0.28 + a * 0.28, gy + 0.05, z - 0.28 + b * 0.28, 1, hgt * 1.6, 1);
        I.crop.setColorAt(nc, p.state === 'ready' ? tmpC.set(0xe8c43c) : tmpC.setRGB((90 - p.p * 30) / 255, (150 + p.p * 20) / 255, 60 / 255));
        nc++;
      }
    }
    I.soil.count = np; I.crop.count = nc;
    I.soil.instanceMatrix.needsUpdate = I.crop.instanceMatrix.needsUpdate = true;
    if (I.soil.instanceColor) I.soil.instanceColor.needsUpdate = true; if (I.crop.instanceColor) I.crop.instanceColor.needsUpdate = true;
    // graves
    const gn = Math.min(90, w.graves.length);
    for (let i = 0; i < gn; i++) {
      const g = w.graves[i], gy = hAt(g.x + 0.5, g.y + 0.5), x = X(g.x + 0.5), z = Z(g.y + 0.5);
      setI(I.gv1, i, x, gy + 0.17, z, 0.05, 0.34, 0.05); setI(I.gv2, i, x, gy + 0.25, z, 0.2, 0.05, 0.05);
    }
    I.gv1.count = I.gv2.count = gn; I.gv1.instanceMatrix.needsUpdate = I.gv2.instanceMatrix.needsUpdate = true;
    // palisade around the village
    const lvl = (w.m.def && w.m.def.wall) || 0;
    let x0 = w.store.x, x1 = w.store.x, y0 = w.store.y, y1 = w.store.y;
    for (const h of w.houses) { x0 = Math.min(x0, h.x); x1 = Math.max(x1, h.x); y0 = Math.min(y0, h.y); y1 = Math.max(y1, h.y); }
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(W - 1, x1 + 3); y1 = Math.min(H - 1, y1 + 3);
    const wst = WALL_STYLE[view.look ? view.look.eraId : ''] || WALL_STYLE.default;
    const key = lvl + '|' + x0 + x1 + y0 + y1 + '|' + wst.col;
    if (extra.wallKey !== key) {
      extra.wallKey = key; let k = 0;
      if (lvl) {
        const ph = (0.35 + lvl * 0.14) * wst.h, r = wst.r;
        I.post.material = mat(wst.col);
        const add = (x, z) => { if (k < 800) setI(I.post, k++, X(x), hAt(x, z) + ph / 2, Z(z), r, ph, r); };
        for (let x = x0; x <= x1; x += wst.step) { add(x, y0); add(x, y1); }
        for (let y = y0; y <= y1; y += wst.step) { add(x0, y); add(x1, y); }
      }
      I.post.count = k; I.post.instanceMatrix.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ syncing dynamic entities
  function syncMap(map, list, make, upd, parent) {
    const seen = new Set();
    for (const o of list) {
      seen.add(o);
      let e = map.get(o);
      if (!e) { e = make(o); if (!e) continue; map.set(o, e); parent.add(e.obj); if (e.bar) overlay.add(e.bar); }
      if (upd) upd(e, o);
    }
    for (const [o, e] of map) if (!seen.has(o)) { parent.remove(e.obj); if (e.bar) overlay.remove(e.bar); map.delete(o); }
  }
  let overlay;

  // ------------------------------------------------------------------ models
  // Optional hooks (set by mods/buildings3d.js): view.makeHouseFn(h) / view.updHouseFn(...) / view.makeStoreFn() / view.updStoreFn(store, look).
  // view.look is the current era look ({wall, roof, eraId}) or null; it is refreshed at the start of every render().
  function makeHouse(h) {
    if (view.makeHouseFn) {
      const e = view.makeHouseFn(h);
      e.obj.position.set(X(h.x + 0.5), hAt(h.x + 0.5, h.y + 0.5), Z(h.y + 0.5));
      return e;
    }
    const g = new T.Group(), e = { obj: g, h };
    e.body = box(g, 0.8, 0.5, 0.7, [0xc8ab80, 0xb99a72, 0xd3b88f][h.v % 3], 0, 0.25, 0);
    e.roof = put(g, G.cone4, mat(0xa23f36), 0, 0.73, 0, 0.66, 0.46, 0.66); e.roof.rotation.y = Math.PI / 4;
    box(g, 0.14, 0.28, 0.03, 0x5c3d22, 0, 0.14, 0.36);
    e.win = [box(g, 0.14, 0.12, 0.03, 0x8fb4d0, -0.24, 0.3, 0.36), box(g, 0.14, 0.12, 0.03, 0x8fb4d0, 0.24, 0.3, 0.36)];
    box(g, 0.1, 0.3, 0.1, 0x6b6f76, 0.22, 0.8, -0.12);
    e.glow = glowSprite(0xffc866, 2.2); e.glow.position.set(0, 0.45, 0.5); e.glow.visible = false; g.add(e.glow);
    e.puffs = [0, 1, 2].map(() => { const s = new T.Sprite(new T.SpriteMaterial({ map: puffTex, color: 0xdddddd, transparent: true, depthWrite: false })); s.visible = false; g.add(s); return s; });
    e.flames = new T.Group(); e.flames.visible = false; g.add(e.flames);
    for (let i = 0; i < 4; i++) { const c = put(e.flames, G.cone7, bmat(i % 2 ? 0xffd34a : 0xff6a1f), (i - 1.5) * 0.2, 0.9, (i % 2 - 0.5) * 0.2, 0.14, 0.5, 0.14, false); }
    e.fglow = glowSprite(0xff8a30, 3); e.fglow.position.set(0, 0.8, 0); e.fglow.visible = false; g.add(e.fglow);
    g.position.set(X(h.x + 0.5), hAt(h.x + 0.5, h.y + 0.5), Z(h.y + 0.5)); g.rotation.y = (h.v - 1) * 0.12;
    return e;
  }
  function updHouse(e, h, t, night, season, look) {
    // Allow buildings3d.js (or any mod) to fully override house update
    if (view.updHouseFn) { view.updHouseFn(e, h, t, night, season, look); return; }
    const lit = night > 0.3 && h.occupants.length > 0;
    for (const wmesh of e.win) wmesh.material = lit ? bmat(0xffd86b) : mat(0x8fb4d0);
    e.glow.visible = lit; if (lit) e.glow.material.opacity = 0.35 * night;
    if (look) e.body.material = mat(look.wall);
    e.roof.material = h.fire ? mat(0x2b2420) : season === 'Winter' ? mat(0xf2f6f8) : mat(look ? look.roof : [0xa23f36, 0x8f4a2b, 0xb4533f][h.v % 3]);
    const smoke = h.heated && season === 'Winter' && !h.fire;
    e.puffs.forEach((s, i) => {
      s.visible = smoke; if (!smoke) return;
      const ph = ((t / 2400) + i / 3) % 1;
      s.position.set(0.22 + Math.sin(ph * 6 + i) * 0.06, 0.95 + ph * 0.9, -0.12); s.scale.setScalar(0.18 + ph * 0.3); s.material.opacity = 0.7 * (1 - ph);
    });
    e.flames.visible = e.fglow.visible = !!h.fire;
    if (h.fire) {
      e.flames.children.forEach((c, i) => { const f = 0.7 + 0.5 * Math.sin(t / 90 + i * 1.7); c.scale.set(0.14, 0.5 * f, 0.14); c.position.y = 0.85 + 0.25 * f; });
      e.fglow.material.opacity = 0.6 + 0.3 * Math.sin(t / 70);
    }
  }
  function makeStore() {
    // Allow buildings3d.js to supply era-aware storehouse
    if (view.makeStoreFn) {
      const e = view.makeStoreFn();
      e.obj.position.set(X(API._store.x + 0.5), hAt(API._store.x + 0.5, API._store.y + 0.5), Z(API._store.y + 0.5));
      return e;
    }
    const g = new T.Group(), e = { obj: g };
    box(g, 1.0, 0.55, 0.8, 0x7b5a35, 0, 0.275, 0);
    for (const s of [-1, 1]) { const r = box(g, 0.62, 0.05, 0.95, 0x5a3f22, s * 0.25, 0.68, 0); r.rotation.z = -s * 0.62; }
    box(g, 0.34, 0.4, 0.03, 0xd9b56a, 0, 0.2, 0.41);
    box(g, 0.04, 0.5, 0.04, 0x4a3a2a, 0.55, 0.25, 0.45);
    e.crates = [0, 1, 2, 3, 4, 5].map(i => box(g, 0.2, 0.2, 0.2, i % 2 ? 0xc9a04e : 0xe0b858, -0.62 + (i % 3) * 0.22, 0.1 + Math.floor(i / 3) * 0.2, 0.62));
    g.position.set(X(API._store.x + 0.5), hAt(API._store.x + 0.5, API._store.y + 0.5), Z(API._store.y + 0.5));
    return e;
  }

  // 3D models for mod structures: factory(T) -> { obj, upd? }
  const M = API.models3d;
  M.forge = () => {
    const g = new T.Group();
    box(g, 0.82, 0.5, 0.7, 0x5a5f68, 0, 0.25, 0); box(g, 0.9, 0.1, 0.78, 0x3a3e45, 0, 0.55, 0); box(g, 0.14, 0.45, 0.14, 0x2b2d33, 0.28, 0.8, -0.15);
    const coal = box(g, 0.3, 0.16, 0.05, 0xff8a30, -0.12, 0.28, 0.36); coal.material = bmat(0xff7a22);
    box(g, 0.22, 0.12, 0.14, 0x9aa0a8, 0.3, 0.12, 0.5); box(g, 0.1, 0.1, 0.1, 0x6e737b, 0.3, 0.04, 0.5);
    const gl = glowSprite(0xff7a22, 1.4); gl.position.set(-0.12, 0.35, 0.5); g.add(gl);
    return { obj: g, upd: (t) => { gl.material.opacity = 0.55 + 0.3 * Math.sin(t / 110); } };
  };
  M.oven = () => {
    const g = new T.Group();
    box(g, 0.86, 0.12, 0.7, 0x8a7458, 0, 0.06, 0);
    put(g, G.cap, mat(0xb5683f), 0, 0.12, 0, 0.42, 0.5, 0.36);
    box(g, 0.24, 0.24, 0.05, 0x2a1a14, 0, 0.26, 0.32).material = bmat(0x2a1a14);
    const gl = glowSprite(0xffa040, 0.9); gl.position.set(0, 0.25, 0.42); g.add(gl);
    box(g, 0.12, 0.3, 0.12, 0x7a5a48, 0.2, 0.66, -0.1);
    return { obj: g, upd: (t) => { gl.material.opacity = 0.5 + 0.3 * Math.sin(t / 130); } };
  };
  M.school = () => {
    const g = new T.Group();
    box(g, 0.86, 0.46, 0.7, 0xd9c9a3, 0, 0.23, 0);
    const r = put(g, G.cone4, mat(0x7a5aa8), 0, 0.68, 0, 0.7, 0.44, 0.7); r.rotation.y = Math.PI / 4;
    box(g, 0.14, 0.26, 0.03, 0x3b2f22, 0, 0.13, 0.36); box(g, 0.14, 0.12, 0.03, 0x7fc4ee, -0.26, 0.3, 0.36); box(g, 0.14, 0.12, 0.03, 0x7fc4ee, 0.26, 0.3, 0.36);
    box(g, 0.03, 0.4, 0.03, 0x6b4a2b, 0.0, 1.05, 0); box(g, 0.2, 0.12, 0.02, 0x3b82d4, 0.1, 1.15, 0);
    return { obj: g };
  };
  M.well = () => {
    const g = new T.Group();
    put(g, G.cyl6, mat(0x8f949c), 0, 0.14, 0, 0.3, 0.28, 0.3); put(g, G.cyl6, bmat(0x2f6fb0), 0, 0.285, 0, 0.23, 0.02, 0.23, false);
    box(g, 0.05, 0.62, 0.05, 0x6b4a2b, -0.27, 0.45, 0); box(g, 0.05, 0.62, 0.05, 0x6b4a2b, 0.27, 0.45, 0);
    const r = put(g, G.cone4, mat(0xa0522d), 0, 0.88, 0, 0.5, 0.26, 0.4); r.rotation.y = Math.PI / 4;
    box(g, 0.04, 0.04, 0.5, 0x4a3a2a, 0, 0.7, 0); box(g, 0.08, 0.08, 0.08, 0x8a6a4a, 0, 0.55, 0);
    return { obj: g };
  };
  M.tower = () => {
    const g = new T.Group();
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.07, 1.3, 0.07, 0x6b4a2b, x * 0.28, 0.65, z * 0.28);
    box(g, 0.7, 0.08, 0.7, 0x8a6238, 0, 1.0, 0); box(g, 0.6, 0.3, 0.6, 0x9a7140, 0, 1.2, 0);
    const r = put(g, G.cone4, mat(0xa0522d), 0, 1.58, 0, 0.55, 0.38, 0.55); r.rotation.y = Math.PI / 4;
    box(g, 0.03, 0.4, 0.03, 0x4a3a2a, 0, 1.95, 0); const f = box(g, 0.22, 0.12, 0.02, 0xc0392b, 0.12, 2.05, 0);
    box(g, 0.04, 1.0, 0.04, 0x6b4a2b, 0, 0.5, 0.32).rotation.x = 0.2;
    return { obj: g, upd: (t) => { f.rotation.y = Math.sin(t / 300) * 0.3; } };
  };
  function makeStruct(s) {
    const fac = M[s.kind];
    const r = fac ? fac(T, s, world) : (() => { const g = new T.Group(); box(g, 0.8, 0.5, 0.8, 0xa8a8b0, 0, 0.25, 0); return { obj: g }; })();
    r.obj.position.set(X(s.x + 0.5), hAt(s.x + 0.5, s.y + 0.5), Z(s.y + 0.5));
    r.era = view.look ? view.look.eraId : null;       // era the model was built for (see rebuild in render())
    return r;
  }
  // when the era advances, rebuild the model in place (same Group, new children) so the village visibly develops
  function disposeSprites(o) { o.traverse(c => { if (c.isSprite && c.material) c.material.dispose(); }); }
  function refreshStruct(s, e) {
    const era = view.look ? view.look.eraId : null;
    if (e.era === era || !M[s.kind]) return;
    const r = M[s.kind](T, s, world);
    disposeSprites(e.obj); e.obj.clear();
    for (const c of r.obj.children.slice()) e.obj.add(c);
    e.upd = r.upd; e.era = era;
  }
  function makeSite(s) {
    if (s.nosite) return null;
    const l = new T.LineSegments(G.edges, new T.LineBasicMaterial({ color: 0xe8b84a }));
    l.position.set(X(s.x + 0.5), hAt(s.x + 0.5, s.y + 0.5), Z(s.y + 0.5));
    const g = new T.Group(); g.add(l); box(g, 0.1, 0.1, 0.1, 0xe8b84a, 0, 0.05, 0);
    g.position.copy(l.position); l.position.set(0, 0, 0);
    return { obj: g };
  }

  // people (also used for raiders)
  function makePerson(bodyC, skin, hair, female) {
    const fig = new T.Group(), p = { fig };
    p.legL = put(fig, G.boxTop, mat(0x2d3440), -0.055, 0.2, 0, 0.07, 0.2, 0.08); p.legR = put(fig, G.boxTop, mat(0x2d3440), 0.055, 0.2, 0, 0.07, 0.2, 0.08);
    p.body = box(fig, 0.2, 0.26, 0.13, bodyC, 0, 0.33, 0);
    p.armL = put(fig, G.boxTop, mat(bodyC), -0.13, 0.45, 0, 0.05, 0.2, 0.06); p.armR = put(fig, G.boxTop, mat(bodyC), 0.13, 0.45, 0, 0.05, 0.2, 0.06);
    p.head = put(fig, G.sph, mat(skin), 0, 0.56, 0, 0.09, 0.09, 0.09);
    p.hair = put(fig, G.cap, mat(hair), 0, 0.575, -0.005, 0.098, 0.098, 0.098);
    if (female) p.hairB = box(fig, 0.17, 0.16, 0.04, hair, 0, 0.5, -0.07);
    p.carry = box(fig, 0.12, 0.12, 0.12, 0x8a5a2b, 0.17, 0.26, 0.05); p.carry.visible = false;
    return p;
  }
  function makeAgent(a) {
    const g = new T.Group(); const p = makePerson(0x999999, SKIN[a.skin], HAIR[a.hair], a.gender === 'F');
    g.add(p.fig); p.fig.scale.setScalar(a.age < 12 ? 0.72 : 1);
    const bar = new T.Group(); bar.renderOrder = 10;
    const bgm = new T.Mesh(G.plane, new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7, depthTest: false })); bgm.renderOrder = 10;
    const fgm = new T.Mesh(G.plane, new T.MeshBasicMaterial({ color: 0x58c46a, depthTest: false })); fgm.renderOrder = 11;
    const ic = new T.Sprite(new T.SpriteMaterial({ map: iconTex('!', '#ffb347'), depthTest: false, transparent: true })); ic.renderOrder = 12; ic.scale.set(0.46, 0.31, 1); ic.visible = false;
    bar.add(bgm, fgm, ic);
    return { obj: g, p, bar, bgm, fgm, ic, rot: 0, lastIcon: '', lastJob: null };
  }
  const iconCache = {};
  function iconTex(text, color) {
    const k = text + color; if (iconCache[k]) return iconCache[k];
    const c = document.createElement('canvas'); c.width = 96; c.height = 64; const x = c.getContext('2d');
    x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 7; x.strokeStyle = 'rgba(0,0,0,.85)';
    x.strokeText(text, 48, 34); x.fillStyle = color; x.fillText(text, 48, 34);
    return iconCache[k] = new T.CanvasTexture(c);
  }
  const jobCol = j => new T.Color((API.jobs[j] && API.jobs[j].color) || API.jobColors[j] || '#999999').getHex();
  function agentIcon(a, w) {
    let icon = null; for (const f of API.icons) { icon = f(a, w); if (icon) break; }
    if (!icon) { if (a.cold) icon = ['*', '#9ad7ff']; else if (a.sick > 0) icon = ['+', '#8fe07a']; else if (a.satiety < 20) icon = ['!', '#ffb347']; else if (a.energy < 15) icon = ['~', '#aab']; }
    return icon;
  }
  function updAgent(e, a, alpha, t, w) {
    const px = a.px + (a.x - a.px) * alpha, py = a.py + (a.y - a.py) * alpha, gy = hAt(px, py);
    const hidden = (a.indoors && a.sleeping) || (a.indoors && a.plan.length === 0);
    e.obj.visible = !hidden; e.bar.visible = !hidden;
    if (hidden) return;
    const p = e.p, mvd = Math.hypot(a.x - a.px, a.y - a.py), moving = mvd > 0.004 && !a.sleeping;
    if (e.lastJob !== a.job) { e.lastJob = a.job; const c = jobCol(a.job); p.body.material = mat(c); p.armL.material = p.armR.material = mat(c); }
    if (moving) e.targetRot = Math.atan2(a.x - a.px, a.y - a.py);
    if (e.targetRot != null) e.rot = angLerp(e.rot, e.targetRot, 0.25);
    const s = a.age < 12 ? 0.72 : 1;
    e.obj.rotation.y = e.rot;
    const sw = moving ? Math.sin(t * 0.016 + a.id) * 0.75 : 0;
    p.legL.rotation.x = sw; p.legR.rotation.x = -sw;
    const step = p.plan0 = a.plan[0], working = step && step.t === 'work' && !a.sleeping && !moving;
    if (working) { const sw2 = -1.1 + Math.sin(t * 0.018 + a.id) * 0.7; p.armL.rotation.x = p.armR.rotation.x = sw2; }
    else { p.armL.rotation.x = -sw * 0.9; p.armR.rotation.x = sw * 0.9; }
    const bob = moving ? Math.abs(Math.sin(t * 0.016 + a.id)) * 0.03 : 0;
    if (a.sleeping) { p.fig.rotation.x = -Math.PI / 2; p.fig.position.y = 0.1 * s; } else { p.fig.rotation.x = 0; p.fig.position.y = bob; }
    p.carry.visible = !!a.carry && !a.sleeping;
    if (a.carry) p.carry.material = mat(a.carry.type === 'wood' ? 0x8a5a2b : a.carry.type === 'bread' ? 0xe6c27a : 0xe8b84a);
    e.obj.position.set(X(px), gy, Z(py));
    // bar
    const bw = 0.4, hp = clamp(a.health / 100, 0, 1);
    e.bar.position.set(X(px), gy + 0.88 * s + 0.12, Z(py)); e.bar.quaternion.copy(camera.quaternion); e.bar.scale.setScalar(clamp(cam.r / 32, 0.8, 2.4));
    e.bgm.position.set(-bw / 2 - 0.015, 0, 0); e.bgm.scale.set(bw + 0.03, 0.065, 1);
    e.fgm.position.set(-bw / 2, 0, 0.001); e.fgm.scale.set(Math.max(0.001, bw * hp), 0.045, 1);
    e.fgm.material.color.set(hp > 0.6 ? 0x58c46a : hp > 0.3 ? 0xe8b84a : 0xe0554c);
    const icon = agentIcon(a, w), key = icon ? icon[0] + icon[1] : '';
    if (key !== e.lastIcon) { e.lastIcon = key; if (icon) { e.ic.material.map = iconTex(icon[0], icon[1]); } e.ic.visible = !!icon; }
    e.ic.position.set(bw / 2 + 0.22, 0.02, 0.002);
  }

  // animals & raiders
  function makeDeer() {
    const g = new T.Group();
    box(g, 0.16, 0.2, 0.42, 0xa9763f, 0, 0.34, 0); box(g, 0.08, 0.2, 0.08, 0xa9763f, 0, 0.5, 0.2); box(g, 0.1, 0.1, 0.14, 0xa9763f, 0, 0.62, 0.26);
    box(g, 0.06, 0.08, 0.04, 0xe8d8b8, 0, 0.34, -0.22);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.04, 0.24, 0.04, 0x6e4a26, x * 0.06, 0.12, z * 0.14);
    box(g, 0.02, 0.12, 0.02, 0x6e4a26, -0.04, 0.72, 0.25); box(g, 0.02, 0.12, 0.02, 0x6e4a26, 0.04, 0.72, 0.25);
    return { obj: g, cx: null };
  }
  function makeWolf() {
    const g = new T.Group();
    box(g, 0.16, 0.2, 0.46, 0x6b6f78, 0, 0.3, 0); box(g, 0.12, 0.12, 0.16, 0x6b6f78, 0, 0.38, 0.28); box(g, 0.05, 0.03, 0.05, 0xe0554c, 0, 0.42, 0.37);
    box(g, 0.05, 0.05, 0.22, 0x555963, 0, 0.32, -0.32).rotation.x = 0.5;
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, 0.045, 0.2, 0.045, 0x41444b, x * 0.06, 0.1, z * 0.15);
    return { obj: g };
  }
  function makeRaider() {
    const p = makePerson(0x7a1f1f, 0xd9b99b, 0x2b2b30, false); const g = new T.Group(); g.add(p.fig);
    box(p.fig, 0.04, 0.4, 0.04, 0xc9ced6, 0.17, 0.36, 0.1); p.fig.scale.setScalar(1.05);
    return { obj: g, p };
  }
  function makeFlame() {
    const g = new T.Group(); const e = { obj: g, cs: [] };
    for (let i = 0; i < 3; i++) e.cs.push(put(g, G.cone7, bmat(i % 2 ? 0xffd34a : 0xff6a1f), (i - 1) * 0.12, 0.2, (i % 2 - 0.5) * 0.14, 0.12, 0.45, 0.12, false));
    const gl = glowSprite(0xff8a30, 1.4); gl.position.y = 0.3; g.add(gl);
    return e;
  }
  const STALL_AWNING = { default: 0xe8e0cc, stone: 0x8a6a48, neo: 0xc9a86a, bronze: 0xd9b45a, iron: 0xb5473a, medieval: 0xa83a3a, industrial: 0x3d6b8a, modern: 0x2f9d8f };
  // Default (fallback) stall. buildings3d.js may set view.makeStallFn(eraId) -> THREE.Group
  // to supply era-specific geometry (the Group must set userData.awning for tint updates).
  function makeStall() {
    if (view.makeStallFn) return view.makeStallFn(view.look ? view.look.eraId : 'medieval');
    const g = new T.Group();
    box(g, 1.2, 0.35, 0.6, 0x7a4f2a, 0, 0.2, 0); const c = box(g, 1.35, 0.05, 0.8, 0xe8e0cc, 0, 0.78, 0); c.rotation.x = 0.25; g.userData.awning = c;
    box(g, 0.05, 0.6, 0.05, 0x5a3a1c, -0.6, 0.5, 0.3); box(g, 0.05, 0.6, 0.05, 0x5a3a1c, 0.6, 0.5, 0.3);
    box(g, 0.2, 0.15, 0.2, 0xe0b858, -0.3, 0.45, 0); box(g, 0.2, 0.15, 0.2, 0xc9a04e, 0.1, 0.45, 0); box(g, 0.18, 0.2, 0.18, 0x6aa84f, 0.4, 0.47, 0);
    for (const s of [-1, 1]) put(g, G.cyl6, mat(0x2b2b30), s * 0.5, 0.14, -0.45, 0.14, 0.05, 0.14).rotation.z = Math.PI / 2;
    return g;
  }

  // ------------------------------------------------------------------ sky, light, weather
  function darkness(f) { return f >= 0.7 ? Math.min(1, (f - 0.7) / 0.08) : Math.max(0, Math.min(1, (0.12 - f) / 0.08)); }
  function updateLighting(w, night) {
    const day = 1 - night, season = w.season;
    const tt = clamp((w.dayFrac - 0.1) / 0.62, 0, 1), ang = tt * Math.PI;
    const sunPos = new T.Vector3(-Math.cos(ang) * 36, Math.sin(ang) * 32 + 6, -10), moonPos = new T.Vector3(-14, 34, 12);
    const k = day * day * (3 - 2 * day);
    sun.position.copy(moonPos).lerp(sunPos, k);
    sun.intensity = 0.18 + 0.62 * day;
    sun.color.set(0x8ea4e0).lerp(tmpC.set(0xfff2d6), k);
    if (tt < 0.12 || tt > 0.88) sun.color.lerp(tmpC.set(0xffb070), 0.45 * day);
    hemi.intensity = 0.32 + 0.3 * day;
    hemi.color.set(0x5a6aa8).lerp(tmpC.set(0xd2e8ff), day);
    hemi.groundColor.set(0x2a3328).lerp(tmpC.set(0x5d7550), day);
    if (w.droughtDays > 0) { sun.color.lerp(tmpC.set(0xffc27a), 0.35); }
    sun.target.position.set(0, 0, 0);
    // sky gradient as CSS background
    const [top, bot] = SKY[season];
    const ct = new T.Color(NIGHT[0]).lerp(new T.Color(top), day), cb = new T.Color(NIGHT[1]).lerp(new T.Color(bot), day);
    cb.lerp(new T.Color(0xf08a4b), clamp(4 * day * (1 - day), 0, 1) * 0.55);
    if (w.droughtDays > 0) cb.lerp(new T.Color(0xe8c27a), 0.3);
    const key = '#' + ct.getHexString() + '#' + cb.getHexString();
    if (key !== skyKey) { skyKey = key; canvas.style.background = `linear-gradient(180deg,#${ct.getHexString()} 0%,#${cb.getHexString()} 100%)`; }
    const cc = new T.Color(0xffffff).lerp(new T.Color(0x8d98bb), night);
    for (const c of clouds) c.children.forEach(s => s.material.color.copy(cc));
  }
  function buildClouds() {
    const m = new T.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
    for (let i = 0; i < 7; i++) {
      const g = new T.Group();
      for (let j = 0; j < 4; j++) {
        const s = new T.Mesh(G.sph, m.clone()); s.scale.set(1.6 + Math.random() * 1.3, 0.8 + Math.random() * 0.4, 1.3 + Math.random());
        s.position.set(j * 1.5 - 2, Math.random() * 0.4, (Math.random() - 0.5) * 1.5); g.add(s);
      }
      g.position.set(-45 + i * 15 + Math.random() * 8, 26 + Math.random() * 6, -H / 2 - 6 - Math.random() * 18); g.userData.sp = 0.4 + Math.random() * 0.5;
      scene.add(g); clouds.push(g);
    }
  }
  function buildSnow() {
    const n = 1400; snowPos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { snowPos[i * 3] = (Math.random() - 0.5) * (W + 10); snowPos[i * 3 + 1] = Math.random() * 22; snowPos[i * 3 + 2] = (Math.random() - 0.5) * (H + 10); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(snowPos, 3));
    snow = new T.Points(g, new T.PointsMaterial({ color: 0xffffff, size: 0.11, transparent: true, opacity: 0.9, depthWrite: false })); snow.frustumCulled = false; snow.visible = false; scene.add(snow);
  }

  // ------------------------------------------------------------------ camera & picking
  function applyCamera() {
    cam.tx = clamp(cam.tx, -W / 2, W / 2); cam.tz = clamp(cam.tz, -H / 2, H / 2);
    const sp = Math.sin(cam.phi);
    camera.position.set(cam.tx + cam.r * sp * Math.sin(cam.theta), cam.r * Math.cos(cam.phi), cam.tz + cam.r * sp * Math.cos(cam.theta));
    camera.lookAt(cam.tx, 0, cam.tz);
    camera.updateMatrixWorld();
  }
  function fitRadius() {
    const a = camera.aspect || 1.6, tanV = Math.tan(T.MathUtils.degToRad(camera.fov / 2)), tanH = tanV * a;
    return clamp(Math.max((W / 2 + 3) / tanH, (H / 2 + 5) / tanV * 0.8) * 1.06, 14, 95);
  }
  function reset() {
    Object.assign(cam, { theta: 0.35, phi: 0.92, tx: 0, tz: 1, moved: false }); cam.r = fitRadius(); setFollow(false);
  }
  function resize() {
    if (!renderer) return;
    const r = stage.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    if (!cam.moved) cam.r = fitRadius();
  }
  const proj = new T.Vector3();
  function screenOf(a, alpha) {
    const px = a.px + (a.x - a.px) * alpha, py = a.py + (a.y - a.py) * alpha;
    proj.set(X(px), hAt(px, py) + 0.35, Z(py)).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: (proj.x * 0.5 + 0.5) * r.width, y: (-proj.y * 0.5 + 0.5) * r.height, z: proj.z };
  }
  function pickAt(mx, my) {
    let best = null, bd = 26 * 26;
    for (const a of world.agents) {
      if ((a.indoors && a.sleeping) || (a.indoors && a.plan.length === 0)) continue;
      const s = screenOf(a, 1), d = (s.x - mx) ** 2 + (s.y - my) ** 2;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  function setFollow(on) {
    view.follow = !!on; const b = document.getElementById('b-follow'); if (b) b.classList.toggle('on', view.follow);
  }
  function bindControls() {
    let drag = null;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pan: e.button === 2 || e.shiftKey || e.button === 1, t: performance.now() };
    });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) {
          cam.moved = true;
          if (drag.pan) {
            const k = cam.r * 0.0017;
            cam.tx -= (Math.cos(cam.theta) * dx + Math.sin(cam.theta) * dy) * k; cam.tz -= (-Math.sin(cam.theta) * dx + Math.cos(cam.theta) * dy) * k; setFollow(false);
          } else { cam.theta -= dx * 0.006; cam.phi = clamp(cam.phi - dy * 0.005, 0.2, 1.38); }
        }
      } else {
        const a = pickAt(mx, my); host.setHover(a ? a.id : null); canvas.style.cursor = a ? 'pointer' : 'grab';
      }
    });
    const up = e => {
      if (!drag) return;
      const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy), quick = performance.now() - drag.t < 450;
      if (moved < 5 && quick && !drag.pan) {
        const r = canvas.getBoundingClientRect(), a = pickAt(e.clientX - r.left, e.clientY - r.top); host.select(a ? a.id : null);
      }
      drag = null;
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', () => drag = null);
    canvas.addEventListener('dblclick', e => {
      const r = canvas.getBoundingClientRect(), a = pickAt(e.clientX - r.left, e.clientY - r.top);
      if (a) { host.select(a.id); setFollow(true); cam.r = Math.min(cam.r, 22); cam.moved = true; }
    });
    canvas.addEventListener('wheel', e => { e.preventDefault(); cam.r = clamp(cam.r * Math.exp(e.deltaY * 0.0012), 7, 90); cam.moved = true; }, { passive: false });
    canvas.addEventListener('pointerleave', () => host.setHover(null));
  }

  // ------------------------------------------------------------------ attach / mode
  function attach(h) {
    host = h; stage = h.stage;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      if (!renderer.getContext()) throw new Error('no context');
    } catch (err) { console.warn('3D view unavailable:', err.message); const b = document.getElementById('b-view'); if (b) { b.disabled = true; b.title = 'WebGL not available'; } return false; }
    canvas = renderer.domElement; canvas.id = 'cv3'; canvas.style.display = 'none';
    stage.insertBefore(canvas, stage.firstChild);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; renderer.setClearColor(0x000000, 0);
    scene = new T.Scene(); camera = new T.PerspectiveCamera(38, 1.6, 0.5, 400);
    makeTextures();
    hemi = new T.HemisphereLight(0xd2e8ff, 0x5d7550, 0.9); scene.add(hemi);
    sun = new T.DirectionalLight(0xfff2d6, 1.1); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 24, bottom: -24, near: 1, far: 140 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    terrainGroup = new T.Group(); scene.add(terrainGroup);
    overlay = new T.Group(); scene.add(overlay);
    selRing = new T.Mesh(G.ring, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false })); selRing.renderOrder = 9; selRing.visible = false; scene.add(selRing);
    buildClouds(); buildSnow();
    labelEl = document.createElement('div'); labelEl.id = 'label3d'; stage.appendChild(labelEl);
    new ResizeObserver(resize).observe(stage);
    bindControls();
    const bv = document.getElementById('b-view'), br = document.getElementById('b-reset'), bf = document.getElementById('b-follow');
    if (bv) bv.addEventListener('click', () => setActive(!view.active));
    if (br) br.addEventListener('click', reset);
    if (bf) bf.addEventListener('click', () => setFollow(!view.follow));
    view.available = true;
    setActive(localStorage.getItem('smallworld.view') !== '2d');
    return true;
  }
  function setActive(on) {
    if (!view.available) on = false;
    view.active = !!on;
    if (canvas) canvas.style.display = on ? 'block' : 'none';
    if (host && host.onMode) host.onMode(!!on);
    const bv = document.getElementById('b-view'), bx = document.getElementById('vbar');
    if (bv) bv.textContent = on ? 'View: 3D' : 'View: 2D';
    if (bx) bx.classList.toggle('is3d', !!on);
    if (labelEl) labelEl.style.display = 'none';
    if (view.available) localStorage.setItem('smallworld.view', on ? '3d' : '2d');
    if (on) resize();
  }

  // ------------------------------------------------------------------ bind world & frame
  function bindWorld(w) {
    world = w; API._store = w.store;
    if (dyn) scene.remove(dyn);
    dyn = new T.Group(); scene.add(dyn); overlay.clear();
    for (const k in maps) maps[k].clear();
    buildInstances(); extra = {}; store = null; stall = null; tSig = '';
    store = makeStore(); dyn.add(store.obj);
    stall = makeStall(); stall.visible = false; dyn.add(stall);
    stall.position.set(X(w.store.x + 3.7), hAt(w.store.x + 3.7, w.store.y + 3.9), Z(w.store.y + 3.9));
    stall._eraId = view.look ? view.look.eraId : null;
    lastSeason = ''; reset();
  }

  function render(w, alpha, t) {
    if (!view.active) return;
    view.look = API.eraLook ? API.eraLook(w) : null;
    if (w !== world) bindWorld(w);
    const dt = Math.min(0.1, (t - lastT) / 1000 || 0.016); lastT = t;
    const season = w.season, night = darkness(w.dayFrac);
    // terrain
    let ts = 0; for (let i = 0; i < w.terrain.length; i++) ts += w.terrain[i];
    const eraI = (API.eras && API.eras.state(w)) ? API.eras.state(w).era : 0;
    const sig = season + '|' + ts + '|' + w.seed + '|' + eraI;
    if (sig !== tSig) { tSig = sig; buildTerrain(w, season); }
    const seasonChanged = season !== lastSeason; lastSeason = season;
    // throttled static sync
    extra.f = (extra.f || 0) + 1;
    if (seasonChanged || extra.f % 6 === 0) syncStatic(w, season, seasonChanged || extra.f === 1);
    // dynamic
    syncMap(maps.houses, w.houses, makeHouse, null, dyn);
    const look = view.look;
    if (view.updStoreFn) view.updStoreFn(store, look);
    for (const [h, e] of maps.houses) updHouse(e, h, t, night, season, look);
    syncMap(maps.structs, w.structs, makeStruct, null, dyn);
    for (const [s, e] of maps.structs) { refreshStruct(s, e); if (e.upd) e.upd(t, w, night); }
    syncMap(maps.sites, w.sites, makeSite, null, dyn);
    syncMap(maps.agents, w.agents, makeAgent, (e, a) => updAgent(e, a, alpha, t, w), dyn);
    const deer = w.m.deer || [], wolves = (w.m.nat && w.m.nat.wolves) || [], raiders = (w.m.def && w.m.def.raiders) || [], flames = (w.m.fire && w.m.fire.flames) || [];
    const place = (e, o, glide) => {
      if (glide) { if (e.cx == null) { e.cx = o.x; e.cy = o.y; } const px = e.cx, py = e.cy; e.cx += (o.x - e.cx) * 0.06; e.cy += (o.y - e.cy) * 0.06; if (Math.hypot(e.cx - px, e.cy - py) > 0.002) e.rot = angLerp(e.rot || 0, Math.atan2(e.cx - px, e.cy - py), 0.15); }
      else { const px = e.lx == null ? o.x : e.lx, py = e.ly == null ? o.y : e.ly; if (Math.hypot(o.x - px, o.y - py) > 0.002) e.rot = angLerp(e.rot || 0, Math.atan2(o.x - px, o.y - py), 0.2); e.lx = o.x; e.ly = o.y; }
      const x = glide ? e.cx : o.x, y = glide ? e.cy : o.y;
      e.obj.position.set(X(x), hAt(x, y), Z(y)); e.obj.rotation.y = e.rot || 0;
    };
    syncMap(maps.deer, deer, makeDeer, (e, o) => place(e, o, true), dyn);
    syncMap(maps.wolves, wolves, makeWolf, (e, o) => { place(e, o, false); e.obj.position.y += Math.abs(Math.sin(t / 90)) * 0.02; }, dyn);
    syncMap(maps.raiders, raiders, makeRaider, (e, o) => {
      place(e, o, false); const s = Math.sin(t * 0.016 + o.x * 5) * 0.7; e.p.legL.rotation.x = s; e.p.legR.rotation.x = -s; e.p.armL.rotation.x = -s; e.p.armR.rotation.x = s;
    }, dyn);
    syncMap(maps.flames, flames, makeFlame, (e, o) => {
      e.obj.position.set(X(o.x + 0.5), hAt(o.x + 0.5, o.y + 0.5), Z(o.y + 0.5));
      e.cs.forEach((c, i) => { const f = 0.7 + 0.5 * Math.sin(t / 80 + i * 2 + o.x); c.scale.set(0.12, 0.45 * f, 0.12); c.position.y = 0.2 * f; });
    }, dyn);
    // store crates reflect food
    const fill = clamp(w.stock.food / Math.max(1, w.targets.food), 0, 1);
    store.crates.forEach((c, i) => { c.visible = i < Math.ceil(fill * 6); });
    stall.visible = !!(w.m.market && w.m.market.until >= w.day);
    // Rebuild stall geometry when era changes (buildings3d.js provides era-specific models)
    const stallEra = view.look ? view.look.eraId : null;
    if (stall._eraId !== stallEra) {
      const pos = stall.position.clone(); dyn.remove(stall);
      stall = makeStall(); stall.visible = !!(w.m.market && w.m.market.until >= w.day);
      stall.position.copy(pos); stall._eraId = stallEra; dyn.add(stall);
    }
    const ac = STALL_AWNING[view.look ? view.look.eraId : ''] || STALL_AWNING.default;
    if (stall.userData.awn !== ac && stall.userData.awning) { stall.userData.awn = ac; stall.userData.awning.material = mat(ac); }
    // environment
    updateLighting(w, night);
    animWater(t);
    clouds.forEach(c => { c.position.x += c.userData.sp * dt; if (c.position.x > W / 2 + 40) c.position.x = -W / 2 - 40; });
    snow.visible = season === 'Winter';
    if (snow.visible) {
      for (let i = 0; i < snowPos.length; i += 3) {
        snowPos[i + 1] -= (1.2 + (i % 7) * 0.1) * dt; snowPos[i] += Math.sin(t / 900 + i) * 0.004;
        if (snowPos[i + 1] < 0) snowPos[i + 1] = 22;
      }
      snow.geometry.attributes.position.needsUpdate = true;
    }
    // camera
    const sel = host.sel() != null ? w.get(host.sel()) : null;
    if (view.follow && sel) {
      const px = sel.px + (sel.x - sel.px) * alpha, py = sel.py + (sel.y - sel.py) * alpha;
      cam.tx += (X(px) - cam.tx) * 0.12; cam.tz += (Z(py) - cam.tz) * 0.12;
    }
    applyCamera();
    // selection ring + label
    const hov = host.hover() != null ? w.get(host.hover()) : null, tgt = sel || hov;
    selRing.visible = !!sel && maps.agents.has(sel) && maps.agents.get(sel).obj.visible;
    if (selRing.visible) { const e = maps.agents.get(sel); selRing.position.copy(e.obj.position); selRing.position.y += 0.03; selRing.scale.setScalar(1 + Math.sin(t / 250) * 0.06); }
    const lab = hov || sel;
    if (lab && maps.agents.has(lab) && maps.agents.get(lab).obj.visible) {
      const s = screenOf(lab, alpha);
      labelEl.style.display = 'block'; labelEl.textContent = lab.name + ' - ' + lab.label;
      labelEl.style.transform = `translate(${Math.round(s.x)}px,${Math.round(s.y - 56)}px) translate(-50%,-100%)`;
    } else labelEl.style.display = 'none';
    renderer.render(scene, camera);
  }
})();
