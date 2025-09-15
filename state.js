// state.js
export const appState = {
  productCatalog: [],
  allProveedores: [],
  isCatalogReady: false,
  user: null,

  // ⬇️ nuevos borradores reutilizables
  pedidoDraft: null,      // { items: [...], proveedor, ... }
  cotizacionDraft: null,  // opcional, mismo patrón que pedidoDraft
};

// Claves de almacenamiento (versionadas por si cambias el formato)
export const KEYS = {
  pedido: 'pedidoDraft:v1',
  cotizacion: 'cotizacionDraft:v1',
};

// --- Hidratación al arrancar (lee sesión del navegador) ---
export function hydrateDrafts() {
  try {
    const pd = sessionStorage.getItem(KEYS.pedido);
    if (pd) appState.pedidoDraft = JSON.parse(pd);
  } catch {}
  try {
    const rfq = sessionStorage.getItem(KEYS.cotizacion);
    if (rfq) appState.cotizacionDraft = JSON.parse(rfq);
  } catch {}
}

// --- Guardar / limpiar pedidoDraft ---
export function savePedidoDraft() {
  try {
    if (appState.pedidoDraft)
      sessionStorage.setItem(KEYS.pedido, JSON.stringify(appState.pedidoDraft));
    else
      sessionStorage.removeItem(KEYS.pedido);
  } catch {}
}
export function clearPedidoDraft() {
  appState.pedidoDraft = null;
  try { sessionStorage.removeItem(KEYS.pedido); } catch {}
}

// --- Guardar / limpiar cotizacionDraft (opcional) ---
export function saveCotizacionDraft() {
  try {
    if (appState.cotizacionDraft)
      sessionStorage.setItem(KEYS.cotizacion, JSON.stringify(appState.cotizacionDraft));
    else
      sessionStorage.removeItem(KEYS.cotizacion);
  } catch {}
}
export function clearCotizacionDraft() {
  appState.cotizacionDraft = null;
  try { sessionStorage.removeItem(KEYS.cotizacion); } catch {}
}
