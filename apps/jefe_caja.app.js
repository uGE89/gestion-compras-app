// /public/apps/jefe_caja.app.js
import { auth, db } from '../firebase-init.js';
import { appState as globalAppState } from '../state.js'; // ⬅️ fallback si el router no inyecta appState
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { showToast } from './lib/toast.js';

// ⛔️ Eliminado TARGET_ACCOUNTS fijo

const ACCOUNT_INFO = {
  1: { name: 'Caja central',   color: '#2563EB', currency: 'NIO' },
  6: { name: 'Caja Principal', color: '#1D4ED8', currency: 'NIO' },
  8: { name: 'Caja Sucursal',  color: '#F59E0B', currency: 'NIO' },
  10:{ name: 'Caja Coperna',   color: '#22C55E', currency: 'NIO' }
};

const NORMALIZE = (str) => (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const LOAN_CATEGORY_KEY = NORMALIZE('Préstamos a terceros');
const EFV_CONTACT_KEY   = NORMALIZE('Eugenio Flores Valdez');
const NUMBER_FORMAT = new Intl.NumberFormat('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function toDateValue(item) {
  if (!item) return null;
  try {
    if (typeof item === 'string') return item ? new Date(`${item}T00:00:00`) : null;
    if (item?.toDate) return item.toDate();
  } catch {}
  return null;
}
function formatDateLabel(isoDate) {
  if (!isoDate) return 'Sin fecha';
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return date.toLocaleDateString('es-NI', { weekday: 'short', day: 'numeric', month: 'short' });
}
function computeNioEquivalent(data) {
  if (data == null) return null;
  const direct = data.cantidadNIO;
  if (direct != null && !Number.isNaN(Number(direct))) return Number(direct);
  const fx = Number(data.fxRate), qty = Number(data.cantidad);
  if (!Number.isNaN(fx) && !Number.isNaN(qty)) return fx * qty;
  return null;
}
function formatAmount(data) {
  const qty = Number(data.cantidad) || 0;
  const nio = computeNioEquivalent(data);
  const currency = data.moneda || 'NIO';
  if (currency === 'USD') return `${NUMBER_FORMAT.format(qty)} USD${nio != null ? ` (C$${NUMBER_FORMAT.format(nio)})` : ''}`;
  if (currency === 'NIO') return `C$${NUMBER_FORMAT.format(qty)}`;
  return `${NUMBER_FORMAT.format(qty)} ${currency}`;
}
function buildSearchString(item) {
  return NORMALIZE([item.observaciones, item.contactName, item.categoryName].filter(Boolean).join(' '));
}
function decorateRecord(docSnap, helpers) {
  const data = docSnap.data();
  const isoDate = data.fecha || (data.createdAt?.toDate ? data.createdAt.toDate().toISOString().slice(0, 10) : null);
  const bankInfo = ACCOUNT_INFO[data.bankAccountId] || { name: `Cuenta ${data.bankAccountId ?? '—'}`, color: '#475569', currency: data.moneda || 'NIO' };
  const contactName  = helpers.getContactName(data.alegraContactId)  || data.contactName  || data.contacto  || '';
  const categoryName = helpers.getCategoryName(data.alegraCategoryId) || data.categoryName || data.category || data.categoria || '';
  const isLoan = NORMALIZE(categoryName) === LOAN_CATEGORY_KEY;
  const isEFV  = NORMALIZE(contactName)   === EFV_CONTACT_KEY;

  return {
    id: docSnap.id,
    ...data,
    isoDate,
    dateValue: isoDate ? toDateValue(isoDate) : toDateValue(data.createdAt),
    bankInfo,
    contactName,
    categoryName,
    isLoan,
    isEFV,
    nioEquivalent: computeNioEquivalent(data),
    amountLabel: formatAmount(data),
    searchHaystack: buildSearchString({ ...data, contactName, categoryName }),
    priorityGroup: isLoan ? (isEFV ? 0 : 1) : 2
  };
}

// === Helpers de usuario/cajas ===
function getActiveUsuario(appState) {
  return appState?.activeUsuario || globalAppState?.activeUsuario || null;
}
function extractAllowedBoxes(userDoc) {
  const candidates = [
    userDoc?.allowedBoxes,
    userDoc?.cajas,
    userDoc?.cajasAsignadas,
    userDoc?.allowedAccounts,
    userDoc?.boxIds
  ];
  const raw = candidates.find(a => Array.isArray(a)) || [];
  const ints = raw.map(v => parseInt(v, 10)).filter(n => Number.isInteger(n));
  return Array.from(new Set(ints));
}
async function resolveTargetAccounts(appState) {
  // 1) preferir el usuario activo inyectado (igual que allowedApps)
  const u = getActiveUsuario(appState);
  let allowed = u ? extractAllowedBoxes(u) : null;

  // 2) fallback: tomar el activo del localStorage y leer Firestore
  if (!allowed || allowed.length === 0) {
    const uid = localStorage.getItem('activeUsuarioId');
    if (uid) {
      const snap = await getDoc(doc(db, 'usuarios', uid));
      if (snap.exists()) allowed = extractAllowedBoxes(snap.data());
    }
  }
  return allowed || [];
}

// Utilidad: partir en trozos de tamaño N (para where-in máx 10)
const chunk = (arr, n = 10) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export default {
  async mount(container, { appState } = {}) {      // ⬅️ ahora recibe appState
    this._isMounted = true;

    const root = document.createElement('div');
    root.className = 'min-h-screen bg-slate-100 pb-28';
    root.innerHTML = `
      <div class="max-w-4xl mx-auto flex flex-col gap-4 p-4">
        <header class="bg-white rounded-3xl shadow-lg p-4 sticky top-2 z-20">
          <div class="flex flex-col gap-3">
            <div>
              <h1 class="text-2xl font-bold text-slate-900">Movimientos del día</h1>
              <p class="text-sm text-slate-500">Aprobación rápida para tus cajas asignadas</p>
            </div>
            <div class="flex flex-col sm:flex-row gap-3">
              <button id="bulk-approve" class="flex-1 min-h-[52px] h-14 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl shadow-md flex items-center justify-center gap-2 transition disabled:opacity-60 disabled:cursor-not-allowed">
                <span class="material-icons text-lg">playlist_add_check</span>
                <span class="label">Aprobar visibles</span>
              </button>
              <button id="refresh" class="flex-1 sm:flex-none min-h-[52px] h-14 px-5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-2xl shadow-md flex items-center justify-center gap-2 transition disabled:opacity-60">
                <span class="material-icons text-lg">refresh</span>
                <span class="label">Actualizar</span>
              </button>
            </div>
          </div>
        </header>

        <section class="bg-white rounded-3xl shadow-lg p-4 space-y-4">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label class="flex flex-col text-sm font-medium text-slate-700">
              Fecha
              <input type="date" id="filter-date" class="mt-1 rounded-2xl border border-slate-300 px-3 py-3 text-base focus:ring-emerald-500 focus:border-emerald-500" />
            </label>
            <label class="flex flex-col text-sm font-medium text-slate-700">
              Estado
              <select id="filter-status" class="mt-1 rounded-2xl border border-slate-300 px-3 py-3 text-base focus:ring-emerald-500 focus:border-emerald-500">
                <option value="pending">Pendientes</option>
                <option value="all">Todos</option>
              </select>
            </label>
          </div>
          <label class="flex flex-col text-sm font-medium text-slate-700">
            Buscar
            <input type="search" id="filter-search" placeholder="Contacto, categoría u observaciones" class="mt-1 rounded-2xl border border-slate-300 px-3 py-3 text-base focus:ring-emerald-500 focus:border-emerald-500" />
          </label>
          <label class="flex items-center justify-between gap-3 bg-slate-100 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium text-slate-700">
            <span>Solo Préstamos a terceros</span>
            <input type="checkbox" id="filter-loans" class="h-5 w-5 accent-emerald-600" />
          </label>
          <label class="flex items-center justify-between gap-3 bg-slate-100 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium text-slate-700">
            <span>Solo Eugenio Flores Valdez</span>
            <input type="checkbox" id="filter-efv" class="h-5 w-5 accent-emerald-600" />
          </label>
        </section>

        <section id="summary" class="hidden bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-3xl px-4 py-3 text-sm"></section>

        <section id="movement-list" class="flex flex-col gap-3"></section>
      </div>

      <nav id="pager" class="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
        <button id="prev-page" class="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-100 text-slate-700 font-semibold disabled:opacity-60 disabled:cursor-not-allowed">
          <span class="material-icons text-base">chevron_left</span>
          <span>Anterior</span>
        </button>
        <div id="page-indicator" class="text-sm font-medium text-slate-600"></div>
        <button id="next-page" class="flex items-center gap-2 px-4 py-3 rounded-2xl bg-slate-100 text-slate-700 font-semibold disabled:opacity-60 disabled:cursor-not-allowed">
          <span>Siguiente</span>
          <span class="material-icons text-base">chevron_right</span>
        </button>
      </nav>
    `;

    container.innerHTML = '';
    container.appendChild(root);

    const refs = {
      root,
      list: root.querySelector('#movement-list'),
      summary: root.querySelector('#summary'),
      bulkApprove: root.querySelector('#bulk-approve'),
      refresh: root.querySelector('#refresh'),
      date: root.querySelector('#filter-date'),
      status: root.querySelector('#filter-status'),
      search: root.querySelector('#filter-search'),
      onlyLoans: root.querySelector('#filter-loans'),
      onlyEFV: root.querySelector('#filter-efv'),
      prev: root.querySelector('#prev-page'),
      next: root.querySelector('#next-page'),
      pageIndicator: root.querySelector('#page-indicator'),
      pager: root.querySelector('#pager')
    };

    const helpers = {
      contactCache: new Map(),
      categoryCache: new Map(),
      getContactName: (id) => {
        if (!id && id !== 0) return '';
        const key = String(id);
        return helpers.contactCache.get(key)?.name || helpers.contactCache.get(key)?.displayName || helpers.contactCache.get(key)?.nombre || helpers.contactCache.get(key)?.value || helpers.contactCache.get(key)?.label || '';
      },
      getCategoryName: (id) => {
        if (!id && id !== 0) return '';
        const key = String(id);
        return helpers.categoryCache.get(key)?.name || helpers.categoryCache.get(key)?.nombre || helpers.categoryCache.get(key)?.value || helpers.categoryCache.get(key)?.label || '';
      }
    };

    const today = new Date().toISOString().slice(0, 10);
    refs.date.value = today;

    const state = {
      raw: [],
      filtered: [],
      pageIndex: 0,
      pageSize: 10,
      isFetching: false,
      bulkBusy: false,
      lastPageItems: [],
      targetAccounts: [],
      allowedSet: new Set()  // ⬅️ para filtro cliente robusto
    };

    const detachments = [];
    const attach = (el, ev, handler) => { el.addEventListener(ev, handler); detachments.push(() => el.removeEventListener(ev, handler)); };

    const setLoading = (isLoading) => {
      state.isFetching = isLoading;
      refs.refresh.disabled = isLoading;
      refs.refresh.querySelector('.label').textContent = isLoading ? 'Actualizando…' : 'Actualizar';
      if (isLoading) {
        refs.list.innerHTML = '<div class="flex flex-col items-center justify-center py-12 text-slate-500"><div class="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3"></div><p>Cargando movimientos…</p></div>';
      }
    };
    const updateSummary = () => {
      if (!state.raw.length) { refs.summary.classList.add('hidden'); return; }
      const text = `Total cargado: ${state.raw.length} • Coincidencias: ${state.filtered.length}`;
      refs.summary.textContent = text;
      refs.summary.classList.remove('hidden');
    };
    const ensurePageInBounds = () => {
      const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
      if (state.pageIndex >= totalPages) state.pageIndex = totalPages - 1;
      if (state.pageIndex < 0) state.pageIndex = 0;
      refs.prev.disabled = state.pageIndex === 0;
      refs.next.disabled = state.pageIndex >= totalPages - 1 || state.filtered.length === 0;
      refs.pageIndicator.textContent = state.filtered.length ? `Página ${state.pageIndex + 1} de ${totalPages}` : 'Sin resultados';
    };
    const updateBulkButtonState = () => {
      const visiblePending = state.lastPageItems.filter(item => item.status === 'pending_review');
      const label = visiblePending.length ? `Aprobar visibles (${visiblePending.length})` : 'Aprobar visibles';
      refs.bulkApprove.querySelector('.label').textContent = state.bulkBusy ? 'Aprobando…' : label;
      refs.bulkApprove.disabled = state.bulkBusy || visiblePending.length === 0;
    };
    const renderList = () => {
      ensurePageInBounds();
      const start = state.pageIndex * state.pageSize;
      const items = state.filtered.slice(start, start + state.pageSize);
      state.lastPageItems = items;

      if (!items.length) {
        refs.list.innerHTML = state.raw.length
          ? '<div class="bg-white rounded-3xl shadow-inner p-6 text-center text-slate-500">No hay movimientos que coincidan con los filtros.</div>'
          : '<div class="bg-white rounded-3xl shadow-inner p-6 text-center text-slate-500">Sin registros para mostrar.</div>';
        updateBulkButtonState();
        return;
      }

      const cards = items.map(item => {
        const statusClass = item.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700';
        const statusLabel = item.status === 'approved' ? 'Aprobado' : 'Pendiente';
        const efvBadge = item.isEFV ? '<span class="text-xs font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Eugenio F. Valdez</span>' : '';
        const loanBadge = item.isLoan ? '<span class="text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700">Préstamo a terceros</span>' : '';
        const cardBorder = item.isLoan && item.isEFV ? 'border-emerald-400 ring-2 ring-emerald-200' : (item.isLoan ? 'border-amber-300' : 'border-slate-200');
        const confirmation = item.numero_confirmacion || 'Sin confirmación';
        const observations = item.observaciones ? `<div><span class="font-semibold text-slate-700">Observaciones:</span> ${item.observaciones}</div>` : '';
        const nioText = item.moneda === 'USD' && item.nioEquivalent != null ? `<div class="text-xs text-slate-500">Equivalente estimado: C$${NUMBER_FORMAT.format(item.nioEquivalent)}</div>` : '';
        return `
          <article class="bg-white border ${cardBorder} rounded-3xl shadow-md overflow-hidden">
            <div class="p-4 flex flex-col gap-3">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-3 py-1 rounded-full text-xs font-semibold text-white" style="background:${item.bankInfo.color}">${item.bankInfo.name}</span>
                <span class="px-3 py-1 rounded-full text-xs font-semibold ${statusClass}">${statusLabel}</span>
                ${loanBadge}${efvBadge}
              </div>
              <div class="flex flex-col gap-1">
                <div class="text-sm text-slate-500">${formatDateLabel(item.isoDate)}</div>
                <div class="text-xl font-bold text-slate-900">${item.amountLabel}</div>
                ${nioText}
              </div>
              <div class="text-sm text-slate-600 space-y-1">
                <div><span class="font-semibold text-slate-700">Contacto:</span> ${item.contactName || 'Sin contacto'}</div>
                <div><span class="font-semibold text-slate-700">Categoría:</span> ${item.categoryName || 'Sin categoría'}</div>
                <div><span class="font-semibold text-slate-700">Confirmación:</span> ${confirmation}</div>
                ${observations}
              </div>
              <div class="flex gap-3">
                ${item.status === 'approved'
                  ? '<button class="flex-1 min-h-[48px] h-12 rounded-2xl bg-emerald-50 text-emerald-600 font-semibold" disabled>Aprobado</button>'
                  : `<button data-action="approve" data-id="${item.id}" class="approve-btn flex-1 min-h-[52px] h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center justify-center gap-2 transition">
                      <span class="material-icons text-lg">check_circle</span><span>Aprobar</span>
                    </button>`}
              </div>
            </div>
          </article>`;
      }).join('');

      refs.list.innerHTML = cards;
      updateBulkButtonState();
    };
    const sortRecords = (records) => {
      return records.slice().sort((a, b) => {
        if (a.priorityGroup !== b.priorityGroup) return a.priorityGroup - b.priorityGroup;
        const at = a.dateValue ? a.dateValue.getTime() : 0;
        const bt = b.dateValue ? b.dateValue.getTime() : 0;
        if (at !== bt) return bt - at;
        return a.id.localeCompare(b.id);
      });
    };
    const applyFilters = ({ resetPage = false } = {}) => {
      if (resetPage) state.pageIndex = 0;
      const dateValue = refs.date.value;
      const statusFilter = refs.status.value;
      const term = NORMALIZE(refs.search.value.trim());
      const onlyLoans = refs.onlyLoans.checked;
      const onlyEFV = refs.onlyEFV.checked;

      state.filtered = state.raw.filter(item => {
        // 🔒 Filtro cliente duro por cajas permitidas (por si algo coló)
        const bankIdInt = Number.isInteger(item.bankAccountId)
          ? item.bankAccountId
          : parseInt(item.bankAccountId, 10);
        if (!state.allowedSet.has(bankIdInt)) return false;
        
        if (dateValue && item.isoDate !== dateValue) return false;      // 1 día exacto
        if (statusFilter === 'pending' && item.status !== 'pending_review') return false;
        if (onlyLoans && !item.isLoan) return false;
        if (onlyEFV && !item.isEFV) return false;
        if (term && !item.searchHaystack.includes(term)) return false;
        return true;
      });

      state.filtered = sortRecords(state.filtered);
      updateSummary();
      renderList();
    };

    const fetchContactsAndCategories = async () => {
      try {
        const [contactsSnap, categoriesSnap] = await Promise.all([
          getDocs(collection(db, 'alegra_contacts')),
          getDocs(collection(db, 'alegra_categories'))
        ]);
        contactsSnap.forEach(d => helpers.contactCache.set(d.id, d.data()));
        categoriesSnap.forEach(d => helpers.categoryCache.set(d.id, d.data()));
      } catch (err) { console.warn('Error cargando catálogos Alegra', err); }
    };

    const fetchMovements = async () => {
      if (state.isFetching) return;
      setLoading(true);
      try {
        await fetchContactsAndCategories();

        // 🔑 cuentas permitidas del usuario activo
        state.targetAccounts = await resolveTargetAccounts(appState);
        state.allowedSet = new Set(state.targetAccounts);

        if (!state.targetAccounts.length) {
          refs.list.innerHTML = `
            <div class="bg-white rounded-3xl shadow-inner p-6 text-center text-slate-500">
              No tienes <b>cajas</b> asignadas para revisar. Pide a un administrador que configure <code>allowedBoxes</code> en tu usuario.
            </div>`;
          state.raw = [];
          applyFilters({ resetPage: true });
          return;
        }

        // Consulta robusta: si bankAccountId está como número O como string en Firestore
        const transfersRef = collection(db, 'transferencias');
        const partsNum = chunk(state.targetAccounts, 10);
        const partsStr = chunk(state.targetAccounts.map(n => String(n)), 10);

        let allDocs = [];
        // 1) Consulta con IDs numéricos
        for (const ids of partsNum) {
          const qy = query(transfersRef, where('bankAccountId', 'in', ids), limit(1000));
          const snap = await getDocs(qy);
          allDocs = allDocs.concat(snap.docs);
        }
        // 2) Consulta con IDs como string
        for (const ids of partsStr) {
          const qy = query(transfersRef, where('bankAccountId', 'in', ids), limit(1000));
          const snap = await getDocs(qy);
          allDocs = allDocs.concat(snap.docs);
        }
        
        // De-duplicar resultados por ID de documento
        const byId = new Map();
        allDocs.forEach(d => byId.set(d.id, d));

        state.raw = Array.from(byId.values()).map(docSnap => decorateRecord(docSnap, helpers));
        applyFilters({ resetPage: true });
      } catch (err) {
        console.error('Error al obtener movimientos', err);
        showToast('No se pudieron cargar los movimientos.', 'error');
        refs.list.innerHTML = '<div class="bg-white rounded-3xl shadow-inner p-6 text-center text-red-500">Error al cargar movimientos.</div>';
      } finally {
        setLoading(false);
        updateBulkButtonState();
      }
    };

    const approveIds = async (ids) => {
      if (!ids.length) return;
      const user = auth.currentUser;
      const approvedBy = user?.displayName || user?.email || user?.uid || 'jefe_caja';
      try {
        const batch = writeBatch(db);
        ids.forEach(id => {
          const ref = doc(db, 'transferencias', id);
          batch.update(ref, { status: 'approved', approvedBy, approvedAt: serverTimestamp() });
        });
        await batch.commit();
        state.raw = state.raw.map(item => ids.includes(item.id) ? { ...item, status: 'approved' } : item);
        applyFilters();
        showToast(ids.length > 1 ? `Se aprobaron ${ids.length} movimientos.` : 'Movimiento aprobado.');
      } catch (err) {
        console.error('Error aprobando movimientos', err);
        showToast('No se pudo aprobar. Intenta nuevamente.', 'error');
      }
    };

    // Eventos
    attach(refs.refresh, 'click', () => fetchMovements());
    attach(refs.prev, 'click', () => { if (state.pageIndex > 0) { state.pageIndex -= 1; renderList(); } });
    attach(refs.next, 'click', () => {
      const totalPages = Math.ceil(state.filtered.length / state.pageSize);
      if (state.pageIndex < totalPages - 1) { state.pageIndex += 1; renderList(); }
    });

    [refs.date, refs.status, refs.onlyLoans, refs.onlyEFV].forEach(input => attach(input, 'change', () => applyFilters({ resetPage: true })));
    attach(refs.search, 'input', () => applyFilters({ resetPage: true }));

    attach(refs.bulkApprove, 'click', async () => {
      const pendingIds = state.lastPageItems.filter(item => item.status === 'pending_review').map(item => item.id);
      if (!pendingIds.length) return;
      state.bulkBusy = true; updateBulkButtonState();
      await approveIds(pendingIds);
      state.bulkBusy = false; updateBulkButtonState();
    });

    attach(refs.list, 'click', async (event) => {
      const button = event.target.closest('button[data-action="approve"]');
      if (!button) return;
      const id = button.getAttribute('data-id');
      if (!id) return;
      button.disabled = true;
      button.innerHTML = '<span class="material-icons text-lg animate-spin">autorenew</span><span>Procesando…</span>';
      await approveIds([id]);
    });

    this._cleanup = () => { this._isMounted = false; detachments.forEach(fn => fn()); };

    // Primer fetch
    fetchMovements();
  },
  unmount() { if (this._cleanup) this._cleanup(); }
};
