import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { ACCESS_CONTEXT_METADATA } from '../../src/modules/authorization/access.decorator.js';
import { ProcessQualityController } from '../../src/modules/process-quality/process-quality.controller.js';

describe('manual ledger authorization entry points', () => {
  it('routes bulk maintenance through the existing permission for the selected board', () => {
    const handler = Reflect.get(ProcessQualityController.prototype, 'bulkMaintenance');
    expect(typeof handler).toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('defects/bulk-maintenance');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PATCH);
    const access = Reflect.getMetadata(ACCESS_CONTEXT_METADATA, handler);
    expect(access.organizationScope).toEqual({ source: 'body', field: 'organizationId', optional: false });
    for (const board of ['ANALYSIS', 'RESPONSIBILITY', 'DISPOSITION']) {
      expect(access.featurePermissions({ board })).toEqual(['process-quality:defects:write']);
    }
    expect(access.featurePermissions({ board: 'CLOSURE' })).toEqual(['process-quality:defects:close']);
    expect(access.featurePermissions({ board: 'MATERIAL_REVIEW' })).toEqual(['process-quality:materials:review']);
  });

  it('does not grant close/reopen with ordinary write, or SQE verification with maintenance', () => {
    for (const [name, path, permission] of [
      ['close', 'defects/:id/close', 'process-quality:defects:close'], ['reopen', 'defects/:id/reopen', 'process-quality:defects:close'],
      ['verifyMaterial', 'defects/:id/materials/:materialId/verification', 'process-quality:materials:review'],
      ['classifyOne', 'defects/:id/classification', 'process-quality:defects:write'], ['classifyMany', 'defects/classification', 'process-quality:defects:write'],
    ] as const) {
      const handler = ProcessQualityController.prototype[name];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.PUT);
      expect(Reflect.getMetadata(ACCESS_CONTEXT_METADATA, handler)).toEqual({ featurePermission: permission, organizationScope: { source: 'body', field: 'organizationId', optional: true } });
    }
  });

  it('offers real eligible SQEs through the existing ledger read scope', () => {
    const handler = ProcessQualityController.prototype.materialSqes;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('defects/material-sqes');
    expect(Reflect.getMetadata(ACCESS_CONTEXT_METADATA, handler)).toEqual({ featurePermission: 'process-quality:defects:read', organizationScope: { source: 'query', field: 'organizationId', optional: true } });
  });
});
