// apps/lib/recon_parser.js
import { CONCILIABLE_ACCOUNT_IDS } from './recon_config.js';
import { parseNumberUS, toISODate, cryptoId } from './recon_utils.js';

// Mapeo nombre→id para Alegra.Cuenta
export function buildAccountNameToIdMap(cuentasArray) {
  const norm = s => s?.toString().trim().toLowerCase().replace(/\s+/g, ' ') || '';
  const map = new Map();
  for (const c of (cuentasArray || [])) map.set(norm(c.nombre), Number(c.id));
  return { getIdByName: (name) => map.get(norm(name)) ?? null };
}

// Normaliza y **filtra temprano** Alegra a cuentas conciliables y (opcional) a la cuenta elegida.
export function normalizeAndFilterAlegra(rowsAlegra, cuentasArray, selectedCuentaId=null) {
  const { getIdByName } = buildAccountNameToIdMap(cuentasArray);
  const out = [];
  for (const r of rowsAlegra || []) {
    const cuentaId = getIdByName(r['Cuenta']);
    if (!cuentaId) continue;
    if (!CONCILIABLE_ACCOUNT_IDS.has(cuentaId)) continue; // solo conciliables
    if (selectedCuentaId && cuentaId !== Number(selectedCuentaId)) continue; // solo la cuenta elegida

    const tipo = (r['Tipo'] || '').toString().toLowerCase();
    const signo = tipo.includes('ingreso') ? 'in' : (tipo.includes('egreso') ? 'out' : null);

    out.push({
      id: String(r['Número'] ?? '').trim() || cryptoId('A'), // no se usa para T1
      cuentaId,
      fecha: toISODate(r['Fecha']),
      notas: (r['Notas'] || '').toString(),       // T1: Banco.NumConfirm ↔ Alegra.Notas
      observaciones: (r['Observaciones'] || '').toString(), // T2: tokens >=6 dígitos
      valorNio: parseNumberUS(r['Valor En NIO']),
      signo, // 'in'|'out'|null
      raw: r,
    });
  }
  return out;
}

// Normaliza Banco (encabezado puede venir más arriba; asumimos rows ya vienen con encabezados correctos)
export function normalizeBanco(rowsBanco, { cuentaId, tipoCambio=1 }) {
  const out = [];
  let minDate = null, maxDate = null;
  for (const r of rowsBanco || []) {
    const fecha = toISODate(r['Fecha']);
    if (!fecha) continue;
    const confirm = (r['Número de confirmación'] || r['Numero de confirmacion'] || r['NroConfirmacion'] || '').toString().trim();
    const descripcion = (r['Descripción'] || r['Descripcion'] || '').toString();
    const deb = parseNumberUS(r['Débito'] || r['Debito']);
    const cred = parseNumberUS(r['Crédito'] || r['Credito']);

    // Signo Banco: Crédito=in, Débito=out
    const signo = cred > 0 ? 'in' : (deb > 0 ? 'out' : null);
    const montoNio = (cred > 0 ? cred : -deb) * (Number(tipoCambio) || 1);

    const row = {
      id: cryptoId('B'),
      cuentaId: Number(cuentaId),
      fecha,
      nroConfirm: confirm,
      descripcion,
      montoNio: Number(montoNio.toFixed(2)),
      signo,
      raw: r,
    };
    out.push(row);

    if (!minDate || fecha < minDate) minDate = fecha;
    if (!maxDate || fecha > maxDate) maxDate = fecha;
  }
  return { rows: out, desde: minDate, hasta: maxDate };
}

// Extrae tokens numéricos >=6 dígitos desde un texto
export function extractNumTokens6(text) {
  const s = (text || '').toString();
  const tokens = new Set();
  const re = /(\d{6,})/g;
  let m; while ((m = re.exec(s))) tokens.add(m[1]);
  return Array.from(tokens);
}

