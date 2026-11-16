// Nightly second check of off-air stations (scheduled by scripts/nightly-prune.cmd).
// Takes the stations the live site marks off-air (they already failed the build's check), tests every stream
// of each one again, and adds the ones that still don't play to removed.json. Builds then leave them out.
// Exit code: 0 = stations removed (deploy needed), 3 = nothing removed, 1 = error.
// Run by hand with --dry-run to see what would be removed without changing anything.
const fs = require("fs");
const path = require("path");
const { checkWithRetry, mapLimit } = require("./stream-check.js");

const ROOT = path.join(__dirname, "..");
const REMOVED = path.join(ROOT, "removed.json");
const SITE = "https://apna-radio.vercel.app";
const DRY = process.argv.includes("--dry-run");

const streamsOf = (s) => [{ url: s.url, hls: s.hls }, ...(s.alts || []).map((a) => ({ url: a.url, hls: a.hls }))];

(async () => {
  const started = new Date();
  console.log(`\n=== ${started.toISOString()} off-air re-check${DRY ? " (dry run)" : ""} ===`);

  // The list the site is serving right now; fall back to the local copy.
  let data;
  try {
    const r = await fetch(`${SITE}/stations.json`, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    data = await r.json();
    console.log(`Live list from ${data.updated}`);
  } catch (e) {
    console.warn(`Couldn't load the live list (${e.message}); using the local stations.json`);
    data = JSON.parse(fs.readFileSync(path.join(ROOT, "stations.json"), "utf8"));
  }
  const offair = data.stations.filter((s) => s.offair);
  console.log(`${offair.length} stations were off-air in the last build. Testing each again…`);

  const results = await mapLimit(offair, 12, async (s) => {
    for (const stream of streamsOf(s)) if ((await checkWithRetry(stream)) === "live") return "live";
    return "dead";
  });

  const dead = offair.filter((_, i) => results[i] === "dead");
  const back = offair.filter((_, i) => results[i] === "live");
  console.log(`Back on air now (kept): ${back.length}`);
  back.forEach((s) => console.log(`  + ${s.name} (${s.cc})`));
  console.log(`Still not playing (${DRY ? "would be removed" : "removed"}): ${dead.length}`);
  dead.forEach((s) => console.log(`  - ${s.name} (${s.cc})  ${s.url}`));

  if (!dead.length) { console.log("Nothing to remove."); process.exit(3); }
  if (DRY) { process.exit(3); }

  let removed = { note: "Stations removed after failing two checks (build + nightly). Builds skip these. Delete an entry to bring a station back.", stations: [] };
  if (fs.existsSync(REMOVED)) removed = JSON.parse(fs.readFileSync(REMOVED, "utf8"));
  const known = new Set(removed.stations.map((r) => r.id));
  for (const s of dead) {
    if (known.has(s.id)) continue;
    removed.stations.push({ id: s.id, name: s.name, cc: s.cc, urls: streamsOf(s).map((x) => x.url), removedAt: started.toISOString() });
  }
  fs.writeFileSync(REMOVED, JSON.stringify(removed, null, 2));
  console.log(`removed.json now lists ${removed.stations.length} stations.`);
  process.exit(0);
})().catch((e) => { console.error("Failed:", e); process.exit(1); });
