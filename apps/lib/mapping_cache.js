// apps/lib/mapping_cache.js
const memo = new Map();   // cache de aciertos -> { ... }
const misses = new Set(); // cache de fallos   -> null

const keyOf = (k) => JSON.stringify(k);

export function cacheGet(k) {
  const key = keyOf(k);
  if (memo.has(key))  return memo.get(key);  // objeto
  if (misses.has(key)) return null;          // miss conocida
  return undefined;                          // sin cache
}

export function cachePut(k, v) {
  const key = keyOf(k);
  if (v) memo.set(key, v); else misses.add(key);
  return v;
}

export function clearCache() {
  memo.clear();
  misses.clear();
}