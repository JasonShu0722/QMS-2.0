import type { components } from '@qms/contracts';
import type { ApiError } from '../../api/client';
import { MasterDataImport } from '../imports/MasterDataImport';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';

type ImportBody = components['schemas']['ComponentProjectImportDto'];
type Props = { organizationId?: string; onImported: () => void | Promise<void>; onUnauthorized?: (cause: ApiError) => void };
const headers = ['组件号', '组件名称'];
const codeHeaders = new Set(['组件号', 'PROD_ID', '成品编码']);
const nameHeaders = new Set(['组件名称', 'MTRL_NAME', '物料名称']);

function column(cell: unknown, t: (text: string) => string) {
  if (typeof cell !== 'string') return undefined;
  if (cell.trim() === t(headers[0]!)) return 'componentCode';
  if (cell.trim() === t(headers[1]!)) return 'componentName';
  const lines = cell.trim().split(/\r?\n/).map(line => line.trim());
  if (lines.length > 2) return undefined;
  if (lines.every(line => codeHeaders.has(line))) return 'componentCode';
  if (lines.every(line => nameHeaders.has(line))) return 'componentName';
  return undefined;
}

export function parseComponentProjectRows(sheet: readonly (readonly unknown[])[], t = (text: string) => text): ImportBody['rows'] {
  const columns = Array.from(sheet[0] ?? [], cell => column(cell, t));
  if (columns.length !== 2 || !columns.includes('componentCode') || !columns.includes('componentName')) throw new Error(t('表头必须且只能包含组件号、组件名称或对应的规定别名'));
  const first = Array.from(sheet[0] ?? [], cell => typeof cell === 'string' ? cell.trim() : '');
  const second = Array.from(sheet[1] ?? [], cell => typeof cell === 'string' ? cell.trim() : '');
  const english = columns.map(key => key === 'componentCode' ? 'PROD_ID' : 'MTRL_NAME');
  const chinese = columns.map(key => key === 'componentCode' ? '成品编码' : '物料名称');
  // Only the immediate complementary English/Chinese header is skipped, never alias-like data under a standard header.
  const paired = first.length === 2 && second.length === 2 && (
    first.every((cell, index) => cell === english[index]) && second.every((cell, index) => cell === chinese[index]) ||
    first.every((cell, index) => cell === chinese[index]) && second.every((cell, index) => cell === english[index])
  );
  const rows: ImportBody['rows'] = [];
  for (let index = paired ? 2 : 1; index < sheet.length; index++) {
    const cells = sheet[index] ?? [];
    if (cells.every(cell => cell == null || typeof cell === 'string' && !cell.trim())) continue;
    if (cells.some((cell, index) => cell != null && (typeof cell === 'object' || index > 1 && (typeof cell !== 'string' || !!cell.trim())))) throw new Error(t('第 {row} 行：不支持公式、对象或额外数据列').replace('{row}', String(index + 1)));
    const code = cells[columns.indexOf('componentCode')];
    const name = cells[columns.indexOf('componentName')];
    rows.push({ rowNumber: index + 1, componentCode: typeof code === 'string' ? code.trim() : '', componentName: typeof name === 'string' ? name.trim() : '' });
  }
  if (!rows.length) throw new Error(t('至少需要一条非空数据行'));
  return rows;
}

export function ComponentProjectImport(props: Props) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <MasterDataImport key={JSON.stringify([session, props.organizationId])} {...props} domain="组件"
    endpoint="/api/v1/admin/configuration/component-project-mappings/import" headers={headers} fields={['componentCode', 'componentName']}
    parse={parseComponentProjectRows} rule="只新增组件号和组件名称；重复组件号跳过，不覆盖名称或映射。组件号请使用文本保留前导 0，项目及分类可稍后完善。" />;
}
