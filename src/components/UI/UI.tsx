import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Play, Pause, Volume2, SkipForward, SkipBack, Palette, Plus, ListMusic, Shuffle, Repeat1, Trash2, Maximize2, Minimize2, Settings, Pencil, Check, X, Clock } from 'lucide-react';
import { engine } from '../../lib/AudioEngine';
import { themes } from '../../lib/themes';
import { LyricsDisplay } from './LyricsDisplay';
import { extractAudioMetadata, extractLyricsFromAudio } from '../../lib/metadata';
import { apiUrl } from '../../lib/config';

interface UIProps {
  theme: string;
  onThemeChange: (theme: string) => void;
}

interface NeteaseSong {
  id: number;
  name: string;
  artist: string;
  album: string;
  duration: number;
  fee: number;
  playable?: boolean;
}

interface SavedPlaylist {
  id: string;
  name: string;
  songs: NeteaseSong[];
}

type PlayMode = 'sequence' | 'shuffle';
type PendingDelete =
  | { type: 'song'; playlistId: string; songId: number; label: string }
  | { type: 'playlist'; playlistId: string; label: string };

const PLAYLIST_STORAGE_KEY = 'sonic-topography-playlists-v1';

function createDefaultPlaylists(): SavedPlaylist[] {
  return [
    { id: 'favorites', name: '我的收藏', songs: [] },
    { id: 'visual-set', name: '视觉歌单', songs: [] },
  ];
}

function readSavedPlaylists(): SavedPlaylist[] {
  try {
    const raw = window.localStorage.getItem(PLAYLIST_STORAGE_KEY);
    if (!raw) return createDefaultPlaylists();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return createDefaultPlaylists();
    return parsed.map((playlist: SavedPlaylist) => ({
      id: playlist.id,
      name: playlist.name,
      songs: Array.isArray(playlist.songs) ? playlist.songs : [],
    }));
  } catch (error) {
    console.warn('Unable to read saved playlists:', error);
    return createDefaultPlaylists();
  }
}

function hasSavedSongs(playlists: SavedPlaylist[]): boolean {
  return playlists.some((playlist) => playlist.songs.length > 0);
}

