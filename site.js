/* =====================================================================
   rilzapiweb — front-end
   1. Utilitas              5. Dokumentasi (sidebar, kartu endpoint, coba langsung)
   2. Router halaman        6. Halaman API key (kontak admin)
   3. Status & statistik    7. Pemutar preview
   4. Beranda               8. Mulai
   ===================================================================== */
"use strict";

/* ---------- 1. Utilitas ---------- */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

/** localStorage bisa melempar error (mode privat), jadi selalu dibungkus. */
const store = {
  get(key) { try { return window.localStorage.getItem(key); } catch (_) { return null; } },
  set(key, value) { try { window.localStorage.setItem(key, value); } catch (_) { /* abaikan */ } },
};

const app = { apiKey: store.get("rilz_key") || "", config: { whatsapp: "", telegramUrl: "" } };

function toast(message, type = "ok") {
  const item = document.createElement("div");
  item.className = "toast" + (type === "error" ? " is-error" : "");
  item.textContent = message;
  $("#toasts").appendChild(item);
  setTimeout(() => { item.classList.add("is-leaving"); setTimeout(() => item.remove(), 300); }, 2600);
}

async function copyText(text, message = "Tersalin ke clipboard") {
  try { await navigator.clipboard.writeText(text); toast(message); }
  catch (_) { toast("Browser menolak akses clipboard. Salin manual.", "error"); }
}

function formatDuration(seconds) {
  if (!seconds) return "";
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

function maskKey(key) { return key ? key.slice(0, 9) + "…" : "rilz_xxx"; }

/** Pewarnaan JSON ringan tanpa library. */
function highlightJson(text) {
  return escapeHtml(text).replace(
    /(&quot;(?:\\.|[^&\\])*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g,
    (match, string, colon, keyword, number) => {
      if (string) return '<span class="' + (colon ? "tok-key" : "tok-str") + '">' + string + "</span>" + (colon || "");
      if (keyword) return '<span class="tok-kw">' + keyword + "</span>";
      if (number) return '<span class="tok-num">' + number + "</span>";
      return match;
    },
  );
}

/* ---------- 2. Router halaman ---------- */
const routes = ["home", "docs", "key"];

function parseRoute() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const page = routes.includes(parts[0]) ? parts[0] : "home";
  return { page, anchor: parts[1] || "" };
}

function showRoute() {
  const { page, anchor } = parseRoute();
  $$("[data-page]").forEach((section) => { section.hidden = section.dataset.page !== page; });
  $$("[data-route]").forEach((link) => link.classList.toggle("is-active", link.dataset.route === page));
  $("#nav").classList.remove("is-open");
  $("#burger").setAttribute("aria-expanded", "false");
  document.title = { home: "rilzapiweb — REST API musik untuk bot dan aplikasi", docs: "Dokumentasi — rilzapiweb", key: "API Key — rilzapiweb" }[page];

  if (page === "docs" && anchor) focusDocsAnchor(anchor);
  else window.scrollTo({ top: 0, behavior: "auto" });
}

window.addEventListener("hashchange", showRoute);
$("#burger").addEventListener("click", () => {
  const open = $("#nav").classList.toggle("is-open");
  $("#burger").setAttribute("aria-expanded", String(open));
});

/* ---------- 3. Status & statistik ---------- */
async function checkStatus() {
  const dot = $("#status-dot");
  const text = $("#status-text");
  const started = performance.now();
  try {
    const response = await fetch("/api/v1");
    if (!response.ok) throw new Error("status " + response.status);
    dot.className = "dot is-on";
    text.textContent = "Online · " + Math.round(performance.now() - started) + " ms";
  } catch (_) {
    dot.className = "dot is-off";
    text.textContent = "Server tidak merespons";
  }
}

async function loadStats() {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) throw new Error();
    const data = await response.json();
    $("#stat-keys").textContent = Number(data.activeKeys).toLocaleString("id-ID");
    $("#stat-endpoints").textContent = Number(data.endpoints).toLocaleString("id-ID");
  } catch (_) {
    $("#stat-keys").textContent = "—";
  }
}

