import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Space, Spin, Tag, Typography } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';
import * as api from './workflow-api';
import { workflowLabel } from './workflow-labels';
import './workflows.css';

export function WorkflowListPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [page, setPage] = useState<Awaited<ReturnType<typeof api.getWorkflows>>>();
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.getWorkflow>>>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<unknown>();
  const [actionError, setActionError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdPath, setCreatedPath] = useState<string>();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const draftDirty = creating && Boolean(code.trim() || name.trim());
  const requestLeave = useNavigationGuard();
  useUnsavedChanges(draftDirty);
  useNavigationBusy(busy);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!createdPath || busy) return;
    // The guard registrations above must clear before entering the created draft.
    setCreatedPath(undefined);
    navigate(createdPath);
  }, [busy, createdPath, navigate]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(undefined);
    const timer = setTimeout(() => {
      api.getWorkflows(new URLSearchParams({ search, ...(status ? { status } : {}), offset: String(offset), pageSize: '25' }), controller.signal)
        .then((result) => { if (!controller.signal.aborted) setPage(result); })
        .catch((cause) => { if (!controller.signal.aborted) { setError(cause); setPage(undefined); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search, status, offset, revision]);
  async function act(id?: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setActionError(undefined);
    try {
      if (id) {
        const result = await api.getWorkflow(id);
        if (alive.current) setHistory(result);
      } else {
        const result = await api.createWorkflow({ code: code.trim(), name: name.trim(), ...api.initialGraph() });
        if (alive.current) { setCreating(false); setCode(''); setName(''); setCreatedPath(api.workflowPath(result)); }
      }
    } catch (cause) { if (alive.current) setActionError(cause); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const displayedError = actionError ?? error;
  return <section className="workflow-list">
    <header className="workflow-heading"><Typography.Title level={2}>{t('受控流程列表')}</Typography.Title>
      <Button type="primary" disabled={busy || !!error} onClick={() => {
        if (creating) requestLeave(() => { setCreating(false); setCode(''); setName(''); });
        else setCreating(true);
      }}>{t('新建流程')}</Button></header>
    {!!displayedError && <Alert type="error" title={t(safeAccountError(displayedError))} description={displayedError instanceof ApiError && displayedError.traceId ? <code>{displayedError.traceId}</code> : undefined}
      action={error ? <Button aria-label={t('重试')} onClick={() => setRevision((value) => value + 1)}>{t('重试')}</Button> : undefined} />}
    <Space wrap className="workflow-list__filters"><label>{t('搜索流程')}<input aria-label={t('搜索流程')} value={search} maxLength={100} onChange={(event) => { setSearch(event.target.value); setOffset(0); }} /></label>
      <label>{t('状态')}<select aria-label={t('状态')} value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}>
        <option value="">{t('全部状态')}</option>{['DRAFT', 'PUBLISHED', 'RETIRED'].map((value) => <option key={value} value={value}>{t(workflowLabel(value))}</option>)}
      </select></label></Space>
    {creating && <Card title={t('新建流程')}><form onSubmit={(event) => { event.preventDefault(); void act(); }}>
      <label>{t('流程代码')}<input aria-label={t('流程代码')} required maxLength={100} value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /></label>
      <label>{t('流程名称')}<input aria-label={t('流程名称')} required maxLength={200} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
      <p>{t('新草稿需要配置处理范围及连线，校验通过后才能发布。')}</p>
      <Button htmlType="submit" disabled={busy || !code.trim() || !name.trim()}>{t('创建草稿')}</Button>
    </form></Card>}
    {loading ? <Spin aria-label={t('加载中')} /> : page && !page.items.length ? <Empty description={t('暂无流程')} /> : page && <div className="workflow-list__table"><table>
      <thead><tr>{['代码', '名称', '状态', '版本', '操作'].map((label) => <th key={label} scope="col">{t(label)}</th>)}</tr></thead>
      <tbody>{page.items.map((item) => <tr key={item.id}><td><code>{item.code}</code></td><td>{item.name}</td><td><Tag>{t(workflowLabel(item.version.status))}</Tag></td><td>{item.version.version}</td><td><Space>
        <Link to={`/app/workflow-designer/${item.id}/${item.version.id}`}>{t('打开流程')}</Link><Button disabled={busy} aria-label={`${t('版本历史')} ${item.name}`} onClick={() => void act(item.id)}>{t('版本历史')}</Button>
      </Space></td></tr>)}</tbody></table></div>}
    {page && <Space className="workflow-list__pagination"><span>{t('总数')} {page.total}</span><Button disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 25))}>{t('上一页')}</Button>
      <Button disabled={loading || offset + 25 >= page.total || offset + 25 > 10000} onClick={() => setOffset((value) => value + 25)}>{t('下一页')}</Button></Space>}
    {history && <Card title={`${history.name} · ${t('版本历史')}`}><ul>{history.versions.map((version) => <li key={version.id}>
      <Link to={`/app/workflow-designer/${history.id}/${version.id}`}>{t('版本')} {version.version} · {t(workflowLabel(version.status))}</Link>{version.changeNote && <span> — {version.changeNote}</span>}
    </li>)}</ul></Card>}
  </section>;
}
