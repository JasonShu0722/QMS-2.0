import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('OpenAPI dependency direction', () => {
  it('keeps the API independent of the generated frontend contract package', () => {
    const manifest = JSON.parse(readFileSync(resolve(apiRoot, 'package.json'), 'utf8'));
    for (const group of ['dependencies', 'devDependencies', 'peerDependencies']) {
      expect(manifest[group] ?? {}).not.toHaveProperty('@qms/contracts');
    }
    expect(readFileSync(resolve(apiRoot, 'jest.config.cjs'), 'utf8')).not.toContain('@qms/contracts');
    const sourceRoot = resolve(apiRoot, 'src');
    for (const entry of readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      expect(readFileSync(resolve(entry.parentPath, entry.name), 'utf8'))
        .not.toMatch(/@qms\/contracts|packages\/contracts/);
    }
  });

  it('exports only types derived from generated API schemas for frontend consumers', () => {
    const contracts = readFileSync(resolve(apiRoot, '../../packages/contracts/src/index.ts'), 'utf8');
    expect(contracts).not.toMatch(/export\s+(?:const|enum|class|function)\b/);
    expect(contracts).not.toMatch(/export type \w+\s*=\s*['"]/);
  });
});
