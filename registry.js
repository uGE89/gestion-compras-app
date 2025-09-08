export const registry = {
  plantilla:  () => import('../apps/plantilla.app.js'),
  miapp:      () => import('../apps/miapp.app.js'), // ← nuevo
  'analizador-compra': () => import('../apps/analizador_compra.app.js'),
  'creador-pedido': () => import('../apps/creador_pedido.app.js'),
  'detalles': () => import('../apps/detalles_articulo.app.js'),
  'mis_pedidos': () => import('../apps/mis_pedidos.app.js'),


};
