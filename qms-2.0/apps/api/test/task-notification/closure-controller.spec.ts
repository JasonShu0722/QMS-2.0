import 'reflect-metadata';
import { ACCESS_CONTEXT_METADATA, type AccessContextRequirement } from '../../src/modules/authorization/access.decorator.js';
import { ClosureInboxController, ClosureNotificationController } from '../../src/modules/workflow/workflow-closure-inbox.controller.js';

describe('closure HTTP authorization boundary', () => {
  it.each([[ClosureInboxController, 'task:read'], [ClosureNotificationController, 'notification:read']] as const)('requires feature permissions without the deny-only generic workflowPermission on %s', (controller, permission) => {
    const access = Reflect.getMetadata(ACCESS_CONTEXT_METADATA, controller.prototype.list) as AccessContextRequirement;
    expect(access.workflowPermission).toBeUndefined();
    expect(access.featurePermissions?.({})).toEqual([permission, 'workflow:act']);
    expect(Object.getOwnPropertyNames(controller.prototype)).toEqual(['constructor', 'list']);
  });
});
