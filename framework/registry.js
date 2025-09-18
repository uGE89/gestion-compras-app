const modUrl = (path) => new URL(path, import.meta.url).href;

const loaders = {
  'creador_pedido': () => import(modUrl('../apps/creador_pedido.app.js')),
  'detalles': () => import(modUrl('../apps/detalles_articulo.app.js')),
  'mis_pedidos': () => import(modUrl('../apps/mis_pedidos.app.js')),
  'caja_historial': () => import(modUrl('../apps/caja_historial.app.js')),
  'caja_detalle': () => import(modUrl('../apps/caja_detalle.app.js')),
  'caja_editar':  () => import(modUrl('../apps/caja_editar.app.js')),
  'caja_formulario': () => import(modUrl('../apps/caja_formulario.app.js')),
  'caja_registrar': () => import(modUrl('../apps/caja_registrar.app.js')),
  'caja_transferir': () => import(modUrl('../apps/caja_transferir.app.js')),
  'caja_chica_historial': () => import(modUrl('../apps/caja_chica_historial.app.js')),
  'compras_historial': () => import(modUrl('../apps/compras_historial.app.js')),
  'compras_registrar': () => import(modUrl('../apps/compras_registrar.app.js')),
  'compras_detalles': () => import(modUrl('../apps/compras_detalles.app.js')),
  'compras_editar': () => import(modUrl('../apps/compras_editar.app.js')),
  'cotizaciones_historial': () => import(modUrl('../apps/cotizaciones_historial.app.js')),
  'cotizaciones_registrar': () => import(modUrl('../apps/cotizaciones_registrar.app.js')),
  'cotizaciones_comparar':  () => import(modUrl('../apps/cotizaciones_comparar.app.js')),
  'cotizaciones_detalles' : () => import(modUrl('../apps/cotizaciones_detalles.app.js')),
  'cotizaciones_editar'   : () => import(modUrl('../apps/cotizaciones_editar.app.js')),
  'conciliacion'          : () => import(modUrl('../apps/conciliacion.app.js')),
  'jefe_caja'             : () => import(modUrl('../apps/jefe_caja.app.js')),
  'usuarios_admin'        : () => import(modUrl('../apps/usuarios_admin.app.js')),
};

const normalize = (name) => (name == null ? '' : String(name)).replace(/-/g, '_');

export const registry = {
  ...loaders,
  get(name) {
    const normalized = normalize(name);
    return loaders[normalized] ?? null;
  },
  has(name) {
    const normalized = normalize(name);
    return Object.prototype.hasOwnProperty.call(loaders, normalized);
  },
  load(name) {
    const loader = this.get(name);
    if (typeof loader !== 'function') {
      throw new Error(`No existe un loader para la ruta "${name}"`);
    }
    return loader();
  },
};
