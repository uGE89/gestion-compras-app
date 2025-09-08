// apps/analizador_compra.app.js
import { SearchBar, Paginator } from '../framework/components.js';

export default {
  async mount(container, { appState, auth }) {
    // Espera segura al catálogo
    if (!appState?.isCatalogReady) {
      for (let i = 0; i < 150 && !appState.isCatalogReady; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // ===== Helpers =====
    const hoyISO = () => new Date().toISOString().slice(0,10);
    const parseFecha = (s) => new Date(s);
    const currency = (n) => 'C$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const ultimoProveedor = (p) => {
      const arr = (p?.stats?.preciosCompraRecientes || []);
      if (!arr.length) return '';
      const sorted = [...arr].sort((a,b)=> parseFecha(b.Fecha) - parseFecha(a.Fecha));
      return sorted[0]?.Proveedor || '';
    };
    const prioridadBucket = (p) => {
      const k = p.kpis || {};
      if (k.RiesgoRuptura) return 'Alta';
      if ((k.cantidadSugerida || 0) > 0) return 'Media';
      return 'Baja';
    };
    const impactoLinea = (p, qty) => {
      const pv = p.precioVta || 0, pc = p.precioU || 0;
      return Math.max(0, qty) * Math.max(0, (pv - pc));
    };
    const parseHabituales = (s) =>
      (s || '')
        .split(',')
        .map(v => parseInt(String(v).trim(), 10))
        .filter(n => Number.isFinite(n) && n > 0)
        .sort((a,b)=>a-b);
    const packDe = (p) => (p.basePack>0?p.basePack:(p.modeQty>0?p.modeQty:1));
    const redondearAPack = (qty, p) => {
      const pack = packDe(p) || 1;
      return Math.max(0, Math.round(qty / pack) * pack);
    };

    // ===== Dataset =====
    const base = (appState?.productCatalog || []).map(p => ({
      id:         p.id,
      clave:      p.clave || p.id,
      nombre:     p.nombre || p.Descripcion || '',
      proveedor:  ultimoProveedor(p),
      stock:      p.stockTotal || 0,
      precioU:    p.PrecioU_Ref || 0,
      precioVta:  p.PrecioVta_Ref || 0,
      basePack:   p.BasePack || 0,
      modeQty:    p.ModeQty || 0,
      habituales: parseHabituales(p.HabitualesStr),
      kpis:       p.kpis || {}
    }));

    // ===== Estado UI =====
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    let page    = parseInt(params.get('p') || '1', 10);
    const pageSize = 20;
    let q       = params.get('q') || '';
    let filtroProv = params.get('prov') || '';
    let filtroPrioridad = params.get('prio') || '';
    let soloConSugerido = params.get('solo') === '1';
    let sortBy = params.get('sort') || 'score'; // 'score'|'sug'|'stock'|'impacto'
    let autoPack = params.get('ap') === '1';

    const overrides = new Map(); // id -> number
    let pedidoProveedor = '';
    let pedidoFecha     = hoyISO();

    // ===== UI base =====
    const root = document.createElement('div');
    root.className = 'max-w-7xl mx-auto p-4 md:p-6 pb-24 md:pb-6';
    root.innerHTML = `
      <header class="mb-4">
        <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Analizador de Compra</h1>
        <p class="text-slate-500">Paginado a 20, filtros por proveedor/prioridad, edición rápida de cantidades y creación de pedido.</p>
      </header>

      <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl">
        <div id="toolbar" class="flex flex-col xl:flex-row gap-4 xl:items-end xl:justify-between"></div>
        <div id="summary" class="sticky top-0 z-10 mt-3 mb-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900"></div>
        <div id="list" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"></div>
        <div id="pager" class="mt-4"></div>
      </section>
    `;
    container.innerHTML = ''; container.appendChild(root);

    const toolbar = root.querySelector('#toolbar');
    const left  = document.createElement('div');
    const mid   = document.createElement('div');
    const right = document.createElement('div');
    left.className  = 'flex flex-col lg:flex-row gap-3 lg:items-end';
    mid.className   = 'flex flex-col lg:flex-row gap-3 lg:items-end';
    right.className = 'flex flex-col lg:flex-row gap-3 lg:items-end';

    // --- CONTROLES DE LA BARRA (alineados) ---

// Buscador (con label fantasma para alinear)
const searchWrap = document.createElement('div');
searchWrap.className = 'min-w-[280px]';
searchWrap.innerHTML = `<label class="block text-xs text-slate-500 mb-1 invisible">Buscar</label>`;
const search = SearchBar({
  placeholder: 'Buscar por nombre o clave…',
  onChange: (v)=>{ q=v||''; page=1; render(); persist(); }
});
searchWrap.appendChild(search.el);
left.appendChild(searchWrap);

// Proveedor
const provWrap = document.createElement('div');
provWrap.innerHTML = `
  <label class="block text-xs text-slate-500 mb-1">Proveedor</label>
  <select id="f-proveedor" class="h-11 px-3 min-w-[220px] rounded-xl border border-slate-200">
    <option value="">Todos</option>
    ${(appState.allProveedores||[]).map(p=>`<option value="${p}">${p}</option>`).join('')}
  </select>
`;
left.appendChild(provWrap);
const selProv = provWrap.querySelector('#f-proveedor');
selProv.addEventListener('change', ()=>{ filtroProv = selProv.value; page=1; render(); persist(); });

// Prioridad
const priorWrap = document.createElement('div');
priorWrap.innerHTML = `
  <label class="block text-xs text-slate-500 mb-1">Prioridad</label>
  <select id="f-prioridad" class="h-11 px-3 min-w-[160px] rounded-xl border border-slate-200">
    <option value="">Todas</option>
    <option value="Alta">Alta</option>
    <option value="Media">Media</option>
    <option value="Baja">Baja</option>
  </select>
`;
left.appendChild(priorWrap);
const selPrior = priorWrap.querySelector('#f-prioridad');
selPrior.addEventListener('change', ()=>{ filtroPrioridad = selPrior.value; page=1; render(); persist(); });

// Solo sugerido > 0 (label fantasma + fila h-11)
const chkWrap = document.createElement('div');
chkWrap.innerHTML = `
  <label class="block text-xs text-slate-500 mb-1">&nbsp;</label>
  <label class="inline-flex h-11 items-center gap-2 text-sm text-slate-600">
    <input id="f-solo" type="checkbox" class="accent-emerald-600">
    <span>Solo con sugerido &gt; 0</span>
  </label>
`;
left.appendChild(chkWrap);
const chkSolo = chkWrap.querySelector('#f-solo');
chkSolo.addEventListener('change', ()=>{ soloConSugerido = chkSolo.checked; page=1; render(); persist(); });

// Ordenar por
const sortWrap = document.createElement('div');
sortWrap.innerHTML = `
  <label class="block text-xs text-slate-500 mb-1">Ordenar por</label>
  <select id="f-sort" class="h-11 px-3 min-w-[200px] rounded-xl border border-slate-200">
    <option value="score">PrioridadScore (desc)</option>
    <option value="sug">Sugerido (desc)</option>
    <option value="stock">Stock (asc)</option>
    <option value="impacto">Impacto (desc)</option>
  </select>
`;
mid.appendChild(sortWrap);
const selSort = sortWrap.querySelector('#f-sort');
selSort.addEventListener('change', ()=>{ sortBy = selSort.value; page=1; render(); persist(); });

// Auto-redondear a pack (label fantasma + fila h-11)
const apWrap = document.createElement('div');
apWrap.innerHTML = `
  <label class="block text-xs text-slate-500 mb-1">&nbsp;</label>
  <label class="inline-flex h-11 items-center gap-2 text-sm text-slate-600">
    <input id="f-ap" type="checkbox" class="accent-emerald-600">
    <span>Auto-redondear a pack</span>
  </label>
`;
mid.appendChild(apWrap);
const chkAP = apWrap.querySelector('#f-ap');
chkAP.addEventListener('change', ()=>{ autoPack = chkAP.checked; persist(); });

// Acciones masivas (label fantasma + fila h-11)
const massWrap = document.createElement('div');
massWrap.innerHTML = `
  <label class="block text-xs text-slate-500 mb-1">&nbsp;</label>
  <div class="flex h-11 items-center gap-2">
    <button id="act-sug" class="h-11 px-3 rounded-xl border bg-slate-50 hover:bg-slate-100">Poner sugerido</button>
    <button id="act-zero" class="h-11 px-3 rounded-xl border bg-slate-50 hover:bg-slate-100">Vaciar</button>
    <button id="act-pack" class="h-11 px-3 rounded-xl border bg-slate-50 hover:bg-slate-100">Redondear a pack</button>
  </div>
`;
mid.appendChild(massWrap);
const btnSug  = massWrap.querySelector('#act-sug');
const btnZero = massWrap.querySelector('#act-zero');
const btnPack = massWrap.querySelector('#act-pack');

// Parámetros del pedido (alinea el botón con mt-6)
const pedidoWrap = document.createElement('div');
pedidoWrap.className = 'flex flex-col md:flex-row gap-3 md:items-end';
pedidoWrap.innerHTML = `
  <div>
    <label class="block text-xs text-slate-500 mb-1">Proveedor del pedido</label>
    <select id="pedido-proveedor" class="h-11 px-3 min-w-[220px] rounded-xl border border-slate-200">
      <option value="">(Selecciona)</option>
      ${(appState.allProveedores||[]).map(p=>`<option value="${p}">${p}</option>`).join('')}
    </select>
  </div>
  <div>
    <label class="block text-xs text-slate-500 mb-1">Fecha</label>
    <input id="pedido-fecha" type="date" value="${hoyISO()}" class="h-11 px-3 rounded-xl border border-slate-200">
  </div>
  <button id="btn-crear" class="mt-6 h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow">
    Crear pedido
  </button>
`;
right.appendChild(pedidoWrap);


// Referencias del bloque "Parámetros del pedido"
const selPedidoProv = pedidoWrap.querySelector('#pedido-proveedor');
const inpFecha      = pedidoWrap.querySelector('#pedido-fecha');
const btnCrear      = pedidoWrap.querySelector('#btn-crear');

// Listeners
selPedidoProv.addEventListener('change', () => {
  pedidoProveedor = selPedidoProv.value;
  updateSummary();                     // habilita/deshabilita el botón
});
inpFecha.addEventListener('change', () => {
  pedidoFecha = inpFecha.value || hoyISO();
});


    // ===== Referencias de contenido =====
    const list    = root.querySelector('#list');
    const pager   = root.querySelector('#pager');
    const summary = root.querySelector('#summary');

    const rank = { Alta:0, Media:1, Baja:2 };

    // ===== Utilidades =====
    function sugerido(p){ return Math.max(0, Math.round(p.kpis?.cantidadSugerida || 0)); }
    function getQty(p){
      const ov = overrides.get(p.id);
      return (ov==null || ov==='') ? sugerido(p) : Math.max(0, parseInt(ov,10) || 0);
    }

    function filtrarOrdenar(datos){
      let arr = datos;
      if (q) {
        const nq = q.toLowerCase();
        arr = arr.filter(d => (`${d.nombre} ${d.clave}`).toLowerCase().includes(nq));
      }
      if (filtroProv) arr = arr.filter(d => d.proveedor === filtroProv);
      if (filtroPrioridad) arr = arr.filter(d => prioridadBucket(d) === filtroPrioridad);
      if (soloConSugerido) arr = arr.filter(d => sugerido(d) > 0);

      arr = [...arr];
      arr.sort((a,b)=>{
        if (sortBy === 'sug')   return sugerido(b) - sugerido(a);
        if (sortBy === 'stock') return (a.stock||0) - (b.stock||0);
        if (sortBy === 'impacto'){
          const ia = impactoLinea(a, getQty(a));
          const ib = impactoLinea(b, getQty(b));
          return ib - ia;
        }
        const pa = rank[prioridadBucket(a)], pb = rank[prioridadBucket(b)];
        if (pa !== pb) return pa - pb;
        const sa = a.kpis?.PrioridadScore || 0, sb = b.kpis?.PrioridadScore || 0;
        return sb - sa;
      });
      return arr;
    }

function updateSummary(){
  const filtered = filtrarOrdenar(base);
  const seleccion = filtered
    .map(p => ({ p, qty: getQty(p) }))
    .filter(x => x.qty > 0 && (!pedidoProveedor || x.p.proveedor === pedidoProveedor));
  const totalCosto = seleccion.reduce((s,x)=> s + x.qty * (x.p.precioU || 0), 0);

  summary.innerHTML = `
    <div class="flex flex-wrap gap-4 items-center justify-between">
      <div>Items filtrados: <b>${filtered.length}</b></div>
      <div>Seleccionados${pedidoProveedor ? ` (Proveedor ${pedidoProveedor})` : ''}: <b>${seleccion.length}</b></div>
      <div>Costo aprox. selección: <b>${currency(totalCosto)}</b></div>
    </div>
  `;

  if (typeof btnCrear !== 'undefined' && btnCrear) {
    btnCrear.disabled = !pedidoProveedor;
    btnCrear.classList.toggle('opacity-50', !pedidoProveedor);
  }
}


    function render(){
      const filtered = filtrarOrdenar(base);

      pager.innerHTML = '';
      const pag = Paginator({
        page, pageSize, total: filtered.length,
        onChange: ({ page: p }) => { page = p; render(); persist(); }
      });
      pager.appendChild(pag.el);

      const start = (page - 1) * pageSize;
      const pageItems = filtered.slice(start, start + pageSize);

      list.innerHTML = pageItems.map(p=>{
        const prio = prioridadBucket(p);
        const qty  = getQty(p);
        const isEdited = qty !== sugerido(p);
        const pack = packDe(p);
        const impacto = impactoLinea(p, qty);

        return `
        <article class="border rounded-xl p-4 bg-slate-50 ${p.stock<0?'ring-1 ring-red-200':''}">
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="text-xs text-slate-500">${p.clave}</div>
              <div class="font-semibold text-slate-800">${p.nombre}</div>
              <div class="text-xs text-slate-500 mt-1">Proveedor: <span class="font-medium">${p.proveedor||'-'}</span></div>
            </div>
            <span class="text-xs px-2 py-0.5 rounded-full ${prio==='Alta'?'bg-red-100 text-red-700':prio==='Media'?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-600'}">
              ${prio}
            </span>
          </div>

          <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div class="p-2 rounded-lg bg-white border">
              <div class="text-slate-500">Stock</div>
              <div class="font-bold ${p.stock<0?'text-red-600':''}">${p.stock}</div>
            </div>
            <div class="p-2 rounded-lg bg-white border">
              <div class="text-slate-500">Sugerido</div>
              <div class="font-bold">${sugerido(p)}</div>
            </div>
            <div class="p-2 rounded-lg bg-white border">
              <div class="text-slate-500">ROP</div>
              <div class="font-bold">${Math.round(p.kpis?.puntoDeReorden || 0)}</div>
            </div>
            <div class="p-2 rounded-lg bg-white border" title="Impacto = qty × (PV−PC). Score=${(p.kpis?.PrioridadScore||0).toFixed(2)}">
              <div class="text-slate-500">Impacto</div>
              <div class="font-bold">${currency(impacto)}</div>
            </div>
          </div>

          <div class="mt-3 text-xs text-slate-500 ${pack>1 || (p.habituales?.length)?'':'hidden'}">
            ${pack>1?`Pack base: <b>${pack}</b>`:''}
            ${p.habituales?.length?` · Habituales: <b>${p.habituales.join(', ')}</b>`:''}
          </div>

          <div class="mt-2">
            <label class="block text-xs text-slate-500 mb-1">Cantidad a pedir ${isEdited?'<span class="ml-1 text-amber-600 font-semibold">(Editado)</span>':''}</label>
            <input data-id="${p.id}" data-pack="${pack}" type="number" min="0" step="1" value="${qty}"
                   class="w-full h-11 px-3 rounded-xl border border-slate-300 bg-white"
                   title="Alt+↑/↓ suma/resta por pack (${pack})">
            <div class="mt-1 text-xs text-slate-500">Costo aprox.: <b>${currency(qty * (p.precioU||0))}</b></div>
          </div>
        </article>`;
      }).join('') || `<div class="text-center text-slate-500">Sin resultados</div>`;

      // Delegación de eventos en inputs
      list.querySelectorAll('input[type="number"][data-id]').forEach(inp=>{
        inp.onchange = (e)=>{
          const id = e.target.dataset.id;
          let val = parseInt(e.target.value, 10) || 0;
          if (autoPack) {
            const pack = parseInt(e.target.dataset.pack || '1', 10) || 1;
            val = Math.max(0, Math.round(val / pack) * pack);
            e.target.value = String(val);
          }
          overrides.set(id, val);
          updateSummary();
        };
        inp.onkeydown = (e)=>{
          if (!e.altKey) return;
          const pack = parseInt(e.target.dataset.pack || '1', 10) || 1;
          let val = parseInt(e.target.value, 10) || 0;
          if (e.key === 'ArrowUp')   { e.preventDefault(); val += pack; }
          if (e.key === 'ArrowDown') { e.preventDefault(); val = Math.max(0, val - pack); }
          e.target.value = String(val);
          overrides.set(e.target.dataset.id, val);
          updateSummary();
        };
      });

      updateSummary();
    }

    // Acciones masivas (sobre el filtro actual)
    btnSug.addEventListener('click', ()=>{
      const filtered = filtrarOrdenar(base);
      filtered.forEach(p => overrides.set(p.id, sugerido(p)));
      render();
    });
    btnZero.addEventListener('click', ()=>{
      const filtered = filtrarOrdenar(base);
      filtered.forEach(p => overrides.set(p.id, 0));
      render();
    });
    btnPack.addEventListener('click', ()=>{
      const filtered = filtrarOrdenar(base);
      filtered.forEach(p => {
        const cur = getQty(p);
        overrides.set(p.id, redondearAPack(cur, p));
      });
      render();
    });

    // Crear pedido (descarga JSON por ahora)
    btnCrear.addEventListener('click', () => {
      if (!pedidoProveedor) { alert('Selecciona proveedor del pedido'); return; }
      const seleccion = filtrarOrdenar(base)
        .filter(p => p.proveedor === pedidoProveedor)
        .map(p => ({ p, qty: getQty(p) }))
        .filter(x => x.qty > 0);

      if (!seleccion.length) { alert('No hay artículos con cantidad > 0 para ese proveedor.'); return; }

      const totalCosto = seleccion.reduce((s,x)=> s + x.qty * (x.p.precioU||0), 0);
      const payload = {
        tipo: 'pedido_compra',
        proveedor: pedidoProveedor,
        fecha: pedidoFecha,
        creadoPor: auth?.currentUser?.uid || null,
        totalItems: seleccion.length,
        totalCostoAprox: totalCosto,
        items: seleccion.map(x => ({
          clave: x.p.clave, nombre: x.p.nombre,
          cantidad: x.qty, precioRef: x.p.precioU || 0,
          costoLineaRef: (x.p.precioU||0) * x.qty
        }))
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pedido_${pedidoProveedor}_${pedidoFecha}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      alert(`Pedido generado: ${seleccion.length} ítems · Costo aprox. ${currency(totalCosto)}`);
    });

    // Persistencia en URL
    function persist(){
      const qs = new URLSearchParams({
        q, p: String(page),
        prov: filtroProv || '',
        prio: filtroPrioridad || '',
        solo: soloConSugerido ? '1' : '',
        sort: sortBy,
        ap:   autoPack ? '1' : ''
      });
      history.replaceState(null, '', `#/analizador-compra?${qs.toString()}`);
    }

    // Anti-zoom móvil (inputs >=16px)
    const style = document.createElement('style');
    style.textContent = `@media (max-width:767px){ input,select,textarea{font-size:16px!important} }`;
    document.head.appendChild(style);
    this._cleanup = () => { document.head.removeChild(style); };

    // Estado inicial sin disparar onChange
    search.input.value = q;
    if (filtroProv)      selProv.value  = filtroProv;
    if (filtroPrioridad) selPrior.value = filtroPrioridad;
    if (soloConSugerido) chkSolo.checked = true;
    if (sortBy)          selSort.value  = sortBy;
    if (autoPack)        chkAP.checked  = true;

    // Primer render
    render();
    persist();
  },
  unmount(){ try{ this._cleanup?.(); }catch{} }
};
