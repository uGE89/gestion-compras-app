// apps/cotizaciones_detalles.app.js
import {
  doc, getDoc, updateDoc, arrayUnion, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { savePedidoDraft } from '../state.js';
import { normalizeId, formatMoney } from './lib/helpers.js';
import { showToast } from './lib/toast.js';

const COT_COLLECTION = 'cotizaciones_analizadas';


export default {
  title: 'Detalles de Cotización',
  async mount(container, { db, auth, params, appState, navigate }) {
    const id = params.get('id');
    if (!id) { container.innerHTML = '<div class="p-6 text-slate-500">ID no especificado.</div>'; return; }

    const fDate = s => { const d=new Date(s); return isNaN(d)? (s||'') :
      `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; };

    const root = document.createElement('div');
    root.className = 'max-w-6xl mx-auto p-4 md:p-6';
    container.innerHTML = ''; container.appendChild(root);

    const productCatalog = appState?.productCatalog || [];

    async function load() {
      const snap = await getDoc(doc(db, COT_COLLECTION, id));
      if (!snap.exists()) { root.innerHTML = '<div class="p-6 text-red-500">No existe la cotización.</div>'; return; }
      const data = snap.data();

      const items = Array.isArray(data.items) ? data.items : [];
      const totalCalc = items.reduce((s,i)=> s + (Number(i.total_linea_final||i.total_linea)||0), 0);
      const totalDoc  = Number(data.total||0);
      const diff      = totalDoc - totalCalc;
      const diffCls   = Math.abs(diff) < 1 ? 'text-emerald-600' : 'text-red-600';
      const folio     = data.numero_cotizacion || data.folio || data.numero || 'N/A';

      root.innerHTML = `
        <header class="mb-4 flex items-center justify-between">
          <div>
            <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Detalles de la Cotización</h1>
            <p class="text-slate-500">#${folio} · ${data.proveedor || '—'}</p>
          </div>
          <div id="quote-actions" class="flex flex-wrap gap-2 justify-end"></div>
        </header>

        <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl space-y-6">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm bg-slate-50 p-4 rounded-lg">
            <div>
              <span class="text-slate-500">Proveedor:</span><br>
              <span class="copy cursor-pointer" data-copy="${data.proveedor||''}">${data.proveedor||'—'}</span>
            </div>
            <div>
              <span class="text-slate-500">Fecha:</span><br>
              <span class="copy cursor-pointer" data-copy="${fDate(data.fecha)}">${fDate(data.fecha)}</span>
            </div>
            <div>
              <span class="text-slate-500">Folio/No. Cotización:</span><br>
              <span class="copy cursor-pointer" data-copy="${folio}">${folio}</span>
            </div>
          </div>

          <div>
            <h3 class="font-bold mb-2">Ítems (fila extraída + fila asociada)</h3>
            ${items.length ? `
            <div class="overflow-x-auto">
              <table class="w-full text-sm border-collapse">
                <thead>
                  <tr class="border-b">
                    <th class="text-left p-2">Código Prov.</th>
                    <th class="text-left p-2">Descripción</th>
                    <th class="text-right p-2">Cant.</th>
                    <th class="text-right p-2">UxP</th>
                    <th class="text-right p-2">P. Final</th>
                    <th class="text-right p-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map((it)=> {
                    const claveProv = it.clave_proveedor || '-';
                    const cant      = Number(it.cantidad_factura || it.cantidad || 0);
                    const uxp       = Number(it.unidades_por_paquete || 1);
                    const pfinal    = Number(it.precio_final || 0);
                    const total     = Number(it.total_linea_final || it.total_linea || 0);
                    const claveCat  = it.clave_catalogo || '';
                    const descCat   = it.desc_catalogo || '';

                    let referencePrice = null;
                    let variationPct = null;

                    if (claveCat) {
                      const normalizedClave = normalizeId(claveCat);
                      const product = productCatalog.find(p => normalizeId(p.id) === normalizedClave);

                      if (product) {
                        const directRef = Number(product?.PrecioU_Ref ?? product?.stats?.PrecioU_Ref ?? 0);
                        if (!Number.isNaN(directRef) && directRef > 0) {
                          referencePrice = directRef;
                        } else {
                          const recientes = Array.isArray(product?.stats?.preciosCompraRecientes)
                            ? product.stats.preciosCompraRecientes
                            : [];

                          for (const entry of recientes) {
                            if (!entry) continue;
                            const raw =
                              entry?.PrecioCom ??
                              entry?.['Precio Com'] ??
                              entry?.Precio ??
                              entry?.precio ??
                              entry?.precioCompra ??
                              entry?.precio_unitario ??
                              entry?.PrecioU ??
                              entry?.PrecioUnitario;
                            const parsed = Number(raw);
                            if (!Number.isNaN(parsed) && parsed > 0) {
                              referencePrice = parsed;
                              break;
                            }
                          }
                        }

                        if (referencePrice != null && referencePrice > 0) {
                          const rawDiff = ((pfinal - referencePrice) / referencePrice) * 100;
                          if (Number.isFinite(rawDiff)) variationPct = rawDiff;
                        }
                      }
                    }

                    const variationClass =
                      variationPct == null || Math.abs(variationPct) < 0.01
                        ? 'text-slate-500'
                        : variationPct > 0
                          ? 'text-red-600'
                          : 'text-emerald-600';
                    const variationLabel =
                      variationPct == null
                        ? ''
                        : `${variationPct > 0 ? '+' : ''}${variationPct.toFixed(1)}%`;

                    return `
                      <!-- Fila 1: extracción (blanco) -->
                      <tr class="border-b border-slate-100 bg-white">
                        <td class="p-2">
                          <span class="copy cursor-pointer" title="Copiar" data-copy="${claveProv}">${claveProv}</span>
                        </td>
                        <td class="p-2">${it.descripcion_factura || it.descripcion || ''}</td>
                        <td class="p-2 text-right">
                          <span class="copy cursor-pointer" title="Copiar" data-copy="${cant}">${cant}</span>
                        </td>
                        <td class="p-2 text-right">${uxp}</td>
                        <td class="p-2 text-right">
                          <span class="copy cursor-pointer" title="Copiar" data-copy="${pfinal.toFixed(2)}">${formatMoney(pfinal)}</span>
                        </td>
                        <td class="p-2 text-right">
                          <span class="copy cursor-pointer" title="Copiar" data-copy="${total.toFixed(2)}">${formatMoney(total)}</span>
                        </td>
                      </tr>
                      <!-- Fila 2: asociado (gris claro) -->
                      <tr class="border-b border-slate-200 bg-slate-50">
                        <td class="p-2 text-slate-600" colspan="2">
                          ${claveCat ? `
                            Asociado: <span class="copy cursor-pointer font-medium text-emerald-700" title="Copiar clave" data-copy="${claveCat}">${claveCat}</span>
                            — ${descCat ? `<span>${descCat}</span>` : '<span class="text-slate-400">Sin descripción de catálogo</span>'}
                          ` : '<span class="text-slate-400">Sin asociación</span>'}
                        </td>
                        <td class="p-2 text-right text-slate-500" colspan="2"></td>
                        <td class="p-2 text-right text-slate-600">
                          ${referencePrice != null
                            ? `
                              <div class="space-y-1">
                                <div class="text-xs uppercase tracking-wide text-slate-400">Histórico</div>
                                <div class="flex items-center justify-end gap-2">
                                  <span class="font-medium">${formatMoney(referencePrice)}</span>
                                  ${variationLabel
                                    ? `<span class="text-xs font-semibold ${variationClass}">${variationLabel}</span>`
                                    : ''}
                                </div>
                              </div>
                            `
                            : '<span class="text-slate-400 italic">Sin dato</span>'}
                        </td>
                        <td class="p-2 text-right text-slate-600"></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
                <tfoot>
                  <tr class="border-t-2 border-slate-300">
                    <td colspan="5" class="text-right p-2">Total (documento):</td>
                    <td class="p-2 font-medium">${formatMoney(totalDoc)}</td>
                  </tr>
                  <tr class="">
                    <td colspan="5" class="text-right p-2 font-bold">Total Calculado:</td>
                    <td class="p-2 font-bold">${formatMoney(totalCalc)}</td>
                  </tr>
                  <tr class="">
                    <td colspan="5" class="text-right p-2 ${diffCls}">Diferencia:</td>
                    <td class="p-2 ${diffCls}">${formatMoney(diff)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            ` : `<div class="text-slate-400 text-sm">No hay ítems.</div>`}
          </div>

          <div>
            <h3 class="font-bold mb-2">Comentarios</h3>
            <div id="comments" class="space-y-2 mb-2">
              ${(data.comments||[]).map(c=>`
                <div class="bg-slate-100 p-3 rounded">
                  <div class="text-sm">${c.text||''}</div>
                  <div class="text-xs text-right text-slate-400">
                    ${c.createdAt?.toDate ? c.createdAt.toDate().toLocaleString() : ''}
                  </div>
                </div>
              `).join('') || '<div class="text-slate-400 text-sm">Sin comentarios.</div>'}
            </div>
            <form id="form-comment" class="flex gap-2">
              <input id="comment-txt" class="flex-1 p-2 border rounded" placeholder="Escribe un comentario…" required>
              <button class="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded">Añadir</button>
            </form>
          </div>
        </section>
      `;

      const actionsWrap = root.querySelector('#quote-actions');
      let backBtn = root.querySelector('#back');
      let editBtn = root.querySelector('#edit-btn');
      let orderBtn = root.querySelector('#to-order');

      if (actionsWrap) {
        backBtn = document.createElement('button');
        backBtn.id = 'back';
        backBtn.type = 'button';
        backBtn.className = 'text-slate-600 hover:text-slate-900 transition-colors';
        backBtn.textContent = 'Volver';

        editBtn = document.createElement('button');
        editBtn.id = 'edit-btn';
        editBtn.type = 'button';
        editBtn.className = 'bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg';
        editBtn.textContent = 'Editar';

        orderBtn = document.createElement('button');
        orderBtn.id = 'to-order';
        orderBtn.type = 'button';
        orderBtn.className = 'bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg flex items-center gap-2';
        orderBtn.innerHTML = '<span class="material-icons text-base">send</span><span>Enviar a Pedido</span>';
        orderBtn.setAttribute('aria-label', 'Enviar cotización a pedido');
        orderBtn.title = 'Enviar cotización al creador de pedidos';

        actionsWrap.replaceChildren(backBtn, editBtn, orderBtn);
      }

      const hasItemsForOrder = (items || []).some(it => (Number(it.cantidad_factura ?? it.cantidad ?? 0) || 0) > 0);
      if (orderBtn) {
        orderBtn.disabled = !hasItemsForOrder;
        orderBtn.classList.toggle('opacity-60', !hasItemsForOrder);
        orderBtn.classList.toggle('cursor-not-allowed', !hasItemsForOrder);
      }

      // Volver al historial de cotizaciones
      backBtn?.addEventListener('click', ()=>{
        location.hash = '#/cotizaciones_historial';
      });

      // Navegar a editar
      editBtn?.addEventListener('click', ()=>{
        location.hash = `#/cotizaciones_editar?id=${encodeURIComponent(id)}`;
      });

      // Enviar a creador de pedidos
      orderBtn?.addEventListener('click', ()=>{
        if (!appState) {
          console.error('appState no disponible, no se puede preparar el pedido.');
          showToast('No se pudo preparar el pedido', 'error');
          return;
        }

        const cart = (items || []).map((it, idx) => {
          const qty = Number(it.cantidad_factura || it.cantidad || 0) || 0;
          if (qty <= 0) return null;

          const idItem = (it.clave_catalogo || it.desc_catalogo || it.descripcion_factura || it.descripcion || `ITEM-${idx}`)
            .toString()
            .trim();

          return {
            id: idItem,
            nombre: it.desc_catalogo || it.descripcion_factura || it.descripcion || idItem,
            cantidad: qty,
            precioUnit: Number(it.precio_final || it.precio_unit || it.precio || 0) || 0,
            proveedor: data.proveedor || ''
          };
        }).filter(Boolean);

        if (!cart.length) {
          showToast('La cotización no tiene artículos con cantidad válida', 'error');
          return;
        }

        appState.pedidoDraft = {
          source: 'cotizacion',
          cotizacionId: id,
          folio,
          proveedor: data.proveedor || '',
          items: cart
        };

        try { savePedidoDraft(); } catch (err) { console.warn('No se pudo guardar el borrador del pedido', err); }

        showToast('Cotización enviada al creador de pedidos', 'success');

        if (typeof navigate === 'function') navigate('creador_pedido');
        else location.hash = '#/creador_pedido';
      });

      // Copia rápida
      root.addEventListener('click', (e)=>{
        const el = e.target.closest('.copy');
        if (!el) return;
        const txt = el.dataset.copy || '';
        navigator.clipboard.writeText(txt).then(()=> showToast('Copiado')).catch(()=>{});
      });

      // Añadir comentario
      root.querySelector('#form-comment').addEventListener('submit', async (e)=>{
        e.preventDefault();
        const txt = root.querySelector('#comment-txt').value.trim();
        if (!txt) return;
        await updateDoc(doc(db, COT_COLLECTION,id), {
          comments: arrayUnion({ text: txt, authorId: auth?.currentUser?.uid || 'anon', createdAt: serverTimestamp() })
        });
        showToast('Comentario añadido');
        await load();
      });
    }

    await load();
    this._cleanup = () => {};
  },
  unmount(){ try{ this._cleanup?.(); } catch{} }
};