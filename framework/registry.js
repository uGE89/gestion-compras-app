export const registry = {
  'analizador-compra': () => import('../apps/analizador_compra.app.js'),
  'creador-pedido': () => import('../apps/creador_pedido.app.js'),
  'detalles': () => import('../apps/detalles_articulo.app.js'),
  'mis_pedidos': () => import('../apps/mis_pedidos.app.js'),
  'compras_historial': () => import('../apps/compras_historial.app.js'),
  'compras_registrar': () => import('../apps/compras_registrar.app.js'),
  'compras_detalles': () => import('../apps/compras_detalles.app.js'),
  'compras_editar': () => import('../apps/compras_editar.app.js'),  
};
