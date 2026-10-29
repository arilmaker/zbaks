/**
 * Jamendo: musik independen berlisensi Creative Commons. Lagu penuh, boleh di-stream dan
 * (jika audiodownload_allowed) diunduh. Wajib isi JAMENDO_CLIENT_ID (gratis di devportal.jamendo.com).
 */
const BASE = "https://api.jamendo.com/v3.0/tracks/";

function clientId() { return String(process.env.JAMENDO_CLIENT_ID || "").trim(); }
function jamendoEnabled() { return Boolean(clientId()); }

function mapTrack(item) {
  const id = String(item.id);
  return {
    id: "jm_" + id,
    title: item.name || "",
    artist: item.artist_name || "",
    artists: item.artist_name ? [item.artist_name] : [],
    album: item.album_name || "",
    cover: item.album_image || item.image || null,
    thumbnail: item.image || item.album_image || null,
    duration: Number(item.duration) || null,
    audio: item.audio || null,
    download: item.audiodownload_allowed ? (item.audiodownload || null) : null,
    preview: null,
    url: item.shareurl || null,
    playlist: "Jamendo",
    source: "jamendo",
    sourceUrl: item.shareurl || null,
    license: item.license_ccurl || null,
    releaseDate: item.releasedate || null,
  };
}

/** mode: "hits" (populer minggu ini) atau pencarian dengan q. */
async function getJamendoTracks({ q = "", limit = 30, tag = "" } = {}) {
  if (!jamendoEnabled()) { const e = new Error("JAMENDO_CLIENT_ID belum diisi."); e.code = "NO_JAMENDO"; throw e; }
  const params = new URLSearchParams({
    client_id: clientId(), format: "json", limit: String(Math.min(Math.max(Number(limit) || 30, 1), 50)),
    include: "licenses", audioformat: "mp32", imagesize: "300",
  });
  if (q) { params.set("search", q); params.set("order", "relevance"); }
  else params.set("order", "popularity_week");
  if (tag) params.set("tags", tag);
  const response = await fetch(BASE + "?" + params.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Jamendo HTTP " + response.status);
  const data = await response.json();
  if (data && data.headers && data.headers.status === "failed") throw new Error("Jamendo: " + (data.headers.error_message || "gagal"));
  return (Array.isArray(data.results) ? data.results : []).filter((item) => item.audio).map(mapTrack);
}

module.exports = { getJamendoTracks, jamendoEnabled, mapTrack };
