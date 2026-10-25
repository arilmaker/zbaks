# rilzapiweb

REST API musik YouTube dengan metadata artis asli (Spotify / Deezer / iTunes). **Gratis untuk semua pengguna, tanpa limit request, tanpa akun.** API key dibagikan oleh admin. Tanpa database, tanpa dependensi npm, **tanpa folder**: semua file ada di satu level supaya mudah di-upload ke GitHub.

## Daftar file

| File | Fungsi |
| --- | --- |
| `server.js` | Server, routing, endpoint API. File utama yang dijalankan |
| `keys.js` | Baca/tulis API key |
| `youtube.js` | Scraper YouTube |
| `metadata.js` | Pencocokan artis ke Spotify/Deezer/iTunes |
| `index.html`, `site.js`, `style.css` | Tampilan web |
| `apikey.json` | Daftar API key |
| `vercel.json` | Konfigurasi Vercel |
| `package.json` | Info proyek |
| `env.example` | Contoh pengaturan (salin menjadi `.env`) |
| `.gitignore` | Opsional |

Hanya `index.html`, `site.js`, dan `style.css` yang bisa dibuka lewat URL. File lain (`apikey.json`, `server.js`, dst.) tidak pernah disajikan.

## Upload ke GitHub (tanpa folder)

1. Buat repositori baru, pilih **Private** (karena `apikey.json` berisi key).
2. Klik **Add file → Upload files**.
3. Pilih semua file di atas sekaligus lalu tarik ke halaman GitHub. Tidak ada folder yang perlu dibuat.
4. Klik **Commit changes**.

`.gitignore` dan `env.example` boleh dilewati kalau sulit dipilih, aplikasi tetap jalan.

## Mengelola API key

Pengguna meminta key ke admin lewat halaman **API Key** (tombol WhatsApp/Telegram). Admin menambah key dengan salah satu cara:

**1. Edit `apikey.json`**

```json
{
  "apiKeys": [
    { "key": "rilz_budi_abc123", "name": "Bot WA Budi", "plan": "free", "active": true },
    { "key": "rilz_siti_xyz789", "name": "Siti", "plan": "free", "active": false }
  ]
}
```

`active: false` menonaktifkan key tanpa menghapusnya. Di server biasa perubahan langsung berlaku tanpa restart.

**2. Environment variable** `API_KEYS=rilz_abc,rilz_def` (dipisah koma). Cara termudah di Vercel.

**3. Endpoint admin** (butuh `ADMIN_BOT_TOKEN`), cocok untuk bot Telegram:

```
POST /api/admin/keys           {"name":"Pak Budi"}   ->  {"apiKey":"rilz_..."}
POST /api/admin/keys/revoke    {"key":"rilz_..."}
GET  /api/admin/keys
header: x-admin-token: ADMIN_BOT_TOKEN
```

## Jalankan (localhost, Pterodactyl, VPS)

1. Salin `env.example` menjadi `.env`, lalu isi.
2. `node server.js` (Node.js 18 atau lebih baru).
3. Buka `http://localhost:3000`.

Port diambil dari `PORT` atau `SERVER_PORT` (otomatis di Pterodactyl). Di Pterodactyl, isi file startup dengan `server.js`. Tidak perlu `npm install`.

## Deploy ke Vercel

1. Upload semua file ke GitHub seperti di atas.
2. Di vercel.com pilih **Add New → Project**, impor repositorinya. Framework Preset **Other**. Build Command dan Output Directory dikosongkan.
3. Buka **Environment Variables**, isi nilai dari `env.example` (minimal `ADMIN_WHATSAPP`, dan `API_KEYS` atau pastikan `apikey.json` berisi key aktif).
4. Klik **Deploy**.

Karena tidak ada folder `api/`, `vercel.json` memakai pengaturan `builds` yang mengarahkan semua request ke `server.js`. Vercel mungkin menampilkan peringatan bahwa Build Settings tidak dipakai. Itu normal.

Disk Vercel read-only. Key dari `apikey.json` dan `API_KEYS` selalu tersedia, tetapi key yang dibuat lewat endpoint admin hanya tersimpan di `/tmp` dan hilang saat instance restart. Di Vercel, tambah key lewat `API_KEYS` atau edit `apikey.json` lalu commit. Untuk membuat key lewat bot secara permanen, jalankan di Pterodactyl/VPS.

Batas waktu fungsi mengikuti pengaturan akun Vercel. Jika playlist besar sering timeout, tambahkan `&enrich=0`.

## Endpoint

Semua endpoint GET. API key lewat `?apikey=` atau header `x-api-key`.

| Endpoint | Fungsi |
| --- | --- |
| `GET /api/v1` | Info API (tanpa key) |
| `GET /api/v1/key` | Periksa apakah key aktif |
| `GET /api/v1/music/home` | Beranda YouTube |
| `GET /api/v1/music/search?q=judul` | Cari lagu |
| `GET /api/v1/music/playlist?url=URL_PLAYLIST` | Isi playlist |

Kode status: `200` berhasil, `400` parameter kosong, `401` key tidak ada, salah, atau dinonaktifkan, `5xx` YouTube gagal diambil.

## Metadata artis asli

1. Judul dibersihkan: `keshi - UNDERSTAND (Official Video) [4K]` menjadi artis `keshi`, judul `UNDERSTAND`.
2. Lagu dicari di katalog berurutan: Spotify (hanya jika key diisi), Deezer, iTunes. Deezer dan iTunes gratis tanpa key.
3. Kandidat diberi skor kemiripan judul dan artis. Hanya skor di atas 0,55 yang dipakai.
4. Jika tidak ada yang cocok, `source` bernilai `youtube` dan data tetap versi YouTube yang sudah dibersihkan.

Hasil dicache 6 jam di memori. Tambahkan `&enrich=0` untuk data YouTube saja (lebih cepat).

```json
{
  "status": true,
  "result": [{
    "id": "2sD0m8xXq3o", "title": "Hati-Hati di Jalan", "artist": "Tulus", "artists": ["Tulus"],
    "album": "Manusia", "cover": "https://...", "duration": 246, "preview": "https://...mp3",
    "url": "https://www.youtube.com/watch?v=2sD0m8xXq3o", "source": "deezer", "confidence": 1,
    "youtube": { "title": "Tulus - Hati-Hati di Jalan (Official Video)", "channel": "TULUS" }
  }],
  "meta": { "count": 1, "enriched": true }
}
```

## Catatan

- **Tanpa limit berarti siapa pun yang punya key bisa memanggil sebanyak-banyaknya.** Setiap request menyentuh YouTube dan katalog dari IP server kamu, sehingga pemakaian berlebih bisa membuat IP diblokir. Nonaktifkan key yang menyalahgunakan.
- YouTube kadang memblokir IP server cloud. Jika endpoint musik sering 5xx di hosting tetapi lancar di lokal, itu penyebabnya.
- Scraping YouTube melanggar ketentuan layanannya. Pakai dengan risiko sendiri.
