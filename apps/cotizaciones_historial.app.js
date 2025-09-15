// apps/cotizaciones_historial.app.js
import { FIREBASE_BASE } from './lib/constants.js';
import {
  collection,
  onSnapshot,
  query,
  orderBy
} from `${FIREBASE_BASE}firebase-firestore.js`;
const COT_COLLECTION = 'cotizaciones_analizadas';


export default {
  title: 'Historial de Cotizaciones',

  async mount(container, { db, appState }) {
    // --- Utils ---
    const fCur = n => `$${(Number(n)||0).toLocaleString('en-US',{ minimumFractionDigits:2, maximumFractionDigits:2 })}`;
    const fDate = s => { const d=new Date(s); return isNaN(d)? (s||'') :
      `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; };

    // --- Estado ---
    let allQuotes = [];
    let unsubscribe = null;

    // --- UI base ---
    const root = document.createElement('div');
    root.className = 'max-w-7xl mx-auto p-4 md:p-6';
    root.innerHTML = `
      <header class="flex flex-col md:flex-row justify-between items-center mb-6">
        <div>
          <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Historial de Cotizaciones</h1>
          <p class="text-slate-500">Consulta, filtra y accede a detalles o edición.</p>
        </div>
        <button id="new-quote" class="w-full md:w-auto bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-6 rounded-lg shadow-md mt-4 md:mt-0">
          <span class="material-icons align-middle mr-2">add_circle</span> Registrar nueva cotización
        </button>
      </header>

      <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl">
        <h2 class="text-xl font-bold text-slate-900 mb-4">Filtros</h2>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
          <input id="q-search" type="text" placeholder="Buscar (proveedor, folio, descripción de ítem)" class="p-2 border rounded-md">
          <select id="q-proveedor" class="p-2 border rounded-md"><option value="">Todos los proveedores</option></select>
          <input id="q-start" type="date" class="p-2 border rounded-md">
          <input id="q-end" type="date" class="p-2 border rounded-md">
          <select id="q-estado" class="p-2 border rounded-md"><option value="">Todos los estados</option></select>
        </div>

        <div id="list" class="space-y-3">
          <div id="loader" class="flex items-center justify-center py-10">
            <div class="spinner w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full"></div>
            <p class="ml-3 text-slate-500">Cargando cotizaciones…</p>
          </div>
        </div>
      </section>
    `;
    container.innerHTML = '';
    container.appendChild(root);

    // --- Refs UI ---
    const btnNew     = root.querySelector('#new-quote');
    const elList     = root.querySelector('#list');
    const elLoader   = root.querySelector('#loader');
    const fSearch    = root.querySelector('#q-search');
    const fProv      = root.querySelector('#q-proveedor');
    const fStart     = root.querySelector('#q-start');
    const fEnd       = root.querySelector('#q-end');
    const fEstado    = root.querySelector('#q-estado');

    // --- Navegación (sin navigate, compatible con tu router actual) ---
    btnNew.addEventListener('click', () => {
      location.hash = '#/cotizaciones_registrar';
    });

    // --- Firestore listener ---
    const col = collection(db, COT_COLLECTION);
    const qCol = query(col, orderBy('createdAt', 'desc'));
    unsubscribe = onSnapshot(qCol, (snap) => {
      elLoader?.classList.add('hidden');
      allQuotes = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      populateProveedorFilter();
      populateEstadoFilter();
      applyFilters();
    }, (err) => {
      console.error('[cotizaciones_historial] onSnapshot error:', err);
      elList.innerHTML = `<div class="text-center text-red-500 py-8">Error al leer cotizaciones. Revisa permisos.</div>`;
    });

    // --- Filtros dinámicos ---
    function populateProveedorFilter() {
      const current = fProv.value;
      const options = [...new Set(allQuotes.map(q => q.proveedor).filter(Boolean))].sort();
      fProv.innerHTML = '<option value="">Todos los proveedores</option>';
      // Preferir tu lista global si existe
      const prefer = (appState?.allProveedores?.length ? appState.allProveedores : options);
      prefer.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p; opt.textContent = p;
        fProv.appendChild(opt);
      });
      if (prefer.includes(current)) fProv.value = current;
    }

    function populateEstadoFilter() {
      const current = fEstado.value;
      const options = [...new Set(allQuotes.map(q => q.estado).filter(Boolean))].sort();
      fEstado.innerHTML = '<option value="">Todos los estados</option>';
      options.forEach(st => {
        const opt = document.createElement('option');
        opt.value = st; opt.textContent = st;
        fEstado.appendChild(opt);
      });
      if (options.includes(current)) fEstado.value = current;
    }

    function safeLower(x){ return (x==null?'':String(x)).toLowerCase(); }

    function applyFilters() {
      const q = safeLower(fSearch.value).trim();
      const prov = fProv.value;
      const start = fStart.value ? new Date(fStart.value) : null;
      const end   = fEnd.value   ? new Date(fEnd.value)   : null;
      const estado = fEstado.value;

      const filtered = allQuotes.filter(c => {
        if (q) {
          const hay = [
            c.proveedor, c.numero_cotizacion, c.folio, c.numero,
            ...(Array.isArray(c.items)? c.items.map(i => i.descripcion_factura || i.descripcion || '') : [])
          ].map(safeLower).some(s => s.includes(q));
          if (!hay) return false;
        }
        if (prov && c.proveedor !== prov) return false;

        if (start) {
          const d = new Date(c.fecha); if (!isNaN(d) && d < start) return false;
        }
        if (end) {
          const d = new Date(c.fecha); if (!isNaN(d) && d > end) return false;
        }
        if (estado && c.estado !== estado) return false;
        return true;
      });

      renderList(filtered);
    }

    function renderList(list) {
      if (!list.length) {
        elList.innerHTML = '<div class="text-center text-slate-500 py-8">No se encontraron cotizaciones.</div>';
        return;
      }
      elList.innerHTML = list.map(c => {
        const folio = c.numero_cotizacion || c.folio || c.numero || '—';
        const total = c.total ?? (Array.isArray(c.items)
          ? c.items.reduce((s,it)=> s + (it.total_linea_final||it.total_linea||0), 0)
          : 0);
        const fecha = c.fecha ? fDate(c.fecha) : '—';
        const estado = c.estado || '—';
        return `
          <div class="border border-slate-200 p-4 rounded-lg flex justify-between items-center hover:bg-slate-50 transition-colors">
            <div>
              <p class="font-bold text-lg text-slate-800">${c.proveedor || 'Sin proveedor'} <span class="font-normal text-base text-slate-500">#${folio}</span></p>
              <p class="text-sm text-slate-500">Fecha: ${fecha} · Total: ${fCur(total)} · Estado: ${estado}</p>
            </div>
            <div class="space-x-2">
              <button data-id="${c.id}" class="btn-edit bg-amber-500 hover:bg-amber-600 text-white font-medium py-2 px-3 rounded-lg">Editar</button>
              <button data-id="${c.id}" class="btn-view bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium py-2 px-4 rounded-lg">Ver Detalles</button>
            </div>
          </div>
        `;
      }).join('');
    }

    // --- Eventos de filtros ---
    fSearch.addEventListener('input', applyFilters);
    fProv.addEventListener('change', applyFilters);
    fStart.addEventListener('change', applyFilters);
    fEnd.addEventListener('change', applyFilters);
    fEstado.addEventListener('change', applyFilters);

    // --- Acciones de fila (compatibles con tu router actual por hash) ---
    root.addEventListener('click', (e) => {
      const v = e.target.closest('.btn-view');
      const ed = e.target.closest('.btn-edit');
      if (v) {
        const id = v.getAttribute('data-id');
        location.hash = `#/cotizaciones_detalles?id=${encodeURIComponent(id)}`;
      } else if (ed) {
        const id = ed.getAttribute('data-id');
        location.hash = `#/cotizaciones_editar?id=${encodeURIComponent(id)}`;
      }
    });

    // Cleanup
    this._cleanup = () => { try { unsubscribe?.(); } catch {} };
  },

  unmount() { try { this._cleanup?.(); } catch {} }
};
