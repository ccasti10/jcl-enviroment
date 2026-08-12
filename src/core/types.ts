export enum JclLineType {
    Comment,        // //*
    InlineDataStart,// DD * o DD DATA
    InlineData,     // Data entre DD * y /*
    InlineDataEnd,  // /*
    JclStatement,   // JOB, EXEC, etc.
    DDStatement,    // DD estándar
    Blank,
    Unknown
}

export interface ParsedLine {
    lineNumber: number;
    rawText: string;
    type: JclLineType;
    isMutable: boolean;
    execProgram?: string;
}