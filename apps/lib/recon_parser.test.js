import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAccountNameToIdMap, normalizeBanco } from './recon_parser.js';

// Test mapping accepts both 'nombre' and 'name'
test('buildAccountNameToIdMap accepts multiple name fields', () => {
  const cuentas = [
    { id: 1, nombre: 'Caja' },
    { id: 2, name: 'Banco' },
  ];
  const { getIdByName } = buildAccountNameToIdMap(cuentas);
  assert.equal(getIdByName('caja'), 1);
  assert.equal(getIdByName('Banco'), 2);
  assert.equal(getIdByName('desconocida'), null);
});

// Test normalizeBanco supports variant columns and single monto scheme
test('normalizeBanco handles variant column names', () => {
  const rows = [
    { 'fecha operacion': '2024-01-01', 'numero de referencia': '123', detalle: 'dep', 'débito': '10' },
    { date: '2024-01-02', monto: '20', tipo: 'credito', ref: '456' },
    { fecha: '2024-01-03', valor: '5', naturaleza: 'debito', 'numero de confirmacion': '789', concepto: 'fee' },
  ];
  const { rows: norm } = normalizeBanco(rows, { cuentaId: 99, tipoCambio: 1 });
  const simplified = norm.map(r => ({
    fecha: r.fecha,
    nroConfirm: r.nroConfirm,
    descripcion: r.descripcion,
    montoNio: r.montoNio,
    signo: r.signo,
  }));
  assert.deepEqual(simplified, [
    { fecha: '2024-01-01', nroConfirm: '123', descripcion: 'dep', montoNio: -10, signo: 'out' },
    { fecha: '2024-01-02', nroConfirm: '456', descripcion: '', montoNio: 20, signo: 'in' },
    { fecha: '2024-01-03', nroConfirm: '789', descripcion: 'fee', montoNio: -5, signo: 'out' },
  ]);
});
