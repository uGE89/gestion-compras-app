export const FIREBASE_VERSION = '11.6.1';
export const FIREBASE_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
export const PDFJS_VERSION = '2.11.338';
export const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`;
export const DEFAULT_EXCHANGE_RATE = 1;
export const USD_TO_NIO_RATE = 36.6;

export const AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_FLASH = 'gemini-1.5-flash-latest';
export const GEMINI_PRO = 'gemini-1.5-pro-latest';

export const buildAiUrl = (model) => `${AI_BASE_URL}/models/${model}:generateContent?key=`;
