# Testing and Tools

All scripts live in the project root and need only Node.js. They load the simulation through `require('./sim.js')`, which also loads every mod, so no browser is involved.

| Script | Purpose | Exit code |
| --- | --- | --- |
| `smoke.js` | Regression test, plus determinism and recorder-neutrality checks | 1 on failure |
| `fingerprint.js` | Hash the end state of N seeds; `--save f` / `--check f` to prove a change did not alter behaviour | 1 on mismatch |
| `lives.js` | Study how villagers lived and died; export dossiers | 0 |
| `headless.js` | Balance test across many seeds | 0 |
| `probe.js` | Print any value from a world at a given day | 0 |
| `trace.js` | Day-by-day economy trace | 0 |
| `starve.js` | Find starvation despite food in stock | 0 |
| `addmod.js` | Register a mod in `load.js` and `index.html` | 1 if file missing |
| `serve.js` | Static web server | n/a |

## `smoke.js`: regression test

```bash
node smoke.js [days=120] [seeds=3]
```

1. Simulates `seeds` worlds (seeds 500, 501, ...) for `days` days. Every 97 ticks it checks invariants.
2. For **every registered event** it builds a fresh world (seed 77), runs it to day 40, triggers the event, runs six more days and checks invariants again. It prints `ok` or `refused` for each event.
3. Prints `ALL OK`, or `FAILED (n problems)` and exits 1.

Invariants checked:

- no duplicate villager ids;
- `health, satiety, energy, mood, injury, x, y` are finite numbers;
- a villager's `home` is still a real house;
- every `stock` value is finite;
- no dead villager is listed as a house occupant;
- no exceptions (a crash is reported with its stack).

Sample output:

```
seed 500: day 60 pop 36 births 28 deaths 12 {"old age":12}
seed 501: day 60 pop 21 births 15 deaths 9 {"old age":9}
event drought      ok  pop 18
event blight       ok  pop 17
...
event raid         ok  pop 18
ALL OK
```

## `lives.js`: study the villagers

```bash
node lives.js [seed=1] [days=300] [--out lives.jsonl] [--who Name|id]
```

Runs one world and prints average lifespan, causes of death, how people spend their time, what jobs they hold, goals set and achieved, and the story of one life. `--out` streams every finished life to a JSON-lines file, so memory stays small however long the run. `--who` prints one living person's full record.

## `fingerprint.js`: did behaviour change?

```bash
node fingerprint.js 6 150 --save base.json     # before your change
node fingerprint.js 6 150 --check base.json    # after: exits 1 on any difference
```

Hashes the full end state (positions, jobs, stocks, stats, next random number) of several seeds. Useful when refactoring: with the freedom mods off (`free: false`) the output is identical to the pre-mod simulation.

## `headless.js`: balance
```bash
node headless.js [runs=10] [maxDays=400]
```

Runs seeds 1000, 1001, ... and prints one line per seed with days survived, population, peak, births, deaths and causes, houses, fields and stocks, then the median, min and max days.

```
seed 1000: days=200 pop=68 peak=68 births=114 deaths=79 causes={"old age":79} houses=18 plots=70 food=1151 wood=513 fish=3
median 200 min 200 max 200
```

Use it before and after changing a constant to see whether a village still survives.

## `probe.js`: inspect any value

```bash
node probe.js <seed> <days> "<expression>"
node probe.js 1 150 "w.m.market"
node probe.js 1 150 "w.agents.map(a => a.name + ':' + a.job)"
node probe.js 1 150 "api.market.prices(w)"
```

`w` is the world and `api` the shared API. The default expression is `w.stats`.

## `trace.js`: economy trace

```bash
node trace.js [seed=1004] [everyNDays=4] [maxDay=120]
```

Prints a snapshot every N days: population, hungry people, food against target, wood, fish, jobs, field states (ready/growing/empty) and houses. Helps find where an economy starts failing.

## `starve.js`: a known failure mode

```bash
node starve.js [seed=1003] [maxDay=400]
```

Reports up to six days when someone has zero hunger while food is in the store, listing their job, plan, health, injury, sickness, jail status and cargo. This catches logic bugs where villagers do not go to eat.

## Using the engine in your own script

```js
const api = require('./sim.js');
const w = new api.World({ seed: 42, pop: 10 });   // pop defaults to 10
while (!w.gameOver && w.day < 100) w.step();

w.trigger('flood');             // fire an event (sets godUsed)
w.skipSeason();                 // fast-forward to the next season
console.log(w.counts());        // jobs
console.log(w.stats, w.stock);
```

The same seed gives the same result every time. This was checked by running seed 42 twice for 80 days and comparing population, stats and food.

## Continuous integration

A minimal GitHub Actions workflow to run the regression test on every push:

```yaml
name: smoke
on: [push, pull_request]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node smoke.js 120 3
```
