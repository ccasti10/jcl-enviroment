const vscode = acquireVsCodeApi();

let state = {
    environments: [],
    prefixMappings: [],
    completeDatasetRules: [],
    parameterRules: [],
    libraries: [],
    blockTemplates: []
};

/**
 * Formato con el que se generan las lineas de una libreria:
 *
 *   //JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR
 *   //         DD  DSN=DB2.AAAA,DISP=SHR
 *
 * El DDNAME ocupa las columnas 3-10, DD la 12-13 y los operandos arrancan en la
 * 16. Las continuaciones van sin nombre, que es como el parser reconoce que
 * siguen perteneciendo al mismo bloque.
 */
const LIBRARY_DISP = 'DISP=SHR';
const LIBRARY_LINE_REGEX = /^\/\/(\S*)\s+DD\s+DSN=([A-Za-z0-9@#$.\-]+),DISP=SHR\s*$/i;

function buildLibraryLine(ddName, dataset, isFirst) {
    const label = isFirst
        ? String(ddName).toUpperCase().padEnd(8)
        : ' '.repeat(8);

    return `//${label} DD  DSN=${dataset},${LIBRARY_DISP}`;
}

/**
 * Devuelve los datasets si el bloque entero calza con el formato de arriba, o
 * null si tiene cualquier otra cosa (otro DISP, parametros extra, comentarios).
 * Un bloque que no calza se sigue editando como bloque literal.
 */
function parseLibraryDatasets(ddName, lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
        return null;
    }

    const datasets = [];

    for (let index = 0; index < lines.length; index++) {
        const match = LIBRARY_LINE_REGEX.exec(String(lines[index]));

        if (!match) {
            return null;
        }

        const label = match[1].toUpperCase();
        const expected = index === 0 ? String(ddName).toUpperCase() : '';

        if (label !== expected) {
            return null;
        }

        datasets.push(match[2]);
    }

    return datasets;
}

/**
 * Parte los bloques guardados en dos vistas: las que se pueden mostrar como
 * lista de datasets (pestana Librerias) y el resto (pestana Bloques). En el
 * JSON siguen siendo lo mismo, un unico blockTemplates.
 */
function splitBlockTemplates(blockTemplates) {
    const libraries = [];
    const blocks = [];

    Object.entries(blockTemplates || {}).forEach(([name, templates]) => {
        const byEnvironment = templates || {};
        const datasets = {};
        let isLibrary = Object.keys(byEnvironment).length > 0;

        Object.entries(byEnvironment).forEach(([environment, lines]) => {
            const parsed = isLibrary ? parseLibraryDatasets(name, lines) : null;

            if (parsed) {
                datasets[environment] = parsed;
            } else {
                isLibrary = false;
            }
        });

        if (isLibrary) {
            libraries.push({ name, datasets });
        } else {
            blocks.push({ name, templates: byEnvironment });
        }
    });

    return { libraries, blocks };
}

/**
 * Todas las secciones de reglas se renderizan igual: una tarjeta con un campo
 * de cabecera y un campo por ambiente. Describirlas como datos evita repetir
 * una funcion de render casi identica por seccion.
 *
 * Los nombres de clase (prefix-source, prefix-target, ...) los lee collectState(),
 * asi que no se pueden cambiar sin actualizar tambien esa funcion.
 */
const SECTIONS = [
    {
        key: 'prefixMappings',
        listId: 'prefix-list',
        addId: 'add-prefix',
        create: () => ({ sourcePrefix: '', targets: {} }),
        headerClass: 'prefix-source',
        headerLabel: 'Prefijo origen',
        headerPlaceholder: 'PROD',
        headerValue: item => item.sourcePrefix,
        fieldClass: 'prefix-target',
        fieldPlaceholder: 'DESA',
        fieldValue: (item, env) => item.targets[env] || '',
        multiline: false,
        empty:
            'Todavía no hay prefijos. Agrega uno para que <code>DSN=PROD.BATCH.LOADLIB</code> ' +
            'se convierta en <code>DSN=DESA.BATCH.LOADLIB</code> al cambiar de ambiente.'
    },
    {
        key: 'completeDatasetRules',
        listId: 'complete-list',
        addId: 'add-complete',
        create: () => ({ name: '', environments: {} }),
        headerClass: 'complete-name',
        headerLabel: 'Nombre de la regla',
        headerPlaceholder: 'Datasets de NW',
        headerValue: item => item.name,
        fieldClass: 'complete-value',
        fieldPlaceholder: 'PXXX.NW.EJEMPLO',
        fieldValue: (item, env) => item.environments[env] || '',
        multiline: false,
        empty:
            'Todavía no hay datasets completos. Úsalos cuando el nombre cambia entero entre ' +
            'ambientes, por ejemplo <code>PXXX.NW.EJEMPLO</code> contra <code>DXXX.WWW.NW.EJEMPLO</code>.'
    },
    {
        key: 'parameterRules',
        listId: 'parameter-list',
        addId: 'add-parameter',
        create: () => ({ parameter: '', values: {} }),
        headerClass: 'parameter-name',
        headerLabel: 'Parámetro',
        headerPlaceholder: 'CLASS',
        headerValue: item => item.parameter,
        fieldClass: 'parameter-value',
        fieldPlaceholder: 'A',
        fieldValue: (item, env) => item.values[env] || '',
        multiline: false,
        empty:
            'Todavía no hay parámetros. Sirven para valores que no son datasets, ' +
            'como <code>CLASS=A</code> en producción y <code>CLASS=D</code> en desarrollo.'
    },
    {
        key: 'libraries',
        listId: 'library-list',
        addId: 'add-library',
        create: () => ({ name: '', datasets: {} }),
        headerClass: 'library-name',
        headerLabel: 'Nombre del DD',
        headerPlaceholder: 'JOBLIB',
        headerValue: item => item.name,
        fieldClass: 'library-datasets',
        fieldPlaceholder: 'PROD.BATCH.LOADLIB\nDB2.AAAA.LOADLIB',
        fieldValue: (item, env) => {
            const datasets = item.datasets[env] || [];
            return Array.isArray(datasets) ? datasets.join('\n') : '';
        },
        multiline: true,
        empty:
            'Todavía no hay librerías. Agrega una para definir qué datasets usa cada ambiente ' +
            'en su <code>JOBLIB</code> o <code>STEPLIB</code>: escribes solo los nombres, ' +
            'uno por línea, y las líneas <code>DD</code> se arman solas.'
    },
    {
        key: 'blockTemplates',
        listId: 'block-list',
        addId: 'add-block',
        create: () => ({ name: '', templates: {} }),
        headerClass: 'block-name',
        headerLabel: 'Nombre del bloque',
        headerPlaceholder: 'JOBLIB',
        headerValue: item => item.name,
        fieldClass: 'block-template',
        fieldPlaceholder: '//JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR',
        fieldValue: (item, env) => {
            const lines = item.templates[env] || [];
            return Array.isArray(lines) ? lines.join('\n') : '';
        },
        multiline: true,
        empty:
            'Todavía no hay bloques escritos a mano. Para un <code>JOBLIB</code> o ' +
            '<code>STEPLIB</code> normal usa la pestaña <strong>Librerías</strong>; esta sección ' +
            'es para bloques con algo distinto, como un <code>DISP</code> que no es ' +
            '<code>SHR</code>.'
    }
];

/**
 * Debajo de esta cantidad de reglas el buscador estorba mas de lo que ayuda.
 */
const SEARCH_THRESHOLD = 5;

/** Boton "Eliminar" esperando el segundo clic de confirmacion. */
let pendingRemoval = null;

init();

function init() {
    bindTabs();
    bindSections();

    document.getElementById('environments').addEventListener('change', onEnvironmentsChanged);
    document.getElementById('save').addEventListener('click', onSave);
    document.getElementById('reload').addEventListener('click', onReload);

    // Un clic fuera o Escape cancelan una eliminacion pendiente.
    document.addEventListener('click', event => {
        if (!event.target.closest('button.remove')) {
            resetPendingRemoval();
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            resetPendingRemoval();
        }
    });

    window.addEventListener('message', onMessage);

    vscode.postMessage({ type: 'ready' });
}

/**
 * Tabs con el patron ARIA completo: roving tabindex (solo la activa es
 * tabulable) mas navegacion por flechas, Home y End.
 */
function bindTabs() {
    const tabs = Array.from(document.querySelectorAll('.tab'));

    const activate = (tab, focus) => {
        tabs.forEach(candidate => {
            const selected = candidate === tab;
            candidate.setAttribute('aria-selected', String(selected));
            candidate.tabIndex = selected ? 0 : -1;
        });

        document.querySelectorAll('.tab-content').forEach(section => {
            section.classList.toggle('active', section.id === `tab-${tab.dataset.tab}`);
        });

        if (focus) {
            tab.focus();
        }
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', () => activate(tab, false));

        tab.addEventListener('keydown', event => {
            const index = tabs.indexOf(tab);
            let next;

            if (event.key === 'ArrowRight') {
                next = tabs[(index + 1) % tabs.length];
            } else if (event.key === 'ArrowLeft') {
                next = tabs[(index - 1 + tabs.length) % tabs.length];
            } else if (event.key === 'Home') {
                next = tabs[0];
            } else if (event.key === 'End') {
                next = tabs[tabs.length - 1];
            } else {
                return;
            }

            event.preventDefault();
            activate(next, true);
        });
    });
}

