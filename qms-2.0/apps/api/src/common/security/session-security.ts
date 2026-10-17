import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';

export const RECENT_AUTHENTICATION_MS = 5 * 60 * 1000;

export function isSecurityConcurrencyConflict(error: unknown): boolean {
  const failure = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
  const databaseCode = failure.meta?.code ?? failure.meta?.driverAdapterError?.cause?.originalCode;
  return failure.code === 'P2034' || databaseCode === '40P01' || databaseCode === '40001';
}

export function securityError(code: string, status = 401): never {
  throw new HttpException({ code, message: code }, status);
}

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function isGovernancePermission(code: string): boolean {
  return /^(account:users:(create|update|status|transfer|reset)|account:roles:(create|update|delete|assign)|organization:manage|organization:structure:manage|organization:positions:assign|configuration:manage|outbox:retry)$/.test(code);
}

export async function mfaPolicy(transaction: Prisma.TransactionClient, userId: string) {
  const assignments = await transaction.userRole.findMany({ where: { userId }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  const facts = assignments.map(({ role, organizationId }) => ({ id: role.id, organizationId, required: role.mfaRequired, permissions: role.permissions.map(({ permission }) => permission.code).sort() })).sort((first, second) => `${first.id}:${first.organizationId}`.localeCompare(`${second.id}:${second.organizationId}`));
  return { required: facts.some((role) => role.required || role.permissions.some(isGovernancePermission)), digest: digest(JSON.stringify(facts)) };
}

export async function assertActiveAuthentication(transaction: Prisma.TransactionClient, actor: { id: string; sessionId: string }) {
  await transaction.$queryRaw`SELECT id FROM users WHERE id = ${actor.id}::uuid FOR UPDATE`;
  const user = await transaction.user.findUnique({ where: { id: actor.id }, include: { organization: true } });
  if (!actor.sessionId || !user || user.status !== 'ACTIVE' || user.organization.status !== 'ACTIVE' || user.mustChangePassword) securityError('AUTH_SESSION_REQUIRED');
  await transaction.$queryRaw`SELECT id FROM organizations WHERE id = ${user.organizationId}::uuid FOR SHARE`;
  const organization = await transaction.organization.findUnique({ where: { id: user.organizationId }, select: { status: true } });
  if (organization?.status !== 'ACTIVE') securityError('AUTH_SESSION_REQUIRED');
  await transaction.$queryRaw`SELECT id FROM sessions WHERE id = ${actor.sessionId}::uuid FOR UPDATE`;
  const session = await transaction.session.findFirst({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() }, securityVersion: user.securityVersion } });
  if (!session) securityError('AUTH_SESSION_REQUIRED');
  const policy = await mfaPolicy(transaction, user.id);
  if ((policy.required || user.mfaEnabled) && !session.mfaVerifiedAt) securityError('AUTH_MFA_REQUIRED');
  return { user, session, policy };
}

export async function assertRecentAuthentication(transaction: Prisma.TransactionClient, actor: { id: string; sessionId: string }) {
  const authentication = await assertActiveAuthentication(transaction, actor);
  const verifiedAt = authentication.session.reauthenticatedAt;
  if (!verifiedAt || verifiedAt.getTime() <= Date.now() - RECENT_AUTHENTICATION_MS) securityError('AUTH_REAUTHENTICATION_REQUIRED', 403);
  return authentication;
}
