// apps/lib/recon_config.js
export const CONCILIABLE_ACCOUNT_IDS = new Set([2, 4, 5, 11, 15]);

// Ventana de fecha por defecto: [-3, +15] días (Alegra vs Banco)
export const DATE_WINDOW = { minDays: -3, maxDays: 15 };

// Tolerancia: max(C$5, 1% del monto banco)
export function tolerance(nioAmountFromBank) {
  const abs = Math.abs(Number(nioAmountFromBank) || 0);
  return Math.max(5, 0.01 * abs);
}

// LocalStorage key helper
export function buildStorageKey({ cuentaId, desdeISO, hastaISO }) {
  return `conciliacion:${cuentaId}:${desdeISO || 'na'}:${hastaISO || 'na'}`;
}

