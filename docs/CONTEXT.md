# Contexto Canónico del Proyecto

> Última edición: YYYY-MM-DD (actualízala cuando cambies algo importante)

## Arquitectura
- Frontend **sin bundler**, módulos ES en `/public`.
- Router por **hash** con `router-lite` + `registry.js`.
  - Navegación: `#/ruta?param=valor` (ej.: `#/detalles?id=160MC03`).
  - `registry.js` mapea rutas → `() => import('apps/xxx.app.js')`.
  - El router pasa `params: URLSearchParams` a `mount()` de cada app.
- Soporte para HTMLs legacy vía `app_loader.js` (fallback).

## Patrón de Apps
- Cada app: `export default { mount(container, deps), unmount() }`.
- `deps` incluye `{ appState, params, ... }` (lo inyecta el router).
- No tocar la inicialización global en `index` (única fuente de `appState`).

## Estado y Datos (appState)
- `appState` se hidrata en `index` tras login:
  1) BigQuery (Apps Script) → `fetch`
  2) Normalización (parsing numérico, JSON)
  3) **IndexedDB** (`ProductDashboardDB/catalog`) como caché
- Expuesto a apps:
  - `appState.productCatalog` (array de productos normalizados)
  - `appState.allProveedores` (lista única)
  - `appState.isCatalogReady` (boolean)

### Estructura de un producto (resumen)
```js
{
  id, clave, nombre, stockTotal,
  stats: {
    ventas24: { "YYYY-MM": unidades, ... },
    preciosCompraRecientes: [{ Fecha, "Precio Com", Cant, Proveedor }, ...]
  },
  kpis: {
    cantidadSugerida, puntoDeReorden, vmp, diasInv,
    RazonRedondeo, PackUsado, RiesgoRuptura,
    SubtotalPedido, CoberturaPostPedido_meses, PrioridadScore
  },
  PrecioU_Ref, PrecioVta_Ref, InvSeg, Tr_meses, BasePack, ModeQty, ...
}
UI y Librerías
Tailwind por CDN, fuente Inter, Material Icons.

Chart.js + chartjs-plugin-datalabels por CDN global (no imports ESM).

Registro correcto en apps:

js
Copiar código
if (window.Chart && window.ChartDataLabels) {
  window.Chart.register(window.ChartDataLabels);
}
Instanciar: new window.Chart(canvas, { ... }).

Service Worker (SW) y Caché
SW tipo app-shell con CACHE_NAME.

Para forzar actualización:

Cambiar CACHE_NAME en service-worker.js y recargar fuerte.

O usar estrategia network-first para HTML si se decide.

No confundir la caché del SW con IndexedDB (datos del catálogo).

Hosting y Despliegue
Firebase Hosting (firebase.json mínimo con rewrites a index.html).

Flujo local: firebase emulators:start (o server estático) → deploy: firebase deploy.

Convenciones de Navegación
Ir a detalles:
location.hash = '#/detalles?id=' + encodeURIComponent(productId)

Las apps reciben params en mount:
const productId = params.get('id');

Checklist de Contexto Mínimo (para abrir issues/consultas)
Ruta/flujo: #/creador-pedido → #/detalles?id=160MC03

Objetivo: qué esperas lograr

Estado de datos: appState.isCatalogReady, ejemplo puntual de item si aplica

Errores exactos: copia del console/stack

Archivos tocados: nombres + fragmentos relevantes

Entorno: navegador/OS, móvil/desktop, SW CACHE_NAME actual

Repro rápido: 1–2 pasos

Plantilla de Prompt (corta)
yaml
Copiar código
Ruta actual: #/<ruta>?<params>
Objetivo: <qué quiero lograr>
Datos en appState: { productCatalog: [...], allProveedores: [...], isCatalogReady: true/false } (ejemplo breve si aplica)
Archivos tocados: <lista>
Error exacto (si hay): <mensaje/stack>
Entorno: <navegador/OS> • SW CACHE_NAME=<valor>

Peticiones:
- Mantener router y registry.
- Chart.js por CDN (sin imports ESM).
- No alterar la inicialización de appState en index.
Plantilla de Prompt (detallada)
diff
Copiar código
[Contexto]
- Router hash + registry.js; apps en /public/apps/*.app.js (export default { mount, unmount }).
- Librerías por CDN: Tailwind, Inter, Material Icons, Chart.js + DataLabels.
- Datos: appState (productCatalog, allProveedores, isCatalogReady) listo en index (BigQuery→IndexedDB).
- Hosting: Firebase Hosting; SW con CACHE_NAME=<...>.

[Ruta/flujo]
- Desde: #/<ruta> (params: <...>)
- Hacia (si aplica): #/<otra-ruta>?<params>

[Objetivo]
- <qué comportamiento/feature quiero>

[Datos relevantes]
- Ejemplo productCatalog[0]: { id, clave, nombre, stockTotal, stats:{...}, kpis:{...} }

[Errores/logs]
- <pegar mensaje>

[Archivos tocados]
- /public/apps/<archivo>.app.js (líneas X–Y si puedes)
- Otros: <...>

[Restricciones]
- No romper index ni appState global.
- Mantener uso de CDN global para Chart.js (new window.Chart).
- Evitar cambios en rutas/registry salvo que se pida.
