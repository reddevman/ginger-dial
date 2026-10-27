# Ginger Dial

Extensión Manifest V3 para Chrome y Firefox que sustituye la nueva pestaña por una cuadrícula de accesos rápidos. Es una implementación original inspirada en el comportamiento público de las extensiones _speed dial_.

## Privacidad

- Los grupos, accesos y preferencias se guardan exclusivamente en `storage.local` del navegador.
- Los fondos personalizados se optimizan a WebP y se guardan en el mismo almacenamiento local.
- No hay cuenta, telemetría, sincronización ni API remota. Firefox solicita un permiso opcional para el dominio elegido solo si usas una URL de icono personalizada.
- La exportación e importación se hace mediante un archivo JSON local iniciado por el usuario.

## Fondos y temas

La pantalla de personalización incluye seis fondos predefinidos originales, tema claro/oscuro/sistema, intensidad regulable y carga de imágenes PNG, JPEG o WebP desde el ordenador. Las imágenes se limitan a 25 MB de entrada y se reducen a un máximo de 2560×1440 antes de guardarse.

## Crear los paquetes

```bash
npm run build
```

El comando genera dos carpetas autocontenidas y locales:

- `chrome/` para Chrome.
- `firefox/` para Firefox.

Estas carpetas se regeneran y no se versionan. Las fuentes compartidas están en `shared/` y los manifiestos específicos en `platforms/`.
Los iconos y fondos versionados se incluyen al generar los paquetes. Si no están disponibles, el build crea un icono de reserva reproducible; no se versiona material de firma privado.

## Probar en Chrome

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y selecciona la carpeta `chrome/` generada.
4. Abre una pestaña nueva.

## Probar en Firefox

1. Abre `about:debugging#/runtime/this-firefox`.
2. Pulsa **Cargar complemento temporal**.
3. Selecciona `firefox/manifest.json` dentro de la carpeta generada. Aunque Firefox admite cualquier archivo del paquete, el manifiesto identifica claramente la extensión.
4. Abre una pestaña nueva y prueba los marcadores, la importación y un icono personalizado por URL.

La carpeta `firefox/` contiene el manifiesto, los scripts, la interfaz, los iconos y los fondos: se debe conservar completa. Esta instalación es temporal y Firefox la elimina al reiniciarse. Para distribuirla o instalarla de forma permanente, hay que empaquetar los contenidos como un archivo `.xpi` y obtener la firma de Mozilla, normalmente mediante [AMO](https://addons.mozilla.org/developers/).

## Validación

```bash
npm test
```
