// /public/apps/caja_transferir.app.js
import { db } from '../firebase-init.js';
import { FIREBASE_BASE } from './lib/constants.js';
const {
  collection,
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
  query,
  where,
  getDocs,
  updateDoc
} = await import(`${FIREBASE_BASE}firebase-firestore.js`);
import { USD_TO_NIO_RATE } from '../constants.js';

const accountMappingsArray = [
  { id: 5,  name: "Ahorro Dólares CEF", moneda: "USD" },
  { id: 4,  name: "Ahorro Dólares EFV", moneda: "USD" },
  { id: 12, name: "Banpro ahorro", moneda: "NIO" },
  { id: 11, name: "Banpro Comercial", moneda: "NIO" },
  { id: 14, name: "Caja Bodegón", moneda: "NIO" },
  { id: 1,  name: "Caja central", moneda: "NIO" },
  { id: 10, name: "Caja Coperna", moneda: "NIO" },
  { id: 6,  name: "Caja Principal", moneda: "NIO" },
  { id: 8,  name: "Caja Sucursal", moneda: "NIO" },
  { id: 9,  name: "Caja Uge", moneda: "NIO" },
  { id: 7,  name: "Comodín", moneda: "NIO" },
  { id: 2,  name: "Cuenta corriente Bancentro", moneda: "NIO" },
  { id: 13, name: "Efectivo POS - Terminal Coperna", moneda: "NIO" },
  { id: 3,  name: "Tarjeta de crédito 1", moneda: "NIO" },
  { id: 15, name: "BAC córdobas", moneda: "NIO" }
];

