import 'reflect-metadata';
import * as ledger from '../../src/modules/process-quality/process-defect-ledger.service.js';

const supplierId = 'aabbccdd-1111-4111-8111-aabbccddeeff';
const materialId = 'bbccddee-2222-4222-8222-bbccddeeffaa';
const sqeId = 'ccddeeff-3333-4333-8333-ccddeeffaabb';
const facts: ledger.ProcessDefectMaterialInput = {
  id: materialId, materialCode: 'A', materialName: 'Part A', supplierOrganizationId: supplierId,
  supplierProfileId: 'ddeeffaa-4444-4444-8444-ddeeffaabbcc', materialBatch: 'X', sqeUserId: sqeId, notes: 'Original note',
};

describe('manual process material review identity', () => {
  const changed = ledger.processMaterialIdentityChanged;

  it.each([
    ['materialCode', 'B'], ['materialName', 'Part B'],
    ['supplierOrganizationId', 'eeffaabb-5555-4555-8555-eeffaabbccdd'], ['materialBatch', 'Y'],
  ] as const)('invalidates a conclusion when %s changes', (field, value) => {
    expect(changed(facts, { ...facts, [field]: value })).toBe(true);
  });

  it.each(['materialCode', 'materialName', 'supplierOrganizationId', 'materialBatch'] as const)(
    'does not guess equality when %s becomes known or unknown', field => {
      const withoutProfile = { ...facts, supplierProfileId: null };
      expect(changed({ ...withoutProfile, [field]: null }, withoutProfile)).toBe(true);
      expect(changed(withoutProfile, { ...withoutProfile, [field]: null })).toBe(true);
      expect(changed({ ...withoutProfile, [field]: null }, { ...withoutProfile, [field]: null })).toBe(false);
      expect(changed({ ...withoutProfile, [field]: undefined }, { ...withoutProfile, [field]: null })).toBe(false);
    },
  );

  it.each([
    { notes: 'Supplement only' }, { sqeUserId: 'eeffaabb-5555-4555-8555-eeffaabbccdd' },
    { supplierProfileId: null }, { supplierProfileId: 'eeffaabb-5555-4555-8555-eeffaabbccdd' }, { position: 3 }, {},
  ])('keeps the conclusion for non-identity edits: %j', patch => {
    expect(changed(facts, { ...facts, ...patch })).toBe(false);
  });

  it.each([null, undefined])('compares supplier profiles when organization is %s', supplierOrganizationId => {
    const unmapped = { ...facts, supplierOrganizationId };
    expect(changed(unmapped, { ...unmapped, supplierProfileId: 'eeffaabb-5555-4555-8555-eeffaabbccdd' })).toBe(true);
    expect(changed(unmapped, { ...unmapped, supplierProfileId: null })).toBe(true);
    expect(changed({ ...unmapped, supplierProfileId: null }, unmapped)).toBe(true);
    expect(changed({ ...unmapped, supplierProfileId: undefined }, { ...unmapped, supplierProfileId: null })).toBe(false);
    expect(changed(unmapped, { ...unmapped, supplierProfileId: facts.supplierProfileId!.toUpperCase(), notes: 'More context', sqeUserId: null })).toBe(false);
  });

  it('keeps the conclusion when the same profile only gains or loses its organization mapping', () => {
    const unmapped = { ...facts, supplierOrganizationId: null };
    expect(changed(unmapped, facts)).toBe(false);
    expect(changed(facts, unmapped)).toBe(false);
    expect(changed(unmapped, { ...facts, supplierProfileId: 'eeffaabb-5555-4555-8555-eeffaabbccdd' })).toBe(true);
    expect(changed(facts, { ...unmapped, supplierProfileId: 'eeffaabb-5555-4555-8555-eeffaabbccdd' })).toBe(true);
  });

  it('never matches an organization id against a profile id', () => {
    expect(changed({ ...facts, supplierProfileId: null }, { ...facts, supplierOrganizationId: null, supplierProfileId: supplierId })).toBe(true);
    expect(changed({ ...facts, supplierOrganizationId: null, supplierProfileId: supplierId }, { ...facts, supplierProfileId: null })).toBe(true);
  });

  it('compares UUID identities case-insensitively without mutating old facts', () => {
    const previous = Object.freeze({ ...facts });
    expect(changed(previous, { ...facts, supplierOrganizationId: supplierId.toUpperCase() })).toBe(false);
    expect(previous).toEqual(facts);
  });

  it('normalizes UUIDs before matching item identities or comparing supplier facts', () => {
    const [item] = ledger.normalizeProcessDefectMaterials([{ ...facts, id: materialId.toUpperCase(), supplierOrganizationId: supplierId.toUpperCase(), sqeUserId: sqeId.toUpperCase() }]);
    expect(item).toMatchObject({ id: materialId, supplierOrganizationId: supplierId, sqeUserId: sqeId });
    expect(() => ledger.normalizeProcessDefectMaterials([facts, { ...facts, id: materialId.toUpperCase() }])).toThrow();
  });
});
