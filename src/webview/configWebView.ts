import * as vscode from 'vscode';
import { JclEnvironmentsConfig } from '../core/config.types';

export function openConfigWebView(
    extensionUri: vscode.Uri,
    initialConfig: JclEnvironmentsConfig,
    onSave: (config: JclEnvironmentsConfig) => Promise<string>
): void {
    const panel = vscode.window.createWebviewPanel(
        'jclSwitcherConfig',
        'JCL Switcher: Configurar Ambientes',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    panel.webview.html = getHtml(panel.webview, extensionUri);

    panel.webview.onDidReceiveMessage(async message => {
        if (message.type === 'ready') {
            await panel.webview.postMessage({
                type: 'load',
                config: initialConfig
            });
        }

        if (message.type === 'save') {
            try {
                const savedPath = await onSave(message.config);

                await panel.webview.postMessage({
                    type: 'saved',
                    ok: true,
                    path: savedPath
                });

                vscode.window.showInformationMessage(
                    `JCL Switcher: configuración guardada en ${savedPath}.`
                );
            } catch (error) {
                const messageText = error instanceof Error
                    ? error.message
                    : String(error);

                await panel.webview.postMessage({
                    type: 'saved',
                    ok: false,
                    error: messageText
                });

                vscode.window.showErrorMessage(
                    `JCL Switcher: no se pudo guardar la configuración. ${messageText}`
                );
            }
        }
    });
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'configWebView.css')
    );

    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'configWebView.js')
    );

    return /* html */ `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>JCL Switcher Config</title>
</head>
<body>
    <div class="toolbar">
        <button id="save" class="primary">Guardar</button>
        <button id="reload">Recargar</button>
        <span id="status" role="status" aria-live="polite"></span>
    </div>

    <div class="tabs" role="tablist" aria-label="Secciones de configuración">
        <button class="tab" id="tabbtn-environments" role="tab" aria-selected="true"
            aria-controls="tab-environments" data-tab="environments">Ambientes</button>
        <button class="tab" id="tabbtn-prefix" role="tab" aria-selected="false"
            aria-controls="tab-prefix" data-tab="prefix" tabindex="-1">Prefijos</button>
        <button class="tab" id="tabbtn-complete" role="tab" aria-selected="false"
            aria-controls="tab-complete" data-tab="complete" tabindex="-1">Datasets completos</button>
        <button class="tab" id="tabbtn-parameters" role="tab" aria-selected="false"
            aria-controls="tab-parameters" data-tab="parameters" tabindex="-1">Parámetros</button>
        <button class="tab" id="tabbtn-libraries" role="tab" aria-selected="false"
            aria-controls="tab-libraries" data-tab="libraries" tabindex="-1">Librerías</button>
        <button class="tab" id="tabbtn-blocks" role="tab" aria-selected="false"
            aria-controls="tab-blocks" data-tab="blocks" tabindex="-1">Bloques</button>
    </div>

    <section id="tab-environments" class="tab-content active" role="tabpanel"
        aria-labelledby="tabbtn-environments" tabindex="0">
        <div class="field">
            <label for="environments">Ambientes de tu instalación</label>
            <textarea id="environments" rows="4" placeholder="DESARROLLO, TEST, PRODUCCION"
                aria-describedby="environments-help"></textarea>
        </div>
        <p id="environments-help" class="section-intro" style="margin-top: 8px;">
            Separados por comas o saltos de línea. Estos nombres son los que verás al
            cambiar de ambiente, y los que se usan como claves en el resto de las pestañas.
        </p>
    </section>

    <section id="tab-prefix" class="tab-content" role="tabpanel"
        aria-labelledby="tabbtn-prefix" tabindex="0">
        <p class="section-intro">
            Reemplaza el primer segmento de un dataset. Por ejemplo,
            <code>DSN=PROD.BATCH.LOADLIB</code> pasa a <code>DSN=DESA.BATCH.LOADLIB</code>.
        </p>
        <button id="add-prefix">Agregar prefijo</button>
        ${searchBar('prefix', 'Buscar prefijo', 'PROD')}
        <div id="prefix-list"></div>
    </section>

    <section id="tab-complete" class="tab-content" role="tabpanel"
        aria-labelledby="tabbtn-complete" tabindex="0">
        <p class="section-intro">
            Para datasets cuyo nombre cambia por completo entre ambientes, no solo el prefijo.
            Tienen prioridad sobre los prefijos.
        </p>
        <button id="add-complete">Agregar dataset completo</button>
        ${searchBar('complete', 'Buscar dataset', 'NW.EJEMPLO')}
        <div id="complete-list"></div>
    </section>

    <section id="tab-parameters" class="tab-content" role="tabpanel"
        aria-labelledby="tabbtn-parameters" tabindex="0">
        <p class="section-intro">
            Para parámetros que no son datasets, como <code>CLASS=</code> en la tarjeta JOB.
        </p>
        <button id="add-parameter">Agregar parámetro</button>
        ${searchBar('parameter', 'Buscar parámetro', 'CLASS')}
        <div id="parameter-list"></div>
    </section>

    <section id="tab-libraries" class="tab-content" role="tabpanel"
        aria-labelledby="tabbtn-libraries" tabindex="0">
        <p class="section-intro">
            Las librerías que usa cada ambiente. Escribe solo los nombres de los datasets,
            uno por línea, y la extensión arma las líneas <code>DD</code> con el formato y las
            columnas correctas. Cada ambiente puede tener una cantidad distinta de librerías.
        </p>
        <button id="add-library">Agregar librería</button>
        ${searchBar('library', 'Buscar librería', 'JOBLIB o LOADLIB')}
        <div id="library-list"></div>
    </section>

    <section id="tab-blocks" class="tab-content" role="tabpanel"
        aria-labelledby="tabbtn-blocks" tabindex="0">
        <p class="section-intro">
            Bloques completos de JCL, escritos a mano línea por línea. Sirven cuando el bloque
            lleva algo que la pestaña <strong>Librerías</strong> no cubre, como un
            <code>DISP</code> distinto de <code>SHR</code> u otros parámetros en la línea.
            Se respetan las columnas tal cual las escribas.
        </p>
        <button id="add-block">Agregar bloque</button>
        ${searchBar('block', 'Buscar bloque', 'STEPLIB')}
        <div id="block-list"></div>
    </section>

    <script src="${scriptUri}"></script>
</body>
</html>
`;
}

/**
 * Barra de busqueda de una lista. Los cuatro ids comparten prefijo
 * (`prefix-toolbar`, `prefix-search`, `prefix-count`, `prefix-list`) porque
 * media/configWebView.js los deriva del listId; si cambia uno hay que cambiar
 * los helpers searchId/countId/toolbarId de ese archivo.
 *
 * Arranca oculta y el script la muestra solo cuando la lista es larga.
 */
function searchBar(prefix: string, label: string, placeholder: string): string {
    return /* html */ `
        <div class="list-toolbar hidden" id="${prefix}-toolbar">
            <div class="field">
                <label for="${prefix}-search">${label}</label>
                <input type="search" id="${prefix}-search"
                    placeholder="${placeholder}" autocomplete="off" />
            </div>
            <span class="list-count" id="${prefix}-count" role="status" aria-live="polite"></span>
        </div>`;
}