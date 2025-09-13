// apps/lib/idb_utils.js
export const IDB_NAME = 'ff-concilia'; // DB separada para conciliación
export async function openDbEnsureStores(stores = []) {
  let db = await new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const missing = stores.filter(s => !db.objectStoreNames.contains(s));
  if (!missing.length) return db;

  const newVersion = db.version + 1;
  db.close();
  return await new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, newVersion);
    req.onupgradeneeded = (ev) => {
      const up = ev.target.result;
      missing.forEach(s => {
        if (!up.objectStoreNames.contains(s)) up.createObjectStore(s);
      });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
