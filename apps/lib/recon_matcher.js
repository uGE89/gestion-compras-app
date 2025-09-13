// apps/lib/recon_matcher.js
import { DATE_WINDOW, tolerance } from './recon_config.js';
import { inDateWindow } from './recon_utils.js';
import { extractNumTokens6 } from './recon_parser.js';

// Construye índices de Alegra para T1/T2/T3
export function buildIndexes(A) {
  const byNotas = new Map();    // T1: exacto por Notas
  const byToken = new Map();    // T2: tokens >=6 en Notas
  const byDay = new Map();      // T3: key = `${cuentaId}|${signo}|${fecha}`

  const push = (map, key, val) => {
    if (!key) return;
    const arr = map.get(key) || []; arr.push(val); map.set(key, arr);
  };

  for (const a of A) {
    // T1
    if (a.notas) push(byNotas, a.notas.trim(), a);
    // T2 (indexar tokens en Notas de Alegra, que matchean contra tokens de Descripción banco)
    for (const t of extractNumTokens6(a.notas)) push(byToken, t, a);
    // T3
    const key = `${a.cuentaId}|${a.signo}|${a.fecha}`;
    push(byDay, key, a);
  }
  return { byNotas, byToken, byDay };
}

// Busca candidatos por tiers para un movimiento de Banco `b`
export function candidatesForBankRow(b, idx, { cuentaId, dateWindow = DATE_WINDOW }) {
  const out = [];

  // Helper para calificar un grupo de Alegra
  function qualify(group, tier) {
    if (!group || !group.length) return null;
    const suma = Number(group.reduce((acc, x) => acc + (x.valorNio || 0), 0).toFixed(2));
    const err = Number((suma - b.montoNio).toFixed(2));
    const okTol = Math.abs(err) <= tolerance(b.montoNio);
    const lagMax = group.reduce((m, x) => Math.max(m, dayDiff(x.fecha, b.fecha)), 0);
    return { tier, group, suma, err, okTol, lagMax };
  }

  // T1: por Notas exactas
  if (b.nroConfirm) {
    const arr = (idx.byNotas.get(b.nroConfirm) || []).filter(a => a.cuentaId === cuentaId && a.signo === b.signo && inDateWindow(a.fecha, b.fecha, dateWindow));
    if (arr.length) out.push(qualify(arr, 'T1-all'));
    // Además, prueba 1↔1 por exactitud de monto
    for (const a of arr) out.push(qualify([a], 'T1-1:1'));
  }

  // T2: tokens >=6 en Descripción banco ↔ tokens en Notas de Alegra
  const tokens = extractNumTokens6(b.descripcion);
  if (tokens.length) {
    const set = new Set();
    for (const t of tokens) {
      for (const a of (idx.byToken.get(t) || [])) {
        if (a.cuentaId !== cuentaId || a.signo !== b.signo) continue;
        if (!inDateWindow(a.fecha, b.fecha, dateWindow)) continue;
        set.add(a);
      }
    }
    const arr = Array.from(set);
    if (arr.length) {
      out.push(qualify(arr, 'T2-all'));
      for (const a of arr) out.push(qualify([a], 'T2-1:1'));
    }
  }

  // T3: fecha + signo (y luego tolerancia por monto)
  // Recorre ventana [-3..+15] días construyendo key diario
  const days = daySpan(dateWindow.minDays, dateWindow.maxDays);
  const daily = [];
  for (const d of days) {
    const key = `${cuentaId}|${b.signo}|${shiftISO(b.fecha, d)}`;
    const arr = idx.byDay.get(key);
    if (arr && arr.length) daily.push(...arr);
  }
  // Intentos T3 1:1
  for (const a of daily) out.push(qualify([a], 'T3-1:1'));

  // Greedy simple 1↔N (limitar a 20 candidatos más cercanos por monto)
  const sorted = daily
    .slice()
    .sort((x, y) => Math.abs(x.valorNio - b.montoNio) - Math.abs(y.valorNio - b.montoNio))
    .slice(0, 20);
  const grp = greedySum(sorted, b.montoNio, tolerance(b.montoNio));
  if (grp && grp.length) out.push(qualify(grp, 'T3-1:N-greedy'));

  // === De-duplicación por grupo (mismos Alegra IDs) y fusión de tiers ===
  const sig = (g) => g.map(x => x.id).sort().join('|');  // firma estable del grupo
  const merged = new Map();
  for (const cand of out.filter(Boolean)) {
    const k = sig(cand.group);
    const prev = merged.get(k);
    if (!prev) {
      merged.set(k, { ...cand, tiers: new Set([cand.tier]) });
    } else {
      // agrega tier y mejora métricas si este rankea mejor
      prev.tiers.add(cand.tier);
      if (rankScore(cand) < rankScore(prev)) {
        prev.suma = cand.suma;
        prev.err = cand.err;
        prev.okTol = cand.okTol;
        prev.lagMax = cand.lagMax;
      }
    }
  }
  // Ranking final (una entrada por grupo)
  const ranked = Array.from(merged.values())
    .map(x => ({ ...x, score: rankScore(x) }))
    .sort((a, b2) => a.score - b2.score);

  return ranked;
}

function dayDiff(aISO, bISO) {
  const a = new Date(aISO + 'T00:00:00');
  const b = new Date(bISO + 'T00:00:00');
  return Math.abs(Math.round((a - b) / 86400000));
}
function shiftISO(iso, d) {
  const dt = new Date(iso + 'T00:00:00');
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0,10);
}
function daySpan(min, max) {
  const arr = []; for (let i=min; i<=max; i++) arr.push(i); return arr;
}

function greedySum(cands, target, tol) {
  const res = [];
  let sum = 0;
  for (const c of cands) {
    const next = Number((sum + c.valorNio).toFixed(2));
    if (Math.abs(next - target) <= tol) { res.push(c); return res; }
    if (next < target + tol) { res.push(c); sum = next; }
  }
  return null;
}

// Ranking: tier primero, luego |err|, luego lag, luego tamaño grupo
function rankScore(x) {
  const tierW = { 'T1-1:1': 0, 'T1-all': 1, 'T2-1:1': 2, 'T2-all': 3, 'T3-1:1': 4, 'T3-1:N-greedy': 5 };
  const tiers = x.tiers ? Array.from(x.tiers) : [x.tier];
  const t = Math.min(...tiers.map(t => tierW[t] ?? 99));
  const e = Math.abs(x.err);
  const lag = x.lagMax;
  const k = x.group.length;
  return t*1e6 + e*1e3 + lag*10 + k; // prioridad: tier, error, lag, tamaño
}

