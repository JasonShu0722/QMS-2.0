import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot, sourceSnapshot } from './engineering-report.mjs';
import { linkedMaintenance } from './maintenance-linkage.mjs';

const sourcePath = fileURLToPath(import.meta.url);

export function validateImpactPolicy(policy, index, manifest, root) {
  assert.equal(policy.version, 1, '影响规则版本无效');
  assert.ok(policy.commands && typeof policy.commands === 'object' && !Array.isArray(policy.commands), '缺少命令清单');
  const ids = Object.keys(policy.commands);
  assert.ok(ids.length > 0, '命令清单不能为空');
  for (const [id, entry] of Object.entries(policy.commands)) {
    assert.match(id, /^[a-z][a-z0-9-]*$/, '命令 ID 无效');
    assert.ok(typeof entry.command === 'string' && entry.command.trim(), `${id} 缺少命令`);
    if (entry.script) {
      assert.ok(!entry.workspace || ['apps/api', 'apps/web'].includes(entry.workspace), `${id} 工作区无效`);
      const packageFile = entry.workspace ? resolve(root, entry.workspace, 'package.json') : null;
      const packageManifest = packageFile ? JSON.parse(readFileSync(packageFile, 'utf8')) : manifest;
      const scripts = packageManifest.scripts;
      assert.ok(Object.hasOwn(scripts, entry.script), `${id} 引用了不存在的脚本 ${entry.script}`);
      const expected = entry.workspace ? `corepack pnpm --filter ${packageManifest.name} ${entry.script}` : `corepack pnpm ${entry.script}`;
      assert.equal(entry.command, expected, `${id} 命令与脚本不一致`);
    } else assert.equal(entry.command, 'git diff --check', `${id} 缺少可验证脚本`);
  }
  const references = (list, label) => {
    assert.ok(Array.isArray(list) && list.length > 0, `${label} 不能为空`);
    assert.equal(new Set(list).size, list.length, `${label} 重复`);
    for (const id of list) assert.ok(ids.includes(id), `${label} 引用了未知命令 ${id}`);
  };
  references(policy.baseline, '基础命令');
  references(policy.unknown, '未知路径命令');
  for (const id of ['test', 'build', 'phase-1', 'phase-2']) assert.ok(policy.unknown.includes(id), `未知路径不得省略 ${id}`);
  assert.ok(Array.isArray(policy.rules) && policy.rules.length > 0, '缺少路径规则');
  const ruleIds = new Set();
  const canonical = new Set(index.documents.filter((entry) => entry.canonical && entry.status !== 'deprecated').map((entry) => entry.path));
  for (const rule of policy.rules) {
    assert.match(rule.id, /^[a-z][a-z0-9-]*$/, '规则 ID 无效');
    assert.ok(!ruleIds.has(rule.id), `规则 ID 重复 ${rule.id}`);
    ruleIds.add(rule.id);
    assert.ok(Array.isArray(rule.prefixes) && Array.isArray(rule.files) && rule.prefixes.length + rule.files.length > 0, `${rule.id} 缺少路径`);
    for (const prefix of rule.prefixes) assert.ok(validPath(prefix) && prefix.endsWith('/'), `${rule.id} 路径前缀无效 ${prefix}`);
    for (const path of rule.files) assert.ok(validPath(path) && !path.endsWith('/'), `${rule.id} 文件路径无效 ${path}`);
    references(rule.checks, `${rule.id} 命令`);
    assert.ok(Array.isArray(rule.documents) && rule.documents.length > 0, `${rule.id} 缺少文档`);
    for (const path of rule.documents) assert.ok(canonical.has(path), `${rule.id} 引用了非权威文档 ${path}`);
  }
}

function validPath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\')
    && !path.split('/').some((part) => part === '..' || part === '.') && !/[\r\n]/.test(path);
}

