# Pruebas manuales

## Manejo de formularios de inicio de sesión incompletos
1. Abrir la aplicación y navegar al formulario de inicio de sesión.
2. Dejar el campo de correo vacío y completar la contraseña. Presionar **Entrar**.
   - Debe aparecer el mensaje "Por favor, completa todos los campos." y no debe procesarse el formulario.
3. Dejar la contraseña vacía y completar el correo. Presionar **Entrar**.
   - Debe aparecer el mismo mensaje y no debe procesarse el formulario.
4. Completar ambos campos con credenciales incorrectas y presionar **Entrar**.
   - Debe mostrarse el mensaje "Correo o contraseña incorrectos.".
