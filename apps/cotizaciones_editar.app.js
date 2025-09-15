// apps/cotizaciones_editar.app.js
import { FIREBASE_BASE, PDFJS_CDN } from './lib/constants.js';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from `${FIREBASE_BASE}firebase-firestore.js`;
import { ItemsEditor } from './components/items_editor.js';
import { persistMappingsForItems } from './lib/associations.js';
import { showToast } from './lib/toast.js';
import { parseNumber } from '../export_utils.js';
import { DEFAULT_EXCHANGE_RATE } from '../constants.js';
const COT_COLLECTION = 'cotizaciones_analizadas';

const MAP_COLLECTION = 'mapeo_articulos';


export default {
  title: 'Editar Cotización',
  async mount(container, { db, appState, params, env }) {
    const id = params.get('id');
    if (!id) { container.innerHTML = '<div class="p-6 text-slate-500">ID no especificado.</div>'; return; }

    const $ = (s, r=document)=> r.querySelector(s);

    // ===== IA directa (opcional, solo para anexar) =====
    async function getAIDataDirect(base64Array, apiKey) {
      if (!apiKey) { showToast('Falta env.AI_API_KEY','error'); return null; }
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
      const parts = [
        { text: "Analiza las imágenes (cotización multipágina). Devuelve JSON: fecha (YYYY-MM-DD), proveedor, numero_cotizacion, total (número) e items[{ descripcion, cantidad, total_linea, clave_proveedor }]. Usa null si falta." }
      ];
      base64Array.forEach(b64 => parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } }));
      try {
        const res = await fetch(apiUrl, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ contents:[{role:'user',parts}], generationConfig:{responseMimeType:'application/json'} })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const raw  = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return JSON.parse(raw);
      } catch (e) { console.error(e); showToast('Error de IA','error'); return null; }
    }
    async function ensurePdfJs(){
      if (typeof pdfjsLib !== 'undefined') return;
      await new Promise((resolve,reject)=>{
        const s=document.createElement('script');
        s.src=`${PDFJS_CDN}pdf.min.js`;
        s.onload=()=>{ pdfjsLib.GlobalWorkerOptions.workerSrc=`${PDFJS_CDN}pdf.worker.min.js`; resolve(); };
        s.onerror=reject; document.head.appendChild(s);
      });
    }
    async function fileToDataURL(file){ return new Promise(res=>{const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(file);}); }
    async function pdfToImages(file){
      await ensurePdfJs();
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const out=[];
      for(let i=1;i<=pdf.numPages;i++){
        const page=await pdf.getPage(i);
        const viewport=page.getViewport({scale:1.5});
        const canvas=document.createElement('canvas'); const ctx=canvas.getContext('2d');
        canvas.width=viewport.width; canvas.height=viewport.height;
        await page.render({canvasContext:ctx, viewport}).promise;
        out.push(canvas.toDataURL('image/jpeg'));
      }
      return out;
    }
    async function findAssociation(description){
      if (!description) return null;
      const mapId = description.toLowerCase().replace(/[^a-z0-9]/g,'-').replace(/-+/g,'-');
      const s = await getDoc(doc(db, MAP_COLLECTION, mapId));
      return s.exists()? s.data() : null;
    }

    // ===== Carga inicial =====
    const snap = await getDoc(doc(db, COT_COLLECTION, id));
    if (!snap.exists()) { container.innerHTML = '<div class="p-6 text-red-500">No existe la cotización.</div>'; return; }
    const data = snap.data();
    const productCatalog = appState?.productCatalog || [];

    const root = document.createElement('div');
    root.className = 'max-w-6xl mx-auto p-4 md:p-6';
    root.innerHTML = `
      <header class="mb-4 flex items-center justify-between">
        <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Editar cotización</h1>
        <button id="back" class="text-slate-600 hover:text-slate-900">Volver</button>
      </header>

      <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl space-y-6">
        <form id="form" class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm text-slate-700">Fecha</label>
              <input id="fecha" type="date" class="p-2 border rounded w-full" required value="${data.fecha||''}">
            </div>
            <div>
              <label class="block text-sm text-slate-700">Folio/No. Cotización</label>
              <input id="folio" type="text" class="p-2 border rounded w-full" value="${data.numero_cotizacion || data.folio || data.numero || ''}">
            </div>
            <div>
              <label class="block text-sm text-slate-700">Proveedor</label>
              <input id="proveedor" type="text" class="p-2 border rounded w-full" required value="${data.proveedor||''}">
            </div>
            <div>
              <label class="block text-sm text-slate-700">Total (documento)</label>
              <input id="total" type="number" step="0.01" class="p-2 border rounded w-full bg-slate-100" readonly value="${Number(data.total||0)}">
            </div>
          </div>

          <!-- Editor de Ítems reutilizable -->
          <div id="calc"></div>

          <div class="flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
            <label class="inline-flex items-center gap-2 cursor-pointer">
              <input id="file" type="file" class="hidden" accept="image/*,application/pdf" multiple>
              <span class="bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded hover:bg-blue-100">
                <span class="material-icons align-middle mr-1">imagesmode</span> Añadir ítems con IA (opcional)
              </span>
            </label>
            <div id="ai-loader" class="hidden text-sm text-slate-500">Analizando…</div>
          </div>

          <div class="text-right">
            <button type="submit" class="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-6 rounded-lg shadow-md">
              Guardar cambios
            </button>
          </div>
        </form>
      </section>
    `;
    container.innerHTML=''; container.appendChild(root);

    $('#back', root).addEventListener('click', ()=> { history.back(); });

    // ===== Montar ItemsEditor con datos existentes =====
