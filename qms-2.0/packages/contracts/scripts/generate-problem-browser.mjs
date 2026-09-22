import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const contracts = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(contracts, '../..');
const api = join(root, 'apps/api');
const expected = join(contracts, 'src/generated/testing/problem-browser.ts');
const check = process.argv.includes('--check');
const temporary = await mkdtemp(join(tmpdir(), 'qms-problem-browser-contract-'));
try {
  for (const args of [
    ['node_modules/prisma/build/index.js', 'generate'],
    ['node_modules/@nestjs/cli/bin/nest.js', 'build'],
  ]) execFileSync(process.execPath, args, { cwd: api, stdio: 'inherit' });
  const schema = join(temporary, 'openapi.json');
  execFileSync(process.execPath, ['test/problem-index/export-problem-browser-openapi.mjs', schema], {
    cwd: api,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost:1/qms_problem_browser_contract' },
  });
  const document = JSON.parse(await readFile(schema, 'utf8'));
  const generated = astToString(await openapiTS(document));
  if (check) {
    if (generated !== await readFile(expected, 'utf8')) throw new Error('Generated problem browser contract differs from the committed contract.');
    console.log('Problem browser testing contract: PASS');
  } else {
    await mkdir(dirname(expected), { recursive: true });
    await writeFile(expected, generated);
    console.log('Problem browser testing contract generated.');
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
