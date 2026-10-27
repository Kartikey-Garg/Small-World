# Modding Guide

Small World is built so that new features need **no changes to the core**. A mod is one JavaScript file in `mods/` that pushes objects onto the shared registries described in [Architecture](Architecture.md).

## Quick start

1. Create `mods/yourmod.js`.
2. Register it:

   ```bash
   node addmod.js yourmod
   ```

   This appends `'yourmod'` to `mods/load.js` and adds a `<script>` tag before `ui.js` in `index.html`. It is safe to run twice.
3. Run the regression test:

   ```bash
   node smoke.js 120 3
   ```

   It must end with `ALL OK`. It also fires every registered event, including yours.

## Boilerplate

Every mod uses the same wrapper so it runs in both the browser and Node:

```js
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  // ... your code ...
})();
```

Rules of thumb:

- Store per-world data under **`w.m.<yourmod>`**, created in `init`. Never use module-level variables for world state, or a "New world" will inherit the old one.
- Use **`w.rng()`** and **`w.rint(a, b)`** for randomness, never `Math.random()`, so seeds stay reproducible.
- Per-villager data goes on the villager object. Initialise it in the `spawn` hook.
- Keep UI code (sprites, panels) in the same file but guard anything that needs the DOM so Node still loads it. Registering into `api.panels` or `api.sprites` is safe: Node simply never calls them.
- Order in `mods/load.js` and `index.html` is the order hooks run. Put your mod after the ones whose state it reads.

## Worked example: an apiary

This complete mod (tested) adds a **building**, a **job**, an **event**, a **HUD stat**, a **panel** and a **2D sprite**.

```js
// mods/apiary.js
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { mv } = api.util;

  const apiary = w => w.sOf('apiary')[0] || null;

  // 1. ask builders for an apiary once the village is big enough
  api.needs.push(w => (apiary(w) || w.agents.length < 12 || w.day < 10)
    ? null
    : { kind: 'apiary', cost: 10, ticks: 80, label: 'building an apiary' });

  // 2. per-world state
  api.mods.push({
    init(w) { w.m.honey = { made: 0 }; },
  });

  // 3. a job
  api.jobs.beekeeper = {
    color: '#e8c33a', group: 'food', skill: 'beekeeping',
    weight: () => 0.15,
    cap: (w, c) => apiary(w) ? 1 : 0,
    plan(w, a) {
      const s = apiary(w);
      if (!s) return null;
      return {
        steps: [mv(s.x, s.y, 'heading to the apiary'), {
          t: 'work', ticks: w.wt(a, 'beekeeping', 50), label: 'collecting honey',
          done: a2 => { w.m.honey.made++; w.addCarry(a2, 'food', 3); w.gain(a2, 'beekeeping'); }
        }, ...w.deliverSteps()],
        claims: [], kind: 'work',
      };
    },
  };

  // 4. an event
  api.events.push({
    id: 'swarm', label: 'Bee swarm', cat: 'good', w: 0.5,
    ok: w => !!apiary(w),
    run(w) { w.stock.food += 20; w.log('A wild swarm settles in the apiary. +20 food.', 'good'); },
  });

  // 5. UI
  api.hud.push({ id: 'honey', label: 'Honey', get: w => w.m.honey.made });
  api.panels.push({
    id: 'honey', title: 'Apiary',
    html: w => apiary(w) ? `<div class="sub">Batches collected: <b>${w.m.honey.made}</b></div>` : null,
  });
  api.sprites.apiary = (G, s) => {
    const { ctx, ts } = G, x = G.gx(s.x), y = G.gy(s.y);
    ctx.fillStyle = '#e8c33a'; ctx.fillRect(x + ts * 0.2, y + ts * 0.4, ts * 0.6, ts * 0.45);
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x + ts * 0.15, y + ts * 0.32, ts * 0.7, ts * 0.12);
  };
})();
```

In a headless run of seeds 1 to 3 over 120 days, the apiary was built in every world, one beekeeper was assigned, and about 145 to 175 batches of honey were collected.

## Recipes

### Add a job

```js
api.jobs.myjob = {
  color: '#hex',            // colour in the Jobs panel
  group: 'food',            // 'food' | 'wood' | 'build' | 'health' | 'edu' | 'defense' | any string. Policy priority boosts matching groups x1.6
  skill: 'myskill',         // used to pick the best candidate for a vacancy
  weight: (w, ctx) => 0.2,  // relative share of workers. 0 = nobody
  cap:    (w, ctx) => 2,    // maximum workers (omit for no limit)
  min:    (w, ctx) => 0,    // guaranteed workers (filled first)
  plan(w, a) { return { steps: [...], claims: [], kind: 'work' }; },  // or null if nothing to do
};
```

`ctx` contains `N` (adults), `pop`, `winter`, `st` (season), `fNeed`, `wNeed`, `houseShort`, `plotShort`, `farmWork`, `needBuild`, `needs`. If `plan` returns `null` the villager falls back to farming, fishing, wood or foraging.

