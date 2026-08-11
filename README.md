# JCL Environment Switcher

Extensión de VS Code para cambiar las referencias para los distintos ambientes de trabajoDESARROLLO, TEST,
PRODUCCIONdentro de un JCL de mainframe, sin buscar y reemplazar a mano.

Abre un JCL, elige el ambiente destino y la extensión reescribe los `DSN=`, los
bloques `JOBLIB`/`STEPLIB` y los parámetros como `CLASS=` entre otros, respetando las columnas
y sin tocar nada que no corresponda.

## Evitar Errores involuntarios

Pasar un JCL de Produccion a desarrollo o viceversa es cambiar decenas de nombres de datasets
siguiendo convenciones de cada ambiente define a su manera. Hacerlo a mano es
lento y se presta a errores silenciosos: un prefijo que queda mal escrito ambientado apuntando a otro ambiente en
produccion provoca errores.

Esta extension no trae ninguna regla escrita en el codigo. Todas las convenciones
de prefijos, nombres completos, librerias, parametros salen de un archivo de
configuracion que cada equipo escribe segun sus propias normas.

## Reglas que nunca se rompen

El JCL es sensible a la posicion, y hay partes del archivo que no se pueden tocar:

- **Los comentarios quedan intactos.** Cualquier línea que empiece con `//*` no se
  modifica jamás, aunque contenga un dataset que coincida con una regla.
- **Los datos en línea quedan intactos.** Todo lo que va entre un `//SYSIN DD *` y
  el `/*` de la columna 1 es data de entrada, no código, y no se altera.
- **Las columnas se preservan.** Las sustituciones no agregan ni quitan espacios que
  descoloquen el resto de la línea.

Estas protecciones viven en un solo lugar (`core/jclParser.ts`), asi que el
detector y el motor de reemplazo no pueden saltarselas por accidente.

## Uso

La barra de estado, abajo a la derecha, muestra el ambiente detectado en el archivo
abierto:

```
$(server-environment) JCL: PRODUCCION
```

Al hacer clic se elige el ambiente destino. Si el archivo mezcla señales de varios
ambientes, la barra muestra `JCL: Mixto` y no deja cambiar nada hasta que se
resuelva la ambiguedad a mano: es preferible detenerse a reescribir mal.

Comandos disponibles en la paleta (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Comando | Para que sirve |
|---|---|
| `JCL Switcher: Cambiar a...` | Aplica un ambiente al archivo abierto |
| `JCL Switcher: Marcar ambiente actual como...` | Fuerza la detección cuando es ambigua |
| `JCL Switcher: Restaurar JCL original` | Deshace los cambios de la extensión |
| `JCL Switcher: Configurar Ambientes (Visual)` | Abre el panel de configuración |
| `JCL Switcher: Editar Configuración (JSON)` | Abre el archivo de configuración |

### Si algo sale mal

`Restaurar JCL original` funciona en dos capas: primero intenta deshacer la edicion
y verifica que el texto haya quedado igual al original; si eso no alcanzapor
ejemplo, porque el archivo ya se cerro recurre a un respaldo `.jcl.bak` que se
escribe antes del primer cambio. Si el respaldo no se puede crear, la extension no
toca el archivo.

## Configuracion

Las reglas se guardan en un archivo `jcl-environments.json` en el workspace. Se
puede editar de dos formas: con el panel visual (`JCL Switcher: Configurar
Ambientes`) o a mano, con autocompletado y validacion provistos por el esquema
incluido.

Los ambientes no son una lista fija: sus nombres salen de las claves que uses en la
configuracion. Si tu instalacion tiene `CERT` o `PREPROD`, alcanza con nombrarlos.

### Prefijos

Reemplaza el primer segmento del nombre del dataset.

```json
{
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
}
```

`DSN=PROD.BATCH.LOADLIB` pasa a `DSN=DESA.BATCH.LOADLIB`.

### Datasets completos

Para los casos en que el nombre cambia entero, no solo el prefijo. Tienen prioridad
sobre los prefijos.

```json
{
  "completeDatasetRules": [
    {
      "name": "Datasets de NW",
      "environments": {
        "PRODUCCION": "PXXX.NW.EJEMPLO",
        "DESARROLLO": "DXXX.WWW.NW.EJEMPLO"
      }
    }
  ]
}
```

### Librerias

Las concatenaciones de `JOBLIB` o `STEPLIB`. En el panel visual solo se escriben los
nombres de los datasets, uno por línea, y las líneas `DD` se arman con el formato y
las columnas correctas. Cada ambiente puede tener una cantidad distinta de librerías.

```json
{
  "blockTemplates": {
    "JOBLIB": {
      "PRODUCCION": [
        "//JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR",
        "//         DD  DSN=DB2.AAAA.LOADLIB,DISP=SHR"
      ],
      "DESARROLLO": [
        "//JOBLIB   DD  DSN=DESA.BATCH.LOADLIB,DISP=SHR"
      ]
    }
  }
}
```

Un bloque que no siga ese formato `DISP`,
la pestaña **Bloques**, linea por linea, y se copia tal cual.

### Parametros

Para lo que no es un dataset.

```json
{
  "parameterRules": [
    {
      "parameter": "CLASS",
      "values": { "PRODUCCION": "A", "DESARROLLO": "D", "TEST": "D" }
    }
  ]
}
```

### Donde se busca la configuracion

Por defecto, el primer `jcl-environments.json` que aparezca en el workspace. Se
puede fijar una ruta con el ajuste `jclSwitcher.configFilePath`, absoluta o relativa
a la primera carpeta del workspace. El archivo se vigila: al guardarlo, la extension
recarga las reglas sin reiniciar nada.

### Prefijos que no detecta
Los prefijos que no coincidan con ninguna regla no se tocan y se informan al
terminar, para que ninguno pase inadvertido.


## Licencia

MIT. Ver [LICENSE](LICENSE).
