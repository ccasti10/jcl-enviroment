"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const jclParser_1 = require("../core/jclParser");
const types_1 = require("../core/types");
describe('JclParser', () => {
    it('debe marcar comentarios //* como inmutables', () => {
        const parser = new jclParser_1.JclParser();
        const parsed = parser.parseLines([
            '//* ESTO ES UN COMENTARIO',
            '//STEP01 EXEC PGM=IEBGENER'
        ]);
        assert_1.default.strictEqual(parsed[0].type, types_1.JclLineType.Comment);
        assert_1.default.strictEqual(parsed[0].isMutable, false);
        assert_1.default.strictEqual(parsed[1].type, types_1.JclLineType.JclStatement);
        assert_1.default.strictEqual(parsed[1].isMutable, true);
    });
    it('debe proteger bloques DD * hasta /*', () => {
        const parser = new jclParser_1.JclParser();
        const parsed = parser.parseLines([
            '//SYSIN DD *',
            'DSN=PROD.NO.TOUCH',
            '//* ESTO DENTRO DEL DD * ES DATA, NO COMENTARIO',
            '/*',
            '//STEP01 EXEC PGM=ABC'
        ]);
        assert_1.default.strictEqual(parsed[0].type, types_1.JclLineType.InlineDataStart);
        assert_1.default.strictEqual(parsed[1].type, types_1.JclLineType.InlineData);
        assert_1.default.strictEqual(parsed[1].isMutable, false);
        assert_1.default.strictEqual(parsed[2].type, types_1.JclLineType.InlineData);
        assert_1.default.strictEqual(parsed[2].isMutable, false);
        assert_1.default.strictEqual(parsed[3].type, types_1.JclLineType.InlineDataEnd);
        assert_1.default.strictEqual(parsed[3].isMutable, false);
        assert_1.default.strictEqual(parsed[4].type, types_1.JclLineType.JclStatement);
        assert_1.default.strictEqual(parsed[4].isMutable, true);
    });
    it('debe marcar execProgram con el PGM del step vigente', () => {
        const parser = new jclParser_1.JclParser();
        const parsed = parser.parseLines([
            '//STEP01 EXEC PGM=IDCAMS',
            '//SYSIN DD *',
            '  DELETE PROD.OLD.FILE',
            '/*',
            '//STEP02 EXEC PGM=IEBGENER',
            '//SYSIN DD *',
            'ALGO'
        ]);
        assert_1.default.strictEqual(parsed[0].execProgram, 'IDCAMS');
        assert_1.default.strictEqual(parsed[1].execProgram, 'IDCAMS');
        assert_1.default.strictEqual(parsed[2].execProgram, 'IDCAMS');
        assert_1.default.strictEqual(parsed[3].execProgram, 'IDCAMS');
        assert_1.default.strictEqual(parsed[4].execProgram, 'IEBGENER');
        assert_1.default.strictEqual(parsed[5].execProgram, 'IEBGENER');
        assert_1.default.strictEqual(parsed[6].execProgram, 'IEBGENER');
    });
});
//# sourceMappingURL=parser.test.js.map