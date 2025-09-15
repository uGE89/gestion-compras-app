// apps/cotizaciones_detalles.app.js
import { FIREBASE_BASE } from './lib/constants.js';
const {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp
} = await import(`${FIREBASE_BASE}firebase-firestore.js`);
import { showToast } from './lib/toast.js';

const COT_COLLECTION = 'cotizaciones_analizadas';


export default {
  title: 'Detalles de Cotización',
  async mount(container, { db, auth, params }) {
    const id = params.get('id');
    if (!id) { container.innerHTML = '<div class="p-6 text-slate-500">ID no especificado.</div>'; return; }

    const fCur  = n => `$${(Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const fDate = s => { const d=new Date(s); return isNaN(d)? (s||'') :
      `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; };

    const root = document.createElement('div');
    root.className = 'max-w-6xl mx-auto p-4 md:p-6';
    container.innerHTML = ''; container.appendChild(root);

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
          <div class="flex gap-2">
            <button id="back" class="text-slate-600 hover:text-slate-900">Volver</button>
            <button id="edit-btn" class="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg">Editar</button>
          </div>
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
                          <span class="copy cursor-pointer" title="Copiar" data-copy="${pfinal.toFixed(2)}">${fCur(pfinal)}</span>
                        </td>
                        <td class="p-2 text-right">
                          <span class="copy cursor-pointer" title="Copiar" data-copy="${total.toFixed(2)}">${fCur(total)}</span>
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
                        <td class="p-2 text-right text-slate-600" colspan="3"></td>
                        <td class="p-2 text-right text-slate-600"></td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
                <tfoot>
                  <tr class="border-t-2 border-slate-300">
                    <td colspan="5" class="text-right p-2">Total (documento):</td>
                    <td class="p-2 font-medium">${fCur(totalDoc)}</td>
                  </tr>
                  <tr class="">
                    <td colspan="5" class="text-right p-2 font-bold">Total Calculado:</td>
                    <td class="p-2 font-bold">${fCur(totalCalc)}</td>
                  </tr>
                  <tr class="">
                    <td colspan="5" class="text-right p-2 ${diffCls}">Diferencia:</td>
                    <td class="p-2 ${diffCls}">${fCur(diff)}</td>
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

      // Volver al historial de cotizaciones
      root.querySelector('#back').addEventListener('click', ()=>{
        location.hash = '#/cotizaciones_historial';
      });

      // Navegar a editar
      root.querySelector('#edit-btn').addEventListener('click', ()=>{
        location.hash = `#/cotizaciones_editar?id=${encodeURIComponent(id)}`;
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
