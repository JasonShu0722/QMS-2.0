import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlatformAdministratorScopeDto } from './platform-administrator-scope.dto.js';

export class AccountOverviewQueryDto {}

export class AccountAssignmentNameDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}
export class AccountAssignmentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) startedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endedAt!: string | null;
  @ApiProperty({ type: AccountAssignmentNameDto }) position!: AccountAssignmentNameDto;
  @ApiProperty({ type: AccountAssignmentNameDto }) department!: AccountAssignmentNameDto;
}
export class AccountRoleSourceDto {
  @ApiProperty({ enum: ['DIRECT', 'POSITION'] }) kind!: 'DIRECT' | 'POSITION';
  @ApiPropertyOptional({ format: 'uuid' }) positionId?: string;
  @ApiPropertyOptional() positionName?: string;
  @ApiPropertyOptional({ format: 'uuid' }) assignmentId?: string;
}
export class AccountEffectiveRoleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: [AccountRoleSourceDto] }) sources!: AccountRoleSourceDto[];
  @ApiPropertyOptional({ type: PlatformAdministratorScopeDto }) platformScope?: PlatformAdministratorScopeDto;
}
export class AccountOverviewDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: [AccountAssignmentDto] }) assignments!: AccountAssignmentDto[];
  @ApiProperty({ type: [AccountEffectiveRoleDto] }) effectiveRoles!: AccountEffectiveRoleDto[];
  @ApiProperty({ type: [String] }) permissions!: string[];
}
