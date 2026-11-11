import { Controller, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiParam, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { InboundReceiptDto, INBOUND_RESULT } from './inbound.dto.js';
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
  @ApiResponse({ status: 201, type: InboundReceiptDto })
  @ApiResponse({ status: 204, description: '接收成功，接口配置关闭回执正文。' })
  @ApiResponse({ status: 'default', type: ErrorResponse })
  async receive(@Req() request: InboundRequest, @Res({ passthrough: true }) response: Response): Promise<InboundReceiptDto | undefined> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.inbound.receive(request, request[INBOUND_IDENTITY]!);
      request[INBOUND_RESULT] = result;
      response.status(result.statusCode);
      return result.returnReceipt ? result.receipt : undefined;
    } catch (error) {
      if (error instanceof InboundRateLimitException) response.setHeader('Retry-After', String(error.retryAfter));
      throw error;
    }
  }
}
