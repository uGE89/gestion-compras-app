// apps/cotizaciones_registrar.app.js
import {
  collection, addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { ItemsEditor } from './components/items_editor.js';
const COT_COLLECTION = 'cotizaciones_analizadas';
import { associateItemsBatch, persistMappingsForItems } from './lib/associations.js';
import { parseNumber } from '../export_utils.js';
import { DEFAULT_EXCHANGE_RATE } from '../constants.js';



export default {
  title: 'Registrar Cotización',
  async mount(container, { db, storage, auth, appState, env, params }) {
    let userId = auth?.currentUser?.uid || 'anon';
    const productCatalog = appState?.productCatalog || [];

    const rfqId = params.get('rfq') || crypto.randomUUID(); // permite pasar ?rfq=...

    const $ = (s,r=document)=>r.querySelector(s);
    const toast = (m,t='success')=>{
      let tc=document.getElementById('toast-container');
      if(!tc){tc=document.createElement('div');tc.id='toast-container';tc.className='fixed bottom-4 right-4 z-50';document.body.appendChild(tc);}
      const el=document.createElement('div');
      el.className=`toast ${t==='success'?'bg-emerald-500':'bg-red-500'} text-white font-bold py-3 px-5 rounded-lg shadow-xl transform translate-y-4 opacity-0 fixed bottom-4 right-4`;
      el.textContent=m; tc.appendChild(el);
      setTimeout(()=>{el.classList.remove('translate-y-4','opacity-0')},10);
      setTimeout(()=>{el.classList.add('translate-y-4','opacity-0'); el.addEventListener('transitionend',()=>el.remove())},2600);
    };

    // === IA (igual que compras, pero con prompt para cotización)
    async function getAI(base64, apiKey){
      if(!apiKey){ toast('Falta AI_API_KEY','error'); return null; }
      const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
      const parts=[{text:"Analiza las imágenes de una COTIZACIÓN. Devuelve JSON con { proveedor, fecha (YYYY-MM-DD), vigencia (opcional), moneda (MXN/USD u otra), tipo_cambio (num, opcional), items:[{descripcion, cantidad, total_linea (opcional), precio_unit (opcional), clave_proveedor}] }. Si falta un dato usa null. No expliques, solo JSON."}];
      base64.forEach(b=>parts.push({inlineData:{mimeType:"image/jpeg", data:b}}));
      try{
        const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json'}})});
        const j=await res.json();
        const raw=j?.candidates?.[0]?.content?.parts?.[0]?.text||'{}';
        return JSON.parse(raw);
      }catch(e){ console.error(e); toast('Error de IA','error'); return null; }
    }

    async function ensurePdf(){ if(typeof pdfjsLib!=='undefined') return;
      await new Promise((ok,ko)=>{ const s=document.createElement('script');
        s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.min.js';
        s.onload=()=>{ pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js'; ok(); };
        s.onerror=ko; document.head.appendChild(s); });}
    async function pdfToImgs(file){
      await ensurePdf(); const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
      const imgs=[]; for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i);
        const v=page.getViewport({scale:1.5}); const c=document.createElement('canvas'); const ctx=c.getContext('2d');
        c.width=v.width; c.height=v.height; await page.render({canvasContext:ctx,viewport:v}).promise;
        imgs.push(c.toDataURL('image/jpeg'));} return imgs;}
    const fileToB64 = f => new Promise(r=>{const rd=new FileReader(); rd.onload=e=>r(e.target.result); rd.readAsDataURL(f);});
    const dataUrlToBlob = d => fetch(d).then(r=>r.blob());
    async function uploadToStorage(fileOrBlob, path){
      const sref=ref(storage,path); const snap=await uploadBytes(sref,fileOrBlob); return getDownloadURL(snap.ref); }

    // === UI
    container.innerHTML = `
      <div class="max-w-5xl mx-auto p-4 md:p-6">
        <header class="mb-4 flex items-center justify-between">
          <div>
            <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Registrar Cotización</h1>
            <div class="text-xs text-slate-500">RFQ: <code>${rfqId}</code></div>
          </div>
          <div class="flex gap-2">
            <button id="go-matrix" class="bg-slate-200 hover:bg-slate-300 text-slate-800 px-3 py-2 rounded">Ir a comparación</button>
            <button id="back" class="text-slate-600 hover:text-slate-900">Volver</button>
          </div>
        </header>

        <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl space-y-6">
          <div class="p-4 border-2 border-dashed rounded-lg text-center">
            <label class="cursor-pointer text-emerald-600 font-medium">
              <span class="material-icons text-4xl align-middle">cloud_upload</span><br>
              Subir imágenes/PDF de la cotización
              <input id="file-upload" type="file" class="hidden" accept="image/*,application/pdf" multiple>
            </label>
            <div id="prev" class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 hidden"></div>
            <div id="loader" class="hidden flex items-center justify-center bg-blue-50 border border-blue-200 text-blue-800 p-3 rounded-lg mt-4">
              <div class="spinner w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mr-3"></div>
              <span id="loader-txt">Analizando…</span>
            </div>
          </div>

          <form id="form" class="hidden space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label class="text-sm">Proveedor</label><input id="proveedor" class="p-2 border rounded w-full" required></div>
              <div><label class="text-sm">Fecha</label><input id="fecha" type="date" class="p-2 border rounded w-full"></div>
              <div><label class="text-sm">Vigencia</label><input id="vigencia" type="date" class="p-2 border rounded w-full"></div>
              <div><label class="text-sm">Moneda</label><input id="moneda" class="p-2 border rounded w-full" placeholder="MXN"></div>
              <div><label class="text-sm">Tipo de cambio</label><input id="tc" type="number" step="0.001" class="p-2 border rounded w-full" value="1"></div>
              <div><label class="text-sm">Notas</label><input id="notas" class="p-2 border rounded w-full"></div>
            </div>

            <div id="items"></div>

            <div class="text-right">
              <button class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-lg">Guardar Cotización</button>
            </div>
          </form>
        </section>
      </div>
    `;

    $('#back').addEventListener('click', ()=>{ location.hash = '#/cotizaciones_historial'; });
    $('#go-matrix').addEventListener('click', ()=>{ location.hash = `#/cotizaciones_comparar?rfq=${rfqId}`; });

    // Editor reutilizado
    const itemsMount = $('#items');
    const editor = ItemsEditor({
      container: itemsMount,
      productCatalog,
      initialIVA: 0,     // usualmente cotiza sin IVA
      initialTC: DEFAULT_EXCHANGE_RATE,
      initialTotalAI: 0,
      onChange: ()=>{}
    });

    // Subida + IA (anexar)
    $('#file-upload').addEventListener('change', handleFiles);
    async function handleFiles(e){
      const files=Array.from(e.target.files||[]); if(!files.length) return;
      const prev=$('#prev'); prev.innerHTML=''; prev.classList.remove('hidden');
      const loader=$('#loader'), txt=$('#loader-txt'); loader.classList.remove('hidden');

      const base64=[], uploads=[];
      try{
        for (const f of files){
          if (f.type.startsWith('image/')){
            const b64=await fileToB64(f); base64.push(b64.split(',')[1]);
            appendPrev(prev, b64);
            uploads.push(uploadToStorage(f, `quotes/${userId}/${rfqId}/${Date.now()}-${f.name}`));
          } else if (f.type==='application/pdf'){
            txt.textContent=`Convirtiendo PDF: ${f.name}…`;
            const imgs=await pdfToImgs(f);
            for (let i=0;i<imgs.length;i++){
              appendPrev(prev, imgs[i]);
              base64.push(imgs[i].split(',')[1]);
              const blob=await dataUrlToBlob(imgs[i]);
              uploads.push(uploadToStorage(blob, `quotes/${userId}/${rfqId}/${Date.now()}-${f.name}-p${i+1}.jpg`));
            }
          }
        }
        await Promise.all(uploads);
        $('#form').classList.remove('hidden');

        txt.textContent='Analizando con IA…';
        const ai = await getAI(base64, env?.AI_API_KEY);
        if (ai){
          $('#proveedor').value = ai.proveedor || '';
          $('#fecha').value     = ai.fecha || '';
          $('#moneda').value    = ai.moneda || 'MXN';
          $('#tc').value        = ai.tipo_cambio || 1;

      const baseItems = (ai.items || []).map(raw => {
            const cant  = parseNumber(raw.cantidad);
            const total = parseNumber(raw.total_linea);
            const uxp   = 1;
            const punit = raw.precio_unit != null ? parseNumber(raw.precio_unit)
                          : (cant*uxp>0 ? total/(cant*uxp) : 0);
            return {
              descripcion_factura: raw.descripcion,
              cantidad_factura: cant,
              unidades_por_paquete: uxp,
              total_linea_base: total,     // lo guardamos para tener referencia
              precio_unit: punit,          // clave para comparación
              clave_proveedor: raw.clave_proveedor || null,
              recibido: false
            };
          });
          const withAssoc = await associateItemsBatch(db, $('#proveedor').value || ai.proveedor || '', baseItems);
          editor.addItems(withAssoc.map(it => ({ ...it, autoAssociated: !!it.clave_catalogo })));
          toast('Cotización extraída. Revisa precios/cantidades.');
        } else {
          toast('La IA no devolvió datos. Completa manualmente.', 'error');
        }
      }catch(err){ console.error(err); toast('Error al procesar archivos.','error'); }
      finally { loader.classList.add('hidden'); }
    }

    function appendPrev(container, dataUrl){
      const img=document.createElement('img');
      img.src=dataUrl; img.className='w-full h-auto object-cover rounded-lg border';
      container.appendChild(img);
    }

    // Guardar
    $('#form').addEventListener('submit', async (e)=>{
      e.preventDefault();
      const btn=e.submitter; if(btn){ btn.disabled=true; btn.textContent='Guardando…'; }

      const items = editor.getItems().map(it=>({
        descripcion_factura: it.descripcion_factura,
        clave_catalogo: it.clave_catalogo,
        desc_catalogo: it.desc_catalogo,
        clave_proveedor: it.clave_proveedor,
        cantidad: it.cantidad_factura,
        precio_unit: Number(it.precio_unit || (it.total_linea_base / Math.max(1,(it.cantidad_factura||0)*(it.unidades_por_paquete||1)) ) || 0),
        total_linea: Number(it.total_linea_base||0)
      }));

      const docData = {
        rfqId,
        proveedor: $('#proveedor').value.trim(),
        fecha: $('#fecha').value || null,
        vigencia: $('#vigencia').value || null,
        moneda: $('#moneda').value || 'MXN',
        tipo_cambio: parseNumber($('#tc').value) || DEFAULT_EXCHANGE_RATE,
        notas: $('#notas').value || '',
        items,
        userId, createdAt: serverTimestamp()
      };

      try{
        await addDoc(collection(db, COT_COLLECTION), docData);

        await persistMappingsForItems(db, $('#proveedor').value.trim(), editor.getItems());

        toast('Cotización guardada.');
        location.hash = `#/cotizaciones_comparar?rfq=${rfqId}`;
      } catch(err){ console.error(err); toast('Error al guardar','error'); }
      finally { if(btn){ btn.disabled=false; btn.textContent='Guardar Cotización'; } }
    });
  },
  unmount(){ /* noop */ }
};
