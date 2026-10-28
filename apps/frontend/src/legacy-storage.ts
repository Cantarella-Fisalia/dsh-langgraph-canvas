import { brand, previousBrands } from '../../../scripts/runtime/brand.mjs';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;
/** Read old data without replaying work; explicit deletion clears both names to prevent resurrection. */
export function compatibleStorage(storage?: StorageLike) {
  if (!storage) return undefined;
  const previousKeys = (key: string) => key.startsWith(brand + ':')
    ? previousBrands.map(previous => previous + key.slice(brand.length).replaceAll('/' + brand + '/api', '/' + previous + '/api')) : [];
  return {
    getItem(key: string) {
      for (const candidate of [key, ...previousKeys(key)]) { const value = storage.getItem(candidate); if (value != null) return value; }
      return null;
    },
    setItem(key: string, value: string) { storage.setItem(key, value); },
    removeItem(key: string) { for (const candidate of [key, ...previousKeys(key)]) storage.removeItem?.(candidate); },
  };
}
