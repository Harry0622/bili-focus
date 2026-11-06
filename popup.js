import { STATE_KEY, emptyState, normalizeSettings, formatTime, isComplete, resumeTarget, cleanupCandidates, estimateBytes, validCover, coverThumbnail } from './shared/model.js';
import { DEFAULT_ACCENT, normalizeAccentColor, appearancePalette } from './shared/appearance.js';
import { needsCleanupWarning } from './shared/limits.js';
import { DEFAULT_GROUP_ID, normalizeLibraryState, buildGroupIndex, descendantIds, defaultVideoName, videoName } from './shared/library.js';
import { ICONS } from './shared/icons.js';
import { mountLibraryView } from './shared/library-view.js';

const $ = selector => document.querySelector(selector);
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const placeholder = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>';
let state = emptyState(), selectedKey, pendingSelection, filter = 'all', searchQuery = '', loadError = false;
let toastTimer, undoId, dialogAction, disposed = false, bookmarkSignature = '', coverSignature;
let rarePromise, rareController, rareStylesPromise, lastToggle;
let actualStorageBytes, usageTimer;
let recordKey, groupAction, deleteGroupId, groupPickerSignature = '', currentDraft, linkDraft, currentReadToken = 0, linkReadToken = 0, searchFrame;
let rareToastPromise, rareToastController, toastSequence = 0;
const library = mountLibraryView({
  container: $('#list'), getState: () => state, getSelection: () => selectedKey, getFilter: () => filter, getQuery: () => searchQuery,
  complete: v => isComplete(v, state.settings), formatTime, cover: createCover, actionButton,
  selectVideo(key) { selectedKey = key; renderFocus(); library.updateSelection(); bookmarkSignature = ''; renderBookmarks(); },
  onEdit: recordDialog, onCreateGroup: parentId => groupDialog({ parentId }), onEditGroup: id => groupDialog({ id }), onDeleteGroup: confirmGroupDelete,
  onDelete: deleteVideo,
  async onRetry(key) { const p = state.pending[key]; if (p) { const r = await send('RETRY', { url: p.url, entire: p.entire }); toast(r.message); } },
  async onDeletePending(key) { const r = await send('DELETE_PENDING', { key }); toast('已移除待补全链接', r.undoId, 8000); },
  async onToggleGroup(id) {
    const ids = new Set(state.libraryUI.collapsedGroupIds); ids.has(id) ? ids.delete(id) : ids.add(id);
    try { await send('LIBRARY_UI', { collapsedGroupIds: [...ids] }); } catch (error) { toast(error.message, undefined, 4200, 'error'); }
  },
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function actionButton(text, label, action, className = 'icon-button') {
  const b = el('button', className, text);
  b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await action(); } catch (error) { toast(error.message, undefined, 4200, 'error'); } finally { b.disabled = false; }
  });
  return b;
}
async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || '操作失败，请重试');
  return response.result;
}
function toast(text, id, duration = 4200, type = 'success') {
  const sequence = ++toastSequence, expiresAt = Date.now() + duration;
  rareToastController?.dismiss();
  clearTimeout(toastTimer); undoId = id;
  $('#toast span').textContent = text; $('#toast').hidden = false; $('#undo').hidden = !id;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; undoId = undefined; rareToastController?.dismiss(); }, duration);
  const showRare = controller => controller.show(text, { duration: expiresAt - Date.now(), type, action: id ? { label: '撤销', onClick: () => { void undo(id); } } : undefined });
  if (rareToastController) { $('#toast').hidden = true; showRare(rareToastController); return; }
  // Show native feedback immediately; only then load the optional Rare UI stack.
  void loadRareToast().then(controller => {
    if (!controller || disposed || sequence !== toastSequence || Date.now() >= expiresAt || $('#toast').hidden) return;
    // A first-use Undo must not move between DOM buttons under the pointer.
    // Keep this native action stable; the loaded component serves later feedback.
    if (id) return;
    showRare(controller);
    $('#toast').hidden = true;
  });
}
function relative(at) {
  if (!at) return '尚未观看';
  const d = Math.max(0, Date.now() - at);
  return d < 60000 ? '刚刚' : d < 3600000 ? `${Math.floor(d / 60000)} 分钟前` : d < 86400000 ? `${Math.floor(d / 3600000)} 小时前` : `${Math.floor(d / 86400000)} 天前`;
}
function applyPalette(color, dark = document.documentElement.dataset.theme === 'dark') {
  for (const [key, value] of Object.entries(appearancePalette(color, dark))) document.documentElement.style.setProperty(key, value);
}
function applyTheme() {
  const dark = state.settings.theme === 'dark' || (state.settings.theme === 'system' && systemTheme.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  applyPalette(state.settings.accentColor, dark);
  const label = dark ? '切换到浅色' : '切换到深色';
  $('#theme-toggle').innerHTML = dark ? ICONS.sun : ICONS.moon;
  $('#theme-toggle').title = label; $('#theme-toggle').setAttribute('aria-label', label);
  rareController?.update(state.settings.theme, systemTheme.matches, state.settings.accentColor);
}
function currentVideo() { return state.videos[selectedKey]; }
function sortedVideos() {
  return Object.entries(state.videos).sort(([, a], [, b]) => Number(b.pinned) - Number(a.pinned) || b.lastWatchedAt - a.lastWatchedAt || b.addedAt - a.addedAt);
}
function filteredVideos(videos) {
  return videos.filter(([, v]) => filter === 'all' || (filter === 'completed' ? isComplete(v, state.settings) : !isComplete(v, state.settings)));
}
function renderFocus() {
  const v = currentVideo();
  const target = v ? resumeTarget(v, state.settings) : null;
  $('#focus').setAttribute('aria-busy', 'false');
  $('#resume-button').disabled = false;
  $('#focus-title').textContent = v ? videoName(v) : '还没有视频';
  $('#focus-title').title = v ? `${videoName(v)}\n${v.title}` : '';
  $('#focus-meta').textContent = v ? `${v.totalPages > 1 ? `P${v.page} · ` : ''}${v.ownerName || ''} · ${state.groups[v.groupId]?.name || '默认分组'}` : '';
  $('#focus-meta').title = v ? library.groupPath(v.groupId) : '';
  $('#focus-status').textContent = v ? isComplete(v, state.settings) ? '已看完' : v.lastWatchedAt ? '上次观看' : '未开始' : '';
  $('#focus-time').textContent = v ? `${formatTime(v.positionSec)} / ${formatTime(v.duration)}` : '';
  $('#focus-progress').style.width = v?.duration ? `${Math.min(100, v.positionSec / v.duration * 100)}%` : '0%';
  $('#resume-label').textContent = target?.label || '添加视频';
  $('#resume-button').setAttribute('aria-label', target?.label || '添加第一个视频');
  $('#focus-last').textContent = target?.lastPage ? '已是最后一P' : v ? relative(v.lastWatchedAt) : '';
  $('#replay').hidden = !v || !isComplete(v, state.settings);
  $('#focus-warning').hidden = !v?.invalid && !v?.refreshError;
  $('#focus-warning').textContent = v?.refreshError || '稿件暂时失效，已保留记录与书签';
  $('#bookmarks-toggle').disabled = !v;
  $('#bookmark-badge').textContent = v?.bookmarks.length || 0;
  const nextCover = v?.cover || '';
  if (coverSignature !== nextCover) {
    coverSignature = nextCover;
    $('#focus-cover').replaceChildren(createCover(nextCover, 'focus-thumbnail', 80, 48));
  }
}
function createCover(url, className, width, height) {
  const cover = el('span', `thumbnail ${className}`); cover.innerHTML = placeholder;
  cover.setAttribute('aria-hidden', 'true');
  const original = validCover(url), thumbnail = coverThumbnail(url);
  if (!thumbnail) { cover.title = '暂无封面'; return cover; }
  const img = el('img'); img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; img.decoding = 'async'; img.alt = ''; img.width = width; img.height = height;
  let retried = false;
  img.addEventListener('error', () => {
    if (!retried && thumbnail !== original) { retried = true; img.src = original; return; }
    img.remove(); cover.title = '封面暂不可用，可在书签面板刷新信息'; cover.dataset.coverState = 'error';
  });
  img.addEventListener('load', () => { cover.dataset.coverState = 'loaded'; }, { once: true });
  img.src = thumbnail; cover.append(img); return cover;
}
function renderBookmarks() {
  if ($('#bookmarks-panel').hidden) return;
  const v = currentVideo();
  if (!v) { closePanels(); return; }
  const signature = JSON.stringify([selectedKey, v.bookmarks, v.title, v.partTitle, v.displayName]);
  if (bookmarkSignature === signature) return;
  bookmarkSignature = signature;
  $('#bookmark-count').textContent = v.bookmarks.length;
  $('#bookmark-video').textContent = videoName(v);
  const fragment = document.createDocumentFragment();
  for (const b of [...v.bookmarks].sort((a, b) => a.sec - b.sec)) {
    const key = selectedKey, row = el('li', 'bookmark-row');
    const jump = actionButton('', `跳转 ${formatTime(b.sec)} ${b.note}`, () => send('OPEN', { key, mode: 'bookmark', id: b.id }), 'bookmark-jump');
    jump.append(el('time', '', formatTime(b.sec)), el('span', '', b.note || '未填写备注'));
    jump.title = `${b.note || '时间书签'} · ${new Date(b.createdAt).toLocaleString('zh-CN')}`;
    row.append(jump, actionButton('✎', '修改书签备注', () => noteDialog({ type: 'BOOKMARK_EDIT', key, id: b.id, sec: b.sec, note: b.note })), actionButton('×', '删除书签', () => send('BOOKMARK_DELETE', { key, id: b.id })));
    fragment.append(row);
  }
  if (!v.bookmarks.length) fragment.append(el('li', 'help', '暂无书签'));
  $('#bookmark-list').replaceChildren(fragment);
}
function render() {
  if (pendingSelection && state.videos[pendingSelection]) { selectedKey = pendingSelection; pendingSelection = undefined; }
  if (!state.videos[selectedKey]) selectedKey = sortedVideos()[0]?.[0];
  library.render(); renderFocus(); renderBookmarks();
  $('#count').textContent = Object.keys(state.videos).length + Object.keys(state.pending).length;
  refreshGroupPickers();
  if (!$('#settings').hidden) settingsUI();
}
function formatBytes(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1073741824 ? `${(bytes / 1048576).toFixed(2)} MB` : `${(bytes / 1073741824).toFixed(2)} GB`; }
async function refreshUsage() {
  try {
    if (!chrome.storage.local.getBytesInUse) return;
    const bytes = await chrome.storage.local.getBytesInUse(null);
    if (disposed) return;
    actualStorageBytes = bytes;
    $('#storage-warning').hidden = !needsCleanupWarning(bytes);
    if (!$('#settings').hidden) cleanupUI();
  } catch { /* Missing usage information must not block the list. */ }
}
function cleanupUI() {
  const quota = chrome.storage.local.QUOTA_BYTES || 10485760, used = actualStorageBytes ?? estimateBytes(state);
  $('#storage-usage').textContent = `约 ${formatBytes(used)}`;
  $('#storage-bar').style.width = `${Math.min(100, used / quota * 100)}%`;
  const marks = Object.values(state.videos).reduce((n, v) => n + v.bookmarks.length, 0);
  $('#storage-detail').textContent = `${Object.keys(state.videos).length} 个分P · ${marks} 个书签 · 上限约 ${formatBytes(quota)}${used / quota > .85 ? ' · 空间将满，建议先备份再清理' : ''}`;
  const days = $('#cleanup-days');
  if (![...days.options].some(o => o.value === String(state.settings.cleanupAfterDays))) days.add(new Option(`${state.settings.cleanupAfterDays} 天`, String(state.settings.cleanupAfterDays)));
  days.value = String(state.settings.cleanupAfterDays);
  $('#cleanup-keep').checked = state.settings.cleanupKeepBookmarked;
  const preview = cleanupCandidates(state);
  $('#cleanup-preview').textContent = preview.count ? `可清理 ${preview.count} 条，预计释放 ${formatBytes(preview.bytes)}` : '没有符合条件的旧记录';
  $('#cleanup-run').disabled = !preview.count;
  const recent = Object.entries(state.trash).filter(([, t]) => t.kind === 'batch' && t.expiresAt > Date.now()).sort(([, a], [, b]) => b.expiresAt - a.expiresAt)[0];
  $('#cleanup-undo').hidden = !recent; $('#cleanup-undo').dataset.id = recent?.[0] || '';
}
function settingsUI() {
  $('#accent-picker').value = state.settings.accentColor;
  if (document.activeElement !== $('#accent-hex')) $('#accent-hex').value = state.settings.accentColor.toUpperCase();
  for (const b of document.querySelectorAll('[data-accent-color]')) b.setAttribute('aria-pressed', String(b.dataset.accentColor === state.settings.accentColor));
  $('#new-tab').checked = state.settings.openInNewTab; $('#default-entire').checked = state.settings.addEntireCollectionDefault;
  for (const [selector, value, suffix] of [['#interval', state.settings.sampleIntervalSec, ' 秒'], ['#completion', state.settings.completionPercent, '%'], ['#remaining', state.settings.completionRemainingSec, ' 秒']]) {
    const s = $(selector); if (![...s.options].some(o => o.value === String(value))) s.add(new Option(`${value}${suffix}`, String(value)));
    s.value = String(value);
  }
  cleanupUI();
}
function syncPanelButtons(id) {
  for (const [button, panel] of [['settings-toggle', 'settings'], ['more-toggle', 'settings'], ['add-toggle', 'add-panel'], ['bookmarks-toggle', 'bookmarks-panel']]) $(`#${button}`).setAttribute('aria-expanded', String(panel === id));
}
function closePanels() { for (const panel of document.querySelectorAll('.drawer')) panel.hidden = true; $('main').inert = false; syncPanelButtons(); }
async function loadRareTheme() {
  if (rareController || rarePromise) return rarePromise;
  const host = $('#rare-theme-host'); host.dataset.rareState = 'loading'; $('#theme-error').hidden = true;
  performance.mark('rare-theme:request');
  rarePromise = (async () => {
    const [module] = await Promise.all([import('./assets/rare-theme.js'), loadRareStyles()]);
    if (disposed) return;
    rareController = await module.mountThemeSelector(host, state.settings.theme, systemTheme.matches, chooseTheme, state.settings.accentColor);
    if (disposed) { rareController.destroy(); return; }
    rareController.update(state.settings.theme, systemTheme.matches, state.settings.accentColor);
    host.dataset.rareState = 'ready';
    performance.mark('rare-theme:ready'); performance.measure('rare-theme:first-mount', 'rare-theme:request', 'rare-theme:ready');
  })().catch(() => {
    if (disposed) return;
    host.dataset.rareState = 'error'; $('#theme-error').hidden = false;
    rarePromise = undefined;
  });
  return rarePromise;
}
function loadRareStyles() {
  if (!rareStylesPromise) rareStylesPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'assets/rare-theme.css'; css.id = 'rare-ui-styles';
    css.onload = resolve; css.onerror = () => { css.remove(); rareStylesPromise = undefined; reject(Error('组件样式未载入')); }; document.head.append(css);
  });
  return rareStylesPromise;
}
async function loadRareToast() {
  if (!rareToastPromise) {
    performance.mark('rare-toast:request');
    rareToastPromise = Promise.all([import('./assets/rare-toast.js'), loadRareStyles()]).then(async ([module]) => {
      if (disposed) return;
      const controller = await module.mountRareToast();
      if (disposed) { controller.destroy(); return; }
      rareToastController = controller;
      performance.mark('rare-toast:ready'); performance.measure('rare-toast:first-mount', 'rare-toast:request', 'rare-toast:ready');
      return controller;
    }).catch(() => { rareToastPromise = undefined; });
  }
  return rareToastPromise;
}
function openPanel(id, toggle) {
  const opening = $(`#${id}`).hidden;
  closePanels();
  if (!opening) return;
  lastToggle = toggle || document.activeElement;
  $(`#${id}`).hidden = false; $('main').inert = true; syncPanelButtons(id);
  if (id === 'settings') { settingsUI(); void loadRareTheme(); }
  if (id === 'bookmarks-panel') { bookmarkSignature = ''; renderBookmarks(); }
  if (id === 'add-panel') {
    refreshGroupPickers(true); $('#current-group').value = DEFAULT_GROUP_ID; $('#link-group').value = DEFAULT_GROUP_ID;
    void prepareCurrentPage();
  }
}
async function chooseTheme(theme) { try { await send('SETTINGS', { settings: { theme } }); } catch (error) { toast(error.message, undefined, 4200, 'error'); } }
async function chooseAccent(value) {
  if (!/^#[\da-f]{6}$/i.test(value)) { $('#accent-hex').setCustomValidity('请输入 #RRGGBB 格式的颜色'); $('#accent-hex').reportValidity(); return; }
  $('#accent-hex').setCustomValidity('');
  const accentColor = normalizeAccentColor(value);
  try { await send('SETTINGS', { settings: { accentColor } }); }
  catch (error) { applyTheme(); settingsUI(); toast(error.message, undefined, 4200, 'error'); }
}
function noteDialog(action) {
  dialogAction = action; $('#note-title').textContent = action.type === 'BOOKMARK_EDIT' ? '修改书签备注' : '记录时间点';
  $('#note-time').textContent = formatTime(action.sec); $('#note-input').value = action.note; $('#note-error').hidden = true;
  $('#note-dialog').showModal(); $('#note-input').focus();
}
function fillGroupSelect(select, { root = false, exclude = new Set(), value = select.value || DEFAULT_GROUP_ID } = {}) {
  const fragment = document.createDocumentFragment();
  if (root) fragment.append(new Option('顶层分组', ''));
  for (const group of buildGroupIndex(state.groups).order) if (!exclude.has(group.id)) fragment.append(new Option(group.path, group.id));
  select.replaceChildren(fragment); select.value = value;
  if (select.selectedIndex < 0) select.value = root ? '' : DEFAULT_GROUP_ID;
}
function refreshGroupPickers(force = false) {
  if (!force && $('#add-panel').hidden && !$('#record-dialog').open && !$('#group-dialog').open) return;
  const signature = JSON.stringify(state.groups);
  if (!force && signature === groupPickerSignature) return;
  groupPickerSignature = signature;
  if (!$('#add-panel').hidden) for (const id of ['current-group', 'link-group']) fillGroupSelect($(`#${id}`));
  if ($('#record-dialog').open) fillGroupSelect($('#record-group'));
  if ($('#group-dialog').open) fillGroupSelect($('#group-parent'), { root: true, exclude: groupAction?.id ? descendantIds(state.groups, groupAction.id) : new Set(), value: $('#group-parent').value });
}
function recordDialog(key) {
  const v = state.videos[key]; if (!v) return;
  recordKey = key; $('#record-name').value = videoName(v); $('#record-name').placeholder = defaultVideoName(v);
  fillGroupSelect($('#record-group'), { value: v.groupId }); $('#record-error').hidden = true;
  $('#record-dialog').showModal(); $('#record-name').focus();
}
function groupDialog({ id, parentId = null, targetSelect } = {}) {
  const group = id ? state.groups[id] : null;
  if (id && !group) return;
  groupAction = { id, targetSelect };
  $('#group-dialog-title').textContent = id ? '编辑分组' : '新建分组';
  $('#group-name').value = group?.name || ''; $('#group-error').hidden = true;
  fillGroupSelect($('#group-parent'), { root: true, exclude: id ? descendantIds(state.groups, id) : new Set(), value: group?.parentId || parentId || '' });
  $('#group-dialog').showModal(); $('#group-name').focus();
}
function confirmGroupDelete(id) {
  if (!state.groups[id] || id === DEFAULT_GROUP_ID) return;
  deleteGroupId = id; const ids = descendantIds(state.groups, id);
  const count = [...Object.values(state.videos), ...Object.values(state.pending)].filter(v => ids.has(v.groupId)).length;
  $('#group-delete-summary').textContent = `删除“${state.groups[id].name}”${ids.size > 1 ? `及其 ${ids.size - 1} 个子分组` : ''}。${count} 条记录将移入默认分组，进度和书签保留。`;
  $('#group-delete-error').hidden = true; $('#group-delete-dialog').showModal();
}
async function deleteVideo(key) { const r = await send('DELETE', { key }); toast('已移出重点关注', r.undoId, 8000); }
async function undo(id) {
  try { await send('UNDO', { id }); toast('已恢复'); } catch (error) { toast(error.message, undefined, 4200, 'error'); }
}
async function prepareCurrentPage() {
  const token = ++currentReadToken; $('#add-current').disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https:\/\/www\.bilibili\.com\/video\//.test(tab.url)) throw Error('当前页不是支持的B站视频，可在下方粘贴链接');
    if (currentDraft?.sourceUrl === tab.url) { $('#add-current').disabled = false; return; }
    $('#current-status').textContent = '正在读取当前视频';
    const preview = await send('PREVIEW', { url: tab.url }); if (disposed || token !== currentReadToken) return;
    currentDraft = { ...preview, sourceUrl: tab.url };
    $('#current-name').value = preview.record ? videoName(state.videos[`${preview.record.bvid}:${preview.record.cid}`] || preview.record) : '';
    $('#current-name').disabled = false; $('#add-current').disabled = false;
    $('#current-status').textContent = preview.failure ? '暂时无法读取标题，可先保存链接' : preview.metadata.pages.length > 1 ? `共 ${preview.metadata.pages.length} 个分P` : '';
  } catch (error) {
    if (token !== currentReadToken || disposed) return;
    currentDraft = undefined; $('#current-status').textContent = error.message; $('#current-name').disabled = true; $('#link-add-details').open = true;
  }
}
async function saveDraft(draft, prefix) {
  if (!draft) throw Error('请先读取视频信息');
  const r = await send('ADD', { url: draft.url, entire: $('#entire').checked, groupId: $(`#${prefix}-group`).value || DEFAULT_GROUP_ID, displayName: $(`#${prefix}-name`).value, preview: draft.metadata ? draft : undefined, previewFailure: draft.failure });
  pendingSelection = r.keys?.[0]; filter = 'all'; searchQuery = ''; $('#library-search').value = ''; setFilter(); render();
  if (pendingSelection && state.videos[pendingSelection]) { selectedKey = pendingSelection; pendingSelection = undefined; renderFocus(); }
  library.reveal(selectedKey); closePanels(); toast(r.message, undefined, r.pending ? 6500 : 4200);
}
function setFilter() { for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.dataset.filter === filter)); }

