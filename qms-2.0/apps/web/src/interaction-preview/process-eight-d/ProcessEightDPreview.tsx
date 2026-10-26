import { Alert, Button, Checkbox, Empty, Modal, Radio, Tag } from 'antd';
import { ClipboardList } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AppearanceButton } from '../../theme/AppearanceButton';
import './process-eight-d.css';

// Local demonstration values only. Never use these types as a production contract or workflow policy.
type Action = {
  id: string; kind: string; action: string; owner: string; plannedAt: string; method: string;
  implementedAt: string; result: string; before: string; after: string; firstBatch: string;
  batches: string; duration: string; record: string; effective: string;
};
type Standard = { name: string; update: string; owner: string; planned: string; completed: string; status: string; reason: string };
type Temporary = { description: string; owner: string; introducedAt: string };
type Containment = { group: string; location: string; quantity: string; measure: string; owner: string; planned: string; completion: string; ng: string };
type DemoDocument = {
  description: string; analysis: string; occurrence: string; escape: string; system: string;
  temporary: Temporary[]; containment: Containment[]; extended: Containment[]; showExtended: boolean;
  actions: Action[]; standards: Standard[];
  horizontal: string; horizontalResult: string; horizontalAction: string; horizontalOwner: string; horizontalCompletion: string;
  horizontalApplicability: string; horizontalReason: string; summary: string; collaborators: string;
};
type Snapshot = { body: DemoDocument; sources: string[]; risk: string; sameManager: boolean; round: number | null };
type DutyStatus = 'pending' | 'approved' | 'skipped' | 'returned' | 'cancelled';
type Round = {
  number: number; snapshot: Snapshot; professional: DutyStatus; management: DutyStatus; manager: string;
  status: 'reviewing' | 'returned' | 'cancelled' | 'closed'; reason: string;
};
type Missing = { id: string; label: string };
const sourceRows = [
  { id: 'SRC-001', code: 'DEMO-TRACE-08', process: '装配', description: '连接松动线索（演示）', category: '物料', status: '跟进中', materials: ['演示物料A / DEMO-MA / 演示供应商甲 / 批次 DEMO-01 / SQE：演示甲', '演示物料B / DEMO-MB / 演示供应商乙 / 批次 DEMO-02 / SQE：待选'] },
  { id: 'SRC-002', code: 'DEMO-TRACE-08', process: '装配', description: '同码的另一条作业线索（演示）', category: '待分析', status: '跟进中', materials: ['演示物料C / DEMO-MC / 演示供应商甲 / 批次未知 / SQE：待选'] },
  { id: 'SRC-003', code: 'DEMO-TRACE-09', process: '终检', description: '另一来源的检查线索（演示）', category: '工艺', status: '已关闭', materials: ['演示物料D / DEMO-MD / 供应商待确认 / 批次未知 / SQE：待选'] },
];
const standardNames = ['DFMEA', 'PFMEA', '设计记录（图纸 / 技术规格书等）', '特殊特性清单', '过程流程图', '控制计划', 'SOP', '检验基准书', '包装确认单', '内部过程审核检查表', '经验总结报告（LLR）'];
const sectionNames = ['团队与计划', '问题描述', '临时措施', '原因分析', '永久措施计划', '实施与有效性', '横展与标准化', '总结与审核'];
const riskNames = { low: '低风险', medium: '中风险', high: '高风险', critical: '重大风险' };
const dutyNames: Record<DutyStatus, string> = { pending: '待审核', approved: '已通过', skipped: '同人跳过（留痕）', returned: '已退回', cancelled: '已取消' };
const roundNames = { reviewing: '审核中 · 正文锁版', returned: '已退回 · 整轮失效', cancelled: '来源变更撤审 · 整轮失效', closed: '演示汇聚完成 · 不代表真实关闭' };
const blankContainment = (): Containment[] => ([
  ['PCBA', '在制品'], ['PCBA', '智新库存'],
  ['成品', '客户端'], ['成品', '运输中'], ['成品', '智新库存'], ['成品', '在制品'], ['成品', 'VMI仓'],
  ['物料', '供应商'], ['物料', '公司内'],
] as const).map(([group, location]) => ({ group, location, quantity: '', measure: '', owner: '', planned: '', completion: '', ng: '' }));

function initialDocument(): DemoDocument {
  return {
    description: '', analysis: '演示分析：对装配记录与检查点逐项比对，附件位置用于展示外部成稿入口。',
    occurrence: '演示发生因：装配防错不足。', escape: '演示流出因：检查点未覆盖。', system: '',
    temporary: [], containment: blankContainment(), extended: blankContainment(), showExtended: false,
    actions: ['发生因', '流出因'].map((kind, index) => ({
      id: `A${index + 1}`, kind, action: index ? '演示增加检查点' : '演示完善装配防错', owner: '演示负责人',
      plannedAt: '2026-10-25', method: '演示逐件确认并记录后续批次', implementedAt: '2026-10-25', result: '演示措施已导入（非真实实施证据）',
      before: '演示改善前状态', after: '演示改善后状态', firstBatch: `DEMO-FIRST-${index + 1} / 规范演示版`,
      batches: '2', duration: '', record: '演示验证记录：需人工明确选择有效性，不能由日期或文件推定。', effective: '',
    })),
    standards: standardNames.map(name => ({ name, update: '', owner: '', planned: '', completed: '', status: '', reason: '' })),
    horizontal: '', horizontalResult: '', horizontalAction: '', horizontalOwner: '', horizontalCompletion: '',
    horizontalApplicability: '', horizontalReason: '', summary: '', collaborators: '',
  };
}

