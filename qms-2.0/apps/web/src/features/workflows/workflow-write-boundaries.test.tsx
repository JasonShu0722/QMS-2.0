import { transferableAbortController } from 'node:util';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerReauthentication } from '../../api/client';
import { LanguageProvider } from '../../i18n/Language';
import { UnsavedChangesProvider, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { WorkflowDesignerPage } from './WorkflowDesignerPage';
import { WorkflowListPage } from './WorkflowListPage';
import { createWorkflow } from './workflow-api';

vi.mock('./WorkflowCanvas', () => ({ WorkflowCanvas: () => <div>Canvas</div> }));
vi.mock('./ProcessEightDBinding', () => ({ ProcessEightDBinding: () => null }));
const base = '/api/v1/workflows';
const graph = { nodes: [{ id: 'start', type: 'ACTION', name: '调查', config: { isStart: true } }, { id: 'end', type: 'CLOSE', name: '关闭', config: { isEnd: true } }], transitions: [] };
const definition = { id: 'definition', organizationId: 'org', name: '质量流程', code: 'QA', revision: 3, description: '', version: { id: 'version', status: 'DRAFT', version: 1, structureSnapshot: graph } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const writes: { path: string; init: RequestInit }[] = [];
let intercept: (path: string, init: RequestInit) => Promise<Response | undefined>;
let published = false;
beforeEach(() => {
  localStorage.clear(); useWorkTabsStore.getState().reset(); useWorkTabsStore.getState().bindSession('INTERNAL:org:user');
  vi.stubGlobal('AbortController', function () { return transferableAbortController(); });
  writes.length = 0; published = false; intercept = async () => undefined;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit = {}) => {
    if (init.method && init.method !== 'GET') writes.push({ path, init });
    const intercepted = await intercept(path, init);
    if (intercepted) return intercepted;
    if (path.endsWith('/csrf')) return json({ csrfToken: 'csrf' });
    if (path.includes('/options?')) return json({ roles: [], users: [], permissions: [] });
    if (path === `${base}/validate`) return json({ valid: true, errors: [] });
    if (path === `${base}/definition/draft`) return json({ ...definition, revision: 4, description: '原草稿', version: { ...definition.version, structureSnapshot: graph } });
    if (path === `${base}/definition/publish`) return json({ ...definition, revision: 5, version: { ...definition.version, status: 'PUBLISHED' } });
    if (path === `${base}/definition/copy` || path === base) return json({ ...definition, version: { ...definition.version, id: 'copied' } });
    if (path.startsWith(`${base}?`)) return json({ items: [], total: 0 });
    return json({ ...definition, version: { ...definition.version, status: published ? 'PUBLISHED' : 'DRAFT' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());
function mount(list = false) {
  function Page() { useUnsavedChanges(true); return list ? <WorkflowListPage /> : <WorkflowDesignerPage definitionId="definition" versionId="version" />; }
  const router = createMemoryRouter([
    { path: '/app/workflow-designer', element: <LanguageProvider><UnsavedChangesProvider><Page /></UnsavedChangesProvider></LanguageProvider> },
    { path: '/app/workflow-designer/definition/copied', element: <p>复制目的页</p> },
    { path: '/login', element: <p>登录目的页</p> },
  ], { initialEntries: ['/app/workflow-designer'] });
  render(<RouterProvider router={router} />); return router;
}
async function createInput() {
  fireEvent.click(await screen.findByRole('button', { name: '新建流程' }));
  fireEvent.change(screen.getByLabelText('流程代码'), { target: { value: 'NEW' } });
  fireEvent.change(screen.getByLabelText('流程名称'), { target: { value: '新流程' } });
}
it.each(['保存草稿', '发布流程', '复制为新草稿', '创建草稿'])('blocks suspended CSRF across scope change from real parent %s', async label => {
  published = label === '复制为新草稿';
  let finish!: (response: Response) => void;
  intercept = async path => path.endsWith('/csrf') ? new Promise(resolve => { finish = resolve; }) : undefined;
  mount(label === '创建草稿');
  if (label === '创建草稿') await createInput();
  await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:new-org:other-user'));
  const csrfSignal = vi.mocked(fetch).mock.calls.find(([path]) => String(path).endsWith('/csrf'))?.[1]?.signal;
  expect(csrfSignal?.aborted).toBe(true);
  await act(async () => finish(json({ csrfToken: 'new-cookie-token' })));
  expect(writes).toHaveLength(0);
});
it.each(['validate', 'draft', 'publish', 'copy'])('freezes exact unknown stage %s and retries only its raw body and key', async stage => {
  published = stage === 'copy';
  const path = stage === 'validate' ? `${base}/validate` : `${base}/definition/${stage}`;
  let attempts = 0;
  intercept = async target => { if (target === path && ++attempts <= 2) throw new TypeError('unknown'); return undefined; };
  const router = mount();
  const label = stage === 'copy' ? '复制为新草稿' : '发布流程';
  await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
  if (stage !== 'copy') fireEvent.change(screen.getByLabelText('流程说明'), { target: { value: '原草稿' } });
  fireEvent.click(screen.getByRole('button', { name: label }));
  const retry = await screen.findByRole('button', { name: '重试原流程请求' });
  expect(screen.getByLabelText('流程说明')).toBeDisabled();
  expect(screen.getByLabelText('发布说明')).toBeDisabled();
  expect(screen.getByRole('button', { name: label })).toBeDisabled();
  expect(screen.getByRole('button', { name: '重新加载流程' })).toBeDisabled();
  expect(writes.filter(item => item.path === path)).toHaveLength(1);
  fireEvent.click(retry);
  await waitFor(() => expect(writes.filter(item => item.path === path)).toHaveLength(2));
  await waitFor(() => expect(retry).toBeEnabled());
  const [first, second] = writes.filter(item => item.path === path);
  expect(second!.init.body).toBe(first!.init.body);
  expect((first!.init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  expect(second!.init.headers).toEqual(first!.init.headers);
  expect(writes.filter(item => item.path === `${base}/validate`)).toHaveLength(stage === 'validate' ? 2 : stage === 'copy' ? 0 : 1);
  fireEvent.click(retry);
  if (stage === 'copy') {
    // The parent is deliberately dirty: successful copy still uses the normal leave guard.
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/workflow-designer/definition/copied'));
  } else expect(await screen.findByText('已发布版本只读；如需修改，请复制为新草稿。')).toBeVisible();
  expect(writes.filter(item => item.path === path)).toHaveLength(3);
  expect(writes.filter(item => item.path === `${base}/definition/draft`)).toHaveLength(stage === 'draft' ? 3 : stage === 'copy' ? 0 : 1);
  expect(writes.filter(item => item.path === `${base}/definition/publish`)).toHaveLength(stage === 'publish' ? 3 : stage === 'copy' ? 0 : 1);
});
it.each(['validate', 'draft', 'publish', 'copy'])('keeps unknown designer %s frozen across retry CSRF 429 and write 422 until exact replay succeeds', async stage => {
  published = stage === 'copy';
  const path = stage === 'validate' ? `${base}/validate` : `${base}/definition/${stage}`;
  let attempts = 0;
  let csrfRejected = false;
  intercept = async target => {
    if (target.endsWith('/csrf') && attempts === 1 && !csrfRejected) {
      csrfRejected = true; return json({ code: 'RATE_LIMITED' }, 429);
    }
    if (target === path) {
      if (++attempts === 1) throw new TypeError('response lost');
      if (attempts === 2) return json({ code: 'VALIDATION_FAILED' }, 422);
    }
    return undefined;
  };
  const router = mount();
  await waitFor(() => expect(screen.getByRole('button', { name: stage === 'copy' ? '复制为新草稿' : '发布流程' })).toBeEnabled());
  if (stage !== 'copy') fireEvent.change(screen.getByLabelText('流程说明'), { target: { value: '原草稿' } });
  fireEvent.click(screen.getByRole('button', { name: stage === 'copy' ? '复制为新草稿' : '发布流程' }));
  const retry = await screen.findByRole('button', { name: '重试原流程请求' });
  const first = writes.find(item => item.path === path)!;
  expect((first.init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  fireEvent.click(retry);
  expect(await screen.findByText('操作过于频繁，请稍后重试')).toBeVisible();
  expect(writes.filter(item => item.path === path)).toHaveLength(1);
  expect(screen.getByLabelText('流程说明')).toBeDisabled(); expect(screen.getByLabelText('发布说明')).toBeDisabled();
  expect(screen.getByRole('button', { name: '重新加载流程' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '重试原流程请求' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '重试原流程请求' }));
  expect(await screen.findByText('请检查填写内容')).toBeVisible();
  expect(writes.filter(item => item.path === path)).toHaveLength(2);
  expect(screen.getByLabelText('流程说明')).toBeDisabled(); expect(screen.getByLabelText('发布说明')).toBeDisabled();
  expect(screen.getByRole('button', { name: stage === 'copy' ? '复制为新草稿' : '发布流程' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  const before = writes.length;
  fireEvent.change(screen.getByLabelText('流程说明'), { target: { value: '不得另造请求' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  expect(writes).toHaveLength(before);
  fireEvent.click(screen.getByRole('button', { name: '重试原流程请求' }));
  if (stage === 'copy') {
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    expect(await screen.findByText('复制目的页')).toBeVisible();
    expect(router.state.location.pathname).toBe('/app/workflow-designer/definition/copied');
  } else expect(await screen.findByText('已发布版本只读；如需修改，请复制为新草稿。')).toBeVisible();
  expect(writes.filter(item => item.path === path)).toHaveLength(3);
  for (const request of writes.filter(item => item.path === path)) {
    expect(request.init.method).toBe(first.init.method); expect(request.init.body).toBe(first.init.body);
    expect(request.init.headers).toEqual(first.init.headers);
  }
  expect(writes.filter(item => item.path === `${base}/validate`)).toHaveLength(stage === 'validate' ? 3 : stage === 'copy' ? 0 : 1);
  expect(writes.filter(item => item.path === `${base}/definition/draft`)).toHaveLength(stage === 'draft' ? 3 : stage === 'copy' ? 0 : 1);
  expect(writes.filter(item => item.path === `${base}/definition/publish`)).toHaveLength(stage === 'publish' ? 3 : stage === 'copy' ? 0 : 1);
});

it.each(['initial save', 'next stage after validation retry'])('keeps designer editable on first write 400: %s', async source => {
  let validations = 0;
  intercept = async path => {
    if (path.endsWith('/validate') && ++validations === 1) throw new TypeError('response lost');
    return path.endsWith('/draft') ? json({ code: 'VALIDATION_FAILED' }, 400) : undefined;
  };
  mount(); await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled());
  fireEvent.change(screen.getByLabelText('流程说明'), { target: { value: '原草稿' } });
  fireEvent.click(screen.getByRole('button', { name: source === 'initial save' ? '保存草稿' : '发布流程' }));
  if (source !== 'initial save') fireEvent.click(await screen.findByRole('button', { name: '重试原流程请求' }));
  expect(await screen.findByText('请检查填写内容')).toBeVisible();
  expect(screen.getByLabelText('流程说明')).toBeEnabled(); expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '重试原流程请求' })).not.toBeInTheDocument();
  expect(writes.filter(item => item.path.endsWith('/draft'))).toHaveLength(1);
  expect(writes.filter(item => item.path.endsWith('/validate'))).toHaveLength(source === 'initial save' ? 0 : 2);
  expect(writes.some(item => item.path.endsWith('/publish'))).toBe(false);
});

it.each([401, 403])('revokes an unknown designer retry on %s instead of retaining its attempt', async status => {
  let attempts = 0;
  intercept = async path => {
    if (!path.endsWith('/draft')) return undefined;
    if (++attempts === 1) throw new TypeError('response lost');
    return json({ code: status === 401 ? 'AUTH_SESSION_REQUIRED' : 'FEATURE_PERMISSION_DENIED' }, status);
  };
  mount(); await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原流程请求' }));
  expect(await screen.findByText(status === 401 ? '登录目的页' : '无权执行此操作')).toBeVisible();
  expect(screen.queryByRole('button', { name: '重试原流程请求' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('流程说明')).not.toBeInTheDocument(); expect(writes).toHaveLength(2);
  if (status === 401) expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  else expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
});

it('does not replay a write after reauthentication and explicitly retries the same raw request', async () => {
  let attempts = 0;
  intercept = async path => path.endsWith('/draft') && ++attempts === 1 ? json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403) : undefined;
  const reauthenticate = vi.fn(async () => {});
  const unregister = registerReauthentication(reauthenticate);
  try {
    mount();
    fireEvent.change(await screen.findByLabelText('流程说明'), { target: { value: '原草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
    const retry = await screen.findByRole('button', { name: '重试原流程请求' });
    expect(reauthenticate).toHaveBeenCalledTimes(1); expect(writes).toHaveLength(1);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled());
    expect(writes).toHaveLength(2); expect(writes[1]!.init.body).toBe(writes[0]!.init.body);
    expect(writes[1]!.init.headers).toEqual(writes[0]!.init.headers);
  } finally { unregister(); }
});
it('holds an applied CAS409 after unknown until explicit refresh without resaving or republishing', async () => {
  let attempts = 0;
  intercept = async path => {
    if (!path.endsWith('/publish')) return undefined;
    if (++attempts === 1) throw new TypeError('response lost');
    return json({ code: 'CONCURRENCY_CONFLICT' }, 409);
  };
  mount(); fireEvent.change(await screen.findByLabelText('流程说明'), { target: { value: '原草稿' } });
  fireEvent.change(screen.getByLabelText('发布说明'), { target: { value: '原发布说明' } });
  fireEvent.click(screen.getByRole('button', { name: '发布流程' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原流程请求' }));
  expect(await screen.findByText('流程已被修改，本地草稿仍保留，请确认后重新加载。')).toBeVisible();
  expect(screen.getByLabelText('发布说明')).toHaveValue('原发布说明');
  expect(screen.getByRole('button', { name: '发布流程' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
  expect(writes.filter(item => item.path.endsWith('/draft'))).toHaveLength(1);
  expect(writes.filter(item => item.path.endsWith('/publish'))).toHaveLength(2);
  expect(screen.queryByRole('button', { name: '重试原流程请求' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新加载流程' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('当前草稿尚未保存');
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('发布说明')).toHaveValue('原发布说明');
});
it.each(['write', 'read', 'directory', 'create'])('ends expired session and navigates past parent dirty and own busy on %s 401', async source => {
  intercept = async (path, init) => {
    const fail = source === 'write' ? path.endsWith('/draft') : source === 'read' ? path.includes('/versions/') : source === 'directory' ? path.includes('/options?') : path === base && init.method === 'POST';
    return fail ? json({ code: 'AUTH_SESSION_REQUIRED' }, 401) : undefined;
  };
  const router = mount(source === 'create');
  if (source === 'write') {
    fireEvent.change(await screen.findByLabelText('流程说明'), { target: { value: '未保存' } });
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  } else if (source === 'create') { await createInput(); fireEvent.click(screen.getByRole('button', { name: '创建草稿' })); }
  expect(await screen.findByText('登录目的页')).toBeVisible();
  expect(router.state.location.pathname).toBe('/login'); expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByLabelText('流程说明')).not.toBeInTheDocument();
});
it('rechecks helper scope after CSRF even without a caller signal', async () => {
  let finish!: (response: Response) => void;
  intercept = async path => path.endsWith('/csrf') ? new Promise(resolve => { finish = resolve; }) : undefined;
  const result = createWorkflow({ code: 'NEW', name: '新流程', nodes: [], transitions: [] });
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  useWorkTabsStore.getState().bindSession('INTERNAL:new-org:user');
  finish(json({ csrfToken: 'new-token' }));
  await rejected; expect(writes).toHaveLength(0);
});
it.each([408, 425, 503])('freezes a standalone save on HTTP %s with the original body and key', async status => {
  intercept = async path => path.endsWith('/draft') ? json({ code: `HTTP_${status}` }, status) : undefined;
  mount(); fireEvent.change(await screen.findByLabelText('流程说明'), { target: { value: '原草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  const retry = await screen.findByRole('button', { name: '重试原流程请求' });
  expect(screen.getByLabelText('流程说明')).toBeDisabled(); expect(writes).toHaveLength(1);
  fireEvent.click(retry);
  await waitFor(() => expect(writes).toHaveLength(2));
  await waitFor(() => expect(retry).toBeEnabled());
  expect(writes[1]!.path).toBe(writes[0]!.path); expect(writes[1]!.init.body).toBe(writes[0]!.init.body);
  expect((writes[0]!.init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  expect(writes[1]!.init.headers).toEqual(writes[0]!.init.headers);
});
it('revokes a CSRF suspended write on directory 403 and rejects late old directory data', async () => {
  let finishCsrf!: (response: Response) => void;
  let finishDirectory!: (response: Response) => void;
  intercept = async path => {
    if (path.endsWith('/csrf')) return new Promise(resolve => { finishCsrf = resolve; });
    if (path.includes('/options?search=revoked')) return json({ code: 'FEATURE_PERMISSION_DENIED' }, 403);
    if (path.includes('/options?')) return new Promise(resolve => { finishDirectory = resolve; });
    return undefined;
  };
  mount(); await screen.findByLabelText('流程说明');
  await waitFor(() => expect(finishDirectory).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await waitFor(() => expect(finishCsrf).toBeTypeOf('function'));
  fireEvent.change(screen.getByLabelText('搜索处理人和角色'), { target: { value: 'revoked' } });
  expect(await screen.findByText('无权执行此操作')).toBeVisible();
  await act(async () => {
    finishDirectory(json({ roles: [{ code: 'LEAK', name: '旧岗位不得回填' }], users: [], permissions: [] }));
    finishCsrf(json({ csrfToken: 'late-token' }));
  });
  expect(writes).toHaveLength(0); expect(screen.queryByText('旧岗位不得回填')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('流程说明')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled();
});
it('ignores an in-flight old write 401 after a new session is bound', async () => {
  let finish!: (response: Response) => void;
  intercept = async path => path.endsWith('/draft') ? new Promise(resolve => { finish = resolve; }) : undefined;
  const router = mount(); fireEvent.change(await screen.findByLabelText('流程说明'), { target: { value: '旧草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '发布流程' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:new-org:user'));
  await act(async () => finish(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)));
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:new-org:user');
  expect(router.state.location.pathname).not.toBe('/login'); expect(writes.some(item => item.path.endsWith('/publish'))).toBe(false);
});
it('preserves local content when an explicit conflict refresh fails', async () => {
  let reads = 0;
  intercept = async path => {
    if (path.includes('/versions/') && ++reads > 1) throw new TypeError('read failed');
    return path.endsWith('/draft') ? json({ code: 'CONCURRENCY_CONFLICT' }, 409) : undefined;
  };
  mount(); fireEvent.change(await screen.findByLabelText('流程说明'), { target: { value: '保留的原草稿' } });
  fireEvent.change(screen.getByLabelText('发布说明'), { target: { value: '保留的发布说明' } });
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }));
  await screen.findByText('流程已被修改，本地草稿仍保留，请确认后重新加载。');
  fireEvent.click(screen.getByRole('button', { name: '重新加载流程' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  await waitFor(() => expect(reads).toBe(2));
  await waitFor(() => expect(screen.getByRole('button', { name: '重新加载流程' })).toBeEnabled());
  expect(screen.getByLabelText('流程说明')).toHaveValue('保留的原草稿');
  expect(screen.getByLabelText('发布说明')).toHaveValue('保留的发布说明'); expect(writes).toHaveLength(1);
});
it('copies a published legacy graph without converting it to an editable draft payload', async () => {
  intercept = async path => path.includes('/versions/') ? json({ ...definition, version: { ...definition.version, status: 'PUBLISHED', structureSnapshot: { nodes: [{ id: 'legacy', name: '旧退回节点', type: 'RETURN' }], transitions: [] } } }) : undefined;
  mount(); fireEvent.click(await screen.findByRole('button', { name: '复制为新草稿' }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.path).toBe(`${base}/definition/copy`);
  expect(JSON.parse(writes[0]!.init.body as string)).toEqual({ sourceVersionId: 'version', expectedRevision: 3, description: '' });
});

it.each(['network', '408', '425', '500', '503', 'CLIENT_REAUTHENTICATION_COMPLETED'])('freezes create unknown %s and retries the exact raw body UUIDs and key until success', async failure => {
  let attempts = 0;
  intercept = async path => {
    if (path !== base || ++attempts > 2) return undefined;
    if (failure === 'network') throw new TypeError('response lost');
    if (failure === 'CLIENT_REAUTHENTICATION_COMPLETED') return json({ code: 'AUTH_REAUTHENTICATION_REQUIRED' }, 403);
    return json({ code: `HTTP_${failure}` }, Number(failure));
  };
  const reauthenticate = vi.fn(async () => {});
  const unregister = registerReauthentication(reauthenticate);
  try {
    const router = mount(true); await createInput();
    fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
    const retry = await screen.findByRole('button', { name: '重试原创建请求' });
    expect(writes).toHaveLength(1);
    expect(screen.getByLabelText('流程代码')).toBeDisabled(); expect(screen.getByLabelText('流程名称')).toBeDisabled();
    expect(screen.getByRole('button', { name: /^新建流程$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建草稿' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '初始化关闭审核模板' })).toBeDisabled();
    const first = writes[0]!;
    const original = JSON.parse(first.init.body as string);
    const ids = original.nodes.map((node: { id: string }) => node.id);
    expect(new Set(ids).size).toBe(2); expect(ids.every((id: string) => /^[\da-f-]{36}$/i.test(id))).toBe(true);
    expect(original).toMatchObject({ code: 'NEW', name: '新流程' });
    expect((first.init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
    fireEvent.submit(screen.getByLabelText('流程代码').closest('form')!);
    expect(writes).toHaveLength(1);
    fireEvent.click(retry);
    await waitFor(() => expect(writes).toHaveLength(2));
    await waitFor(() => expect(retry).toBeEnabled());
    expect(screen.getByLabelText('流程代码')).toBeDisabled();
    fireEvent.click(retry);
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    expect(await screen.findByText('复制目的页')).toBeVisible();
    expect(router.state.location.pathname).toBe('/app/workflow-designer/definition/copied');
    expect(writes).toHaveLength(3);
    for (const request of writes) {
      expect(request.path).toBe(base); expect(request.init.method).toBe('POST');
      expect(request.init.body).toBe(first.init.body); expect(request.init.headers).toEqual(first.init.headers);
      expect(JSON.parse(request.init.body as string).nodes.map((node: { id: string }) => node.id)).toEqual(ids);
    }
    expect(reauthenticate).toHaveBeenCalledTimes(failure === 'CLIENT_REAUTHENTICATION_COMPLETED' ? 2 : 0);
  } finally { unregister(); }
});

it.each([{ stage: 'CSRF', status: 429 }, { stage: 'POST', status: 400 }, { stage: 'POST', status: 422 }, { stage: 'POST', status: 429 }])('keeps unknown create frozen after retry $stage $status until the exact request succeeds', async ({ stage, status }) => {
  let csrfReads = 0;
  let attempts = 0;
  const rejected = () => json({ code: status === 429 ? 'RATE_LIMITED' : 'VALIDATION_FAILED' }, status);
  intercept = async path => {
    if (path.endsWith('/csrf') && ++csrfReads === 2 && stage === 'CSRF') return rejected();
    if (path === base) {
      if (++attempts === 1) throw new TypeError('response lost');
      if (attempts === 2 && stage === 'POST') return rejected();
    }
    return undefined;
  };
  const router = mount(true); await createInput();
  fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  const retry = await screen.findByRole('button', { name: '重试原创建请求' });
  expect(writes).toHaveLength(1);
  const first = writes[0]!;
  const original = JSON.parse(first.init.body as string);
  const ids = original.nodes.map((node: { id: string }) => node.id);
  expect(original).toMatchObject({ code: 'NEW', name: '新流程' });
  expect(new Set(ids).size).toBe(2); expect(ids.every((id: string) => /^[\da-f-]{36}$/i.test(id))).toBe(true);
  expect((first.init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  fireEvent.click(retry);
  expect(await screen.findByText(status === 429 ? '操作过于频繁，请稍后重试' : '请检查填写内容')).toBeVisible();
  expect(csrfReads).toBe(2);
  expect(writes).toHaveLength(stage === 'CSRF' ? 1 : 2);
  expect(screen.getByLabelText('流程代码')).toBeDisabled(); expect(screen.getByLabelText('流程名称')).toBeDisabled();
  expect(screen.getByRole('button', { name: /^新建流程$/ })).toBeDisabled();
  expect(screen.getByRole('button', { name: '创建草稿' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '初始化关闭审核模板' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '重试原创建请求' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('流程代码'), { target: { value: 'CHANGED' } });
  fireEvent.change(screen.getByLabelText('流程名称'), { target: { value: '不得另造请求' } });
  fireEvent.submit(screen.getByLabelText('流程代码').closest('form')!);
  expect(writes).toHaveLength(stage === 'CSRF' ? 1 : 2); expect(csrfReads).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: '重试原创建请求' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  expect(await screen.findByText('复制目的页')).toBeVisible();
  expect(router.state.location.pathname).toBe('/app/workflow-designer/definition/copied');
  expect(writes).toHaveLength(stage === 'CSRF' ? 2 : 3); expect(csrfReads).toBe(3);
  for (const request of writes) {
    expect(request.path).toBe(base); expect(request.init.method).toBe('POST');
    expect(request.init.body).toBe(first.init.body); expect(request.init.headers).toEqual(first.init.headers);
    expect(JSON.parse(request.init.body as string).nodes.map((node: { id: string }) => node.id)).toEqual(ids);
  }
});

it('keeps create inputs after retry 409 and failed explicit refresh then reconciles without another POST', async () => {
  let attempts = 0;
  let refreshes = 0;
  let checking = false;
  intercept = async path => {
    if (path === base) {
      if (++attempts === 1) throw new TypeError('response lost');
      return json({ code: 'CONCURRENCY_CONFLICT' }, 409);
    }
    if (checking && path.startsWith(`${base}?`)) {
      if (++refreshes === 1) throw new TypeError('refresh failed');
      return json({ items: [{ ...definition, code: 'NEW', name: '新流程', draftVersionId: 'version' }], total: 1 });
    }
    return undefined;
  };
  mount(true); await screen.findByText('暂无流程'); await createInput();
  fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原创建请求' }));
  expect(await screen.findByText('创建结果需核对，输入已保留，请显式刷新流程列表。')).toBeVisible();
  expect(screen.getByLabelText('流程代码')).toHaveValue('NEW'); expect(screen.getByLabelText('流程名称')).toHaveValue('新流程');
  expect(screen.getByRole('button', { name: '创建草稿' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: '重试原创建请求' })).not.toBeInTheDocument();
  expect(writes).toHaveLength(2); expect(writes[1]!.init.body).toBe(writes[0]!.init.body); expect(writes[1]!.init.headers).toEqual(writes[0]!.init.headers);
  checking = true;
  const refresh = screen.getByRole('button', { name: '刷新流程列表核对' });
  await waitFor(() => expect(refresh).toBeEnabled()); fireEvent.click(refresh);
  expect(await screen.findByText('刷新流程列表失败，创建输入仍保留，请重试刷新核对。')).toBeVisible();
  expect(screen.getByLabelText('流程代码')).toHaveValue('NEW'); expect(screen.getByLabelText('流程名称')).toHaveValue('新流程');
  expect(screen.getByRole('button', { name: '创建草稿' })).toBeDisabled();
  await waitFor(() => expect(refresh).toBeEnabled()); fireEvent.click(refresh);
  expect(await screen.findByRole('link', { name: '打开流程' })).toBeVisible();
  await waitFor(() => expect(screen.getByLabelText('流程代码')).toBeEnabled());
  expect(screen.getByLabelText('流程代码')).toHaveValue('NEW'); expect(screen.getByLabelText('流程名称')).toHaveValue('新流程');
  expect(writes).toHaveLength(2); expect(refreshes).toBe(2);
});

it.each([403, 401])('clears unknown create and releases guards when the original retry returns %s', async status => {
  let attempts = 0;
  intercept = async path => {
    if (path !== base) return undefined;
    if (++attempts === 1) throw new TypeError('response lost');
    return json({ code: status === 401 ? 'AUTH_SESSION_REQUIRED' : 'FEATURE_PERMISSION_DENIED' }, status);
  };
  const router = mount(true); await createInput(); fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原创建请求' }));
  if (status === 401) {
    expect(await screen.findByText('登录目的页')).toBeVisible(); expect(useWorkTabsStore.getState().sessionScope).toBeUndefined();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  } else {
    expect(await screen.findByText('无权执行此操作')).toBeVisible();
    expect(screen.getByRole('button', { name: /^新建流程$/ })).toBeDisabled();
    expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:org:user');
    await act(async () => { void router.navigate('/login'); });
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
    expect(await screen.findByText('登录目的页')).toBeVisible();
  }
  expect(screen.queryByLabelText('流程代码')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试原创建请求' })).not.toBeInTheDocument();
  expect(writes).toHaveLength(2); expect(writes[1]!.init.body).toBe(writes[0]!.init.body); expect(writes[1]!.init.headers).toEqual(writes[0]!.init.headers);
});

it('aborts unknown create retry during CSRF after scope change without another POST', async () => {
  let csrfReads = 0;
  let finish!: (response: Response) => void;
  intercept = async path => {
    if (path.endsWith('/csrf') && ++csrfReads === 2) return new Promise(resolve => { finish = resolve; });
    if (path === base) throw new TypeError('response lost');
    return undefined;
  };
  mount(true); await createInput(); fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原创建请求' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:new-org:user'));
  await act(async () => finish(json({ csrfToken: 'new-cookie-token' })));
  expect(writes).toHaveLength(1); expect(screen.queryByLabelText('流程代码')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试原创建请求' })).not.toBeInTheDocument();
});

it('does not unlock conflicted create from a late pre-conflict list read', async () => {
  let finish!: (response: Response) => void;
  let attempts = 0;
  intercept = async path => {
    if (path.startsWith(`${base}?`)) return new Promise(resolve => { finish = resolve; });
    if (path === base) {
      if (++attempts === 1) throw new TypeError('response lost');
      return json({ code: 'CONCURRENCY_CONFLICT' }, 409);
    }
    return undefined;
  };
  mount(true); await createInput(); await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原创建请求' }));
  await screen.findByText('创建结果需核对，输入已保留，请显式刷新流程列表。');
  await act(async () => finish(json({ items: [], total: 0 })));
  expect(screen.getByLabelText('流程代码')).toHaveValue('NEW'); expect(screen.getByLabelText('流程代码')).toBeDisabled();
  expect(screen.getByRole('button', { name: '创建草稿' })).toBeDisabled(); expect(writes).toHaveLength(2);
  expect(screen.getByRole('button', { name: '刷新流程列表核对' })).toBeEnabled();
});

it('ignores an old unknown create retry 401 after a new session is bound', async () => {
  let finish!: (response: Response) => void;
  let attempts = 0;
  intercept = async path => {
    if (path !== base) return undefined;
    if (++attempts === 1) throw new TypeError('response lost');
    return new Promise(resolve => { finish = resolve; });
  };
  const router = mount(true); await createInput(); fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
  fireEvent.click(await screen.findByRole('button', { name: '重试原创建请求' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  act(() => useWorkTabsStore.getState().bindSession('INTERNAL:new-org:user'));
  await act(async () => finish(json({ code: 'AUTH_SESSION_REQUIRED' }, 401)));
  expect(useWorkTabsStore.getState().sessionScope).toBe('INTERNAL:new-org:user'); expect(router.state.location.pathname).not.toBe('/login');
  expect(screen.queryByLabelText('流程代码')).not.toBeInTheDocument(); expect(writes).toHaveLength(2);
  expect(writes[1]!.init.body).toBe(writes[0]!.init.body); expect(writes[1]!.init.signal?.aborted).toBe(true);
});
