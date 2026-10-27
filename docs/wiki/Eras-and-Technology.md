# Eras and Technology

The village starts as a band of hunter-gatherers sheltering in caves and slowly develops, as humanity did, toward a modern society. This is implemented by `mods/eras.js`.

## How it works

- Every day the village earns **knowledge points (KP)**: `0.8 + 0.18 x population + 0.5 x teachers + 1 if a school exists`, multiplied by `1 + (sum of research bonuses)`. Writing, mathematics, universities, the printing press and computers raise that bonus.
- KP are spent on one technology at a time. By default the **cheapest available** technology is researched (**Auto**). In the **Civilization** panel you can click a technology to research it next; **Auto** goes back to the default.
- A technology is available when the current era has reached it and all of its prerequisites are known.
- An era opens when **65 %** of the technologies of the previous era are known. Eras only move forward.
- Every discovery and every new era is written to the chronicle (eras appear as milestones in the Timeline). Houses change colour with the era in 2D. In 3D, every building has a distinct model per era: stone domes, mud-brick huts, timber and thatch, stone cottages with tiles, half-timbered houses, brick terraces and flat-roofed modern homes. Forge, oven, school, well and tower also change in 3D (`mods/buildings3d.js`).

## Eras

| # | Era | Homes | Theme |
| --- | --- | --- | --- |
| 1 | Stone Age | cave shelters | fire, flint, gathering, nets, hides |
| 2 | Neolithic | mud-brick huts | agriculture, pottery, wells, carpentry |
| 3 | Bronze Age | timber houses | metalworking, writing, trade, plow, masonry |
| 4 | Iron Age | stone houses | ironworking, fortification, mathematics, baths |
| 5 | Middle Ages | half-timbered houses | three-field farming, watermill, universities, castles, guilds, hospitals |
| 6 | Industrial Age | brick houses | steam, fertilizer, germ theory, railways, sewers |
| 7 | Modern Age | modern homes | electricity, mechanized farming, antibiotics, computers |

There are 41 technologies in 8 areas: Food, Building, Tools, Health, Defense, Knowledge, Trade and Society. Open the **Tech tree** button for the full list with descriptions and prerequisites.

## What technologies do

| Effect | Examples |
| --- | --- |
| **Unlock a building or job** (locked until known) | Pottery: oven and baker. Herbal medicine: doctor. Well digging: wells. Watchtower: tower. Bronze casting: forge and smith. Writing: school and teacher. Fortification: palisade. Hunting spears: guard |
| **Unlock an event** | Long-distance trade: visiting traders |
| **Yield multipliers** | Foraging, fishing, farming and woodcutting yields (agriculture, plow, crop rotation, fertilizer, mechanization, ...) |
| **Work speed** | Per skill or for all work (iron tools, steam power, electricity, ...) |
| **Firewood use** | Hide clothing, weaving and electricity lower the wood burned per house per winter night |
| **Disaster odds** | Masonry, baths, hospitals, germ theory, sewers and others lower the weight of storms, fires, plague, cholera, raids and so on; calendar lowers drought and blight |
| **Lifespan and mood** | Medicine adds days to every villager's life; some technologies lift mood |

Core jobs (farmer, fisher, woodcutter, builder) and core buildings (houses, fields, storehouse) are never locked, so the early game stays playable. Until the village knows wells and watchtowers, cholera and raids are rarer, because a small camp is a smaller target.

## Switching it off

`new World({ eras: false })` removes the mod's effect completely: everything is unlocked from day 0, no multipliers apply and the run is identical to the game before eras existed (`NOERAS=1 node fingerprint.js 6 150 --check base.json` proves it).

## Tuning

At the top of `mods/eras.js`: `COST_SCALE` (research cost, pacing), the `TECHS` table (cost, prerequisites, effects) and `NEED` (share of an era required for the next). With the shipped values a village reaches the Bronze Age around day 80-130 and the Modern Age around day 270-370.

## For modders

The mod exposes `api.eras` (`ERAS`, `TECHS`, `state(w)`, `has(w, id)`, `available(w)`, `rate(w)`, `current(w)`) and `api.eraLook(w)`, which gives the house colours for the current era (or `null` when eras are off). The core hooks it uses are listed in [Architecture](Architecture.md#hook-reference): `lockedBuild`, `lockedJob`, `yieldMult`, `heatCost` and `eventMult`.
