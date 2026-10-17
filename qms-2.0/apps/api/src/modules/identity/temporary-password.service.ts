import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { AdminTransaction } from '../../common/security/admin-mutation.service.js';
import { encryptSecret, decryptSecret } from '../../common/security/security-keyring.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordService } from './password.service.js';
import { replacePassword } from './password-credentials.js';
import type { TemporaryPasswordDto } from './dto/password-change-challenge.dto.js';

export const TEMPORARY_PASSWORD_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class TemporaryPasswordService {
  constructor(private readonly prisma: PrismaService, private readonly passwords: PasswordService) {}

  async reset(transaction: AdminTransaction, userId: string, suppliedPassword?: string) {
    const password = suppliedPassword ?? randomBytes(18).toString('base64url');
    const user = await replacePassword(transaction, userId, await this.passwords.hash(password), true);
    await this.store(transaction, user.id, user.credentialVersion, password);
    await transaction.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { userId, credentialVersion: user.credentialVersion };
  }

  async store(transaction: AdminTransaction, userId: string, credentialVersion: number, password: string) {
    const encryptedValue = encryptSecret(password, `temporary-password:${userId}:${credentialVersion}`);
    await transaction.userTemporaryPassword.create({ data: { userId, credentialVersion, encryptedValue, expiresAt: new Date(Date.now() + TEMPORARY_PASSWORD_LIFETIME_MS) } });
  }

  async project(transaction: AdminTransaction, userId: string, expectedVersion?: number): Promise<TemporaryPasswordDto> {
    const user = await transaction.user.findUniqueOrThrow({ where: { id: userId }, include: { temporaryPassword: true } });
    const value = user.temporaryPassword;
    if (!user.mustChangePassword || !value || value.credentialVersion !== user.credentialVersion || (expectedVersion !== undefined && expectedVersion !== user.credentialVersion)) return { userId, status: 'UNAVAILABLE' };
    if (value.expiresAt.getTime() <= Date.now()) return { userId, status: 'EXPIRED' };
    return { userId, status: 'AVAILABLE', credentialVersion: value.credentialVersion, expiresAt: value.expiresAt.toISOString(), temporaryPassword: decryptSecret(value.encryptedValue, `temporary-password:${userId}:${value.credentialVersion}`) };
  }

  purgeExpired() {
    return this.prisma.userTemporaryPassword.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  }
}
