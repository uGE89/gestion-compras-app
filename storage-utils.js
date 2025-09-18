import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

export async function uploadToStorage({ storage, path, fileOrBlob }) {
  if (!storage) {
    throw new Error('Firebase storage instance is required');
  }
  if (!path) {
    throw new Error('Storage path is required');
  }
  if (!fileOrBlob) {
    throw new Error('File or Blob is required');
  }

  if (typeof Blob !== 'undefined' && !(fileOrBlob instanceof Blob)) {
    throw new Error('fileOrBlob must be a File or Blob instance');
  }

  const storageRef = ref(storage, path);
  const snapshot = await uploadBytes(storageRef, fileOrBlob);
  return getDownloadURL(snapshot.ref);
}
