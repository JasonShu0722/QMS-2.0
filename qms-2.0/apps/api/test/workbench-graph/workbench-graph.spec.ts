import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthenticatedGuard } from '../../src/common/guards/authenticated.guard.js';
import { AuditLogService } from '../../src/modules/audit-log/audit-log.service.js';
import { AuthorizationService } from '../../src/modules/authorization/authorization.service.js';
import { SessionService } from '../../src/modules/identity/session.service.js';
import { OrganizationScopeService } from '../../src/modules/organization/organization-scope.service.js';
import catalog from '../../src/modules/workbench-graph/workbench-catalog.json' with { type: 'json' };
import { WorkbenchGraphModule } from '../../src/modules/workbench-graph/workbench-graph.module.js';

describe('workbench graph HTTP contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [WorkbenchGraphModule],
      providers: [
        { provide: APP_GUARD, useClass: AuthenticatedGuard },
        { provide: SessionService, useValue: { resolve: (token: string) =>
          ['INTERNAL', 'SUPPLIER'].includes(token) ? { user: { accountType: token } } : null } },
        { provide: OrganizationScopeService, useValue: {} },
        { provide: AuthorizationService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => app?.close());

  const path = '/api/v1/workbench/graph';

  it('serves exactly the public catalog fields to an internal user without business grants', async () => {
    const { body } = await request(app.getHttpServer()).get(path).set('Cookie', 'qms_session=INTERNAL')
      .expect(200).expect('Cache-Control', 'no-store');
    expect(Object.keys(body).sort()).toEqual(['nodes', 'relations', 'version']);
    expect(body.version).toBe(catalog.version);
    expect(body.nodes.length).toBeGreaterThan(0);
    expect(body.relations.length).toBeGreaterThan(0);
    expect(body.nodes.map((node: { id: string }) => node.id)).toEqual(catalog.nodes.map(node => node.id));
    expect(body.relations.map((relation: { id: string }) => relation.id)).toEqual(catalog.relations.map(relation => relation.id));
    for (const node of body.nodes) {
      expect(Object.keys(node).sort()).toEqual(['aliases', 'domain', 'entry', 'guide', 'id', 'name', 'plan', 'status', 'statusUpdatedOn', 'summary']);
      expect(node.statusUpdatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Object.keys(node.guide).sort()).toEqual(['exceptions', 'prerequisites', 'result', 'role', 'steps', 'title', 'version']);
      expect(['idea', 'development', 'live']).toContain(node.status);
    }
    for (const relation of body.relations) {
      expect(Object.keys(relation).sort()).toEqual(['content', 'exceptions', 'from', 'id', 'kind', 'name', 'result', 'status', 'to', 'trigger']);
      expect(['data', 'configuration', 'handoff']).toContain(relation.kind);
      expect(['effective', 'configuration', 'planned', 'unverified']).toContain(relation.status);
    }
  });

  it('requires a valid session', async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    await request(app.getHttpServer()).get(path).set('Cookie', 'qms_session=invalid').expect(401);
  });

  it('denies an authenticated supplier', async () => {
    await request(app.getHttpServer()).get(path).set('Cookie', 'qms_session=SUPPLIER').expect(403);
  });
});
