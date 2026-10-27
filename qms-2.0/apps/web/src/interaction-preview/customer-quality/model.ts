import { readXlsxFile } from '../../features/imports/read-xlsx';

// All values and policies here belong to this memory preview, not the API contract.
export const fields = [
  ['客户', 'customer'], ['类型', 'kind'], ['组件号', 'component'], ['质量工程师', 'engineer'],
  ['服务方式', 'service'], ['拦截状态', 'interception'], ['发生日期', 'occurred'],
  ['发生地点', 'place'], ['发生区域', 'area'], ['生产日期', 'produced'], ['上线日期', 'online'],
  ['车辆交付或下线日期', 'delivered'], ['购车日期', 'purchased'], ['追溯码', 'trace'],
  ['VIN', 'vin'], ['里程', 'mileage'], ['数量', 'quantity'], ['详细故障描述', 'description'],
] as const;
export type Raw = Record<string, string>;
export type Issue = { field: string; original: string; reason: string };
export type Fact = {
  id: string; raw: Raw; state: '跟进中' | '已关闭'; engineer: string;
  engineerSource: '人工指定' | '映射带出' | '待指定'; fae: string; faeText: string;
  sqe: string; sqeText: string; tracking: string; received: string;
  history: string[]; links: string[]; demoDerived?: string;
};
export const services = ['远程指导', '现场现调', '未接到通知'];
export const interceptions = ['是，已发备件', '否，索赔件', '否，不索赔'];
export const engineers = ['演示工程师林', '演示工程师周', '演示项目工程师许'];
export const faes = ['演示FAE陈', '演示FAE吴'];
export const sqes = ['演示SQE宋', '演示SQE郑'];
export type Mapping = { project: string; category: string; segment: string; phase: string; engineer: string };
export const mappings: Record<string, Mapping> = {
  'C-100': { project: '演示项目 A', category: '电驱', segment: '控制器', phase: '新品', engineer: engineers[2] },
  'C-200': { project: '演示项目 B', category: '电源', segment: '转换器', phase: '量产', engineer: engineers[0] },
};
export function blank(): Raw { return Object.fromEntries(fields.map(([, key]) => [key, ''])); }

export function parseSheet(sheet: readonly (readonly unknown[])[]): Raw[] {
  if (!sheet.length) throw new Error('没有可预览的内容');
  const text = (value: unknown): string => {
    if (value == null) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new Error('单元格请使用文本、数字或日期，不支持公式 / 富文本');
    const result = String(value);
    if (result.length > 2000) throw new Error('单元格超过内存预览 2000 字符上限');
    return result;
  };
  const headers = Array.from(sheet[0], text);
  if (!headers.length || headers.some(header => !header)) throw new Error('列名不能为空');
  if (new Set(headers).size !== headers.length) throw new Error('重复列名，请先消除歧义');
  const keys = headers.map(header => {
    const field = fields.find(([label]) => label === header);
    if (!field) throw new Error(`不支持的列：${header}`);
    return field[1];
  });
  const rows = Array.from(sheet.slice(1)).flatMap((cells, index) => {
    const values = Array.from(cells ?? [], text);
    if (values.length > keys.length) throw new Error('存在没有对应列名的数据');
    if (values.every(value => !value.trim())) return [];
    return [{ ...blank(), sourceRow: String(index + 2), ...Object.fromEntries(keys.map((key, index) => [key, values[index] ?? ''])) }];
  });
  if (rows.length > 100) throw new Error('内存预览最多 100 条数据行');
  return rows;
}

export function inspect(raw: Raw): Issue[] {
  const issues: Issue[] = [];
  const add = (key: string, reason: string) => issues.push({ field: fields.find(([, field]) => field === key)![0], original: raw[key], reason });
  for (const [key, options] of [['kind', ['零公里', '售后']], ['service', services], ['interception', interceptions]] as const) {
    if (raw[key] && !options.some(option => option === raw[key])) add(key, '未知选项，保留原文待补正');
  }
  if (raw.quantity && (!/^\d+$/.test(raw.quantity) || !Number.isSafeInteger(Number(raw.quantity)) || Number(raw.quantity) <= 0)) add('quantity', '不是有效正整数，规范数量暂空');
  if (raw.mileage && (!/^\d+(\.\d+)?$/.test(raw.mileage) || !Number.isFinite(Number(raw.mileage)))) add('mileage', '不是有效非负里程，不分档');
  // Native date-input validity only; calendar/MIS/mileage policies remain in the shared API unit.
  for (const key of ['occurred', 'produced', 'online', 'delivered', 'purchased']) {
    if (!raw[key]) continue;
    const input = document.createElement('input');
    input.type = 'date'; input.value = raw[key];
    if (!input.value) add(key, '日期原文无效，规范日期暂空，不参与计算');
  }
  return issues;
}

export function supplementChanges(before: Raw, incoming: Raw) {
  return fields.filter(([, key]) => key !== 'engineer' && incoming[key]?.trim() && before[key] !== incoming[key])
    .map(([label, key]) => ({ key, label, before: before[key], after: incoming[key] }));
}

export async function readPreviewExcel(file: File): Promise<Raw[]> {
  // Count meaningful rows locally; the reader still bounds physical rows and ZIP size.
  return parseSheet(await readXlsxFile(file, { mode: 'master-data' }));
}

export function createFact(raw: Raw, id: string, map: Record<string, Mapping>): Fact {
  const engineer = raw.engineer || map[raw.component]?.engineer || '';
  return { id, raw: { ...raw }, state: '跟进中', engineer, engineerSource: raw.engineer ? '人工指定' : engineer ? '映射带出' : '待指定',
    fae: '', faeText: '', sqe: '', sqeText: '', tracking: '', received: '', history: [], links: [] };
}

export function initialFacts(): Fact[] {
  return [
    { ...createFact({ ...blank(), customer: '演示客户甲', kind: '售后', component: 'C-200', engineer: engineers[0], quantity: '3', service: '远程指导', interception: '否，索赔件', occurred: '2026-10-20', produced: '2026-08-01', delivered: '2026-08-10', mileage: '3200', trace: 'TRACE-DEMO-01', description: '演示连接间歇异常，三件汇总，里程仅为描述原文' }, 'CQ-DEMO-001', mappings), fae: faes[0], faeText: '演示：检查连接端子，待复核。', links: ['8D-DEMO-018 · 审核中'], demoDerived: '多件汇总 · 不以单车代表整批；3MIS 仅固定演示标签' },
    { ...createFact({ ...blank(), customer: '演示客户乙', kind: '零公里', component: 'C-100', quantity: '1', online: '2026-10-22', produced: '2026-10-15', trace: 'TRACE-DEMO-02', description: '演示上线检查发现异响' }, 'CQ-DEMO-002', mappings) },
    { ...createFact({ ...blank(), customer: '演示客户甲', kind: '售后', component: 'C-404', engineer: engineers[1], quantity: '', trace: 'TRACE-DEMO-03', description: '演示历史待补资料，缺少组件映射' }, 'CQ-DEMO-003', mappings), state: '已关闭', history: ['2026-10-23（固定演示） · 演示工程师周 · 已关闭：演示历史调查结论'] },
  ];
}
