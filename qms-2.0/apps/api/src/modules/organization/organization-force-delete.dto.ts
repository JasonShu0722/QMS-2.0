import { ApiProperty } from '@nestjs/swagger';
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

export class OrganizationForceDeletePreviewDto {
  @ApiProperty({ enum: ['ORGANIZATION', 'DEPARTMENT'] }) kind!: 'ORGANIZATION' | 'DEPARTMENT';
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ description: '绑定实际操作者、范围、实体及引用版本的影响基线', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 }) previewToken!: string;
  @ApiProperty({ type: OrganizationForceDeleteCountsDto }) counts!: OrganizationForceDeleteCountsDto;
  @ApiProperty({ type: [String] }) retainedHistory!: string[];
}

export class OrganizationForceDeleteResultDto extends OrganizationForceDeletePreviewDto {
  @ApiProperty({ format: 'date-time' }) deletedAt!: string;
  @ApiProperty({ type: [OrganizationForceDeleteEffectDto] }) effects!: OrganizationForceDeleteEffectDto[];
}