/* ---------- 4. Beranda ---------- */
const heroSample = {
  status: true,
  result: [{
    id: "2sD0m8xXq3o",
    title: "Hati-Hati di Jalan",
    artist: "Tulus",
    album: "Manusia",
    cover: "https://…/cover.jpg",
    duration: 246,
    preview: "https://…/preview.mp3",
    url: "https://www.youtube.com/watch?v=2sD0m8xXq3o",
    source: "deezer",
    confidence: 1,
    youtube: { title: "Tulus - Hati-Hati di Jalan (Official Video)", channel: "TULUS" },
  }],
  meta: { count: 1, enriched: true },
};
$("#hero-code").innerHTML = '<span class="tok-com">// contoh bentuk respons, nilai dipersingkat</span>\n' + highlightJson(JSON.stringify(heroSample, null, 2));

/* ---------- 5. Dokumentasi ---------- */
const catalog = [
  {
    title: "Musik",
    items: [
      {
        id: "home", name: "Beranda", path: "/api/v1/music/home", needsKey: true,
        desc: "Mengambil lagu yang sedang tampil di beranda YouTube. Setiap lagu dicocokkan dengan katalog untuk mendapat nama artis asli, album, cover, dan preview.",
        params: [
          { name: "apikey", type: "key", required: true, desc: "API key. Bisa juga dikirim lewat header x-api-key." },
          { name: "enrich", type: "select", options: ["1", "0"], desc: "Isi 0 untuk melewati pencocokan katalog dan menerima data YouTube saja." },
        ],
      },
      {
        id: "search", name: "Cari lagu", path: "/api/v1/music/search", needsKey: true,
        desc: "Mencari lagu atau artis di YouTube. Judul dibersihkan dari tulisan seperti “Official Video”, lalu dicocokkan dengan katalog.",
        params: [
          { name: "q", type: "text", required: true, placeholder: "tulus hati-hati di jalan", desc: "Judul lagu atau nama artis." },
          { name: "apikey", type: "key", required: true, desc: "API key. Bisa juga dikirim lewat header x-api-key." },
          { name: "enrich", type: "select", options: ["1", "0"], desc: "Isi 0 untuk data YouTube saja." },
        ],
      },
      {
        id: "playlist", name: "Playlist", path: "/api/v1/music/playlist", needsKey: true,
        desc: "Membaca isi playlist YouTube publik. Respons berisi title playlist dan daftar tracks.",
        params: [
          { name: "url", type: "text", required: true, placeholder: "https://www.youtube.com/playlist?list=PL…", desc: "URL playlist yang memiliki parameter list=." },
          { name: "apikey", type: "key", required: true, desc: "API key. Bisa juga dikirim lewat header x-api-key." },
          { name: "enrich", type: "select", options: ["1", "0"], desc: "Isi 0 untuk data YouTube saja." },
        ],
      },
    ],
  },
  {
    title: "Umum",
    items: [
      {
        id: "key", name: "Cek key", path: "/api/v1/key", needsKey: true,
        desc: "Memeriksa apakah API key aktif. Mengembalikan nama pemilik key. Tidak memanggil YouTube.",
        params: [
          { name: "apikey", type: "key", required: true, desc: "API key. Bisa juga dikirim lewat header x-api-key." },
        ],
      },
      {
        id: "info", name: "Info API", path: "/api/v1", needsKey: false,
        desc: "Menampilkan nama, versi, cara autentikasi, dan daftar endpoint. Tidak memakai kuota dan tidak butuh API key.",
        params: [],
      },
    ],
  },
];
const allEndpoints = catalog.flatMap((group) => group.items);
const responses = new Map(); // id endpoint -> { raw, tracks, view, curl }

$("#base-url").textContent = window.location.origin;
$("#copy-base").addEventListener("click", () => copyText(window.location.origin, "Base URL tersalin"));
$("#try-key").value = app.apiKey;
$("#try-key").addEventListener("input", (event) => applyKey(event.target.value));

