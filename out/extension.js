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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs/promises"));
const environmentDetector_1 = require("./core/environmentDetector");
const replacementEngine_1 = require("./core/replacementEngine");
const configLoader_1 = require("./core/configLoader");
const backupService_1 = require("./core/backupService");
const configWebView_1 = require("./webview/configWebView");
let statusBarItem;
let outputChannel;
let backupService;
let config;
let detector;
const manualOverrides = new Map();
const detectionCache = new Map();
const lastOriginalTexts = new Map();
const extensionEditedDocuments = new Set();
let debounceTimer;
async function activate(context) {
    outputChannel = vscode.window.createOutputChannel('JCL Switcher');
    backupService = new backupService_1.BackupService();
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'jclSwitcher.switchEnvironment';
    context.subscriptions.push(outputChannel);
    context.subscriptions.push(statusBarItem);
    context.subscriptions.push(vscode.commands.registerCommand('jclSwitcher.switchEnvironment', () => switchEnvironment()), vscode.commands.registerCommand('jclSwitcher.markAs', () => markAs()), vscode.commands.registerCommand('jclSwitcher.restoreOriginal', () => restoreOriginal()), vscode.commands.registerCommand('jclSwitcher.configVisual', () => configVisual(context.extensionUri)), vscode.commands.registerCommand('jclSwitcher.configJson', () => configJson()));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
        updateStatusBar();
    }), vscode.workspace.onDidCloseTextDocument(document => {
        const key = document.uri.toString();
        manualOverrides.delete(key);
        detectionCache.delete(key);
        lastOriginalTexts.delete(key);
        extensionEditedDocuments.delete(key);
    }), vscode.workspace.onDidChangeTextDocument(event => {
        const editor = vscode.window.activeTextEditor;
        if (editor &&
            event.document === editor.document &&
            isJclFile(event.document)) {
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
                updateStatusBar();
            }, 300);
        }
    }), vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('jclSwitcher.configFilePath')) {
            void refreshConfig();
        }
    }));
    const configWatcher = vscode.workspace.createFileSystemWatcher('**/jcl-environments.json');
    configWatcher.onDidCreate(() => void refreshConfig());
    configWatcher.onDidChange(() => void refreshConfig());
    configWatcher.onDidDelete(() => void refreshConfig());
    context.subscriptions.push(configWatcher);
    await refreshConfig();
    updateStatusBar();
}
function deactivate() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
}
// =========================================================================
// CONFIG
// =========================================================================
async function refreshConfig() {
    config = await (0, configLoader_1.loadJclEnvironmentsConfig)();
    detector = config ? new environmentDetector_1.EnvironmentDetector(config) : undefined;
    detectionCache.clear();
    if (!config) {
        outputChannel.appendLine('No se encontró jcl-environments.json. Puedes configurarlo con "jclSwitcher.configFilePath".');
    }
    else {
        outputChannel.appendLine('Configuración JCL cargada correctamente.');
    }
    updateStatusBar();
}
// =========================================================================
// STATUS BAR
// =========================================================================
function updateStatusBar() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isJclFile(editor.document)) {
        statusBarItem.hide();
        return;
    }
    const documentKey = editor.document.uri.toString();
    const manualEnvironment = manualOverrides.get(documentKey);
    if (manualEnvironment) {
        statusBarItem.text = `$(server-environment) JCL: ${manualEnvironment}`;
        statusBarItem.tooltip = `Ambiente forzado manualmente: ${manualEnvironment}`;
        statusBarItem.command = 'jclSwitcher.switchEnvironment';
        statusBarItem.show();
        return;
    }
    if (!detector) {
        statusBarItem.text = '$(server-environment) JCL: N/D';
        statusBarItem.tooltip =
            'No hay configuración JCL cargada. Ejecuta "JCL Switcher: Configurar Ambientes (Visual)".';
        statusBarItem.command = 'jclSwitcher.switchEnvironment';
        statusBarItem.show();
        return;
    }
    const detection = detector.detectText(editor.document.getText());
    detectionCache.set(documentKey, detection);
    if (detection.isAmbiguous) {
        const scores = Object.entries(detection.scores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([env, score]) => `${env}: ${score}`)
            .join(', ');
        statusBarItem.text = '$(warning) JCL: Mixto';
        statusBarItem.tooltip = `Ambiente ambiguo. ${scores}. Haz clic para marcar manualmente.`;
        statusBarItem.command = 'jclSwitcher.markAs';
        statusBarItem.show();
        return;
    }
    if (detection.detectedEnvironment) {
        statusBarItem.text = `$(server-environment) JCL: ${detection.detectedEnvironment}`;
        statusBarItem.tooltip = `Ambiente detectado: ${detection.detectedEnvironment}. Clic para cambiar.`;
        statusBarItem.command = 'jclSwitcher.switchEnvironment';
        statusBarItem.show();
        return;
    }
    statusBarItem.text = '$(server-environment) JCL: N/D';
    statusBarItem.tooltip =
        'No se pudo detectar el ambiente JCL. Clic para seleccionar manualmente.';
    statusBarItem.command = 'jclSwitcher.switchEnvironment';
    statusBarItem.show();
}
// =========================================================================
// COMMANDS
// =========================================================================
async function switchEnvironment() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isJclFile(editor.document)) {
        vscode.window.showWarningMessage('JCL Switcher: el archivo activo no parece un JCL.');
        return;
    }
    if (!config || !detector) {
        vscode.window.showErrorMessage('JCL Switcher: no hay configuración cargada. Crea o edita jcl-environments.json.');
        return;
    }
    const documentKey = editor.document.uri.toString();
    const manualEnvironment = manualOverrides.get(documentKey);
    let detection = detectionCache.get(documentKey);
    if (!detection) {
        detection = detector.detectText(editor.document.getText());
        detectionCache.set(documentKey, detection);
    }
    if (!manualEnvironment && detection.isAmbiguous) {
        const action = await vscode.window.showWarningMessage('JCL Switcher: el ambiente actual es ambiguo. Debes marcarlo manualmente antes de realizar cambios automáticos.', 'Marcar ambiente actual');
        if (action === 'Marcar ambiente actual') {
            await markAs();
        }
        return;
    }
    const environments = detector.getKnownEnvironments();
    if (environments.length === 0) {
        vscode.window.showErrorMessage('JCL Switcher: la configuración no define ambientes.');
        return;
    }
    const currentEnvironment = manualEnvironment ?? detection.detectedEnvironment;
    const items = environments.map(environment => ({
        label: environment,
        description: environment === currentEnvironment ? 'actual' : undefined
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title: 'JCL Switcher',
        placeHolder: 'Selecciona el ambiente destino'
    });
    if (!picked) {
        return;
    }
    await applyEnvironment(editor, picked.label);
}
async function markAs() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isJclFile(editor.document)) {
        vscode.window.showWarningMessage('JCL Switcher: el archivo activo no parece un JCL.');
        return;
    }
    if (!detector) {
        vscode.window.showErrorMessage('JCL Switcher: no hay configuración cargada.');
        return;
    }
    const environments = detector.getKnownEnvironments();
    if (environments.length === 0) {
        vscode.window.showErrorMessage('JCL Switcher: la configuración no define ambientes.');
        return;
    }
    const items = environments.map(environment => ({
        label: environment
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title: 'JCL Switcher',
        placeHolder: 'Marcar ambiente actual como...'
    });
    if (!picked) {
        return;
    }
    const documentKey = editor.document.uri.toString();
    manualOverrides.set(documentKey, picked.label);
    updateStatusBar();
    vscode.window.showInformationMessage(`JCL Switcher: ambiente actual marcado como ${picked.label}.`);
}
async function restoreOriginal() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isJclFile(editor.document)) {
        vscode.window.showWarningMessage('JCL Switcher: el archivo activo no parece un JCL.');
        return;
    }
    const document = editor.document;
    const documentKey = document.uri.toString();
    // Capa 1: intento de undo nativo si la extensión editó el documento.
    if (extensionEditedDocuments.has(documentKey)) {
        const expectedOriginal = lastOriginalTexts.get(documentKey);
        const beforeUndo = document.getText();
        await vscode.commands.executeCommand('undo');
        const currentEditor = vscode.window.activeTextEditor;
        const afterUndo = currentEditor?.document.uri.toString() === documentKey
            ? currentEditor.document.getText()
            : undefined;
        if (afterUndo !== undefined &&
            expectedOriginal !== undefined &&
            afterUndo === expectedOriginal) {
            extensionEditedDocuments.delete(documentKey);
            lastOriginalTexts.delete(documentKey);
            manualOverrides.delete(documentKey);
            await backupService.deleteBackup(document);
            vscode.window.showInformationMessage('JCL restaurado a su estado original.');
            updateStatusBar();
            return;
        }
        // If undo did not restore the expected original, continue to backup.
        if (afterUndo !== undefined && afterUndo !== beforeUndo) {
            outputChannel.appendLine('El undo nativo modificó el documento, pero no restauró el estado esperado. Se usará backup.');
        }
    }
    // Capa 2: backup temporal.
    const backupText = await backupService.readBackup(document);
    if (backupText === undefined) {
        vscode.window.showWarningMessage('JCL Switcher: no hay backup disponible para restaurar.');
        return;
    }
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    const applied = await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, backupText);
    }, {
        undoStopBefore: true,
        undoStopAfter: true
    });
    if (!applied) {
        vscode.window.showWarningMessage('JCL Switcher: no se pudo restaurar el documento.');
        return;
    }
    await backupService.deleteBackup(document);
    extensionEditedDocuments.delete(documentKey);
    lastOriginalTexts.delete(documentKey);
    manualOverrides.delete(documentKey);
    vscode.window.showInformationMessage('JCL restaurado a su estado original. Se utilizó el backup temporal.');
    updateStatusBar();
}
async function configVisual(extensionUri) {
    try {
        const currentConfig = config ?? (await (0, configLoader_1.loadJclEnvironmentsConfig)()) ?? {};
        (0, configWebView_1.openConfigWebView)(extensionUri, currentConfig, async (newConfig) => {
            const savedPath = await (0, configLoader_1.saveJclEnvironmentsConfig)(newConfig);
            await refreshConfig();
            return savedPath;
        });
    }
    catch (error) {
        const message = error instanceof Error
            ? error.message
            : String(error);
        vscode.window.showErrorMessage(`JCL Switcher: no se pudo abrir la configuración visual. ${message}`);
    }
}
async function configJson() {
    try {
        const filePath = await (0, configLoader_1.getOrCreateConfigFilePath)();
        try {
            await fs.access(filePath);
        }
        catch {
            await fs.writeFile(filePath, JSON.stringify(getDefaultConfig(), null, 2), 'utf8');
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        await vscode.window.showTextDocument(document);
    }
    catch (error) {
        const message = error instanceof Error
            ? error.message
            : String(error);
        vscode.window.showErrorMessage(`JCL Switcher: no se pudo abrir la configuración JSON. ${message}`);
    }
}
// =========================================================================
// APPLY ENVIRONMENT
// =========================================================================
async function applyEnvironment(editor, targetEnvironment) {
    if (!config) {
        vscode.window.showErrorMessage('JCL Switcher: no hay configuración cargada.');
        return;
    }
    const document = editor.document;
    const documentKey = document.uri.toString();
    const originalText = document.getText();
    const backupStatus = await backupService.ensureBackup(document);
    if (backupStatus === 'failed') {
        vscode.window.showErrorMessage('JCL Switcher: no se pudo crear el backup temporal. Por seguridad, no se aplicarán cambios.');
        return;
    }
    lastOriginalTexts.set(documentKey, originalText);
    const engine = new replacementEngine_1.ReplacementEngine(config);
    const result = engine.applyEnvironmentToText(originalText, targetEnvironment);
    logWarnings(targetEnvironment, result.warnings);
    logUnusedRules(result.unusedRules);
    if (result.replacements === 0) {
        if (result.unknownPrefixes.length > 0) {
            // Sin await: la notificación tiene botón y no se cierra sola.
            void reportUnknownPrefixes(`JCL Switcher: no se realizaron reemplazos. Prefijos desconocidos: [${result.unknownPrefixes.join(', ')}].`, result.unknownPrefixes);
        }
        else {
            vscode.window.showInformationMessage(`JCL Switcher: no se realizaron reemplazos para cambiar a ${targetEnvironment}.`);
        }
        updateStatusBar();
        return;
    }
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(originalText.length));
    const applied = await editor.edit(editBuilder => {
        editBuilder.replace(fullRange, result.text);
    }, {
        undoStopBefore: true,
        undoStopAfter: true
    });
    if (!applied) {
        vscode.window.showWarningMessage('JCL Switcher: no se pudo aplicar el cambio en el documento.');
        return;
    }
    vscode.window.showInformationMessage(`JCL actualizado a ${targetEnvironment}: ${result.replacements} reemplazos realizados.`);
    extensionEditedDocuments.add(documentKey);
    manualOverrides.set(documentKey, targetEnvironment);
    updateStatusBar();
    // Al final y sin await: la notificación tiene botón y espera al usuario.
    void reportUnknownPrefixes(`Cambio completado, pero se ignoraron los siguientes prefijos por no estar configurados: [${result.unknownPrefixes.join(', ')}].`, result.unknownPrefixes);
}
// =========================================================================
// HELPERS
// =========================================================================
function isJclFile(document) {
    const validExtensions = ['.jcl', '.jclinc', '.proc', '.prc'];
    const fileName = document.fileName.toLowerCase();
    const hasValidExtension = validExtensions.some(extension => fileName.endsWith(extension));
    return hasValidExtension || document.languageId === 'jcl';
}
function logWarnings(targetEnvironment, warnings) {
    if (warnings.length === 0) {
        return;
    }
    outputChannel.appendLine(`[${new Date().toISOString()}] Advertencias al cambiar a ${targetEnvironment}:`);
    for (const warning of warnings) {
        outputChannel.appendLine(`- ${warning}`);
    }
}
function logUnusedRules(unusedRules) {
    if (unusedRules.length === 0) {
        return;
    }
    // Al canal de salida y no como notificación: en un JCL cualquiera es normal
    // que sobren reglas, así que avisarlo con popup sería puro ruido.
    outputChannel.appendLine(`Reglas configuradas que no calzaron con nada en este JCL: ${unusedRules.join(', ')}.`);
}
/**
 * Avisa de los prefijos sin configurar y ofrece abrir el panel para agregarlos.
 */
async function reportUnknownPrefixes(message, unknownPrefixes) {
    if (unknownPrefixes.length === 0) {
        return;
    }
    const agregar = 'Agregar prefijo';
    const eleccion = await vscode.window.showWarningMessage(message, agregar);
    if (eleccion === agregar) {
        await vscode.commands.executeCommand('jclSwitcher.configVisual');
    }
}
function getDefaultConfig() {
    return {
        prefixMappings: [],
        completeDatasetRules: [],
        blockTemplates: {},
        parameterRules: []
    };
}
//# sourceMappingURL=extension.js.map