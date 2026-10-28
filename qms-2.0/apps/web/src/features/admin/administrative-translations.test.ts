import { expect, it } from 'vitest';
import { administrativeTranslations } from './administrative-translations';

it('translates representative administrative lifecycle labels from the current screens', () => {
  expect(administrativeTranslations).toMatchObject({
    '平台管理员：全部内部组织': 'Platform administrator: all internal organizations',
    '永久删除用户': 'Permanently delete user',
    '组织（含目标）': 'Organizations (including target)',
    '待配置管理': 'Pending configuration management',
    '补配后保持停用，需另行完成任职、授权与启用。': 'Remains disabled after reconfiguration. Complete appointments, authorization and activation separately.',
    '问题责任恢复': 'Problem responsibility recovery',
    '客户质量': 'Customer quality',
    '新产品质量': 'New product quality',
  });
});

it('covers responsibility field labels and their dynamically composed picker actions', () => {
  for (const label of ['专业责任任职', '负责人任职', 'SQE 任职', '内部答复人任职']) {
    for (const key of [label, `重试${label}`, `${label}上一页`, `${label}下一页`]) {
      expect(administrativeTranslations[key], key).toBeTruthy();
    }
  }
});

it('uses nonempty printable ASCII English values without adding markup', () => {
  expect(Object.keys(administrativeTranslations).length).toBeGreaterThan(0);
  for (const [key, value] of Object.entries(administrativeTranslations)) {
    expect(value.trim(), key).not.toBe('');
    expect(value, key).toMatch(/^[\x20-\x7E]+$/);
    expect(value, key).not.toMatch(/[<>]/);
    expect(value, key).not.toBe(key);
  }
});
