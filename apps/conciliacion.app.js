// apps/conciliacion.app.js
import { ensureCDNs, readAnyTable, detectSourceType } from './lib/recon_utils.js';
import { normalizeAndFilterAlegra, normalizeBanco } from './lib/recon_parser.js';
import { buildIndexes, candidatesForBankRow } from './lib/recon_matcher.js';
import { DATE_WINDOW } from './lib/recon_config.js';
import { bankSignature, masterBulkHas, masterSave, masterGetAll, masterImportEntries } from './lib/recon_master.js';
import { loadSession, saveSession, saveParsedTables, loadParsedTables, savePrefs, loadPrefs } from './lib/recon_storage.js';
import { clearCache } from './lib/mapping_cache.js'; // opcional si usás asociaciones aquí después
import { toCSV, downloadText } from './lib/export_utils.js';

function normalizeSession(s) {
  return {
    matches: (s && s.matches) ? s.matches : {},
    onlyPend: !!(s && s.onlyPend),
  };
}

export default {
  title: 'Conciliación Alegra ↔ Bancos',
  async mount(container, { appState, params }) {
    container.innerHTML = layout();

    const ui = getRefs(container);
    let cuentasArray = [];       // [{id, nombre}]
    let alegraRows = [];         // raw
    let bancoRows = [];          // raw
    let A = [];                  // Alegra normalizada y filtrada
    let B = [];                  // Banco normalizado
    let idx = null;              // índices de Alegra
    let periodo = { desde: null, hasta: null };
    let session = normalizeSession({}); // { [bankId]: { alegraIds:[], tier, suma, err } }
    let activeBid = null;

    // Cargar librerías
    await ensureCDNs();

    // Restaurar preferencias
    const prefs = loadPrefs();
    if (prefs?.cuentaId) ui.cuenta.value = String(prefs.cuentaId);
    if (prefs?.tc) ui.tc.value = String(prefs.tc);
    if (ui.chkOnlyPend) ui.chkOnlyPend.checked = !!prefs.onlyPend;
    // Intento de warm start (si existe cache para el último periodo usado)
    await warmStartFromCache();

    // Cargar catálogo de cuentas de manera fija por ahora
    const accountMappingsArray = [
      { id: 5,  name: "Ahorro Dólares CEF",              color: "#388E3C", moneda: "USD" },
      { id: 4,  name: "Ahorro Dólares EFV",              color: "#388E3C", moneda: "USD" },
      { id: 12, name: "Banpro ahorro",                    color: "#6EA8FE", moneda: "NIO" },
      { id: 11, name: "Banpro Comercial",                 color: "#6EA8FE", moneda: "NIO" },
      { id: 14, name: "Caja Bodegón",                     color: "#81C784", moneda: "NIO" },
      { id: 1,  name: "Caja central",                     color: "#2196F3", moneda: "NIO" },
      { id: 10, name: "Caja Coperna",                     color: "#4CAF50", moneda: "NIO" },
      { id: 6,  name: "Caja Principal",                   color: "#1976D2", moneda: "NIO" },
      { id: 8,  name: "Caja Sucursal",                    color: "#FFC107", moneda: "NIO" },
      { id: 9,  name: "Caja Uge",                         color: "#FF9800", moneda: "NIO" },
      { id: 7,  name: "Comodín",                          color: "#9E9E9E", moneda: "NIO" },
      { id: 2,  name: "Cuenta corriente Bancentro",       color: "#388E3C", moneda: "NIO" },
      { id: 13, name: "Efectivo POS - Terminal Coperna",  color: "#795548", moneda: "NIO" },
      { id: 3,  name: "Tarjeta de crédito 1",             color: "#388E3C", moneda: "NIO" },
      { id: 15, name: "BAC córdobas",                     color: "#D32F2F", moneda: "NIO" }
    ];

    // Adaptar a lo que espera el parser: {id, nombre}
    cuentasArray = accountMappingsArray.map(a => ({ id: a.id, nombre: a.name, moneda: a.moneda, color: a.color }));

    // Handlers UI
    ui.tc.addEventListener('input', () => dirtyParamsBanner(ui));
    ui.cuenta.addEventListener('change', () => {
      dirtyParamsBanner(ui);
      maybeEnableProcess();
    });

    ui.btnAlegra.addEventListener('change', async (e) => {
      alegraRows = await readAnyTable(e.target.files[0]);
      ui.badgeAlegra.textContent = `${alegraRows.length} filas`;
      ui.btnAlegra.classList.add('bg-green-50');
      maybeEnableProcess();
    });

    ui.btnBanco.addEventListener('change', async (e) => {
      bancoRows = await readAnyTable(e.target.files[0]);
      ui.badgeBanco.textContent = `${bancoRows.length} filas`;
      ui.btnBanco.classList.add('bg-green-50');
      maybeEnableProcess();
    });

    ui.btnProcesar.addEventListener('click', async () => {
      // opcional: clear cache de asociaciones si tu flujo lo usa
      try { clearCache?.(); } catch {}
      const cuentaId = Number(ui.cuenta.value);
      const tc = Number(ui.tc.value || '1');

      // --- Autodetección y swap si el usuario cruzó los archivos
      try {
        const tA = detectSourceType(alegraRows);
        const tB = detectSourceType(bancoRows);
        if (tA === 'banco' && tB === 'alegra') {
          [alegraRows, bancoRows] = [bancoRows, alegraRows];
          console.warn('Archivos cruzados detectados: A↔B intercambiados automáticamente');
        }
      } catch (e) { console.warn('detectSourceType falló o no concluyente', e); }

      // 2) Normalización y filtrado
      // Normaliza y filtra Alegra (solo conciliables y SOLO cuenta seleccionada)
      A = normalizeAndFilterAlegra(alegraRows, cuentasArray, cuentaId);
      // Normaliza Banco con TC global
      const Bpack = normalizeBanco(bancoRows, { cuentaId, tipoCambio: tc });
      B = Bpack.rows; periodo = { desde: Bpack.desde, hasta: Bpack.hasta };
      window.__periodo = periodo;

      idx = buildIndexes(A);
      // Restaurar sesión
      session = normalizeSession(
        loadSession({ cuentaId, desdeISO: periodo.desde, hastaISO: periodo.hasta }) || {}
      );

      // Marcar conciliados ya guardados en MASTER
      const sigs = B.map(b => bankSignature(b));
      const hasMap = await masterBulkHas(sigs);
      B = B.map((b, i) => ({ ...b, inMaster: !!hasMap.get(sigs[i]), _sig: sigs[i] }));
      renderLeftList(B, ui, session);
      ui.panelInfo.textContent = `Alegra (filtrada): ${A.length} • Banco: ${B.length} • Periodo ${periodo.desde || '?'} a ${periodo.hasta || '?'}`;
      ui.paramsBanner.classList.add('hidden');

      // Persistir tablas y preferencias (guardar último período para warm start)
      savePrefs({ cuentaId, tc, onlyPend: !!ui.chkOnlyPend?.checked, lastPeriodo: periodo });
      try {
        await saveParsedTables({ cuentaId, desdeISO: periodo.desde, hastaISO: periodo.hasta, alegraRows, bancoRows });
      } catch (e) { console.warn('saveParsedTables error', e); }
    });

    // ====== Export/Import Master ======
    ui.btnExportJSON.onclick = async () => {
      const arr = await masterGetAll();
      const text = JSON.stringify(arr, null, 2);
      downloadText(`master-${new Date().toISOString().slice(0,10)}.json`, text, 'application/json');
    };
    ui.btnExportCSV.onclick = async () => {
      const arr = await masterGetAll();
      const csv = toCSV(arr);
      downloadText(`master-${new Date().toISOString().slice(0,10)}.csv`, csv, 'text/csv;charset=utf-8');
    };
    ui.btnImport.onclick = () => ui.fileImport.click();
    ui.fileImport.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        let result = { inserted: 0, updated: 0, skipped: 0, total: 0 };
        const onProgress = ({ processed, total }) => {
          ui.masterStatus.textContent = `Importando ${processed}/${total}...`;
        };
        if (/\.(json)$/i.test(f.name)) {
          const data = JSON.parse(text);
          const entries = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
          result = await masterImportEntries(entries, { mode: 'keep', onProgress });
        } else {
          await ensureCDNs(); // PapaParse
          const parsed = window.Papa.parse(text, { header: true, skipEmptyLines: true });
          const rows = parsed?.data || [];
          // mapear columnas esperadas: sig, cuentaId, fecha, signo, nroConfirm, montoNio, descripcion, alegraIds, meta
          const entries = rows.map(r => ({
            sig: r.sig || null,
            cuentaId: r.cuentaId,
            fecha: r.fecha,
            signo: r.signo,
            nroConfirm: r.nroConfirm ?? r.numeroConfirmacion,
            montoNio: r.montoNio,
            descripcion: r.descripcion,
            alegraIds: r.alegraIds,          // puede venir "a|b|c"
            meta: r.meta                     // puede venir como JSON string
          }));
          result = await masterImportEntries(entries, { mode: 'keep', onProgress });
        }
        ui.masterStatus.textContent = `Importados: ${result.inserted}, actualizados: ${result.updated}, omitidos: ${result.skipped}`;
        // refrescar banderas inMaster si ya hay B
        if (B?.length) {
          const sigs = B.map(b => b._sig || bankSignature(b));
          const hasMap = await masterBulkHas(sigs);
          B = B.map((b, i) => ({ ...b, inMaster: !!hasMap.get(sigs[i]), _sig: sigs[i] }));
          renderLeftList(B, ui, session);
          if (activeBid) selectBankRow(activeBid);
        }
      } catch (err) {
        console.error('Import error', err);
        ui.masterStatus.textContent = 'Error al importar (ver consola).';
      } finally {
        e.target.value = ''; // reset input
      }
    });

    // Selección en lista Banco
    container.addEventListener('click', (ev) => {
      const li = ev.target.closest('[data-bid]');
      if (!li) return;
      selectBankRow(li.dataset.bid);
    });

    // Navegación por teclado
    container.addEventListener('keydown', (ev) => {
      const list = [...container.querySelectorAll('[data-bid]')];
      const active = container.querySelector('[data-bid].ring-2');
      if (!list.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        const idxA = active ? list.findIndex(x => x === active) : -1;
        const next = ev.key === 'ArrowDown' ? Math.min(idxA + 1, list.length - 1) : Math.max(idxA - 1, 0);
        list.forEach(x => x.classList.remove('ring-2','ring-blue-500'));
        list[next].classList.add('ring-2','ring-blue-500');
        selectBankRow(list[next].dataset.bid);
      } else if (ev.key === 'Enter' && activeBid) {
        // Fijar el primer candidato visible (por firma del grupo)
        const node = container.querySelector('#cands [data-cand-key]');
        if (node) {
          const key = node.getAttribute('data-cand-key');
          fixCandidate(activeBid, key);
        }
      } else if (ev.key === 'j' || ev.key === 'k') {
        const dir = ev.key === 'j' ? 'ArrowDown' : 'ArrowUp';
        const e = new KeyboardEvent('keydown', { key: dir });
        container.dispatchEvent(e);
      }
    });

    function selectBankRow(bid) {
      const b = B.find(x => x.id === bid);
      if (!b || !idx) return;
      activeBid = bid;
      const cuentaId = Number(ui.cuenta.value);
      const cands = candidatesForBankRow(b, idx, { cuentaId, dateWindow: DATE_WINDOW });
      renderRightPanel(b, cands, ui, session, (candKey) => fixCandidate(bid, candKey));
      // marca selección visual
      container.querySelectorAll('[data-bid]').forEach(x => x.classList.remove('bg-blue-50','ring-2','ring-blue-500'));
      const node = container.querySelector(`[data-bid="${bid}"]`);
      if (node) node.classList.add('bg-blue-50','ring-2','ring-blue-500');
    }

    function maybeEnableProcess() {
      ui.btnProcesar.disabled = !(alegraRows.length && bancoRows.length && ui.cuenta.value);
    }

    // ===== Warm start: intenta cargar tablas parseadas desde IndexedDB =====
    async function warmStartFromCache() {
      try {
        const p = loadPrefs() || {};
        const cuentaId = Number(ui.cuenta.value || p.cuentaId || 0);
        const desdeISO = p?.lastPeriodo?.desde || null;
        const hastaISO = p?.lastPeriodo?.hasta || null;
        if (!cuentaId || !desdeISO || !hastaISO) return; // no hay claves suficientes
        const cached = await loadParsedTables({ cuentaId, desdeISO, hastaISO });
        if (!cached) return;
        alegraRows = Array.isArray(cached.alegraRows) ? cached.alegraRows : [];
        bancoRows  = Array.isArray(cached.bancoRows)  ? cached.bancoRows  : [];
        if (!alegraRows.length || !bancoRows.length) return;
        // Marcar UI como "cargado desde cache"
        ui.badgeAlegra.textContent = `${alegraRows.length} filas (cache)`;
        ui.badgeBanco.textContent  = `${bancoRows.length} filas (cache)`;
        ui.btnAlegra.classList.add('bg-green-50');
        ui.btnBanco.classList.add('bg-green-50');
        maybeEnableProcess();
      } catch (err) {
        console.warn('warmStartFromCache error', err);
      }
    }

    async function fixCandidate(bid, candKey) {
      const b = B.find(x => x.id === bid);
      if (!b) return;
      const cuentaId = Number(ui.cuenta.value);
      const cands = candidatesForBankRow(b, idx, { cuentaId, dateWindow: DATE_WINDOW });
      // localizar por firma de grupo para ser estable con/ sin filtro
      const sig = (g) => g.map(x => x.id).sort().join('|');
      const chosen = cands.find(c => sig(c.group) === String(candKey)) || cands[0];
      if (!chosen) return;
      session.matches = session.matches || {};
      session.matches[bid] = {
        alegraIds: chosen.group.map(a => a.id),
        tier: chosen.tier,
        suma: chosen.suma,
        err: chosen.err
      };
      saveSession({ cuentaId, desdeISO: periodo.desde, hastaISO: periodo.hasta }, normalizeSession(session));

      // Guardar en MASTER (DB separada)
      try {
        await masterSave({
          bankRow: b,
          alegraIds: chosen.group.map(a => a.id),
          meta: { tiers: chosen.tiers ? Array.from(chosen.tiers) : [chosen.tier], suma: chosen.suma, err: chosen.err }
        });
        b.inMaster = true;
      } catch (e) { console.warn('masterSave error', e); }

      // refrescar UI izquierda y derecha
      renderLeftList(B, ui, session);
      selectBankRow(bid);
    }
  }
};

