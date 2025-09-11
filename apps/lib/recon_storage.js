// apps/lib/recon_storage.js
import { buildStorageKey } from './recon_config.js';

export function loadSession({ cuentaId, desdeISO, hastaISO }) {
  const key = buildStorageKey({ cuentaId, desdeISO, hastaISO });
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}

export function saveSession({ cuentaId, desdeISO, hastaISO }, stateObj) {
  const key = buildStorageKey({ cuentaId, desdeISO, hastaISO });
  localStorage.setItem(key, JSON.stringify(stateObj));
}

