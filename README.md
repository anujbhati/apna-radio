# Apna Radio

Free live radio from around the world, sorted by language (English, Hindi, Punjabi, Tamil, Telugu, Malayalam, Urdu and more).
A plain HTML/CSS/JS site: no framework and no npm packages.

## Files
- `index.html`, `styles.css`, `app.js`: the website.
- `core.js`: the language list and the station-directory logic, shared by the site and the build script.
- `scripts/build-stations.js`: builds `stations.json`. It fetches stations from the free Radio Browser directory, tests every stream
  (for HLS it checks real audio chunks, not just the playlist), merges duplicate listings (the highest bitrate plays first, and the others become backups),
  and keeps stations that are off-air right now if they worked in the last 30 days (many stations only broadcast at certain hours).
- `stations.json`: the generated list the site loads in one request. Commit it, so the site works even if a build can't reach the directory.
- `vercel.json`: tells Vercel to rerun the build script on every deploy.
- `scripts/prune-offair.js`: a second check for stations the live site marks off-air. Stations that still don't play are added to `removed.json`,
  and builds leave them out. To bring a station back, delete its entry from `removed.json` and redeploy.
  Preview without changing anything: `node scripts/prune-offair.js --dry-run`.
- `scripts/nightly-prune.cmd`: runs the check and redeploys if anything was removed. Windows Task Scheduler runs it
  (task "Apna Radio nightly check"), and its output goes to `logs/prune.log`.

## Run it on your computer
```
node scripts/build-stations.js
python -m http.server 5173
```
Then open http://localhost:5173

## Deploy to Vercel (free), when you're ready
1. Put this folder in a GitHub repository.
2. On vercel.com: Add New → Project → import the repository → Deploy (the settings come from `vercel.json`).
3. Every push redeploys and refreshes `stations.json`.
