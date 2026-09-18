import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
@Injectable() export class NotificationService { constructor(private readonly prisma: PrismaService) {} create(input: any) { return (this.prisma as any).notification.create({ data: input }); } list(organizationId: string, recipientUserId: string) { return (this.prisma as any).notification.findMany({ where: { organizationId, recipientUserId } }); } }