// ==== UI helpers ====
function layout() {
  return `
  <div class="p-3 space-y-3">
    <div class="flex items-end gap-3">
      <div>
        <label class="block text-sm font-medium">Cuenta banco</label>
        <select id="cuenta" class="border rounded px-2 py-1">
          <option value="">—</option>
          <option value="2">2</option>
          <option value="4">4</option>
          <option value="5">5</option>
          <option value="11">11</option>
          <option value="15">15</option>
        </select>
      </div>
      <div>
        <label class="block text-sm font-medium">Tipo de cambio (TC)</label>
        <input id="tc" type="number" step="0.01" value="1" class="border rounded px-2 py-1 w-28" />
      </div>
      <div class="flex items-center gap-2">
        <label class="block text-sm font-medium">Alegra</label>
        <input id="btnAlegra" type="file" accept=".csv,.xls,.xlsx" class="border rounded px-2 py-1" />
        <span id="badgeAlegra" class="text-xs text-gray-500"></span>
      </div>
      <div class="flex items-center gap-2">
        <label class="block text-sm font-medium">Banco</label>
        <input id="btnBanco" type="file" accept=".csv,.xls,.xlsx" class="border rounded px-2 py-1" />
        <span id="badgeBanco" class="text-xs text-gray-500"></span>
      </div>
      <button id="btnProcesar" class="ml-auto bg-blue-600 text-white px-3 py-2 rounded disabled:opacity-50" disabled>Procesar</button>
    </div>

    <div id="paramsBanner" class="hidden bg-amber-50 border border-amber-200 text-amber-700 px-3 py-2 rounded">Parámetros cambiaron. <button class="underline">Recalcular</button></div>
    <div id="panelInfo" class="text-sm text-gray-600">—</div>

    <div class="flex items-center gap-3">
      <label class="inline-flex items-center gap-2 text-sm">
        <input id="chkOnlyPend" type="checkbox" class="accent-blue-600">
        Mostrar solo pendientes
      </label>
      <label class="inline-flex items-center gap-2 text-sm">
        <input id="chkHideMaster" type="checkbox" class="accent-blue-600" checked>
        Excluir conciliados (master)
      </label>
      <div class="ml-auto flex items-center gap-2">
        <button id="btnExportJSON" class="px-2 py-1 text-xs bg-slate-100 border rounded">Export JSON</button>
        <button id="btnExportCSV" class="px-2 py-1 text-xs bg-slate-100 border rounded">Export CSV</button>
        <button id="btnImport" class="px-2 py-1 text-xs bg-slate-100 border rounded">Importar</button>
        <input id="fileImport" type="file" accept=".json,.csv" class="hidden" />
        <span id="masterStatus" class="text-xs text-gray-600"></span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <div class="text-sm font-semibold mb-1">Banco (160/mes aprox.)</div>
        <ul id="bankList" class="border rounded divide-y max-h-[70vh] overflow-auto"></ul>
      </div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <div class="text-sm font-semibold">Candidatos Alegra (T1→T3)</div>
          <label class="text-xs flex items-center gap-1">
            <input id="chkAllCands" type="checkbox" class="accent-blue-600">
            Ver todos
          </label>
        </div>
        <div id="cands" class="border rounded max-h-[70vh] overflow-auto p-2 text-sm"></div>
      </div>
    </div>
  </div>`;
}

