import { Alert, Button, Descriptions, Empty, Input, List, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import './new-product-quality.css';

type Project = components['schemas']['NewProductProjectDetailDto'];

function errorMessage(cause: unknown) {
  if (cause instanceof ApiError) return safeAccountError(cause);
  return '新产品项目加载失败，请重试。';
}

function permissionDenied(cause: unknown) {
  if (cause instanceof ApiError) return cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED';
  return typeof cause === 'object' && cause !== null && ((cause as { status?: number }).status === 403 || ['FEATURE_PERMISSION_DENIED', 'ORGANIZATION_SCOPE_DENIED'].includes((cause as { code?: string }).code ?? ''));
}

const projectStatus: Record<Project['status'], string> = { ACTIVE: '进行中', ARCHIVED: '已归档' };

export function NewProductQualityPage({ projectId: initialProjectId }: { projectId?: string } = {}) {
  const [input, setInput] = useState(initialProjectId ?? '');
  const [projectId, setProjectId] = useState(initialProjectId ?? '');
  const [project, setProject] = useState<Project>();
  const [loading, setLoading] = useState(Boolean(initialProjectId));
  const [error, setError] = useState<unknown>();

  async function load(id = projectId) {
    const value = id.trim();
    if (!value) return;
    setProjectId(value);
    setLoading(true);
    setError(undefined);
    try { setProject(await apiRequest<Project>(`/api/v1/new-product-quality/projects/${value}`)); }
    catch (cause) { setProject(undefined); setError(cause); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (initialProjectId) void load(initialProjectId); }, [initialProjectId]);

  return <main className="new-product-quality-page">
    <header className="new-product-quality-heading">
      <div><Typography.Text type="secondary">新产品质量</Typography.Text><Typography.Title level={1}>项目质量台账</Typography.Title><Typography.Paragraph type="secondary">查看项目阶段、经验教训和试制批次，所有数据均来自受权限保护的项目接口。</Typography.Paragraph></div>
      {project ? <Button onClick={() => void load()} loading={loading}>刷新</Button> : null}
    </header>
    <section className="new-product-quality-card">
      <Space.Compact className="new-product-quality-lookup">
        <Input aria-label="新产品项目 ID" placeholder="输入新产品项目 ID" value={input} onChange={(event) => setInput(event.target.value)} onPressEnter={() => void load(input)} />
        <Button type="primary" onClick={() => void load(input)} loading={loading}>查看项目</Button>
      </Space.Compact>
    </section>
    {error ? <Alert type={permissionDenied(error) ? 'warning' : 'error'} showIcon title={permissionDenied(error) ? '暂无新产品项目访问权限' : errorMessage(error)} description={error instanceof ApiError && error.traceId ? `追踪标识：${error.traceId}` : undefined} action={!permissionDenied(error) ? <Button onClick={() => void load()}>重试</Button> : undefined} /> : null}
    <section className="new-product-quality-card" aria-live="polite">
      {loading ? <div className="new-product-quality-loading"><Spin /></div> : error ? null : project ? <>
        <Descriptions column={{ xs: 1, sm: 2 }} title={<Space><span>{project.name}</span><Tag color={project.status === 'ACTIVE' ? 'blue' : 'default'}>{projectStatus[project.status]}</Tag></Space>} items={[
          { key: 'code', label: '项目编号', children: project.code }, { key: 'product', label: '产品代码', children: project.product_code },
          { key: 'stages', label: '阶段数', children: project.stages.length }, { key: 'batches', label: '试制批次数', children: project.batches.length },
          { key: 'lessons', label: '经验教训数', children: project.lessons.length }, { key: 'version', label: '版本', children: project.version },
        ]} />
        <Typography.Title level={3}>阶段</Typography.Title>
        <List size="small" dataSource={project.stages} locale={{ emptyText: <Empty description="暂无阶段" /> }} renderItem={(stage) => <List.Item><Space><Typography.Text strong>{stage.code}</Typography.Text><span>{stage.name}</span><Tag>{stage.status}</Tag></Space></List.Item>} />
      </> : <Empty description={projectId ? '未找到新产品项目' : '输入新产品项目 ID 后查看详情'} />}
    </section>
  </main>;
}
