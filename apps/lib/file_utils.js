/**
 * Utilidades compartidas para manejo de archivos en las apps.
 *
 * Formatos de retorno:
 * - ensurePdfJs(): Promise<pdfjsLib> → instancia global configurada con el worker.
 * - pdfToImages(file, options?): Promise<string[]> → cada elemento es un Data URL `data:image/jpeg;base64,...` en orden de página.
 * - fileToDataURL(file): Promise<string> → Data URL `data:<mime>;base64,...` listo para previsualización o IA.
 * - dataUrlToBlob(url): Promise<Blob> → Blob creado a partir del recurso (acepta data URLs o URLs remotas).
 * - uploadToStorage(storage, blob, path, metadata?): Promise<string> → URL pública de descarga en Firebase Storage.
 */
import { ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

const PDF_JS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.min.js';
const PDF_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
let pdfJsLoadingPromise = null;

/**
 * Carga pdf.js dinámicamente si aún no está disponible y configura el worker.
 * @returns {Promise<any>} Instancia global de pdfjsLib lista para usarse.
 */
export async function ensurePdfJs() {
  const globalPdf = globalThis.pdfjsLib;
  if (globalPdf) {
    if (globalPdf?.GlobalWorkerOptions?.workerSrc !== PDF_WORKER_SRC) {
      globalPdf.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
    }
    return globalPdf;
  }
  if (!pdfJsLoadingPromise) {
    pdfJsLoadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PDF_JS_SRC;
      script.async = true;
      script.onload = () => {
        try {
          const lib = globalThis.pdfjsLib;
          if (!lib) throw new Error('pdfjsLib no se inicializó correctamente');
          lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
          resolve(lib);
        } catch (err) {
          reject(err);
        }
      };
      script.onerror = (err) => reject(err);
      document.head.appendChild(script);
    }).catch((err) => {
      pdfJsLoadingPromise = null;
      throw err;
    });
  }
  return pdfJsLoadingPromise;
}

/**
 * Convierte cada página de un PDF en una imagen en formato Data URL.
 * @param {File|Blob} file PDF a procesar.
 * @param {{ scale?: number, mimeType?: string, quality?: number }} [options]
 * @returns {Promise<string[]>} Array de Data URLs (`data:image/jpeg;base64,...`).
 */
export async function pdfToImages(file, { scale = 1.5, mimeType = 'image/jpeg', quality = 0.92 } = {}) {
  if (!file) return [];
  const pdfjsLib = await ensurePdfJs();
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const images = [];
  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
    const page = await pdf.getPage(pageIndex);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(canvas.toDataURL(mimeType, quality));
  }
  return images;
}

/**
 * Lee un archivo y devuelve su representación como Data URL.
 * @param {File|Blob} file
 * @returns {Promise<string>} Data URL con el contenido (`data:<mime>;base64,...`).
 */
export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Convierte una URL (data o remota) en un Blob.
 * @param {string} url
 * @returns {Promise<Blob>} Blob con el contenido descargado.
 */
export function dataUrlToBlob(url) {
  return fetch(url).then((response) => response.blob());
}

/**
 * Sube un archivo o blob a Firebase Storage y devuelve su URL pública.
 * @param {import('https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js').FirebaseStorage} storage
 * @param {Blob|File} fileOrBlob
 * @param {string} path
 * @param {import('https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js').UploadMetadata} [metadata]
 * @returns {Promise<string>} URL de descarga obtenida con getDownloadURL.
 */
export async function uploadToStorage(storage, fileOrBlob, path, metadata) {
  if (!storage) throw new Error('Firebase Storage no proporcionado');
  if (!path) throw new Error('El path de Storage es obligatorio');
  const storageRef = ref(storage, path);
  const snapshot = await uploadBytes(storageRef, fileOrBlob, metadata);
  return getDownloadURL(snapshot.ref);
}
