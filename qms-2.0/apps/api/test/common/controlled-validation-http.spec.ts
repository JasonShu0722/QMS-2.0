import 'reflect-metadata';
import { Controller, ForbiddenException, Get, HttpException, HttpStatus, Param, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { ControlledValidationException } from '../../src/common/contracts/controlled-validation.exception.js';
import { PLATFORM_ERROR_MESSAGES } from '../../src/common/contracts/platform-error.js';
import { ProcessEightDService } from '../../src/modules/process-quality/process-eight-d.service.js';
import { ProcessEightDController } from '../../src/modules/process-quality/process-eight-d.controller.js';
import { AUTHENTICATED_SESSION } from '../../src/common/guards/authenticated.guard.js';
import { normalizeProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';

const document = normalizeProcessEightDDocument({
  occurrenceCause: '发生原因', escapeCause: '流出原因',
  correctiveActions: ['OCCURRENCE', 'ESCAPE'].map((causeKind, i) => ({
    id: `action-${i}`, causeKind, action: '改善措施', owner: '负责人',
    plannedAt: '2026-11-01', verificationMethod: '实测',
  })),
});
const record = { problem: { ownerId: 'owner' }, report: { document,
  analysisCompletedAt: new Date(), submissionDueAt: new Date() } };
// Only the transaction boundary is replaced: the real service validation and filter run over HTTP.
const service = Object.assign(Object.create(ProcessEightDService.prototype), {
  command: async (_actor: unknown, _id: string, _input: unknown, _action: string, _key: string, _trace: string,
    work: (tx: unknown, current: unknown) => Promise<unknown>) => work({}, record),
  authorizeEdit: async () => {}, authorize: async () => {},
});
const readinessService = Object.assign(Object.create(ProcessEightDService.prototype), {
  transaction: (work: (tx: unknown) => Promise<unknown>) => work({}),
  lockRecord: async () => record,
  authorizeEdit: async (_tx: unknown, actor: { id: string }) => {
    if (actor.id !== 'owner') throw new ForbiddenException();
  },
});

@Controller('validation')
class ValidationController {
  @Get('required-evidence')
  requiredEvidence(): never {
    throw new ControlledValidationException('FILE_REQUIRED_EVIDENCE', [
      { path: 'horizontalDeployment[0].fileIds', message: '已完成的项目须关联本行通过安全扫描的附件' },
    ], HttpStatus.CONFLICT);
  }

  @Get('controlled/:status')
  controlled(@Param('status') status: string): never {
    const exception = new ControlledValidationException('PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE', [
      { path: 'correctiveActions[0].effective', message: '必须人工明确确认措施验证有效' },
      { path: 'token', message: 'secret' }, { path: 'document.__proto__.polluted', message: 'secret' },
      { path: 'correctiveActions[0].firstBatch', message: 'SELECT password FROM C:\\private' },
    ]);
    Object.assign(exception, { getStatus: () => Number(status) });
    throw exception;
  }

  @Get(':operation')
  fail(@Param('operation') operation: string) {
    const actor = { id: 'owner' };
    if (operation === 'document') return service.save(actor, 'problem', { document: { description: 42 } }, 'trace', 'key');
    if (operation === 'analysis') {
      const current = { ...record, report: { ...record.report, document: normalizeProcessEightDDocument({}), analysisCompletedAt: null, submissionDueAt: null } };
      return Object.assign(Object.create(service), {
        command: async (_a: unknown, _i: unknown, _p: unknown, _n: unknown, _k: unknown, _t: unknown,
          work: (tx: unknown, r: unknown) => Promise<unknown>) => work({}, current),
      }).analysisComplete(actor, 'problem', { submissionDueAt: new Date() }, 'trace', 'key');
    }
    return service.submit(actor, 'problem', { expectedVersion: 1 }, 'trace', 'key');
  }

  @Get('untrusted/:status')
  untrusted(@Param('status') status: string): never {
    throw new HttpException({ code: 'PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE', message: 'SELECT secret',
      issues: [{ path: 'correctiveActions[0].firstBatch', message: 'secret' }],
      fields: { token: ['secret'], 'correctiveActions[0].firstBatch': ['secret'] } }, Number(status));
  }
}

describe('controlled validation HTTP seam (no database)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = (await Test.createTestingModule({ controllers: [ValidationController, ProcessEightDController],
      providers: [{ provide: ProcessEightDService, useValue: readinessService }] }).compile()).createNestApplication();
    app.use((incoming: Record<PropertyKey, unknown> & { headers: Record<string, string> }, _response: unknown, next: () => void) => {
      incoming[AUTHENTICATED_SESSION] = { user: { id: incoming.headers['x-test-user'] ?? 'owner', accountType: 'INTERNAL' } };
      next();
    });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('checks consecutive unsaved drafts through the actual D8 route and rejects non-editors', async () => {
    const path = '/api/v1/process-quality/eight-d/1edc6a4d-87c1-4c6c-948b-ef190ef65df1/closure-check';
    const before = structuredClone(record);
    const submit = (draft: object) => request(app.getHttpServer()).post(path).send({ document: draft });
    const summaries = (issues: { path: string; message: string }[]) => issues.filter(issue => ['occurrenceCause', 'escapeCause'].includes(issue.path));
    const empty = await submit({}).expect(200);
    expect(summaries(empty.body)).toEqual([{ path: 'occurrenceCause', message: '请填写发生因总结' }, { path: 'escapeCause', message: '请填写流出因总结' }]);
    const partial = await submit({ occurrenceCause: 'New cause' }).expect(200);
    expect(summaries(partial.body)).toEqual([{ path: 'escapeCause', message: '请填写流出因总结' }]);
    const complete = await submit({ occurrenceCause: 'New cause', escapeCause: 'New escape cause' }).expect(200);
    expect(summaries(complete.body)).toEqual([]);
    expect(complete.body).toContainEqual({ path: 'analysisCompletedAt', message: '需由负责人先确认分析完成并明确完整提交计划' });
    await submit({}).set('x-test-user', 'reader').expect(403);
    await request(app.getHttpServer()).post(path).send({}).expect(400);
    expect(record).toEqual(before);
  });

  it('locates the real incomplete submission at individual action fields', async () => {
    const { body } = await request(app.getHttpServer()).get('/validation/submission').expect(400);
    expect(body).toMatchObject({ code: 'PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE', fields: {
      'correctiveActions[0].firstBatch': ['请填写实际实施及验证记录'],
      'correctiveActions[0].effective': ['必须人工明确确认措施验证有效'],
      'correctiveActions[1].verificationRecord': ['请填写验证记录或提供受控验证文件'],
    } });
    expect(body.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.issues).toBeUndefined();
  });

  it('locates real analysis completion issues without changing the 400 code', async () => {
    const { body } = await request(app.getHttpServer()).get('/validation/analysis').expect(400);
    expect(body).toMatchObject({ code: 'PROCESS_EIGHT_D_ANALYSIS_INCOMPLETE', fields: {
      occurrenceCause: ['请填写发生因总结'], escapeCause: ['请填写流出因总结'],
      correctiveActions: ['请填写 发生因 对策计划', '请填写 流出因 对策计划'],
    } });
  });

  it('locates real malformed draft input with a fixed Chinese message instead of validator payloads', async () => {
    const { body } = await request(app.getHttpServer()).get('/validation/document').expect(400);
    const { traceId, ...payload } = body;
    expect(traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(payload).toMatchObject({ code: 'PROCESS_EIGHT_D_DOCUMENT_INVALID', fields: {
      description: [PLATFORM_ERROR_MESSAGES.PROCESS_EIGHT_D_DOCUMENT_INVALID],
    } });
    expect(JSON.stringify(payload)).not.toMatch(/42|must be|SELECT|secret/);
  });

  it.each([400, 401, 403, 409, 500])('does not trust ordinary exception fields, issues or messages (%s)', async status => {
    const { body } = await request(app.getHttpServer()).get(`/validation/untrusted/${status}`).expect(status);
    expect(body.fields).toEqual({});
    expect(body.message).toBe(status === 500 ? '服务暂时不可用' : PLATFORM_ERROR_MESSAGES.PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE);
    expect(JSON.stringify(body)).not.toMatch(/SELECT|secret|token|correctiveActions/);
  });

  it('serializes only safe controlled fields and registered Chinese instructions', async () => {
    const { body } = await request(app.getHttpServer()).get('/validation/controlled/400').expect(400);
    expect(body.fields).toEqual({ 'correctiveActions[0].effective': ['必须人工明确确认措施验证有效'],
      'correctiveActions[0].firstBatch': [PLATFORM_ERROR_MESSAGES.PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE] });
    expect(JSON.stringify(body)).not.toMatch(/SELECT|password|private|token|secret|__proto__|polluted/);
  });

  it.each([401, 403, 409, 500])('does not attach validation fields to other HTTP semantics (%s)', async status => {
    const { body } = await request(app.getHttpServer()).get(`/validation/controlled/${status}`).expect(status);
    expect(body.fields).toEqual({});
    expect(body.code).toBe(status === 500 ? 'INTERNAL_ERROR' : 'PROCESS_EIGHT_D_SUBMISSION_INCOMPLETE');
  });

  it('locates required evidence conflicts in the completed D7 row', async () => {
    const { body } = await request(app.getHttpServer()).get('/validation/required-evidence').expect(409);
    expect(body).toMatchObject({ code: 'FILE_REQUIRED_EVIDENCE', fields: {
      'horizontalDeployment[0].fileIds': ['已完成的项目须关联本行通过安全扫描的附件'],
    } });
  });
});
