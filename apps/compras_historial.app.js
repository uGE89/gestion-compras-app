// apps/compras_historial.app.js
import { SearchBar, Paginator } from '../framework/components.js';
import { FIREBASE_BASE } from './lib/constants.js';
const {
  collection,
  query,
  orderBy,
  onSnapshot,
  where
} = await import(`${FIREBASE_BASE}firebase-firestore.js`);

export default {
  title: 'Historial de Compras',
  async mount(container, { appState, db, navigate }) {
    const root = document.createElement('div');
    root.className = 'max-w-7xl mx-auto p-4 md:p-6';
    root.innerHTML = `
      <header class="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Historial de Compras</h1>
          <p class="text-slate-500">Registros recientes</p>
        </div>
        <div class="flex gap-2">
          <button id="new-btn"
            class="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 py-2 rounded-lg shadow">
            Registrar nueva compra
          </button>
        </div>
      </header>

      <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl">
        <div id="toolbar" class="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4"></div>
        <div id="list" class="space-y-2"></div>
        <div id="pager" class="mt-4"></div>
      </section>
    `;
    container.innerHTML = '';
    container.appendChild(root);

    // ------- UI: filtros -------
    const toolbar = root.querySelector('#toolbar');
    const list    = root.querySelector('#list');
    const pager   = root.querySelector('#pager');
    const newBtn  = root.querySelector('#new-btn');

    // 1) Buscador
    const search = SearchBar({
      placeholder: 'Buscar proveedor, número, descripción de ítem…',
      onChange: () => render()
    });
    toolbar.appendChild(search.el);

    // 2) Sucursal
    const sucSel = document.createElement('select');
    sucSel.className = 'p-2 border rounded-md';
    sucSel.innerHTML = `<option value="">Todas las sucursales</option>`;
    toolbar.appendChild(sucSel);

    // 3) Fecha inicio
    const start = document.createElement('input');
    start.type = 'date';
    start.className = 'p-2 border rounded-md';
    toolbar.appendChild(start);

    // 4) Fecha fin
    const end = document.createElement('input');
    end.type = 'date';
    end.className = 'p-2 border rounded-md';
    toolbar.appendChild(end);

    // 5) Estado recepción
    const status = document.createElement('select');
    status.className = 'p-2 border rounded-md';
    status.innerHTML = `
      <option value="">Todos</option>
      <option value="Pendiente">Pendiente</option>
      <option value="Recibido con Discrepancias">Recibido con Discrepancias</option>
      <option value="Completo">Completo</option>
    `;
    toolbar.appendChild(status);

    [sucSel, start, end, status].forEach(el => el.addEventListener('change', render));
    newBtn.addEventListener('click', () => location.hash = '#/compras_registrar');

    // ------- Datos (snapshot) -------
    const purchasesCol = collection(db, 'compras');
    const q = query(purchasesCol, orderBy('createdAt', 'desc'));
    let all = [];
    let unsub = onSnapshot(q, snap => {
      all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      populateSucursal();
      render();
    }, err => {
      console.error(err);
      list.innerHTML = `<div class="text-center text-red-500 py-6">
        Error cargando historial. Revisa reglas de seguridad.
      </div>`;
    });

    const norm = s => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const fCurrency = n => `$${(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const fDate = s => {
      const d = new Date(s); if (isNaN(d)) return s||'';
      return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
    };
    const getReceptionStatus = (items=[]) => {
      if (!items.length) return 'Pendiente';
      const allRec = items.every(i => i.recibido);
      const none   = items.every(i => !i.recibido);
      if (allRec) return 'Completo';
      if (none)   return 'Pendiente';
      return 'Recibido con Discrepancias';
    };

    function populateSucursal() {
      const current = sucSel.value;
      const opts = [...new Set(all.map(p => p.sucursal).filter(Boolean))];
      sucSel.innerHTML = `<option value="">Todas las sucursales</option>` +
        opts.map(s => `<option>${s}</option>`).join('');
      if (opts.includes(current)) sucSel.value = current;
    }

    let page = 1, pageSize = 12;

    function render() {
      const q = (search.input.value || '').trim().toLowerCase();
      const qs = norm(q);
      const tok = qs.split(/\s+/).filter(Boolean);

      const fSucursal = sucSel.value;
      const fStart    = start.value ? new Date(start.value) : null;
      const fEnd      = end.value ? new Date(end.value) : null;
      const fStatus   = status.value;

      const filtered = all.filter(p => {
        // texto (proveedor, numero, items.descripcion)
        if (tok.length) {
          const text = norm(`${p.proveedor||''} ${p.numero_factura||''} ${(p.items||[]).map(i=>i.descripcion_factura||'').join(' ')}`);
          if (!tok.every(t => text.includes(t))) return false;
        }
        if (fSucursal && p.sucursal !== fSucursal) return false;
        if (fStart && new Date(p.fecha) < fStart)  return false;
        if (fEnd   && new Date(p.fecha) > fEnd)    return false;

        const s = getReceptionStatus(p.items||[]);
        if (fStatus && s !== fStatus) return false;

        return true;
      });

      // paginación
      pager.innerHTML = '';
      const pag = Paginator({
        page, pageSize, total: filtered.length,
        onChange: ({ page: p }) => { page = p; render(); }
      });
      pager.appendChild(pag.el);

      const startIdx = (page - 1) * pageSize;
      const slice = filtered.slice(startIdx, startIdx + pageSize);

      list.innerHTML = slice.map(p => {
        const statusTxt = getReceptionStatus(p.items||[]);
        const badge = statusTxt === 'Completo' ? 'bg-emerald-100 text-emerald-700'
                    : statusTxt === 'Pendiente' ? 'bg-amber-100 text-amber-700'
                    : 'bg-blue-100 text-blue-700';
        const sicar = p.agregado_sicar ? `<span class="ml-2 text-xs px-2 py-0.5 rounded-full bg-blue-600 text-white">Sicar</span>` : '';
        return `
          <article class="border rounded-xl p-4 hover:bg-slate-50 transition flex items-center justify-between">
            <div>
              <div class="text-slate-800 font-semibold">${p.proveedor || '—'} <span class="text-slate-500 font-normal">#${p.numero_factura||'N/A'}</span>${sicar}</div>
              <div class="text-sm text-slate-500">Fecha: ${fDate(p.fecha)} · Total: ${fCurrency(p.total||0)}</div>
              <div class="mt-1 inline-flex items-center text-xs px-2 py-0.5 rounded-full ${badge}">${statusTxt}</div>
            </div>
            <div class="flex gap-2">
              <button data-id="${p.id}" class="btn-edit px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm">Editar</button>
              <button data-id="${p.id}" class="btn-det px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm">Ver detalles</button>
            </div>
          </article>
        `;
      }).join('') || `<div class="text-center text-slate-500 py-8">Sin resultados</div>`;
    }

    // Delegación
root.addEventListener('click', (e) => {
  const det = e.target.closest('.btn-det');
  if (det) {
    const id = det.dataset.id;
    location.hash = '#/compras_detalles?id=' + encodeURIComponent(id);
  }

  const edt = e.target.closest('.btn-edit');
  if (edt) {
    const id = edt.dataset.id;
    location.hash = '#/compras_editar?id=' + encodeURIComponent(id);
  }

  const newBtn = e.target.closest('#new-btn');
  if (newBtn) {
    location.hash = '#/compras_registrar';
  }
});



    this._cleanup = () => { try { unsub && unsub(); } catch {} };
  },
  unmount() { try { this._cleanup?.(); } catch {} }
};
