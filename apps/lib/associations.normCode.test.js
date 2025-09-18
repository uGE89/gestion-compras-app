const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, 'associations.js');
let source = fs.readFileSync(sourcePath, 'utf8');

// Remove import statements that are not needed for normalization logic.
source = source.replace(/import[^;]+;\n/g, '');
// Remove `export` keywords so the script can run in the VM context.
source = source.replace(/export\s+/g, '');
// Expose the helpers we want to assert on the sandbox.
source += '\nthis.normCode = normCode;\nthis.idProvCode = idProvCode;\n';

const sandbox = {};
vm.runInNewContext(source, sandbox, { filename: 'associations.js' });

const { normCode, idProvCode } = sandbox;

assert.strictEqual(normCode('ABC/123'), 'abc-2f-123', 'slashes should be encoded');
assert.strictEqual(normCode('  ABC-123  '), 'abc-123', 'trimming and casing should remain intact');
assert.strictEqual(normCode('ABC/123'), normCode('abc/123'), 'normalization should be case-insensitive');
assert.notStrictEqual(normCode('ABC/123'), normCode('ABC-123'), 'encoded slash should not collide with hyphen');
assert.strictEqual(normCode('abc\u0000def'), 'abc-00-def', 'control characters should be encoded');
assert.strictEqual(normCode('__name__'), '--name--', 'reserved document IDs should be adjusted');

const safeAbc123 = normCode('ABC/123');
assert.strictEqual(
  idProvCode('Proveedor Ejemplo', safeAbc123),
  'provcode:proveedor-ejemplo:abc-2f-123',
  'idProvCode should use the sanitized code'
);

const safe946 = normCode('94638/712');
assert.strictEqual(
  idProvCode('Proveedor Ejemplo', safe946),
  'provcode:proveedor-ejemplo:94638-2f-712',
  'idProvCode should reuse sanitized IDs for slashed provider codes'
);

console.log('associations.normCode tests passed');
