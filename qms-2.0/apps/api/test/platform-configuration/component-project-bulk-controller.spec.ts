import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { ACCESS_CONTEXT_METADATA } from '../../src/modules/authorization/access.decorator.js';
import { ComponentProjectBulkController } from '../../src/modules/platform-configuration/component-project-bulk.controller.js';
import { ComponentProjectBulkPreviewDto, ComponentProjectBulkApplyDto } from '../../src/modules/platform-configuration/component-project-bulk.dto.js';

describe('bulk controller contract', () => {
  it('uses manage access and query-scoped organization on both independent POST endpoints', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ComponentProjectBulkController)).toBe('api/v1/admin/configuration/component-project-mappings');
    for (const [method, path, body] of [['preview', 'bulk-preview', ComponentProjectBulkPreviewDto], ['apply', 'bulk-apply', ComponentProjectBulkApplyDto]] as const) {
      const handler = ComponentProjectBulkController.prototype[method];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
      expect(Reflect.getMetadata(ACCESS_CONTEXT_METADATA, handler)).toEqual({ featurePermission: 'component-project:manage', organizationScope: { source: 'query', field: 'organizationId', optional: true } });
      expect(Reflect.getMetadata('design:paramtypes', ComponentProjectBulkController.prototype, method)[1]).toBe(body);
    }
  });
});
