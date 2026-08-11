import { JclLineType, ParsedLine } from './types';
import { JclParser } from './jclParser';
import {
    CompleteDatasetRule,
    JclEnvironmentsConfig,
    PrefixMapping
} from './config.types';

export interface ReplacementResult {
    text: string;
    replacements: number;
    unknownPrefixes: string[];
    warnings: string[];
}

interface EngineLine extends ParsedLine {
    fromTemplate?: boolean;
}

interface CompleteDatasetMatch {
    rule: CompleteDatasetRule;
    environmentKey: string;
    dataset: string;
}

interface ReplacementContext {
    targetEnvironment: string;
    replacements: number;
    unknownPrefixes: Set<string>;
    warnings: Set<string>;
}

const DSN_REGEX = /(?<![A-Za-z0-9_&])(DSN\s*=\s*)([A-Za-z0-9@#$\.\-]+)/gi;
const ANONYMOUS_DD_REGEX = /^\/\/\s+DD\b/i;

export class ReplacementEngine {
    private readonly parser = new JclParser();

    constructor(private readonly config: JclEnvironmentsConfig) {}

    /**
     * Aplica el ambiente destino al texto JCL completo.
     */
    public applyEnvironmentToText(
        text: string,
        targetEnvironment: string
    ): ReplacementResult {
        const eol = text.includes('\r\n') ? '\r\n' : '\n';

        if (!targetEnvironment || targetEnvironment.trim().length === 0) {
            return {
                text,
                replacements: 0,
                unknownPrefixes: [],
                warnings: ['No se indicó un ambiente destino válido.']
            };
        }

        const parsed = this.parser.parseText(text);

        const ctx: ReplacementContext = {
            targetEnvironment,
            replacements: 0,
            unknownPrefixes: new Set<string>(),
            warnings: new Set<string>()
        };

        const completeDatasetIndex = this.buildCompleteDatasetIndex();

        // 1. Bloques completos.
        const blockProcessed = this.applyBlockTemplates(parsed, targetEnvironment, ctx);

        // 2/3/4. Datasets completos, prefijos y parámetros.
        const finalLines = blockProcessed.map(line =>
            this.applyLineLevelReplacements(line, targetEnvironment, completeDatasetIndex, ctx)
        );

        return {
            text: finalLines.join(eol),
            replacements: ctx.replacements,
            unknownPrefixes: Array.from(ctx.unknownPrefixes).sort(),
            warnings: Array.from(ctx.warnings).sort()
        };
    }

    // =====================================================================
    // BLOCK TEMPLATES
    // =====================================================================

    private applyBlockTemplates(
        parsed: ParsedLine[],
        targetEnvironment: string,
        ctx: ReplacementContext
    ): EngineLine[] {
        const blockTemplates = this.config.blockTemplates ?? {};
        const blockNames = Object.keys(blockTemplates);
        const output: EngineLine[] = [];

        let i = 0;

        while (i < parsed.length) {
            const line = parsed[i];

            if (!line.isMutable || line.type !== JclLineType.DDStatement) {
                output.push(line);
                i++;
                continue;
            }

            const blockName = this.findBlockName(line.rawText, blockNames);

            if (!blockName) {
                output.push(line);
                i++;
                continue;
            }

            const blockEnd = this.findBlockEnd(parsed, i);
            const templateByEnvironment = blockTemplates[blockName];
            const targetTemplate = this.getRecordValueByEnv<string[]>(
                templateByEnvironment,
                targetEnvironment
            );

            if (!Array.isArray(targetTemplate)) {
                ctx.warnings.add(
                    `El bloque "${blockName}" no tiene plantilla para el ambiente "${targetEnvironment}".`
                );

                // Si falta plantilla, protegemos el bloque actual para no modificarlo parcialmente.
                for (let j = i; j <= blockEnd; j++) {
                    output.push({
                        ...parsed[j],
                        isMutable: false
                    });
                }

                i = blockEnd + 1;
                continue;
            }

            const existingLines = parsed.slice(i, blockEnd + 1).map(l => l.rawText);
            const templateLines = targetTemplate.map(templateLine => String(templateLine));

            const changed = !this.areArraysEqual(existingLines, templateLines);

            if (changed) {
                ctx.replacements += 1;
            }

            for (const templateLine of templateLines) {
                output.push({
                    lineNumber: -1,
                    rawText: templateLine,
                    type: JclLineType.JclStatement,
                    isMutable: false,
                    fromTemplate: true
                });
            }

            i = blockEnd + 1;
        }

        return output;
    }

    private findBlockName(rawText: string, blockNames: string[]): string | undefined {
        for (const blockName of blockNames) {
            const regex = new RegExp(
                `^\\/\\/${this.escapeRegExp(blockName)}\\s+DD\\b`,
                'i'
            );

            if (regex.test(rawText)) {
                return blockName;
            }
        }

        return undefined;
    }

    private findBlockEnd(parsed: ParsedLine[], startIndex: number): number {
        let end = startIndex;

        for (let i = startIndex + 1; i < parsed.length; i++) {
            const line = parsed[i];

            if (!line.isMutable || line.type !== JclLineType.DDStatement) {
                break;
            }

            if (!ANONYMOUS_DD_REGEX.test(line.rawText)) {
                break;
            }

            end = i;
        }

        return end;
    }

    // =====================================================================
    // LINE LEVEL REPLACEMENTS
    // =====================================================================

    private applyLineLevelReplacements(
        line: EngineLine,
        targetEnvironment: string,
        completeDatasetIndex: Map<string, CompleteDatasetMatch>,
        ctx: ReplacementContext
    ): string {
        if (!line.isMutable || line.fromTemplate) {
            return line.rawText;
        }

        // Comentarios, blancos y data en línea no se tocan.
        if (
            line.type === JclLineType.Comment ||
            line.type === JclLineType.Blank ||
            line.type === JclLineType.InlineData ||
            line.type === JclLineType.InlineDataEnd ||
            line.type === JclLineType.InlineDataStart
        ) {
            return line.rawText;
        }

        let text = line.rawText;

        // Complete dataset rules + prefix mappings.
        text = this.replaceDatasets(text, targetEnvironment, completeDatasetIndex, ctx);

        // Parameter rules.
        text = this.replaceParameters(text, targetEnvironment, ctx);

        return text;
    }

    // =====================================================================
    // DSN REPLACEMENTS
    // =====================================================================

    private replaceDatasets(
        line: string,
        targetEnvironment: string,
        completeDatasetIndex: Map<string, CompleteDatasetMatch>,
        ctx: ReplacementContext
    ): string {
        return line.replace(
            DSN_REGEX,
            (match: string, dsnKeyword: string, dataset: string) => {
                if (!dataset || dataset.startsWith('&')) {
                    return match;
                }

                const normalizedDataset = this.normalize(dataset);

                // ------------------------------------------------------------
                // Prioridad 1: Complete Dataset Rules
                // ------------------------------------------------------------
                const completeMatch = completeDatasetIndex.get(normalizedDataset);

                if (completeMatch) {
                    const targetValue = this.getRecordValueByEnv<string>(
                        completeMatch.rule.environments,
                        targetEnvironment
                    );

                    if (targetValue === undefined) {
                        const ruleName = completeMatch.rule.name ?? normalizedDataset;
                        ctx.warnings.add(
                            `La regla de dataset completo "${ruleName}" no define valor para el ambiente "${targetEnvironment}".`
                        );
                        return match;
                    }

                    if (targetValue === dataset) {
                        return match;
                    }

                    ctx.replacements += 1;
                    return dsnKeyword + targetValue;
                }

                // ------------------------------------------------------------
                // Prioridad 2: Prefix Mappings
                // ------------------------------------------------------------
                const segments = dataset.split('.');
                const prefix = segments[0];
                const prefixGroup = this.findPrefixGroup(prefix);

                if (!prefixGroup) {
                    // Prefijo desconocido.
                    if (dataset.includes('.') && /^[A-Za-z0-9@#$\-]+$/.test(prefix)) {
                        ctx.unknownPrefixes.add(this.normalize(prefix));
                    }

                    return match;
                }

                const targetPrefix = this.getRecordValueByEnv<string>(
                    prefixGroup.environmentTargets,
                    targetEnvironment
                );

                if (targetPrefix === undefined) {
                    ctx.warnings.add(
                        `El prefijo "${prefix}" no define valor para el ambiente "${targetEnvironment}".`
                    );
                    return match;
                }

                let newDataset: string;

                if (dataset.includes('.')) {
                    const prefixRegex = new RegExp(
                        `^${this.escapeRegExp(prefix)}(?=\\.)`,
                        'i'
                    );

                    newDataset = dataset.replace(prefixRegex, targetPrefix);
                } else {
                    newDataset = targetPrefix;
                }

                if (newDataset === dataset) {
                    return match;
                }

                ctx.replacements += 1;
                return dsnKeyword + newDataset;
            }
        );
    }

    private findPrefixGroup(prefix: string): PrefixMapping | undefined {
        const normalizedPrefix = this.normalize(prefix);
        const mappings = this.config.prefixMappings ?? [];

        for (const mapping of mappings) {
            if (!mapping || !mapping.environmentTargets) {
                continue;
            }

            if (this.normalize(mapping.sourcePrefix) === normalizedPrefix) {
                return mapping;
            }

            const targetValues = Object.values(mapping.environmentTargets);

            if (targetValues.some(value => this.normalize(value) === normalizedPrefix)) {
                return mapping;
            }
        }

        return undefined;
    }

    private buildCompleteDatasetIndex(): Map<string, CompleteDatasetMatch> {
        const index = new Map<string, CompleteDatasetMatch>();
        const rules = this.config.completeDatasetRules ?? [];

        for (const rule of rules) {
            if (!rule || !rule.environments) {
                continue;
            }

            for (const [environmentKey, dataset] of Object.entries(rule.environments)) {
                if (typeof dataset !== 'string' || dataset.trim().length === 0) {
                    continue;
                }

                const normalizedDataset = this.normalize(dataset);

                if (!index.has(normalizedDataset)) {
                    index.set(normalizedDataset, {
                        rule,
                        environmentKey,
                        dataset
                    });
                }
            }
        }

        return index;
    }

    // =====================================================================
    // PARAMETER REPLACEMENTS
    // =====================================================================

    private replaceParameters(
        line: string,
        targetEnvironment: string,
        ctx: ReplacementContext
    ): string {
        let result = line;
        const rules = this.config.parameterRules ?? [];

        for (const rule of rules) {
            if (!rule || !rule.parameter || !rule.values) {
                continue;
            }

            // DSN se procesa en el motor de datasets, no como parámetro simple.
            if (this.normalize(rule.parameter) === 'DSN') {
                continue;
            }

            const paramRegex = new RegExp(
                `(?<![A-Za-z0-9_&])(${this.escapeRegExp(rule.parameter)}\\s*=\\s*)([^,\\s)]+)`,
                'gi'
            );

            result = result.replace(
                paramRegex,
                (match: string, paramKeyword: string, currentValue: string) => {
                    const knownValues = Object.values(rule.values);
                    const normalizedCurrentValue = this.normalize(currentValue);

                    const currentIsKnown = knownValues.some(
                        value => this.normalize(value) === normalizedCurrentValue
                    );

                    if (!currentIsKnown) {
                        return match;
                    }

                    const targetValue = this.getRecordValueByEnv<string>(
                        rule.values,
                        targetEnvironment
                    );

                    if (targetValue === undefined) {
                        ctx.warnings.add(
                            `El parámetro "${rule.parameter}" no define valor para el ambiente "${targetEnvironment}".`
                        );
                        return match;
                    }

                    if (targetValue === currentValue) {
                        return match;
                    }

                    ctx.replacements += 1;
                    return paramKeyword + targetValue;
                }
            );
        }

        return result;
    }

    // =====================================================================
    // HELPERS
    // =====================================================================

    private getRecordValueByEnv<T>(
        record: Record<string, T> | undefined,
        targetEnvironment: string
    ): T | undefined {
        if (!record) {
            return undefined;
        }

        const normalizedTarget = this.normalize(targetEnvironment);

        for (const [environmentKey, value] of Object.entries(record)) {
            if (this.normalize(environmentKey) === normalizedTarget) {
                return value;
            }
        }

        return undefined;
    }

    private normalize(value: string | undefined | null): string {
        if (value === undefined || value === null) {
            return '';
        }

        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase();
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private areArraysEqual(a: string[], b: string[]): boolean {
        if (a.length !== b.length) {
            return false;
        }

        return a.every((value, index) => value === b[index]);
    }
}