"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const environmentDetector_1 = require("../core/environmentDetector");
describe('EnvironmentDetector', () => {
    it('debe detectar ambigüedad cuando CLASS=D aplica a varios ambientes', () => {
        const config = {
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
        const detector = new environmentDetector_1.EnvironmentDetector(config);
        const result = detector.detectText('//JOB0001 JOB (ACCT),CLASS=D');
        assert_1.default.strictEqual(result.isAmbiguous, true);
        assert_1.default.strictEqual(result.detectedEnvironment, undefined);
    });
    it('debe detectar DESARROLLO por prefijo', () => {
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
            ]
        };
        const detector = new environmentDetector_1.EnvironmentDetector(config);
        const result = detector.detectText('//DD1 DD DSN=DESA.BATCH.LOADLIB');
        assert_1.default.strictEqual(result.isAmbiguous, false);
        assert_1.default.strictEqual(result.detectedEnvironment, 'DESARROLLO');
    });
    it('debe detectar PRODUCCION por dataset completo', () => {
        const config = {
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
        const detector = new environmentDetector_1.EnvironmentDetector(config);
        const result = detector.detectText('//DD1 DD DSN=PXXX.NW.EJEMPLO');
        assert_1.default.strictEqual(result.isAmbiguous, false);
        assert_1.default.strictEqual(result.detectedEnvironment, 'PRODUCCION');
    });
});
//# sourceMappingURL=environmentDetector.test.js.map