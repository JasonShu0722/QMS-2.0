import { Inject, Injectable, Optional } from '@nestjs/common';
import { workflowError } from '../workflow/workflow-runtime-policy.js';

export interface FilePolicyOptions {
  allowedMimeTypes?: string[];
  maxBytes?: number;
  maxFiles?: number;
}

export interface FileCandidate {
  contentType: string;
  sizeBytes: number;
}

export const FILE_POLICY_OPTIONS = 'QMS_FILE_POLICY_OPTIONS';

const DEFAULT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/plain',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

@Injectable()
export class FilePolicyService {
  private readonly allowedMimeTypes: Set<string>;
  readonly maxBytes: number;
  readonly maxFiles: number;

  constructor(@Optional() @Inject(FILE_POLICY_OPTIONS) options: FilePolicyOptions = {}) {
    this.allowedMimeTypes = new Set(options.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES);
    this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 10;
  }

  assertBatch(files: FileCandidate[]): void {
    if (files.length > this.maxFiles) workflowError('FILE_COUNT_EXCEEDED', 400);
    for (const file of files) this.assertOne(file);
  }

  assertOne(file: FileCandidate): void {
    if (!this.allowedMimeTypes.has(file.contentType)) workflowError('FILE_MIME_NOT_ALLOWED', 400);
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes > this.maxBytes) workflowError('FILE_TOO_LARGE', 400);
    if (file.sizeBytes < 1) workflowError('FILE_EMPTY', 400);
  }
}
