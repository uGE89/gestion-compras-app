// apps/components/items_editor.js
import { parseNumber } from '../../export_utils.js';
import { DEFAULT_EXCHANGE_RATE } from '../../constants.js';

export function ItemsEditor({
  container,
  productCatalog = [],
  initialIVA = 15,
  initialTC = DEFAULT_EXCHANGE_RATE,
  initialTotalAI = 0,
  onChange = () => {}
}) {
  // ===== Estado =====
  let items = [];
  let IVA = Number(initialIVA) || 0;
  let TC  = Number(initialTC)  || 1;
  let totalAI = Number(initialTotalAI) || 0;

  // ===== Utils =====
  const $  = (sel, root=container) => root.querySelector(sel);
  const $$ = (sel, root=container) => Array.from(root.querySelectorAll(sel));

  const cur = n => `$${(Number(n)||0).toLocaleString('en-US',{ minimumFractionDigits:2, maximumFractionDigits:2 })}`;

  const norm = s => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

  const escapeHtml = (s='') =>
    s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  const highlight = (text, tokens) => {
    if (!tokens.length) return text;
    let out = text;
    tokens.forEach(t=>{
      if (!t) return;
      const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')})`,'ig');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  };

  function searchCatalog(query, limit=50) {
    const toks = norm(query).split(/\s+/).filter(Boolean);
    if (!toks.length) return [];
    const match = it => {
      const hay = norm(`${it.nombre} ${it.clave} ${it.id}`);
      return toks.every(t => hay.includes(t));
    };
    return productCatalog.filter(match).slice(0, limit);
  }

  // Preserva caret/foco entre repintados
  function withCaretPreserved(root, mutateFn) {
    const ae = document.activeElement;
    const isText = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
    const key = isText ? ae.getAttribute('data-key') : null;
    const start = isText ? ae.selectionStart : null;
    const end   = isText ? ae.selectionEnd   : null;

    mutateFn();

    if (key != null) {
      const next = root.querySelector(`[data-key="${key}"]`);
      if (next) {
        next.focus();
        try { next.setSelectionRange(start, end); } catch {}
      }
    }
  }

  // Debounce simple
  function debounce(fn, ms=120) {
    let t=null;
    const f = (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
    f.cancel = ()=>clearTimeout(t);
    return f;
  }

  // ===== Render raíz =====
  container.innerHTML = `
    <div class="bg-slate-50 p-6 rounded-lg">
      <h3 class="text-lg font-bold mb-4">Ajustes y Verificación de Artículos</h3>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <label class="block text-sm font-medium text-slate-700">IVA (%)</label>
          <input id="ie-iva" type="number" step="any" min="0" inputmode="decimal" value="${IVA}"
            class="mt-1 block w-full rounded-md border-slate-300 shadow-sm p-2">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700">Tipo de Cambio</label>
          <input id="ie-tc" type="number" step="any" min="0" inputmode="decimal" value="${TC}"
            class="mt-1 block w-full rounded-md border-slate-300 shadow-sm p-2">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700">Total Factura (IA)</label>
          <input id="ie-total-ai" type="number" step="0.01" value="${totalAI}"
            class="mt-1 block w-full rounded-md border-slate-300 shadow-sm p-2 bg-slate-100" readonly>
        </div>
      </div>

      <div id="ie-items-list" class="mt-4 space-y-4"></div>

      <div class="mt-4 flex items-center justify-between">
        <button id="ie-add-item" type="button"
          class="bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg flex items-center">
          <span class="material-icons mr-2">add</span>Añadir Artículo
        </button>
        <div id="ie-summary" class="text-right text-sm text-slate-600"></div>
      </div>
    </div>
  `;

  // ===== Listeners raíz =====
  $('#ie-iva').addEventListener('input', () => { IVA = parseNumber($('#ie-iva').value); renderSummary(); patchAllComputed(); onChange(getItems()); });
  $('#ie-tc').addEventListener('input',  () => { TC  = parseNumber($('#ie-tc').value);  renderSummary(); patchAllComputed(); onChange(getItems()); });
  $('#ie-add-item').addEventListener('click', addItem);

  // Cerrar resultados al hacer click fuera
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.ie-search-wrap')) hideAllResults();
  });
  function hideAllResults() { $$('.ie-results').forEach(r => r.classList.add('hidden')); }

  // ===== API expuesta =====
  function addItems(newOnes=[]) { items.push(...newOnes); renderAll(); }
  function setItems(next=[])   { items = [...next]; renderAll(); }
  function getItems()          { return items.map(x=>({ ...x })); }
  function setInvoiceTotal(n)  { totalAI = Number(n)||0; $('#ie-total-ai').value = totalAI.toFixed(2); renderSummary(); }

  // ===== Render tarjetas =====
  function renderAll() {
    const list = $('#ie-items-list');
    withCaretPreserved(container, () => {
      list.innerHTML = '';
      items.forEach((_, idx) => {
        const card = document.createElement('div');
        card.className = 'ie-card';
        card.dataset.idx = idx;
        list.appendChild(card);
        renderCard(idx);
      });
      renderSummary();
    });
    onChange(getItems());
  }

  function renderSummary() {
    const ivaFactor = 1 + (IVA/100);
    const totalCalc = items.reduce((sum, it)=>{
      const base = Number(it.total_linea_base||0);
      return sum + base * ivaFactor * (Number(TC)||1);
    }, 0);
    const diff = totalAI - totalCalc;
    const diffCls = Math.abs(diff) < 1 ? 'text-emerald-600' : 'text-red-600';
    $('#ie-summary').innerHTML = `
      <div>Total Factura (IA): <b>${cur(totalAI)}</b></div>
      <div>Total Calculado: <b class="text-slate-900">${cur(totalCalc)}</b></div>
      <div class="${diffCls}">Diferencia: <b>${cur(diff)}</b></div>
    `;
  }

  // Parchea solo los valores derivados (sin reconstruir inputs)
  function patchComputedRow(idx) {
    const it = items[idx] || {};
    const card = $(`.ie-card[data-idx="${idx}"]`);
    if (!card) return;

    const ivaFactor = 1 + (IVA/100);
    const totalBase = Number(it.total_linea_base||0);
    const cant = Number(it.cantidad_factura||0);
    const uxp  = Number(it.unidades_por_paquete||1);
    const totalFinal = totalBase * ivaFactor * (Number(TC)||1);
    const unidades = cant * Math.max(uxp, 1);
    const pUnit = unidades > 0 ? totalFinal / unidades : 0;

    const isAssoc = !!it.clave_catalogo;
    const priceEl = card.querySelector('.final-unit-price');
    if (priceEl) priceEl.textContent = cur(pUnit);

    const cmp = card.querySelector('.price-comparison-content');
    if (cmp) {
      if (isAssoc) {
        const cat = productCatalog.find(p => p.id === it.clave_catalogo);
        if (cat) {
          const ref = Number(cat.PrecioU_Ref||0);
          const pct = ref>0 ? ((pUnit - ref) / ref) * 100 : 0;
          const cls = pct>0.1 ? 'text-red-500' : (pct<-0.1 ? 'text-green-500':'text-slate-500');
          const sign = pct>0 ? '+' : '';
          cmp.innerHTML = `
            <div class="flex justify-between items-center text-sm">
              <span class="text-slate-500">Precio Ref.:</span>
              <span class="font-bold text-slate-800">${cur(ref)}</span>
            </div>
            <div class="mt-2 pt-2 border-t border-slate-200 flex items-center justify-center ${cls}">
              <div class="text-xl font-bold">${sign}${pct.toFixed(1)}%</div>
            </div>`;
        } else {
          cmp.innerHTML = `<div class="text-center text-slate-400 text-sm p-2">Artículo no encontrado en catálogo.</div>`;
        }
      } else {
        cmp.innerHTML = `<div class="text-center text-slate-400 text-sm p-2">Asocia un artículo para comparar.</div>`;
      }
    }

    // Ajustar borde por asociación
    card.classList.toggle('border-emerald-300', isAssoc);
    card.classList.toggle('border-slate-200', !isAssoc);
  }

  function patchAllComputed() { items.forEach((_, i) => patchComputedRow(i)); }

  function renderCard(idx) {
    const it = items[idx] || {};
    const card = $(`.ie-card[data-idx="${idx}"]`);
    if (!card) return;

    const ivaFactor = 1 + (IVA/100);
    const totalBase = Number(it.total_linea_base||0);
    const cant = Number(it.cantidad_factura||0);
    const uxp  = Number(it.unidades_por_paquete||1);
    const totalFinal = totalBase * ivaFactor * (Number(TC)||1);
    const unidades = cant * Math.max(uxp, 1);
    const pUnit = unidades > 0 ? totalFinal / unidades : 0;

    const isAssoc = !!it.clave_catalogo;
    let compareHTML = '<div class="text-center text-slate-400 text-sm p-2">Asocia un artículo para comparar.</div>';
    if (isAssoc) {
      const cat = productCatalog.find(p => p.id === it.clave_catalogo);
      if (cat) {
        const ref = Number(cat.PrecioU_Ref||0);
        const pct = ref>0 ? ((pUnit - ref) / ref) * 100 : 0;
        const cls = pct>0.1 ? 'text-red-500' : (pct<-0.1 ? 'text-green-500':'text-slate-500');
        const sign = pct>0 ? '+' : '';
        compareHTML = `
          <div class="flex justify-between items-center text-sm">
            <span class="text-slate-500">Precio Ref.:</span>
            <span class="font-bold text-slate-800">${cur(ref)}</span>
          </div>
          <div class="mt-2 pt-2 border-t border-slate-200 flex items-center justify-center ${cls}">
            <div class="text-xl font-bold">${sign}${pct.toFixed(1)}%</div>
          </div>`;
      }
    }

    const assocBadge = it.autoAssociated ? `<span class="bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">Auto-asociado</span>` : '';

    withCaretPreserved(card, () => {
      card.className = `ie-card bg-white p-4 rounded-lg shadow-sm border ${isAssoc?'border-emerald-300':'border-slate-200'}`;
      card.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <label class="block text-sm font-medium text-slate-700">Descripción en Factura</label>
              ${assocBadge}
            </div>
            <div>
              <textarea data-field="descripcion_factura" data-key="desc-${idx}"
                class="ie-input w-full p-2 border rounded text-slate-800" rows="2">${it.descripcion_factura||''}</textarea>
            </div>

            <div class="ie-search-wrap relative">
              <label class="block text-sm font-medium text-slate-700">Asociar con Catálogo (Buscar)</label>
              <input type="text" class="ie-search w-full p-2 border rounded bg-white shadow-sm"
                placeholder="Escribe para buscar…" autocomplete="off"
                aria-expanded="false" aria-autocomplete="list" role="combobox">
              <div class="ie-results hidden absolute z-10 w-full bg-white border mt-1 rounded-md shadow-lg max-h-60 overflow-y-auto"
                role="listbox"></div>
              <div class="ie-selected text-sm mt-1"></div>
            </div>
          </div>

          <div class="space-y-3">
<div class="grid grid-cols-2 md:grid-cols-3 gap-4">
  <div>
    <label class="block text-sm font-medium text-slate-700">Cantidad</label>
    <input type="number" step="any" min="0" inputmode="decimal" data-field="cantidad_factura" data-key="cant-${idx}" value="${cant||0}" class="ie-input w-full p-2 border rounded text-slate-800">
  </div>

  <div>
    <label class="block text-sm font-medium text-slate-700">UxP</label>
    <input type="number" step="any" min="1" inputmode="decimal" data-field="unidades_por_paquete" data-key="uxp-${idx}" value="${uxp||1}" class="ie-input w-full p-2 border rounded text-slate-800">
  </div>

  <div>
    <label class="block text-sm font-medium text-slate-700">Total Base</label>
    <input type="text" data-field="total_linea_base" value="${(totalBase||0).toLocaleString('en-US')}" class="ie-input w-full p-2 border rounded text-right text-slate-800">
  </div>
</div>


            <div>
              <label class="block text-sm font-medium text-slate-700">Clave Proveedor</label>
              <input type="text" data-field="clave_proveedor" data-key="prov-${idx}"
                value="${it.clave_proveedor||''}" class="ie-input w-full p-2 border rounded text-slate-800">
            </div>

            <div class="p-3 rounded-md bg-slate-50 border">
              <h4 class="text-sm font-bold text-center text-slate-600 mb-2">Precio Unitario Final</h4>
              <div class="text-center text-2xl font-bold text-emerald-600 final-unit-price">${cur(pUnit)}</div>
              <div class="mt-2 pt-2 border-t price-comparison-content">${compareHTML}</div>
            </div>

            <div class="text-right">
              <button type="button" class="ie-del text-red-500 hover:text-red-700 font-bold" title="Eliminar artículo">Eliminar</button>
            </div>
          </div>
        </div>
      `;
    });

    updateSelected(idx);

    // Inputs → actualizar modelo + parchar derivados (sin reconstruir todo)
    card.querySelectorAll('.ie-input').forEach(inp=>{
      inp.addEventListener('input', () => {
        const field = inp.dataset.field;
        let val = inp.value;
        if (['cantidad_factura','unidades_por_paquete','total_linea_base'].includes(field)) {
          val = parseNumber(val);
        }
        items[idx][field] = val;
        patchComputedRow(idx);
        renderSummary();
        onChange(getItems());
      });
    });

    // Buscar con teclado
    const searchInput   = card.querySelector('.ie-search');
    const resultsBox    = card.querySelector('.ie-results');
    let activeIndex = -1;

    const openResults = () => { resultsBox.classList.remove('hidden'); searchInput.setAttribute('aria-expanded','true'); };
    const closeResults = () => { resultsBox.classList.add('hidden'); searchInput.setAttribute('aria-expanded','false'); activeIndex = -1; setActiveItem(); };

    const debounced = debounce((q)=>{
      const hits = searchCatalog(q);
      resultsBox.innerHTML = hits.map((p,i)=>`
        <div class="ie-item px-2 py-1 cursor-pointer hover:bg-emerald-100"
             role="option" id="opt-${idx}-${i}" data-id="${p.id}">
          <div class="text-sm">${highlight(escapeHtml(p.nombre), norm(q).split(/\s+/).filter(Boolean))}</div>
          <div class="text-xs text-slate-500">${p.clave}</div>
        </div>
      `).join('') || `<div class="px-2 py-2 text-sm text-slate-400">Sin resultados</div>`;
      activeIndex = hits.length ? 0 : -1;
      setActiveItem();
      openResults();
    }, 120);

    searchInput.addEventListener('input', (e)=>{
      const q = e.target.value.trim();
      if (!q) { closeResults(); return; }
      debounced(q);
    });

    searchInput.addEventListener('keydown', (e)=>{
      if (resultsBox.classList.contains('hidden')) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const q = e.currentTarget.value.trim();
          if (!q) return;
          debounced.cancel?.();
          const hits = searchCatalog(q);
          resultsBox.innerHTML = hits.map((p,i)=>`
            <div class="ie-item px-2 py-1 cursor-pointer hover:bg-emerald-100"
                role="option" id="opt-${idx}-${i}" data-id="${p.id}">
              <div class="text-sm">${highlight(escapeHtml(p.nombre), norm(q).split(/\s+/).filter(Boolean))}</div>
              <div class="text-xs text-slate-500">${p.clave}</div>
            </div>
          `).join('') || `<div class="px-2 py-2 text-sm text-slate-400">Sin resultados</div>`;
          activeIndex = hits.length ? 0 : -1;
          setActiveItem();
          openResults();
          return;
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const opts = resultsBox.querySelectorAll('.ie-item');
        if (!opts.length) return;
        activeIndex = (activeIndex + 1 + opts.length) % opts.length;
        setActiveItem(true);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const opts = resultsBox.querySelectorAll('.ie-item');
        if (!opts.length) return;
        activeIndex = (activeIndex - 1 + opts.length) % opts.length;
        setActiveItem(true);
      } else if (e.key === 'Enter') {
        if (!resultsBox.classList.contains('hidden')) {
          e.preventDefault();
          const opt = resultsBox.querySelectorAll('.ie-item')[activeIndex];
          if (opt) choose(opt.dataset.id);
        }
      } else if (e.key === 'Escape') {
        closeResults();
      }
    });

    resultsBox.addEventListener('mousemove', (e)=>{
      const opt = e.target.closest('.ie-item');
      if (!opt) return;
      const opts = Array.from(resultsBox.querySelectorAll('.ie-item'));
      const i = opts.indexOf(opt);
      if (i >= 0) { activeIndex = i; setActiveItem(); }
    });
    resultsBox.addEventListener('click', (e)=>{
      const opt = e.target.closest('.ie-item'); if (!opt) return;
      choose(opt.dataset.id);
    });

    function setActiveItem(scrollIntoView=false) {
      const opts = resultsBox.querySelectorAll('.ie-item');
      opts.forEach((el,i)=>{
        if (i === activeIndex) {
          el.classList.add('bg-emerald-100');
          el.setAttribute('aria-selected','true');
          searchInput.setAttribute('aria-activedescendant', el.id);
          if (scrollIntoView) el.scrollIntoView({block:'nearest'});
        } else {
          el.classList.remove('bg-emerald-100');
          el.removeAttribute('aria-selected');
        }
      });
    }

    function choose(id) {
      const art = productCatalog.find(p => p.id === id);
      if (!art) return;
      items[idx].clave_catalogo = art.id;
      items[idx].desc_catalogo  = art.nombre;
      items[idx].autoAssociated = false;
      searchInput.value = '';
      closeResults();
      patchComputedRow(idx);
      updateSelected(idx);
      renderSummary();
      onChange(getItems());
    }

    // Limpiar asociación
    card.querySelector('.ie-selected').addEventListener('click', (e)=>{
      const btn = e.target.closest('.ie-clear');
      if (!btn) return;
      items[idx].clave_catalogo = null;
      items[idx].desc_catalogo  = null;
      patchComputedRow(idx);
      updateSelected(idx);
      renderSummary();
      onChange(getItems());
    });

    // Eliminar ítem
    card.querySelector('.ie-del').addEventListener('click', ()=>{
      items.splice(idx,1);
      renderAll();
    });
  }

  function updateSelected(idx) {
    const it = items[idx] || {};
    const card = $(`.ie-card[data-idx="${idx}"]`);
    const display = card.querySelector('.ie-selected');
    const input   = card.querySelector('.ie-search');
    if (it.clave_catalogo && it.desc_catalogo) {
      display.innerHTML = `
        Asociado:
        <strong class="text-emerald-700">${escapeHtml(it.desc_catalogo)}</strong>
        <span class="text-xs text-slate-500 ml-2">(Clave: ${escapeHtml(it.clave_catalogo)})</span>
        <button type="button" class="ie-clear text-red-500 hover:text-red-700 font-bold ml-2" title="Desasociar">X</button>
      `;
      input.style.display = 'none';
    } else {
      display.innerHTML = '';
      input.style.display = 'block';
    }
  }

  function addItem() {
    items.push({
      descripcion_factura: '',
      cantidad_factura: 1,
      unidades_por_paquete: 1,
      total_linea_base: 0,
      clave_proveedor: null,
      clave_catalogo: null,
      desc_catalogo: null,
      recibido: false
    });
    renderAll();
  }

  // Primera render
  renderAll();

  // API pública
  return {
    addItems, setItems, getItems, setInvoiceTotal
  };
}
