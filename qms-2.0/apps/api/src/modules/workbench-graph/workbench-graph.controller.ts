import { Body, Controller, ForbiddenException, Get, Header, Param, Patch, Req, UnauthorizedException } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { UpdateWorkbenchGraphStatusDto, WorkbenchGraphDto, WorkbenchGraphNodeDto } from './workbench-graph.dto.js';
import { WorkbenchGraphService } from './workbench-graph.service.js';

function internalSession(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION];
  if (!session) throw new UnauthorizedException({ code: 'AUTH_SESSION_REQUIRED', message: '请先登录' });
  if (session.user.accountType !== 'INTERNAL') {
    throw new ForbiddenException({ code: 'FEATURE_PERMISSION_DENIED', message: '仅内部账号可查看工作台功能图谱' });
  }
  return session;
}

@Controller('api/v1/workbench')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class WorkbenchGraphController {
  constructor(private readonly graph: WorkbenchGraphService) {}

  @Get('graph')
  @RequireAuthenticated()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: WorkbenchGraphDto })
  getGraph(@Req() request: AuthorizedRequest): Promise<WorkbenchGraphDto> {
    return this.graph.getGraph(internalSession(request).user);
  }

  @Patch('graph/nodes/:id/status')
  @RequireAuthenticated()
  @Header('Cache-Control', 'no-store')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiOkResponse({ type: WorkbenchGraphNodeDto })
  @ApiResponse({ status: 400, type: ErrorResponse, description: '状态、版本或依据不合法' })
  @ApiResponse({ status: 403, type: ErrorResponse, description: '仅有效平台管理员可调整状态' })
  @ApiResponse({ status: 404, type: ErrorResponse, description: '节点不存在' })
  @ApiResponse({ status: 409, type: ErrorResponse, description: '状态版本冲突，请刷新后重试' })
  updateNodeStatus(@Req() request: AuthorizedRequest, @Param('id') id: string, @Body() body: UpdateWorkbenchGraphStatusDto): Promise<WorkbenchGraphNodeDto> {
    return this.graph.updateNodeStatus(internalSession(request), id, body, requestTraceId(request));
  }
}
