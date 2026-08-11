# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

Extensión de VS Code (TypeScript, CommonJS) que cambia las referencias de ambiente (DESARROLLO / TEST / PRODUCCION) dentro de scripts JCL de mainframe. La especificación funcional completa está en `docs/spec.md` y es la fuente de verdad del comportamiento esperado.

## Comandos

```bash
npm run compile      # tsc -p ./  → out/
npm run watch        # tsc en modo watch
npm run package      # vsce package → .vsix
npx tsc -p ./ --noEmit   # typecheck sin emitir
npm test             # mocha sobre src/test/**/*.test.ts
```

Para probar la extensión: F5 en VS Code (launch config `Run Extension`, corre `npm: compile` como preLaunchTask y abre un Extension Development Host).

Para acotar la corrida de tests:

```bash
npx mocha 'src/test/replacementEngine.test.ts'              # un archivo
npx mocha 'src/test/**/*.test.ts' -g "comentarios"          # un test por nombre
```

`.mocharc.json` solo carga `ts-node/register`; el glob vive en el script `test` de `package.json` a propósito. Si se pusiera `spec` en `.mocharc.json`, mocha lo **suma** al argumento de la línea de comandos en vez de reemplazarlo, y pasar un archivo suelto seguiría corriendo la suite entera.

Los tests cubren `core/` (parser, motor, detector) y el render del webview — ninguno importa `vscode`, por eso corren sin el Extension Host.

`src/test/webview.test.ts` es el único que no prueba TypeScript: ejecuta `media/configWebView.js` con el módulo `vm` sobre un DOM de mentira y fija las invariantes de accesibilidad del render (cada campo con su `<label for>` apuntando a un id existente, ids únicos, `aria-label` propio en el botón destructivo, estados vacíos con explicación). ts-node carga estos tests como ES module, así que **`__dirname` no existe**: usa `process.cwd()` para rutas a assets, que mocha corre desde la raíz.

## Encoding: todo el repo es UTF-8

Los fuentes estuvieron guardados en ISO-8859-1, y eso rompía en silencio todos los mensajes al usuario: `tsc` los lee como UTF-8, encuentra bytes inválidos y emite U+FFFD, así que el `out/` publicado mostraba `configuraci?n`. Ya están convertidos; no vuelvas a guardar nada en ISO-8859-1.

El daño es irreversible una vez escrito (U+FFFD no recuerda qué carácter era), así que conviene chequearlo antes de publicar. Como `out/` está versionado, el chequeo cubre fuentes y build de una sola vez:

```bash
grep -rl $'\xef\xbf\xbd' --exclude-dir=.git --exclude-dir=node_modules .   # debe salir vacío
```

Cuidado con `package.json`: sus textos (`description`, los `title` de comandos, las `description` de settings) se publican en el marketplace y salen en la paleta de comandos, y ya vinieron con U+FFFD grabado una vez.

## Arquitectura

Flujo de una operación: `extension.ts` → `JclParser` → (`EnvironmentDetector` para leer estado | `ReplacementEngine` para mutar) → edición del `TextDocument`.

### `core/jclParser.ts` — el guardián de las reglas inquebrantables

Convierte texto en `ParsedLine[]` con un flag `isMutable`. **Toda** la protección de comentarios (`//*`) y de datos en línea (bloques entre `DD *`/`DD DATA` y `/*` en columna 1) vive aquí, como `isMutable: false`. El detector y el motor jamás re-inspeccionan el texto para decidir si pueden tocar una línea: confían en `isMutable`. Si añades una regla de protección nueva, va en el parser, no en los consumidores.

### `core/replacementEngine.ts` — orden de prioridad

`applyEnvironmentToText()` aplica en este orden, y el orden importa:

1. **Block templates** (`applyBlockTemplates`): reemplaza bloques enteros DD + continuaciones anónimas (`//        DD ...`), pudiendo cambiar la cantidad de líneas. Las líneas insertadas se marcan `fromTemplate: true` y quedan exentas de los pasos siguientes (la plantilla se copia tal cual, preservando columnas). Cuenta **1 solo reemplazo** por bloque. Si falta la plantilla del ambiente destino, el bloque entero se marca inmutable y se emite un warning en vez de dejarlo a medias.
2. **Complete dataset rules** (mapeo exacto de DSN completo) — mayor prioridad que los prefijos.
3. **Prefix mappings** (primer segmento del DSN antes del punto). Un prefijo que no matchea ninguna regla se acumula en `unknownPrefixes` y no se toca.
4. **Parameter rules** (`CLASS=`, etc.). `DSN` se excluye explícitamente aquí porque ya lo maneja el paso de datasets. Solo sustituye si el valor actual es uno de los valores conocidos de la regla, para no pisar valores ajenos.

El resultado (`ReplacementResult`) nunca lanza excepciones: acumula `warnings` y `unknownPrefixes` que `extension.ts` muestra como notificaciones y vuelca al output channel `JCL Switcher`.

### `core/environmentDetector.ts` — scoring y ambigüedad

Recorre el mismo `ParsedLine[]` sumando puntos por ambiente:

| Evidencia | Puntos |
|---|---|
| Bloque coincide exactamente con una plantilla | 100 |
| DSN coincide con una `completeDatasetRule` | 100 |
| Prefijo de DSN coincide con un `prefixMapping` | 20 |
| Parámetro coincide (ej. `CLASS=D`) | 1 |

Empate en el puntaje máximo → `isAmbiguous: true` → la status bar muestra `$(warning) JCL: Mixto` y `switchEnvironment` **bloquea** el cambio hasta que el usuario ejecute `markAs`. Los pesos están calibrados para que un `CLASS=` compartido entre DEV y TEST no decida por sí solo.

