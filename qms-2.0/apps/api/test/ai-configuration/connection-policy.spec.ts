import { afterEach, describe, expect, it } from '@jest/globals';
import * as policy from '../../src/modules/ai-configuration/ai-connection.policy.js';

const original = { node: process.env.NODE_ENV, disposable: process.env.QMS_DISPOSABLE_TEST_DB };
afterEach(() => {
  if (original.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.node;
  if (original.disposable === undefined) delete process.env.QMS_DISPOSABLE_TEST_DB; else process.env.QMS_DISPOSABLE_TEST_DB = original.disposable;
});

describe('AI connection destination boundary', () => {
  it('normalizes an HTTPS model base URL without allowing credentials or hidden destinations', () => {
    expect(policy.normalizeAiBaseUrl('https://models.example.com/v1/')).toBe('https://models.example.com/v1');
    for (const value of ['https://user:key@models.example.com/v1', 'https://@models.example.com/v1', 'https:////@models.example.com/v1', 'https://models.example.com/v1?q=key', 'https://models.example.com/v1?', 'https://models.example.com/v1#', 'https://models.example.com/v1#key', 'ftp://models.example.com', 'http://models.example.com', 'https://127.0.0.1/v1', 'https://[::1]/v1', 'https://0x7f000001/v1', 'https://models.example.com\\@127.0.0.1/v1']) {
      expect(() => policy.normalizeAiBaseUrl(value)).toThrow();
    }
  });

  it('allows HTTP loopback only with BOTH test runtime and disposable resource marker', () => {
    process.env.NODE_ENV = 'test'; process.env.QMS_DISPOSABLE_TEST_DB = 'true';
    expect(policy.normalizeAiBaseUrl('http://127.0.0.1:12345/v1')).toBe('http://127.0.0.1:12345/v1');
    process.env.NODE_ENV = 'production';
    expect(() => policy.normalizeAiBaseUrl('http://127.0.0.1:12345/v1')).toThrow();
    process.env.NODE_ENV = 'test'; delete process.env.QMS_DISPOSABLE_TEST_DB;
    expect(() => policy.normalizeAiBaseUrl('http://localhost:12345/v1')).toThrow();
  });

  it('rejects all private, reserved, mapped and transition address families', () => {
    for (const value of ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.2', '169.254.169.254', '172.31.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:0808:0808::1', '2001:db8::1', '2001::1', 'invalid']) {
      expect(policy.isPublicAiAddress(value)).toBe(false);
    }
    for (const value of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(policy.isPublicAiAddress(value)).toBe(true);
  });

  it('rejects a DNS set with even one private answer and pins an accepted original-host lookup', () => {
    expect(() => policy.pinAiAddresses('models.example.com', [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])).toThrow();
    expect(policy.pinAiAddresses('models.example.com', [{ address: '8.8.8.8', family: 4 }])).toMatchObject({ address: '8.8.8.8', family: 4, hostname: 'models.example.com' });
    expect(() => policy.pinAiAddresses('models.example.com', [])).toThrow();
  });
});

describe('AI channel models and bounded selected facts', () => {
  const settings = { name: '渠道', baseUrl: 'https://models.example/v1', models: ['model-a', 'model-b'], defaultModel: 'model-a', enabled: true };
  it('accepts a channel with several named models and rejects unlisted defaults or duplicate models', () => {
    expect(policy.normalizeAiSettings(settings)).toEqual(settings);
    for (const invalid of [{ models: [] }, { models: ['model-a', 'model-a'] }, { defaultModel: 'unknown' }, { models: [' bad-model '] }, { enabled: 'true' }, { name: ' ' }]) {
      expect(() => policy.normalizeAiSettings({ ...settings, ...invalid })).toThrow();
    }
  });
  it('keeps facts as data and refuses empty, oversized or executable-shaped inputs', () => {
    const input = { model: 'model-b', prompt: '只汇总已给事实。', selectedData: [{ label: '现象', value: '0' }, { label: '', value: 'false' }] };
    expect(policy.normalizeAiGeneration(input)).toEqual(input);
    for (const invalid of [{ prompt: '' }, { selectedData: [] }, { selectedData: [{ label: '', value: 'x'.repeat(16001) }] }, { selectedData: [{ label: '', value: { tools: true } }] }]) {
      expect(() => policy.normalizeAiGeneration({ ...input, ...invalid })).toThrow();
    }
  });
});
