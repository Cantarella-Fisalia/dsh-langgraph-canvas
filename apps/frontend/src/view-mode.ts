export type ViewMode = 'standard' | 'professional';
export const viewModeKey = 'vis4agent:view-mode';
export const viewModeNames = { standard: '标准模式', professional: '专业模式' };

export function viewModeStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}
export function readViewMode(storage = viewModeStorage()): ViewMode {
  try { return storage?.getItem(viewModeKey) === 'professional' ? 'professional' : 'standard'; } catch { return 'standard'; }
}
export function saveViewMode(mode: ViewMode, storage = viewModeStorage()): boolean {
  try { if (!storage) return false; storage.setItem(viewModeKey, mode); return true; } catch { return false; }
}
