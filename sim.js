/* ==========================================================================
   SMALL WORLD - simulation core
   Pure logic, no DOM. Works in the browser (window.SmallWorld) and in Node.
   Features live in mods/*.js and plug in through the registries on `api`:
     api.mods    hook objects  (init, spawn, die, leave, day, dusk, tick, vitals, work, built,
                                history, workMult, speedMult, urgent, needs, child, idle, homeFor, ate,
                                 jobAffinity(w,a,job)->number, quitJob(w,a)->bool, jobsAssigned, decided(w,a,plan))
     api.jobs    job definitions { plan, weight, cap, min, group, color }
     api.events  random / god events { id, label, w, ok, run, manual }
     api.needs   building requests   fn(world) -> {kind,cost,ticks,label,props,done,nosite} | [..] | null
   UI registries: api.sprites, api.draw, api.info, api.icons, api.hud, api.alerts, api.jobColors
   ========================================================================== */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- constants
  const W = 44, H = 30;               // map size in tiles
  const DAY = 240;                    // ticks per day
  const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
  const SEASON_DAYS = 10;
  const YEAR = SEASON_DAYS * 4;
  const ADULT_AGE = 12;               // days
  const HOUSE_CAP = 4;
  const HOUSE_COST = 15;              // wood
  const GROW_DAYS = 4;
  const SAT_DECAY = 100 / (2.6 * DAY);
  const ENERGY_DECAY = 0.2;
  const FOOD_VALUE = 45;
  const BREAD_VALUE = 90;
  const FISH_MAX = 100;
  const FERT_MIN = 0.62;              // fields below this fertility are left fallow

  const TRAITS = ['honest', 'honest', 'kind', 'greedy', 'hotheaded', 'diligent'];

  const MALE = ['Tom', 'Oskar', 'Leif', 'Bram', 'Hugo', 'Jonas', 'Eli', 'Rowan', 'Finn', 'Ansel', 'Cedric', 'Dorian',
    'Emil', 'Gideon', 'Silas', 'Tobias', 'Wren', 'Arlo', 'Milo', 'Otis', 'Perry', 'Quinn', 'Rufus', 'Soren'];
  const FEMALE = ['Mara', 'Ida', 'Nell', 'Freya', 'Lena', 'Sofie', 'Thea', 'Wilma', 'Edda', 'Greta', 'Hana', 'Ivy',
    'Joan', 'Kira', 'Lotte', 'Maud', 'Nora', 'Orla', 'Pia', 'Runa', 'Sage', 'Tilda', 'Una', 'Vera'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // stateless hash -> [0,1). Lets mods make per-person "random" choices without consuming the world's rng stream.
  function hash01() {
    let h = 2166136261;
    for (let k = 0; k < arguments.length; k++) {
      const s = String(arguments[k]);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      h ^= 124; h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85EBCA6B); h ^= h >>> 13; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function nearestTo(list, x, y, pred) {
    let best = null, bd = Infinity;
    for (const o of list) {
      if (pred && !pred(o)) continue;
      const dx = o.x + 0.5 - x, dy = o.y + 0.5 - y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  const mv = (x, y, label) => ({ t: 'move', x, y, label });

  // plug-in registries -------------------------------------------------------
  const api = {
    mods: [], events: [], jobs: {}, needs: [],
    sprites: {}, draw: { ground: [], top: [] }, info: [], icons: [], hud: [], alerts: [], jobColors: {},
    panels: [], actions: {}, overHtml: [],
    util: { clamp, nearestTo, mv, mulberry32, hash01 },
    consts: { W, H, DAY, SEASONS, SEASON_DAYS, YEAR, ADULT_AGE, HOUSE_CAP, HOUSE_COST, FISH_MAX },
    recordRecentDecision(w, meta) {
      if (!w || !w.m) return null;
      const state = w.m.dilemmas || (w.m.dilemmas = { active: null, lastDay: -99, resolvedCount: 0, recent: [] });
      const entry = {
        day: w.day,
        title: (meta && meta.title) || 'Council Decision',
        choice: (meta && meta.choice) || 'Unknown decision',
        summary: (meta && meta.summary) || '',
        consequence: (meta && meta.consequence) || '',
      };
      state.recent = [entry].concat((state.recent || []).slice(0, 7));
      state.lastResolved = entry;
      return entry;
    },
    getRecentDecisions(w) {
      return (!w || !w.m || !w.m.dilemmas) ? [] : (w.m.dilemmas.recent || []).slice(0, 8);
    },
  };

  // ====================================================================== World
  class World {
    constructor(opts) {
      opts = opts || {};
      this.opts = opts;                               // read by mods (e.g. { free: false } switches the freedom mods off)
      this.seed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
      this.rng = mulberry32(this.seed);
      this.W = W; this.H = H; this.DAY = DAY;
      this.tick = Math.floor(DAY * 0.1);              // start just after dawn
      this.day = 0;
      this.terrain = new Uint8Array(W * H);          // 0 grass, 1 water, 2 flood water
      this.occ = new Array(W * H).fill(null);
      this.trees = []; this.bushes = []; this.houses = []; this.plots = []; this.sites = []; this.structs = [];
      this.agents = [];                              // living
      this.dead = [];                                // obituary list
      this.graves = [];
      this.registry = {};                            // every person ever born/arrived
      this.byId = new Map();                         // living agents by id
      this.stock = { food: 0, wood: 0, bread: 0, tools: 0 };
      this.fish = 70;
      this.logs = [];
      this.chron = [];                               // key events for the end-of-run timeline
      this.history = [];
      this.stats = { births: 0, deaths: 0, peak: 0, causes: {}, arrivals: 0, left: 0 };
      this.policy = { priority: 'balanced', ration: false };
      this.m = {};                                   // per-mod state
      this.nextId = 1;
      this.gameOver = false;
      this.endCause = null;
      this.godUsed = false;
      this.droughtDays = 0;
      this.targets = { food: 100, wood: 60 };
      this.ctx = {};
      this._prev = new Int32Array(W * H);
      this._queue = new Int32Array(W * H);
      this.generate(opts.pop || 10);
      this.hook('init');
      this.assignJobs();
      this.log('A small band of settlers arrives at the lake. Survive!', 'info');
    }

    // ------------------------------------------------------------ helpers
    rint(a, b) { return a + Math.floor(this.rng() * (b - a + 1)); }
    idx(x, y) { return y * W + x; }
    inb(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
    walkable(x, y) { return this.inb(x, y) && this.terrain[y * W + x] === 0; }
    isFree(x, y) { return this.walkable(x, y) && this.occ[y * W + x] === null; }
    get season() { return SEASONS[Math.floor(this.day / SEASON_DAYS) % 4]; }
    get dayFrac() { return (this.tick % DAY) / DAY; }
    get year() { return Math.floor(this.day / YEAR) + 1; }
    isNight() { const f = this.dayFrac; return f >= 0.75 || f < 0.08; }
    log(text, type) {
      type = type || 'info';
      const e = { day: this.day, text, type };
      this.logs.push(e);
      if (this.logs.length > 400) this.logs.splice(0, 100);
      if (type === 'bad' || type === 'good' || type === 'mile') {
        this.chron.push(e); if (this.chron.length > 1500) this.chron.splice(0, 300);
      }
    }
    canPlant() {
      return (this.day % YEAR) < 3 * SEASON_DAYS - 6; // crops need ~6 days before first frost
    }

    // ------------------------------------------------------------ plug-in plumbing
    hook(name, ...args) { for (const m of api.mods) { const f = m[name]; if (f) f(this, ...args); } }
    hookFirst(name, ...args) {
      for (const m of api.mods) { const f = m[name]; if (f) { const r = f(this, ...args); if (r) return r; } }
      return null;
    }
    hookProd(name, ...args) {
      let v = 1;
      for (const m of api.mods) { const f = m[name]; if (f) v *= f(this, ...args); }
      return v;
    }
    hookSum(name, ...args) {
      let v = 0;
      for (const m of api.mods) { const f = m[name]; if (f) v += f(this, ...args) || 0; }
      return v;
    }
    sOf(kind) { return this.structs.filter(s => s.kind === kind); }
    hasFood() { return this.stock.food >= 1 || this.stock.bread >= 1; }
    foodEq() { return this.stock.food + this.stock.bread * 2; }

    // ------------------------------------------------------------ skills
    skillLv(a, k) { return Math.min(10, (a.skills[k] || 0) / 12); }
    gain(a, k, n) { a.skills[k] = (a.skills[k] || 0) + (n == null ? 1 : n); this.hook('work', a, k); }
    // work duration in ticks after skill / mood / tool / injury modifiers
    wt(a, k, base) {
      const m = (1 + 0.06 * this.skillLv(a, k)) * this.hookProd('workMult', a, k) * (0.8 + 0.4 * (a.mood / 100));
      return Math.max(2, Math.round(base / m));
    }

    // ---------------------------------------------------------- generation
    generate(pop) {
      const r = this.rng;
      // lake in a random corner
      const corners = [[7, 7], [W - 8, H - 8], [W - 8, 7], [7, H - 8]];
      const [cx, cy] = corners[this.rint(0, 3)];
      this.lake = { x: cx, y: cy };
      const rx = 4 + r() * 2.2, ry = 3.2 + r() * 2, ph = r() * 6;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d = dx * dx + dy * dy + Math.sin(x * 0.9 + ph) * 0.12 + Math.sin(y * 1.3 + ph) * 0.12;
        if (d < 1) this.terrain[y * W + x] = 1;
      }
      this.shore = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (this.terrain[y * W + x] !== 0) continue;
        const wn = (a, b) => this.inb(a, b) && this.terrain[b * W + a] === 1;
        if (wn(x + 1, y) || wn(x - 1, y) || wn(x, y + 1) || wn(x, y - 1)) this.shore.push({ x, y });
      }

      // storehouse in the centre
      this.store = { kind: 'store', x: (W / 2) | 0, y: (H / 2) | 0 };
      this.occ[this.idx(this.store.x, this.store.y)] = this.store;
      const sd = (x, y) => Math.hypot(x - this.store.x, y - this.store.y);

      // forests
      for (let c = 0; c < 5; c++) {
        let fx, fy, tries = 0;
        do { fx = this.rint(2, W - 3); fy = this.rint(2, H - 3); tries++; }
        while ((sd(fx, fy) < 9 || !this.walkable(fx, fy)) && tries < 60);
        const rr = 3 + r() * 2.5;
        for (let y = Math.floor(fy - rr); y <= fy + rr; y++) for (let x = Math.floor(fx - rr); x <= fx + rr; x++) {
          const d = Math.hypot(x - fx, y - fy);
          if (d > rr || !this.isFree(x, y) || sd(x, y) < 5) continue;
          if (r() < 0.75 - (d / rr) * 0.5) this.addTree(x, y);
        }
      }
      for (let i = 0; i < 16; i++) {
        const x = this.rint(0, W - 1), y = this.rint(0, H - 1);
        if (this.isFree(x, y) && sd(x, y) > 5) this.addTree(x, y);
      }
      // berry bushes
      for (let i = 0, n = 0; i < 300 && n < 14; i++) {
        const x = this.rint(0, W - 1), y = this.rint(0, H - 1);
        if (this.isFree(x, y) && sd(x, y) > 3) {
          const b = { kind: 'bush', x, y, food: 3, regrowAt: 0 };
          this.bushes.push(b); this.occ[this.idx(x, y)] = b; n++;
        }
      }
      // starting buildings
      for (let i = 0; i < 2; i++) this.addHouse(this.findSite('house'));
      for (let i = 0; i < 6; i++) {
        const p = this.addPlot(this.findSite('plot'));
        if (i < 3) { p.state = 'growing'; p.p = 0.5; }
      }
      this.stock.food = 10 + pop * 3;
      this.stock.wood = 15 + pop * 2;

      // settlers
      for (let i = 0; i < pop; i++) {
        const a = this.spawnAgent(i % 2 === 0 ? 'M' : 'F', this.rint(14, 34));
        a.x = this.store.x + 0.5 + (r() - 0.5) * 3; a.y = this.store.y + 0.5 + (r() - 0.5) * 3;
        a.px = a.x; a.py = a.y;
      }
      for (const a of this.agents) this.assignHome(a);
      this.stats.peak = this.agents.length;
    }

    addTree(x, y) {
      const t = { kind: 'tree', x, y, wood: 4, regrowAt: 0, v: this.rint(0, 2), claimed: null };
      this.trees.push(t); this.occ[this.idx(x, y)] = t; return t;
    }
    addHouse(tile) {
      if (!tile) return null;
      const h = { kind: 'house', x: tile.x, y: tile.y, occupants: [], heated: false, v: this.rint(0, 2), fire: null };
      this.houses.push(h); this.occ[this.idx(h.x, h.y)] = h; return h;
    }
    addPlot(tile) {
      if (!tile) return null;
      const p = { kind: 'plot', x: tile.x, y: tile.y, state: 'empty', p: 0, claimed: null, fert: 1 };
      this.plots.push(p); this.occ[this.idx(p.x, p.y)] = p; return p;
    }
    addStruct(kind, tile, props) {
      const s = Object.assign({ kind, x: tile.x, y: tile.y, struct: true }, props || {});
      this.structs.push(s); this.occ[this.idx(s.x, s.y)] = s;
      this.hook('built', s);
      return s;
    }
    removeStruct(s) {
      this.structs = this.structs.filter(x => x !== s);
      if (this.occ[this.idx(s.x, s.y)] === s) this.occ[this.idx(s.x, s.y)] = null;
    }
    destroyHouse(h) {
      this.houses = this.houses.filter(x => x !== h);
      if (this.occ[this.idx(h.x, h.y)] === h) this.occ[this.idx(h.x, h.y)] = null;
      this.reassignHomes();
    }

    findSite(kind) {
      const s = this.store, r = this.rng, isPlot = kind === 'plot';
      const rmin = isPlot ? 3 : 2.2, rmax = isPlot ? 16 : 14;
      let best = null, bs = Infinity;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < rmin || d > rmax || !this.isFree(x, y)) continue;
        let adjB = 0, adjP = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (!this.inb(x + dx, y + dy)) continue;
          const o = this.occ[this.idx(x + dx, y + dy)];
          if (!o) continue;
          if (o.kind === 'plot' || (o.kind === 'site' && o.for === 'plot')) adjP++;
          else if (o.kind !== 'tree' && o.kind !== 'bush') adjB++;
        }
        if (!isPlot && (adjB > 0 || adjP > 1)) continue;
        if (isPlot && adjB > 1) continue;
        const score = d + r() * 1.6 - (isPlot ? adjP * 1.1 : 0);
        if (score < bs) { bs = score; best = { x, y }; }
      }
      return best;
    }

    // ------------------------------------------------------------- agents
    spawnAgent(gender, age, opts) {
      opts = opts || {};
      const r = this.rng;
      const pool = gender === 'M' ? MALE : FEMALE;
      const used = new Set(this.agents.map(a => a.name));
      let name = pool[this.rint(0, pool.length - 1)];
      for (let t = 0; t < 12 && used.has(name); t++) name = pool[this.rint(0, pool.length - 1)];
      if (used.has(name)) name += ' ' + 'IVX'[this.rint(0, 2)];
      const a = {
        id: this.nextId++, name, gender, bornTick: this.tick - Math.floor(age * DAY), age,
        lifespan: 55 + r() * 30,
        x: this.store.x + 0.5, y: this.store.y + 0.5, px: 0, py: 0,
        health: 100, satiety: 70 + r() * 25, energy: 70 + r() * 25,
        job: 'woodcutter', plan: [], planKind: null, path: null, pi: 0, label: 'arriving',
        carry: null, claims: [], home: null, sleeping: false, indoors: false, cold: false,
        sick: 0, sickKind: null, injury: 0, speed: 0.2, hue: this.rint(0, 360), skin: this.rint(0, 3), hair: this.rint(0, 4),
        lastBirth: -99, lastCause: null, alive: true, born: this.day,
        skills: {}, mood: 70, grief: 0, trait: TRAITS[this.rint(0, TRAITS.length - 1)], tool: null,
        spouse: null, parents: opts.parents || [], kids: [], rel: {}, crimes: 0,
      };
      if (age >= ADULT_AGE) {
        const ks = ['farming', 'fishing', 'woodcutting', 'building'];
        for (let i = 0; i < 2; i++) a.skills[ks[this.rint(0, 3)]] = this.rint(6, 40);
      }
      a.px = a.x; a.py = a.y;
      this.agents.push(a); this.byId.set(a.id, a);
      this.registry[a.id] = {
        id: a.id, name, gender, born: Math.floor(a.bornTick / DAY), parents: a.parents.slice(),
        spouse: null, kids: [], died: null, left: null
      };
      this.hook('spawn', a);
      return a;
    }

    assignHome(a) {
      if (a.home && this.houses.includes(a.home)) return;
      let best = this.hookFirst('homeFor', a);
      if (best && (best.occupants.length >= HOUSE_CAP || !this.houses.includes(best))) best = null;
      if (!best) {
        let bd = Infinity;
        for (const h of this.houses) {
          if (h.occupants.length >= HOUSE_CAP) continue;
          const d = Math.hypot(h.x - this.store.x, h.y - this.store.y);
          if (d < bd) { bd = d; best = h; }
        }
      }
      a.home = best;
      if (best) best.occupants.push(a);
    }
    reassignHomes() {
      for (const a of this.agents) if (a.home && !this.houses.includes(a.home)) a.home = null;
      for (const a of this.agents) if (!a.home) this.assignHome(a);
    }

    removeAgent(a) {
      a.alive = false;
      this.endPlan(a);
      if (a.home) a.home.occupants = a.home.occupants.filter(o => o !== a);
      if (a.carry) { this.stock[a.carry.type] = (this.stock[a.carry.type] || 0) + a.carry.n; a.carry = null; }
      this.agents = this.agents.filter(o => o !== a); this.byId.delete(a.id);
    }
    get(id) { return this.byId.get(id) || null; }
    // hurt someone (accident, fight, fire...). Returns true if they died.
    injure(a, n, cause) {
      if (!a.alive) return false;
      a.injury = clamp(a.injury + n, 0, 100); a.health -= n * 0.6; a.lastCause = cause;
      this.hook('hurt', a, n, cause);
      if (a.health <= 0) { this.die(a, cause); return true; }
      return false;
    }
    checkOver(cause) {
      if (this.agents.length === 0) {
        this.gameOver = true; this.endCause = cause;
        this.log(`The last villager has gone. The village lasted ${this.day} days.`, 'bad');
      }
    }
    die(a, cause) {
      if (!a.alive) return;
      a.cause = cause;
      this.removeAgent(a);
      this.graves.push({ x: Math.floor(a.x), y: Math.floor(a.y), name: a.name, day: this.day });
      if (this.graves.length > 60) this.graves.shift();
      this.dead.push({ name: a.name, age: a.age, day: this.day, cause });
      this.registry[a.id].died = { day: this.day, cause };
      this.stats.deaths++;
      this.stats.causes[cause] = (this.stats.causes[cause] || 0) + 1;
      this.log(`${a.name} died of ${cause} aged ${a.age.toFixed(0)}.`, 'death');
      this.hook('die', a, cause);
      this.checkOver(cause);
    }
    leave(a, why) {
      if (!a.alive) return;
      this.removeAgent(a);
      this.registry[a.id].left = { day: this.day, why };
      this.stats.left++;
      this.log(`${a.name} ${why}.`, 'bad');
      this.hook('leave', a, why);
      this.checkOver('abandonment');
    }

    // --------------------------------------------------------- pathfinding
    findPath(sx, sy, gx, gy) {
      if (sx === gx && sy === gy) return [{ x: gx + 0.5, y: gy + 0.5 }];
      const prev = this._prev, q = this._queue;
      prev.fill(-1);
      let qh = 0, qt = 0;
      const s = sy * W + sx, g = gy * W + gx;
      prev[s] = s; q[qt++] = s;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      while (qh < qt) {
        const c = q[qh++];
        if (c === g) break;
        const cx = c % W, cy = (c / W) | 0;
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (!this.walkable(nx, ny)) continue;
          if (dx && dy && (!this.walkable(cx + dx, cy) || !this.walkable(cx, cy + dy))) continue;
          const n = ny * W + nx;
          if (prev[n] !== -1) continue;
          prev[n] = c; q[qt++] = n;
        }
      }
      if (prev[g] === -1) return null;
      const path = [];
      for (let c = g; c !== s; c = prev[c]) path.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
      return path.reverse();
    }

    // -------------------------------------------------------------- plans
    claim(a, o) { o.claimed = a.id; a.claims.push(o); }
    endPlan(a) {
      a.plan = []; a.path = null; a.planKind = null; a.sleeping = false;
      for (const o of a.claims) {
        if (o.kind === 'site') {
          if (!o.done) {
            if (!o.nosite && this.occ[this.idx(o.x, o.y)] === o) this.occ[this.idx(o.x, o.y)] = null;
            this.sites = this.sites.filter(s => s !== o);
          }
        } else if (o.claimed === a.id) o.claimed = null;
      }
      a.claims = [];
    }
    // replace whatever the agent is doing with an emergency plan
    forcePlan(a, p) {
      this.endPlan(a);
      a.plan = p.steps; a.planKind = p.kind || 'urgent';
      for (const c of (p.claims || [])) this.claim(a, c);
    }
    addCarry(a, type, n) {
      if (a.carry && a.carry.type !== type) { this.stock[a.carry.type] = (this.stock[a.carry.type] || 0) + a.carry.n; a.carry = null; }
      if (!a.carry) a.carry = { type, n: 0 };
      a.carry.n += n;
    }
    deliverSteps() {
      return [
        mv(this.store.x, this.store.y, 'heading to the storehouse'),
        {
          t: 'work', ticks: 4, label: 'storing goods', check: a => !!a.carry,
          done: a => { this.stock[a.carry.type] = (this.stock[a.carry.type] || 0) + a.carry.n; a.carry = null; }
        },
      ];
    }
    waitStep(label, ticks) { return { t: 'work', ticks: ticks || this.rint(15, 40), label: label || 'resting' }; }

    // Each planXxx returns {steps, claims, kind} or null
    planEat(a) {
      return {
        steps: [mv(this.store.x, this.store.y, 'going to eat'), {
          t: 'work', ticks: 8, label: 'eating', check: () => this.hasFood(),
          done: a2 => {
            const useBread = this.stock.bread >= 1 && (a2.satiety < 42 || this.stock.food < 1);
            const pm = this.hookProd('portion', a2);
            if (useBread) { this.stock.bread--; a2.satiety = Math.min(100, a2.satiety + BREAD_VALUE * pm); this.hook('ate', a2, 'bread'); }
            else if (this.stock.food >= 1) { this.stock.food--; a2.satiety = Math.min(100, a2.satiety + FOOD_VALUE * pm); this.hook('ate', a2, 'food'); }
          }
        }], claims: [], kind: 'eat'
      };
    }
    planForage(a) {
      const b = nearestTo(this.bushes, a.x, a.y, o => o.food > 0 && !o.claimed);
      if (!b) return null;
      return {
        steps: [mv(b.x, b.y, 'foraging for berries'), {
          t: 'work', ticks: 18, label: 'picking berries', check: () => b.food > 0,
          done: a2 => {
            b.food--; if (b.food <= 0) b.regrowAt = this.tick + 5 * DAY;
            a2.satiety = Math.min(100, a2.satiety + 35 * this.hookProd('yieldMult', a2, 'forage'));
          }
        }], claims: [b], kind: 'eat'
      };
    }
    planSleep(a, nap) {
      let tx, ty;
      if (a.home) { tx = a.home.x; ty = a.home.y; }
      else {
        tx = clamp(this.store.x + (a.id % 5) - 2, 0, W - 1); ty = clamp(this.store.y + 2 + (a.id % 2), 0, H - 1);
        if (!this.walkable(tx, ty)) { tx = this.store.x; ty = this.store.y; }
      }
      return {
        steps: [mv(tx, ty, a.home ? 'going home to sleep' : 'looking for a place to sleep'),
          { t: 'sleep', nap: !!nap, label: a.home ? 'sleeping' : 'sleeping outdoors' }],
        claims: [], kind: 'sleep'
      };
    }
    planWander(a, label) {
      const cx = a.home ? a.home.x : this.store.x, cy = a.home ? a.home.y : this.store.y;
      for (let i = 0; i < 12; i++) {
        const x = Math.round(cx + (this.rng() - 0.5) * 8), y = Math.round(cy + (this.rng() - 0.5) * 8);
        if (this.walkable(x, y)) return { steps: [mv(x, y, label || 'wandering'), this.waitStep(label || 'idling', this.rint(20, 70))], claims: [], kind: 'work' };
      }
      return { steps: [this.waitStep('resting', 20)], claims: [], kind: 'work' };
    }

    planFarm(a) {
      const steps = [], claims = [];
      let fx = a.x, fy = a.y;
      for (let i = 0; i < 3; i++) {
        const p = nearestTo(this.plots, fx, fy, q => q.state === 'ready' && !q.claimed && !claims.includes(q));
        if (!p) break;
        claims.push(p); fx = p.x + 0.5; fy = p.y + 0.5;
        steps.push(mv(p.x, p.y, 'walking to the fields'),
          {
            t: 'work', ticks: this.wt(a, 'farming', 14), label: 'harvesting crops', check: () => p.state === 'ready',
            done: a2 => {
              const y = Math.max(1, Math.round((5 + this.rint(0, 2)) * p.fert * (1 + 0.04 * this.skillLv(a2, 'farming')) * this.hookProd('yieldMult', a2, 'farm')));
              p.state = 'empty'; p.p = 0; p.fert = Math.max(0.2, p.fert - 0.07);
              this.addCarry(a2, 'food', y); this.gain(a2, 'farming');
            }
          },
          {
            t: 'work', ticks: this.wt(a, 'farming', 10), label: 'replanting', optional: true, check: () => this.canPlant() && p.fert >= FERT_MIN,
            done: () => { p.state = 'growing'; p.p = 0; }
          });
      }
      if (steps.length) return { steps: steps.concat(this.deliverSteps()), claims, kind: 'work' };
      if (this.canPlant()) {
        for (let i = 0; i < 3; i++) {
          const p = nearestTo(this.plots, fx, fy, q => q.state === 'empty' && !q.claimed && q.fert >= FERT_MIN && !claims.includes(q));
          if (!p) break;
          claims.push(p); fx = p.x + 0.5; fy = p.y + 0.5;
          steps.push(mv(p.x, p.y, 'walking to the fields'), {
            t: 'work', ticks: this.wt(a, 'farming', 10), label: 'planting seeds', optional: true,
            check: () => this.canPlant() && p.state === 'empty',
            done: a2 => { p.state = 'growing'; p.p = 0; this.gain(a2, 'farming', 0.5); }
          });
        }
        if (steps.length) return { steps, claims, kind: 'work' };
      }
      return null;
    }

    planWood(a) {
      if (this.stock.wood > this.targets.wood * 2) return null;
      const steps = [], claims = [];
      let fx = a.x, fy = a.y;
      for (let i = 0; i < 2; i++) {
        const t = nearestTo(this.trees, fx, fy, q => q.wood > 0 && !q.claimed && !claims.includes(q));
        if (!t) break;
        claims.push(t); fx = t.x + 0.5; fy = t.y + 0.5;
        steps.push(mv(t.x, t.y, 'heading to the forest'), {
          t: 'work', ticks: this.wt(a, 'woodcutting', 36), label: 'chopping wood', check: () => t.wood > 0,
          done: a2 => {
            const n = Math.min(t.wood, 4); t.wood -= n; this.addCarry(a2, 'wood', Math.max(1, Math.round(n * this.hookProd('yieldMult', a2, 'wood'))));
            if (t.wood <= 0) t.regrowAt = this.tick + (4 + this.rng() * 3) * DAY;
            this.gain(a2, 'woodcutting');
          }
        });
      }
      if (!steps.length) return null;
      return { steps: steps.concat(this.deliverSteps()), claims, kind: 'work' };
    }

    planFish(a) {
      if (this.fish < 30) return null;
      const near = this.shore.slice().sort((p, q) =>
        Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y)).filter(t => this.terrain[t.y * W + t.x] === 0).slice(0, 5);
      const tile = near[this.rint(0, near.length - 1)];
      if (!tile) return null;
      const steps = [mv(tile.x, tile.y, 'walking to the lake')];
      for (let i = 0; i < 3; i++) steps.push({
        t: 'work', ticks: this.wt(a, 'fishing', 28), label: 'fishing', optional: true, check: () => this.fish >= 1,
        done: a2 => {
          if (this.fish >= 1) {
            let n = 1; if (this.fish >= 2 && this.rng() < 0.05 * this.skillLv(a2, 'fishing')) n = 2;
            this.fish -= n; this.addCarry(a2, 'food', Math.max(1, Math.round(n * this.hookProd('yieldMult', a2, 'fish')))); this.gain(a2, 'fishing');
          }
        }
      });
      return { steps: steps.concat(this.deliverSteps()), claims: [], kind: 'work' };
    }

    // generic construction: nd = {kind,cost,ticks,label,props,done,nosite}
    buildPlan(a, nd) {
      let tile = null, site = null;
      if (nd.nosite) {
        site = { kind: 'site', for: nd.kind, nosite: true, done: false, x: -1, y: -1 };
        this.sites.push(site);
      } else {
        tile = this.findSite(nd.kind === 'house' ? 'house' : 'struct');
        if (!tile) return null;
        site = { kind: 'site', for: nd.kind, x: tile.x, y: tile.y, done: false };
        this.sites.push(site); this.occ[this.idx(tile.x, tile.y)] = site;
      }
      const tx = tile ? tile.x : this.store.x, ty = tile ? tile.y : this.store.y;
      const haveWood = a.carry && a.carry.type === 'wood' && a.carry.n >= nd.cost;
      const steps = [];
      if (!haveWood) steps.push(mv(this.store.x, this.store.y, 'fetching timber'), {
        t: 'work', ticks: 6, label: 'loading timber', check: () => this.stock.wood >= nd.cost,
        done: a2 => { this.stock.wood -= nd.cost; this.addCarry(a2, 'wood', nd.cost); }
      });
      steps.push(mv(tx, ty, 'carrying timber to site'), {
        t: 'work', ticks: this.wt(a, 'building', nd.ticks || 80), label: nd.label || 'building',
        done: a2 => {
          a2.carry = null; this.gain(a2, 'building', 3);
          site.done = true; this.sites = this.sites.filter(s => s !== site);
          if (tile && this.occ[this.idx(tile.x, tile.y)] === site) this.occ[this.idx(tile.x, tile.y)] = null;
          if (nd.done) nd.done(this, a2, tile);
          else {
            this.addStruct(nd.kind, tile, nd.props);
            this.log(`${a2.name} finished building a ${nd.kind}.`, 'good');
          }
        }
      });
      return { steps, claims: [site], kind: 'work' };
    }
    houseNeed() {
      return {
        kind: 'house', cost: HOUSE_COST, ticks: 80, label: 'building a house',
        done: (w, a2, tile) => {
          w.addHouse(tile); w.reassignHomes();
          w.log(`${a2.name} finished a new house (${w.houses.length} total).`, 'good');
        }
      };
    }
    getNeeds() {
      const out = [];
      for (const f of api.needs) {
        const r = f(this); if (!r) continue;
        for (const nd of [].concat(r)) if (!this.sites.some(s => s.for === nd.kind) && !this.hookFirst('lockedBuild', nd)) out.push(nd);
      }
      return out;
    }

    planBuild(a) {
      const pop = this.agents.length;
      const hs = this.sites.filter(s => s.for === 'house').length;
      const ps = this.sites.filter(s => s.for === 'plot').length;
      const needHouse = (this.houses.length + hs) * HOUSE_CAP < pop + 3 && this.houses.length + hs < 30;
      const needPlot = this.plots.length + ps < this.plotTarget() && this.season !== 'Winter';
      const afford = n => this.stock.wood >= n || (a.carry && a.carry.type === 'wood' && a.carry.n >= n);
      if (needHouse && afford(HOUSE_COST)) { const p = this.buildPlan(a, this.houseNeed()); if (p) return p; }
      for (const nd of this.getNeeds()) if (afford(nd.cost)) { const p = this.buildPlan(a, nd); if (p) return p; }
      if (needPlot) {
        const tile = this.findSite('plot');
        if (tile) {
          const site = { kind: 'site', for: 'plot', x: tile.x, y: tile.y, done: false };
          this.sites.push(site); this.occ[this.idx(tile.x, tile.y)] = site;
          return {
            steps: [mv(tile.x, tile.y, 'heading to new field'), {
              t: 'work', ticks: this.wt(a, 'building', 26), label: 'clearing a field',
              done: a2 => {
                site.done = true; this.sites = this.sites.filter(s => s !== site);
                this.occ[this.idx(site.x, site.y)] = null; this.addPlot(site); this.gain(a2, 'building', 1);
              }
            }], claims: [site], kind: 'work'
          };
        }
      }
      return this.planWood(a);
    }

    plotTarget() { return Math.min(70, Math.ceil(this.agents.length * 1.3) + 4); }

    // -------------------------------------------------------- job planner
    assignJobs() {
      const workers = this.agents.filter(a => a.age >= ADULT_AGE);
      const N = workers.length;
      if (!N) return;
      const pop = this.agents.length, st = this.season, winter = st === 'Winter';
      const foodT = pop * (winter ? 14 : st === 'Autumn' ? 20 : st === 'Summer' ? 14 : 12) + 10;
      const woodT = pop * (winter ? 3 : st === 'Autumn' ? 4 : 2.5) + 30;
      this.targets = { food: foodT, wood: woodT };
      const fNeed = clamp(1 - this.foodEq() / foodT, 0.08, 1);
      const wNeed = clamp(1 - this.stock.wood / woodT, 0.08, 1);
      const hs = this.sites.filter(s => s.for === 'house').length;
      const houseShort = (this.houses.length + hs) * HOUSE_CAP < pop + 3;
      const plotShort = this.plots.length < this.plotTarget() && !winter;
      const ready = this.plots.filter(p => p.state === 'ready').length;
      const empty = this.plots.filter(p => p.state === 'empty' && p.fert >= FERT_MIN).length;
      const farmWork = ready + (this.canPlant() ? empty : 0);
      const needs = this.getNeeds();
      const needBuild = needs.some(nd => this.stock.wood >= nd.cost);
      const ctx = this.ctx = { N, pop, winter, st, fNeed, wNeed, houseShort, plotShort, farmWork, needBuild, needs: needs.length };

      const names = Object.keys(api.jobs);
      const wt = {}, caps = {}, mins = {};
      const pri = this.policy.priority;
      for (const j of names) {
        const d = api.jobs[j];
        if (this.hookFirst('lockedJob', j)) { wt[j] = 0; caps[j] = 0; mins[j] = 0; continue; }
        let w = d.weight ? d.weight(this, ctx) : 0;
        if (d.group && d.group === pri) w *= 1.6;
        wt[j] = Math.max(0, w || 0);
        caps[j] = d.cap ? Math.max(0, Math.floor(d.cap(this, ctx))) : N;
        mins[j] = d.min ? Math.max(0, Math.floor(d.min(this, ctx))) : 0;
      }
      const desired = {};
      names.forEach(j => desired[j] = 0);
      let M = N;
      for (const j of names) { const m = Math.min(mins[j], caps[j], M); desired[j] = m; M -= m; }
      for (let guard = 0; M > 0 && guard < 6; guard++) {
        const act = names.filter(j => wt[j] > 0 && caps[j] - desired[j] > 0);
        if (!act.length) break;
        const tw = act.reduce((s, j) => s + wt[j], 0);
        const shares = act.map(j => ({ j, x: (wt[j] / tw) * M }));
        let given = 0;
        for (const s of shares) {
          const g = Math.min(Math.floor(s.x), caps[s.j] - desired[s.j]);
          desired[s.j] += g; given += g; s.f = s.x - Math.floor(s.x);
        }
        M -= given;
        shares.sort((p, q) => q.f - p.f);
        for (const s of shares) { if (M <= 0) break; if (caps[s.j] - desired[s.j] > 0) { desired[s.j]++; M--; } }
      }
      desired.woodcutter += M;

      // stable assignment: keep current jobs where possible (mods may veto via `quitJob` and bias via `jobAffinity`)
      const left = Object.assign({}, desired);
      const free = [], quit = new Set();
      for (const w of workers) {
        if (left[w.job] > 0) {
          if (this.hookFirst('quitJob', w)) { quit.add(w); free.push(w); } else left[w.job]--;
        } else free.push(w);
      }
      for (const w of free) {
        let j = null, bs = -Infinity;
        for (const k of names) if (left[k] > 0 && !(quit.has(w) && k === w.job)) {
          const s = (w.skills[api.jobs[k].skill] || 0) + this.rng() * 2 + this.hookSum('jobAffinity', w, k);
          if (s > bs) { bs = s; j = k; }
        }
        j = j || (quit.has(w) && left[w.job] > 0 ? w.job : 'woodcutter');
        if (left[j] > 0) left[j]--;
        w.job = j;
      }
      for (const a of this.agents) if (a.age < ADULT_AGE) a.job = 'child';
      this.hook('jobsAssigned');
    }

    // -------------------------------------------------------------- think
    think(a) {
      const night = this.isNight();
      const ration = this.policy.ration && a.age >= ADULT_AGE && !a.sick && a.injury < 30;
      const food = this.hasFood();
      let p = this.hookFirst('urgent', a);
      if (!p) {
        if (a.satiety < (ration ? 24 : 30) && food) p = this.planEat(a);
        else if (a.satiety < 28 && !food) p = this.planForage(a);
      }
      if (!p && night) p = this.planSleep(a, false);
      if (!p && a.energy < 12) p = this.planSleep(a, true);
      if (!p) p = this.hookFirst('needs', a);
      if (!p && a.carry) p = { steps: this.deliverSteps(), claims: [], kind: 'work' };
      if (!p && a.satiety < (ration ? 38 : 50) && food) p = this.planEat(a);
      if (!p && a.age < ADULT_AGE) p = this.hookFirst('child', a) || this.planWander(a, 'playing');
      if (!p && !night) p = this.hookFirst('idle', a);
      if (!p) {
        const jd = api.jobs[a.job];
        if (jd && jd.plan) p = jd.plan(this, a);
        if (!p && a.job !== 'child') {
          const fb = [this.planFarm, this.planFish, this.planWood, this.planForage];
          for (const f of fb) { if (!p && this.foodEq() < this.targets.food * 1.5) p = f.call(this, a); }
          if (!p) p = this.planWood(a);
        }
      }
      if (!p) p = this.planWander(a, 'idling');
      this.endPlan(a);
      a.plan = p.steps; a.planKind = p.kind;
      for (const c of (p.claims || [])) this.claim(a, c);
      this.hook('decided', a, p);
    }

    // ----------------------------------------------------------- per tick
    runPlan(a) {
      for (let guard = 0; guard < 4; guard++) {
        const s = a.plan[0];
        if (!s) return;
        if (s.t === 'move') {
          if (!s.started) {
            s.started = true;
            a.path = this.findPath(Math.floor(a.x), Math.floor(a.y), s.x, s.y);
            if (!a.path) { this.endPlan(a); return; }
            a.pi = 0;
          }
          a.label = s.label; a.sleeping = false;
          if (a.pi >= a.path.length) { a.plan.shift(); a.path = null; continue; }
          const t = a.path[a.pi], dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy);
          let sp = a.speed * this.hookProd('speedMult', a);
          if (a.age < ADULT_AGE) sp *= 0.85;
          if (a.satiety < 10 || a.energy < 8) sp *= 0.6;
          if (d <= sp) { a.x = t.x; a.y = t.y; a.pi++; }
          else { a.x += (dx / d) * sp; a.y += (dy / d) * sp; }
          return;
        }
        if (s.t === 'work') {
          if (!s.started) {
            if (s.check && !s.check(a)) {
              if (s.optional) { a.plan.shift(); continue; }
              this.endPlan(a); return;
            }
            s.started = true; s.left = s.ticks;
          }
          a.label = s.label; a.sleeping = false;
          if (--s.left <= 0) { if (s.done) s.done(a); a.plan.shift(); }
          return;
        }
        if (s.t === 'sleep') {
          a.label = s.label; a.sleeping = true;
          const wake = s.nap ? a.energy >= 60 : (!this.isNight() && a.energy >= 40);
          if (wake || a.satiety < 8) { a.sleeping = false; a.plan.shift(); if (!a.plan.length) a.planKind = null; }
          return;
        }
        a.plan.shift();
      }
    }

    vitals(a) {
      const winter = this.season === 'Winter';
      a.satiety = Math.max(0, a.satiety - SAT_DECAY);
      a.indoors = !!a.home && Math.hypot(a.x - (a.home.x + 0.5), a.y - (a.home.y + 0.5)) < 0.9;
      if (a.sleeping) a.energy = Math.min(100, a.energy + (a.indoors ? 1.0 : 0.35));
      else a.energy = Math.max(0, a.energy - ENERGY_DECAY);
      a.cold = winter && this.isNight() && !(a.indoors && a.home.heated);
      let dmg = 0, cause = null;
      const hit = (v, c) => { dmg += v; if (!cause || v > 0.1) cause = c; };
      if (a.satiety <= 0) hit(0.12, 'starvation');
      if (a.energy <= 0) hit(0.06, 'exhaustion');
      if (a.cold) hit(0.10, 'exposure');
      if (a.sick > 0) hit(a.sickKind === 'cholera' ? 0.10 : 0.07, a.sickKind || 'plague');
      this.hook('vitals', a, hit);
      if (dmg > 0) { a.health -= dmg; a.lastCause = cause; }
      else if (a.satiety > 35 && a.energy > 20 && a.health < 100 && a.injury < 60) {
        a.health = Math.min(100, a.health + (a.sleeping ? 0.12 : 0.06));
      }
      if (a.health <= 0) this.die(a, a.lastCause || 'unknown causes');
      else if (a.age > a.lifespan) this.die(a, 'old age');
    }

    step() {
      if (this.gameOver) return;
      const dt = this.tick % DAY;
      if (dt === 0) this.onNewDay();
      if (dt === Math.floor(0.75 * DAY)) this.onDusk();
      if (dt === DAY / 2 || dt === 0) this.assignJobs();

      // crops
      const winter = this.season === 'Winter';
      if (!winter) {
        const st = this.season;
        const rate = (this.droughtDays > 0 ? 0.25 : 1) * (st === 'Summer' ? 1.15 : st === 'Autumn' ? 0.85 : 1) / (GROW_DAYS * DAY);
        for (const p of this.plots) if (p.state === 'growing') {
          p.p += rate;
          if (p.p >= 1) { p.p = 1; p.state = 'ready'; }
        }
      }

      for (const a of this.agents.slice()) {
        a.px = a.x; a.py = a.y;
        if (!a.alive) continue;
        this.vitals(a);
        if (!a.alive) continue;
        if (!a.plan.length) this.think(a);
        this.runPlan(a);
        if (!a.plan.length && a.planKind) a.planKind = null;
      }
      this.hook('tick');
      this.tick++;
    }

    onDusk() {
      // heating & interrupt work so everyone heads home
      if (this.season === 'Winter') {
        let out = false;
        for (const h of this.houses) {
          if (!h.occupants.length) { h.heated = false; continue; }
          const hc = 1.5 * this.hookProd('heatCost');
          if (this.stock.wood >= hc) { this.stock.wood -= hc; h.heated = true; }
          else { h.heated = false; out = true; }
        }
        if (out) this.log('Firewood has run out - some houses are freezing tonight!', 'bad');
      } else for (const h of this.houses) h.heated = true;
      for (const a of this.agents) if (a.planKind === 'work') this.endPlan(a);
      this.hook('dusk');
    }

    onNewDay() {
      this.day = Math.floor(this.tick / DAY);
      for (const a of this.agents) {
        a.age = (this.tick - a.bornTick) / DAY;
        if (a.injury > 0) a.injury = Math.max(0, a.injury - 3);   // wounds slowly heal (mods/medicine.js speeds it up)
        if (a.sick > 0) {
          a.sick--;
          if (a.sick === 0) { this.log(`${a.name} recovered from ${a.sickKind || 'the plague'}.`, 'good'); a.sickKind = null; }
        }
      }
      if (this.droughtDays > 0) { this.droughtDays--; if (!this.droughtDays) this.log('The drought has ended.', 'good'); }
      // nature
      this.fish = clamp(this.fish + 0.25 * this.fish * (1 - this.fish / FISH_MAX) + 0.3, 0, FISH_MAX);
      for (const t of this.trees) if (t.wood <= 0 && t.regrowAt && this.tick >= t.regrowAt) { t.wood = 4; t.regrowAt = 0; }
      for (const b of this.bushes) if (b.food < 3 && b.regrowAt && this.tick >= b.regrowAt) { b.food = 3; b.regrowAt = 0; }
      const winter = this.season === 'Winter';
      for (const p of this.plots) {
        if (p.state === 'empty') p.fert = Math.min(1.2, p.fert + 0.05);
        else if (winter) p.fert = Math.min(1.2, p.fert + 0.01);
      }
      const doy = this.day % YEAR;
      if (doy === 0 && this.day > 0) this.log(`A new year begins (year ${this.year}).`, 'mile');
      if (doy === 0 || doy === SEASON_DAYS || doy === 2 * SEASON_DAYS) this.log(`${this.season} has arrived.`, 'info');
      if (doy === 3 * SEASON_DAYS) {
        this.log('Winter has arrived. Crops freeze, nights are deadly cold. Stock firewood and food!', 'bad');
        let lost = 0;
        for (const p of this.plots) if (p.state === 'growing') { p.state = 'empty'; p.p = 0; lost++; }
        if (lost) this.log(`Frost destroyed ${lost} unharvested fields.`, 'bad');
      }

      this.hook('day');
      const pt = { day: this.day, pop: this.agents.length, food: Math.round(this.foodEq()), wood: Math.round(this.stock.wood) };
      this.hook('history', pt);
      this.history.push(pt);
      this.stats.peak = Math.max(this.stats.peak, this.agents.length);

      this.doBirths();
      this.doEvents();
    }

    // default births (mods/family.js replaces this with marriage-based births)
    doBirths() {
      const pop = this.agents.length;
      if (pop >= 90 || this.stock.food < pop * 2.5) return;
      if (!this.agents.some(a => a.gender === 'M' && a.age >= ADULT_AGE && a.age < 60)) return;
      for (const m of this.agents.slice()) {
        if (m.gender !== 'F' || m.age < 14 || m.age > 40 || this.day - m.lastBirth < 7) continue;
        if (this.houses.length * HOUSE_CAP <= this.agents.length) break;
        if (m.health < 50 || m.satiety < 30) continue;
        if (this.rng() > 0.2) continue;
        this.giveBirth(m, null);
      }
    }
    giveBirth(m, father) {
      m.lastBirth = this.day;
      const parents = father ? [m.id, father.id] : [m.id];
      const c = this.spawnAgent(this.rng() < 0.5 ? 'M' : 'F', 0, { parents });
      c.x = m.x; c.y = m.y; c.px = c.x; c.py = c.y;
      c.job = 'child'; this.assignHome(c);
      m.kids.push(c.id); this.registry[m.id].kids.push(c.id);
      if (father) { father.kids.push(c.id); this.registry[father.id].kids.push(c.id); }
      this.stats.births++;
      this.log(`${c.name} was born to ${m.name}${father ? ' and ' + father.name : ''}.`, 'birth');
      this.hook('birth', c, m, father);
      return c;
    }

    // ------------------------------------------------------------- events
    doEvents() {
      if (this.day < 6) return;
      const p = Math.min(0.26, 0.05 + this.day * 0.002);
      if (this.rng() > p) return;
      const pool = []; let tot = 0;
      for (const e of api.events) {
        if (e.manual) continue;
        if (e.ok && !e.ok(this)) continue;
        const wt = (typeof e.w === 'function' ? e.w(this) : (e.w == null ? 1 : e.w)) * this.hookProd('eventMult', e);
        if (wt <= 0) continue;
        pool.push([e, wt]); tot += wt;
      }
      let r = this.rng() * tot;
      for (const [e, wt] of pool) { r -= wt; if (r <= 0) { e.run(this); return; } }
    }
    // god mode / debugging: run an event right now
    trigger(id) {
      const e = api.events.find(x => x.id === id);
      if (!e || this.gameOver) return false;
      this.godUsed = true;
      const r = e.run(this);
      return r !== false;
    }
    skipSeason() {
      this.godUsed = true;
      const s = this.season;
      let guard = 0;
      while (!this.gameOver && this.season === s && guard++ < DAY * SEASON_DAYS + 5) this.step();
    }

    // utility for UI / tests
    counts() {
      const c = {};
      for (const a of this.agents) c[a.job] = (c[a.job] || 0) + 1;
      return c;
    }
  }

  // ====================================================================== core jobs
  const J = api.jobs;
  J.farmer = {
    color: '#5fae4b', group: 'food', skill: 'farming',
    plan: (w, a) => w.planFarm(a),
    weight: (w, c) => c.farmWork > 0 ? c.fNeed * 1.1 : 0,
    cap: (w, c) => Math.ceil(c.farmWork / 1.5),
  };
  J.fisher = {
    color: '#3f8fd8', group: 'food', skill: 'fishing',
    plan: (w, a) => w.planFish(a),
    weight: (w, c) => w.fish >= 30 ? c.fNeed * (c.winter ? 0.9 : 0.25) : 0,
    cap: (w, c) => 1 + Math.floor(c.pop / 12),
  };
  J.woodcutter = {
    color: '#a2703d', group: 'wood', skill: 'woodcutting',
    plan: (w, a) => w.planWood(a),
    weight: (w, c) => c.wNeed * 0.8,
  };
  J.builder = {
    color: '#e08a2e', group: 'build', skill: 'building',
    plan: (w, a) => w.planBuild(a),
    // Extra weight for civilization structures (castle/university/hospital/library)
    weight: (w, c) => {
      let wt = (c.houseShort ? 0.45 : 0) + (c.plotShort ? 0.3 : 0) + (c.needBuild ? 0.3 : 0);
      // Boost slightly when important civic buildings are unlocked but not yet built
      const civNeeds = c.needs > 0 && !c.houseShort;
      if (civNeeds) wt += 0.18;
      return wt;
    },
    cap: (w, c) => (c.houseShort || c.plotShort || c.needBuild) ? 1 + Math.floor(c.N / 7) : 0,
  };
  api.jobColors.child = '#f1d36a';

  // ====================================================================== core events
  const E = api.events;
  E.push({
    id: 'drought', label: 'Drought', cat: 'bad', ok: w => w.season !== 'Winter' && w.droughtDays === 0,
    run(w) { w.droughtDays = w.rint(3, 5); w.log(`A drought hits! Crops grow slowly for ${w.droughtDays} days.`, 'bad'); }
  });
  E.push({
    id: 'blight', label: 'Crop blight', cat: 'bad', ok: w => w.season !== 'Winter' && w.plots.some(q => q.state === 'growing'),
    run(w) {
      let n = 0;
      for (const q of w.plots) if (q.state === 'growing' && w.rng() < 0.6) { q.state = 'empty'; q.p = 0; n++; }
      w.log(`Blight ruins ${n} growing fields.`, 'bad');
    }
  });
  E.push({
    id: 'plague', label: 'Plague', cat: 'bad', ok: w => w.agents.length >= 4,
    run(w) {
      const n = Math.max(1, Math.round(w.agents.length * 0.35));
      const pool = w.agents.slice().sort(() => w.rng() - 0.5).slice(0, n);
      for (const a of pool) { a.sick = 4; a.sickKind = 'plague'; }
      w.log(`Plague! ${n} villagers fall ill.`, 'bad');
    }
  });
  E.push({
    id: 'bandits', label: 'Thieves in the night', cat: 'bad', w: 0.8, ok: w => w.stock.food > 25,
    run(w) {
      if (w.hookFirst('raidBlock')) return;
      const lost = Math.floor(w.stock.food * (0.3 + w.rng() * 0.2));
      w.stock.food -= lost;
      w.log(`Bandits raid the storehouse and steal ${lost} food!`, 'bad');
    }
  });
  E.push({
    id: 'storm', label: 'Violent storm', cat: 'bad', ok: w => w.houses.length > 2,
    run(w) {
      const h = w.houses[w.rint(0, w.houses.length - 1)];
      const lostW = Math.floor(w.stock.wood * 0.2); w.stock.wood -= lostW;
      w.hook('houseLost', h, 'storm');
      w.destroyHouse(h);
      w.log(`A violent storm destroys a house and ${lostW} firewood!`, 'bad');
    }
  });
  E.push({
    id: 'migrants', label: 'Travellers arrive', cat: 'good', w: 2,
    ok: w => w.stock.food > w.agents.length * 4 && w.houses.length * HOUSE_CAP > w.agents.length + 2,
    run(w) {
      const n = w.rint(1, 3);
      for (let i = 0; i < n; i++) {
        const a = w.spawnAgent(w.rng() < 0.5 ? 'M' : 'F', w.rint(15, 30));
        w.assignHome(a); w.stats.arrivals++;
      }
      w.log(`${n} travellers hear of your thriving village and settle here.`, 'good');
    }
  });
  // god-only blessings
  E.push({
    id: 'harvest', label: 'Bountiful harvest', cat: 'good', manual: true,
    run(w) {
      let n = 0;
      for (const p of w.plots) if (p.state === 'growing') { p.state = 'ready'; p.p = 1; n++; }
      w.stock.food += 40; w.log(`A divine blessing: ${n} fields ripen at once and +40 food appears.`, 'good');
    }
  });
  E.push({
    id: 'rain', label: 'Gentle rain', cat: 'good', manual: true,
    run(w) {
      w.droughtDays = 0; for (const p of w.plots) if (p.state === 'growing') p.p = Math.min(1, p.p + 0.3);
      w.log('Rain falls. Drought ends and crops surge.', 'good');
    }
  });
  E.push({
    id: 'feast', label: 'Feast (+100 food)', cat: 'good', manual: true,
    run(w) { w.stock.food += 100; w.stock.wood += 40; w.log('Food and firewood mysteriously appear in the storehouse.', 'good'); }
  });
  E.push({
    id: 'heal', label: 'Heal everyone', cat: 'good', manual: true,
    run(w) {
      for (const a of w.agents) { a.health = 100; a.sick = 0; a.sickKind = null; a.injury = 0; a.satiety = Math.max(a.satiety, 60); }
      w.log('A warm light heals every villager.', 'good');
    }
  });

  Object.assign(api, { World, W, H, DAY, SEASONS, SEASON_DAYS, YEAR, ADULT_AGE, HOUSE_CAP, FISH_MAX, TRAITS });
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    require('./mods/load.js');
  } else root.SmallWorld = api;
})(typeof window !== 'undefined' ? window : globalThis);
