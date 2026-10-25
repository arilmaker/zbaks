/**
 * Metadata enrichment
 * -------------------
 * YouTube hanya memberi nama CHANNEL (mis. "Official Vevo", "Lofi Girl", "Nadin Amizah"),
 * bukan nama artis asli lagu. Situs seperti spotimate / spotidown / spotisaver mengambil
 * data dari katalog musik (Spotify). Modul ini melakukan hal yang sama:
 *
 *   1. Bersihkan judul YouTube      "Keshi - Understand (Official Video) [4K]"  ->  Keshi / Understand
 *   2. Cari lagunya di katalog      Spotify (opsional, butuh key) -> Deezer -> iTunes
 *   3. Pilih hasil paling mirip     (skor kemiripan judul + artis, ada ambang batas)
 *   4. Timpa field artist/title/album/cover/preview dengan data katalog
 *
 * Deezer dan iTunes gratis tanpa API key. Spotify aktif otomatis jika
 * SPOTIFY_CLIENT_ID dan SPOTIFY_CLIENT_SECRET diisi.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 3000;
const REQUEST_TIMEOUT_MS = 4500;
const CONCURRENCY = 8;
const MATCH_THRESHOLD = 0.55;

const cache = new Map();
const diagnostics = { lastError: null };

function getDiagnostics() { return { lastError: diagnostics.lastError }; }

/* ------------------------------------------------------------------ */
/* Pembersihan teks                                                    */
/* ------------------------------------------------------------------ */

// Kata sampah yang sering muncul dalam tanda kurung pada judul YouTube.
const NOISE_WORDS = [
  "official", "music video", "video", "lyric", "lyrics", "lirik", "audio", "visualizer", "visualiser",
  "mv", "m/v", "hd", "hq", "4k", "8k", "1080p", "720p", "remastered", "remaster", "clip", "clip officiel",
  "full album", "full song", "teaser", "trailer", "performance video", "color coded", "sub indo",
  "terjemahan", "cover art", "premiere", "out now", "free download", "download", "with lyrics",
  "lyric video", "audio only", "topic", "provided to youtube",
];
const noiseRegex = new RegExp("\\b(" + NOISE_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|") + ")\\b", "i");

