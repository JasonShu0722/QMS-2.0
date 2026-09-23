import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import ts from '../apps/api/node_modules/typescript/lib/typescript.js';

export async function checkModuleBoundaries(root) {
  const policy = JSON.parse(await readFile(resolve(root, 'governance/module-boundaries.json'), 'utf8'));
  const allowed = new Set(policy.allowedModuleDependencies);
  const modulesRoot = resolve(root, 'apps/api/src/modules');
  const modules = new Set((await readdir(modulesRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
  const configFile = resolve(root, 'apps/api/tsconfig.json');
  const config = ts.sys.fileExists(configFile) ? ts.readConfigFile(configFile, ts.sys.readFile) : { config: {} };
  assert.ok(!config.error, 'API tsconfig 读取失败');
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configFile)).options;
  const violations = [];
  const pairs = new Set();

  async function visitDirectory(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      assert.ok(!entry.isSymbolicLink(), `模块目录不允许符号链接：${relative(root, file)}`);
      if (entry.isDirectory()) { await visitDirectory(file); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const sourceModule = relative(modulesRoot, file).split(sep)[0];
      const tree = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function inspect(node) {
        let specifier;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) specifier = node.moduleReference.expression;
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
          specifier = node.arguments[0];
          if (!specifier || !ts.isStringLiteralLike(specifier)) violations.push(`${relative(root, file)}：无法静态检查的动态导入`);
        }
        if (specifier && ts.isStringLiteralLike(specifier)) {
          const importPath = specifier.text;
          const resolved = ts.resolveModuleName(importPath, file, options, ts.sys).resolvedModule?.resolvedFileName
            ?? (importPath.startsWith('.') ? resolve(dirname(file), importPath) : undefined);
          if (resolved) {
            const targetModule = relative(modulesRoot, resolved).split(sep)[0];
            if (modules.has(targetModule) && targetModule !== sourceModule) {
              const pair = `${sourceModule} -> ${targetModule}`;
              pairs.add(pair);
              if (!allowed.has(pair)) violations.push(`${relative(root, file)}：未批准依赖 ${pair}`);
              const withoutExtension = resolved.replace(/\.(?:[cm]?[jt]sx?)$/, '');
              if (policy.forbiddenImportFileSuffixes.some((suffix) => withoutExtension.endsWith(suffix.replace(/\.(?:[cm]?[jt]sx?)$/, '')))) {
                violations.push(`${relative(root, file)}：禁止跨模块 Controller 导入 ${importPath}`);
              }
            }
          }
        }
        ts.forEachChild(node, inspect);
      }
      inspect(tree);
    }
  }
  await visitDirectory(modulesRoot);
  assert.deepEqual(violations, [], violations.join('\n'));
  return { pairs: pairs.size };
}
