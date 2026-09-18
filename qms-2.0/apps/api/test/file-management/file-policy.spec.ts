import { jest } from '@jest/globals';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import {
  S3CompatibleObjectStorage,
  createObjectStorage,
} from '../../src/modules/file-management/object-storage.service.js';

describe('file management foundation', () => {
  it('enforces MIME, size, and batch count limits', () => {
    const policy = new FilePolicyService({
      allowedMimeTypes: ['application/pdf', 'image/png'],
      maxBytes: 1024,
      maxFiles: 2,
    });

    expect(() =>
      policy.assertBatch([
        { contentType: 'application/pdf', sizeBytes: 100 },
        { contentType: 'image/png', sizeBytes: 200 },
      ]),
    ).not.toThrow();
    expect(() =>
      policy.assertBatch([{ contentType: 'text/html', sizeBytes: 100 }]),
    ).toThrow('FILE_MIME_NOT_ALLOWED');
    expect(() =>
      policy.assertBatch([{ contentType: 'application/pdf', sizeBytes: 1025 }]),
    ).toThrow('FILE_TOO_LARGE');
    expect(() =>
      policy.assertBatch([
        { contentType: 'application/pdf', sizeBytes: 1 },
        { contentType: 'application/pdf', sizeBytes: 1 },
        { contentType: 'application/pdf', sizeBytes: 1 },
      ]),
    ).toThrow('FILE_COUNT_EXCEEDED');
  });

  it('creates supplier uploads as quarantined records with UUID object keys', async () => {
    const prisma = {
      fileObject: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    const service = new FileLifecycleService(prisma as never, new FilePolicyService());

    const created = await service.initializeUpload({
      accountType: 'SUPPLIER',
      organizationId: '20000000-0000-4000-8000-000000000002',
      uploadedById: '10000000-0000-4000-8000-000000000002',
      originalName: 'supplier ncr evidence.pdf',
      contentType: 'application/pdf',
      sizeBytes: 12,
      bytes: Buffer.from('file-content'),
      resourceType: 'FoundationAttachment',
      resourceId: 'foundation-only',
    });

    expect(created.status).toBe('QUARANTINED');
    expect(created.objectKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.objectKey).not.toContain('supplier');
    expect(created.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prisma.fileObject.create.mock.calls[0][0].data).toMatchObject({
      organizationId: '20000000-0000-4000-8000-000000000002',
      uploadedById: '10000000-0000-4000-8000-000000000002',
      originalName: 'supplier ncr evidence.pdf',
      version: 1,
      status: 'QUARANTINED',
    });
  });

  it('validates MIME and size before creating upload metadata', async () => {
    const prisma = {
      fileObject: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new FileLifecycleService(
      prisma as never,
      new FilePolicyService({
        allowedMimeTypes: ['application/pdf'],
        maxBytes: 10,
      }),
    );

    await expect(
      service.initializeUpload({
        accountType: 'INTERNAL',
        organizationId: '20000000-0000-4000-8000-000000000002',
        uploadedById: '10000000-0000-4000-8000-000000000002',
        originalName: 'payload.html',
        contentType: 'text/html',
        sizeBytes: 12,
        bytes: Buffer.from('file-content'),
      }),
    ).rejects.toThrow('FILE_MIME_NOT_ALLOWED');
    expect(prisma.fileObject.create).not.toHaveBeenCalled();
  });

  it('allows downloads only after scan availability and uses logical delete', async () => {
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValueOnce({ status: 'QUARANTINED' }).mockResolvedValueOnce({
          status: 'AVAILABLE',
        }),
        update: jest.fn().mockResolvedValue({ id: 'file-id', status: 'DELETED' }),
      },
    };
    const service = new FileLifecycleService(prisma as never, new FilePolicyService());

    await expect(service.assertDownloadable('file-id')).rejects.toThrow('FILE_NOT_AVAILABLE');
    await expect(service.assertDownloadable('file-id')).resolves.toEqual({ status: 'AVAILABLE' });
    await expect(service.deleteLogically('file-id')).resolves.toMatchObject({ status: 'DELETED' });
  });

  it('rejects object storage keys that are not random UUIDs', async () => {
    const storage = new S3CompatibleObjectStorage();
    await expect(storage.createUploadUrl('invoice.pdf', 'application/pdf')).rejects.toThrow(
      'OBJECT_KEY_MUST_BE_UUID',
    );
  });

  it('uses MinIO defaults locally and accepts S3 compatible endpoints from configuration', async () => {
    const uuid = '10000000-0000-4000-8000-000000000001';
    const previousEndpoint = process.env.QMS_OBJECT_STORAGE_ENDPOINT;
    const previousBucket = process.env.QMS_OBJECT_STORAGE_BUCKET;
    const previousProvider = process.env.QMS_OBJECT_STORAGE_PROVIDER;

    delete process.env.QMS_OBJECT_STORAGE_ENDPOINT;
    delete process.env.QMS_OBJECT_STORAGE_BUCKET;
    delete process.env.QMS_OBJECT_STORAGE_PROVIDER;
    await expect(createObjectStorage().createUploadUrl(uuid, 'application/pdf')).resolves.toMatchObject({
      objectKey: uuid,
      url: `http://localhost:9000/qms-foundation/${uuid}`,
      headers: { 'content-type': 'application/pdf' },
    });

    process.env.QMS_OBJECT_STORAGE_PROVIDER = 's3';
    process.env.QMS_OBJECT_STORAGE_ENDPOINT = 'https://s3.example.test';
    process.env.QMS_OBJECT_STORAGE_BUCKET = 'qms-prod';
    await expect(createObjectStorage().createUploadUrl(uuid, 'application/pdf')).resolves.toMatchObject({
      objectKey: uuid,
      url: `https://s3.example.test/qms-prod/${uuid}`,
      headers: { 'content-type': 'application/pdf' },
    });

    if (previousEndpoint === undefined) delete process.env.QMS_OBJECT_STORAGE_ENDPOINT;
    else process.env.QMS_OBJECT_STORAGE_ENDPOINT = previousEndpoint;
    if (previousBucket === undefined) delete process.env.QMS_OBJECT_STORAGE_BUCKET;
    else process.env.QMS_OBJECT_STORAGE_BUCKET = previousBucket;
    if (previousProvider === undefined) delete process.env.QMS_OBJECT_STORAGE_PROVIDER;
    else process.env.QMS_OBJECT_STORAGE_PROVIDER = previousProvider;
  });
});