function getRefs(root) {
  return {
    cuenta: root.querySelector('#cuenta'),
    tc: root.querySelector('#tc'),
    btnAlegra: root.querySelector('#btnAlegra'),
    btnBanco: root.querySelector('#btnBanco'),
    btnProcesar: root.querySelector('#btnProcesar'),
    badgeAlegra: root.querySelector('#badgeAlegra'),
    badgeBanco: root.querySelector('#badgeBanco'),
    bankList: root.querySelector('#bankList'),
    cands: root.querySelector('#cands'),
    chkAllCands: root.querySelector('#chkAllCands'),
    panelInfo: root.querySelector('#panelInfo'),
    paramsBanner: root.querySelector('#paramsBanner'),
    chkOnlyPend: root.querySelector('#chkOnlyPend'),
    chkHideMaster: root.querySelector('#chkHideMaster'),
    btnExportJSON: root.querySelector('#btnExportJSON'),
    btnExportCSV: root.querySelector('#btnExportCSV'),
    btnImport: root.querySelector('#btnImport'),
    fileImport: root.querySelector('#fileImport'),
    masterStatus: root.querySelector('#masterStatus'),
  };
}

function dirtyParamsBanner(ui) {
  ui.paramsBanner.classList.remove('hidden');
  ui.paramsBanner.querySelector('button').onclick = () => ui.btnProcesar.click();
}

