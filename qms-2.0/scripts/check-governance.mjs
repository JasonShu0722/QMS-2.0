import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDocumentation } from './check-documentation.mjs';
import { checkModuleBoundaries } from './check-module-boundaries.mjs';
import { validateImpactPolicy } from './recommend-validation.mjs';
import { checkMaintenance } from './check-maintenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'docs/DEVELOPMENT-GOVERNANCE.md',
  'docs/CAPABILITY-STATUS.md',
  'docs/README.md',
  'governance/module-boundaries.json',
  'governance/documentation-index.json',
];

for (const file of requiredFiles) await stat(join(root, file));

const governance = await readFile(join(root, 'docs/DEVELOPMENT-GOVERNANCE.md'), 'utf8');
for (const heading of ['## 1. 任务模板', '## 2. 功能交付证据矩阵', '## 3. 分层质量门禁', '## 4. 独立审查规则', '## 5. 模块边界', '## 7. 完成判定']) {
  assert.ok(governance.includes(heading), `governance document is missing ${heading}`);
}

const documentationIndex = JSON.parse(await readFile(join(root, 'governance/documentation-index.json'), 'utf8'));
assert.equal(documentationIndex.canonicalLanguage, 'zh-CN', 'documentation canonical language must be zh-CN');
assert.equal(documentationIndex.technicalIdentifiersLanguage, 'en', 'technical identifiers language must be en');
assert.equal(documentationIndex.reviewPolicy.newDocumentMustBeIndexed, true, 'new documents must be indexed');
assert.equal(documentationIndex.reviewPolicy.oneCanonicalSourcePerTopic, true, 'topics must have one canonical source');

const indexedAgentPaths = documentationIndex.agents.map((entry) => entry.path);
assert.equal(new Set(indexedAgentPaths).size, indexedAgentPaths.length, 'AGENTS paths must be unique');
for (const entry of documentationIndex.agents) {
  await stat(join(root, entry.path));
  const agentText = await readFile(join(root, entry.path), 'utf8');
  for (const heading of ['## 作用范围', '## 权威入口', '## 验证命令']) {
    assert.ok(agentText.includes(heading), `${entry.path} is missing ${heading}`);
  }
}

const documentationResult = await checkDocumentation(root);
console.log(`文档检查 PASS：${documentationResult.documents} 份文档，${documentationResult.links} 个本地链接，${documentationResult.reviews} 份来源复核`);
const impactPolicy = JSON.parse(await readFile(join(root, 'governance/validation-impact.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
validateImpactPolicy(impactPolicy, documentationIndex, manifest, root);
const maintenance = await checkMaintenance(root);
console.log(`维护台账 PASS：开放 ${maintenance.open}；关闭 ${maintenance.closed}`);
const boundaries = await checkModuleBoundaries(root);
console.log(`Governance checks: PASS (${boundaries.pairs} approved module dependency pairs)`);
