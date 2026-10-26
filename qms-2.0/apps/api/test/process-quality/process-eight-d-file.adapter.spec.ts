import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ProcessEightDFileAdapter } from '../../src/modules/process-quality/process-eight-d-file.adapter.js';

function fixture() {
  const actor = { id: randomUUID(), organizationId: randomUUID(), accountType: 'INTERNAL' as const, sessionId: randomUUID(), scopeOrganizationId: randomUUID() };
  const target = randomUUID(), resource = { resourceType: 'process-eight-d', resourceId: randomUUID() };
  const record = { problem: { organizationId: target }, report: { version: 3 } };
  const tx = {};
  const service = {
    readResourceOrganizationId: jest.fn(async () => target),
    lockRecord: jest.fn(async () => record),
    authorizeRead: jest.fn(async () => {}),
    authorizeEdit: jest.fn(async () => {}),
  };
  const adapter = new ProcessEightDFileAdapter({} as never, service as never);
  return { actor, target, resource, record, tx, service, adapter };
}

it('derives READ scope only from the persisted report, retaining real actor identity and ignoring supplied scope', async () => {
  const f = fixture(), original = { ...f.actor };
  expect(await f.adapter.authorizeAndLock(f.tx as never, f.actor, f.resource, 'read')).toEqual({ organizationId: f.target, version: 3 });
  const reader = { ...f.actor, scopeOrganizationId: f.target };
  expect(f.service.readResourceOrganizationId).toHaveBeenCalledWith(f.tx, f.resource.resourceId);
  expect(f.service.lockRecord).toHaveBeenCalledWith(f.tx, reader, f.resource.resourceId, 'READ');
  expect(f.service.authorizeRead).toHaveBeenCalledWith(f.tx, reader, f.record);
  expect(f.service.authorizeEdit).not.toHaveBeenCalled();
  expect(f.actor).toEqual(original);
});

it.each(['upload', 'complete', 'attach', 'delete'] as const)('preserves the original EDIT actor and responsibility gate for %s', async action => {
  const f = fixture();
  await f.adapter.authorizeAndLock(f.tx as never, f.actor, f.resource, action);
  expect(f.service.readResourceOrganizationId).not.toHaveBeenCalled();
  expect(f.service.lockRecord).toHaveBeenCalledWith(f.tx, f.actor, f.resource.resourceId, 'EDIT');
  expect(f.service.authorizeEdit).toHaveBeenCalledWith(f.tx, f.actor, f.record);
  expect(f.service.authorizeRead).not.toHaveBeenCalled();
});

it('propagates final target READ permission revocation instead of returning a resource grant', async () => {
  const f = fixture();
  f.service.authorizeRead.mockImplementation(async () => { throw new HttpException('revoked', 403); });
  await expect(f.adapter.authorizeAndLock(f.tx as never, f.actor, f.resource, 'read')).rejects.toMatchObject({ status: 403 });
});

it('rejects invalid resource types and IDs before any report lookup', async () => {
  const f = fixture();
  for (const resource of [{ ...f.resource, resourceType: 'other-domain' }, { ...f.resource, resourceId: 'invalid' }]) {
    await expect(f.adapter.authorizeAndLock(f.tx as never, f.actor, resource, 'read')).rejects.toMatchObject({ status: 403 });
  }
  expect(f.service.readResourceOrganizationId).not.toHaveBeenCalled();
  expect(f.service.lockRecord).not.toHaveBeenCalled();
});