function bindSections() {
    SECTIONS.forEach(section => {
        document.getElementById(section.addId).addEventListener('click', () => {
            state = collectState();
            state[section.key].push(section.create());

            // La regla nueva esta vacia: con un filtro puesto nacería escondida.
            document.getElementById(searchId(section)).value = '';

            renderAll();
        });

        document.getElementById(section.listId).addEventListener('click', event => {
            handleRemove(event, section.key);
        });

        document.getElementById(searchId(section)).addEventListener('input', () => {
            applyFilter(section);
        });
    });
}

/**
 * Eliminar es destructivo y no hay undo, asi que pide un segundo clic.
 * No se usa confirm(): los dialogos nativos bloquean el webview.
 */
function handleRemove(event, stateKey) {
    const button = event.target.closest('button.remove');

    if (!button) {
        return;
    }

    const index = Number(button.dataset.index);

    if (Number.isNaN(index)) {
        return;
    }

    if (button.dataset.confirming !== 'true') {
        resetPendingRemoval();
        button.dataset.confirming = 'true';
        button.textContent = '¿Confirmar?';
        pendingRemoval = button;
        return;
    }

    pendingRemoval = null;
    state = collectState();
    state[stateKey].splice(index, 1);
    renderAll();
    setStatus('Regla eliminada. Guarda para aplicar el cambio.');
}

