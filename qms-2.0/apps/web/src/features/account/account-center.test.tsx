import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountCenterPage } from './AccountCenterPage';

const api = vi.hoisted(() => ({
  getAccountProfile: vi.fn(),
  getAccountSessions: vi.fn(),
  updateAccountProfile: vi.fn(),
  changeAccountPassword: vi.fn(),
  revokeAccountSession: vi.fn(),
}));

vi.mock('../../api/client', () => api);

describe('account center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAccountProfile.mockResolvedValue({ id: 'u1', username: 'alice', email: 'alice@example.test', accountType: 'INTERNAL', status: 'ACTIVE', mfaEnabled: false, organization: { id: 'o1', code: 'internal', name: 'Internal' } });
    api.getAccountSessions.mockResolvedValue([{ id: 's1', createdAt: '2026-09-18T00:00:00.000Z', expiresAt: '2026-09-18T08:00:00.000Z', revokedAt: null, isCurrent: true }]);
  });

  it('loads profile and current session without exposing credential fields', async () => {
    render(<AccountCenterPage />);
    expect(await screen.findByText('alice')).toBeTruthy();
    expect(screen.getByText('Internal · 内部账号')).toBeTruthy();
    await waitFor(() => expect(api.getAccountSessions).toHaveBeenCalledOnce());
    expect(screen.queryByText(/passwordHash|tokenHash/i)).toBeNull();
  });
});
