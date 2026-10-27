# Villagers and Society

Everything on this page comes from `sim.js` and the mods in `mods/`.

## A villager

| Field | Notes |
| --- | --- |
| Name, gender | Drawn from 24 male and 24 female names. Duplicates get a Roman suffix (I, V, X) |
| Age | In days. Adult at 12. Settlers start at 14-34, migrants at 15-30 |
| Lifespan | Random 55 to 85 days |
| Health, hunger, energy | 0 to 100. See [Simulation Mechanics](Simulation-Mechanics.md) |
| Trait | One of `honest`, `kind`, `greedy`, `hotheaded`, `diligent`. `honest` appears twice in the draw list, so it is twice as common |
| Skills | Experience points per activity. Level = points / 12, max 10 |
| Mood | 0 to 100 |
| Job | Reassigned twice a day |
| Home | A house with up to 4 occupants |
| Coins | Personal money from market profit sharing and fencing stolen goods |
| Tool | A durability value (0 to 100) or none |

`diligent` villagers work 8% faster (`mods/personality.js`). Each trait also tilts which jobs a person likes, see [Free will](#free-will-callings-goals-and-memory).

### Skills

Adult settlers begin with two random skills among farming, fishing, woodcutting and building (6 to 40 points). Skills grow by doing the work. At level 5 and level 8 the chronicle announces a promotion (*expert*, *master*). The **Best skills** panel lists the top person in each skill. Skill levels shorten task times by 6% per level and are used when the job planner picks who fills a vacancy.

Skills: farming, fishing, woodcutting, building, hunting, baking, smithing, healing, teaching, fighting.

## Free will: callings, goals and memory

Two mods (`mods/personality.js`, `mods/goals.js`) give each villager preferences of their own. Both are deterministic: they use a stateless hash of seed, person and day instead of the world's random numbers, so a seed still replays identically. Start a world with `new World({ seed, free: false })` to turn both off and get the original behaviour exactly.

### Callings (job preferences)

- Every adult has a liking from -1 to 1 for each job. It starts from a stable hash, plus a trait bias (`kind` leans to doctor and teacher, `hotheaded` to guard and hunter, `greedy` to baker, smith and fisher, `diligent` to farmer and builder), blended 50/50 with the parents' average, so families share a craft.
- When the job planner fills vacancies, the score is skill + a small random roll + `liking x 10`. Skill is still decisive, but a person who loves fishing will beat an equally skilled person who does not.
- Being content in a job slowly raises its liking, and liking a job lifts mood a little each day. An accident at work lowers it.
- Someone who has held a job at least 6 days, has mood of 50 or less and strongly dislikes it (liking below -0.3) may quit. The village still gets its required headcount: the planner just picks someone else or finds them another job.
- The villager card shows **Calling** (the job they would choose) and the **Callings** panel shows how many people are in a liked job.

### Memory and goals

- Each villager keeps their last 30 memories: going hungry, serious injuries, births, marriage, deaths of people close to them, and goals met or abandoned.
- Having starved makes a person lean to food jobs for 30 days. A recent loss makes them more likely to seek company.
- About one day in four, a person without a goal may set one: **master** a job (reach level 5, 60 days), **befriend** someone (14 days) or **win over** a single villager (24 days, feeds the marriage mod's relationship score). Goals end in success, or are given up when the target is gone or time runs out. Success raises mood.
- Friend and court goals send the villager on one short visit a day in spare time, never when food is short or they are tired or hurt.
- The villager card shows the current **Goal** and the last two memories, and the **Ambitions** panel shows totals.

## Life recorder

`mods/recorder.js` keeps a dossier for every person: when they were born or arrived, a capped list of life events (jobs, marriages, children, injuries, illness, crimes, skills, goals, death), a job history, a time-use breakdown (sampled every 20 ticks), their most common decisions, and a mood/health/hunger series. It is **passive**: it only reads the world, never uses the random generator, and a test in `smoke.js` proves a run is identical with it on or off.

- In the browser: the **Life recorder** panel, the **Life story** button on a villager card, and **Life stories** on the game-over card. Each opens a modal; **Download all (JSON)** exports everything.
- In Node: `node lives.js [seed] [days] [--out file.jsonl] [--who name]`. With `--out`, each finished life is streamed to a JSON-lines file and dropped from memory, which is the way to run very long studies.
- From code: `SmallWorld.rec.study(world)` returns village-wide numbers (average lifespan, causes of death, time use, job share, goal success rate) and `SmallWorld.rec.all(world)` the dossiers.
- Cost: about 2.3 MB of JSON for a 1000-day run. Without a sink the browser keeps the last 1200 finished lives.

## Mood

Each day a villager's mood moves 35% of the way to a target:

| Factor | Effect on target |
| --- | --- |
| Base | 58 |
| Hunger above 55 | +10 |
| Hunger 25 to 40 / below 25 | -6 / -18 |
| Has a home / homeless | +6 / -12 |
| Cold | -10 |
| Sick | -12 |
| Injury | `-0.15 x injury` |
| Energy below 20 | -6 |
| No food in the storehouse | -8 |
| Grief | `-0.45 x grief` |
| Recent joy (marriage) | `+joy` |
| Married to a living spouse | +8 |
| Child | +10 |

Mood changes work speed (80% to 120% of base). Grief fades 5 points per day.

**Despair.** An adult whose mood stays below 22 for 4 consecutive days has a 12% chance each day to leave the village for good. If everyone leaves, the run ends with the cause *abandonment*.

**Grief.** When someone dies, their spouse gets 55 grief and each parent or child 35. Close friends (relationship above 40) get 15. Everyone else loses 1.5 mood.

## Family

- Singles aged 16 to 50 with mood above 40 and no illness are considered each day. Each man has a 20% chance of choosing the best available partner, scored by existing friendship, a random factor and age gap. Close relatives never marry.
- Married couples try to share a house.
- A married woman aged 15 to 42, at least 8 days since her last birth, has a 27% chance per day to have a child, provided: population is under 90, food is at least `pop x 2.5`, there is spare housing, and she has health >= 50, hunger >= 30 and mood >= 30.
- If all single adults of one gender are gone, a stranger of that gender occasionally turns up at dusk.
- Widows and widowers stay in the family tree. See the **Family tree** button in the History panel.

## Friendships and rivalries

Relationship scores run from -100 to 100 and decay by 3% a day.

- Every day each person meets housemates and two random villagers. The score changes by roughly `+0.8` plus modifiers: cheerful pair +1, same job +0.5, a kind person +0.7, two hotheads -3, a greedy person -0.8, no food in store -1.5. A random quarrel (15% chance) costs 3.
- **Gossip:** a villager's mood drifts 6% towards their happiest close friend (relationship above 45).
- **Brawls:** each day there is a 35% chance that a hothead or a miserable person fights their worst enemy (below -40). Both are hurt, then the grudge fades by 10.

## Health, injury and healing

| Cause | Detail |
| --- | --- |
| Work accidents | Chance per action: woodcutting 1.2%, building 0.8%, smithing 1.0%, others 0.2%, reduced 5% per skill level. Injury 8 to 28 |
| Hunting | 8% chance of a 12-point injury on each kill |
| Infection | A wound of 15+ has an 18% chance to become infected: 0.05 damage per tick, +3 injury per day, 28% daily chance to clear (40% with a doctor around) |
| Recovery | Injury falls 3 per day naturally, 1 more if fed, 2 if resting indoors |
| Resting | At injury 55+ a villager goes home and naps until recovered |
| Doctors | Treat the sick and injured: -15 injury, +health, reduce sickness days, cure infections nearby |

## Governance

- Every 10 days (each season) the village **elects** a council: the best-scoring adults (age 20+, not near the end of life, health > 30, mood > 25). Score favours age (capped at 50), skills, honesty/kindness, friendships and mood.
- Council size is `min(5, max(1, floor(pop / 6)))`. The top scorer is **elder** with a vote weight of 1.5.
- The council **votes** on priority (food, wood, build or balanced) and rationing, based on stock levels. Greedy members sometimes vote against rationing.
- Votes also happen every 5 days if food is below 35% of target.
- When the elder dies, a successor is elected immediately.
- You can override all of this in the Governance panel. See the [Gameplay Guide](Gameplay-Guide.md).

## Law and order

Adults two days past adulthood may steal from the storehouse. *Temptation* rises with hunger, an empty store, misery, greed and previous crimes, and falls with honesty, owning a home and guards.

| Step | Detail |
| --- | --- |
| Theft | Takes 4 food if starving, otherwise 6 to 12. Starving thieves are fed. Others sell the goods for coins |
| Caught? | 35% + 15% per guard + 10% with a tower |
| Trial | Held at the next dawn. The elder's trait matters |
| Pardon | Hungry offenders, usually (kind elders always) |
| Fine | Up to 10 coins, goods returned |
| Prison | 3 days in a cell next to the storehouse, -14 mood |
| Banishment | With 4+ prior crimes the sentence is a coin-flip between banishment and prison (2-3 crimes: prison; first offence: 60% fine, 40% prison). Banishment is permanent and lowers family mood |

## Market

A village treasury starts with 20 coins. A visiting trader arrives randomly (after day 8) and stays two days.

| Item | Base price | Scarcity multiplier |
| --- | --- | --- |
| Food | 2 | `target / stock`, limited to 0.5-2.5 |
| Wood | 1.5 | same, against the wood target |
| Tools | 8 | against `population` |
| Bread | 4 | fixed 0.9x |

The trader **buys** surplus wood (above 110% of target), food (above 140% of target) and tools (more than `max(3, pop / 2)`), paying 90% of price, up to 60 of each. It **sells** food when you are below 80% of the food target and the treasury can pay. When profit exceeds 10 coins, 30% is split equally among villagers.

## History

Every villager ever born or arrived is recorded in `world.registry`. The **Family tree** modal shows who married whom, children, and what became of everyone. The **Timeline** modal plots population with markers for disasters (red) and new years (grey) and lists key events.
