import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOkResponse, ApiResponse } from '@nestjs/swagger';
import { AUTHENTICATED_SESSION, type AuthorizedRequest } from '../../common/guards/authenticated.guard.js';
import { ErrorResponse } from '../../common/contracts/error-response.js';
import { requestTraceId } from '../../common/contracts/request-trace.js';
import { RequireAuthenticated } from '../authorization/access.decorator.js';
import { FileLifecycleService } from './file-lifecycle.service.js';
import { FileDto, FileDownloadDto, FileDownloadRequestDto, FileMutationDto, FileUploadDto, InitializeFileUploadDto } from './file.dto.js';

function actor(request: AuthorizedRequest) {
  const session = request[AUTHENTICATED_SESSION]!;
  return { ...session.user, sessionId: session.id };
}

@Controller('api/v1/files')
@RequireAuthenticated()
@ApiCookieAuth('qms_session')
@ApiResponse({ status: 'default', type: ErrorResponse })
export class FileController {
  constructor(private readonly files: FileLifecycleService) {}

  @Post('uploads')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 201, type: FileUploadDto })
  initialize(@Body() body: InitializeFileUploadDto, @Headers('idempotency-key') key: string, @Req() request: AuthorizedRequest) {
    return this.files.initializeUpload(actor(request), body, key, requestTraceId(request));
  }

  @Post(':id/complete')
  @HttpCode(202)
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiResponse({ status: 202, type: FileDto })
  complete(@Param('id', ParseUUIDPipe) id: string, @Body() body: FileMutationDto, @Headers('idempotency-key') key: string, @Req() request: AuthorizedRequest) {
    return this.files.complete(actor(request), id, body.expectedVersion, key, requestTraceId(request));
  }

  @Get(':id')
  @ApiOkResponse({ type: FileDto })
  get(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthorizedRequest) {
    return this.files.get(actor(request), id);
  }

  @Post(':id/download')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, type: FileDownloadDto })
  download(@Param('id', ParseUUIDPipe) id: string, @Body() _body: FileDownloadRequestDto, @Req() request: AuthorizedRequest) {
    return this.files.download(actor(request), id, requestTraceId(request));
  }

  @Post(':id/delete')
  @ApiHeader({ name: 'x-csrf-token', required: true })
  @ApiResponse({ status: 201, type: FileDto })
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() body: FileMutationDto, @Req() request: AuthorizedRequest) {
    return this.files.deleteLogically(actor(request), id, body.expectedVersion, requestTraceId(request));
  }
}
