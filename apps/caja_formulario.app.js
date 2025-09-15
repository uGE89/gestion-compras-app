// /public/apps/caja_formulario.app.js
// Registro manual de movimientos (sin IA)

import { auth, db } from '../firebase-init.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection, addDoc, serverTimestamp, doc, getDocs, query
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export default {
  async mount(container, { appState, params }) {
    const transfersCollection = collection(db, 'transferencias');
    const alegraContactsCollection = collection(db, 'alegra_contacts');
    const alegraCategoriesCollection = collection(db, 'alegra_categories');

    // Mapeo de cuentas (igual al historial)
    const accountMappingsArray = [
      { id: 5,  name: "Ahorro Dólares CEF", color: "#388E3C", moneda: "USD" },
      { id: 4,  name: "Ahorro Dólares EFV", color: "#388E3C", moneda: "USD" },
      { id: 12, name: "Banpro ahorro", color: "#6EA8FE", moneda: "NIO" },
      { id: 11, name: "Banpro Comercial", color: "#6EA8FE", moneda: "NIO" },
      { id: 14, name: "Caja Bodegón", color: "#81C784", moneda: "NIO" },
      { id: 1,  name: "Caja central", color: "#2196F3", moneda: "NIO" },
      { id: 10, name: "Caja Coperna", color: "#4CAF50", moneda: "NIO" },
      { id: 6,  name: "Caja Principal", color: "#1976D2", moneda: "NIO" },
      { id: 8,  name: "Caja Sucursal", color: "#FFC107", moneda: "NIO" },
      { id: 9,  name: "Caja Uge", color: "#FF9800", moneda: "NIO" },
      { id: 7,  name: "Comodín", color: "#9E9E9E", moneda: "NIO" },
      { id: 2,  name: "Cuenta corriente Bancentro", color: "#388E3C", moneda: "NIO" },
      { id: 13, name: "Efectivo POS - Terminal Coperna", color: "#795548", moneda: "NIO" },
      { id: 3,  name: "Tarjeta de crédito 1", color: "#388E3C", moneda: "NIO" },
      { id: 15, name: "BAC córdobas", color: "#D32F2F", moneda: "NIO" }
    ];

    const qpId = params?.get('bankId');
    const defaultBankId = (qpId && Number.isFinite(Number(qpId))) ? Number(qpId)
                         : (Number.isFinite(Number(appState?.pettyCashBankId)) ? Number(appState.pettyCashBankId) : 1);

    const todayISO = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth()+1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return `${y}-${m}-${day}`;
    })();

    container.innerHTML = `
      <div class="p-4 md:p-6 max-w-3xl mx-auto">
        <header class="mb-6 flex items-center justify-between">
          <h1 class="text-2xl font-bold text-slate-900">Nuevo movimiento (manual)</h1>
          <a href="#/caja_chica_historial?bankId=${defaultBankId}" class="text-sm px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">Ver historial</a>
        </header>

        <main class="bg-white rounded-2xl shadow-xl p-6 space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-700">Fecha</label>
              <input id="f-fecha" type="date" class="mt-1 w-full rounded-md border-slate-300 p-2" value="${todayISO}">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700">Tipo</label>
              <select id="f-tipo" class="mt-1 w-full rounded-md border-slate-300 p-2">
                <option value="in" selected>Entrada</option>
                <option value="out">Salida</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-slate-700">Moneda</label>
              <select id="f-moneda" class="mt-1 w-full rounded-md border-slate-300 p-2">
                <option value="NIO" selected>Córdobas (NIO)</option>
                <option value="USD">Dólares (USD)</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700">Cantidad</label>
              <input id="f-cantidad" type="number" step="0.01" min="0" class="mt-1 w-full rounded-md border-slate-300 p-2" placeholder="0.00">
            </div>

            <div class="md:col-span-2">
              <label class="block text-sm font-medium text-slate-700">Cuenta/Banco</label>
              <select id="f-banco" class="mt-1 w-full rounded-md border-slate-300 p-2"></select>
              <p id="f-banco-hint" class="text-xs text-slate-500 mt-1"></p>
            </div>

            <div>
              <label class="block text-sm font-medium text-slate-700">Estado</label>
              <select id="f-status" class="mt-1 w-full rounded-md border-slate-300 p-2">
                <option value="pending_review" selected>Pendiente</option>
                <option value="approved">Aprobado</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700">N.º Confirmación</label>
              <input id="f-numconf" type="text" class="mt-1 w-full rounded-md border-slate-300 p-2" placeholder="Referencia/confirmación">
            </div>

            <div>
              <label class="block text-sm font-medium text-slate-700">Contacto (Alegra)</label>
              <select id="f-contacto" class="mt-1 w-full rounded-md border-slate-300 p-2">
                <option value="">—</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700">Categoría (Alegra)</label>
              <select id="f-categoria" class="mt-1 w-full rounded-md border-slate-300 p-2">
                <option value="">—</option>
              </select>
            </div>

            <div class="md:col-span-2">
              <label class="block text-sm font-medium text-slate-700">Observaciones</label>
              <textarea id="f-observaciones" rows="3" class="mt-1 w-full rounded-md border-slate-300 p-2" placeholder="Notas, detalle del movimiento"></textarea>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <button id="btn-guardar" class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold">
              Guardar
            </button>
            <a href="#/caja_chica_historial?bankId=${defaultBankId}" class="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">Cancelar</a>
          </div>
        </main>
      </div>

      <div id="toast-container" class="fixed bottom-4 right-4 z-50"></div>
    `;

    // Refs
    const $ = s => container.querySelector(s);
    const fFecha  = $('#f-fecha');
    const fTipo   = $('#f-tipo');
    const fMoneda = $('#f-moneda');
    const fCant   = $('#f-cantidad');
    const fBanco  = $('#f-banco');
    const fBancoHint = $('#f-banco-hint');
    const fStatus = $('#f-status');
    const fNum    = $('#f-numconf');
    const fObs    = $('#f-observaciones');
    const fContacto = $('#f-contacto');
    const fCategoria = $('#f-categoria');
    const btnGuardar = $('#btn-guardar');

    // Helpers UI
    function toast(message, type='info'){
      const colors = { info:'bg-sky-500', success:'bg-emerald-500', error:'bg-red-500' };
      const div = document.createElement('div');
      div.className = `mb-2 ${colors[type]} text-white font-bold py-3 px-5 rounded-lg shadow-xl`;
      div.textContent = message;
      $('#toast-container').appendChild(div);
      setTimeout(()=>div.remove(), 2500);
    }

    // Poblar bancos
    fBanco.innerHTML = accountMappingsArray
      .slice().sort((a,b)=>a.name.localeCompare(b.name))
      .map(acc => `<option value="${acc.id}">${acc.name}</option>`).join('');
    fBanco.value = String(defaultBankId);
    const bankMeta = accountMappingsArray.find(a => a.id === Number(fBanco.value));
    fBancoHint.textContent = bankMeta ? `Moneda sugerida: ${bankMeta.moneda}` : '';

    fBanco.addEventListener('change', () => {
      const meta = accountMappingsArray.find(a => a.id === Number(fBanco.value));
      fBancoHint.textContent = meta ? `Moneda sugerida: ${meta.moneda}` : '';
    });

    // Cargar combos de Alegra
    let alegraContactsCache = [];
    let alegraCategoriesCache = [];
    try {
      const [cSnap, gSnap] = await Promise.all([
        getDocs(query(alegraContactsCollection)),
        getDocs(query(alegraCategoriesCollection))
      ]);
      alegraContactsCache = cSnap.docs.map(d => ({ id:d.id, ...d.data() }));
      alegraCategoriesCache = gSnap.docs.map(d => ({ id:d.id, ...d.data() }));
      fContacto.innerHTML += alegraContactsCache
        .slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''))
        .map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join('');
      fCategoria.innerHTML += alegraCategoriesCache
        .slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''))
        .map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join('');
    } catch (err) {
      console.error(err);
      toast('No se pudieron cargar Contactos/Categorías de Alegra.', 'error');
    }

    // Validación simple
    function readAndValidate(){
      const fecha = fFecha.value?.trim();
      const tipo  = fTipo.value;
      const moneda = fMoneda.value;
      const cantidad = Number(fCant.value);
      const bankAccountId = Number(fBanco.value);
      const status = fStatus.value;
      const numero_confirmacion = (fNum.value || '').trim();
      const observaciones = (fObs.value || '').trim();
      const alegraContactId = fContacto.value || '';
      const alegraCategoryId = fCategoria.value || '';

      if (!fecha) { toast('Definí la fecha.', 'error'); return null; }
      if (!tipo)  { toast('Elegí el tipo (Entrada/Salida).', 'error'); return null; }
      if (!moneda){ toast('Definí la moneda.', 'error'); return null; }
      if (!Number.isFinite(cantidad) || cantidad <= 0){ toast('Cantidad inválida.', 'error'); return null; }
      if (!Number.isFinite(bankAccountId)){ toast('Seleccioná una cuenta/banco.', 'error'); return null; }
      if (!status){ toast('Definí el estado.', 'error'); return null; }

      const bankMeta = accountMappingsArray.find(a => a.id === bankAccountId);
      const banco = bankMeta?.name || `Cuenta #${bankAccountId}`;
      const color = bankMeta?.color || '#64748b';

      return {
        fecha,
        tipo,                 // "in" / "out"
        moneda,               // "NIO" / "USD"
        cantidad,             // number
        bankAccountId,        // number
        banco, color,         // para mostrar fácil
        status,               // "pending_review" / "approved"
        numero_confirmacion,
        observaciones,
        alegraContactId: alegraContactId || null,
        alegraCategoryId: alegraCategoryId || null,
        alegraPaymentId: "",  // manual: vacío
        isMirror: false,
        originalTransactionId: null,
        mirrorTransactionId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
    }

    // Guardar
    btnGuardar.addEventListener('click', async () => {
      const payload = readAndValidate();
      if (!payload) return;

      btnGuardar.disabled = true;
      btnGuardar.textContent = 'Guardando...';

      try {
        await addDoc(transfersCollection, payload);
        toast('Movimiento guardado.', 'success');
        // Redirige al historial de la cuenta
        location.hash = `#/caja_chica_historial?bankId=${payload.bankAccountId}`;
      } catch (err) {
        console.error(err);
        toast('Error al guardar.', 'error');
      } finally {
        btnGuardar.disabled = false;
        btnGuardar.textContent = 'Guardar';
      }
    });

    // (opcional) armar prefills futuros desde params (placeholder para IA/espejo más adelante)
    // Ejemplo: ?tipo=out&moneda=USD&cantidad=10.5&fecha=2025-09-15&num=123
    const prefill = {
      tipo: params?.get('tipo'),
      moneda: params?.get('moneda'),
      cantidad: params?.get('cantidad'),
      fecha: params?.get('fecha'),
      num: params?.get('num'),
      obs: params?.get('obs'),
      contactId: params?.get('contactId'),
      categoryId: params?.get('categoryId')
    };
    if (prefill.fecha) fFecha.value = prefill.fecha;
    if (prefill.tipo)  fTipo.value = prefill.tipo;
    if (prefill.moneda) fMoneda.value = prefill.moneda;
    if (prefill.cantidad && !isNaN(Number(prefill.cantidad))) fCant.value = String(prefill.cantidad);
    if (prefill.num) fNum.value = prefill.num;
    if (prefill.obs) fObs.value = prefill.obs;
    if (prefill.contactId) fContacto.value = prefill.contactId;
    if (prefill.categoryId) fCategoria.value = prefill.categoryId;

    onAuthStateChanged(auth, (user) => {
      // Si más adelante bloqueás por auth, aquí lo validás
    });
  },

  unmount() {}
};
