"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JclParser = void 0;
const types_1 = require("./types");
const INLINE_DATA_START_REGEX = /^\/\/([A-Z0-9]{1,8})?\s+DD\s+(\*|DATA\b)/i;
const INLINE_DATA_END_PREFIX = '/*';
const COMMENT_PREFIX = '//*';
const DD_STANDARD_REGEX = /^\/\/([A-Z0-9]{1,8})?\s+DD\s+/i;
class JclParser {
    /**
     * Parsea texto JCL completo.
     * Útil para motor de reemplazo y tests unitarios.
     */
    parseText(text) {
        const lines = text.split(/\r?\n/);
        return this.parseLines(lines);
    }
    /**
     * Parsea línea por línea aplicando Regla 1 y Regla 2.
     */
    parseLines(lines) {
        const parsedLines = [];
        let isInInlineData = false;
        for (let i = 0; i < lines.length; i++) {
            const rawText = lines[i];
            let type;
            let isMutable = true;
            // Si estamos dentro de un bloque DD *, mandan los datos en línea.
            if (isInInlineData) {
                // Fin de data en línea: /* en columna 1.
                if (rawText.startsWith(INLINE_DATA_END_PREFIX)) {
                    type = types_1.JclLineType.InlineDataEnd;
                    isInInlineData = false;
                }
                else {
                    type = types_1.JclLineType.InlineData;
                }
                // Regla 2: data en línea intocable por defecto.
                isMutable = false;
            }
            // Regla 1: comentarios //* en columnas 1-3.
            else if (rawText.startsWith(COMMENT_PREFIX)) {
                type = types_1.JclLineType.Comment;
                isMutable = false;
            }
            // Inicio de data en línea: DD * o DD DATA.
            else if (INLINE_DATA_START_REGEX.test(rawText)) {
                type = types_1.JclLineType.InlineDataStart;
                // La tarjeta DD en sí es una sentencia JCL, pero por seguridad
                // el motor de reemplazo la tratará como protegida en esta fase.
                isMutable = true;
                isInInlineData = true;
            }
            else if (rawText.trim() === '') {
                type = types_1.JclLineType.Blank;
                isMutable = false;
            }
            else if (DD_STANDARD_REGEX.test(rawText)) {
                type = types_1.JclLineType.DDStatement;
            }
            else {
                type = types_1.JclLineType.JclStatement;
            }
            parsedLines.push({
                lineNumber: i,
                rawText,
                type,
                isMutable
            });
        }
        return parsedLines;
    }
}
exports.JclParser = JclParser;
//# sourceMappingURL=jclParser.js.map