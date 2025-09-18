# Contexto Canónico del Proyecto

> Última edición: YYYY-MM-DD (actualízala cuando cambies algo importante)

## Arquitectura
- Frontend **sin bundler**, módulos ES en `/public`.
- Router por **hash** con `router-lite` + `framework/registry.js`.
  - Navegación: `#/ruta?param=valor` (ej.: `#/detalles?id=160MC03`).
  - `framework/registry.js` mapea rutas → `() => import('apps/xxx.app.js')`.
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
Tailwind se carga directamente por CDN con `<script src="https://cdn.tailwindcss.com"></script>` en `index.html` y los HTML legacy, sin loader adicional. También se incluye la fuente Inter y los iconos de Material Icons por CDN.

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
Ruta/flujo: #/creador_pedido → #/detalles?id=160MC03

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
- Router hash + `framework/registry.js`; apps en /public/apps/*.app.js (export default { mount, unmount }).
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

# Apéndice — Contratos y convenciones para micro-apps de Compras

### 1) Router + Registry
- **Router**: `framework/router-lite.js` usa hash routing con rutas `#/nombre_app?query`.
- **Registry**: `framework/registry.js` mapea *cleanPath* (minúsculas) → `() => import('...')`.
- **Navegación**:
  - `location.hash = '#/compras_historial'`
  - `location.hash = '#/compras_detalles?id=ABC123'`
- **Params**: cada app recibe `params: URLSearchParams` en `mount`.

**Boot (index) mínimo**
```js
import { createRouter } from './framework/router-lite.js';
import { registry } from './framework/registry.js';
import { auth, db as firestoreDb, storage as firebaseStorage } from './firebase-init.js';
import { env } from './env.js';

const router = createRouter({
  container: document.getElementById('content-container'),
  registry,
  deps: { appState, auth, db: firestoreDb, storage: firebaseStorage, env },
  fallbackLoadContent: async (file) => { /* legacy loader */ }
});

router.mount();
window.addEventListener('hashchange', () => router.mount());
2) Contrato de deps para mount(container, deps)
ts
Copiar código
type Deps = {
  appState: {
    productCatalog: Product[];
    allProveedores: string[];
    isCatalogReady: boolean;
  };
  auth;          // Firebase Auth (modular)
  db;            // Firestore (modular)
  storage;       // Firebase Storage (modular)
  env: { AI_API_KEY?: string; AI_PROXY_URL?: string };
  params: URLSearchParams;   // #/ruta?foo=bar → params.get('foo')
};
3) Estado global (catálogo)
Fuente: BigQuery → Apps Script (endpoint configurado en index).

Cache: IndexedDB (ProductDashboardDB/catalog).

Normalización: translateBigQueryData → appState.productCatalog + appState.allProveedores.

Disponibilidad: usar appState.isCatalogReady === true antes de depender del catálogo.

4) Componente compartido: ItemsEditor
API esperada:

ts
Copiar código
ItemsEditor({
  container: HTMLElement,
  productCatalog: Product[],
  initialIVA: number,   // default 15
  initialTC: number,    // default 1
  initialTotalAI?: number,
  onChange?: () => void
}): {
  setItems(items: Item[]): void;
  addItems(items: Item[]): void;      // ANEXAR (no reemplaza)
  getItems(): Item[];
  setInvoiceTotal(n: number): void;
  onChange?: () => void;
}
Item:

ts
Copiar código
type Item = {
  descripcion_factura: string;
  cantidad_factura: number;
  unidades_por_paquete: number;
  total_linea_base: number;
  clave_proveedor?: string | null;
  clave_catalogo?: string | null;
  desc_catalogo?: string | null;
  recibido?: boolean;
  autoAssociated?: boolean;
};
5) Mapeo automático (mapeo_articulos)
DocID: slug de descripcion_factura (a-z0-9-, colapsando guiones).

Campos: { descripcion_proveedor, clave_catalogo, desc_catalogo, ultima_actualizacion, conteo_usos }.

Uso:

En extracción IA: findAssociation(desc) preasigna clave_catalogo/desc_catalogo.

Al guardar: setDoc(..., { merge: true }) + increment(1) por ítem con clave_catalogo.

6) IA (Gemini 1.5)
Temporal (front): env.AI_API_KEY + getAIDataDirect(base64[]).

Prod (recomendado): env.AI_PROXY_URL.

Output requerido (solo JSON):
fecha (YYYY-MM-DD), proveedor, numero_factura, total (number),
items[] con { descripcion, cantidad, total_linea, clave_proveedor }.

Comportamiento: ANEXAR ítems detectados (nunca reemplazar).

PDF: convertir páginas a imágenes (PDF.js) y tratarlas como image/jpeg.

7) Subida de archivos (Storage)
Registrar: invoices/${userId}/${timestamp}-${file}

Editar: invoices/${userId}/${docId}/${timestamp}-${file} (merge de URLs, evitar duplicados)

Helper:

js
Copiar código
import { ref, uploadBytes, getDownloadURL, getStorage } from 'firebase-storage';
async function uploadToStorage(storage, fileOrBlob, path) {
  const s = storage ?? getStorage();
  const storageRef = ref(s, path);
  const snap = await uploadBytes(storageRef, fileOrBlob);
  return getDownloadURL(snap.ref);
}
8) Borradores locales (reutilizable)
Util genérico: framework/drafts.js

js
Copiar código
export function createDraftStore(ns, { version = 1 } = {}) {
  const prefix = `draft::${ns}::`;
  return {
    key: ({ userId='anon', entityId='' }={}) => `draft::${ns}::${userId}::${entityId}`,
    load: (k) => { try { const o = JSON.parse(localStorage.getItem(k)||'null'); return o?.__v===version?o:null; } catch { return null; } },
    save: (k, data) => { try { localStorage.setItem(k, JSON.stringify({ __v:version, savedAt:Date.now(), ...data })); } catch {} },
    clear: (k) => { try { localStorage.removeItem(k); } catch {} },
    throttle: (fn, ms=600) => { let t=0,h; return (...a)=>{ const n=Date.now(); if(n-t>ms){t=n;fn(...a);} else {clearTimeout(h); h=setTimeout(()=>{t=Date.now();fn(...a);},ms);} }; },
    onExternalChange: (handler) => { const l=(e)=>{ if(e.key?.startsWith(prefix)) handler(e); }; window.addEventListener('storage', l); return ()=>window.removeEventListener('storage', l); }
  };
}
Claves:

Registrar: draft::compras_registrar::<userId>::

Editar: draft::compras_editar::<userId>::<docId>

Persistir: form, ie (iva, tc, totalFacturaAI, items[]), imageUrls[].

Limpiar: al guardar OK o si el usuario “Descarta” el borrador.

9) Diferencias de flujo: Registrar vs Editar
Registrar: arranca vacío; addDoc; setea createdAt, userId, agregado_sicar=false, comments=[]; anti-dup: si existe cualquiera (proveedor, numero_factura) ⇒ bloquear.

Editar: precarga doc; updateDoc + updatedAt; imágenes en subcarpeta docId (merge sin duplicar); anti-dup: si existe otro doc con (proveedor, numero_factura) ⇒ bloquear (excluye el actual).

10) Estándares UI reutilizables
Toasts con Tailwind (bg-emerald-500/bg-red-500).

Copiar al clic: data-copy="..." + handler global.

Buscador de catálogo con tokens sobre nombre + clave.
