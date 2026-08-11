import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { JclEnvironmentsConfig } from './config.types';

export async function resolveConfigFilePath(): Promise<string | undefined> {
    const settings = vscode.workspace.getConfiguration('jclSwitcher');
    const configuredPath = settings.get<string>('configFilePath');

    if (configuredPath && configuredPath.trim().length > 0) {
        if (path.isAbsolute(configuredPath)) {
            return configuredPath;
        }

        const firstFolder = vscode.workspace.workspaceFolders?.[0];

        if (!firstFolder) {
            vscode.window.showWarningMessage(
                'JCL Switcher: hay una ruta relativa configurada, pero no hay un workspace abierto.'
            );
            return undefined;
        }

        return path.join(firstFolder.uri.fsPath, configuredPath);
    }

    const files = await vscode.workspace.findFiles(
        '**/jcl-environments.json',
        '**/node_modules/**',
        1
    );

    if (files.length > 0) {
        return files[0].fsPath;
    }

    return undefined;
}

export async function getOrCreateConfigFilePath(): Promise<string> {
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

export async function loadJclEnvironmentsConfig(): Promise<JclEnvironmentsConfig | undefined> {
    const configFilePath = await resolveConfigFilePath();

    if (!configFilePath) {
        return undefined;
    }

    try {
        const raw = await fs.readFile(configFilePath, 'utf8');
        const sanitized = raw.replace(/^\uFEFF/, '');
        return JSON.parse(sanitized) as JclEnvironmentsConfig;
    } catch (error) {
        const message = error instanceof Error
            ? error.message
            : String(error);

        vscode.window.showErrorMessage(
            `JCL Switcher: no se pudo leer la configuración desde "${configFilePath}". ${message}`
        );

        return undefined;
    }
}

export async function saveJclEnvironmentsConfig(
    config: JclEnvironmentsConfig
): Promise<string> {
    const filePath = await getOrCreateConfigFilePath();

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
        filePath,
        JSON.stringify(config, null, 2),
        'utf8'
    );

    return filePath;
}