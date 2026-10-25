const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const keys = require("./keys");
const { getHomeTracks, searchTracks, getPlaylist } = require("./youtube");
const { enrichTracks } = require("./metadata");

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
      return json(res, 200, { status: true, activeKeys: all.filter((item) => item.active !== false).length, endpoints: 3 });
    }
    if (req.method === "GET" && pathname === "/api/v1") {
      return json(res, 200, {
        name: "rilzapiweb", version: "v1",
        authentication: "Gunakan ?apikey=API_KEY atau header x-api-key. Minta key ke admin. Gratis, tanpa limit.",
        note: "Tambahkan &enrich=0 untuk mematikan pencocokan metadata katalog.",
        endpoints: ["GET /api/v1/key", "GET /api/v1/music/home", "GET /api/v1/music/search?q=nama+lagu", "GET /api/v1/music/playlist?url=https://www.youtube.com/playlist?list=..."],
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
        let tracks = await getHomeTracks(); if (enrich) tracks = await enrichTracks(tracks);
        return ok(res, tracks, { count: tracks.length, enriched: enrich });
      }
      if (pathname === "/api/v1/music/search") {
        const query = String(url.searchParams.get("q") || "").trim();
        if (!query) return json(res, 400, { status: false, message: "Parameter q diperlukan." });
        let tracks = await searchTracks(query); if (enrich) tracks = await enrichTracks(tracks);
        return ok(res, tracks, { query, count: tracks.length, enriched: enrich });
      }
      const playlistUrl = String(url.searchParams.get("url") || "").trim();
      if (!playlistUrl) return json(res, 400, { status: false, message: "Parameter url playlist diperlukan." });
      const playlist = await getPlaylist(playlistUrl); if (enrich) playlist.tracks = await enrichTracks(playlist.tracks);
      return ok(res, playlist, { count: playlist.tracks.length, enriched: enrich });
    }

    /* ---------- admin (header x-admin-token) ---------- */
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
