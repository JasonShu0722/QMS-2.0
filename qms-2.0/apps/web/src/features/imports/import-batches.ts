import type { components } from '@qms/contracts';

export type MasterRow = components['schemas']['SupplierProfileImportDto']['rows'][number]
  | components['schemas']['CustomerMasterImportDto']['rows'][number]
  | components['schemas']['MaterialMasterImportDto']['rows'][number];
export type MasterResult = components['schemas']['SupplierProfileImportResultDto'];
export type ImportBatch = { body: string; key: string; count: number };

export function prepareImportBatches(rows: readonly MasterRow[], organizationId?: string, t = (text: string) => text): ImportBatch[] {
  const encode = new TextEncoder();
  const body = (items: readonly MasterRow[]) => JSON.stringify({ ...(organizationId ? { organizationId } : {}), rows: items });
  const batches: ImportBatch[] = [];
  let current: MasterRow[] = [];
  for (const row of rows) {
    if (encode.encode(body([row])).length > 96 * 1024) throw new Error(t('第 {row} 行：单行内容超过请求大小限制').replace('{row}', String(row.rowNumber)));
    if (current.length === 100 || encode.encode(body([...current, row])).length > 96 * 1024) {
      batches.push({ body: body(current), key: crypto.randomUUID(), count: current.length });
      current = [];
    }
    current.push(row);
  }
  if (current.length) batches.push({ body: body(current), key: crypto.randomUUID(), count: current.length });
  return batches;
}
