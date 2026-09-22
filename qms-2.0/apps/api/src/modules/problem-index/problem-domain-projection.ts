import { isUUID } from 'class-validator';
import type { ProblemDomainSection, ProblemDomainSummary, ProblemDomainWorkspace } from './problem-domain-registry.js';

export function domainText(value: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) throw new Error('PROBLEM_DOMAIN_RESPONSE_INVALID');
  return value;
}
export function domainKey(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9._:-]{0,99}$/.test(value)) throw new Error('PROBLEM_DOMAIN_RESPONSE_INVALID');
  return value;
}
export function summaryProjection(summary: ProblemDomainSummary): ProblemDomainSummary {
  return { title: domainText(summary.title, 200), description: domainText(summary.description, 10000), domainUiKey: domainKey(summary.domainUiKey) };
}
export function sectionProjection(sections: ProblemDomainSection[]): ProblemDomainSection[] {
  if (!Array.isArray(sections) || sections.length > 30 || new Set(sections.map((section) => section.key)).size !== sections.length) throw new Error('PROBLEM_DOMAIN_RESPONSE_INVALID');
  return sections.map((section) => {
    if (!Array.isArray(section.fields) || section.fields.length > 50 || new Set(section.fields.map((field) => field.key)).size !== section.fields.length) throw new Error('PROBLEM_DOMAIN_RESPONSE_INVALID');
    return { key: domainKey(section.key), title: domainText(section.title, 200), fields: section.fields.map((field) => ({ key: domainKey(field.key), label: domainText(field.label, 200), value: field.value === null ? null : domainText(field.value, 20000) })) };
  });
}
export function workspaceProjection(domain: ProblemDomainWorkspace): ProblemDomainWorkspace {
  if (!Number.isSafeInteger(domain.domainVersion) || domain.domainVersion < 1 || domain.revisionId !== null && !isUUID(domain.revisionId)) throw new Error('PROBLEM_DOMAIN_RESPONSE_INVALID');
  return { domainVersion: domain.domainVersion, revisionId: domain.revisionId, summary: summaryProjection(domain.summary), sections: sectionProjection(domain.sections) };
}