export function recommendForPaths(paths, policy, index, maintenance = { items: [] }) {
  const changedPaths = [...new Set(paths)].sort();
  for (const path of changedPaths) assert.ok(validPath(path), `改动路径无效 ${path}`);
  const commandIds = new Set(policy.baseline);
  const documents = new Set();
  const ruleIds = new Set();
  const unknownPaths = [];
  for (const path of changedPaths) {
    const matching = policy.rules.filter((rule) => rule.files.includes(path) || rule.prefixes.some((prefix) => path.startsWith(prefix)));
    if (matching.length === 0) unknownPaths.push(path);
    for (const rule of matching) {
      ruleIds.add(rule.id);
      rule.checks.forEach((id) => commandIds.add(id));
      rule.documents.forEach((document) => documents.add(document));
    }
    for (const entry of index.documents) {
      if (!entry.canonical || entry.status === 'deprecated') continue;
      if (`qms-2.0/${entry.path}` === path) documents.add(entry.path);
      if (entry.review?.sources?.some((source) => source.path.startsWith('../') ? source.path.slice(3) === path : `qms-2.0/${source.path}` === path)) documents.add(entry.path);
    }
  }
  if (changedPaths.length === 0 || unknownPaths.length > 0) policy.unknown.forEach((id) => commandIds.add(id));
  return {
    changedPaths, maintenance: linkedMaintenance(changedPaths, maintenance), ruleIds: [...ruleIds], unknownPaths, needsManualReview: changedPaths.length === 0 || unknownPaths.length > 0,
    commandIds: [...commandIds], commands: [...commandIds].map((id) => ({ id, command: policy.commands[id].command })),
    documents: [...documents].sort(),
  };
}

export function branchChangedPaths(repository, base) {
  assert.ok(typeof base === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/@{}^~-]*$/.test(base), 'Git 基线无效');
  const scope = ['qms-2.0', 'docs/superpowers', 'AGENTS.md', 'README.md', '.github/workflows'];
  const output = execFileSync('git', ['diff', '--name-only', '-z', `${base}...HEAD`, '--', ...scope], { cwd: repository, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return output.split('\0').filter(Boolean).sort();
}

export async function recommendValidation(root, base) {
  const [policy, index, manifest, maintenance, source] = await Promise.all([
    readFile(resolve(root, 'governance/validation-impact.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'governance/documentation-index.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'governance/maintenance-items.json'), 'utf8').then(JSON.parse),
    sourceSnapshot(root),
  ]);
  validateImpactPolicy(policy, index, manifest, root);
  const repository = await repositoryRoot(root);
  const paths = [...source.changedFiles, ...(base ? branchChangedPaths(repository, base) : [])];
  const recommendation = recommendForPaths(paths, policy, index, maintenance);
  if (source.excludedCount) {
    recommendation.needsManualReview = true;
    for (const id of policy.unknown) if (!recommendation.commandIds.includes(id)) recommendation.commandIds.push(id);
    recommendation.commands = recommendation.commandIds.map((id) => ({ id, command: policy.commands[id].command }));
  }
  return { version: 1, base: base ?? null, source: { commit: source.commit, fingerprint: source.fingerprint, excludedCount: source.excludedCount }, ...recommendation };
}

export function renderImpactMarkdown(report) {
  const bullets = (items) => items.length ? items.map((item) => `- ${JSON.stringify(item)}`).join('\n') : '- 无';
  return `# QMS 变更验证建议\n\n- 源码提交：\`${report.source.commit}\`\n- 源码指纹：\`${report.source.fingerprint}\`\n- 比较基线：${report.base ?? 'HEAD 与当前工作区'}\n- 被安全策略排除的文件：${report.source.excludedCount}\n- 需要人工判定：${report.needsManualReview ? '是' : '否'}\n\n## 改动路径\n\n${bullets(report.changedPaths)}\n\n## 关联开放维护事项\n\n${report.maintenance.length ? report.maintenance.map((item) => `- **${item.id}**（负责人：${item.owner}，复核截止：${item.reviewDue}）：${item.nextAction}`).join("\n") : "- 无"}\n\n## 推荐命令\n\n${report.commands.map((entry) => `- \`${entry.command}\`（${entry.id}）`).join('\n')}\n\n## 复核文档\n\n${bullets(report.documents)}\n\n## 命中规则与未知路径\n\n规则：${report.ruleIds.join('、') || '无'}\n\n${bullets(report.unknownPaths)}\n\n推荐结果不执行命令，也不是 PASS。阶段整合与发布仍按根 AGENTS 和开发治理执行完整门禁。\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === sourcePath) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let position = 0; position < args.length; position += 2) {
      const name = args[position]?.replace(/^--/, '');
      assert.ok(args[position]?.startsWith('--') && ['base', 'format'].includes(name) && args[position + 1] && !Object.hasOwn(options, name), '参数无效');
      options[name] = args[position + 1];
    }
    assert.ok(!options.format || ['markdown', 'json'].includes(options.format), '格式必须为 markdown 或 json');
    const report = await recommendValidation(resolve(dirname(sourcePath), '..'), options.base);
    console.log(options.format === 'json' ? JSON.stringify(report, null, 2) : renderImpactMarkdown(report));
  } catch (error) {
    console.error(`影响推荐失败：${error.code ?? error.message}`);
    process.exitCode = 1;
  }
}
