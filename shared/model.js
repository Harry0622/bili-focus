import { DEFAULT_ACCENT, normalizeAccentColor } from './appearance.js';
import { defaultLibrary, normalizeLibraryState, normalizeGroups, DEFAULT_GROUP_ID } from './library.js';

export const STATE_KEY = 'focusState';
export const DEFAULT_SETTINGS = Object.freeze({ sampleIntervalSec: 5, openInNewTab: true, addEntireCollectionDefault: false, completionPercent: 95, completionRemainingSec: 30, theme: 'system', accentColor: DEFAULT_ACCENT, autoCleanup: false, cleanupAfterDays: 30, cleanupKeepBookmarked: true });
export const emptyState = () => ({ schemaVersion: 1, videos: {}, pending: {}, trash: {}, settings: { ...DEFAULT_SETTINGS }, ...defaultLibrary() });
export const keyOf = v => `${v.bvid}:${v.cid}`;
export const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
export const cleanText = (v, max = 300) => typeof v === 'string' ? v.slice(0, max) : '';
export function formatTime(sec = 0) {
  const n = Math.floor(Math.max(0, Number(sec) || 0));
  return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
export function isComplete(v, settings = DEFAULT_SETTINGS) {
  return !!v.completed || (v.duration > 0 && (v.positionSec >= v.duration - settings.completionRemainingSec || v.positionSec / v.duration >= settings.completionPercent / 100));
}
export function videoUrl(v, sec = null, page = v.page) {
  const url = new URL(`https://www.bilibili.com/video/${v.bvid}`);
  url.searchParams.set('p', String(page));
  if (sec !== null) url.searchParams.set('t', String(Math.floor(Math.max(0, sec))));
  return url.href;
}
export function resumeTarget(v, settings) {
  if (!isComplete(v, settings)) return { url: videoUrl(v, v.positionSec), label: `继续观看 ${formatTime(v.positionSec)}` };
  if (v.page < (v.totalPages || v.page)) return { url: videoUrl(v, null, v.page + 1), label: `播放下一P · P${v.page + 1}` };
  return { url: videoUrl(v), label: '从头观看', lastPage: (v.totalPages || 1) > 1 };
}
export function validCover(value) {
  try {
    const u = new URL(value?.startsWith('//') ? `https:${value}` : value);
    if (!['https:', 'http:'].includes(u.protocol) || !/(^|\.)hdslb\.com$/i.test(u.hostname) || u.port || u.username || u.password) return '';
    u.protocol = 'https:';
    return u.href;
  } catch { return ''; }
}
export function normalizeSettings(raw = {}) {
  return { sampleIntervalSec: clamp(raw.sampleIntervalSec ?? 5, 5, 60), openInNewTab: raw.openInNewTab !== false, addEntireCollectionDefault: raw.addEntireCollectionDefault === true, completionPercent: clamp(raw.completionPercent ?? 95, 50, 100), completionRemainingSec: clamp(raw.completionRemainingSec ?? 30, 0, 120), theme: ['system', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'system', accentColor: normalizeAccentColor(raw.accentColor), autoCleanup: false, cleanupAfterDays: Math.round(clamp(raw.cleanupAfterDays ?? 30, 7, 365)), cleanupKeepBookmarked: raw.cleanupKeepBookmarked !== false };
}
export function coverThumbnail(value) {
  const original = validCover(value);
  if (!original) return '';
  const url = new URL(original);
  if (url.pathname.startsWith('/bfs/') && !url.pathname.includes('@') && /\.(jpe?g|png|webp)$/i.test(url.pathname) && !url.search) url.pathname += '@160w.webp';
  return url.href;
}
export function estimateBytes(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
export function cleanupCandidates(state, options = {}, now = Date.now()) {
  const days = Math.round(clamp(options.days ?? state.settings.cleanupAfterDays, 7, 365));
  const cutoff = now - days * 86400000;
  const keepBookmarked = options.keepBookmarked ?? state.settings.cleanupKeepBookmarked;
  const items = [];
  for (const [key, v] of Object.entries(state.videos)) {
    if (Math.max(v.lastWatchedAt || 0, v.addedAt || 0) > cutoff) continue;
    if (keepBookmarked && v.bookmarks.length) continue;
    if (isComplete(v, state.settings) || (options.includeInvalid !== false && v.invalid)) items.push({ kind: 'videos', key, value: v });
  }
  if (options.includeInvalid !== false) for (const [key, p] of Object.entries(state.pending || {})) if (p.addedAt <= cutoff) items.push({ kind: 'pending', key, value: p });
  return { items, count: items.length, bytes: items.reduce((n, item) => n + estimateBytes(item.value), 0), days };
}
export function recordsFromMetadata(meta, page, entire, now = Date.now()) {
  if (!Array.isArray(meta.pages) || !/^BV[\da-zA-Z]{10}$/.test(meta.bvid)) throw new Error('视频信息不完整，请稍后重试');
  const selected = entire ? meta.pages : meta.pages.filter(p => p.page === page);
  if (!selected.length) throw new Error('该分P不存在，请检查链接中的 p 参数');
  return selected.map(p => ({ bvid: meta.bvid, aid: meta.aid, cid: p.cid, page: p.page, totalPages: meta.pages.length, partTitle: cleanText(p.part), url: videoUrl({ bvid: meta.bvid, page: p.page }), title: cleanText(meta.title), cover: validCover(meta.pic), duration: Math.max(0, Number(p.duration) || 0), ownerName: cleanText(meta.owner?.name), metaUpdatedAt: now, positionSec: 0, maxPositionSec: 0, completed: false, lastWatchedAt: 0, bookmarks: [], addedAt: now, note: '', pinned: false, invalid: false, groupId: DEFAULT_GROUP_ID, displayName: '' }));
}
export function applyProgress(state, key, sample) {
  const v = state.videos[key];
  if (!v) return false;
  const at = Number(sample.at), sec = Number(sample.sec);
  if (!Number.isFinite(at) || at <= v.lastWatchedAt || at > Date.now() + 60000 || !Number.isFinite(sec) || sec < 0) return false;
  const position = clamp(sec, 0, v.duration || 604800);
  if (Math.abs(v.positionSec - position) < 0.25 && !sample.ended) return false;
  v.positionSec = position;
  v.maxPositionSec = Math.max(v.maxPositionSec, position);
  v.lastWatchedAt = at;
  v.completed = !!sample.ended || (v.duration > 0 && (position >= v.duration - state.settings.completionRemainingSec || position / v.duration >= state.settings.completionPercent / 100));
  return true;
}
export function validateBackup(raw) {
  if (!raw || raw.schemaVersion !== 1 || !raw.videos || typeof raw.videos !== 'object' || Array.isArray(raw.videos)) throw new Error('备份格式不正确，或版本暂不支持');
  const entries = Object.entries(raw.videos);
  if (entries.length > 10000) throw new Error('备份条目过多（最多 10000 条）');
  const state = emptyState(); state.settings = normalizeSettings(raw.settings); state.groups = normalizeGroups(raw.groups);
  for (const [key, v] of entries) {
    if (!v || !/^BV[\da-zA-Z]{10}$/.test(v.bvid) || !Number.isSafeInteger(v.cid) || v.cid <= 0 || !Number.isSafeInteger(v.page) || v.page <= 0 || key !== keyOf(v) || !Array.isArray(v.bookmarks) || v.bookmarks.length > 1000) throw new Error('备份含无效的视频或书签，未导入任何数据');
    const duration = clamp(v.duration, 0, 604800);
    const seen = new Set();
    const bookmarks = v.bookmarks.map(b => {
      if (!b || typeof b.id !== 'string' || !b.id || b.id.length > 100 || seen.has(b.id) || !Number.isFinite(b.sec) || b.sec < 0) throw new Error('备份含无效或重复的书签');
      seen.add(b.id);
      return { id: b.id.slice(0, 100), sec: clamp(b.sec, 0, duration || 604800), note: cleanText(b.note), createdAt: clamp(b.createdAt, 0, Date.now()) };
    });
    state.videos[key] = { bvid: v.bvid, aid: Math.max(0, Number(v.aid) || 0), cid: v.cid, page: v.page, totalPages: Math.max(v.page, Math.floor(clamp(v.totalPages || v.page, 1, 10000))), partTitle: cleanText(v.partTitle), url: videoUrl(v), title: cleanText(v.title) || v.bvid, cover: validCover(v.cover), duration, ownerName: cleanText(v.ownerName), metaUpdatedAt: clamp(v.metaUpdatedAt, 0, Date.now()), positionSec: clamp(v.positionSec, 0, duration || 604800), maxPositionSec: clamp(v.maxPositionSec, 0, duration || 604800), completed: v.completed === true, lastWatchedAt: clamp(v.lastWatchedAt, 0, Date.now()), bookmarks, addedAt: clamp(v.addedAt, 0, Date.now()), note: cleanText(v.note), pinned: v.pinned === true, invalid: v.invalid === true };
    if (v.groupId && !Object.hasOwn(state.groups, v.groupId)) throw Error('视频引用了不存在的分组');
    Object.assign(state.videos[key], { groupId: v.groupId || DEFAULT_GROUP_ID, displayName: cleanText(v.displayName, 200).trim() });
  }
  if (raw.pending && typeof raw.pending === 'object') for (const p of Object.values(raw.pending).slice(0, 1000)) {
    // Only canonical UGC links are allowed back into the retry queue.
    try { const u = new URL(p.url); if (!(u.origin === 'https://b23.tv' && /^\/[\da-zA-Z]+\/?$/.test(u.pathname)) && (u.origin !== 'https://www.bilibili.com' || !/^\/video\/(BV[\da-zA-Z]{10}|av\d+)\/?$/.test(u.pathname))) continue;
      state.pending[u.href] = { url: u.href, entire: p.entire === true, addedAt: clamp(p.addedAt, 0, Date.now()), error: '等待重试', attempts: 0, nextRetryAt: 0, groupId: Object.hasOwn(state.groups, p.groupId) ? p.groupId : DEFAULT_GROUP_ID, displayName: cleanText(p.displayName, 200) };
    } catch { /* Ignore invalid pending links. */ }
  }
  state.libraryUI = raw.libraryUI;
  return normalizeLibraryState(state);
}
