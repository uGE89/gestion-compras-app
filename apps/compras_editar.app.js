// apps/compras_editar.app.js
import {
  collection, doc, getDoc, updateDoc,
  query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { ItemsEditor } from './components/items_editor.js';
import { persistMappingsForItems } from './lib/associations.js';
import { parseNumber } from '../export_utils.js';
import { DEFAULT_EXCHANGE_RATE } from '../constants.js';

const MAP_COLLECTION = 'mapeo_articulos';

export default {
  title: 'Editar Compra',
  async mount(container, { db, storage, auth, appState, env, params }) {
    // ===== Guard Clauses =====
    const id = params?.get('id');
    if (!id) {
      container.innerHTML = '<div class="p-6 text-slate-500">ID no especificado.</div>';
      return;
    }

    // ===== Estado =====
    let userId = auth?.currentUser?.uid || 'anon';
    let original = null;
    let imageUrls = [];           // existentes + nuevas
    let totalFacturaAI = 0;       // total detectado por IA o el del documento
    let itemsEditor;              // instancia del editor de ítems
    const productCatalog = appState?.productCatalog || [];

    // ===== Utils =====
    const $  = (sel, root = document) => root.querySelector(sel);
    function showToast(m, t='success') {
      let tc = document.getElementById('toast-container');
      if (!tc) { tc = document.createElement('div'); tc.id='toast-container'; tc.className='fixed bottom-4 right-4 z-50'; document.body.appendChild(tc); }
      const el = document.createElement('div');
      const color = t==='success' ? 'bg-emerald-500' : 'bg-red-500';
      el.className = `toast ${color} text-white font-bold py-3 px-5 rounded-lg shadow-xl transform translate-y-4 opacity-0 fixed bottom-4 right-4 z-50`;
      el.textContent = m; tc.appendChild(el);
      setTimeout(()=>{ el.classList.remove('translate-y-4','opacity-0'); }, 10);
      setTimeout(()=>{ el.classList.add('translate-y-4','opacity-0'); el.addEventListener('transitionend',()=>el.remove()); }, 3000);
    }
    const ymd = (s) => { const d = new Date(s); if (isNaN(d)) return ''; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

    // ===== IA directa (temporal en frontend) =====
    async function getAIDataDirect(base64Array, apiKey) {
      if (!apiKey) { showToast('Falta env.AI_API_KEY', 'error'); return null; }
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
      const parts = [
        { text: "Analiza las imágenes de la factura (puede ser multipágina). Devuelve JSON con: fecha (YYYY-MM-DD), proveedor, numero_factura, total (número) e items[{ descripcion, cantidad, total_linea, clave_proveedor }]. Usa null si falta." }
      ];
      base64Array.forEach(b64 => parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } }));
      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: { responseMimeType: "application/json" }
          })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return JSON.parse(rawText);
      } catch (err) {
        console.error('AI error:', err);
        showToast('Error de IA. Formato inválido o red.', 'error');
        return null;
      }
    }

    // ===== PDF.js on-demand =====
    async function ensurePdfJs() {
      if (typeof pdfjsLib !== 'undefined') return;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.min.js';
        s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js'; resolve(); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    async function pdfToImages(file) {
      await ensurePdfJs();
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const imgs = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
        imgs.push(canvas.toDataURL('image/jpeg'));
      }
      return imgs;
    }
    function fileToDataURL(file){ return new Promise((res)=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(file); }); }
    function dataUrlToBlob(dataUrl){ return fetch(dataUrl).then(r=>r.blob()); }
    async function uploadToStorage(fileOrBlob, path) {
      const storageRef = ref(storage, path);
      const snap = await uploadBytes(storageRef, fileOrBlob);
      return getDownloadURL(snap.ref);
    }

    // ===== Mapeo (asociación por descripción) =====
    async function findAssociation(description) {
      if (!description) return null;
      const mapId = description.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-');
      const mref = doc(db, MAP_COLLECTION, mapId);
      const snap = await (await import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js")).getDoc(mref);
      return snap.exists() ? snap.data() : null;
    }

    // ===== Shell UI =====
    const root = document.createElement('div');
    root.className = 'max-w-5xl mx-auto p-4 md:p-6';
    root.innerHTML = `
      <header class="mb-4 flex items-center justify-between">
        <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Editar compra</h1>
        <button id="back" class="text-slate-600 hover:text-slate-900">Volver</button>
      </header>

      <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl space-y-6">

        <!-- Re-analizar / Adjuntar -->
        <div class="p-4 border-2 border-dashed rounded-lg">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div class="text-slate-700 font-medium">Adjuntar nuevas imágenes o PDF para analizar con IA (se anexarán ítems).</div>
            <label class="cursor-pointer text-emerald-600 font-medium">
              <span class="material-icons align-middle">cloud_upload</span>
              <span class="align-middle">Añadir archivos</span>
              <input id="file-upload" type="file" class="hidden" accept="image/*,application/pdf" multiple>
            </label>
          </div>
          <div id="image-preview-container" class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 hidden"></div>
          <div id="ai-loader" class="hidden flex items-center justify-center bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded-lg mt-3">
            <div class="spinner w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mr-3"></div>
            <span id="ai-loader-text">Analizando...</span>
          </div>
        </div>

        <!-- Formulario -->
        <form id="purchase-form" class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label class="text-sm text-slate-700">Fecha</label><input id="fecha" type="date" class="p-2 border rounded w-full" required></div>
            <div><label class="text-sm text-slate-700">No. Factura</label><input id="numero_factura" type="text" class="p-2 border rounded w-full" required></div>
            <div><label class="text-sm text-slate-700">Proveedor</label><input id="proveedor" type="text" class="p-2 border rounded w-full" required></div>
            <div><label class="text-sm text-slate-700">Monto Total (Factura)</label><input id="total" type="number" step="0.01" min="0" inputmode="decimal" class="p-2 border rounded w-full"></div>
            <div><label class="text-sm text-slate-700">Sucursal</label><input id="sucursal" type="text" class="p-2 border rounded w-full" required></div>
            <div><label class="text-sm text-slate-700">Transporte</label><input id="transporte" type="text" class="p-2 border rounded w-full" required></div>
            <div class="md:col-span-2"><label class="text-sm text-slate-700">Faltantes o Comentarios</label><input id="faltantes" type="text" class="p-2 border rounded w-full" required></div>
          </div>

          <div id="calculation-section" class="mt-2"></div>

          <div class="text-right">
            <button type="submit" class="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-6 rounded-lg shadow-md">Guardar Cambios</button>
          </div>
        </form>
      </section>
    `;
    container.innerHTML = ''; container.appendChild(root);

    // Navegar atrás (no usamos navigate para no alterar tus apps)
    $('#back', root).addEventListener('click', () => { location.hash = '#/compras_historial'; });

    // ===== Cargar documento =====
    const snap = await getDoc(doc(db, 'compras', id));
    if (!snap.exists()) {
      root.innerHTML = '<div class="p-6 text-red-500">No existe el registro.</div>';
      return;
    }
    original = snap.data();

    // Prefill
    imageUrls      = Array.isArray(original.images) ? [...original.images] : [];
    totalFacturaAI = parseNumber(original.total) || 0;

    $('#fecha', root).value          = ymd(original.fecha || '');
    $('#numero_factura', root).value = original.numero_factura || '';
    $('#proveedor', root).value      = original.proveedor || '';
    $('#total', root).value          = (original.total || 0).toFixed(2);
    $('#sucursal', root).value       = original.sucursal || '';
    $('#transporte', root).value     = original.transporte || '';
    $('#faltantes', root).value      = original.faltantes || 'Ninguno';

    // ===== Montar ItemsEditor =====
    const calcContainer = $('#calculation-section', root);
    itemsEditor = ItemsEditor({
      container: calcContainer,
      productCatalog,
      initialIVA: original.iva_aplicado ?? 15,
      initialTC:  original.tipo_cambio_aplicado ?? 1,
      initialTotalAI: Number(original.total || 0),
      onChange: () => {}
    });

    // Sincronizar cuando el usuario edite "Monto Total (Factura)"
    $('#total', root).addEventListener('input', (e) => {
      const v = parseNumber(e.target.value);
      totalFacturaAI = isFinite(v) && v >= 0 ? v : 0;
      itemsEditor.setInvoiceTotal(totalFacturaAI); // refleja en "Total Factura (IA)"
    });

    $('#total', root).addEventListener('blur', (e) => {
      const v = parseNumber(e.target.value);
      e.target.value = (isFinite(v) ? v : 0).toFixed(2);
    });

    // Cargar ítems existentes
    itemsEditor.setItems((original.items || []).map(it => ({
      descripcion_factura: it.descripcion_factura,
      cantidad_factura: it.cantidad_factura,
      unidades_por_paquete: it.unidades_por_paquete,
      total_linea_base: it.total_linea_base,
      clave_proveedor: it.clave_proveedor,
      clave_catalogo: it.clave_catalogo,
      desc_catalogo: it.desc_catalogo,
      recibido: !!it.recibido
    })));

    // ===== Adjuntar archivos + IA (ANEXAR SIEMPRE) =====
    $('#file-upload', root).addEventListener('change', handleFileSelect);

    async function handleFileSelect(e) {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;

      const preview = $('#image-preview-container', root);
      preview.innerHTML = ''; preview.classList.remove('hidden');
      const aiLoader = $('#ai-loader', root);
      const aiLoaderText = $('#ai-loader-text', root);
      aiLoader.classList.remove('hidden');
      aiLoaderText.textContent = 'Procesando archivos...';

      const base64ForAI = [];
      const uploadPromises = [];

      try {
        for (const file of files) {
          if (file.type.startsWith('image/')) {
            const base64 = await fileToDataURL(file);
            appendPreviewImage(preview, base64);
            base64ForAI.push(base64.split(',')[1]);
            uploadPromises.push(uploadToStorage(file, `invoices/${userId}/${id}/${Date.now()}-${file.name}`));
          } else if (file.type === 'application/pdf') {
            aiLoaderText.textContent = `Convirtiendo PDF: ${file.name}...`;
            const imgs = await pdfToImages(file);
            for (let i=0;i<imgs.length;i++) {
              const base64 = imgs[i];
              appendPreviewImage(preview, base64);
              base64ForAI.push(base64.split(',')[1]);
              const blob = await dataUrlToBlob(base64);
              uploadPromises.push(uploadToStorage(blob, `invoices/${userId}/${id}/${Date.now()}-${file.name}-page-${i+1}.jpg`));
            }
          }
        }

        aiLoaderText.textContent = `Subiendo ${uploadPromises.length} imágenes...`;
        const newUrls = await Promise.all(uploadPromises);
        // Unir con las existentes (evitamos duplicados simples)
        imageUrls = Array.from(new Set([...(imageUrls || []), ...newUrls]));

        aiLoaderText.textContent = 'Analizando con IA...';
        const aiData = await getAIDataDirect(base64ForAI, env?.AI_API_KEY);

        if (aiData) {
          if (aiData.fecha)           $('#fecha', root).value = aiData.fecha;
          if (aiData.proveedor)       $('#proveedor', root).value = aiData.proveedor;
          if (aiData.numero_factura)  $('#numero_factura', root).value = aiData.numero_factura;
          const aiTotal = parseNumber(aiData.total) || 0;
          if (aiTotal) { totalFacturaAI = aiTotal; $('#total', root).value = aiTotal.toFixed(2); itemsEditor.setInvoiceTotal(aiTotal); }

          aiLoaderText.textContent = 'Mapeando artículos...';
          const associationPromises = (aiData.items || []).map(async (it) => {
            const assoc = await findAssociation(it.descripcion);
            return {
              descripcion_factura: it.descripcion,
              cantidad_factura: parseNumber(it.cantidad),
              unidades_por_paquete: 1,
              total_linea_base: parseNumber(it.total_linea),
              clave_proveedor: it.clave_proveedor || null,
              clave_catalogo: assoc ? assoc.clave_catalogo : null,
              desc_catalogo: assoc ? assoc.desc_catalogo : null,
              autoAssociated: !!assoc,
              recibido: false
            };
          });
          const newItems = await Promise.all(associationPromises);

          // ANEXAR SIEMPRE
          itemsEditor.addItems(newItems);
          showToast('IA: ítems anexados. Revisá y ajustá.', 'success');
        } else {
          showToast('IA no devolvió datos. Archivos anexados a la compra.', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('Error al procesar archivos.', 'error');
      } finally {
        aiLoader.classList.add('hidden');
      }
    }

    function appendPreviewImage(container, dataUrl) {
      const img = document.createElement('img');
      img.src = dataUrl;
      img.className = 'w-full h-auto object-cover rounded-lg shadow-md';
      container.appendChild(img);
    }

    // ===== Guardar cambios =====
    $('#purchase-form', root).addEventListener('submit', handleFormSubmit);

    async function handleFormSubmit(e) {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = `<div class="spinner w-5 h-5 border-2 border-white border-t-transparent rounded-full mx-auto"></div>`;

      const proveedor = $('#proveedor', root).value.trim();
      const numeroFactura = $('#numero_factura', root).value.trim();

      // Anti-duplicado (excluye el propio doc)
      if (proveedor && numeroFactura) {
        const qdup = query(collection(db, 'compras'),
          where("proveedor", "==", proveedor),
          where("numero_factura", "==", numeroFactura));
        const snap = await getDocs(qdup);
        const existsOther = snap.docs.find(d => d.id !== id);
        if (existsOther) {
          showToast('Ya existe otra factura con ese número para este proveedor.', 'error');
          btn.disabled = false; btn.textContent = 'Guardar Cambios';
          return;
        }
      }

      const ivaPercent = parseFloat($('#ie-iva', root)?.value || '0');
      const tipoCambio = parseNumber($('#ie-tc', root)?.value || DEFAULT_EXCHANGE_RATE);
      const ivaFactor  = 1 + (ivaPercent / 100);

      // Ítems desde el editor
      const rawItems = (window.__ie_debug__ = undefined, ItemsEditor && {}); // solo para evitar treeshake CDN
      const editorEl = $('#calculation-section', root); // punto de referencia (no se usa)
      const finalItems = (function () {
        const items = (typeof editorEl !== 'undefined'); // nada; placeholder
        const fromEditor = (document.querySelector || null); // no se usa
        // Tomamos los ítems desde la instancia real:
        const list = itemsEditor.getItems();
        return list.map(item => {
          const totalBase = item.total_linea_base || 0;
          const totalFinal = totalBase * ivaFactor * tipoCambio;
          const units = (item.cantidad_factura || 0) * (item.unidades_por_paquete || 1);
          const precioFinal = units > 0 ? (totalFinal / units) : 0;
          return {
            descripcion_factura: item.descripcion_factura,
            clave_proveedor: item.clave_proveedor,
            clave_catalogo: item.clave_catalogo,
            desc_catalogo: item.desc_catalogo,
            cantidad_factura: item.cantidad_factura,
            total_linea_base: totalBase,
            unidades_por_paquete: item.unidades_por_paquete || 1,
            precio_final: precioFinal,
            total_linea_final: totalFinal,
            recibido: item.recibido ?? false
          };
        });
      })();

      totalFacturaAI = parseNumber($('#total', root).value);

      const patch = {
        fecha: $('#fecha', root).value,
        proveedor,
        numero_factura: numeroFactura,
        total: totalFacturaAI,
        sucursal: $('#sucursal', root).value,
        transporte: $('#transporte', root).value,
        faltantes: $('#faltantes', root).value,
        images: imageUrls,
        items: finalItems,
        iva_aplicado: ivaPercent,
        tipo_cambio_aplicado: tipoCambio,
        updatedAt: serverTimestamp()
      };

      try {
        await updateDoc(doc(db, 'compras', id), patch);

        const itemsForMap = itemsEditor.getItems();
        await persistMappingsForItems(db, proveedor, itemsForMap);

        showToast('Registro actualizado con éxito.', 'success');
        location.hash = '#/compras_historial';
      } catch (err) {
        console.error(err);
        showToast(`Error al guardar: ${err.message}`, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Guardar Cambios';
      }
    }
  },

  unmount() {
    try { const t = document.getElementById('toast-container'); if (t) t.remove(); } catch {}
  }
};
