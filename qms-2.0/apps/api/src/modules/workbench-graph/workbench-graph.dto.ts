import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const nodeStatuses = ['idea', 'development', 'live'] as const;
const maxStatusVersion = 2147483647;
const relationKinds = ['data', 'configuration', 'handoff'] as const;
const relationStatuses = ['effective', 'configuration', 'planned', 'unverified'] as const;

export class UpdateWorkbenchGraphStatusDto {
  @ApiProperty({ enum: nodeStatuses })
  @IsIn(nodeStatuses)
  status!: typeof nodeStatuses[number];

  @ApiProperty({ type: 'integer', minimum: 0, maximum: maxStatusVersion })
  @IsInt()
  @Min(0)
  @Max(maxStatusVersion)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 500, description: '发布和认可依据；状态为 live 时必填' })
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @ValidateIf((body: UpdateWorkbenchGraphStatusDto, value: unknown) => body.status === 'live' || value !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @Matches(/^[^\u0000]+$/u)
  evidence?: string;
}

class WorkbenchGraphGuideDto {
  @ApiProperty() title!: string;
  @ApiProperty() version!: string;
  @ApiProperty() role!: string;
  @ApiProperty() prerequisites!: string;
  @ApiProperty({ type: [String] }) steps!: string[];
  @ApiProperty() result!: string;
  @ApiProperty() exceptions!: string;
}

export class WorkbenchGraphNodeDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() domain!: string;
  @ApiProperty() entry!: string;
  @ApiProperty({ type: [String] }) aliases!: string[];
  @ApiProperty({ enum: nodeStatuses }) status!: typeof nodeStatuses[number];
  @ApiProperty({ format: 'date' }) statusUpdatedOn!: string;
  @ApiProperty({ type: 'integer', minimum: 0 }) statusVersion!: number;
  @ApiProperty() summary!: string;
  @ApiProperty() plan!: string;
  @ApiProperty({ type: WorkbenchGraphGuideDto }) guide!: WorkbenchGraphGuideDto;
}

class WorkbenchGraphRelationDto {
  @ApiProperty() id!: string;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: relationKinds }) kind!: typeof relationKinds[number];
  @ApiProperty({ enum: relationStatuses }) status!: typeof relationStatuses[number];
  @ApiProperty() trigger!: string;
  @ApiProperty() content!: string;
  @ApiProperty() result!: string;
  @ApiProperty() exceptions!: string;
}

export class WorkbenchGraphDto {
  @ApiProperty() version!: string;
  @ApiProperty() canEditStatus!: boolean;
  @ApiProperty({ type: [WorkbenchGraphNodeDto] }) nodes!: WorkbenchGraphNodeDto[];
  @ApiProperty({ type: [WorkbenchGraphRelationDto] }) relations!: WorkbenchGraphRelationDto[];
}
