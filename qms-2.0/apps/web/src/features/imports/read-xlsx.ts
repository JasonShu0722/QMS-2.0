const invalidZip = 'Excel ZIP 结构无效';
const oversizedZip = 'Excel 解压后内容过大';
const invalidWorkbook = 'Excel 文件无法解析，请检查文件格式';
const mib = 1024 * 1024;

type ZipEntry = { name: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer>; method: number; uncompressed: number };

function* zipEntries(buffer: ArrayBuffer, maxEntries: number, preview = false): Generator<ZipEntry> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const start = Math.max(0, bytes.length - 65557);
  let directoryEnd = -1;
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { directoryEnd = offset; break; }
  }
  if (directoryEnd < 0) throw new Error(invalidZip);
  const count = view.getUint16(directoryEnd + 10, true);
  const directorySize = view.getUint32(directoryEnd + 12, true);
  let offset = view.getUint32(directoryEnd + 16, true);
  if (view.getUint16(directoryEnd + 4, true) !== 0 || view.getUint16(directoryEnd + 6, true) !== 0 || count > maxEntries || directorySize === 0xffffffff || offset === 0xffffffff || offset + directorySize > directoryEnd) throw new Error(invalidZip);
  const directoryStart = offset;
  const end = offset + directorySize;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error(invalidZip);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameLength = view.getUint16(offset + 28, true);
    const length = 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff || offset + length > end || localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(invalidZip);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const dataStart = localOffset + 30 + localNameLength + view.getUint16(localOffset + 28, true);
    if (view.getUint16(localOffset + 8, true) !== method || dataStart + compressed > (preview ? directoryStart : end)) throw new Error(invalidZip);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength);
    if (preview && (localNameLength !== nameLength || view.getUint16(localOffset + 6, true) !== flags ||
      !name.every((byte, index) => byte === bytes[localOffset + 30 + index]))) throw new Error(invalidZip);
    yield { name, method, uncompressed, data: bytes.subarray(dataStart, dataStart + compressed) };
    offset += length;
  }
  if (offset !== end) throw new Error(invalidZip);
}

export async function inflateZipEntry(data: Uint8Array<ArrayBuffer>, limit: number, chunkSize: number, destination?: Uint8Array<ArrayBuffer>, signal?: AbortSignal) {
  let position = 0;
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (position === data.length) { controller.close(); return; }
      const next = Math.min(position + chunkSize, data.length);
      controller.enqueue(data.subarray(position, next));
      position = next;
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > limit) throw new Error(oversizedZip);
      destination?.set(value, size);
      size += value.byteLength;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.message === oversizedZip) throw error;
    throw new Error(invalidZip);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return size;
}

async function checkZipSize(buffer: ArrayBuffer) {
  let totalSize = 0;
  for (const { data, method, uncompressed } of zipEntries(buffer, 100)) {
    const compressed = data.length;
    totalSize += uncompressed;
    if (uncompressed > 4 * mib || totalSize > 8 * mib || (uncompressed > 0 && compressed === 0) || (compressed > 0 && uncompressed / compressed > 200)) throw new Error(oversizedZip);
    const actualSize = method === 8 ? await inflateZipEntry(data, Math.min(4 * mib, 8 * mib - totalSize + uncompressed), 64 * 1024) : compressed;
    if (actualSize !== uncompressed) throw new Error(invalidZip);
  }
}

export async function readXlsxFile(file: File, options?: { mode: 'master-data' }): Promise<unknown[][]> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('仅支持 .xlsx 文件');
  if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB');
  const buffer = await file.arrayBuffer();
  await checkZipSize(buffer);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
  catch { throw new Error(invalidWorkbook); }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Excel 文件没有工作表');
  if (workbook.worksheets.length > 10) throw new Error('工作表不能超过 10 个');
  const sheet: unknown[][] = [];
  let dataRows = 0;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > 10000) throw new Error('数据行号不能超过 10000');
    if (rowNumber > 1 && ++dataRows > 100 && options?.mode !== 'master-data') throw new Error('每次最多 100 条数据行');
    const cells: unknown[] = [];
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (columnNumber > 100) throw new Error('列号不能超过 100');
      cells[columnNumber - 1] = cell.value;
    });
    sheet[rowNumber - 1] = cells;
  });
  return sheet;
}

const sheetNamespaces = [
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
];
const relationshipNamespaces = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
];
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
const previewRowLimit = 200;
const previewColumnLimit = 30;
const previewCellLimit = 1_000;

function* children(parent: Element | undefined, name: string) {
  for (let child = parent?.firstElementChild; child; child = child.nextElementSibling) {
    if (child.localName === name && child.namespaceURI === parent?.namespaceURI) yield child;
  }
}

function firstChild(parent: Element | undefined, name: string) {
  const child = children(parent, name).next();
  return child.done ? undefined : child.value;
}

function relationshipPath(relationships: Element, type: string, id?: string) {
  for (const relationship of children(relationships, 'Relationship')) {
    if (id !== undefined && relationship.getAttribute('Id') !== id) continue;
    if (!relationshipNamespaces.some(namespace => relationship.getAttribute('Type') === `${namespace}/${type}`)) continue;
    const target = relationship.getAttribute('Target');
    if (!target || relationship.getAttribute('TargetMode') === 'External') throw new Error(invalidWorkbook);
    const base = new URL('https://xlsx.invalid/xl/workbook.xml');
    const url = new URL(target, base);
    if (url.origin !== base.origin || url.search || url.hash) throw new Error(invalidWorkbook);
    return decodeURIComponent(url.pathname.slice(1));
  }
  return undefined;
}

