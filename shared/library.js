export const DEFAULT_GROUP_ID = 'default';
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const label = (value, limit = 200) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '';
const groupIdValid = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id);

export function defaultLibrary() {
  return { groups: { default: { id: DEFAULT_GROUP_ID, name: '默认分组', parentId: null, createdAt: 0 } }, libraryUI: { collapsedGroupIds: [] } };
}
export function normalizeGroups(raw) {
  const groups = defaultLibrary().groups;
  if (raw === undefined || raw === null) return groups;
  if (typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 10000) throw Error('分组数据格式不正确');
  for (const [id, group] of Object.entries(raw)) {
    if (!groupIdValid(id) || !group || group.id !== id || !label(group.name, 60)) throw Error('分组数据无效');
    if (id === DEFAULT_GROUP_ID) continue;
    const parentId = group.parentId === null || group.parentId === undefined ? null : group.parentId;
    if (parentId !== null && !groupIdValid(parentId)) throw Error('父分组无效');
    groups[id] = { id, name: label(group.name, 60), parentId, createdAt: Number.isFinite(group.createdAt) ? Math.max(0, group.createdAt) : 0 };
  }
  buildGroupIndex(groups); // Validate parent references and cycles, without recursion.
  return groups;
}
export function normalizeLibraryState(state) {
  const groups = normalizeGroups(state.groups);
  const collapsed = Array.isArray(state.libraryUI?.collapsedGroupIds) ? state.libraryUI.collapsedGroupIds : [];
  const videos = state.videos || {}, pending = state.pending || {};
  for (const v of Object.values(videos)) { v.groupId = own(groups, v.groupId) ? v.groupId : DEFAULT_GROUP_ID; v.displayName = label(v.displayName); }
  for (const p of Object.values(pending)) { p.groupId = own(groups, p.groupId) ? p.groupId : DEFAULT_GROUP_ID; p.displayName = label(p.displayName); }
  return { ...state, groups, libraryUI: { collapsedGroupIds: [...new Set(collapsed.filter(id => own(groups, id)))] }, videos, pending };
}
export function defaultVideoName(video) {
  const suffix = video.totalPages > 1 ? ` · P${video.page}${video.partTitle ? ` ${label(video.partTitle, 70)}` : ''}` : '';
  return `${label(video.title || video.bvid, 200 - suffix.length)}${suffix}`;
}
export function videoName(video) { return label(video.displayName) || defaultVideoName(video); }
export function requireGroup(state, id = DEFAULT_GROUP_ID) {
  const target = id || DEFAULT_GROUP_ID;
  if (!own(state.groups, target)) throw Error('所选分组已删除，请重新选择');
  return target;
}
export function buildGroupIndex(groups) {
  const children = new Map([[null, []]]);
  for (const group of Object.values(groups)) {
    if (group.parentId !== null && !own(groups, group.parentId)) throw Error('分组引用了不存在的父分组');
    if (!children.has(group.parentId)) children.set(group.parentId, []);
    children.get(group.parentId).push(group);
  }
  for (const list of children.values()) list.sort((a, b) => (a.id === DEFAULT_GROUP_ID ? -1 : b.id === DEFAULT_GROUP_ID ? 1 : a.createdAt - b.createdAt || a.name.localeCompare(b.name, 'zh-CN')));
  const order = [], byId = new Map(), stack = [...(children.get(null) || [])].reverse().map(g => ({ group: g, depth: 0, parentPath: '' }));
  while (stack.length) {
    const { group, depth, parentPath } = stack.pop();
    if (byId.has(group.id)) throw Error('分组层级存在循环');
    let path = parentPath ? `${parentPath} / ${group.name}` : group.name;
    if (path.length > 220) path = `${path.slice(0, 50)} / … / ${path.slice(-150)}`;
    const item = { ...group, depth, path };
    byId.set(group.id, item); order.push(item);
    const next = children.get(group.id) || [];
    for (let i = next.length - 1; i >= 0; i--) stack.push({ group: next[i], depth: depth + 1, parentPath: path });
  }
  if (order.length !== Object.keys(groups).length) throw Error('分组层级存在循环');
  return { order, byId, children };
}
export function descendantIds(groups, id) {
  const index = buildGroupIndex(groups), ids = new Set(), stack = [id];
  while (stack.length) { const next = stack.pop(); if (ids.has(next)) continue; ids.add(next); for (const child of index.children.get(next) || []) stack.push(child.id); }
  return ids;
}
export function expandGroupPath(state, id) {
  const open = new Set(); let current = id;
  while (current && state.groups[current] && !open.has(current)) { open.add(current); current = state.groups[current].parentId; }
  state.libraryUI.collapsedGroupIds = state.libraryUI.collapsedGroupIds.filter(value => !open.has(value));
}
function ensureSiblingName(state, name, parentId, except) {
  if (Object.values(state.groups).some(g => g.id !== except && g.parentId === parentId && g.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw Error('同一层级已存在同名分组');
}
export function createGroup(state, input) {
  const name = label(input.name, 60), parentId = input.parentId || null;
  if (!name) throw Error('请输入分组名称');
  if (parentId) requireGroup(state, parentId);
  if (Object.keys(state.groups).length >= 10000) throw Error('分组数量已达上限');
  ensureSiblingName(state, name, parentId);
  const id = crypto.randomUUID();
  state.groups[id] = { id, name, parentId, createdAt: Date.now() };
  if (parentId) expandGroupPath(state, parentId);
  return { id, group: state.groups[id], message: '分组已创建' };
}
export function editGroup(state, input) {
  const group = state.groups[input.id];
  if (!group || input.id === DEFAULT_GROUP_ID) throw Error('默认分组不能修改');
  const name = label(input.name, 60), parentId = input.parentId || null;
  if (!name) throw Error('请输入分组名称');
  if (parentId) requireGroup(state, parentId);
  if (descendantIds(state.groups, group.id).has(parentId)) throw Error('不能将分组放入自己或自己的子分组');
  ensureSiblingName(state, name, parentId, group.id);
  Object.assign(group, { name, parentId });
  return { message: '分组已更新' };
}
export function deleteGroup(state, id, now = Date.now()) {
  if (id === DEFAULT_GROUP_ID || !state.groups[id]) throw Error('默认分组不能删除');
  const ids = descendantIds(state.groups, id), removed = {}, assignments = { videos: {}, pending: {} };
  for (const groupId of ids) { removed[groupId] = state.groups[groupId]; delete state.groups[groupId]; }
  for (const kind of ['videos', 'pending']) for (const [key, entry] of Object.entries(state[kind])) if (ids.has(entry.groupId)) { assignments[kind][key] = entry.groupId; entry.groupId = DEFAULT_GROUP_ID; }
  const collapsed = state.libraryUI.collapsedGroupIds.filter(groupId => ids.has(groupId));
  state.libraryUI.collapsedGroupIds = state.libraryUI.collapsedGroupIds.filter(groupId => !ids.has(groupId));
  const undoId = crypto.randomUUID();
  state.trash[undoId] = { kind: 'group', groups: removed, assignments, collapsed, expiresAt: now + 8000 };
  return { undoId, message: '分组已删除，视频已移入默认分组' };
}
export function restoreGroup(state, saved) {
  for (const [id, group] of Object.entries(saved.groups)) if (!own(state.groups, id)) state.groups[id] = { ...group, parentId: group.parentId && (own(state.groups, group.parentId) || own(saved.groups, group.parentId)) ? group.parentId : null };
  for (const kind of ['videos', 'pending']) for (const [key, groupId] of Object.entries(saved.assignments[kind])) if (state[kind][key]?.groupId === DEFAULT_GROUP_ID && own(state.groups, groupId)) state[kind][key].groupId = groupId;
  state.libraryUI.collapsedGroupIds = [...new Set([...state.libraryUI.collapsedGroupIds, ...saved.collapsed.filter(id => own(state.groups, id))])];
}
export function editVideo(state, key, input) {
  const video = state.videos[key]; if (!video) throw Error('该视频已不在清单中');
  video.groupId = requireGroup(state, input.groupId);
  const value = label(input.displayName);
  video.displayName = value === defaultVideoName(video) ? '' : value;
  expandGroupPath(state, video.groupId);
  return { message: '名称和分组已保存' };
}
export function mergeGroups(state, imported) {
  const mapping = new Map([[DEFAULT_GROUP_ID, DEFAULT_GROUP_ID]]), added = new Set();
  const siblingKey = (parentId, name) => `${parentId || ''}\u0000${name.toLocaleLowerCase()}`;
  const siblings = new Map(Object.values(state.groups).map(g => [siblingKey(g.parentId, g.name), g]));
  for (const group of buildGroupIndex(imported.groups).order) {
    if (group.id === DEFAULT_GROUP_ID) continue;
    const parentId = group.parentId ? mapping.get(group.parentId) : null;
    const identical = siblings.get(siblingKey(parentId, group.name));
    if (identical) { mapping.set(group.id, identical.id); continue; }
    const id = own(state.groups, group.id) ? crypto.randomUUID() : group.id;
    state.groups[id] = { ...group, id, parentId }; delete state.groups[id].depth; delete state.groups[id].path;
    siblings.set(siblingKey(parentId, group.name), state.groups[id]);
    mapping.set(group.id, id); added.add(id);
  }
  return { mapping, added };
}

// Flat, fixed-height entries allow the popup to render only its viewport.
// A reverse parent-first pass aggregates descendant counts in O(groups + videos).
export function libraryEntries(state, { filter = 'all', query = '', complete = () => false } = {}) {
  const index = buildGroupIndex(state.groups), records = new Map(), counts = new Map(index.order.map(g => [g.id, 0]));
  const search = query.trim().normalize('NFKC').toLocaleLowerCase();
  const values = Object.entries(state.videos).sort(([, a], [, b]) => Number(b.pinned) - Number(a.pinned) || b.lastWatchedAt - a.lastWatchedAt || b.addedAt - a.addedAt);
  for (const [key, value] of values) {
    if (filter !== 'all' && (filter === 'completed') !== complete(value)) continue;
    if (search && !`${videoName(value)} ${value.title} ${value.partTitle} ${value.ownerName}`.normalize('NFKC').toLocaleLowerCase().includes(search)) continue;
    if (!records.has(value.groupId)) records.set(value.groupId, []);
    records.get(value.groupId).push({ kind: 'video', key, value, height: 64 });
    counts.set(value.groupId, (counts.get(value.groupId) || 0) + 1);
  }
  if (filter === 'all') for (const [key, value] of Object.entries(state.pending)) {
    if (search && !`${value.displayName || ''} ${value.url}`.normalize('NFKC').toLocaleLowerCase().includes(search)) continue;
    if (!records.has(value.groupId)) records.set(value.groupId, []);
    records.get(value.groupId).push({ kind: 'pending', key, value, height: 64 });
    counts.set(value.groupId, (counts.get(value.groupId) || 0) + 1);
  }
  for (let i = index.order.length - 1; i >= 0; i--) { const g = index.order[i]; if (g.parentId) counts.set(g.parentId, counts.get(g.parentId) + counts.get(g.id)); }
  const entries = [], collapsed = new Set(state.libraryUI.collapsedGroupIds), stack = [...(index.children.get(null) || [])].reverse().map(group => ({ kind: 'branch', id: group.id }));
  let offset = 0, matched = 0;
  while (stack.length) {
    const item = stack.pop();
    if (item.kind !== 'branch') { entries.push({ ...item, offset, depth: index.byId.get(item.value.groupId)?.depth || 0 }); offset += item.height; matched++; continue; }
    const group = index.byId.get(item.id), count = counts.get(group.id);
    if (search && count === 0) continue;
    const open = !!search || !collapsed.has(group.id);
    entries.push({ kind: 'group', key: group.id, value: group, count, open, depth: group.depth, height: 36, offset }); offset += 36;
    if (!open) continue;
    const videos = records.get(group.id) || [];
    for (let i = videos.length - 1; i >= 0; i--) stack.push(videos[i]);
    const children = index.children.get(group.id) || [];
    for (let i = children.length - 1; i >= 0; i--) stack.push({ kind: 'branch', id: children[i].id });
  }
  return { entries, height: offset, index, matched, matchedTotal: [...records.values()].reduce((n, list) => n + list.length, 0) };
}
