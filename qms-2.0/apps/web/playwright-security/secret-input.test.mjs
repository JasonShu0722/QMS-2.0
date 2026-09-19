import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const webDirectory = fileURLToPath(new URL('../', import.meta.url));

test('secret input failures and nested reporter steps never disclose the input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qms-secret-input-'));
  const canary = `non-sensitive-canary-${randomUUID()}`;
  const run = (mode) => {
    const reportPath = join(directory, `${mode}.json`);
    const result = spawnSync(process.execPath, [
      'node_modules/@playwright/test/cli.js', 'test',
      '--config=playwright-security/playwright.config.ts',
      `--output=${join(directory, mode)}`,
      ...(mode === 'baseline' ? ['--grep=disabled secret input'] : []),
    ], {
      cwd: webDirectory,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, SECRET_INPUT_MODE: mode, SECRET_INPUT_CANARY: canary, SECRET_INPUT_REPORT: reportPath },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, 'The disabled real input must fail the browser test');
    return { terminal: result.stdout + result.stderr, report: readFileSync(reportPath, 'utf8') };
  };
  try {
    const baseline = run('baseline');
    assert.equal(baseline.terminal.includes(canary), true, 'Baseline must reproduce plaintext in terminal diagnostics');
    assert.equal(baseline.report.includes(canary), true, 'Baseline must reproduce plaintext in reporter diagnostics');
    const protectedRun = run('protected');
    assert.equal(protectedRun.terminal.includes(canary), false, 'Secret input leaked into terminal diagnostics');
    assert.equal(protectedRun.report.includes(canary), false, 'Secret input leaked into reporter diagnostics or nested steps');
    const report = JSON.parse(protectedRun.report);
    assert.equal(report.stats.expected, 1, 'Enabled secret input must still succeed');
    assert.equal(report.stats.unexpected, 1, 'Disabled secret input must still fail');
    assert.equal(protectedRun.terminal.includes('Secret input failed'), true, 'Failure must retain a useful redacted diagnostic');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
