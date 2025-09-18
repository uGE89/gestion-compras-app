# Pruebas manuales

## Manejo de formularios de inicio de sesión incompletos
1. Abrir la aplicación y navegar al formulario de inicio de sesión.
2. Dejar el campo de correo vacío y completar la contraseña. Presionar **Entrar**.
   - Debe aparecer el mensaje "Por favor, completa todos los campos." y no debe procesarse el formulario.
3. Dejar la contraseña vacía y completar el correo. Presionar **Entrar**.
   - Debe aparecer el mismo mensaje y no debe procesarse el formulario.
4. Completar ambos campos con credenciales incorrectas y presionar **Entrar**.
   - Debe mostrarse el mensaje "Correo o contraseña incorrectos.".

## Asociaciones con códigos de proveedor que contienen `/`
1. Preparar un documento de proveedor con códigos que incluyan `/` (por ejemplo `ABC/123`) y otro equivalente sin el caracter (por ejemplo `ABC-123`).
2. Ejecutar el flujo de asociación de artículos (por ejemplo desde compras o cotizaciones) con ambos códigos.
3. Confirmar que el código con `/` ya no arroja `FirebaseError: Invalid document reference` y se persiste correctamente.
4. Verificar que los dos códigos resuelven asociaciones distintas (`ABC/123` no debe sobrescribir la asociación de `ABC-123`).
