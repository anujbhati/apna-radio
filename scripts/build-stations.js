// Builds stations.json: fetches the station list, tests every stream, and saves the result,
// so the site loads everything in one request. Run: node scripts/build-stations.js
// (Vercel runs it on every deploy, see vercel.json.)
//
// Many stations only broadcast at certain hours, so a failed test does NOT drop a station.
// It stays, marked `offair`, as long as it worked at some point in the last KEEP_DAYS days,
// according to the directory's own regular checks or to an earlier build (`lastLive`).
// Stations in removed.json (failed the build check AND the nightly re-check, see prune-offair.js) are left out.
const fs = require("fs");
const path = require("path");
const core = require("../core.js");
const { checkWithRetry, mapLimit } = require("./stream-check.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "stations.json");
const REMOVED = path.join(ROOT, "removed.json");

// History from the previous build: the live site's stations.json (on Vercel) or the local copy.
async function loadHistory() {
  const history = new Map();
  let prev = null;
  const site = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (site) {
    try { const r = await fetch(`https://${site}/stations.json`); if (r.ok) prev = await r.json(); } catch { /* ignore */ }
  }
  if (!prev && fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { /* ignore */ } }
  for (const s of (prev && prev.stations) || []) if (s.lastLive) history.set(s.id, s);
  return history;
}

function loadRemoved() {
  const ids = new Set(), urls = new Set();
  if (fs.existsSync(REMOVED)) {
    for (const r of JSON.parse(fs.readFileSync(REMOVED, "utf8")).stations || []) {
      ids.add(r.id);
      (r.urls || []).forEach((u) => urls.add(u));
    }
  }
  return { ids, urls, size: ids.size };
}

(async () => {
  let stations;
  try {
    stations = await core.fetchAll(3);
  } catch (e) {
    // Keep the old stations.json if the directory is down, so a deploy never breaks the site.
    if (fs.existsSync(OUT)) { console.warn("Directory unreachable, keeping existing stations.json:", e.message); return; }
    console.error("Directory unreachable and no stations.json yet:", e.message);
    process.exit(1);
  }
  const removed = loadRemoved();
  const before = stations.length;
  stations = stations.filter((s) => !removed.ids.has(s.id) && !removed.urls.has(s.url));
  const history = await loadHistory();
  console.log(`Directory: ${before} streams, ${before - stations.length} skipped (removed.json lists ${removed.size}), history for ${history.size}. Testing streams…`);
  const status = await mapLimit(stations, 24, checkWithRetry, (done, total) => { if (done % 100 === 0) console.log(`  tested ${done}/${total}`); });

  const now = new Date().toISOString();
  const kept = [];
  let live = 0, offair = 0, dropped = 0;
  stations.forEach((s, i) => {
    const prev = history.get(s.id);
    if (status[i] === "live") {
      kept.push({ ...s, offair: false, lastLive: now });
      live++;
      return;
    }
    const lastSeen = [prev && prev.lastLive, s.lastOk].filter(Boolean).sort().pop();
    if (lastSeen && core.daysSince(lastSeen) <= core.KEEP_DAYS) {
      kept.push({ ...s, offair: true, lastLive: lastSeen });
      offair++;
    } else {
      dropped++;
    }
  });

  const grouped = core.group(kept);
  fs.writeFileSync(OUT, JSON.stringify({ updated: now, stations: grouped }));
  const countries = new Set(grouped.map((s) => s.cc)).size;
  const hq = grouped.filter((s) => s.bitrate >= 128).length;
  console.log(`stations.json: ${grouped.length} stations from ${countries} countries (${hq} at 128 kbps or better)`);
  console.log(`  streams: ${live} on air now, ${offair} off-air right now (kept: worked in the last ${core.KEEP_DAYS} days), ${dropped} dropped (silent ${core.KEEP_DAYS}+ days)`);
})();
