import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('api-integration organization ownership (source contract, not PostgreSQL evidence)', () => {
  const moduleRoot = resolve('src/modules/api-integration');
  const files = readdirSync(moduleRoot, { recursive: true }).map(String).filter(file => file.endsWith('.ts')).sort();

  it.each(files)('%s delegates organization reads and locks to the owner read model', file => {
    const source = readFileSync(resolve(moduleRoot, file), 'utf8');
    expect(source).not.toMatch(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:(?:"public"|public)\.)?"?organizations\b/i);
    expect(source).not.toMatch(/\.organization\b|\[\s*(['"])organization\1\s*\]/);
  });
});
