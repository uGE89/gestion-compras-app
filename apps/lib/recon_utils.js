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
  // Intenta formatos comunes (incluye 03/SEP/2025 del banco)
  const monthMap = {
    'ENE':'01','FEB':'02','MAR':'03','ABR':'04','MAY':'05','JUN':'06',
    'JUL':'07','AGO':'08','SEP':'09','SET':'09','OCT':'10','NOV':'11','DIC':'12'
  };
  const m1 = s.match(/^(\d{2})\/(\w{3})\/(\d{4})$/i);
  if (m1) {
    const dd = m1[1], mmm = m1[2].toUpperCase(), yyyy = m1[3];
    const mm = monthMap[mmm] || null;
    if (mm) return `${yyyy}-${mm}-${dd}`;
  }
  // fallback Date
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
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return readCSV(file);
  if (name.endsWith('.xls') || name.endsWith('.xlsx')) return readXLSX(file);
  // fallback: intenta por contenido
  if (file.type.includes('csv')) return readCSV(file);
  return readXLSX(file);
}

async function readCSV(file) {
  await ensureCDNs();
  return new Promise((resolve, reject) => {
    window.Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data || []),
      error: reject,
    });
  });
}

async function readXLSX(file) {
  await ensureCDNs();
  const data = await file.arrayBuffer();
  const wb = window.XLSX.read(data, { type: 'array' });
  // Toma la primera hoja
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];
  const rows = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows;
}

