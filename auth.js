// auth.js - Módulo reutilizable para la autenticación de Firebase

// --- Importaciones de Firebase ---
import { FIREBASE_BASE } from './apps/lib/constants.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from `${FIREBASE_BASE}firebase-auth.js`;

// --- Variables del Módulo ---
let auth;

/**
 * Inicializa el módulo de autenticación y maneja el estado del usuario.
 * @param {string} loginContainerId - El ID del elemento del DOM donde se inyectará el login.
 * @param {function} onAuthStateChangeCallback - Una función que se ejecutará cuando el estado de autenticación cambie. Recibe el objeto 'user' o 'null'.
 */
export function initAuth(loginContainerId, onAuthStateChangeCallback) {
    // Obtenemos la instancia de Auth que ya fue inicializada en la app principal
    auth = getAuth();

    const loginContainer = document.getElementById(loginContainerId);
    if (!loginContainer) {
        console.error(`Error: No se encontró el contenedor de login con el ID '${loginContainerId}'.`);
        return;
    }

    // Cargar el HTML del formulario de login
    fetch('login.html')
        .then(response => {
            if (!response.ok) {
                throw new Error("No se pudo cargar login.html. Asegúrate de que el archivo exista en la misma carpeta.");
            }
            return response.text();
        })
        .then(html => {
            loginContainer.innerHTML = html;
            setupLoginForm();
        })
        .catch(error => {
            console.error("Error al cargar el formulario de login:", error);
            loginContainer.innerHTML = `<p class="text-red-500 text-center">${error.message}</p>`;
        });

    // Escuchar cambios en la autenticación
    onAuthStateChanged(auth, (user) => {
        const loginContainer = document.getElementById(loginContainerId);
        if (user) {
            // Usuario ha iniciado sesión
            loginContainer.style.display = 'none';
        } else {
            // Usuario ha cerrado sesión
            loginContainer.style.display = 'flex';
        }
        // Informar a la aplicación principal sobre el cambio
        onAuthStateChangeCallback(user);
    });
}

/**
 * Configura los event listeners para el formulario de login.
 */
function setupLoginForm() {
    const loginForm = document.getElementById('login-form');
    const loginError = document.getElementById('login-error');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = loginForm.email.value;
            const password = loginForm.password.value;
            if (!loginError) {
                console.error("Error: No se encontró el contenedor de error de login.");
                return;
            }
            loginError.classList.add('hidden');

            if (!email || !password) {
                loginError.textContent = "Por favor, completa todos los campos.";
                loginError.classList.remove('hidden');
                return;
            }

            try {
                await signInWithEmailAndPassword(auth, email, password);
                // onAuthStateChanged se encargará de ocultar el formulario
            } catch (error) {
                console.error("Error de inicio de sesión:", error);
                loginError.textContent = "Correo o contraseña incorrectos.";
                loginError.classList.remove('hidden');
            }
        });
    }
}

/**
 * Cierra la sesión del usuario actual.
 * @returns {Promise<void>}
 */
export function logout() {
    if (!auth) {
        console.error("Auth no ha sido inicializado.");
        return;
    }
    return signOut(auth);
}
