# Documentation

The long-form documentation for Small World lives in [`wiki/`](wiki). It is written as ordinary Markdown so it can be read directly in the repository, and it is published to the project's **GitHub Wiki** by a workflow.

## Pages

| File | Topic |
| --- | --- |
| [`Home.md`](wiki/Home.md) | Landing page and index |
| [`Getting-Started.md`](wiki/Getting-Started.md) | Running the game, screen layout, controls |
| [`Gameplay-Guide.md`](wiki/Gameplay-Guide.md) | Strategy, policy, God mode |
| [`Simulation-Mechanics.md`](wiki/Simulation-Mechanics.md) | Time, needs, planner, economy, farming |
| [`Villagers-and-Society.md`](wiki/Villagers-and-Society.md) | Mood, family, relations, governance, law, market |
| [`Buildings-and-Jobs.md`](wiki/Buildings-and-Jobs.md) | Every job and structure |
| [`Events-and-Disasters.md`](wiki/Events-and-Disasters.md) | Random events, fires, floods, wolves, raids |
| [`Architecture.md`](wiki/Architecture.md) | Code structure, registries, hook reference |
| [`Modding-Guide.md`](wiki/Modding-Guide.md) | How to write a mod, with a tested example |
| [`Testing-and-Tools.md`](wiki/Testing-and-Tools.md) | Smoke test and diagnostic scripts |
| [`FAQ.md`](wiki/FAQ.md) | Troubleshooting and known limitations |
| `_Sidebar.md`, `_Footer.md` | Wiki navigation (special GitHub Wiki files) |
| `images/` | Screenshots used by the pages |

## Publishing to the GitHub Wiki

GitHub stores a wiki as a separate Git repository (`<repo>.wiki.git`). It does not exist until the first page is created, so there is a one-time manual step.

### One-time setup

1. Push this repository to GitHub.
2. Open the repository's **Settings > General > Features** and make sure **Wikis** is ticked.
3. Open the **Wiki** tab and click **Create the first page**. Type anything and save. This only creates the wiki repository. The workflow will overwrite the content.
4. Open **Settings > Actions > General > Workflow permissions** and select **Read and write permissions**. The workflow pushes with the built-in `GITHUB_TOKEN`.

### Every time after that

Edit files under `docs/wiki/` and push to `main`. The workflow [`publish-wiki.yml`](../.github/workflows/publish-wiki.yml) runs automatically when anything under `docs/wiki/` changes. You can also start it by hand from the **Actions** tab (**Publish wiki > Run workflow**).

What it does:

1. Checks out the repository and the wiki repository.
2. Mirrors `docs/wiki/` into the wiki, including `_Sidebar.md`, `_Footer.md` and `images/`. Pages deleted from `docs/wiki` are removed from the wiki.
3. Rewrites links such as `(Getting-Started.md#section)` to `(Getting-Started#section)`, which is the form GitHub Wiki expects. In the repository the `.md` form is kept so links work when browsing the files.
4. Commits and pushes if anything changed.

> Do not edit pages in the Wiki web editor. The next publish overwrites them.

### If the default branch is not `main`

Change `branches: [main]` in `.github/workflows/publish-wiki.yml`.

### Publishing without the workflow

```bash
git clone https://github.com/<owner>/<repo>.wiki.git
rsync -a --delete --exclude .git docs/wiki/ <repo>.wiki/
cd <repo>.wiki
sed -E -i 's/\]\(([A-Za-z0-9_-]+)\.md(#[^)]*)?\)/](\1\2)/g' *.md
git add -A && git commit -m "Update wiki" && git push
```

## Writing guidelines

- File names become page titles: `Villagers-and-Society.md` appears as "Villagers and Society". Use hyphens, not spaces.
- Link between pages with the `.md` form, for example `[Architecture](Architecture.md#hook-reference)`.
- Put images in `docs/wiki/images/` and reference them as `images/name.png`.
- Mermaid diagrams in fenced `mermaid` blocks render on GitHub, including in the wiki.
- Keep numbers in the reference pages in step with the code. Most come from `sim.js` and `mods/*.js`.
