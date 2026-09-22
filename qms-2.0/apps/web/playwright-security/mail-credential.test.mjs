import assert from 'node:assert/strict';
import test from 'node:test';
import { mailCredential } from './mail-credential.mjs';

test('reads all base64url initial characters from real-mail-shaped text', () => {
  for (const initial of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') {
    const token = initial + 'A'.repeat(42);
    for (const newline of ['\n', '\r\n']) {
      assert.equal(mailCredential(`请在 QMS 安全页面输入以下一次性凭证（15 分钟内有效）：${newline}${token}${newline}如非本人操作，请忽略本邮件。`), token);
    }
  }
});

test('rejects missing, shortened, oversized and embedded credentials', () => {
  for (const text of ['', 'A'.repeat(42), 'A'.repeat(44), 'A'.repeat(43) + '-', `prefix ${'A'.repeat(43)} suffix`]) {
    assert.throws(() => mailCredential(text), /Expected a real one-time mail credential/);
  }
});