### Código duplicado deliberado entre detector y motor

`DSN_REGEX`, `ANONYMOUS_DD_REGEX`, `findBlockName`, `findBlockEnd`, `normalize`, `escapeRegExp` y `areArraysEqual` están **copiados** en `environmentDetector.ts` y `replacementEngine.ts`. Si cambias uno, cambia el otro o detección y reemplazo divergen (síntoma clásico: la extensión detecta PRODUCCION pero al cambiar reporta 0 reemplazos).

### `normalize()`: los ambientes no son un enum

No hay lista fija de ambientes. Los nombres salen de las **claves** de la config del usuario (`getKnownEnvironments()` los recolecta de los cuatro modelos de reglas). Toda comparación de ambientes, prefijos y datasets pasa por `normalize()`: NFD + quitar diacríticos + trim + uppercase. Por eso `PRODUCCIÓN`, `produccion` y `Produccion` son la misma clave, y `envOriginal` guarda la etiqueta original para mostrarla en la UI.

### Configuración: `jcl-environments.json`

Resolución en `core/configLoader.ts`: setting `jclSwitcher.configFilePath` (absoluto, o relativo al primer workspace folder) → si está vacío, primer match de `findFiles('**/jcl-environments.json')`. Un `FileSystemWatcher` sobre ese glob recarga config y detector en caliente. Los cuatro modelos de reglas están tipados en `core/config.types.ts` y validados vía `jcl-environments.schema.json` (asociado por `contributes.jsonValidation`). Ejemplo funcional en `ejemplos/`.

### Restauración en dos capas (`restoreOriginal`)

Capa 1: `executeCommand('undo')` y se **verifica** que el texto resultante sea igual a `lastOriginalTexts` — si no coincide, cae a capa 2. Capa 2: `.jcl.bak` escrito por `BackupService.ensureBackup()` antes del primer cambio (nunca sobrescribe uno existente; para documentos untitled usa un backup en memoria). Si el backup falla, `applyEnvironment` aborta sin tocar el archivo.

El estado por documento en `extension.ts` (`manualOverrides`, `detectionCache`, `lastOriginalTexts`, `extensionEditedDocuments`) se indexa por `document.uri.toString()` y se limpia en `onDidCloseTextDocument`.

### WebView de configuración

`src/webview/configWebView.ts` genera el HTML; `media/configWebView.js` y `.css` son assets planos que **no pasan por tsc** (`rootDir` es `src`) — se cargan tal cual vía `asWebviewUri`. Ojo con la forma de los datos: en el estado del webview `blockTemplates` es un **array** de `{ name, templates }`, mientras que en la config persistida es un **objeto** `Record<name, Record<env, string[]>>`. La conversión ocurre en ambos sentidos dentro de `media/configWebView.js`.

Las secciones de reglas se dibujan con **un solo** par `renderSection`/`buildCard` guiado por el array `SECTIONS`; para agregar una sección nueva se añade una entrada ahí, no una función de render. Los nombres de clase que declara cada entrada (`headerClass`, `fieldClass`) son un **contrato con `collectState()`**, que lee el DOM por esos selectores para reconstruir la config: si cambias uno, el guardado se rompe en silencio.

#### El buscador esconde tarjetas, no deja de dibujarlas

Cuando una lista pasa de `SEARCH_THRESHOLD` (5) reglas aparece una barra de búsqueda en esa pestaña. `applyFilter()` marca con `.hidden` las tarjetas que no coinciden **sin sacarlas del DOM**, y eso no es cosmético: `collectState()` reconstruye la config leyendo las tarjetas dibujadas, así que una regla filtrada que no estuviera en el DOM desaparecería del JSON al guardar, sin ningún error visible. Si alguna vez hace falta re-renderizar solo lo que coincide, primero hay que hacer que `collectState()` trabaje sobre `state` en vez del DOM.

Los ids de la barra se derivan del `listId` (`prefix-list` → `prefix-search`, `prefix-count`, `prefix-toolbar`) en `searchId()`/`countId()`/`toolbarId()`; el HTML lo genera `searchBar()` en `configWebView.ts` siguiendo esa misma convención.

#### Librerías y Bloques son la misma configuración

`blockTemplates` se muestra en **dos pestañas**. `splitBlockTemplates()` lo parte al cargar: si todas las líneas de todos los ambientes de un bloque calzan con `LIBRARY_LINE_REGEX` (`//DDNAME   DD  DSN=x,DISP=SHR`, continuaciones sin nombre), ese bloque se edita en **Librerías** como una lista de datasets; cualquier otra cosa —otro `DISP`, parámetros extra— cae en **Bloques** y se sigue editando línea por línea. `buildConfig()` los fusiona de vuelta en el único `blockTemplates` que entiende el motor, generando las líneas con `buildLibraryLine()`.

No hay modelo nuevo ni migración: el JSON no cambió. Pero **generar y parsear tienen que seguir siendo inversos**; si divergen, un JOBLIB guardado desde Librerías reaparece en Bloques al recargar, sin ningún error visible. `src/test/webview.test.ts` fija ese ida y vuelta y el formato exacto de columnas. Si un mismo nombre existiera en las dos pestañas gana el bloque literal, porque se escribe después.

El CSS solo puede usar variables `--vscode-*`; el CSP del panel es `default-src 'none'`, así que fuentes externas o assets remotos no cargan. El borrado confirma en dos pasos sobre el propio botón porque `confirm()` y demás diálogos nativos **bloquean el webview** entero.

## Archivos referenciados que no existen

`package.json` declara `"configuration": "./language-configuration.json"` para el lenguaje `jcl`, pero el archivo no está en el repo. `docs/estructura.md` también lista `README.md` y no existe — trata ese doc como plan, no como inventario.
