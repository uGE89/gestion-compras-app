// /public/apps/caja_registrar.app.js
// Registrar movimientos de caja (usa colección 'transferencias')
import { auth, db, storage, firebaseConfig } from '../firebase-init.js';
import { FIREBASE_BASE, GEMINI_PRO, buildAiUrl } from './lib/constants.js';
import { onAuthStateChanged, signInAnonymously } from `${FIREBASE_BASE}firebase-auth.js`;
import {
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  where
} from `${FIREBASE_BASE}firebase-firestore.js`;
import { ref, uploadBytes, getDownloadURL } from `${FIREBASE_BASE}firebase-storage.js`;
import { toNio } from '../export_utils.js';
import { showToast } from './lib/toast.js';

export default {
  async mount(container) {
    // ---------- UI ----------
    container.innerHTML = `
      <div class="container mx-auto p-4 max-w-lg">
        <header class="mb-6 flex items-center">
          <button id="back" type="button" class="text-slate-600 hover:text-slate-900">Volver</button>
          <div class="flex-1 text-center">
            <h1 class="text-3xl font-bold text-slate-900">Nuevo Registro</h1>
            <p class="text-slate-500 mt-1">Sube un comprobante o estado de cuenta.</p>
          </div>
        </header>

        <div id="register-wizard" class="bg-white rounded-2xl shadow-lg">
          <!-- STEP 1: Upload -->
          <div id="step-1" class="step active">
            <div id="image-panel-trigger" class="relative flex flex-col items-center justify-center min-h-[300px] p-6 border-4 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-all">
              <img id="image-preview" class="hidden absolute inset-0 w-full h-full object-contain rounded-2xl p-2 z-10" src="#" alt="Vista previa del comprobante"/>
              <div id="upload-placeholder" class="text-center text-slate-400">
                <span class="material-icons text-6xl">cloud_upload</span>
                <p class="mt-2 font-semibold">Toca para subir una imagen o PDF</p>
              </div>
              <div id="ai-loader" class="hidden text-center text-emerald-700">
                <div class="spinner w-10 h-10 border-4 border-current border-t-transparent rounded-full mx-auto"></div>
                <p class="mt-4 font-semibold text-lg">Analizando comprobante...</p>
              </div>
            </div>
            <input type="file" id="file-upload" class="hidden" accept="image/*,application/pdf">
          </div>

          <!-- STEP 2: Review -->
          <div id="step-review" class="step">
            <div class="p-4 sm:p-6">
              <div class="flex justify-between items-center mb-4">
                <h3 class="font-bold text-lg text-slate-900">Revisa los Movimientos</h3>
                <button id="cancel-btn" type="button" class="text-slate-500 hover:text-slate-800">&times; Cancelar</button>
              </div>
              <div id="transaction-forms-container" class="space-y-4"></div>
            </div>
          </div>
        </div>
      </div>

      <div id="toast-container" class="fixed bottom-24 right-4 z-50"></div>
    `;

    // ---------- Estado ----------
    const accountMappingsArray = [
      { id: 5,  name: "Ahorro Dólares CEF", color: "#388E3C", moneda: "USD" },
      { id: 4,  name: "Ahorro Dólares EFV", color: "#388E3C", moneda: "USD" },
      { id: 12, name: "Banpro ahorro", color: "#6EA8FE", moneda: "NIO" },
      { id: 11, name: "Banpro Comercial", color: "#6EA8FE", moneda: "NIO" },
      { id: 14, name: "Caja Bodegón", color: "#81C784", moneda: "NIO" },
      { id: 1,  name: "Caja central", color: "#2196F3", moneda: "NIO" },
      { id: 10, name: "Caja Coperna", color: "#4CAF50", moneda: "NIO" },
      { id: 6,  name: "Caja Principal", color: "#1976D2", moneda: "NIO" },
      { id: 8,  name: "Caja Sucursal", color: "#FFC107", moneda: "NIO" },
      { id: 9,  name: "Caja Uge", color: "#FF9800", moneda: "NIO" },
      { id: 7,  name: "Comodín", color: "#9E9E9E", moneda: "NIO" },
      { id: 2,  name: "Cuenta corriente Bancentro", color: "#388E3C", moneda: "NIO" },
      { id: 13, name: "Efectivo POS - Terminal Coperna", color: "#795548", moneda: "NIO" },
      { id: 3,  name: "Tarjeta de crédito 1", color: "#388E3C", moneda: "NIO" },
      { id: 15, name: "BAC córdobas", color: "#D32F2F", moneda: "NIO" }
    ];

    let userId = null, currentImageUrl = null;
    let alegraContactsCache = [], alegraCategoriesCache = [];
    let isDataUnsaved = false;

    // ---------- Helpers DOM ----------
    const $ = s => container.querySelector(s);
    const imagePanel = $('#image-panel-trigger');
    const fileInput  = $('#file-upload');
    const imgPrev    = $('#image-preview');
    const uploadPh   = $('#upload-placeholder');
    const aiLoader   = $('#ai-loader');
    const txForms    = $('#transaction-forms-container');
    const backBtn    = $('#back');

    // ---------- Init ----------
    onAuthStateChanged(auth, (user) => { userId = user?.uid || null; if (!user) signInAnonymously(auth); });
    await loadAlegraData().catch(()=>{});
    imagePanel.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    $('#cancel-btn').addEventListener('click', resetUI);
    backBtn.addEventListener('click', () => { location.hash = '#/caja_historial'; });
    window.addEventListener('beforeunload', (e) => { if (isDataUnsaved) { e.preventDefault(); e.returnValue = ''; } });

    // Step control
    function goToStep(id) {
      ['step-1','step-review'].forEach(s => $(`#${s}`).classList.remove('active'));
      $(`#${id}`).classList.add('active');
    }
    function resetUI() {
      isDataUnsaved = false;
      goToStep('step-1');
      txForms.innerHTML = '';
      imgPrev.classList.add('hidden'); imgPrev.src = '#';
      uploadPh.classList.remove('hidden');
      aiLoader.classList.add('hidden');
      currentImageUrl = null;
      imagePanel.style.pointerEvents = 'auto';
    }

    // ---------- Alegra ----------
    async function loadAlegraData() {
      const contactsSnap = await getDocs(query(collection(db, 'alegra_contacts')));
      alegraContactsCache = contactsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const categoriesSnap = await getDocs(query(collection(db, 'alegra_categories')));
      alegraCategoriesCache = categoriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // ---------- Upload + IA ----------
    async function handleFileSelect(e) {
      const file = e.target?.files?.[0];
      if (!file) return;

      uploadPh.classList.add('hidden');
      aiLoader.classList.remove('hidden');
      imagePanel.style.pointerEvents = 'none';

      let parsed = [];

      try {
        // Previsualización (imagen o PDF renderizado)
        let base64, mimeForAI;
        if (file.type === 'application/pdf') {
          showToast('Convirtiendo PDF a imagen…', 'info');
          base64 = await renderPdfToImage(file); // dataURL
          mimeForAI = 'image/jpeg';
        } else {
          base64 = await fileToBase64(file);
          mimeForAI = file.type;
        }
        imgPrev.src = base64; imgPrev.classList.remove('hidden');

        // Subir archivo original a Storage
        currentImageUrl = await uploadFileToStorage(file);

        // Garantiza caches de Alegra
        if (!alegraContactsCache.length || !alegraCategoriesCache.length) {
          await loadAlegraData();
        }

        // IA
        const arr = await getAIData(base64.split(',')[1], mimeForAI);
        if (!Array.isArray(arr) || !arr.length) {
          showToast('No se encontraron transacciones en la imagen.', 'warning');
          resetUI(); return;
        }

        // Dedupe por numero_confirmacion (normalizado, acepta variantes con ceros)
        const result = [];
        for (let i = 0; i < arr.length; i++) {
          const tx = arr[i] || {};
          const n = normalizeConfirmation(tx.numero_confirmacion);
          if (n && await checkConfirmationExists(n)) {
            showToast(`Movimiento #${i + 1} omitido (No. duplicado ${n}).`, 'warning');
            continue;
          }
          tx.numero_confirmacion = n;
          result.push(tx);
        }
        if (!result.length) {
          showToast('Todos los movimientos detectados ya existían.', 'warning');
          resetUI(); return;
        }

        displayTransactionForms(result);
      } catch (err) {
        console.error(err);
        showToast(`Error: ${err.message}`, 'error');
        resetUI();
      } finally {
        aiLoader.classList.add('hidden');
        imagePanel.style.pointerEvents = 'auto';
      }
    }

    async function uploadFileToStorage(file) {
      if (!userId) throw new Error('Usuario no autenticado.');
      const storageRef = ref(storage, `transfer-images/${userId}/${Date.now()}_${file.name}`);
      const up = await uploadBytes(storageRef, file);
      return await getDownloadURL(up.ref);
    }

    async function renderPdfToImage(file) {
      // Carga pdf.js on-demand si no existe
      if (!window.pdfjsLib) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.min.js';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

      const ab = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument(new Uint8Array(ab)).promise;
      const canvases = [];
      let totalH = 0;
      const quality = 1.5;

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 * quality });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        canvases.push(canvas); totalH += canvas.height;
      }
      if (!canvases.length) throw new Error('PDF sin páginas');

      const stitched = document.createElement('canvas');
      stitched.width = canvases[0].width; stitched.height = totalH;
      const ctx = stitched.getContext('2d');
      let y = 0; for (const c of canvases) { ctx.drawImage(c, 0, y); y += c.height; }
      return stitched.toDataURL('image/jpeg', 0.9);
    }

    async function getAIData(base64, mimeType) {
      const apiKey = firebaseConfig.apiKey;
      const apiUrl = buildAiUrl(GEMINI_PRO) + apiKey;
      const prompt = buildAIPrompt(alegraContactsCache, alegraCategoriesCache);
      const payload = {
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }],
        generationConfig: { responseMimeType: 'application/json' }
      };
      const r = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(`Error IA: ${r.statusText}`);
      const j = await r.json();
      try {
        const text = j.candidates[0].content.parts[0].text;
        return JSON.parse(text);
      } catch (e) {
        console.error('Respuesta IA inválida:', j);
        throw new Error('La IA no devolvió JSON válido.');
      }
    }

    // ---------- Render de formularios ----------
    function displayTransactionForms(transactions) {
      txForms.innerHTML = transactions.map((tx, i) => createTransactionFormHTML(tx, i)).join('');

      // auto-grow observaciones
      txForms.querySelectorAll('textarea[name="observaciones"]').forEach(t => {
        autoGrow(t); t.addEventListener('input', () => autoGrow(t));
      });

      // validar fecha
      txForms.querySelectorAll('.date-input').forEach(input => {
        validateDateField({ target: input });
        input.addEventListener('input', validateDateField);
      });

      // cuenta → moneda/símbolo
      txForms.querySelectorAll('.account-select').forEach(sel =>
        sel.addEventListener('change', updateCurrencyFromAccount)
      );

      // submit (guardar)
      txForms.querySelectorAll('form.transaction-card').forEach(form =>
        form.addEventListener('submit', handleSaveSingleTransaction)
      );

      // chips tipo + combobox + confirm duplicado + monto editable
      txForms.querySelectorAll('form.transaction-card').forEach(form => {
        const amount = form.querySelector('.amount-input');
        const symbol = form.querySelector('.currency-symbol');
        const tipoInput = form.querySelector('input[name="tipo"]');

        form.querySelectorAll('.tipo-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const t = btn.dataset.tipo; const isIn = (t === 'in');
            tipoInput.value = t;
            amount.classList.toggle('text-emerald-600', isIn);
            amount.classList.toggle('text-red-600', !isIn);
            symbol.classList.toggle('text-emerald-600', isIn);
            symbol.classList.toggle('text-red-600', !isIn);

            form.querySelectorAll('.tipo-btn').forEach(b => {
              const ent = b.dataset.tipo === 'in';
              b.classList.toggle('bg-emerald-50', ent && isIn);
              b.classList.toggle('text-emerald-700', ent && isIn);
              b.classList.toggle('bg-rose-50', !ent && !isIn);
              b.classList.toggle('text-rose-700', !ent && !isIn);
              if (ent && !isIn) b.classList.remove('bg-emerald-50','text-emerald-700');
              if (!ent && isIn) b.classList.remove('bg-rose-50','text-rose-700');
            });
          });
        });

        attachCombobox(form, { inputName: 'alegraContactName', hiddenName: 'alegraContactId', sourceList: alegraContactsCache });
        attachCombobox(form, { inputName: 'alegraCategoryName', hiddenName: 'alegraCategoryId', sourceList: alegraCategoriesCache });

        const conf = form.querySelector('input[name="numero_confirmacion"]');
        const err  = form.querySelector('.confirmation-error');
        if (conf) {
          const debounce = (fn, ms=350) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; };
          const runCheck = debounce(async () => {
            const val = normalizeConfirmation(conf.value);
            conf.value = val ?? '';
            if (err) { err.classList.add('hidden'); err.textContent=''; }
            if (!val) return;
            if (await checkConfirmationExists(val)) {
              if (err) { err.textContent='Este No. ya existe.'; err.classList.remove('hidden'); }
            }
          }, 350);
          conf.addEventListener('input', runCheck);
          conf.addEventListener('blur', runCheck);
        }

        const input = form.querySelector('.amount-input');
        const hidden = form.querySelector('input[name="cantidad"]');
        const syncHidden = () => { const n = cleanAmount(input.value); hidden.value = (n===null ? '' : n); };

        input.addEventListener('input', () => {
          const caret = input.selectionStart;
          let v = input.value.replace(/[^\d.,-]/g,'');
          input.value = v; syncHidden();
          try { input.setSelectionRange(caret, caret); } catch {}
        });
        input.addEventListener('blur', () => {
          const n = cleanAmount(input.value);
          if (n !== null) { input.value = n.toLocaleString('en-US',{minimumFractionDigits:2}); hidden.value = n; }
          else { input.value = ''; hidden.value = ''; }
        });
        input.addEventListener('focus', () => input.select());
      });

      isDataUnsaved = true;
      goToStep('step-review');
    }

    function createTransactionFormHTML(tx, index) {
      const bankOptions = accountMappingsArray.slice().sort((a,b)=>a.name.localeCompare(b.name))
        .map(acc => `<option value="${acc.id}" ${acc.id==tx.bankAccountId?'selected':''}>${acc.name}</option>`).join('');
      const tipo = (tx.tipo || 'in');
      const isEntrada = tipo === 'in';
      const colorClass = isEntrada ? 'text-emerald-600' : 'text-red-600';
      const fecha = tx.fecha || new Date().toISOString().split('T')[0];
      const currency = (tx.moneda || 'NIO');
      const sym = currency === 'NIO' ? 'C$' : '$';
      const contactName = (tx.alegraContactId && alegraContactsCache.find(x=>String(x.id)===String(tx.alegraContactId)))?.name || '';
      const categoryName = (tx.alegraCategoryId && alegraCategoriesCache.find(x=>String(x.id)===String(tx.alegraCategoryId)))?.name || '';

      return `
      <form id="form-${index}" data-index="${index}" class="transaction-card bg-white rounded-2xl shadow-lg p-6 space-y-4">
        <div class="flex justify-between items-center border-t pt-2">
          <h2 class="text-lg font-semibold text-gray-800">Revisa los Movimientos</h2>
          <button type="button" class="text-sm font-medium text-gray-500 hover:text-red-600 transition" onclick="location.hash='#/caja_historial'">× Cerrar</button>
        </div>

        <div class="text-center my-2 flex items-center justify-center gap-1">
          <span class="currency-symbol ${colorClass} text-4xl">${sym}</span>
          <input type="text" name="cantidad_display"
                 value="${(tx.cantidad ?? 0).toLocaleString('en-US',{minimumFractionDigits:2})}"
                 inputmode="decimal" autocomplete="off"
                 class="amount-input ${colorClass} text-4xl font-bold text-center bg-transparent border-b-2 border-transparent focus:border-emerald-300 outline-none w-[12ch]" />
        </div>

        <div class="flex justify-center">
          <div class="inline-flex rounded-lg overflow-hidden border border-slate-200" role="group">
            <button type="button" class="tipo-btn px-3 py-1 text-sm font-semibold ${isEntrada ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-slate-700'}" data-tipo="in">Entrada</button>
            <button type="button" class="tipo-btn px-3 py-1 text-sm font-semibold ${!isEntrada ? 'bg-rose-50 text-rose-700' : 'bg-white text-slate-700'}" data-tipo="out">Salida</button>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-gray-600">Fecha</label>
          <input type="date" name="fecha" value="${fecha}" required class="date-input w-full mt-1 p-2.5 border border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500" />
          <p class="text-xs text-gray-400 mt-1 hidden field-hint">Se ajusta si supera la fecha actual.</p>
        </div>

        <div>
          <label class="text-sm font-medium text-gray-600">Cuenta Afectada</label>
          <select name="bankAccountId" required class="account-select w-full mt-1 p-2.5 border border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500 bg-white">
            ${bankOptions}
          </select>
          <p class="text-xs text-gray-400 mt-1">La moneda y el símbolo se actualizan según la cuenta.</p>
        </div>

        <div>
          <label class="text-sm font-medium text-gray-600">Contacto</label>
          <div class="relative">
            <input type="text" name="alegraContactName" value="${contactName}" autocomplete="off"
                   class="w-full mt-1 p-2.5 border border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500 combobox-input" placeholder="Buscar contacto…">
            <input type="hidden" name="alegraContactId" value="${tx.alegraContactId || ''}">
            <ul class="cb-list absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto hidden"></ul>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-gray-600">Categoría</label>
          <div class="relative">
            <input type="text" name="alegraCategoryName" value="${categoryName}" autocomplete="off"
                   class="w-full mt-1 p-2.5 border border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500 combobox-input" placeholder="Buscar categoría…">
            <input type="hidden" name="alegraCategoryId" value="${tx.alegraCategoryId || ''}">
            <ul class="cb-list absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto hidden"></ul>
          </div>
        </div>

        <div>
          <label class="text-sm font-medium text-gray-600">Observaciones</label>
          <textarea name="observaciones" rows="2" class="w-full mt-1 p-2.5 border border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500 resize-none" placeholder="Cliente, categoría, concepto, etc.">${tx.observaciones || ''}</textarea>
        </div>

        <div>
          <label class="text-sm font-medium text-gray-600">No. Confirmación</label>
          <input type="text" name="numero_confirmacion" value="${tx.numero_confirmacion || ''}" class="w-full mt-1 p-2.5 border border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
          <p class="form-error confirmation-error text-xs mt-1 hidden"></p>
        </div>

        <input type="hidden" name="cantidad" value="${tx.cantidad ?? ''}">
        <input type="hidden" name="moneda" value="${currency}">
        <input type="hidden" name="tipo" value="${tipo}">

        <div class="pt-2">
          <button type="submit" class="save-btn w-full bg-emerald-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition flex items-center justify-center">
            <span class="material-icons mr-2">check_circle</span>
            Guardar Registro
            <span class="spinner w-5 h-5 border-2 border-white border-t-transparent rounded-full hidden ml-2"></span>
          </button>
        </div>
      </form>`;
    }

    // ---------- Guardado ----------
    async function handleSaveSingleTransaction(ev) {
      ev.preventDefault();
      const form = ev.currentTarget;
      const saveBtn = form.querySelector('.save-btn');
      const spinner = form.querySelector('.spinner');
      const err = form.querySelector('.confirmation-error');

      err?.classList.add('hidden'); if (err) err.textContent = '';
      saveBtn.disabled = true; spinner.classList.remove('hidden');

      try {
        const data = new FormData(form);
        const tx = Object.fromEntries(data.entries());
        tx.numero_confirmacion = normalizeConfirmation(tx.numero_confirmacion);

        const confInput = form.querySelector('input[name="numero_confirmacion"]');
        if (confInput) confInput.value = tx.numero_confirmacion ?? '';

        if (tx.numero_confirmacion && await checkConfirmationExists(tx.numero_confirmacion)) {
          showToast('Registro duplicado.', 'error');
          if (err) { err.textContent = 'Este No. ya existe.'; err.classList.remove('hidden'); }
          return;
        }

        tx.bankAccountId = parseInt(tx.bankAccountId);
        const transferData = createTransactionDataObject(tx);
        if (!transferData.cantidad || !transferData.fecha || !transferData.bankAccountId) {
          showToast('Monto, fecha y cuenta son obligatorios.', 'error'); return;
        }

        await addDoc(collection(db, 'transferencias'), transferData);
        showToast(`Registro guardado.`, 'success');

        form.setAttribute('disabled', true); // marca como completado
        const all = txForms.querySelectorAll('.transaction-card');
        const done = txForms.querySelectorAll('.transaction-card[disabled]');
        if (all.length === done.length) {
          isDataUnsaved = false;
          showToast('¡Todos los registros han sido guardados!', 'success');
          setTimeout(() => { location.hash = '#/caja_historial'; }, 1200);
        }
      } catch (e) {
        showToast(`Error al guardar: ${e.message}`, 'error');
      } finally {
        if (!form.hasAttribute('disabled')) saveBtn.disabled = false;
        spinner.classList.add('hidden');
      }
    }

    function createTransactionDataObject(tx) {
      const bankAccountId = parseInt(tx.bankAccountId);
      const selected = accountMappingsArray.find(acc => acc.id === bankAccountId);
      const obj = {
        fecha: tx.fecha,
        cantidad: cleanAmount(tx.cantidad),
        moneda: tx.moneda,
        tipo: tx.tipo,
        numero_confirmacion: tx.numero_confirmacion?.trim() || null,
        observaciones: tx.observaciones?.trim() || '',
        alegraContactId: tx.alegraContactId || null,
        alegraCategoryId: tx.alegraCategoryId || null,
        bankAccountId: bankAccountId || null,
        banco: selected?.name || 'N/A',
        imageUrl: currentImageUrl,
        status: 'pending_review',
        userId: userId,
        createdAt: serverTimestamp(),
      };
      obj.cantidadNIO = toNio(obj.cantidad, obj.moneda);
      return obj;
    }

    // ---------- Utilidades ----------
    const fileToBase64 = (file) => new Promise((res, rej) => {
      const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsDataURL(file);
    });
    function cleanAmount(amount) {
      if (amount === null || amount === undefined) return null;
      let s = String(amount).replace(/[^\d,.]/g,'');
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) { s = s.replace(/\./g,'').replace(',','.'); }
      else { s = s.replace(/,/g,''); }
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    }
    function normalizeConfirmation(s){
      if (!s) return null;
      const n = String(s).replace(/\D/g,'').replace(/^0+/, '');
      return n || null;
    }
    async function checkConfirmationExists(number) {
      const normalized = normalizeConfirmation(number);
      if (!normalized) return false;
      const variants = [normalized];
      for (let i=1; i<=9; i++) variants.push('0'.repeat(i)+normalized);
      try {
        const qy = query(collection(db,'transferencias'), where('numero_confirmacion','in', variants));
        const snap = await getDocs(qy);
        return !snap.empty;
      } catch(e){ console.warn('checkConfirmationExists:', e); return false; }
    }
    function autoGrow(el){ el.style.height='auto'; el.style.height=(el.scrollHeight)+'px'; }
    function validateDateField(ev) {
      const input = ev.target;
      const d = new Date(input.value+'T00:00:00'); if (isNaN(d)) return;
      const today = new Date(); today.setHours(0,0,0,0);
      const seven = new Date(); seven.setDate(today.getDate()-7); seven.setHours(0,0,0,0);
      input.classList.remove('bg-yellow-100','border-yellow-400','bg-red-100','border-red-400');
      if (d > today || d.getFullYear() < today.getFullYear()) input.classList.add('bg-red-100','border-red-400');
      else if (d < seven) input.classList.add('bg-yellow-100','border-yellow-400');
    }
    function updateCurrencyFromAccount(ev) {
      const sel = ev.target;
      const form = sel.closest('form.transaction-card');
      const id = parseInt(sel.value);
      const acc = accountMappingsArray.find(a => a.id === id); if (!acc) return;
      const currency = acc.moneda;
      form.querySelector('input[name="moneda"]').value = currency;
      form.querySelector('.currency-symbol').textContent = currency === 'NIO' ? 'C$' : '$';
    }
    function norm(s){ return (s||'').toString().normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase(); }
    function attachCombobox(form, { inputName, hiddenName, sourceList }) {
      const input = form.querySelector(`input[name="${inputName}"]`);
      const hidden = form.querySelector(`input[name="${hiddenName}"]`);
      const listEl = input?.parentElement?.querySelector('.cb-list');
      if (!input || !hidden || !listEl) return;
      let filtered = []; let active = -1;
      const closeList = ()=>{ listEl.classList.add('hidden'); input.setAttribute('aria-expanded','false'); active = -1; };
      const openList  = ()=>{ if (!filtered.length) return closeList(); listEl.classList.remove('hidden'); input.setAttribute('aria-expanded','true'); };
      const render = items => { listEl.innerHTML = items.map((it,i)=>`
        <li role="option" data-id="${it.id}" data-name="${it.name}" class="px-3 py-2 cursor-pointer hover:bg-emerald-50 ${i===active?'bg-emerald-50':''}">
          ${it.name}
        </li>`).join(''); };
      const selectItem = it => { input.value = it.name; hidden.value = it.id; closeList(); };
      const recompute = ()=>{ const q = norm(input.value); filtered = q ? sourceList.filter(x=>norm(x.name).includes(q)) : sourceList.slice(0,50); filtered = filtered.slice(0,50); active=-1; render(filtered); openList(); };

      input.addEventListener('input', ()=>{ hidden.value=''; recompute(); });
      input.addEventListener('focus', ()=>{ if (input.value) recompute(); });
      input.addEventListener('keydown', (e)=>{
        if (listEl.classList.contains('hidden')) return;
        if (e.key==='ArrowDown'){ e.preventDefault(); active=Math.min(active+1, filtered.length-1); render(filtered); }
        else if (e.key==='ArrowUp'){ e.preventDefault(); active=Math.max(active-1,0); render(filtered); }
        else if (e.key==='Enter'){ e.preventDefault(); if (active>=0 && filtered[active]) selectItem(filtered[active]); }
        else if (e.key==='Escape'){ e.preventDefault(); closeList(); }
      });
      listEl.addEventListener('mousedown', (e)=>{ const li = e.target.closest('li[role="option"]'); if (!li) return; selectItem({ id: li.dataset.id, name: li.dataset.name }); });
      document.addEventListener('mousedown', (e)=>{ if (!form.contains(e.target)) closeList(); });
    }

    // ---------- Prompt IA (idéntico a tu HTML) ----------
    function buildAIPrompt(contacts, categories) {
      const formatList = (items) => items.map(item => `- ID: ${item.id}, Nombre: ${item.name}`).join('\n') || 'Ninguno disponible';
      const contactList = formatList(contacts);
      const categoryList = formatList(categories);

    return `
        Eres un asistente experto en contabilidad. Tu tarea es analizar la imagen de un documento financiero y extraer TODAS las transacciones visibles en un ARRAY de objetos JSON. Sigue rigurosamente las reglas y el proceso de decisión demostrado en los ejemplos.

        Responde únicamente con el array JSON. Si no encuentras transacciones, devuelve un array vacío [].

        ### Contexto Dinámico (Proporcionado por el sistema)
        - Lista de Contactos de Alegra:
        ${contactList}
        - Lista de Categorías de Alegra:
        ${categoryList}

### Regla 0 (máxima prioridad): Estado de cuenta con columnas
Detecta si la imagen corresponde a un **estado de cuenta**. Suele incluir en el encabezado (en lista o bloque) datos como **Cliente, Nro de cuenta, Tipo de cuenta, Banco, Moneda** y una **tabla de movimientos** con columnas similares a:
**Fecha, Número de confirmación, Descripción, Débito, Crédito, Saldo, Referencia, Tipo de movimiento** (pueden variar en mayúsculas/acentos/sinónimos p. ej. Debit/Credit/Balance).

Para cada fila de la tabla:
- Si hay valor en **Crédito** → **"tipo":"in"** y **"cantidad"** = valor de **Crédito**.
- Si hay valor en **Débito** → **"tipo":"out"** y **"cantidad"** = valor de **Débito**.
- Si excepcionalmente ambas tienen valor, decide por variación de **Saldo** (si aumenta → "in"; si disminuye → "out").
- **Este criterio sobrescribe cualquier otra regla** (texto “Pago”, “Depósito”, “Originador”, etc.). **La columna manda**.
- **Moneda**: por defecto, usa la del encabezado del estado de cuenta (p. ej., “Moneda NIO”) para todas las filas, salvo evidencia contraria en la fila.
- **bankAccountId**: por defecto, toma del **Nro de cuenta** del encabezado (últimos dígitos) y mapea:
  - Terminación **0009** → bankAccountId: **2**
  - Terminación **0339** → bankAccountId: **5**
  - Terminación **0015** → bankAccountId: **4**
- **Fecha**: usa la de la columna **Fecha**, en formato **YYYY-MM-DD** (normaliza “27/08/2025”, “27 AGO 2025”, etc.).
- **numero_confirmacion**: toma la columna **Número de confirmación**; normaliza a **solo dígitos**, sin ceros a la izquierda; si queda vacío, usa **null**.
- **observaciones**: usa la **Descripción**; si existen **Referencia** y/o **Tipo de movimiento**, concatena:  
  \`"Descripción | Referencia: X | Tipo: Y"\`
- **Normaliza números**: elimina separadores de miles (puntos o comas) y usa **punto** como separador decimal en **cantidad**.

---


Ejemplo EC — Estado de cuenta (Crédito y Débito)

Contexto detectado: Estado de cuenta con columnas (Fecha, Número de confirmación, Descripción, Débito, Crédito, Saldo, Referencia, Tipo de movimiento).
Encabezado: Moneda NIO y cuenta terminación 0009 ⇒ bankAccountId: 2.
Regla aplicada: La columna manda → Crédito ⇒ tipo:"in", Débito ⇒ tipo:"out".
(Si ambas columnas tuvieran valor, decidir por variación de Saldo: aumenta ⇒ in, disminuye ⇒ out.)

Fila 1 — Crédito ⇒ in

Valores leídos (OCR):

Fecha: 03/SEP/2025

Nº confirmación: 106328334

Descripción: Transferencia entre cuentas

Débito: (vacío)

Crédito: 5,360.00

Saldo: 2,572,479.49

Referencia: TB

Proceso de decisión (campo por campo):

tipo: Hay importe en Crédito ⇒ in (columna manda).

fecha: Normalizar a ISO YYYY-MM-DD → 2025-09-03.

bankAccountId: Tomar del encabezado por terminación 0009 → 2.

numero_confirmacion: Normalizar a solo dígitos (sin letras/espacios/símbolos y sin ceros a la izquierda) → "106328334".

cantidad: Tomar exactamente el valor de Crédito; eliminar separadores de miles y usar punto como decimal → 5360.00.

moneda: Del encabezado → "NIO".

observaciones: Usar Descripción y, si existe, añadir Referencia → "Transferencia entre cuentas | Referencia: TB".

JSON (fila 1):

{
  "tipo": "in",
  "fecha": "2025-09-03",
  "bankAccountId": 2,
  "numero_confirmacion": "106328334",
  "cantidad": 5360.00,
  "moneda": "NIO",
  "observaciones": "Transferencia entre cuentas | Referencia: TB",
  "alegraContactId": null,
  "alegraCategoryId": null
}

Fila 2 — Débito ⇒ out

Valores leídos (OCR):

Fecha: 03/SEP/2025

Nº confirmación: 35026492

Descripción: PAGO MATERIALES - MARYIN URBINA

Débito: (vacío)

Crédito: 19,805.00

Saldo: 2,567,119.49

Referencia: A3

Proceso de decisión (campo por campo):

tipo: Hay importe en Débito ⇒ out (columna manda).

fecha: Normalizar a 2025-09-03.

bankAccountId: Del encabezado por terminación 0009 → 2.

numero_confirmacion: Normalizar a solo dígitos y sin ceros a la izquierda → "35026492".

cantidad: Tomar el valor de Débito; quitar miles y usar punto decimal → 19805.00.

moneda: Del encabezado → "NIO".

observaciones: Descripción + Referencia → "PAGO MATERIALES - MARYIN URBINA | Referencia: A3".

JSON (fila 2):

{
  "tipo": "in",
  "fecha": "2025-09-03",
  "bankAccountId": 2,
  "numero_confirmacion": "35026492",
  "cantidad": 19805.00,
  "moneda": "NIO",
  "observaciones": "PAGO MATERIALES - MARYIN URBINA | Referencia: A3",
  "alegraContactId": null,
  "alegraCategoryId": null
}

Si **NO** es un estado de cuenta con columnas (comprobantes, tickets, vouchers, remesas, recibos, etc.), aplica las **Reglas Generales**:


        ### 1. Reglas Generales de Procesamiento
        Estas son las reglas de alta prioridad que debes aplicar en todos los casos.

        #### Reglas para bankAccountId
        - **Prioridad 1 (Número explícito):** Asigna el ID basándote en los últimos dígitos del número de cuenta de la transacción. Para egresos (out), la cuenta a analizar es la de origen; para ingresos (in), es la de destino.
            - Terminación 0339 -> bankAccountId: 5
            - Terminación 0015 -> bankAccountId: 4
            - Terminación 5763 -> bankAccountId: 11
            - Terminación 0009 -> bankAccountId: 2
            - Terminación 2433 o 433 -> bankAccountId: 15
        - **Prioridad 2 (Inferencia):** Si el número de cuenta no está visible, infiere el ID a partir de la combinación Banco + Moneda.
        - **Por defecto:** Si no se puede determinar la cuenta, asigna null.

        #### Reglas para tipo ("in" o "out")
        - **Será 'out' (Egreso) si:**
            - El 'Usuario originador' es EUGENIO FLORES VALDEZ o CARLOS EUGENIO FLORES.
            - Un comprobante de POS muestra 'SPRV: EUGENIO FLORES VALDEZ', indicando un depósito a una cuenta externa.
            - El monto de la transacción es un número negativo (ej: -250.00).
        - **Será 'in' (Ingreso) en todos los demás casos, incluyendo:**
            - Si el 'Usuario originador' o 'SENDER' es un tercero.
            - Si el 'Destinatario' o 'BENEFICIARIO' somos nosotros.
            - Si el comprobante contiene frases como 'Depósito', 'Acreditado en' o 'Ver depositante'.

        #### Reglas para numero_confirmacion
        - El valor debe ser una cadena de texto conteniendo únicamente los dígitos numéricos. Elimina letras, espacios, ceros a la izquierda y símbolos como #.
        - **Regla Especial ACH:** Si el comprobante indica explícitamente 'Transferencia ACH', el numero_confirmacion siempre debe ser null.
        - **Prioridad por tipo de comprobante:**
            - POS: Usa el 'No. Aprobacion'.
            - Remesa: Usa el 'Ria PIN No.' o 'Clave Ria'.
            - ATM: Usa el 'AUTORIZACION'.

        ---
        ### 2. Ejemplos Guiados y Proceso de Decisión
        A continuación se presentan ejemplos clave. Úsalos para entender cómo aplicar las reglas a diferentes formatos. Para cada transacción, sigue un proceso de decisión similar.

        **Ejemplo A: Egreso - Pago de Servicios (Lafise)**
        -   **Proceso de Decisión:**
            1.  Analizar tipo: El 'Usuario originador' es EUGENIO FLORES VALDEZ. Decisión: Se aplica la regla de egreso, asignando "out".
            2.  Analizar fecha: Se extrae '30/JUL/2025' de 'Fecha de finalización'. Decisión: Se formatea como "2025-07-30".
            3.  Analizar bankAccountId: Por ser un egreso, se usa la 'Cuenta a utilizar', que termina en 0009. Decisión: Corresponde al ID 2.
            4.  Analizar numero_confirmacion: Se toma el 'Número de referencia'. Decisión: "102492671".
            5.  Analizar cantidad y moneda: Se extraen los valores del 'Monto'. Decisión: 1433.90 y "NIO".
            6.  Analizar observaciones: Se combina el 'Servicio' y el concepto del pago. Decisión: "Pago de servicio a Nicaragua-Dissur Nis. Concepto: luz managua.".
        -   **JSON Final:**
            \`\`\`json
            [
                {"tipo":"out", "fecha":"2025-07-30", "bankAccountId":2, "numero_confirmacion":"102492671", "cantidad":1433.90, "moneda":"NIO", "observaciones":"Pago de servicio a Nicaragua-Dissur Nis. Concepto: luz managua.", "alegraContactId": null, "alegraCategoryId": null}
            ]
            \`\`\`

        **Ejemplo B: Egreso - Depósito en POS a Tercero (Banpro)**
        -   **Proceso de Decisión:**
            1.  Analizar tipo: 'SPRV.' es nuestro nombre y 'DEPOSITO A NO CTA' indica un destino externo. Decisión: Es un egreso, se asigna "out".
            2.  Analizar fecha: Se extrae la fecha '2025-08-09'. Decisión: "2025-08-09".
            3.  Analizar bankAccountId: La cuenta de origen no se especifica. Decisión: null.
            4.  Analizar numero_confirmacion: Se prioriza 'No. Aprobacion' y se limpia. Decisión: "255055198".
            5.  Analizar cantidad y moneda: Se extraen los valores del 'MONTO'. Decisión: 137261.92 y "NIO".
            6.  Analizar observaciones: Se combina el gestor, el agente y la cuenta de destino externa. Decisión: "Pago/Depósito a cuenta externa ...095670. Gestor: JAVIER AUIL LOPEZ PRO VIA. Agente: FERRETERIA FLORES 2 SIU (Banpro).".
        -   **JSON Final:**
            \`\`\`json
            [
                {"tipo":"out", "fecha":"2025-08-09", "bankAccountId":null, "numero_confirmacion":"255055198", "cantidad":137261.92, "moneda":"NIO", "observaciones":"Pago/Depósito a cuenta externa ...095670. Gestor: JAVIER AUIL LOPEZ PRO VIA. Agente: FERRETERIA FLORES 2 SIU (Banpro).", "alegraContactId": null, "alegraCategoryId": null}
            ]
            \`\`\`

        **Ejemplo D: Ingreso - Remesa Internacional (Ria)**
        -   **Proceso de Decisión:**
            1.  Analizar tipo: El 'SENDER' es un tercero. Decisión: Es un ingreso, se asigna "in".
            2.  Analizar fecha: Se prioriza la 'Date Available' sobre la fecha de orden. Decisión: "2025-08-18".
            3.  Analizar bankAccountId: El 'PAYING AGENT Account' termina en 0015. Decisión: Corresponde al ID 4.
            4.  Analizar numero_confirmacion: Se prioriza el 'Ria PIN No.' como identificador principal. Decisión: "12410803284".
            5.  Analizar cantidad y moneda: Se usa el 'Total to Recipient', no el total cobrado. Decisión: 328.00 y "USD".
            6.  Analizar observaciones: Se combina el nombre del remitente y el servicio. Decisión: "Remitente: GAMALIEL BENAVIDEZ LEIVA. Servicio: Ria.".
        -   **JSON Final:**
            \`\`\`json
            [
                {"tipo":"in", "fecha":"2025-08-18", "bankAccountId":4, "numero_confirmacion":"12410803284", "cantidad":328.00, "moneda":"USD", "observaciones":"Remitente: GAMALIEL BENAVIDEZ LEIVA. Servicio: Ria.", "alegraContactId": null, "alegraCategoryId": null}
            ]
            \`\`\`

        **Ejemplo G: Ingreso - Transferencia de Tercero (BAC)**
        -   **Proceso de Decisión:**
            1.  Analizar tipo: La 'Cuenta origen' pertenece a un tercero. Decisión: Es un ingreso, se asigna "in".
            2.  Analizar fecha: Se extrae '27 agosto'. Decisión: "2025-08-27".
            3.  Analizar bankAccountId: La 'Cuenta destino' termina en 2433. Decisión: Corresponde al ID 15.
            4.  Analizar numero_confirmacion: Se toma el 'Nº comprobante'. Decisión: "301450930".
            5.  Analizar observaciones: Se usa el nombre del titular de la cuenta origen. Decisión: "Transferencia desde BAC de WILMER ALBERTO BLANDON BARRERA.".
        -   **JSON Final:**
            \`\`\`json
            [
                {"tipo":"in", "fecha":"2025-08-27", "bankAccountId":15, "numero_confirmacion":"301450930", "cantidad":525.00, "moneda":"NIO", "observaciones":"Transferencia desde BAC de WILMER ALBERTO BLANDON BARRERA.", "alegraContactId": null, "alegraCategoryId": null}
            ]
            \`\`\`

        Ahora, analiza la siguiente imagen y proporciona el resultado JSON.`;
    }
  },

  unmount() {
    // No subscriptions in this module (todo está atado al DOM local)
  }
};
