import test from 'node:test';
import assert from 'node:assert/strict';
import { autoHeaderObjects, detectSourceType } from './recon_utils.js';

test('detects header with accentless variants', () => {
  const matrix = [
    ['x', 'y', 'z'],
    ['Fecha', 'Numero de confirmacion', 'Valor En NIO', 'Cuenta'],
    ['2024-01-01', '123', '456', 'Main'],
  ];
  const rows = autoHeaderObjects(matrix);
  assert.deepEqual(rows, [
    {
      fecha: '2024-01-01',
      'numero de confirmacion': '123',
      'valor en nio': '456',
      cuenta: 'Main',
    },
  ]);
});

test('detects header with mixed accents and case', () => {
  const matrix = [
    ['foo', 'bar'],
    ['Número de confirmación', 'VALOR EN NIO', 'Cuenta', 'Fecha'],
    ['123', '100', 'ACC', '2025-02-03'],
  ];
  const rows = autoHeaderObjects(matrix);
  assert.deepEqual(rows, [
    {
      'numero de confirmacion': '123',
      'valor en nio': '100',
      cuenta: 'ACC',
      fecha: '2025-02-03',
    },
  ]);
});

test('detectSourceType identifies sources and handles conflicts', () => {
  const alegra = [{ Cuenta: 'Caja', 'Valor en NIO': '10' }];
  const banco = [{ Debito: '5', Credito: '0', Referencia: 'abc' }];
  const mixed = [{ Cuenta: 'Main', Debito: '1', Valor: '50' }];
  assert.equal(detectSourceType(alegra), 'alegra');
  assert.equal(detectSourceType(banco), 'banco');
  assert.equal(detectSourceType([]), 'unknown');
  assert.equal(detectSourceType(mixed), 'alegra');
});
