# Guía de interacción para Codex

Sigue estos pasos para iniciar sesión y acceder al flujo operativo de la aplicación:

1. Inicia la sesión del frontend (por ejemplo, ejecuta `npx serve .`) y abre `http://localhost/login.html`.
2. Introduce las credenciales de acceso:
   - **Correo electrónico:** `uge300889@gmail.com`
   - **Contraseña:** `Hola1511`
3. Haz clic en **Entrar** para que la autenticación se procese mediante Firebase Authentication.
4. Tras autenticarse, la aplicación redirigirá a `index.html` y mostrará un modal operativo. Captura los datos solicitados:
   - **Usuario:** `U001`
   - **PIN:** `1111`
5. Confirma la captura. Si el PIN es válido, el modal se cerrará, se activarán los permisos correspondientes y aparecerá el menú principal para continuar trabajando.

Asegúrate de repetir este flujo de inicio de sesión en cada nueva interacción con la aplicación.