function renderSidebar(query = "") {
  const needle = query.trim().toLowerCase();
  let html = "";
  let matched = 0;
  for (const group of catalog) {
    const items = group.items.filter((item) => (item.name + " " + item.path + " " + item.desc).toLowerCase().includes(needle));
    if (!items.length) continue;
    matched += items.length;
    html += '<div class="side-group"><h4>' + escapeHtml(group.title) + "</h4>" +
      items.map((item) => '<a class="side-link" href="#/docs/' + item.id + '" data-side="' + item.id + '"><span class="m">GET</span>' + escapeHtml(item.name) + "</a>").join("") + "</div>";
  }
  if (!matched) html = '<p class="side-empty">Endpoint tidak ditemukan.</p>';
  html += '<div class="side-group"><h4>Referensi</h4><a class="side-link" href="#/docs/ref">Isi respons</a><a class="side-link" href="#/docs/codes">Kode status</a></div>';
  $("#side-nav").innerHTML = html;
  const active = parseRoute().anchor;
  $$(".side-link").forEach((link) => link.classList.toggle("is-active", link.dataset.side === active));
}

function paramRow(item, param) {
  const label = '<code>' + escapeHtml(param.name) + "</code>" + (param.required ? '<span class="req">wajib</span>' : '<span class="opt">opsional</span>');
  let control;
  if (param.type === "key") {
    control = '<input class="input" data-ep="' + item.id + '" data-param="apikey" type="text" value="' + escapeHtml(app.apiKey) + '" placeholder="rilz_xxx" autocomplete="off" spellcheck="false">';
  } else if (param.type === "select") {
    control = '<select class="input" data-ep="' + item.id + '" data-param="' + param.name + '">' + param.options.map((o) => "<option>" + o + "</option>").join("") + "</select>";
  } else {
    control = '<input class="input" data-ep="' + item.id + '" data-param="' + param.name + '" type="text" placeholder="' + escapeHtml(param.placeholder || "") + '" autocomplete="off">';
  }
  return "<tr><td>" + label + '</td><td class="t-ctl">' + control + "<small>" + escapeHtml(param.desc) + "</small></td></tr>";
}

function renderEndpoints() {
  $("#endpoint-list").innerHTML = catalog.map((group) =>
    '<h2 class="group-title">' + escapeHtml(group.title) + "</h2>" +
    group.items.map((item) =>
      '<article class="surface endpoint" id="ep-' + item.id + '" data-id="' + item.id + '">' +
        '<button class="endpoint-top" type="button" aria-expanded="false" data-toggle="' + item.id + '">' +
          '<span class="method">GET</span><span class="endpoint-path">' + escapeHtml(item.path) + '</span><span class="endpoint-name">' + escapeHtml(item.name) + "</span>" +
        "</button>" +
        '<div class="endpoint-body">' +
          '<p class="endpoint-desc">' + escapeHtml(item.desc) + "</p>" +
          (item.params.length ? '<div class="table-scroll"><table class="param-table"><thead><tr><th>Parameter</th><th>Nilai</th></tr></thead><tbody>' + item.params.map((p) => paramRow(item, p)).join("") + "</tbody></table></div>" : "") +
          '<div class="try-url" id="url-' + item.id + '"></div>' +
          '<div class="try-actions"><button class="btn btn--sm" type="button" data-run="' + item.id + '">Jalankan</button><button class="btn btn--sm btn--line" type="button" data-clear="' + item.id + '">Bersihkan</button><button class="btn btn--sm btn--line" type="button" data-copyurl="' + item.id + '">Salin URL</button></div>' +
          '<div id="res-' + item.id + '"></div>' +
        "</div>" +
      "</article>").join("")).join("");
  refreshAllUrls();
}

/** Kumpulkan nilai input sebuah endpoint menjadi query string. */
function buildRequest(item, { reveal }) {
  const params = new URLSearchParams();
  for (const param of item.params) {
    const input = $('[data-ep="' + item.id + '"][data-param="' + (param.type === "key" ? "apikey" : param.name) + '"]');
    let value = input ? input.value.trim() : "";
    if (param.type === "key") { value = value || app.apiKey; if (!reveal) value = maskKey(value); }
    if (param.name === "enrich" && value === "1") continue;
    if (value) params.set(param.name, value);
  }
  const query = params.toString();
  return item.path + (query ? "?" + query : "");
}

