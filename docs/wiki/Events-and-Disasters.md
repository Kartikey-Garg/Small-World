# Events and Disasters

## How events are chosen

Starting on day 6, each new day has a chance to trigger **one** random event:

```
chance = min(0.26, 0.05 + 0.002 x day)
```

That is 5% early on, reaching the 26% cap around day 105. If the roll succeeds, the game collects every event whose `ok` condition is currently true, weights them, and picks one. Events marked *manual* are only available through God mode.

## Event table

"Weight" is the relative likelihood among eligible events. Higher means more common.

| Event | Type | Weight | Needs | What happens |
| --- | --- | --- | --- | --- |
| **Drought** | bad | 1 | Not winter, no drought running | 3 to 5 days of crop growth at 25% speed |
| **Crop blight** | bad | 1 | Not winter, fields growing | Each growing field has a 60% chance to be destroyed |
| **Plague** | bad | 1 | 4+ villagers | 35% of villagers get sick for 4 days (0.07 damage per tick) |
| **Thieves in the night** | bad | 0.8 | Food > 25 | 30-50% of food stolen. Guards and walls can block it |
| **Violent storm** | bad | 1 | 3+ houses | One house destroyed, 20% of wood lost |
| **Travellers arrive** | good | 2 | Food > `4 x pop`, spare housing | 1 to 3 new settlers |
| **Visiting trader** | good | 2.2 | After day 8, no trader present | Buys surplus, sells food. See [Villagers and Society](Villagers-and-Society.md) |
| **Cholera outbreak** | bad | `2.2 x (1 - well coverage)` | 6+ villagers, coverage < 1 | `12% + 22% x (1 - coverage)` of villagers fall ill for 5 days. Spreads |
| **House fire** | bad | 0.8, or 2 in a drought, +0.5 in winter | 3+ houses, none burning | A house with people in it ignites |
| **Wildfire** | bad | 0.35, or 2 in a drought | Not winter, 10+ trees | Trees within 3.5 tiles are burned. A nearby house may ignite |
| **Flood** | bad | 0.8 | Spring or autumn, none active | Land within 2 to 3 tiles of the lake floods for 3 to 5 days |
| **Earthquake** | bad | 0.35 | After day 15, 3+ houses | 10-25% of houses collapse, 12% of other buildings wrecked, everyone loses 10 mood |
| **Wolf pack** | bad | 0.9 | After day 10, 5+ villagers, no wolves. Winter and autumn mostly, otherwise 40% | 1 to 3 wolves enter from a map edge |
| **Raiders** | bad | `min(1.4, 0.35 + day / 160)` | After day 14, 8+ villagers, none present | An armed band attacks the storehouse |
| Bountiful harvest | manual | n/a | God mode | All growing fields ripen, +40 food |
| Gentle rain | manual | n/a | God mode | Ends drought, crops +30% growth |
| Feast | manual | n/a | God mode | +100 food, +40 wood |
| Heal everyone | manual | n/a | God mode | Full health, no sickness or injury, minimum hunger 60 |

## Details

### Fire

- A burning house has 200 "fire strength" and collapses after 140 ticks.
- Up to five nearby adults are sent to fight it, each removing 1 per tick (1.5 with a well). More are called as it continues.
- Every 20 ticks, neighbouring houses within 2.4 tiles have a 14% chance to catch fire.
- If it collapses: people indoors take 22 injury, 10% of wood (max 8) is lost, and the house is destroyed.
- If it is put out, the house is saved.

### Flood

Flooded tiles become impassable water. Fields on flooded land are washed out but gain +0.3 fertility from silt. Nobody is placed on a flooded tile. When the water recedes the land returns and the fish count gets +15.

### Wolves

Each wolf has 28 HP, hunts the nearest person who is outdoors within 12 tiles, bites every 45 ticks for 10 to 24 injury, and flees after 3 days. Up to `4 + wolves` healthy adults are called to fight. Each fighter within 2 tiles removes 0.12 HP per tick, multiplied by a guard bonus (+20% per guard). A dead wolf adds 6 food to the store.

### Raiders

A raid is resolved when at least half the band reaches the storehouse, or after 2.5 days.

```
raider strength = n x (3.2 + day / 28)
odds of winning = defense / (defense + raider strength)
```

Band size is `min(8, 1 + floor(day / 55) + 0..1)`.

| Outcome | Result |
| --- | --- |
| **Repelled** | +6 food per raider, 30% of defenders hurt (about 20), +3 fighting skill and +6 mood for defenders |
| **Overrun** | Lose 30-55% of food and 15% of wood, 55% of defenders hurt (about 34), -8 mood for everyone |

Defense comes from healthy adults near the storehouse (guards count 2.2, others 0.7), the watchtower and the palisade. See [Buildings and Jobs](Buildings-and-Jobs.md#defense-strength).

**Prevention.** Guards and defenses also block "thieves in the night" with a chance of `min(90%, 28% x guards + 20% x towers + 12% x wall sections)`.

## Alerts

The red banner above the map shows the first active alert in this order: mod alerts (raiders, wolves or flood, fire, cholera, collapsing morale), then starvation, then "storehouse is out of food".

## Causes of death you will see

`old age`, `starvation`, `exposure` (cold), `exhaustion`, `plague`, `cholera`, `infection`, `wounds`, `a hunting accident`, `an accident at work`, `a house fire`, `a collapsing house`, `wolves`, `raiders`, `a brawl`, `lightning` (God mode) and `abandonment` (the village emptied).
