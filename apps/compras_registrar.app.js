// apps/compras_registrar.app.js
import {
  collection, addDoc, query, where, getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { ItemsEditor } from './components/items_editor.js';
import { associateItemsBatch, persistMappingsForItems } from './lib/associations.js';
import { parseNumber } from '../export_utils.js';
import { DEFAULT_EXCHANGE_RATE } from '../constants.js';



export default {
  title: 'Registrar Compra',
  async mount(container, { db, storage, auth, appState, env }) {
    // ===== Estado =====
    let userId = auth?.currentUser?.uid || 'anon';
    let imageUrls = [];
    let totalFacturaAI = 0;
    const productCatalog = appState?.productCatalog || [];

    // ===== Utils =====
    const $  = (sel, root=document) => root.querySelector(sel);

    function showToast(m,t='success'){
      let tc = document.getElementById('toast-container');
      if (!tc) { tc = document.createElement('div'); tc.id='toast-container'; tc.className='fixed bottom-4 right-4 z-50'; document.body.appendChild(tc); }
      const el=document.createElement('div');
      const color = t==='success'?'bg-emerald-500':'bg-red-500';
      el.className = `toast ${color} text-white font-bold py-3 px-5 rounded-lg shadow-xl transform translate-y-4 opacity-0 fixed bottom-4 right-4 z-50`;
      el.textContent = m; tc.appendChild(el);
      setTimeout(()=>{el.classList.remove('translate-y-4','opacity-0')},10);
      setTimeout(()=>{el.classList.add('translate-y-4','opacity-0'); el.addEventListener('transitionend',()=>el.remove())},3000);
    }

    // ===== IA directa (temporal en frontend) =====
    async function getAIDataDirect(base64Array, apiKey) {
      if (!apiKey) { showToast('Falta env.AI_API_KEY', 'error'); return null; }
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
      const parts = [
        { text: "Analiza las imágenes de la factura (puede ser multipágina). Devuelve JSON con: fecha (YYYY-MM-DD), proveedor, numero_factura, total (número) e items[{ descripcion, cantidad, total_linea, clave_proveedor }]. Usa null si falta." }
      ];
      base64Array.forEach(b64 => {
        parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } });
      });

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
      await new Promise((resolve, reject)=>{
        const s=document.createElement('script');
        s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.min.js';
        s.onload=()=>{ pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js'; resolve(); };
        s.onerror=reject; document.head.appendChild(s);
      });
    }
    async function pdfToImages(file){
      await ensurePdfJs();
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const imgs = [];
      for (let i=1;i<=pdf.numPages;i++){
        const page=await pdf.getPage(i);
        const viewport=page.getViewport({scale:1.5});
        const canvas=document.createElement('canvas'); const ctx=canvas.getContext('2d');
        canvas.width=viewport.width; canvas.height=viewport.height;
        await page.render({canvasContext:ctx, viewport}).promise;
        imgs.push(canvas.toDataURL('image/jpeg'));
      }
      return imgs;
    }
    function fileToDataURL(file){ return new Promise((res)=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(file); }); }
    function dataUrlToBlob(dataUrl){ return fetch(dataUrl).then(r=>r.blob()); }
    async function uploadToStorage(fileOrBlob, path){
      const storageRef = ref(storage, path);
      const snap = await uploadBytes(storageRef, fileOrBlob);
      return getDownloadURL(snap.ref);
    }

    // ===== UI =====
    const root = document.createElement('div');
    root.className = 'max-w-5xl mx-auto p-4 md:p-6';
    root.innerHTML = `
      <header class="mb-4 flex items-center justify-between">
        <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Registrar nueva compra</h1>
        <button id="back" class="text-slate-600 hover:text-slate-900">Volver</button>
      </header>

      <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl space-y-6">
        <!-- Paso 1: Subir archivos -->
        <div class="p-4 border-2 border-dashed rounded-lg text-center">
          <label class="cursor-pointer text-emerald-600 font-medium">
            <span class="material-icons text-4xl align-middle">cloud_upload</span><br>
            Subir imágenes/PDF de factura
            <input id="file-upload" type="file" class="hidden" accept="image/*,application/pdf" multiple>
          </label>
          <div id="image-preview-container" class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 hidden"></div>
          <div id="ai-loader" class="hidden flex items-center justify-center bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded-lg mt-4">
            <div class="spinner w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mr-3"></div>
            <span id="ai-loader-text">Analizando factura con IA...</span>
          </div>
        </div>

        <!-- Paso 2: Formulario + Editor de Ítems -->
        <form id="purchase-form" class="hidden space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm text-slate-700">Fecha</label>
              <input id="fecha" type="date" class="p-2 border rounded w-full" required>
            </div>
            <div>
              <label class="block text-sm text-slate-700">No. Factura</label>
              <input id="numero_factura" type="text" class="p-2 border rounded w-full" placeholder="Número de la factura" required>
            </div>
            <div>
              <label class="block text-sm text-slate-700">Proveedor</label>
              <input id="proveedor" type="text" class="p-2 border rounded w-full" placeholder="Nombre del proveedor" required>
            </div>
            <div>
              <label class="block text-sm text-slate-700">Monto Total (Factura)</label>
              <input id="total" type="number" step="0.01" inputmode="decimal" class="p-2 border rounded w-full">
            </div>
            <div>
              <label class="block text-sm text-slate-700">Sucursal</label>
              <input id="sucursal" type="text" class="p-2 border rounded w-full" placeholder="Sucursal que recibe" required>
            </div>
            <div>
              <label class="block text-sm text-slate-700">Transporte</label>
              <input id="transporte" type="text" class="p-2 border rounded w-full" placeholder="Transporte utilizado" required>
            </div>
            <div class="md:col-span-2">
              <label class="block text-sm text-slate-700">Faltantes o Comentarios</label>
              <input id="faltantes" type="text" class="p-2 border rounded w-full" value="Ninguno" required>
            </div>
          </div>

          <div id="calculation-section" class="mt-2"></div>

          <div class="text-right">
            <button type="submit" class="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-6 rounded-lg shadow-md">Guardar Registro</button>
          </div>
        </form>
      </section>
    `;
    container.innerHTML = '';
    container.appendChild(root);

    $('#back', root).addEventListener('click', ()=> { location.hash = '#/compras_historial'; });

    // ===== Montar ItemsEditor =====
    const calcContainer = $('#calculation-section', root);
    const itemsEditor = ItemsEditor({
      container: calcContainer,
      productCatalog,
      initialIVA: 15,
      initialTC: DEFAULT_EXCHANGE_RATE,
      initialTotalAI: 0,
      onChange: () => {}
    });

    // Sincroniza el total escrito a mano con el editor (diferencias/summary)
    const totalInput = $('#total', root);
    totalInput.addEventListener('input', () => {
      const v = parseNumber(totalInput.value);
      totalFacturaAI = v;
      itemsEditor.setInvoiceTotal(v); // actualiza "Total Factura (IA)" y recalcula diferencias
    });

    // ===== Subida + IA + Mapeo (ANEXAR SIEMPRE) =====
    $('#file-upload', root).addEventListener('change', handleFileSelect);

    async function handleFileSelect(e) {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      if (!userId) userId = auth?.currentUser?.uid || 'anon';

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
            uploadPromises.push(uploadToStorage(file, `invoices/${userId}/${Date.now()}-${file.name}`));
          } else if (file.type === 'application/pdf') {
            aiLoaderText.textContent = `Convirtiendo PDF: ${file.name}...`;
            const imgs = await pdfToImages(file);
            for (let i=0;i<imgs.length;i++){
              const base64 = imgs[i];
              appendPreviewImage(preview, base64);
              base64ForAI.push(base64.split(',')[1]);
              const blob = await dataUrlToBlob(base64);
              uploadPromises.push(uploadToStorage(blob, `invoices/${userId}/${Date.now()}-${file.name}-page-${i+1}.jpg`));
            }
          }
        }

        aiLoaderText.textContent = `Subiendo ${uploadPromises.length} imágenes a Storage...`;
        imageUrls = await Promise.all(uploadPromises);

        // Mostrar formulario (aunque la IA no devuelva nada)
        $('#purchase-form', root).classList.remove('hidden');

        aiLoaderText.textContent = 'Analizando factura con IA...';
        const extracted = await getAIDataDirect(base64ForAI, env?.AI_API_KEY);

        if (extracted) {
          totalFacturaAI = parseNumber(extracted.total) || 0;
          $('#fecha', root).value = extracted.fecha || '';
          $('#proveedor', root).value = extracted.proveedor || '';
          $('#numero_factura', root).value = extracted.numero_factura || '';
          $('#total', root).value = totalFacturaAI.toFixed(2);

          // Editor: actualizar total IA y ANEXAR ítems
          itemsEditor.setInvoiceTotal(totalFacturaAI);

          const baseItems = (extracted.items || []).map(it => ({
            descripcion_factura: it.descripcion,
            cantidad_factura: parseNumber(it.cantidad),
            unidades_por_paquete: 1,
            total_linea_base: parseNumber(it.total_linea),
            clave_proveedor: it.clave_proveedor || null,
            recibido: false
          }));
          const withAssoc = await associateItemsBatch(db, $('#proveedor', root).value || extracted.proveedor || '', baseItems);
          const newItems = withAssoc.map(it => ({ ...it, autoAssociated: !!it.clave_catalogo }));
          itemsEditor.addItems(newItems); // <--- ANEXAR SIEMPRE
          showToast('Datos y productos extraídos por la IA.', 'success');
        } else {
          showToast('La IA no pudo extraer datos, ingrésalos manualmente.', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('Error al procesar archivos.', 'error');
      } finally {
        aiLoader.classList.add('hidden');
      }
    }

    function appendPreviewImage(container, dataUrl) {
      const img=document.createElement('img');
      img.src=dataUrl; img.className='w-full h-auto object-cover rounded-lg shadow-md';
      container.appendChild(img);
    }

    // ===== Guardar =====
    $('#purchase-form', root).addEventListener('submit', handleFormSubmit);

    async function handleFormSubmit(e) {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.innerHTML = `<div class="spinner w-5 h-5 border-2 border-white border-t-transparent rounded-full mx-auto"></div>`;

      if (imageUrls.length === 0) {
        showToast('Subí al menos una imagen de la factura.', 'error');
        btn.disabled = false; btn.textContent = 'Guardar Registro';
        return;
      }

      const proveedor = $('#proveedor', root).value.trim();
      const numeroFactura = $('#numero_factura', root).value.trim();

      // Anti-duplicado
      if (proveedor && numeroFactura) {
        const qdup = query(collection(db,'compras'),
          where("proveedor","==", proveedor),
          where("numero_factura","==", numeroFactura));
        const snap = await getDocs(qdup);
        if (!snap.empty) {
          showToast('Ya existe una factura con ese número para este proveedor.', 'error');
          btn.disabled = false; btn.textContent = 'Guardar Registro';
          return;
        }
      }

      const ivaPercent = parseFloat($('#ie-iva', root)?.value || '0');
      const tipoCambio = parseNumber($('#ie-tc', root)?.value || DEFAULT_EXCHANGE_RATE);

      // Asegura el total a partir del input
      totalFacturaAI = parseNumber($('#total', root).value);

      // Final items desde el editor
      const rawItems = itemsEditor.getItems();
      const ivaFactor = 1 + (ivaPercent/100);
      const finalItems = rawItems.map(item => {
        const totalBase = item.total_linea_base || 0;
        const totalLineaFinal = totalBase * ivaFactor * tipoCambio;
        const cantidadTotalUnidades = (item.cantidad_factura || 0) * (item.unidades_por_paquete || 1);
        const precioFinal = cantidadTotalUnidades > 0 ? totalLineaFinal / cantidadTotalUnidades : 0;
        return {
          descripcion_factura: item.descripcion_factura,
          clave_proveedor: item.clave_proveedor,
          clave_catalogo: item.clave_catalogo,
          desc_catalogo: item.desc_catalogo,
          cantidad_factura: item.cantidad_factura,
          total_linea_base: totalBase,
          unidades_por_paquete: item.unidades_por_paquete || 1,
          precio_final: precioFinal,
          total_linea_final: totalLineaFinal,
          recibido: item.recibido ?? false
        };
      });

      const purchaseData = {
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
        comments: [],
        agregado_sicar: false,
        userId: userId,
        createdAt: serverTimestamp()
      };

      try {
        const col = collection(db, 'compras');
        await addDoc(col, purchaseData);

        await persistMappingsForItems(db, proveedor, rawItems);

        showToast('Compra registrada con éxito.', 'success');
        location.hash = '#/compras_historial';
      } catch (err) {
        console.error("Error al guardar: ", err);
        showToast(`Error al guardar: ${err.message}`, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Guardar Registro';
      }
    }
  },

  unmount() {
    try { const t=document.getElementById('toast-container'); if (t) t.remove(); } catch {}
  }
};
