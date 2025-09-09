// apps/compras_detalles.app.js
import {
  doc, getDoc, updateDoc, arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

export default {
  title: 'Detalles de Compra',
  async mount(container, { db, storage, params, auth, navigate }) {
    const id = params.get('id');
    if (!id) { container.innerHTML = '<div class="p-6 text-slate-500">ID no especificado.</div>'; return; }

    const fCurrency = n => `$${(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const fDate = s => { const d=new Date(s); if(isNaN(d)) return s||''; return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; };

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
            <p class="text-slate-500">#${data.numero_factura||'N/A'} · ${data.proveedor||'—'}</p>
          </div>
          <div class="flex gap-2">
            <button id="edit-btn" class="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg">Editar</button>
            <button id="toggle-sicar-btn" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
              ${data.agregado_sicar ? 'Quitar de Sicar' : 'Marcar Agregado en Sicar'}
            </button>
          </div>
        </header>

        <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl space-y-6">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm bg-slate-50 p-4 rounded-lg">
            <div><span class="text-slate-500">Proveedor:</span><br><span class="copy" data-copy="${data.proveedor||''}">${data.proveedor||'—'}</span></div>
            <div><span class="text-slate-500">Fecha:</span><br><span class="copy" data-copy="${fDate(data.fecha)}">${fDate(data.fecha)}</span></div>
            <div><span class="text-slate-500">No. Factura:</span><br><span class="copy" data-copy="${data.numero_factura||'N/A'}">${data.numero_factura||'N/A'}</span></div>
          </div>

          <div>
            <h3 class="font-bold mb-2">Artículos</h3>
            ${items.length ? `
            <div class="overflow-x-auto">
              <table class="w-full text-sm border-collapse">
                <thead><tr class="border-b">
                  <th>Rec.</th><th>Código Prov.</th><th>Descripción</th><th>Cant.</th><th>UxP</th><th>P. Final</th><th>Total</th>
                </tr></thead>
                <tbody>
                  ${items.map((it,idx)=>`
                    <tr class="border-b border-slate-100">
                      <td><input type="checkbox" class="chk-rec" data-idx="${idx}" ${it.recibido?'checked':''}></td>
                      <td><span class="copy" data-copy="${it.clave_proveedor||''}">${it.clave_proveedor||'-'}</span></td>
                      <td>${it.descripcion_factura||''}</td>
                      <td><span class="copy" data-copy="${it.cantidad_factura||0}">${it.cantidad_factura||0}</span></td>
                      <td>${it.unidades_por_paquete||1}</td>
                      <td><span class="copy" data-copy="${(it.precio_final||0).toFixed(2)}">${fCurrency(it.precio_final||0)}</span></td>
                      <td class="font-semibold">${fCurrency(it.total_linea_final||0)}</td>
                    </tr>
                  `).join('')}
                </tbody>
                <tfoot>
                  <tr class="border-t-2 border-slate-300"><td colspan="6" class="text-right p-2">Total Factura (IA):</td><td class="p-2">${fCurrency(data.total||0)}</td></tr>
                  <tr class="bg-slate-50"><td colspan="6" class="text-right p-2 font-bold">Total Calculado:</td><td class="p-2 font-bold">${fCurrency(totalCalc)}</td></tr>
                  <tr class="bg-slate-50"><td colspan="6" class="text-right p-2 ${diffCls}">Diferencia:</td><td class="p-2 ${diffCls}">${fCurrency(diff)}</td></tr>
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
                <div class="bg-slate-100 p-3 rounded"><div class="text-sm">${c.text}</div>
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

      // Navegar a editar
      root.querySelector('#edit-btn').addEventListener('click', ()=>navigate('compras_editar',{ id }));

      // Toggle Sicar
      root.querySelector('#toggle-sicar-btn').addEventListener('click', async (e)=>{
        const newVal = !data.agregado_sicar;
        await updateDoc(doc(db,'compras',id), { agregado_sicar: newVal });
        e.target.textContent = newVal ? 'Quitar de Sicar' : 'Marcar Agregado en Sicar';
      });

      // Copiar al clic
      root.addEventListener('click', (e)=>{
        const el = e.target.closest('.copy');
        if (!el) return;
        const txt = el.dataset.copy||'';
        navigator.clipboard.writeText(txt).catch(()=>{});
      });

      // Recibido toggle
      root.addEventListener('change', async (e)=>{
        const chk = e.target.closest('.chk-rec');
        if (!chk) return;
        const idx = Number(chk.dataset.idx);
        const fresh = (await getDoc(doc(db,'compras',id))).data();
        const items = [...(fresh.items||[])];
        items[idx] = { ...(items[idx]||{}), recibido: chk.checked };
        await updateDoc(doc(db,'compras',id), { items });
      });

      // Añadir comentario
      root.querySelector('#form-comment').addEventListener('submit', async (e)=>{
        e.preventDefault();
        const txt = root.querySelector('#comment-txt').value.trim();
        if (!txt) return;
        await updateDoc(doc(db,'compras',id), {
          comments: arrayUnion({ text: txt, authorId: auth?.currentUser?.uid||'anon', createdAt: serverTimestamp() })
        });
        await load(); // recargar (simple)
      });

      // Subir imagen
      root.querySelector('#add-img').addEventListener('change', async (e)=>{
        const file = e.target.files?.[0]; if (!file) return;
        const storageRef = ref(storage, `invoices/${auth?.currentUser?.uid||'anon'}/${id}/${Date.now()}-${file.name}`);
        const snap = await uploadBytes(storageRef, file);
        const url = await getDownloadURL(snap.ref);
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
