import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';
import { parentPort, workerData } from 'node:worker_threads';
import { inflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import type { ProcessEightDControlledReportDto } from './process-eight-d-report.dto.js';

const fontPath = createRequire(import.meta.url).resolve('@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf');
const { report, images: rawImages, dimensions, domainLabel, supplierPortal } = workerData as {
  report: ProcessEightDControlledReportDto; images: Map<string, Uint8Array>; dimensions: Map<string, { width: number; height: number }>; domainLabel: string; supplierPortal: boolean;
};
const images = new Map([...rawImages].map(([id, bytes]) => [id, Buffer.from(bytes)]));

function boundPngInflation(bytes: Buffer): void {
  const invalid = () => { throw new Error('PROCESS_EIGHT_D_REPORT_RENDER_FAILED'); };
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  const bits = bytes[24]!; const color = bytes[25]!; const interlace = bytes[28]!;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (!channels || ![1, 2, 4, 8, 16].includes(bits) || color === 3 && bits === 16
    || [2, 4, 6].includes(color) && bits < 8 || bytes[26] !== 0 || bytes[27] !== 0 || interlace > 1) invalid();
  const idat: Buffer[] = []; let offset = 8; let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset); const type = bytes.toString('ascii', offset + 4, offset + 8);
    const end = offset + length + 12;
    if (end > bytes.length || type === 'IHDR' && (offset !== 8 || length !== 13)) invalid();
    if (type === 'IDAT') idat.push(bytes.subarray(offset + 8, end - 4));
    if (type === 'IEND') { if (length !== 0 || end !== bytes.length) invalid(); ended = true; break; }
    offset = end;
  }
  if (!ended || !idat.length) invalid();
  const passes = interlace === 1 ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  let expected = 0;
  for (const [x, y, dx, dy] of passes) {
    const columns = Math.max(0, Math.ceil((width - x!) / dx!));
    const rows = Math.max(0, Math.ceil((height - y!) / dy!));
    if (columns && rows) expected += (Math.ceil(columns * channels! * bits / 8) + 1) * rows;
  }
  // Worker heap limits do not bound zlib Buffers: cap inflation using the validated scanline dimensions.
  if (inflateSync(Buffer.concat(idat), { maxOutputLength: expected }).length !== expected) invalid();
}