function missingFields(body: DemoDocument): Missing[] {
  const missing: Missing[] = [];
  const need = (value: string, id: string, label: string) => { if (!value.trim()) missing.push({ id, label }); };
  need(body.description, 'description', 'D2 问题描述');
  need(body.analysis, 'analysis', 'D4 分析过程');
  need(body.occurrence, 'occurrence', 'D4 发生因');
  need(body.escape, 'escape', 'D4 流出因');
  for (const action of body.actions) {
    const fields: [keyof Action, string][] = [
      ['action', '措施'], ['owner', '责任人'], ['plannedAt', '计划日期'], ['method', '验证方法'],
      ['implementedAt', '实施日期'], ['result', '实施结果'], ['before', '改善前状态'], ['after', '改善后状态'],
      ['firstBatch', '首批导入断点'], ['record', '验证记录'],
    ];
    fields.forEach(([key, label]) => need(action[key], `${action.id}-${key}`, `${action.id} ${label}`));
    const batches = Number(action.batches);
    if (!(Number.isSafeInteger(batches) && batches > 0) && !action.duration.trim()) missing.push({ id: `${action.id}-batches`, label: `${action.id} 后续批数或时长` });
    if (action.effective !== 'yes') missing.push({ id: `${action.id}-effective`, label: `${action.id} 明确有效结论` });
  }
  body.standards.forEach((row, index) => {
    if (row.update === 'yes') {
      (['name', 'owner', 'planned', 'completed'] as const).forEach(key => need(row[key], `s${index}-${key}`, `D7 第${index + 1}行 ${key === 'owner' ? '部门 / 主导者' : key === 'name' ? '相关文件' : key === 'planned' ? '计划完成日期' : '实际完成日期'}`));
      if (row.status !== 'done') missing.push({ id: `s${index}-status`, label: `D7 第${index + 1}行 更新完成状态` });
    } else if (row.update === 'no') need(row.reason, `s${index}-reason`, `D7 第${index + 1}行 不适用理由`);
  });
  if (body.horizontalApplicability === 'no') need(body.horizontalReason, 'horizontalReason', 'D7 横展不适用理由');
  if (body.horizontalApplicability === 'yes') {
    (['horizontal', 'horizontalResult', 'horizontalAction', 'horizontalOwner', 'horizontalCompletion'] as const).forEach(key => need(body[key], key, 'D7 横展记录：范围、结果、措施、责任人和完成情况'));
  }
  return missing;
}

function Field({ id, label, value, onChange, readOnly = false, type = 'text', multiline = false, options }: {
  id: string; label: string; value: string; onChange: (value: string) => void; readOnly?: boolean;
  type?: string; multiline?: boolean; options?: [string, string][];
}) {
  return <div className="pe-field"><label htmlFor={id}>{label}</label>
    {options ? <select id={id} value={value} disabled={readOnly} onChange={event => onChange(event.target.value)}>
      {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select> : multiline ? <textarea id={id} rows={3} value={value} disabled={readOnly} onChange={event => onChange(event.target.value)} />
      : <input id={id} type={type} min={type === 'number' ? '0' : undefined} value={value} disabled={readOnly} onChange={event => onChange(event.target.value)} />}
  </div>;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} tabIndex={-1} className="pe-panel pe-section"><h2>{title}</h2>{children}</section>;
}

