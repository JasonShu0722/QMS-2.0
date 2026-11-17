import { describe, expect, it } from '@jest/globals';
import { normalizeAiApplication, applicationSamples } from '../../src/modules/ai-configuration/ai-application.policy.js';

const settings = () => ({ name: '制程事实整理', domain: 'PROCESS_QUALITY', scene: 'PROCESS_DEFECT_DESCRIPTION', enabled: true,
  variables: [{ variable: 'fact', label: '现象' }], connectionId: '620241ce-45aa-4c37-a2d2-997411164855', model: 'model', prompt: '整理{{fact}}',
  output: { mode: 'TEXT', field: 'description', target: 'description' }, fallback: 'DIRECT' });

describe('central AI application policy', () => {
  it('retains ordered named variables without coupling source paths to the center', () => {
    expect(normalizeAiApplication(settings())).toEqual(settings());
  });
  it('preserves legacy supported multiline names and labels when centralizing inline configurations', () => {
    const input = { ...settings(), name: '已有规则\n第二行', variables: [{ variable: 'fact', label: '现象：\n' }] };
    expect(normalizeAiApplication(input)).toEqual(input);
  });
  it('rejects unconnected scenes, duplicate variables, unknown placeholders and unsupported output targets', () => {
    for (const change of [{ scene: 'FUTURE' }, { variables: [{ variable: 'fact', label: '' }, { variable: 'fact', label: '' }] },
      { prompt: '{{missing}}' }, { output: { mode: 'JSON', field: 'x', target: 'quantity' } }, { fallback: 'IGNORE' }]) {
      expect(() => normalizeAiApplication({ ...settings(), ...change })).toThrow();
    }
  });
  it('only sends explicit samples ordered by configured variables and refuses missing or unknown samples', () => {
    const config = normalizeAiApplication(settings());
    expect(applicationSamples(config, [{ variable: 'fact', value: '现场现象' }])).toEqual([{ variable: 'fact', label: '现象', value: '现场现象' }]);
    expect(() => applicationSamples(config, [])).toThrow();
    expect(() => applicationSamples(config, [{ variable: 'fact', value: '现场' }, { variable: 'secret', value: '其他' }])).toThrow();
  });
});
