import { Alert, Button, Card, Checkbox, Empty, Radio, Space, Tag, Typography } from 'antd';
import { useState } from 'react';

// Sample-only state, not API DTOs or a substitute for the server's closure policy.
type Scenario = {
  policy: 'internal' | 'supplier';
  severity: 'low' | 'medium' | 'high' | 'critical';
  ownerIsManager: boolean;
  managerIsMinister: boolean;
};
type Duty = {
  key: 'professional' | 'manager' | 'minister';
  person: string;
  status: 'pending' | 'waiting' | 'approved' | 'skipped' | 'returned' | 'cancelled';
  confirmation?: string;
};
type Round = {
  number: number;
  scenario: Scenario;
  duties: Duty[];
  status: 'reviewing' | 'cancelled' | 'closed';
};
const dutyNames = { professional: '专业审核', manager: '经理审核', minister: '部长审核' };
const severityNames = { low: '低风险', medium: '中风险', high: '高风险', critical: '重大风险' };
const statusNames = {
  pending: '待审核', waiting: '等待专业通过', approved: '已通过',
  skipped: '同人跳过（仅管理侧）', returned: '已退回', cancelled: '已取消',
};
const roundNames = { reviewing: '审核中', cancelled: '已退回 / 整轮取消', closed: '本轮汇聚完成（仅样例）' };
const isHigh = (scenario: Scenario) => scenario.severity === 'high' || scenario.severity === 'critical';
const isGrouped = (scenario: Scenario) => scenario.policy === 'supplier' && isHigh(scenario) && scenario.managerIsMinister;

