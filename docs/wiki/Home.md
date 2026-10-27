# Small World Wiki

Small World is a browser-based village survival simulation. Ten settlers arrive at a lake and run their own lives. You watch, set policy and try to keep them alive as long as possible.

![Overview of a village in 3D](images/overview-3d.png)

## Start here

| If you want to... | Read |
| --- | --- |
| Run the game | [Getting Started](Getting-Started.md) |
| Learn how to survive longer | [Gameplay Guide](Gameplay-Guide.md) |
| Understand the numbers behind the sim | [Simulation Mechanics](Simulation-Mechanics.md) |
| Know what villagers feel, think and do | [Villagers and Society](Villagers-and-Society.md) |
| Study how individuals live and die | [Life recorder](Villagers-and-Society.md#life-recorder) and `node lives.js` in [Testing and Tools](Testing-and-Tools.md) |
| See every job and building | [Buildings and Jobs](Buildings-and-Jobs.md) |
| Know what can go wrong | [Events and Disasters](Events-and-Disasters.md) |
| See how the village develops from caves to modern times | [Eras and Technology](Eras-and-Technology.md) |
| Understand how the code is organised | [Architecture](Architecture.md) |
| Add your own feature | [Modding Guide](Modding-Guide.md) |
| Run tests and diagnostic scripts | [Testing and Tools](Testing-and-Tools.md) |
| Fix a problem | [FAQ and Troubleshooting](FAQ.md) |

## At a glance

| | |
| --- | --- |
| Genre | Autonomous colony / village survival simulation |
| Platform | Any modern browser. Node.js for the optional headless tools (developed on Node 24) |
| Tech | Vanilla JavaScript, HTML canvas, three.js r149 (bundled) |
| Build step | None |
| Backend | None. Saved data is limited to two `localStorage` keys |
| Map | 44 x 30 tiles, a lake in a random corner, storehouse in the middle |
| Time scale | 1 day = 240 ticks, 1 season = 10 days, 1 year = 40 days |
| Randomness | Seeded (`mulberry32`). The same seed gives the same run |
| Win condition | There is none. Your score is days survived |

## Key ideas

1. **Emergent behaviour.** Villagers plan their own work from live shortages. You never give orders. They also have tastes, memories and goals of their own ([Free will](Villagers-and-Society.md#free-will-callings-goals-and-memory)).
2. **Everything is a mod.** Beyond a small core (farming, fishing, wood, building, jobs, events), every feature is an independent file that plugs into shared registries.
3. **The core is headless.** `sim.js` has no DOM code, so the same engine drives the browser and the Node test scripts.

## Screenshots

![Following one villager at night](images/villager-night.png)

*Following a villager at night in 3D. Lit windows, the sidebar villager card, market, governance and defense panels are visible.*
