// apps/compras_detalles.app.js
import {
  doc, getDoc, updateDoc, arrayUnion, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { uploadToStorage as uploadToStorageHelper }
  from '../storage-utils.js';

export default {
  title: 'Detalles de Compra',
  async mount(container, { db, storage, params, auth }) {
    const id = params.get('id');
    if (!id) { container.innerHTML = '<div class="p-6 text-slate-500">ID no especificado.</div>'; return; }

    const fCurrency = n => `$${(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const fDate = s => { const d=new Date(s); if(isNaN(d)) return s||''; return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; };

    // --- estilos utilitarios (copiable, toast, tabla) ---
    const style = document.createElement('style');
    style.textContent = `
      .copy { cursor: pointer; text-decoration: underline dotted; }
      .tabular { font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      thead.sticky th { position: sticky; top: 0; background: white; z-index: 1; }
      .toast-mini { position: fixed; bottom: 18px; right: 18px; background: #10b981; color: #fff;
        padding: 8px 12px; border-radius: 10px; box-shadow: 0 8px 20px rgba(16,185,129,.3); opacity: 0;
        transform: translateY(8px); transition: all .18s ease; z-index: 60; font-weight: 600; }
      .toast-mini.show { opacity: 1; transform: translateY(0); }
    `;
    document.head.appendChild(style);

    function flashCopied(msg='Copiado') {
      const t = document.createElement('div');
      t.className = 'toast-mini';
      t.textContent = msg;
      document.body.appendChild(t);
      requestAnimationFrame(()=> t.classList.add('show'));
      setTimeout(()=> { t.classList.remove('show'); t.addEventListener('transitionend', ()=>t.remove(), {once:true}); }, 1200);
    }

    const root = document.createElement('div');
    root.className = 'max-w-5xl mx-auto p-4 md:p-6';
    container.innerHTML = '';
    container.appendChild(root);

    async function load() {
      const snap = await getDoc(doc(db, 'compras', id));
      if (!snap.exists()) { root.innerHTML = '<div class="p-6 text-red-500">No existe el registro.</div>'; return; }
      const data = snap.data();

      const items = data.items || [];
      const totalCalc = items.reduce((s,i)=>s+(i.total_linea_final||0),0);
      const diff = (data.total||0) - totalCalc;
      const diffCls = Math.abs(diff) < 1 ? 'text-emerald-600' : 'text-red-600';

      root.innerHTML = `
        <header class="mb-4 flex items-center justify-between">
          <div>
            <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Detalles de la Compra</h1>
            <p class="text-slate-500">
              <span class="copy" title="Copiar" data-copy="${data.numero_factura||'N/A'}">#${data.numero_factura||'N/A'}</span>
              ·
              <span class="copy" title="Copiar" data-copy="${data.proveedor||''}">${data.proveedor||'—'}</span>
            </p>
          </div>
          <div class="flex gap-2">
            <button id="back" class="text-slate-600 hover:text-slate-900">Volver</button>
            <button id="edit-btn" class="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg">Editar</button>
            <button id="toggle-sicar-btn" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
              ${data.agregado_sicar ? 'Quitar de Sicar' : 'Marcar Agregado en Sicar'}
            </button>
          </div>
        </header>

        <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl space-y-6">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm bg-slate-50 p-4 rounded-lg">
            <div>
              <span class="text-slate-500">Proveedor:</span><br>
              <span class="copy" title="Copiar" data-copy="${data.proveedor||''}">${data.proveedor||'—'}</span>
            </div>
            <div>
              <span class="text-slate-500">Fecha:</span><br>
              <span class="copy" title="Copiar" data-copy="${fDate(data.fecha)}">${fDate(data.fecha)}</span>
            </div>
            <div>
              <span class="text-slate-500">No. Factura:</span><br>
              <span class="copy" title="Copiar" data-copy="${data.numero_factura||'N/A'}">${data.numero_factura||'N/A'}</span>
            </div>
          </div>

          <div>
            <h3 class="font-bold mb-2">Artículos</h3>
            ${items.length ? `
            <div class="overflow-x-auto">
              <table class="w-full text-sm border-collapse">
                <thead class="sticky">
                  <tr class="border-b">
                    <th class="text-left py-2">Rec.</th>
                    <th class="text-left">Código Prov.</th>
                    <th class="text-left">Descripción</th>
                    <th class="text-right tabular">Cant.</th>
                    <th class="text-right tabular">UxP</th>
                    <th class="text-right tabular">P. Final</th>
                    <th class="text-right tabular">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map((it,idx)=>{
                    const precio = Number(it.precio_final||0);
                    const total  = Number(it.total_linea_final||0);
                    const cant   = Number(it.cantidad_factura||0);
                    const uxp    = Number(it.unidades_por_paquete||1);
                    const claveProv = it.clave_proveedor || '';
                    const claveCat  = it.clave_catalogo || '';
                    const descCat   = it.desc_catalogo  || '';
                    const hasAssoc  = Boolean(claveCat || descCat);

                    const filaExtraido = `
                      <tr class="border-b border-slate-100 bg-white align-middle">
                        <td class="py-2">
                          <input type="checkbox" class="chk-rec" data-idx="${idx}" ${it.recibido?'checked':''}>
                        </td>
                        <td><span class="copy" title="Copiar" data-copy="${claveProv}">${claveProv || '-'}</span></td>
                        <td>${it.descripcion_factura||''}</td>
                        <td class="text-right tabular"><span class="copy" title="Copiar" data-copy="${cant}">${cant}</span></td>
                        <td class="text-right tabular">${uxp}</td>
                        <td class="text-right tabular"><span class="copy" title="Copiar" data-copy="${precio.toFixed(2)}">${fCurrency(precio)}</span></td>
                        <td class="text-right tabular font-semibold">
                          <span class="copy" title="Copiar" data-copy="${total.toFixed(2)}">${fCurrency(total)}</span>
                        </td>
                      </tr>`;

                    const filaAsociado = hasAssoc ? `
                      <tr class="border-b border-slate-100 bg-emerald-50">
                        <td></td>
                        <td colspan="6" class="py-2">
                          <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                            <div class="text-slate-600">Asociado (Catálogo):</div>
                            <div>
                              <span class="text-slate-500">Clave:</span>
                              <span class="copy font-medium text-emerald-800" title="Copiar"
                                    data-copy="${claveCat}">${claveCat || '—'}</span>
                            </div>
                            <div class="truncate">
                              <span class="text-slate-500">Descripción:</span>
                              <span class="copy" title="Copiar" data-copy="${descCat}">${descCat || '—'}</span>
                            </div>
                          </div>
                        </td>
                      </tr>` : '';

                    return filaExtraido + filaAsociado;
                  }).join('')}
                </tbody>
                <tfoot>
                  <tr class="border-t-2 border-slate-300">
                    <td colspan="6" class="text-right p-2">Total Factura (IA):</td>
                    <td class="p-2 text-right tabular">
                      <span class="copy" title="Copiar" data-copy="${Number(data.total||0).toFixed(2)}">${fCurrency(data.total||0)}</span>
                    </td>
                  </tr>
                  <tr class="bg-slate-50">
                    <td colspan="6" class="text-right p-2 font-bold">Total Calculado:</td>
                    <td class="p-2 text-right tabular font-bold">
                      <span class="copy" title="Copiar" data-copy="${totalCalc.toFixed(2)}">${fCurrency(totalCalc)}</span>
                    </td>
                  </tr>
                  <tr class="bg-slate-50">
                    <td colspan="6" class="text-right p-2 ${diffCls}">Diferencia:</td>
                    <td class="p-2 text-right tabular ${diffCls}">
                      <span class="copy" title="Copiar" data-copy="${diff.toFixed(2)}">${fCurrency(diff)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>` : `<div class="text-slate-400 text-sm">No hay artículos.</div>`}
          </div>

          <div>
            <h3 class="font-bold mb-2">Imágenes</h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
              ${(data.images||[]).map(url=>`
                <a href="${url}" target="_blank"><img src="${url}" class="w-full h-auto object-contain rounded border"></a>
              `).join('')}
            </div>
            <label class="inline-block mt-3 bg-blue-100 hover:bg-blue-200 text-blue-800 text-sm px-3 py-2 rounded cursor-pointer">
              Añadir imagen<input id="add-img" type="file" accept="image/*" class="hidden">
            </label>
          </div>

          <div>
            <h3 class="font-bold mb-2">Comentarios</h3>
            <div id="comments" class="space-y-2 mb-2">
              ${(data.comments||[]).map(c=>`
                <div class="bg-slate-100 p-3 rounded">
                  <div class="text-sm">${c.text}</div>
                  <div class="text-xs text-right text-slate-400">${c.createdAt?.toDate ? c.createdAt.toDate().toLocaleString() : ''}</div>
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

      // Accesible: permite tab/enter en todos los .copy
      root.querySelectorAll('.copy').forEach(el => { el.setAttribute('tabindex','0'); el.setAttribute('role','button'); });

      // Ir a editar (sin navigate; compatible con tu router actual)
      root.querySelector('#edit-btn').addEventListener('click', ()=>{
        location.hash = `#/compras_editar?id=${encodeURIComponent(id)}`;
      });

      // Volver al historial de compras
      root.querySelector('#back').addEventListener('click', ()=>{
        location.hash = '#/compras_historial';
      });

      // Toggle Sicar
      root.querySelector('#toggle-sicar-btn').addEventListener('click', async (e)=>{
        const newVal = !data.agregado_sicar;
        await updateDoc(doc(db,'compras',id), { agregado_sicar: newVal });
        e.target.textContent = newVal ? 'Quitar de Sicar' : 'Marcar Agregado en Sicar';
      });

      // Copiar al clic / teclado
      root.addEventListener('click', (e)=>{
        const el = e.target.closest('.copy'); if (!el) return;
        navigator.clipboard.writeText(el.dataset.copy||'').then(()=>flashCopied()).catch(()=>{});
      });
      root.addEventListener('keydown', (e)=>{
        const el = e.target.closest('.copy'); if (!el) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigator.clipboard.writeText(el.dataset.copy||'').then(()=>flashCopied()).catch(()=>{});
        }
      });

      // Toggle "Recibido" con debounce para evitar ráfagas
      const debouncers = new Map();
      root.addEventListener('change', (e)=>{
        const chk = e.target.closest('.chk-rec'); if (!chk) return;
        const idx = Number(chk.dataset.idx);
        const key = `rec-${idx}`;
        clearTimeout(debouncers.get(key));
        debouncers.set(key, setTimeout(async ()=>{
          try {
            const fresh = (await getDoc(doc(db,'compras',id))).data();
            const items = [...(fresh.items||[])];
            items[idx] = { ...(items[idx]||{}), recibido: chk.checked };
            await updateDoc(doc(db,'compras',id), { items });
          } catch(err) { console.error(err); }
        }, 200));
      });

      // Añadir comentario
      root.querySelector('#form-comment').addEventListener('submit', async (e)=>{
        e.preventDefault();
        const txt = root.querySelector('#comment-txt').value.trim();
        if (!txt) return;
        await updateDoc(doc(db,'compras',id), {
          comments: arrayUnion({ text: txt, authorId: auth?.currentUser?.uid||'anon', createdAt: serverTimestamp() })
        });
        await load(); // recargar
      });

      // Subir imagen
      root.querySelector('#add-img').addEventListener('change', async (e)=>{
        const file = e.target.files?.[0]; if (!file) return;
        const storagePath = `invoices/${auth?.currentUser?.uid||'anon'}/${id}/${Date.now()}-${file.name}`;
        const url = await uploadToStorageHelper({ storage, path: storagePath, fileOrBlob: file });
        const fresh = (await getDoc(doc(db,'compras',id))).data();
        const images = Array.from(new Set([...(fresh.images||[]), url]));
        await updateDoc(doc(db,'compras',id), { images });
        await load();
      });
    }

    await load();
    this._cleanup = () => {};
  },
  unmount() { try { this._cleanup?.(); } catch {} }
};