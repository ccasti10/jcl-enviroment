"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vm = __importStar(require("vm"));
/**
 * media/configWebView.js corre en el webview, no en Node, y no pasa por tsc.
 * Estos tests lo ejecutan sobre un DOM minimo para blindar las invariantes de
 * accesibilidad del render: cada input con su <label for>, ids unicos, nombre
 * accesible en el boton destructivo y estados vacios explicativos.
 */
// Relativo a la raiz del proyecto: mocha se ejecuta desde ahi. No se usa
// __dirname porque ts-node carga estos tests como ES module.
const SCRIPT_PATH = path.join(process.cwd(), 'media', 'configWebView.js');
const CONFIG_DEMO = {
    prefixMappings: [
        {
            sourcePrefix: 'PCRE',
            environmentTargets: { DESARROLLO: 'DCRE', TEST: 'TCRE', PRODUCCION: 'PCRE' }
        }
    ],
    completeDatasetRules: [],
    parameterRules: [],
    blockTemplates: {}
};
function makeElement(id = '') {
    return {
        id,
        className: '',
        innerHTML: '',
        textContent: '',
        value: '',
        tabIndex: 0,
        dataset: {},
        children: [],
        addEventListener: () => undefined,
        setAttribute: () => undefined,
        appendChild(child) { this.children.push(child); return child; },
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        focus: () => undefined,
        classList: makeClassList()
    };
}
/** Registra las clases de verdad: el buscador esconde tarjetas con .hidden. */
function makeClassList() {
    const classes = new Set();
    return {
        add: (name) => { classes.add(name); },
        remove: (name) => { classes.delete(name); },
        contains: (name) => classes.has(name),
        toggle: (name, force) => {
            const activar = force === undefined ? !classes.has(name) : force;
            if (activar) {
                classes.add(name);
            }
            else {
                classes.delete(name);
            }
            return activar;
        }
    };
}
/** Ejecuta el script del webview con la config de demo ya cargada. */
function renderWithDemoConfig(config = CONFIG_DEMO) {
    const elements = new Map();
    const getById = (id) => {
        if (!elements.has(id)) {
            elements.set(id, makeElement(id));
        }
        return elements.get(id);
    };
    const tabs = ['environments', 'prefix', 'complete', 'parameters', 'libraries', 'blocks'].map(name => {
        const element = makeElement(`tabbtn-${name}`);
        element.dataset.tab = name;
        return element;
    });
    let messageHandler = null;
    const context = {
        console,
        setTimeout,
        document: {
            getElementById: getById,
            addEventListener: () => undefined,
            createElement: () => makeElement(),
            querySelectorAll: (selector) => (selector === '.tab' ? tabs : [])
        },
        window: {
            addEventListener: (type, handler) => {
                if (type === 'message') {
                    messageHandler = handler;
                }
            }
        },
        acquireVsCodeApi: () => ({
            postMessage: (message) => {
                if (message.type === 'ready' && messageHandler) {
                    messageHandler({ data: { type: 'load', config } });
                }
            }
        })
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(SCRIPT_PATH, 'utf8'), context);
    return { getById, context };
}
describe('configWebView (render)', () => {
    it('debe asociar cada campo con un label existente', () => {
        const { getById } = renderWithDemoConfig();
        const card = getById('prefix-list').children[0].innerHTML;
        const labelFors = [...card.matchAll(/<label for="([^"]+)"/g)].map(m => m[1]);
        const controlIds = [...card.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
        assert_1.default.ok(labelFors.length >= 4, `esperaba >=4 labels, hubo ${labelFors.length}`);
        for (const target of labelFors) {
            assert_1.default.ok(controlIds.includes(target), `el label for="${target}" no apunta a ningun control`);
        }
        assert_1.default.strictEqual(new Set(controlIds).size, controlIds.length, 'los ids de los controles deben ser unicos');
    });
    it('debe etiquetar la cabecera y cada ambiente, no solo con placeholder', () => {
        const { getById } = renderWithDemoConfig();
        const card = getById('prefix-list').children[0].innerHTML;
        assert_1.default.ok(card.includes('Prefijo origen'), 'falta el label de la cabecera');
        assert_1.default.ok(card.includes('value="PCRE"'), 'no se cargo el valor del prefijo');
        for (const environment of ['DESARROLLO', 'TEST', 'PRODUCCION']) {
            assert_1.default.ok(card.includes(`>${environment}</label>`), `falta el label del ambiente ${environment}`);
        }
    });
    it('debe dar nombre accesible propio al boton Eliminar', () => {
        const { getById } = renderWithDemoConfig();
        const card = getById('prefix-list').children[0].innerHTML;
        assert_1.default.ok(/aria-label="Eliminar [^"]+"/.test(card), 'el boton Eliminar necesita aria-label');
    });
    it('debe explicar las secciones vacias en vez de dejar un hueco', () => {
        const { getById } = renderWithDemoConfig();
        for (const listId of ['complete-list', 'parameter-list', 'library-list', 'block-list']) {
            const list = getById(listId);
            assert_1.default.strictEqual(list.children.length, 1, `${listId} debe tener estado vacio`);
            assert_1.default.strictEqual(list.children[0].className, 'empty', `${listId} debe usar .empty`);
            assert_1.default.ok(list.children[0].innerHTML.length > 60, `${listId} debe explicar para que sirve la seccion`);
        }
    });
});
/**
 * La pestana Librerias es una vista sobre el mismo blockTemplates: muestra los
 * datasets sueltos y al guardar los vuelve a convertir en lineas DD. Si generar
 * y parsear dejan de coincidir, un JOBLIB guardado reaparece en la pestana
 * Bloques sin que nadie lo note, asi que el ida y vuelta va blindado.
 */
describe('configWebView (librerias)', () => {
    const JOBLIB_SIMPLE = {
        prefixMappings: [],
        completeDatasetRules: [],
        parameterRules: [],
        blockTemplates: {
            JOBLIB: {
                PRODUCCION: [
                    '//JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR',
                    '//         DD  DSN=DB2.AAAA.LOADLIB,DISP=SHR'
                ],
                DESARROLLO: [
                    '//JOBLIB   DD  DSN=DESA.BATCH.LOADLIB,DISP=SHR'
                ]
            }
        }
    };
    it('debe generar las lineas DD con las columnas del JCL', () => {
        const { context } = renderWithDemoConfig();
        assert_1.default.strictEqual(context.buildLibraryLine('JOBLIB', 'PROD.BATCH.LOADLIB', true), '//JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR');
        assert_1.default.strictEqual(context.buildLibraryLine('JOBLIB', 'DB2.AAAA.LOADLIB', false), '//         DD  DSN=DB2.AAAA.LOADLIB,DISP=SHR');
    });
    it('debe recuperar los mismos datasets que genero', () => {
        const { context } = renderWithDemoConfig();
        const datasets = ['PROD.BATCH.LOADLIB', 'DB2.AAAA.LOADLIB', 'CEE.SCEERUN'];
        const lines = datasets.map((dataset, index) => context.buildLibraryLine('STEPLIB', dataset, index === 0));
        // Los arrays vienen del contexto vm, que es otro realm: deepStrictEqual
        // fallaria por prototipo aunque el contenido sea el mismo.
        assert_1.default.strictEqual(context.parseLibraryDatasets('STEPLIB', lines).join('|'), datasets.join('|'));
    });
    it('debe mostrar un JOBLIB simple como lista de datasets', () => {
        const { getById } = renderWithDemoConfig(JOBLIB_SIMPLE);
        const list = getById('library-list');
        assert_1.default.strictEqual(list.children.length, 1, 'el JOBLIB debe verse en Librerias');
        const card = list.children[0].innerHTML;
        assert_1.default.ok(card.includes('value="JOBLIB"'), 'falta el nombre del DD');
        assert_1.default.ok(card.includes('PROD.BATCH.LOADLIB\nDB2.AAAA.LOADLIB'), 'los datasets deben verse uno por linea, sin el JCL alrededor');
        assert_1.default.ok(!card.includes('DISP=SHR'), 'la vista simple no debe mostrar el DISP');
    });
    it('no debe duplicar el bloque en la pestana Bloques', () => {
        const { getById } = renderWithDemoConfig(JOBLIB_SIMPLE);
        const blocks = getById('block-list');
        assert_1.default.strictEqual(blocks.children.length, 1, 'Bloques debe quedar vacia');
        assert_1.default.strictEqual(blocks.children[0].className, 'empty');
    });
    it('debe dejar en Bloques lo que no calza con el formato simple', () => {
        const conDispDistinto = {
            ...JOBLIB_SIMPLE,
            blockTemplates: {
                JOBLIB: {
                    PRODUCCION: ['//JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=OLD']
                }
            }
        };
        const { getById } = renderWithDemoConfig(conDispDistinto);
        assert_1.default.strictEqual(getById('library-list').children[0].className, 'empty');
        assert_1.default.strictEqual(getById('block-list').children.length, 1);
    });
    it('no debe confundir el nombre del DD con una continuacion', () => {
        const { context } = renderWithDemoConfig();
        assert_1.default.strictEqual(context.parseLibraryDatasets('JOBLIB', [
            '//STEPLIB  DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR'
        ]), null, 'el nombre del bloque y el de la primera linea deben coincidir');
        assert_1.default.strictEqual(context.parseLibraryDatasets('JOBLIB', [
            '//JOBLIB   DD  DSN=A.B,DISP=SHR',
            '//JOBLIB   DD  DSN=C.D,DISP=SHR'
        ]), null, 'solo la primera linea lleva nombre');
    });
});
/**
 * El buscador esconde tarjetas con CSS en vez de dejar de dibujarlas, porque
 * collectState() arma la config leyendo el DOM: una tarjeta no dibujada se
 * perderia al guardar. Aca se fija la logica de comparacion y el contador.
 */
describe('configWebView (buscador)', () => {
    it('debe ignorar mayusculas y acentos al comparar', () => {
        const { context } = renderWithDemoConfig();
        assert_1.default.strictEqual(context.searchKey('  PARÁMETRO  '.trim()), 'parametro');
        assert_1.default.strictEqual(context.searchKey('Librería'), 'libreria');
    });
    it('debe encontrar la regla por cualquiera de sus campos', () => {
        const { context } = renderWithDemoConfig();
        const campos = ['PCRE', 'DCRE', 'TCRE'];
        assert_1.default.ok(context.matchesQuery(campos, 'dcre'), 'debe buscar en los ambientes');
        assert_1.default.ok(context.matchesQuery(campos, 'cre'), 'debe aceptar coincidencias parciales');
        assert_1.default.ok(!context.matchesQuery(campos, 'xxxx'), 'no debe inventar coincidencias');
    });
    it('debe mostrar todo cuando la busqueda esta vacia', () => {
        const { context } = renderWithDemoConfig();
        assert_1.default.ok(context.matchesQuery([], ''), 'sin texto no se filtra nada');
        assert_1.default.strictEqual(context.describeCount(80, 80, ''), '80 en total');
    });
    it('debe avisar cuando la busqueda no encuentra nada', () => {
        const { context } = renderWithDemoConfig();
        assert_1.default.strictEqual(context.describeCount(3, 80, 'prod'), '3 de 80');
        assert_1.default.strictEqual(context.describeCount(0, 80, 'zzz'), 'Ninguna de las 80 coincide');
        assert_1.default.strictEqual(context.describeCount(0, 0, ''), '', 'lista vacia no muestra contador');
    });
    it('debe esconder el buscador mientras la lista sea corta', () => {
        const { getById } = renderWithDemoConfig();
        // La config demo trae un solo prefijo.
        assert_1.default.ok(getById('prefix-toolbar').classList.contains('hidden'));
    });
    it('debe mostrar el buscador cuando la lista se hace larga', () => {
        const muchosPrefijos = {
            ...CONFIG_DEMO,
            prefixMappings: Array.from({ length: 12 }, (_unused, index) => ({
                sourcePrefix: `PRE${index}`,
                environmentTargets: { DESARROLLO: `DES${index}` }
            }))
        };
        const { getById } = renderWithDemoConfig(muchosPrefijos);
        assert_1.default.ok(!getById('prefix-toolbar').classList.contains('hidden'), 'con 12 prefijos el buscador tiene que estar visible');
        assert_1.default.strictEqual(getById('prefix-list').children.length, 12, 'se dibujan todas');
    });
});
//# sourceMappingURL=webview.test.js.map