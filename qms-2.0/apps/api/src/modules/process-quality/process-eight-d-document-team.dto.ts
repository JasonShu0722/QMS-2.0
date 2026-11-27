import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkflowClosureOptionsQueryDto } from '../workflow/workflow-closure-preview.dto.js';
import { IsOptional, IsUUID } from 'class-validator';

export class EightDTeamOptionsQueryDto extends WorkflowClosureOptionsQueryDto {}

export class InternalEightDTeamOptionsQueryDto extends EightDTeamOptionsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() organizationId?: string;
}

export class EightDTeamOptionDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) assignmentId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) department!: string | null;
  @ApiProperty({ type: String, nullable: true }) jobTitle!: string | null;
}

export class EightDTeamOptionsDto {
  @ApiProperty({ type: [EightDTeamOptionDto] }) items!: EightDTeamOptionDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
