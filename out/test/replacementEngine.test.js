"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const replacementEngine_1 = require("../core/replacementEngine");
describe('ReplacementEngine', () => {
    const config = {
        prefixMappings: [
            {
                sourcePrefix: 'PROD',
                environmentTargets: {
                    DESARROLLO: 'DESA',
                    TEST: 'TEST',
                    PRODUCCION: 'PROD'
                }
            }
        ],
        completeDatasetRules: [
            {
                name: 'Datasets de NW',
                environments: {
                    PRODUCCION: 'PXXX.NW.EJEMPLO',
                    DESARROLLO: 'DXXX.WWW.NW.EJEMPLO'
                }
            }
        ],
        blockTemplates: {
            JOBLIB: {
                PRODUCCION: [
                    '//JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR'
                ],
                DESARROLLO: [
                    '//JOBLIB   DD  DSN=DESA.BATCH.LOADLIB,DISP=SHR'
                ]
            }
        },
        parameterRules: [
            {
                parameter: 'CLASS',
                values: {
                    PRODUCCION: 'A',
                    DESARROLLO: 'D',
                    TEST: 'D'
                }
            }
        ]
    };
    it('no debe modificar comentarios', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = [
            '//* DSN=PROD.NO.TOUCH',
            '//DD1    DD  DSN=PROD.SI.TOUCH,DISP=SHR'
        ].join('\n');
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes('//* DSN=PROD.NO.TOUCH'));
        assert_1.default.ok(result.text.includes('DSN=DESA.SI.TOUCH'));
    });
    it('no debe modificar data dentro de DD *', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = [
            '//SYSIN DD *',
            'DSN=PROD.NO.TOUCH',
            '/*',
            '//DD1    DD  DSN=PROD.SI.TOUCH,DISP=SHR'
        ].join('\n');
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes('DSN=PROD.NO.TOUCH'));
        assert_1.default.ok(result.text.includes('DSN=DESA.SI.TOUCH'));
    });
    it('debe reemplazar bloques JOBLIB completos', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = '//JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR';
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.strictEqual(result.text, '//JOBLIB   DD  DSN=DESA.BATCH.LOADLIB,DISP=SHR');
    });
    it('debe dar prioridad a completeDatasetRules sobre prefixMappings', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = '//DD1    DD  DSN=PXXX.NW.EJEMPLO,DISP=SHR';
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes('DXXX.WWW.NW.EJEMPLO'));
    });
    it('debe reportar prefijos desconocidos', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = '//DD1    DD  DSN=EEEE.UNKNOWN.DATASET,DISP=SHR';
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.strictEqual(result.replacements, 0);
        assert_1.default.deepStrictEqual(result.unknownPrefixes, ['EEEE']);
    });
    it('debe reemplazar parámetros simples', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = '//JOB0001 JOB (ACCT),CLASS=A';
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes('CLASS=D'));
    });
    it('debe reemplazar datasets bare en DELETE/ALTER dentro de SYSIN de un step IDCAMS', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = [
            '//STEP01  EXEC PGM=IDCAMS',
            '//SYSIN    DD *',
            '  DELETE PROD.BATCH.LOADLIB',
            '  ALTER  PROD.SI.TOUCH NEWNAME(PROD.SI.TOUCH2)',
            '/*',
            '//DD1    DD  DSN=PROD.SI.TOUCH,DISP=SHR'
        ].join('\n');
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes('DELETE DESA.BATCH.LOADLIB'));
        assert_1.default.ok(result.text.includes('ALTER  DESA.SI.TOUCH'));
        assert_1.default.ok(result.text.includes('DSN=DESA.SI.TOUCH'));
    });
    it('debe reemplazar el dataset de NAME(...) en un DEFINE dentro de SYSIN IDCAMS', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = [
            '//STEP01  EXEC PGM=IDCAMS',
            '//SYSIN    DD *',
            '  DEFINE CLUSTER (NAME(PROD.SI.TOUCH) -',
            '  VOLUMES(VOL001))',
            '/*'
        ].join('\n');
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes('NAME(DESA.SI.TOUCH)'));
    });
    it('debe reemplazar el dataset de LIB(...) dentro de SYSTSIN de un step IKJEFT01', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = [
            '//STEP01  EXEC PGM=IKJEFT01',
            '//SYSTSIN  DD *',
            '  DSN SYSTEM(DB2P)',
            "   RUN PROGRAM(CREB8617) -",
            "       PLAN(PPISI) LIB('PROD.BATCH.LOADLIB')",
            '   END',
            '/*'
        ].join('\n');
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes("LIB('DESA.BATCH.LOADLIB')"));
    });
    it('debe reemplazar LIB(...) en SYSTSIN aunque el step invoque un PROC sin PGM=', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = [
            '//STEP01  EXEC DB2BATCH',
            '//SYSTSIN  DD *',
            '  DSN SYSTEM(DB2P)',
            "       PLAN(PPISI) LIB('PROD.BATCH.LOADLIB')",
            '   END',
            '/*'
        ].join('\n');
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes("LIB('DESA.BATCH.LOADLIB')"));
    });
    it('debe reemplazar SYSTEM(...) y PLAN(...) además del LIB en un bloque SYSTSIN', () => {
        const engine = new replacementEngine_1.ReplacementEngine({
            ...config,
            parameterRules: [
                {
                    parameter: 'SYSTEM',
                    values: { PRODUCCION: 'DB2P', DESARROLLO: 'DB2D' }
                },
                {
                    parameter: 'PLAN',
                    values: { PRODUCCION: 'PPISI', DESARROLLO: 'PDISI' }
                }
            ]
        });
        const jcl = [
            '//STEP01  EXEC PGM=IKJEFT01',
            '//SYSTSIN  DD *',
            '  DSN SYSTEM(DB2P)',
            '   RUN PROGRAM(CREB8617) -',
            "       PLAN(PPISI) LIB('PROD.BATCH.LOADLIB')",
            '   END',
            '/*'
        ].join('\n');
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes('SYSTEM(DB2D)'));
        assert_1.default.ok(result.text.includes('PLAN(PDISI)'));
        assert_1.default.ok(result.text.includes("LIB('DESA.BATCH.LOADLIB')"));
    });
    it('no debe tocar LIB(...) dentro de un SYSIN que no es SYSTSIN', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = [
            '//STEP01  EXEC PGM=IEBGENER',
            '//SYSIN    DD *',
            "  LIB('PROD.NO.TOUCH')",
            '/*'
        ].join('\n');
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes("LIB('PROD.NO.TOUCH')"));
    });
    it('no debe modificar data dentro de DD * de un step que no es IDCAMS', () => {
        const engine = new replacementEngine_1.ReplacementEngine(config);
        const jcl = [
            '//STEP01  EXEC PGM=IEBGENER',
            '//SYSIN    DD *',
            '  DELETE PROD.NO.TOUCH',
            '/*'
        ].join('\n');
        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');
        assert_1.default.ok(result.text.includes('DELETE PROD.NO.TOUCH'));
    });
});
//# sourceMappingURL=replacementEngine.test.js.map