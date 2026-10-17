async function checkZipSize(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const start = Math.max(0, bytes.length - 65557);
  let directoryEnd = -1;
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { directoryEnd = offset; break; }
  }
  if (directoryEnd < 0) throw new Error('Excel ZIP 结构无效');
  const count = view.getUint16(directoryEnd + 10, true);
  const directorySize = view.getUint32(directoryEnd + 12, true);
  let offset = view.getUint32(directoryEnd + 16, true);
  if (view.getUint16(directoryEnd + 4, true) !== 0 || view.getUint16(directoryEnd + 6, true) !== 0 || count > 100 || directorySize === 0xffffffff || offset === 0xffffffff || offset + directorySize > directoryEnd) throw new Error('Excel ZIP 结构无效');
  const end = offset + directorySize;
  let totalSize = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Excel ZIP 结构无效');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const localOffset = view.getUint32(offset + 42, true);
    const length = 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    if (flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff || offset + length > end || localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Excel ZIP 结构无效');
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (view.getUint16(localOffset + 8, true) !== method || dataStart + compressed > end) throw new Error('Excel ZIP 结构无效');
    totalSize += uncompressed;
    if (uncompressed > 4 * 1024 * 1024 || totalSize > 8 * 1024 * 1024 || (uncompressed > 0 && compressed === 0) || (compressed > 0 && uncompressed / compressed > 200)) throw new Error('Excel 解压后内容过大');
    let actualSize = compressed;
    if (method === 8) {
      actualSize = 0;
      const data = bytes.subarray(dataStart, dataStart + compressed);
      let position = 0;
      const source = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (position === data.length) { controller.close(); return; }
          const next = Math.min(position + 64 * 1024, data.length);
          controller.enqueue(data.subarray(position, next));
          position = next;
        },
      });
      const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          actualSize += value.byteLength;
          if (actualSize > 4 * 1024 * 1024 || totalSize - uncompressed + actualSize > 8 * 1024 * 1024) throw new Error('Excel 解压后内容过大');
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Excel 解压后内容过大') throw error;
        throw new Error('Excel ZIP 结构无效');
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }
    if (actualSize !== uncompressed) throw new Error('Excel ZIP 结构无效');
    offset += length;
  }
  if (offset !== end) throw new Error('Excel ZIP 结构无效');
}

export async function readXlsxFile(file: File): Promise<unknown[][]> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('仅支持 .xlsx 文件');
  if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB');
  const buffer = await file.arrayBuffer();
  await checkZipSize(buffer);
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
  catch { throw new Error('Excel 文件无法解析，请检查文件格式'); }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Excel 文件没有工作表');
  if (workbook.worksheets.length > 10) throw new Error('工作表不能超过 10 个');
  const sheet: unknown[][] = [];
  let dataRows = 0;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber > 10000) throw new Error('数据行号不能超过 10000');
    if (rowNumber > 1 && ++dataRows > 100) throw new Error('每次最多 100 条数据行');
    const cells: unknown[] = [];
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (columnNumber > 100) throw new Error('列号不能超过 100');
      cells[columnNumber - 1] = cell.value;
    });
    sheet[rowNumber - 1] = cells;
  });
  return sheet;
}
