export const STORAGE_WARNING_BYTES = 1024 ** 3;
export function needsCleanupWarning(bytes) {
  return Number.isFinite(bytes) && bytes > STORAGE_WARNING_BYTES;
}
