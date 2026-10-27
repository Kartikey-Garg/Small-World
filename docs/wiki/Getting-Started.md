# Getting Started

## Requirements

- A modern desktop browser (Chrome, Edge, Firefox, Safari). WebGL is needed for the 3D view. Without it the **View** button is disabled and the 2D view is used.
- Node.js is **optional**. You only need it for `serve.js` and the test/diagnostic scripts.

## Running the game

### Option A: open the file

Double-click `index.html`. The app loads all of its scripts with plain `<script>` tags and makes no network requests, so it works straight from `file://`.

### Option B: local static server

```bash
node serve.js          # http://localhost:8765
node serve.js 3000     # choose another port
```

`serve.js` is about ten lines of Node's built-in `http` module. It maps `/` to `index.html` and serves files from the project folder. Because it is a normal process:

- it **stops** when you close the terminal, log out or restart the computer;
- a browser tab you already loaded keeps working after the server dies, because the whole game is already in the page. Reloading that tab would fail.

### Option C: host it

Because it is fully static, you can publish the repository root with GitHub Pages, Netlify or any static host. No build is required.

## The screen

| Area | What it shows |
| --- | --- |
| **Top bar** | Day, season, clock, population, food, wood, fish in the lake, best run, plus extra stats added by mods (mood, couples, tools, bread, treasury, wells, soil, injured, policy, guards, thefts) |
| **Controls** | View 3D/2D, Reset cam, Follow, Pause, speed buttons, New world |
| **Map** | The village. A red banner appears for alerts (raiders, fire, starvation, empty storehouse) |
| **Villager card** | Health, hunger, energy, mood, injury, current action, skills, family, friends, rivals, tool, coins, calling (favourite job), current goal, latest memories, and a **Life story** button |
| **Population chart** | People, food and wood over time |
| **Jobs** | Head count per job, colour coded |
| **Mod panels** | Best skills, Market, Governance, Defense, Law and order, God mode, History, Callings, Ambitions, Life recorder |
| **Villagers list** | Everyone alive, with their job and a health bar |
| **Chronicle** | Running log of events |

## Controls

| Input | Action |
| --- | --- |
| `Space` | Pause / resume |
| `1`..`5` | Speed 1x, 3x, 8x, 25x, 80x |
| Click villager | Select (map or list) |
| 3D drag | Rotate |
| 3D right-drag / middle-drag / Shift-drag | Pan |
| 3D wheel | Zoom (distance clamped to 7..90) |
| 3D double-click villager, or **Follow** | Camera follows them |

At 1x one in-game day takes about 8 seconds. At 80x a 100-day run takes about 10 seconds.

## Saved data

The game stores only two values in the browser's `localStorage`:

| Key | Meaning |
| --- | --- |
| `smallworld.best` | Your best number of days survived (runs that used God mode are excluded) |
| `smallworld.view` | `3d` or `2d` |

There is no save/load for a world in progress. Closing the tab ends the run.

## Next

- [Gameplay Guide](Gameplay-Guide.md) for strategy.
- [Testing and Tools](Testing-and-Tools.md) to run simulations from the command line.
