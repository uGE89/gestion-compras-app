// framework/router-lite.js
export function createRouter({ container, registry, deps, fallbackLoadContent }) {
  let current = null;

  function parseRoute(route) {
    const hash = route?.startsWith('#') ? route : `#${route || ''}`;

    // Separa path y query
    const [rawPath, queryString] = hash.split('?');
    const params = new URLSearchParams(queryString || '');

    // Limpia: quita "#/" o "#", barra final y normaliza a minúsculas
    let cleanPath = rawPath.replace(/^#\/?/, ''); // "#/detalles" -> "detalles"
    cleanPath = cleanPath.replace(/\/+$/, '');    // "detalles/" -> "detalles"
    cleanPath = cleanPath || '';                  // "" si estaba vacío
    cleanPath = cleanPath.toLowerCase();          // consistentemente en minúsculas

    return { cleanPath, params };
  }

  async function mount(route) {
    const { cleanPath, params } = parseRoute(route || location.hash || '#/creador-pedido');

    // Desmontar app actual
    if (current?.unmount) {
      try { current.unmount(); } catch {}
    }
    container.innerHTML = '<div class="text-center py-10">Cargando…</div>';

    // 1) Intentar micro-app registrada
    let loader = registry[cleanPath];

    // 2) Fallback: si piden un .html, delega al app_loader
    if (!loader) {
      const looksHtml = cleanPath.endsWith('.html');
      if (fallbackLoadContent && looksHtml) {
        container.innerHTML = '';
        // reconstruye ruta original del .html (sin hash)
        const filename = cleanPath;               // p.ej. "compras.html"
        return fallbackLoadContent(filename);
      }

      container.innerHTML = `<div class="text-center text-red-500 py-10">
        Ruta desconocida: <code>${cleanPath || '(vacía)'}</code>
      </div>`;
      return;
    }

    try {
      const mod = await loader();
      const app = mod.default || mod;
      if (!app?.mount) throw new Error('App inválida: falta mount()');
      current = app;
      await app.mount(container, { ...deps, params });
    } catch (err) {
      console.error('[router-lite] error montando app', err);
      if (fallbackLoadContent) {
        container.innerHTML = '';
        await fallbackLoadContent('compras.html');
      } else {
        container.innerHTML = '<div class="text-center text-red-500 py-10">Error cargando app.</div>';
      }
    }
  }

  return { mount };
}
