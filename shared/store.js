import { STATE_KEY, emptyState, normalizeSettings } from './model.js';
import { normalizeLibraryState } from './library.js';
// This queue is only a mutex. Every operation re-reads the durable state;
// no business state lives in the service worker's memory.
let queue = Promise.resolve();
export async function readState() {
  const stored = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  if (!stored) return emptyState();
  if (stored.schemaVersion !== 1) throw new Error('本机数据版本暂不支持，请先导出备份');
  return normalizeLibraryState({ ...emptyState(), ...stored, settings: normalizeSettings(stored.settings) });
}
export function transact(change) {
  const task = queue.then(async () => {
    const state = await readState();
    const result = await change(state);
    if (result?.changed !== false) await chrome.storage.local.set({ [STATE_KEY]: state });
    return result;
  });
  queue = task.catch(() => {});
  return task;
}
