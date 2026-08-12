import assert from 'assert';
import { JclParser } from '../core/jclParser';
import { JclLineType } from '../core/types';

describe('JclParser', () => {
    it('debe marcar comentarios //* como inmutables', () => {
        const parser = new JclParser();

        const parsed = parser.parseLines([
            '//* ESTO ES UN COMENTARIO',
            '//STEP01 EXEC PGM=IEBGENER'
        ]);

        assert.strictEqual(parsed[0].type, JclLineType.Comment);
        assert.strictEqual(parsed[0].isMutable, false);

        assert.strictEqual(parsed[1].type, JclLineType.JclStatement);
        assert.strictEqual(parsed[1].isMutable, true);
    });

    it('debe proteger bloques DD * hasta /*', () => {
        const parser = new JclParser();

        const parsed = parser.parseLines([
            '//SYSIN DD *',
            'DSN=PROD.NO.TOUCH',
            '//* ESTO DENTRO DEL DD * ES DATA, NO COMENTARIO',
            '/*',
            '//STEP01 EXEC PGM=ABC'
        ]);

        assert.strictEqual(parsed[0].type, JclLineType.InlineDataStart);

        assert.strictEqual(parsed[1].type, JclLineType.InlineData);
        assert.strictEqual(parsed[1].isMutable, false);

        assert.strictEqual(parsed[2].type, JclLineType.InlineData);
        assert.strictEqual(parsed[2].isMutable, false);

        assert.strictEqual(parsed[3].type, JclLineType.InlineDataEnd);
        assert.strictEqual(parsed[3].isMutable, false);

        assert.strictEqual(parsed[4].type, JclLineType.JclStatement);
        assert.strictEqual(parsed[4].isMutable, true);
    });

    it('debe marcar execProgram con el PGM del step vigente', () => {
        const parser = new JclParser();

        const parsed = parser.parseLines([
            '//STEP01 EXEC PGM=IDCAMS',
            '//SYSIN DD *',
            '  DELETE PROD.OLD.FILE',
            '/*',
            '//STEP02 EXEC PGM=IEBGENER',
            '//SYSIN DD *',
            'ALGO'
        ]);

        assert.strictEqual(parsed[0].execProgram, 'IDCAMS');
        assert.strictEqual(parsed[1].execProgram, 'IDCAMS');
        assert.strictEqual(parsed[2].execProgram, 'IDCAMS');
        assert.strictEqual(parsed[3].execProgram, 'IDCAMS');
        assert.strictEqual(parsed[4].execProgram, 'IEBGENER');
        assert.strictEqual(parsed[5].execProgram, 'IEBGENER');
        assert.strictEqual(parsed[6].execProgram, 'IEBGENER');
    });
});