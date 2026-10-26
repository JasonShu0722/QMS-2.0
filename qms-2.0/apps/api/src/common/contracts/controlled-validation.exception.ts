import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorFields } from './error-response.js';
import { PLATFORM_ERROR_CODES, PLATFORM_ERROR_MESSAGES, type PlatformErrorCode } from './platform-error.js';

const SAFE_PATH = /^[A-Za-z][A-Za-z0-9_]*(?:\[(?:0|[1-9]\d{0,3})\]|\.[A-Za-z][A-Za-z0-9_]*)*$/;
const UNSAFE_KEY = /__proto__|prototype|constructor|password|passphrase|secret|token|session|authorization|cookie|objectkey|accesskey|privatekey|apikey|credential|connectionstring|databaseurl/i;
// These are server-authored validation instructions, never interpolated submitted values.
const SAFE_MESSAGES = new Set([
  '请填写原因总结', '请填写 发生因 对策计划', '请填写 流出因 对策计划', '请完善对策计划',
  '请填写实际实施及验证记录', '请填写实际跟进批数或时长', '请填写验证记录或提供受控验证文件',
  '必须人工明确确认措施验证有效', '需要更新的项目须记录实际完成日期', '需要更新的项目尚未完成',
  '请说明不适用原因', '需由负责人先确认分析完成并明确完整提交计划',
]);

export class ControlledValidationException extends HttpException {
  readonly fields: ErrorFields = Object.create(null);

  constructor(code: PlatformErrorCode, issues: readonly { path: string; message: string }[]) {
    super({ code }, HttpStatus.BAD_REQUEST);
    if (!PLATFORM_ERROR_CODES.includes(code)) return;
    for (const issue of issues.slice(0, 100)) {
      const path = issue?.path;
      if (typeof path !== 'string' || path.length > 160 || !SAFE_PATH.test(path)
        || path.split('.').length > 8 || UNSAFE_KEY.test(path.replace(/_/g, ''))
        || path.split(/[.\[\]]/).some(key => Object.hasOwn(Object.prototype, key))) continue;
      const message = SAFE_MESSAGES.has(issue.message) ? issue.message : PLATFORM_ERROR_MESSAGES[code];
      const messages = this.fields[path] ??= [];
      if (messages.length < 5 && !messages.includes(message)) messages.push(message);
    }
  }
}