function refreshUrl(item) {
  const target = $("#url-" + item.id);
  if (!target) return;
  let shown = buildRequest(item, { reveal: false });
  try { shown = decodeURIComponent(shown); } catch (_) { /* biarkan apa adanya */ }
  target.textContent = "GET " + window.location.origin + shown;
}
function refreshAllUrls() { allEndpoints.forEach(refreshUrl); }

function toggleEndpoint(id, force) {
  const card = $("#ep-" + id);
  if (!card) return;
  const open = force ?? !card.classList.contains("is-open");
  card.classList.toggle("is-open", open);
  $(".endpoint-top", card).setAttribute("aria-expanded", String(open));
}

function focusDocsAnchor(anchor) {
  $$(".side-link").forEach((link) => link.classList.toggle("is-active", link.dataset.side === anchor));
  const target = $("#ep-" + anchor) || (anchor === "ref" ? $("#ref") : anchor === "codes" ? $("#codes") : null);
  if (!target) { window.scrollTo({ top: 0 }); return; }
  if (target.classList.contains("endpoint")) {
    toggleEndpoint(anchor, true);
    target.classList.remove("is-flash"); void target.offsetWidth; target.classList.add("is-flash");
  }
  requestAnimationFrame(() => target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" }));
}

function curlFor(item, path) {
  const url = window.location.origin + path.replace(/apikey=[^&]*&?/, "").replace(/[?&]$/, "");
  return item.needsKey
    ? 'curl -H "x-api-key: ' + maskKey(app.apiKey) + '" \\\n  "' + url + '"'
    : 'curl "' + url + '"';
}

function renderResponse(id) {
  const data = responses.get(id);
  const box = $("#res-" + id);
  if (!data) { box.innerHTML = ""; return; }
  const tabs = [["json", "JSON"]];
  if (data.tracks.length) tabs.push(["songs", "Lagu (" + data.tracks.length + ")"]);
  tabs.push(["curl", "cURL"]);
  const ok = data.status >= 200 && data.status < 300;

  let body;
  if (data.view === "songs") {
    body = '<div class="song-rows">' + data.tracks.map((track, index) => {
      const cover = track.cover || track.thumbnail;
      return '<div class="song-row">' +
        (cover ? '<img src="' + escapeHtml(cover) + '" alt="" loading="lazy">' : '<div class="ph"></div>') +
        "<div><strong>" + escapeHtml(track.title) + "</strong><span>" + escapeHtml([track.artist, track.album, formatDuration(track.duration)].filter(Boolean).join(" · ")) + '</span><span class="src">' + escapeHtml(track.source || "youtube") + "</span></div>" +
        '<div class="row-actions">' +
          (track.audio || track.preview ? '<button class="mini-btn" type="button" data-play="' + id + ":" + index + ':preview" aria-label="Putar preview 30 detik ' + escapeHtml(track.title) + '">30 dtk</button>' : "") +
          '<button class="round-btn" type="button" data-play="' + id + ":" + index + ':full" aria-label="Putar lagu penuh ' + escapeHtml(track.title) + '"><svg><use href="#i-play"/></svg></button>' +
        "</div></div>";
    }).join("") + "</div>";
  } else if (data.view === "curl") {
    body = "<pre><code>" + escapeHtml(data.curl) + "</code></pre>";
  } else {
    body = "<pre><code>" + highlightJson(JSON.stringify(data.raw, null, 2)) + "</code></pre>";
  }

  box.innerHTML =
    '<div class="response"><div class="response-bar">' +
      '<span class="code ' + (ok ? "is-ok" : "is-bad") + '">' + data.status + "</span>" +
      '<span class="meta">' + data.ms + " ms</span><span class=\"meta\">" + data.size + "</span>" +
      '<div class="response-tabs" role="tablist">' + tabs.map(([key, label]) => '<button type="button" role="tab" aria-selected="' + (data.view === key) + '" data-view="' + id + ":" + key + '">' + label + "</button>").join("") +
      '<button type="button" data-copyres="' + id + '">Salin</button></div>' +
    "</div>" + body + "</div>";
}

async function runEndpoint(id) {
  const item = allEndpoints.find((entry) => entry.id === id);
  const button = $('[data-run="' + id + '"]');
  const path = buildRequest(item, { reveal: true });

  const missing = item.params.find((p) => p.required && p.type !== "key" && !($('[data-ep="' + id + '"][data-param="' + p.name + '"]').value.trim()));
  if (item.needsKey && !app.apiKey && !$('[data-ep="' + id + '"][data-param="apikey"]').value.trim()) { toast("Isi API key dulu. Minta key ke admin di halaman API Key.", "error"); return; }
  if (missing) { toast("Parameter " + missing.name + " wajib diisi.", "error"); $('[data-ep="' + id + '"][data-param="' + missing.name + '"]').focus(); return; }

  button.disabled = true;
  const original = button.textContent;
  button.innerHTML = '<span class="spinner"></span> Memproses';
  const started = performance.now();
  try {
    const response = await fetch(path);
    const text = await response.text();
    let raw;
    try { raw = JSON.parse(text); } catch (_) { raw = { raw: text }; }
    const result = raw && raw.result;
    const tracks = Array.isArray(result) ? result : result && Array.isArray(result.tracks) ? result.tracks : [];
    responses.set(id, {
      raw, tracks, status: response.status, ms: Math.round(performance.now() - started),
      size: (new Blob([text]).size / 1024).toFixed(1) + " KB",
      view: tracks.length ? "songs" : "json", curl: curlFor(item, path),
    });
    renderResponse(id);
  } catch (_) {
    toast("Server tidak dapat dihubungi.", "error");
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

$("#endpoint-list").addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-toggle]");
  const run = event.target.closest("[data-run]");
  const clear = event.target.closest("[data-clear]");
  const copyUrl = event.target.closest("[data-copyurl]");
  const view = event.target.closest("[data-view]");
  const copyRes = event.target.closest("[data-copyres]");
  const play = event.target.closest("[data-play]");

  if (toggle) toggleEndpoint(toggle.dataset.toggle);
  if (run) runEndpoint(run.dataset.run);
  if (clear) { responses.delete(clear.dataset.clear); renderResponse(clear.dataset.clear); }
  if (copyUrl) {
    const item = allEndpoints.find((entry) => entry.id === copyUrl.dataset.copyurl);
    copyText(window.location.origin + buildRequest(item, { reveal: true }), "URL tersalin");
  }
  if (view) { const [id, key] = view.dataset.view.split(":"); responses.get(id).view = key; renderResponse(id); }
  if (copyRes) copyText(JSON.stringify(responses.get(copyRes.dataset.copyres).raw, null, 2), "Respons tersalin");
  if (play) { const [id, index, mode] = play.dataset.play.split(":"); playTrack(responses.get(id).tracks[Number(index)], mode); }
});

