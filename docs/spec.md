# Spec: Extensión VS Code - JCL Environment Switcher

## 1. Resumen del Proyecto (Product Overview)
Esta extensión de VS Code permite a los desarrolladores Mainframe cambiar dinámicamente las referencias de ambiente (DESARROLLO, TEST, PRODUCCIÓN) dentro de scripts JCL (Job Control Language).

El objetivo es proporcionar una herramienta **genérica y altamente configurable** que evite búsquedas y reemplazos manuales propensos a errores. La extensión no tiene reglas "quemadas" (hardcodeadas) en el código; en su lugar, lee un archivo de configuración (JSON) donde cada desarrollador o empresa define sus propias convenciones de nomenclatura, librerías y parámetros.

## 2. Reglas del Dominio y Contexto (Reglas Inquebrantables del JCL)
El agente de IA debe programar la lógica de parsing respetando estrictamente estas reglas al manipular el texto del editor:

*   **Regla 1 (Comentarios Intocables):** Cualquier línea que comience con `//*` (columnas 1-3) es un comentario. **NUNCA** se debe modificar, buscar ni reemplazar texto dentro de estas líneas.
*   **Regla 2 (Datos en Línea Intocables por defecto):** El texto que se encuentra entre un `DD *` (ej. `//SYSIN DD *`) y el delimitador `/*` en la columna 1 es data de entrada en línea. Por defecto, **NUNCA** se debe modificar, a menos que exista una regla de configuración explícita que autorice tocar un DDNAME específico dentro del SYSIN.
*   **Regla 3 (Formato JCL y Espacios):** El JCL es sensible a posiciones. Las sustituciones de texto deben preservar el resto de la línea intacta. Si un prefijo cambia de longitud (ej. `PROD` a `DESA`), se acepta el cambio de longitud de la cadena, pero no se deben añadir ni quitar espacios en blanco arbitrarios que rompan la alineación de columnas del JCL.
*   **Regla 4 (Activación):** La extensión solo debe activarse y mostrar su UI en archivos con extensión `.jcl`, `.jclinc`, `.proc` o cuyo lenguaje configurado sea `JCL`.

## 3. Arquitectura de Configuración
La extensión utilizará un archivo de configuración global (ej. `jcl-environments.json`) que soporta tres modelos de reglas. El usuario podrá editar este archivo mediante una interfaz visual (WebView) o directamente en formato JSON (con soporte de JSON Schema para autocompletado).

