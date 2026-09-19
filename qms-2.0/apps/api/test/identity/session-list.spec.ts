import { jest } from '@jest/globals';
import { SessionService } from '../../src/modules/identity/session.service.js';

it('only queries unrevoked unexpired account sessions', async () => {
  const prisma = { session: { findMany: jest.fn().mockResolvedValue([]) } };
  const service = new SessionService(prisma as never, {} as never);
  await service.listForUser('user', 'session');
  expect(prisma.session.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user', revokedAt: null, expiresAt: { gt: expect.any(Date) } } }));
});
