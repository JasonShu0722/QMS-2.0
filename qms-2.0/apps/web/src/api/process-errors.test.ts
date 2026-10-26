import { describe, expect, it } from 'vitest';
import { ApiError, safeAccountError } from './client';

describe('process quality safe feedback', () => {
  it.each([
    ['PROCESS_EIGHT_D_CONFIGURATION_REQUIRED', '尚未绑定'],
    ['PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE', '首批'],
    ['PROCESS_EIGHT_D_SOURCE_CONFIRMATION_REQUIRED', '复发'],
    ['PROCESS_EIGHT_D_REPORT_VERSION_CONFLICT', '刷新'],
    ['PROCESS_PRODUCTION_QUANTITY_INCOMPLETE', '数量'],
  ])('explains %s without displaying an arbitrary server message', (code, text) => {
    const error = new ApiError({ code, message: 'SELECT password FROM secret' }, 409);
    expect(safeAccountError(error)).toContain(text);
    expect(safeAccountError(error)).not.toContain('secret');
  });
});