function DocumentFields({ body, onChange, readOnly, report = false, showAttachment }: {
  body: DemoDocument; onChange: (body: DemoDocument) => void; readOnly: boolean; report?: boolean; showAttachment: (label: string) => void;
}) {
  const prefix = report ? 'report-' : '';
  const labelPrefix = report ? '报告 ' : '';
  function field(key: keyof DemoDocument, label: string, multiline = true) {
    return <Field id={`${prefix}${key}`} label={`${labelPrefix}${label}`} value={String(body[key])} multiline={multiline} readOnly={readOnly}
      onChange={value => onChange({ ...body, [key]: value })} />;
  }
  function attachment(label: string) {
    return <Button htmlType="button" onClick={() => showAttachment(label)}>{label}演示占位</Button>;
  }
  function actionField(action: Action, key: keyof Action, label: string, type = 'text', options?: [string, string][]) {
    return <Field key={key} id={`${prefix}${action.id}-${key}`} label={`${labelPrefix}${action.id} ${label}`} value={action[key]} type={type} options={options} readOnly={readOnly}
      onChange={value => onChange({ ...body, actions: body.actions.map(row => row.id === action.id ? { ...row, [key]: value } : row) })} />;
  }
  function containment(rows: Containment[], key: 'containment' | 'extended') {
    const columns: [keyof Containment, string][] = [['group', '对象'], ['location', '位置 / 范围'], ['quantity', '数量（未知留空）'], ['measure', '措施'], ['owner', '责任人'], ['planned', '计划日期'], ['completion', '完成情况'], ['ng', 'NG数（未知留空）']];
    return <div className="pe-table-scroll"><table aria-label={`${labelPrefix}D3 ${key === 'extended' ? '可选扩展围堵' : '库存围堵'}`}><thead><tr>{columns.map(([name, label]) => <th key={name} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{columns.map(([name, label]) => <td key={name}><Field id={`${prefix}${key}-${index}-${name}`} label={`${labelPrefix}围堵${key === 'extended' ? '扩展' : '库存'}${index + 1} ${label}`}
        value={row[name]} readOnly={readOnly} type={name === 'planned' ? 'date' : name === 'quantity' || name === 'ng' ? 'number' : 'text'}
        onChange={value => onChange({ ...body, [key]: rows.map((item, i) => i === index ? { ...item, [name]: value } : item) })} /></td>)}</tr>)}</tbody></table></div>;
  }
  return <>
    <Section id={report ? 'report-d2' : 'work-d2'} title="D2 问题描述与来源依据">
      {field('description', 'D2 问题描述')}
      <p className="pe-muted">按实际事实说明对象、发生位置、时间与影响。OK / NG 对比仅作引导，不强制两图齐全。</p>
      <div className="pe-actions">{attachment('D2 OK参考')}{attachment('D2 NG参考')}</div>
    </Section>
    <Section id={report ? 'report-d3' : 'work-d3'} title="D3 临时措施与围堵">
      <p className="pe-muted">导入时间是临时措施实际投入使用时间，不等于围堵完结。附件按需；未知数量留空，不默认填零。</p>
      <div className="pe-table-scroll"><table aria-label={`${labelPrefix}D3 临时措施`}><thead><tr><th scope="col">临时措施</th><th scope="col">部门 / 主导者</th><th scope="col">导入时间</th><th scope="col">按需附件</th></tr></thead>
        <tbody>{body.temporary.map((row, index) => <tr key={index}>{(['description', 'owner', 'introducedAt'] as const).map((key, i) => <td key={key}>
          <Field id={`${prefix}temp-${index}-${key}`} label={`${labelPrefix}临时措施${index + 1} ${['描述', '部门 / 主导者', '导入时间'][i]}`} type={key === 'introducedAt' ? 'datetime-local' : 'text'} value={row[key]} readOnly={readOnly}
            onChange={value => onChange({ ...body, temporary: body.temporary.map((item, n) => n === index ? { ...item, [key]: value } : item) })} />
        </td>)}<td>{attachment(`临时措施${index + 1}附件`)}</td></tr>)}</tbody></table></div>
      {!body.temporary.length && <p className="pe-muted">尚未录入临时措施（可保存草稿）。</p>}
      <Button htmlType="button" disabled={readOnly} onClick={() => onChange({ ...body, temporary: [...body.temporary, { description: '', owner: '', introducedAt: '' }] })}>新增临时措施</Button>
      <h3>库存围堵 · PCBA / 成品 / 物料（按需）</h3>{containment(body.containment, 'containment')}
      <Checkbox disabled={readOnly} checked={body.showExtended} onChange={event => onChange({ ...body, showExtended: event.target.checked })}>展示可选扩展围堵</Checkbox>
      {body.showExtended && <><p>受同工装、设备、作业影响或设计相同 / 相似的对象，范围由实际分析确定；不替代 D7。</p>{containment(body.extended, 'extended')}</>}
    </Section>
    <Section id={report ? 'report-d4' : 'work-d4'} title="D4 原因分析">
      {field('analysis', 'D4 分析过程')}{attachment('D4 分析附件')}
      <p className="pe-muted">先呈现分析过程和外部成稿，再分别总结原因；此处不提供在线鱼骨 / FTA 绘图。</p>
      <div className="pe-grid">{field('occurrence', 'D4 发生因')}{field('escape', 'D4 流出因')}</div>{field('system', 'D4 系统因（可空）')}
    </Section>
    <Section id={report ? 'report-d5' : 'work-d5'} title="D5 永久措施计划">
      <p className="pe-muted">D5 与 D6 使用同一条措施，不重复建单；发生因和流出因分别落实措施。</p>
      {body.actions.map(action => <div key={action.id} className="pe-subpanel"><h3>{action.id} · {action.kind}</h3><div className="pe-grid">
        {actionField(action, 'action', '措施')}{actionField(action, 'owner', '责任人')}{actionField(action, 'plannedAt', '计划日期', 'date')}{actionField(action, 'method', '验证方法')}
      </div>{attachment(`${action.id}计划佐证`)}</div>)}
    </Section>
    <Section id={report ? 'report-d6' : 'work-d6'} title="D6 同一措施的实施与有效性">
      <p className="pe-muted">必须填写实际应用改善的首批批次；规范 / 程序版本仅作辅助说明，不能替代首批批次。后续批数与时长二选一即可，不设统一阈值；文件或日期不自动等于有效。</p>
      {body.actions.map(action => <div key={action.id} className="pe-subpanel"><h3>{action.id} · {action.action || action.kind}</h3><div className="pe-grid">
        {actionField(action, 'implementedAt', '实施日期', 'date')}{actionField(action, 'result', '实施结果')}
        {actionField(action, 'before', '改善前状态')}{actionField(action, 'after', '改善后状态')}
        {actionField(action, 'firstBatch', '首批导入断点')}{actionField(action, 'batches', '后续批数', 'number')}
        {actionField(action, 'duration', '后续跟进时长')}{actionField(action, 'record', '验证记录')}
        {actionField(action, 'effective', '明确有效结论', 'text', [['', '待验证（不可完整提交）'], ['yes', '有效（演示人工选择）'], ['no', '无效（继续改善，不可完整提交）']])}
      </div>{attachment(`${action.id}验证佐证`)}</div>)}
    </Section>
    <Section id={report ? 'report-d7' : 'work-d7'} title="D7 横展与标准化">
      <Field id={`${prefix}horizontalApplicability`} label={`${labelPrefix}D7 横展适用性`} value={body.horizontalApplicability} readOnly={readOnly}
        options={ [['', '未评估'], ['yes', '适用'], ['no', '不适用（说明理由）']] } onChange={value => onChange({ ...body, horizontalApplicability: value })} />
      {body.horizontalApplicability === 'yes' && <div className="pe-grid">{field('horizontal', 'D7 对象 / 范围')}{field('horizontalResult', 'D7 检查结果')}{field('horizontalAction', 'D7 横展措施（可引用A1/A2）')}{field('horizontalOwner', 'D7 横展责任人')}{field('horizontalCompletion', 'D7 横展完成情况')}{attachment('D7 横展佐证')}</div>}
      {body.horizontalApplicability === 'no' && field('horizontalReason', 'D7 横展不适用理由')}
      <p className="pe-muted">七列 / 11 个预置文件保留，可新增；按适用性记录，不要求全部更新。不适用写理由，完成标记不代表文件正式发布。</p>
      <div className="pe-table-scroll"><table className="pe-standards" aria-label={`${labelPrefix}D7 标准化清单`}><thead><tr>
        {['序号', '相关文件', '是否需更新', '部门 / 主导者', '计划完成日期', '实际完成日期', '状态'].map(text => <th key={text} scope="col">{text}</th>)}
      </tr></thead><tbody>{body.standards.map((row, index) => {
        const cell = (key: keyof Standard, label: string, type = 'text', options?: [string, string][]) => <Field id={`${prefix}s${index}-${key}`} label={`${labelPrefix}标准化${index + 1} ${label}`} value={row[key]} type={type} options={options} readOnly={readOnly}
          onChange={value => onChange({ ...body, standards: body.standards.map((item, i) => i === index ? { ...item, [key]: value } : item) })} />;
        return <tr key={index}><th scope="row">{index + 1}</th><td>{index < 11 ? row.name : cell('name', '相关文件')}</td><td>{cell('update', '是否需更新', 'text', [['', '未评估'], ['yes', '需要更新'], ['no', '不适用']])}</td>
          <td>{cell('owner', '部门 / 主导者')}</td><td>{cell('planned', '计划完成日期', 'date')}</td><td>{cell('completed', '实际完成日期', 'date')}</td>
          <td>{cell('status', '状态', 'text', [['', '未开始'], ['doing', '处理中'], ['done', '已完成（非正式发布）']])}{row.update === 'no' && cell('reason', '不适用理由')}</td></tr>;
      })}</tbody></table></div>
      <Button htmlType="button" disabled={readOnly} onClick={() => onChange({ ...body, standards: [...body.standards, { name: '', update: '', owner: '', planned: '', completed: '', status: '', reason: '' }] })}>新增标准化行</Button>
    </Section>
    <Section id={report ? 'report-d8' : 'work-d8'} title="D8 总结与审核记录">
      {field('summary', 'D8 关闭总结（草稿）')}<p className="pe-muted">审核职责和轮次在当前对象内展示。D1～D8 是内容分区，不是八级审批。并行汇聚仅为状态演示。</p>
    </Section>
  </>;
}

