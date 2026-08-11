import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export type BackupStatus = 'created' | 'existing' | 'memory' | 'failed';

export class BackupService {
    private memoryBackups = new Map<string, string>();

    public getBackupPath(document: vscode.TextDocument): string | undefined {
        if (document.isUntitled || !document.uri.fsPath) {
            return undefined;
        }

        return `${document.uri.fsPath}.bak`;
    }

    /**
     * Creates a backup only if one does not already exist.
     * This preserves the original JCL before the first extension-driven change.
     */
    public async ensureBackup(document: vscode.TextDocument): Promise<BackupStatus> {
        const key = document.uri.toString();

        if (document.isUntitled || !document.uri.fsPath) {
            if (!this.memoryBackups.has(key)) {
                this.memoryBackups.set(key, document.getText());
            }

            return 'memory';
        }

        const backupPath = this.getBackupPath(document);

        if (!backupPath) {
            return 'failed';
        }

        try {
            await fs.access(backupPath);
            return 'existing';
        } catch {
            // Backup does not exist; create it.
        }

        try {
            await fs.mkdir(path.dirname(backupPath), { recursive: true });
            await fs.writeFile(backupPath, document.getText(), 'utf8');
            return 'created';
        } catch {
            return 'failed';
        }
    }

    public async readBackup(document: vscode.TextDocument): Promise<string | undefined> {
        const key = document.uri.toString();

        if (document.isUntitled || !document.uri.fsPath) {
            return this.memoryBackups.get(key);
        }

        const backupPath = this.getBackupPath(document);

        if (!backupPath) {
            return undefined;
        }

        try {
            return await fs.readFile(backupPath, 'utf8');
        } catch {
            return undefined;
        }
    }

    public async deleteBackup(document: vscode.TextDocument): Promise<void> {
        const key = document.uri.toString();
        this.memoryBackups.delete(key);

        if (document.isUntitled || !document.uri.fsPath) {
            return;
        }

        const backupPath = this.getBackupPath(document);

        if (!backupPath) {
            return;
        }

        try {
            await fs.unlink(backupPath);
        } catch {
            // Ignore if backup does not exist.
        }
    }
}