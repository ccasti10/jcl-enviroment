import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { EnvironmentDetector, DetectionResult } from './core/environmentDetector';
import { ReplacementEngine } from './core/replacementEngine';
import {
    loadJclEnvironmentsConfig,
    getOrCreateConfigFilePath,
    saveJclEnvironmentsConfig
} from './core/configLoader';
import { JclEnvironmentsConfig } from './core/config.types';
import { BackupService } from './core/backupService';
import { openConfigWebView } from './webview/configWebView';

let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let backupService: BackupService;

let config: JclEnvironmentsConfig | undefined;
let detector: EnvironmentDetector | undefined;

const manualOverrides = new Map<string, string>();
const detectionCache = new Map<string, DetectionResult>();
const lastOriginalTexts = new Map<string, string>();
const extensionEditedDocuments = new Set<string>();

let debounceTimer: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('JCL Switcher');
    backupService = new BackupService();

    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );

    statusBarItem.command = 'jclSwitcher.switchEnvironment';

    context.subscriptions.push(outputChannel);
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'jclSwitcher.switchEnvironment',
            () => switchEnvironment()
        ),
        vscode.commands.registerCommand(
            'jclSwitcher.markAs',
            () => markAs()
        ),
        vscode.commands.registerCommand(
            'jclSwitcher.restoreOriginal',
            () => restoreOriginal()
        ),
        vscode.commands.registerCommand(
            'jclSwitcher.configVisual',
            () => configVisual(context.extensionUri)
        ),
        vscode.commands.registerCommand(
            'jclSwitcher.configJson',
            () => configJson()
        )
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            updateStatusBar();
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            const key = document.uri.toString();
            manualOverrides.delete(key);
            detectionCache.delete(key);
            lastOriginalTexts.delete(key);
            extensionEditedDocuments.delete(key);
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = vscode.window.activeTextEditor;

            if (
                editor &&
                event.document === editor.document &&
                isJclFile(event.document)
            ) {
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }

                debounceTimer = setTimeout(() => {
                    updateStatusBar();
                }, 300);
            }
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('jclSwitcher.configFilePath')) {
                void refreshConfig();
            }
        })
    );

    const configWatcher = vscode.workspace.createFileSystemWatcher(
        '**/jcl-environments.json'
    );

    configWatcher.onDidCreate(() => void refreshConfig());
    configWatcher.onDidChange(() => void refreshConfig());
    configWatcher.onDidDelete(() => void refreshConfig());

    context.subscriptions.push(configWatcher);

    await refreshConfig();
    updateStatusBar();
}

export function deactivate(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
}

// =========================================================================
// CONFIG
// =========================================================================

async function refreshConfig(): Promise<void> {
    config = await loadJclEnvironmentsConfig();
    detector = config ? new EnvironmentDetector(config) : undefined;

    detectionCache.clear();

    if (!config) {
        outputChannel.appendLine(
            'No se encontró jcl-environments.json. Puedes configurarlo con "jclSwitcher.configFilePath".'
        );
    } else {
        outputChannel.appendLine('Configuración JCL cargada correctamente.');
    }

    updateStatusBar();
}

// =========================================================================
// STATUS BAR
// =========================================================================

function updateStatusBar(): void {
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

async function switchEnvironment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor || !isJclFile(editor.document)) {
        vscode.window.showWarningMessage(
            'JCL Switcher: el archivo activo no parece un JCL.'
        );
        return;
    }

    if (!config || !detector) {
        vscode.window.showErrorMessage(
            'JCL Switcher: no hay configuración cargada. Crea o edita jcl-environments.json.'
        );
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
        const action = await vscode.window.showWarningMessage(
            'JCL Switcher: el ambiente actual es ambiguo. Debes marcarlo manualmente antes de realizar cambios automáticos.',
            'Marcar ambiente actual'
        );

        if (action === 'Marcar ambiente actual') {
            await markAs();
        }

        return;
    }

    const environments = detector.getKnownEnvironments();

    if (environments.length === 0) {
        vscode.window.showErrorMessage(
            'JCL Switcher: la configuración no define ambientes.'
        );
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

async function markAs(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor || !isJclFile(editor.document)) {
        vscode.window.showWarningMessage(
            'JCL Switcher: el archivo activo no parece un JCL.'
        );
        return;
    }

    if (!detector) {
        vscode.window.showErrorMessage(
            'JCL Switcher: no hay configuración cargada.'
        );
        return;
    }

    const environments = detector.getKnownEnvironments();

    if (environments.length === 0) {
        vscode.window.showErrorMessage(
            'JCL Switcher: la configuración no define ambientes.'
        );
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

    vscode.window.showInformationMessage(
        `JCL Switcher: ambiente actual marcado como ${picked.label}.`
    );
}

async function restoreOriginal(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor || !isJclFile(editor.document)) {
        vscode.window.showWarningMessage(
            'JCL Switcher: el archivo activo no parece un JCL.'
        );
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
        const afterUndo =
            currentEditor?.document.uri.toString() === documentKey
                ? currentEditor.document.getText()
                : undefined;

        if (
            afterUndo !== undefined &&
            expectedOriginal !== undefined &&
            afterUndo === expectedOriginal
        ) {
            extensionEditedDocuments.delete(documentKey);
            lastOriginalTexts.delete(documentKey);
            manualOverrides.delete(documentKey);

            await backupService.deleteBackup(document);

            vscode.window.showInformationMessage(
                'JCL restaurado a su estado original.'
            );

            updateStatusBar();
            return;
        }

        // If undo did not restore the expected original, continue to backup.
        if (afterUndo !== undefined && afterUndo !== beforeUndo) {
            outputChannel.appendLine(
                'El undo nativo modificó el documento, pero no restauró el estado esperado. Se usará backup.'
            );
        }
    }

    // Capa 2: backup temporal.
    const backupText = await backupService.readBackup(document);

    if (backupText === undefined) {
        vscode.window.showWarningMessage(
            'JCL Switcher: no hay backup disponible para restaurar.'
        );
        return;
    }

    const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
    );

    const applied = await editor.edit(
        editBuilder => {
            editBuilder.replace(fullRange, backupText);
        },
        {
            undoStopBefore: true,
            undoStopAfter: true
        }
    );

    if (!applied) {
        vscode.window.showWarningMessage(
            'JCL Switcher: no se pudo restaurar el documento.'
        );
        return;
    }

    await backupService.deleteBackup(document);

    extensionEditedDocuments.delete(documentKey);
    lastOriginalTexts.delete(documentKey);
    manualOverrides.delete(documentKey);

    vscode.window.showInformationMessage(
        'JCL restaurado a su estado original. Se utilizó el backup temporal.'
    );

    updateStatusBar();
}

