/* Shared by the website (app.js) and the build script (scripts/build-stations.js):
   the language list, which directory queries to run, and how raw Radio Browser stations are cleaned up. */
(function (root) {
  "use strict";

  const MIRRORS = [
    "https://de1.api.radio-browser.info",
    "https://de2.api.radio-browser.info",
    "https://all.api.radio-browser.info",
  ];

  // Languages, in the order the chips appear. `aliases` are the words Radio Browser uses.
  const LANGS = [
    { id: "hindi", en: "Hindi", native: "हिन्दी", aliases: ["hindi", "bollywood", "hindustani", "filmi"] },
    { id: "punjabi", en: "Punjabi", native: "ਪੰਜਾਬੀ", aliases: ["punjabi", "panjabi", "bhangra"] },
    { id: "english", en: "English", native: "English", aliases: ["english"] },
    { id: "tamil", en: "Tamil", native: "தமிழ்", aliases: ["tamil", "kollywood"] },
    { id: "telugu", en: "Telugu", native: "తెలుగు", aliases: ["telugu", "tollywood"] },
    { id: "malayalam", en: "Malayalam", native: "മലയാളം", aliases: ["malayalam", "ml", "mollywood"] },
    { id: "kannada", en: "Kannada", native: "ಕನ್ನಡ", aliases: ["kannada", "sandalwood"] },
    { id: "bengali", en: "Bengali", native: "বাংলা", aliases: ["bengali", "bangla"] },
    { id: "marathi", en: "Marathi", native: "मराठी", aliases: ["marathi"] },
    { id: "gujarati", en: "Gujarati", native: "ગુજરાતી", aliases: ["gujarati"] },
    { id: "urdu", en: "Urdu", native: "اردو", aliases: ["urdu"] },
    { id: "bhojpuri", en: "Bhojpuri", native: "भोजपुरी", aliases: ["bhojpuri"] },
    { id: "haryanvi", en: "Haryanvi", native: "हरियाणवी", aliases: ["haryanvi"] },
    { id: "odia", en: "Odia", native: "ଓଡ଼ିଆ", aliases: ["odia", "oriya"] },
    { id: "assamese", en: "Assamese", native: "অসমীয়া", aliases: ["assamese"] },
    { id: "nepali", en: "Nepali", native: "नेपाली", aliases: ["nepali"] },
    { id: "sindhi", en: "Sindhi", native: "سنڌي", aliases: ["sindhi"] },
    { id: "kashmiri", en: "Kashmiri", native: "कॉशुर", aliases: ["kashmiri"] },
    { id: "konkani", en: "Konkani", native: "कोंकणी", aliases: ["konkani"] },
    { id: "sanskrit", en: "Sanskrit", native: "संस्कृतम्", aliases: ["sanskrit"] },
    { id: "other", en: "Mixed", native: "मिक्स", aliases: [] },
  ];
  const ALIAS = {};
  LANGS.forEach((l) => l.aliases.forEach((a) => (ALIAS[a] = l.id)));
  // Words that mark a station abroad as desi even without a language tag.
  const DESI_WORDS = ["desi", "indian", "india", "bollywood", "bhangra", "ghazal", "carnatic", "hindustani"];

  // Directory queries: every station in India, plus Indian-language and desi stations anywhere.
  // "search?language=" matches partially, so "punjabi" also finds "punjabi,english".
  // Broken-looking stations are NOT hidden here: many only broadcast at certain hours.
  // normalise() drops only those that haven't worked for KEEP_DAYS.
  const KEEP_DAYS = 30;
  const q = "&limit=1500&order=clickcount&reverse=true";
  const QUERIES = [
    "/json/stations/search?countrycode=IN&limit=4000",
    ...["hindi", "punjabi", "panjabi", "tamil", "telugu", "malayalam", "kannada", "bengali", "bangla",
      "marathi", "gujarati", "urdu", "bhojpuri", "odia", "assamese", "nepali", "sindhi", "kashmiri", "konkani"]
      .map((l) => `/json/stations/search?language=${l}${q}`),
    ...["bollywood", "desi", "bhangra", "indian", "ghazal"].map((t) => `/json/stations/search?tag=${t}${q}`),
  ];
  // English stations: the most listened-to in these countries. About 120 each before the https/working filters,
  // which leaves roughly 60-80 per country.
  const ENGLISH_COUNTRIES = ["US", "GB", "CA"];
  const ENGLISH_QUERIES = ENGLISH_COUNTRIES.map((cc) =>
    `/json/stations/search?language=english&countrycode=${cc}&hidebroken=true&order=clickcount&reverse=true&limit=120`);
  QUERIES.push(...ENGLISH_QUERIES);

  function classify(raw) {
    const langs = new Set();
    String(raw.language || "").toLowerCase().split(/[,;/]+/).map((x) => x.trim())
      .forEach((x) => { if (ALIAS[x]) langs.add(ALIAS[x]); });
    const words = (raw.tags + " " + raw.name).toLowerCase().split(/[^a-z]+/);
    if (!langs.size) words.forEach((w) => { if (ALIAS[w] && w !== "english" && w !== "ml") langs.add(ALIAS[w]); });
    const isIndia = raw.countrycode === "IN";
    const desi = isIndia || words.some((w) => DESI_WORDS.includes(w));
    // Abroad, an English-only station counts only if it is clearly desi, or comes from the English queries (raw._english).
    if (!isIndia && langs.size === 1 && langs.has("english") && !desi && !raw._english) return null;
    // From the English queries but also listed in another language (Italian, French…): not an English station.
    if (raw._english && !desi && langs.size === 1 && langs.has("english")) {
      const listed = String(raw.language || "").toLowerCase().split(/[,;/]+/).map((x) => x.trim()).filter(Boolean);
      if (listed.some((x) => !ALIAS[x])) return null;
    }
    if (!langs.size) { if (!desi) return null; langs.add("other"); }

    // File each station under the language it is really in, not every language the directory lists:
    // 1. Many Bollywood stations are tagged "english,hindi". An Indian language wins over English.
    const indian = [...langs].filter((l) => l !== "english" && l !== "other");
    if (indian.length && langs.has("english")) langs.delete("english");
    // 2. English-only, but its name/tags say Hindi, Punjabi…: use that language. Desi English abroad: Mixed.
    if (langs.size === 1 && langs.has("english")) {
      const fromWords = [...new Set(words.filter((w) => ALIAS[w] && w !== "english" && w !== "ml").map((w) => ALIAS[w]))];
      if (fromWords.length) { langs.clear(); fromWords.forEach((l) => langs.add(l)); }
      else if (!isIndia && !raw._english) { langs.clear(); langs.add("other"); }
    }
    // 3. Claims to be in lots of Indian languages: it's a mixed station, not one for every category.
    if ([...langs].filter((l) => l !== "english" && l !== "other").length > 3) { langs.clear(); langs.add("other"); }
    return [...langs];
  }

  // Turns one raw directory entry into the small object the site uses, or null to skip it.
  function normalise(raw) {
    const url = raw.url_resolved || raw.url;
    if (!url || !url.startsWith("https://")) return null; // the site is https, so plain-http streams are blocked
    const langs = classify(raw);
    if (!langs) return null;
    // When the directory last heard this stream working. Off-air now is fine (timed broadcasts);
    // silent for KEEP_DAYS means it's gone.
    const lastOk = raw.lastcheckoktime_iso8601 || "";
    if (!raw.lastcheckok && (!lastOk || daysSince(lastOk) > KEEP_DAYS)) return null;
    return {
      id: raw.stationuuid,
      name: raw.name.trim().replace(/^[#*\s]+/, "").replace(/\s+/g, " "),
      url,
      logo: raw.favicon && raw.favicon.startsWith("http") ? raw.favicon.replace(/^http:/, "https:") : "",
      cc: (raw.countrycode || "").toUpperCase(),
      country: raw.country || "",
      state: raw.state || "",
      tags: String(raw.tags || "").split(",").map((t) => t.trim())
        .filter((t) => t && t.length < 22 && !ALIAS[t.toLowerCase()]).slice(0, 2),
      langs,
      bitrate: raw.bitrate || 0,
      hls: raw.hls === 1 || /\.m3u8(\?|$)/i.test(url),
      score: (raw.clickcount || 0) + (raw.votes || 0) * 2,
      lastOk,
      offair: !raw.lastcheckok, // the build script replaces this with its own test result
    };
  }

  function daysSince(iso) {
    const t = Date.parse(iso);
    return isNaN(t) ? Infinity : (Date.now() - t) / 86400000;
  }

  // Merges the results of several queries: drops duplicates and sorts by popularity.
  function merge(lists) {
    const byId = new Map();
    const seen = new Set();
    for (const list of lists) {
      for (const raw of list) {
        if (byId.has(raw.stationuuid)) continue;
        const s = normalise(raw);
        if (!s) continue;
        const key = s.name.toLowerCase() + "|" + s.url;
        if (seen.has(key)) continue;
        seen.add(key);
        byId.set(s.id, s);
      }
    }
    return [...byId.values()].sort((a, b) => b.score - a.score);
  }

  // The same station is often listed several times (64, 128, 320 kbps…). Merge those into one entry:
  // the on-air, highest-bitrate stream plays first, and the rest become backups (`alts`).
  function group(stations) {
    const groups = new Map();
    for (const s of stations) {
      // Ignore quality notes in names, so "X (128k AAC)" and "X (64k AAC)" are one station.
      const base = s.name.toLowerCase().replace(/\(?\b\d{2,3}\s*k(bps)?\b[^)]*\)?/g, "").replace(/\b(aac\+?|mp3|hq|hd)\b/g, "");
      const key = base.replace(/[^\p{L}\p{N}]+/gu, "") + "|" + s.cc;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const out = [];
    for (const list of groups.values()) {
      list.sort((a, b) => (a.offair - b.offair) || ((b.bitrate || 64) - (a.bitrate || 64)) || (b.score - a.score));
      const best = list[0];
      const langs = [...new Set(list.flatMap((s) => s.langs))];
      out.push({
        ...best,
        name: best.name.replace(/\s*\(\d{2,3}\s*k[^)]*\)\s*$/i, "").trim() || best.name,
        langs: langs.length > 1 ? langs.filter((l) => l !== "other") : langs,
        logo: best.logo || (list.find((s) => s.logo) || {}).logo || "",
        score: list.reduce((n, s) => n + s.score, 0),
        alts: list.slice(1).filter((s) => s.url !== best.url).map((s) => ({ url: s.url, hls: s.hls, bitrate: s.bitrate, offair: s.offair })),
      });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  async function api(path, timeout = 20000) {
    let lastErr;
    for (const base of MIRRORS) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeout);
      try {
        const r = await fetch(base + path, { signal: ctl.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) { lastErr = e; } finally { clearTimeout(t); }
    }
    throw lastErr;
  }

  // Runs every query, a few at a time so the directory isn't flooded. Returns one entry per stream
  // (not yet grouped): the build script tests each stream first, then calls group().
  async function fetchAll(concurrency = 4) {
    const results = new Array(QUERIES.length);
    let next = 0, ok = 0;
    async function worker() {
      while (next < QUERIES.length) {
        const i = next++;
        try { results[i] = await api(QUERIES[i]); ok++; } catch { results[i] = []; }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    if (!ok) throw new Error("directory unreachable");
    // Stations found by the English queries keep "English" even without a desi tag (see classify).
    const englishIds = new Set();
    QUERIES.forEach((p, i) => { if (ENGLISH_QUERIES.includes(p)) (results[i] || []).forEach((raw) => englishIds.add(raw.stationuuid)); });
    results.forEach((list) => (list || []).forEach((raw) => { raw._english = englishIds.has(raw.stationuuid); }));
    return merge(results);
  }

  const core = { MIRRORS, LANGS, ALIAS, QUERIES, KEEP_DAYS, classify, normalise, merge, group, api, fetchAll, daysSince };
  if (typeof module !== "undefined" && module.exports) module.exports = core;
  else root.ApnaCore = core;
})(this);