function RoundSummary({ round, historical = false, onAct }: { round: Round; historical?: boolean; onAct?: (side: 'professional' | 'management', returned: boolean) => void }) {
  return <div className="pe-subpanel"><h3>第 {round.number} 轮 · 演示锁版 R{round.number}</h3><p>{roundNames[round.status]}</p>
    <p className="pe-muted">{historical ? '旧结果不计入新轮；仅供追溯。' : '专业与管理并行，任一待审侧均可先处理。'} {round.reason}</p>
    <div className="pe-grid">{(['professional', 'management'] as const).map(side => {
      const name = side === 'professional' ? '专业审核' : round.manager;
      const status = round[side];
      return <div key={side} role="group" aria-label={name} className="pe-duty"><strong>{name}</strong><p>{side === 'professional' ? '演示发单PQE（实际发单人固定）' : round.manager === '经理审核' ? '演示经理' : '演示分管部长'}</p>
        <Tag color={status === 'pending' ? 'processing' : status === 'returned' ? 'error' : undefined}>{dutyNames[status]}</Tag>
        {!historical && <div className="pe-actions"><Button htmlType="button" disabled={!onAct || round.status !== 'reviewing' || status !== 'pending'} onClick={() => onAct?.(side, false)}>{name}通过</Button>
          <Button htmlType="button" danger disabled={!onAct || round.status !== 'reviewing' || status !== 'pending'} onClick={() => onAct?.(side, true)}>{name}退回</Button></div>}
      </div>;
    })}</div></div>;
}

