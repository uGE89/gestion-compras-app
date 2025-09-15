import { TAILWIND_CDN } from './apps/lib/constants.js';

export function ensureTailwindCdn() {
  const hasTailwind = Array.from(document.scripts || []).some(
    (script) => script.src === TAILWIND_CDN || script.dataset?.tailwindCdn === 'true',
  );

  if (hasTailwind) {
    return;
  }

  const tailwindScript = document.createElement('script');
  tailwindScript.src = TAILWIND_CDN;
  tailwindScript.dataset.tailwindCdn = 'true';
  document.head.appendChild(tailwindScript);
}

ensureTailwindCdn();
