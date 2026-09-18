import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(root, 'packages/contracts');
const packageManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
const typeEntry = packageManifest.exports?.['.']?.types;

assert.equal(typeEntry, './src/index.ts', 'workspace type resolution must use the source contract entry');
await access(join(packageRoot, typeEntry));

console.log('contracts package exports: PASS');
