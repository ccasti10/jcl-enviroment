export interface PrefixMapping {
    sourcePrefix: string;
    environmentTargets: Record<string, string>;
}

export interface CompleteDatasetRule {
    name?: string;
    environments: Record<string, string>;
}

export interface ParameterRule {
    parameter: string;
    values: Record<string, string>;
}

export type BlockTemplateByEnvironment = Record<string, string[]>;

export interface JclEnvironmentsConfig {
    prefixMappings?: PrefixMapping[];
    completeDatasetRules?: CompleteDatasetRule[];
    blockTemplates?: Record<string, BlockTemplateByEnvironment>;
    parameterRules?: ParameterRule[];
}