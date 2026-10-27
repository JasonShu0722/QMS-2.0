import type { components } from '@qms/contracts';
import { useEightDStyle, useEightDText, type EightDReport } from '../process-eight-d/eight-d';
import styles from '../process-eight-d/eight-d.module.css';
import type { InternalEightDDomain } from './domain';

type Fact = [zh: string, en: string, value: unknown];
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function scalar(value: unknown): string | number | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 10000);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

export function extractInternalEightDSourceTitle(domain: InternalEightDDomain, snapshot: unknown): string | undefined {
  const facts = record(snapshot);
  const value = domain === 'customer' ? record(facts.normalized).defectDescription : facts.description;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const title = value.trim();
  return title.length > 240 ? `${title.slice(0, 237)}...` : title;
}

function sourceFacts(domain: InternalEightDDomain, snapshot: Record<string, unknown>): Fact[] {
  if (domain === 'customer') {
    const normalized = record(snapshot.normalized);
    const mapping = record(snapshot.mappingSnapshot);
    const project = record(mapping.project);
    const savedMapping = record(mapping.mapping);
    return [
      ['客诉编号', 'Complaint number', snapshot.complaintNumber],
      ['客诉类型', 'Complaint type', snapshot.complaintType],
      ['客户名称', 'Customer name', snapshot.customerName],
      ['事实描述', 'Fact description', normalized.defectDescription],
      ['零部件代码', 'Component code', normalized.componentCode],
      ['产品型号', 'Product model', normalized.productModel],
      ['保存的项目代码', 'Saved project code', project.code],
      ['登记阶段', 'Registered stage', snapshot.stage],
      ['发生日期', 'Occurrence date', normalized.occurredOn],
      ['数量', 'Quantity', normalized.quantity],
      ['产品条码', 'Product barcode', normalized.barcode],
      ['批次', 'Batch', normalized.batch],
      ['VIN', 'VIN', normalized.vin],
      ['行驶里程', 'Mileage', normalized.mileage],
      ['生产日期', 'Production date', normalized.productionOn],
      ['购买日期', 'Purchase date', normalized.purchaseOn],
      ['车辆交付日期', 'Vehicle delivery date', normalized.vehicleDeliveryOn],
      ['车辆下线日期', 'Vehicle offline date', normalized.vehicleOfflineOn],
      ['上线日期', 'Online date', normalized.onlineOn],
      ['发生地点', 'Occurrence location', normalized.occurredAtLocation],
      ['发生区域', 'Occurrence region', normalized.occurredAtRegion],
      ['终端客户名称', 'End customer name', normalized.terminalCustomerName],
      ['保存的映射标识', 'Saved mapping ID', savedMapping.id],
      ['保存的映射版本', 'Saved mapping version', savedMapping.version],
      ['映射时项目阶段', 'Project stage at mapping', project.stage],
    ];
  }
  const process: Fact[] = [
    ['事实描述', 'Fact description', snapshot.description],
    ['发生时间', 'Occurrence time', snapshot.occurredAt],
    ['不良数量', 'Defect quantity', snapshot.defectQuantity],
    ['工序', 'Operation', snapshot.operationCode],
    ['产线', 'Line', snapshot.lineCode],
    ['追溯码', 'Trace code', snapshot.traceCode],
    ['批次', 'Batch', snapshot.batchCode],
    ['工单', 'Work order', snapshot.workOrderCode],
  ];
  if (domain === 'new-product') {
    const inclusion = record(snapshot.inclusion);
    return [
      ['纳入记录标识', 'Selection ID', snapshot.selectionId],
      ['新品项目标识', 'New-product project ID', snapshot.projectId],
      ['纳入时项目代码', 'Project code at inclusion', inclusion.projectCode],
      ['纳入时零部件代码', 'Component code at inclusion', inclusion.componentCode],
      ['纳入时观察阶段', 'Observed stage at inclusion', inclusion.observedProjectStage],
      ['纳入依据发生时间', 'Occurrence time in inclusion evidence', inclusion.occurredAt],
      ['纳入观察时间', 'Inclusion observation time', inclusion.observedAt],
      ['历史阶段依据', 'Historical stage evidence', inclusion.temporalEvidence],
      ['确认理由', 'Confirmation reason', inclusion.confirmationReason],
      ['保存的映射标识', 'Saved mapping ID', inclusion.mappingId],
      ['保存的映射版本', 'Saved mapping version', inclusion.mappingVersion],
      ['原过程事实标识', 'Original process fact ID', snapshot.id],
      ...process,
      ['过程事实项目代码', 'Process fact project code', snapshot.projectCode],
      ['过程事实产品代码', 'Process fact product code', snapshot.productCode],
    ];
  }
  return [...process, ['项目代码', 'Project code', snapshot.projectCode], ['产品代码', 'Product code', snapshot.productCode]];
}

export function InternalEightDSourceFacts({ domain, sources }: {
  domain: InternalEightDDomain;
  sources: EightDReport['sources'] | components['schemas']['ProcessEightDControlledReportDto']['snapshot']['sources'];
}) {
  const text = useEightDText();
  const style = useEightDStyle();
  const labels: Record<string, string> = {
    ZERO_KM: text('零公里', 'Zero kilometer'), AFTER_SALES: text('售后', 'After-sales'),
    NEW_PRODUCT: text('新品', 'New product'), MASS_PRODUCTION: text('量产', 'Mass production'),
    MANUAL_CONFIRMATION: text('人工确认', 'Manual confirmation'), UNVERIFIED: text('未核实', 'Unverified'),
  };
  return <section aria-label={text('来源基础信息', 'Source facts')} className={styles.section}
    style={{ ...style, minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' }}>
    <h3>{text('来源基础信息', 'Source facts')}</h3>
    <p>{text('仅展示本报告版本保存且获准可见的来源事实；缺失项为未记录，不补查实时台账。', 'Only authorized source facts saved with this report version are shown. Missing facts are unrecorded; live ledgers are not queried.')}</p>
    {!sources.length && <p>{text('未记录来源', 'No sources recorded')}</p>}
    {sources.map((source, index) => {
      const id = 'sourceId' in source ? source.sourceId : source.defectId;
      const snapshot = record('sourceSnapshot' in source ? source.sourceSnapshot : source.snapshot);
      const facts: Fact[] = [
        ['来源标识', 'Source ID', id], ['保存来源版本', 'Saved source version', source.sourceVersion],
        ...('primary' in source && typeof source.primary === 'boolean'
          ? [['来源角色', 'Source role', source.primary ? text('主来源', 'Primary source') : text('关联来源', 'Linked source')] as Fact] : []),
        ...sourceFacts(domain, snapshot),
      ];
      return <article key={`${id}-${index}`} aria-label={`${text('来源', 'Source')} ${index + 1}`} className={styles.row}>
        <h4 style={{ margin: 0 }}>{extractInternalEightDSourceTitle(domain, snapshot)
          ?? `${scalar(id) ?? text('来源', 'Source')} · ${text('未记录', 'Not recorded')}`}</h4>
        <dl className={styles.fields} style={{ margin: 0 }}>{facts.map(([zh, en, raw]) => {
          const value = scalar(raw);
          const display = ['客诉类型', '登记阶段', '映射时项目阶段', '纳入时观察阶段', '历史阶段依据'].includes(zh)
            && typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : value;
          return <div key={zh} className={styles.field}><dt>{text(zh, en)}</dt>
            <dd style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{display ?? text('未记录', 'Not recorded')}</dd>
          </div>;
        })}</dl>
      </article>;
    })}
  </section>;
}
