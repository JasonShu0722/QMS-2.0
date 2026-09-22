import { Test } from '@nestjs/testing';
import { PrismaService } from '../../src/database/prisma.service.js';
import { FileManagementModule } from '../../src/modules/file-management/file-management.module.js';
import { FileLifecycleService } from '../../src/modules/file-management/file-lifecycle.service.js';
import { FilePolicyService } from '../../src/modules/file-management/file-policy.service.js';
import { FileResourceAccess } from '../../src/modules/file-management/file-resource-access.js';
import { OBJECT_STORAGE, S3CompatibleObjectStorage, createObjectStorage } from '../../src/modules/file-management/object-storage.service.js';

describe('attachment policy and immutable object signing', () => {
  const environment = { ...process.env };
  afterEach(() => { process.env = { ...environment }; });

  it('enforces MIME, integer size, and batch count before upload', () => {
    const policy = new FilePolicyService({ allowedMimeTypes: ['application/pdf'], maxBytes: 1024, maxFiles: 2 });
    expect(() => policy.assertOne({ contentType: 'application/pdf', sizeBytes: 100 })).not.toThrow();
    for (const sizeBytes of [0, -1, 0.5, Number.NaN, 1025]) expect(() => policy.assertOne({ contentType: 'application/pdf', sizeBytes })).toThrow();
    expect(() => policy.assertOne({ contentType: 'text/html', sizeBytes: 1 })).toThrow();
    expect(() => policy.assertBatch(Array.from({ length: 3 }, () => ({ contentType: 'application/pdf', sizeBytes: 1 })))).toThrow();
  });

  it('rejects nonrandom object keys and missing version identifiers', async () => {
    const storage = new S3CompatibleObjectStorage();
    await expect(storage.createUploadUrl('invoice.pdf', 'application/pdf')).rejects.toThrow('OBJECT_KEY_MUST_BE_UUID');
    await expect(storage.createDownloadUrl('10000000-0000-4000-8000-000000000001', 'null', 'file')).rejects.toThrow('FILE_OBJECT_VERSION_REQUIRED');
  });

  it('requires explicit storage configuration and signs only short-lived immutable PUT and exact-version GET', async () => {
    const objectKey = '10000000-0000-4000-8000-000000000001';
    delete process.env.QMS_OBJECT_STORAGE_ENDPOINT;
    await expect(createObjectStorage().createUploadUrl(objectKey, 'application/pdf')).rejects.toThrow('OBJECT_STORAGE_CONFIGURATION_REQUIRED');
    Object.assign(process.env, { QMS_OBJECT_STORAGE_PROVIDER: 's3', QMS_OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test', QMS_OBJECT_STORAGE_BUCKET: 'test-bucket',
      QMS_OBJECT_STORAGE_ACCESS_KEY: 'fixture-access', QMS_OBJECT_STORAGE_SECRET_KEY: 'fixture-secret' });
    const storage = createObjectStorage();
    const upload = await storage.createUploadUrl(objectKey, 'application/pdf');
    const put = new URL(upload.url);
    expect(put.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(put.searchParams.get('X-Amz-SignedHeaders')).toContain('if-none-match');
    expect(upload.headers).toMatchObject({ 'if-none-match': '*', 'content-type': 'application/pdf' });
    const download = new URL(await storage.createDownloadUrl(objectKey, 'frozen-version', '证据.txt'));
    expect(download.searchParams.get('versionId')).toBe('frozen-version');
    expect(download.searchParams.get('response-content-disposition')).toContain('attachment;');
    expect(download.searchParams.get('X-Amz-Expires')).toBe('60');
  });

  it('installs an empty production resource registry and has no caller-supplied clean transition', async () => {
    const module = await Test.createTestingModule({ imports: [FileManagementModule] }).overrideProvider(PrismaService).useValue({}).compile();
    expect(module.get(OBJECT_STORAGE)).toBeInstanceOf(S3CompatibleObjectStorage);
    expect(module.get(FileResourceAccess)).toBeDefined();
    expect(module.get(FileLifecycleService)).not.toHaveProperty('markAvailableAfterScan');
    expect(module.get(FileLifecycleService)).not.toHaveProperty('assertDownloadable');
    await module.close();
  });

  it('rejects unsupported object storage providers', () => {
    process.env.QMS_OBJECT_STORAGE_PROVIDER = 'filesystem';
    expect(() => createObjectStorage()).toThrow('OBJECT_STORAGE_PROVIDER_UNSUPPORTED');
  });
});
