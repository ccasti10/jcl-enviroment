"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveConfigFilePath = resolveConfigFilePath;
exports.getOrCreateConfigFilePath = getOrCreateConfigFilePath;
exports.loadJclEnvironmentsConfig = loadJclEnvironmentsConfig;
exports.saveJclEnvironmentsConfig = saveJclEnvironmentsConfig;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
async function resolveConfigFilePath() {
    const settings = vscode.workspace.getConfiguration('jclSwitcher');
    const configuredPath = settings.get('configFilePath');
    if (configuredPath && configuredPath.trim().length > 0) {
        if (path.isAbsolute(configuredPath)) {
            return configuredPath;
        }
        const firstFolder = vscode.workspace.workspaceFolders?.[0];
        if (!firstFolder) {
            vscode.window.showWarningMessage('JCL Switcher: hay una ruta relativa configurada, pero no hay un workspace abierto.');
            return undefined;
        }
        return path.join(firstFolder.uri.fsPath, configuredPath);
    }
    const files = await vscode.workspace.findFiles('**/jcl-environments.json', '**/node_modules/**', 1);
    if (files.length > 0) {
        return files[0].fsPath;
    }
    return undefined;
}
async function getOrCreateConfigFilePath() {
    const existing = await resolveConfigFilePath();
    if (existing) {
        return existing;
    }
    const firstFolder = vscode.workspace.workspaceFolders?.[0];
    if (firstFolder) {
        return path.join(firstFolder.uri.fsPath, 'jcl-environments.json');
    }
    const chosen = await vscode.window.showSaveDialog({
        saveLabel: 'Crear jcl-environments.json',
        filters: {
            JSON: ['json']
        }
    });
    if (!chosen) {
        throw new Error('No se seleccionó ubicación para jcl-environments.json.');
    }
    return chosen.fsPath;
}
async function loadJclEnvironmentsConfig() {
    const configFilePath = await resolveConfigFilePath();
    if (!configFilePath) {
        return undefined;
    }
    try {
        const raw = await fs.readFile(configFilePath, 'utf8');
        const sanitized = raw.replace(/^\uFEFF/, '');
        return JSON.parse(sanitized);
    }
    catch (error) {
        const message = error instanceof Error
            ? error.message
            : String(error);
        vscode.window.showErrorMessage(`JCL Switcher: no se pudo leer la configuración desde "${configFilePath}". ${message}`);
        return undefined;
    }
}
async function saveJclEnvironmentsConfig(config) {
    const filePath = await getOrCreateConfigFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf8');
    return filePath;
}
//# sourceMappingURL=configLoader.js.map