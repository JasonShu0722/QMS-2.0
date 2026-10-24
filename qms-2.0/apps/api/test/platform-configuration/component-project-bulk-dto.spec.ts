import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ComponentProjectBulkPreviewDto, ComponentProjectBulkApplyDto } from '../../src/modules/platform-configuration/component-project-bulk.dto.js';

const options = { whitelist: true, forbidNonWhitelisted: true };
const selection = () => [{ id: randomUUID(), expectedVersion: 1 }];
const errors = (body: object) => validate(plainToInstance(ComponentProjectBulkPreviewDto, body), options);

describe('component project bulk DTO boundary', () => {
  it('accepts exactly 1..100 distinct versioned mapping IDs without numeric coercion', async () => {
    for (const count of [1, 100]) {
      expect(await errors({ selection: Array.from({ length: count }, () => selection()[0]), changes: { stage: 'NEW_PRODUCT' } })).toEqual([]);
    }
    const id = randomUUID();
    for (const selected of [[], Array.from({ length: 101 }, () => selection()[0]), [{ id, expectedVersion: 1 }, { id: id.toUpperCase(), expectedVersion: 1 }],
      [{ id: 'invalid', expectedVersion: 1 }], [{ id, expectedVersion: 0 }], [{ id, expectedVersion: '1' }], [{ id, expectedVersion: 1.5 }], [{ id, expectedVersion: 2147483648 }]]) {
      expect((await errors({ selection: selected, changes: { stage: 'NEW_PRODUCT' } })).length).toBeGreaterThan(0);
    }
  });

  it('rejects empty changes, nested extras, and mapping identity edits', async () => {
    for (const changes of [{}, null, [], { componentCode: 'X' }, { componentName: 'X' }, { status: 'DISABLED' }, { organizationId: randomUUID() }]) {
      expect((await errors({ selection: selection(), changes })).length).toBeGreaterThan(0);
    }
    expect((await errors({ selection: [{ ...selection()[0], other: 'x' }], changes: { stage: 'NEW_PRODUCT' } })).length).toBeGreaterThan(0);
    expect((await errors({ selection: selection(), changes: { stage: 'NEW_PRODUCT' }, organizationId: randomUUID() })).length).toBeGreaterThan(0);
  });

  it('trims classifications and distinguishes omission from allowed explicit null', async () => {
    const dto = plainToInstance(ComponentProjectBulkPreviewDto, { selection: selection(), changes: { productCategory: ' Drive ', productSubcategory: null, customerEngineerAssignmentId: null } });
    expect(await validate(dto, options)).toEqual([]);
    expect(dto.changes).toMatchObject({ productCategory: 'Drive', productSubcategory: null, customerEngineerAssignmentId: null });
    expect(dto.changes.projectEngineerAssignmentId).toBeUndefined();
    for (const field of ['projectRecordId', 'stage', 'productCategory']) {
      expect((await errors({ selection: selection(), changes: { [field]: null } })).length).toBeGreaterThan(0);
    }
    for (const field of ['productCategory', 'productSubcategory']) {
      for (const value of [' ', 'x'.repeat(101), 1]) expect((await errors({ selection: selection(), changes: { [field]: value } })).length).toBeGreaterThan(0);
    }
    for (const field of ['projectRecordId', 'customerEngineerAssignmentId', 'projectEngineerAssignmentId']) {
      expect((await errors({ selection: selection(), changes: { [field]: 'free-user-name' } })).length).toBeGreaterThan(0);
    }
    expect((await errors({ selection: selection(), changes: { stage: 'DEFAULT' } })).length).toBeGreaterThan(0);
  });

  it('requires an actual sha256 snapshot fingerprint for apply', async () => {
    for (const previewToken of [undefined, null, '', 'fake', 'a'.repeat(63), 'z'.repeat(64)]) {
      expect((await validate(plainToInstance(ComponentProjectBulkApplyDto, { selection: selection(), changes: { stage: 'NEW_PRODUCT' }, previewToken }), options)).length).toBeGreaterThan(0);
    }
    expect(await validate(plainToInstance(ComponentProjectBulkApplyDto, { selection: selection(), changes: { projectEngineerAssignmentId: null }, previewToken: 'a'.repeat(64) }), options)).toEqual([]);
  });
});
