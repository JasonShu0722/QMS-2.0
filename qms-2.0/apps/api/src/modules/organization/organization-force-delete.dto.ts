import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsBoolean, IsInt, IsString, Matches, Min } from 'class-validator';

export class OrganizationForceDeleteDto {
  @ApiProperty({ minimum: 1, type: Number })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ enum: [true], type: Boolean })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;

  @ApiProperty({ description: '本次预览的服务端影响基线；引用变化后须刷新预览再确认', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 })
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  previewToken!: string;
}

export class OrganizationForceDeleteCountsDto {
  @ApiProperty() users!: number;
  @ApiProperty() departments!: number;
  @ApiProperty() positions!: number;
  @ApiProperty() organizations!: number;
  @ApiProperty() assignments!: number;
  @ApiProperty() managementBindings!: number;
  @ApiProperty() ministerScopes!: number;
}

export class OrganizationForceDeleteEffectDto {
  @ApiProperty() module!: string;
  @ApiProperty() changed!: number;
  @ApiProperty() pendingConfiguration!: number;
}

export class PositionDeletionAffectedUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() pendingConfiguration!: boolean;
}

export class PositionDeletionAffectedAssignmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endedAt!: string | null;
}

export class PositionDeletionReferenceDto {
  @ApiProperty() source!: string;
  @ApiProperty() count!: number;
}

export class PositionDeletionImpactDto {
  @ApiProperty({ type: [PositionDeletionAffectedUserDto] }) users!: PositionDeletionAffectedUserDto[];
  @ApiProperty({ type: [PositionDeletionAffectedAssignmentDto] }) assignments!: PositionDeletionAffectedAssignmentDto[];
  @ApiProperty({ type: [PositionDeletionReferenceDto] }) responsibilities!: PositionDeletionReferenceDto[];
  @ApiProperty({ type: [PositionDeletionReferenceDto] }) configurations!: PositionDeletionReferenceDto[];
}

export class OrganizationForceDeletePreviewDto {
  @ApiProperty({ enum: ['ORGANIZATION', 'DEPARTMENT', 'POSITION'] }) kind!: 'ORGANIZATION' | 'DEPARTMENT' | 'POSITION';
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ description: '绑定实际操作者、范围、实体及引用版本的影响基线', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 }) previewToken!: string;
  @ApiProperty({ type: OrganizationForceDeleteCountsDto }) counts!: OrganizationForceDeleteCountsDto;
  @ApiProperty({ type: [String] }) retainedHistory!: string[];
  @ApiPropertyOptional({ type: PositionDeletionImpactDto }) positionImpact?: PositionDeletionImpactDto;
}

export class OrganizationForceDeleteResultDto extends OrganizationForceDeletePreviewDto {
  @ApiProperty({ format: 'date-time' }) deletedAt!: string;
  @ApiProperty({ type: [OrganizationForceDeleteEffectDto] }) effects!: OrganizationForceDeleteEffectDto[];
}
