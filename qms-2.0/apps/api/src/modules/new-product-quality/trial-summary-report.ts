import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

type Metric = { id: string; code: string; target: number; actual: number; comparison: string; signal: string; source: string; recordedAt: string };
type Issue = { kind: string; id: string; description?: string; riskLevel?: string; responseForm?: string; complexity?: string; severity?: string; status: string; createdAt: string };
export type TrialSummaryReport = {
  project: { id: string; code: string; name: string; productCode: string };
  batch: { id: string; code: string; workOrderCode: string | null };
  summary: { version: number; conclusion: string; sourceSha256: string; submittedAt: string; approvedAt: string; metricSnapshot: Metric[]; issueSnapshot: Issue[] };
};

const fontPath = createRequire(import.meta.url).resolve('@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf');

function worksheet(workbook: ExcelJS.Workbook, name: string, headers: string[], rows: (string | number | null)[][]) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF277CC4' } };
  sheet.columns.forEach((column) => { column.width = 26; });
  sheet.eachRow((row) => { row.alignment = { vertical: 'top', wrapText: true }; });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

async function xlsx(report: TrialSummaryReport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QMS';
  worksheet(workbook, '试产总结', ['项目', '内容'], [
    ['项目编号', report.project.code], ['项目名称', report.project.name], ['产品编号', report.project.productCode],
    ['批次编号', report.batch.code], ['工单编号', report.batch.workOrderCode], ['项目 ID', report.project.id],
    ['批次 ID', report.batch.id], ['总结版本', report.summary.version], ['来源 SHA-256', report.summary.sourceSha256],
    ['结论', report.summary.conclusion], ['提交时间', report.summary.submittedAt], ['批准时间', report.summary.approvedAt],
  ]);
  worksheet(workbook, '指标', ['ID', '指标', '目标', '实际', '比较', '信号', '来源', '记录时间'], report.summary.metricSnapshot.map((metric) => [metric.id, metric.code, metric.target, metric.actual, metric.comparison, metric.signal, metric.source, metric.recordedAt]));
  workbook.getWorksheet('试产总结')!.getColumn(2).width = 90;
  worksheet(workbook, '问题', ['类型', 'ID', '描述', '风险等级', '响应形式', '复杂度', '严重度', '状态', '创建时间'], report.summary.issueSnapshot.map((issue) => [issue.kind, issue.id, issue.description ?? null, issue.riskLevel ?? null, issue.responseForm ?? null, issue.complexity ?? null, issue.severity ?? null, issue.status, issue.createdAt]));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function pdf(report: TrialSummaryReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 42, autoFirstPage: true, info: { Title: '试产总结', Author: 'QMS' } });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.font(fontPath).fontSize(18).text('试产总结');
    document.moveDown(0.6).fontSize(10);
    const line = (label: string, value: unknown) => document.text(`${label}：${value ?? '—'}`, { width: 500 });
    line('项目编号', report.project.code);
    line('项目名称', report.project.name);
    line('产品编号', report.project.productCode);
    line('项目 ID', report.project.id);
    line('批次编号', report.batch.code);
    line('工单编号', report.batch.workOrderCode);
    line('批次 ID', report.batch.id);
    line('总结版本', report.summary.version);
    line('来源 SHA-256', report.summary.sourceSha256);
    line('提交时间', report.summary.submittedAt);
    line('批准时间', report.summary.approvedAt);
    document.moveDown().fontSize(13).text('结论').fontSize(10).text(report.summary.conclusion, { width: 500 });
    document.moveDown().fontSize(13).text('试产指标').fontSize(9);
    for (const metric of report.summary.metricSnapshot) {
      document.text(`${metric.code}  目标 ${metric.target}  实际 ${metric.actual}  ${metric.comparison}  ${metric.signal}`);
      document.text(`ID ${metric.id}  来源 ${metric.source}  记录 ${metric.recordedAt}`);
    }
    document.moveDown().fontSize(13).text('正式及遗留问题').fontSize(9);
    if (!report.summary.issueSnapshot.length) document.text('无');
    for (const issue of report.summary.issueSnapshot) {
      document.text(`${issue.kind}  ${issue.id}  ${issue.status}`);
      document.text([issue.description, issue.riskLevel, issue.responseForm, issue.complexity, issue.severity, issue.createdAt].filter(Boolean).join('  '));
    }
    document.end();
  });
}

export async function renderTrialSummaryReport(report: TrialSummaryReport, format: 'xlsx' | 'pdf') {
  const content = format === 'xlsx' ? await xlsx(report) : await pdf(report);
  return { content, contentType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf' };
}
