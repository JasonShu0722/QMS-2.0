import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkDocumentation, sourceDigest } from '../scripts/check-documentation.mjs';

async function fixture(context) {
  const repository = await mkdtemp(join(tmpdir(), 'qms-docs-'));
  context.after(() => rm(repository, { recursive: true, force: true }));
  const root = join(repository, 'qms-2.0');
  await mkdir(join(root, 'docs'), { recursive: true });
  await mkdir(join(root, 'governance'));
  await writeFile(join(root, 'source.md'), '# 来源\n');
  await writeFile(join(root, 'docs/guide.md'), '# 指南\n[来源](../source.md)\n');
  await writeFile(join(root, 'docs/README.md'), '[指南](guide.md)\n');
  const index = {
    reviewPolicy: { freshnessTopics: ['guide'] },
    agents: [],
    documents: [
      { path: 'docs/README.md', topic: 'index', canonical: true, status: 'active' },
      { path: 'docs/guide.md', topic: 'guide', canonical: true, status: 'active', review: {
        owner: 'QMS 维护者', reviewedOn: '2026-09-22', maxAgeDays: 30,
        reason: '核对来源与指南', sources: [{ path: 'source.md', sha256: sourceDigest('# 来源\n') }],
      } },
    ],
  };
  return {
    root, index,
    write: (file, text) => writeFile(join(root, file), text),
    check: async (now = new Date('2026-09-23T00:00:00Z')) => {
      await writeFile(join(root, 'governance/documentation-index.json'), JSON.stringify(index));
      return checkDocumentation(root, now);
    },
  };
}

test('有效文档通过，摘要不受 CRLF 影响', async (context) => {
  const current = await fixture(context);
  await current.write('source.md', '# 来源\r\n');
  assert.equal((await current.check()).documents, 2);
});

test('缺失文档、未索引的新文档均失败', async (context) => {
  const current = await fixture(context);
  current.index.documents[1].path = 'docs/missing.md';
  await assert.rejects(current.check(), /missing.md/);
  current.index.documents[1].path = 'docs/guide.md';
  await current.write('docs/extra.md', '# 新文档');
  await assert.rejects(current.check(), /extra.md/);
});

test('每个主题必须恰好有一个有效权威来源', async (context) => {
  const current = await fixture(context);
  current.index.documents[1].canonical = false;
  await assert.rejects(current.check(), /guide.*权威/);
  current.index.documents[1].canonical = true;
  current.index.documents[0].topic = 'guide';
  await assert.rejects(current.check(), /guide.*权威/);
});

test('导航中的纯文本提及不能替代链接', async (context) => {
  const current = await fixture(context);
  await current.write('docs/README.md', 'guide.md');
  await assert.rejects(current.check(), /导航.*guide.md/);
});

test('链接检查支持引用式、空格路径，忽略代码示例与外链', async (context) => {
  const current = await fixture(context);
  await current.write('space name.md', '# 空格');
  await current.write('docs/guide.md', '[来源][source]\n[source]: ../source.md\n[空格](<../space name.md>)\n[远程](https://example.invalid)\n```md\n[示例](missing.md)\n```\n`[示例](missing.md)`');
  await current.check();
  await current.write('docs/guide.md', '[来源][source]\n[source]: ../missing.md');
  await assert.rejects(current.check(), /guide.md.*missing.md/);
});

test('来源变更必须重新复核，不能沿用旧摘要', async (context) => {
  const current = await fixture(context);
  await current.write('source.md', '# 来源已变化\n');
  await assert.rejects(current.check(), /guide.md.*来源已变化.*source.md/);
});

test('复核到期边界、未来日期和非法日期失败', async (context) => {
  const current = await fixture(context);
  await current.check(new Date('2026-10-21T23:59:59Z'));
  await assert.rejects(current.check(new Date('2026-10-22T00:00:00Z')), /到期/);
  current.index.documents[1].review.reviewedOn = '2026-09-24';
  await assert.rejects(current.check(), /未来/);
  current.index.documents[1].review.reviewedOn = '2026-02-30';
  await assert.rejects(current.check(), /日期/);
});

test('受保护主题不允许移除复核信息或来源', async (context) => {
  const current = await fixture(context);
  const review = current.index.documents[1].review;
  delete current.index.documents[1].review;
  await assert.rejects(current.check(), /复核信息/);
  current.index.documents[1].review = review;
  review.sources = [];
  await assert.rejects(current.check(), /来源/);
});

test('索引路径、来源路径不能逃出允许目录', async (context) => {
  const current = await fixture(context);
  current.index.documents[1].review.sources[0].path = '../../secret.md';
  await assert.rejects(current.check(), /路径/);
  current.index.documents[1].path = '../outside.md';
  await assert.rejects(current.check(), /路径/);
});

test('废弃文档必须指向存在的有效替代文档', async (context) => {
  const current = await fixture(context);
  current.index.documents[0].status = 'deprecated';
  current.index.documents[0].canonical = false;
  await assert.rejects(current.check(), /替代/);
});

test('新增 AGENTS 未登记会失败，依赖目录中的 AGENTS 不纳入', async (context) => {
  const current = await fixture(context);
  await mkdir(join(current.root, 'feature'));
  await current.write('feature/AGENTS.md', '# 专属规则');
  await assert.rejects(current.check(), /AGENTS/);
  current.index.agents.push({ path: 'feature/AGENTS.md', scope: 'feature/' });
  await current.check();
  await mkdir(join(current.root, 'node_modules/example'), { recursive: true });
  await current.write('node_modules/example/AGENTS.md', '# 第三方');
  await current.check();
});

test('新增工程 Skill 必须登记到同一文档索引', async (context) => {
  const current = await fixture(context);
  await mkdir(join(current.root, '.agents/skills/example'), { recursive: true });
  await current.write('.agents/skills/example/SKILL.md', '# 示例');
  await assert.rejects(current.check(), /Skill/);
  current.index.documents.push({ path: '.agents/skills/example/SKILL.md', topic: 'example-skill', canonical: true, status: 'active' });
  await current.check();
});
