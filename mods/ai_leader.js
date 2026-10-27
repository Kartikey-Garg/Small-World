/* =============================================================================
   AI LEADER  —  mods/ai_leader.js
   Gives one villager (the elected elder) a live LLM mind via Ollama.
   The agent lives, thinks, and acts through natural language.
   No restrictions are placed on the AI's thinking.
   The interpreter translates intentions into sim actions silently.

   Prerequisites (browser only — ignored in Node headless runs):
     1. Install Ollama  →  https://ollama.com/download
     2. Pull a model    →  ollama pull llama3.2:1b
     3. Start Ollama    →  ollama serve   (runs on http://localhost:11434)

   Config (optional) — set before loading this script:
     window.AI_LEADER_MODEL    default: 'llama3.2:1b'
     window.AI_LEADER_ENDPOINT default: 'http://localhost:11434/api/generate'
     window.AI_LEADER_DEBUG    default: false  — logs prompts/responses to console
   ============================================================================= */
(function () {
  'use strict';

  /* --------------------------------------------------------------------------
     Guard: this mod is browser-only. Node headless runs skip it entirely so
     smoke.js / headless.js / fingerprint.js are unaffected.
  -------------------------------------------------------------------------- */
  if (typeof window === 'undefined') return;

  const api = window.SmallWorld;
  if (!api) return;

  const MODEL    = window.AI_LEADER_MODEL    || 'llama3.2:1b';
  const ENDPOINT = window.AI_LEADER_ENDPOINT || 'http://localhost:11434/api/generate';
  const DEBUG    = !!window.AI_LEADER_DEBUG;

  const MEMORY_MAX     = 20;  // thought entries kept on the agent
  // Timing reference: ui.js runs at 10 ticks/sec at 1x speed.
  // DAY = 240 ticks → 1 day = 24 real seconds.
  // Daytime  = ticks 19–180 of each day = ~16 real seconds.
  // Night    = remaining ~8 real seconds (biology drives sleep).
  //
  // While Ollama is thinking (3–8s), the agent keeps doing its normal job;
  // the decision is queued and applied when its current plan ends.
  const FALLBACK_WAIT  = 50;  // 5s cooldown after a network error
  // Minimum ticks between an applied AI decision and the next LLM call.
  // In between, the leader works its normal job instead of idling.
  const MIN_CALL_INTERVAL = 100; // ~10s at 1x
  const DECISION_MAX_AGE  = 150; // queued decisions older than this are stale

  /* --------------------------------------------------------------------------
     Known action vocabulary → sim plan builders
     Each entry: { match: [keywords], build: (w, a) => plan | null }
     The interpreter checks the AI's [action: ...] tag against these in order.
     Unknown actions are logged to w.m.ai.unknownActions for future features.
  -------------------------------------------------------------------------- */
  const ACTIONS = [
    {
      id: 'eat',
      match: ['eat', 'food', 'hungry', 'meal', 'bread', 'drink'],
      build: (w, a) => w.planEat(a) || w.planForage(a),
    },
    {
      id: 'sleep',
      match: ['sleep', 'rest', 'bed', 'tired', 'nap', 'home'],
      build: (w, a) => w.planSleep(a, false),
    },
    {
      id: 'chop_wood',
      match: ['wood', 'chop', 'timber', 'forest', 'tree', 'cut'],
      build: (w, a) => w.planWood(a),
    },
    {
      id: 'farm',
      match: ['farm', 'harvest', 'plant', 'field', 'crop', 'sow', 'reap'],
      build: (w, a) => w.planFarm(a),
    },
    {
      id: 'fish',
      match: ['fish', 'lake', 'catch', 'shore', 'water'],
      build: (w, a) => w.planFish(a),
    },
    {
      id: 'build',
      match: ['build', 'construct', 'house', 'shelter', 'forge', 'well', 'oven', 'school'],
      build: (w, a) => w.planBuild(a),
    },
    {
      id: 'patrol',
      match: ['patrol', 'guard', 'watch', 'defend', 'protect', 'walk around'],
      build: (w, a) => w.planWander(a, 'patrolling the village'),
    },
    {
      id: 'wander',
      match: ['wander', 'explore', 'walk', 'stroll', 'think', 'ponder', 'grieve', 'mourn', 'pray', 'reflect', 'contemplate',
              'ignore', 'dismiss', 'nothing', 'continue', 'nevermind', 'shrug'],
      build: (w, a) => w.planWander(a, 'walking and thinking'),
    },
    {
      id: 'speak',
      match: ['speak', 'talk', 'ask', 'tell', 'meet', 'visit', 'gather', 'council', 'address'],
      build: (w, a, target) => {
        const t = target || nearestOther(w, a);
        if (!t) return w.planWander(a, 'looking for someone to talk to');
        return {
          steps: [
            api.util.mv(Math.floor(t.x), Math.floor(t.y), `walking to ${t.name}`),
            {
              t: 'work', ticks: 30, label: `speaking with ${t.name}`,
              done: a2 => {
                const clamp = api.util.clamp;
                a2.rel[t.id] = clamp((a2.rel[t.id] || 0) + 4, -100, 100);
                t.rel[a2.id]  = clamp((t.rel[a2.id]  || 0) + 4, -100, 100);
                a2.mood = Math.min(100, a2.mood + 3);
              },
            },
          ],
          claims: [], kind: 'work',
        };
      },
    },
    // ---- newly implemented intentions ----------------------------------------
    {
      // greet: a brief, warm hello — quicker and lighter than speak
      id: 'greet',
      match: ['greet', 'welcome', 'salute', 'say hello', 'wave'],
      build: (w, a, target) => {
        const t = target || nearestOther(w, a);
        if (!t) return w.planWander(a, 'looking for someone to greet');
        return {
          steps: [
            api.util.mv(Math.floor(t.x), Math.floor(t.y), `going to greet ${t.name}`),
            {
              t: 'work', ticks: 12, label: `greeting ${t.name}`,
              done: a2 => {
                const clamp = api.util.clamp;
                a2.rel[t.id] = clamp((a2.rel[t.id] || 0) + 3, -100, 100);
                t.rel[a2.id]  = clamp((t.rel[a2.id]  || 0) + 3, -100, 100);
                a2.mood = Math.min(100, a2.mood + 1);
                t.mood  = Math.min(100, t.mood + 2);
                w.log(`${a2.name} greeted ${t.name}.`, 'info');
              },
            },
          ],
          claims: [], kind: 'work',
        };
      },
    },
    {
      // examine: walk to a person and observe them — small relationship + mood
      // boost; if they are sick/injured the AI gains awareness of the problem
      id: 'examine',
      match: ['examine', 'inspect', 'check on', 'check', 'look at', 'observe', 'assess', 'survey', 'scan'],
      build: (w, a, target) => {
        const t = target || w.agents.filter(o => o !== a && (o.sick > 0 || o.injury > 20)).sort((p, q) =>
          Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0] || nearestOther(w, a);
        if (!t) return w.planWander(a, 'looking around');
        return {
          steps: [
            api.util.mv(Math.floor(t.x), Math.floor(t.y), `going to examine ${t.name}`),
            {
              t: 'work', ticks: 20, label: `examining ${t.name}`,
              done: a2 => {
                const clamp = api.util.clamp;
                a2.rel[t.id] = clamp((a2.rel[t.id] || 0) + 2, -100, 100);
                t.rel[a2.id]  = clamp((t.rel[a2.id]  || 0) + 2, -100, 100);
                a2.mood = Math.min(100, a2.mood + 2);
                if (t.sick > 0 || t.injury > 20) {
                  w.log(`${a2.name} checked on ${t.name} — ${t.sick > 0 ? 'they are ill' : 'they are injured'}.`, 'info');
                }
              },
            },
          ],
          claims: [], kind: 'work',
        };
      },
    },
    {
      // tend_to: walk to the nearest sick or injured person and help them recover
      // mirrors the doctor job's heal step — no resources needed, smaller effect
      id: 'tend_to',
      match: ['tend to', 'tend_to', 'tend', 'care for', 'help', 'nurse', 'comfort', 'look after'],
      build: (w, a, target) => {
        const sick = w.agents.filter(o => o !== a && (o.sick > 0 || o.injury > 15));
        const t = target && (target.sick > 0 || target.injury > 15) ? target
          : sick.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0]
            || nearestOther(w, a);
        if (!t) return w.planWander(a, 'looking for someone who needs help');
        return {
          steps: [
            api.util.mv(Math.floor(t.x), Math.floor(t.y), `going to tend to ${t.name}`),
            {
              t: 'work', ticks: 40, label: `caring for ${t.name}`,
              done: a2 => {
                const clamp = api.util.clamp;
                if (t.sick > 0) t.sick = Math.max(0, t.sick - 1);
                t.injury  = Math.max(0, t.injury - 8);
                t.health  = Math.min(100, t.health + 4);
                t.mood    = Math.min(100, t.mood + 5);
                a2.rel[t.id] = clamp((a2.rel[t.id] || 0) + 6, -100, 100);
                t.rel[a2.id]  = clamp((t.rel[a2.id]  || 0) + 6, -100, 100);
                w.log(`${a2.name} tended to ${t.name}.`, 'info');
              },
            },
          ],
          claims: [], kind: 'work',
        };
      },
    },
    {
      // tend_to_healing_meds: same as tend_to but uses 2 wood as fuel/herbs
      // and delivers a stronger heal — represents actually making medicine
      id: 'tend_to_healing_meds',
      match: ['tend_to_healing', 'healing meds', 'healing', 'medicine', 'remedy', 'herbs', 'brew', 'potion', 'salve', 'treat', 'cure'],
      build: (w, a, target) => {
        const sick = w.agents.filter(o => o !== a && (o.sick > 0 || o.injury > 15));
        const t = target && (target.sick > 0 || target.injury > 15) ? target
          : sick.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0]
            || nearestOther(w, a);
        if (!t) return w.planWander(a, 'gathering healing herbs');
        const HERB_COST = 2; // wood represents gathered herbs/fuel
        return {
          steps: [
            api.util.mv(w.store.x, w.store.y, 'gathering materials for medicine'),
            {
              t: 'work', ticks: 12, label: 'preparing medicine',
              check: () => w.stock.wood >= HERB_COST,
              done: a2 => { w.stock.wood -= HERB_COST; },
            },
            api.util.mv(Math.floor(t.x), Math.floor(t.y), `bringing medicine to ${t.name}`),
            {
              t: 'work', ticks: 35, label: `treating ${t.name} with medicine`,
              done: a2 => {
                const clamp = api.util.clamp;
                if (t.sick > 0) { t.sick = Math.max(0, t.sick - 2); if (!t.sick) t.sickKind = null; }
                if (t.infected) t.infected = false;
                t.injury  = Math.max(0, t.injury - 20);
                t.health  = Math.min(100, t.health + 10);
                t.mood    = Math.min(100, t.mood + 8);
                a2.rel[t.id] = clamp((a2.rel[t.id] || 0) + 8, -100, 100);
                t.rel[a2.id]  = clamp((t.rel[a2.id]  || 0) + 8, -100, 100);
                w.gain(a2, 'healing', 1);
                w.log(`${a2.name} made medicine and treated ${t.name}.`, 'good');
              },
            },
          ],
          claims: [], kind: 'work',
        };
      },
    },
    {
      // listen: sit with someone and genuinely listen — stronger bond than speak,
      // lifts both moods, helps a grieving or low-mood villager recover faster
      id: 'listen',
      match: ['listen', 'hear out', 'sit with', 'be with', 'console', 'comfort', 'support', 'empathize'],
      build: (w, a, target) => {
        // prefer someone grieving or with low mood
        const t = target || w.agents.filter(o => o !== a && (o.grief > 0 || o.mood < 40))
          .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0]
          || nearestOther(w, a);
        if (!t) return w.planWander(a, 'looking for someone to listen to');
        return {
          steps: [
            api.util.mv(Math.floor(t.x), Math.floor(t.y), `going to listen to ${t.name}`),
            {
              t: 'work', ticks: 50, label: `listening to ${t.name}`,
              done: a2 => {
                const clamp = api.util.clamp;
                // deep connection — stronger boost than speak
                a2.rel[t.id] = clamp((a2.rel[t.id] || 0) + 8, -100, 100);
                t.rel[a2.id]  = clamp((t.rel[a2.id]  || 0) + 8, -100, 100);
                t.mood    = Math.min(100, t.mood + 10);
                a2.mood   = Math.min(100, a2.mood + 4);
                if (t.grief > 0) t.grief = Math.max(0, t.grief - 15);
                w.log(`${a2.name} listened to ${t.name}. Their bond deepened.`, 'info');
              },
            },
          ],
          claims: [], kind: 'work',
        };
      },
    },
    {
      // tend_to_herd: walk to nearest deer, reduce stress/claimed state,
      // small chance of passive food (herd keeps population up)
      id: 'tend_to_herd',
      match: ['tend_to_herd', 'tend herd', 'herd', 'livestock', 'animals', 'deer', 'feed the', 'feed', 'graze', 'shepherd'],
      build: (w, a) => {
        const deer = w.m.deer;
        if (!deer || !deer.length) return w.planWander(a, 'looking for animals to tend');
        const d = deer.sort((p, q) =>
          Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
        return {
          steps: [
            api.util.mv(Math.floor(d.x), Math.floor(d.y), 'walking to the herd'),
            {
              t: 'work', ticks: 45, label: 'tending to the animals',
              done: a2 => {
                // calm the deer — release any hunting claim so they aren't hunted today
                if (d.claimed) d.claimed = null;
                a2.mood = Math.min(100, a2.mood + 4);
                // small passive food yield from tended animals
                if (w.rng() < 0.3) {
                  w.addCarry(a2, 'food', 1);
                  w.log(`${a2.name} tended the animals and gathered some provisions.`, 'info');
                } else {
                  w.log(`${a2.name} tended to the herd.`, 'info');
                }
              },
            },
            ...w.deliverSteps(),
          ],
          claims: [], kind: 'work',
        };
      },
    },
    {
      // meditate: sit still in quiet reflection.
      // Stronger mood/grief recovery than wander; nearby villagers who see
      // their leader at peace get a small mood lift too.
      id: 'meditate',
      match: ['meditate', 'meditation', 'reflect', 'contemplate', 'pray', 'sit quietly', 'be still', 'rest mind'],
      build: (w, a) => {
        // Find a calm spot: near home, or near the lake shore, or just stay put
        const home = a.home;
        let tx = Math.floor(a.x), ty = Math.floor(a.y);
        if (home) {
          tx = Math.max(0, home.x + (w.rng() < 0.5 ? -1 : 1));
          ty = Math.max(0, home.y + 1);
          if (!w.walkable(tx, ty)) { tx = home.x; ty = home.y; }
        } else if (w.shore && w.shore.length) {
          const spot = w.shore[Math.floor(w.rng() * w.shore.length)];
          tx = spot.x; ty = spot.y;
        }
        return {
          steps: [
            api.util.mv(tx, ty, 'finding a quiet spot'),
            {
              t: 'work', ticks: 70, label: 'meditating',
              done: a2 => {
                const clamp = api.util.clamp;
                // Self recovery
                a2.mood  = Math.min(100, a2.mood + 12);
                if (a2.grief > 0) a2.grief = Math.max(0, a2.grief - 20);
                // Nearby villagers feel the calm presence of their leader
                for (const o of w.agents) {
                  if (o === a2) continue;
                  if (Math.hypot(o.x - a2.x, o.y - a2.y) > 4) continue;
                  o.mood = Math.min(100, o.mood + 4);
                  o.rel[a2.id] = clamp((o.rel[a2.id] || 0) + 2, -100, 100);
                  a2.rel[o.id] = clamp((a2.rel[o.id] || 0) + 1, -100, 100);
                }
                w.log(`${a2.name} sat in quiet meditation.`, 'info');
              },
            },
          ],
          claims: [], kind: 'work',
        };
      },
    },
  ];

  /* --------------------------------------------------------------------------
     Helpers
  -------------------------------------------------------------------------- */
  function nearestOther(w, a) {
    let best = null, bd = Infinity;
    for (const o of w.agents) {
      if (o === a) continue;
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // Find a named villager from freeform text ("Jonas", "mara", "the elder")
  function findNamedTarget(w, a, text) {
    const lower = text.toLowerCase();
    for (const o of w.agents) {
      if (o === a) continue;
      if (lower.includes(o.name.toLowerCase())) return o;
    }
    return null;
  }

  // Parse action from AI response — three tiers:
  // 1. Explicit bracketed tag:  [action: word]
  // 2. Bare tag (model forgot brackets):  action: word
  // 3. Word-boundary keyword scan of full response text
  function parseAction(text) {
    // tier 1 — bracketed
    let m = text.match(/\[action:\s*([^\]\n]+)\]/i);
    if (m) return m[1].trim().toLowerCase();
    // tier 2 — bare (last line often "action: word")
    m = text.match(/^action:\s*([^\n\]]+)/im);
    if (m) return m[1].trim().toLowerCase();
    // tier 3 — word-boundary keyword scan (avoids "rest" matching "forest")
    const lower = text.toLowerCase();
    for (const act of ACTIONS) {
      if (act.match.some(kw => new RegExp('\\b' + kw + '\\b').test(lower))) return act.id;
    }
    return null;
  }

  // Match action tag to a known ACTIONS entry
  function resolveAction(tag, text) {
    if (!tag) return null;
    // An exact id wins over keyword matches elsewhere in the text.
    const exact = ACTIONS.find(a => a.id === tag);
    if (exact) return exact;
    const combined = tag + ' ' + text.toLowerCase();
    for (const a of ACTIONS) {
      if (a.match.some(kw => combined.includes(kw))) return a;
    }
    return null;
  }

  /* --------------------------------------------------------------------------
     Observation builder — what the AI "sees" each time it wakes up.
     Kept compact: target < 600 tokens so it fits any small model.
  -------------------------------------------------------------------------- */
  function buildObservation(w, a) {
    const clamp01 = v => Math.round(Math.max(0, Math.min(100, v)));

    // Vitals
    const vitals = `Health ${clamp01(a.health)}%, hunger ${clamp01(a.satiety)}%, energy ${clamp01(a.energy)}%` +
      (a.sick > 0 ? `, sick (${a.sickKind || 'ill'})` : '') +
      (a.cold ? ', freezing' : '') +
      (a.injury > 10 ? `, injured (${Math.round(a.injury)}%)` : '');

    // Surroundings — nearest 4 people
    const nearby = w.agents
      .filter(o => o !== a)
      .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))
      .slice(0, 4)
      .map(o => {
        const rel = a.rel[o.id] || 0;
        const feel = rel > 40 ? 'friend' : rel < -30 ? 'rival' : 'neighbour';
        return `${o.name} (${o.job}, ${feel})`;
      }).join(', ') || 'nobody nearby';

    // Village state
    const foodDays = w.targets && w.targets.food > 0
      ? (w.foodEq() / (w.targets.food / 10)).toFixed(1)
      : '?';
    const village = `Day ${w.day}, ${w.season}. Pop ${w.agents.length}. ` +
      `Food: ${Math.floor(w.foodEq())} (≈${foodDays} days). Wood: ${Math.floor(w.stock.wood)}. ` +
      `Houses: ${w.houses.length}. Structs: ${w.structs.map(s => s.kind).join(', ') || 'none'}.`;

    // Relationships — top friends and rivals
    const sorted = Object.entries(a.rel)
      .map(([id, v]) => ({ o: w.get(+id), v }))
      .filter(x => x.o)
      .sort((p, q) => Math.abs(q.v) - Math.abs(p.v))
      .slice(0, 6);
    const rels = sorted.length
      ? sorted.map(x => `${x.o.name} (${x.v > 0 ? '+' : ''}${Math.round(x.v)})`).join(', ')
      : 'no strong bonds yet';

    // Recent memories (last 6)
    const mems = (a.mem || []).slice(-6)
      .map(m => `day ${m.d}: ${m.t}`)
      .join('; ') || 'nothing notable';

    // AI's own recent thoughts (last 3)
    const prevThoughts = (a.aiMemory || []).slice(-3)
      .map(m => `day ${m.day}: "${m.thought.slice(0, 80)}"`)
      .join('\n') || 'none yet';

    // Governance
    const G = w.m.gov;
    const isElder = G && G.elder === a.id;
    const role = isElder ? 'You are the village elder.' : (G && G.council.includes(a.id) ? 'You are on the council.' : '');

    // God message — injected once then cleared so the AI reads it exactly once.
    // Framed as an urgent direct address so the model engages rather than ignores.
    const AI = w.m.ai;
    const godLine = AI.godMessage
      ? `\nSomeone speaks directly to you: "${AI.godMessage}"\nYou must respond to this. What do you do?`
      : '';
    if (AI.godMessage) AI.godMessage = '';   // consume it

    return [
      `=== ${a.name}'s world ===`,
      `You: ${vitals}.`,
      `You are currently: ${a.label || 'idle'}.${a.carry ? ` Carrying ${a.carry.n} ${a.carry.type}.` : ''}`,
      `Nearby: ${nearby}.`,
      role,
      `Village: ${village}`,
      `Your relationships: ${rels}.`,
      `Your memories: ${mems}.`,
      `Your recent thoughts:\n${prevThoughts}`,
      godLine,
    ].filter(Boolean).join('\n');
  }

  /* --------------------------------------------------------------------------
     System prompt — given once per call as the AI's permanent identity.
     No mention of actions, code, or the simulation. The AI just lives.
  -------------------------------------------------------------------------- */
  const SYSTEM_PROMPT =
