import { ApiProperty } from '@nestjs/swagger';
import { ProcessEightDControlledReportDto, ProcessEightDReportQueryDto } from '../process-quality/process-eight-d-report.dto.js';

export class SupplierEightDReportQueryDto extends ProcessEightDReportQueryDto {}

export class SupplierEightDControlledReportDto extends ProcessEightDControlledReportDto {
  @ApiProperty({ format: 'uuid' }) supplierProblemId!: string;
}
