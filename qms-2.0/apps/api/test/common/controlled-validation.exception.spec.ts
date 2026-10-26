import { ControlledValidationException } from '../../src/common/contracts/controlled-validation.exception.js';
import { PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from '../../src/common/contracts/platform-error.js';

const code = 'PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE';
const message = '必须人工明确确认措施验证有效';

describe('controlled validation field safety', () => {
  it('copies only bounded field instructions and collapses duplicate instructions', () => {
    const issues = [{ path: 'correctiveActions[0].effective', message }];
    const exception = new ControlledValidationException(code, [...issues, ...issues]);
    issues[0]!.message = 'secret';
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toEqual({ code });
    expect(exception.fields).toEqual({ 'correctiveActions[0].effective': [message] });
  });

  it.each([
    '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf',
    'document.__proto__.polluted', 'document.constructor.name', 'document.prototype.name',
    'token', 'sessionId', 'password', 'secret', 'credentials', 'private_key', 'access_key', 'object_key',
    'authorization', 'cookie', 'databaseUrl', 'connectionString', 'apiKey', 'document.access_token',
    'correctiveActions[-1].firstBatch', 'correctiveActions[01].effective', 'correctiveActions[10000].effective',
    'correctiveActions[0][secret]', 'document/secret', 'document\\secret', '', 'x'.repeat(161),
    'a.b.c.d.e.f.g.h.i',
  ])('drops unsafe field path %s rather than reflecting it', path => {
    expect(new ControlledValidationException(code, [{ path, message }]).fields).toEqual({});
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each(['token=secret', '这是秘密值：secret', '纯中文的任意秘密值', 'x'.repeat(10000), '<script>alert(1)</script>', 'must be a string'])('replaces unregistered messages with a fixed Chinese instruction (%#)', untrusted => {
    expect(new ControlledValidationException(code, [{ path: 'description', message: untrusted }]).fields)
      .toEqual({ description: [PLATFORM_ERROR_MESSAGES[code]] });
  });

  it('does not retain fields for a runtime-unregistered code', () => {
    expect(new ControlledValidationException('SQL_SECRET' as PlatformErrorCode, [{ path: 'description', message }]).fields).toEqual({});
  });

  it('bounds response work to the first 100 issues and at most five messages per path', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ path: `correctiveActions[${i}].effective`, message }));
    expect(Object.keys(new ControlledValidationException(code, many).fields)).toHaveLength(100);
    const messages = ['请填写原因总结', '请填写 发生因 对策计划', '请填写 流出因 对策计划', '请完善对策计划',
      '请填写实际实施及验证记录', '请填写实际跟进批数或时长'];
    expect(new ControlledValidationException(code, messages.map(text => ({ path: 'correctiveActions', message: text }))).fields.correctiveActions)
      .toEqual(messages.slice(0, 5));
  });
});
