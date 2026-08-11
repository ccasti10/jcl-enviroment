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
exports.BackupService = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
class BackupService {
    memoryBackups = new Map();
    getBackupPath(document) {
        if (document.isUntitled || !document.uri.fsPath) {
            return undefined;
        }
        return `${document.uri.fsPath}.bak`;
    }
    /**
     * Creates a backup only if one does not already exist.
     * This preserves the original JCL before the first extension-driven change.
     */
    async ensureBackup(document) {
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
        }
        catch {
            // Backup does not exist; create it.
        }
        try {
            await fs.mkdir(path.dirname(backupPath), { recursive: true });
            await fs.writeFile(backupPath, document.getText(), 'utf8');
            return 'created';
        }
        catch {
            return 'failed';
        }
    }
    async readBackup(document) {
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
        }
        catch {
            return undefined;
        }
    }
    async deleteBackup(document) {
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
        }
        catch {
            // Ignore if backup does not exist.
        }
    }
}
exports.BackupService = BackupService;
//# sourceMappingURL=backupService.js.map