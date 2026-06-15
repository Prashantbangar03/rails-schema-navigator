import * as vscode from 'vscode';
import { workspaceRelativePath } from './schemaSerializer';

export interface StaleSchemaInfo {
  stale: boolean;
  message?: string;
  dumpCommand?: string;
  schemaPath?: string;
}

export async function getStaleSchemaInfo(
  schemaUri: vscode.Uri
): Promise<StaleSchemaInfo> {
  try {
    const schemaStat = await vscode.workspace.fs.stat(schemaUri);
    const dbDir = vscode.Uri.file(schemaUri.fsPath.replace(/[/\\][^/\\]+$/, ''));
    const migrations = await vscode.workspace.findFiles(
      new vscode.RelativePattern(dbDir, 'migrate/**/*.rb'),
      '**/node_modules/**',
      500
    );

    if (migrations.length === 0) {
      return { stale: false };
    }

    let latestMigration = 0;
    for (const migration of migrations) {
      const stat = await vscode.workspace.fs.stat(migration);
      if (stat.mtime > latestMigration) {
        latestMigration = stat.mtime;
      }
    }

    if (latestMigration > schemaStat.mtime) {
      const rel = workspaceRelativePath(schemaUri);
      const dumpCommand = schemaUri.fsPath.endsWith('structure.sql')
        ? 'rails db:structure:dump'
        : 'rails db:schema:dump';
      return {
        stale: true,
        message: `${rel} is older than the latest migration · run ${dumpCommand}`,
        dumpCommand,
        schemaPath: schemaUri.fsPath,
      };
    }
  } catch {
    return { stale: false };
  }

  return { stale: false };
}
