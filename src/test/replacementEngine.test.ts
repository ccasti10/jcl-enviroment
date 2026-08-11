import assert from 'assert';
import { ReplacementEngine } from '../core/replacementEngine';
import { JclEnvironmentsConfig } from '../core/config.types';

describe('ReplacementEngine', () => {
    const config: JclEnvironmentsConfig = {
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
        const engine = new ReplacementEngine(config);

        const jcl = [
            '//* DSN=PROD.NO.TOUCH',
            '//DD1    DD  DSN=PROD.SI.TOUCH,DISP=SHR'
        ].join('\n');

        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');

        assert.ok(result.text.includes('//* DSN=PROD.NO.TOUCH'));
        assert.ok(result.text.includes('DSN=DESA.SI.TOUCH'));
    });

    it('no debe modificar data dentro de DD *', () => {
        const engine = new ReplacementEngine(config);

        const jcl = [
            '//SYSIN DD *',
            'DSN=PROD.NO.TOUCH',
            '/*',
            '//DD1    DD  DSN=PROD.SI.TOUCH,DISP=SHR'
        ].join('\n');

        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');

        assert.ok(result.text.includes('DSN=PROD.NO.TOUCH'));
        assert.ok(result.text.includes('DSN=DESA.SI.TOUCH'));
    });

    it('debe reemplazar bloques JOBLIB completos', () => {
        const engine = new ReplacementEngine(config);

        const jcl = '//JOBLIB   DD  DSN=PROD.BATCH.LOADLIB,DISP=SHR';

        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');

        assert.strictEqual(
            result.text,
            '//JOBLIB   DD  DSN=DESA.BATCH.LOADLIB,DISP=SHR'
        );
    });

    it('debe dar prioridad a completeDatasetRules sobre prefixMappings', () => {
        const engine = new ReplacementEngine(config);

        const jcl = '//DD1    DD  DSN=PXXX.NW.EJEMPLO,DISP=SHR';

        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');

        assert.ok(result.text.includes('DXXX.WWW.NW.EJEMPLO'));
    });

    it('debe reportar prefijos desconocidos', () => {
        const engine = new ReplacementEngine(config);

        const jcl = '//DD1    DD  DSN=EEEE.UNKNOWN.DATASET,DISP=SHR';

        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');

        assert.strictEqual(result.replacements, 0);
        assert.deepStrictEqual(result.unknownPrefixes, ['EEEE']);
    });

    it('debe reemplazar parámetros simples', () => {
        const engine = new ReplacementEngine(config);

        const jcl = '//JOB0001 JOB (ACCT),CLASS=A';

        const result = engine.applyEnvironmentToText(jcl, 'DESARROLLO');

        assert.ok(result.text.includes('CLASS=D'));
    });
});