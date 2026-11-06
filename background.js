import { readState, transact } from './shared/store.js';
import { keyOf, recordsFromMetadata, applyProgress, normalizeSettings, validateBackup, resumeTarget, videoUrl, isComplete, cleanText, cleanupCandidates } from './shared/model.js';
import { parseLink, resolveLink, LinkError } from './shared/links.js';
import { fetchVideo, ApiError, retryDelay } from './shared/api.js';
import { needsCleanupWarning } from './shared/limits.js';
import { DEFAULT_GROUP_ID, defaultVideoName, requireGroup, expandGroupPath, createGroup, editGroup, deleteGroup, restoreGroup, editVideo, mergeGroups } from './shared/library.js';

const ALARM = 'focus-maintenance';
const DAY = 86400000;
async function badge() {
  const state = await readState();
  const count = Object.values(state.videos).filter(v => !isComplete(v, state.settings)).length;
  let oversized = false;
  if (chrome.storage.local.getBytesInUse) {
    try { oversized = needsCleanupWarning(await chrome.storage.local.getBytesInUse(null)); } catch { /* Keep the regular badge if the size query fails. */ }
  }
  await chrome.action.setBadgeBackgroundColor({ color: oversized ? '#b45309' : '#0f766e' });
  await chrome.action.setBadgeText({ text: oversized ? '!' : count ? String(Math.min(count, 999)) : '' });
  if (chrome.action.setTitle) await chrome.action.setTitle({ title: oversized ? '数据已超过1GB，请手动清理' : '重点关注' });
}
async function initialize() {
  if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  await badge();
}
chrome.runtime.onInstalled.addListener(() => { initialize().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { initialize().catch(console.error); });
// Alarms may be removed on restart. Recreate them on every worker activation.
initialize().catch(console.error);

export async function addVideo(text, entire = false, options = {}) {
  const parsed = parseLink(text);
  const before = await readState();
  const pending = before.pending[parsed.url];
  const groupId = requireGroup(before, options.groupId ?? pending?.groupId);
  const displayName = cleanText(options.displayName ?? pending?.displayName, 200).trim();
  if (pending?.nextRetryAt > Date.now()) throw new Error(`${pending.error}；将在退避期后重试`);
  let link;
  try { link = await resolveLink(text); }
  catch (error) {
    if (!parsed.short || error instanceof LinkError) throw error;
    await transact(state => {
      const old = state.pending[parsed.url]; const attempts = (old?.attempts || 0) + 1;
      state.pending[parsed.url] = { url: parsed.url, entire, groupId: state.groups[groupId] ? groupId : DEFAULT_GROUP_ID, displayName, addedAt: old?.addedAt || Date.now(), error: '短链暂时无法解析，已保留链接', attempts, nextRetryAt: Date.now() + retryDelay(attempts - 1) };
    });
    return { pending: true, message: '短链暂时无法解析，已保留链接，稍后重试。' };
  }
  let metadata;
  try {
    if (options.previewFailure) throw new ApiError(Number(options.previewFailure.code) || 0, cleanText(options.previewFailure.message));
    const supplied = options.metadata;
    if (supplied) {
      if ((link.bvid && supplied.bvid !== link.bvid) || (link.aid && supplied.aid !== link.aid) || !Array.isArray(supplied.pages) || !supplied.pages.length || supplied.pages.some(p => !p || !Number.isSafeInteger(p.cid) || p.cid <= 0 || !Number.isSafeInteger(p.page) || p.page <= 0)) throw Error('视频预览信息已失效，请重新读取');
      metadata = supplied;
    } else metadata = await fetchVideo(link);
  }
  catch (error) {
    if (!(error instanceof ApiError)) throw error;
    await transact(state => {
      const old = state.pending[link.url];
      const attempts = (old?.attempts || 0) + 1;
      state.pending[link.url] = { url: link.url, entire, groupId: state.groups[groupId] ? groupId : DEFAULT_GROUP_ID, displayName, addedAt: old?.addedAt || Date.now(), error: error.message, attempts, nextRetryAt: Date.now() + (error.retryable ? retryDelay(attempts - 1) : DAY) };
      if (parsed.url !== link.url) delete state.pending[parsed.url];
    });
    return { pending: true, message: `${error.message}。已保留链接，稍后补全信息。` };
  }
  const records = recordsFromMetadata(metadata, link.page, entire);
  const selected = recordsFromMetadata(metadata, link.page, false)[0];
  const custom = displayName && displayName !== defaultVideoName(selected);
  return transact(state => {
    requireGroup(state, groupId);
    let count = 0;
    for (const record of records) if (!state.videos[keyOf(record)]) {
      record.groupId = groupId;
      const suffix = entire && records.length > 1 ? ` · P${record.page}` : '';
      record.displayName = custom ? `${displayName.slice(0, 200 - suffix.length)}${suffix}` : '';
      state.videos[keyOf(record)] = record; count++;
    }
    expandGroupPath(state, state.videos[keyOf(selected)]?.groupId || groupId);
    delete state.pending[link.url];
    delete state.pending[parsed.url];
    return { count, keys: records.map(keyOf), message: count ? `已添加 ${count} 个分P` : '已在重点关注清单中' };
  });
}
async function refreshGroup(bvid, manual = false) {
  const state = await readState();
  const old = Object.values(state.videos).find(v => v.bvid === bvid);
  if (!old) return;
  if (old.nextRetryAt > Date.now()) { if (manual) throw new Error('正在退避等待，请稍后重试'); return; }
  let records, failure;
  try { records = recordsFromMetadata(await fetchVideo({ bvid }), 1, true); }
  catch (e) { failure = e; }
  await transact(current => {
    for (const v of Object.values(current.videos).filter(v => v.bvid === bvid)) {
      if (failure) {
        v.refreshError = failure.message;
        v.invalid = failure.code === -404 || v.invalid;
        v.refreshAttempts = (v.refreshAttempts || 0) + 1;
        v.nextRetryAt = Date.now() + (failure.code === -404 ? DAY : retryDelay(v.refreshAttempts - 1));
      } else {
        const fresh = records.find(r => r.cid === v.cid);
        if (!fresh) { v.invalid = true; v.refreshError = '该分P已不存在'; v.nextRetryAt = Date.now() + DAY; continue; }
        for (const field of ['aid', 'page', 'totalPages', 'partTitle', 'url', 'title', 'cover', 'duration', 'ownerName', 'metaUpdatedAt']) v[field] = fresh[field];
        v.invalid = false; delete v.refreshError; delete v.refreshAttempts; delete v.nextRetryAt;
        v.coverRepairAttempted = true;
      }
    }
  });
  if (failure && manual) throw failure;
}
export async function maintenance() {
  const state = await readState();
  const now = Date.now();
  for (const p of Object.values(state.pending).filter(p => p.nextRetryAt <= now).slice(0, 2)) {
    try { await addVideo(p.url, p.entire); } catch (e) {
      await transact(s => { if (s.pending[p.url]) { s.pending[p.url].error = e.message; s.pending[p.url].nextRetryAt = now + DAY; } });
    }
  }
  const due = Object.values(state.videos).filter(v => v.nextRetryAt ? v.nextRetryAt <= now : v.metaUpdatedAt < now - DAY || (!v.cover && !v.coverRepairAttempted)).sort((a, b) => a.metaUpdatedAt - b.metaUpdatedAt);
  for (const bvid of [...new Set(due.map(v => v.bvid))].slice(0, 2)) await refreshGroup(bvid);
  await transact(s => {
    let changed = false;
    for (const [id, t] of Object.entries(s.trash)) if (t.expiresAt < now) { delete s.trash[id]; changed = true; }
    return { changed };
  });
  await badge();
}
function moveCleanupToTrash(state, batch, now) {
  if (!batch.count) return { count: 0, message: '没有符合条件的旧数据' };
  const id = crypto.randomUUID();
  state.trash[id] = { kind: 'batch', items: batch.items, count: batch.count, automatic: false, expiresAt: now + 8000 };
  for (const item of batch.items) delete state[item.kind][item.key];
  return { count: batch.count, undoId: id, message: `已清理 ${batch.count} 条旧记录` };
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) maintenance().catch(console.error); });

