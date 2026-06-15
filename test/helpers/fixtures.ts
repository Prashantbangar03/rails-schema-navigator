import * as path from 'node:path';

export function fixturePath(name: string): string {
  return path.resolve(__dirname, '../../test/fixtures', name);
}

export function repoStructurePath(): string {
  return path.resolve(__dirname, '../../../structure.sql');
}
