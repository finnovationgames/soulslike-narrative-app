# Narrative Forge (phone app)

An installable PWA for authoring the soulslike's **dialogue trees** and browsing/editing
**quests** from a phone. Edits are committed straight to a private GitHub repo via the
GitHub Contents API — **no backend server**. See [SETUP.md](SETUP.md) for the full install.

## How it fits together
- Reads/writes the same JSON the Godot editor uses (`dialogues/<id>.json`,
  `custom_quests.json`, …). Serialized with tab indent to match `JSON.stringify(data,"\t")`.
- Edits a deep clone and **mutates fields in place**, so unmanaged fields
  (`condition`, `timer`, `timeout_choice`, `requires_trait`, `skip_to`, `pos`, …) are
  preserved losslessly. `pos` is editor-only layout metadata the game ignores.
- Optimistic concurrency: each file's git blob SHA is sent on save; a stale SHA → the app
  warns and offers to reload instead of clobbering.

## Files
```
index.html            app shell
css/style.css         mobile-first dark theme
js/app.js             boot, hash router, header, data loading, settings
js/github.js          GitHub Contents API client (CORS, token auth)
js/store.js           settings + in-memory data + offline cache (localStorage)
js/dialogue.js        dialogue list + outline editor (the core)
js/map.js             read-only SVG tree map with touch pan/zoom
js/quests.js          quest list + editor (whole-file custom_quests.json)
js/docs.js            Obsidian-vault browser + markdown editor (2nd repo, "Docs" tab)
js/validate.js        light checks (dangling links, unreachable nodes, …)
js/util.js            DOM helpers, base64/UTF-8, bottom-sheet picker
manifest.webmanifest  PWA manifest      sw.js  offline app-shell cache
icons/                app icons         sample-data/  demo content
publish.ps1           push this folder to a public repo for GitHub Pages
```

## Run locally (for development)
```powershell
cd C:\Users\ibaim\Documents\soulslike-\tools\narrative-phone-app
python -m http.server 8080         # or: npx serve .
```
Open http://localhost:8080 and use **Try demo** (no token needed), or connect to a repo.
Service worker only registers over http(s), not `file://`.

## Scope (v1)
Full dialogue authoring + quest browse/light-edit. Deferred: cast/events/encounters
editing, node-id renaming, an interactive (draggable) node graph, and offline *writing*
(saving needs a connection). The map is read-only.
