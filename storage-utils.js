import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

export async function uploadFileToStorage(
  file,
  storage = typeof window !== 'undefined' ? window.storage : undefined,
  userId = typeof window !== 'undefined' ? window.userId : undefined,
) {
  if (!storage) {
    throw new Error('Firebase storage instance is required');
  }
  if (!userId) {
    throw new Error('User ID is required');
  }
  const storageRef = ref(storage, `transfers/${userId}/${Date.now()}-${file.name}`);
  const snapshot = await uploadBytes(storageRef, file);
  return await getDownloadURL(snapshot.ref);
}