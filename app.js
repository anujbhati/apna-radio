/* Apna Radio — free live radio from India and around the world.
   Pages (hash links, so the phone's back button works):
     #/                 home: categories, favourites, recents, countries
     #/lang/<id>        every station in one language ("all" = everything)
     #/country/<CC>     every station from one country
     #/search/<text>    search across all stations
   Station data: stations.json (made by scripts/build-stations.js), see core.js. */
(() => {
  "use strict";

  // ---------- Config ----------
  const { LANGS, api, fetchAll } = window.ApnaCore;
  const LANG_BY_ID = Object.fromEntries(LANGS.map((l) => [l.id, l]));
  const CACHE_KEY = "ar_stations_v7";
  const CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours
  const HQ_KBPS = 128;
  const HLS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js";
  // A colour per category card, so the grid is easy to scan.
  const LANG_HUE = { all: 25, hindi: 12, punjabi: 42, english: 210, tamil: 340, telugu: 150, malayalam: 115, kannada: 265,
    bengali: 355, marathi: 28, gujarati: 300, urdu: 170, bhojpuri: 60, haryanvi: 85, odia: 195, assamese: 235,
    nepali: 220, sindhi: 180, kashmiri: 245, konkani: 160, sanskrit: 38, other: 280 };

  // ---------- Small helpers ----------
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  };
  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch { /* old browser */ }
  const flag = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "🌐");
  const countryName = (cc, fallback) => {
    if (!cc) return fallback || "Online";
    try { return regionNames ? regionNames.of(cc.toUpperCase()) : fallback || cc; } catch { return fallback || cc; }
  };
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initials = (name) => {
    const w = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
    return ((w[0] || "?")[0] + (w[1] ? w[1][0] : "")).toUpperCase();
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // ---------- Loading stations ----------
  // stations.json is made by scripts/build-stations.js on every deploy; the live directory is the fallback.
  async function loadStations() {
    const cached = store.get(CACHE_KEY, null);
    if (cached && Date.now() - cached.t < CACHE_MS && cached.s.length) return cached.s;
    let list = null;
    try {
      const r = await fetch("stations.json", { cache: "no-cache" });
      if (r.ok) list = (await r.json()).stations;
    } catch { /* fall through to the live directory */ }
    if (!list || !list.length) list = window.ApnaCore.group(await fetchAll());
    store.set(CACHE_KEY, { t: Date.now(), s: list });
    return list;
  }

  // ---------- State ----------
  let stations = [];
  let favs = store.get("ar_favs", []);
  let recent = store.get("ar_recent", []);
  const failed = new Set();
  let current = null;
  let queue = [];
  let view = { type: "home" };
  const pageFilter = { text: "", hq: false, sel: "" };
  const lists = { page: [], favs: [], recent: [] }; // what each list on screen is showing, for next/previous

  const isFav = (id) => favs.some((f) => f.id === id);
  const langLabel = (s) => s.langs.map((id) => (LANG_BY_ID[id] || LANG_BY_ID.other).en).join(" · ");
  const sourceHTML = (s) => `<span class="flag">${flag(s.cc)}</span> ${esc(countryName(s.cc, s.country))}`;
  const findStation = (id) => stations.find((s) => s.id === id) || favs.find((s) => s.id === id) || recent.find((s) => s.id === id);
  const searchText = (s) => (s.name + " " + s.tags.join(" ") + " " + s.state + " " + s.country + " " + countryName(s.cc) + " " + langLabel(s)).toLowerCase();
  const matchesText = (s, q) => !q || q.split(/\s+/).every((w) => searchText(s).includes(w));

  // ---------- Routing ----------
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "");
    const [type, ...rest] = h.split("/");
    const arg = decodeURIComponent(rest.join("/"));
    if (type === "lang" && (arg === "all" || LANG_BY_ID[arg])) return { type: "lang", id: arg };
    if (type === "country" && /^[A-Za-z]{2}$/.test(arg)) return { type: "country", id: arg.toUpperCase() };
    if (type === "search" && arg.trim()) return { type: "search", q: arg.trim().toLowerCase() };
    if (LANG_BY_ID[type]) return { type: "lang", id: type, legacy: true }; // old links like #punjabi
    return { type: "home" };
  }

  function route() {
    const next = parseHash();
    if (next.legacy) { history.replaceState(null, "", `#/lang/${next.id}`); }
    const changed = next.type !== view.type || next.id !== view.id;
    view = next;
    if (changed) {
      pageFilter.text = ""; pageFilter.sel = "";
      $("#filter").value = "";
      window.scrollTo(0, 0);
    }
    if (view.type !== "search" && document.activeElement !== $("#search")) $("#search").value = "";
    render();
  }

  function render() {
    const home = view.type === "home";
    $("#home").hidden = !home;
    $("#page").hidden = home;
    if (!stations.length) return;
    if (home) renderHome(); else renderPage();
  }

  // ---------- Pieces ----------
  function logoHTML(s) {
    const h = hue(s.name);
    const bg = `background:linear-gradient(135deg,hsl(${h} 55% 45%),hsl(${(h + 40) % 360} 60% 32%))`;
    const img = s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback>` : "";
    return `<div class="logo" style="${bg}">${img || esc(initials(s.name))}</div>`;
  }

  // Broken logo images fall back to the coloured initials.
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute("data-fallback")) return;
    const row = img.closest("[data-id]");
    const s = row && findStation(row.dataset.id);
    if (img.closest(".stack")) { img.remove(); return; }
    img.replaceWith(document.createTextNode(s ? initials(s.name) : "♪"));
  }, true);

  const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3.1 4.5 6.9 4.5c2.1 0 3.6 1.1 5.1 2.9 1.5-1.8 3-2.9 5.1-2.9 3.8 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21Z"/></svg>';
  const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5Z"/></svg>';

  // One compact station row: thumbnail, name, where it's from, quality, favourite, play.
  function rowHTML(s, { hideLang = false } = {}) {
    const cls = ["station", current && current.id === s.id ? "current" : "", failed.has(s.id) ? "failed" : "", s.offair ? "offair" : ""].join(" ");
    const where = [sourceHTML(s)];
    if (s.state && s.state.toLowerCase() !== (s.country || "").toLowerCase()) where.push(esc(s.state));
    if (!hideLang) where.push(esc(langLabel(s)));
    const badge = s.offair
      ? `<span class="pill off" title="Not broadcasting right now. Some stations only run at certain hours.">Off-air</span>`
      : s.bitrate >= HQ_KBPS ? `<span class="pill hq" title="${s.bitrate} kbps">HQ</span>` : "";
    return `<div class="${cls}" data-id="${s.id}" tabindex="0" role="button" aria-label="Play ${esc(s.name)}, from ${esc(countryName(s.cc, s.country))}">
      <div class="thumb">${logoHTML(s)}</div>
      <div class="st-main">
        <div class="st-name">${esc(s.name)}</div>
        <div class="st-sub">${where.join('<span class="dot">·</span>')}</div>
      </div>
      ${badge}
      <button class="st-fav ${isFav(s.id) ? "on" : ""}" data-fav="${s.id}" aria-label="Favourite">${HEART}</button>
      <span class="st-play" aria-hidden="true">${PLAY}<span class="eq"><i></i><i></i><i></i><i></i></span></span>
    </div>`;
  }

  function fillList(el, items, opts) {
    lists[el.dataset.list] = items;
    el.innerHTML = items.map((s) => rowHTML(s, opts)).join("");
  }

  // ---------- Home ----------
  function renderHome() {
    const counts = { all: stations.length };
    const tops = { all: [] };
    for (const s of stations) {
      for (const l of s.langs) {
        counts[l] = (counts[l] || 0) + 1;
        (tops[l] = tops[l] || []);
        if (s.logo && !s.offair && tops[l].length < 3) tops[l].push(s);
      }
      if (s.logo && !s.offair && tops.all.length < 3) tops.all.push(s);
    }
    const cats = [{ id: "all", en: "All Stations", native: "Sab kuch, ek jagah" }].concat(LANGS.filter((l) => counts[l.id]));
    $("#cats").innerHTML = cats.map((c) => {
      const stack = (tops[c.id] || []).map((s) => `<img src="${esc(s.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback>`).join("");
      return `<a class="cat${c.id === "all" ? " cat-all" : ""}" href="#/lang/${c.id}" style="--h:${LANG_HUE[c.id] ?? 25}">
        <span class="cat-name">${esc(c.en)}</span>
        <span class="cat-native">${c.native !== c.en ? esc(c.native) : "&nbsp;"}</span>
        <span class="cat-foot"><span class="cat-count">${plural(counts[c.id], "station")}</span><span class="stack">${stack}</span></span>
      </a>`;
    }).join("");

    const byCountry = {};
    stations.forEach((s) => (byCountry[s.cc] = (byCountry[s.cc] || 0) + 1));
    const ccs = Object.keys(byCountry).sort((a, b) => (a === "IN" ? -1 : b === "IN" ? 1 : byCountry[b] - byCountry[a]));
    $("#countries").innerHTML = ccs.map((cc) =>
      `<a class="country" href="#/country/${cc || "XX"}"><span class="flag big">${flag(cc)}</span>
        <span class="c-text"><span class="c-name">${esc(countryName(cc))}</span><span class="c-count">${plural(byCountry[cc], "station")}</span></span></a>`).join("");

    renderShelves();
  }

  function renderShelves() {
    $("#favShelf").hidden = !favs.length;
    $("#recentShelf").hidden = !recent.length;
    fillList($("#favList"), favs);
    fillList($("#recentList"), recent.slice(0, 6));
  }

  // ---------- Category / country / search page ----------
  function baseList() {
    if (view.type === "lang") return view.id === "all" ? stations : stations.filter((s) => s.langs.includes(view.id));
    if (view.type === "country") return stations.filter((s) => s.cc === view.id);
    if (view.type === "search") return stations.filter((s) => matchesText(s, view.q));
    return [];
  }

  function renderPage() {
    const base = baseList();
    const byCountry = view.type !== "country";

    // Title and subtitle
    let title, sub;
    if (view.type === "lang") {
      const l = view.id === "all" ? { en: "All Stations", native: "" } : LANG_BY_ID[view.id];
      title = view.id === "all" ? "All Stations" : `${l.en} Radio`;
      sub = [l.native && l.native !== l.en ? l.native : "", plural(base.length, "station")].filter(Boolean).join(" · ");
    } else if (view.type === "country") {
      title = `<span class="flag">${flag(view.id)}</span> ${esc(countryName(view.id))}`;
      sub = plural(base.length, "station");
    } else {
      title = `Results for “${esc(view.q)}”`;
      sub = plural(base.length, "station");
    }
    $("#pageTitle").innerHTML = view.type === "lang" ? esc(title) : title;
    $("#pageSub").textContent = sub;
    document.title = `${$("#pageTitle").textContent} – Apna Radio`;
    $("#filterBox").hidden = view.type === "search";

    // The picker: countries on language/search pages, languages on country pages.
    const counts = {};
    base.forEach((s) => (byCountry ? [s.cc] : s.langs).forEach((k) => (counts[k] = (counts[k] || 0) + 1)));
    const keys = Object.keys(counts).sort((a, b) => (a === "IN" ? -1 : b === "IN" ? 1 : counts[b] - counts[a]));
    $("#selLabel").textContent = byCountry ? "From" : "Language";
    $("#sel").innerHTML = (byCountry ? `<option value="">🌍 All countries</option>` : `<option value="">All languages</option>`) +
      keys.map((k) => `<option value="${k}">${byCountry ? flag(k) + " " + esc(countryName(k)) : esc((LANG_BY_ID[k] || LANG_BY_ID.other).en)} · ${counts[k]}</option>`).join("");
    if (pageFilter.sel && !counts[pageFilter.sel]) pageFilter.sel = "";
    $("#sel").value = pageFilter.sel;
    $("#sel").closest(".pick").hidden = keys.length < 2;
    $("#hq").checked = pageFilter.hq;

    renderPageList(base, byCountry);
  }

  function renderPageList(base = baseList(), byCountry = view.type !== "country") {
    const f = pageFilter;
    const list = base
      .filter((s) => !f.sel || (byCountry ? s.cc === f.sel : s.langs.includes(f.sel)))
      .filter((s) => !f.hq || s.bitrate >= HQ_KBPS)
      .filter((s) => matchesText(s, f.text))
      .sort((a, b) => a.offair - b.offair); // on-air first; off-air (timed broadcasts) at the end
    fillList($("#list"), list, { hideLang: view.type === "lang" && view.id !== "all" && view.id !== "other" });
    const empty = $("#empty");
    empty.hidden = list.length > 0;
    empty.textContent = view.type === "search" && !base.length ? "No stations found. Try a station name, city or language." : "No stations match. Try another filter.";
  }

  function markCurrent() {
    document.querySelectorAll(".station").forEach((c) => c.classList.toggle("current", !!current && c.dataset.id === current.id));
  }

  // ---------- Player ----------
  const audio = $("#audio");
  let hls = null;
  let hlsLib = null;
  let loadTimer = null;

  function setMode(mode) {
    document.body.classList.toggle("playing", mode === "playing");
    document.body.classList.toggle("loading", mode === "loading");
    $("#play").setAttribute("aria-label", mode === "playing" ? "Pause" : "Play");
  }

  function loadHlsLib() {
    if (hlsLib) return hlsLib;
    hlsLib = new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = HLS_SRC; sc.onload = () => res(window.Hls); sc.onerror = rej;
      document.head.appendChild(sc);
    });
    return hlsLib;
  }

  // Each station has its best stream first, then lower-quality backups (s.alts). `alt` picks which one.
  let attempt = 0;
  let currentStream = null;
  const streamsOf = (s) => [{ url: s.url, hls: s.hls, bitrate: s.bitrate }, ...(s.alts || [])];

  async function play(s, alt = 0) {
    const token = ++attempt;
    const stream = streamsOf(s)[alt];
    current = s;
    currentStream = stream;
    if (hls) { hls.destroy(); hls = null; }
    setMode("loading");
    showPlayer(s, stream);
    if (alt === 0) { markCurrent(); addRecent(s); resetClock(); }
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => { if (token === attempt && audio.paused) onFail(s, alt); }, 15000);

    try {
      // HLS (.m3u8): hls.js wherever Media Source works; only iPhones (no MSE) use the native player.
      const useHlsJs = stream.hls && ("MediaSource" in window || "ManagedMediaSource" in window);
      if (useHlsJs) {
        const Hls = await loadHlsLib();
        if (token !== attempt) return;
        audio.removeAttribute("src");
        hls = new Hls();
        let chunkErrors = 0;
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (token !== attempt) return;
          // A playlist with missing audio chunks means the station is off-air right now.
          if (d.fatal || (d.details === "fragLoadError" && ++chunkErrors >= 3)) onFail(s, alt);
        });
        hls.loadSource(stream.url);
        hls.attachMedia(audio);
      } else {
        audio.src = stream.url;
      }
      await audio.play();
    } catch (e) {
      if (token === attempt && e.name !== "AbortError") onFail(s, alt);
    }
    if (alt === 0) api(`/json/url/${s.id}`).catch(() => {}); // counts a listen in the directory, as Radio Browser asks
  }

  function onFail(s, alt = 0) {
    if (current !== s) return;
    clearTimeout(loadTimer);
    if (hls) { hls.destroy(); hls = null; }
    if (alt + 1 < streamsOf(s).length) { // try the next backup stream before giving up
      toast("Backup stream try kar rahe hain…");
      play(s, alt + 1);
      return;
    }
    attempt++;
    stopClock();
    audio.pause();
    audio.removeAttribute("src");
    failed.add(s.id);
    setMode("paused");
    document.querySelectorAll(`.station[data-id="${s.id}"]`).forEach((c) => c.classList.add("failed"));
    toast(s.offair
      ? `${s.name} abhi off-air hai. Kuch stations sirf kuch ghanton ke liye chalte hain — baad mein try karein.`
      : `${s.name} abhi nahi chal raha. Koi aur station try karein.`);
  }

  function toggle() {
    if (!current) return;
    if (audio.paused) {
      if (failed.has(current.id) || (!audio.getAttribute("src") && !hls)) { failed.delete(current.id); play(current); return; }
      setMode("loading");
      // Live radio: reload the stream so we resume "now", not where we paused.
      if (!hls) { audio.src = currentStream.url; }
      audio.play().catch(() => onFail(current, streamsOf(current).indexOf(currentStream)));
    } else {
      audio.pause();
    }
  }

  function step(dir) {
    const list = queue.length ? queue : stations;
    if (!list.length) return;
    let i = current ? list.findIndex((s) => s.id === current.id) : -1;
    for (let n = 0; n < list.length; n++) {
      i = (i + dir + list.length) % list.length;
      if (!failed.has(list[i].id) && !list[i].offair) return play(list[i]);
    }
  }

  function showPlayer(s, stream = s) {
    $("#player").hidden = false;
    $("#pLogo").innerHTML = logoHTML(s);
    $("#pLogo").dataset.id = s.id;
    $("#pName").textContent = s.name;
    $("#pSub").innerHTML = `${sourceHTML(s)} · ${esc(langLabel(s))}${stream.bitrate ? " · " + stream.bitrate + " kbps" : ""}`;
    $("#pFav").classList.toggle("on", isFav(s.id));
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: s.name,
        artist: `${langLabel(s)} · ${countryName(s.cc, s.country)}`,
        album: "Apna Radio",
        artwork: s.logo ? [{ src: s.logo, sizes: "512x512" }] : [{ src: "icon.svg", sizes: "any", type: "image/svg+xml" }],
      });
    }
  }

  // ---------- Listening timer ----------
  // Live radio has no song length, so the player shows how long you've been listening to this station.
  let listened = 0, lastTick = 0, tickTimer = null;
  function renderClock() {
    const t = Math.floor(listened / 1000);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0");
    $("#pClock").textContent = h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }
  function startClock() {
    if (tickTimer) return;
    lastTick = Date.now();
    tickTimer = setInterval(() => { const n = Date.now(); listened += n - lastTick; lastTick = n; renderClock(); }, 1000);
  }
  function stopClock() {
    if (tickTimer) { listened += Date.now() - lastTick; clearInterval(tickTimer); tickTimer = null; }
    renderClock();
  }
  function resetClock() { stopClock(); listened = 0; renderClock(); }

  audio.addEventListener("playing", () => { clearTimeout(loadTimer); setMode("playing"); startClock(); });
  audio.addEventListener("waiting", () => { if (!audio.paused) { setMode("loading"); stopClock(); } });
  audio.addEventListener("pause", () => { setMode("paused"); stopClock(); });
  audio.addEventListener("error", () => { if (current && !hls && audio.getAttribute("src")) onFail(current, streamsOf(current).indexOf(currentStream)); });

  if ("mediaSession" in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", toggle);
    ms.setActionHandler("pause", toggle);
    ms.setActionHandler("previoustrack", () => step(-1));
    ms.setActionHandler("nexttrack", () => step(1));
  }

  // ---------- Favourites & recents ----------
  function toggleFav(id) {
    const s = findStation(id);
    if (!s) return;
    if (isFav(id)) { favs = favs.filter((f) => f.id !== id); toast("Removed from favourites"); }
    else { favs = [s, ...favs]; toast("Added to favourites ❤"); }
    store.set("ar_favs", favs);
    document.querySelectorAll(`[data-fav="${id}"]`).forEach((b) => b.classList.toggle("on", isFav(id)));
    if (current) $("#pFav").classList.toggle("on", isFav(current.id));
    if (view.type === "home") renderShelves();
  }

  function addRecent(s) {
    recent = [s, ...recent.filter((r) => r.id !== s.id)].slice(0, 12);
    store.set("ar_recent", recent);
    if (view.type === "home") renderShelves();
  }

  // ---------- Sleep timer ----------
  const SLEEP_STEPS = [0, 15, 30, 60];
  let sleepIdx = 0, sleepTimer = null;
  function cycleSleep() {
    sleepIdx = (sleepIdx + 1) % SLEEP_STEPS.length;
    const m = SLEEP_STEPS[sleepIdx];
    clearTimeout(sleepTimer);
    const badge = $("#sleepBadge");
    badge.hidden = !m;
    badge.textContent = m;
    if (m) {
      sleepTimer = setTimeout(() => { audio.pause(); sleepIdx = 0; badge.hidden = true; toast("Sleep timer: radio stopped. Shubh ratri 🌙"); }, m * 60000);
      toast(`Radio will stop in ${m} minutes`);
    } else toast("Sleep timer off");
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  // ---------- Events ----------
  function onStationActivate(e) {
    const favBtn = e.target.closest("[data-fav]");
    if (favBtn) { e.stopPropagation(); toggleFav(favBtn.dataset.fav); return; }
    const row = e.target.closest(".station");
    if (!row) return;
    const s = findStation(row.dataset.id);
    if (!s) return;
    queue = lists[row.closest("[data-list]").dataset.list] || stations;
    if (current && current.id === s.id && !failed.has(s.id)) toggle(); else { failed.delete(s.id); play(s); }
  }
  document.addEventListener("click", (e) => { if (e.target.closest(".station, [data-fav]")) onStationActivate(e); });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("station")) { e.preventDefault(); onStationActivate(e); }
  });

  // Header search: searches every station and shows the results page.
  let searchT;
  $("#search").addEventListener("input", (e) => {
    clearTimeout(searchT);
    searchT = setTimeout(() => {
      const q = e.target.value.trim();
      if (!q) { if (view.type === "search") location.hash = "#/"; return; }
      const target = `#/search/${encodeURIComponent(q)}`;
      if (view.type === "search") { history.replaceState(null, "", target); route(); } else location.hash = target;
    }, 200);
  });

  // Back: go back in history if we came from inside the site, otherwise home.
  let navigatedInside = false;
  $("#back").addEventListener("click", (e) => { if (navigatedInside) { e.preventDefault(); history.back(); } });
  window.addEventListener("hashchange", () => { navigatedInside = true; route(); });

  let filterT;
  $("#filter").addEventListener("input", (e) => {
    clearTimeout(filterT);
    filterT = setTimeout(() => { pageFilter.text = e.target.value.trim().toLowerCase(); renderPageList(); }, 120);
  });
  $("#hq").addEventListener("change", (e) => { pageFilter.hq = e.target.checked; renderPageList(); });
  $("#sel").addEventListener("change", (e) => { pageFilter.sel = e.target.value; renderPageList(); });

  $("#play").addEventListener("click", toggle);
  $("#prev").addEventListener("click", () => step(-1));
  $("#next").addEventListener("click", () => step(1));
  $("#pFav").addEventListener("click", () => current && toggleFav(current.id));
  $("#sleep").addEventListener("click", cycleSleep);
  $("#surprise").addEventListener("click", () => {
    const pool = stations.filter((s) => !failed.has(s.id) && !s.offair).slice(0, 200);
    queue = stations;
    if (pool.length) play(pool[Math.floor(Math.random() * pool.length)]);
  });

  const vol = $("#volume");
  audio.volume = store.get("ar_vol", 0.9);
  vol.value = audio.volume;
  vol.addEventListener("input", () => { audio.volume = +vol.value; audio.muted = false; document.body.classList.remove("muted"); store.set("ar_vol", audio.volume); });
  $("#mute").addEventListener("click", () => { audio.muted = !audio.muted; document.body.classList.toggle("muted", audio.muted); });

  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea, button, a, [role=button]")) return;
    if (e.code === "Space") { e.preventDefault(); toggle(); }
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });

  // ---------- Start ----------
  $("#year").textContent = new Date().getFullYear();
  route();

  loadStations()
    .then((list) => {
      stations = list;
      const countries = new Set(list.map((s) => s.cc)).size;
      const hq = list.filter((s) => s.bitrate >= HQ_KBPS).length;
      $("#stat").textContent = `${list.length} stations · ${countries} countries · ${hq} in HQ`;
      render();
    })
    .catch(() => {
      $("#cats").innerHTML = "";
      $("#stat").textContent = "Couldn't reach the station directory. Check your internet and refresh.";
      $("#empty").hidden = false;
      $("#empty").textContent = "Couldn't reach the station directory. Check your internet and refresh.";
    });
})();