export function ProcessEightDPreview() {
  const [pageState, setPageState] = useState('normal');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [workspace, setWorkspace] = useState(false);
  const [created, setCreated] = useState(false);
  const [view, setView] = useState('work');
  const [body, setBody] = useState(initialDocument);
  const [sources, setSources] = useState<string[]>([]);
  const [creationSources, setCreationSources] = useState<string[]>([]);
  const [proposed, setProposed] = useState<string[] | null>(null);
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [risk, setRisk] = useState('low');
  const [sameManager, setSameManager] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveFailure, setSaveFailure] = useState(false);
  const [notice, setNotice] = useState('');
  const [missing, setMissing] = useState<Missing[]>([]);
  const [dialog, setDialog] = useState<'issue' | 'leave' | 'reset' | null>(null);
  const [attachment, setAttachment] = useState('');
  const current = rounds.at(-1);
  const reviewing = current?.status === 'reviewing';
  const closed = current?.status === 'closed';
  const readOnly = pageState === 'readonly';
  const locked = readOnly || reviewing || closed;
  const visibleRows = sourceRows.slice(page * 2, page * 2 + 2);
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(value => value !== id) : [...list, id];

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  function edit(next: DemoDocument) {
    if (locked) return;
    setBody(next); setDirty(true);
  }
  function snapshot(round: number | null): Snapshot {
    return { body: structuredClone(body), sources: [...sources], risk, sameManager, round };
  }
  function save() {
    if (locked) return;
    if (saveFailure) { setNotice('模拟失败，输入已保留；没有发起API请求，请取消失败模拟后重试。'); return; }
    setSaved(snapshot(null)); setDirty(false); setNotice('已保存到内存；刷新后丢失，不是服务端保存。');
  }
  function submit() {
    if (locked) return;
    const issues = missingFields(body);
    setMissing(issues);
    if (issues.length) { setNotice('完整提交被缺项阻止；输入保留，请逐项定位。'); return; }
    const number = rounds.length + 1;
    const high = risk === 'high' || risk === 'critical';
    const fixed = snapshot(number);
    setRounds([...rounds, { number, snapshot: fixed, professional: 'pending', management: !high && sameManager ? 'skipped' : 'pending',
      manager: high ? '部长审核' : '经理审核', status: 'reviewing', reason: !high && sameManager ? '负责人 = 经理，仅管理侧同人跳过并留痕，专业仍需审核。' : '' }]);
    setSaved(fixed); setDirty(false); setNotice(`第 ${number} 轮已锁版（内存演示），不是实际workflow提交。`);
  }
  function act(side: 'professional' | 'management', returned: boolean) {
    if (readOnly || !reviewing || current[side] !== 'pending') return;
    const next: Round = { ...current, [side]: returned ? 'returned' : 'approved' };
    if (returned) {
      const other = side === 'professional' ? 'management' : 'professional';
      if (next[other] === 'pending') next[other] = 'cancelled';
      next.status = 'returned'; next.reason = '任一侧退回，整轮失效；原通过仅留历史，重提两侧重新审核。';
    } else if (next.professional === 'approved' && (next.management === 'approved' || next.management === 'skipped')) next.status = 'closed';
    setRounds([...rounds.slice(0, -1), next]);
    setNotice(returned ? '已退回，整轮失效并解锁正文；重提不会沿用旧通过。' : next.status === 'closed' ? '演示两侧汇聚完成，非真实业务关闭。' : '本侧已通过，另一侧仍独立待审。');
  }
  function applySources() {
    if (!proposed?.length || readOnly || closed || !sourceChanged) return;
    if (reviewing) setRounds([...rounds.slice(0, -1), { ...current, status: 'cancelled',
      professional: current.professional === 'pending' ? 'cancelled' : current.professional,
      management: current.management === 'pending' ? 'cancelled' : current.management, reason: '来源变更撤审：用户明确确认，旧轮结果整体失效。' }]);
    setSources([...proposed]); setProposed(null); setDirty(true);
    setNotice(reviewing ? '已确认来源变更并取消整轮审核；原快照保留，新轮必须重审。' : '来源仅在内存中调整，尚未保存草稿。');
  }
  const sourceChanged = proposed !== null && (proposed.length !== sources.length || proposed.some(id => !sources.includes(id)));
  function sourceDetails(ids: string[]) {
    return <ul className="pe-source-list">{sourceRows.filter(row => ids.includes(row.id)).map(row => <li key={row.id}><strong>{row.id} · {row.code} · {row.process}</strong><p>{row.description} · {row.category} · {row.status}</p><ul>{row.materials.map(material => <li key={material}>{material}</li>)}</ul></li>)}</ul>;
  }
  const reportRound = saved?.round === null ? undefined : rounds.find(round => round.number === saved?.round);

  return <div className="pe-preview">
    <a className="pe-skip" href="#pe-main">跳到主要内容</a>
    <header className="pe-header"><div className="pe-actions"><ClipboardList aria-hidden="true" size={22} /><strong>过程质量 · N3 交互样例</strong><Tag>Issue #70 / V0.0.31 · 非生产</Tag></div><AppearanceButton /></header>
    <main id="pe-main" className="pe-main">
      <Alert type="warning" showIcon title="仅内存 / 无API / 刷新重置；不代表真实业务验收" />
      <div className="pe-toolbar"><p className="pe-muted">不解析真实权限，不启动 workflow；无真实上传、扫描或PDF导出。示例日期、人员和物料全部为虚构预填，不是业务默认值。</p>
        <Field id="page-state" label="演示页面状态" value={pageState} onChange={setPageState} options={ [['normal', '正常'], ['readonly', '只读（无写入资格演示）'], ['empty', '空态'], ['error', '错误'], ['loading', '加载中']] } />
        <Button htmlType="button" onClick={() => setDialog('reset')}>重置全部内存样例</Button>
      </div>
      <div role="status" aria-label="操作反馈" aria-live="polite" className="pe-notice">{notice || '请选择来源，查看发单预览后进入内部8D。'}</div>
      {pageState === 'empty' ? <div className="pe-panel"><Empty description="暂无来源（演示空态）" image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
        : pageState === 'error' ? <div className="pe-panel"><h2>演示读取失败，未发起网络请求</h2><Button htmlType="button" onClick={() => setPageState('normal')}>恢复正常演示</Button></div>
          : pageState === 'loading' ? <div className="pe-panel" role="status" aria-label="演示加载状态">加载状态演示，不请求服务；可从上方切回正常。</div>
            : !workspace ? <>
              <div className="pe-toolbar"><div><h1>过程来源台账</h1><p className="pe-muted">一条来源一行；同工序同条码仅提示，不阻断登记或自动合并。</p></div>
                <div className="pe-actions">{created && <Button htmlType="button" onClick={() => setWorkspace(true)}>返回当前8D样例</Button>}
                  <Button htmlType="button" type="primary" disabled={readOnly || !selected.length} onClick={() => setDialog('issue')}>发单预览</Button></div>
              </div>
              <section className="pe-panel" aria-label="来源台账"><div className="pe-selection" role="status" aria-label="来源选择摘要">已选 {selected.length} 条 · 跨页保留选择，不只处理当前页；发单预览展示全部来源。
                <Button htmlType="button" disabled={readOnly || !selected.length} onClick={() => setSelected([])}>清空选择</Button></div>
                <div className="pe-table-scroll"><table aria-label="过程来源台账"><thead><tr>{['选择', '来源编号 / 条码', '工序', '问题线索', '责任分类', '状态', '物料'].map(text => <th key={text} scope="col">{text}</th>)}</tr></thead>
                  <tbody>{visibleRows.map(row => <Fragment key={row.id}><tr><td><Checkbox aria-label={`选择来源 ${row.id}`} checked={selected.includes(row.id)} disabled={readOnly} onChange={() => setSelected(toggle(selected, row.id))} /></td>
                    <th scope="row">{row.id}<p>{row.code}</p>{row.code === 'DEMO-TRACE-08' && <Tag color="warning">同码多线索 · 不自动合并</Tag>}</th><td>{row.process}</td><td>{row.description}</td><td>{row.category}</td><td>{row.status}</td>
                    <td><Button htmlType="button" aria-expanded={expanded.includes(row.id)} aria-controls={`materials-${row.id}`} onClick={() => setExpanded(toggle(expanded, row.id))}>{expanded.includes(row.id) ? '收起' : '展开'} {row.id} 物料</Button><p>{row.materials.length} 项物料</p></td></tr>
                    {expanded.includes(row.id) && <tr><td colSpan={7}><section id={`materials-${row.id}`} aria-label={`${row.id} 多物料`}><ul>{row.materials.map(value => <li key={value}>{value}</li>)}</ul><p className="pe-muted">四类复核事实：批次确认 / 影响范围 / 原因复核 / 处置建议分项保存（正式页后续接入）。SQE 需人工选有效人员，不自动映射；未发8D不生成正式待办。</p></section></td></tr>}
                  </Fragment>)}</tbody></table></div>
                <div className="pe-toolbar"><span>共 3 条来源 · 第 {page + 1} / 2 页</span><div className="pe-actions"><Button htmlType="button" disabled={page === 0} onClick={() => setPage(0)}>上一页</Button><Button htmlType="button" disabled={page === 1} onClick={() => setPage(1)}>下一页</Button></div></div>
              </section>
            </> : <>
              <div className="pe-toolbar"><div><h1>内部8D · 演示工作空间</h1><p>DEMO-8D-001 · 演示负责人 · {closed ? '演示汇聚完成（只读）' : reviewing ? '审核中（锁版）' : '可编辑内存草稿'}{dirty ? ' · 有未保存修改' : ''}</p></div>
                <div className="pe-actions"><Button htmlType="button" onClick={() => dirty ? setDialog('leave') : setWorkspace(false)}>返回来源台账</Button><Button htmlType="button" disabled={locked} onClick={save}>保存内存草稿</Button><Button htmlType="button" type="primary" disabled={locked} onClick={submit}>完整提交（演示）</Button></div></div>
              <div className="pe-toolbar"><div className="pe-actions" role="group" aria-label="工作空间视图">{[['work', '工作区'], ['report', '报告'], ['history', '轨迹']].map(([key, label]) => <Button htmlType="button" key={key} aria-label={label} aria-pressed={view === key} onClick={() => setView(key)}>{label}</Button>)}</div>
                <Checkbox disabled={locked} checked={saveFailure} onChange={event => setSaveFailure(event.target.checked)}>模拟保存失败（无请求）</Checkbox></div>
              {readOnly && <p className="pe-notice">只读演示：无写入资格，查看不等于真实权限校验。</p>}
              {view === 'work' && <>
                {missing.length > 0 && <section className="pe-validation" aria-label="提交缺项"><h2>提交缺项 · 输入已保留</h2><ul>{missing.map((item, index) => <li key={`${item.id}-${index}`}><Button htmlType="button" onClick={() => document.getElementById(item.id)?.focus()}>定位 {item.label}</Button></li>)}</ul></section>}
                <div className="pe-workspace"><nav className="pe-nav" aria-label="D1至D8内容导航"><strong>内容分区</strong><p className="pe-muted">不是八级审批</p>{sectionNames.map((name, index) => <a key={name} href={`#work-d${index + 1}`}>D{index + 1} {name}</a>)}</nav>
                  <div className="pe-content"><Section id="work-d1" title="D1 团队与计划">
                    <p>实际发单人 / 专业审核：演示发单PQE（固定） · 责任科室 / 负责人：演示科室 / 演示负责人</p>
                    <p className="pe-muted">本页不选真实人员、不代配权限。日期预填只服务内容展示，不代替正式页明确选择期限。</p>
                    <Field id="collaborators" label="D1 协作者（仅演示）" value={body.collaborators} readOnly={locked} onChange={value => edit({ ...body, collaborators: value })} />
                    <div className="pe-actions"><span id="pe-risk-label">风险等级（演示场景）</span><Radio.Group aria-labelledby="pe-risk-label" value={risk} disabled={locked} onChange={event => { setRisk(event.target.value); setDirty(true); }}>
                      {Object.entries(riskNames).map(([value, name]) => <Radio key={value} value={value}>{name}</Radio>)}</Radio.Group></div>
                    <Checkbox disabled={locked} checked={sameManager} onChange={event => { setSameManager(event.target.checked); setDirty(true); }}>演示负责人 = 经理</Checkbox>
                    <p className="pe-muted">低 / 中：专业 + 经理并行；高 / 重大：专业 + 分管部长并行。经理同人仅低 / 中跳管理侧并留痕。</p>
                  </Section>
                    <section className="pe-panel" aria-label="关联来源"><div className="pe-toolbar"><h2>D2 来源明细 · {sources.length} 条</h2><Button htmlType="button" disabled={readOnly || closed} onClick={() => setProposed([...sources])}>调整来源</Button></div>{sourceDetails(sources)}</section>
                    <DocumentFields body={body} onChange={edit} readOnly={locked} showAttachment={setAttachment} />
                  </div>
                </div>
                <section aria-label="当前审核轮次" className="pe-panel"><h2>关闭审核 · 与内容分区分离</h2>{current ? <RoundSummary round={current} onAct={readOnly ? undefined : act} /> : <p>尚未完整提交；草稿可以不完整。专业与管理职责均未启动。</p>}</section>
              </>}
              {view === 'report' && <section aria-label="报告预览" className="pe-report"><div className="pe-panel"><div className="pe-toolbar"><h2>网页报告预览 · 内存已保存快照</h2><Button htmlType="button" disabled>PDF导出未接入</Button></div><p>仅展示最后保存或提交的内存版本；未保存输入不进入报告，不声称生成真实PDF。</p>
                {saved && <><p>{saved.round === null ? '已保存草稿 · 非关闭版' : `第 ${saved.round} 轮锁定快照 · 非真实报告`}{dirty ? ' · 当前另有未保存修改' : ''}</p>{sourceDetails(saved.sources)}<p>风险：{riskNames[saved.risk as keyof typeof riskNames]} · 专业审核人：演示发单PQE · 负责人：演示负责人 · 协作者：{saved.body.collaborators || '未填写'}</p></>}
              </div>{saved ? <><DocumentFields body={saved.body} onChange={() => {}} readOnly report showAttachment={setAttachment} />{reportRound && <RoundSummary round={reportRound} historical />}</> : <Empty description="尚无已保存快照，请先保存内存草稿" />}</section>}
              {view === 'history' && <section className="pe-panel" aria-label="轮次轨迹"><h2>轮次轨迹 · 仅内存演示</h2><p className="pe-muted">不是服务端审计记录；每轮保留独立正文及来源快照，旧结果不计入新轮。</p>{rounds.length ? rounds.map(round => <div key={round.number}><RoundSummary round={round} historical /><details><summary>查看第 {round.number} 轮快照</summary><p>{round.snapshot.body.description}</p>{sourceDetails(round.snapshot.sources)}</details></div>) : <Empty description="尚无审核轮次" />}</section>}
            </>}
    </main>
    <Modal open={dialog === 'issue'} title="发单预览（非真实发单）" onCancel={() => setDialog(null)} footer={null} destroyOnHidden>
      <p>已选 {selected.length} 条来源。专业审核人固定为演示发单PQE，演示负责人属于演示责任科室。</p>{sourceDetails(selected)}
      <p>创建仅替换本页当前内存8D，不写台账、不创建真实待办。{created && '当前内存工作区（含草稿和轮次）将被替换。'}</p>
      <div className="pe-actions"><Button htmlType="button" aria-label="取消" onClick={() => setDialog(null)}>取消</Button><Button htmlType="button" type="primary" disabled={readOnly || !selected.length} onClick={() => {
        setSources([...selected]); setCreationSources([...selected]); setBody(initialDocument()); setRounds([]); setSaved(null); setMissing([]); setRisk('low'); setSameManager(false); setDirty(false); setSaveFailure(false); setView('work'); setWorkspace(true); setCreated(true); setDialog(null); setNotice('已创建内存样例；D2描述和D6明确有效结论待填写，其余预填均为虚构演示内容。');
      }}>创建内存8D样例</Button></div>
    </Modal>
    <Modal open={proposed !== null} title="调整来源（内存演示）" onCancel={() => setProposed(null)} footer={null} destroyOnHidden>
      <p>{reviewing ? '在审来源改变将取消整轮审核，原通过保留历史但不再有效。取消不写入任何变更。' : '至少保留一条来源；本次操作只改变内存草稿。'}</p>
      <div className="pe-dialog-list">{sourceRows.map(row => <Checkbox key={row.id} checked={proposed?.includes(row.id)} disabled={readOnly || closed} onChange={() => setProposed(toggle(proposed ?? [], row.id))}>关联 {row.id}</Checkbox>)}</div>
      {!proposed?.length && <p>请至少选择一条来源。</p>}
      <div className="pe-actions"><Button htmlType="button" aria-label="取消" onClick={() => setProposed(null)}>取消</Button><Button htmlType="button" danger={reviewing} disabled={readOnly || closed || !proposed?.length || !sourceChanged} onClick={applySources}>{reviewing ? '确认变更并取消整轮审核' : '应用来源变更'}</Button></div>
    </Modal>
    <Modal open={!!attachment} title="附件演示占位 · 非真实文件" onCancel={() => setAttachment('')} footer={<Button htmlType="button" onClick={() => setAttachment('')}>关闭占位预览</Button>} destroyOnHidden>
      <h3>{attachment}</h3><div className="pe-attachment">演示成稿预览区域</div><p>仅用于讨论点击入口和弹窗布局。未上传、未扫描、无文件内容，不代表扫描通过；不提供真实附件下载。</p>
    </Modal>
    <Modal open={dialog === 'leave'} title="未保存的内存修改" onCancel={() => setDialog(null)} footer={null} destroyOnHidden>
      <p>返回台账将放弃未保存修改；刷新仍会丢失全部内存数据。</p><div className="pe-actions"><Button htmlType="button" onClick={() => setDialog(null)}>继续编辑</Button><Button htmlType="button" danger onClick={() => {
        const restored = saved ?? { body: initialDocument(), sources: creationSources, risk: 'low', sameManager: false };
        setBody(structuredClone(restored.body)); setSources([...restored.sources]); setRisk(restored.risk); setSameManager(restored.sameManager); setDirty(false); setMissing([]); setWorkspace(false); setDialog(null);
      }}>放弃修改并返回台账</Button></div>
    </Modal>
    <Modal open={dialog === 'reset'} title="重置全部内存样例？" onCancel={() => setDialog(null)} footer={null} destroyOnHidden>
      <p>本页草稿、选择、来源与审核轮次全部清空；无服务端数据受影响。</p><div className="pe-actions"><Button htmlType="button" onClick={() => setDialog(null)}>取消</Button><Button htmlType="button" danger onClick={() => {
        setBody(initialDocument()); setSelected([]); setSources([]); setCreationSources([]); setExpanded([]); setRounds([]); setSaved(null); setProposed(null); setMissing([]); setDirty(false); setWorkspace(false); setCreated(false); setPage(0); setPageState('normal'); setRisk('low'); setSameManager(false); setSaveFailure(false); setView('work'); setNotice('全部内存样例已重置。'); setDialog(null);
      }}>确认重置内存</Button></div>
    </Modal>
  </div>;
}