`You are a person living in a small village. You have a name, feelings, and responsibilities.
You are not an assistant. You simply exist and live in this world.
Reply as JSON with two fields:
"thought": one or two short sentences (under 40 words) in your own first-person voice about what you feel and intend.
"action": the one thing you do next.
If someone speaks to you, your thought must answer them in your own words. Never repeat their words back, and never ignore them.`;

  // Structured output: Ollama constrains the model to this schema, so a small
  // model can no longer skip the action line or echo the prompt back.
  const RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
      thought: { type: 'string' },
      action:  { type: 'string', enum: ACTIONS.map(x => x.id) },
    },
    required: ['thought', 'action'],
  };

  // Convert the model's JSON reply into the "thought\n[action: x]" text that
  // parseAction / interpret / the memory log already understand.
  function normalizeResponse(raw) {
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) {
      // Truncated JSON: salvage the fields with a regex.
      const t = raw.match(/"thought"\s*:\s*"((?:[^"\\]|\\.)*)/);
      const act = raw.match(/"action"\s*:\s*"([^"]+)"/);
      if (t || act) obj = { thought: t ? t[1] : '', action: act ? act[1] : '' };
    }
    if (!obj) return raw;   // not JSON at all — let the old keyword parsing handle it
    const thought = String(obj.thought || '').trim();
    const action  = String(obj.action  || '').trim();
    return action ? `${thought}\n[action: ${action}]` : thought;
  }

  /* --------------------------------------------------------------------------
     Ollama call — async, non-blocking
  -------------------------------------------------------------------------- */
  async function askOllama(w, a) {
    const observation = buildObservation(w, a);
    const prompt = observation + '\n\nWhat do you do?';

    if (DEBUG) console.log('[AI_LEADER] prompt:\n', prompt);

    const body = JSON.stringify({
      model: MODEL,
      system: SYSTEM_PROMPT,
      prompt,
      format: RESPONSE_SCHEMA,
      stream: false,
      options: { temperature: 0.8, num_predict: 200 },
    });

    const res  = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const data = await res.json();
    return normalizeResponse(data.response || '');
  }

  /* --------------------------------------------------------------------------
     Interpreter — converts AI response into a real sim plan.
     Silent: the AI never sees errors or "unknown action" messages.
  -------------------------------------------------------------------------- */
  function interpret(w, a, response) {
    const actionTag = parseAction(response);
    const matched   = resolveAction(actionTag, response);
    const target    = findNamedTarget(w, a, response);

    let plan = null;

    if (matched) {
      plan = matched.build(w, a, target);
    }

    // Log unknown / unexecutable intentions as a feature backlog
    if (!matched && actionTag) {
      w.m.ai.unknownActions[actionTag] = (w.m.ai.unknownActions[actionTag] || 0) + 1;
      if (DEBUG) console.log('[AI_LEADER] unknown action:', actionTag, '— falling back to wander');
    }

    // Directive parsing: "tell/ask X to Y" → reassign job
    applyDirectives(w, a, response);

    // Fallback: wander if plan failed or action was unrecognised
    if (!plan) plan = w.planWander(a, 'lost in thought');

    return plan;
  }

  // Parse natural language directives about other villagers and apply them.
  // Best-effort — never throws, never blocks.
  function applyDirectives(w, a, text) {
    const lower = text.toLowerCase();
    // "ask/tell/order NAME to JOB" → reassign
    const jobNames = Object.keys(api.jobs);
    for (const target of w.agents) {
      if (target === a) continue;
      const name = target.name.toLowerCase();
      if (!lower.includes(name)) continue;
      // look for a job keyword near the name
      for (const job of jobNames) {
        const pattern = new RegExp(`${name}.{0,40}${job}|${job}.{0,40}${name}`, 'i');
        if (pattern.test(lower)) {
          if (target.job !== job) {
            target.job = job;
            w.log(`${a.name} directed ${target.name} to work as ${job}.`, 'info');
          }
          break;
        }
      }
    }
  }

  /* --------------------------------------------------------------------------
     Leader assignment — called from init() once governance has run.
     Prefers the elected elder; falls back to the oldest adult.
  -------------------------------------------------------------------------- */
  function assignLeader(w) {
    const AI = w.m.ai;
    if (AI.leaderId !== null) return;
    const gov = w.m.gov;
    let leader = gov && gov.elder ? w.get(gov.elder) : null;
    if (!leader) {
      leader = w.agents
        .filter(a => a.age >= api.ADULT_AGE)
        .sort((p, q) => q.age - p.age)[0] || null;
    }
    if (!leader) return;
    leader.ai = true;
    AI.leaderId = leader.id;
    leader.aiMemory = [];
    w.log(`${leader.name} has been given an AI mind. They will lead.`, 'mile');
  }

  /* --------------------------------------------------------------------------
     Core mod registration
  -------------------------------------------------------------------------- */
  api.mods.push({

    init(w) {
      w.m.ai = {
        leaderId: null,          // agent id of the AI-controlled villager
        pending: false,          // true while an Ollama call is in-flight
        godPending: false,       // true when the in-flight call answers a divine message
        lastThought: '',         // last full response text
        lastAction: '',          // last resolved action id
        unknownActions: {},      // { actionTag: count } — the feature backlog
        errorUntil: 0,           // tick to resume after a network error
        lastCallTick: -999,      // tick when last AI decision was applied (rate-limiter)
        decision: null,          // queued LLM response awaiting the end of the current plan
        decisionTick: 0,         // tick when the queued decision arrived
        totalCalls: 0,
        totalErrors: 0,
        godMessage: '',          // pending divine message — consumed on next AI observation
        godHistory: [],          // log of all sent messages { day, text }
      };
      // governance.init() runs before this (mods load in order) so
      // w.m.gov.elder is already elected by the time we get here.
      assignLeader(w);
    },

    // The urgent hook fires first inside think(), i.e. whenever the AI agent's
    // plan is empty. Returning null lets the agent carry on with its normal
    // job, so it never idles waiting for the LLM. Async LLM calls run in the
    // background; their decision is queued and applied here on the next
    // empty-plan moment.
    urgent(w, a) {
      if (!a.ai) return null;
      const AI = w.m.ai;

      // A divine message wakes the leader and bypasses the rate-limiter and
      // night rest. It also overrides any queued (now outdated) decision.
      const godInterrupt = !!AI.godMessage;

      // Waiting for a response — work normally; the decision is queued on
      // arrival. A god message sent meanwhile is answered right after (see
      // startCall's .then).
      if (AI.pending) return null;

      // Network error cooldown — work normally until it passes.
      if (w.tick < AI.errorUntil) return null;

      // Survival overrides — the AI still physically needs to eat and sleep.
      // These bypass the LLM entirely; biology is not optional.
      if (a.satiety < 20 && w.hasFood()) return null;   // let normal think() handle it
      if (a.energy < 10)                 return null;   // let normal think() handle it

      // Night: let biology drive sleep, UNLESS a god message is waiting.
      if (w.isNight() && !godInterrupt) return null;

      if (godInterrupt) {
        AI.decision = null;
      } else {
        // Apply a queued decision now that the previous plan has finished.
        if (AI.decision !== null) {
          const response = AI.decision;
          AI.decision = null;
          if (w.tick - AI.decisionTick <= DECISION_MAX_AGE) {
            AI.lastCallTick = w.tick;
            return interpret(w, a, response);
          }
        }
        // Rate-limit: enforce MIN_CALL_INTERVAL after the last applied decision.
        if (w.tick - AI.lastCallTick < MIN_CALL_INTERVAL) return null;
      }

      startCall(w, a, godInterrupt);
      // Nothing to do yet — the agent continues its normal job meanwhile.
      return null;
    },

    // When the AI agent dies, pass the mind to the next elder
    die(w, a) {
      if (!a.ai) return;
      a.ai = false;
      w.m.ai.leaderId = null;
      w.m.ai.pending = false;
      w.m.ai.godPending = false;
      w.log(`The AI mind of ${a.name} has gone silent. Their thoughts are recorded.`, 'mile');
      // re-elect after a short delay — governance will have updated by next tick
      setTimeout(() => { if (!w.gameOver) assignLeader(w); }, 100);
    },

    // When the AI agent leaves voluntarily
    leave(w, a) {
      if (!a.ai) return;
      a.ai = false;
      w.m.ai.leaderId = null;
      w.m.ai.pending = false;
      w.m.ai.godPending = false;
      setTimeout(() => { if (!w.gameOver) assignLeader(w); }, 100);
    },
  });

  // Start an async LLM call. godInterrupt=true means this call carries a divine
  // message: its reply replaces the current plan immediately.
  function startCall(w, a, godInterrupt) {
    const AI = w.m.ai;
    AI.pending = true;
    AI.godPending = godInterrupt;
    AI.totalCalls++;

    askOllama(w, a)
      .then(response => {
        if (DEBUG) console.log('[AI_LEADER] response:\n', response);

        // Store thought in agent memory
        const actionTag = parseAction(response) || 'wander';
        const thought   = response.replace(/\[action:[^\]]*\]/gi, '').trim();
        AI.lastThought  = thought;
        AI.lastAction   = actionTag;

        const mem = { day: w.day, thought, action: actionTag };
        a.aiMemory = a.aiMemory || [];
        a.aiMemory.push(mem);
        if (a.aiMemory.length > MEMORY_MAX) a.aiMemory.shift();

        // Also push into the sim's memory ring so existing UI picks it up
        if (api.goals && api.goals.remember) {
          api.goals.remember(w, a, 'thought', thought.slice(0, 60));
        }

        if (a.alive) {
          if (godInterrupt) {
            // Reply to a divine message: show it and act immediately, replacing
            // whatever is running. w.endPlan clears claims before the new steps.
            w.log(`${a.name} answers the divine voice: "${thought}"`, 'mile');
            const plan = interpret(w, a, response);
            w.endPlan(a);
            a.plan     = plan.steps;
            a.planKind = plan.kind;
            for (const c of (plan.claims || [])) w.claim(a, c);
            AI.decision     = null;
            AI.lastCallTick = w.tick;
          } else {
            // Queue it — applied by urgent() when the current plan ends.
            AI.decision     = response;
            AI.decisionTick = w.tick;
          }
        }

        AI.pending    = false;
        AI.godPending = false;
        // A divine message arrived while this call was in flight: answer it now.
        if (a.alive && AI.godMessage) startCall(w, a, true);
      })
      .catch(err => {
        AI.totalErrors++;
        AI.pending    = false;
        AI.godPending = false;
        AI.errorUntil = w.tick + FALLBACK_WAIT;
        if (DEBUG) console.warn('[AI_LEADER] Ollama error:', err.message || err);
        // Silently fall back — the agent works normally until errorUntil passes
      });
  }

  /* --------------------------------------------------------------------------
     godSpeak action — sets the divine message on the AI's next observation.
     Reads the input value from the DOM directly (no changes to ui.js needed).
  -------------------------------------------------------------------------- */
  api.actions.godSpeak = (w) => {
    const inp = document.getElementById('ai-god-input');
    if (!inp) return;
    const msg = inp.value.trim();
    if (!msg || w.gameOver) return;
    const AI = w.m.ai;
    if (!AI) return;
    AI.godMessage = msg;
    AI.godHistory.push({ day: w.day, text: msg });
    if (AI.godHistory.length > 10) AI.godHistory.shift();
    const leader = AI.leaderId ? w.get(AI.leaderId) : null;
    AI.decision = null; // any queued decision predates this message
    // Answer right away. If a call is already in flight, its .then starts the
    // divine call as soon as it finishes (godMessage stays set until then).
    if (leader && leader.alive && !AI.pending) startCall(w, leader, true);
    w.log(`A divine voice speaks: "${msg}"`, 'mile');
    inp.value = '';
    inp.blur(); // a focused input freezes the panel, hiding the thinking/response
  };

  // Enter key fires godSpeak when the input is focused — registered once.
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    if (document.activeElement && document.activeElement.id === 'ai-god-input') {
      const w = window.__world && window.__world();
      if (w) api.actions.godSpeak(w);
    }
  });

  /* --------------------------------------------------------------------------
     UI — sidebar panel showing the AI mind's state
  -------------------------------------------------------------------------- */
  api.panels.push({
    id: 'ai_leader',
    title: 'AI Mind',
    html(w) {
      const AI = w.m.ai;
      if (!AI) return null;
      const a = AI.leaderId ? w.get(AI.leaderId) : null;
      if (!a) return '<div class="sub muted">No AI leader active.</div>';

      // If the user is actively typing in the input, freeze the panel HTML so
      // ui.js's innerHTML-only-on-change guard skips the re-render entirely.
      // This prevents focus loss and cursor jumping on every 250ms poll.
      const existingInput = document.getElementById('ai-god-input');
      if (existingInput && document.activeElement === existingInput) {
        return this._lastHtml || '';   // return previous render verbatim — no DOM change
      }

      const statusTxt = AI.pending
        ? (AI.godPending || AI.godMessage ? 'hearing the divine voice, thinking...' : 'thinking...')
        : (AI.errorUntil > w.tick ? 'reconnecting...' : 'active');
      const thought = AI.lastThought
        ? `<div class="sub" style="font-style:italic;margin-top:6px">"${AI.lastThought.slice(0, 180)}${AI.lastThought.length > 180 ? '…' : ''}"</div>`
        : '<div class="sub muted">No thoughts yet.</div>';
      const backlog = Object.entries(AI.unknownActions);
      const backlogHtml = backlog.length
        ? '<div class="sub" style="margin-top:4px">Unimplemented: ' +
          backlog.map(([k, v]) => `<b>${k}</b>×${v}`).join(', ') + '</div>'
        : '';

      // God message history (last 3)
      const histHtml = AI.godHistory.length
        ? '<div class="sub" style="margin-top:6px;color:#9a6bff">Past messages:<br>' +
          AI.godHistory.slice(-3).map(h => `D${h.day}: "${h.text}"`).join('<br>') + '</div>'
        : '';

      const inputRow =
        '<div style="display:flex;gap:4px;margin-top:8px">' +
          '<input id="ai-god-input" type="text" placeholder="Speak to the AI leader…" ' +
            'style="flex:1;background:#14171c;color:#dfe4ea;border:1px solid #3b4553;border-radius:4px;padding:3px 7px;font:inherit;font-size:12px" ' +
            'maxlength="200">' +
          '<button class="sm" data-act="godSpeak" style="white-space:nowrap">Send</button>' +
        '</div>';

      this._lastHtml = `<div class="sub"><b>${a.name}</b> — ${statusTxt}</div>` +
        `<div class="sub">Calls: ${AI.totalCalls} | Errors: ${AI.totalErrors} | Last: ${AI.lastAction || '—'}</div>` +
        thought + backlogHtml + inputRow + histHtml;
      return this._lastHtml;
    },
  });

  /* --------------------------------------------------------------------------
     HUD badge — shows who the AI leader is
  -------------------------------------------------------------------------- */
  api.hud.push({
    id: 'ai_leader',
    label: 'AI mind',
    get(w) {
      const AI = w.m.ai;
      if (!AI || !AI.leaderId) return '—';
      const a = w.get(AI.leaderId);
      return a ? a.name : '—';
    },
  });

  /* --------------------------------------------------------------------------
     Villager info — shows AI tag in sidebar when that agent is selected
  -------------------------------------------------------------------------- */
  api.info.push((a, w) => {
    if (!a.ai) return '';
    const AI = w.m.ai;
    const mem = (a.aiMemory || []).slice(-5).reverse()
      .map(m => `<div class="log-i info"><b>D${m.day}</b>${m.thought.slice(0, 100)}</div>`)
      .join('');
    return `<div class="doing" style="color:#6cc6ff"><b>AI mind active</b> — ${AI.pending ? 'thinking...' : 'ready'}</div>` +
      (mem ? `<div style="margin-top:4px;max-height:120px;overflow-y:auto">${mem}</div>` : '');
  });

})();
