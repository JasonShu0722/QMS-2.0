import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOutputDirectory, parseOptions, sourceSnapshot, saveReport, sourceSummary, within, repositoryRoot } from './engineering-report.mjs';
import { linkedMaintenance } from './maintenance-linkage.mjs';

export async function createHandoff(root, options) {
  const source = await sourceSnapshot(root);
  const index = JSON.parse(await readFile(resolve(root, 'governance/documentation-index.json'), 'utf8'));
  const maintenance = JSON.parse(await readFile(resolve(root, 'governance/maintenance-items.json'), 'utf8'));
  const repository = await repositoryRoot(root);
  const rules = ['../AGENTS.md', ...index.agents.map((entry) => entry.path)];
  const pending = [];
  let plan = null;
  if (options.plan) {
    const file = await realpath(resolve(root, options.plan));
    assert.ok(within(resolve(repository, 'docs/superpowers/plans'), file) && file.endsWith('.md'), '计划必须是根 docs/superpowers/plans 中的 Markdown');
    plan = relative(root, file).split(sep).join('/');
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
    lines.forEach((text, position) => { if (/^\s*- \[ \]/.test(text)) pending.push({ line: position + 1, text }); });
  }
  const applicableRules = rules.filter((rule) => rule === '../AGENTS.md' || rule === 'AGENTS.md' || source.changedFiles.some((file) => {
    const scope = dirname(`qms-2.0/${rule}`).replaceAll('\\', '/');
    return file.startsWith(`${scope}/`);
  }));
  const report = {
    version: 1, generatedAt: new Date().toISOString(), kind: 'handoff', source,
    rules, applicableRules, plan, pending,
    maintenance: linkedMaintenance(source.changedFiles, maintenance),
    documents: index.documents.filter((entry) => entry.canonical && entry.status !== 'deprecated').map((entry) => entry.path),
    limitations: ['这是接续资料，不是验收结果或操作授权。', '未完成项仅来自显式选择计划的未勾选行；未选择计划不能解释为任务全部完成。', '仅输出文件路径和摘要，不输出差异正文、环境变量、秘密或原始日志。', '源码快照覆盖范围以 JSON scope 为准；不包含数据库、外部配置或归档。'],
  };
  const output = await createOutputDirectory(root, options.output);
  const markdown = `# QMS 任务交接\n\n${sourceSummary(source)}\n## 当前计划\n\n${plan ?? '未选择计划，请结合任务说明确认剩余范围。'}\n\n${pending.map((entry) => `- 第 ${entry.line} 行：${entry.text.replace(/^\s*- \[ \]\s*/, '')}`).join('\n') || '未提取到未勾选行，不代表业务验收完成。'}\n\n## 适用规则\n\n${applicableRules.map((rule) => `- \`${rule}\``).join('\n')}\n\n## 关联开放维护事项\n\n${report.maintenance.length ? report.maintenance.map((item) => `- **${item.id}**（复核截止：${item.reviewDue}）：${item.nextAction}`).join("\n") : "- 无"}\n\n## 改动路径\n\n${source.changedFiles.map((path) => `- \`${path}\``).join('\n') || '覆盖范围内无改动。'}\n\n## 知识入口\n\n${report.documents.map((path) => `- \`${path}\``).join('\n')}\n\n## 限制\n\n${report.limitations.map((item) => `- ${item}`).join('\n')}\n`;
  await saveReport(output, 'handoff', report, markdown);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2), ['output', 'plan']);
    await createHandoff(resolve(dirname(fileURLToPath(import.meta.url)), '..'), options);
    console.log('交接包已生成：handoff.md、handoff.json');
  } catch (error) {
    console.error(`交接失败：${error.code ?? error.message}`);
    process.exitCode = 1;
  }
}
