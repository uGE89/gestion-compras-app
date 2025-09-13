// apps/lib/recon_storage.js
import { buildStorageKey } from './recon_config.js';
import { openDbEnsureStores } from './idb_utils.js';

export function loadSession({ cuentaId, desdeISO, hastaISO }) {
  const key = buildStorageKey({ cuentaId, desdeISO, hastaISO });
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}

export function saveSession({ cuentaId, desdeISO, hastaISO }, stateObj) {
  const key = buildStorageKey({ cuentaId, desdeISO, hastaISO });
  localStorage.setItem(key, JSON.stringify(stateObj));
}

// ---------- Tablas parseadas ----------
const STORE_TABLES = 'tables';
function tablesKey({ cuentaId, desdeISO, hastaISO }) {
  return `tables:${cuentaId}:${desdeISO || 'na'}:${hastaISO || 'na'}`;
}
export async function saveParsedTables({ cuentaId, desdeISO, hastaISO, alegraRows, bancoRows }) {
  const db = await openDbEnsureStores([STORE_TABLES]);
  const tx = db.transaction(STORE_TABLES, 'readwrite');
  await new Promise((res, rej) => {
    const req = tx.objectStore(STORE_TABLES).put({ alegraRows, bancoRows, ts: Date.now() }, tablesKey({ cuentaId, desdeISO, hastaISO }));
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}
export async function loadParsedTables({ cuentaId, desdeISO, hastaISO }) {
  const db = await openDbEnsureStores([STORE_TABLES]);
  const tx = db.transaction(STORE_TABLES, 'readonly');
  return await new Promise((res) => {
    const req = tx.objectStore(STORE_TABLES).get(tablesKey({ cuentaId, desdeISO, hastaISO }));
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => res(null);
  });
}

// ---------- Preferencias ----------
const PREFS_KEY = 'conciliacion:prefs';
export function savePrefs(p) { localStorage.setItem(PREFS_KEY, JSON.stringify(p || {})); }
export function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; } }