export function UI({ theme, onThemeChange }: UIProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playlistFileInputRef = useRef<HTMLInputElement>(null);
  const playlistJSONInputRef = useRef<HTMLInputElement>(null);
  const demoAudioUrl = '/demo.mp3';
  const demoLyricsUrl = '/demo.lrc';
  const [isPlaying, setIsPlaying] = useState(false);
  const [trackName, setTrackName] = useState<string>('未选择曲目');
  const [lyricsText, setLyricsText] = useState<string>('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    try {
      const saved = localStorage.getItem('sonic-volume');
      return saved ? parseFloat(saved) : 1;
    } catch {
      return 1;
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try { return JSON.parse(window.localStorage.getItem('sonic-topography-search-history') || '[]'); } catch { return []; }
  });
  const [searchResults, setSearchResults] = useState<NeteaseSong[]>([]);
  const [searchStatus, setSearchStatus] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>(readSavedPlaylists);
  const [activePlaylistId, setActivePlaylistId] = useState('favorites');
  const [songToAdd, setSongToAdd] = useState<NeteaseSong | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [playMode, setPlayMode] = useState<PlayMode>('sequence');
  const [isSingleLoop, setIsSingleLoop] = useState(false);
  const [playQueue, setPlayQueue] = useState<NeteaseSong[]>([]);
  const [currentSongId, setCurrentSongId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const sidebarExpanded = sidebarPinned || sidebarHovered;
  const [neteaseUID, setNeteaseUID] = useState(() => window.localStorage.getItem('sonic-topography-netease-uid') || '');
  const [userPlaylists, setUserPlaylists] = useState<{id:number;name:string;trackCount:number;coverImgUrl:string}[]>([]);
  const [isFetchingPlaylists, setIsFetchingPlaylists] = useState(false);
  const [importingPlaylistId, setImportingPlaylistId] = useState<number | null>(null);
  const [playlistImportStatus, setPlaylistImportStatus] = useState('');
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

  const hasLoadedPlaylistsRef = useRef(false);
  const importingRef = useRef(false);

  useEffect(() => {
    if (!hasLoadedPlaylistsRef.current) return;
    window.localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlists));
    const syncPlaylists = async () => {
      try {
        await fetch(apiUrl('/api/playlists'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlists }),
        });
      } catch (error) {
        console.warn('Unable to save playlists to local server:', error);
      }
    };
    syncPlaylists();
  }, [playlists]);


  useEffect(() => {
    const loadPlaylists = async () => {
      try {
        const response = await fetch(apiUrl('/api/playlists'));
        if (!response.ok) throw new Error('歌单请求失败');
        const data = await response.json();
        if (Array.isArray(data.playlists) && data.playlists.length > 0) {
          const serverPlaylists = data.playlists;
          const browserPlaylists = readSavedPlaylists();
          if (!hasSavedSongs(serverPlaylists) && hasSavedSongs(browserPlaylists)) {
            setPlaylists(browserPlaylists);
          } else {
            setPlaylists(serverPlaylists);
          }
        }
      } catch (error) {
        console.warn('Using browser playlist storage:', error);
      } finally {
        hasLoadedPlaylistsRef.current = true;
      }
    };

    loadPlaylists();
  }, []);
  
  // Audio state poller
  useEffect(() => {
    const initEngine = async () => {
       await engine.init(); 
    };
    initEngine();
    
    let animationFrameId: number;
    const poll = () => {
      setIsPlaying(engine.isPlaying);
      setCurrentTime(engine.audioElement.currentTime);
      setDuration(engine.audioElement.duration || 0);
      setVolume(engine.audioElement.volume);
      setIsCapturing(engine.isCapturing);
      animationFrameId = requestAnimationFrame(poll);
    };
    poll();
    
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.warn('Unable to toggle fullscreen:', error);
    }
  };

  const processFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    let audioFile: File | null = null;
    let lrcFile: File | null = null;
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('audio/') || file.name.endsWith('.mp3') || file.name.endsWith('.wav') || file.name.endsWith('.flac')) {
            audioFile = file;
        } else if (file.name.endsWith('.lrc')) {
            lrcFile = file;
        }
    }

    if (lrcFile) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result as string;
            setLyricsText(text);
        };
        reader.readAsText(lrcFile);
    } else if (audioFile) {
        setLyricsText('');
        // Try extracting lyrics natively from the audio file
        const extractedLyrics = await extractLyricsFromAudio(audioFile);
        if (extractedLyrics) {
             setLyricsText(extractedLyrics);
        }
    } else {
        setLyricsText('');
    }

    if (audioFile) {
        setTrackName(audioFile.name);
        engine.init();
        engine.loadFile(audioFile);
        engine.play();
    }
  };


  // Handle local music upload to playlist
  const exportPlaylistsJSON = () => {
    const data = JSON.stringify(playlists, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sonic-topography-playlists-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportPlaylistsJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(imported)) throw new Error('格式错误');
        const merged = [...playlists];
        for (const pl of imported) {
          if (!pl.id || !pl.name) continue;
          const existing = merged.findIndex((p) => p.id === pl.id);
          if (existing >= 0) {
            // Merge songs (deduplicate by id)
            const existingIds = new Set(merged[existing].songs.map((s: {id:number}) => s.id));
            const newSongs = (pl.songs || []).filter((s: {id:number}) => !existingIds.has(s.id));
            merged[existing] = { ...merged[existing], songs: [...merged[existing].songs, ...newSongs] };
          } else {
            merged.push({ id: pl.id, name: pl.name, songs: pl.songs || [] });
          }
        }
        setPlaylists(merged);
        setSearchStatus(`已导入 ${imported.length} 个歌单`);
        setTimeout(() => setSearchStatus(''), 3000);
      } catch {
        setSearchStatus('JSON 格式错误，导入失败');
        setTimeout(() => setSearchStatus(''), 3000);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handlePlaylistFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !activePlaylist) return;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('audio/') && !file.name.endsWith('.mp3') && !file.name.endsWith('.wav') && !file.name.endsWith('.flac')) continue;
      
      const url = URL.createObjectURL(file);
      const song: NeteaseSong = {
        id: Date.now() + i,
        name: file.name.replace(/\.[^.]+$/, ''),
        artist: '本地音乐',
        album: '',
        duration: 0,
        fee: 0,
        playable: true,
      };
      
      setPlaylists(prev => prev.map(p => {
        if (p.id === activePlaylist!.id) {
          return { ...p, songs: [...p.songs, song] };
        }
        return p;
      }));
    }
    e.target.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
    e.target.value = '';
  };

  const loadDemo = async () => {
    const audioName = demoAudioUrl.split('/').pop() || 'demo.mp3';

    setTrackName('正在加载示例音乐...');
    setLyricsText('');

    try {
      const audioResponse = await fetch(demoAudioUrl);
      if (!audioResponse.ok) {
        throw new Error(`Demo audio not found: ${demoAudioUrl}`);
      }

      const audioBlob = await audioResponse.blob();
      const metadata = await extractAudioMetadata(audioBlob, audioName);
      setTrackName(metadata.displayName);

      let demoLyrics = metadata.lyrics || '';
      try {
        const lyricsResponse = await fetch(demoLyricsUrl, { cache: 'no-store' });
        if (lyricsResponse.ok) {
          demoLyrics = await lyricsResponse.text();
        }
      } catch (error) {
        console.warn('Demo lyrics file is not available:', error);
      }

      setLyricsText(demoLyrics);
      engine.init();
      engine.loadUrl(demoAudioUrl);
      engine.play();
    } catch (error) {
      console.warn('Unable to load demo track:', error);
      setTrackName('未选择曲目');
      setLyricsText('');
    }
  };

  const togglePlay = () => {
    engine.init();
    engine.togglePlay();
  };

  const seekTo = (time: number) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const nextTime = Math.max(0, Math.min(time, duration));
    engine.audioElement.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const doSearch = async (query: string) => {
    const keywords = query.trim();
    if (!keywords) return;

    setIsSearching(true);
    setSearchStatus('正在搜索...');
    setSearchResults([]);

    try {
      const response = await fetch(apiUrl(`/api/netease/search?keywords=${encodeURIComponent(keywords)}`));
      if (!response.ok) throw new Error('搜索请求失败');

      const data = await response.json();
      const songs = data.songs || [];
      setSearchResults(songs);
      if (!songs.length) {
        setSearchStatus('没有找到歌曲');
      } else if (songs.some((song: NeteaseSong) => song.playable === false)) {
        setSearchStatus('已显示全部结果，不可播放歌曲已标灰');
      } else {
        setSearchStatus('');
      }
      // Save to search history
      setSearchHistory((prev) => {
        const next = [keywords, ...prev.filter((k) => k !== keywords)].slice(0, 12);
        window.localStorage.setItem('sonic-topography-search-history', JSON.stringify(next));
        return next;
      });
    } catch (error) {
      console.warn('Netease search failed:', error);
      setSearchStatus('搜索失败');
    } finally {
      setIsSearching(false);
    }
  };

  const searchNetease = () => doSearch(searchQuery);

  const searchNeteaseWithQuery = (query: string) => {
    setSearchQuery(query);
    doSearch(query);
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    window.localStorage.removeItem('sonic-topography-search-history');
  };







  const loadDailyRecommendations = async () => {
    setIsSearching(true);
    setSearchStatus('正在加载每日推荐...');
    setSearchResults([]);

    try {
      const response = await fetch(apiUrl('/api/netease/daily-recommend'));
      if (response.status === 401) {
        setSearchStatus('请先配置网易云 Cookie');
        return;
      }
      if (!response.ok) throw new Error('每日推荐请求失败');

      const data = await response.json();
      const songs = data.songs || [];
      setSearchResults(songs);
      if (!songs.length) {
        setSearchStatus('没有拿到每日推荐');
      } else if (songs.some((song: NeteaseSong) => song.playable === false)) {
        setSearchStatus('已加载每日推荐，不可播放歌曲已标灰');
      } else {
        setSearchStatus('已加载每日推荐');
      }
    } catch (error) {
      console.warn('Netease daily recommendations failed:', error);
      setSearchStatus('每日推荐加载失败');
    } finally {
      setIsSearching(false);
    }
  };

  const autoDetectUID = async () => {
    setIsFetchingPlaylists(true);
    setPlaylistImportStatus('正在获取账号信息...');
    try {
      const response = await fetch(apiUrl('/api/netease/user/account'));
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setPlaylistImportStatus(data?.error || '请先配置网易云 Cookie');
        return;
      }
      const data = await response.json();
      if (data.uid) {
        setNeteaseUID(String(data.uid));
        setPlaylistImportStatus(`已识别账号: ${data.nickname || data.uid}`);
        // Auto-fetch playlists
        const plResponse = await fetch(apiUrl(`/api/netease/user/playlists?uid=${encodeURIComponent(String(data.uid))}`));
        if (plResponse.ok) {
          const plData = await plResponse.json();
          setUserPlaylists(plData.playlists || []);
          setPlaylistImportStatus(plData.playlists?.length ? `已识别账号: ${data.nickname || data.uid}，找到 ${plData.playlists.length} 个歌单` : `已识别账号: ${data.nickname || data.uid}，没有找到歌单`);
        }
      }
    } catch {
      setPlaylistImportStatus('获取账号信息失败');
    } finally {
      setIsFetchingPlaylists(false);
    }
  };

  const fetchUserPlaylists = async () => {
    const uid = neteaseUID.trim();
    if (!uid) return;

    setIsFetchingPlaylists(true);
    setUserPlaylists([]);
    setPlaylistImportStatus('正在获取歌单...');

    try {
      const response = await fetch(apiUrl(`/api/netease/user/playlists?uid=${encodeURIComponent(uid)}`));
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setPlaylistImportStatus(data?.error || '获取歌单失败，请检查 UID');
        return;
      }
      const data = await response.json();
      setUserPlaylists(data.playlists || []);
      setPlaylistImportStatus(data.playlists?.length ? `找到 ${data.playlists.length} 个歌单` : '没有找到歌单');
    } catch {
      setPlaylistImportStatus('获取歌单失败');
    } finally {
      setIsFetchingPlaylists(false);
    }
  };

  const importNeteasePlaylist = async (playlistId: number, playlistName: string) => {
    if (importingRef.current) return;
    importingRef.current = true;
    setImportingPlaylistId(playlistId);
    setPlaylistImportStatus(`正在获取「${playlistName}」...`);
    setImportProgress({ current: 0, total: 0 });

    try {
      const uidParam = neteaseUID.trim() ? `&uid=${encodeURIComponent(neteaseUID.trim())}` : '';
      
      // Start a progress timer (estimate: 20 songs per batch, ~1.5s per batch)
      const progressTimer = setInterval(() => {
        setImportProgress(prev => {
          if (prev.total === 0 || prev.current >= prev.total) return prev;
          return { ...prev, current: Math.min(prev.current + 20, prev.total) };
        });
      }, 1500);
      
      const response = await fetch(apiUrl(`/api/netease/playlist/detail?id=${encodeURIComponent(String(playlistId))}${uidParam}`));
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setPlaylistImportStatus(data?.error || '导入失败');
        return;
      }
      const data = await response.json();
      clearInterval(progressTimer);
      const songs: NeteaseSong[] = data?.playlist?.songs || [];
      const totalTracks = data?.playlist?.trackCount || songs.length;

      if (!songs.length) {
        setPlaylistImportStatus('歌单为空');
        setImportProgress({ current: 0, total: 0 });
        return;
      }
      
      setImportProgress({ current: songs.length, total: songs.length });

      // Create a new playlist in the local list
      const newPlaylist: SavedPlaylist = {
        id: `netease-${playlistId}`,
        name: playlistName,
        songs,
      };

      setPlaylists((prev) => {
        const filtered = prev.filter((p) => p.id !== newPlaylist.id);
        return [...filtered, newPlaylist];
      });

      setPlaylistImportStatus(`已导入「${playlistName}」(${songs.length} 首)`);
      setImportProgress({ current: songs.length, total: songs.length });
      setTimeout(() => {
        setUserPlaylists([]);
        setPlaylistImportStatus('');
        setImportProgress({ current: 0, total: 0 });
      }, 2500);
    } catch {
      setPlaylistImportStatus('导入失败');
      setImportProgress({ current: 0, total: 0 });
    } finally {
      setImportingPlaylistId(null);
      importingRef.current = false;
    }
  };

  // Queue a song to play next (insert after current)
  const queueNextSong = (song: NeteaseSong) => {
    if (song.playable === false) {
      setSearchStatus('这首歌当前不可播放');
      return;
    }
    const queue = getCurrentQueue();
    const currentIndex = queue.findIndex(s => s.id === currentSongId);
    const insertAt = currentIndex >= 0 ? currentIndex + 1 : 0;
    const newQueue = [...queue];
    // Remove song if already in queue
    const existingIdx = newQueue.findIndex(s => s.id === song.id);
    if (existingIdx >= 0) newQueue.splice(existingIdx, 1);
    newQueue.splice(insertAt, 0, song);
    setPlayQueue(newQueue);
    setSearchStatus(`已加入队列: ${song.name}`);
    setTimeout(() => setSearchStatus(''), 2000);
  };

  const loadNeteaseSong = async (song: NeteaseSong, queue?: NeteaseSong[]) => {
    if (song.playable === false) {
      setSearchStatus('这首歌当前不可播放');
      return;
    }

    if (queue) setPlayQueue(queue);
    setCurrentSongId(song.id);
    setTrackName(`${song.artist ? `${song.artist} - ` : ''}${song.name}`);
    setLyricsText('');
    setSearchStatus('正在加载歌曲...');

    try {
      const isLocalFile = !!(song as any)._localUrl;
      
      if (isLocalFile) {
        engine.init();
        engine.loadUrl((song as any)._localUrl);
        engine.play();
        setLyricsText('');
        setSearchStatus('');
        setActivePanel(null);
      } else {
        const [urlResponse, lyricResponse] = await Promise.all([
          fetch(apiUrl(`/api/netease/url?id=${song.id}`)),
          fetch(apiUrl(`/api/netease/lyric?id=${song.id}`)),
        ]);

        const urlData = await urlResponse.json();
        const lyricData = await lyricResponse.json();
        const lyric = lyricData.lyric || lyricData.translatedLyric || '';
        setLyricsText(lyric);

        if (!urlData.url) {
          setSearchStatus('歌曲不可用，正在跳过...');
          playFromQueue(1, song.id);
          return;
        }

        engine.init();
        engine.loadUrl(`/api/netease/audio?id=${song.id}`);
        engine.play();
        setSearchStatus('');
        setActivePanel(null);
      }
    } catch (error) {
      console.warn('Unable to load Netease song:', error);
      setSearchStatus('加载失败，正在跳过...');
      playFromQueue(1, song.id);
    }
  };

  const getCurrentQueue = () => playQueue.length > 0 ? playQueue : activePlaylist?.songs || [];

  const playFromQueue = (direction: 1 | -1, fromSongId = currentSongId) => {
    const queue = getCurrentQueue();
    if (queue.length === 0) return;

    let nextIndex = 0;
    const currentIndex = queue.findIndex((song) => song.id === fromSongId);

    if (playMode === 'shuffle' && queue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * queue.length);
      } while (nextIndex === currentIndex);
    } else {
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      nextIndex = (baseIndex + direction + queue.length) % queue.length;
    }

    loadNeteaseSong(queue[nextIndex], queue);
  };

  useEffect(() => {
    engine.audioElement.loop = isSingleLoop;
  }, [isSingleLoop]);

  useEffect(() => {
    const handleEnded = () => {
      if (isSingleLoop) return;
      const queue = getCurrentQueue();
      if (queue.length > 1) playFromQueue(1);
    };

    engine.audioElement.addEventListener('ended', handleEnded);
    return () => engine.audioElement.removeEventListener('ended', handleEnded);
  }, [playQueue, currentSongId, playMode, activePlaylistId, playlists, isSingleLoop]);

  const addSongToPlaylist = (playlistId: string, song: NeteaseSong) => {
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      const exists = playlist.songs.some((savedSong) => savedSong.id === song.id);
      if (exists) return playlist;
      return { ...playlist, songs: [...playlist.songs, song] };
    }));
    const playlistName = playlists.find((playlist) => playlist.id === playlistId)?.name || '歌单';
    setSearchStatus(`已添加到 ${playlistName}`);
    setSongToAdd(null);
  };

  const createPlaylistAndAddSong = () => {
    const name = newPlaylistName.trim();
    if (!name || !songToAdd) return;

    const id = `playlist-${Date.now()}`;
    setPlaylists((current) => [...current, { id, name, songs: [songToAdd] }]);
    setActivePlaylistId(id);
    setSearchStatus(`已添加到 ${name}`);
    setSongToAdd(null);
    setNewPlaylistName('');
  };

  const deleteSongFromPlaylist = (playlistId: string, songId: number) => {
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      return { ...playlist, songs: playlist.songs.filter((song) => song.id !== songId) };
    }));

    setPlayQueue((queue) => queue.filter((song) => song.id !== songId));
    if (currentSongId === songId) {
      setCurrentSongId(null);
    }
  };

  const deletePlaylist = (playlistId: string) => {
    if (playlists.length <= 1) return;

    const nextPlaylists = playlists.filter((playlist) => playlist.id !== playlistId);
    setPlaylists(nextPlaylists);

    if (activePlaylistId === playlistId) {
      setActivePlaylistId(nextPlaylists[0]?.id || 'favorites');
    }

    const deletedPlaylist = playlists.find((playlist) => playlist.id === playlistId);
    if (deletedPlaylist?.songs.some((song) => song.id === currentSongId)) {
      setPlayQueue([]);
      setCurrentSongId(null);
    }
  };

  const startRenamePlaylist = (playlistId: string, currentName: string) => {
    setRenamingPlaylistId(playlistId);
    setRenameInput(currentName);
  };

  const confirmRenamePlaylist = () => {
    if (!renamingPlaylistId || !renameInput.trim()) {
      setRenamingPlaylistId(null);
      return;
    }
    setPlaylists((current) =>
      current.map((p) => (p.id === renamingPlaylistId ? { ...p, name: renameInput.trim() } : p))
    );
    setRenamingPlaylistId(null);
  };

  const cancelRenamePlaylist = () => {
    setRenamingPlaylistId(null);
  };

  const confirmPendingDelete = () => {
    if (!pendingDelete) return;

    if (pendingDelete.type === 'song') {
      deleteSongFromPlaylist(pendingDelete.playlistId, pendingDelete.songId);
    } else {
      deletePlaylist(pendingDelete.playlistId);
    }

    setPendingDelete(null);
  };

  const activePlaylist = playlists.find((playlist) => playlist.id === activePlaylistId) || playlists[0];

  const playFromQueueRef = useRef(playFromQueue);
  playFromQueueRef.current = playFromQueue;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        engine.init();
        engine.togglePlay();
        return;
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        engine.init();
        playFromQueueRef.current(-1);
        return;
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        engine.init();
        playFromQueueRef.current(1);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  const formatTime = (time: number) => {
     if(!Number.isFinite(time)) return "0:00";
     const min = Math.floor(time / 60);
     const sec = Math.floor(time % 60);
     return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  // Drag and drop global listeners
  useEffect(() => {
    const handleDragOverGlobal = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    };
    const handleDragLeaveGlobal = (e: DragEvent) => {
      e.preventDefault();
      if (e.clientX === 0 || e.clientY === 0) {
        setIsDragging(false);
      }
    };
    const handleDropGlobal = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      processFiles(e.dataTransfer?.files || null);
    };

    window.addEventListener('dragover', handleDragOverGlobal);
    window.addEventListener('dragleave', handleDragLeaveGlobal);
    window.addEventListener('drop', handleDropGlobal);

    return () => {
      window.removeEventListener('dragover', handleDragOverGlobal);
      window.removeEventListener('dragleave', handleDragLeaveGlobal);
      window.removeEventListener('drop', handleDropGlobal);
    };
  }, []);

 
  const t = themes[theme] || themes['nocturnal'];
  const accentHex = `#${t.uRippleColor.getHexString()}`;
  const hasSeekableDuration = Number.isFinite(duration) && duration > 0;
  const progressValue = hasSeekableDuration ? Math.min(currentTime, duration) : 0;
  const progressPercent = hasSeekableDuration ? Math.min(100, Math.max(0, (progressValue / duration) * 100)) : 0;

  return (
    <div 
      className="absolute inset-0 pointer-events-none z-10 flex w-full h-full" 
      style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif", color: '#94a3b8' }}
    >
      {isDragging && (
        <div 
          className="absolute inset-0 z-[60] backdrop-blur-lg border-2 border-dashed m-4 rounded-xl flex items-center justify-center font-mono text-2xl tracking-widest pointer-events-none"
          style={{ backgroundColor: `${accentHex}1a`, borderColor: accentHex, color: accentHex }}
        >
          拖放音频文件开始播放
        </div>
      )}
      
      {/* Sidebar Left */}
      <div
        className={`absolute left-0 top-0 h-full z-[60] transition-all pointer-events-auto ${sidebarPinned ? 'w-[60px]' : 'w-[20px] group hover:w-[60px]'}`}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
      >
        <aside className={`absolute left-0 top-0 w-[60px] h-full border-r border-white/[0.04] flex flex-col items-center py-6 pointer-events-auto transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${sidebarPinned ? 'translate-x-0' : '-translate-x-full group-hover:translate-x-0'}`} style={{ background: 'rgba(8,14,26,0.18)', backdropFilter: 'blur(80px) saturate(180%)', WebkitBackdropFilter: 'blur(80px) saturate(180%)', boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.05), 4px 0 30px rgba(0,0,0,0.3)' }}>
          <button className="uppercase tracking-[0.2em] text-[10px] mb-12 opacity-100 transition-opacity cursor-pointer" style={{ writingMode: 'vertical-rl', color: accentHex }}>可视化</button>
          <button onClick={() => setActivePanel(activePanel === 'freq' ? null : 'freq')} className={`uppercase tracking-[0.2em] text-[10px] mb-12 transition-opacity cursor-pointer flex items-center justify-center gap-2 ${activePanel === 'freq' ? 'opacity-100 scale-100' : 'opacity-40 hover:opacity-100'}`} style={{ writingMode: 'vertical-rl' }}>
            触发器
          </button>
          <button onClick={() => setActivePanel(activePanel === 'search' ? null : 'search')} className={`uppercase tracking-[0.2em] text-[10px] mb-12 transition-opacity cursor-pointer flex items-center justify-center gap-2 ${activePanel === 'search' ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`} style={{ writingMode: 'vertical-rl' }}>
            搜索
          </button>
          <button onClick={() => setActivePanel(activePanel === 'playlist' ? null : 'playlist')} className={`uppercase tracking-[0.2em] text-[10px] mb-12 transition-opacity cursor-pointer flex items-center justify-center gap-2 ${activePanel === 'playlist' ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`} style={{ writingMode: 'vertical-rl' }}>
            歌单
          </button>
          
          <button onClick={() => setActivePanel(activePanel === 'queue' ? null : 'queue')} className={`uppercase tracking-[0.2em] text-[10px] mb-12 transition-opacity cursor-pointer flex items-center justify-center gap-2 ${activePanel === 'queue' ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`} style={{ writingMode: 'vertical-rl' }}>
            队列
          </button>
          <button onClick={() => setActivePanel(activePanel === 'settings' ? null : 'settings')} className={`uppercase tracking-[0.2em] text-[10px] mb-12 transition-opacity cursor-pointer flex items-center justify-center gap-2 ${activePanel === 'settings' ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`} style={{ writingMode: 'vertical-rl' }}>
            设置
          </button>
          <div className="mt-auto flex flex-col items-center gap-10">
            <button 
              onClick={loadDemo}
              className="uppercase tracking-[0.2em] text-[10px] opacity-40 hover:opacity-100 transition-opacity cursor-pointer font-bold"
              style={{ writingMode: 'vertical-rl' }}
            >
              示例
            </button>

            <button 
              onClick={() => {
                if (engine.isCapturing) {
                  engine.stopCapture();
                  setTrackName('未选择曲目');
                } else {
                  engine.startCapture().then(() => {
                      if (engine.isCapturing) setTrackName('系统音频捕获');
                  });
                }
              }}
              className={`uppercase tracking-[0.2em] text-[10px] transition-opacity cursor-pointer ${isCapturing ? 'opacity-100 text-[#ef4444]' : 'opacity-40 hover:opacity-100'}`}
              style={{ writingMode: 'vertical-rl' }}
            >
              {isCapturing ? '停止' : '捕获'}
            </button>
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            accept="audio/*,.lrc" 
            multiple
            className="hidden" 
            onChange={handleFileChange}
          />
        </aside>
      </div>

      {/* Sidebar Toggle + Brand */}
      {/* Hamburger button — always visible */}
      <div className={`absolute top-[40px] transition-all duration-300 ${sidebarExpanded ? 'left-[76px]' : 'left-[16px]'} ${activePanel ? 'opacity-0 pointer-events-none' : 'z-[70]'}`}>
        <button
          onClick={() => setSidebarPinned(!sidebarPinned)}
          className="h-9 w-9 rounded-lg border border-white/[0.08] bg-white/[0.02] text-white/45 hover:text-white hover:border-white/20 hover:bg-white/[0.04] transition-all flex items-center justify-center pointer-events-auto"
          title={sidebarPinned ? '收起侧栏' : '固定侧栏'}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <rect x="2" y="3" width="11" height="1.5" rx="0.5" fill="currentColor"/>
            <rect x="2" y="6.75" width="11" height="1.5" rx="0.5" fill="currentColor"/>
            <rect x="2" y="10.5" width="11" height="1.5" rx="0.5" fill="currentColor"/>
          </svg>
        </button>
      </div>

      {/* Brand text — fades out when panel is open */}
      <div className={`absolute top-[40px] z-30 select-none pointer-events-none transition-all duration-300 ${sidebarExpanded ? 'left-[124px]' : 'left-[68px]'} ${activePanel ? 'opacity-0' : 'opacity-100'}`}>
        <div className="font-black text-[22px] tracking-[0] text-white">
          ALEX-W.
        </div>
      </div>

      <button
        onClick={toggleFullscreen}
        className="absolute top-[40px] right-[40px] z-[70] h-9 w-9 rounded-sm border border-white/[0.06] bg-black/20 text-white/45 hover:text-white hover:bg-white/[0.04] pointer-events-auto flex items-center justify-center transition-colors"
        title={isFullscreen ? '退出全屏' : '进入全屏'}
      >
        {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>



      {/* Player Panel */}
      <AnimatePresence mode="wait">
        {activePanel === 'search' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.2, ease: 'easeIn' } }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="absolute top-[40px] left-[100px] w-[360px] max-h-[70vh] z-50 pointer-events-auto backdrop-blur-3xl border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl shadow-black/30"
            style={{ background: 'rgba(8,14,26,0.22)', backdropFilter: 'blur(80px) saturate(180%)', WebkitBackdropFilter: 'blur(80px) saturate(180%)', boxShadow: '0 8px 40px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)' }}
          >
          <div className="p-5 border-b border-white/[0.06]">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[12px] uppercase tracking-[0.2em] text-white/70">网易云搜索</div>
              <button onClick={() => setActivePanel(null)} className="text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">关闭</button>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                searchNetease();
              }}
            >
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="歌曲或歌手"
                className="min-w-0 flex-1 bg-white/5 border border-white/[0.06] rounded-sm px-3 py-2 text-[12px] text-white outline-none focus:border-white/30"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-black rounded-sm disabled:opacity-50"
                style={{ backgroundColor: accentHex }}
              >
                搜索
              </button>
            </form>
            <button
              type="button"
              onClick={loadDailyRecommendations}
              disabled={isSearching}
              className="mt-3 w-full rounded-lg border border-white/[0.08] px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-white/55 hover:border-white/20 hover:text-white disabled:opacity-50"
            >
              每日推荐
            </button>
            {searchStatus ? (
              <div className="mt-3 flex items-center gap-2">
                <div className="text-[11px] text-white/45">{searchStatus}</div>
                {searchStatus.includes('失败') && (
                  <button
                    onClick={() => {
                      if (searchStatus.includes('每日推荐')) loadDailyRecommendations();
                      else if (searchStatus.includes('导入')) fetchUserPlaylists();
                      else searchNetease();
                    }}
                    className="text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 rounded border border-white/[0.1] text-white/50 hover:text-white hover:border-white/25 transition-all"
                  >
                    重试
                  </button>
                )}
              </div>
            ) : null}
            {/* Search History */}
            {searchHistory.length > 0 && !searchStatus && searchResults.length === 0 && (
              <div className="mt-3 pt-3 border-t border-white/[0.06]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-[0.15em] text-white/35 flex items-center gap-1"><Clock size={10} /> 搜索历史</span>
                  <button onClick={clearSearchHistory} className="text-[10px] text-white/25 hover:text-white/50 transition-colors">清除</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {searchHistory.slice(0, 8).map((kw) => (
                    <button
                      key={kw}
                      onClick={() => { setSearchQuery(kw); searchNeteaseWithQuery(kw); }}
                      className="px-2.5 py-1 text-[10px] text-white/45 hover:text-white border border-white/[0.06] hover:border-white/15 rounded-full transition-colors truncate max-w-[160px]"
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Netease Playlist Import */}
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-[0.15em] text-white/40">导入歌单</span>
                {userPlaylists.length > 0 && (
                  <button
                    onClick={() => { setUserPlaylists([]); setPlaylistImportStatus(''); setImportProgress({ current: 0, total: 0 }); }}
                    className="text-[10px] text-white/30 hover:text-white/60 transition-colors"
                  >
                    收起
                  </button>
                )}
              </div>
              <button
                onClick={fetchUserPlaylists}
                disabled={isFetchingPlaylists || !neteaseUID.trim()}
                className="w-full py-2 text-[10px] uppercase tracking-[0.1em] text-black rounded-lg disabled:opacity-50 transition-all"
                style={{ backgroundColor: accentHex }}
              >
                {isFetchingPlaylists ? '获取中...' : '获取我的歌单'}
              </button>
              {playlistImportStatus && (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] text-white/45">{playlistImportStatus}</div>
                    {playlistImportStatus.includes('失败') && (
                      <button
                        onClick={fetchUserPlaylists}
                        className="text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 rounded border border-white/[0.1] text-white/50 hover:text-white hover:border-white/25 transition-all"
                      >
                        重试
                      </button>
                    )}
                  </div>
                  {importProgress.total > 0 ? (
                    <div className="mt-1.5 w-full h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all duration-500 ease-out"
                        style={{ 
                          width: `${Math.min(100, Math.round((importProgress.current / Math.max(importProgress.total, 1)) * 100))}%`,
                          backgroundColor: importProgress.current >= importProgress.total ? '#22c55e' : accentHex,
                        }}
                      />
                    </div>
                  ) : importingPlaylistId ? (
                    <div className="mt-1.5 w-full h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
                      <div className="h-full w-1/2 rounded-full animate-pulse" style={{ backgroundColor: accentHex }} />
                    </div>
                  ) : null}
                </div>
              )}
              {userPlaylists.length > 0 && (
                <div className="mt-2 max-h-[180px] overflow-y-auto space-y-1">
                  {userPlaylists.map((pl) => (
                    <div key={pl.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors border border-white/[0.04]">
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-white/75 truncate">{pl.name}</div>
                        <div className="text-[10px] text-white/35">{pl.trackCount} 首</div>
                      </div>
                      <button
                        onClick={() => importNeteasePlaylist(pl.id, pl.name)}
                        disabled={importingPlaylistId === pl.id}
                        className="ml-2 px-3 py-1.5 text-[10px] rounded-lg border border-white/[0.08] text-white/55 hover:text-white hover:border-white/20 disabled:opacity-50 whitespace-nowrap transition-colors"
                      >
                        {importingPlaylistId === pl.id ? '导入中' : '导入'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
          <div className="max-h-[48vh] overflow-y-auto">
            {searchResults.map((song) => (
              <button
                key={song.id}
                disabled={song.playable === false}
                onClick={() => loadNeteaseSong(song, searchResults)}
                className={`relative w-full text-left px-5 py-3 border-b border-white/[0.04] transition-colors disabled:cursor-not-allowed ${
                  song.playable === false ? 'opacity-35 grayscale' : 'hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className={`text-[13px] truncate flex-1 min-w-0 ${currentSongId === song.id ? 'text-white' : 'text-white/80'}`}>{song.name}</div>
                  {song.playable === false ? (
                    <span className="shrink-0 rounded border border-white/[0.06] px-1.5 py-0.5 text-[9px] tracking-[0.08em] text-white/45">
                      不可播
                    </span>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSongToAdd(song);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setSongToAdd(song);
                          }
                        }}
                        className="h-6 w-6 rounded border border-white/[0.08] text-white/45 hover:text-black hover:border-transparent transition-colors flex items-center justify-center"
                        title="添加到歌单"
                      >
                        <Plus size={11} />
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          queueNextSong(song);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            queueNextSong(song);
                          }
                        }}
                        className="h-6 w-6 rounded border border-white/[0.08] text-white/45 hover:text-black hover:border-transparent transition-colors flex items-center justify-center"
                        title="下一首播放"
                      >
                        <SkipForward size={10} />
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-white/45 truncate">{song.artist || '未知歌手'} · {song.album || '未知专辑'}</div>
              </button>
            ))}
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {activePanel === 'queue' && (
        <motion.div
          key="queue-panel"
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16, transition: { duration: 0.18 } }}
          transition={{ type: 'spring', stiffness: 280, damping: 24 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="absolute top-[40px] left-[100px] w-[380px] max-h-[78vh] z-50 pointer-events-auto backdrop-blur-3xl border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl shadow-black/30"
          style={{ background: 'rgba(8,14,26,0.22)', backdropFilter: 'blur(80px) saturate(180%)', WebkitBackdropFilter: 'blur(80px) saturate(180%)', boxShadow: '0 8px 40px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)' }}
        >
          <div className="p-6 border-b border-white/[0.06] flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-white/45 mb-1">播放队列</div>
              <div className="text-[11px] text-white/35">{getCurrentQueue().length} 首</div>
            </div>
            <button
              onClick={() => { setPlayQueue([]); setCurrentSongId(null); }}
              className="text-[10px] text-white/25 hover:text-red-400/60 transition-colors"
            >
              清空
            </button>
          </div>
          <div className="max-h-[55vh] overflow-y-auto">
            {getCurrentQueue().length === 0 ? (
              <div className="p-6 text-[12px] text-white/25 text-center">队列为空</div>
            ) : (
              getCurrentQueue().map((song, idx) => {
                const isCurrent = song.id === currentSongId;
                return (
                  <div
                    key={`${song.id}-${idx}`}
                    className={`flex items-center gap-3 px-5 py-3 border-b border-white/[0.03] transition-colors ${isCurrent ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'}`}
                  >
                    <div className="w-5 text-[10px] text-white/25 font-mono text-right shrink-0">
                      {isCurrent ? '▶' : idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-[12px] truncate ${isCurrent ? 'text-white' : 'text-white/65'}`}>
                        {song.name}
                      </div>
                      <div className="text-[10px] text-white/35 truncate">{song.artist}</div>
                    </div>
                    <button
                      onClick={() => {
                        setPlayQueue(q => q.filter((_, i) => i !== idx));
                        if (isCurrent) {
                          const nextSong = getCurrentQueue()[idx + 1];
                          if (nextSong) loadNeteaseSong(nextSong, getCurrentQueue().filter((_, i) => i !== idx));
                        }
                      }}
                      className="text-white/20 hover:text-red-400/60 transition-colors shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      )}

      {songToAdd && (
        <div className="absolute top-[120px] left-[480px] w-[280px] z-[70] pointer-events-auto backdrop-blur-2xl border border-white/[0.06] rounded-xl overflow-hidden" style={{ background: 'rgba(8,14,26,0.22)', backdropFilter: 'blur(80px) saturate(180%)', WebkitBackdropFilter: 'blur(80px) saturate(180%)', boxShadow: '0 8px 40px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
          <div className="p-5 border-b border-white/[0.06]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/45 mb-2">添加到歌单</div>
                <div className="text-[13px] text-white truncate" title={songToAdd.name}>{songToAdd.name}</div>
              </div>
              <button onClick={() => setSongToAdd(null)} className="text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">关闭</button>
            </div>
          </div>
          <div className="p-3 border-b border-white/[0.06]">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                onClick={() => addSongToPlaylist(playlist.id, songToAdd)}
                className="w-full flex items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/[0.04] rounded-sm transition-colors"
              >
                <span className="min-w-0 text-[12px] text-white truncate">{playlist.name}</span>
                <span className="text-[10px] text-white/35">{playlist.songs.length}</span>
              </button>
            ))}
          </div>
          <form
            className="p-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              createPlaylistAndAddSong();
            }}
          >
            <input
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="新建歌单"
              className="min-w-0 flex-1 bg-white/5 border border-white/[0.06] rounded-sm px-3 py-2 text-[12px] text-white outline-none focus:border-white/30"
            />
            <button
              type="submit"
              className="h-9 w-9 flex-shrink-0 rounded-sm text-black flex items-center justify-center disabled:opacity-50"
              style={{ backgroundColor: accentHex }}
              disabled={!newPlaylistName.trim()}
              title="创建歌单"
            >
              <Plus size={15} />
            </button>
          </form>
        </div>
      )}

      {/* Settings Panel — Netease Cloud Hub */}
      <AnimatePresence mode="wait">
        {activePanel === 'settings' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.2, ease: 'easeIn' } }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="absolute top-[40px] left-[100px] w-[300px] max-h-[78vh] z-50 pointer-events-auto backdrop-blur-3xl border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl shadow-black/30"
            style={{ background: 'rgba(8,14,26,0.22)', backdropFilter: 'blur(80px) saturate(180%)', WebkitBackdropFilter: 'blur(80px) saturate(180%)', boxShadow: '0 8px 40px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)' }}
          >
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[12px] uppercase tracking-[0.2em] text-white/70 flex items-center gap-2">
                <Settings size={14} /> 设置
              </div>
              <button onClick={() => setActivePanel(null)} className="text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">关闭</button>
            </div>
            <div className="text-[11px] text-white/40 leading-relaxed space-y-3">
              <p>Cookie 在源文件中修改：</p>
              <p className="bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 font-mono text-white/35 text-[10px] break-all">
                ~/Library/Application Support/sonic-topography/.env.local
              </p>
              <p className="text-white/25">格式：NETEASE_COOKIE=MUSIC_U=xxx; __csrf=xxx; NMTID=xxx</p>
              <p className="text-white/25">修改后重启 App。</p>
            </div>
            <div className="mt-5 pt-4 border-t border-white/[0.04] text-[10px] text-white/25">
              Sonic Topography · ALEX-W. &copy; 2026
            </div>
          </div>
          </motion.div>

        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {activePanel === 'playlist' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.2, ease: 'easeIn' } }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="absolute top-[40px] left-[100px] w-[420px] max-h-[74vh] z-[65] pointer-events-auto backdrop-blur-3xl border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl shadow-black/30"
            style={{ background: 'rgba(8,14,26,0.22)', backdropFilter: 'blur(80px) saturate(180%)', WebkitBackdropFilter: 'blur(80px) saturate(180%)', boxShadow: '0 8px 40px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)' }}
          >
          <div className="p-5 border-b border-white/[0.06]">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3 text-[12px] uppercase tracking-[0.2em] text-white/70">
                <ListMusic size={15} />
                歌单
              </div>
              <button onClick={() => setActivePanel(null)} className="text-[10px] uppercase tracking-[0.15em] text-white/40 hover:text-white">关闭</button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => playlistFileInputRef.current?.click()}
                className="flex-1 py-2 text-[10px] uppercase tracking-[0.15em] text-white/55 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-lg transition-all"
              >
                导入本地音乐
              </button>
              <input
                type="file"
                ref={playlistFileInputRef}
                accept="audio/*"
                multiple
                className="hidden"
                onChange={handlePlaylistFileUpload}
              />
              <button
                onClick={exportPlaylistsJSON}
                className="py-2 px-3 text-[10px] uppercase tracking-[0.15em] text-white/45 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-lg transition-all"
                title="导出歌单为 JSON 文件"
              >
                导出
              </button>
              <button
                onClick={() => playlistJSONInputRef.current?.click()}
                className="py-2 px-3 text-[10px] uppercase tracking-[0.15em] text-white/45 hover:text-white border border-white/[0.08] hover:border-white/20 rounded-lg transition-all"
                title="从 JSON 文件导入歌单"
              >
                导入
              </button>
              <input
                type="file"
                ref={playlistJSONInputRef}
                accept=".json"
                className="hidden"
                onChange={handleImportPlaylistsJSON}
              />
            </div>
            <div className="flex items-center gap-3 mt-3">
              <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
              {playlists.map((playlist) => (
                renamingPlaylistId === playlist.id ? (
                  <div key={playlist.id} className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-sm border border-white/20" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <input
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') confirmRenamePlaylist(); if (e.key === 'Escape') cancelRenamePlaylist(); }}
                      className="w-[80px] bg-transparent border-none outline-none text-[10px] text-white placeholder-white/30"
                      autoFocus
                    />
                    <button onClick={confirmRenamePlaylist} className="text-white/60 hover:text-white"><Check size={11} /></button>
                    <button onClick={cancelRenamePlaylist} className="text-white/60 hover:text-white"><X size={11} /></button>
                  </div>
                ) : (
                <button
                  key={playlist.id}
                  onClick={() => setActivePlaylistId(playlist.id)}
                  onDoubleClick={() => startRenamePlaylist(playlist.id, playlist.name)}
                  className={`flex-shrink-0 px-3 py-2 rounded-sm border text-[10px] uppercase tracking-[0.12em] transition-colors group ${activePlaylist?.id === playlist.id ? 'text-black border-transparent' : 'text-white/45 border-white/[0.06] hover:text-white'}`}
                  style={{ backgroundColor: activePlaylist?.id === playlist.id ? accentHex : 'transparent' }}
                  title="双击重命名"
                >
                  {playlist.name}
                  <span className="ml-1.5 opacity-0 group-hover:opacity-40 transition-opacity"><Pencil size={9} /></span>
                </button>
              )))}
              </div>
              <button
                onClick={() => activePlaylist && setPendingDelete({ type: 'playlist', playlistId: activePlaylist.id, label: activePlaylist.name })}
                disabled={!activePlaylist || playlists.length <= 1}
                className="h-8 w-8 flex-shrink-0 rounded-sm border border-white/[0.06] text-white/45 hover:text-[#ef4444] disabled:opacity-20 disabled:hover:text-white/45 flex items-center justify-center"
                title="删除歌单"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="max-h-[52vh] overflow-y-auto">
            {activePlaylist && activePlaylist.songs.length > 0 ? activePlaylist.songs.map((song) => (
              <button
                key={song.id}
                onClick={() => loadNeteaseSong(song, activePlaylist.songs)}
                className="relative w-full text-left px-5 py-3 border-b border-white/[0.04] hover:bg-white/[0.04] transition-colors"
              >
                <div className="text-[13px] text-white truncate">{song.name}</div>
                <div className="mt-1 text-[11px] text-white/45 truncate">{song.artist || '未知歌手'} - {song.album || '未知专辑'}</div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete({ type: 'song', playlistId: activePlaylist.id, songId: song.id, label: song.name });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setPendingDelete({ type: 'song', playlistId: activePlaylist.id, songId: song.id, label: song.name });
                    }
                  }}
                  className="absolute right-5 top-1/2 -translate-y-1/2 h-8 w-8 rounded-sm border border-white/[0.06] text-white/45 hover:text-[#ef4444] transition-colors flex items-center justify-center"
                  title="从歌单移除"
                >
                  <Trash2 size={14} />
                </span>
              </button>
            )) : (
              <div className="px-5 py-8 text-[12px] text-white/40">这个歌单还没有歌曲</div>
            )}
          </div>
          </motion.div>
        )}
      </AnimatePresence>

      {pendingDelete && (
        <div className="absolute inset-0 z-[120] pointer-events-auto flex items-center justify-center bg-black/50 backdrop-blur-xl">
          <div className="w-[320px] border border-white/[0.06] rounded-sm p-5" style={{ background: 'rgba(8,14,26,0.22)', backdropFilter: 'blur(80px) saturate(180%)', WebkitBackdropFilter: 'blur(80px) saturate(180%)', boxShadow: '0 8px 40px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
            <div className="text-[12px] uppercase tracking-[0.2em] text-white/70 mb-3">
              确认删除
            </div>
            <div className="text-[13px] text-white/80 leading-relaxed mb-5">
              确定删除{pendingDelete.type === 'playlist' ? '歌单' : '歌曲'} <span className="text-white">{pendingDelete.label}</span> 吗？
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-3 py-2 rounded-sm border border-white/[0.06] text-[10px] uppercase tracking-[0.15em] text-white/45 hover:text-white"
              >
                取消
              </button>
              <button
                onClick={confirmPendingDelete}
                className="px-3 py-2 rounded-sm border border-[#ef4444]/40 text-[10px] uppercase tracking-[0.15em] text-[#ef4444] hover:bg-[#ef4444] hover:text-black"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Player Panel */}
      {trackName !== '未选择曲目' && (
        <div className="absolute top-[88px] right-[40px] w-[340px] p-6 rounded-sm z-50 pointer-events-auto backdrop-blur-2xl border border-white/[0.06]" style={{ background: 'rgba(8,14,26,0.22)', backdropFilter: 'blur(80px) saturate(180%)', WebkitBackdropFilter: 'blur(80px) saturate(180%)', boxShadow: '0 8px 40px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
          <div className="flex justify-between items-start mb-1">
            <div className="text-[18px] font-light tracking-[0.05em] text-white truncate" title={trackName}>
              {trackName}
            </div>
            <button 
              onClick={() => {
                const keys = Object.keys(themes);
                const nextIndex = (keys.indexOf(theme) + 1) % keys.length;
                onThemeChange(keys[nextIndex]);
              }}
              className="text-white/40 hover:text-white transition-colors"
              title="切换主题"
            >
              <Palette size={16} />
            </button>
          </div>
          <div className="text-[12px] opacity-50 uppercase mb-6 tracking-wider">
             {isCapturing ? '系统音频捕获' : '本地音频'}
             <span className="ml-2 text-[#3b82f6] text-[10px]">&bull; {themes[theme]?.name}</span>
          </div>

          {/* Progress bar */}
          <div className={`mb-5 ${isCapturing ? 'opacity-30 pointer-events-none' : ''}`}>
            <input
              type="range"
              min={0}
              max={hasSeekableDuration ? duration : 0}
              step="0.01"
              value={progressValue}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              onInput={(e) => seekTo(parseFloat(e.currentTarget.value))}
              disabled={!hasSeekableDuration}
              aria-label="拖动歌曲进度"
              className="player-progress-range block h-4 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                '--player-accent': accentHex,
                '--player-progress': `${progressPercent}%`,
              } as React.CSSProperties}
            />
          </div>

          <div className={`flex justify-between items-center text-[10px] uppercase tracking-[0.1em] opacity-80 ${isCapturing ? 'opacity-30 pointer-events-none' : ''}`}>
             <span className="w-8">{formatTime(currentTime)}</span>
             <div className="flex items-center gap-3">
                <button
                  onClick={() => playFromQueue(-1)}
                  className="hover:text-white transition-colors disabled:opacity-25 disabled:hover:text-inherit"
                  disabled={getCurrentQueue().length === 0}
                  title="上一首"
                >
                  <SkipBack size={14} />
                </button>
                <button onClick={togglePlay} className="hover:text-white transition-colors">
                  {isPlaying ? <Pause size={14} className="fill-current" /> : <Play size={14} className="fill-current" />}
                </button>
                <button
                  onClick={() => playFromQueue(1)}
                  className="hover:text-white transition-colors disabled:opacity-25 disabled:hover:text-inherit"
                  disabled={getCurrentQueue().length === 0}
                  title="下一首"
                >
                  <SkipForward size={14} />
                </button>
                <button
                  onClick={() => setPlayMode((mode) => mode === 'sequence' ? 'shuffle' : 'sequence')}
                  className={`hover:text-white transition-all ${playMode === 'shuffle' ? 'scale-110' : ''}`}
                  title={playMode === 'sequence' ? '顺序播放' : '随机播放'}
                  aria-label={playMode === 'shuffle' ? '关闭随机播放' : '开启随机播放'}
                  aria-pressed={playMode === 'shuffle'}
                  style={playMode === 'shuffle' ? { color: accentHex, filter: `drop-shadow(0 0 4px ${accentHex}80)` } : undefined}
                >
                  <Shuffle size={14} />
                </button>
                <button
                  onClick={() => setIsSingleLoop((value) => !value)}
                  className={`hover:text-white transition-all ${isSingleLoop ? 'scale-110' : ''}`}
                  title={isSingleLoop ? '单曲循环已开启' : '单曲循环'}
                  aria-label={isSingleLoop ? '关闭单曲循环' : '开启单曲循环'}
                  aria-pressed={isSingleLoop}
                  style={isSingleLoop ? { color: accentHex, filter: `drop-shadow(0 0 4px ${accentHex}80)` } : undefined}
                >
                  <Repeat1 size={14} />
                </button>
             </div>
             {(playMode !== 'sequence' || isSingleLoop) && (
               <div className="flex items-center gap-2 mt-0.5">
                 {playMode === 'shuffle' && <span className="text-[9px] uppercase tracking-[0.12em] text-white/50 flex items-center gap-1"><span className="w-1 h-1 rounded-full" style={{ backgroundColor: accentHex }} /> 随机</span>}
                 {isSingleLoop && <span className="text-[9px] uppercase tracking-[0.12em] text-white/50 flex items-center gap-1"><span className="w-1 h-1 rounded-full" style={{ backgroundColor: accentHex }} /> 单曲循环</span>}
               </div>
             )}
             
             <div className="flex items-center gap-2 w-24">
                <input 
                  type="range"
                  min={0} max={1} step={0.01}
                  value={volume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    engine.audioElement.volume = val;
                    setVolume(val);
                    try { localStorage.setItem('sonic-volume', String(val)); } catch {}
                  }}
                  className="w-14 h-1 accent-current cursor-pointer bg-white/15 appearance-none rounded-full"
                  style={{ accentColor: accentHex }}
                />
                <Volume2 
                  size={13} 
                  className="opacity-50 hover:opacity-100 transition-opacity cursor-pointer flex-shrink-0" 
                  onClick={() => {
                    const val = volume > 0 ? 0 : 1;
                    engine.audioElement.volume = val;
                    setVolume(val);
                    try { localStorage.setItem('sonic-volume', String(val)); } catch {}
                  }} 
                />
             </div>
             <span className="w-8 text-right">{formatTime(duration)}</span>
          </div>
        </div>
      )}

      {/* Lyrics Display */}
      {trackName !== '未选择曲目' && lyricsText && (
        <LyricsDisplay lrcText={lyricsText} currentTime={currentTime} accentHex={accentHex} isPlaying={isPlaying} />
      )}

      {/* Stats Panel & Lyrics Status */}
      {trackName !== '未选择曲目' && (
        <div className="absolute bottom-[40px] left-[100px] z-50 pointer-events-none flex flex-col gap-6">
          {!lyricsText && (
             <div 
                className="text-[10px] text-white/40 uppercase tracking-[0.2em] flex items-center gap-2 pointer-events-auto cursor-pointer hover:text-white/80 transition-colors w-fit"
                onClick={() => fileInputRef.current?.click()}
                title="上传 .lrc 歌词文件"
             >
                <div className="w-1.5 h-1.5 rounded-full bg-red-500/50"></div>
                暂无歌词 · 点击上传 .lrc
             </div>
          )}
          <StatsPanel accentHex={accentHex} />
        </div>
      )}

      <div className="absolute bottom-[40px] right-[40px] text-[10px] uppercase tracking-[0.1em] opacity-30 select-none">
        拖拽旋转视角 · 点击产生波纹
      </div>
      {/* Frequency Trigger Panel */}
      <AnimatePresence>
        {activePanel === 'freq' && (
          <FreqTriggerPanelWrapper onClose={() => setActivePanel(null)} accentHex={accentHex} />
        )}
      </AnimatePresence>
    </div>
  );
}

import { TriggerPreset } from '../../lib/AudioEngine';

function FreqTriggerPanelWrapper({ onClose, accentHex }: { onClose: () => void, accentHex: string }) {
  const [action, setAction] = useState<'Pulse' | 'Meteor'>('Meteor');
  return (
    <FreqTriggerPanel key={action} action={action} setAction={setAction} onClose={onClose} accentHex={accentHex} />
  );
}

function FreqTriggerPanel({ action, setAction, onClose, accentHex }: { action: 'Pulse' | 'Meteor', setAction: (a: 'Pulse' | 'Meteor') => void, onClose: () => void, accentHex: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const getConfig = () => action === 'Pulse' ? engine.pulseTrigger : engine.meteorTrigger;
  
  const [triggerPoint, setTriggerPoint] = useState({ 
    x: getConfig().freqIndex >= 0 ? getConfig().freqIndex / 512 : 0.5, 
    y: getConfig().threshold 
  });
  const [isEnabled, setIsEnabled] = useState(getConfig().enabled);
  const [mode, setMode] = useState<TriggerPreset>(getConfig().mode);
  const [sensitivity, setSensitivity] = useState(getConfig().sensitivity);
  const [cooldown, setCooldown] = useState(getConfig().cooldown);
  const [pulseStrength, setPulseStrength] = useState(getConfig().pulseStrength);
  const [bandStart, setBandStart] = useState(getConfig().bandStart);
  const [bandEnd, setBandEnd] = useState(getConfig().bandEnd);
  const isDragging = useRef(false);

  // Sync state TO engine when parameters change
  useEffect(() => {
     const c = getConfig();
     c.enabled = isEnabled;
     c.mode = mode;
     c.sensitivity = sensitivity;
     c.cooldown = cooldown;
     c.pulseStrength = pulseStrength;
     c.bandStart = bandStart;
     c.bandEnd = bandEnd;
     
     if (mode === 'Advanced') {
         c.freqIndex = Math.floor(triggerPoint.x * 512);
         c.threshold = triggerPoint.y;
     } else {
         c.freqIndex = -1;
     }
  }, [isEnabled, mode, sensitivity, cooldown, pulseStrength, bandStart, bandEnd, triggerPoint]);

  const handleModeChange = (newMode: TriggerPreset) => {
    setMode(newMode);
  };

  const presets: TriggerPreset[] = ['Auto Beat', 'Advanced'];
  const actionLabel = action === 'Pulse' ? '波纹' : '流星';
  const modeLabel = mode === 'Advanced' ? '高级' : '自动节拍';

  useEffect(() => {
    let animationId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;
      
      ctx.clearRect(0, 0, width, height);
      
      // Draw grid
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      for(let i=1; i<10; i++) {
         ctx.moveTo(0, height * i / 10);
         ctx.lineTo(width, height * i / 10);
         ctx.moveTo(width * i / 10, 0);
         ctx.lineTo(width * i / 10, height);
      }
      ctx.stroke();

      const data = engine.getRawFrequencyData();
      const binCount = data.length || 512;

      // Draw highlighted band
      const [startBin, endBin] = getConfig().getTriggerRange();
      const startX = (startBin / binCount) * width;
      const endX = (endBin / binCount) * width;
      
      ctx.fillStyle = mode === 'Advanced' ? 'rgba(255,255,255,0.02)' : `${accentHex}20`;
      ctx.fillRect(startX, 0, Math.max(1, endX - startX), height);
      
      if (mode !== 'Advanced') {
         ctx.strokeStyle = accentHex + '80';
         ctx.lineWidth = 1;
         ctx.beginPath();
         ctx.moveTo(endX, 0);
         ctx.lineTo(endX, height);
         ctx.stroke();
      }

      // Draw spectrum
      ctx.fillStyle = accentHex + '40'; // opacity
      ctx.beginPath();
      ctx.moveTo(0, height);
      
      for(let i = 0; i < binCount; i++) {
         const x = (i / binCount) * width;
         const val = data[i] / 255.0;
         const y = height - (val * height);
         ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      if (mode === 'Advanced') {
          // Draw drag point
          const tx = triggerPoint.x * width;
          const ty = height - (triggerPoint.y * height);
          
          ctx.beginPath();
          ctx.moveTo(tx, 0);
          ctx.lineTo(tx, height);
          ctx.moveTo(0, ty);
          ctx.lineTo(width, ty);
          ctx.strokeStyle = accentHex;
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(tx, ty, 6, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
      } else {
          // Draw dynamic threshold line
          const evE = getConfig().lastEvalEnergy;
          const evThresh = getConfig().lastEvalThresh;
          
          const eY = height - (evE * height);
          const tY = height - (evThresh * height);
          
          ctx.beginPath();
          ctx.setLineDash([5, 5]);
          ctx.moveTo(0, tY);
          ctx.lineTo(width, tY);
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Current energy dot
          const cx = (startX + endX) / 2;
          ctx.beginPath();
          ctx.arc(cx, eY, 6, 0, Math.PI * 2);
          ctx.fillStyle = evE > evThresh ? accentHex : 'rgba(255,255,255,0.5)';
          ctx.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(animationId);
  }, [accentHex, triggerPoint, mode]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (mode !== 'Advanced') return;
    isDragging.current = true;
    updateTriggerFromEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current || mode !== 'Advanced') return;
    updateTriggerFromEvent(e);
  };

  const handlePointerUp = () => {
    isDragging.current = false;
  };

  const updateTriggerFromEvent = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    
    setTriggerPoint({ x, y });
    const config = action === 'Meteor' ? engine.meteorTrigger : engine.pulseTrigger;
    config.freqIndex = Math.floor(x * 512); // assuming binCount max 512
    config.threshold = y;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="absolute inset-0 z-[100] backdrop-blur-md bg-black/50 flex flex-col items-center justify-center pointer-events-auto">
      <div className="w-[80vw] max-w-[800px] border border-white/[0.06] rounded-2xl p-8 shadow-2xl" style={{ background: 'rgba(10,15,28,0.45)', backdropFilter: 'blur(48px) saturate(220%)', WebkitBackdropFilter: 'blur(48px) saturate(220%)' }}>
          <div className="flex justify-between items-center mb-6">
             <div className="flex items-center gap-6">
               <h2 className="text-xl font-light tracking-widest text-white">频率触发器</h2>
               <div className="flex items-center gap-3">
                 <label className="flex items-center gap-2 cursor-pointer">
                   <input 
                     type="checkbox" 
                     checked={isEnabled} 
                     onChange={(e) => setIsEnabled(e.target.checked)}
                     className="w-4 h-4 rounded-sm border-white/20 bg-black/50"
                     style={{ accentColor: accentHex }}
                   />
                   <span className="text-[10px] uppercase tracking-widest text-white/50">启用</span>
                 </label>
                 
                 {isEnabled && (
                   <div className="flex items-center rounded overflow-hidden border border-white/[0.06] text-[10px] uppercase tracking-widest">
                     <button 
                       onClick={() => setAction('Pulse')}
                       className={`px-3 py-1 transition-colors ${action === 'Pulse' ? 'text-black' : 'text-white/50 hover:bg-white/[0.04]'}`}
                       style={{ backgroundColor: action === 'Pulse' ? accentHex : 'transparent' }}
                     >
                       波纹
                     </button>
                     <button 
                       onClick={() => setAction('Meteor')}
                       className={`px-3 py-1 transition-colors ${action === 'Meteor' ? 'text-black' : 'text-white/50 hover:bg-white/[0.04]'}`}
                       style={{ backgroundColor: action === 'Meteor' ? accentHex : 'transparent' }}
                     >
                       流星
                     </button>
                   </div>
                 )}
               </div>
             </div>
             <button onClick={onClose} className="text-white/50 hover:text-white uppercase tracking-widest text-[10px]">关闭</button>
          </div>
          
          <div className="flex gap-2 mb-4">
            {presets.map(p => (
               <button
                  key={p}
                  onClick={() => handleModeChange(p)}
                  className={`px-3 py-1.5 text-[10px] uppercase tracking-widest rounded-sm border transition-colors ${
                     mode === p ? 'bg-white/10 text-white border-white/20' : 'border-transparent text-white/40 hover:text-white hover:bg-white/[0.04]'
                  }`}
               >
                  {p === 'Advanced' ? '高级' : '自动节拍'}
               </button>
            ))}
          </div>

          <p className="text-[11px] text-white/40 mb-6 font-mono h-10 leading-relaxed">
            {mode === 'Advanced'
              ? "拖动十字准星设置目标频率（X）和触发阈值（Y）。\n当频谱超过阈值时，会触发视觉效果。"
              : `已启用${modeLabel}检测。当前频段的瞬时能量明显高于滚动平均值时，会触发${actionLabel}效果。`}
          </p>
          <div className={`relative w-full aspect-[2/1] bg-black/50 border border-white/[0.04] rounded overflow-hidden ${mode === 'Advanced' ? 'cursor-crosshair' : ''}`}>
            <canvas 
              ref={canvasRef}
              width={800} 
              height={400} 
              className="w-full h-full block"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          </div>

          {mode === 'Auto Beat' && (
            <div className="mt-8 grid grid-cols-2 gap-6">
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>灵敏度</span>
                    <span style={{ color: accentHex }}>{sensitivity.toFixed(2)}</span>
                 </div>
                 <input type="range" min="0" max="1" step="0.05" value={sensitivity} onChange={e => setSensitivity(parseFloat(e.target.value))} className="w-full accent-current h-1" style={{ accentColor: accentHex }}/>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>冷却时间（帧）</span>
                    <span style={{ color: accentHex }}>{cooldown}</span>
                 </div>
                 <input type="range" min="0" max="300" step="1" value={cooldown} onChange={e => setCooldown(parseInt(e.target.value))} className="w-full accent-current h-1" style={{ accentColor: accentHex }}/>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>频段（{bandStart} - {bandEnd}）</span>
                 </div>
                 <div className="flex gap-2">
                   <input type="range" min="0" max="250" step="1" value={bandStart} onChange={e => setBandStart(Math.min(parseInt(e.target.value), bandEnd - 1))} className="w-1/2 accent-current h-1" style={{ accentColor: accentHex }}/>
                   <input type="range" min="2" max="256" step="1" value={bandEnd} onChange={e => setBandEnd(Math.max(parseInt(e.target.value), bandStart + 1))} className="w-1/2 accent-current h-1" style={{ accentColor: accentHex }}/>
                 </div>
               </div>
               <div className="flex flex-col gap-2">
                 <div className="flex justify-between uppercase tracking-widest text-[10px] text-white/50">
                    <span>波纹强度</span>
                    <span style={{ color: accentHex }}>{pulseStrength.toFixed(2)}</span>
                 </div>
                 <input type="range" min="0" max="5" step="0.1" value={pulseStrength} onChange={e => setPulseStrength(parseFloat(e.target.value))} className="w-full accent-current h-1" style={{ accentColor: accentHex }}/>
               </div>
            </div>
          )}
       </div>
    </motion.div>
  );
}

function StatsPanel({ accentHex }: { accentHex: string }) {
  const [data, setData] = useState({ bass: 0, mid: 0, treble: 0, energy: 0 });

  useEffect(() => {
    let animationFrameId: number;
    const poll = () => {
      setData(engine.getAudioData());
      animationFrameId = requestAnimationFrame(poll);
    };
    poll();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <div className="flex gap-10">
      <StatBox label="低频" value={data.bass} accentHex={accentHex} />
      <StatBox label="中频" value={data.mid} accentHex={accentHex} />
      <StatBox label="高频" value={data.treble} accentHex={accentHex} />
      <StatBox label="能量" value={data.energy} accentHex={accentHex} />
    </div>
  );
}

function StatBox({ label, value, accentHex }: { label: string, value: number, accentHex: string }) {
  const displayValue = (value * 100).toFixed(1);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[9px] uppercase tracking-[0.15em] opacity-40">{label}</div>
      <div className="font-mono text-[14px]" style={{ color: accentHex }}>{displayValue}</div>
      <div className="w-[100px] h-[2px] relative bg-white/10">
        <div 
          className="absolute h-full transition-all duration-75"
          style={{ backgroundColor: accentHex, width: `${Math.min(100, value * 100)}%`, boxShadow: `0 0 8px ${accentHex}88` }} 
        />
      </div>
    </div>
  );
}
