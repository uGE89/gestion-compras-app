export const registry = {
  'analizador-compra': () => import('../apps/analizador_compra.app.js'),
  'creador_pedido': () => import('../apps/creador_pedido.app.js'),
  'detalles': () => import('../apps/detalles_articulo.app.js'),
  'mis_pedidos': () => import('../apps/mis_pedidos.app.js'),
  'compras_historial': () => import('../apps/compras_historial.app.js'),
  'compras_registrar': () => import('../apps/compras_registrar.app.js'),
  'compras_detalles': () => import('../apps/compras_detalles.app.js'),
  'compras_editar': () => import('../apps/compras_editar.app.js'),  
  'cotizaciones_historial': () => import('../apps/cotizaciones_historial.app.js'),
  'cotizaciones_registrar': () => import('../apps/cotizaciones_registrar.app.js'),
  'cotizaciones_comparar':  () => import('../apps/cotizaciones_comparar.app.js'),
  'cotizaciones_detalles' : () => import('../apps/cotizaciones_detalles.app.js'),
  'cotizaciones_editar'   : () => import('../apps/cotizaciones_editar.app.js'),

};