function resetPendingRemoval() {
    if (!pendingRemoval) {
        return;
    }

    pendingRemoval.dataset.confirming = 'false';
    pendingRemoval.textContent = 'Eliminar';
    pendingRemoval = null;
}

function onEnvironmentsChanged() {
    state = collectState();
    state.environments = parseEnvironments(document.getElementById('environments').value);
    renderAll();
}

function onSave() {
    state = collectState();
    const config = buildConfig(state);

    setStatus('Guardando...');

    vscode.postMessage({
        type: 'save',
        config
    });
}

function onReload() {
    setStatus('Recargando...');
    vscode.postMessage({ type: 'ready' });
}

function onMessage(event) {
    const message = event.data;

    if (message.type === 'load') {
        state = normalize(message.config || {});
        renderAll();
        setStatus('');
    }

    if (message.type === 'saved') {
        if (message.ok) {
            setStatus(`Guardado en ${message.path || 'la configuración'}`);
        } else {
            setStatus(`No se pudo guardar: ${message.error || 'error desconocido'}`, true);
        }
    }
}

function normalize(config) {
    const environments = deriveEnvironments(config);
    const { libraries, blocks } = splitBlockTemplates(config.blockTemplates);

    return {
        environments,
        prefixMappings: (config.prefixMappings || []).map(mapping => ({
            sourcePrefix: mapping.sourcePrefix || '',
            targets: mapping.environmentTargets || {}
        })),
        completeDatasetRules: (config.completeDatasetRules || []).map(rule => ({
            name: rule.name || '',
            environments: rule.environments || {}
        })),
        parameterRules: (config.parameterRules || []).map(rule => ({
            parameter: rule.parameter || '',
            values: rule.values || {}
        })),
        libraries,
        blockTemplates: blocks
    };
}

