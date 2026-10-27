# Buildings and Jobs

## Jobs

Jobs are defined in `api.jobs` and each has a `weight`, optional `cap` and `min`. `N` = adult population, `pop` = total population, `fNeed` = food shortage (0.08 to 1).

| Job | Group | Skill | Weight | Cap | Notes |
| --- | --- | --- | --- | --- | --- |
| **Farmer** | food | farming | `fNeed x 1.1` while any field needs work | `ceil(fieldsToTend / 1.5)` | Harvests, replants, plants |
| **Fisher** | food | fishing | `fNeed x 0.25` (winter `x 0.9`), zero if fish < 30 | `1 + floor(pop / 12)` | Three casts per trip |
| **Woodcutter** | wood | woodcutting | `woodNeed x 0.8` | none | Absorbs everyone left over |
| **Builder** | build | building | up to 0.45 (housing) + 0.3 (fields) + 0.3 (building request) | `1 + floor(N / 8)` while something needs building | Houses, fields, structures |
| **Smith** | build | smithing | 0.35 if a forge exists, tools are low and wood > 25 | `1 + floor(N / 25)` | Needs a forge |
| **Hunter** | food | hunting | `fNeed x 0.3` (winter `x 0.7`) if more than 2 deer | `min(1 + floor(pop / 15), deer / 2)` | A deer yields 5+ food |
| **Baker** | food | baking | 0.2 if an oven exists and food > `pop x 2` | `1 + floor(N / 30)` | 3 food + 0.5 wood becomes 2-3 bread |
| **Doctor** | health | healing | `min(0.5, 0.08 x patients)` | `min(patients, 1 + floor(N / 20))` | Walks to the sick and injured |
| **Teacher** | edu | teaching | 0.15 if a school exists and 3+ children | `1 + floor(children / 12)` | Trains children |
| **Guard** | defense | fighting | `0.05 + min(0.2, 0.05 x raids)` from pop 14 and day 15 | `1 + floor(N / 14)` from pop 14 | One guard is mandatory after the first raid at pop 28+ |
| Child | n/a | n/a | n/a | n/a | Under 12 years. Plays, goes to school |

The job colours in the Jobs panel match the sprite tints on the map.

## Structures

Requests from `api.needs` are built by builders with wood from the storehouse. Only one site of each kind is active at a time.

| Structure | Unlock condition | Cost (wood) | Build ticks | Effect |
| --- | --- | --- | --- | --- |
| **House** | Capacity < population + 3, max 30 houses | 15 | 80 | Sleep, shelter, winter heat. 4 occupants |
| **Field (plot)** | Fewer than `1.3 x pop + 4` (max 70), not winter | 0 | 26 | Grows crops |
| **Forge** | Day 12 and pop 14 | 25 | 120 | Allows tool making |
| **Oven** | Day 8 and pop 10 | 20 | 100 | Allows bread |
| **School** | Day 15 and 4 children aged 4+ | 25 | 120 | Teachers train kids |
| **Well** | Day 10 and pop 8, until `ceil(pop / 18)` wells exist | 12 | 90 | Clean water, faster firefighting |
| **Watchtower** | Day 22 and pop 16 | 30 | 140 | +3 defense, helps against thieves and raiders |
| **Palisade section** | Tower exists and pop >= `20 + 10 x sections`. Up to 3 | 22 | 130 | +2.5 defense per section, 8% less injury per section |

Starting layout: a storehouse in the middle, two houses, six fields (three already half grown), five forests, 14 berry bushes and seven deer.

## Tools

- The forge turns 3 wood into one tool (70 ticks, scaled by smithing).
- A villager without a tool fetches one from the storehouse during idle time.
- A tool starts at durability 100, loses 6 per completed task (about 17 uses) and then breaks.
- A working tool gives +25% work speed.
- Smiths keep stock at about `0.35 x pop` and stop at `0.4 x pop`.

## Wells and water

Coverage is `min(1, wells / wellsNeeded)`. Cholera events become more frequent as coverage falls (weight `2.2 x (1 - coverage)`), and an outbreak strikes `12% + 22% x (1 - coverage)` of villagers. Sick villagers spread it daily when coverage is incomplete. A well also boosts firefighters by 50%.

## Defense strength

```
strength = sum over healthy adults near the storehouse (guards anywhere)
             of  (guard 2.2, others 0.7) x (1 + 0.12 x fightingLevel) x (0.6 + health / 250)
         + 3 x towers + 2.5 x palisade sections
```

Only adults who are not sick and have injury below 50 count. The HUD shows this in the Defense panel. See [Events and Disasters](Events-and-Disasters.md) for how it is used.
