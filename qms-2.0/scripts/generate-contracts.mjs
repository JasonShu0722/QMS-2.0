import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'apps/api');
const output = resolve(process.argv[2] ?? join(root, 'packages/contracts/src/generated/api.ts'));
const temporary = await mkdtemp(join(tmpdir(), 'qms-openapi-'));
try {
  for (const args of [
    ['node_modules/prisma/build/index.js', 'generate'],
    ['node_modules/@nestjs/cli/bin/nest.js', 'build'],
  ]) {
    execFileSync(process.execPath, args, { cwd: api, stdio: 'inherit' });
  }
  const schema = join(temporary, 'openapi.json');
  execFileSync(process.execPath, ['scripts/export-openapi.mjs', schema], {
    cwd: api,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost:1/qms_contract_export' },
  });
  const document = JSON.parse(await readFile(schema, 'utf8'));
  const types = astToString(await openapiTS(document));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, types);
  console.log('OpenAPI types generated.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
