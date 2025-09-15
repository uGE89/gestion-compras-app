import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.es.min.js';

/**
 * Carga dinámicamente el contenido de un archivo HTML en un contenedor específico.
 * @param {string} url - La URL del archivo HTML a cargar (ej. 'compras.html').
 * @param {HTMLElement} container - El elemento del DOM donde se insertará el contenido.
 */
export async function loadContent(url, container) {
    try {
        // Muestra un mensaje de carga
        container.innerHTML = DOMPurify.sanitize('<div class="text-center py-10">Cargando...</div>');

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`No se pudo cargar el contenido de ${url}`);
        }
        const html = await response.text();

        // Usamos un truco para procesar el HTML y poder extraer el script
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Extraer el script del módulo si existe
        const scriptElement = doc.querySelector('script[type="module"]');
        if (scriptElement) {
            scriptElement.remove(); // Evita que DOMPurify lo elimine y nos permite ejecutarlo luego
        }

        // Sanitizar e insertar el HTML
        const sanitizedHtml = DOMPurify.sanitize(doc.body ? doc.body.innerHTML : html);
        container.innerHTML = sanitizedHtml;

        // Ejecutar el script del módulo después de la sanitización
        if (scriptElement) {
            const newScript = document.createElement('script');
            newScript.type = 'module';

            const src = scriptElement.getAttribute('src');
            if (src) {
                // Soporte para <script type="module" src="...">
                // Resuelve la URL relativa contra la página actual
                newScript.src = new URL(src, window.location.href).href;
            } else {
                // Soporte para inline <script type="module"> ... </script>
                newScript.textContent = scriptElement.textContent || '';
            }

            // Añadir al DOM para que se ejecute
            container.appendChild(newScript);
        }

    } catch (error) {
        console.error('Error al cargar el contenido:', error);
        container.innerHTML = DOMPurify.sanitize(`<div class="text-center text-red-500 py-10">Error al cargar la sección.</div>`);
    }
}