function deriveEnvironments(config) {
    const envs = new Set();

    const add = value => {
        if (value && String(value).trim().length > 0) {
            envs.add(String(value).trim());
        }
    };

    (config.prefixMappings || []).forEach(mapping => {
        Object.keys(mapping.environmentTargets || {}).forEach(add);
    });

    (config.completeDatasetRules || []).forEach(rule => {
        Object.keys(rule.environments || {}).forEach(add);
    });

    Object.values(config.blockTemplates || {}).forEach(byEnvironment => {
        Object.keys(byEnvironment || {}).forEach(add);
    });

    (config.parameterRules || []).forEach(rule => {
        Object.keys(rule.values || {}).forEach(add);
    });

    if (envs.size === 0) {
        return ['DESARROLLO', 'TEST', 'PRODUCCION'];
    }

    return Array.from(envs).sort();
}

function renderAll() {
    document.getElementById('environments').value = state.environments.join(', ');

    resetPendingRemoval();
    SECTIONS.forEach(renderSection);
}

function renderSection(section) {
    const list = document.getElementById(section.listId);
    list.innerHTML = '';

    const items = state[section.key];

    // El buscador solo aparece cuando la lista es larga de verdad.
    document.getElementById(toolbarId(section))
        .classList.toggle('hidden', items.length < SEARCH_THRESHOLD);

    // Estado vacio: explica para que sirve la seccion en vez de dejar el hueco.
    if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.innerHTML = `<p>${section.empty}</p>`;
        list.appendChild(empty);
        document.getElementById(countId(section)).textContent = '';
        return;
    }

    items.forEach((item, index) => {
        list.appendChild(buildCard(section, item, index));
    });

    applyFilter(section);
}

/*
 * Buscador. Los ids salen del listId ('prefix-list' -> 'prefix-search') para no
 * repetir tres campos mas por seccion; el HTML de configWebView.ts tiene que
 * respetar esa convencion.
 */
function searchId(section) {
    return section.listId.replace('-list', '-search');
}

function countId(section) {
    return section.listId.replace('-list', '-count');
}

function toolbarId(section) {
    return section.listId.replace('-list', '-toolbar');
}

