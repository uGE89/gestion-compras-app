// apps/lib/recon_master.js
import { normalizeText } from './recon_utils.js';
import { openDbEnsureStores } from './idb_utils.js';

const STORE_MASTER = 'master';
const idbOpen = () => openDbEnsureStores([STORE_MASTER]);

export function bankSignature(b) {
  const desc = normalizeText((b.descripcion || '').slice(0, 120));
  const base = `${b.cuentaId}|${b.fecha}|${b.signo}|${Number(b.montoNio).toFixed(2)}|${b.nroConfirm || ''}|${desc}`;
  let h = 5381; for (let i = 0; i < base.length; i++) h = ((h << 5) + h) ^ base.charCodeAt(i);
  return 'B:' + (h >>> 0).toString(36);
}

export async function masterBulkHas(sigs = []) {
  const db = await idbOpen();
  const store = db.transaction(STORE_MASTER, 'readonly').objectStore(STORE_MASTER);
  const out = new Map();
  await Promise.all(sigs.map(sig => new Promise((res) => {
    const r = store.get(sig);
    r.onsuccess = () => { out.set(sig, !!r.result); res(); };
    r.onerror = () => { out.set(sig, false); res(); };
  })));
  return out;
}

export async function masterSave({ bankRow, alegraIds, meta = {} }) {
  const db = await idbOpen();
  const store = db.transaction(STORE_MASTER, 'readwrite').objectStore(STORE_MASTER);
  const sig = bankSignature(bankRow);
  const payload = {
    sig,
    cuentaId: bankRow.cuentaId,
    fecha: bankRow.fecha,
    signo: bankRow.signo,
    nroConfirm: bankRow.nroConfirm || null,
    montoNio: Number(bankRow.montoNio).toFixed(2),
    descripcion: bankRow.descripcion || '',
    alegraIds: Array.from(new Set(alegraIds || [])),
    meta: { ...meta, ts: Date.now() },
  };
  await new Promise((res, rej) => {
    const r = store.put(payload, sig);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
  return sig;
}
