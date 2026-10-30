import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { components } from '@qms/contracts';
import { PositionSelector } from './PositionSelector';
import type { AuthorizationPreview, PositionDirectory } from './position-authorization';

const directory: PositionDirectory = { departments: [], positions: [{ id: 'direct', organizationId: 'org', departmentId: null, categoryId: null, code: 'ADMIN', name: '组织管理员', status: 'ACTIVE', version: 1 }] };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); });

it('selects and previews an organization-direct position without inventing a department', async () => {
  const requests: unknown[] = [];
  const preview: components['schemas']['PositionAuthorizationPreviewDto'] = {
    authorizationBaseline: 'direct-baseline', positions: [{ id: 'direct', code: 'ADMIN', name: '组织管理员', department: null, version: 1, roleVersion: 1, permissionCodes: ['workbench:read'], mfaRequired: false, historicalSources: [] }], effectivePermissionCodes: ['workbench:read'], effectiveMfaRequired: false,
  };
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    requests.push(JSON.parse(String(init?.body)));
    return json(preview);
  }));
  function Editor() {
    const [value, setValue] = useState<string[]>([]);
    const [result, setResult] = useState<AuthorizationPreview>();
    return <PositionSelector organizationId="org" directory={directory} value={value} onChange={setValue} preview={result} onPreviewChange={setResult} />;
  }
  render(<Editor />);
  const input = screen.getByRole('combobox', { name: '任职岗位' });
  await waitFor(() => expect(input).toBeEnabled());
  expect(screen.queryByText('当前组织没有可用岗位')).not.toBeInTheDocument();
  fireEvent.mouseDown(input);
  fireEvent.click(await screen.findByText('组织管理员 · ADMIN', { selector: '.ant-select-item-option-content' }));
  fireEvent.click(screen.getByRole('button', { name: '预览授权' }));
  expect(await screen.findByText('组织直属 · 组织管理员')).toBeVisible();
  expect(requests).toEqual([{ positionIds: ['direct'] }]);
});

it('does not treat an unavailable department or a disabled direct position as an available direct grant', async () => {
  const unavailable: PositionDirectory = { departments: [], positions: [
    { ...directory.positions[0], id: 'disabled', status: 'DISABLED' },
    { ...directory.positions[0], id: 'orphan', departmentId: 'missing' },
  ] };
  render(<PositionSelector organizationId="org" directory={unavailable} value={[]} onChange={vi.fn()} onPreviewChange={vi.fn()} />);
  expect(await screen.findByText('当前组织没有可用岗位')).toBeVisible();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '任职岗位' }));
  expect(screen.getByText('组织管理员 · ADMIN', { selector: '.ant-select-item-option-content' }).closest('.ant-select-item-option')).toHaveClass('ant-select-item-option-disabled');
});
