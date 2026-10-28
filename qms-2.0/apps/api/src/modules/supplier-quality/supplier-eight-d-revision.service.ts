import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { assertWorkflowFeature } from '../workflow/workflow-access-policy.js';
import { SupplierEightDService } from './supplier-eight-d.service.js';
import type { SupplierEightDActor } from './supplier-eight-d.types.js';
import type { SupplierEightDRevisionPageDto, SupplierEightDRevisionQueryDto } from './supplier-eight-d-revision.controller.js';

@Injectable()
export class SupplierEightDRevisionService {
  constructor(private readonly prisma: PrismaService, private readonly core: SupplierEightDService) {}
  list(actor: SupplierEightDActor, id: string, query: SupplierEightDRevisionQueryDto): Promise<SupplierEightDRevisionPageDto> {
    return this.prisma.$transaction(async tx => {
      const record = await this.core.lockRecord(tx, actor, id, true);
      await this.core.authorizeRead(tx, actor, record);
      await assertWorkflowFeature(tx, actor, actor.organizationId,
        actor.accountType === 'SUPPLIER' ? 'supplier-quality:responses:read' : 'supplier-quality:issues:report');
      const rows = await tx.supplierResponseRevision.findMany({ where: { problemId: record.supplier.id,
        ...(query.before ? { revision: { lt: query.before } } : {}) },
      select: { id: true, revision: true, createdAt: true }, orderBy: { revision: 'desc' }, take: query.pageSize + 1 });
      await this.core.authorizeRead(tx, actor, record);
      const items = rows.slice(0, query.pageSize).map(row => ({ id: row.id, revision: row.revision,
        createdAt: row.createdAt.toISOString(), approved: row.id === record.control.approvedRevisionId }));
      return { items, nextBefore: rows.length > query.pageSize ? items.at(-1)!.revision : null };
    }, { isolationLevel: 'ReadCommitted' });
  }
}
