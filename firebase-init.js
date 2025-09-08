import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
// ✅ AÑADIDO: Importa la función para Storage
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

export const firebaseConfig = {
    apiKey: "AIzaSyCPeJ-uaDBJfX6wmEZc2EV8hgzq7Z_Gw4o",
    authDomain: "gestion-compras-app.firebaseapp.com",
    projectId: "gestion-compras-app",
    storageBucket: "gestion-compras-app.firebasestorage.app",
    messagingSenderId: "546037523332",
    appId: "1:546037523332:web:7f71a9760fd3885b0df3d1",
    measurementId: "G-ZTVEZBMBK0"
};

const app = initializeApp(firebaseConfig);

// Inicializa y exporta todos los servicios necesarios
export const auth = getAuth(app);
export const db = getFirestore(app);
// ✅ AÑADIDO: Inicializa y exporta Storage
export const storage = getStorage(app);
