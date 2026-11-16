// Tests whether radio streams are playing right now. Used by build-stations.js and prune-offair.js.
const UA = { "User-Agent": "ApnaRadio/1.0", "Icy-MetaData": "0" };
const TIMEOUT = 15000;

// Fetches only the response headers (and, for playlists, the text), then stops the download.
async function probe(url, wantText) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: UA, redirect: "follow" });
    const type = (r.headers.get("content-type") || "").toLowerCase();
    let text = "";
    if (r.ok && (wantText || /mpegurl|x-scpls|text\//.test(type))) text = (await r.text()).slice(0, 20000);
    return { ok: r.ok, status: r.status, type, text, url: r.url || url };
  } catch (e) {
    return { ok: false, status: 0, error: (e.cause && e.cause.code) || e.name };
  } finally {
    clearTimeout(t);
    ctl.abort();
  }
}

const lines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

// "live": audio is flowing now. "offair": the server answers but no audio, or it didn't answer.
async function check(stream) {
  const r = await probe(stream.url, stream.hls);
  if (!r.ok) return "offair";
  const isHls = stream.hls || /mpegurl/.test(r.type) || r.text.startsWith("#EXTM3U");
  if (!isHls) return /text\/html/.test(r.type) ? "offair" : "live";

  // HLS: a playlist can exist while the broadcast is off. Follow it down to a real audio chunk.
  let playlist = r;
  if (/#EXT-X-STREAM-INF/.test(playlist.text)) {
    const variant = lines(playlist.text)[0];
    if (!variant) return "offair";
    playlist = await probe(new URL(variant, playlist.url).href, true);
    if (!playlist.ok) return "offair";
  }
  const chunks = lines(playlist.text);
  if (!chunks.length) return "offair";
  const chunk = await probe(new URL(chunks[chunks.length - 1], playlist.url).href, false);
  return chunk.ok ? "live" : "offair";
}

async function checkWithRetry(stream) {
  if ((await check(stream)) === "live") return "live";
  await new Promise((res) => setTimeout(res, 3000));
  return check(stream);
}

// Runs fn over items, `concurrency` at a time, and returns the results in order.
async function mapLimit(items, concurrency, fn, onProgress) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      if (onProgress) onProgress(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

module.exports = { probe, check, checkWithRetry, mapLimit };