for (const file of report.attachments) {
  if (file.rendering === 'EMBEDDED' && file.contentType === 'image/png') boundPngInflation(images.get(file.id)!);
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hasValue = (value: unknown) => typeof value === 'string' && !!value.trim() || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean';
const display = (value: unknown): string => !hasValue(value) ? '' : value === true ? '是' : value === false ? '否' : String(value);
const labels: Record<string, string> = {
  description: '问题描述', operationCode: '工序', lineCode: '产线', batchCode: '批次', workOrderCode: '工单', projectCode: '项目', productCode: '产品',
  traceCode: '追溯条码', defectQuantity: '不良数量', defectTypeCode: '不良类型', occurredAt: '发生时间', responsibilityCategory: '责任分类',
  analysisProgress: '分析进度', ledgerStatus: '台账状态', materials: '多物料', materialCode: '物料编码', materialName: '物料名称', materialBatch: '物料批次',
  responsibilityCategoryName: '责任分类', materialQuantity: '物料数量', notes: '备注',
  complaintNumber: '客诉编号', complaintType: '客诉类型', customerName: '客户名称', normalized: '客诉事实', componentCode: '零部件代码',
  defectDescription: '不良描述', productModel: '产品型号', quantity: '数量', occurredOn: '发生日期', barcode: '产品条码', batch: '批次',
  vin: 'VIN', mileage: '行驶里程', stage: '登记阶段', terminalCustomerName: '终端客户名称', occurredAtLocation: '发生地点',
  occurredAtRegion: '发生区域', productionOn: '生产日期', purchaseOn: '购买日期', vehicleDeliveryOn: '车辆交付日期',
  vehicleOfflineOn: '车辆下线日期', onlineOn: '上线日期', inclusion: '纳入依据', projectCodeAtInclusion: '纳入时项目代码',
  observedProjectStage: '纳入时观察阶段', observedAt: '纳入观察时间', temporalEvidence: '历史阶段依据', confirmationReason: '确认理由',
  operationName: '工序名称', lineName: '产线名称', mappingSnapshot: '保存的映射', project: '项目', code: '代码',
};

async function render(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const reportTitle = `${domainLabel}${domainLabel === '供应商' ? '' : '内部'}`;
    const pdf = new PDFDocument({ size: 'A4', margins: { top: 83, bottom: 58, left: 38, right: 38 }, autoFirstPage: false,
      bufferPages: true, info: { Title: `${reportTitle}8D ${report.reportNumber}`, Author: 'QMS' } }) as PDFKit.PDFDocument & Readable;
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    pdf.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 64 * 1024 * 1024) pdf.destroy(new Error('PROCESS_EIGHT_D_REPORT_PDF_LIMIT'));
      else chunks.push(chunk);
    });
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    try {
      pdf.font(fontPath);
      let pages = 0;
      const width = 519;
      const bottom = () => pdf.page.height - 58;
      pdf.on('pageAdded', () => {
        if (++pages > 300) throw new Error('PROCESS_EIGHT_D_REPORT_PDF_LIMIT');
        pdf.save().fillColor('#e8edf1').opacity(0.55).fontSize(26);
        pdf.rotate(-25, { origin: [280, 420] }).text(`${report.label} / V${report.contentVersion}`, 80, 420, { lineBreak: false });
        pdf.restore();
        pdf.fillColor('#123b52').fontSize(15).text(`${reportTitle} 8D 报告`, 38, 28, { lineBreak: false });
        pdf.fontSize(8).text(`${report.reportNumber} | 版本 V${report.contentVersion} | ${report.label}`, 38, 51, { width, lineBreak: false });
        pdf.moveTo(38, 70).lineTo(557, 70).strokeColor('#b9c9d3').stroke();
        pdf.fillColor('#182e3c').fontSize(9); pdf.x = 38; pdf.y = 83;
      });
      pdf.addPage();
      const ensure = (height: number) => { if (pdf.y + height > bottom()) pdf.addPage(); };
      const line = (label: string, value: unknown) => {
        if (!hasValue(value)) return;
        ensure(20); pdf.fontSize(9).fillColor('#182e3c').text(label ? `${label}：${display(value)}` : display(value), 38, pdf.y, { width, lineGap: 3 });
        pdf.y += 4;
      };
      const heading = (title: string) => {
        ensure(64); pdf.y += 8; pdf.fontSize(12).fillColor('#145c78').text(title, 38, pdf.y, { width }); pdf.y += 8;
      };
      const details = (value: unknown, prefix = '') => {
        if (Array.isArray(value)) {
          value.forEach((row, index) => details(row, `${prefix} ${index + 1}`));
        } else if (value !== null && typeof value === 'object') {
          for (const [key, item] of Object.entries(value)) {
            if (Object.hasOwn(labels, key)) details(item, `${prefix ? `${prefix} / ` : ''}${labels[key]}`);
          }
        } else line(prefix, value);
      };
      const charWidths = new Map<string, number>();
      const wrap = (value: unknown, available: number) => {
        const lines: string[] = []; let text = ''; let used = 0;
        pdf.fontSize(8);
        for (const character of display(value).replace(/\r\n?/g, '\n')) {
          const size = charWidths.get(character) ?? pdf.widthOfString(character);
          charWidths.set(character, size);
          if (character === '\n' || used + size > available) { lines.push(text); text = ''; used = 0; }
          if (character !== '\n') { text += character; used += size; }
        }
        lines.push(text); return lines;
      };
      const table = (headers: string[], allRows: unknown[][], weights = headers.map(() => 1)) => {
        const rows = allRows.filter(row => row.some(hasValue));
        if (!rows.length) return;
        const widths = weights.map(weight => width * weight / weights.reduce((sum, n) => sum + n, 0));
        const draw = (cells: string[][], offset: number, count: number, header = false) => {
          const y = pdf.y; const height = count * 13 + 10; let x = 38;
          cells.forEach((cell, index) => {
            pdf.rect(x, y, widths[index]!, height).fillAndStroke(header ? '#e6f0f5' : '#ffffff', '#c2d0d8');
            pdf.fillColor('#182e3c').fontSize(8);
            // Already wrapped: supplying width makes PDFKit wrap a second time and overflow the row.
            cell.slice(offset, offset + count).forEach((text, lineIndex) => pdf.text(text, x + 5, y + 5 + lineIndex * 13, { lineBreak: false }));
            x += widths[index]!;
          });
          pdf.x = 38; pdf.y = y + height;
        };
        const headerCells = headers.map((title, index) => wrap(title, widths[index]! - 10));
        const headerLines = Math.max(...headerCells.map(cell => cell.length));
        const head = () => { ensure(headerLines * 13 + 40); draw(headerCells, 0, headerLines, true); };
        head();
        for (const row of rows) {
          const cells = headers.map((_title, index) => wrap(row[index], widths[index]! - 10));
          const count = Math.max(...cells.map(cell => cell.length));
          const pageCapacity = Math.floor((bottom() - 83 - headerLines * 13 - 20) / 13);
          if (count <= pageCapacity && pdf.y + count * 13 + 10 > bottom()) { pdf.addPage(); head(); }
          let offset = 0;
          while (offset < count) {
            let available = Math.floor((bottom() - pdf.y - 10) / 13);
            if (available < 1) { pdf.addPage(); head(); available = Math.floor((bottom() - pdf.y - 10) / 13); }
            const take = Math.min(available, count - offset);
            draw(cells, offset, take); offset += take;
          }
        }
        pdf.y += 10;
      };
      const shown = new Set<string>();
      function figure(id: string, x: number, y: number, available: number, purpose?: string) {
        const file = report.attachments.find(item => item.id === id);
        if (!file || file.rendering !== 'EMBEDDED' || shown.has(id)) return y;
        const size = dimensions.get(id)!;
        const scale = Math.min(available / size.width, 230 / size.height, 1);
        const height = size.height * scale;
        pdf.fontSize(8);
        const caption = purpose ? `${purpose} · ${file.originalName}` : file.originalName;
        pdf.image(images.get(id)!, x, y, { width: size.width * scale, height });
        pdf.fillColor('#526976').text(caption, x, y + height + 5, { width: available });
        shown.add(id);
        return pdf.y + 8;
      }
      const figures = (ids: string[], purpose?: string) => {
        if (purpose && ids.some(id => dimensions.has(id) && !shown.has(id))) {
          ensure(300);
          heading(purpose);
        }
        for (const id of new Set(ids)) {
          if (!dimensions.has(id) || shown.has(id)) continue;
          ensure(275); pdf.y = figure(id, 38, pdf.y, width, purpose);
        }
      };
      const pairedFigures = (okIds: string[], ngIds: string[], okDescription?: string, ngDescription?: string) => {
        const ok = [...new Set(okIds)].filter(id => dimensions.has(id));
        const ng = [...new Set(ngIds)].filter(id => dimensions.has(id) && !ok.includes(id));
        const column = width / 2;
        if (ok.length || ng.length) ensure(310);
        table([hasValue(okDescription) ? 'OK 图片说明' : '', hasValue(ngDescription) ? 'NG 图片说明' : ''], [[okDescription, ngDescription]]);
        for (let index = 0; index < Math.max(ok.length, ng.length); index++) {
          ensure(275);
          const y = pdf.y;
          const okBottom = ok[index] ? figure(ok[index], 43, y, column - 10, 'D2 OK') : y;
          const ngBottom = ng[index] ? figure(ng[index], 43 + column, y, column - 10, 'D2 NG') : y;
          pdf.y = Math.max(okBottom, ngBottom);
        }
      };
      const snapshot = report.snapshot; const document = snapshot.document;
      const title = document.title || (hasValue(snapshot.problem.title) ? snapshot.problem.title : report.reportNumber);
      pdf.fontSize(17).fillColor('#123b52').text(display(title), 38, pdf.y, { width });
      pdf.y += 6;
      const severity = snapshot.problem.severity ?? snapshot.severity;
      const riskLabels: Record<string, string> = { LOW: '低风险', MEDIUM: '中风险', HIGH: '高风险', CRITICAL: '重大风险' };
      const closed = report.status === 'APPROVED' || report.status === 'CLOSED_SUPPLEMENT' || hasValue(snapshot.problem.closedAt);
      const inReview = report.status === 'IN_REVIEW' || report.status === 'HISTORICAL' && hasValue(snapshot.submittedAt);
      line('业务状态', closed ? '已关闭' : inReview ? '审批中' : '办理中');
      line('风险', riskLabels[String(severity)] ?? severity);
      const findings = [
        ['问题', document.description || snapshot.problem.defectDescription], ['发生原因', document.occurrenceCause],
        ['流出原因', document.escapeCause], ['系统原因', document.systemCause],
        ['已记录对策（摘录）', document.correctiveActions.find(row => hasValue(row.action))?.action],
        ['已记录结果（摘录）', document.effectTracking?.result || document.correctiveActions.find(row => hasValue(row.result))?.result],
      ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && hasValue(entry[1]));
      if (findings.length) {
        heading('执行摘要');
        for (const [label, value] of findings) {
          const excerpt = [...value.trim()];
          line(label, excerpt.length > 100 ? `${excerpt.slice(0, 100).join('')}…` : excerpt.join(''));
        }
      }
      heading(`${domainLabel}基本信息`);
      line('发起时间', snapshot.problem.createdAt);
      if (!supplierPortal) {
        if (snapshot.ownerName) line('负责人', snapshot.ownerName);
        if (snapshot.responsibleSectionName) line('责任科室', snapshot.responsibleSectionName);
      }
      if (document.riskAssessment) line('风险判定说明', document.riskAssessment);
      if (domainLabel === '供应商') {
        line('物料编码', snapshot.problem.materialCode); line('物料类别', snapshot.problem.materialCategory);
        line('不良描述', snapshot.problem.defectDescription); line('不良数量', snapshot.problem.defectQuantity);
        if (report.status === 'CLOSED_SUPPLEMENT') line('补充更新时间', snapshot.problem.supplementUpdatedAt);
      }
      const stages = [
        ['分析 / 对策', snapshot.deadlines.analysisDueAt, snapshot.analysisCompletedAt],
        ['完整提交', snapshot.deadlines.submissionDueAt, snapshot.submittedAt],
        ['关闭', snapshot.deadlines.closureDueAt, snapshot.problem.closedAt],
      ].filter(row => row.slice(1).some(hasValue));
      if (stages.length) { heading('阶段期限与实际时间'); table(['阶段', '计划期限', '实际时间'], stages); }
      heading('D1 团队名册');
      table(['姓名', '部门', '职务', '职责分工', '协作范围', '组长'], (document.team ?? []).map(row =>
        [row.name, row.department, row.jobTitle, row.responsibility, row.collaborationScope, row.isLeader ? '组长' : null]), [1, 1, 1, 2, 2, 0.8]);
      heading(`D2 问题描述与${domainLabel}来源`); line('', document.description);
      if (!supplierPortal) snapshot.sources.forEach((source, index) => {
        line(`来源 ${index + 1}`, source.sourceId);
        details(source.sourceSnapshot);
      });
      if (!supplierPortal && Array.isArray(snapshot.sourceConfirmations)) for (const value of snapshot.sourceConfirmations) {
        const confirmation = object(value);
        const recurrence = confirmation.recurrence === 'RECURRENCE' || confirmation.recurrence === true ? '复发'
          : confirmation.recurrence === 'NOT_RECURRENCE' || confirmation.recurrence === false ? '非复发' : undefined;
        line('复发确认', recurrence); line('确认理由', confirmation.reason); line('确认时间', confirmation.recordedAt);
        if (Array.isArray(confirmation.relatedProblemIds)) line('相关问题', confirmation.relatedProblemIds.filter(hasValue).join('、'));
      }
      pairedFigures(document.okFileIds, document.ngFileIds, document.okDescription, document.ngDescription);
      heading('D3 临时措施');
      table(['序号', '措施', '责任部门 / 人', '导入时间'], document.temporaryMeasures.flatMap((row, index) =>
        [row.description, row.departmentOwner, row.introducedAt].some(hasValue) || row.fileIds.some(id => dimensions.has(id))
          ? [[index + 1, row.description, row.departmentOwner, row.introducedAt]] : []), [0.45, 3, 1, 1]);
      document.temporaryMeasures.forEach((row, index) => figures(row.fileIds, `D3 临时措施 ${index + 1}`));
      for (const [title, rows, scope] of [['D3 围堵', document.containment], ['D3 可选扩展围堵', document.optionalAffectedContainment, document.optionalAffectedScope]] as const) {
        if (!scope && !rows.some(row => [row.group, row.location, row.quantity, row.ngQuantity, row.measure, row.owner, row.plannedAt, row.completion].some(hasValue))) continue;
        heading(title);
        if (scope) line('潜在影响范围', scope);
        table(['组别', '位置', '数量', '不良数', '措施', '负责人', '计划', '完成情况'],
          rows.map(row => [row.group, row.location, row.quantity, row.ngQuantity, row.measure, row.owner, row.plannedAt, row.completion]), [1, 1, 0.65, 0.65, 2, 1, 1, 1.5]);
      }
      heading('D4 根因分析'); line('', document.analysisProcess);
      line('发生原因', document.occurrenceCause); line('流出原因', document.escapeCause); line('系统原因', document.systemCause);
      figures(document.analysisFileIds);
      const causes = { OCCURRENCE: '发生原因', ESCAPE: '流出原因', SYSTEM: '系统原因' };
      heading('D5 永久纠正措施');
      table(['序号', '原因类别', '对策', '负责人', '计划日期'], document.correctiveActions.flatMap((row, index) =>
        [row.action, row.owner, row.plannedAt].some(hasValue) || row.fileIds.some(id => report.attachments.some(file => file.id === id))
          ? [[index + 1, causes[row.causeKind], row.action, row.owner, row.plannedAt]] : []), [0.5, 1, 3, 1, 1]);
      document.correctiveActions.forEach((row, index) => figures(row.fileIds, `D5 措施 ${index + 1}`));
      heading('D6 实施与验证');
      document.correctiveActions.forEach((row, index) => {
        const facts = [
          ['实施人', row.implementer], ['验证人', row.verifier], ['实施时间', row.implementationAt], ['实施结果', row.result],
          ['改善前', row.beforeState], ['改善后', row.afterState], ['真实首批断点', row.firstBatch], ['后续批数', row.followUpBatchCount],
          ['跟踪时长', row.followUpDuration], ['验证记录', row.verificationRecord], ['确认有效', row.effective],
        ].filter(([, value]) => hasValue(value));
        if (!facts.length && !row.verificationFileIds.some(id => report.attachments.some(file => file.id === id))) return;
        heading(`措施 ${index + 1} · ${causes[row.causeKind]}`);
        facts.forEach(([label, value]) => line(String(label), value));
        figures(row.verificationFileIds);
      });
      if (document.effectTracking && Object.values(document.effectTracking).some(hasValue)) {
        const { startDate, startOrderNumber, productionQuantity, defectQuantity, result, judgement } = document.effectTracking;
        heading('D6 效果跟踪'); line('开始日期', startDate); line('开始订单号', startOrderNumber);
        line('生产数量', productionQuantity); line('不良数量', defectQuantity); line('确认结果', result); line('判断', judgement);
      }
      heading('D7 横向展开');
      table(['序号', '范围', '排查结果', '措施', '负责人', '完成情况', '状态'], document.horizontalDeployment.flatMap((row, index) => {
        const cells = [row.scope, row.inspectionResult, row.action, row.owner, row.completion, row.completed == null ? null : row.completed ? '已完成' : '未完成'];
        return cells.some(hasValue) || row.fileIds.some(id => dimensions.has(id)) ? [[index + 1, ...cells]] : [];
      }), [0.5, 1, 2, 2, 1, 2, 0.8]);
      document.horizontalDeployment.forEach((row, index) => figures(row.fileIds, `D7 横展 ${index + 1}`));
      const standardization = document.standardization.filter(row => [row.departmentOwner, row.plannedAt, row.completedAt, row.reason, row.needsUpdate].some(hasValue)
        || row.status === 'COMPLETED' || row.status === 'NOT_APPLICABLE' || (row.fileIds ?? []).some(id => report.attachments.some(file => file.id === id))
        || row.key.startsWith('custom-') && hasValue(row.documentName));
      if (standardization.length) {
        heading('标准化');
        table(['相关文件', '需要更新', '部门 / 主导者', '计划完成日期', '实际完成日期', '状态', '补充说明'], standardization.map(row =>
          [row.documentName, row.needsUpdate, row.departmentOwner, row.plannedAt, row.completedAt, row.status === 'COMPLETED' ? '已完成' : row.status === 'NOT_APPLICABLE' ? '不适用' : '', row.reason]), [2.5, 0.9, 1.3, 1, 1, 0.8, 2]);
        standardization.forEach(row => figures(row.fileIds ?? [], `D7 标准化 · ${row.documentName}`));
      }
      heading('D8 关闭与实际审批事实'); line('', document.closureSummary);
      const lessonFiles = document.lessonsLearnedFileIds ?? [];
      if ([document.lessonsLearnedTitle, document.lessonsLearned, document.lessonsLearnedApplicability].some(hasValue) || lessonFiles.length) {
        heading('经验教训'); line('', document.lessonsLearnedTitle); line('', document.lessonsLearned);
        line('经验适用简要说明', document.lessonsLearnedApplicability); figures(lessonFiles);
      }
      const rounds = snapshot.approvalRounds ?? (snapshot.approval ? [snapshot.approval] : []);
      if (!rounds.length) line('', '本版无批准记录');
      rounds.forEach(round => {
        const invalid = ['RETURNED', 'CANCELLED'].includes(String(round.status));
        const oldVersion = round.contentVersion !== report.contentVersion;
        let qualification = invalid ? '旧轮已失效' : '';
        // A supplement changes content, not the original round's actual approval facts.
        if (!invalid && oldVersion) {
          qualification = '非本版审批，不作为本版批准';
          if (round.status === 'APPROVED') qualification = report.status === 'CLOSED_SUPPLEMENT'
            ? '原版本实际批准，未覆盖本次补充' : '原版本实际批准，不作为本版批准';
        }
        heading(`审批轮 ${display(round.roundNumber)} / ${display(round.status)}${qualification ? ` / ${qualification}` : ''}`);
        line('发起时间', round.createdAt); line('轮次更新时间', round.updatedAt);
        if (!supplierPortal) line('轮次结束原因', object(round.context).endReason);
        for (const raw of Array.isArray(round.duties) ? round.duties : []) {
          const duty = object(raw);
          const signed = duty.status === 'APPROVED' && (supplierPortal || !!duty.decidedBy) && !!duty.decidedAt;
          const fact = duty.status === 'SKIPPED_SAME_PERSON' ? '同人跳过（非签批）'
            : signed ? `实际签批 ${display(duty.decidedBy)} / ${display(duty.decidedAt)}` : '未形成批准签批';
          let dutyQualification = invalid ? '旧轮已失效，不作为本版批准' : '';
          if (!invalid && oldVersion) dutyQualification = round.status === 'APPROVED' && signed ? qualification : '非本版签批，不作为本版批准';
          line(`${display(duty.duty)} / ${display(duty.status)}`, supplierPortal ? duty.decidedAt : `${fact}${dutyQualification ? `（${dutyQualification}）` : ''}`);
          if (!supplierPortal) line('意见', duty.comment);
        }
      });
      figures(report.attachments.map(file => file.id));
      const listed = report.attachments.filter(file => file.rendering === 'LISTED');
      if (listed.length) heading('版本附件');
      for (const file of listed) {
        const purposes = [...new Set(file.uses.map(use => use.replace(/^(D3 临时措施|D5 \/ D6 措施|D5 措施|D6 验证|D7 横展|D7 标准化) .+$/, '$1')))];
        line('', [file.originalName, ...purposes].join(' · '));
      }
      const range = pdf.bufferedPageRange();
      for (let index = range.start; index < range.start + range.count; index++) {
        pdf.switchToPage(index); pdf.page.margins.bottom = 0;
        pdf.fillColor('#526976').fontSize(8).text(`第 ${index + 1} / ${range.count} 页 | ${report.reportNumber} | ${report.label}`, 38, pdf.page.height - 34, { width, align: 'right', lineBreak: false });
      }
      pdf.end();
    } catch (error) { pdf.destroy(error instanceof Error ? error : new Error('PROCESS_EIGHT_D_REPORT_PDF_FAILED')); }
  });
}

parentPort!.postMessage(await render());
