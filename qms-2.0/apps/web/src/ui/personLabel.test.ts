import { describe, expect, it } from 'vitest';
import { personLabel } from './personLabel';

describe('person labels', () => {
  it('shows the name, assignment department and account, preserving distinct appointments', () => {
    expect(personLabel({ fullName: '张三', departmentName: '质量保证部', username: 'D1411024' })).toBe('张三 / 质量保证部（D1411024）');
    expect(personLabel({ fullName: '张三', departmentName: '项目质量室', username: 'D1411024', positionName: '项目工程师' }, true)).toBe('张三 / 项目质量室（D1411024） · 项目工程师');
  });
  it('does not disguise a missing name as an account or leave missing identity blank', () => {
    expect(personLabel({ username: 'D1411024' })).toBe('姓名未填写 / 部门未填写（D1411024）');
    expect(personLabel({ fullName: ' ', departmentName: ' ', username: null }, false, 'en-US')).toBe('Name not provided / Department not provided (Account unavailable)');
  });
});
