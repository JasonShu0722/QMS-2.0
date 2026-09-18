import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'qms-contracts-check-'));
try {
  const generated = join(temporary, 'api.ts');
  execFileSync(process.execPath, [join(root, 'scripts/generate-contracts.mjs'), generated], {
    cwd: root,
    stdio: 'inherit',
  });
  const expected = await readFile(join(root, 'packages/contracts/src/generated/api.ts'));
  const actual = await readFile(generated);
  if (!actual.equals(expected)) throw new Error('Generated OpenAPI types differ from the committed contract.');
  console.log('OpenAPI contracts: PASS');
} catch (error) {
  console.error(error.message);
  console.error('OpenAPI contracts: FAIL; run contracts:generate and commit the generated types.');
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
