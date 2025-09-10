# Contexto Canónico del Proyecto

> Última edición: 2025-09-10

## Router
- SPA sin bundler; módulos ES.
- Router basado en hash (`framework/router-lite.js`) con registro de rutas (`framework/registry.js`).
- Navegación: `#/ruta?param=valor`.
- `registry.js` mapea rutas a `() => import('apps/xxx.app.js')`.
- Cada `app.mount` recibe `{ appState, params }`.

## Patrón de apps
- Cada app exporta `{ mount(container, deps), unmount() }`.
- `deps` contiene `{ appState, params, ... }`.
- `app_loader.js` da soporte a HTMLs legacy.

## Estado
- `state.js` mantiene `appState`.
- Hidratación tras login:
  1. BigQuery → `fetch`.
  2. Normalización (números/JSON).
  3. Cache en IndexedDB (`ProductDashboardDB/catalog`).
- Campos expuestos: `productCatalog`, `allProveedores`, `isCatalogReady`.
- Componentes compartidos:
  - `ItemsEditor` (`apps/components/items_editor.js`) gestiona listas de ítems.
  - `createDraftStore` (`framework/drafts.js`) guarda borradores en `localStorage`.

## Service Worker
- `service-worker.js` implementa el app‑shell y gestiona la caché.
- `APP_VERSION` se concatena a un prefijo para generar `CACHE_NAME`; cambiarla en cada despliegue
  invalida cachés antiguos.
- Estrategias:
  - **network-first** para HTML, JS y CSS → asegura recursos frescos con respaldo al caché.
  - **cache-first** para imágenes y fuentes → mejora rendimiento pero puede servir contenido viejo.
- La app puede enviar `postMessage({ type: 'SKIP_WAITING' })` al Service Worker para que la versión
  actualizada se active inmediatamente.

## Flujo de datos e IA
1. Usuario inicia sesión.
2. `state.js` hidrata `appState`.
3. Router monta apps que leen `appState`.
4. `ItemsEditor` emite `onChange` para recalcular totales.
5. Los borradores se persisten con `createDraftStore`.
6. `getAIDataDirect` en `compras_registrar.app.js` consume `env.AI_API_KEY` (o `env.AI_PROXY_URL` en prod) para extraer datos de facturas.