export function WorkflowClosurePreview() {
  const [scenario, setScenario] = useState<Scenario>({
    policy: 'internal', severity: 'low', ownerIsManager: false, managerIsMinister: false,
  });
  const [state, setState] = useState<{ current: Round | null; history: Round[] }>({ current: null, history: [] });
  const [confirmed, setConfirmed] = useState(false);
  const current = state.current;
  const reviewing = current?.status === 'reviewing';

  function submit() {
    setState(previous => {
      if (previous.current?.status === 'reviewing') return previous;
      const duties: Duty[] = [{ key: 'professional', person: '演示专业审核人', status: 'pending' }];
      if (scenario.policy === 'internal') {
        duties.push(isHigh(scenario)
          ? { key: 'minister', person: '演示部长', status: 'pending' }
          : { key: 'manager', person: '演示经理', status: scenario.ownerIsManager ? 'skipped' : 'pending' });
      } else {
        duties.push({ key: 'manager', person: '演示经理', status: 'waiting' });
        if (isHigh(scenario)) duties.push({
          key: 'minister', person: scenario.managerIsMinister ? '演示经理（兼部长）' : '演示部长', status: 'waiting',
        });
      }
      return {
        current: { number: (previous.current?.number ?? 0) + 1, scenario: { ...scenario }, duties, status: 'reviewing' },
        history: previous.current ? [...previous.history, previous.current] : previous.history,
      };
    });
    setConfirmed(false);
  }

  function act(key: Duty['key'], returned = false, both = false) {
    setState(previous => {
      const round = previous.current;
      if (!round || round.status !== 'reviewing' || round.duties.find(duty => duty.key === key)?.status !== 'pending') return previous;
      const grouped = isGrouped(round.scenario);
      if (both && (!grouped || !confirmed || round.duties.some(duty => duty.key !== 'professional' && duty.status !== 'pending'))) return previous;
      if (grouped && key !== 'professional' && !both) return previous;
      const duties = round.duties.map((duty): Duty => {
        if (duty.key === key || (both && duty.key !== 'professional')) return {
          ...duty, status: returned ? 'returned' : 'approved',
          ...(both ? { confirmation: `R${round.number}-M` } : {}),
        };
        if (returned && (duty.status === 'pending' || duty.status === 'waiting')) return { ...duty, status: 'cancelled' };
        if (!returned && key === 'professional' && duty.status === 'waiting') return { ...duty, status: 'pending' };
        return duty;
      });
      return { ...previous, current: {
        ...round, duties, status: returned ? 'cancelled'
          : duties.every(duty => duty.status === 'approved' || duty.status === 'skipped') ? 'closed' : 'reviewing',
      } };
    });
    if (returned || both) setConfirmed(false);
  }

  function summary(round: Round) {
    return <Space wrap>
      <strong>第 {round.number} 轮</strong>
      <Tag>{round.scenario.policy === 'internal' ? '内部' : '供应商'}</Tag>
      <Tag>{severityNames[round.scenario.severity]}</Tag>
      <span>{round.scenario.policy === 'internal' ? '专业与管理并行' : '专业先过，再启动管理'}</span>
      {round.scenario.policy === 'internal' && !isHigh(round.scenario) && round.scenario.ownerIsManager && <span>负责人 = 经理（演示设定）</span>}
      {isGrouped(round.scenario) && <span>经理 = 部长（演示设定）</span>}
    </Space>;
  }

  return <main style={{ maxWidth: 1160, margin: '0 auto', padding: 8, display: 'grid', gap: 6 }}>
    <header>
      <Typography.Title level={2} style={{ margin: '8px 0' }}>关闭审核 · 独立交互样例</Typography.Title>
      <Alert type="warning" showIcon title="仅内存交互样例，非生产，不连接API/不代表验收" />
      <Typography.Paragraph style={{ margin: '8px 0' }}>
        所有人员仅为手动演示设定，不解析真实人员、不检查任职或权限；刷新即丢失轮次与记录。
        本页不启动业务、不代表真实关闭资格。外观沿用共享主题偏好。
      </Typography.Paragraph>
    </header>

    <Card title="1. 选择演示场景" size="small">
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap>
          <span id="closure-policy-label">审核策略</span>
          <Radio.Group aria-labelledby="closure-policy-label" value={scenario.policy} disabled={reviewing}
            onChange={event => setScenario({ ...scenario, policy: event.target.value })}>
            <Radio value="internal">内部</Radio><Radio value="supplier">供应商</Radio>
          </Radio.Group>
        </Space>
        <Space wrap>
          <span id="closure-severity-label">风险等级</span>
          <Radio.Group aria-labelledby="closure-severity-label" value={scenario.severity} disabled={reviewing}
            onChange={event => setScenario({ ...scenario, severity: event.target.value })}>
            {Object.entries(severityNames).map(([value, label]) => <Radio key={value} value={value}>{label}</Radio>)}
          </Radio.Group>
        </Space>
        {scenario.policy === 'internal'
          ? <Checkbox disabled={reviewing || isHigh(scenario)} checked={scenario.ownerIsManager}
            onChange={event => setScenario({ ...scenario, ownerIsManager: event.target.checked })}>演示负责人 = 经理</Checkbox>
          : <Checkbox disabled={reviewing || !isHigh(scenario)} checked={scenario.managerIsMinister}
            onChange={event => setScenario({ ...scenario, managerIsMinister: event.target.checked })}>演示经理 = 部长</Checkbox>}
        <Typography.Text type="secondary">
          内部低中：专业 + 经理，同负责人仅管理留痕跳过；高重大：专业 + 部长，不跳过部长。
          供应商：专业先过，低中再经理，高重大再经理 + 部长。
        </Typography.Text>
        <Space wrap>
          <Button type="primary" disabled={reviewing} onClick={submit}>
            {current?.status === 'cancelled' ? '重新提交（新轮次）' : '提交新轮次'}
          </Button>
          <span>{reviewing ? '审核中锁定场景；任一待审职责可退回整轮。' : '提交后固定本轮场景；旧轮次仅作历史，不沿用结果。'}</span>
        </Space>
      </Space>
    </Card>

    <section aria-label="当前轮">
      <Card title="2. 当前轮" size="small">
        {!current ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未提交，请先选择演示场景" /> : <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          {summary(current)}
          <div role="status" aria-live="polite"><Tag color={current.status === 'cancelled' ? 'error' : current.status === 'closed' ? 'success' : 'processing'}>{roundNames[current.status]}</Tag></div>
          {current.status === 'cancelled' && <Typography.Text type="danger">整轮已失效，旧通过仅供追溯；重提清空前轮结果，专业和管理均重新开始。</Typography.Text>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 6 }}>
            {current.duties.map(duty => <div key={duty.key} role="group" aria-label={dutyNames[duty.key]}>
              <Card title={`${dutyNames[duty.key]} · ${duty.key}`} size="small" style={{ height: '100%' }}>
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                  <span>{duty.person}（非真实解析）</span>
                  <strong>{statusNames[duty.status]}</strong>
                  {duty.confirmation && <span>同次确认 {duty.confirmation} · 独立职责记录</span>}
                  <Space wrap>
                    {!(isGrouped(current.scenario) && duty.key !== 'professional') && <>
                      <Button disabled={!reviewing || duty.status !== 'pending'} onClick={() => act(duty.key)}>{dutyNames[duty.key]}通过</Button>
                      <Button danger disabled={!reviewing || duty.status !== 'pending'} onClick={() => act(duty.key, true)}>{dutyNames[duty.key]}退回</Button>
                    </>}
                  </Space>
                </Space>
              </Card>
            </div>)}
          </div>
          {isGrouped(current.scenario) && <Card title="同人双管理职责确认（不是免审）" size="small">
            <Space orientation="vertical" size={8}>
              <span>演示经理同时承担 manager 与 minister；专业通过后，明确确认一次，分别记录两项职责。专业审核不在此次确认内。</span>
              <Checkbox checked={confirmed} disabled={!reviewing || current.duties.some(duty => duty.status !== 'pending' && duty.key !== 'professional')}
                onChange={event => setConfirmed(event.target.checked)}>我确认同时履行经理与部长两项职责</Checkbox>
              <Button disabled={!reviewing || !confirmed || current.duties.some(duty => duty.key !== 'professional' && duty.status !== 'pending')}
                onClick={() => act('manager', false, true)}>一次确认经理与部长（两份记录）</Button>
              <Button danger disabled={!reviewing || !confirmed || current.duties.some(duty => duty.key !== 'professional' && duty.status !== 'pending')}
                onClick={() => act('manager', true, true)}>一次退回经理与部长（两份记录）</Button>
            </Space>
          </Card>}
        </Space>}
      </Card>
    </section>

    <section aria-label="历史轮次">
      <Card title={`3. 历史轮次（${state.history.length}）`} size="small">
        <Typography.Paragraph>只读追溯，不计入当前轮；取消轮次中的旧通过不构成有效审批。</Typography.Paragraph>
        {state.history.length === 0 ? <Typography.Text type="secondary">暂无历史；下一次提交时，上一轮移入此处。</Typography.Text>
          : <Space orientation="vertical" size={8} style={{ width: '100%' }}>
            {state.history.map(round => <Card key={round.number} size="small">
              {summary(round)}
              <p>{roundNames[round.status]} · 不计入当前轮</p>
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>{round.duties.map(duty => <li key={duty.key}>
                {dutyNames[duty.key]} / {duty.person}：{statusNames[duty.status]}{duty.confirmation ? ` / 同次确认 ${duty.confirmation}` : ''}
              </li>)}</ul>
            </Card>)}
          </Space>}
      </Card>
    </section>
  </main>;
}