$("#endpoint-list").addEventListener("input", (event) => {
  const input = event.target.closest("[data-ep]");
  if (!input) return;
  refreshUrl(allEndpoints.find((entry) => entry.id === input.dataset.ep));
});
$("#endpoint-list").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.matches("input[data-ep]")) { event.preventDefault(); runEndpoint(event.target.dataset.ep); }
});

const sideSearch = $("#side-search");
sideSearch.addEventListener("input", () => renderSidebar(sideSearch.value));
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (parseRoute().page !== "docs") window.location.hash = "#/docs";
    setTimeout(() => sideSearch.focus(), 30);
  }
});

/* ---------- 6. Halaman API key (kontak admin) ---------- */
function setKeyMessage(text, state = "") {
  const el = $("#key-message");
  el.textContent = text || "";
  el.classList.toggle("is-ok", state === "ok");
}

function applyKey(value) {
  app.apiKey = value.trim();
  store.set("rilz_key", app.apiKey);
  $("#try-key").value = app.apiKey;
  $("#key-input").value = app.apiKey;
  $$('[data-param="apikey"]').forEach((input) => { input.value = app.apiKey; });
  refreshAllUrls();
  renderQuick();
}

function renderQuick() {
  const key = app.apiKey || "rilz_xxx";
  const origin = window.location.origin;
  const text = '# Cari lagu\ncurl -H "x-api-key: ' + key + '" \\\n  "' + origin + '/api/v1/music/search?q=tulus"\n\n# Beranda YouTube\ncurl "' + origin + '/api/v1/music/home?apikey=' + key + '"';
  $("#quick-code").innerHTML = escapeHtml(text).replace(/^(# .*)$/gm, '<span class="tok-com">$1</span>').replace(/(&quot;[^&]*?&quot;)/g, '<span class="tok-str">$1</span>');
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) return;
    app.config = await response.json();
  } catch (_) { /* pakai bawaan */ }
  const text = encodeURIComponent("Halo admin, saya mau minta API key rilzapiweb. Nama saya ... dan dipakai untuk ...");
  const wa = app.config.whatsapp ? "https://wa.me/" + app.config.whatsapp + "?text=" + text : "";
  [["#contact-wa", wa], ["#footer-wa", wa]].forEach(([selector, href]) => {
    const link = $(selector);
    if (href) { link.href = href; link.target = "_blank"; link.rel = "noreferrer"; }
  });
  if (app.config.telegramUrl) { $("#contact-tg").href = app.config.telegramUrl; $("#contact-tg").hidden = false; }
}

