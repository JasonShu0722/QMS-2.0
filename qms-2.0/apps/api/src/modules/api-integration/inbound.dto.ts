import { ApiProperty } from '@nestjs/swagger';

export class InboundReceiptDto {
  @ApiProperty({ format: 'uuid' }) receiptId!: string;
  @ApiProperty({ format: 'uuid', description: '服务端分配的本次接收检索编号。' }) messageId!: string;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ enum: ['RECEIVED'] }) status!: 'RECEIVED';
}

export type InboundIdentity = { organizationId: string; endpointId: string; credentialId: string; secretDigest: string };
export type InboundResult = Omit<InboundIdentity, 'secretDigest'> & {
  statusCode: 200;
  receipt: InboundReceiptDto;
  traceId: string;
  configurationVersion: number;
  returnReceipt: boolean;
};

export const INBOUND_RESULT = Symbol('INBOUND_RESULT');
export const INBOUND_CONFIGURATION = Symbol('INBOUND_CONFIGURATION');
export type InboundConfigurationContext = { [INBOUND_CONFIGURATION]?: { version: number; returnReceipt: boolean } };