$('#resume-button').addEventListener('click', async event => {
  if (loadError) { location.reload(); return; }
  if (!currentVideo()) { event.stopPropagation(); openPanel('add-panel', $('#resume-button')); return; }
  const key = selectedKey, b = $('#resume-button'); b.disabled = true;
  try { await send('OPEN', { key, mode: 'resume' }); } catch (error) { toast(error.message, undefined, 4200, 'error'); } finally { b.disabled = false; }
});
$('#replay').addEventListener('click', async () => { try { await send('OPEN', { key: selectedKey, mode: 'last' }); } catch (error) { toast(error.message, undefined, 4200, 'error'); } });
$('#theme-toggle').addEventListener('click', () => chooseTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
for (const b of document.querySelectorAll('[data-accent-color]')) b.addEventListener('click', () => { void chooseAccent(b.dataset.accentColor); });
$('#accent-picker').addEventListener('change', event => { void chooseAccent(event.target.value); });
$('#accent-hex').addEventListener('input', () => $('#accent-hex').setCustomValidity(''));
$('#accent-hex').addEventListener('change', event => { void chooseAccent(event.target.value.trim()); });
$('#accent-hex').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void chooseAccent(event.target.value.trim()); } });
$('#accent-reset').addEventListener('click', () => { void chooseAccent(DEFAULT_ACCENT); });
$('#theme-retry').addEventListener('click', () => { void loadRareTheme(); });
for (const [button, panel] of [['settings-toggle', 'settings'], ['more-toggle', 'settings'], ['add-toggle', 'add-panel'], ['bookmarks-toggle', 'bookmarks-panel']]) $(`#${button}`).addEventListener('click', () => openPanel(panel, $(`#${button}`)));
for (const b of document.querySelectorAll('[data-close-panel]')) b.addEventListener('click', () => { closePanels(); lastToggle?.focus(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { closePanels(); lastToggle?.focus(); } });
document.addEventListener('click', event => { if (!event.target.closest('.drawer,.utility-bar,.header,dialog,#toast,#storage-warning,#rare-toast-host')) closePanels(); });
for (const b of document.querySelectorAll('[data-filter]')) b.addEventListener('click', () => {
  filter = b.dataset.filter; library.resetScroll();
  const first = filteredVideos(sortedVideos())[0]; if (first && !filteredVideos(sortedVideos()).some(([key]) => key === selectedKey)) selectedKey = first[0];
  setFilter(); render();
});
$('#library-search').addEventListener('input', event => {
  searchQuery = event.target.value;
  if (searchFrame) cancelAnimationFrame(searchFrame);
  searchFrame = requestAnimationFrame(() => { searchFrame = undefined; library.resetScroll(); library.render(); });
});
$('#group-create').addEventListener('click', () => groupDialog());
for (const prefix of ['current', 'link']) $(`#${prefix}-new-group`).addEventListener('click', () => groupDialog({ targetSelect: `${prefix}-group` }));
for (const b of document.querySelectorAll('[data-close-dialog]')) b.addEventListener('click', () => $(`#${b.dataset.closeDialog}`).close());
$('#record-form').addEventListener('submit', async event => {
  event.preventDefault(); const b = $('#record-form button[type=submit]'); b.disabled = true;
  try { await send('VIDEO_EDIT', { key: recordKey, displayName: $('#record-name').value, groupId: $('#record-group').value }); $('#record-dialog').close(); toast('名称和分组已保存'); }
  catch (error) { $('#record-error').textContent = error.message; $('#record-error').hidden = false; } finally { b.disabled = false; }
});
$('#group-form').addEventListener('submit', async event => {
  event.preventDefault(); const b = $('#group-form button[type=submit]'); b.disabled = true;
  try {
    const action = groupAction;
    const r = await send(action.id ? 'GROUP_EDIT' : 'GROUP_CREATE', { id: action.id, name: $('#group-name').value, parentId: $('#group-parent').value || null });
    if (r.group && !state.groups[r.id]) state.groups[r.id] = r.group;
    refreshGroupPickers(true); if (action.targetSelect && r.id) $(`#${action.targetSelect}`).value = r.id;
    $('#group-dialog').close(); toast(r.message);
  } catch (error) { $('#group-error').textContent = error.message; $('#group-error').hidden = false; } finally { b.disabled = false; }
});
$('#group-delete-confirm').addEventListener('click', async () => {
  const b = $('#group-delete-confirm'); b.disabled = true;
  try { const r = await send('GROUP_DELETE', { id: deleteGroupId }); $('#group-delete-dialog').close(); toast(r.message, r.undoId, 8000); }
  catch (error) { $('#group-delete-error').textContent = error.message; $('#group-delete-error').hidden = false; } finally { b.disabled = false; }
});
$('#add-form').addEventListener('submit', async event => {
  event.preventDefault(); const b = $('#add-form button'), token = ++linkReadToken; b.disabled = true; $('#add-error').hidden = true;
  try {
    const preview = await send('PREVIEW', { url: $('#video-link').value });
    if (disposed || token !== linkReadToken) return;
    linkDraft = preview;
    $('#link-name').value = preview.defaultName; $('#link-fields').hidden = false;
    if (preview.failure) { $('#add-error').textContent = '暂时无法读取标题，可先保存链接'; $('#add-error').hidden = false; }
  } catch (error) { $('#add-error').textContent = error.message; $('#add-error').hidden = false; } finally { b.disabled = false; }
});
$('#video-link').addEventListener('input', () => { linkReadToken++; linkDraft = undefined; $('#link-fields').hidden = true; });
$('#add-current').addEventListener('click', async () => {
  const b = $('#add-current'); b.disabled = true; $('#add-error').hidden = true;
  try { await saveDraft(currentDraft, 'current'); }
  catch (error) { $('#add-error').textContent = error.message; $('#add-error').hidden = false; } finally { b.disabled = !currentDraft; }
});
$('#add-link-save').addEventListener('click', async () => {
  const b = $('#add-link-save'); b.disabled = true; $('#add-error').hidden = true;
  try { await saveDraft(linkDraft, 'link'); }
  catch (error) { $('#add-error').textContent = error.message; $('#add-error').hidden = false; } finally { b.disabled = false; }
});
$('#add-bookmark').addEventListener('click', async () => {
  const key = selectedKey; $('#add-bookmark').disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith('https://www.bilibili.com/video/')) throw new Error('请先打开对应分P的视频页，再记录当前播放时间');
    let response;
    try { response = await chrome.tabs.sendMessage(tab.id, { type: 'CURRENT_BOOKMARK', key }); } catch { throw new Error('请刷新视频页后再记录书签'); }
    if (!response?.ok) throw new Error(response?.error || '当前播放页尚未就绪');
    noteDialog({ type: 'BOOKMARK_ADD', key, sec: response.sec, note: '' });
  } catch (error) { toast(error.message, undefined, 4200, 'error'); } finally { $('#add-bookmark').disabled = false; }
});
$('#refresh-record').addEventListener('click', async () => { const v = currentVideo(); if (!v) return; try { await send('REFRESH', { bvid: v.bvid }); toast('视频信息已更新'); } catch (error) { toast(error.message, undefined, 4200, 'error'); } });
$('#delete-record').addEventListener('click', async () => { if (!currentVideo()) return; try { const r = await send('DELETE', { key: selectedKey }); closePanels(); toast('已移出重点关注', r.undoId, 8000); } catch (error) { toast(error.message, undefined, 4200, 'error'); } });
for (const id of ['note-close', 'note-cancel']) $(`#${id}`).addEventListener('click', () => $('#note-dialog').close());
$('#note-form').addEventListener('submit', async event => {
  event.preventDefault(); const b = $('#note-form button[type=submit]'); b.disabled = true;
  try { const { type, ...payload } = dialogAction; await send(type, { ...payload, note: $('#note-input').value }); $('#note-dialog').close(); toast(type === 'BOOKMARK_ADD' ? '已保存书签' : '备注已更新'); }
  catch (error) { $('#note-error').textContent = error.message; $('#note-error').hidden = false; } finally { b.disabled = false; }
});
for (const [id, key, boolean] of [['new-tab', 'openInNewTab', true], ['default-entire', 'addEntireCollectionDefault', true], ['interval', 'sampleIntervalSec'], ['completion', 'completionPercent'], ['remaining', 'completionRemainingSec'], ['cleanup-days', 'cleanupAfterDays'], ['cleanup-keep', 'cleanupKeepBookmarked', true]]) $(`#${id}`).addEventListener('change', async event => {
  const b = event.target; b.disabled = true;
  try { await send('SETTINGS', { settings: { [key]: boolean ? b.checked : Number(b.value) } }); }
  catch (error) { toast(error.message, undefined, 4200, 'error'); settingsUI(); } finally { b.disabled = false; }
});
$('#cleanup-run').addEventListener('click', async () => { $('#cleanup-run').disabled = true; try { const r = await send('CLEANUP'); toast(r.message, r.undoId, 8000); } catch (error) { toast(error.message, undefined, 4200, 'error'); } finally { cleanupUI(); } });
$('#cleanup-undo').addEventListener('click', async () => { try { await send('UNDO', { id: $('#cleanup-undo').dataset.id }); toast('已恢复清理的记录'); } catch (error) { toast(error.message, undefined, 4200, 'error'); } });
$('#storage-cleanup').addEventListener('click', () => {
  if ($('#settings').hidden) openPanel('settings', $('#storage-cleanup'));
  $('#cleanup-panel').open = true;
  requestAnimationFrame(() => { $('#settings').scrollTop = $('#cleanup-panel').offsetTop - 16; });
});
$('#export').addEventListener('click', () => {
  const backup = { schemaVersion: 1, exportedAt: Date.now(), videos: state.videos, pending: state.pending, settings: state.settings, groups: state.groups, libraryUI: state.libraryUI };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const a = el('a'); a.href = url; a.download = `重点关注-备份-${new Date().toLocaleDateString('sv-SE')}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('已导出本机 JSON 备份');
});
$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return; $('#import').disabled = true;
  try { if (file.size > 8 * 1024 * 1024) throw new Error('备份超过 8MB，请检查文件'); const r = await send('IMPORT', { data: JSON.parse(await file.text()) }); toast(r.message); }
  catch (error) { toast(error instanceof SyntaxError ? '这不是有效的 JSON 备份文件' : error.message, undefined, 6500); }
  finally { event.target.value = ''; $('#import').disabled = false; }
});
$('#toast-close').addEventListener('click', () => { toastSequence++; clearTimeout(toastTimer); $('#toast').hidden = true; rareToastController?.dismiss(); });
$('#undo').addEventListener('click', async () => { const id = undoId; $('#undo').disabled = true; try { await undo(id); } finally { $('#undo').disabled = false; } });
function onStorage(changes, area) {
  const next = changes[STATE_KEY]?.newValue;
  if (area !== 'local' || !next || next.schemaVersion !== 1) return;
  state = normalizeLibraryState({ ...emptyState(), ...next, settings: normalizeSettings(next.settings) });
  applyTheme(); render();
  clearTimeout(usageTimer); usageTimer = setTimeout(() => { void refreshUsage(); }, 150);
}
chrome.storage.onChanged.addListener(onStorage); systemTheme.addEventListener('change', applyTheme);
window.addEventListener('pagehide', () => {
  disposed = true; clearTimeout(toastTimer); clearTimeout(usageTimer); if (searchFrame) cancelAnimationFrame(searchFrame);
  chrome.storage.onChanged.removeListener(onStorage); systemTheme.removeEventListener('change', applyTheme); rareController?.destroy(); rareToastController?.destroy(); library.destroy();
}, { once: true });
try {
  // Exactly one initial local state read. Rare UI, React and its stylesheet are
  // not requested until settings or operation feedback; no network gates the first view.
  const result = await chrome.storage.local.get(STATE_KEY);
  if (result[STATE_KEY]?.schemaVersion && result[STATE_KEY].schemaVersion !== 1) throw new Error('本机数据版本暂不支持');
  state = normalizeLibraryState({ ...emptyState(), ...result[STATE_KEY], settings: normalizeSettings(result[STATE_KEY]?.settings) });
  applyTheme(); $('#entire').checked = state.settings.addEntireCollectionDefault; render();
  const recent = Object.entries(state.trash).filter(([, t]) => t.expiresAt > Date.now()).sort(([, a], [, b]) => b.expiresAt - a.expiresAt)[0];
  if (recent) toast(recent[1].kind === 'batch' ? `已清理 ${recent[1].count} 条旧记录` : '刚刚移除了一个条目', recent[0], Math.min(8000, recent[1].expiresAt - Date.now()));
} catch (error) {
  loadError = true; $('#focus').setAttribute('aria-busy', 'false'); $('#list').setAttribute('aria-busy', 'false');
  $('#focus-title').textContent = '暂时无法读取本机清单'; $('#focus-meta').textContent = error.message;
  $('#resume-label').textContent = '重新读取'; $('#resume-button').setAttribute('aria-label', '重新读取'); $('#resume-button').disabled = false;
  $('#list').replaceChildren(el('p', 'empty-list', '重新读取不会清空已保存的数据。'));
}
document.body.dataset.ready = 'true'; performance.mark('focus:ready');
requestAnimationFrame(() => { void refreshUsage(); });
