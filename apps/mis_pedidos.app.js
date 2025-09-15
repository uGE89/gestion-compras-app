// apps/mis_pedidos.app.js
import { FIREBASE_BASE } from './lib/constants.js';

export default {
  async mount(container, { appState, auth, db }) {
    // === UI base ===
    container.innerHTML = `
      <div class="p-4 border-b bg-white">
        <h1 class="text-xl font-bold text-gray-800">Mis pedidos</h1>
      </div>

      <div id="mis-pedidos-content" class="flex flex-col flex-grow overflow-hidden">
        <div class="flex flex-col flex-grow overflow-y-auto p-4">
          <h2 class="text-lg font-semibold mb-3">Pedidos Guardados</h2>
          <div id="saved-orders-list" class="space-y-3"></div>
        </div>
      </div>

      <!-- Modal: vista de pedido -->
      <div id="order-modal" class="fixed inset-0 bg-gray-900 bg-opacity-50 hidden items-center justify-center z-50">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
          <div class="p-5 border-b flex justify-between items-center">
            <h2 class="text-2xl font-bold">Pedido</h2>
            <button id="close-modal-btn" class="text-gray-500 hover:text-gray-800 text-2xl" aria-label="Cerrar">&times;</button>
          </div>
          <div class="p-5 overflow-y-auto flex-grow">
            <div id="order-header" class="mb-4 text-sm text-gray-600"></div>
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b">
                  <th class="text-left p-2">Producto</th>
                  <th class="text-center p-2 w-28">Cantidad</th>
                  <th class="text-right p-2 w-28">Costo U.</th>
                  <th class="text-right p-2 w-32">Subtotal</th>
                </tr>
              </thead>
              <tbody id="current-order-items"></tbody>
            </table>
          </div>
          <div class="p-5 border-t bg-gray-50 flex justify-between items-center">
            <div>
              <p class="text-gray-600">Total de Artículos: <span id="total-items-modal" class="font-bold">0</span></p>
              <p class="text-2xl font-bold">Total: <span id="total-cost-modal">C$0.00</span></p>
            </div>
            <div class="flex gap-2">
              <button id="print-order-btn" class="bg-blue-600 text-white font-bold py-3 px-5 rounded-lg hover:bg-blue-700 transition-colors">
                <i class="fas fa-print mr-2"></i>Imprimir
              </button>
              <button id="close-modal-btn-2" class="bg-slate-200 text-slate-800 font-semibold py-3 px-5 rounded-lg hover:bg-slate-300 transition-colors">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // === Estado ===
    const savedOrdersEl = container.querySelector('#saved-orders-list');
    const orderModal = container.querySelector('#order-modal');
    const orderHeaderEl = container.querySelector('#order-header');
    const itemsTbody = container.querySelector('#current-order-items');
    const totalItemsEl = container.querySelector('#total-items-modal');
    const totalCostEl = container.querySelector('#total-cost-modal');

    let currentUser = auth?.currentUser || null;
    let savedOrders = [];
    let openedOrder = null; // { id, ...data }

    // === Helpers ===
    const formatMoney = (n) =>
      Number(n ?? 0).toLocaleString('es-NI', { style: 'currency', currency: 'NIO', maximumFractionDigits: 2 });

    const formatDate = (d) => {
      try {
        return new Date(d).toLocaleDateString('es-ES');
      } catch { return 'N/A'; }
    };

    const createSavedOrderHTML = (o) => {
      const fecha = o.fechaCreacion?.seconds
        ? new Date(o.fechaCreacion.seconds * 1000).toLocaleDateString('es-ES')
        : 'N/A';
      return `
        <div class="p-3 rounded border flex justify-between items-center bg-white hover:bg-gray-50">
          <div>
            <p class="font-semibold">Pedido a ${o.proveedorNombre || 'N/A'}</p>
            <p class="text-sm text-gray-500">
              Fecha: ${fecha} • Items: ${o.items?.length || 0} • Total: ${formatMoney(o.total || 0)}
            </p>
          </div>
          <div class="flex gap-3">
            <button class="text-blue-600 hover:underline text-sm open-order-btn" data-order-id="${o.id}">Abrir</button>
            <button class="text-green-600 hover:underline text-sm print-order-btn" data-order-id="${o.id}">Imprimir</button>
          </div>
        </div>
      `;
    };

    function renderSavedOrders() {
      if (!savedOrders.length) {
        savedOrdersEl.innerHTML = `<div class="text-gray-500 text-sm p-4">No tienes pedidos guardados.</div>`;
        return;
      }
      savedOrdersEl.innerHTML = savedOrders
        .sort((a, b) => (b.fechaCreacion?.seconds || 0) - (a.fechaCreacion?.seconds || 0))
        .map((o) => createSavedOrderHTML(o))
        .join('');
    }

    function renderOrderModal(data, orderId) {
      openedOrder = { id: orderId, ...data };

      // Encabezado (proveedor y fecha)
      const fecha = data.fechaCreacion?.seconds ? new Date(data.fechaCreacion.seconds * 1000) : null;
      orderHeaderEl.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
          <div>
            <p><span class="text-gray-500">Proveedor:</span> <span class="font-semibold">${data.proveedorNombre || 'N/A'}</span></p>
            <p><span class="text-gray-500">Estado:</span> <span class="font-semibold">${data.estado || '—'}</span></p>
          </div>
          <div class="text-right">
            <p><span class="text-gray-500">Pedido:</span> <span class="font-mono">#${(orderId || '').slice(0, 6)}</span></p>
            <p><span class="text-gray-500">Fecha:</span> <span>${fecha ? formatDate(fecha) : 'N/A'}</span></p>
          </div>
        </div>
      `;

      // Items ordenados por nombre (como el ejemplo)
      const items = (data.items || []).slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

      itemsTbody.innerHTML = '';
      let total = 0;
      items.forEach((it) => {
        const costo = Number(it.costoUnitario || 0);
        const cant = Number(it.cantidad || 0);
        const sub = costo * cant;
        total += sub;

        const tr = document.createElement('tr');
        tr.className = 'border-b';
        tr.innerHTML = `
          <td class="p-2">${it.nombre || it.productoId || ''}</td>
          <td class="p-2 text-center">${cant}</td>
          <td class="p-2 text-right">${costo.toFixed(2)}</td>
          <td class="p-2 text-right font-semibold">${sub.toFixed(2)}</td>
        `;
        itemsTbody.appendChild(tr);
      });

      totalItemsEl.textContent = items.length;
      totalCostEl.textContent = formatMoney(total);

      // Mostrar modal
      orderModal.classList.remove('hidden');
      orderModal.classList.add('flex');
    }

    async function loadSavedOrders() {
      if (!currentUser) return;
      const { collection, getDocs, query, where } = await import(
        `${FIREBASE_BASE}firebase-firestore.js`
      );
      const q = query(collection(db, 'pedidos'), where('userId', '==', currentUser.uid));
      const snap = await getDocs(q);
      savedOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderSavedOrders();
    }

    async function openOrder(orderId) {
      const { doc, getDoc } = await import(
        `${FIREBASE_BASE}firebase-firestore.js`
      );
      const snap = await getDoc(doc(db, 'pedidos', orderId));
      if (!snap.exists()) {
        alert('No se encontró el pedido.');
        return;
      }
      renderOrderModal(snap.data(), orderId);
    }

    async function printOrder(orderId) {
      const { doc, getDoc } = await import(
        `${FIREBASE_BASE}firebase-firestore.js`
      );
      const snap = await getDoc(doc(db, 'pedidos', orderId));
      if (!snap.exists()) {
        alert('Pedido no encontrado.');
        return;
      }
      const data = snap.data();
      const sortedItems = (data.items || []).slice().sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

      const rows = sortedItems
        .map(
          (it) => `
          <tr class="border-b">
            <td class="p-2">${it.nombre || it.productoId || ''}</td>
            <td class="p-2 text-center">${Number(it.cantidad || 0)}</td>
            <td class="p-2 text-right">${Number(it.costoUnitario || 0).toFixed(2)}</td>
            <td class="p-2 text-right font-semibold">${(Number(it.costoUnitario || 0) * Number(it.cantidad || 0)).toFixed(2)}</td>
          </tr>
        `
        )
        .join('');

      const html = `
        <!DOCTYPE html>
        <html lang="es">
          <head>
            <title>Pedido ${orderId.slice(0,6)}</title>
            <script src="https://cdn.tailwindcss.com"><\/script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
              body { font-family: 'Inter', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              @page { size: auto; margin: 20mm; }
            </style>
          </head>
          <body class="p-4">
            <div class="mb-6">
              <h1 class="text-3xl font-bold">Pedido #${orderId.slice(0,6)}</h1>
              <p class="text-gray-600">Proveedor: ${data.proveedorNombre || 'N/A'}</p>
              <p class="text-gray-600">Fecha: ${
                data.fechaCreacion?.seconds
                  ? new Date(data.fechaCreacion.seconds * 1000).toLocaleDateString('es-ES')
                  : 'N/A'
              }</p>
            </div>
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b">
                  <th class="text-left p-2 font-semibold">Producto</th>
                  <th class="text-center p-2 font-semibold">Cantidad</th>
                  <th class="text-right p-2 font-semibold">Costo U.</th>
                  <th class="text-right p-2 font-semibold">Subtotal</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <div class="mt-8 text-right">
              <p class="text-gray-600">Total de Artículos: <span class="font-bold">${sortedItems.length}</span></p>
              <p class="text-2xl font-bold">Total: ${formatMoney(data.total || 0)}</p>
            </div>
            <script>
              window.addEventListener('load', () => {
                setTimeout(() => {
                  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
                  if (!isTouch) {
                    window.addEventListener('afterprint', () => window.close());
                  }
                  window.print();
                }, 300);
              });
            <\/script>
          </body>
        </html>
      `;

      const w = window.open('', '_blank');
      w.document.write(html);
      w.document.close();
      w.focus();
    }

    // === Auth gate + carga ===
    if (!currentUser) {
      // Si el router trae auth listo, úsalo; si no, intenta leer de nuevo.
      currentUser = auth?.currentUser || null;
    }
    if (!currentUser) {
      container.innerHTML = `
        <div class="p-10 text-center">
          <h2 class="text-xl font-bold">Acceso Denegado</h2>
          <p class="text-gray-600">Inicia sesión para ver tus pedidos.</p>
        </div>`;
      return;
    }

    await loadSavedOrders();

    // === Eventos ===
    container.addEventListener('click', (e) => {
      // Abrir pedido
      const openBtn = e.target.closest('.open-order-btn');
      if (openBtn) {
        e.preventDefault();
        openOrder(openBtn.dataset.orderId);
        return;
      }

      // Imprimir desde la lista
      const printBtn = e.target.closest('.print-order-btn');
      if (printBtn) {
        e.preventDefault();
        printOrder(printBtn.dataset.orderId);
        return;
      }

      // Cerrar modal
      if (e.target.closest('#close-modal-btn') || e.target.closest('#close-modal-btn-2')) {
        orderModal.classList.add('hidden');
        orderModal.classList.remove('flex');
        openedOrder = null;
        return;
      }

      // Imprimir desde el modal (usa el pedido actualmente abierto)
      if (e.target.closest('#print-order-btn')) {
        if (openedOrder?.id) {
          printOrder(openedOrder.id);
        }
        return;
      }
    });
  }
};
