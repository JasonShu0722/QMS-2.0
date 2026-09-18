import { jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../src/database/prisma.service.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FileManagementModule } from '../../src/modules/file-management/file-management.module.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import {
  OBJECT_STORAGE,
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

  it('creates supplier upload metadata and upload URLs with the same UUID object key', async () => {
    const persistedFile = {
      id: '30000000-0000-4000-8000-000000000001',
      organizationId: '20000000-0000-4000-8000-000000000002',
      objectKey: 'will-be-replaced',
      originalName: 'supplier ncr evidence.pdf',
      contentType: 'application/pdf',
      sizeBytes: 12n,
      sha256: 'will-be-replaced',
      status: 'QUARANTINED',
      version: 1,
      resourceType: 'FoundationAttachment',
      resourceId: 'foundation-only',
      uploadedById: '10000000-0000-4000-8000-000000000002',
      createdAt: new Date('2026-09-18T00:00:00.000Z'),
      updatedAt: new Date('2026-09-18T00:00:00.000Z'),
    };
    const prisma = {
      fileObject: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...persistedFile,
            objectKey: data.objectKey,
            sha256: data.sha256,
          }),
        ),
      },
    };
    const storage = {
      createUploadUrl: jest.fn().mockImplementation((objectKey: string) => Promise.resolve({
        objectKey,
        url: `http://localhost:9000/qms-foundation/${objectKey}`,
        headers: { 'content-type': 'application/pdf' },
      })),
    };
    const service = new FileLifecycleService(prisma as never, new FilePolicyService(), storage);

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

    expect(storage.createUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      'application/pdf',
    );
    expect(created).toMatchObject({
      fileId: '30000000-0000-4000-8000-000000000001',
      status: 'QUARANTINED',
      uploadUrl: `http://localhost:9000/qms-foundation/${created.objectKey}`,
      headers: { 'content-type': 'application/pdf' },
      metadata: {
        originalName: 'supplier ncr evidence.pdf',
        contentType: 'application/pdf',
        sizeBytes: 12,
        resourceType: 'FoundationAttachment',
        resourceId: 'foundation-only',
      },
    });
    expect(created.objectKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.objectKey).not.toContain('supplier');
    expect(JSON.parse(JSON.stringify(created))).toEqual(created);
    expect(Object.keys(created).sort()).toEqual([
      'fileId',
      'headers',
      'metadata',
      'objectKey',
      'status',
      'uploadUrl',
    ]);
    expect(prisma.fileObject.create.mock.calls[0][0].data).toMatchObject({
      organizationId: '20000000-0000-4000-8000-000000000002',
      uploadedById: '10000000-0000-4000-8000-000000000002',
      originalName: 'supplier ncr evidence.pdf',
      version: 1,
      status: 'QUARANTINED',
    });
    expect(prisma.fileObject.create.mock.calls[0][0].data.objectKey).toBe(created.objectKey);
    expect(prisma.fileObject.create.mock.calls[0][0].data.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('validates MIME and size before creating upload metadata', async () => {
    const prisma = {
      fileObject: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const storage = { createUploadUrl: jest.fn() };
    const service = new FileLifecycleService(prisma as never, new FilePolicyService({
      allowedMimeTypes: ['application/pdf'],
      maxBytes: 10,
    }), storage as never);

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
    expect(storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it('marks quarantined files available only after a clean scan', async () => {
    const prisma = {
      fileObject: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'file-id', status: 'AVAILABLE' }),
      },
    };
    const service = new FileLifecycleService(prisma as never, new FilePolicyService(), {} as never);

    await expect(
      service.markAvailableAfterScan('file-id', { clean: true, scanner: 'local-av' }),
    ).resolves.toEqual({ id: 'file-id', status: 'AVAILABLE' });
    expect(prisma.fileObject.updateMany).toHaveBeenCalledWith({
      where: { id: 'file-id', status: 'QUARANTINED' },
      data: { status: 'AVAILABLE' },
    });
  });

  it('keeps failed scans quarantined and refuses the availability transition', async () => {
    const prisma = {
      fileObject: {
        updateMany: jest.fn(),
      },
    };
    const service = new FileLifecycleService(prisma as never, new FilePolicyService(), {} as never);

    await expect(
      service.markAvailableAfterScan('file-id', {
        clean: false,
        scanner: 'local-av',
        reason: 'malware signature',
      }),
    ).rejects.toThrow('FILE_SCAN_REJECTED');
    expect(prisma.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it('allows downloads only after availability and uses logical delete', async () => {
    const prisma = {
      fileObject: {
        findUnique: jest.fn().mockResolvedValueOnce({ status: 'QUARANTINED' }).mockResolvedValueOnce({
          status: 'AVAILABLE',
        }),
        update: jest.fn().mockResolvedValue({ id: 'file-id', status: 'DELETED' }),
      },
    };
    const service = new FileLifecycleService(prisma as never, new FilePolicyService(), {} as never);

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

  it('injects object storage through the configured provider token', async () => {
    const previousProvider = process.env.QMS_OBJECT_STORAGE_PROVIDER;
    process.env.QMS_OBJECT_STORAGE_PROVIDER = 's3';
    const moduleRef = await Test.createTestingModule({
      imports: [FileManagementModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ fileObject: { create: jest.fn() } })
      .compile();

    expect(moduleRef.get(OBJECT_STORAGE)).toBeInstanceOf(S3CompatibleObjectStorage);
    expect(moduleRef.get(FileLifecycleService)).toBeInstanceOf(FileLifecycleService);
    await moduleRef.close();

    if (previousProvider === undefined) delete process.env.QMS_OBJECT_STORAGE_PROVIDER;
    else process.env.QMS_OBJECT_STORAGE_PROVIDER = previousProvider;
  });

  it('fails fast during module initialization for unsupported object storage providers', async () => {
    const previousProvider = process.env.QMS_OBJECT_STORAGE_PROVIDER;
    process.env.QMS_OBJECT_STORAGE_PROVIDER = 'filesystem';

    await expect(
      Test.createTestingModule({
        imports: [FileManagementModule],
      })
        .overrideProvider(PrismaService)
        .useValue({ fileObject: { create: jest.fn() } })
        .compile(),
    ).rejects.toThrow('OBJECT_STORAGE_PROVIDER_UNSUPPORTED');

    if (previousProvider === undefined) delete process.env.QMS_OBJECT_STORAGE_PROVIDER;
    else process.env.QMS_OBJECT_STORAGE_PROVIDER = previousProvider;
  });
});
