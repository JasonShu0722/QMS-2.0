import { Injectable, Module } from '@nestjs/common';
import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';

@Injectable()
export class LegacyRoleReferenceReadModel {
  async references(tx: AdminTransaction, organizationIds: string[], roleCode: string) {
    const nodes = await tx.workflowNode.findMany({ where: { organizationId: { in: organizationIds } }, select: { id: true, organizationId: true, config: true, workflowVersionId: true, workflowVersion: { select: { status: true } } }, orderBy: { id: 'asc' } });
    return nodes.filter(({ config }) => {
      const object = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
      return ['assignment', 'escalation'].some(key => { const entry = object[key]; return entry === roleCode || (entry && typeof entry === 'object' && !Array.isArray(entry) && entry.roleCode === roleCode); });
    }).map(node => ({ organizationId: node.organizationId, versionId: node.workflowVersionId, nodeId: node.id, status: node.workflowVersion.status, roleCode }));
  }
}

@Module({ providers: [LegacyRoleReferenceReadModel], exports: [LegacyRoleReferenceReadModel] })
export class LegacyRoleReferenceModule {}
