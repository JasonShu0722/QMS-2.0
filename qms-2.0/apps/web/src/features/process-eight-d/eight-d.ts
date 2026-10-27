import type { components } from '@qms/contracts';
import { theme } from 'antd';
import type { CSSProperties } from 'react';
import { useLanguage } from '../../i18n/Language';
import { eightDDomain, type InternalEightDDomain } from '../internal-eight-d/domain';
import type { InternalEightDReport } from '../internal-eight-d/source-picker';

export type EightDReport = components['schemas']['ProcessEightDReportDto'] | InternalEightDReport;
export type EightDDocument = components['schemas']['ProcessEightDDocumentDto'];
export type EightDFields = components['schemas']['ErrorResponse']['fields'];
export type EightDRead = <T>(path: string, init?: RequestInit) => Promise<T>;
export type EightDWriteBody = components['schemas']['SaveProcessEightDDto']
  | components['schemas']['ProcessEightDVersionDto'] | components['schemas']['ProcessEightDAnalysisCompleteDto']
  | components['schemas']['ProcessEightDCollaboratorsDto'] | components['schemas']['ReassignProcessEightDDto']
  | components['schemas']['ProcessEightDRiskDto'] | components['schemas']['ProcessEightDSourcesDto']
  | components['schemas']['ProcessEightDDeadlinesDto'] | components['schemas']['RequestWorkflowDeadlineExtensionDto']
  | components['schemas']['CustomerEightDSourcesDto'] | components['schemas']['NewProductEightDSourcesDto'];
export type EightDWrite = (path: string, method: 'PUT' | 'POST', body: EightDWriteBody) => Promise<boolean>;
export const eightDPath = (id: string, domain: InternalEightDDomain = 'process') => `${eightDDomain(domain).basePath}/${encodeURIComponent(id)}`;
export const extensionPath = (id: string) => `/api/v1/workflow-deadline-extensions/problems/${encodeURIComponent(id)}/requests`;
export const roundPath = (id: string) => `/api/v1/workflow-closure/problems/${encodeURIComponent(id)}/rounds`;
const fieldSections: Record<keyof EightDDocument, string> = {
  description: 'D2', okFileIds: 'D2', ngFileIds: 'D2', temporaryMeasures: 'D3', containment: 'D3', optionalAffectedContainment: 'D3',
  analysisProcess: 'D4', analysisFileIds: 'D4', occurrenceCause: 'D4', escapeCause: 'D4', systemCause: 'D4', correctiveActions: 'D5-D6',
  horizontalDeployment: 'D7', standardization: 'D7', closureSummary: 'D8',
};
// Only map server-returned paths to existing UI regions; this is not a client validation policy.
export function eightDFieldLocation(path: string) {
  const match = /^(?:document\.)?([a-zA-Z]+)(?:\[(\d+)\]|\.(\d+))?(?:\.|$)/.exec(path);
  if (!match || !Object.hasOwn(fieldSections, match[1])) return undefined;
  const index = match[2] ?? match[3];
  return { section: fieldSections[match[1] as keyof EightDDocument], row: index === undefined ? undefined : `${match[1]}[${index}]` };
}
export function useEightDText() {
  const { t, locale } = useLanguage();
  return (zh: string, en: string) => locale === 'en-US' ? en : t(zh);
}
export function useEightDSeverityText() {
  const text = useEightDText();
  const labels: Record<EightDReport['severity'], string> = {
    LOW: text('低风险', 'Low risk'), MEDIUM: text('中风险', 'Medium risk'),
    HIGH: text('高风险', 'High risk'), CRITICAL: text('重大风险', 'Critical risk'),
  };
  return (severity: EightDReport['severity']) => Object.hasOwn(labels, severity) ? labels[severity] : severity;
}
export const aborted = (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError';
export function useEightDStyle(): CSSProperties {
  const { token } = theme.useToken();
  return { '--ed-bg': token.colorBgContainer, '--ed-input': token.colorBgContainer, '--ed-text': token.colorText, '--ed-primary': token.colorPrimary, '--ed-border': token.colorBorderSecondary, '--ed-fill': token.colorFillAlter } as CSSProperties;
}