### 3.1. Modelo de Prefijos Mapeables (Prefix Mappings)
Define cómo se reemplazan los prefijos (primer segmento antes del punto) de los datasets (`DSN=`).
```json
"prefixMappings": [
  {
    "sourcePrefix": "PROD",
    "environmentTargets": {
      "DESARROLLO": "DESA",
      "TEST": "TEST",
      "PRODUCCION": "PROD"
    }
  }
]
Comportamiento: Busca DSN=PROD.XXX y lo cambia a DSN=DESA.XXX si el destino es DESARROLLO.
3.2. Modelo de Reglas de Dataset Completo (Complete Dataset Rules)
Define mapeos bidireccionales exactos para datasets específicos donde la estructura del nombre cambia completamente entre ambientes. Tiene mayor prioridad que los Prefijos Mapeables.

"completeDatasetRules": [
  {
    "name": "Datasets de NW",
    "environments": {
      "PRODUCCION": "PXXX.NW.EJEMPLO",
      "DESARROLLO": "DXXX.WWW.NW.EJEMPLO"
    }
  }
]

3.3. Modelo de Plantillas de Bloque (Block Templates)
Permite definir bloques completos de código JCL (como un JOBLIB o STEPLIB concatenado) para cada ambiente. La herramienta identificará el bloque actual, lo eliminará por completo e insertará las líneas configuradas para el ambiente destino.

"blockTemplates": {
  "JOBLIB": {
    "PRODUCCION": [
      "//JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR",
      "//                DD  DSN=DB2.AAAA,DISP=SHR"
    ],
    "DESARROLLO": [
      "//JOBLIB   DD  DSN=DESA.BATCH.LOADLIB,DISP=SHR",
      "//                DD  DSN=DB2.BBBB,DISP=SHR",
      "//                DD  DSN=DB2.BBBBLOAD,DISP=SHR"
    ]
  }
}

Comportamiento: Soporta que un ambiente tenga 2 líneas y otro tenga 5 líneas. Preserva el formato exacto de columnas escrito en la configuración.

3.3.1. Vista de Librerías (sobre el mismo modelo)
El caso más frecuente de plantilla de bloque es una concatenación de librerías (JOBLIB / STEPLIB) donde todas las líneas son iguales salvo el nombre del dataset. Para no obligar al usuario a escribir JCL a mano, la interfaz visual ofrece la pestaña "Librerías", donde solo se cargan los nombres de los datasets —uno por línea, por ambiente— y la herramienta genera las líneas DD con el formato correcto:

//JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR
//         DD  DSN=DB2.AAAA.LOADLIB,DISP=SHR

El DDNAME ocupa las columnas 3-10, DD las 12-13 y los operandos arrancan en la 16; las continuaciones van sin nombre. No es un modelo de configuración nuevo: se guarda en blockTemplates y el motor lo procesa igual que cualquier otro bloque. Un bloque cuyas líneas no calcen con este formato (por ejemplo un DISP distinto de SHR, o parámetros adicionales) se sigue editando en la pestaña "Bloques", línea por línea.

3.4. Modelo de Parámetros JCL (Parameter Rules)
Para parámetros que no son DSN, como el CLASS= en la tarjeta JOB.

"parameterRules": [
  {
    "parameter": "CLASS",
    "values": {
      "PRODUCCION": "A",
      "DESARROLLO": "D",
      "TEST": "D"
    }
  }
]

4. Lógica de Detección de Ambiente
Cuando el usuario abre un JCL, la extensión debe intentar detectar el ambiente actual automáticamente:
Escaneo: Busca DSN= y bloques configurados (como JOBLIB).
Coincidencia: Compara los hallazgos con la configuración. Si la mayoría de los datasets/bloques coinciden con las reglas de "PRODUCCION", marca el ambiente como PRODUCCION.
Ambigüedad: Si hay mezcla de ambientes (ej. CLASS=A pero datasets de DESARROLLO) o si CLASS=D aplica tanto a DEV como a TEST y no hay datasets concluyentes, la extensión marcará el estado como "Ambiguo / Mixto" y obligará al usuario a definirlo manualmente antes de permitir cambios automáticos.
Prefijos Desconocidos: Si encuentra prefijos en los DSN= que no están en ninguna regla de la configuración, no los modifica y los almacena en una lista para mostrar una advertencia posterior.
5. Interfaz de Usuario (User Interface)
5.1. Barra de Estado (Status Bar)
Ubicación: Esquina inferior derecha.
Visualización: $(server-environment) JCL: [AMBIENTE] (Ej: JCL: PRODUCCIÓN).
Comportamiento: Al hacer clic, abre un vscode.QuickPick para seleccionar el ambiente destino.
Estados: Si el archivo no es JCL, el botón se oculta. Si el ambiente es ambiguo, muestra $(warning) JCL: Mixto.
5.2. Paleta de Comandos (Command Palette)
JCL Switcher: Cambiar a [Ambiente] (Un comando por cada ambiente configurado).
JCL Switcher: Marcar ambiente actual como... (Fuerza la detección manual mediante QuickPick).
JCL Switcher: Restaurar JCL original (Revierte cambios).
JCL Switcher: Configurar Ambientes (Visual) (Abre WebView).
JCL Switcher: Editar Configuración (JSON) (Abre el archivo JSON).
5.3. Estrategia de Restauración (Opción C)
El comando "Restaurar JCL original" funcionará con una estrategia de doble capa:
Capa 1 (Nativa): Intenta ejecutar un undo programático sobre las ediciones realizadas por la extensión en la sesión actual.
Capa 2 (Backup): Si el historial de undo no está disponible (ej. el archivo fue guardado y cerrado), la extensión buscará un backup temporal (.jcl.bak) que se crea silenciosamente antes de cada cambio grande y restaurará el contenido desde allí.
5.4. Búsqueda dentro de las listas
Una instalación real puede tener decenas de prefijos, datasets o librerías, y dibujarlos todos deja una pantalla imposible de recorrer. Cada pestaña con lista muestra una barra de búsqueda cuando supera las 5 reglas: filtra por cualquiera de los campos de la regla (el nombre y el valor de cada ambiente), ignorando mayúsculas y acentos, e indica cuántas reglas se están viendo sobre el total. El filtro es solo visual: las reglas escondidas siguen siendo parte de la configuración y se guardan igual.

6. Manejo de Notificaciones
Éxito: "JCL actualizado a DESARROLLO: 14 reemplazos realizados."
Advertencia (Prefijos ignorados): "Cambio completado, pero se ignoraron los siguientes prefijos por no estar configurados: [EEEE, XYZ]."
Restauración: "JCL restaurado a su estado original." (Agrega "Se utilizó el backup temporal." si aplicó la Capa 2).
7. Tareas de Implementación (Checklist para el Agente)
Fase 1: Setup Inicial. Inicializar proyecto de extensión VS Code (TypeScript, yo code o Vite). Configurar package.json con los comandos, eventos de activación (onLanguage:jcl) y el StatusBarItem.
Fase 2: Core - Parsing JCL. Crear la lógica en TypeScript para leer el documento línea por línea. Implementar las "Reglas Inquebrantables" (ignorar //* y bloques DD *).
Fase 3: Core - Motor de Reemplazo. Implementar las funciones que aplican los 4 modelos de configuración (Prefijos, Datasets Completos, Bloques, Parámetros) respetando el orden de prioridad.
Fase 4: Detección Automática. Implementar el escáner inicial al abrir el archivo para determinar el ambiente actual y actualizar el Status Bar.
Fase 5: Sistema de Backups. Implementar la lógica para guardar el .bak temporal antes de aplicar cambios y la lógica de "Restaurar".
Fase 6: UI - WebView. Crear el panel visual (HTML/CSS/JS + API de VS Code) para editar la configuración sin tocar JSON.
Fase 7: UI - JSON Schema. Crear el archivo jcl-environments.schema.json y asociarlo a la configuración para habilitar autocompletado nativo de VS Code.
Fase 8: Testing. Crear pruebas unitarias (mocha/jest) con JCLs de prueba que validen que los comentarios NO son tocados y que los bloques de JOBLIB se reemplazan correctamente.


---

> *"Actúa como un arquitecto de software y desarrollador experto en extensiones de VS Code con TypeScript. Lee detenidamente el archivo `@spec.md` que está en el contexto. Entiende las reglas inquebrantables del JCL y la arquitectura de configuración. No escribas todo el código de golpe. Responde 'Entendido' y procede a ejecutar únicamente la **Fase 1** y la **Fase 2** del checklist. Espera mi revisión antes de pasar a la Fase 3."*
