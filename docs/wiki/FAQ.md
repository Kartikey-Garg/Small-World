# FAQ and Troubleshooting

## Do I need Node.js to play?

No. Open `index.html` in a browser. Node is only needed for `serve.js` and the test scripts.

## I restarted my computer and the game is still showing

Two separate things can explain this:

- The game does not depend on the Node server once the page has loaded. If a browser tab was restored on startup, it shows the page, and any scripts it already loaded keep running.
- `serve.js` itself does **not** survive a restart. It is an ordinary process, so it stops with the machine. Reload the tab and you will get "connection refused" until you run `node serve.js` again.

If the address bar shows `file:///...`, you opened the file directly and no server is involved.

## The page is blank or "Not found" when using `serve.js`

- Run the command from the project folder, or give an absolute path: `node "C:\path\to\Small World\serve.js"`.
- Check the port is free, or choose another: `node serve.js 3000`.
- The server answers 404 for anything outside the project folder or for directories.

## The 3D view button is greyed out

The browser could not create a WebGL context. Enable hardware acceleration, update your graphics driver, or use the 2D view. The tooltip reads "WebGL not available".

## The game runs slowly at high speed

At 80x the loop runs many simulation ticks per frame. A 40 ms budget per frame protects the page, so you may see jumps rather than smooth motion. The 2D view is lighter than 3D.

## My best run is wrong or disappeared

It lives in `localStorage` under `smallworld.best` for the current site origin. It is separate for `file://`, `http://localhost:8765` and `http://localhost:3000`, and is cleared when you clear site data. Runs that used God mode never update it.

To reset it, run this in the browser console:

```js
localStorage.removeItem('smallworld.best')
```

## Can I save a game?

Not currently. A world exists only in memory. You can, however, reproduce a world exactly in Node with its seed, but the browser UI does not display the seed.

## Why did my village die so quickly?

Look at the cause of death on the game-over card and the [Timeline](Villagers-and-Society.md#history). The usual suspects:

| Cause | Usual reason |
| --- | --- |
| `starvation` | Not enough fields planted before day 23 of the year, or low fertility |
| `exposure` | Out of firewood in winter, or not enough houses |
| `cholera` | No wells |
| `raiders` / `wolves` | No guards or tower |
| `abandonment` | Morale collapsed. Everyone left in despair |

## Why do some villagers do nothing?

When a job has nothing to do (for example a farmer in winter) the villager falls back to wood, fishing or foraging. If those are also unavailable they wander or idle. This is normal in winter.

## Is the simulation random?

It is seeded. A given seed always generates the same map, people and sequence of events given the same inputs. In the browser UI a new random seed is picked for each world.

## What does "godUsed" mean?

You used a power in the God mode panel, or the season skip. The run still plays out but does not set a record.

## How do I add a feature?

See the [Modding Guide](Modding-Guide.md). A new job, building and event can be done in one file with no core changes.

## Do villagers make their own choices?

Within limits, yes. Their routine (eat, sleep, work) is still rule-based, but since the freedom mods they also have job preferences, memories and personal goals, and may quit a job they hate. See [Villagers and Society](Villagers-and-Society.md#free-will-callings-goals-and-memory). To study the results, use the life recorder (`node lives.js`). `new World({ free: false })` restores the old behaviour exactly.

## Known limitations

- No save/load, and no way to choose a seed in the UI.
- No mobile or touch controls for the 3D camera (mouse only).
- Villagers all share one storehouse. There is no per-person property beyond coins.

## License

Small World is open source under the [MIT License](https://opensource.org/license/mit). The full text is in the `LICENSE` file at the repository root. The bundled three.js library is also MIT licensed.
