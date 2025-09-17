// framework/router-lite.js
export function createRouter({ container, registry, deps = {}, fallbackLoadContent }) {
  let currentApp = null;

  // Helper para las apps (y para uso externo si lo necesitas)
  const navigate = (path, query = {}) => {
    const qs = new URLSearchParams(query).toString();
    location.hash = `#/${path}${qs ? `?${qs}` : ''}`;
  };

  function parseRoute(route) {
    const hash = typeof route === 'string' && route ? route : (location.hash || '#/compras_historial');
    const raw = hash.replace(/^#\/?/, '');          // "#/x?y" -> "x?y"
    const [pathRaw = '', qs] = raw.split('?');
    const cleanPath = pathRaw.replace(/\/+$/, ''); // quita "/" al final
    const params = new URLSearchParams(qs || '');
    return { path: pathRaw, cleanPath, params };
  }

  function getLoader(key) {
    if (!key) return null;
    // Soporta Map-like y objeto plano
    if (registry?.has && registry?.get) return registry.has(key) ? registry.get(key) : null;
    if (registry && typeof registry === 'object') {
      const f = registry[key];
      return (typeof f === 'function') ? f : null;
    }
    return null;
  }

  async function unmount() {
    try { await currentApp?.unmount?.(); } catch {}
    currentApp = null;
  }

  async function mount(route) {
    const { cleanPath, params } = parseRoute(route);

    await unmount();
    container.innerHTML = '<div class="text-center py-10 text-slate-500">Cargando…</div>';

    const loader = getLoader(cleanPath);
    if (loader) {
      try {
        const mod = await loader();
        const app = mod?.default ?? mod;
        if (typeof app?.mount !== 'function') throw new Error('App inválida: falta mount()');

        currentApp = app;
        await app.mount(container, { ...deps, params, navigate });
        return;
      } catch (err) {
        console.error('[router-lite] error montando app', err);
      }
    }

    // Fallback si la ruta no existe o falló el import
    if (typeof fallbackLoadContent === 'function') {
      container.innerHTML = '';
      await fallbackLoadContent('fallback.html');
    } else {
      container.innerHTML = '<div class="text-center text-slate-500 p-8">Página no encontrada.</div>';
    }
  }

  return { mount, navigate };
}