function stringParts(element: Element | undefined) {
  const inline = firstChild(element, 't');
  if (inline) return inline.textContent ?? '';
  let text = '';
  for (const run of children(element, 'r')) {
    text += firstChild(run, 't')?.textContent ?? '';
    if (text.length > previewCellLimit) break;
  }
  return text;
}

export async function readXlsxPreview(buffer: ArrayBuffer, signal?: AbortSignal): Promise<{ rows: string[][]; truncated: boolean }> {
  signal?.throwIfAborted();
  if (buffer.byteLength > 25 * mib) throw new Error('文件不能超过 25 MiB');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts = new Map<string, ZipEntry>();
  for (const entry of zipEntries(buffer, 2048, true)) {
    const name = decoder.decode(entry.name);
    if (parts.has(name)) throw new Error(invalidZip);
    parts.set(name, entry);
  }

  let expandedSize = 0;
  async function readPart(path: string, root: string, namespaces: readonly string[]) {
    signal?.throwIfAborted();
    const entry = parts.get(path);
    if (!entry) throw new Error(invalidWorkbook);
    const { data, method, uncompressed } = entry;
    expandedSize += uncompressed;
    if (uncompressed > 8 * mib || expandedSize > 24 * mib) throw new Error(oversizedZip);
    const bytes = method === 0 ? data : new Uint8Array(uncompressed);
    const size = method === 0 ? data.length : await inflateZipEntry(data, uncompressed, 4 * 1024, bytes, signal);
    if (size !== uncompressed) throw new Error(invalidZip);
    const xml = decoder.decode(bytes);
    if (/<!DOCTYPE/i.test(xml)) throw new Error(invalidWorkbook);
    let markup = 0;
    for (let offset = xml.indexOf('<'); offset !== -1; offset = xml.indexOf('<', offset + 1)) {
      if (++markup > 300_000) throw new Error(oversizedZip);
    }
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const element = document.documentElement;
    if (element.localName !== root || !namespaces.includes(element.namespaceURI ?? '') || document.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror').length) throw new Error(invalidWorkbook);
    return element;
  }

  const workbook = await readPart('xl/workbook.xml', 'workbook', sheetNamespaces);
  const firstSheet = firstChild(firstChild(workbook, 'sheets'), 'sheet');
  if (!firstSheet) throw new Error('Excel 文件没有工作表');
  const id = relationshipNamespaces.map(namespace => firstSheet.getAttributeNS(namespace, 'id')).find(Boolean);
  if (!id) throw new Error(invalidWorkbook);
  const relationships = await readPart('xl/_rels/workbook.xml.rels', 'Relationships', [packageRelationships]);
  const sheetPath = relationshipPath(relationships, 'worksheet', id);
  if (!sheetPath) throw new Error(invalidWorkbook);
  const sheet = await readPart(sheetPath, 'worksheet', sheetNamespaces);
  const sharedPath = relationshipPath(relationships, 'sharedStrings');
  const shared = sharedPath ? await readPart(sharedPath, 'sst', sheetNamespaces) : undefined;
  const strings = shared ? Array.from(children(shared, 'si')) : [];
  const cachedStrings = new Map<number, string>();

  const rows: string[][] = [];
  let truncated = false;
  let rowNumber = 0;
  for (const row of children(firstChild(sheet, 'sheetData'), 'row')) {
    rowNumber = Number(row.getAttribute('r') ?? rowNumber + 1);
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || rowNumber > 1_048_576) throw new Error(invalidWorkbook);
    let column = 0;
    for (const cell of children(row, 'c')) {
      const address = cell.getAttribute('r');
      if (address === null) column += 1;
      else {
        const letters = /^([A-Z]{1,3})[1-9]\d{0,6}$/.exec(address)?.[1];
        if (!letters) throw new Error(invalidWorkbook);
        column = 0;
        for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
      }
      const value = firstChild(cell, 'v');
      const inline = firstChild(cell, 'is');
      if (!value && !inline && !firstChild(cell, 'f')) continue;
      if (rowNumber > previewRowLimit || column > previewColumnLimit) { truncated = true; continue; }

      let text = value?.textContent ?? '';
      switch (cell.getAttribute('t')) {
        case 's': {
          const index = Number(text);
          if (!/^\d+$/.test(text) || !strings[index]) throw new Error(invalidWorkbook);
          if (!cachedStrings.has(index)) cachedStrings.set(index, stringParts(strings[index]).slice(0, previewCellLimit + 1));
          text = cachedStrings.get(index)!;
          break;
        }
        case 'inlineStr': text = stringParts(inline); break;
        case 'b': text = text === '' ? '' : text === '1' ? 'true' : 'false'; break;
      }
      if (text.length > previewCellLimit) truncated = true;
      while (rows.length < rowNumber) rows.push([]);
      rows[rowNumber - 1]![column - 1] = text.slice(0, previewCellLimit);
    }
  }
  return { rows, truncated };
}
