import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { QualityDashboardCardDto } from './quality-data.dto.js';

type ReportCard = Pick<QualityDashboardCardDto, 'domain' | 'metricCode' | 'metricName' | 'unit' | 'status' | 'latestValue' | 'numerator' | 'denominator' | 'sourceSystem' | 'sourceRecordKey' | 'periodStart' | 'periodEnd'>;
type ReportContext = { generatedAt: string; from: string | null; to: string | null };
const fontPath = createRequire(import.meta.url).resolve('@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf');

function rows(cards: ReportCard[]) {
  return cards.map((card) => [card.domain, card.metricCode, card.metricName, card.unit, card.status, card.latestValue, card.numerator, card.denominator, card.sourceSystem, card.sourceRecordKey, card.periodStart, card.periodEnd] as (string | number | null)[]);
}

async function xlsx(cards: ReportCard[], context: ReportContext) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QMS';
  const sheet = workbook.addWorksheet('质量看板');
  sheet.addRow(['管理报表', '质量管理综合看板']);
  sheet.addRow(['生成时间', context.generatedAt]);
  sheet.addRow(['统计起始', context.from]);
  sheet.addRow(['统计结束', context.to]);
  sheet.addRow([]);
  sheet.addRow(['领域', '指标代码', '指标名称', '单位', '数据状态', '最新值', '分子', '分母', '来源系统', '来源记录键', '期间开始', '期间结束']);
  for (const row of rows(cards)) sheet.addRow(row);
  const header = sheet.getRow(6);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF277CC4' } };
  sheet.columns.forEach((column) => { column.width = 20; });
  sheet.views = [{ state: 'frozen', ySplit: 6 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function pdf(cards: ReportCard[], context: ReportContext) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 36, info: { Title: '质量管理综合看板', Author: 'QMS' } });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.font(fontPath).fontSize(18).text('质量管理综合看板');
    document.fontSize(9).text(`生成时间：${context.generatedAt}`);
    document.text(`统计范围：${context.from ?? '未指定'} 至 ${context.to ?? '未指定'}`);
    document.moveDown().fontSize(10);
    for (const card of cards) {
      document.text(`${card.domain} / ${card.metricCode} ${card.metricName}：${card.latestValue ?? '—'} ${card.unit} · ${card.status}`);
      document.fontSize(8).text(`来源：${card.sourceSystem ?? '—'} / ${card.sourceRecordKey ?? '—'} · 期间：${card.periodStart ?? '—'} 至 ${card.periodEnd ?? '—'}`).fontSize(10);
    }
    document.end();
  });
}

export async function renderQualityManagementReport(cards: ReportCard[], context: ReportContext, format: 'xlsx' | 'pdf') {
  const content = format === 'xlsx' ? await xlsx(cards, context) : await pdf(cards, context);
  return { content, contentType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf' };
}
