# Gameplay Guide

You cannot give orders to individual villagers. You influence the village through **policy** (when you take over from the council), through **God mode** (which disqualifies the run), and by choosing when to watch, pause or speed up.

## Goal

Survive as many days as you can. A run ends when the last villager has died or left. The game-over card shows days survived, peak population, births, deaths, arrivals, causes of death, and buttons for the **Family tree** and **Timeline**.

Your best run is kept in the browser. A run where you used any God mode power shows *"God mode was used - this run does not count for the record"*.

## The yearly rhythm

| Days | Season | What matters |
| --- | --- | --- |
| 0-9 | Spring | Crops grow at normal speed. Plant everything. Floods are possible |
| 10-19 | Summer | Crops grow 15% faster. Droughts and wildfires are likelier in dry spells |
| 20-29 | Autumn | Crops grow 15% slower. The target stockpile is highest. Last chance to plant |
| 30-39 | Winter | **No crop growth. Frost wipes every field that is still growing on the first winter day** (fields already ripe are kept). Nights are deadly cold without heat |

Planting stops after day 23 of the year (`canPlant`), because a crop needs about 6 days before frost.

## What a healthy village looks like

- Food stock comfortably above the **target** (about `12-20` per person, depending on season, plus 10).
- Firewood above its target (about `2.5-4` per person plus 30). In winter every occupied house burns 1.5 wood each dusk.
- One house for every 4 people, plus a small buffer.
- Enough wells: one per 18 villagers.
- Several fields per person (the plot target is `1.3 x population + 4`, capped at 70).

## Policy: what you can actually change

Open the **Governance** panel.

| Control | Effect |
| --- | --- |
| `balanced / food / wood / build` | The chosen group's job weights are multiplied by 1.6 in the next job assignment |
| `Ration ON / off` | With rationing on, healthy adults only go to eat when hunger drops lower (24 instead of 30 when it is urgent, 38 instead of 50 when idle). This stretches food, but villagers spend longer hungry. |
| `Let council decide` | Hands control back. The council votes every season, and every 5 days if food is below 35% of target |

Pressing any policy button switches the village to *manual*: the council stops voting until you press **Let council decide**.

## Strategy tips

1. **Survive the first winter.** Before day 30, have at least `pop x 14` food and `pop x 3` wood. Most early collapses are winter starvation or exposure.
2. **Do not over-plant late.** Fields planted after the cut-off are lost to frost.
3. **Keep fields fertile.** Each harvest costs 0.07 fertility. Fields below 0.62 are left fallow to recover, so a large village needs more plots than it seems.
4. **Dig wells early.** Without them, cholera outbreaks are frequent and spread through the water.
5. **Build a forge and an oven.** Tools make work 25% faster. Bread is worth twice as much as plain food per unit eaten, and costs 3 food for 2-3 bread.
6. **Guards and a tower before day ~50.** Raids grow with time (see [Events and Disasters](Events-and-Disasters.md)).
7. **Watch morale.** Villagers who stay miserable for 4+ days can walk away for good. Hunger, homelessness, grief and a lack of food all pull mood down.
8. **Trade surplus.** Visiting traders buy surplus wood, food and tools, and sell food when you are short. 30% of profit is shared among villagers as coins.

## God mode

Open the **God mode** panel and press **Show powers**.

| Group | Powers |
| --- | --- |
| Blessings | Bountiful harvest, Gentle rain, Feast (+100 food, +40 wood), Heal everyone, Travellers arrive, Visiting trader, **+3 settlers**, **+150 food** |
| Calamities | Every bad event (drought, blight, plague, bandits, storm, fire, wildfire, flood, earthquake, wolves, raiders, cholera), **Smite one** |
| Time | **Skip season** (runs the simulation forward to the next season) |

Any use sets the run as *godUsed*. It is useful for testing how the village responds to a disaster.

## Reading the villager card

| Line | Meaning |
| --- | --- |
| Health / Hunger / Energy | 0-100 bars. Hunger at 0 means starvation damage |
| Doing | Current plan step, for example *"going home to sleep"* |
| Skills | Top four skills with levels (0 to 10) |
| Mood | Bar plus a word: joyful, content, uneasy, unhappy, miserable |
| Family | Spouse and living children |
| Friends / Rivals | Up to 3 friends and 2 rivals |
| Tool | Durability of the current tool |
| Coins | Personal money |

Small icons above villagers' heads flag problems: `:(` miserable, `+` seriously hurt, `x` infected wound, `G` guard, `!!` defending, `H2O` fighting a fire.
