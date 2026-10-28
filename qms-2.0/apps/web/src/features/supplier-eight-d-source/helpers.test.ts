import type { components } from '@qms/contracts';
import { expect, it } from 'vitest';
import { draftFromPreview } from './helpers';

const fact: components['schemas']['SupplierCopyFactDto'] = { factKey: 'process:1', defectDescription: '表面裂纹', defectQuantity: 3, materials: [{ id: 'material-1', materialCode: 'RAW-1', materialName: '壳体', materialBatch: 'B1' }] };
it('uses only server-projected distinct facts and never defaults risk or adds quantities', () => {
  const preview = { token: 'token', expiresAt: '2026-12-01', facts: [fact, fact, { ...fact, factKey: 'process:2', defectDescription: '尺寸异常', defectQuantity: 5 }] };
  expect(draftFromPreview(preview)).toEqual({ title: '表面裂纹', materialCode: 'RAW-1', defectDescription: '表面裂纹\n尺寸异常' });
});
it('leaves unknown or ambiguous material empty instead of substituting a finished component', () => {
  const unknown = { ...fact, materials: [{ id: 'unknown', materialCode: null, materialName: null, materialBatch: null }] };
  const preview = { token: 'token', expiresAt: '2026-12-01', facts: [unknown], componentCode: 'FINISHED-COMP', raw: { vin: 'secret' }, fileIds: ['private-file'] };
  expect(draftFromPreview(preview)).toEqual({ title: '表面裂纹', materialCode: '', defectDescription: '表面裂纹' });
  expect(draftFromPreview({ ...preview, facts: [fact, unknown] }).materialCode).toBe('');
  expect(draftFromPreview({ ...preview, facts: [] })).toEqual({ title: '', materialCode: '', defectDescription: '' });
});
