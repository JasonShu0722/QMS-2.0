import { expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { integrationError } from './integration-ui';

it.each([
  ['INTEGRATION_CREDENTIAL_LIMIT', 409, '请先撤销不再使用的接口凭据'],
  ['INTEGRATION_CREDENTIAL_REQUIRED', 409, '启用前需要有效的接口凭据'],
  ['INTEGRATION_CREDENTIAL_SECRET_UNAVAILABLE', 409, '旧凭据无法复制，请创建一份新凭据；旧凭据仍可继续使用'],
  ['INTEGRATION_CAPACITY_CONFLICT', 409, '容量不能低于当前已用容量'],
  ['INTEGRATION_PAYLOAD_EXPIRED', 410, '接收正文已按保留期限清理'],
])('explains %s without incorrectly treating it as an edit conflict', (code, status, message) => {
  expect(integrationError(new ApiError({ code, message: 'untrusted-server-detail' }, status))).toBe(message);
});
