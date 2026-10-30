import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { adminError, assertAdminAccess, type AdminActor } from '../../common/security/admin-mutation.service.js';
import { FileScannerService } from './file-scanner.service.js';

@Injectable()
export class FileOperationsReadService {
  constructor(private readonly prisma: PrismaService, private readonly scanner: FileScannerService) {}

  async read(actor: AdminActor, organizationId: string) {
    if (actor.accountType !== 'INTERNAL') adminError('FEATURE_PERMISSION_DENIED', 403);
    let scannerConfigured = false;
    try { this.scanner.configuration(); scannerConfigured = true; } catch { /* Configuration is not a liveness probe. */ }
    let storageConfigured = false;
    try {
      const endpoint = new URL(process.env.QMS_OBJECT_STORAGE_ENDPOINT ?? '');
      storageConfigured = ['rustfs', 'minio', 's3'].includes(process.env.QMS_OBJECT_STORAGE_PROVIDER ?? 'rustfs')
        && ['http:', 'https:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash
        && !!process.env.QMS_OBJECT_STORAGE_BUCKET && !!process.env.QMS_OBJECT_STORAGE_ACCESS_KEY && !!process.env.QMS_OBJECT_STORAGE_SECRET_KEY;
    } catch { /* No raw configuration leaves this owner. */ }
    return this.prisma.$transaction(async tx => {
      await assertAdminAccess(tx, actor, organizationId, 'console:services:read');
      const where = { organizationId, deletedAt: null };
      const [waiting, pending, failed, succeeded, latest] = await Promise.all([
        tx.fileObject.count({ where: { ...where, scanStatus: 'WAITING_UPLOAD' } }),
        tx.fileObject.count({ where: { ...where, scanStatus: 'PENDING' } }),
        tx.fileObject.count({ where: { ...where, scanStatus: { in: ['ERROR', 'REJECTED'] } } }),
        tx.fileObject.count({ where: { ...where, scanStatus: 'CLEAN' } }),
        tx.fileObject.findFirst({ where: { ...where, scannedAt: { not: null } }, orderBy: [{ scannedAt: 'desc' }, { id: 'asc' }], select: { scannedAt: true, scanStatus: true } }),
      ]);
      return { configured: scannerConfigured && storageConfigured, scannerConfigured, storageConfigured, counts: { waiting, pending, failed, succeeded },
        latest: latest?.scannedAt ? { observedAt: latest.scannedAt.toISOString(), status: latest.scanStatus === 'CLEAN' ? 'SUCCEEDED' as const : 'FAILED' as const } : null };
    });
  }
}
