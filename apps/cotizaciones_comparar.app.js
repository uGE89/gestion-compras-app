// apps/cotizaciones_comparar.app.js
import { FIREBASE_BASE } from './lib/constants.js';
import { collection, query, where, getDocs }
  from `${FIREBASE_BASE}firebase-firestore.js`;
  const COT_COLLECTION = 'cotizaciones_analizadas';


export default {
  title: 'Comparar Cotizaciones',
  async mount(container, { db, appState, params }) {
    const rfqId = params.get('rfq');
    if (!rfqId) { container.innerHTML = '<div class="p-6 text-slate-500">Falta rfq.</div>'; return; }

    const $=(s,r=document)=>r.querySelector(s);
    const cur=n=>`$${(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

    // 1) Traer cotizaciones del RFQ
    const snap = await getDocs(query(collection(db, COT_COLLECTION), where('rfqId','==',rfqId)));
    const quotes = snap.docs.map(d=>({ id:d.id, ...d.data() }));

    // 2) Construir universo de items (por clave_catalogo si existe, si no por descripción)
    const keyOf = it => it.clave_catalogo || `DESC:${(it.desc_catalogo||it.descripcion_factura||'').toLowerCase()}`;
    const allRows = new Map(); // key -> {desc, clave, reqQty?, cells:{[proveedor]: {precio, moneda, tc}}}

    quotes.forEach(q=>{
      (q.items||[]).forEach(it=>{
        const key=keyOf(it);
        if(!allRows.has(key)){
          allRows.set(key, {
            clave: it.clave_catalogo || '',
            desc: it.desc_catalogo || it.descripcion_factura || '',
            reqQty: it.cantidad || 0,
            cells: {}
          });
        }
        allRows.get(key).cells[q.proveedor||'(sin proveedor)'] = {
          precio: Number(it.precio_unit||0),
          moneda: q.moneda||'MXN',
          tc: Number(q.tipo_cambio||1)
        };
      });
    });

    const proveedores = Array.from(new Set(quotes.map(q=>q.proveedor||'(sin proveedor)')));

    // 3) Render
    container.innerHTML = `
      <div class="max-w-7xl mx-auto p-4 md:p-6">
        <header class="mb-4 flex items-center justify-between">
          <div>
            <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Comparar Cotizaciones</h1>
            <div class="text-xs text-slate-500">RFQ: <code>${rfqId}</code></div>
          </div>
          <div class="flex gap-2">
            <button id="to-register" class="bg-slate-200 hover:bg-slate-300 text-slate-800 px-3 py-2 rounded">Agregar otra cotización</button>
            <button id="to-order" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded">Enviar a Pedido</button>
          </div>
        </header>

        <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="border-b">
                <th class="text-left">Clave</th>
                <th class="text-left">Descripción</th>
                <th class="text-right">Cant.</th>
                ${proveedores.map(p=>`<th class="text-right">${p}</th>`).join('')}
                <th class="text-right">Ganador</th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </section>
      </div>
    `;

    const rowsEl = $('#rows', container);

    const rows = Array.from(allRows.values()).map(r=>({
      ...r,
      winner: null // { proveedor, precio_base_mxn }
    }));

    function renderRows(){
      rowsEl.innerHTML = rows.map((r,idx)=>{
        const celdas = proveedores.map(p=>{
          const c = r.cells[p];
          if(!c) return `<td class="text-right text-slate-400">—</td>`;
          const mxn = c.precio * (c.tc||1);
          return `<td class="text-right ${isBest(r,c)?'bg-emerald-50 font-semibold':''}">
                    ${cur(mxn)}
                  </td>`;
        }).join('');
        const ganador = r.winner?.proveedor || '';
        return `
          <tr class="border-b">
            <td class="text-xs text-slate-500">${r.clave||'-'}</td>
            <td class="text-slate-800">${r.desc||'-'}</td>
            <td class="text-right">
              <input data-idx="${idx}" class="qty p-1 border rounded w-20 text-right" type="number" step="1" value="${r.reqQty||0}">
            </td>
            ${celdas}
            <td class="text-right">
              <select data-idx="${idx}" class="win p-1 border rounded">
                <option value="">(auto)</option>
                ${proveedores.map(p=>`<option value="${p}" ${ganador===p?'selected':''}>${p}</option>`).join('')}
              </select>
            </td>
          </tr>
        `;
      }).join('');
    }

    function isBest(r, cell) {
      // resalta el más barato en MXN
      const best = proveedores
        .map(p=>r.cells[p])
        .filter(Boolean)
        .map(c=>c.precio*(c.tc||1));
      if (!best.length) return false;
      const min = Math.min(...best);
      return Math.abs((cell.precio*(cell.tc||1)) - min) < 1e-6;
    }

    rowsEl.addEventListener('input', (e)=>{
      const inp = e.target.closest('.qty'); if(!inp) return;
      const idx = Number(inp.dataset.idx);
      rows[idx].reqQty = Number(inp.value)||0;
    });

    rowsEl.addEventListener('change', (e)=>{
      const sel = e.target.closest('.win'); if(!sel) return;
      const idx = Number(sel.dataset.idx);
      const p = sel.value || ''; // vacío = auto
      rows[idx].winner = p ? { proveedor: p } : null;
    });

    renderRows();

    // Agregar otra cotización al mismo RFQ
    $('#to-register').addEventListener('click', ()=>{
      location.hash = `#/cotizaciones_registrar?rfq=${rfqId}`;
    });

    // Enviar a Pedido (creador_pedido)
    $('#to-order').addEventListener('click', ()=>{
      // construir carrito ganador
      const cart = [];
      rows.forEach(r=>{
        if (!r.reqQty) return;
        // elegir ganador (si no se seleccionó, auto: menor MXN)
        let ganador = r.winner?.proveedor;
        if (!ganador){
          let bestP=null, bestVal=Infinity;
          proveedores.forEach(p=>{
            const c=r.cells[p]; if(!c) return;
            const mxn = c.precio*(c.tc||1);
            if (mxn < bestVal){ bestVal=mxn; bestP=p; }
          });
          ganador = bestP;
        }
        if (!ganador) return;
        const c = r.cells[ganador]; if(!c) return;
        cart.push({
          id: r.clave || r.desc,   // si no hay clave usa desc
          nombre: r.desc,
          cantidad: r.reqQty,
          precioUnit: c.precio*(c.tc||1),
          proveedor: ganador
        });
      });

      appState.pedidoDraft = { rfqId, items: cart };
      location.hash = '#/creador-pedido'; // tu app ya imprime/arma el pedido
    });
  },
  unmount(){ }
};
