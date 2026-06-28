import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envFilePath = process.env.SONIC_TOPOGRAPHY_ENV_FILE || path.join(__dirname, '.env.local');
dotenv.config({ path: envFilePath, quiet: true });
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

// Reload env file
async function reloadEnvFile() {
  const content = await fs.readFile(envFilePath, 'utf8').catch(() => '');
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) {
      process.env[match[1]] = match[2].trim();
    }
  }
  neteaseCookie = process.env.NETEASE_COOKIE?.trim();
}

// Write env file
async function writeEnvFile(updates) {
  let content = await fs.readFile(envFilePath, 'utf8').catch(() => '');
  const lines = content.split('\n');
  const updated = {};
  
  for (const [key, value] of Object.entries(updates)) {
    updated[key] = true;
    const escapedValue = value || '';
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(`${key}=`)) {
        lines[i] = `${key}=${escapedValue}`;
        found = true;
        break;
      }
    }
    if (!found) {
      lines.push(`${key}=${escapedValue}`);
    }
  }
  
  await fs.writeFile(envFilePath, lines.join('\n'), 'utf8');
  await reloadEnvFile();
}

const defaultPort = Number(process.env.PORT || 4173);
const dataDir = process.env.SONIC_TOPOGRAPHY_DATA_DIR || path.join(__dirname, 'data');
const playlistsPath = path.join(dataDir, 'playlists.json');
let neteaseCookie = process.env.NETEASE_COOKIE?.trim();

function getNeteaseHeaders() {
  return {
    Referer: 'https://music.163.com/',
    'User-Agent': 'Mozilla/5.0',
    ...(neteaseCookie ? { Cookie: neteaseCookie } : {}),
  };
}

// Compatibility: keep old name as getter
const neteaseHeaders = () => getNeteaseHeaders();


const playableUrlCache = new Map();
const searchCache = new Map();
let dailyRecommendCache = null;
const playableUrlCacheTtl = 1000 * 60 * 10;
const searchCacheTtl = 1000 * 60 * 5;
const dailyRecommendCacheTtl = 1000 * 60 * 10;

function getNeteaseCookieValue(name) {
  if (!neteaseCookie) return '';
  const prefix = `${name}=`;
  const item = neteaseCookie.split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : '';
}

async function getNeteasePlayableUrl(id) {
  const cached = playableUrlCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const url = `https://music.163.com/api/song/enhance/player/url?id=${encodeURIComponent(id)}&ids=%5B${encodeURIComponent(id)}%5D&br=320000`;
  const response = await fetch(url, { headers: neteaseHeaders() });
  const data = await response.json();
  const playableUrl = data?.data?.[0]?.url || null;
  playableUrlCache.set(id, { url: playableUrl, expiresAt: Date.now() + playableUrlCacheTtl });
  return playableUrl;
}

function normalizeNeteaseSong(song) {
  return {
    id: song.id,
    name: song.name,
    artist: (song.ar || song.artists || []).map((artist) => artist.name).filter(Boolean).join(' / '),
    album: song.al?.name || song.album?.name || '',
    duration: song.dt || song.duration || 0,
    fee: song.fee,
  };
}

async function checkBatchPlayable(songIds) {
  try {
    const url = `https://music.163.com/api/song/enhance/player/url?ids=${encodeURIComponent(JSON.stringify(songIds.map(String)))}&br=320000`;
    const response = await fetch(url, { headers: neteaseHeaders() });
    const data = await response.json();
    const urlMap = new Map();
    if (data?.data) {
      for (const item of data.data) {
        if (item.url) urlMap.set(String(item.id), item.url);
      }
    }
    return urlMap;
  } catch {
    return new Map();
  }
}

async function annotatePlayableSongs(rawSongs) {
  const songs = [];
  const batchSize = 20; // Check 20 songs per API call

  for (let i = 0; i < rawSongs.length; i += batchSize) {
    const batch = rawSongs.slice(i, i + batchSize);
    const songIds = batch.map((s) => String(s.id));
    
    try {
      const urlMap = await checkBatchPlayable(songIds);
      for (const song of batch) {
        songs.push({
          ...song,
          playable: urlMap.has(String(song.id)),
        });
      }
    } catch {
      // If batch check fails entirely, still add all songs (marked unplayable)
      for (const song of batch) {
        songs.push({ ...song, playable: false });
      }
    }
  }

  return songs;
}

