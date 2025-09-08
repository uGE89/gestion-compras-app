// apps/plantilla.app.js
import { SearchBar, Paginator } from '../framework/components.js';

export default {
  title: 'Plantilla',
  async mount(container, { appState }) {
    const root = document.createElement('div');
    root.className = 'max-w-7xl mx-auto p-4 md:p-6';
    root.innerHTML = `
      <header class="mb-4">
        <h1 class="text-2xl md:text-3xl font-bold text-slate-900">App Plantilla</h1>
        <p class="text-slate-500">Demo de buscador + paginación compartidos.</p>
      </header>
      <section class="bg-white p-4 md:p-6 rounded-2xl shadow-xl">
        <div id="toolbar" class="flex flex-col md:flex-row gap-3 md:items-center md:justify-between mb-4"></div>
        <div id="list" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"></div>
        <div id="pager" class="mt-4"></div>
      </section>
    `;
    container.innerHTML = '';
    container.appendChild(root);

    const toolbar = root.querySelector('#toolbar');
    const list    = root.querySelector('#list');
    const pager   = root.querySelector('#pager');

    // UI: buscador compartido
    const search = SearchBar({
      placeholder: 'Buscar en catálogo global…',
      onChange: () => render()
    });
    toolbar.appendChild(search.el);

    // Datos: reutiliza tu appState (no tocamos nada)
    const data = (appState?.productCatalog || []).map(p => ({
      id: p.id, nombre: p.nombre, stock: p.stockTotal ?? 0
    }));

    const norm = s => (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const matches = (it, q) => {
      const hay = norm(`${it.nombre} ${it.id}`);
      const toks = norm(q).split(/\s+/).filter(Boolean);
      return toks.every(t => hay.includes(t));
    };

    let page = 1, pageSize = 12;

    function render() {
      const q = (search.input.value || '').trim();
      const filtered = q ? data.filter(d => matches(d, q)) : data;

      // Paginador (simplemente lo recreamos con el total actual)
      pager.innerHTML = '';
      const pag = Paginator({
        page, pageSize, total: filtered.length,
        onChange: ({ page: p }) => { page = p; render(); }
      });
      pager.appendChild(pag.el);

      const start = (page - 1) * pageSize;
      const pageItems = filtered.slice(start, start + pageSize);

      list.innerHTML = pageItems.map(it => `
        <article class="border rounded-xl p-4 bg-slate-50">
          <div class="text-sm text-slate-500">${it.id}</div>
          <div class="font-semibold text-slate-800">${it.nombre}</div>
          <div class="text-xs text-slate-500 mt-1">Stock: ${it.stock}</div>
        </article>
      `).join('') || `<div class="text-center text-slate-500">Sin resultados</div>`;
    }

    render();
    this._cleanup = () => {};
  },
  unmount() { try { this._cleanup?.(); } catch {} }
};
