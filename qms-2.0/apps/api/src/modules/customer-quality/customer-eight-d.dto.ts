import { ProcessEightDActivationDto, ProcessEightDAnalysisCompleteDto, ProcessEightDAssignmentOptionsDto, ProcessEightDAssignmentOptionsQueryDto, ProcessEightDBindingDto, ProcessEightDBindingResultDto, ProcessEightDCollaboratorsDto, ProcessEightDDeadlinesDto, ProcessEightDRiskDto, ProcessEightDScopeDto, ProcessEightDVersionDto, ReassignProcessEightDDto, SaveProcessEightDDto } from '../process-quality/process-eight-d.dto.js';
import { ProcessIssueResultDto } from '../process-quality/process-quality.dto.js';
import { InternalEightDHttpIssueDto, InternalEightDHttpSourcePreviewInputDto, InternalEightDHttpSourcePreviewDto, InternalEightDHttpSourcesDto, InternalEightDHttpReportDto } from '../../common/eight-d/internal-eight-d-http.dto.js';

export class CustomerEightDActivationDto extends ProcessEightDActivationDto {}
export class CustomerEightDAnalysisCompleteDto extends ProcessEightDAnalysisCompleteDto {}
export class CustomerEightDAssignmentOptionsDto extends ProcessEightDAssignmentOptionsDto {}
export class CustomerEightDAssignmentOptionsQueryDto extends ProcessEightDAssignmentOptionsQueryDto {}
export class CustomerEightDBindingDto extends ProcessEightDBindingDto {}
export class CustomerEightDBindingResultDto extends ProcessEightDBindingResultDto {}
export class CustomerEightDCollaboratorsDto extends ProcessEightDCollaboratorsDto {}
export class CustomerEightDDeadlinesDto extends ProcessEightDDeadlinesDto {}
export class CustomerEightDRiskDto extends ProcessEightDRiskDto {}
export class CustomerEightDScopeDto extends ProcessEightDScopeDto {}
export class CustomerEightDVersionDto extends ProcessEightDVersionDto {}
export class ReassignCustomerEightDDto extends ReassignProcessEightDDto {}
export class SaveCustomerEightDDto extends SaveProcessEightDDto {}
export class IssueCustomerEightDDto extends InternalEightDHttpIssueDto {}
export class CustomerEightDSourcePreviewInputDto extends InternalEightDHttpSourcePreviewInputDto {}
export class CustomerEightDSourcePreviewDto extends InternalEightDHttpSourcePreviewDto {}
export class CustomerEightDSourcesDto extends InternalEightDHttpSourcesDto {}
export class CustomerEightDReportDto extends InternalEightDHttpReportDto {}
export class CustomerEightDIssueResultDto extends ProcessIssueResultDto {}