function stripAccents(value) {
  return String(value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Hapus isi (...) atau [...] yang hanya berisi kata sampah. "(feat. X)" tetap dipertahankan. */
function stripNoiseBrackets(title) {
  return String(title || "")
    .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, (chunk) => (noiseRegex.test(chunk) && !/\b(feat|ft|featuring|with)\b/i.test(chunk) ? " " : chunk))
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Nama channel -> kandidat nama artis. "KeshiVEVO" / "Keshi - Topic" / "Keshi Official" -> "Keshi". */
function cleanChannel(channel) {
  return String(channel || "")
    .replace(/\s*-\s*topic$/i, "")
    .replace(/\s*vevo$/i, "")
    .replace(/\s+(official|music|records|channel|entertainment|label)$/gi, "")
    .replace(/\s+(official|music)$/gi, "")
    .trim();
}

/** Pisahkan "Artis - Judul" dari judul video. Mengembalikan kandidat artis (bisa kosong) + judul bersih. */
function parseYoutubeTitle(rawTitle, channel) {
  let title = stripNoiseBrackets(rawTitle);
  // Buang sisa "| Official Video", "• Lyrics" di ujung.
  title = title.replace(/\s*[|•·]\s*[^|•·]*$/g, (tail) => (noiseRegex.test(tail) ? "" : tail)).trim();
  let artist = "";
  const parts = title.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    artist = parts[0].trim();
    title = parts.slice(1).join(" - ").trim();
  } else {
    const quoted = title.match(/^(.+?)\s*["“'‘]([^"”'’]+)["”'’]/);
    if (quoted) { artist = quoted[1].trim(); title = quoted[2].trim(); }
  }
  // Buang kata sampah yang menempel di ujung judul (tanpa kurung), mis. "... 4K", "... Official Video", "... HD".
  const trailing = /\s+(official(\s+(music\s+)?(video|audio|lyric\s+video))?|lyrics?(\s+video)?|(music\s+)?video|audio|visuali[sz]er|mv|hd|hq|4k|8k|1080p|720p)\s*$/i;
  for (let guard = 0; guard < 4 && trailing.test(title); guard += 1) title = title.replace(trailing, "").trim();
  return { artist: artist || cleanChannel(channel), title: title || String(rawTitle || "").trim() };
}

/* ------------------------------------------------------------------ */
/* Skor kemiripan                                                      */
/* ------------------------------------------------------------------ */

function normalize(value) {
  return stripAccents(value)
    .toLowerCase()
    .replace(/\b(feat|ft|featuring|with|prod|remix|version|ver)\b.*$/g, " ")
    .replace(/[^a-z0-9Ѐ-ӿ぀-ヿ一-鿿가-힯\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) { return new Set(normalize(value).split(" ").filter(Boolean)); }

function overlap(a, b) {
  const left = tokens(a); const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function contains(haystack, needle) {
  const h = normalize(haystack); const n = normalize(needle);
  return Boolean(n) && h.includes(n);
}

function scoreCandidate(candidate, wanted) {
  const titleScore = Math.max(overlap(candidate.title, wanted.title), contains(wanted.rawTitle, candidate.title) ? 0.9 : 0);
  const artistNames = [candidate.artist].concat(candidate.artists || []);
  const artistScore = Math.max(
    ...artistNames.map((name) => Math.max(
      overlap(name, wanted.artist),
      overlap(name, wanted.channel),
      contains(wanted.rawTitle, name) ? 0.9 : 0,
      contains(wanted.channel, name) ? 0.9 : 0,
    )),
    0,
  );
  return titleScore * 0.65 + artistScore * 0.35;
}

/* ------------------------------------------------------------------ */
/* HTTP helper                                                         */
/* ------------------------------------------------------------------ */

async function getJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

/* ------------------------------------------------------------------ */
/* Provider: Spotify (opsional)                                        */
/* ------------------------------------------------------------------ */

let spotifyToken = { value: "", expiresAt: 0 };

function spotifyEnabled() { return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET); }

async function spotifyAccessToken() {
  if (spotifyToken.value && spotifyToken.expiresAt > Date.now() + 30000) return spotifyToken.value;
  const basic = Buffer.from(process.env.SPOTIFY_CLIENT_ID + ":" + process.env.SPOTIFY_CLIENT_SECRET).toString("base64");
  const data = await getJson("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  spotifyToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return spotifyToken.value;
}

async function searchSpotify(query) {
  const token = await spotifyAccessToken();
  const data = await getJson("https://api.spotify.com/v1/search?type=track&limit=5&q=" + encodeURIComponent(query), { headers: { Authorization: "Bearer " + token } });
  return ((data.tracks && data.tracks.items) || []).map((item) => ({
    source: "spotify",
    title: item.name,
    artist: item.artists.map((a) => a.name).join(", "),
    artists: item.artists.map((a) => a.name),
    album: item.album && item.album.name,
    cover: item.album && item.album.images && item.album.images[0] && item.album.images[0].url,
    duration: Math.round((item.duration_ms || 0) / 1000),
    preview: item.preview_url || null,
    link: item.external_urls && item.external_urls.spotify,
    releaseDate: item.album && item.album.release_date,
    explicit: Boolean(item.explicit),
  }));
}

/* ------------------------------------------------------------------ */
/* Provider: Deezer (gratis, tanpa key)                                */
/* ------------------------------------------------------------------ */

async function searchDeezer(query) {
  const data = await getJson("https://api.deezer.com/search?limit=5&q=" + encodeURIComponent(query));
  return (data.data || []).map((item) => ({
    source: "deezer",
    title: item.title_short || item.title,
    artist: item.artist && item.artist.name,
    artists: [item.artist && item.artist.name].filter(Boolean),
    album: item.album && item.album.title,
    cover: (item.album && (item.album.cover_xl || item.album.cover_big || item.album.cover_medium)) || null,
    duration: item.duration,
    preview: item.preview || null,
    link: item.link,
    explicit: Boolean(item.explicit_lyrics),
  }));
}

/* ------------------------------------------------------------------ */
/* Provider: iTunes (gratis, tanpa key)                                */
/* ------------------------------------------------------------------ */

async function searchItunes(query) {
  const data = await getJson("https://itunes.apple.com/search?media=music&entity=song&limit=5&term=" + encodeURIComponent(query));
  return (data.results || []).map((item) => ({
    source: "itunes",
    title: item.trackName,
    artist: item.artistName,
    artists: [item.artistName],
    album: item.collectionName,
    cover: item.artworkUrl100 ? item.artworkUrl100.replace(/\/\d+x\d+bb\./, "/640x640bb.") : null,
    duration: Math.round((item.trackTimeMillis || 0) / 1000),
    preview: item.previewUrl || null,
    link: item.trackViewUrl,
    releaseDate: item.releaseDate,
    explicit: item.trackExplicitness === "explicit",
  }));
}

function providers() {
  const list = [];
  if (spotifyEnabled()) list.push(searchSpotify);
  list.push(searchDeezer, searchItunes);
  return list;
}

/* ------------------------------------------------------------------ */
/* Enrich satu lagu                                                    */
/* ------------------------------------------------------------------ */

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) { cache.delete(key); return undefined; }
  return hit.value;
}
function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function findBestMatch(track) {
  const parsed = parseYoutubeTitle(track.title, track.artist);
  const wanted = { artist: parsed.artist, title: parsed.title, channel: track.artist, rawTitle: track.title };
  const queries = [...new Set([parsed.artist + " " + parsed.title, parsed.title])].filter((q) => q.trim());

  let best = null;
  let hadError = false;
  for (const search of providers()) {
    for (const query of queries) {
      let candidates = [];
      try { candidates = await search(query); } catch (error) { hadError = true; diagnostics.lastError = search.name + ": " + error.message; continue; }
      for (const candidate of candidates) {
        const score = scoreCandidate(candidate, wanted);
        if (!best || score > best.score) best = { ...candidate, score };
      }
      if (best && best.score >= 0.85) return { match: best, hadError };
    }
    if (best && best.score >= MATCH_THRESHOLD) return { match: best, hadError };
  }
  return { match: best && best.score >= MATCH_THRESHOLD ? best : null, hadError };
}

async function enrichTrack(track) {
  const key = track.id;
  let match = cacheGet(key);
  if (match === undefined) {
    let result = { match: null, hadError: true };
    try { result = await findBestMatch(track); } catch (error) { diagnostics.lastError = error.message; }
    match = result.match;
    // Hanya simpan "tidak cocok" bila memang tidak ada kecocokan. Jika penyebabnya error
    // jaringan/provider, jangan di-cache supaya request berikutnya mencoba lagi.
    if (match || !result.hadError) cacheSet(key, match);
  }
  const youtube = { title: track.title, channel: track.artist, thumbnail: track.thumbnail };
  if (!match) {
    const guess = parseYoutubeTitle(track.title, track.artist);
    return { ...track, artist: guess.artist || track.artist, title: guess.title || track.title, album: null, duration: null, audio: null, source: "youtube", youtube };
  }
  return {
    ...track,
    title: match.title,
    artist: match.artist,
    artists: match.artists,
    album: match.album || null,
    thumbnail: match.cover || track.thumbnail,
    cover: match.cover || track.thumbnail,
    duration: match.duration || null,
    preview: match.preview || null,
    audio: match.preview || null,
    explicit: Boolean(match.explicit),
    releaseDate: match.releaseDate || null,
    source: match.source,
    sourceUrl: match.link || null,
    confidence: Math.round(match.score * 100) / 100,
    youtube,
  };
}

/** Enrich banyak lagu sekaligus dengan batas konkurensi supaya tidak kena rate limit. */
async function enrichTracks(tracks) {
  const output = new Array(tracks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tracks.length) {
      const index = cursor++;
      output[index] = await enrichTrack(tracks[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tracks.length) }, worker));
  return output;
}

module.exports = { getDiagnostics, enrichTracks, enrichTrack, parseYoutubeTitle, cleanChannel, scoreCandidate, spotifyEnabled };
