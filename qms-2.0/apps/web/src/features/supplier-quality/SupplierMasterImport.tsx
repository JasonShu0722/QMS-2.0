import type { components } from '@qms/contracts';
import { MasterDataImport } from '../imports/MasterDataImport';

type ImportBody = components['schemas']['SupplierProfileImportDto'];
type Props = { organizationId?: string; onImported: () => void | Promise<void> };
const headers = ['供应商编码', '供应商名称', '联系人', '联系邮箱'];

export function parseSupplierMasterRows(sheet: readonly (readonly unknown[])[], t = (text: string) => text): ImportBody['rows'] {
  const columns = Array.from(sheet[0] ?? [], (cell) => typeof cell === 'string' ? headers.find((header) => header === cell.trim() || t(header) === cell.trim()) ?? '' : '');
  if (columns.length !== 4 || headers.some((header) => !columns.includes(header))) throw new Error(t('表头必须且只能包含供应商编码、供应商名称、联系人、联系邮箱'));
  const rows: ImportBody['rows'] = [];
  for (let index = 1; index < sheet.length; index++) {
    const cells = sheet[index] ?? [];
    if (cells.every((cell) => cell == null || cell === '')) continue;
    const code = cells[columns.indexOf(headers[0]!)];
    const name = cells[columns.indexOf(headers[1]!)];
    if (cells.some((cell, column) => (column > 3 && cell != null && cell !== '') || (cell != null && typeof cell === 'object'))) throw new Error(t('第 {row} 行：不支持公式或额外数据列').replace('{row}', String(index + 1)));
    const contact = cells[columns.indexOf(headers[2]!)];
    const email = cells[columns.indexOf(headers[3]!)];
    rows.push({ rowNumber: index + 1, businessCode: typeof code === 'string' ? code.trim() : '', displayName: typeof name === 'string' ? name.trim() : '', contactName: contact == null ? undefined : typeof contact === 'string' ? contact.trim() : String(contact), contactEmail: email == null ? undefined : typeof email === 'string' ? email.trim() : String(email) });
  }
  if (!rows.length) throw new Error(t('至少需要一条非空数据行'));
  return rows;
}

export function SupplierMasterImport(props: Props) {
  return <MasterDataImport {...props} domain="供应商" endpoint="/api/v1/supplier-quality/profiles/import" headers={headers} fields={['businessCode', 'displayName', 'contactName', 'contactEmail']} parse={parseSupplierMasterRows} rule="只新增供应商档案，不创建企业或账号；重复编码跳过，不覆盖名称或联系人。编码请使用文本保留前导 0。" />;
}
