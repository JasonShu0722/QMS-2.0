import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOutputDirectory, parseOptions, sourceSnapshot, saveReport, sourceSummary } from './engineering-report.mjs';

const profiles = {
  governance: ['check:governance', 'test:governance', 'check:archive-isolation'],
  unit: ['check:governance', 'test'],
  'phase-1': ['acceptance:phase-1'],
  'phase-2': ['acceptance:phase-2'],
};

export async function runEvidence(root, options) {
  assert.ok(options.steps.length > 0, '至少需要一个验证步骤');
  const output = await createOutputDirectory(root, options.output);
  const report = {
    version: 1, profile: options.profile, startedAt: new Date().toISOString(), status: 'RUNNING',
    runtime: options.runtime, sourceBefore: null, sourceAfter: null, sourceUnchanged: false, reasons: [],
    steps: options.steps.map((step) => ({ name: step.name, command: step.display, status: 'NOT_RUN', exitCode: null, seconds: null })),
    limitations: ['结果只覆盖所选组合，不代表未选择的门禁通过。', '子进程原始输出留在终端，本报告不采集环境值或原始日志。', 'RUNNING 或 NOT_RUN 不得当作 PASS；中断后保留最近落盘状态。', '临时服务由既有阶段验收流程准备和清理，本工具不创建或销毁数据库。'],
  };
  async function persist() {
    const markdown = `# QMS 验收证据\n\n- 组合：${report.profile}\n- 总体结果：${report.status}\n- Node：${report.runtime?.node ?? '未取得'}；pnpm：${report.runtime?.pnpm ?? '未取得'}\n- 源码保持一致：${report.sourceUnchanged}\n- 原因代码：${report.reasons.join('、') || '无'}\n\n${sourceSummary(report.sourceBefore)}\n## 执行结果\n\n| 步骤 | 命令 | 状态 | 退出码 | 秒 |\n| --- | --- | --- | --- | --- |\n${report.steps.map((step) => `| ${step.name} | ${step.command} | ${step.status} | ${step.exitCode ?? '无'} | ${step.seconds ?? '未计时'} |`).join('\n')}\n\n## 限制\n\n${report.limitations.map((item) => `- ${item}`).join('\n')}\n`;
    await saveReport(output, 'evidence', report, markdown);
  }
  await persist();
  try {
    report.sourceBefore = await sourceSnapshot(root);
    if (!options.runtime) report.reasons.push('RUNTIME_UNAVAILABLE_OR_MISMATCH');
    if (report.sourceBefore.excludedCount) report.reasons.push('SOURCE_EXCLUSIONS');
    await persist();
    if (report.reasons.length === 0) {
      for (const [position, step] of options.steps.entries()) {
        const result = report.steps[position];
        result.status = 'RUNNING';
        result.startedAt = new Date().toISOString();
        await persist();
        const started = Date.now();
        const execution = spawnSync(step.command, step.args, { cwd: root, env: process.env, stdio: options.quiet ? 'ignore' : 'inherit', shell: false });
        result.seconds = Math.round((Date.now() - started) / 10) / 100;
        result.exitCode = execution.status;
        result.status = !execution.error && execution.status === 0 ? 'PASS' : 'FAIL';
        if (execution.error) result.failure = 'PROCESS_START_FAILED';
        else if (execution.signal) result.failure = 'PROCESS_SIGNAL';
        await persist();
        if (result.status === 'FAIL') { report.reasons.push('STEP_FAILED'); break; }
      }
    }
    report.sourceAfter = await sourceSnapshot(root);
    report.sourceUnchanged = report.sourceBefore.fingerprint === report.sourceAfter.fingerprint && report.sourceAfter.excludedCount === 0;
    if (!report.sourceUnchanged) report.reasons.push('SOURCE_CHANGED_OR_EXCLUDED');
  } catch {
    report.reasons.push('REPORT_OR_SOURCE_FAILURE');
  }
  report.status = report.reasons.length === 0 && report.steps.every((step) => step.status === 'PASS') ? 'PASS' : 'FAIL';
  report.finishedAt = new Date().toISOString();
  await persist();
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const options = parseOptions(process.argv.slice(2), ['output', 'profile']);
    assert.ok(Object.hasOwn(profiles, options.profile), '必须选择 --profile governance、unit、phase-1 或 phase-2');
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    const pnpm = process.env.npm_execpath;
    let runtime = null;
    try {
      const pnpmVersion = execFileSync(process.execPath, [pnpm, '--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const minimum = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(manifest.engines.node);
      const [major, minor, patch] = process.versions.node.split('.').map(Number);
      assert.ok(minimum && major === Number(minimum[1]) && major < Number(minimum[4]) && (minor > Number(minimum[2]) || minor === Number(minimum[2]) && patch >= Number(minimum[3])));
      assert.equal(`pnpm@${pnpmVersion}`, manifest.packageManager);
      runtime = { node: process.version, pnpm: pnpmVersion, platform: process.platform, architecture: process.arch };
    } catch { runtime = null; }
    const steps = profiles[options.profile].map((name) => ({ name, display: `corepack pnpm ${name}`, command: process.execPath, args: [pnpm ?? '', name] }));
    const report = await runEvidence(root, { ...options, runtime, steps });
    console.log(`验收证据 ${report.status}：evidence.md、evidence.json`);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
  } catch (error) {
    console.error(`证据汇总失败：${error.code ?? error.message}`);
    process.exitCode = 1;
  }
}
