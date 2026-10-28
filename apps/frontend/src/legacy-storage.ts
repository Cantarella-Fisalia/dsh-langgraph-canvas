import { brand, previousBrand } from '../../../scripts/runtime/brand.mjs';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;
/** Read old data without replaying work; explicit deletion clears both names to prevent resurrection. */
export function compatibleStorage(storage?: StorageLike) {
  if (!storage) return undefined;
  const previousKey = (key: string) => key.startsWith(brand + ':')
    ? previousBrand + key.slice(brand.length).replaceAll('/' + brand + '/api', '/' + previousBrand + '/api') : key;
  return {
    getItem(key: string) { const value = storage.getItem(key); return value ?? storage.getItem(previousKey(key)); },
    setItem(key: string, value: string) { storage.setItem(key, value); },
    removeItem(key: string) { storage.removeItem?.(key); const old = previousKey(key); if (old !== key) storage.removeItem?.(old); },
  };
}