function contentMayAccess(sender, v) {
  if (!sender.tab || sender.frameId !== 0 || !v) return false;
  try { const link = parseLink(sender.url); return link.page === v.page && (link.bvid === v.bvid || link.aid === v.aid); } catch { return false; }
}
export async function handleMessage(m, sender = {}) {
  const trusted = sender.url?.startsWith(chrome.runtime.getURL(''));
  const allowedContent = ['ADD', 'PROGRESS', 'BOOKMARK_ADD'];
  if (!trusted && !allowedContent.includes(m.type)) throw new Error('该操作只能在扩展弹窗中进行');
  if (m.type === 'ADD') {
    if (!trusted) { const actual = parseLink(sender.url); if (!sender.tab || sender.frameId !== 0 || parseLink(m.url).url !== actual.url) throw new Error('仅可添加当前视频'); }
    const result = await addVideo(m.url, m.entire === true, trusted ? { groupId: m.groupId, displayName: m.displayName, metadata: m.preview?.metadata, previewFailure: m.previewFailure } : {}); await badge(); return result;
  }
  if (m.type === 'PREVIEW') {
    const parsed = parseLink(m.url);
    let link;
    try { link = await resolveLink(m.url); }
    catch (error) {
      if (!parsed.short || error instanceof LinkError) throw error;
      return { url: parsed.url, failure: { code: 0, message: '短链暂时无法解析，已保留链接' }, defaultName: '' };
    }
    try {
      const metadata = await fetchVideo(link), record = recordsFromMetadata(metadata, link.page, false)[0];
      return { url: link.url, metadata, record, defaultName: defaultVideoName(record) };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { url: link.url, failure: { code: error.code, message: error.message }, defaultName: '' };
    }
  }
  if (m.type === 'GROUP_CREATE') return transact(s => createGroup(s, m));
  if (m.type === 'GROUP_EDIT') return transact(s => editGroup(s, m));
  if (m.type === 'GROUP_DELETE') return transact(s => deleteGroup(s, m.id));
  if (m.type === 'VIDEO_EDIT') return transact(s => editVideo(s, m.key, m));
  if (m.type === 'LIBRARY_UI') return transact(s => {
    if (!Array.isArray(m.collapsedGroupIds)) throw Error('分组展开状态无效');
    s.libraryUI.collapsedGroupIds = [...new Set(m.collapsedGroupIds.filter(id => Object.hasOwn(s.groups, id)))];
  });
  if (m.type === 'PROGRESS') return transact(s => {
    if (!contentMayAccess(sender, s.videos[m.key])) return { changed: false };
    return { changed: applyProgress(s, m.key, m.sample || {}) };
  }).then(async result => { if (result.changed) await badge(); return result; });
  if (m.type === 'SETTINGS') return transact(s => {
    const next = normalizeSettings({ ...s.settings, ...m.settings });
    if (next.completionPercent !== s.settings.completionPercent || next.completionRemainingSec !== s.settings.completionRemainingSec) {
      for (const v of Object.values(s.videos)) v.completed = v.duration > 0 && (v.positionSec >= v.duration - next.completionRemainingSec || v.positionSec / v.duration >= next.completionPercent / 100);
    }
    s.settings = next;
  }).then(async result => { if ('completionPercent' in (m.settings || {}) || 'completionRemainingSec' in (m.settings || {})) await badge(); return result; });
  if (m.type === 'CLEANUP') {
    const result = await transact(s => moveCleanupToTrash(s, cleanupCandidates(s, m.options || {}), Date.now()));
    await badge(); return result;
  }
  if (m.type === 'DELETE' || m.type === 'DELETE_PENDING') return transact(s => {
    const collection = m.type === 'DELETE' ? s.videos : s.pending;
    if (!collection[m.key]) return { changed: false };
    const id = crypto.randomUUID();
    s.trash[id] = { key: m.key, kind: m.type === 'DELETE' ? 'videos' : 'pending', value: collection[m.key], expiresAt: Date.now() + 8000 };
    delete collection[m.key]; return { undoId: id };
  }).then(async r => { await badge(); return r; });
  if (m.type === 'UNDO') return transact(s => {
    const t = s.trash[m.id];
    if (!t || t.expiresAt < Date.now()) throw new Error('撤销时间已过');
    if (t.kind === 'group') restoreGroup(s, t);
    else if (t.kind === 'batch') {
      for (const item of t.items) if (!s[item.kind][item.key]) s[item.kind][item.key] = { ...item.value, groupId: s.groups[item.value.groupId] ? item.value.groupId : DEFAULT_GROUP_ID };
    } else if (!s[t.kind][t.key]) s[t.kind][t.key] = { ...t.value, groupId: s.groups[t.value.groupId] ? t.value.groupId : DEFAULT_GROUP_ID };
    delete s.trash[m.id];
  }).then(async r => { await badge(); return r; });
  if (m.type === 'BOOKMARK_ADD' || m.type === 'BOOKMARK_EDIT' || m.type === 'BOOKMARK_DELETE') return transact(s => {
    const v = s.videos[m.key];
    if (!v) throw new Error('该分P已不在清单中');
    if (!trusted && !contentMayAccess(sender, v)) throw new Error('当前页面与分P不匹配');
    if (m.type === 'BOOKMARK_ADD') {
      if (!Number.isFinite(m.sec) || m.sec < 0 || m.sec > (v.duration || 604800) + 2) throw new Error('书签时间无效');
      if (v.bookmarks.length >= 1000) throw new Error('该分P书签已达 1000 个上限');
      v.bookmarks.push({ id: crypto.randomUUID(), sec: Math.min(m.sec, v.duration || m.sec), note: cleanText(m.note), createdAt: Date.now() });
    } else if (m.type === 'BOOKMARK_DELETE') v.bookmarks = v.bookmarks.filter(b => b.id !== m.id);
    else { const b = v.bookmarks.find(b => b.id === m.id); if (!b) throw new Error('书签已不存在'); b.note = cleanText(m.note); }
  });
  if (m.type === 'RETRY') return addVideo(m.url, m.entire === true).then(async r => { await badge(); return r; });
  if (m.type === 'REFRESH') return refreshGroup(m.bvid, true);
  if (m.type === 'IMPORT') {
    const imported = validateBackup(m.data);
    const result = await transact(s => {
      const wasEmpty = !Object.keys(s.videos).length && Object.keys(s.groups).length === 1;
      const { mapping } = mergeGroups(s, imported);
      if (Object.keys(s.groups).length > 10000) throw Error('合并后分组数量超过上限');
      if (wasEmpty) s.libraryUI.collapsedGroupIds = imported.libraryUI.collapsedGroupIds.map(id => mapping.get(id)).filter(Boolean);
      let count = 0;
      for (const [key, v] of Object.entries(imported.videos)) {
        const old = s.videos[key];
        if (!old) { s.videos[key] = { ...v, groupId: mapping.get(v.groupId) || DEFAULT_GROUP_ID }; count++; continue; }
        const merged = new Map(old.bookmarks.map(b => [b.id, b]));
        for (const b of v.bookmarks) if (!merged.has(b.id)) merged.set(b.id, b);
        if (merged.size > 1000) throw new Error('合并后书签超过上限，未导入任何数据');
        if (v.lastWatchedAt > old.lastWatchedAt) Object.assign(old, { positionSec: v.positionSec, lastWatchedAt: v.lastWatchedAt, completed: v.completed });
        old.maxPositionSec = Math.max(old.maxPositionSec, v.maxPositionSec);
        old.bookmarks = [...merged.values()];
      }
      for (const [key, p] of Object.entries(imported.pending)) if (!s.pending[key]) s.pending[key] = { ...p, groupId: mapping.get(p.groupId) || DEFAULT_GROUP_ID };
      return { message: `备份已合并，新增 ${count} 个分P；保留当前设置` };
    });
    await badge(); return result;
  }
  if (m.type === 'OPEN') {
    const s = await readState(), v = s.videos[m.key];
    if (!v) throw new Error('该分P已被删除');
    const target = m.mode === 'resume' ? resumeTarget(v, s.settings).url : videoUrl(v, m.mode === 'bookmark' ? v.bookmarks.find(b => b.id === m.id)?.sec ?? v.positionSec : v.positionSec);
    if (s.settings.openInNewTab) return chrome.tabs.create({ url: target });
    const tabs = await chrome.tabs.query({ url: 'https://www.bilibili.com/video/*' });
    const existing = tabs.find(t => { try { const link = parseLink(t.url); return link.bvid === v.bvid || link.aid === v.aid; } catch { return false; } });
    if (existing) { await chrome.tabs.update(existing.id, { url: target, active: true }); await chrome.windows.update(existing.windowId, { focused: true }); }
    else await chrome.tabs.create({ url: target });
    return {};
  }
  throw new Error('暂不支持该操作');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handleMessage(message || {}, sender).then(result => respond({ ok: true, result })).catch(error => respond({ ok: false, error: error.message }));
  return true;
});
