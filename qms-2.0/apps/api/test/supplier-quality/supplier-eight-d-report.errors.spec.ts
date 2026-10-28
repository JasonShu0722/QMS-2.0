import 'reflect-metadata';
import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';

const errors = [
  ['QUERY_INVALID', 400], ['ACCESS_DENIED', 403], ['APPROVED_UNAVAILABLE', 409], ['REVISION_NOT_FOUND', 404],
  ['SNAPSHOT_INVALID', 409], ['PRIVATE_SUPPLEMENT', 403], ['EVIDENCE_LIMIT', 409], ['EVIDENCE_DENIED', 403],
  ['EVIDENCE_UNAVAILABLE', 409], ['EVIDENCE_UNPINNED', 409], ['VERSION_CONFLICT', 409], ['OBJECT_INVALID', 409],
  ['IMAGE_INVALID', 422], ['IMAGE_LIMIT', 413], ['PDF_LIMIT', 413], ['RENDER_FAILED', 422], ['STORAGE_UNAVAILABLE', 503],
] as const;

it.each(errors)('preserves the safe status and registered report code for %s, hiding all 5xx details', (suffix, status) => {
  let actualStatus: number | undefined, body: any;
  const response = { status(value: number) { actualStatus = value; return this; }, json(value: unknown) { body = value; } };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ headers: {} }) }) } as unknown as ArgumentsHost;
  const code = `SUPPLIER_EIGHT_D_REPORT_${suffix}`;
  new GlobalExceptionFilter().catch(new HttpException({ code, message: 'PRIVATE_RAW_SNAPSHOT_OR_STORAGE_DETAILS' }, status), host);
  expect(actualStatus).toBe(status);
  expect(body.code).toBe(status >= 500 ? 'INTERNAL_ERROR' : code);
  expect(body.message).not.toBe('请求无法处理');
  expect(JSON.stringify(body)).not.toContain('PRIVATE_RAW_SNAPSHOT_OR_STORAGE_DETAILS');
  expect(JSON.stringify(body)).not.toContain('stack');
  if (status >= 500) expect(body.message).toBe('服务暂时不可用');
});
