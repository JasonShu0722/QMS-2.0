import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { HttpException, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { jest } from '@jest/globals';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { configureHttpBodyParser } from '../../src/http-body-parser.js';
import { GlobalExceptionFilter } from '../../src/common/contracts/global-exception.filter.js';
import { IntegrationReceiptService } from '../../src/modules/api-integration/integration-receipt.service.js';
import { InboundService } from '../../src/modules/api-integration/inbound.service.js';
import { DataExchangeObservationService } from '../../src/modules/system-management/data-exchange-observation.service.js';
import { isDisposableLoopbackPostgres } from '../disposable-postgres.js';

if (!isDisposableLoopbackPostgres(process.env.DATABASE_URL) || process.env.QMS_DISPOSABLE_TEST_DB!=='true') throw new Error('Observation requires disposable PostgreSQL.');

describe('noncritical integration observation on real HTTP and PostgreSQL', () => {
  let app: NestExpressApplication, prisma: PrismaService;
  const scopes: string[]=[];
  beforeAll(async()=> {
    app=(await Test.createTestingModule({imports:[AppModule]}).compile()).createNestApplication<NestExpressApplication>({bodyParser:false});
    configureHttpBodyParser(app); app.useGlobalFilters(new GlobalExceptionFilter()); app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true})); await app.init(); prisma=app.get(PrismaService);
  });
  afterEach(()=>jest.restoreAllMocks());
  afterAll(async()=> {
    if (prisma) {
      const where={organizationId:{in:scopes}};
      await prisma.dataExchangeAttempt.deleteMany({where:{scopeKey:{in:scopes}}});
      await prisma.integrationRequestAttempt.deleteMany({where}); await prisma.integrationReceipt.deleteMany({where}); await prisma.integrationRateWindow.deleteMany({where:{endpoint:{organizationId:{in:scopes}}}});
      await prisma.integrationCredential.deleteMany({where}); await prisma.integrationScopeCapacity.deleteMany({where}); await prisma.integrationEndpoint.deleteMany({where});
      await prisma.auditEvent.deleteMany({where}); await prisma.organization.deleteMany({where:{id:{in:scopes}}});
    }
    await app?.close();
  });
  async function fixture(returnReceipt=true) {
    const organization=await prisma.organization.create({data:{code:randomUUID(),name:'Private observed organization',type:'INTERNAL'}}); scopes.push(organization.id);
    const endpoint=await prisma.integrationEndpoint.create({data:{organizationId:organization.id,code:randomUUID(),name:'Private observed endpoint',sourceCode:'INTERNAL',sourceName:'Internal',status:'ENABLED',returnReceipt}});
    const secret=randomBytes(32).toString('base64url');
    const credential=await prisma.integrationCredential.create({data:{organizationId:organization.id,endpointId:endpoint.id,name:'Private machine',secretHash:createHash('sha256').update(secret).digest('hex'),expiresAt:new Date(Date.now()+86400000)}});
    return {organization,endpoint,credential,secret,authorization:`Bearer ${credential.id}.${secret}`,path:`/api/v1/integrations/inbound/${endpoint.id}/messages`};
  }
  it('records independent received attempts and server message IDs when the legacy header is repeated',async()=> {
    const item=await fixture(),messageId='A'.repeat(128);
    const first=await request(app.getHttpServer()).post(item.path).set('Authorization',item.authorization).set('Idempotency-Key',messageId).send([{private:'retained'}]).expect(200);
    const repeated=await request(app.getHttpServer()).post(item.path).set('Authorization',item.authorization).set('Idempotency-Key',messageId).send([{private:'retained'}]).expect(200);
    expect(first.headers['x-request-id']).not.toBe(repeated.headers['x-request-id']);
    const attempts=await prisma.integrationRequestAttempt.findMany({where:{organizationId:item.organization.id},orderBy:{observedAt:'asc'}});
    expect(attempts).toHaveLength(2); expect(attempts.map(row=>row.outcome)).toEqual(['RECEIVED','RECEIVED']);
    expect(attempts.map(row=>row.messageId)).toEqual([first.body.receiptId,repeated.body.receiptId]);
    expect(new Set(attempts.map(row=>row.receiptId)).size).toBe(2);
    expect(JSON.stringify(attempts)).not.toContain(item.secret);
    const exchange=await prisma.dataExchangeAttempt.findMany({where:{scopeKey:item.organization.id}});
    expect(exchange).toHaveLength(2); expect(exchange.every(row=>row.correlationId.length===36)).toBe(true);
    expect(exchange.every(row=>(row.stages as {processing:{outcome:string}}).processing.outcome==='NOT_REPORTED')).toBe(true);
  });
  it('receives raw bytes independently through encoded and original endpoint UUID paths',async()=> {
    const item=await fixture(),messageId=randomUUID(),payload=JSON.stringify([{private:'界'.repeat(40000)}]);
    const encoded=`%${item.endpoint.id.charCodeAt(0).toString(16)}${item.endpoint.id.slice(1)}`;
    const first=await request(app.getHttpServer()).post(`/api/v1/integrations/inbound/${encoded}/messages`).set('Authorization',item.authorization).set('Idempotency-Key',messageId).set('Content-Type','application/json').send(payload).expect(200);
    const repeated=await request(app.getHttpServer()).post(item.path).set('Authorization',item.authorization).set('Idempotency-Key',messageId).set('Content-Type','application/json').send(payload).expect(200);
    expect(repeated.body.receiptId).not.toBe(first.body.receiptId);
    const receipts=await prisma.integrationReceipt.findMany({where:{organizationId:item.organization.id}});
    expect(receipts).toHaveLength(2);
    expect(receipts).toEqual(expect.arrayContaining([first,repeated].map(response=>expect.objectContaining({id:response.body.receiptId,messageId:response.body.receiptId,bodyDigest:null}))));
  });
  it('stores authenticated failure metadata but never failed plaintext or untrusted identity',async()=> {
    const item=await fixture(false),messageId=randomUUID();
    await request(app.getHttpServer()).post(item.path).set('Authorization',item.authorization).set('Idempotency-Key',messageId).set('Content-Type','application/json').send('{"private-broken":').expect(400);
    expect(await prisma.integrationReceipt.count({where:{organizationId:item.organization.id}})).toBe(0);
    const attempt=await prisma.integrationRequestAttempt.findFirstOrThrow({where:{organizationId:item.organization.id}});
    expect(attempt).toMatchObject({messageId:null,statusCode:400,outcome:'REJECTED',reasonCode:'INTEGRATION_MESSAGE_INVALID'});
    expect(JSON.stringify(attempt)).not.toMatch(/private-broken|secretDigest|Bearer/);
    await request(app.getHttpServer()).post(item.path).set('Authorization','Bearer invalid').set('Idempotency-Key',randomUUID()).send({organizationId:item.organization.id}).expect(401);
    expect(await prisma.integrationRequestAttempt.count({where:{organizationId:item.organization.id}})).toBe(1);
  });
  it('records the evaluated failure configuration when an endpoint changes before observation',async()=> {
    const item=await fixture();
    await prisma.integrationEndpoint.update({where:{id:item.endpoint.id},data:{maxBodyBytes:4}});
    const inbound=app.get(InboundService),receive=inbound.receive.bind(inbound);
    jest.spyOn(inbound,'receive').mockImplementation(async (incoming,identity)=> {
      try { return await receive(incoming,identity); }
      catch (error) {
        await prisma.integrationEndpoint.update({where:{id:item.endpoint.id},data:{version:2,maxBodyBytes:1024,returnReceipt:false}});
        throw error;
      }
    });
    const messageId=randomUUID();
    await request(app.getHttpServer()).post(item.path).set('Authorization',item.authorization).set('Idempotency-Key',messageId).send([{private:'too large for version one'}]).expect(413);
    expect(await prisma.integrationEndpoint.findUniqueOrThrow({where:{id:item.endpoint.id}})).toMatchObject({version:2,maxBodyBytes:1024,returnReceipt:false});
    const attempt=await prisma.integrationRequestAttempt.findFirstOrThrow({where:{organizationId:item.organization.id}});
    expect(attempt).toMatchObject({messageId:null,statusCode:413,outcome:'REJECTED',reasonCode:'INTEGRATION_BODY_TOO_LARGE',configurationVersion:1,returnReceipt:true});
    expect(await prisma.integrationReceipt.count({where:{organizationId:item.organization.id}})).toBe(0);
  });
  it.each([
    ['quoted UTF-8','application/json; charset="utf-8"',undefined],
    ['Identity casing','application/json','Identity'],
    ['quoted UTF-8 and Identity casing','application/json; charset="utf-8"','Identity'],
  ])('accepts equivalent JSON headers for first delivery and retry: %s',async (_label,contentType,contentEncoding)=> {
    const item=await fixture(),messageId=randomUUID(),payload='[{"private":"equivalent headers"}]';
    for (const status of [200,200]) {
      const outgoing=request(app.getHttpServer()).post(item.path).set('Authorization',item.authorization).set('Idempotency-Key',messageId).set('Content-Type',contentType!);
      if (contentEncoding) outgoing.set('Content-Encoding',contentEncoding);
      await outgoing.send(payload).expect(status);
    }
    expect(await prisma.integrationReceipt.count({where:{organizationId:item.organization.id}})).toBe(2);
  });
  it('keeps rejecting non-UTF-8 charsets and compressed bodies',async()=> {
    const item=await fixture();
    await request(app.getHttpServer()).post(item.path).set('Authorization',item.authorization).set('Idempotency-Key',randomUUID()).set('Content-Type','application/json; charset="iso-8859-1"').send('{"private":"unsupported charset"}').expect(415);
    await request(app.getHttpServer()).post(item.path).set('Authorization',item.authorization).set('Idempotency-Key',randomUUID()).set('Content-Type','application/json').set('Content-Encoding','gzip').send(Buffer.from('private compressed input')).expect(415);
    expect(await prisma.integrationReceipt.count({where:{organizationId:item.organization.id}})).toBe(0);
  });
  it.each([400,403,409,503])('does not reverse committed 201 or 204 when an auxiliary writer fails with %s',async status=> {
    for (const returnReceipt of [true,false]) {
      const item=await fixture(returnReceipt);
      const spy=jest.spyOn(app.get(IntegrationReceiptService),'recordAttempt').mockRejectedValue(new HttpException('auxiliary failure',status));
      const response=await request(app.getHttpServer()).post(item.path).set('Authorization',item.authorization).set('Idempotency-Key',randomUUID()).send([{private:'successful'}]).expect(200);
      expect(await prisma.integrationReceipt.count({where:{organizationId:item.organization.id}})).toBe(1);
      expect(app.get(IntegrationReceiptService).collectionStatus(item.organization.id)).toBe('UNAVAILABLE');
      if (!returnReceipt) expect(response.text).toBe('');
      spy.mockRestore();
    }
  });
  it('isolates an exchange conflict after the receipt and request metadata were saved',async()=> {
    const item=await fixture();
    jest.spyOn(app.get(DataExchangeObservationService),'recordStageResult').mockRejectedValue(new HttpException('observation conflict',409));
    await request(app.getHttpServer()).post(item.path).set('Authorization',item.authorization).set('Idempotency-Key',randomUUID()).send([{private:'successful'}]).expect(200);
    expect(await prisma.integrationReceipt.count({where:{organizationId:item.organization.id}})).toBe(1);
    expect(await prisma.integrationRequestAttempt.count({where:{organizationId:item.organization.id}})).toBe(1);
    expect(app.get(IntegrationReceiptService).collectionStatus(item.organization.id)).toBe('UNAVAILABLE');
  });
});
