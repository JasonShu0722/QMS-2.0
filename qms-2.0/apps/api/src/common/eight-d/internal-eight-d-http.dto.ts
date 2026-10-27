import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IssueProcessEightDDto, ProcessEightDReportDto, ProcessEightDSourceConfirmationDto, ProcessEightDSourceDto,
  ProcessEightDSourcePreviewDto, ProcessEightDSourcePreviewInputDto, ProcessEightDSourceSnapshotDto, ProcessEightDSourcesDto } from '../../modules/process-quality/process-eight-d.dto.js';

export class InternalEightDHttpSourceDto extends OmitType(ProcessEightDSourceDto, ['defectId'] as const) {
  @ApiProperty({ format: 'uuid' }) @IsUUID() sourceId!: string;
}

export class InternalEightDHttpSourceConfirmationDto extends OmitType(ProcessEightDSourceConfirmationDto, ['defectId'] as const) {
  @ApiProperty({ format: 'uuid' }) @IsUUID() sourceId!: string;
}

export class InternalEightDHttpIssueDto extends OmitType(IssueProcessEightDDto, ['sources', 'sourceConfirmations'] as const) {
  @ApiProperty({ type: [InternalEightDHttpSourceDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InternalEightDHttpSourceDto) sources!: InternalEightDHttpSourceDto[];
  @ApiPropertyOptional({ type: [InternalEightDHttpSourceConfirmationDto] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InternalEightDHttpSourceConfirmationDto) sourceConfirmations?: InternalEightDHttpSourceConfirmationDto[];
}

export class InternalEightDHttpSourcePreviewInputDto extends OmitType(ProcessEightDSourcePreviewInputDto, ['sources'] as const) {
  @ApiProperty({ type: [InternalEightDHttpSourceDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InternalEightDHttpSourceDto) sources!: InternalEightDHttpSourceDto[];
}

export class InternalEightDHttpSourcePreviewDto extends OmitType(ProcessEightDSourcePreviewDto, ['defectId'] as const) {
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
}

export class InternalEightDHttpSourcesDto extends OmitType(ProcessEightDSourcesDto, ['add', 'removeDefectIds', 'primaryDefectId', 'sourceConfirmations'] as const) {
  @ApiProperty({ type: [InternalEightDHttpSourceDto] }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InternalEightDHttpSourceDto) add!: InternalEightDHttpSourceDto[];
  @ApiProperty({ type: [String], format: 'uuid' }) @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) removeSourceIds!: string[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() primarySourceId?: string;
  @ApiPropertyOptional({ type: [InternalEightDHttpSourceConfirmationDto] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => InternalEightDHttpSourceConfirmationDto) sourceConfirmations?: InternalEightDHttpSourceConfirmationDto[];
}

export class InternalEightDHttpSourceSnapshotDto extends OmitType(ProcessEightDSourceSnapshotDto, ['defectId'] as const) {
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
}

export class InternalEightDHttpReportDto extends OmitType(ProcessEightDReportDto, ['sources'] as const) {
  @ApiProperty({ type: [InternalEightDHttpSourceSnapshotDto] }) sources!: InternalEightDHttpSourceSnapshotDto[];
}
