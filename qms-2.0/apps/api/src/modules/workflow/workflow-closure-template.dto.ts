import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

export class CreateWorkflowClosureTemplateDto {
  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] }) @IsIn(['INTERNAL', 'SUPPLIER']) policy!: 'INTERNAL' | 'SUPPLIER';
  @ApiProperty({ maxLength: 100 }) @IsString() @Matches(/^\S(?:.*\S)?$/) @MaxLength(100) domainCode!: string;
  @ApiProperty({ maxLength: 100 }) @IsString() @Matches(/\S/) @MaxLength(100) code!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @Matches(/\S/) @MaxLength(200) name!: string;
}

export class WorkflowClosureTemplateCandidateDto {
  @ApiProperty({ enum: ['INTERNAL', 'SUPPLIER'] }) policy!: 'INTERNAL' | 'SUPPLIER';
  @ApiProperty() name!: string;
}

export class WorkflowClosureTemplatesDto {
  @ApiProperty({ type: [WorkflowClosureTemplateCandidateDto], minItems: 2, maxItems: 2 }) items!: WorkflowClosureTemplateCandidateDto[];
}
