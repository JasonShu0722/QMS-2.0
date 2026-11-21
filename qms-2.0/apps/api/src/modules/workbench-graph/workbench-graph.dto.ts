import { ApiProperty } from '@nestjs/swagger';

const nodeStatuses = ['idea', 'development', 'live'] as const;
const relationKinds = ['data', 'configuration', 'handoff'] as const;
const relationStatuses = ['effective', 'configuration', 'planned', 'unverified'] as const;

class WorkbenchGraphGuideDto {
  @ApiProperty() title!: string;
  @ApiProperty() version!: string;
  @ApiProperty() role!: string;
  @ApiProperty() prerequisites!: string;
  @ApiProperty({ type: [String] }) steps!: string[];
  @ApiProperty() result!: string;
  @ApiProperty() exceptions!: string;
}

class WorkbenchGraphNodeDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() domain!: string;
  @ApiProperty() entry!: string;
  @ApiProperty({ type: [String] }) aliases!: string[];
  @ApiProperty({ enum: nodeStatuses }) status!: typeof nodeStatuses[number];
  @ApiProperty({ format: 'date' }) statusUpdatedOn!: string;
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
  @ApiProperty({ type: [WorkbenchGraphNodeDto] }) nodes!: WorkbenchGraphNodeDto[];
  @ApiProperty({ type: [WorkbenchGraphRelationDto] }) relations!: WorkbenchGraphRelationDto[];
}
