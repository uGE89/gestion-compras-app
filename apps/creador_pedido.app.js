// apps/creador_pedido.app.js
import { SearchBar, Paginator } from '../framework/components.js';

export default {
  async mount(container, { appState, auth, db }) {
    // ===== Espera segura y acceso a los datos =====
    if (!appState?.isCatalogReady) {
      container.innerHTML = `<div class="p-10 text-center text-gray-500">Cargando datos...</div>`;
      for (let i = 0; i < 150 && !appState.isCatalogReady; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!appState.isCatalogReady) {
        console.error("Catálogo no listo. La app de pedidos no puede inicializarse.");
        return;
      }
    }

    const productCatalog = appState.productCatalog;
    const allProveedores = appState.allProveedores;

    // ===== Helpers =====

    // --- UI: alerta simple con 1 botón Aceptar (warning/success) ---
const uiAlert = (message, { title = 'Aviso', variant = 'warning' } = {}) => {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';

    const color = variant === 'success' ? 'emerald' : 'amber';
    const iconPath =
      variant === 'success'
        ? 'M9 12.75 11.25 15 15 9.75m-3-7.5a9 9 0 11-9 9 9 9 0 019-9Z'
        : 'M12 9v3.75m0 3.75h.007M21 12a9 9 0 11-18 0 9 9 0 0118 0z';

    const modal = document.createElement('div');
    modal.className = 'w-full max-w-md rounded-xl bg-white shadow-2xl';
    modal.innerHTML = `
      <div class="flex items-start gap-3 p-5">
        <div class="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-${color}-100 text-${color}-600">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}" />
          </svg>
        </div>
        <div class="min-w-0">
          <h3 class="text-base font-semibold text-slate-900">${title}</h3>
          <p class="mt-1 text-sm text-slate-600">${message}</p>
        </div>
      </div>
      <div class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
        <button id="ui-alert-ok"
          class="inline-flex items-center rounded-lg bg-${color}-600 px-4 py-2 text-sm font-semibold text-white hover:bg-${color}-700 focus:outline-none">
          Aceptar
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const okBtn = modal.querySelector('#ui-alert-ok');
    const close = () => {
      document.body.removeChild(overlay);
      resolve();
    };

    okBtn.addEventListener('click', close);
    // Cerrar con ESC
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey, { once: true });

    // Evitar cerrar por click en fondo (solo botón Aceptar)
  });
};


    const getUltimoProveedor = (p) => {
      const arr = (p?.stats?.preciosCompraRecientes || []);
      if (!arr.length) return '';
      const sorted = [...arr].sort((a, b) => new Date(b.Fecha) - new Date(a.Fecha));
      return sorted[0]?.Proveedor || '';
    };

    const formatMoney = (n) => {
      const v = Number(n ?? 0);
      return isNaN(v)
        ? '—'
        : v.toLocaleString('es-NI', {
            style: 'currency',
            currency: 'NIO',
            maximumFractionDigits: 2,
          });
    };

    // Detecta stocks por sucursal con fallback a campos Alm_1..Alm_4
    const getStocksByBranch = (p) => {
      if (p?.stocks && typeof p.stocks === 'object') {
        return Object.entries(p.stocks)
          .filter(([k, v]) => v != null)
          .map(([name, qty], idx) => ({ name: String(idx + 1), qty }));
      }
      const branches = ['Alm_1', 'Alm_2', 'Alm_3', 'Alm_4'];
      const list = [];
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        if (p[b] != null) list.push({ name: String(i + 1), qty: p[b] });
      }
      return list;
    };

    // Precios de compra/venta con fallbacks comunes
    const getPreciosRef = (p) => {
      const compra = p?.PrecioU_Ref ?? p?.stats?.PrecioU_Ref ?? p?.precioCompra ?? p?.precio_u ?? null;
      const venta = p?.PrecioVta_Ref ?? p?.stats?.PrecioVta_Ref ?? p?.precioVenta ?? p?.precio_v ?? null;
      return { compra, venta };
    };

    const getTodayStr = () => {
      const d = new Date();
      const z = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
    };

    const normalizeText = (str) =>
      String(str ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    const normalizeId = (value) => {
      const str = String(value ?? '');
      const trimmed = str.replace(/^0+/, '');
      return trimmed || str;
    };

    // ===== Estado UI y del Pedido Actual =====
    let currentOrder = new Map(); // id -> { product, quantity }
    let lastFilteredProducts = [];
    let reorderFilterActive = false;

    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    let currentPage = parseInt(params.get('p') || '1', 10);
    let searchTerm = params.get('q') || '';
    let selectedSupplierName = params.get('prov') || 'all';

    const ITEMS_PER_PAGE = 15;

    // Carga y guarda borrador del pedido
    const loadDraftOrder = () => {
      const savedDraft = localStorage.getItem('draftOrder');
      if (!savedDraft) return;
      try {
        const draft = JSON.parse(savedDraft);
        for (const id in draft) {
          const normalizedId = normalizeId(id);
          const product = productCatalog.find((p) => normalizeId(p.id) === normalizedId);
          if (product) {
            currentOrder.set(normalizedId, { product, quantity: draft[id] });
          }
        }
      } catch (e) {
        console.error('Error al cargar el borrador del pedido:', e);
        localStorage.removeItem('draftOrder');
      }
    };

    const saveDraftOrder = () => {
      const draftToSave = {};
      currentOrder.forEach((item, id) => {
        draftToSave[id] = item.quantity;
      });
      localStorage.setItem('draftOrder', JSON.stringify(draftToSave));
    };

    // ===== UI base (esqueleto) =====
    container.innerHTML = `
      <div class="p-4 border-b bg-white">
        <h1 class="text-xl font-bold text-gray-800">Creación de Pedidos</h1>
      </div>
      <div class="p-3 border-b bg-white space-y-3">
        <div id="toolbar" class="flex items-center gap-2"></div>
        <div>
          <label class="block text-xs text-gray-500 mb-1">Proveedor</label>
          <select id="supplier-filter" class="w-full p-2 border rounded-lg text-sm"></select>
        </div>
      </div>
      <div class="flex-grow overflow-y-auto">
        <table class="w-full text-sm"><tbody id="product-list"></tbody></table>
      </div>
      <div id="pagination-controls" class="p-2 border-t bg-white flex justify-between items-center text-sm"></div>

      <div class="p-3 border-t sticky bottom-0 bg-gray-50">
        <div class="flex gap-2">
          <button id="nav-my-orders-btn"
                  class="flex-1 bg-white border text-gray-700 font-medium py-2 px-3 rounded-lg hover:bg-gray-100">
            Mis pedidos
          </button>
          <button id="save-order-btn"
                  class="flex-1 bg-emerald-600 text-white font-semibold py-2 px-3 rounded-lg hover:bg-emerald-700">
            Guardar pedido (<span id="current-order-count">0</span>)
          </button>
        </div>
      </div>

      <div class="fixed bottom-6 right-6 z-50">
        <div id="fab-menu" class="hidden mb-4 flex flex-col items-end space-y-2">
          <button id="apply-suggestions-btn" class="px-4 py-2 rounded-lg bg-indigo-600 text-white shadow hover:bg-indigo-700">Aplicar sugeridos</button>
          <button id="new-order-btn" class="px-4 py-2 rounded-lg bg-red-600 text-white shadow hover:bg-red-700">Nuevo pedido</button>
        </div>
        <button id="fab-main-btn" class="w-14 h-14 rounded-full bg-emerald-600 text-white shadow-lg flex items-center justify-center text-2xl">+</button>
      </div>

    `;

    // Referencias al DOM
    const productListEl = container.querySelector('#product-list');
    const supplierFilterEl = container.querySelector('#supplier-filter');
    const toolbarEl = container.querySelector('#toolbar');
    const paginationEl = container.querySelector('#pagination-controls');
    const currentOrderCountEl = container.querySelector('#current-order-count');
    const fabMenuEl = container.querySelector('#fab-menu');
    const fabMainBtn = container.querySelector('#fab-main-btn');
    const applySuggestionsBtn = container.querySelector('#apply-suggestions-btn');
    const newOrderBtn = container.querySelector('#new-order-btn');

    // Barra de búsqueda + botón de reposición
    const searchInput = SearchBar({
      placeholder: 'Buscar producto...',
      onChange: (value) => {
        searchTerm = value;
        applyFiltersAndRender();
        persistState();
      },
    });

    const reorderFilterBtn = document.createElement('button');
    reorderFilterBtn.id = 'reorder-filter-btn';
    reorderFilterBtn.className = 'p-2 border rounded-lg text-gray-500 hover:bg-gray-100 transition-colors';
    reorderFilterBtn.title = 'Mostrar solo para reponer';
    reorderFilterBtn.innerHTML = `
      <svg class="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clip-rule="evenodd" />
      </svg>`;

    toolbarEl.appendChild(searchInput.el);
    toolbarEl.appendChild(reorderFilterBtn);

    // ===== Lógica de Negocio y Renderizado =====
    function updateOrderCount() {
      currentOrderCountEl.textContent = currentOrder.size;
    }

    const updateOrder = (productId, quantity) => {
      const normalizedId = normalizeId(productId);
      if (quantity > 0) {
        const product = productCatalog.find((p) => normalizeId(p.id) === normalizedId);
        if (product) {
          currentOrder.set(normalizedId, { product, quantity });
        }
      } else {
        currentOrder.delete(normalizedId);
      }
      updateOrderCount();
      saveDraftOrder();
      renderProductList();
    };

    const renderProductList = () => {
      const filtered = filterAndSortProducts();
      lastFilteredProducts = filtered;

      const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE) || 1;
      const start = (currentPage - 1) * ITEMS_PER_PAGE;
      const pageItems = filtered.slice(start, start + ITEMS_PER_PAGE);

      productListEl.innerHTML =
        pageItems.map(createProductRowHTML).join('') ||
        `<tr class="p-4 text-center text-gray-500"><td colspan="2">Sin resultados</td></tr>`;

      const paginator = Paginator({
        page: currentPage,
        pageSize: ITEMS_PER_PAGE,
        total: filtered.length,
        onChange: ({ page: p }) => {
          currentPage = p;
          renderProductList();
          persistState();
        },
      });
      paginationEl.innerHTML = '';
      paginationEl.appendChild(paginator.el);
    };

    const filterAndSortProducts = () => {
      let filtered = productCatalog;

      if (reorderFilterActive) {
        filtered = filtered.filter((p) => p.kpis?.cantidadSugerida > 0);
      }

      if (selectedSupplierName !== 'all') {
        filtered = filtered.filter((p) => getUltimoProveedor(p) === selectedSupplierName);
      }

      if (searchTerm) {
        const tokens = normalizeText(searchTerm).split(/\s+/).filter(Boolean);
        filtered = filtered.filter((p) => {
          const haystack = normalizeText(`${p.nombre} ${p.clave}`);
          return tokens.every((t) => haystack.includes(t));
        });
      }

      filtered.sort((a, b) => ((b.kpis?.PrioridadScore) || 0) - ((a.kpis?.PrioridadScore) || 0));
      return filtered;
    };

    const applyFiltersAndRender = () => {
      currentPage = 1;
      renderProductList();
    };

    const createProductRowHTML = (p) => {
      const orderedItem = currentOrder.get(normalizeId(p.id));
      const isOrdered = !!orderedItem;
      const cantidadSugerida = p.kpis?.cantidadSugerida || 0;

      const ultimoProv = getUltimoProveedor(p);
      const { compra, venta } = getPreciosRef(p);
      const stocks = getStocksByBranch(p);
      const total = Number(p.stockTotal ?? stocks.reduce((acc, s) => acc + (Number(s.qty) || 0), 0));

      const provPill = ultimoProv
        ? `<span class="px-3 py-1 rounded-full text-xs font-semibold text-white" style="background:#2563EB">${ultimoProv}</span>`
        : `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">Sin proveedor</span>`;

      const riesgoPill = p.kpis?.RiesgoRuptura
        ? `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">En riesgo</span>`
        : `<span class="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Ok</span>`;

      const sugeridoBtn = cantidadSugerida > 0
        ? `<button type="button"
              class="sugerido-toggle-btn w-full mt-2 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm"
              title="Usar sugerido: ${cantidadSugerida}"
              data-product-id="${p.id}" data-quantity="${cantidadSugerida}">
              Sugerido (${cantidadSugerida})
           </button>`
        : '';

      const quickClearBtn = isOrdered
        ? `<button type="button"
              class="quick-clear-btn absolute -right-2 -top-2 h-8 w-8 flex items-center justify-center rounded-full bg-white border text-red-500 hover:text-red-700 shadow"
              title="Borrar del pedido" data-product-id="${p.id}">
              <i class="fas fa-trash-can text-sm"></i>
           </button>`
        : '';

      const stockChips = stocks.length
        ? stocks.map(s => `
            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
              ${s.name}: <span class="ml-1 font-semibold">${Number(s.qty) || 0}</span>
            </span>`).join(' ')
        : `<span class="text-[11px] text-slate-400">Sin desglose</span>`;

      const footer = isOrdered
        ? `<div class="mt-3 bg-emerald-50 text-emerald-700 text-center font-semibold rounded-2xl px-4 py-3">
             En pedido: ${orderedItem.quantity}
           </div>`
        : '';

      return `
        <tr data-product-id="${p.id}">
          <td colspan="2" class="p-2">
            <article class="relative bg-white border rounded-3xl shadow-md hover:shadow-lg transition overflow-hidden">
              ${quickClearBtn}
              <div class="p-4">
                <div class="flex items-start justify-between gap-4">
                  <div class="flex flex-wrap items-center gap-2">
                    ${provPill}
                    ${riesgoPill}
                  </div>
                  <div class="w-32 shrink-0">
                    <input
                      type="number"
                      class="quantity-input w-full h-11 text-center border rounded-2xl px-2 placeholder:text-gray-400"
                      value="${isOrdered ? orderedItem.quantity : ''}"
                      placeholder="${cantidadSugerida > 0 ? cantidadSugerida : '0'}"
                      min="0" data-id="${p.id}">
                    ${sugeridoBtn}
                  </div>
                </div>

                <div class="mt-3">
                  <h3 class="text-lg md:text-xl font-bold text-slate-900">${p.nombre}</h3>
                  <div class="mt-0.5 text-sm text-slate-500">
                    Clave: <span class="font-medium text-slate-700">${p.clave}</span>
                    <span class="mx-2 text-slate-300">•</span>
                    Total: <span class="font-semibold">${Number.isFinite(total) ? total : '—'}</span>
                  </div>
                  <div class="mt-1 text-sm">
                    <span class="text-slate-500">Costo:</span> <span class="font-semibold text-slate-700">${formatMoney(compra)}</span>
                    <span class="mx-2 text-slate-300">•</span>
                    <span class="text-slate-500">Venta:</span> <span class="font-semibold text-slate-700">${formatMoney(venta)}</span>
                  </div>
                  <div class="mt-2 flex flex-wrap gap-1">
                    ${stockChips}
                  </div>
                  ${footer}
                </div>
              </div>
            </article>
          </td>
        </tr>`;
    };

    const populateSupplierFilter = () => {
      supplierFilterEl.innerHTML = '<option value="all">Todos los proveedores</option>';
      allProveedores.forEach((name) => {
        const o = document.createElement('option');
        o.value = name;
        o.textContent = name;
        supplierFilterEl.appendChild(o);
      });
      supplierFilterEl.value = selectedSupplierName;
    };

    const persistState = () => {
      const qs = new URLSearchParams({
        q: searchTerm,
        p: String(currentPage),
        prov: selectedSupplierName,
        solo: reorderFilterActive ? '1' : '',
      });
      history.replaceState(null, '', `#/pedidos?${qs.toString()}`);
    };

    // ===== Manejadores de Eventos =====
    const setupEventListeners = () => {
      const debouncedFilter = (fn, ms = 300) => {
        let t;
        return (...a) => {
          clearTimeout(t);
          t = setTimeout(() => fn(...a), ms);
        };
      };
      const debouncedApplyFilter = debouncedFilter(applyFiltersAndRender);

      supplierFilterEl.addEventListener('change', () => {
        selectedSupplierName = supplierFilterEl.value;
        applyFiltersAndRender();
        persistState();
      });

      reorderFilterBtn.addEventListener('click', () => {
        reorderFilterActive = !reorderFilterActive;
        reorderFilterBtn.classList.toggle('bg-blue-100', reorderFilterActive);
        reorderFilterBtn.classList.toggle('text-blue-600', reorderFilterActive);
        applyFiltersAndRender();
        persistState();
      });

      fabMainBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fabMenuEl.classList.toggle('hidden');
      });

      document.addEventListener('click', (e) => {
        if (!fabMenuEl.contains(e.target) && !fabMainBtn.contains(e.target)) {
          fabMenuEl.classList.add('hidden');
        }
      });

      applySuggestionsBtn.addEventListener('click', () => {
        fabMenuEl.classList.add('hidden');
        lastFilteredProducts.forEach((p) => {
          const sugerida = p.kpis?.cantidadSugerida || 0;
          if (sugerida > 0) {
            const currentQty = Number(currentOrder.get(normalizeId(p.id))?.quantity) || 0;
            if (!(currentQty > 0)) {
              updateOrder(p.id, sugerida);
            }
          }
        });
      });

      newOrderBtn.addEventListener('click', () => {
        fabMenuEl.classList.add('hidden');
        currentOrder.clear();
        localStorage.removeItem('draftOrder');
        updateOrderCount();
        searchTerm = '';
        searchInput.input.value = '';
        selectedSupplierName = 'all';
        supplierFilterEl.value = 'all';
        reorderFilterActive = false;
        reorderFilterBtn.classList.remove('bg-blue-100', 'text-blue-600');
        currentPage = 1;
        renderProductList();
        persistState();
      });

      function abrirDetalles(productId) {
        // 100% compatible con el router
        const from = encodeURIComponent(location.hash || '#/pedidos');
        location.hash = `#/detalles?id=${encodeURIComponent(productId)}&from=${from}`;
      }

      // Ir a la vista "Mis pedidos"
      container.querySelector('#nav-my-orders-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        // Usa la vista legacy registrada en index.html
        location.hash = '#/mis_pedidos';
        // Si más adelante creas una app modular: location.hash = '#/mis-pedidos';
      });

      // Guardar pedido (Firestore con esquema del ejemplo)
      container.querySelector('#save-order-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();

  const user = auth?.currentUser;
  if (!user) {
    await uiAlert('Debes iniciar sesión para guardar un pedido.', {
      title: 'Acceso requerido',
      variant: 'warning'
    });
    return;
  }

  if (currentOrder.size === 0) {
    await uiAlert('No tienes productos en el pedido actual.', {
      title: 'Pedido vacío',
      variant: 'warning'
    });
    return;
  }

  // Proveedor: debe estar seleccionado en el filtro (sin prompt)
  const supplier = selectedSupplierName;
  if (!supplier || supplier === 'all') {
    await uiAlert('Selecciona un proveedor en el filtro para poder guardar el pedido.', {
      title: 'Proveedor requerido',
      variant: 'warning'
    });
    return;
  }

  // Items ordenados alfabéticamente por descripción
  const items = Array.from(currentOrder.values())
    .map(({ product, quantity }) => ({
      productoId: product.id,
      nombre: product.nombre,
      cantidad: quantity,
      costoUnitario: Number(product.PrecioU_Ref || 0),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const total = items.reduce((s, it) => s + it.costoUnitario * it.cantidad, 0);

  // Deshabilita botón mientras guarda (mejora UX)
  const saveBtn = container.querySelector('#save-order-btn');
  let originalText = saveBtn?.textContent;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Guardando...'; }

  try {
    const { addDoc, collection, serverTimestamp } = await import(
      'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js'
    );

    const orderData = {
      userId: user.uid,
      proveedorNombre: supplier,
      items,
      total,
      estado: 'Borrador',
      fechaCreacion: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await addDoc(collection(db, 'pedidos'), orderData);

    // Limpieza local
    currentOrder.clear();
    localStorage.removeItem('draftOrder');
    updateOrderCount();
    renderProductList();

    await uiAlert(`El pedido para ${supplier} se guardó correctamente.`, {
      title: 'Pedido guardado',
      variant: 'success'
    });
  } catch (err) {
    console.error('Error guardando pedido:', err);
    await uiAlert('No se pudo guardar el pedido. Revisa la consola para más detalles.', {
      title: 'Error al guardar',
      variant: 'warning'
    });
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalText || 'Guardar pedido'; }
  }
});


      // Acciones de botones rápidos + navegación a detalles protegida
      container.addEventListener('click', (e) => {
        const quickClearBtn = e.target.closest('.quick-clear-btn');
        const sugeridoToggleBtn = e.target.closest('.sugerido-toggle-btn');

        if (sugeridoToggleBtn) {
          e.stopPropagation();
          e.preventDefault();
          const productId = sugeridoToggleBtn.dataset.productId;
          const suggested = parseInt(sugeridoToggleBtn.dataset.quantity, 10) || 0;
          const row = sugeridoToggleBtn.closest('tr[data-product-id]');
          const input = row?.querySelector('input.quantity-input');
          const currentVal = parseInt(input?.value, 10) || 0;

          if (currentVal === suggested) {
            if (input) input.value = '';
            updateOrder(productId, 0);
            sugeridoToggleBtn.title = `Usar sugerido: ${suggested}`;
          } else {
            if (input) input.value = suggested;
            updateOrder(productId, suggested);
            sugeridoToggleBtn.title = `Borrar sugerido`;
          }
          return;
        }

        if (quickClearBtn) {
          e.stopPropagation();
          e.preventDefault();
          updateOrder(quickClearBtn.dataset.productId, 0);
          return;
        }


      });

      // Navegación a detalles (evitar conflicto con botones e input)
      productListEl.addEventListener('click', (e) => {
        if (
          e.target.closest('.quick-clear-btn') ||
          e.target.closest('.sugerido-toggle-btn') ||
          e.target.closest('input.quantity-input') ||
          e.target.tagName === 'BUTTON' ||
          e.target.closest('button')
        )
          return;

        const row = e.target.closest('tr[data-product-id]');
        if (row) abrirDetalles(row.dataset.productId);
      });

      container.addEventListener('change', (e) => {
        const input = e.target;
        if (input.classList.contains('quantity-input')) {
          updateOrder(input.dataset.id, parseInt(input.value, 10) || 0);
        }
      });
    };

    // ===== Inicialización =====
    loadDraftOrder();
    populateSupplierFilter();
    setupEventListeners();
    renderProductList();
    updateOrderCount();
  },
};