// ===== Montar ItemsEditor con datos existentes =====
const itemsInit = (data.items || []).map(it => ({
  descripcion_factura: it.descripcion_factura || it.descripcion || '',
  cantidad_factura: Number(it.cantidad_factura ?? it.cantidad ?? 0),
  unidades_por_paquete: Number(it.unidades_por_paquete ?? 1),
  total_linea_base: Number(it.total_linea_base ?? it.total_linea ?? 0),
  clave_proveedor: it.clave_proveedor || null,
  clave_catalogo: it.clave_catalogo || null,
  desc_catalogo: it.desc_catalogo || null,
  recibido: !!it.recibido,
  autoAssociated: !!it.clave_catalogo
}));

const itemsEditor = ItemsEditor({
  container: $('#calc', root),
  productCatalog,
  initialIVA: Number(data.iva_aplicado ?? 0),
  initialTC: Number(data.tipo_cambio_aplicado ?? DEFAULT_EXCHANGE_RATE),
  initialTotalAI: Number(data.total || 0),
  onChange: () => {}
});

// ⬅️ Esta línea hace que aparezcan los ítems
if (itemsInit.length) itemsEditor.addItems(itemsInit);

// Mantén sincronizado el total del documento mostrado
itemsEditor.setInvoiceTotal(Number(data.total || 0));


    // ===== IA opcional: anexar ítems =====
    $('#file', root).addEventListener('change', async (e)=>{
      const files = Array.from(e.target.files||[]);
      if (!files.length) return;

      const aiLoader = $('#ai-loader', root);
      aiLoader.classList.remove('hidden');
      try {
        const base64 = [];
        for (const f of files) {
          if (f.type === 'application/pdf') {
            const pages = await pdfToImages(f);
            for (const p of pages) base64.push(p.split(',')[1]);
          } else if (f.type.startsWith('image/')) {
            const dataUrl = await fileToDataURL(f);
            base64.push(dataUrl.split(',')[1]);
          }
        }

        const extracted = await getAIDataDirect(base64, env?.AI_API_KEY);
        if (extracted) {
          // actualizar encabezados si vienen
          if (extracted.fecha) $('#fecha', root).value = extracted.fecha;
          if (extracted.proveedor) $('#proveedor', root).value = extracted.proveedor;
          if (extracted.numero_cotizacion) $('#folio', root).value = extracted.numero_cotizacion;

          const totalDoc = parseNumber(extracted.total);
          if (totalDoc>0) { $('#total', root).value = totalDoc.toFixed(2); itemsEditor.setInvoiceTotal(totalDoc); }

          // anexa ítems + mapeo
          const mapped = await Promise.all((extracted.items||[]).map(async it=>{
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
          }));
          itemsEditor.addItems(mapped);
          showToast('Ítems añadidos desde IA.');
        } else {
          showToast('La IA no devolvió datos.', 'error');
        }
      } catch (err) {
        console.error(err); showToast('Error con archivos/IA','error');
      } finally {
        aiLoader.classList.add('hidden');
        e.target.value = '';
      }
    });

    // ===== Guardar cambios =====
    $('#form', root).addEventListener('submit', async (ev)=>{
      ev.preventDefault();
      const btn = ev.target.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Guardando…';

      const ivaPercent = Number($('#ie-iva', root)?.value || 0);
      const tipoCambio = Number($('#ie-tc', root)?.value || 1);
      const ivaFactor  = 1 + (ivaPercent/100);

      const rawItems = itemsEditor.getItems();
      const finalItems = rawItems.map(it=>{
        const totalBase = Number(it.total_linea_base||0);
        const totalFinal = totalBase * ivaFactor * tipoCambio;
        const qtyUnits = Number(it.cantidad_factura||0) * Number(it.unidades_por_paquete||1);
        const precioFinal = qtyUnits>0 ? (totalFinal/qtyUnits) : 0;
        return {
          descripcion_factura: it.descripcion_factura,
          clave_proveedor: it.clave_proveedor||null,
          clave_catalogo: it.clave_catalogo||null,
          desc_catalogo: it.desc_catalogo||null,
          cantidad_factura: Number(it.cantidad_factura||0),
          unidades_por_paquete: Number(it.unidades_por_paquete||1),
          total_linea_base: totalBase,
          precio_final: precioFinal,
          total_linea_final: totalFinal,
          recibido: !!it.recibido
        };
      });

      const payload = {
        fecha: $('#fecha', root).value,
        proveedor: $('#proveedor', root).value.trim(),
        numero_cotizacion: $('#folio', root).value.trim(),
        total: Number($('#total', root).value||0),
        items: finalItems,
        iva_aplicado: ivaPercent,
        tipo_cambio_aplicado: tipoCambio,
        updatedAt: serverTimestamp()
      };

      try {
        await updateDoc(doc(db, COT_COLLECTION,id), payload);

        await persistMappingsForItems(db, $('#proveedor', root).value.trim(), rawItems);

        showToast('Cambios guardados.');
        location.hash = `#/cotizaciones_detalles?id=${encodeURIComponent(id)}`;
      } catch (e) {
        console.error(e); showToast('Error al guardar','error');
      } finally {
        btn.disabled = false; btn.textContent = 'Guardar cambios';
      }
    });
  },
  unmount(){ try{ const t=document.getElementById('toast-container'); if(t) t.remove(); }catch{} }
};
