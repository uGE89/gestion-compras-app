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

// ====== NUEVO: lecturas/exportaciones/importaciones ======

/** Lee todo el master como arreglo de objetos {sig, ...payload} */
export async function masterGetAll() {
  const db = await idbOpen();
  const store = db.transaction(STORE_MASTER, 'readonly').objectStore(STORE_MASTER);
  const out = [];
  await new Promise((res, rej) => {
    const req = store.openCursor();
    req.onsuccess = (ev) => {
      const cur = ev.target.result;
      if (cur) { out.push({ sig: cur.key, ...cur.value }); cur.continue(); }
      else res();
    };
    req.onerror = () => rej(req.error);
  });
  return out;
}

/** Normaliza una entrada importada a la forma canónica del master */
function normalizeEntry(raw = {}) {
  // alegraIds puede venir como string "a|b|c" o arreglo
  let alegraIds = raw.alegraIds;
  if (!Array.isArray(alegraIds)) {
    alegraIds = String(alegraIds ?? '').split(/[|,;\s]+/).filter(Boolean);
  }
  const meta = (raw.meta && typeof raw.meta === 'object')
    ? { ...raw.meta }
    : (raw.meta ? safeParseJSON(raw.meta) : {});

  const errors = [];

  const cuentaId = Number(raw.cuentaId);
  if (!Number.isFinite(cuentaId)) errors.push('cuentaId');

  const fecha = raw.fecha && !Number.isNaN(Date.parse(raw.fecha)) ? raw.fecha : null;
  if (!fecha) errors.push('fecha');

  const signo = (raw.signo || '').toString();
  if (!['in', 'out'].includes(signo)) errors.push('signo');

  const monto = Number(
    typeof raw.montoNio === 'string' ? raw.montoNio.replace(/,/g, '') : raw.montoNio
  );
  if (!Number.isFinite(monto)) errors.push('montoNio');

  if (errors.length) {
    return { errors };
  }

  return {
    value: {
      sig: raw.sig || null,
      cuentaId,
      fecha,
      signo,
      nroConfirm: raw.nroConfirm ?? raw.numeroConfirmacion ?? null,
      montoNio: monto.toFixed(2),
      descripcion: raw.descripcion || '',
      alegraIds: Array.from(new Set(alegraIds)),
      meta: { ...meta, ts: meta.ts || Date.now() },
    },
    errors: null,
  };
}
function safeParseJSON(s) { try { return JSON.parse(s); } catch { return {}; } }

/**
 * Importa un lote de entradas normalizadas.
 * mode='keep' => conserva existentes (no sobreescribe); 'overwrite' => reemplaza.
 */
export async function masterImportEntries(entries = [], { mode = 'keep' } = {}) {
  if (!Array.isArray(entries) || !entries.length) return { inserted: 0, updated: 0, skipped: 0, total: 0, errors: [] };
  const db = await idbOpen();
  const tx = db.transaction(STORE_MASTER, 'readwrite');
  const store = tx.objectStore(STORE_MASTER);
  let inserted = 0, updated = 0, skipped = 0;
  const errors = [];
  for (const r of entries) {
    const { value: e, errors: errs } = normalizeEntry(r);
    if (errs?.length) {
      console.warn('Skipping invalid master entry', errs, r);
      errors.push({ entry: r, errors: errs });
      skipped++;
      continue;
    }
    const sig = e.sig || bankSignature(e);
    e.sig = sig;
    // ¿existe ya?
    // Nota: usamos await secuencial para mantener viva la transacción con orden predecible
    const exists = await new Promise((res) => {
      const g = store.get(sig); g.onsuccess = () => res(!!g.result); g.onerror = () => res(false);
    });
    if (exists && mode === 'keep') { skipped++; continue; }
    await new Promise((res, rej) => {
      const p = store.put(e, sig); p.onsuccess = () => res(); p.onerror = () => rej(p.error);
    });
    exists ? updated++ : inserted++;
  }
  await new Promise((res) => { tx.oncomplete = () => res(); });
  return { inserted, updated, skipped, total: entries.length, errors };
}
