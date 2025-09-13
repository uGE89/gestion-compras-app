// apps/conciliacion.app.js
import { ensureCDNs, readAnyTable } from './lib/recon_utils.js';
import { normalizeAndFilterAlegra, normalizeBanco } from './lib/recon_parser.js';
import { buildIndexes, candidatesForBankRow } from './lib/recon_matcher.js';
import { DATE_WINDOW } from './lib/recon_config.js';
import { loadSession, saveSession } from './lib/recon_storage.js';

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

    // Cargar librerías
    await ensureCDNs();

    // Cargar catálogo de cuentas desde appState si lo tenés ahí; si no, pedilo por input JSON
    // Aquí asumimos que appState trae algo como appState.alegraCuentas
    cuentasArray = appState?.alegraCuentas || [];

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

    ui.btnProcesar.addEventListener('click', () => {
      const cuentaId = Number(ui.cuenta.value);
      const tc = Number(ui.tc.value || '1');
      // Normaliza y filtra Alegra (solo conciliables y SOLO cuenta seleccionada)
      A = normalizeAndFilterAlegra(alegraRows, cuentasArray, cuentaId);
      // Normaliza Banco con TC global
      const Bpack = normalizeBanco(bancoRows, { cuentaId, tipoCambio: tc });
      B = Bpack.rows; periodo = { desde: Bpack.desde, hasta: Bpack.hasta };

      idx = buildIndexes(A);
      renderLeftList(B, ui);
      ui.panelInfo.textContent = `Alegra (filtrada): ${A.length} • Banco: ${B.length} • Periodo ${periodo.desde || '?'} a ${periodo.hasta || '?'}`;
      ui.paramsBanner.classList.add('hidden');
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
      }
    });

    function selectBankRow(bid) {
      const b = B.find(x => x.id === bid);
      if (!b || !idx) return;
      const cuentaId = Number(ui.cuenta.value);
      const cands = candidatesForBankRow(b, idx, { cuentaId, dateWindow: DATE_WINDOW });
      renderRightPanel(b, cands, ui);
      // marca selección visual
      container.querySelectorAll('[data-bid]').forEach(x => x.classList.remove('bg-blue-50'));
      const node = container.querySelector(`[data-bid="${bid}"]`);
      if (node) node.classList.add('bg-blue-50');
    }

    function maybeEnableProcess() {
      ui.btnProcesar.disabled = !(alegraRows.length && bancoRows.length && ui.cuenta.value);
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

    <div class="grid grid-cols-2 gap-3">
      <div>
        <div class="text-sm font-semibold mb-1">Banco (160/mes aprox.)</div>
        <ul id="bankList" class="border rounded divide-y max-h-[70vh] overflow-auto"></ul>
      </div>
      <div>
        <div class="text-sm font-semibold mb-1">Candidatos Alegra (T1→T3)</div>
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
    panelInfo: root.querySelector('#panelInfo'),
    paramsBanner: root.querySelector('#paramsBanner'),
  };
}

function dirtyParamsBanner(ui) {
  ui.paramsBanner.classList.remove('hidden');
  ui.paramsBanner.querySelector('button').onclick = () => ui.btnProcesar.click();
}

function renderLeftList(B, ui) {
  const fmt = n => (n<0?'-':'') + 'C$ ' + Math.abs(n).toFixed(2);
  ui.bankList.innerHTML = B.map(b => `
    <li data-bid="${b.id}" class="px-3 py-2 hover:bg-blue-50 cursor-pointer">
      <div class="flex justify-between">
        <div class="font-medium">${b.fecha} • ${b.nroConfirm || '—'}</div>
        <div class="${b.montoNio>=0?'text-green-700':'text-red-700'}">${fmt(b.montoNio)}</div>
      </div>
      <div class="text-xs text-gray-600">${b.descripcion || ''}</div>
    </li>
  `).join('');
}

function renderRightPanel(b, cands, ui) {
  const fmt = n => 'C$ ' + Number(n).toFixed(2);
  const pill = t => `<span class="inline-block text-xs px-2 py-0.5 rounded bg-slate-100 border">${t}</span>`;
  if (!cands.length) {
    ui.cands.innerHTML = `<div class="text-gray-500">Sin candidatos para <b>${b.fecha}</b> ${fmt(b.montoNio)} (signo: ${b.signo})</div>`;
    return;
  }
  ui.cands.innerHTML = cands.map((c,i) => `
    <div class="p-2 rounded border mb-2 ${c.okTol ? 'border-green-300' : 'border-slate-200'}">
      <div class="flex items-center gap-2 mb-1">
        ${pill(c.tier)}
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
        <button class="px-2 py-1 text-xs bg-blue-600 text-white rounded">Fijar (Enter)</button>
        <button class="px-2 py-1 text-xs bg-slate-100 border rounded">Editar 1↔N</button>
      </div>
    </div>
  `).join('');
}