/* ===================== Helpers ===================== */
function cleanAmount(amount) {
  if (amount === null || amount === undefined) return null;
  let s = String(amount).replace(/[^\d,.-]/g,'');
  // manejar formatos "1.234,56" vs "1,234.56"
  if (s.lastIndexOf(',') > s.lastIndexOf('.')) { s = s.replace(/\./g,'').replace(',','.'); }
  else { s = s.replace(/,/g,''); }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function normalizeConfirmation(s){
  if (!s) return null;
  const n = String(s).replace(/\D/g,'').replace(/^0+/, '');
  return n || null;
}
async function checkConfirmationExists(number) {
  const normalized = normalizeConfirmation(number);
  if (!normalized) return false;
  const variants = [normalized, ...Array.from({length:9},(_,i)=>'0'.repeat(i+1)+normalized)];
  try {
    const qy = query(collection(db,'transferencias'), where('numero_confirmacion','in', variants));
    const snap = await getDocs(qy);
    return !snap.empty;
  } catch(e){
    console.warn('checkConfirmationExists error:', e);
    return false;
  }
}
function accById(id){ return accountMappingsArray.find(a => a.id === Number(id)); }

/* ============ Renderers / Small UI utils ============ */
function currencySymbol(moneda){ return moneda === 'USD' ? '$' : 'C$'; }
function amountFmt(n, moneda){
  if (moneda === 'USD') return `${(Number(n)||0).toFixed(2)} USD`;
  return `C$ ${(Number(n)||0).toLocaleString('es-NI',{minimumFractionDigits:2})}`;
}
function optionsFor(accounts){ return accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join(''); }

/* ===================== Core create ===================== */
/**
 * Crea origen y destino (espejo) en una sola transacción.
 * - Si sourceDoc (id) está presente: NO crea origen, solo crea espejo y enlaza.
 * - Si no hay sourceDoc: crea ambos.
 */
async function createTransferPair({
  sourceDocId = null,
  fecha, tipoOrigen, bankOrigenId, montoOrigen, numero_confirmacion,
  observaciones, imageUrl = '', userId = null,
  bankDestinoId, rate = 1, montoDestino = null,
}) {

  const origenAcc = accById(bankOrigenId);
  const destinoAcc = accById(bankDestinoId);
  if (!origenAcc || !destinoAcc) throw new Error('Cuenta inválida.');
  if (Number(bankOrigenId) === Number(bankDestinoId)) throw new Error('Las cuentas deben ser distintas.');

  const oppositeType = tipoOrigen === 'in' ? 'out' : 'in';
  const sameCurrency = (origenAcc.moneda === destinoAcc.moneda);
  const cantidadOrigen = Number(montoOrigen);
  const cantidadDestino = sameCurrency ? cantidadOrigen : Number((cantidadOrigen * Number(rate)).toFixed(2));
  const numeroConfNorm = normalizeConfirmation(numero_confirmacion);

  // Dedupe: si ya existe numero_confirmacion, avisa (lo usamos igual en ambos)
  if (numeroConfNorm && await checkConfirmationExists(numeroConfNorm)) {
    throw new Error('El No. de confirmación ya existe.');
  }

  const transfersCol = collection(db, 'transferencias');
  const origenRef  = sourceDocId ? doc(db, 'transferencias', sourceDocId) : doc(transfersCol);
  const espejoRef  = doc(transfersCol);

  await runTransaction(db, async (tx) => {
    let origenData;
    if (sourceDocId) {
      const snap = await tx.get(origenRef);
      if (!snap.exists()) throw new Error('El registro original no existe.');
      origenData = snap.data();
      if (origenData.mirrorTransactionId) throw new Error('El original ya tiene espejo.');
      // moneda/monto exactos del original
      const destAcc = destinoAcc;
      if (origenData.moneda !== destAcc.moneda) {
        throw new Error('Para “desde existente”, la moneda destino debe coincidir con la del original.');
      }
      const espejoPayload = {
        fecha: origenData.fecha || fecha || null,
        tipo: (origenData.tipo === 'in') ? 'out' : 'in',
        moneda: origenData.moneda,
        cantidad: origenData.cantidad,
        bankAccountId: bankDestinoId,
        banco: destAcc.name,
        numero_confirmacion: origenData.numero_confirmacion || numeroConfNorm || null,
        observaciones: (`Transferencia interna (espejo de ${origenData.banco || origenData.bankAccountId} → ${destAcc.name}). ${origenData.observaciones||observaciones||''}`).trim(),
        alegraContactId: origenData.alegraContactId || null,
        alegraCategoryId: origenData.alegraCategoryId || null,
        imageUrl: origenData.imageUrl || imageUrl || '',
        status: 'pending_review',
        userId: origenData.userId || userId || null,
        isMirror: true,
        originalTransactionId: origenRef.id,
        createdAt: serverTimestamp()
      };
      tx.set(espejoRef, espejoPayload);
      tx.update(origenRef, { mirrorTransactionId: espejoRef.id, updatedAt: serverTimestamp() });
      return; // listo (solo espejo)
    }

    // Desde cero: crear ambos
    const origenPayload = {
      fecha: fecha || null,
      tipo: tipoOrigen,
      moneda: origenAcc.moneda,
      cantidad: cantidadOrigen,
      bankAccountId: bankOrigenId,
      banco: origenAcc.name,
      numero_confirmacion: numeroConfNorm || null,
      observaciones: observaciones?.trim() || '',
      alegraContactId: null,
      alegraCategoryId: null,
      imageUrl: imageUrl || '',
      status: 'pending_review',
      userId: userId || null,
      createdAt: serverTimestamp()
    };
    const espejoPayload = {
      fecha: fecha || null,
      tipo: oppositeType,
      moneda: destinoAcc.moneda,
      cantidad: sameCurrency ? cantidadOrigen : cantidadDestino,
      bankAccountId: bankDestinoId,
      banco: destinoAcc.name,
      numero_confirmacion: numeroConfNorm || null,
      observaciones: (`Transferencia interna (espejo de ${origenAcc.name} → ${destinoAcc.name}). ${observaciones||''}`).trim(),
      alegraContactId: null,
      alegraCategoryId: null,
      imageUrl: imageUrl || '',
      status: 'pending_review',
      userId: userId || null,
      isMirror: true,
      originalTransactionId: origenRef.id, // sabremos id local de origenRef (aunque aún no se setea)
      createdAt: serverTimestamp(),
      parejaMoneda: sameCurrency ? null : { from: origenAcc.moneda, to: destinoAcc.moneda, rate: Number(rate) }
    };

    // Set en transacción y link cruzado
    tx.set(origenRef, origenPayload);
    tx.set(espejoRef, espejoPayload);
    tx.update(origenRef, { mirrorTransactionId: espejoRef.id, updatedAt: serverTimestamp() });
  });

  return { origenId: origenRef.id, espejoId: espejoRef.id };
}

/* ===================== UI Module ===================== */
export default {
  async mount(container, { params }) {
    const sourceId = params.get('id') || null;
    let original = null;

    // Si viene id, precarga para modo "desde existente"
    if (sourceId) {
      const snap = await getDoc(doc(db, 'transferencias', sourceId));
      if (!snap.exists()) {
        container.innerHTML = `<div class="p-6 text-center text-slate-500">Registro original no encontrado.</div>`;
        return;
      }
      original = { id: sourceId, ...snap.data() };
    }

    // Listas de cuentas (para selects)
    const ordered = accountMappingsArray.slice().sort((a,b)=>a.name.localeCompare(b.name));
    const origenAcc = original ? accById(original.bankAccountId) : ordered[0];
    const origenMon = original ? original.moneda : (origenAcc?.moneda || 'NIO');

    const destCandidates = ordered.filter(a => !original || a.id !== original.bankAccountId);
    const defaultDest = destCandidates.find(a => a.moneda === (original?.moneda || origenMon)) || destCandidates[0];

    container.innerHTML = `
      <div class="max-w-3xl mx-auto p-4 md:p-6">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Transferencia interna</h1>
          <a href="${sourceId ? `#/caja_detalle?id=${encodeURIComponent(sourceId)}` : '#/caja_historial'}"
             class="px-3 py-2 bg-slate-100 text-slate-800 rounded-lg">Cancelar</a>
        </div>

        <form id="form" class="bg-white border rounded-2xl shadow-sm p-4 md:p-6 space-y-4">
          ${sourceId ? `
            <p class="text-sm text-slate-500 mb-2">Creará <strong>solo</strong> el movimiento espejo a partir del registro original (copiando todos los campos). Solo debes elegir la cuenta <strong>destino</strong>.</p>
          ` : `
            <p class="text-sm text-slate-500 mb-2">Crea una transferencia completa: <strong>origen</strong> y <strong>destino (espejo)</strong> en un solo paso.</p>
          `}

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- ORIGEN -->
            <div>
              <h2 class="font-semibold text-slate-800 mb-2">Origen</h2>
              <div class="space-y-3">
                <div>
                  <label class="text-sm text-slate-600">Fecha</label>
                  <input name="fecha" type="date" class="mt-1 block w-full rounded-md border p-2"
                         ${sourceId ? 'disabled' : ''} value="${original?.fecha || ''}" />
                </div>
                <div>
                  <label class="text-sm text-slate-600">Tipo</label>
                  ${sourceId ? `
                    <input type="text" disabled class="mt-1 block w-full rounded-md border p-2 bg-slate-50"
                      value="${original?.tipo === 'in' ? 'Entrada' : 'Salida'}" />
                    <input type="hidden" name="tipoOrigen" value="${original?.tipo || 'in'}" />
                  ` : `
                    <div class="mt-1 inline-flex rounded-lg overflow-hidden border">
                      <button type="button" data-tipo="in"  class="tipo-btn px-3 py-1 text-sm font-semibold bg-emerald-50 text-emerald-700">Entrada</button>
                      <button type="button" data-tipo="out" class="tipo-btn px-3 py-1 text-sm font-semibold bg-white text-slate-700">Salida</button>
                    </div>
                    <input type="hidden" name="tipoOrigen" value="in" />
                  `}
                </div>
                <div>
                  <label class="text-sm text-slate-600">Cuenta Origen</label>
                  ${sourceId ? `
                    <input type="text" disabled class="mt-1 block w-full rounded-md border p-2 bg-slate-50"
                      value="${original?.banco || ('ID '+original?.bankAccountId)}" />
                    <input type="hidden" name="bankOrigenId" value="${original?.bankAccountId}" />
                    <input type="hidden" name="monedaOrigen" value="${original?.moneda}" />
                  ` : `
                    <select name="bankOrigenId" class="mt-1 block w-full rounded-md border p-2">
                      ${optionsFor(ordered)}
                    </select>
                  `}
                </div>
                <div>
                  <label class="text-sm text-slate-600">Monto Origen</label>
                  ${sourceId ? `
                    <input type="text" disabled class="mt-1 block w-full rounded-md border p-2 bg-slate-50"
                      value="${amountFmt(original?.cantidad, original?.moneda)}" />
                    <input type="hidden" name="montoOrigen" value="${Number(original?.cantidad||0)}" />
                  ` : `
                    <div class="flex items-center gap-2">
                      <span id="symOrigen" class="font-semibold">${currencySymbol(origenMon)}</span>
                      <input name="montoOrigen" type="text" inputmode="decimal" placeholder="0.00"
                        class="flex-1 mt-1 block rounded-md border p-2" />
                    </div>
                  `}
                </div>
                <div>
                  <label class="text-sm text-slate-600">No. Confirmación</label>
                  <input name="numero_confirmacion" type="text" class="mt-1 block w-full rounded-md border p-2"
                         ${sourceId ? 'disabled' : ''} value="${original?.numero_confirmacion || ''}" />
                  <p id="confErr" class="text-xs text-rose-600 mt-1 hidden"></p>
                </div>
                <div>
                  <label class="text-sm text-slate-600">Observaciones</label>
                  <textarea name="observaciones" rows="2" class="mt-1 block w-full rounded-md border p-2"
                            ${sourceId ? 'disabled' : ''}>${original?.observaciones || ''}</textarea>
                </div>
              </div>
            </div>

            <!-- DESTINO -->
            <div>
              <h2 class="font-semibold text-slate-800 mb-2">Destino (espejo)</h2>
              <div class="space-y-3">
                <div>
                  <label class="text-sm text-slate-600">Cuenta Destino</label>
                  <select name="bankDestinoId" class="mt-1 block w-full rounded-md border p-2">
                    ${optionsFor(destCandidates)}
                  </select>
                </div>
                <div id="fxWrap" class="hidden">
                  <label class="text-sm text-slate-600">Tipo de cambio</label>
                  <input name="rate" type="number" step="0.0001" class="mt-1 block w-full rounded-md border p-2"
                         placeholder="p. ej. 36.6" />
                  <p class="text-xs text-slate-500 mt-1">Se usa solo cuando las monedas difieren. Destino = Origen × TC.</p>
                </div>
                <div>
                  <label class="text-sm text-slate-600">Monto Destino (preview)</label>
                  <input id="montoDestinoPreview" type="text" disabled
                         class="mt-1 block w-full rounded-md border p-2 bg-slate-50" />
                </div>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 pt-2">
            <button type="submit" class="px-4 py-2 bg-violet-600 text-white rounded-lg">
              ${sourceId ? 'Crear espejo' : 'Crear transferencia'}
            </button>
          </div>
        </form>
      </div>
    `;

    /* ===== Wiring ===== */
    const $ = s => container.querySelector(s);
    const form = $('#form');
    const bankOrigenSel = sourceId ? null : form.querySelector('select[name="bankOrigenId"]');
    const bankDestinoSel = form.querySelector('select[name="bankDestinoId"]');
    const tipoBtns = form.querySelectorAll('.tipo-btn');
    const tipoHidden = form.querySelector('input[name="tipoOrigen"]');
    const symOrigen = $('#symOrigen');
    const fxWrap = $('#fxWrap');
    const rateInput = form.querySelector('input[name="rate"]');
    const montoOrigenInput = form.querySelector('input[name="montoOrigen"]');
    const montoDestPrev = $('#montoDestinoPreview');
    const confInput = form.querySelector('input[name="numero_confirmacion"]');
    const confErr = $('#confErr');

    function currentOrigenAcc(){
      if (sourceId) return accById(original.bankAccountId);
      return accById((bankOrigenSel?.value) || ordered[0]?.id);
    }
    function currentDestinoAcc(){
      return accById(bankDestinoSel.value);
    }
    function refreshFXandPreview(){
      const oAcc = sourceId ? accById(original.bankAccountId) : currentOrigenAcc();
      const dAcc = currentDestinoAcc();
      const same = oAcc && dAcc && (oAcc.moneda === dAcc.moneda);
      fxWrap.classList.toggle('hidden', !!same);

      const montoO = sourceId ? Number(original.cantidad||0) : cleanAmount(montoOrigenInput.value);
      if (!oAcc || !dAcc || !montoO) {
        montoDestPrev.value = '';
        return;
      }
      if (same) {
        montoDestPrev.value = amountFmt(montoO, dAcc.moneda);
      } else {
        // default rate sugerido
        if (!rateInput.value) {
          rateInput.value =
            (oAcc.moneda==='USD' && dAcc.moneda==='NIO') ? USD_TO_NIO_RATE :
            (oAcc.moneda==='NIO' && dAcc.moneda==='USD') ? (1/USD_TO_NIO_RATE).toFixed(6) :
            1;
        }
        const r = Number(rateInput.value||1) || 1;
        const dest = Number((montoO * r).toFixed(2));
        montoDestPrev.value = amountFmt(dest, dAcc.moneda);
      }
      if (symOrigen && !sourceId) symOrigen.textContent = currencySymbol(oAcc?.moneda || 'NIO');
    }

    // eventos
    tipoBtns.forEach(btn=>{
      btn?.addEventListener('click', ()=>{
        if (sourceId) return;
        const t = btn.dataset.tipo;
        tipoHidden.value = t;
        tipoBtns.forEach(b=>{
          const isIn = b.dataset.tipo==='in';
          b.classList.toggle('bg-emerald-50', isIn && t==='in');
          b.classList.toggle('text-emerald-700', isIn && t==='in');
          b.classList.toggle('bg-white', !(isIn && t==='in'));
          b.classList.toggle('text-slate-700', !(isIn && t==='in'));
        });
      });
    });
    bankOrigenSel?.addEventListener('change', refreshFXandPreview);
    bankDestinoSel.addEventListener('change', refreshFXandPreview);
    rateInput?.addEventListener('input', refreshFXandPreview);
    montoOrigenInput?.addEventListener('input', refreshFXandPreview);

    confInput?.addEventListener('input', ()=>{
      confErr?.classList.add('hidden'); confErr.textContent='';
    });

    refreshFXandPreview(); // inicial

    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      try {
        const fd = new FormData(form);
        const fecha = sourceId ? (original.fecha || null) : (fd.get('fecha') || null);
        const tipoOrigen = sourceId ? (original.tipo || 'in') : (fd.get('tipoOrigen') || 'in');
        const bankOrigenId = sourceId ? original.bankAccountId : Number(fd.get('bankOrigenId'));
        const bankDestinoId = Number(fd.get('bankDestinoId'));
        const montoOrigen = sourceId ? Number(original.cantidad||0) : cleanAmount(fd.get('montoOrigen'));
        const numero_confirmacion = sourceId ? (original.numero_confirmacion || fd.get('numero_confirmacion')) : fd.get('numero_confirmacion');
        const observaciones = sourceId ? (original.observaciones || '') : (fd.get('observaciones') || '');

        if (!fecha && !sourceId) throw new Error('La fecha es obligatoria.');
        if (!bankOrigenId) throw new Error('Selecciona la cuenta origen.');
        if (!bankDestinoId) throw new Error('Selecciona la cuenta destino.');
        if (!montoOrigen || montoOrigen <= 0) throw new Error('Monto origen inválido.');

        const oAcc = accById(bankOrigenId);
        const dAcc = accById(bankDestinoId);
        const same = oAcc.moneda === dAcc.moneda;
        const rate = same ? 1 : Number(fd.get('rate')||0);
        if (!same && (!rate || rate<=0)) throw new Error('Tipo de cambio inválido.');

        const result = await createTransferPair({
          sourceDocId: sourceId,
          fecha,
          tipoOrigen,
          bankOrigenId,
          montoOrigen: Number(montoOrigen),
          numero_confirmacion,
          observaciones,
          imageUrl: '', userId: null,
          bankDestinoId,
          rate,
          montoDestino: null
        });

        // Redirige al detalle del origen (si se creó) o del espejo (si venía de id)
        if (sourceId) {
          location.hash = `#/caja_detalle?id=${encodeURIComponent(result.espejoId)}`;
        } else {
          location.hash = `#/caja_detalle?id=${encodeURIComponent(result.origenId)}`;
        }
      } catch (err) {
        if (confErr && /confirmaci/i.test(err.message)) {
          confErr.textContent = err.message; confErr.classList.remove('hidden');
        } else {
          alert(err.message);
        }
      }
    });
  },
  unmount() {}
};