/** Compara sin distinguir mayusculas ni acentos: se busca a mano y apurado. */
function searchKey(value) {
    return String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function matchesQuery(values, query) {
    if (!query) {
        return true;
    }

    return values.some(value => searchKey(value).includes(query));
}

/**
 * Filtra ESCONDIENDO tarjetas, nunca sacandolas del DOM. collectState() arma la
 * config leyendo las tarjetas dibujadas, asi que una regla que no este en el DOM
 * desaparece del archivo al guardar, sin ningun error visible. Si algun dia esto
 * pasa a re-renderizar solo lo que coincide, collectState tiene que dejar de leer
 * el DOM primero.
 */
function applyFilter(section) {
    const cards = document.querySelectorAll(`#${section.listId} .card`);
    const query = searchKey(document.getElementById(searchId(section)).value.trim());

    let visible = 0;

    cards.forEach(card => {
        const values = Array.from(card.querySelectorAll('input, textarea'))
            .map(control => control.value);

        const match = matchesQuery(values, query);
        card.classList.toggle('hidden', !match);

        if (match) {
            visible++;
        }
    });

    document.getElementById(countId(section)).textContent =
        describeCount(visible, cards.length, query);
}

function describeCount(visible, total, query) {
    if (total === 0) {
        return '';
    }

    if (!query) {
        return `${total} en total`;
    }

    if (visible === 0) {
        return `Ninguna de las ${total} coincide`;
    }

    return `${visible} de ${total}`;
}

function buildCard(section, item, index) {
    const card = document.createElement('div');
    card.className = 'card';

    const headerId = `${section.listId}-${index}-name`;

    const fields = state.environments
        .map((environment, envIndex) => {
            const fieldId = `${section.listId}-${index}-env${envIndex}`;
            const value = section.fieldValue(item, environment);

            const control = section.multiline
                ? `<textarea id="${fieldId}"
                        class="${section.fieldClass}"
                        data-index="${index}"
                        data-env="${escapeHtml(environment)}"
                        placeholder="${escapeHtml(section.fieldPlaceholder)}"
                    >${escapeHtml(value)}</textarea>`
                : `<input type="text"
                        id="${fieldId}"
                        class="${section.fieldClass}"
                        data-index="${index}"
                        data-env="${escapeHtml(environment)}"
                        placeholder="${escapeHtml(section.fieldPlaceholder)}"
                        value="${escapeHtml(value)}" />`;

            return `
                <div class="field">
                    <label for="${fieldId}">${escapeHtml(environment)}</label>
                    ${control}
                </div>
            `;
        })
        .join('');

    const title = section.headerValue(item) || `sin nombre (#${index + 1})`;

    card.innerHTML = `
        <div class="card-header">
            <div class="field">
                <label for="${headerId}">${escapeHtml(section.headerLabel)}</label>
                <input type="text"
                    id="${headerId}"
                    class="${section.headerClass}"
                    placeholder="${escapeHtml(section.headerPlaceholder)}"
                    value="${escapeHtml(section.headerValue(item))}" />
            </div>
            <button class="remove"
                data-index="${index}"
                aria-label="Eliminar ${escapeHtml(title)}">Eliminar</button>
        </div>
        <div class="env-grid">
            ${fields}
        </div>
    `;

    return card;
}

function collectState() {
    const environments = parseEnvironments(
        document.getElementById('environments').value
    );

    const prefixMappings = [];
    document.querySelectorAll('#prefix-list .card').forEach(card => {
        const sourcePrefix = card.querySelector('.prefix-source').value.trim();
        const environmentTargets = {};

        card.querySelectorAll('.prefix-target').forEach(input => {
            const environment = input.dataset.env;
            const value = input.value.trim();

            if (environment && value) {
                environmentTargets[environment] = value;
            }
        });

        if (sourcePrefix || Object.keys(environmentTargets).length > 0) {
            prefixMappings.push({
                sourcePrefix,
                targets: environmentTargets
            });
        }
    });

    const completeDatasetRules = [];
    document.querySelectorAll('#complete-list .card').forEach(card => {
        const name = card.querySelector('.complete-name').value.trim();
        const environmentsMap = {};

        card.querySelectorAll('.complete-value').forEach(input => {
            const environment = input.dataset.env;
            const value = input.value.trim();

            if (environment && value) {
                environmentsMap[environment] = value;
            }
        });

        if (name || Object.keys(environmentsMap).length > 0) {
            completeDatasetRules.push({
                name,
                environments: environmentsMap
            });
        }
    });

    const parameterRules = [];
    document.querySelectorAll('#parameter-list .card').forEach(card => {
        const parameter = card.querySelector('.parameter-name').value.trim();
        const values = {};

        card.querySelectorAll('.parameter-value').forEach(input => {
            const environment = input.dataset.env;
            const value = input.value.trim();

            if (environment && value) {
                values[environment] = value;
            }
        });

        if (parameter || Object.keys(values).length > 0) {
            parameterRules.push({
                parameter,
                values
            });
        }
    });

    const libraries = [];
    document.querySelectorAll('#library-list .card').forEach(card => {
        const name = card.querySelector('.library-name').value.trim();
        const datasets = {};

        card.querySelectorAll('.library-datasets').forEach(textarea => {
            const environment = textarea.dataset.env;
            const values = textarea.value
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0);

            if (environment && values.length > 0) {
                datasets[environment] = values;
            }
        });

        if (name || Object.keys(datasets).length > 0) {
            libraries.push({
                name,
                datasets
            });
        }
    });

    const blockTemplates = [];
    document.querySelectorAll('#block-list .card').forEach(card => {
        const name = card.querySelector('.block-name').value.trim();
        const templates = {};

        card.querySelectorAll('.block-template').forEach(textarea => {
            const environment = textarea.dataset.env;
            const lines = textarea.value
                .split(/\r?\n/)
                .filter(line => line.trim().length > 0);

            if (environment && lines.length > 0) {
                templates[environment] = lines;
            }
        });

        if (name || Object.keys(templates).length > 0) {
            blockTemplates.push({
                name,
                templates
            });
        }
    });

    return {
        environments,
        prefixMappings,
        completeDatasetRules,
        parameterRules,
        libraries,
        blockTemplates
    };
}

