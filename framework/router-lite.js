// framework/router-lite.js
export function createRouter({ container, registry, deps, fallbackLoadContent, soloApp }) {
  let current = null;
  let soloActive = false;

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

    let targetPath = cleanPath;

    if (soloApp) {
      const flagParam = soloApp.flagParam || 'solo';
      const flagValue = soloApp.flagValue || '1';
      const appParam = soloApp.appParam || 'app';
      const wantsSolo = params.get(flagParam) === flagValue;
      const requestedApp = params.get(appParam);
      const shouldForceSolo = wantsSolo && requestedApp === soloApp.id;

      if (shouldForceSolo) {
        targetPath = soloApp.id;
        if (!soloActive) {
          soloApp.onEnter?.({ params });
        }
        soloActive = true;
        const queryString = params.toString();
        const expectedHash = `#/${soloApp.id}${queryString ? `?${queryString}` : ''}`;
        if (typeof window !== 'undefined' && typeof window.location !== 'undefined' && window.location.hash !== expectedHash) {
          if (typeof history !== 'undefined' && history.replaceState) {
            history.replaceState(null, '', expectedHash);
          } else {
            window.location.hash = expectedHash;
          }
        }
      } else if (soloActive) {
        soloApp.onExit?.({ params });
        soloActive = false;
      }
    }

    // Desmontar app actual
    if (current?.unmount) {
      try { current.unmount(); } catch {}
    }
    container.innerHTML = '<div class="text-center py-10">Cargando…</div>';

    // 1) Intentar micro-app registrada
    let loader = registry[targetPath];

    // 2) Fallback: si piden un .html, delega al app_loader
    if (!loader) {
      const looksHtml = targetPath.endsWith('.html');
      if (fallbackLoadContent) {
        container.innerHTML = '';
        // reconstruye ruta original del .html (sin hash)
        const filename = looksHtml ? targetPath : 'fallback.html';
        return fallbackLoadContent(filename);
      }

      container.innerHTML = `<div class="text-center text-red-500 py-10">
        Ruta desconocida: <code>${targetPath || '(vacía)'}</code>
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
        await fallbackLoadContent('fallback.html');
      } else {
        container.innerHTML = '<div class="text-center text-red-500 py-10">Error cargando app.</div>';
      }
    }
  }

  return { mount };
}
