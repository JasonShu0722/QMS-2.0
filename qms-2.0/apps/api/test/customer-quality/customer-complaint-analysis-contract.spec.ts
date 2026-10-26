import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { readFileSync } from 'node:fs';
import { SaveCustomerFaeAnalysisDto, SaveCustomerSupplierAnalysisDto } from '../../src/modules/customer-quality/customer-complaint-analysis.dto.js';

describe('analysis contract and isolation', () => {
  it('requires only the version for optional content, not date/material/receiving quantity', () => {
    for (const dto of [SaveCustomerFaeAnalysisDto, SaveCustomerSupplierAnalysisDto]) {
      expect(validateSync(plainToInstance(dto, { expectedVersion: 1 }))).toEqual([]);
      expect(validateSync(plainToInstance(dto, { expectedVersion: 1, receivedQuantity: 2 }), { whitelist: true, forbidNonWhitelisted: true })).not.toEqual([]);
    }
  });
  it('uses only public source access and never creates workflow tasks or mutates the ledger', () => {
    const source = readFileSync('src/modules/customer-quality/customer-complaint-analysis.service.ts', 'utf8');
    expect(source).toContain('this.ledger.readCase(');
    expect(source).not.toMatch(/customerQualityComplaint\.|(?:FROM|UPDATE|INTO)\s+customer_quality_complaints|workflowTask\.(?:create|upsert)|INSERT INTO workflow_tasks/i);
    expect(source).toContain('assertAttachable(');
    expect(source).toContain('authorizeFile(');
  });
  it('preserves immutable snapshots in the SQL-owned migration without a Prisma model', () => {
    const sql = readFileSync('prisma/migrations/20261026231000_customer_complaint_analysis/migration.sql', 'utf8');
    expect(sql).toContain('BEFORE UPDATE OR DELETE');
    expect(sql).toContain('UNIQUE (organization_id, complaint_id, section)');
    expect(sql).not.toMatch(/ALTER TABLE customer_quality_complaints/);
  });
});