function renderLeftList(B = [], ui, session) {
  session = normalizeSession(session || {});
  const fmt = n => (n<0?'-':'') + 'C$ ' + Math.abs(n).toFixed(2);
  let rows = session.onlyPend ? B.filter(b => !session.matches[b.id]) : B.slice();
  if (ui?.chkHideMaster?.checked) rows = rows.filter(b => !b.inMaster);
  ui.bankList.innerHTML = rows.map(b => {
    const ok = !!session.matches[b.id];
    const dot = b.inMaster ? 'bg-gray-400' : (ok ? 'bg-green-500' : 'bg-amber-400');
    return `
      <li data-bid="${b.id}" class="px-3 py-2 hover:bg-blue-50 cursor-pointer">
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <span class="inline-block w-2 h-2 rounded-full ${dot}"></span>
            <div class="font-medium">${b.fecha} • ${b.nroConfirm || '—'}</div>
          </div>
          <div class="${b.montoNio>=0?'text-green-700':'text-red-700'}">${fmt(b.montoNio)}</div>
        </div>
        <div class="text-xs text-gray-600">${b.descripcion || ''}</div>
      </li>`;
  }).join('');
  if (ui.chkOnlyPend) {
    ui.chkOnlyPend.onchange = () => {
      session.onlyPend = ui.chkOnlyPend.checked;
      renderLeftList(B, ui, session);
      const cuentaId = Number(document.querySelector('#cuenta')?.value || 0);
      if (cuentaId && (window.__periodo?.desde || window.__periodo?.hasta)) {
        saveSession(
          { cuentaId, desdeISO: window.__periodo.desde, hastaISO: window.__periodo.hasta },
          session
        );
      }
    };
    ui.chkOnlyPend.checked = !!session.onlyPend;
  }
  if (ui.chkHideMaster) ui.chkHideMaster.onchange = () => renderLeftList(B, ui, session);
}

