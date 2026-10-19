import type { components } from '@qms/contracts';
import { Alert, Button, Card, Col, Empty, Row, Spin, Statistic, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { ApiError, apiRequest, safeAccountError } from '../../api/client';
import './task-statistics.css';

type TaskStatistics = components['schemas']['TaskStatisticsDto'];

function isDenied(cause: unknown) {
  return cause instanceof ApiError && (cause.status === 403 || cause.code === 'FEATURE_PERMISSION_DENIED' || cause.code === 'ORGANIZATION_SCOPE_DENIED');
}

export function TaskStatisticsPage() {
  const [statistics, setStatistics] = useState<TaskStatistics>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void apiRequest<TaskStatistics>('/api/v1/tasks/statistics').then((result) => {
      if (active) setStatistics(result);
    }).catch((cause) => {
      if (!active) return;
      setStatistics(undefined);
      setError(cause);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);

  return <section className="task-statistics-page">
    <header className="task-statistics-heading">
      <div><Typography.Title level={1}>任务统计</Typography.Title><Typography.Paragraph type="secondary">按当前组织权限汇总进行中的流程任务，帮助团队识别逾期、未领取和待处理工作。</Typography.Paragraph></div>
      <Button onClick={() => setRevision((value) => value + 1)} loading={loading}>刷新</Button>
    </header>
    {error ? <Alert type={isDenied(error) ? 'warning' : 'error'} showIcon title={isDenied(error) ? '暂无任务统计访问权限' : error instanceof ApiError ? safeAccountError(error) : '任务统计加载失败，请重试。'} description={error instanceof ApiError ? error.traceId : undefined} action={isDenied(error) ? undefined : <Button onClick={() => setRevision((value) => value + 1)}>重试</Button>} /> : null}
    {loading ? <div className="task-statistics-loading"><Spin /></div> : statistics ? <>
      <Row gutter={[6, 6]}>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="进行中任务" value={statistics.total} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="待处理" value={statistics.pending} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card><Statistic title="处理中" value={statistics.inProgress} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card className={statistics.overdue ? 'task-statistics-card--danger' : undefined}><Statistic title="已逾期" value={statistics.overdue} /></Card></Col>
        <Col xs={24} sm={12} lg={6}><Card className={statistics.failed ? 'task-statistics-card--danger' : undefined}><Statistic title="失败待恢复" value={statistics.failed} /></Card></Col>
      </Row>
      <Row gutter={[6, 6]} className="task-statistics-secondary">
        <Col xs={24} sm={8}><Card><Statistic title="未领取" value={statistics.unclaimed} /></Card></Col>
        <Col xs={24} sm={8}><Card><Statistic title="我负责" value={statistics.mine} /></Card></Col>
        <Col xs={24} sm={8}><Card><Statistic title="7 天内到期" value={statistics.dueThisWeek} /></Card></Col>
      </Row>
      <Card className="task-statistics-note"><Typography.Text type="secondary">今日到期任务：{statistics.dueToday} 项。统计只包含当前可见且仍处于运行中的流程任务，失败待恢复单独计数。</Typography.Text></Card>
    </> : !error ? <Empty description="暂无可统计的任务" /> : null}
  </section>;
}