$("#key-input").value = app.apiKey;
$("#key-input").addEventListener("input", (event) => applyKey(event.target.value));

$("#key-check").addEventListener("click", async () => {
  const value = $("#key-input").value.trim();
  if (!value) { setKeyMessage("Isi API key dulu."); return; }
  setKeyMessage("Memeriksa…");
  try {
    const response = await fetch("/api/v1/key?apikey=" + encodeURIComponent(value));
    const data = await response.json();
    if (response.ok) setKeyMessage("Key aktif atas nama " + data.result.name + ". Tanpa limit.", "ok");
    else setKeyMessage(data.message || "Key tidak valid.");
  } catch (_) {
    setKeyMessage("Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.");
  }
});

$("#key-clear").addEventListener("click", () => { applyKey(""); setKeyMessage("Key dihapus dari browser ini.", "ok"); });

/* ---------- 7. Pemutar preview ---------- */
const audio = $("#audio");
const player = $("#player");

function stopPlayer() {
  audio.pause();
  $("#player-frame").innerHTML = "";
  $("#player-frame").hidden = true;
}

/** mode "preview": file mp3 30 detik langsung. mode "full": lagu penuh lewat pemutar YouTube resmi (embed). */
function playTrack(track, mode = "full") {
  if (!track) return;
  const audioUrl = track.audio || track.preview;
  if (mode === "preview" && !audioUrl) { toast("Lagu ini tidak punya preview.", "error"); return; }
  stopPlayer();
  const coverUrl = track.cover || track.thumbnail || "";
  $("#player-cover").hidden = !coverUrl;
  if (coverUrl) $("#player-cover").src = coverUrl;
  $("#player-title").textContent = track.title;
  $("#player-artist").textContent = track.artist;
  $("#player-progress").style.width = "0";

  if (mode === "preview") {
    $("#player-toggle").hidden = false;
    audio.src = audioUrl;
    audio.play().then(() => player.classList.add("is-open")).catch(() => toast("Preview tidak dapat diputar.", "error"));
    return;
  }
  // Lagu penuh: pemutar YouTube resmi. Tombol jeda ada di dalam pemutarnya sendiri.
  $("#player-toggle").hidden = true;
  const frame = $("#player-frame");
  frame.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(track.id) + '?autoplay=1&playsinline=1&rel=0" title="' + escapeHtml(track.title) + '" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
  frame.hidden = false;
  player.classList.add("is-open");
}
$("#player-toggle").addEventListener("click", () => { if (audio.paused) audio.play(); else audio.pause(); });
$("#player-close").addEventListener("click", () => { stopPlayer(); player.classList.remove("is-open"); });
audio.addEventListener("play", () => $("#player-toggle use").setAttribute("href", "#i-pause"));
audio.addEventListener("pause", () => $("#player-toggle use").setAttribute("href", "#i-play"));
audio.addEventListener("ended", () => { $("#player-progress").style.width = "0"; });
audio.addEventListener("timeupdate", () => { if (audio.duration) $("#player-progress").style.width = (audio.currentTime / audio.duration) * 100 + "%"; });

/* ---------- 8. Mulai ---------- */
renderSidebar();
renderEndpoints();
toggleEndpoint("search", true);
renderQuick();
showRoute();
checkStatus();
loadStats();
loadConfig();
