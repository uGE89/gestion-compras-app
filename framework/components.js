// framework/components.js
export function SearchBar({ placeholder='Buscar…', debounce=250, onChange } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'relative';
  wrap.innerHTML = `
    <span class="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
    <input type="search" class="w-full h-11 pl-10 pr-3 rounded-xl border border-slate-200 bg-white
                               focus:outline-none focus:ring-2 focus:ring-emerald-500"
           placeholder="${placeholder}">
  `;
  const input = wrap.querySelector('input');
  let t = null;
  input.addEventListener('input', e => {
    clearTimeout(t);
    const v = e.target.value;
    t = setTimeout(() => onChange?.(v), debounce);
  });
  return { el: wrap, input, setValue(v){ input.value = v; onChange?.(v); } };
}

export function Paginator({ page=1, pageSize=20, total=0, onChange } = {}) {
  const wrap = document.createElement('div');
  const render = () => {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    wrap.innerHTML = `
      <div class="flex items-center justify-between gap-2 text-sm text-slate-600">
        <button data-act="prev" class="px-3 py-1.5 rounded-lg border hover:bg-slate-50 ${page<=1?'opacity-50 pointer-events-none':''}">Anterior</button>
        <div> Página <strong>${page}</strong> de ${pages} · ${total} items </div>
        <button data-act="next" class="px-3 py-1.5 rounded-lg border hover:bg-slate-50 ${page>=pages?'opacity-50 pointer-events-none':''}">Siguiente</button>
      </div>`;
    wrap.querySelector('[data-act="prev"]')?.addEventListener('click', () => { if (page>1)  { page--; onChange?.({ page, pageSize }); render(); }});
    wrap.querySelector('[data-act="next"]')?.addEventListener('click', () => { if (page<pages){ page++; onChange?.({ page, pageSize }); render(); }});
  };
  render();
  return { el: wrap, get state(){ return { page, pageSize, total }; } };
}