function createDefaultPlaylists() {
  return [
    { id: 'favorites', name: '我的收藏', songs: [] },
    { id: 'visual-set', name: '视觉歌单', songs: [] },
  ];
}

function normalizePlaylists(value) {
  if (!Array.isArray(value) || value.length === 0) return createDefaultPlaylists();
  return value.map((playlist) => ({
    id: String(playlist.id || `playlist-${Date.now()}`),
    name: String(playlist.name || '歌单'),
    songs: Array.isArray(playlist.songs) ? playlist.songs : [],
  }));
}

async function readPlaylistsFile() {
  try {
    const raw = await fs.readFile(playlistsPath, 'utf8');
    return normalizePlaylists(JSON.parse(raw));
  } catch (error) {
    return createDefaultPlaylists();
  }
}

async function writePlaylistsFile(playlists) {
  await fs.mkdir(dataDir, { recursive: true });
  const normalized = normalizePlaylists(playlists);
  await fs.writeFile(playlistsPath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/playlists', async (_req, res) => {
    res.json({ playlists: await readPlaylistsFile() });
  });

  app.put('/api/playlists', async (req, res) => {
    try {
      const playlists = await writePlaylistsFile(req.body?.playlists);
      res.json({ playlists });
    } catch (error) {
      res.status(500).json({ error: 'Unable to save playlists' });
    }
  });

  app.get('/api/netease/search', async (req, res) => {
    try {
      const keywords = String(req.query.keywords || '').trim();
      const requestedLimit = Number(req.query.limit || '12');
      const resultLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 20)) : 12;

      if (!keywords) {
        res.status(400).json({ error: 'Missing keywords' });
        return;
      }

      const cacheKey = `${keywords.toLowerCase()}::${resultLimit}`;
      const cached = searchCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.json({ songs: cached.songs, cached: true });
        return;
      }

      const params = new URLSearchParams({
        s: keywords,
        type: '1',
        offset: '0',
        limit: String(Math.min(resultLimit * 3, 60)),
      });

      const response = await fetch(`https://music.163.com/api/cloudsearch/pc?${params}`, {
        headers: neteaseHeaders(),
      });
      const data = await response.json();
      const rawSongs = (data?.result?.songs || []).map(normalizeNeteaseSong);
      const songs = await annotatePlayableSongs(rawSongs.slice(0, resultLimit));
      searchCache.set(cacheKey, { songs, expiresAt: Date.now() + searchCacheTtl });

      res.json({ songs });
    } catch (error) {
      res.status(500).json({ error: 'Netease search failed' });
    }
  });

  app.get('/api/netease/daily-recommend', async (req, res) => {
    try {
      if (!neteaseCookie) {
        res.status(401).json({ error: 'Netease cookie is required' });
        return;
      }

      const requestedLimit = Number(req.query.limit || '30');
      const resultLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 50)) : 30;

      if (dailyRecommendCache && dailyRecommendCache.expiresAt > Date.now()) {
        res.json({ songs: dailyRecommendCache.songs.slice(0, resultLimit), cached: true });
        return;
      }

      const csrfToken = getNeteaseCookieValue('__csrf');
      const params = new URLSearchParams();
      if (csrfToken) params.set('csrf_token', csrfToken);

      const response = await fetch(`https://music.163.com/api/v1/discovery/recommend/songs?${params}`, {
        headers: neteaseHeaders(),
      });
      const data = await response.json();

      if (data?.code === 301 || data?.code === 401) {
        res.status(401).json({ error: 'Netease login is required' });
        return;
      }

      const sourceSongs = data?.recommend || data?.data?.dailySongs || data?.data?.songs || [];
      const rawSongs = sourceSongs.map(normalizeNeteaseSong).filter((song) => song.id);
      const songs = await annotatePlayableSongs(rawSongs);
      dailyRecommendCache = { songs, expiresAt: Date.now() + dailyRecommendCacheTtl };

      res.json({ songs: songs.slice(0, resultLimit) });
    } catch (error) {
      res.status(500).json({ error: 'Netease daily recommendations failed' });
    }
  });

  app.get('/api/netease/lyric', async (req, res) => {
    try {
      const id = String(req.query.id || '');
      if (!id) {
        res.status(400).json({ error: 'Missing id' });
        return;
      }

      const response = await fetch(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1`, {
        headers: neteaseHeaders(),
      });
      const data = await response.json();
      res.json({
        lyric: data?.lrc?.lyric || '',
        translatedLyric: data?.tlyric?.lyric || '',
      });
    } catch (error) {
      res.status(500).json({ error: 'Netease lyric failed' });
    }
  });

  app.get('/api/netease/user/account', async (req, res) => {
    try {
      if (!neteaseCookie) {
        res.status(401).json({ error: 'Netease cookie is required' });
        return;
      }

      const response = await fetch('https://music.163.com/api/nuser/account/get', {
        headers: neteaseHeaders(),
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        res.status(502).json({ error: 'Invalid response from Netease' });
        return;
      }

      if (data?.code !== 200) {
        // Try parse uid from cookie MUSIC_U as fallback
        const muCookie = getNeteaseCookieValue('MUSIC_U');
        if (muCookie) {
          const parts = muCookie.split('@');
          if (parts.length > 1) {
            const nickname = parts[0];
            res.json({ uid: parts[1], nickname });
            return;
          }
        }
        res.status(401).json({ error: `Failed to get account info (code: ${data?.code || 'none'}), cookie may be expired` });
        return;
      }

      const uid = data?.profile?.userId || data?.profile?.userPoint?.userId || data?.account?.id || '';
      const nickname = data?.profile?.nickname || data?.profile?.userPoint?.nickname || '';

      if (!uid) {
        // Fallback: parse from MUSIC_U cookie
        const muCookie = getNeteaseCookieValue('MUSIC_U');
        if (muCookie) {
          const parts = muCookie.split('@');
          if (parts.length > 1) {
            res.json({ uid: parts[1], nickname: parts[0] || nickname });
            return;
          }
        }
      }

      res.json({ uid, nickname });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get account info' });
    }
  });

  app.get('/api/netease/user/playlists', async (req, res) => {
    try {
      const uid = String(req.query.uid || '').trim();
      if (!uid) {
        res.status(400).json({ error: 'Missing uid' });
        return;
      }

      const response = await fetch(`https://music.163.com/api/user/playlist?uid=${encodeURIComponent(uid)}&limit=100&offset=0`, {
        headers: neteaseHeaders(),
      });
      const data = await response.json();

      if (data?.code !== 200) {
        const reason = data?.code === 401 ? '需要登录，Cookie 可能已过期' :
                       data?.code === 403 ? '无法访问该用户歌单' :
                       `接口返回错误 (${data?.code})`;
        res.status(401).json({ error: reason });
        return;
      }

      const playlists = (data?.playlist || []).map((pl) => ({
        id: pl.id,
        name: pl.name,
        trackCount: pl.trackCount || 0,
        coverImgUrl: pl.coverImgUrl || '',
      }));

      res.json({ playlists });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch playlists' });
    }
  });

  async function fetchAllPlaylistTracks(id) {
    // Try track/all endpoint first — returns ALL tracks
    try {
      const url = `https://music.163.com/api/playlist/track/all?id=${encodeURIComponent(id)}&limit=500&offset=0`;
      const response = await fetch(url, { headers: neteaseHeaders() });
      const data = await response.json();
      if (data?.code === 200 && data?.songs?.length) {
        return { tracks: data.songs, name: '', id, total: data.songs.length };
      }
    } catch (e) {
      // fall through
    }
    return null;
  }

  async function fetchPlaylistDetail(id, uid) {
    // First try the track/all endpoint (most reliable for full track lists)
    const allTracks = await fetchAllPlaylistTracks(id);
    if (allTracks && allTracks.tracks.length > 0) {
      return { tracks: allTracks.tracks, name: allTracks.name, id, totalCount: allTracks.total };
    }

    // Fallback: standard playlist detail endpoints
    const endpoints = [
      `https://music.163.com/api/playlist/detail?id=${encodeURIComponent(id)}`,
      `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(id)}`,
    ];

    for (const url of endpoints) {
      try {
        const response = await fetch(url, { headers: neteaseHeaders() });
        const data = await response.json();
        if (data?.code === 200) {
          const result = data?.playlist || data?.result || {};
          if (result.tracks?.length || result.trackIds?.length) {
            return { tracks: result.tracks || [], name: result.name || '', id, totalCount: result.trackCount || 0 };
          }
        }
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  async function fetchLikedSongs(uid) {
    try {
      const url = `https://music.163.com/api/song/like/list?uid=${encodeURIComponent(uid)}`;
      const response = await fetch(url, { headers: neteaseHeaders() });
      const data = await response.json();
      if (data?.code === 200 && data?.ids?.length) {
        const songIds = data.ids.slice(0, 500);
        const detailRes = await fetch(
          `https://music.163.com/api/song/detail?ids=${encodeURIComponent(songIds.join(','))}`,
          { headers: neteaseHeaders() }
        );
        const detail = await detailRes.json();
        if (detail?.code === 200 && detail?.songs) {
          return detail.songs;
        }
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  app.get('/api/netease/playlist/detail', async (req, res) => {
    try {
      const id = String(req.query.id || '').trim();
      const uid = String(req.query.uid || '').trim();
      if (!id) {
        res.status(400).json({ error: 'Missing id' });
        return;
      }

      // Try regular playlist endpoints
      const result = await fetchPlaylistDetail(id, uid);
      if (result && result.tracks && result.tracks.length > 0) {
        const rawSongs = result.tracks.map(normalizeNeteaseSong);
        const songs = await annotatePlayableSongs(rawSongs);
        res.json({
          playlist: {
            id: result.id || id,
            name: result.name || '',
            trackCount: result.tracks.length,
            songs,
          },
        });
        return;
      }

      // Try liked songs
      const likeUid = uid || id;
      const likedSongs = await fetchLikedSongs(likeUid);
      if (likedSongs) {
        const rawSongs = likedSongs.map(normalizeNeteaseSong);
        const songs = await annotatePlayableSongs(rawSongs);
        res.json({
          playlist: { id, name: '我喜欢', songs },
        });
        return;
      }

      // Nothing worked — try one more time with the original API to get proper error code
      try {
        const lastRes = await fetch(`https://music.163.com/api/playlist/detail?id=${encodeURIComponent(id)}`, {
          headers: neteaseHeaders(),
        });
        const lastData = await lastRes.json();
        const reason = lastData?.code === 401 ? '需要登录，Cookie 可能已过期' :
                       lastData?.code === 404 ? '歌单不存在，可能为私密歌单' :
                       lastData?.code === 403 ? '歌单为私密，无法访问' :
                       lastData?.code === 400 ? '歌单ID无效' :
                       `接口返回错误 (${lastData?.code || 'unknown'})`;
        res.status(401).json({ error: reason });
      } catch {
        res.status(500).json({ error: '获取歌单失败，请检查网络' });
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch playlist detail' });
    }
  });

  app.get('/api/netease/url', async (req, res) => {
    try {
      const id = String(req.query.id || '');
      if (!id) {
        res.status(400).json({ error: 'Missing id' });
        return;
      }

      res.json({ url: await getNeteasePlayableUrl(id) });
    } catch (error) {
      res.status(500).json({ error: 'Netease url failed' });
    }
  });

  app.get('/api/netease/audio', async (req, res) => {
    try {
      const id = String(req.query.id || '');
      if (!id) {
        res.status(400).json({ error: 'Missing id' });
        return;
      }

      const playableUrl = await getNeteasePlayableUrl(id);
      if (!playableUrl) {
        res.status(404).json({ error: 'No playable url for this song' });
        return;
      }

      const headers = { ...neteaseHeaders() };
      if (req.headers.range) headers.Range = req.headers.range;

      const audioResponse = await fetch(playableUrl, { headers });
      res.status(audioResponse.status);
      ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((header) => {
        const value = audioResponse.headers.get(header);
        if (value) res.setHeader(header, value);
      });

      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'audio/mpeg');
      if (audioResponse.body) {
        const reader = audioResponse.body.getReader();
        const pump = async () => {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            return;
          }
          res.write(Buffer.from(value), pump);
        };
        pump();
      } else {
        res.end();
      }
    } catch (error) {
      res.status(500).json({ error: 'Netease audio proxy failed' });
    }
  });

  // Settings: get cookie status
  app.get('/api/settings/cookie', (_req, res) => {
    const cookie = process.env.NETEASE_COOKIE?.trim() || '';
    // Return masked version
    const hasCookie = cookie.length > 0;
    res.json({
      hasCookie,
      preview: hasCookie ? cookie.substring(0, 30) + '...' : '',
    });
  });

  // Settings: update cookie
  app.post('/api/settings/cookie', async (req, res) => {
    try {
      const cookie = String(req.body?.cookie || '').trim();
      await writeEnvFile({ NETEASE_COOKIE: cookie });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save cookie' });
    }
  });

  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });

  return app;
}

export function startServer(port = defaultPort) {
  const app = createApp();
  return app.listen(port, '127.0.0.1', () => {
    console.log(`Sonic Topography is running at http://127.0.0.1:${port}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer(defaultPort);
}
