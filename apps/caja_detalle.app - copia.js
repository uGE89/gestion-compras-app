// /public/apps/caja_detalle.app.js
import { db } from '../firebase-init.js';
import {
  doc, getDoc, updateDoc, serverTimestamp, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

function setupA4PrintStyles() {
  if (document.getElementById('print-a4-style')) return;
  const style = document.createElement('style');
  style.id = 'print-a4-style';
  style.textContent = `
  /* === Print A4: clonado fijo en una sola página === */
  @media print {
    @page { size: A4 portrait; margin: 12mm; }

    /* Oculta TODO por defecto durante la impresión */
    body * { display: none !important; }

    /* El clon de impresión y sus hijos sí se muestran */
    .print-only, .print-only * { display: block !important; visibility: visible !important; }

    /* Caja de impresión: fija dentro de los márgenes */
    .print-only {
      position: fixed !important;
      inset: 12mm !important;          /* top/right/bottom/left */
      width: auto !important;
      height: auto !important;
      overflow: hidden !important;
      box-shadow: none !important;
      border: none !important;
      background: #fff !important;
      z-index: 2147483647 !important;
      break-inside: avoid;
      page-break-inside: avoid;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      font-size: 12px !important;
      line-height: 1.25 !important;
    }

    .print-only.shrink {
      transform-origin: top left !important;
      transform: scale(var(--print-scale, 1)) !important;
      letter-spacing: 0 !important;
    }

    /* Compactaciones suaves */
    .print-only .grid { display: block !important; gap: 2mm !important; margin: 2mm 0 !important; }
    .print-only .grid > * { margin-bottom: 2mm !important; break-inside: avoid; page-break-inside: avoid; }
    .print-only h1, .print-only h2, .print-only h3 { margin: 0 0 6px 0 !important; line-height: 1.15 !important; }

    /* Imagen: ajusta al espacio disponible (JS limita max-height) */
    .print-only img { object-fit: contain !important; max-width: 100% !important; height: auto !important; }

    /* Clamp observaciones si hace falta */
    #observaciones.clamp-print { display: -webkit-box !important; -webkit-line-clamp: 8; -webkit-box-orient: vertical; overflow: hidden !important; }
  }
  `;
  document.head.appendChild(style);
}

export default {
  async mount(container, { params }) {
    const id = params.get('id');
    if (!id) {
      container.innerHTML = `<div class="p-6 text-center text-slate-500">ID no especificado.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="max-w-5xl mx-auto p-4 md:p-6">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-2xl md:text-3xl font-bold text-slate-900">Detalle de Transferencia</h1>
          <div class="flex gap-2">
            <a id="btn-editar" class="px-3 py-2 bg-blue-600 text-white rounded-lg">Editar</a>
            <button id="btn-aprobar" class="px-3 py-2 bg-emerald-600 text-white rounded-lg hidden">Aprobar</button>
            <button id="btn-imprimir" class="px-3 py-2 bg-slate-200 text-slate-800 rounded-lg">Imprimir</button>
            <button id="btn-eliminar" class="px-3 py-2 bg-rose-600 text-white rounded-lg">Eliminar</button>
            <a href="#/caja_historial" class="px-3 py-2 bg-slate-100 text-slate-800 rounded-lg">Volver</a>
          </div>
        </div>

        <section id="card" class="bg-white border rounded-2xl shadow-sm overflow-hidden printable-area">
          <div id="imgWrap" class="p-3 border-b hidden">
            <img id="img" class="w-full max-h-[70vh] object-contain rounded-lg" alt="Comprobante"/>
          </div>

          <div class="p-4 md:p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><div class="text-sm text-slate-600">Banco</div><div class="font-semibold" id="banco">—</div></div>
            <div><div class="text-sm text-slate-600">Cuenta (ID)</div><div class="font-semibold" id="bankAccountId">—</div></div>
            <div><div class="text-sm text-slate-600">Fecha</div><div class="font-semibold" id="fecha">—</div></div>
            <div><div class="text-sm text-slate-600">Tipo</div><div class="font-semibold" id="tipo">—</div></div>
            <div><div class="text-sm text-slate-600">Moneda / Cantidad</div><div class="font-semibold" id="monto">—</div></div>
            <div><div class="text-sm text-slate-600">Estado</div><div class="font-semibold" id="status">—</div></div>
            <div><div class="text-sm text-slate-600">Contacto (Alegra)</div><div class="font-semibold" id="contacto">—</div></div>
            <div><div class="text-sm text-slate-600">Categoría (Alegra)</div><div class="font-semibold" id="categoria">—</div></div>
            <div class="md:col-span-2">
              <div class="text-sm text-slate-600">No. Confirmación</div>
              <div class="font-semibold break-words" id="numero_confirmacion">—</div>
            </div>
            <div class="md:col-span-2">
              <div class="text-sm text-slate-600">Observaciones</div>
              <div class="font-semibold whitespace-pre-wrap" id="observaciones">—</div>
            </div>
          </div>
        </section>
      </div>
    `;

    setupA4PrintStyles();

    const $ = s => container.querySelector(s);
    const refs = {
      banco: $('#banco'),
      bankAccountId: $('#bankAccountId'),
      fecha: $('#fecha'),
      tipo: $('#tipo'),
      monto: $('#monto'),
      status: $('#status'),
      numero_confirmacion: $('#numero_confirmacion'),
      observaciones: $('#observaciones'),
      contacto: $('#contacto'),
      categoria: $('#categoria'),
      imgWrap: $('#imgWrap'),
      img: $('#img'),
      card: $('#card'),
      btnEditar: $('#btn-editar'),
      btnAprobar: $('#btn-aprobar'),
      btnImprimir: $('#btn-imprimir'),
      btnEliminar: $('#btn-eliminar'),
    };

    function fitToA4(el) {
      // Altura útil A4 con márgenes de 12mm
      const usableHeightPx = 3.78 * (297 - 12 - 12); // ≈ 273mm * 3.78
      // Quita escalados previos
      el.classList.remove('shrink');
      el.style.removeProperty('--print-scale');

      // Si tiene imagen, limita su alto para que el conjunto quepa
      const imgWrap = el.querySelector('#imgWrap');
      const img = el.querySelector('#img');
      if (imgWrap && !imgWrap.classList.contains('hidden') && img) {
        img.style.maxHeight = '';
        // mide sin restricción
        const hWithoutImg = el.getBoundingClientRect().height - imgWrap.getBoundingClientRect().height;
        const remaining = usableHeightPx - hWithoutImg;
        img.style.maxHeight = remaining > 0 ? `${remaining}px` : '0px';
      }

      // Recalcula altura total
      const current = el.getBoundingClientRect().height;
      if (current > usableHeightPx) {
        const scale = Math.max(0.6, Math.min(1, usableHeightPx / current));
        el.style.setProperty('--print-scale', String(scale));
        el.classList.add('shrink');

        // último recurso: clampa observaciones
        const obs = el.querySelector('#observaciones');
        if (obs) obs.classList.add('clamp-print');
      } else {
        const obs = el.querySelector('#observaciones');
        if (obs) obs.classList.remove('clamp-print');
      }
    }

    function printDetail(refs) {
      // 1) Clona la tarjeta
      const clone = refs.card.cloneNode(true);
      clone.id = 'print-card';
      clone.classList.add('print-only'); // <- clave para @media print
      document.body.appendChild(clone);

      // 2) Ajusta a A4
      fitToA4(clone);

      // 3) Lanza impresión y limpia después
      const cleanup = () => {
        try { document.body.removeChild(clone); } catch {}
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);

      // Pequeño reflow antes de abrir el diálogo
      requestAnimationFrame(() => setTimeout(() => window.print(), 0));
    }

    async function load() {
      const snap = await getDoc(doc(db, 'transferencias', id));
      if (!snap.exists()) {
        container.innerHTML = `<div class="p-6 text-center text-slate-500">No encontrado.</div>`;
        return;
      }
      const t = snap.data();

      refs.banco.textContent = t.banco || 'N/A';
      refs.bankAccountId.textContent = (t.bankAccountId ?? '—');
      refs.fecha.textContent = t.fecha ? new Date(t.fecha + 'T00:00:00').toLocaleDateString('es-ES') : '—';
      refs.tipo.textContent = t.tipo === 'in' ? 'Entrada' : 'Salida';
      refs.monto.textContent = t.moneda === 'USD'
        ? `${Number(t.cantidad||0).toFixed(2)} USD`
        : `C$ ${Number(t.cantidad||0).toLocaleString('es-NI', {minimumFractionDigits:2})}`;
      refs.status.innerHTML = t.status === 'pending_review'
        ? `<span class="inline-flex text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">Pendiente</span>`
        : `<span class="inline-flex text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">Aprobado</span>`;
      refs.numero_confirmacion.textContent = t.numero_confirmacion || '—';
      refs.observaciones.textContent = t.observaciones || '—';

      // ---- Resolver nombres de Alegra (si hay IDs) ----
      try {
        const [cSnap, gSnap] = await Promise.all([
          t.alegraContactId ? getDoc(doc(db, 'alegra_contacts', String(t.alegraContactId))) : null,
          t.alegraCategoryId ? getDoc(doc(db, 'alegra_categories', String(t.alegraCategoryId))) : null,
        ]);
        const contactName  = cSnap?.exists() ? (cSnap.data().name || cSnap.id) : (t.alegraContactId ? t.alegraContactId : '—');
        const categoryName = gSnap?.exists() ? (gSnap.data().name || gSnap.id) : (t.alegraCategoryId ? t.alegraCategoryId : '—');
        refs.contacto.textContent  = contactName || '—';
        refs.categoria.textContent = categoryName || '—';
      } catch (e) {
        // Si falla la carga, mostramos el ID en crudo como fallback
        refs.contacto.textContent  = t.alegraContactId  || '—';
        refs.categoria.textContent = t.alegraCategoryId || '—';
      }

      if (t.imageUrl) {
        refs.img.src = t.imageUrl;
        refs.img.alt = 'Comprobante';
        refs.imgWrap.classList.remove('hidden');
      } else {
        refs.imgWrap.classList.add('hidden');
      }

      refs.btnEditar.href = `#/caja_editar?id=${encodeURIComponent(id)}`;
      refs.btnAprobar.classList.toggle('hidden', t.status === 'approved');

      refs.btnAprobar.onclick = async () => {
        await updateDoc(doc(db, 'transferencias', id), { status: 'approved', updatedAt: serverTimestamp() });
        await load();
      };
      refs.btnImprimir.onclick = () => {
        printDetail(refs);
      };
      refs.btnEliminar.onclick = async () => {
        if (!confirm('¿Eliminar este registro?')) return;
        await deleteDoc(doc(db, 'transferencias', id));
        location.hash = '#/caja_historial';
      };
    }

    await load();
  },
  unmount() {}
};