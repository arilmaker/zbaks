const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Penyimpanan API key berbasis file (tanpa akun, tanpa limit).
 *
 * Key diberikan oleh admin. Ada tiga cara menambah key:
 *   1. Edit apikey.json langsung:
 *        { "apiKeys": [ { "key": "rilz_abc", "name": "Bot WA Budi", "plan": "free", "active": true } ] }
 *   2. Isi environment variable API_KEYS, dipisah koma:  API_KEYS=rilz_abc,rilz_def
 *      (cara termudah di Vercel, karena filenya read-only)
 *   3. Panggil endpoint admin POST /api/admin/keys dengan header x-admin-token.
 *
 * Lokasi file: APIKEY_PATH jika diisi, /tmp/apikey.json di Vercel (hilang saat restart,
 * disalin dari apikey.json di repo), selain itu apikey.json di root proyek.
 */
const bundledPath = path.join(__dirname, "apikey.json");
const onVercel = Boolean(process.env.VERCEL);
const keyPath = process.env.APIKEY_PATH || (onVercel ? "/tmp/apikey.json" : bundledPath);

function seedIfNeeded() {
  if (fs.existsSync(keyPath) || keyPath === bundledPath) return;
  try {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    if (fs.existsSync(bundledPath)) fs.copyFileSync(bundledPath, keyPath);
  } catch (_) { /* pakai data kosong */ }
}

function readFileKeys() {
  seedIfNeeded();
  if (!fs.existsSync(keyPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    return Array.isArray(data.apiKeys) ? data.apiKeys.filter((item) => item && typeof item.key === "string") : [];
  } catch (_) {
    throw new Error("apikey.json tidak dapat dibaca. Periksa format JSON-nya.");
  }
}

function writeFileKeys(list) {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const temporaryPath = keyPath + ".tmp";
  fs.writeFileSync(temporaryPath, JSON.stringify({ apiKeys: list }, null, 2) + "\n", "utf8");
  fs.renameSync(temporaryPath, keyPath);
}

function envKeys() {
  return String(process.env.API_KEYS || "").split(",").map((value) => value.trim()).filter(Boolean)
    .map((key) => ({ key, name: "Key dari environment", plan: "free", active: true, source: "env" }));
}

/** Semua key (file + environment). */
function listKeys() { return readFileKeys().concat(envKeys()); }

/** Mengembalikan data key jika ada dan aktif, selain itu null. */
function findActiveKey(value) {
  const wanted = String(value || "").trim();
  if (!wanted) return null;
  return listKeys().find((item) => item.key === wanted && item.active !== false) || null;
}

function createKey(name) {
  const list = readFileKeys();
  const entry = {
    key: "rilz_" + crypto.randomBytes(18).toString("base64url"),
    name: String(name || "API key baru").slice(0, 60),
    plan: "free",
    active: true,
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  writeFileKeys(list);
  return entry;
}

/** Menonaktifkan key di file. Mengembalikan true bila ditemukan. */
function revokeKey(value) {
  const list = readFileKeys();
  const entry = list.find((item) => item.key === value);
  if (!entry) return false;
  entry.active = false;
  writeFileKeys(list);
  return true;
}

function maskKey(value) { return value.length > 10 ? value.slice(0, 8) + "…" + value.slice(-3) : value.slice(0, 3) + "…"; }

module.exports = { listKeys, findActiveKey, createKey, revokeKey, maskKey, keyPath, onVercel };
