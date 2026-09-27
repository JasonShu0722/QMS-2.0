import type { components } from '@qms/contracts';
import { apiRequest, csrfToken } from '../../api/client';

export type Attachment = components['schemas']['FileDto'];
export type FileResource = Pick<Attachment, 'resourceType' | 'resourceId'>;
type UploadReservation = components['schemas']['FileUploadDto'];
type UploadBody = components['schemas']['InitializeFileUploadDto'];
type MutationBody = components['schemas']['FileMutationDto'];

export function fileUrl(value: string) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('FILE_URL_INVALID');
  return url.href;
}

async function write<Result>(path: string, body?: UploadBody | MutationBody, key?: string, signal?: AbortSignal) {
  const token = await csrfToken();
  signal?.throwIfAborted();
  return apiRequest<Result>(path, { method: 'POST', signal, headers: { 'x-csrf-token': token, ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

export function createUploadAttempt(resource: FileResource, selected: File) {
  const initializeKey = crypto.randomUUID();
  const completeKey = crypto.randomUUID();
  let body: UploadBody | undefined;
  let reservation: UploadReservation | undefined;
  let uploaded = false;
  return {
    async run(observe?: (file: Attachment) => void, signal?: AbortSignal): Promise<Attachment> {
      if (selected.size < 1 || selected.size > 25 * 1024 * 1024) throw new Error('FILE_SIZE_INVALID');
      if (!body) {
        const digest = await crypto.subtle.digest('SHA-256', await selected.arrayBuffer());
        body = { ...resource, originalName: selected.name, contentType: selected.type || 'application/octet-stream', sizeBytes: selected.size,
          sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') };
      }
      signal?.throwIfAborted();
      if (!uploaded) {
        reservation = await write<UploadReservation>('/api/v1/files/uploads', body, initializeKey, signal);
        observe?.(reservation.file);
        const response = await fetch(fileUrl(reservation.uploadUrl), { method: 'PUT', headers: reservation.headers, body: selected, credentials: 'omit', referrerPolicy: 'no-referrer', signal });
        if (!response.ok && response.status !== 412) throw new Error('FILE_UPLOAD_FAILED');
        uploaded = true;
      }
      const result = await write<Attachment>(`/api/v1/files/${reservation!.file.id}/complete`, { expectedVersion: reservation!.file.version }, completeKey, signal);
      observe?.(result);
      return result;
    },
  };
}

export const readAttachment = (id: string, signal?: AbortSignal) => apiRequest<Attachment>(`/api/v1/files/${id}`, { signal });
export const deleteAttachment = (file: Attachment) => write<Attachment>(`/api/v1/files/${file.id}/delete`, { expectedVersion: file.version });
export const retryScanAttachment = (file: Attachment) => write<Attachment>(`/api/v1/files/${file.id}/retry-scan`, { expectedVersion: file.version }, crypto.randomUUID());
export async function attachmentDownload(id: string) {
  const result = await write<components['schemas']['FileDownloadDto']>(`/api/v1/files/${id}/download`);
  return fileUrl(result.url);
}
