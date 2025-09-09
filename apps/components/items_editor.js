// apps/components/items_editor.js
export function ItemsEditor({
  container,                 // HTMLElement donde se monta el editor
  productCatalog = [],       // Catálogo global (con id, nombre, clave, PrecioU_Ref)
  initialIVA = 15,           // IVA inicial
  initialTC = 1,             // Tipo de cambio inicial
  initialTotalAI = 0,        // Total de factura detectado por IA (opcional)
  onChange = () => {}        // Callback cuando cambian ítems o parámetros
}) {
  // ------- Estado interno -------
  let items = [];            // [{descripcion_factura, cantidad_factura, unidades_por_paquete, total_linea_base, ...}]
  let iva = Number(initialIVA) || 0;
  let tc  = Number(initialTC)  || 1;
  let totalAI = Number(initialTotalAI) || 0;

  // ------- Utils -------
  const parseLocalFloat = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return 0;
    return parseFloat(v.replace(/,/g,'')) || 0;
  };
  const formatCurrency = (n) =>
    `$${(n || 0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

  // ------- Estructura base -------
  container.innerHTML = `
    <div class="bg-slate-50 p-6 rounded-lg">
      <h3 class="text-lg font-bold mb-4">Ajustes y Verificación de Artículos</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <label class="block text-sm font-medium text-slate-700">IVA (%)</label>
          <input type="number" id="ie-iva" value="${iva}" step="0.01"
                 class="ie-recalc mt-1 block w-full rounded-md border-slate-300 shadow-sm p-2">
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700">Tipo de Cambio</label>
          <input type="number" id="ie-tc" value="${tc}" step="0.01"
                 class="ie-recalc mt-1 block w-full rounded-md border-slate-300 shadow-sm p-2">
        </div>
      </div>

      <div id="ie-items" class="mt-4 space-y-4"></div>

      <div class="mt-4">
        <button type="button" id="ie-add" class="bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-lg flex items-center">
          <span class="material-icons mr-2">add</span>Añadir Artículo
        </button>
      </div>

      <div id="ie-totals" class="mt-6 text-right border-t pt-4"></div>
    </div>
  `;

  const elIVA    = container.querySelector('#ie-iva');
  const elTC     = container.querySelector('#ie-tc');
  const elList   = container.querySelector('#ie-items');
  const elAdd    = container.querySelector('#ie-add');
  const elTotals = container.querySelector('#ie-totals');

  // ------- Render principal -------
  function renderList() {
    elList.innerHTML = '';
    items.forEach((_, idx) => {
      const card = document.createElement('div');
      card.className = 'ie-card bg-white p-4 rounded-lg shadow-sm border';
      card.dataset.index = String(idx);
      elList.appendChild(card);
      updateCard(idx);
    });
    renderTotals();
    onChange({ items: getItems(), iva, tc, grandTotal: getGrandTotal() });
  }

  // Cálculo por línea y totales
  function computeLine(idx) {
    const it = items[idx] || {};
    const ivaFactor = 1 + (iva / 100);
    const totalBase = Number(it.total_linea_base || 0);
    const cant = Number(it.cantidad_factura || 0);
    const uxp  = Number(it.unidades_por_paquete || 1);
    const totalFinal = totalBase * ivaFactor * tc;
    const unidadesTot = cant * uxp;
    const precioUFinal = unidadesTot > 0 ? (totalFinal / unidadesTot) : 0;
    return { totalFinal, precioUFinal };
  }
  function getGrandTotal() {
    const ivaFactor = 1 + (iva / 100);
    return items.reduce((s, it) => s + ((it.total_linea_base || 0) * ivaFactor * tc), 0);
  }

  // Render de una tarjeta
  function updateCard(idx) {
    const it = items[idx];
    const card = elList.querySelector(`.ie-card[data-index="${idx}"]`);
    if (!card) return;

    const { totalFinal, precioUFinal } = computeLine(idx);
    const isAssociated = !!it.clave_catalogo;

    let priceComparisonHTML = '<div class="text-center text-slate-400 text-sm p-2">Asocia un artículo para comparar.</div>';
    if (isAssociated) {
      const cat = productCatalog.find(p => p.id === it.clave_catalogo);
      if (cat) {
        const ref = cat.PrecioU_Ref || 0;
        const diffPct = ref > 0 ? ((precioUFinal - ref) / ref) * 100 : 0;
        const diffClass = diffPct > 0.1 ? 'text-red-500' : (diffPct < -0.1 ? 'text-green-500' : 'text-slate-500');
        const diffSign  = diffPct > 0.1 ? '+' : '';
        priceComparisonHTML = `
          <div class="flex justify-between items-center text-sm">
            <span class="text-slate-500">Precio Ref.:</span>
            <span class="font-bold text-slate-800">${formatCurrency(ref)}</span>
          </div>
          <div class="mt-2 pt-2 border-t border-slate-200 flex items-center justify-center ${diffClass}">
            <div class="text-xl font-bold">${diffSign}${diffPct.toFixed(1)}%</div>
          </div>
        `;
      }
    }

    // Primer render
    if (!card.dataset.rendered) {
      const autoBadge = it.autoAssociated ? `<span class="bg-blue-100 text-blue-800 text-xs font-semibold px-2.5 py-0.5 rounded-full">Auto-asociado</span>` : '';
      card.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <label class="block text-sm font-medium text-slate-700">Descripción en Factura</label>
              ${autoBadge}
            </div>
            <div>
              <textarea data-field="descripcion_factura"
                        class="ie-input w-full p-2 border rounded text-slate-800"
                        rows="2">${it.descripcion_factura || ''}</textarea>
            </div>

            <div class="search-container relative">
              <label class="block text-sm font-medium text-slate-700">Asociar con Catálogo (Buscar)</label>
              <input type="text" class="ie-search w-full p-2 border rounded bg-white shadow-sm" placeholder="Escribe para buscar...">
              <div class="ie-results hidden absolute z-10 w-full bg-white border mt-1 rounded-md shadow-lg max-h-60 overflow-y-auto"></div>
              <div class="ie-selected text-sm mt-1"></div>
            </div>
          </div>

          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-slate-700">Cantidad</label>
                <input type="number" value="${it.cantidad_factura || 0}"
                       data-field="cantidad_factura" class="ie-input w-full p-2 border rounded text-slate-800">
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700">Total Base</label>
                <input type="text" value="${(it.total_linea_base || 0).toLocaleString('en-US')}"
                       data-field="total_linea_base" class="ie-input w-full p-2 border rounded text-right text-slate-800">
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-slate-700">Clave Proveedor</label>
              <input type="text" value="${it.clave_proveedor || ''}"
                     data-field="clave_proveedor" class="ie-input w-full p-2 border rounded text-slate-800">
            </div>

            <div class="p-3 rounded-md bg-slate-50 border">
              <h4 class="text-sm font-bold text-center text-slate-600 mb-2">Análisis de Precio Unitario (Final)</h4>
              <div class="text-center text-2xl font-bold text-emerald-600 ie-unit">${formatCurrency(precioUFinal)}</div>
              <div class="mt-2 pt-2 border-t ie-compare">${priceComparisonHTML}</div>
            </div>

            <div class="text-right">
              <button type="button" class="ie-del text-red-500 hover:text-red-700 font-bold" title="Eliminar artículo">Eliminar</button>
            </div>
          </div>
        </div>
      `;
      card.dataset.rendered = '1';
      updateSelectedDisplay(idx);
    } else {
      card.querySelector('.ie-unit').textContent = formatCurrency(precioUFinal);
      card.querySelector('.ie-compare').innerHTML = priceComparisonHTML;
      updateSelectedDisplay(idx);
    }

    // Borde según asociación
    card.classList.remove('border-slate-200','border-emerald-300');
    card.classList.add(isAssociated ? 'border-emerald-300' : 'border-slate-200');
  }

  function updateSelectedDisplay(idx) {
    const card = elList.querySelector(`.ie-card[data-index="${idx}"]`);
    if (!card) return;
    const display = card.querySelector('.ie-selected');
    const input   = card.querySelector('.ie-search');
    const it = items[idx];
    if (it.clave_catalogo && it.desc_catalogo) {
      display.innerHTML = `Asociado: <strong class="text-emerald-700">${it.desc_catalogo}</strong>
        <button class="ie-clear text-red-500 hover:text-red-700 font-bold ml-2" title="Desasociar">X</button>`;
      input.style.display = 'none';
    } else {
      display.innerHTML = '';
      input.style.display = 'block';
    }
  }

  function renderTotals() {
    const grand = getGrandTotal();
    const diff  = totalAI - grand;
    const cls   = Math.abs(diff) < 1 ? 'text-green-600' : 'text-red-600';
    elTotals.innerHTML = `
      <p class="text-sm">Total Factura (IA): <span class="font-bold text-slate-600">${formatCurrency(totalAI)}</span></p>
      <p class="text-lg">Total Calculado: <span class="font-bold text-slate-900">${formatCurrency(grand)}</span></p>
      <p class="text-sm ${cls}">Diferencia: <span class="font-bold">${formatCurrency(diff)}</span></p>
    `;
  }

  // ------- Eventos del editor -------
  container.addEventListener('input', (e) => {
    const card = e.target.closest('.ie-card');
    if (card && e.target.classList.contains('ie-input')) {
      const idx = Number(card.dataset.index);
      const field = e.target.dataset.field;
      const raw = e.target.value;
      const val = (field === 'cantidad_factura' || field === 'unidades_por_paquete' || field === 'total_linea_base')
        ? parseLocalFloat(raw) : raw;
      items[idx][field] = val;
      updateCard(idx);
      renderTotals();
      onChange({ items: getItems(), iva, tc, grandTotal: getGrandTotal() });
    }
  });

  container.addEventListener('click', (e) => {
    // Borrar
    if (e.target.classList.contains('ie-del')) {
      const card = e.target.closest('.ie-card');
      const idx = Number(card.dataset.index);
      items.splice(idx, 1);
      renderList();
      return;
    }
    // Desasociar
    if (e.target.classList.contains('ie-clear')) {
      const card = e.target.closest('.ie-card');
      const idx = Number(card.dataset.index);
      items[idx].clave_catalogo = null;
      items[idx].desc_catalogo  = null;
      updateCard(idx);
      renderTotals();
      onChange({ items: getItems(), iva, tc, grandTotal: getGrandTotal() });
      return;
    }
  });

  // Buscar en catálogo (al teclear)
  container.addEventListener('input', (e) => {
    if (!e.target.classList.contains('ie-search')) return;
    const card = e.target.closest('.ie-card');
    const idx = Number(card.dataset.index);
    const results = card.querySelector('.ie-results');
    const tokens = (e.target.value || '').toLowerCase().split(' ').filter(Boolean);
    results.innerHTML = '';
    if (!tokens.length) { results.classList.add('hidden'); return; }
    const list = productCatalog.filter(p => {
      const txt = `${p.nombre} ${p.clave}`.toLowerCase();
      return tokens.every(t => txt.includes(t));
    }).slice(0, 50);
    if (!list.length) { results.classList.add('hidden'); return; }
    list.forEach(p => {
      const div = document.createElement('div');
      div.className = 'p-2 hover:bg-emerald-100 cursor-pointer';
      div.textContent = `${p.nombre} (Clave: ${p.clave})`;
      div.dataset.clave = p.id;
      div.classList.add('ie-hit');
      results.appendChild(div);
    });
    results.classList.remove('hidden');
  });

  // Seleccionar un resultado de búsqueda
  container.addEventListener('click', (e) => {
    if (!e.target.classList.contains('ie-hit')) return;
    const card = e.target.closest('.ie-card');
    const idx  = Number(card.dataset.index);
    const clave = e.target.dataset.clave;
    const art = productCatalog.find(p => p.id === clave);
    if (art) {
      items[idx].clave_catalogo = clave;
      items[idx].desc_catalogo  = art.nombre;
    }
    card.querySelector('.ie-results').classList.add('hidden');
    card.querySelector('.ie-search').value = '';
    updateCard(idx);
    renderTotals();
    onChange({ items: getItems(), iva, tc, grandTotal: getGrandTotal() });
  });

  // Botón añadir ítem vacío
  elAdd.addEventListener('click', () => {
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
    renderList();
  });

  // IVA / TC
  container.addEventListener('input', (e) => {
    if (!e.target.classList.contains('ie-recalc')) return;
    iva = Number(elIVA.value) || 0;
    tc  = Number(elTC.value)  || 1;
    // Solo re-render totales y tarjetas (precios unitarios)
    elList.querySelectorAll('.ie-card').forEach(card => {
      updateCard(Number(card.dataset.index));
    });
    renderTotals();
    onChange({ items: getItems(), iva, tc, grandTotal: getGrandTotal() });
  });

  // ------- API pública -------
  function setItems(arr = []) {
    items = arr.map(x => ({ ...x }));
    renderList();
  }
  // Anexar SIEMPRE (tu requerimiento). Si quisieras dedupe, podrías agregarlo aquí.
  function addItems(arr = []) {
    items.push(...arr.map(x => ({ ...x })));
    renderList();
  }
  function getItems() {
    return items.map(x => ({ ...x }));
  }
  function setInvoiceTotal(n) {
    totalAI = Number(n) || 0;
    renderTotals();
  }
  function setParams({ iva: nIva, tipoCambio }) {
    if (typeof nIva === 'number') { iva = nIva; elIVA.value = String(nIva); }
    if (typeof tipoCambio === 'number') { tc = tipoCambio; elTC.value = String(tipoCambio); }
    // Recalcular
    elList.querySelectorAll('.ie-card').forEach(card => updateCard(Number(card.dataset.index)));
    renderTotals();
  }
  function getGrandTotalPublic() {
    return getGrandTotal();
  }
  function destroy() {
    container.innerHTML = '';
  }

  // Render inicial
  renderList();

  return {
    setItems,
    addItems,
    getItems,
    setInvoiceTotal,
    setParams,
    getGrandTotal: getGrandTotalPublic,
    destroy
  };
}
