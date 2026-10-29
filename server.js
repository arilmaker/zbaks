const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const keys = require("./keys");
const { getHomeTracks, searchTracks, getPlaylist } = require("./youtube");
const { enrichTracks, getDiagnostics } = require("./metadata");
const { getJamendoTracks } = require("./jamendo");
const { put, list } = require("@vercel/blob");

function readEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
readEnvFile();

const port = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const adminToken = String(process.env.ADMIN_BOT_TOKEN || "");
const whatsappNumber = String(process.env.ADMIN_WHATSAPP || "6285892370690").replace(/\D/g, "");
const telegramUrl = String(process.env.TELEGRAM_BOT_URL || "").trim();

function wantsEnrich(value) { return !["0", "false", "off", "no"].includes(String(value || "").toLowerCase()); }

function json(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(String(req.body) || "{}")); } catch (_) { return Promise.reject(new Error("JSON body tidak valid.")); }
  }
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 32768) req.destroy(); });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (_) { reject(new Error("JSON body tidak valid.")); } });
    req.on("error", reject);
  });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Memeriksa API key dari header x-api-key atau query apikey. Mengirim 401 dan mengembalikan null jika gagal. */
function requireApiKey(req, url, res) {
  const value = req.headers["x-api-key"] || url.searchParams.get("apikey");
  if (!value) { json(res, 401, { status: false, message: "API key diperlukan. Kirim lewat header x-api-key atau parameter apikey. Minta key ke admin." }); return null; }
  const entry = keys.findActiveKey(value);
  if (!entry) { json(res, 401, { status: false, message: "API key tidak valid atau sudah dinonaktifkan. Minta key ke admin." }); return null; }
  return entry;
}

function requireAdmin(req, res) {
  if (!adminToken || !safeEqual(req.headers["x-admin-token"] || "", adminToken)) { json(res, 403, { status: false, message: "Khusus admin." }); return false; }
  return true;
}

function ok(res, result, extra = {}) { json(res, 200, { status: true, result, meta: { ...extra } }); }

/** Attach a previously uploaded, authorized MP3 to matching YouTube search results. */
async function attachStoredAudio(tracks) {
  if (!process.env.BLOB_READ_WRITE_TOKEN || !Array.isArray(tracks)) return tracks;
  return Promise.all(tracks.map(async (track) => {
    try {
      const found = await list({ prefix: `audio/${track.id}.`, limit: 1 });
      const blob = found.blobs && found.blobs[0];
      if (blob && blob.url) {
        return { ...track, url: blob.url, preview: blob.url, audio: blob.url, audioStored: true };
      }
    } catch (_) {
      // Keep ordinary search results working if Blob lookup is unavailable.
    }
    return track;
  }));
}

