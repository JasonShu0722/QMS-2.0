import { HttpException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { parseComplaintDate } from './customer-complaint-derived.js';

export const ANALYSIS_RESOURCE_TYPE = 'customer-complaint-analysis';
export const ANALYSIS_PERMISSIONS = { FAE: 'customer-quality:analyses:fae', SUPPLIER: 'customer-quality:analyses:supplier' } as const;
export type AnalysisSection = keyof typeof ANALYSIS_PERMISSIONS;
export type FaeAnalysisStatus = 'NOT_ANALYSED' | 'ANALYSED';
export interface AnalysisContentInput {
  text?: string | null; progress?: string | null; result?: string | null;
  completedOn?: string | null; failedPart?: string | null; failedMaterialCode?: string | null;
  supplierAnalysisRequired?: boolean | null; fileIds?: string[];
}
export interface AnalysisContent {
  text: string | null; progress: string | null; result: string | null; completedOn: string | null;
  failedPart: string | null; failedMaterialCode: string | null; supplierAnalysisRequired: boolean | null; fileIds: string[];
}
export interface AnalysisSnapshot extends AnalysisContent {
  id: string; organizationId: string; complaintId: string; section: AnalysisSection; version: number;
  assigneeUserId: string; assigneeAssignmentId: string; departmentId: string;
  faeStatus: FaeAnalysisStatus | null; updatedByUserId: string; updatedAt: string;
}
export interface AnalysisAssignmentInput { expectedVersion: number; assigneeUserId: string; assigneeAssignmentId: string }
export interface AnalysisSaveInput extends AnalysisContentInput { expectedVersion: number }
export function analysisFail(code: string, status = 400): never { throw new HttpException({ code, message: code }, status); }
export function faeAnalysisStatus(text: string | null, files: number): FaeAnalysisStatus { return text?.trim() || files > 0 ? 'ANALYSED' : 'NOT_ANALYSED'; }
export function analysisContent(input: AnalysisContentInput, section: AnalysisSection): AnalysisContent {
  const allowed = section === 'FAE' ? ['text', 'completedOn', 'failedPart', 'failedMaterialCode', 'supplierAnalysisRequired', 'fileIds', 'expectedVersion'] : ['progress', 'result', 'fileIds', 'expectedVersion'];
  if (Object.keys(input).some(key => !allowed.includes(key))) analysisFail('CUSTOMER_ANALYSIS_INPUT_INVALID');
  const text = (value: unknown, max = 10000): string | null => {
    if (value == null) return null;
    if (typeof value !== 'string' || value.length > max || value.includes('\u0000')) analysisFail('CUSTOMER_ANALYSIS_INPUT_INVALID');
    return value.trim() || null;
  };
  const completedOn = text(input.completedOn, 10);
  if (completedOn && !parseComplaintDate(completedOn)) analysisFail('CUSTOMER_ANALYSIS_DATE_INVALID');
  if (input.supplierAnalysisRequired != null && typeof input.supplierAnalysisRequired !== 'boolean') analysisFail('CUSTOMER_ANALYSIS_INPUT_INVALID');
  const fileIds = input.fileIds ?? [];
  if (!Array.isArray(fileIds) || fileIds.length > 20 || new Set(fileIds).size !== fileIds.length || fileIds.some(id => typeof id !== 'string' || !isUUID(id))) analysisFail('CUSTOMER_ANALYSIS_INPUT_INVALID');
  return { text: text(input.text), progress: text(input.progress), result: text(input.result), completedOn,
    failedPart: text(input.failedPart, 200), failedMaterialCode: text(input.failedMaterialCode, 200), supplierAnalysisRequired: input.supplierAnalysisRequired ?? null, fileIds };
}
export function assertAnalysisWriter(actor: string, assigned: string, valid: boolean, status: string): void {
  if (actor !== assigned || !valid) analysisFail('CUSTOMER_ANALYSIS_ASSIGNEE_REQUIRED', 403);
  if (status !== 'FOLLOWING') analysisFail('CUSTOMER_ANALYSIS_SOURCE_CLOSED', 409);
}
export function assertAnalysisTransfer(section: AnalysisSection, department: string, target: string): void {
  if (section !== 'FAE' || department !== target) analysisFail('CUSTOMER_ANALYSIS_TRANSFER_DENIED', 403);
}
