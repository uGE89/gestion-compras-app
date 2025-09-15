// /public/apps/caja_editar.app.js
import { db } from '../firebase-init.js';
import { FIREBASE_BASE } from './lib/constants.js';
const {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} = await import(`${FIREBASE_BASE}firebase-firestore.js`);

export default {
  async mount(container, { params }) {
    const id = params.get('id');
    if (!id) {
      container.innerHTML = `<div class="p-6 text-center text-slate-500">ID no especificado.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="max-w-3xl mx-auto p-4 md:p-6">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Editar Transferencia</h1>
          <a href="#/caja_detalle?id=${encodeURIComponent(id)}" class="px-3 py-2 bg-slate-100 text-slate-800 rounded-lg">Cancelar</a>
        </div>

        <form id="form" class="bg-white border rounded-2xl shadow-sm p-4 md:p-6 space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-sm text-slate-600">Fecha</label>
              <input name="fecha" type="date" class="mt-1 block w-full rounded-md border p-2" required />
            </div>
            <div>
              <label class="text-sm text-slate-600">Tipo</label>
              <select name="tipo" class="mt-1 block w-full rounded-md border p-2">
                <option value="in">Entrada</option>
                <option value="out">Salida</option>
              </select>
            </div>
            <div>
              <label class="text-sm text-slate-600">Moneda</label>
              <select name="moneda" class="mt-1 block w-full rounded-md border p-2">
                <option value="NIO">NIO</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label class="text-sm text-slate-600">Cantidad</label>
              <input name="cantidad" type="number" step="0.01" class="mt-1 block w-full rounded-md border p-2" required />
            </div>
            <div>
              <label class="text-sm text-slate-600">Cuenta (bankAccountId)</label>
              <input name="bankAccountId" type="number" class="mt-1 block w-full rounded-md border p-2" />
            </div>
            <div>
              <label class="text-sm text-slate-600">Banco (texto)</label>
              <input name="banco" type="text" class="mt-1 block w-full rounded-md border p-2" placeholder="Opcional, visible en UI" />
            </div>
            <div class="md:col-span-2">
              <label class="text-sm text-slate-600">No. Confirmación</label>
              <input name="numero_confirmacion" type="text" class="mt-1 block w-full rounded-md border p-2" />
            </div>
            <div class="md:col-span-2">
              <label class="text-sm text-slate-600">Observaciones</label>
              <textarea name="observaciones" rows="3" class="mt-1 block w-full rounded-md border p-2"></textarea>
            </div>

            <div class="md:col-span-2">
              <label class="text-sm text-slate-600">Imagen (URL)</label>
              <input name="imageUrl" type="url" class="mt-1 block w-full rounded-md border p-2" placeholder="https://..." />
              <div id="imgWrap" class="mt-3 hidden">
                <img id="img" class="w-full max-h-[60vh] object-contain rounded-lg border" alt="Comprobante"/>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 pt-2">
            <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded-lg">Guardar cambios</button>
          </div>
        </form>
      </div>
    `;

    const $ = s => container.querySelector(s);
    const form = $('#form');
    const imgWrap = $('#imgWrap');
    const img = $('#img');

    async function load() {
      const snap = await getDoc(doc(db, 'transferencias', id));
      if (!snap.exists()) {
        form.outerHTML = `<div class="p-6 text-center text-slate-500">No encontrado.</div>`;
        return;
      }
      const t = snap.data();

      form.fecha.value = t.fecha || '';
      form.tipo.value = t.tipo || 'in';
      form.moneda.value = t.moneda || 'NIO';
      form.cantidad.value = t.cantidad ?? '';
      form.bankAccountId.value = t.bankAccountId ?? '';
      form.banco.value = t.banco || '';
      form.numero_confirmacion.value = t.numero_confirmacion || '';
      form.observaciones.value = t.observaciones || '';
      form.imageUrl.value = t.imageUrl || '';

      if (t.imageUrl) {
        img.src = t.imageUrl;
        imgWrap.classList.remove('hidden');
      } else {
        imgWrap.classList.add('hidden');
      }
    }

    form.imageUrl.addEventListener('input', () => {
      const url = form.imageUrl.value.trim();
      if (url) {
        img.src = url;
        imgWrap.classList.remove('hidden');
      } else {
        imgWrap.classList.add('hidden');
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        fecha: form.fecha.value || null,
        tipo: form.tipo.value,
        moneda: form.moneda.value,
        cantidad: form.cantidad.value === '' ? null : Number(form.cantidad.value),
        bankAccountId: form.bankAccountId.value === '' ? null : Number(form.bankAccountId.value),
        banco: form.banco.value.trim() || null,
        numero_confirmacion: form.numero_confirmacion.value.trim() || '',
        observaciones: form.observaciones.value.trim() || '',
        imageUrl: form.imageUrl.value.trim() || '',
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'transferencias', id), data);
      location.hash = `#/caja_detalle?id=${encodeURIComponent(id)}`;
    });

    await load();
  },
  unmount() {}
};
