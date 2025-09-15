// apps/lib/associations.js
import { doc, getDoc, setDoc, serverTimestamp, increment } 
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { cacheGet, cachePut } from './mapping_cache.js';

export const MAP_COLLECTION = 'mapeo_articulos';

export const slugifyDesc = (s='') =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
   .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

const normProv  = (s='') => slugifyDesc(s);
const normCode  = (s='') => String(s).trim().toLowerCase();
const idProvCode = (prov, code) => `provcode:${normProv(prov)}:${normCode(code)}`;
const idProvDesc = (prov, desc) => `provdesc:${normProv(prov)}:${slugifyDesc(desc)}`;
const idDesc     = (desc)        => `desc:${slugifyDesc(desc)}`;

/** Lee en cascada con memo: prov+code → prov+desc → desc */
export async function findAssociationCascade(db, { proveedor, codigoProveedor, descripcion }) {
  const keys = [
    codigoProveedor ? idProvCode(proveedor, codigoProveedor) : null,
    (proveedor && descripcion) ? idProvDesc(proveedor, descripcion) : null,
    descripcion ? idDesc(descripcion) : null
  ].filter(Boolean);

  // memo: si ya sabemos el resultado para *esta combinación*, devolverlo
  const cached = cacheGet({ proveedor, codigoProveedor, descripcion });
  if (cached !== undefined) return cached; // null (miss) u objeto (hit)

  for (const k of keys) {
    const snap = await getDoc(doc(db, MAP_COLLECTION, k));
    if (snap.exists()) {
      const v = snap.data();
      return cachePut({ proveedor, codigoProveedor, descripcion }, v);
    }
  }
  return cachePut({ proveedor, codigoProveedor, descripcion }, null);
}

/** Dedupe por lote: genera ids únicas y resuelve una sola vez por clave */
export async function associateItemsBatch(db, proveedor, rawItems) {
  // Construye llaves únicas a consultar (string → set)
  const idSet = new Set();
  const rows = rawItems.map(it => {
    const desc = it.descripcion ?? it.descripcion_factura ?? '';
    const code = it.clave_proveedor ?? null;
    const ids = [
      code ? idProvCode(proveedor, code) : null,
      proveedor && desc ? idProvDesc(proveedor, desc) : null,
      desc ? idDesc(desc) : null
    ].filter(Boolean);
    ids.forEach(id => idSet.add(id));
    return { desc, code, ids };
  });

  // Resolve por ID (con memo por combinación funcional)
  const idToAssoc = new Map();
  for (const id of idSet) {
    // Mapear el ID a un objeto de consulta "combinación" para aprovechar cacheGet/Put
    // Simple: hacemos un getDoc directo (memo funcional se aplica a combinación completa)
    const snap = await getDoc(doc(db, MAP_COLLECTION, id));
    idToAssoc.set(id, snap.exists() ? snap.data() : null);
  }

  // Asignar el primer hit en orden
  return rawItems.map((it, i) => {
    const { desc, code, ids } = rows[i];
    let assoc = null;
    for (const id of ids) {
      assoc = idToAssoc.get(id);
      if (assoc) break;
    }
    return {
      ...it,
      clave_catalogo: assoc?.clave_catalogo || null,
      desc_catalogo:  assoc?.desc_catalogo  || null,
      autoAssociated: !!assoc
    };
  });
}

/** Persiste mapeos útiles para futuro (crea 1–3 docs) */
export async function persistMappingsForItem(db, proveedor, it) {
  if (!it?.clave_catalogo || !it?.desc_catalogo) return;
  const ops = [];
  const desc = it.descripcion_factura || it.descripcion || '';
  const code = it.clave_proveedor || null;

  if (code) {
    ops.push(setDoc(doc(db, MAP_COLLECTION, idProvCode(proveedor, code)), {
      descripcion_proveedor: desc,
      clave_proveedor: code,
      proveedor: proveedor,
      clave_catalogo: it.clave_catalogo,
      desc_catalogo: it.desc_catalogo,
      ultima_actualizacion: serverTimestamp(),
      conteo_usos: increment(1)
    }, { merge:true }));
  }
  if (proveedor && desc) {
    ops.push(setDoc(doc(db, MAP_COLLECTION, idProvDesc(proveedor, desc)), {
      descripcion_proveedor: desc,
      proveedor: proveedor,
      clave_catalogo: it.clave_catalogo,
      desc_catalogo: it.desc_catalogo,
      ultima_actualizacion: serverTimestamp(),
      conteo_usos: increment(1)
    }, { merge:true }));
  }
  if (desc) {
    ops.push(setDoc(doc(db, MAP_COLLECTION, idDesc(desc)), {
      descripcion_proveedor: desc,
      clave_catalogo: it.clave_catalogo,
      desc_catalogo: it.desc_catalogo,
      ultima_actualizacion: serverTimestamp(),
      conteo_usos: increment(1)
    }, { merge:true }));
  }

  await Promise.all(ops);
}

/** Helper para persistir muchos ítems */
export async function persistMappingsForItems(db, proveedor, items=[]) {
  for (const it of items) {
    await persistMappingsForItem(db, proveedor, it);
  }
}