function readRawBody(req, maxBytes = 4 * 1024 * 1024) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) return Promise.reject(new Error("FILE_TOO_LARGE"));
    return Promise.resolve(req.body);
  }
  if (typeof req.body === "string") {
    const body = Buffer.from(req.body);
    if (body.length > maxBytes) return Promise.reject(new Error("FILE_TOO_LARGE"));
    return Promise.resolve(body);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("FILE_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Ringkasan pencocokan katalog untuk meta. Jika tidak ada yang cocok, sertakan penyebab terakhir. */
function catalogMeta(tracks, enrich) {
  if (!enrich) return { enriched: false };
  const matched = tracks.filter((track) => track.source && track.source !== "youtube").length;
  const meta = { enriched: true, matched };
  if (tracks.length && matched === 0) meta.catalogError = getDiagnostics().lastError || "tidak ada hasil katalog yang cocok";
  return meta;
}

/**
 * Hanya tiga file ini yang boleh dibuka lewat URL. Semua file lain di folder yang sama
 * (apikey.json, server.js, keys.js, .env, dst.) TIDAK PERNAH disajikan.
 */
const webFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/site.js": ["site.js", "application/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

function serveStatic(res, pathname) {
  const entry = webFiles[pathname];
  const target = entry && path.join(__dirname, entry[0]);
  if (!entry || !fs.existsSync(target)) return json(res, 404, { status: false, message: "Tidak ditemukan." });
  res.writeHead(200, { "Content-Type": entry[1] });
  fs.createReadStream(target).pipe(res);
}

async function handle(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, x-api-key, x-admin-token", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
    return res.end();
  }
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const pathname = url.pathname;

  try {
    /* ---------- publik ---------- */
    if (req.method === "GET" && pathname === "/api/config") {
      return json(res, 200, { status: true, whatsapp: whatsappNumber, telegramUrl, onVercel: keys.onVercel });
    }
    if (req.method === "GET" && pathname === "/api/stats") {
      const all = keys.listKeys();
      return json(res, 200, { status: true, activeKeys: all.filter((item) => item.active !== false).length, endpoints: 4 });
    }
    if (req.method === "GET" && pathname === "/api/v1") {
      return json(res, 200, {
        name: "rilzapiweb", version: "v1",
        authentication: "Gunakan ?apikey=API_KEY atau header x-api-key. Minta key ke admin. Gratis, tanpa limit.",
        note: "Tambahkan &enrich=0 untuk mematikan pencocokan metadata katalog.",
        endpoints: ["GET /api/v1/key", "GET /api/v1/music/home", "GET /api/v1/music/search?q=nama+lagu", "GET /api/v1/music/playlist?url=https://www.youtube.com/playlist?list=...", "GET /api/v1/music/jamendo?q=opsional", "POST /api/admin/audio-upload?id=VIDEO_ID (audio/mpeg, x-admin-token)"],
      });
    }

    /* ---------- butuh API key ---------- */
    if (req.method === "GET" && pathname === "/api/v1/key") {
      const entry = requireApiKey(req, url, res); if (!entry) return;
      return ok(res, { valid: true, name: entry.name, plan: entry.plan || "free", limit: "unlimited" });
    }

    if (req.method === "GET" && ["/api/v1/music/home", "/api/v1/music/search", "/api/v1/music/playlist"].includes(pathname)) {
      const entry = requireApiKey(req, url, res); if (!entry) return;
      const enrich = wantsEnrich(url.searchParams.get("enrich"));
      if (pathname === "/api/v1/music/home") {
        let tracks = await getHomeTracks(); if (enrich) tracks = await enrichTracks(tracks); tracks = await attachStoredAudio(tracks);
        return ok(res, tracks, { count: tracks.length, ...catalogMeta(tracks, enrich) });
      }
      if (pathname === "/api/v1/music/search") {
        const query = String(url.searchParams.get("q") || "").trim();
        if (!query) return json(res, 400, { status: false, message: "Parameter q diperlukan." });
        let tracks = await searchTracks(query); if (enrich) tracks = await enrichTracks(tracks); tracks = await attachStoredAudio(tracks);
        return ok(res, tracks, { query, count: tracks.length, ...catalogMeta(tracks, enrich) });
      }
      const playlistUrl = String(url.searchParams.get("url") || "").trim();
      if (!playlistUrl) return json(res, 400, { status: false, message: "Parameter url playlist diperlukan." });
      const playlist = await getPlaylist(playlistUrl); if (enrich) playlist.tracks = await enrichTracks(playlist.tracks); playlist.tracks = await attachStoredAudio(playlist.tracks);
      return ok(res, playlist, { count: playlist.tracks.length, ...catalogMeta(playlist.tracks, enrich) });
    }

    if (req.method === "GET" && pathname === "/api/v1/music/jamendo") {
      const entry = requireApiKey(req, url, res); if (!entry) return;
      try {
        const query = String(url.searchParams.get("q") || "").trim();
        const tracks = await getJamendoTracks({ q: query, limit: url.searchParams.get("limit"), tag: String(url.searchParams.get("tag") || "").trim() });
        return ok(res, tracks, { query, count: tracks.length, source: "jamendo" });
      } catch (error) {
        if (error.code === "NO_JAMENDO") return json(res, 503, { status: false, message: "Jamendo belum diaktifkan admin (JAMENDO_CLIENT_ID kosong)." });
        return json(res, 502, { status: false, message: "Jamendo sedang tidak dapat diambil.", detail: process.env.VERCEL ? undefined : error.message });
      }
    }

    /* ---------- admin (header x-admin-token) ---------- */
    if (pathname === "/api/admin/audio-upload" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return json(res, 503, { status: false, message: "Vercel Blob belum terhubung. Atur BLOB_READ_WRITE_TOKEN di Environment Variables." });
      }
      const id = String(url.searchParams.get("id") || "").trim();
      if (!/^[a-zA-Z0-9_-]{6,20}$/.test(id)) {
        return json(res, 400, { status: false, message: "Parameter id wajib berisi ID video yang valid." });
      }
      const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!["audio/mpeg", "audio/mp3", "application/octet-stream"].includes(contentType)) {
        return json(res, 415, { status: false, message: "Kirim body file MP3 dengan Content-Type: audio/mpeg." });
      }
      let audio;
      try { audio = await readRawBody(req); }
      catch (error) {
        if (error.message === "FILE_TOO_LARGE") return json(res, 413, { status: false, message: "File terlalu besar. Endpoint ini menerima maksimal 4 MiB per unggahan." });
        throw error;
      }
      if (!audio.length) return json(res, 400, { status: false, message: "File audio kosong." });
      const blob = await put(`audio/${id}.mp3`, audio, {
        access: "public",
        contentType: "audio/mpeg",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return json(res, 201, { status: true, result: { id, url: blob.url, pathname: blob.pathname, contentType: "audio/mpeg", size: audio.length } });
    }

    if (pathname === "/api/admin/keys" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      return json(res, 200, { status: true, apiKeys: keys.listKeys() });
    }
    if (pathname === "/api/admin/keys" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const entry = keys.createKey(body.name);
      return json(res, 201, { status: true, apiKey: entry.key, name: entry.name });
    }
    if (pathname === "/api/admin/keys/revoke" && req.method === "POST") {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      return keys.revokeKey(String(body.key || ""))
        ? json(res, 200, { status: true, message: "Key dinonaktifkan." })
        : json(res, 404, { status: false, message: "Key tidak ditemukan di apikey.json." });
    }

    if (req.method === "GET" && !pathname.startsWith("/api/")) return serveStatic(res, pathname);
    return json(res, 404, { status: false, message: "Endpoint tidak ditemukan." });
  } catch (error) {
    const isYoutube = pathname.startsWith("/api/v1/music/");
    const debug = process.env.NODE_ENV === "production" || process.env.VERCEL ? undefined : error.message;
    return json(res, isYoutube ? 502 : 500, { status: false, message: isYoutube ? "YouTube sedang tidak dapat diambil." : "Terjadi kesalahan pada server.", detail: debug });
  }
}

module.exports = handle;

if (require.main === module) {
  http.createServer(handle).listen(port, () => {
    console.log("rilzapiweb berjalan di http://localhost:" + port);
    console.log("File API key: " + keys.keyPath + " (" + keys.listKeys().filter((item) => item.active !== false).length + " key aktif)");
  });
}
