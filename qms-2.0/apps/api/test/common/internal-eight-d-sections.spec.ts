import 'reflect-metadata';
import { emptyProcessEightDDocument } from '../../src/modules/process-quality/process-eight-d-document.js';
import * as adapter from '../../src/modules/process-quality/process-eight-d-read.adapter.js';
import { internalEightDSections } from '../../src/common/eight-d/internal-eight-d-sections.js';

it('exports the pure D2-D8 projection without including domain queries or changing the document', () => {
  expect(adapter.internalEightDSections).toBe(internalEightDSections);
  const document = emptyProcessEightDDocument(); document.description = 'shared body';
  document.temporaryMeasures = [{ id: 'm1', description: 'contain', departmentOwner: '', introducedAt: null, fileIds: [] }];
  const before = structuredClone(document);
  const sections = internalEightDSections(document);
  expect(sections.map((section: { key: string }) => section.key)).toEqual(['D2', 'D3', 'D4', 'D5-D6', 'D7', 'D8']);
  expect(sections[0]).toEqual({ key: 'D2', title: 'D2 问题描述', fields: [
    { key: 'description', label: 'description', value: 'shared body' },
    { key: 'okFileIds', label: 'okFileIds', value: '[]' },
    { key: 'ngFileIds', label: 'ngFileIds', value: '[]' },
  ] });
  expect(sections[1].fields[0].value).toBe(JSON.stringify(document.temporaryMeasures));
  expect(document).toEqual(before);
});