async function configVisual(extensionUri: vscode.Uri): Promise<void> {
    try {
        const currentConfig = config ?? (await loadJclEnvironmentsConfig()) ?? {};

        openConfigWebView(
            extensionUri,
            currentConfig,
            async (newConfig: JclEnvironmentsConfig) => {
                const savedPath = await saveJclEnvironmentsConfig(newConfig);
                await refreshConfig();
                return savedPath;
            }
        );
    } catch (error) {
        const message = error instanceof Error
            ? error.message
            : String(error);

        vscode.window.showErrorMessage(
            `JCL Switcher: no se pudo abrir la configuración visual. ${message}`
        );
    }
}

async function configJson(): Promise<void> {
    try {
        const filePath = await getOrCreateConfigFilePath();

        try {
            await fs.access(filePath);
        } catch {
            await fs.writeFile(
                filePath,
                JSON.stringify(getDefaultConfig(), null, 2),
                'utf8'
            );
        }

        const document = await vscode.workspace.openTextDocument(
            vscode.Uri.file(filePath)
        );

        await vscode.window.showTextDocument(document);
    } catch (error) {
        const message = error instanceof Error
            ? error.message
            : String(error);

        vscode.window.showErrorMessage(
            `JCL Switcher: no se pudo abrir la configuración JSON. ${message}`
        );
    }
}

// =========================================================================
// APPLY ENVIRONMENT
// =========================================================================

async function applyEnvironment(
    editor: vscode.TextEditor,
    targetEnvironment: string
): Promise<void> {
    if (!config) {
        vscode.window.showErrorMessage(
            'JCL Switcher: no hay configuración cargada.'
        );
        return;
    }

    const document = editor.document;
    const documentKey = document.uri.toString();
    const originalText = document.getText();

    const backupStatus = await backupService.ensureBackup(document);

    if (backupStatus === 'failed') {
        vscode.window.showErrorMessage(
            'JCL Switcher: no se pudo crear el backup temporal. Por seguridad, no se aplicarán cambios.'
        );
        return;
    }

    lastOriginalTexts.set(documentKey, originalText);

    const engine = new ReplacementEngine(config);
    const result = engine.applyEnvironmentToText(originalText, targetEnvironment);

    logWarnings(targetEnvironment, result.warnings);

    if (result.replacements === 0) {
        if (result.unknownPrefixes.length > 0) {
            vscode.window.showWarningMessage(
                `JCL Switcher: no se realizaron reemplazos. Prefijos desconocidos: [${result.unknownPrefixes.join(', ')}].`
            );
        } else {
            vscode.window.showInformationMessage(
                `JCL Switcher: no se realizaron reemplazos para cambiar a ${targetEnvironment}.`
            );
        }

        updateStatusBar();
        return;
    }

    const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(originalText.length)
    );

    const applied = await editor.edit(
        editBuilder => {
            editBuilder.replace(fullRange, result.text);
        },
        {
            undoStopBefore: true,
            undoStopAfter: true
        }
    );

    if (!applied) {
        vscode.window.showWarningMessage(
            'JCL Switcher: no se pudo aplicar el cambio en el documento.'
        );
        return;
    }

    vscode.window.showInformationMessage(
        `JCL actualizado a ${targetEnvironment}: ${result.replacements} reemplazos realizados.`
    );

    if (result.unknownPrefixes.length > 0) {
        vscode.window.showWarningMessage(
            `Cambio completado, pero se ignoraron los siguientes prefijos por no estar configurados: [${result.unknownPrefixes.join(', ')}].`
        );
    }

    extensionEditedDocuments.add(documentKey);
    manualOverrides.set(documentKey, targetEnvironment);

    updateStatusBar();
}

// =========================================================================
// HELPERS
// =========================================================================

function isJclFile(document: vscode.TextDocument): boolean {
    const validExtensions = ['.jcl', '.jclinc', '.proc', '.prc'];
    const fileName = document.fileName.toLowerCase();

    const hasValidExtension = validExtensions.some(extension =>
        fileName.endsWith(extension)
    );

    return hasValidExtension || document.languageId === 'jcl';
}

function logWarnings(targetEnvironment: string, warnings: string[]): void {
    if (warnings.length === 0) {
        return;
    }

    outputChannel.appendLine(
        `[${new Date().toISOString()}] Advertencias al cambiar a ${targetEnvironment}:`
    );

    for (const warning of warnings) {
        outputChannel.appendLine(`- ${warning}`);
    }
}

function getDefaultConfig(): JclEnvironmentsConfig {
    return {
        prefixMappings: [],
        completeDatasetRules: [],
        blockTemplates: {},
        parameterRules: []
    };
}