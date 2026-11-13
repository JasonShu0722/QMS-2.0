import { Controller, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiParam, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { INBOUND_RESULT } from './inbound.dto.js';
import { INBOUND_IDENTITY, RequireInboundMachine, type InboundRequest } from './inbound.guard.js';
import { InboundRateLimitException, InboundService } from './inbound.service.js';

@Controller('api/v1/integrations/inbound')
export class InboundController {
  constructor(private readonly inbound: InboundService) {}

  @Post(':endpointId/messages')
  @RequireInboundMachine()
  @ApiParam({ name: 'endpointId', required: true, description: '接口编码（区分大小写），或原有接口 UUID。', schema: { type: 'string', maxLength: 64 } })
  @ApiHeader({ name: 'Authorization', required: true })
  @ApiBody({ schema: { type: 'array', items: { type: 'object', additionalProperties: true } } })
  @ApiResponse({ status: 200, schema: { type: 'boolean', enum: [true], example: true }, description: '接收成功；开启回执返回 JSON true，关闭回执无正文。' })
  @ApiResponse({ status: 'default', type: ErrorResponse })
  async receive(@Req() request: InboundRequest, @Res({ passthrough: true }) response: Response): Promise<true | undefined> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.inbound.receive(request, request[INBOUND_IDENTITY]!);
      request[INBOUND_RESULT] = result;
      response.status(200);
      if (result.returnReceipt) response.type('application/json');
      return result.returnReceipt ? true : undefined;
    } catch (error) {
      if (error instanceof InboundRateLimitException) response.setHeader('Retry-After', String(error.retryAfter));
      throw error;
    }
  }
}
