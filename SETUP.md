# Narrative Forge — Setup

A phone app for writing dialogue trees and browsing quests while you're away from your PC.
Edits commit to a **private GitHub repo** (your "cloud storage"); on your PC a one-line
script pulls them into the game's `data/` folder.

```
 Phone (installed web app)  ──commit──▶  GitHub private repo  ──git pull──▶  Your PC  ──▶  data/  ──▶  Godot
        Narrative Forge                  soulslike-narrative      narrative-pull.ps1
```

You only do this setup **once**. Budget ~15 minutes. You need a GitHub account and `git`
installed on the PC (you already have git).

---

## Part A — Create the private data repo (your cloud storage)

1. On GitHub, click **New repository**.
   - Name: `soulslike-narrative`
   - Visibility: **Private**
   - Do **not** add a README/.gitignore (leave it empty).
   - Create.
2. Copy its URL, e.g. `https://github.com/YOURNAME/soulslike-narrative.git`.
3. On the PC, in this folder's sibling `..\narrative-sync`, run:
   ```powershell
   cd C:\Users\ibaim\Documents\soulslike-\tools\narrative-sync
   .\narrative-init.ps1 -RemoteUrl https://github.com/YOURNAME/soulslike-narrative.git
   ```
   This clones the repo to `C:\Users\ibaim\Documents\soulslike-narrative`, copies your
   current dialogue/quest JSON into it, and pushes. (First push may pop up a GitHub
   login via Git Credential Manager — sign in.)

> The repo now mirrors the narrative files: `dialogues/*.json`, `custom_quests.json`,
> `custom_cast.json`, etc. — exactly the shapes Godot already reads.

---

## Part B — Create a GitHub token (so the phone can read/write the repo)

1. Open **https://github.com/settings/tokens?type=beta** (Settings → Developer settings →
   Fine-grained tokens → **Generate new token**).
2. Settings:
   - **Token name:** `narrative-phone`
   - **Expiration:** your choice (e.g. 90 days — you can regenerate later).
   - **Repository access:** *Only select repositories* → pick **`soulslike-narrative`**.
   - **Permissions → Repository permissions → Contents:** **Read and write**.
     (Leave everything else as "No access".)
3. **Generate token** and copy it (starts with `github_pat_…`). You'll paste it into the
   app on your phone in Part D. Treat it like a password.

---

## Part C — Put the app online (GitHub Pages)

The phone needs an HTTPS URL to install the app. We host it free on GitHub Pages from a
**public** repo. (Safe: the app holds no secrets — the token lives only on your phone.)

1. On GitHub create another **New repository**, **Public**, named `soulslike-narrative-app`.
   Copy its URL.
2. On the PC, from **this** folder:
   ```powershell
   cd C:\Users\ibaim\Documents\soulslike-\tools\narrative-phone-app
   .\publish.ps1 -RemoteUrl https://github.com/YOURNAME/soulslike-narrative-app.git
   ```
3. On GitHub: app repo → **Settings → Pages** → Source: *Deploy from a branch* →
   Branch: **main** / **(root)** → **Save**. Wait ~1 minute.
4. Your app URL appears there, like:
   `https://YOURNAME.github.io/soulslike-narrative-app/`

---

## Part D — Install on your phone

1. Open that Pages URL in **Chrome** on your Android phone.
2. Tap **Connect** isn't shown yet — first fill in:
   - **GitHub token:** the `github_pat_…` from Part B
   - **Owner:** your GitHub username
   - **Repository name:** `soulslike-narrative`
   - (Branch defaults to `main`.)
   Then tap **Connect & load**. Your dialogue trees and quests appear.
3. Install it like an app: Chrome menu **⋮ → Add to Home screen**. Now it opens
   fullscreen with its own icon.

You're done. Edit anywhere.

---

## Part E — (optional) Add your Obsidian design vault → the "Docs" tab

Lets you read & edit your design notes (`Narrative/`, `Quests/`, `GameDesign/`, …) from
the phone too. The vault folder itself becomes a git repo (standard Obsidian + git).

1. Create another **private** repo, **`soulslike-vault`**.
2. Let your token reach it: GitHub → the fine-grained token from Part B → **Repository
   access** → add **`soulslike-vault`** (or switch to *All repositories*) → Save.
3. Turn your Obsidian vault into that repo and push it:
   ```powershell
   cd C:\Users\ibaim\Documents\soulslike-\tools\vault-sync
   .\vault-init.ps1 -RemoteUrl https://github.com/YOURNAME/soulslike-vault.git
   ```
   (Vault path lives in `vault-common.ps1` — currently
   `C:\Users\ibaim\Desktop\Soulslike Videogame\Soulslike`.)
4. In the phone app: **⚙ Settings → Advanced → Vault repo name** = `soulslike-vault` →
   **Connect & load**. A **Docs** tab appears next to Dialogues / Quests.

**Sync the vault:** `vault-pull.ps1` (phone → Obsidian) and `vault-push.ps1`
(Obsidian → phone), or use the **Obsidian Git** plugin for auto-sync. See
[../vault-sync/README.md](../vault-sync/README.md).

---

## Daily use

**On the phone:** open the app, edit a dialogue tree or quest, tap **Save**. Each save is
a commit to the private repo.

**On the PC, to pull those edits into the game:**
```powershell
cd C:\Users\ibaim\Documents\soulslike-\tools\narrative-sync
.\narrative-pull.ps1
```
Then open Godot — the changes are in `data/`.

**After you edit on the desktop** (Godot quest editor) and want the phone to see it:
```powershell
.\narrative-push.ps1
```

**Both at once** (grab phone edits, then upload desktop edits):
```powershell
.\narrative-sync.ps1
```
Add `-DryRun` to any of them to preview without touching files.

---

## Demo mode (no account)

Tap **Try demo** on the Settings screen to explore with bundled sample content
(the two Deepmark dialogues + one quest). Edits in demo mode stay on the device and are
**not** pushed to GitHub — handy for trying the UI before connecting.

---

## Security notes

- The token is stored only in your phone's browser storage, scoped to a single private
  repo with just Contents read/write. If you lose the phone, **revoke it** at
  https://github.com/settings/tokens and the access is gone.
- The app repo is public but contains no secrets. Your story stays in the private repo.

## Troubleshooting

- **"Unauthorized"** → token wrong/expired, or not scoped to the repo. Recreate it (Part B).
- **"Forbidden"** → token is missing **Contents: Read & write**.
- **Nothing loads / "offline"** → the app shows your last synced copy; reconnect when you
  have signal and tap **Reload from GitHub** in Settings.
- **"This tree changed on GitHub"** on save → you (or `narrative-push`) changed it
  elsewhere. The app offers to reload the latest; copy your new text out first if needed.
- **`git pull failed` (diverged)** → you edited the same file on phone and desktop without
  syncing. Open `C:\Users\ibaim\Documents\soulslike-narrative`, resolve, then re-run.