function renderRightPanel(b, cands, ui, session, onFix) {
  const fmt = n => 'C$ ' + Number(n).toFixed(2);
  const pill = t => `<span class="inline-block text-[10px] px-1.5 py-0.5 rounded bg-slate-100 border">${t}</span>`;

  const showAll = !!ui?.chkAllCands?.checked;
  const list = showAll ? cands : cands.filter(c => c.okTol);
  if (!list.length) {
    ui.cands.innerHTML = `<div class="text-gray-500">Sin candidatos para <b>${b.fecha}</b> ${fmt(b.montoNio)} (signo: ${b.signo})</div>`;
    return;
  }
  const sig = (g) => g.map(x => x.id).sort().join('|');
  ui.cands.innerHTML = list.map((c) => `
    <div class="p-2 rounded border mb-2 ${c.okTol ? 'border-green-300' : 'border-slate-200'}">
      <div class="flex items-center gap-2 mb-1">
        ${(c.tiers ? Array.from(c.tiers) : [c.tier]).map(pill).join(' ')}
        <span class="text-xs text-gray-600">error ${fmt(c.err)} • lag ${c.lagMax}d • #${c.group.length}</span>
      </div>
      <div class="grid gap-1">
        ${c.group.map(a => `
          <div class="flex justify-between text-xs">
            <div>${a.fecha} • ${a.notas || '—'}</div>
            <div>${fmt(a.valorNio)}</div>
          </div>`).join('')}
      </div>
      <div class="mt-1 text-xs text-gray-700">Σ ${fmt(c.suma)}</div>
      <div class="mt-2 flex gap-2">
        <button data-cand-key="${sig(c.group)}" class="px-2 py-1 text-xs bg-blue-600 text-white rounded">Fijar (Enter)</button>
        <button class="px-2 py-1 text-xs bg-slate-100 border rounded">Editar 1↔N</button>
      </div>
    </div>
  `).join('');
  // wire botones Fijar
  ui.cands.querySelectorAll('[data-cand-key]').forEach(btn => {
    btn.onclick = () => onFix(btn.getAttribute('data-cand-key'));
  });
  // re-render al cambiar el toggle
  if (ui?.chkAllCands) {
    ui.chkAllCands.onchange = () => renderRightPanel(b, cands, ui, session, onFix);
  }
}

