import assert from 'assert';
import { EnvironmentDetector } from '../core/environmentDetector';
import { JclEnvironmentsConfig } from '../core/config.types';

describe('EnvironmentDetector', () => {
    it('debe detectar ambigüedad cuando CLASS=D aplica a varios ambientes', () => {
        const config: JclEnvironmentsConfig = {
            parameterRules: [
                {
                    parameter: 'CLASS',
                    values: {
                        DESARROLLO: 'D',
                        TEST: 'D',
                        PRODUCCION: 'A'
                    }
                }
            ]
        };

        const detector = new EnvironmentDetector(config);
        const result = detector.detectText('//JOB0001 JOB (ACCT),CLASS=D');

        assert.strictEqual(result.isAmbiguous, true);
        assert.strictEqual(result.detectedEnvironment, undefined);
    });

    it('debe detectar DESARROLLO por prefijo', () => {
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
            ]
        };

        const detector = new EnvironmentDetector(config);
        const result = detector.detectText('//DD1 DD DSN=DESA.BATCH.LOADLIB');

        assert.strictEqual(result.isAmbiguous, false);
        assert.strictEqual(result.detectedEnvironment, 'DESARROLLO');
    });

    it('debe detectar PRODUCCION por dataset completo', () => {
        const config: JclEnvironmentsConfig = {
            completeDatasetRules: [
                {
                    name: 'NW',
                    environments: {
                        PRODUCCION: 'PXXX.NW.EJEMPLO',
                        DESARROLLO: 'DXXX.WWW.NW.EJEMPLO'
                    }
                }
            ]
        };

        const detector = new EnvironmentDetector(config);
        const result = detector.detectText('//DD1 DD DSN=PXXX.NW.EJEMPLO');

        assert.strictEqual(result.isAmbiguous, false);
        assert.strictEqual(result.detectedEnvironment, 'PRODUCCION');
    });
});