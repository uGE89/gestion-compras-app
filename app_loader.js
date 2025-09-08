/**
 * Carga dinámicamente el contenido de un archivo HTML en un contenedor específico.
 * @param {string} url - La URL del archivo HTML a cargar (ej. 'compras.html').
 * @param {HTMLElement} container - El elemento del DOM donde se insertará el contenido.
 */
export async function loadContent(url, container) {
    try {
        container.innerHTML = '<div class="text-center py-10">Cargando...</div>'; // Muestra un mensaje de carga

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`No se pudo cargar el contenido de ${url}`);
        }
        const html = await response.text();
        
        // Usamos un truco para procesar el HTML y poder extraer el script
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Extraer y ejecutar el script del módulo
const scriptElement = doc.querySelector('script[type="module"]');
if (scriptElement) {
    // Insertar primero el HTML en el contenedor
    container.innerHTML = doc.body ? doc.body.innerHTML : html;

    // Crear el nuevo script, respetando el tipo "module"
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
} else {
    container.innerHTML = html;
}

    } catch (error) {
        console.error('Error al cargar el contenido:', error);
        container.innerHTML = `<div class="text-center text-red-500 py-10">Error al cargar la sección.</div>`;
    }
}
