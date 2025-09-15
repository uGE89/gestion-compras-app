import { USD_TO_NIO_RATE } from './constants.js';

export function parseNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v.replace(/,/g, '')) || 0;
  return 0;
}

export function toNio(amount, currency, rate = USD_TO_NIO_RATE) {
  const num = parseNumber(amount);
  return currency === 'USD' ? num * rate : num;
}
