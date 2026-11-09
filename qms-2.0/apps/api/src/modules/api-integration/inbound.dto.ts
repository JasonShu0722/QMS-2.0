import { ApiProperty } from '@nestjs/swagger';

export class InboundReceiptDto {
  @ApiProperty({ format: 'uuid' }) receiptId!: string;
  @ApiProperty({ minLength: 8, maxLength: 128 }) messageId!: string;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ enum: ['RECEIVED'] }) status!: 'RECEIVED';
  @ApiProperty() duplicate!: boolean;
}

export type InboundIdentity = { organizationId: string; endpointId: string; credentialId: string; secretDigest: string };
export type InboundResult = Omit<InboundIdentity, 'secretDigest'> & {
  statusCode: 200 | 201 | 204;
  receipt: InboundReceiptDto;
  traceId: string;
  configurationVersion: number;
  returnReceipt: boolean;
};

export const INBOUND_RESULT = Symbol('INBOUND_RESULT');
export const INBOUND_CONFIGURATION = Symbol('INBOUND_CONFIGURATION');
export type InboundConfigurationContext = { [INBOUND_CONFIGURATION]?: { version: number; returnReceipt: boolean } };
