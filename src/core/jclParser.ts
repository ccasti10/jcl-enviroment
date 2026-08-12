import { JclLineType, ParsedLine } from './types';

const INLINE_DATA_START_REGEX = /^\/\/([A-Z0-9]{1,8})?\s+DD\s+(\*|DATA\b)/i;
const INLINE_DATA_END_PREFIX = '/*';
const COMMENT_PREFIX = '//*';
const DD_STANDARD_REGEX = /^\/\/([A-Z0-9]{1,8})?\s+DD\s+/i;
const EXEC_PGM_REGEX = /^\/\/\S*\s+EXEC\s+PGM\s*=\s*([A-Za-z0-9@#$]+)/i;

export class JclParser {
    /**
     * Parsea texto JCL completo.
     * Útil para motor de reemplazo y tests unitarios.
     */
    public parseText(text: string): ParsedLine[] {
        const lines = text.split(/\r?\n/);
        return this.parseLines(lines);
    }

    /**
     * Parsea línea por línea aplicando Regla 1 y Regla 2.
     */
    public parseLines(lines: string[]): ParsedLine[] {
        const parsedLines: ParsedLine[] = [];
        let isInInlineData = false;
        let currentProgram: string | undefined;

        for (let i = 0; i < lines.length; i++) {
            const rawText = lines[i];
            let type: JclLineType;
            let isMutable = true;

            if (!isInInlineData) {
                const execMatch = EXEC_PGM_REGEX.exec(rawText);
                if (execMatch) {
                    currentProgram = execMatch[1].toUpperCase();
                }
            }

            // Si estamos dentro de un bloque DD *, mandan los datos en línea.
            if (isInInlineData) {
                // Fin de data en línea: /* en columna 1.
                if (rawText.startsWith(INLINE_DATA_END_PREFIX)) {
                    type = JclLineType.InlineDataEnd;
                    isInInlineData = false;
                } else {
                    type = JclLineType.InlineData;
                }

                // Regla 2: data en línea intocable por defecto.
                isMutable = false;
            }
            // Regla 1: comentarios //* en columnas 1-3.
            else if (rawText.startsWith(COMMENT_PREFIX)) {
                type = JclLineType.Comment;
                isMutable = false;
            }
            // Inicio de data en línea: DD * o DD DATA.
            else if (INLINE_DATA_START_REGEX.test(rawText)) {
                type = JclLineType.InlineDataStart;

                // La tarjeta DD en sí es una sentencia JCL, pero por seguridad
                // el motor de reemplazo la tratará como protegida en esta fase.
                isMutable = true;
                isInInlineData = true;
            }
            else if (rawText.trim() === '') {
                type = JclLineType.Blank;
                isMutable = false;
            }
            else if (DD_STANDARD_REGEX.test(rawText)) {
                type = JclLineType.DDStatement;
            }
            else {
                type = JclLineType.JclStatement;
            }

            parsedLines.push({
                lineNumber: i,
                rawText,
                type,
                isMutable,
                execProgram: currentProgram
            });
        }

        return parsedLines;
    }
}