function buildConfig(currentState) {
    const prefixMappings = currentState.prefixMappings
        .map(mapping => ({
            sourcePrefix: mapping.sourcePrefix,
            environmentTargets: mapping.targets
        }))
        .filter(mapping => {
            return (
                mapping.sourcePrefix ||
                Object.keys(mapping.environmentTargets || {}).length > 0
            );
        });

    const completeDatasetRules = currentState.completeDatasetRules
        .map(rule => ({
            name: rule.name,
            environments: rule.environments
        }))
        .filter(rule => {
            return (
                rule.name ||
                Object.keys(rule.environments || {}).length > 0
            );
        });

    const parameterRules = currentState.parameterRules
        .map(rule => ({
            parameter: rule.parameter,
            values: rule.values
        }))
        .filter(rule => {
            return (
                rule.parameter ||
                Object.keys(rule.values || {}).length > 0
            );
        });

    // Librerias y bloques comparten destino: blockTemplates. Las librerias se
    // escriben primero para que un bloque literal del mismo nombre, que es la
    // forma mas explicita, quede como version final.
    const blockTemplates = {};

    currentState.libraries.forEach(library => {
        if (!library.name) {
            return;
        }

        const templates = {};

        Object.entries(library.datasets || {}).forEach(([environment, datasets]) => {
            if (Array.isArray(datasets) && datasets.length > 0) {
                templates[environment] = datasets.map((dataset, index) =>
                    buildLibraryLine(library.name, dataset, index === 0)
                );
            }
        });

        if (Object.keys(templates).length > 0) {
            blockTemplates[library.name] = templates;
        }
    });

    currentState.blockTemplates.forEach(block => {
        if (!block.name) {
            return;
        }

        if (Object.keys(block.templates || {}).length > 0) {
            blockTemplates[block.name] = block.templates;
        }
    });

    return {
        prefixMappings,
        completeDatasetRules,
        parameterRules,
        blockTemplates
    };
}

function parseEnvironments(value) {
    const parts = String(value || '')
        .split(/[\n,;]+/)
        .map(part => part.trim())
        .filter(part => part.length > 0);

    return [...new Set(parts)];
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setStatus(text, isError) {
    const element = document.getElementById('status');

    // El contenedor es role="status" aria-live="polite", asi que cambiar el
    // texto basta para que un lector de pantalla lo anuncie.
    element.textContent = text || '';
    element.classList.toggle('error', Boolean(isError));
}