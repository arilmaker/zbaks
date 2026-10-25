const YOUTUBE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
};

function textFrom(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value.simpleText) return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((part) => part.text || "").join("");
  return "";
}

function thumbnailFrom(value, id) {
  const thumbnails = value && (value.thumbnails || value.sources);
  return (thumbnails && thumbnails.at(-1) && thumbnails.at(-1).url) || (id ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : "");
}

function parseInitialData(html) {
  const match = html.match(/ytInitialData\s*=\s*({.+?})\s*;<\/script>/s);
  if (!match) throw new Error("Data YouTube tidak ditemukan.");
  return JSON.parse(match[1]);
}

function extractTracks(data, fallbackPlaylist) {
  const tracks = [];
  const seen = new Set();

  function addTrack(item) {
    if (!item.id || !item.title || seen.has(item.id)) return;
    seen.add(item.id);
    tracks.push({
      id: item.id, title: item.title, artist: item.artist || "YouTube",
      playlist: item.playlist || fallbackPlaylist,
      thumbnail: item.thumbnail || thumbnailFrom(null, item.id),
      url: "https://www.youtube.com/watch?v=" + item.id, preview: null,
    });
  }

  function visit(value, sectionTitle = fallbackPlaylist) {
    if (!value || typeof value !== "object") return;
    if (value.videoRenderer) {
      const item = value.videoRenderer;
      addTrack({ id: item.videoId, title: textFrom(item.title), artist: textFrom(item.ownerText) || textFrom(item.shortBylineText) || textFrom(item.longBylineText), thumbnail: thumbnailFrom(item.thumbnail, item.videoId), playlist: sectionTitle });
      return;
    }
    if (value.lockupViewModel && value.lockupViewModel.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
      const item = value.lockupViewModel;
      const metadata = item.metadata && item.metadata.lockupMetadataViewModel;
      const rows = metadata && metadata.metadata && metadata.metadata.contentMetadataViewModel && metadata.metadata.contentMetadataViewModel.metadataRows;
      const artist = rows && rows[0] && rows[0].metadataParts && rows[0].metadataParts[0] && rows[0].metadataParts[0].text && rows[0].metadataParts[0].text.content;
      addTrack({ id: item.contentId, title: metadata && metadata.title && metadata.title.content, artist, thumbnail: thumbnailFrom(item.contentImage && item.contentImage.thumbnailViewModel && item.contentImage.thumbnailViewModel.image, item.contentId), playlist: sectionTitle });
      return;
    }
    const header = value.itemSectionRenderer && value.itemSectionRenderer.header && value.itemSectionRenderer.header.itemSectionHeaderRenderer;
    const nextTitle = header && header.title ? textFrom(header.title) : sectionTitle;
    for (const key of Object.keys(value)) {
      if (!["clickTrackingParams", "trackingParams", "serviceTrackingParams"].includes(key)) visit(value[key], nextTitle);
    }
  }

  visit(data);
  return tracks;
}

async function fetchPage(url) {
  const response = await fetch(url, { headers: YOUTUBE_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("YouTube menjawab HTTP " + response.status + ".");
  return parseInitialData(await response.text());
}

async function getHomeTracks() { return extractTracks(await fetchPage("https://www.youtube.com/"), "Beranda YouTube"); }
async function searchTracks(query) { return extractTracks(await fetchPage("https://www.youtube.com/results?search_query=" + encodeURIComponent(query)), "Pencarian: " + query); }
async function getPlaylist(url) {
  let playlistId;
  try { playlistId = new URL(url).searchParams.get("list"); } catch (_) { throw new Error("URL playlist YouTube tidak valid."); }
  if (!playlistId) throw new Error("URL playlist YouTube harus memiliki parameter list.");
  const data = await fetchPage("https://www.youtube.com/playlist?list=" + encodeURIComponent(playlistId));
  const title = textFrom(data.metadata && data.metadata.playlistMetadataRenderer && data.metadata.playlistMetadataRenderer.title) || "Playlist YouTube";
  return { title, tracks: extractTracks(data, title) };
}

module.exports = { getHomeTracks, searchTracks, getPlaylist };
