// apps/lib/export_utils.js

// Helpers for exporting data
export function toCSV(arr = []) {
  const header = ['sig','cuentaId','fecha','signo','nroConfirm','montoNio','descripcion','alegraIds','meta'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g,'""')}"`;
  const lines = [header.join(',')];
  for (const e of arr) {
    const row = {
      sig: e.sig,
      cuentaId: e.cuentaId,
      fecha: e.fecha,
      signo: e.signo,
      nroConfirm: e.nroConfirm ?? '',
      montoNio: e.montoNio,
      descripcion: e.descripcion ?? '',
      alegraIds: Array.isArray(e.alegraIds) ? e.alegraIds.join('|') : (e.alegraIds ?? ''),
      meta: JSON.stringify(e.meta || {}),
    };
    lines.push(header.map(k => esc(row[k])).join(','));
  }
  return lines.join('\r\n');
}

export function downloadText(filename, text, mime='text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

