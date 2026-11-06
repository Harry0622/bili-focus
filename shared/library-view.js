import { libraryEntries, DEFAULT_GROUP_ID, videoName } from './library.js';
import { ICONS } from './icons.js';

export function mountLibraryView({ container, getState, getSelection, selectVideo, getFilter, getQuery, complete, formatTime, cover, actionButton, onEdit, onCreateGroup, onEditGroup, onDeleteGroup, onDelete, onRetry, onDeletePending, onToggleGroup }) {
  let view, frame, rowNodes = new Map(), disposed = false;
  const canvas = document.createElement('div'); canvas.className = 'library-canvas'; canvas.setAttribute('role', 'list');
  container.replaceChildren(canvas);
  function iconButton(icon, label, action, className = 'icon-button') {
    const b = actionButton('', label, action, className); b.innerHTML = icon; return b;
  }
  function row(entry) {
    if (entry.kind === 'group') {
      const node = document.createElement('div'); node.className = 'group-row'; node.dataset.groupId = entry.key; node.setAttribute('role', 'listitem');
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'group-toggle';
      const arrow = document.createElement('span'); arrow.className = 'group-chevron'; arrow.innerHTML = ICONS.chevron;
      const folder = document.createElement('span'); folder.className = 'group-folder'; folder.innerHTML = ICONS.folder;
      const name = document.createElement('span'); name.className = 'group-name';
      const count = document.createElement('span'); count.className = 'group-count';
      toggle.append(arrow, folder, name, count); toggle.addEventListener('click', () => onToggleGroup(entry.key));
      node.append(toggle, iconButton(ICONS.plus, `在 ${entry.value.path} 新建子分组`, () => onCreateGroup(entry.key)));
      if (entry.key !== DEFAULT_GROUP_ID) node.append(iconButton(ICONS.edit, `编辑分组 ${entry.value.path}`, () => onEditGroup(entry.key)), iconButton(ICONS.trash, `删除分组 ${entry.value.path}`, () => onDeleteGroup(entry.key), 'icon-button danger'));
      return node;
    }
    if (entry.kind === 'pending') {
      const node = document.createElement('div'); node.className = 'pending-row'; node.setAttribute('role', 'listitem');
      const body = document.createElement('div'); body.className = 'row-body';
      const title = document.createElement('span'); title.className = 'row-title'; title.textContent = entry.value.displayName || '等待补全视频信息';
      const error = document.createElement('span'); error.className = 'row-meta'; error.textContent = entry.value.error; body.title = entry.value.url;
      body.append(title, error); node.append(body, iconButton('↻', '重试获取视频信息', () => onRetry(entry.key)), iconButton(ICONS.trash, '移除待补全链接', () => onDeletePending(entry.key), 'icon-button danger'));
      return node;
    }
    const node = document.createElement('div'); node.className = 'list-row'; node.dataset.key = entry.key; node.setAttribute('role', 'listitem');
    const select = document.createElement('button'); select.type = 'button'; select.className = 'list-select';
    const body = document.createElement('span'); body.className = 'row-body';
    const title = document.createElement('span'); title.className = 'row-title';
    const meta = document.createElement('span'); meta.className = 'row-meta';
    body.append(title, meta); select.append(cover(entry.value.cover, 'row-cover', 56, 36), body);
    select.addEventListener('click', () => selectVideo(entry.key));
    const tools = document.createElement('span'); tools.className = 'row-actions';
    tools.append(iconButton(ICONS.edit, '编辑名称和分组', () => onEdit(entry.key)), iconButton(ICONS.trash, '删除此分P', () => onDelete(entry.key), 'icon-button danger'));
    node.append(select, tools); return node;
  }
  function update(node, entry) {
    node.style.transform = `translateY(${entry.offset}px)`; node.style.height = `${entry.height}px`;
    node.style.setProperty('--depth', Math.min(entry.depth, 4));
    if (entry.kind === 'group') {
      const toggle = node.querySelector('.group-toggle');
      toggle.setAttribute('aria-expanded', String(entry.open)); toggle.setAttribute('aria-label', `${entry.open ? '收起' : '展开'}分组 ${entry.value.path}`); toggle.title = entry.value.path;
      node.querySelector('.group-name').textContent = entry.value.name; node.querySelector('.group-count').textContent = entry.count;
      node.dataset.expanded = String(entry.open);
    } else if (entry.kind === 'video') {
      const v = getState().videos[entry.key];
      const select = node.querySelector('.list-select');
      select.setAttribute('aria-pressed', String(entry.key === getSelection())); select.setAttribute('aria-label', `选择 ${videoName(v)}`); select.title = `${videoName(v)}\n${v.title}`;
      node.dataset.selected = String(entry.key === getSelection());
      node.querySelector('.row-title').textContent = videoName(v);
      node.querySelector('.row-meta').textContent = `${complete(v) ? '已看完' : formatTime(v.positionSec)} · ${v.ownerName || (v.totalPages > 1 ? `P${v.page}` : '单P视频')}`;
    }
  }
  function visibleRange() {
    const low = Math.max(0, container.scrollTop - 144), high = container.scrollTop + container.clientHeight + 144;
    let left = 0, right = view.entries.length;
    while (left < right) { const middle = (left + right) >> 1; const e = view.entries[middle]; if (e.offset + e.height < low) left = middle + 1; else right = middle; }
    let end = left; while (end < view.entries.length && view.entries[end].offset <= high) end++;
    return view.entries.slice(left, end);
  }
  function paint() {
    frame = undefined; if (!view || disposed) return;
    const visible = visibleRange(), keep = new Set();
    let previous;
    for (const entry of visible) {
      const key = `${entry.kind}:${entry.key}`;
      const signature = `${entry.value.cover || ''}|${entry.value.path || ''}|${entry.value.displayName || ''}|${entry.value.error || ''}`;
      let cached = rowNodes.get(key);
      if (!cached || cached.signature !== signature) { cached?.node.remove(); cached = { node: row(entry), signature }; rowNodes.set(key, cached); canvas.append(cached.node); }
      update(cached.node, entry); keep.add(key);
      const expected = previous ? previous.nextElementSibling : canvas.firstElementChild;
      if (expected !== cached.node) canvas.insertBefore(cached.node, expected);
      previous = cached.node;
    }
    for (const [key, cached] of rowNodes) if (!keep.has(key)) { cached.node.remove(); rowNodes.delete(key); }
    let empty = canvas.querySelector('.empty-list');
    if (!view.matchedTotal && !empty) { empty = document.createElement('p'); empty.className = 'empty-list'; empty.textContent = getQuery() ? '没有找到匹配的视频' : '暂无视频'; canvas.append(empty); }
    if (empty) { if (view.matchedTotal) empty.remove(); else empty.style.transform = `translateY(${view.height}px)`; }
    container.dataset.renderedRows = rowNodes.size;
  }
  function schedule() { if (!frame && !disposed) frame = requestAnimationFrame(paint); }
  container.addEventListener('scroll', schedule, { passive: true });
  const resize = new ResizeObserver(schedule); resize.observe(container);
  return {
    render() {
      view = libraryEntries(getState(), { filter: getFilter(), query: getQuery(), complete });
      canvas.style.height = `${Math.max(1, view.height + (view.matchedTotal ? 0 : 40))}px`;
      // Removing rows after collapsing must also clamp a formerly deep scroll.
      const max = Math.max(0, parseFloat(canvas.style.height) - container.clientHeight);
      if (container.scrollTop > max) container.scrollTop = max;
      paint(); container.setAttribute('aria-busy', 'false');
      return view;
    },
    updateSelection() { paint(); },
    groupPath(id) { return view?.index.byId.get(id)?.path || '默认分组'; },
    reveal(key) { const entry = view?.entries.find(e => e.kind === 'video' && e.key === key); if (entry) { container.scrollTop = Math.max(0, entry.offset - 36); paint(); } },
    resetScroll() { container.scrollTop = 0; },
    destroy() { disposed = true; if (frame) cancelAnimationFrame(frame); container.removeEventListener('scroll', schedule); resize.disconnect(); rowNodes.clear(); },
  };
}
