// apps/lib/recon_utils.js

// ===== Dinamic loader de CDNs (XLSX y PapaParse) =====
export async function ensureCDNs() {
  await loadIfMissing('XLSX', 'https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js');
  await loadIfMissing('Papa', 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js');
}

function loadIfMissing(globalName, src) {
  return new Promise((resolve, reject) => {
    if (window[globalName]) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = () => resolve(); s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ===== Parseo numérico en-US =====
export function parseNumberUS(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/,/g, '').trim(); // "5,360.00" -> "5360.00"
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ===== Fechas a ISO (YYYY-MM-DD) =====
export function toISODate(any) {
  if (!any) return null;
  if (any instanceof Date) return any.toISOString().slice(0,10);
  const s = String(any).trim();

  // === 1) dd/MMM/yyyy (ES o EN), acepta primeras o últimas 3 letras del mes
  const monthMap = {
    // Español
    ENE:'01', FEB:'02', MAR:'03', ABR:'04', MAY:'05', JUN:'06',
    JUL:'07', AGO:'08', SEP:'09', SET:'09', OCT:'10', NOV:'11', DIC:'12',
    // Inglés
    JAN:'01', APR:'04', AUG:'08', DEC:'12'
  };
  // Completar alias faltantes en inglés que coinciden con ES (FEB, MAR, MAY, JUN, JUL, SEP, OCT, NOV)
  Object.assign(monthMap, { FEB:'02', MAR:'03', MAY:'05', JUN:'06', JUL:'07', SEP:'09', OCT:'10', NOV:'11' });

  const mAlpha = s.match(/^(\d{1,2})[\/\-. ]([A-Za-z]{3,})[\/\-. ](\d{4})$/);
  if (mAlpha) {
    const dd = mAlpha[1].padStart(2, '0');
    const raw = mAlpha[2].toUpperCase();
    const y  = mAlpha[3];
    const keyA = raw.slice(0,3);      // primeras 3
    const keyB = raw.slice(-3);       // últimas 3 (por si ponen SEPT, MARCH, etc.)
    const mm = monthMap[keyA] || monthMap[keyB];
    if (mm) return `${y}-${mm}-${dd}`;
  }

  // === 2) Formato numérico d/m/yyyy (Alegra: ej. "4/9/2025"), admite -, . como separador
  const mNum = s.match(/^(\d{1,2})[\/\-. ](\d{1,2})[\/\-. ](\d{2,4})$/);
  if (mNum) {
    let d = parseInt(mNum[1], 10);
    let m = parseInt(mNum[2], 10);
    let y = parseInt(mNum[3], 10);
    if (y < 100) y += 2000;
    // Interpretación preferida: dd/mm/yyyy (Alegra usa día/mes/año)
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const dd = String(d).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      return `${y}-${mm}-${dd}`;
    }
  }

  // === 3) Fallback: confiar al Date parser
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0,10);
}

export function addDays(iso, delta) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0,10);
}

export function inDateWindow(alegraISO, bankISO, { minDays, maxDays }) {
  if (!alegraISO || !bankISO) return false;
  const a = new Date(alegraISO + 'T00:00:00');
  const b = new Date(bankISO + 'T00:00:00');
  const diffDays = Math.round((a - b) / 86400000);
  return diffDays >= (minDays || 0) && diffDays <= (maxDays || 0);
}

export function cryptoId(prefix='ID') {
  const r = Math.random().toString(36).slice(2, 8);
  const t = Date.now().toString(36).slice(-6);
  return `${prefix}-${t}${r}`;
}

// ===== Lectura de archivos =====
export async function readAnyTable(file) {
  if (!file) throw new Error('Archivo no proporcionado');
  try {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) return readCSV(file);
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) return readXLSX(file);
    // fallback: intenta por contenido
    if (file.type.includes('csv')) return readCSV(file);
    return readXLSX(file);
  } catch (err) {
    console.error('Error leyendo archivo', err);
    throw err;
  }
}

// CSV → detecta la fila que contiene "Fecha" y "Número de confirmación"
async function readCSV(file) {
  await ensureCDNs();
  try {
    let text;
    try {
      const buf = await file.arrayBuffer();
      text = new TextDecoder('iso-8859-1').decode(buf);
    } catch (e) {
      console.warn('Fallo al decodificar ArrayBuffer, usando file.text()', e);
      text = await file.text();
    }
    // Limpiar BOM y línea sep=
    text = text.replace(new RegExp('^\uFEFF'), '').replace(/^sep=.;?\r?\n/i, '');
    // Detectar delimitador en la primera línea con contenido
    const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const delimiter = semicolonCount > commaCount ? ';' : ',';
    const res = window.Papa.parse(text, {
      header: false,
      skipEmptyLines: true,
      delimiter,
    });
    const rows = res.data || [];
    return autoHeaderObjects(rows);
  } catch (err) {
    console.error('Error leyendo CSV', err);
    throw err;
  }
}

// XLS/XLSX → lee como matriz y reencabeza
async function readXLSX(file) {
  await ensureCDNs();
  try {
    const data = await file.arrayBuffer();
    const wb = window.XLSX.read(data, { type: 'array' });
    // Toma la primera hoja
    const wsName = wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const matrix = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return autoHeaderObjects(matrix);
  } catch (err) {
    console.error('Error leyendo XLSX', err);
    throw err;
  }
}

// ===== Reencabezado genérico: encuentra la fila con "Fecha" y "Número de confirmación"
export function autoHeaderObjects(matrixOrRows) {
  // Si ya viene como objetos con 'Fecha', devolver tal cual
  if (Array.isArray(matrixOrRows) && matrixOrRows.length && !Array.isArray(matrixOrRows[0])) {
    const maybe = matrixOrRows[0];
    const keys = Object.keys(maybe).map(k => k.toLowerCase());
    if (keys.some(k => k.includes('fecha'))) return matrixOrRows;
  }
  // Asegurar matriz (array de arrays)
  const M = Array.isArray(matrixOrRows[0]) ? matrixOrRows : matrixOrRows.map(row => Object.values(row));
  const isHeaderRow = (arr = []) => {
    const cells = arr.map(x => String(x || '').toLowerCase());
    const hasFecha = cells.some(c => c === 'fecha');
    const hasConfirm = cells.some(c => c.includes('número de confirmación') || c.includes('numero de confirmacion'));
    const hasCuenta = cells.some(c => c === 'cuenta');
    const hasValorNIO = cells.some(c => c === 'valor en nio');
    return hasFecha && (hasConfirm || (hasCuenta && hasValorNIO));
  };
  const hIdx = M.findIndex(isHeaderRow);
  const extractHeader = (arr = []) => {
    const raw = arr.map(x => String(x || '').trim());
    const selected = raw.map((h, i) => ({ h, i })).filter(({ h }) => h && !/^unnamed/i.test(h));
    return {
      header: selected.map(s => s.h),
      indices: selected.map(s => s.i),
    };
  };
  if (hIdx === -1) {
    // Fallback: usa la primera fila como encabezado
    const { header, indices } = extractHeader(M[0] || []);
    return M.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[indices[i]] ?? ''])));
  }
  const { header, indices } = extractHeader(M[hIdx] || []);
  const body = M.slice(hIdx + 1).map(r => indices.map(i => r[i]));
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

