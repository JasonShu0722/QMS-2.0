import type { components } from '@qms/contracts';

export function draftFromPreview(preview: components['schemas']['SupplierCopyPreviewDto']): Pick<components['schemas']['SupplierProblemDraftDto'], 'title' | 'materialCode' | 'defectDescription'> {
  const facts = [...new Map(preview.facts.map(fact => [fact.factKey, fact])).values()];
  const materials = [...new Map(facts.flatMap(fact => fact.materials).map(material => [material.id, material])).values()];
  return {
    title: facts[0]?.defectDescription.slice(0, 500) ?? '',
    materialCode: materials.length === 1 ? materials[0].materialCode ?? '' : '',
    defectDescription: facts.map(fact => fact.defectDescription).join('\n'),
  };
}
