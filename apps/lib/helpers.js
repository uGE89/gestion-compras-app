export const normalizeId = (value) => {
  const str = String(value ?? '');
  const trimmed = str.replace(/^0+/, '');
  return trimmed || str;
};

export const formatMoney = (n, {
  locale = 'es-NI',
  currency = 'NIO',
  maximumFractionDigits = 2,
} = {}) => {
  const value = Number(n ?? 0);
  if (Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits,
  });
};

export const getUltimoProveedor = (product) => {
  const arr = product?.stats?.preciosCompraRecientes || [];
  if (!arr.length) return '';
  const sorted = [...arr].sort((a, b) => new Date(b.Fecha) - new Date(a.Fecha));
  return sorted[0]?.Proveedor || '';
};

export const uiAlert = (message, { title = 'Aviso', variant = 'warning' } = {}) => {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';

    const color = variant === 'success' ? 'emerald' : 'amber';
    const iconPath =
      variant === 'success'
        ? 'M9 12.75 11.25 15 15 9.75m-3-7.5a9 9 0 11-9 9 9 9 0 019-9Z'
        : 'M12 9v3.75m0 3.75h.007M21 12a9 9 0 11-18 0 9 9 0 0118 0z';

    const modal = document.createElement('div');
    modal.className = 'w-full max-w-md rounded-xl bg-white shadow-2xl';
    modal.innerHTML = `
      <div class="flex items-start gap-3 p-5">
        <div class="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-${color}-100 text-${color}-600">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}" />
          </svg>
        </div>
        <div class="min-w-0">
          <h3 class="text-base font-semibold text-slate-900">${title}</h3>
          <p class="mt-1 text-sm text-slate-600">${message}</p>
        </div>
      </div>
      <div class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
        <button id="ui-alert-ok"
          class="inline-flex items-center rounded-lg bg-${color}-600 px-4 py-2 text-sm font-semibold text-white hover:bg-${color}-700 focus:outline-none">
          Aceptar
        </button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const okBtn = modal.querySelector('#ui-alert-ok');
    const close = () => {
      document.body.removeChild(overlay);
      resolve();
    };

    okBtn.addEventListener('click', close);
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey, { once: true });
  });
};
