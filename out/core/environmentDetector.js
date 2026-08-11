"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvironmentDetector = void 0;
const types_1 = require("./types");
const jclParser_1 = require("./jclParser");
const DSN_REGEX = /(?<![A-Za-z0-9_&])(DSN\s*=\s*)([A-Za-z0-9@#$\.\-]+)/gi;
const ANONYMOUS_DD_REGEX = /^\/\/\s+DD\b/i;
class EnvironmentDetector {
    config;
    parser = new jclParser_1.JclParser();
    /**
     * Normalized environment -> original environment label found in config.
     */
    envOriginal = new Map();
    /**
     * Normalized dataset -> environments where that dataset is configured.
     */
    completeDatasetIndex = new Map();
    constructor(config) {
        this.config = config;
        this.collectEnvironments();
        this.buildCompleteDatasetIndex();
    }
    /**
     * Returns all environments found in the configuration.
     */
    getKnownEnvironments() {
        return Array.from(this.envOriginal.values()).sort();
    }
    /**
     * Detects the current environment for a JCL text.
     */
    detectText(text) {
        const scores = new Map();
        const reasons = [];
        const unknownPrefixes = new Set();
        const warnings = new Set();
        if (this.envOriginal.size === 0) {
            warnings.add('No hay ambientes configurados en jcl-environments.json.');
            return {
                detectedEnvironment: undefined,
                isAmbiguous: false,
                scores: {},
                unknownPrefixes: [],
                warnings: Array.from(warnings),
                reasons
            };
        }
        const parsed = this.parser.parseText(text);
        this.detectBlockTemplates(parsed, scores, reasons);
        this.detectDatasets(parsed, scores, reasons, unknownPrefixes);
        this.detectParameters(parsed, scores, reasons);
        const positiveScores = Array.from(scores.entries()).filter(([, score]) => score > 0);
        if (positiveScores.length === 0) {
            return {
                detectedEnvironment: undefined,
                isAmbiguous: false,
                scores: this.buildScoresOutput(scores),
                unknownPrefixes: Array.from(unknownPrefixes).sort(),
                warnings: Array.from(warnings).sort(),
                reasons
            };
        }
        const maxScore = Math.max(...positiveScores.map(([, score]) => score));
        const topEnvironments = positiveScores.filter(([, score]) => score === maxScore);
        const isAmbiguous = topEnvironments.length > 1;
        const detectedEnvironment = isAmbiguous
            ? undefined
            : this.envOriginal.get(topEnvironments[0][0]) ?? topEnvironments[0][0];
        return {
            detectedEnvironment,
            isAmbiguous,
            scores: this.buildScoresOutput(scores),
            unknownPrefixes: Array.from(unknownPrefixes).sort(),
            warnings: Array.from(warnings).sort(),
            reasons
        };
    }
    // =====================================================================
    // ENVIRONMENT CATALOG
    // =====================================================================
    collectEnvironments() {
        const addEnvironmentKey = (environment) => {
            this.addEnvironment(environment);
        };
        for (const mapping of this.config.prefixMappings ?? []) {
            Object.keys(mapping.environmentTargets ?? {}).forEach(addEnvironmentKey);
        }
        for (const rule of this.config.completeDatasetRules ?? []) {
            Object.keys(rule.environments ?? {}).forEach(addEnvironmentKey);
        }
        for (const blockByEnvironment of Object.values(this.config.blockTemplates ?? {})) {
            Object.keys(blockByEnvironment ?? {}).forEach(addEnvironmentKey);
        }
        for (const rule of this.config.parameterRules ?? []) {
            Object.keys(rule.values ?? {}).forEach(addEnvironmentKey);
        }
    }
    addEnvironment(environment) {
        if (!environment) {
            return;
        }
        const normalized = this.normalize(environment);
        if (!normalized) {
            return;
        }
        if (!this.envOriginal.has(normalized)) {
            this.envOriginal.set(normalized, environment.trim());
        }
    }
    // =====================================================================
    // COMPLETE DATASET INDEX
    // =====================================================================
    buildCompleteDatasetIndex() {
        for (const rule of this.config.completeDatasetRules ?? []) {
            if (!rule || !rule.environments) {
                continue;
            }
            for (const [environmentKey, dataset] of Object.entries(rule.environments)) {
                if (typeof dataset !== 'string' || dataset.trim().length === 0) {
                    continue;
                }
                const normalizedDataset = this.normalize(dataset);
                const normalizedEnvironment = this.normalize(environmentKey);
                if (!normalizedDataset || !normalizedEnvironment) {
                    continue;
                }
                if (!this.completeDatasetIndex.has(normalizedDataset)) {
                    this.completeDatasetIndex.set(normalizedDataset, new Set());
                }
                this.completeDatasetIndex.get(normalizedDataset).add(normalizedEnvironment);
            }
        }
    }
    // =====================================================================
    // BLOCK TEMPLATE DETECTION
    // =====================================================================
    detectBlockTemplates(parsed, scores, reasons) {
        const blockTemplates = this.config.blockTemplates ?? {};
        const blockNames = Object.keys(blockTemplates);
        if (blockNames.length === 0) {
            return;
        }
        for (let i = 0; i < parsed.length; i++) {
            const line = parsed[i];
            if (!line.isMutable || line.type !== types_1.JclLineType.DDStatement) {
                continue;
            }
            const blockName = this.findBlockName(line.rawText, blockNames);
            if (!blockName) {
                continue;
            }
            const blockEnd = this.findBlockEnd(parsed, i);
            const existingBlockLines = parsed
                .slice(i, blockEnd + 1)
                .map(l => l.rawText);
            const templatesByEnvironment = blockTemplates[blockName] ?? {};
            for (const [environmentKey, templateLines] of Object.entries(templatesByEnvironment)) {
                if (!Array.isArray(templateLines)) {
                    continue;
                }
                const normalizedTemplateLines = templateLines.map(templateLine => String(templateLine));
                if (this.areArraysEqual(existingBlockLines, normalizedTemplateLines)) {
                    this.addScore(scores, environmentKey, 100, reasons, `Bloque "${blockName}" coincide exactamente con "${environmentKey}".`);
                }
            }
        }
    }
    findBlockName(rawText, blockNames) {
        for (const blockName of blockNames) {
            const regex = new RegExp(`^\\/\\/${this.escapeRegExp(blockName)}\\s+DD\\b`, 'i');
            if (regex.test(rawText)) {
                return blockName;
            }
        }
        return undefined;
    }
    findBlockEnd(parsed, startIndex) {
        let end = startIndex;
        for (let i = startIndex + 1; i < parsed.length; i++) {
            const line = parsed[i];
            if (!line.isMutable || line.type !== types_1.JclLineType.DDStatement) {
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
    // DATASET DETECTION
    // =====================================================================
    detectDatasets(parsed, scores, reasons, unknownPrefixes) {
        for (const line of parsed) {
            if (!this.isAnalyzable(line)) {
                continue;
            }
            line.rawText.replace(DSN_REGEX, (match, _dsnKeyword, dataset) => {
                if (!dataset || dataset.startsWith('&')) {
                    return match;
                }
                const normalizedDataset = this.normalize(dataset);
                // ------------------------------------------------------------
                // Complete dataset rules.
                // ------------------------------------------------------------
                const completeEnvironments = this.completeDatasetIndex.get(normalizedDataset);
                if (completeEnvironments && completeEnvironments.size > 0) {
                    for (const normalizedEnvironment of completeEnvironments) {
                        const environmentLabel = this.envOriginal.get(normalizedEnvironment) ?? normalizedEnvironment;
                        this.addScore(scores, normalizedEnvironment, 100, reasons, `DSN exacto "${dataset}" coincide con "${environmentLabel}".`);
                    }
                    return match;
                }
                // ------------------------------------------------------------
                // Prefix mappings.
                // ------------------------------------------------------------
                const segments = dataset.split('.');
                const prefix = segments[0];
                const prefixEnvironments = this.findPrefixEnvironments(prefix);
                if (prefixEnvironments.length > 0) {
                    for (const normalizedEnvironment of prefixEnvironments) {
                        const environmentLabel = this.envOriginal.get(normalizedEnvironment) ?? normalizedEnvironment;
                        this.addScore(scores, normalizedEnvironment, 20, reasons, `Prefijo "${prefix}" coincide con "${environmentLabel}".`);
                    }
                }
                else {
                    // Unknown prefix.
                    if (dataset.includes('.') && /^[A-Za-z0-9@#$\-]+$/.test(prefix)) {
                        unknownPrefixes.add(this.normalize(prefix));
                    }
                }
                return match;
            });
        }
    }
    findPrefixEnvironments(prefix) {
        const normalizedPrefix = this.normalize(prefix);
        const environments = new Set();
        if (!normalizedPrefix) {
            return [];
        }
        for (const mapping of this.config.prefixMappings ?? []) {
            if (!mapping || !mapping.environmentTargets) {
                continue;
            }
            for (const [environmentKey, configuredPrefix] of Object.entries(mapping.environmentTargets)) {
                if (this.normalize(configuredPrefix) === normalizedPrefix) {
                    const normalizedEnvironment = this.normalize(environmentKey);
                    if (normalizedEnvironment) {
                        environments.add(normalizedEnvironment);
                    }
                }
            }
        }
        return Array.from(environments);
    }
    // =====================================================================
    // PARAMETER DETECTION
    // =====================================================================
    detectParameters(parsed, scores, reasons) {
        const rules = this.config.parameterRules ?? [];
        for (const rule of rules) {
            if (!rule || !rule.parameter || !rule.values) {
                continue;
            }
            if (this.normalize(rule.parameter) === 'DSN') {
                continue;
            }
            const paramRegex = new RegExp(`(?<![A-Za-z0-9_&])(${this.escapeRegExp(rule.parameter)}\\s*=\\s*)([^,\\s)]+)`, 'gi');
            for (const line of parsed) {
                if (!this.isAnalyzable(line)) {
                    continue;
                }
                line.rawText.replace(paramRegex, (match, _paramKeyword, currentValue) => {
                    const normalizedCurrentValue = this.normalize(currentValue);
                    if (!normalizedCurrentValue) {
                        return match;
                    }
                    for (const [environmentKey, configuredValue] of Object.entries(rule.values)) {
                        if (this.normalize(configuredValue) === normalizedCurrentValue) {
                            this.addScore(scores, environmentKey, 1, reasons, `Parámetro "${rule.parameter}=${currentValue}" coincide con "${environmentKey}".`);
                        }
                    }
                    return match;
                });
            }
        }
    }
    // =====================================================================
    // HELPERS
    // =====================================================================
    isAnalyzable(line) {
        return (line.isMutable &&
            line.type !== types_1.JclLineType.Comment &&
            line.type !== types_1.JclLineType.Blank &&
            line.type !== types_1.JclLineType.InlineData &&
            line.type !== types_1.JclLineType.InlineDataEnd &&
            line.type !== types_1.JclLineType.InlineDataStart);
    }
    addScore(scores, environment, amount, reasons, reason) {
        const normalizedEnvironment = this.normalize(environment);
        if (!normalizedEnvironment || amount <= 0) {
            return;
        }
        const current = scores.get(normalizedEnvironment) ?? 0;
        scores.set(normalizedEnvironment, current + amount);
        if (reason) {
            reasons.push(reason);
        }
    }
    buildScoresOutput(scores) {
        const output = {};
        for (const [normalizedEnvironment, score] of scores.entries()) {
            const environmentLabel = this.envOriginal.get(normalizedEnvironment) ?? normalizedEnvironment;
            output[environmentLabel] = (output[environmentLabel] ?? 0) + score;
        }
        return output;
    }
    normalize(value) {
        if (value === undefined || value === null) {
            return '';
        }
        return String(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase();
    }
    escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    areArraysEqual(a, b) {
        if (a.length !== b.length) {
            return false;
        }
        return a.every((value, index) => value === b[index]);
    }
}
exports.EnvironmentDetector = EnvironmentDetector;
//# sourceMappingURL=environmentDetector.js.map