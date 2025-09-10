# Gestión de Compras App

## Resumen del proyecto
Aplicación web para gestionar procesos de compra utilizando **ES Modules**. Integra servicios de **Firebase** y análisis de datos en **BigQuery**.

## Estructura de directorios
- [apps/](apps/) – módulos de la aplicación para cada flujo de trabajo.
- [framework/](framework/) – utilidades y componentes reutilizables.
- [docs/](docs/) – documentación adicional y pruebas manuales.

## Cómo ejecutar en desarrollo
1. Instalar las herramientas de Firebase si aún no se tienen:
   ```bash
   npm install -g firebase-tools
   ```
2. Ejecutar un servidor estático (por ejemplo `npx serve .`) **o** iniciar los emuladores de Firebase:
   ```bash
   firebase emulators:start
   ```

## Despliegue
El despliegue se realiza en **Firebase Hosting**:
```bash
firebase deploy
```
El archivo [service-worker.js](service-worker.js) se encarga de la caché y actualizaciones de recursos en producción.
