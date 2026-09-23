import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { checkModuleBoundaries } from '../scripts/check-module-boundaries.mjs';

async function fixture(context, source) {
  const root = await mkdtemp(join(tmpdir(), 'qms-boundaries-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['governance', 'apps/api/src/modules/alpha', 'apps/api/src/modules/beta']) await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, 'governance/module-boundaries.json'), JSON.stringify({ allowedModuleDependencies: ['alpha -> beta'], forbiddenImportFileSuffixes: ['.controller.ts', '.controller.js'] }));
  await writeFile(join(root, 'apps/api/src/modules/alpha/source.ts'), source);
  await writeFile(join(root, 'apps/api/src/modules/beta/service.ts'), 'export const value = 1;');
  await writeFile(join(root, 'apps/api/src/modules/beta/admin.controller.ts'), 'export const value = 1;');
  return root;
}

test('公开依赖通过，注释与代码字符串不作为导入', async (context) => {
  const root = await fixture(context, `import { value } from '../beta/service.js';
    // import bad from '../beta/admin.controller';
    const example = "import bad from '../beta/admin.controller'";`);
  assert.equal((await checkModuleBoundaries(root)).pairs, 1);
});

for (const source of [
  "import { value } from '../beta/admin.controller';",
  "export { value } from '../beta/admin.controller.js';",
  "import '../beta/admin.controller';",
  "const module = import('../beta/admin.controller');",
  "const module = require('../beta/admin.controller');",
]) {
  test(`禁止跨模块 Controller：${source}`, async (context) => {
    await assert.rejects(checkModuleBoundaries(await fixture(context, source)), /Controller|禁止/);
  });
}

test('动态字面量导入不能绕过依赖白名单', async (context) => {
  const root = await fixture(context, "const module = import('../beta/service.js');");
  await writeFile(join(root, 'governance/module-boundaries.json'), JSON.stringify({ allowedModuleDependencies: [], forbiddenImportFileSuffixes: [] }));
  await assert.rejects(checkModuleBoundaries(root), /alpha -> beta/);
});

test('模块内无法静态分析的导入必须显式失败', async (context) => {
  await assert.rejects(checkModuleBoundaries(await fixture(context, 'const module = import(target);')), /无法静态/);
});

test('tsconfig 路径别名不能绕过 Controller 边界', async (context) => {
  const root = await fixture(context, "import { value } from '@modules/beta/admin.controller';");
  await writeFile(join(root, 'apps/api/tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: './src', paths: { '@modules/*': ['modules/*'] } } }));
  await assert.rejects(checkModuleBoundaries(root), /Controller|禁止/);
});
