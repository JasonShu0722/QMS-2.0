import { ApiProperty } from '@nestjs/swagger';
import {
  PROBLEM_STATUSES, RESPONSE_FORMS,
  type ProblemDomainCode, type ProblemStatus, type ResponseForm,
} from '../../modules/problem-index/problem.types.js';
import {
  WORKFLOW_NODE_TYPES, WORKFLOW_VERSION_STATUSES,
  type WorkflowNodeType, type WorkflowVersionStatus,
} from '../../modules/workflow/workflow.types.js';
import {
  TASK_STATUSES, NOTIFICATION_STATUSES,
  type TaskStatus, type NotificationStatus,
} from '../../modules/task-notification/task.types.js';
import { PLATFORM_ERROR_CODES, type PlatformErrorCode } from './platform-error.js';

export class PlatformTypesDto {
  @ApiProperty({ type: String, example: 'neutral-test', description: 'Stable code owned by the domain service.' })
  problemDomainCode!: ProblemDomainCode;

  @ApiProperty({ enum: PROBLEM_STATUSES, enumName: 'ProblemStatus' })
  problemStatus!: ProblemStatus;

  @ApiProperty({ enum: RESPONSE_FORMS, enumName: 'ResponseForm' })
  responseForm!: ResponseForm;

  @ApiProperty({ enum: WORKFLOW_NODE_TYPES, enumName: 'WorkflowNodeType' })
  workflowNodeType!: WorkflowNodeType;

  @ApiProperty({ enum: WORKFLOW_VERSION_STATUSES, enumName: 'WorkflowVersionStatus' })
  workflowVersionStatus!: WorkflowVersionStatus;

  @ApiProperty({ enum: TASK_STATUSES, enumName: 'TaskStatus' })
  taskStatus!: TaskStatus;

  @ApiProperty({ enum: NOTIFICATION_STATUSES, enumName: 'NotificationStatus' })
  notificationStatus!: NotificationStatus;

  @ApiProperty({ enum: PLATFORM_ERROR_CODES, enumName: 'PlatformErrorCode' })
  platformErrorCode!: PlatformErrorCode;
}
