import { Controller, ForbiddenException, Get, Header, Req, UnauthorizedException } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import catalog from './workbench-catalog.json' with { type: 'json' };
import { WorkbenchGraphDto } from './workbench-graph.dto.js';

const graph: WorkbenchGraphDto = {
  version: catalog.version,
  nodes: catalog.nodes.map(({ id, name, domain, entry, aliases, status, summary, plan, guide, statusUpdatedOn }: typeof catalog.nodes[number] & { statusUpdatedOn?: string }) => ({
    id, name, domain, entry, aliases, status: status as WorkbenchGraphDto['nodes'][number]['status'], summary, plan,
    statusUpdatedOn: statusUpdatedOn ?? catalog.statusBaselineDate,
    guide: {
      title: guide.title, version: guide.version, role: guide.role, prerequisites: guide.prerequisites,
      steps: guide.steps, result: guide.result, exceptions: guide.exceptions,
    },
  })),
  relations: catalog.relations.map(({ id, from, to, name, kind, status, trigger, content, result, exceptions }) => ({
    id, from, to, name, kind: kind as WorkbenchGraphDto['relations'][number]['kind'],
    status: status as WorkbenchGraphDto['relations'][number]['status'], trigger, content, result, exceptions,
  })),
};

@Controller('api/v1/workbench')
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class WorkbenchGraphController {
  @Get('graph')
  @RequireAuthenticated()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: WorkbenchGraphDto })
  getGraph(@Req() request: AuthorizedRequest): WorkbenchGraphDto {
    const user = request[AUTHENTICATED_SESSION]?.user;
    if (!user) throw new UnauthorizedException({ code: 'AUTH_SESSION_REQUIRED', message: '请先登录' });
    if (user.accountType !== 'INTERNAL') {
      throw new ForbiddenException({ code: 'FEATURE_PERMISSION_DENIED', message: '仅内部账号可查看工作台功能图谱' });
    }
    return graph;
  }
}
