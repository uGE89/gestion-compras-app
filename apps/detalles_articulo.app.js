// apps/detalles_articulo.app.js

import { normalizeId } from './lib/helpers.js';

export default {
  async mount(container, { appState, params }) {
    // Registrar el plugin DataLabels si está disponible por CDN
    if (window.Chart && window.ChartDataLabels) {
      window.Chart.register(window.ChartDataLabels);
    }

    // Fallback robusto para obtener el id desde el hash si params no llegó
    const hashSearch = (location.hash.split('?')[1] || '');
    const safeParams = (params instanceof URLSearchParams)
      ? params
      : new URLSearchParams(hashSearch);

    const fromInUrl = safeParams.get('from');
    if (fromInUrl) sessionStorage.setItem('last_from_pedidos', fromInUrl);
    const productId =
      safeParams.get('id') ||
      safeParams.get('productoId') ||
      safeParams.get('pid');
    if (!productId) {
      container.innerHTML = `<div class="p-10 text-center text-gray-500">Producto no especificado.</div>`;
      return;
    }

    if (!appState?.isCatalogReady) {
      container.innerHTML = `<div class="p-10 text-center text-gray-500">Cargando datos...</div>`;
      for (let i = 0; i < 150 && !appState.isCatalogReady; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!appState.isCatalogReady) return;
    }

    const product = appState.productCatalog.find(p => normalizeId(p.id) === normalizeId(productId));
    if (!product) {
      container.innerHTML = `<div class="p-10 text-center text-red-500">Producto no encontrado.</div>`;
      return;
    }

    // Helpers
    const currency = (n) => 'C$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const parseDate = (s) => new Date(s);

    // Render
    const createKpiBox = (title, value, icon, color='bg-gray-100') => `
      <div class="kpi-box p-4 rounded-lg shadow ${color}">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-blue-100 text-blue-600 mr-4">
            <i class="fas ${icon}"></i>
          </div>
          <div>
            <p class="text-sm text-gray-500">${title}</p>
            <p class="text-2xl font-bold">${value}</p>
          </div>
        </div>
      </div>`;

    const renderCharts = (ventas24, preciosCompraRecientes) => {
      const salesCanvas = container.querySelector('#salesChart');
      if (salesCanvas && window.Chart && ventas24 && Object.keys(ventas24).length > 0) {
        const sortedMonths = Object.keys(ventas24).sort();
        new window.Chart(salesCanvas, {
          type: 'bar',
          data: {
            labels: sortedMonths.map(dateStr => parseDate(dateStr + '-02')
              .toLocaleString('es-ES', { month: 'short', year: '2-digit' })),
            datasets: [{
              label: 'Unidades Vendidas',
              data: sortedMonths.map(month => ventas24[month]),
              backgroundColor: 'rgba(59,130,246,0.5)',
              borderColor: 'rgba(59,130,246,1)',
              borderWidth: 1
            }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
      }

      const purchasesCanvas = container.querySelector('#purchasesChart');
      if (purchasesCanvas && window.Chart && preciosCompraRecientes && preciosCompraRecientes.length > 0) {
        const sortedPurchases = [...preciosCompraRecientes].sort((a, b) => parseDate(a.Fecha) - parseDate(b.Fecha));
        new window.Chart(purchasesCanvas, {
          type: 'line',
          data: {
            labels: sortedPurchases.map(p => parseDate(p.Fecha).toLocaleDateString('es-ES')),
            datasets: [{
              label: 'Precio de Compra',
              data: sortedPurchases.map(p => p['Precio Com']),
              borderColor: 'rgba(239,68,68,1)',
              backgroundColor: 'rgba(239,68,68,0.1)',
              fill: true,
              tension: 0.2
            }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
      }

      const historyContainer = container.querySelector('#purchase-history-container');
      if (historyContainer && preciosCompraRecientes && preciosCompraRecientes.length > 0) {
        const sortedHistory = [...preciosCompraRecientes].sort((a, b) => parseDate(b.Fecha) - parseDate(a.Fecha));
        let tableHTML = `<table class="w-full text-sm text-left">
          <thead class="bg-gray-50 sticky top-0">
            <tr>
              <th class="p-2 font-semibold">Fecha</th>
              <th class="p-2 font-semibold">Proveedor</th>
              <th class="p-2 font-semibold text-right">Cantidad</th>
              <th class="p-2 font-semibold text-right">Precio Unit.</th>
            </tr>
          </thead><tbody>`;
        sortedHistory.forEach(compra => {
          tableHTML += `<tr class="border-b hover:bg-gray-50">
            <td class="p-2">${parseDate(compra.Fecha).toLocaleDateString('es-ES')}</td>
            <td class="p-2">${compra.Proveedor}</td>
            <td class="p-2 text-right">${compra.Cant}</td>
            <td class="p-2 text-right font-mono">${currency(compra['Precio Com'])}</td>
          </tr>`;
        });
        historyContainer.innerHTML = tableHTML + '</tbody></table>';
      } else if (historyContainer) {
        historyContainer.innerHTML = '<p class="text-sm text-gray-500 p-4 text-center">No hay historial de compras.</p>';
      }
    };

    const renderDetails = () => {
      const kpis = product.kpis || {};
      const stats = product.stats || {};
      const analysisText = kpis.RazonRedondeo
        ? `<p>Razón: ${kpis.RazonRedondeo} (usando pack de ${kpis.PackUsado}).</p>`
        : `<p>Análisis no disponible.</p>`;

      container.innerHTML = `
        <div class="p-4 md:p-6 bg-white">
          <button id="btn-volver" class="flex items-center text-blue-600 hover:text-blue-800 font-semibold mb-4">
            <i class="fas fa-arrow-left mr-2"></i> Volver a la lista
          </button>
          <h2 class="text-2xl font-bold text-gray-800">${product.nombre}</h2>
          <p class="text-md text-gray-500 mb-4">Clave: ${product.clave}</p>
        </div>

        <div class="p-4 md:p-6 flex-grow overflow-y-auto">
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            ${createKpiBox('Stock', product.stockTotal, 'fa-boxes-stacked', product.stockTotal < 0 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800')}
            ${createKpiBox('Sugerido', kpis.cantidadSugerida || 0, 'fa-lightbulb', (kpis.RiesgoRuptura) ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800')}
            ${createKpiBox('Pto. Reorden', (kpis.puntoDeReorden || 0).toFixed(1), 'fa-bullseye')}
            ${createKpiBox('Venta Mensual', (kpis.vmp || 0).toFixed(1), 'fa-chart-line')}
            ${createKpiBox('Días Inventario', kpis.diasInv === Infinity ? '∞' : (kpis.diasInv || 0).toFixed(1), 'fa-calendar-days')}
            ${createKpiBox('Costo Est.', `C$${(product.PrecioU_Ref || 0).toFixed(2)}`, 'fa-dollar-sign')}
          </div>

          <div class="bg-blue-50 border border-blue-200 p-4 rounded-lg text-sm mb-6">
            <h4 class="font-bold mb-2"><i class="fas fa-info-circle mr-2"></i>Análisis</h4> 
            <p>Sugerencia de pedido: <strong>${kpis.cantidadSugerida || 0}</strong> unidades.</p>
            ${analysisText}
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
            <div class="bg-white p-4 rounded-lg shadow">
              <h3 class="font-semibold mb-2 text-gray-700">Tendencia de Ventas Mensuales</h3>
              <div class="chart-container"><canvas id="salesChart"></canvas></div>
            </div>
            <div class="bg-white p-4 rounded-lg shadow">
              <h3 class="font-semibold mb-2 text-gray-700">Evolución del Precio de Compra</h3>
              <div class="chart-container"><canvas id="purchasesChart"></canvas></div>
            </div>
            <div class="bg-white p-4 rounded-lg shadow col-span-1 lg:col-span-2">
              <h3 class="font-semibold mb-2 text-gray-700">Historial de Compras Recientes</h3>
              <div id="purchase-history-container" class="max-h-64 overflow-y-auto"></div>
            </div>
          </div>
        </div>
      `;

      renderCharts(stats.ventas24, stats.preciosCompraRecientes);

      // Manejo "Volver": intentar tomar ?from=..., luego sessionStorage, y fallback a #/creador_pedido
      const btnVolver = container.querySelector('#btn-volver');
      if (btnVolver) {
        btnVolver.addEventListener('click', (e) => {
          e.preventDefault();

          const hashSearch = (location.hash.split('?')[1] || '');
          const qp = new URLSearchParams(hashSearch);
          let from = qp.get('from');

          if (!from) from = sessionStorage.getItem('last_from_pedidos');
          if (!from) from = '#/creador_pedido';

          try { from = decodeURIComponent(from); } catch (_) {}
          if (!from.startsWith('#')) from = '#/creador_pedido';

          location.hash = from;
        });
      }
    };

    // Render inicial
    renderDetails();
  },

  unmount() {
    // si agregas listeners locales aquí, límpialos
  }
};