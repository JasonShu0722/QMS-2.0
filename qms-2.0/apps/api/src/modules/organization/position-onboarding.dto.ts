import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsUUID } from 'class-validator';

export class PositionAuthorizationPreviewInputDto {
  @ApiProperty({ type: [String], maxItems: 100, description: '目标组织内的岗位 ID，空数组用于预览撤销全部任职。' })
  @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true })
  positionIds!: string[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID()
  targetUserId?: string;
}

export class PositionAuthorizationSourceDto {
  @ApiProperty() roleId!: string;
  @ApiProperty() roleCode!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [String] }) permissionCodes!: string[];
  @ApiProperty() mfaRequired!: boolean;
}

export class PositionAuthorizationDepartmentDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}

export class UserPositionSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: PositionAuthorizationDepartmentDto }) department!: PositionAuthorizationDepartmentDto;
}

export class PositionAuthorizationItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: PositionAuthorizationDepartmentDto }) department!: PositionAuthorizationDepartmentDto;
  @ApiProperty() version!: number;
  @ApiProperty() roleVersion!: number;
  @ApiProperty({ type: [String] }) permissionCodes!: string[];
  @ApiProperty() mfaRequired!: boolean;
  @ApiProperty({ type: [PositionAuthorizationSourceDto] }) historicalSources!: PositionAuthorizationSourceDto[];
}

export class PositionAuthorizationPreviewDto {
  @ApiProperty() authorizationBaseline!: string;
  @ApiProperty({ type: [PositionAuthorizationItemDto] }) positions!: PositionAuthorizationItemDto[];
  @ApiProperty({ type: [String] }) effectivePermissionCodes!: string[];
  @ApiProperty({ description: '候选岗位及保留直接角色的 MFA 要求并集，不代替账户级 MFA 策略。' }) effectiveMfaRequired!: boolean;
  @ApiPropertyOptional({ type: [PositionAuthorizationSourceDto] }) retainedSources?: PositionAuthorizationSourceDto[];
}
