# publish.ps1 — push this app folder to a PUBLIC GitHub repo so it can be served by
# GitHub Pages (HTTPS) and installed on your phone.
#
# First create an empty PUBLIC repo on GitHub (e.g. soulslike-narrative-app), then:
#   .\publish.ps1 -RemoteUrl https://github.com/<you>/soulslike-narrative-app.git
#
# The app contains NO secrets — your token is typed into the app on the phone and stored
# only on the phone — so a public repo is safe. Your story data stays in the PRIVATE repo.
param([Parameter(Mandatory = $true)][string]$RemoteUrl)

$appDir = $PSScriptRoot

if (-not (Test-Path (Join-Path $appDir ".git"))) {
  git -C $appDir init
  git -C $appDir branch -M main
  git -C $appDir remote add origin $RemoteUrl
} else {
  git -C $appDir remote set-url origin $RemoteUrl
}

git -C $appDir add -A
git -C $appDir commit -m "Publish Narrative Forge app"
if ($LASTEXITCODE -ne 0) { Write-Host "Nothing new to commit." -ForegroundColor DarkGray }

git -C $appDir push -u origin main
if ($LASTEXITCODE -ne 0) { Write-Host "Push failed — check the URL and your GitHub auth." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Pushed. Final step — enable GitHub Pages:" -ForegroundColor Green
Write-Host "  1. On GitHub open the app repo -> Settings -> Pages" -ForegroundColor Gray
Write-Host "  2. Source: 'Deploy from a branch'  ->  Branch: main  /  (root)  -> Save" -ForegroundColor Gray
Write-Host "  3. Wait ~1 min, then open the shown URL on your phone." -ForegroundColor Gray
$leaf = Split-Path -Leaf ($RemoteUrl -replace '\.git$', '')
Write-Host "  URL will look like:  https://<you>.github.io/$leaf/" -ForegroundColor Gray
