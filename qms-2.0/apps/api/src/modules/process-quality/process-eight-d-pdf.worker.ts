import { createRequire } from 'node:module';
import type { Readable } from 'node:stream';
import { parentPort, workerData } from 'node:worker_threads';
import { inflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import type { ProcessEightDControlledReportDto } from './process-eight-d-report.dto.js';

const fontPath = createRequire(import.meta.url).resolve('@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf');
const { report, images: rawImages, dimensions, domainLabel } = workerData as {
  report: ProcessEightDControlledReportDto; images: Map<string, Uint8Array>; dimensions: Map<string, { width: number; height: number }>; domainLabel: string;
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
const display = (value: unknown): string => value === null || value === undefined || value === '' ? '未记录' : value === true ? '是' : value === false ? '否' : String(value);
const labels: Record<string, string> = {
  description: '问题描述', operationCode: '工序', lineCode: '产线', batchCode: '批次', workOrderCode: '工单', projectCode: '项目', productCode: '产品',
  traceCode: '追溯条码', defectQuantity: '不良数量', defectTypeCode: '不良类型', occurredAt: '发生时间', responsibilityCategory: '责任分类',
  analysisProgress: '分析进度', ledgerStatus: '台账状态', materials: '多物料', materialCode: '物料编码', materialName: '物料名称', materialBatch: '物料批次',
  supplierOrganizationId: '供应商组织ID', supplierProfileId: '供应商档案ID', sqeUserId: '选定SQE ID', notes: '备注',
  materialVerificationHistory: '物料复核历史', ledgerHistory: '台账历史', classificationHistory: '分类历史',
};

async function render(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margins: { top: 83, bottom: 58, left: 38, right: 38 }, autoFirstPage: false,
      bufferPages: true, info: { Title: `${domainLabel}内部8D ${report.reportNumber}`, Author: 'QMS' } }) as PDFKit.PDFDocument & Readable;
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
        pdf.fillColor('#123b52').fontSize(15).text(`${domainLabel}内部 8D 报告`, 38, 28, { lineBreak: false });
        pdf.fontSize(8).text(`${report.reportNumber} | 内容 V${report.contentVersion} / 行 V${report.rowVersion} | ${report.label}`, 38, 51, { width, lineBreak: false });
        pdf.moveTo(38, 70).lineTo(557, 70).strokeColor('#b9c9d3').stroke();
        pdf.fillColor('#182e3c').fontSize(9); pdf.x = 38; pdf.y = 83;
      });
      pdf.addPage();
      const ensure = (height: number) => { if (pdf.y + height > bottom()) pdf.addPage(); };
      const line = (label: string, value: unknown) => {
        ensure(20); pdf.fontSize(9).fillColor('#182e3c').text(`${label}：${display(value)}`, 38, pdf.y, { width, lineGap: 3 });
        pdf.y += 4;
      };
      const heading = (title: string) => {
        ensure(64); pdf.y += 8; pdf.fontSize(12).fillColor('#145c78').text(title, 38, pdf.y, { width }); pdf.y += 8;
      };
      const details = (value: unknown, prefix = '') => {
        if (Array.isArray(value)) {
          if (!value.length) line(prefix, null);
          value.forEach((row, index) => details(row, `${prefix} ${index + 1}`));
        } else if (value !== null && typeof value === 'object') {
          for (const [key, item] of Object.entries(value)) details(item, `${prefix ? `${prefix} / ` : ''}${labels[key] ?? key}`);
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
      const table = (headers: string[], rows: unknown[][], weights = headers.map(() => 1)) => {
        if (!rows.length) { line('记录', null); return; }
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
      const figures = (ids: string[], use: string) => {
        for (const id of ids) {
          const file = report.attachments.find(item => item.id === id);
          if (!file) throw new Error('PROCESS_EIGHT_D_REPORT_IMAGE_MISSING');
          line(`${use} / 原附件`, `${file.originalName} | ${file.note}`);
          if (file.rendering !== 'EMBEDDED') continue;
          const size = dimensions.get(id)!;
          const scale = Math.min(width / size.width, 250 / size.height, 1);
          const height = size.height * scale;
          ensure(height + 12);
          pdf.image(images.get(id)!, 38, pdf.y, { width: size.width * scale, height });
          pdf.y += height + 12;
        }
      };
      const snapshot = report.snapshot; const document = snapshot.document;
      heading(`版本与${domainLabel}基础`);
      line('报告状态', report.label); line('修订ID', report.revisionId); line('生成时间（非审批时间）', report.generatedAt);
      line('问题ID', report.problemId); line('负责人ID', snapshot.ownerUserId); line('实际发单 / 专业审核人ID', snapshot.professionalUserId);
      line('责任科室ID', snapshot.responsibleSectionDepartmentId); line('协作者ID', snapshot.collaboratorUserIds.join('、'));
      const severity = snapshot.problem.severity ?? snapshot.severity;
      const riskLabels: Record<string, string> = { LOW: '低风险', MEDIUM: '中风险', HIGH: '高风险', CRITICAL: '重大风险' };
      line('风险', riskLabels[String(severity)] ?? severity); line('发起时间', snapshot.problem.createdAt);
      heading('阶段期限与实际时间');
      table(['阶段', '计划期限', '实际时间'], [
        ['分析 / 对策', snapshot.deadlines.analysisDueAt, snapshot.analysisCompletedAt],
        ['完整提交', snapshot.deadlines.submissionDueAt, snapshot.submittedAt],
        ['关闭', snapshot.deadlines.closureDueAt, snapshot.problem.closedAt],
      ]);
      heading(`D2 问题描述与${domainLabel}来源`); line('问题描述', document.description);
      snapshot.sources.forEach((source, index) => {
        heading(`来源 ${index + 1} / ${source.sourceId} / V${source.sourceVersion}`);
        line('来源域 / 类型', `${source.sourceDomain} / ${source.sourceType}`); details(source.sourceSnapshot);
      });
      if (!snapshot.sources.length) line('来源', null);
      if (snapshot.sourceConfirmations) { heading('来源关联 / 复发确认'); details(snapshot.sourceConfirmations); }
      figures(document.okFileIds, 'D2 OK'); figures(document.ngFileIds, 'D2 NG');
      heading('D3 临时措施');
      table(['措施', '责任部门 / 人', '导入时间'], document.temporaryMeasures.map(row => [row.description, row.departmentOwner, row.introducedAt]), [3, 1, 1]);
      document.temporaryMeasures.forEach(row => figures(row.fileIds, `D3 临时措施 ${row.id}`));
      for (const [title, rows] of [['D3 围堵', document.containment], ['D3 可选扩展围堵', document.optionalAffectedContainment]] as const) {
        heading(title); table(['组别 / 位置', '数量 / 不良数', '措施', '负责人 / 计划', '完成情况'],
          rows.map(row => [`${row.group} / ${row.location}`, `${display(row.quantity)} / ${display(row.ngQuantity)}`, row.measure, `${row.owner} / ${display(row.plannedAt)}`, row.completion]), [1, 1, 2, 1.5, 1.5]);
      }
      heading('D4 分析过程'); line('过程还原 / 分析方法', document.analysisProcess); figures(document.analysisFileIds, 'D4 分析');
      line('发生因总结', document.occurrenceCause); line('流出因总结', document.escapeCause); line('系统因（可选）', document.systemCause);
      heading('D5 / D6 对策、实施与有效性验证');
      document.correctiveActions.forEach((row, index) => {
        heading(`措施 ${index + 1} / ${row.id} / ${row.causeKind}`);
        table(['项目', '真实记录'], [
          ['对策 / 负责人 / 计划', `${row.action} / ${row.owner} / ${display(row.plannedAt)}`], ['验证方法', row.verificationMethod],
          ['实施时间 / 结果', `${display(row.implementationAt)} / ${row.result}`], ['改善前', row.beforeState], ['改善后', row.afterState],
          ['真实首批断点', row.firstBatch], ['后续批数 / 时长', `${display(row.followUpBatchCount)} / ${display(row.followUpDuration)}`],
          ['验证记录', row.verificationRecord], ['人工明确有效结论', row.effective === null ? '尚未确认' : row.effective ? '确认有效' : '确认无效'],
        ], [1, 4]);
        figures(row.fileIds, `D5 / D6 措施 ${row.id}`); figures(row.verificationFileIds, `D6 验证 ${row.id}`);
      });
      if (!document.correctiveActions.length) line('对策', null);
      heading('D7 标准化（不代表受控文件已经发布）');
      table(['序号', '相关文件', '是否需要更新', '部门 / 主导者', '计划完成日期', '实际完成日期', '状态'], document.standardization.map((row, index) =>
        [index + 1, row.documentName, row.needsUpdate, row.departmentOwner, row.plannedAt, row.completedAt, row.status]), [0.5, 2.5, 0.9, 1.3, 1, 1, 0.8]);
      document.standardization.forEach((row, index) => { if (row.reason.trim()) line(`标准化第${index + 1}项补充说明`, row.reason); });
      heading('D7 横向展开');
      table(['范围', '排查结果', '措施', '负责人', '完成情况'], document.horizontalDeployment.map(row => [row.scope, row.inspectionResult, row.action, row.owner, row.completion]), [1, 2, 2, 1, 2]);
      document.horizontalDeployment.forEach(row => figures(row.fileIds, `D7 横展 ${row.id}`));
      heading('D8 关闭与实际审批事实'); line('关闭总结', document.closureSummary); line('实际关闭时间', snapshot.problem.closedAt);
      const rounds = snapshot.approvalRounds ?? (snapshot.approval ? [snapshot.approval] : []);
      if (!rounds.length) line('审批记录', '未记录实际批准；草稿不代表签批');
      rounds.forEach(round => {
        const invalid = ['RETURNED', 'CANCELLED'].includes(String(round.status)) || round.contentVersion !== report.contentVersion;
        heading(`审批轮 ${display(round.roundNumber)} / ${display(round.status)}${invalid ? ' / 旧轮已失效' : ''}`);
        line('本轮内容版本', round.contentVersion);
        if (round.context) { const context = object(round.context); line('轮次结束原因', context.endReason); line('结束操作人ID', context.endedBy); }
        for (const raw of Array.isArray(round.duties) ? round.duties : []) {
          const duty = object(raw);
          const fact = duty.status === 'SKIPPED_SAME_PERSON' ? '同人跳过（非签批）'
            : duty.status === 'APPROVED' && duty.decidedBy && duty.decidedAt ? `实际签批 ${display(duty.decidedBy)} / ${display(duty.decidedAt)}` : '未形成批准签批';
          line(`${display(duty.duty)} / ${display(duty.status)}`, `${fact}${invalid ? '（旧轮已失效，不作为本版批准）' : ''}`);
          line('记录人员 / 意见', `${display(duty.userId)} / ${display(duty.comment)}`);
        }
      });
      heading('原附件清单（不自动合并原文件）');
      for (const file of report.attachments) {
        line('文件名 / 用途', `${file.originalName} / ${file.uses.join('、')}`);
        line('受控引用', `${file.id} / 文件V${file.version} / 对象版本 ${file.objectVersionId}`);
        line('处理方式', file.note);
      }
      if (!report.attachments.length) line('原附件', '无');
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
