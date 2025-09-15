const assert = require('assert');

function createSplitRegex(delimiter) {
  const escaped = delimiter === '\t' ? '\\t' : delimiter;
  const safe = escaped.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
  return new RegExp(safe + '(?=(?:(?:[^\"]*\"){2})*[^\"]*$)');
}

assert.strictEqual(createSplitRegex('|').toString(), '/\\|(?=(?:(?:[^\"]*\"){2})*[^\"]*$)/');
assert.strictEqual(createSplitRegex('.').toString(), '/\\.(?=(?:(?:[^\"]*\"){2})*[^\"]*$)/');
assert.strictEqual(createSplitRegex(';').toString(), '/;(?=(?:(?:[^\"]*\"){2})*[^\"]*$)/');

console.log('Delimiter regex sanitization tests passed.');