### Build steps

```js
const { mv } = api.util;
steps: [
  mv(x, y, 'walking somewhere'),                                   // pathfind to a tile
  { t: 'work', ticks: w.wt(a, 'myskill', 40),                      // duration scaled by skill, mood, tools
    label: 'doing a thing',
    check: () => w.stock.wood >= 1,                                // optional: abort (or skip if optional:true)
    done: a2 => { w.stock.wood -= 1; w.gain(a2, 'myskill'); } },   // optional: effect
  ...w.deliverSteps(),                                             // carry goods to the storehouse
]
```

Use `w.addCarry(a, 'food' | 'wood' | 'bread' | 'tools', n)` before `deliverSteps()` to bring goods home.

### Add a building

Push a function to `api.needs` that returns a need, an array of needs, or `null`:

```js
{ kind: 'apiary', cost: 10 /* wood */, ticks: 80, label: 'building an apiary',
  props: { /* copied onto the struct */ },
  done: (w, builder, tile) => { /* custom completion instead of the default addStruct */ },
  nosite: true /* no physical tile, e.g. the palisade */ }
```

When built, the struct is stored in `w.structs`, is found with `w.sOf('apiary')`, and the `built` hook fires. Add a 2D look with `api.sprites.apiary = (G, s) => {...}` and a 3D model with `api.models3d.apiary = (T, s, w) => ({ obj: group, upd: (t, w, night) => {} })`. Without a 3D model it shows as a grey box.

### Add an event

```js
api.events.push({
  id: 'myevent', label: 'My event', cat: 'bad',     // cat: 'good' | 'bad' (God mode groups by it)
  w: 1,                                              // number or w => number. Relative weight
  ok: w => w.day > 20,                               // eligibility
  manual: false,                                     // true = God mode only
  run(w) { /* do it. Return false if it could not happen */ },
});
```

IDs ending in `!` are hidden from the God mode panel (a trick used for the manual cholera trigger).

### React to the world

```js
api.mods.push({
  spawn(w, a) { a.myField = 0; },
  die(w, a, cause) { /* ... */ },
  vitals(w, a, hit) { if (a.mood < 10) hit(0.02, 'despair'); },   // extra damage per tick
  workMult(w, a, skill) { return a.trait === 'diligent' ? 1.1 : 1; },   // multiplies work speed
  urgent(w, a) { return null; },  // return a plan to pre-empt normal behaviour
});
```

See the full list in the [hook reference](Architecture.md#hook-reference).

### Add UI

```js
api.hud.push({ id: 'x', label: 'X', get: w => w.m.mymod.count });                 // top bar stat
api.panels.push({ id: 'x', title: 'X', html: (w, ui) => '<div class="sub">...</div>' });  // return null to hide
api.info.push((a, w) => `<div class="doing">Fact about ${a.name}</div>`);          // villager card
api.icons.push(a => a.mood < 10 ? ['!', '#ff0'] : null);                           // badge by the head
api.alerts.push(w => w.m.mymod.bad ? 'Something is wrong!' : null);                // red banner
```

Buttons inside panel HTML call actions:

```js
api.actions.doThing = (w, arg, ui) => { /* arg = data-arg */ };
// in html():  <button class="sm" data-act="doThing" data-arg="42">Do it</button>
```

Useful CSS classes in panels: `.sub`, `.btns`, `button.sm`, `button.sm.on`, `.tbl`, `.row`, `.bar`, `.doing`. `ui.modal(html)` opens a full-card modal.

### Draw on the map

```js
api.draw.ground.push(G => { /* below entities */ });
api.draw.top.push(G => { /* above entities */ });
```

`G.ctx` is the canvas context, `G.ts` the tile size, `G.gx(tileX)` and `G.gy(tileY)` convert tile coordinates to pixels. These layers are 2D only.

## Things to watch for

- **Smoke test your mod.** `node smoke.js` fires every event after day 40 and checks for NaN values, duplicates and dangling references. Add checks there for your own invariants.
- **Never keep references to dead villagers.** Look them up by id with `w.get(id)`, which returns `null` if gone.
- **Edit `w.stock` only with finite numbers.** The smoke test fails on `NaN`.
- **Keep per-tick work cheap.** `tick` hooks run 30 times per second at 1x and up to thousands of times per second at 80x.
- **Do not use `w.rng()` in an observer mod.** A mod that only watches (like `mods/recorder.js`) must not consume random numbers, or it changes every run. For per-person choices that must not shift the random stream, use `api.util.hash01(w.seed, a.id, ...)`, a stateless hash giving a number in [0,1).
- **Check neutrality.** `node fingerprint.js 6 150 --save base.json` before and `--check base.json` after proves a refactor changed nothing. `smoke.js` already does this for the recorder.
- The 3D view does not draw raiders, wolves or deer from the `draw` layers; check `view3d.js` if you add moving creatures.

## Test your balance

```bash
node headless.js 10 400
```

Prints outcomes for ten seeds. Compare before and after your change.
