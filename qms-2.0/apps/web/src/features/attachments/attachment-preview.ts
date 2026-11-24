import { inflateZipEntry, readXlsxPreview } from '../imports/read-xlsx';
import { attachmentDownload, type Attachment } from './attachments';

const maxAttachmentSize = 25 * 1024 * 1024;
const maxWordXmlSize = 8 * 1024 * 1024;
const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const excelType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const wordNamespaces = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];

export type Preview = { kind: 'image' | 'pdf'; blob: Blob } | { kind: 'text' | 'word'; text: string; truncated: boolean }
  | { kind: 'sheet'; rows: string[][]; truncated: boolean };

export const canDownloadAttachment = (file: Attachment) => file.status === 'AVAILABLE' && file.scanStatus === 'CLEAN';
export const canPreviewAttachment = (file: Attachment) => canDownloadAttachment(file) &&
  ['image/png', 'image/jpeg', 'application/pdf', 'text/plain', wordType, excelType].includes(file.contentType);

async function verifiedBytes(file: Attachment, signal: AbortSignal) {
  if (!canPreviewAttachment(file) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > maxAttachmentSize || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('PREVIEW_METADATA_INVALID');
  const url = await attachmentDownload(file.id, signal);
  const response = await fetch(url, { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error' });
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (!response.ok || (mime !== file.contentType && mime !== 'application/octet-stream') || Number(response.headers.get('content-length')) > file.sizeBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('PREVIEW_RESPONSE_INVALID');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PREVIEW_RESPONSE_INVALID');
  const bytes = new Uint8Array(file.sizeBytes);
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const result = await reader.read();
      if (result.done) break;
      if (length + result.value.byteLength > bytes.length) throw new Error('PREVIEW_SIZE_MISMATCH');
      bytes.set(result.value, length);
      length += result.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (length !== bytes.length) throw new Error('PREVIEW_SIZE_MISMATCH');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  signal.throwIfAborted();
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== file.sha256) throw new Error('PREVIEW_HASH_MISMATCH');
  return bytes;
}

async function wordXml(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) {
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let end = bytes.length - 22; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) !== 0x06054b50 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) continue;
    const count = view.getUint16(end + 10, true);
    const directoryOffset = view.getUint32(end + 16, true);
    const directoryEnd = directoryOffset + view.getUint32(end + 12, true);
    if (view.getUint32(end + 4, true) !== 0 || count > 2048 || directoryEnd > end) break;
    let entry = directoryOffset;
    for (let index = 0; index < count && entry + 46 <= directoryEnd; index++) {
      if (view.getUint32(entry, true) !== 0x02014b50) break;
      const nameLength = view.getUint16(entry + 28, true);
      const next = entry + 46 + nameLength + view.getUint16(entry + 30, true) + view.getUint16(entry + 32, true);
      if (next > directoryEnd) break;
      if (decoder.decode(bytes.subarray(entry + 46, entry + 46 + nameLength)) === 'word/document.xml') {
        const method = view.getUint16(entry + 10, true);
        const compressed = view.getUint32(entry + 20, true);
        const size = view.getUint32(entry + 24, true);
        const local = view.getUint32(entry + 42, true);
        if (view.getUint16(entry + 8, true) & 1 || ![0, 8].includes(method) || size > maxWordXmlSize || local + 30 > directoryOffset || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method) break;
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (start + compressed > directoryOffset) break;
        const data = bytes.subarray(start, start + compressed);
        if (method === 0 && data.length === size) return decoder.decode(data);
        if (method !== 8) break;
        const xml = new Uint8Array(size);
        const length = await inflateZipEntry(data, size, 4 * 1024, xml, signal);
        if (length === size) return decoder.decode(xml);
        break;
      }
      entry = next;
    }
    break;
  }
  throw new Error('PREVIEW_DOCX_INVALID');
}

function textPreview(kind: 'text' | 'word', value: string): Preview {
  const limit = 200_000;
  return { kind, text: value.slice(0, limit), truncated: value.length > limit };
}

function wordText(xml: string) {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('PREVIEW_DOCX_INVALID');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const namespace = document.documentElement.namespaceURI;
  if (!namespace || !wordNamespaces.includes(namespace) || document.documentElement.localName !== 'document' || document.querySelector('parsererror')) throw new Error('PREVIEW_DOCX_INVALID');
  const body = document.getElementsByTagNameNS(namespace, 'body')[0];
  if (!body) throw new Error('PREVIEW_DOCX_INVALID');
  const elements = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  const parts: string[] = [];
  let hasParagraph = false;
  for (let element = elements.nextNode() as Element | null; element; element = elements.nextNode() as Element | null) {
    if (element.namespaceURI !== namespace) continue;
    switch (element.localName) {
      case 'p':
        if (hasParagraph) parts.push('\n');
        hasParagraph = true;
        break;
      case 't': parts.push(element.firstChild?.nodeValue ?? ''); break;
      case 'tab': parts.push('\t'); break;
      case 'br':
      case 'cr': parts.push('\n'); break;
    }
  }
  return parts.join('');
}

export async function readAttachmentPreview(file: Attachment, signal: AbortSignal): Promise<Preview> {
  const bytes = await verifiedBytes(file, signal);
  if (file.contentType === 'text/plain') return textPreview('text', new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (file.contentType === wordType) return textPreview('word', wordText(await wordXml(bytes, signal)));
  if (file.contentType === excelType) {
    return { kind: 'sheet', ...await readXlsxPreview(bytes.buffer, signal) };
  }
  const signatures: Record<string, number[]> = { 'image/png': [137, 80, 78, 71, 13, 10, 26, 10], 'image/jpeg': [255, 216, 255], 'application/pdf': [37, 80, 68, 70, 45] };
  if (!signatures[file.contentType]?.every((byte, index) => bytes[index] === byte)) throw new Error('PREVIEW_SIGNATURE_INVALID');
  return { kind: file.contentType === 'application/pdf' ? 'pdf' : 'image', blob: new Blob([bytes], { type: file.contentType }) };
}
