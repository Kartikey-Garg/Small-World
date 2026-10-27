# AI Leader — Setup Guide

One villager (the elected elder) is given a live LLM mind via Ollama.
They think in natural language, act in the world, and their thoughts are
recorded as memories. No code or action menus are exposed to the AI — it
simply lives.

---

## Step 1 — Install Ollama

Download and run the Windows installer:

```
https://ollama.com/download
```

After install, Ollama runs as a background service on `http://localhost:11434`.
You can confirm it is running:

```powershell
curl http://localhost:11434
# should return: Ollama is running
```

---

## Step 2 — Pull the model (one-time, ~1.3 GB download)

```powershell
ollama pull llama3.2:1b
```

To upgrade to a larger model later (better reasoning, slower):

```powershell
ollama pull llama3.2:3b
```

---

## Step 3 — Start the game

```powershell
node serve.js
# open http://localhost:8765 in your browser
```

The AI mind activates automatically on day 0. The elected elder becomes
the AI-controlled agent. Watch the **AI Mind** panel in the right sidebar.

---

## Optional — Change model or endpoint

Add this before the `<script src="mods/ai_leader.js">` line in `index.html`:

```html
<script>
  window.AI_LEADER_MODEL    = 'llama3.2:3b';           // change model
  window.AI_LEADER_ENDPOINT = 'http://localhost:11434/api/generate'; // default
  window.AI_LEADER_DEBUG    = true;                    // log prompts to console
</script>
```

---

## How it works

| What you see | What is happening |
|---|---|
| Elder keeps working normally | LLM is thinking in the background (one async call) |
| "thinking..." in the AI Mind panel | Waiting for Ollama response; the elder is not frozen |
| "reconnecting..." in panel | Ollama not reachable — elder works normally, will retry |
| AI Mind panel shows thought | Last natural language response from LLM |
| **Unimplemented intentions** list | Actions the AI tried that don't exist yet — your feature backlog |

---

## Speed note

The AI mind works best at **1x speed** (or 3x at most).
The elder never idles while waiting for Ollama: they carry on with their
normal job, and the AI's decision is applied when their current task ends.
At higher speeds decisions arrive less often relative to game time, and
decisions older than ~15s of game time are discarded as stale.

---

## What the AI controls

- Its own physical actions (walk, work, sleep, eat, farm, fish, build, speak)
- Job assignments for other villagers (via natural language directives)
- Relationship-building through conversations
- Village policy through governance (elder vote still runs normally)

## What the AI does not control

- Other villagers' survival instincts (eating, sleeping)
- Physics (pathfinding, building mechanics, resource consumption)
- Events and disasters (these still happen randomly)

---

## Extending the action vocabulary

When the AI tries an action that doesn't exist, it appears in the
**Unimplemented intentions** list in the AI Mind panel. To implement one,
add an entry to the `ACTIONS` array in `mods/ai_leader.js`:

```js
{
  id: 'pray',
  match: ['pray', 'worship', 'ritual', 'ceremony'],
  build: (w, a) => w.planWander(a, 'performing a ritual'),
},
```

The AI will never know new actions were added. It will simply find that
its intentions now have effects in the world.
