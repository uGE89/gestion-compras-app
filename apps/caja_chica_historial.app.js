// /public/apps/caja_chica_historial.app.js
// Historial de Caja Chica (filtrado a una cuenta fija) + totales por filtros

import { auth, db } from '../firebase-init.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  collection, onSnapshot, doc, deleteDoc, query, orderBy,
  serverTimestamp, getDoc, updateDoc, where, getDocs, addDoc,
  limit, startAfter
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

export default {
  async mount(container, { appState }) {
    // ====== Config: ID fijo de cuenta de Caja Chica ======
    // 1) Si appState trae un id, úsalo; 2) o lee de ?bankId=; 3) o default 1 (Caja central)
    const urlParams = new URLSearchParams(location.hash.split('?')[1] || '');
    const PETTY_CASH_BANK_ID =
      Number(appState?.pettyCashBankId ?? urlParams.get('bankId')) || 1;

    const USD_TO_NIO_RATE = 36.6;

    // Mapeo rápido para mostrar el nombre en UI
    const accountMappingsArray = [
      { id: 5, name: "Ahorro Dólares CEF", color: "#388E3C", moneda: "USD" },
      { id: 4, name: "Ahorro Dólares EFV", color: "#388E3C", moneda: "USD" },
      { id: 12, name: "Banpro ahorro", color: "#6EA8FE", moneda: "NIO" },
      { id: 11, name: "Banpro Comercial", color: "#6EA8FE", moneda: "NIO" },
      { id: 14, name: "Caja Bodegón", color: "#81C784", moneda: "NIO" },
      { id: 1, name: "Caja central", color: "#2196F3", moneda: "NIO" },
      { id: 10, name: "Caja Coperna", color: "#4CAF50", moneda: "NIO" },
      { id: 6, name: "Caja Principal", color: "#1976D2", moneda: "NIO" },
      { id: 8, name: "Caja Sucursal", color: "#FFC107", moneda: "NIO" },
      { id: 9, name: "Caja Uge", color: "#FF9800", moneda: "NIO" },
      { id: 7, name: "Comodín", color: "#9E9E9E", moneda: "NIO" },
      { id: 2, name: "Cuenta corriente Bancentro", color: "#388E3C", moneda: "NIO" },
      { id: 13, name: "Efectivo POS - Terminal Coperna", color: "#795548", moneda: "NIO" },
      { id: 3, name: "Tarjeta de crédito 1", color: "#388E3C", moneda: "NIO" },
      { id: 15, name: "BAC córdobas", color: "#D32F2F", moneda: "NIO" }
    ];
    const pettyMeta = accountMappingsArray.find(a => a.id === PETTY_CASH_BANK_ID) || { name: `Cuenta #${PETTY_CASH_BANK_ID}`, color: '#64748b' };

    container.innerHTML = `
      <div class="p-4 md:p-6 max-w-6xl mx-auto">
        <header class="flex flex-col md:flex-row justify-between items-center mb-6">
          <div>
            <h1 class="text-3xl font-bold text-slate-900">Caja Chica</h1>
            <p class="text-slate-500 mt-1 flex items-center gap-2">
              <span class="inline-block w-3 h-3 rounded-full" style="background:${pettyMeta.color}"></span>
              <span>Cuenta fija: <strong>${pettyMeta.name}</strong> (ID: ${PETTY_CASH_BANK_ID})</span>
            </p>
          </div>
          <a href="#/caja_registrar" class="mt-3 md:mt-0 px-3 py-2 bg-blue-600 text-white rounded-lg">Nuevo</a>
        </header>

        <main class="bg-white p-6 md:p-8 rounded-2xl shadow-xl">
          <div class="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="rounded-xl border border-slate-200 p-4">
              <p class="text-xs uppercase tracking-wider text-slate-500">Ingresos (filtrados)</p>
              <p id="tot-in" class="text-2xl font-bold text-emerald-600">C$0.00</p>
            </div>
            <div class="rounded-xl border border-slate-200 p-4">
              <p class="text-xs uppercase tracking-wider text-slate-500">Retiros (filtrados)</p>
              <p id="tot-out" class="text-2xl font-bold text-red-600">C$0.00</p>
            </div>
            <div class="rounded-xl border border-slate-200 p-4">
              <p class="text-xs uppercase tracking-wider text-slate-500">Saldo (filtrado)</p>
              <p id="tot-balance" class="text-2xl font-bold text-slate-900">C$0.00</p>
            </div>
          </div>

          <h2 class="text-2xl font-bold text-slate-900 mb-4">Registros</h2>

          <div id="filters" class="grid grid-cols-1 md:grid-cols-12 gap-4 mb-6 items-end">
            <div class="md:col-span-3">
              <label class="block text-sm font-medium text-slate-700">Buscar</label>
              <input id="general-search" type="text" placeholder="Buscar..." class="mt-1 block w-full rounded-md border-slate-300 shadow-sm p-2">
            </div>
            <div class="md:col-span-2">
              <label class="block text-sm font-medium text-slate-700">Fecha</label>
              <input id="filter-date" type="date" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm p-2">
            </div>
            <!-- Banco fijo oculto, solo mostramos etiqueta -->
            <div class="md:col-span-2">
              <label class="block text-sm font-medium text-slate-700">Banco</label>
              <input type="text" value="${pettyMeta.name}" class="mt-1 block w-full rounded-md border-slate-200 bg-slate-50 text-slate-600 p-2" disabled>
            </div>
            <div class="md:col-span-2">
              <label class="block text-sm font-medium text-slate-700">Estado</label>
              <select id="filter-status" class="mt-1 block w-full rounded-md border-slate-300 shadow-sm p-2">
                <option value="">Todos</option>
                <option value="approved">Aprobado</option>
                <option value="pending_review">Pendiente</option>
              </select>
            </div>
          </div>

          <div id="history-list" class="space-y-4">
            <div id="history-loader" class="flex items-center justify-center py-10">
              <div class="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
              <p class="ml-3 text-slate-500">Cargando registros...</p>
            </div>
          </div>

          <div id="pager" class="mt-4 flex items-center justify-between">
            <button id="prevPage" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 disabled:opacity-50">Anterior</button>
            <div class="text-sm text-slate-600"><span id="pageLabel">Página 1</span></div>
            <button id="nextPage" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 disabled:opacity-50">Siguiente</button>
          </div>
        </main>
      </div>

      <div id="confirmation-modal" style="display:none" class="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
          <h3 class="text-lg font-bold text-slate-800">Confirmar Acción</h3>
          <p id="confirmation-message" class="text-slate-600 mt-2 mb-6">¿Estás seguro?</p>
          <div class="flex justify-end gap-4">
            <button id="confirm-cancel-btn" class="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancelar</button>
            <button id="confirm-ok-btn" class="px-4 py-2 text-white bg-red-600 hover:bg-red-700 rounded-lg">Confirmar</button>
          </div>
        </div>
      </div>

      <div id="toast-container" class="fixed bottom-4 right-4 z-50"></div>
    `;

    // ====== Refs UI
    const $ = s => container.querySelector(s);
    const historyList   = $('#history-list');
    const historyLoader = $('#history-loader');
    const pager         = $('#pager');
    const prevBtn       = $('#prevPage');
    const nextBtn       = $('#nextPage');
    const pageLabel     = $('#pageLabel');
    const filterDate      = $('#filter-date');
    const filterStatus    = $('#filter-status');
    const generalSearch   = $('#general-search');
    const totInEl         = $('#tot-in');
    const totOutEl        = $('#tot-out');
    const totBalEl        = $('#tot-balance');

    const modalEl = $('#confirmation-modal');
    const modalMsg = $('#confirmation-message');
    const modalCancel = $('#confirm-cancel-btn');
    const modalOk = $('#confirm-ok-btn');

    // ====== Estado
    const transfersCollection = collection(db, 'transferencias');
    const alegraContactsCollection = collection(db, 'alegra_contacts');
    const alegraCategoriesCollection = collection(db, 'alegra_categories');

    let alegraContactsCache = [];
    let alegraCategoriesCache = [];

    // Buscamos que “quepa el día” en una página.
    // Si tu día típico trae más de 500 movimientos, subilo aquí.
    const PAGE_SIZE = 500;
    let pageIndex = 0;
    let pageCursors = [];
    let currentUnsub = null;
    let currentRawDocs = [];

    function showModal(msg, onOk){
      modalMsg.textContent = msg;
      modalEl.style.display = 'flex';
      const okHandler = async () => { try{ await onOk?.(); } finally{ hideModal(); } };
      const cancelHandler = () => hideModal();
      modalOk.onclick = okHandler;
      modalCancel.onclick = cancelHandler;
      modalEl.onclick = (e)=>{ if(e.target===modalEl) hideModal(); };
      function hideModal(){
        modalEl.style.display = 'none';
        modalOk.onclick = null;
        modalCancel.onclick = null;
        modalEl.onclick = null;
      }
    }
    function toast(message, type='info'){
      const colors = { info:'bg-sky-500', success:'bg-emerald-500', error:'bg-red-500' };
      const div = document.createElement('div');
      div.className = `fixed bottom-4 right-4 ${colors[type]} text-white font-bold py-3 px-5 rounded-lg shadow-xl`;
      div.textContent = message;
      container.appendChild(div);
      setTimeout(()=>div.remove(), 2500);
    }

    function buildPageQuery() {
      // Para NO requerir índice compuesto:
      // - Solo igualdad por bankAccountId
      // - Sin orderBy('fecha')
      // - Sin where('status')
      // Luego ordenamos/filtramos por fecha y status en cliente.
      const qy = query(
        transfersCollection,
        where('bankAccountId', '==', Number(PETTY_CASH_BANK_ID)),
        limit(PAGE_SIZE)
      );
      return qy;
    }

    async function attachPage(page) {
      if (currentUnsub) { currentUnsub(); currentUnsub = null; }
      const qy = buildPageQuery();

      historyLoader.classList.remove('hidden');
      currentUnsub = onSnapshot(qy, (snap) => {
        historyLoader.classList.add('hidden');
        currentRawDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const lastDoc = snap.docs[snap.docs.length - 1] || null;
        pageCursors[page] = { lastDoc, size: snap.docs.length };
        renderWithClientFilters();
        updatePagerUI();
      });
    }

    onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      await loadInitialData();
    });

    async function loadInitialData(){
      try{
        const [contactsSnap, categoriesSnap] = await Promise.all([
          getDocs(query(alegraContactsCollection)),
          getDocs(query(alegraCategoriesCollection))
        ]);
        alegraContactsCache = contactsSnap.docs.map(d => ({id:d.id, ...d.data()}));
        alegraCategoriesCache = categoriesSnap.docs.map(d => ({id:d.id, ...d.data()}));

        // Fecha por defecto: HOY
        if (!filterDate.value) {
          const tz = new Date();
          const y = tz.getFullYear();
          const m = String(tz.getMonth()+1).padStart(2,'0');
          const d = String(tz.getDate()).padStart(2,'0');
          filterDate.value = `${y}-${m}-${d}`;
        }

        pageIndex = 0;
        pageCursors = [];
        await attachPage(pageIndex);
        // Los totales siempre salen de lo visible (renderWithClientFilters)
        renderWithClientFilters();
      } catch(err){
        console.error(err);
        toast('Error al cargar datos.', 'error');
      }
    }

    function cleanAmountToNIO(t){
      const base = Number(t.cantidad || 0);
      if (!base) return 0;
      return (t.moneda === 'USD') ? base * USD_TO_NIO_RATE : base;
    }

    function applyClientFilters(docs){
      // Aplica filtro de estado SOLO en cliente (evita índices)
      const statusFilter = (filterStatus.value || '').trim();
      const byStatus = statusFilter
        ? docs.filter(t => (t.status || '') === statusFilter)
        : docs.slice();

      // Un solo día. Si no hay valor, lo forzamos a HOY.
      const sel = filterDate.value;
      const dayStart = sel ? new Date(sel + 'T00:00:00') : null;
      const dayEnd   = sel ? new Date(sel + 'T23:59:59') : null;
      const term      = (generalSearch.value || '').trim().toLowerCase();

      const dateAndText = byStatus.filter(t => {
        // Fecha
        const dateValue = t.fecha ? new Date(t.fecha + 'T00:00:00')
          : (t.createdAt?.toDate ? t.createdAt.toDate() : null);
        if (dayStart && dateValue && dateValue < dayStart) return false;
        if (dayEnd   && dateValue && dateValue > dayEnd)   return false;

        // Búsqueda
        if (term){
          const contact  = alegraContactsCache.find(c => c.id === t.alegraContactId);
          const category = alegraCategoriesCache.find(c => c.id === t.alegraCategoryId);
          const haystack = [
            t.observaciones, t.banco, t.numero_confirmacion, String(t.cantidad),
            contact?.name, category?.name
          ].join(' ').toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      });

      // Orden por fecha DESC en cliente (evita orderBy compuesto)
      dateAndText.sort((a, b) => {
        const da = a.fecha ? new Date(a.fecha + 'T00:00:00') : (a.createdAt?.toDate ? a.createdAt.toDate() : 0);
        const db = b.fecha ? new Date(b.fecha + 'T00:00:00') : (b.createdAt?.toDate ? b.createdAt.toDate() : 0);
        return db - da;
      });

      return dateAndText;
    }

    function renderWithClientFilters(){
      const filtered = applyClientFilters(currentRawDocs);
      renderHistory(filtered);
      // Totales SIEMPRE sobre lo visible (lista filtrada actual)
      const quickTotals = computeTotals(filtered);
      paintTotals(quickTotals);
    }

    function computeTotals(list){
      let inSum = 0, outSum = 0;
      for (const t of list){
        const nio = cleanAmountToNIO(t);
        if (t.tipo === 'in') inSum += nio;
        else if (t.tipo === 'out') outSum += nio;
      }
      return { inSum, outSum, balance: inSum - outSum };
    }

    function paintTotals({inSum, outSum, balance}){
      const fmt = (n) => `C$${(n || 0).toFixed(2)}`;
      totInEl.textContent  = fmt(inSum);
      totOutEl.textContent = fmt(outSum);
      totBalEl.textContent = fmt(balance);
    }

    function updatePagerUI(){
      pageLabel.textContent = `Página ${pageIndex + 1}`;
      const size = pageCursors[pageIndex]?.size ?? 0;
      prevBtn.disabled = true; // normalmente no paginamos si cabe el día
      nextBtn.disabled = true;
    }

    prevBtn.addEventListener('click', () => {
      // deshabilitado
    });
    nextBtn.addEventListener('click', () => {
      // deshabilitado
    });

    // Render de tarjetas
    function renderHistory(list){
      if (!list.length){
        historyList.innerHTML = '<p class="text-center text-slate-500 py-8">No se encontraron registros.</p>';
        return;
      }
      const grouped = list.reduce((acc, t) => {
        const key = t.fecha || (t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : 'sin-fecha');
        (acc[key] ||= []).push(t);
        return acc;
      }, {});
      const dates = Object.keys(grouped).sort((a,b)=> new Date(b) - new Date(a));

      const html = dates.map(dateKey => {
        const header = `<div class="text-lg font-bold text-slate-600 py-2 sticky top-0 bg-white/80 backdrop-blur-sm z-10">${formatDateHeader(dateKey)}</div>`;
        const items = grouped[dateKey].map(renderCard).join('');
        return header + items;
      }).join('');

      historyList.innerHTML = html;
    }

    function formatDateHeader(dateString){
      const d = new Date(dateString + 'T00:00:00');
      const today = new Date();
      const y = new Date(); y.setDate(y.getDate()-1);
      if (d.toDateString() === today.toDateString())
        return `Hoy, ${d.toLocaleDateString('es-ES', { day:'numeric', month:'long' })}`;
      if (d.toDateString() === y.toDateString())
        return `Ayer, ${d.toLocaleDateString('es-ES', { day:'numeric', month:'long' })}`;
      return d.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
    }

    function renderCard(t){
      const statusBar = t.status === 'pending_review' ? 'bg-amber-400' : 'bg-green-500';
      const typeColor = t.tipo === 'in' ? 'text-green-600' : 'text-red-600';
      const bancoName = pettyMeta.name;
      const bancoColor = pettyMeta.color;
      const statusTag = t.status === 'pending_review'
        ? `<span class="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">Pendiente</span>`
        : `<span class="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 font-semibold">Aprobado</span>`;
      const contactName  = alegraContactsCache.find(c => c.id === t.alegraContactId)?.name || 'N/A';
      const categoryName = alegraCategoriesCache.find(c => c.id === t.alegraCategoryId)?.name || 'N/A';
      const mirrorTag = (t.isMirror ? `<span class="ml-2 text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-semibold">Espejo</span>` : '');
      const hasMirror = t.mirrorTransactionId || t.originalTransactionId;

      const formattedDate = t.fecha ? new Date(t.fecha + 'T00:00:00').toLocaleDateString('es-ES') : 'N/A';
      const nioAmount = cleanAmountToNIO(t);
      const amountHtml = `<span class="font-bold ${typeColor}">C$${nioAmount.toFixed(2)}</span>` +
        (t.moneda === 'USD' ? ` <span class="text-slate-400 text-xs">(${(t.cantidad||0).toFixed(2)} USD)</span>` : '');

      let extraInfo = '';
      if (t.status === 'approved'){
        if (t.numero_confirmacion) extraInfo += ` | <span class="font-medium">Conf:</span> ${t.numero_confirmacion}`;
        if (t.alegraPaymentId)     extraInfo += ` | <span class="font-medium">Alegra ID:</span> ${t.alegraPaymentId}`;
      }

      const viewBtn = `<a href="#/caja_detalle?id=${encodeURIComponent(t.id)}" class="view-btn bg-sky-100 hover:bg-sky-200 text-sky-800 font-bold py-2 px-3 rounded-lg text-sm"><span class="material-icons text-base">visibility</span> Ver</a>`;
      const editOrReviewBtn = (t.status === 'pending_review' && !hasMirror)
        ? `<a href="#/caja_editar?id=${encodeURIComponent(t.id)}" class="edit-btn bg-blue-100 hover:bg-blue-200 text-blue-800 font-bold py-2 px-3 rounded-lg text-sm"><span class="material-icons text-base">edit</span> Revisar</a>`
        : viewBtn;

      const approveBtn = t.status !== 'approved'
        ? `<button data-id="${t.id}" class="approve-btn bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-bold py-2 px-3 rounded-lg text-sm"><span class="material-icons text-base">check_circle</span> Aprobar</button>`
        : '';

      const printBtn = `<a href="#/caja_detalle?id=${encodeURIComponent(t.id)}" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium p-2 rounded-lg text-sm"><span class="material-icons text-base">print</span></a>`;
      const deleteBtn = `<button data-id="${t.id}" class="delete-btn bg-red-100 hover:bg-red-200 text-red-700 font-medium p-2 rounded-lg text-sm"><span class="material-icons text-base">delete</span></button>`;

      return `
        <div class="transaction-card bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
          <div class="p-4 flex flex-col sm:flex-row justify-between items-start gap-4">
            <div class="flex items-center gap-4 flex-grow">
              <div class="${statusBar} w-2 h-full self-stretch rounded-full flex-shrink-0"></div>
              <div>
                <p class="font-bold text-lg flex items-center" style="color:${bancoColor};">
                  ${bancoName} ${statusTag} ${mirrorTag}
                </p>
                <p class="text-sm text-slate-500">
                  <span class="font-medium">Fecha:</span> ${formattedDate} | ${amountHtml}${extraInfo}
                </p>
                <p class="text-xs text-slate-600 mt-1">
                  <span class="font-medium">Contacto:</span> ${contactName} |
                  <span class="font-medium">Categoría:</span> ${categoryName}
                </p>
              </div>
            </div>
            <div class="flex-shrink-0 self-end sm:self-center flex items-center gap-2">
              ${editOrReviewBtn}
              ${approveBtn}
              ${printBtn}
              ${deleteBtn}
            </div>
          </div>
        </div>
      `;
    }

    historyList.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      const id = btn.dataset.id;

      if (btn.classList.contains('approve-btn')) {
        showModal('¿Aprobar este registro?', async () => {
          await updateDoc(doc(db, transfersCollection.path, id), { status: 'approved', updatedAt: serverTimestamp() });
          toast('Registro aprobado.', 'success');
          renderWithClientFilters(); // refleja saldo si el filtro de estado aplica
        });
      } else if (btn.classList.contains('delete-btn')) {
        showModal('¿Eliminar este registro?', async () => {
          await deleteDoc(doc(db, transfersCollection.path, id));
          toast('Registro eliminado.', 'success');
          renderWithClientFilters();
        });
      }
    });
    
    // Filtros (texto/fecha) → re-render local (totales salen de lo visible)
    [generalSearch, filterDate].forEach(el => {
      el?.addEventListener('input', () => {
        renderWithClientFilters();
      });
    });
    // Filtro de estado cambia el query (pero totales siguen saliendo del render)
    filterStatus?.addEventListener('change', async () => {
      pageIndex = 0;
      pageCursors = [];
      await attachPage(pageIndex);
      renderWithClientFilters();
    });
  },

  unmount() {}
};
