import type { components } from '@qms/contracts';
import { MasterDataImport } from '../imports/MasterDataImport';

type ImportBody = components['schemas']['MaterialMasterImportDto'];
type Props = { organizationId?: string; onImported: () => void | Promise<void> };
const headers = ['物料编码', '物料名称'];

export function parseMaterialMasterRows(sheet: readonly (readonly unknown[])[], t = (text: string) => text): ImportBody['rows'] {
  const columns = Array.from(sheet[0] ?? [], (cell) => typeof cell === 'string' ? headers.find((header) => header === cell.trim() || t(header) === cell.trim()) ?? '' : '');
  if (columns.length !== 2 || headers.some((header) => !columns.includes(header))) throw new Error(t('表头必须且只能包含物料编码、物料名称'));
  const rows: ImportBody['rows'] = [];
  for (let index = 1; index < sheet.length; index++) {
    const cells = sheet[index] ?? [];
    if (cells.every((cell) => cell == null || cell === '')) continue;
    const code = cells[columns.indexOf(headers[0]!)];
    const name = cells[columns.indexOf(headers[1]!)];
    if (cells.some((cell, column) => (column > 1 && cell != null && cell !== '') || (cell != null && typeof cell === 'object'))) throw new Error(t('第 {row} 行：不支持公式或额外数据列').replace('{row}', String(index + 1)));
    rows.push({ rowNumber: index + 1, materialCode: typeof code === 'string' ? code.trim() : '', materialName: typeof name === 'string' ? name.trim() : '' });
  }
  if (!rows.length) throw new Error(t('至少需要一条非空数据行'));
  return rows;
}

export function MaterialMasterImport(props: Props) {
  return <MasterDataImport {...props} domain="物料" endpoint="/api/v1/material-masters/import" headers={headers} fields={['materialCode', 'materialName']} parse={parseMaterialMasterRows} rule="重复编码跳过；编码用文本保留前导 0。" />;
}
