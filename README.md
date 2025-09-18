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

## Autenticación

La inicialización de Firebase Authentication se centraliza en
[firebase-init.js](firebase-init.js). Anteriormente existía un módulo
independiente `auth.js`, pero se eliminó al no ser necesario y para evitar
confusiones con las importaciones de los SDKs oficiales de Firebase.

## Despliegue
El despliegue se realiza en **Firebase Hosting**:
```bash
firebase deploy
```

## Service Worker

El archivo [service-worker.js](service-worker.js) controla la caché del "app shell". Define la constante
`APP_VERSION`, usada para construir el nombre del caché (`gestion-compras-cache-<versión>`). Cambiar
este valor en cada despliegue fuerza la creación de un caché nuevo e invalida recursos antiguos.

El script implementa una estrategia **network-first** para HTML, JS y CSS, lo que prioriza obtener
los archivos más recientes de la red y solo cae al caché si no hay conexión. Para imágenes y otros
activos estáticos utiliza **cache-first**, entregando respuestas rápidas a costa de poder servir
contenido desactualizado.

Para aplicar inmediatamente una nueva versión, la aplicación puede enviar
`postMessage({ type: 'SKIP_WAITING' })` al Service Worker, provocando que la actualización se active
sin esperar a que el usuario recargue manualmente.
