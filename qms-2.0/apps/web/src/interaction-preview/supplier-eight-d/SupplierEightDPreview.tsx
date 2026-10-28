import { Alert, Button, Checkbox, Empty, Modal, Tag } from 'antd';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AppearanceButton } from '../../theme/AppearanceButton';
import { currentRecord, dateEditable, editable, extensionReviewable, initialDemo, managementDuties, transition } from './model';
import type { Action, Actor, Duty, Risk, Stage } from './model';
import './supplier-eight-d.css';

const actors: Record<Actor, string> = { SQE: '本单 SQE', SUPPLIER: '本企业供应商', MANAGER: '本单有效经理', MINISTER: '本单部长', OTHER_MANAGER: '其他科室经理（无本单资格）' };
const duties: Record<Duty, string> = { SQE: 'SQE', MANAGER: '经理', MINISTER: '部长' };
const risks: Record<Risk, string> = { LOW: '低风险', MEDIUM: '中风险', HIGH: '高风险', CRITICAL: '重大风险' };
const stages: Record<Stage, string> = { ANALYSIS: '原因分析 / 对策制定期限', SUBMISSION: '完整提交计划时间', CLOSURE: '计划关闭时间' };
const statuses = { DRAFT: '内部发单草稿', FILLING: '供应商填写中', SQE_PENDING: '待 SQE 专业审核 · 正文锁版', MANAGEMENT_PENDING: '待管理审批 · 正文锁版', RETURNED: '退回供应商修改 · 旧轮失效', CLOSED: '已关闭（内存演示）' };
const extensionStatuses = { SQE_PENDING: '待 SQE 审批', MANAGER_PENDING: '待经理审批', APPROVED: '已批准（内存）', RETURNED: '已退回（原期限不变）' };

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div className="se-field"><label htmlFor={id}>{label}</label>{children}</div>;
}
function ScrollTable({ name, children }: { name: string; children: ReactNode }) {
  return <div className="se-table-scroll" tabIndex={0} role="region" aria-label={`${name}滚动区域`}><table aria-label={name}>{children}</table></div>;
}

export function SupplierEightDPreview() {
  const [state, setState] = useState(initialDemo);
  const [actor, setActor] = useState<Actor>('SQE');
  const [source, setSource] = useState('过程');
  const [reason, setReason] = useState('');
  const [supplement, setSupplement] = useState('');
  const [stage, setStage] = useState<Stage>('ANALYSIS');
  const [requested, setRequested] = useState('');
  const [dialog, setDialog] = useState<'release' | 'both' | 'reset' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState('请选择场景并从内部草稿开始；所有操作仅作用于本页内存。');
  const supplier = actor === 'SUPPLIER';
  const draft = state.status === 'DRAFT';
  const locked = state.status === 'SQE_PENDING' || state.status === 'MANAGEMENT_PENDING';
  const closed = state.status === 'CLOSED';
  const canFill = supplier && editable(state);
  const dual = state.samePerson && (state.risk === 'HIGH' || state.risk === 'CRITICAL');
  const canSupplement = closed && (actor === 'SQE' || actor === 'MANAGER');
  const e = state.extension;
  const canExtensionReview = extensionReviewable(state, actor);
  const send = (action: Action) => {
    const next = transition(state, actor, action);
    setState(next);
    setFeedback(next === state ? '未执行：请检查当前身份、阶段及必填内容。' : '已更新本页内存；没有发送请求、上传、扫描或正式业务写入。');
  };
  const open = (name: 'release' | 'both' | 'reset') => { setConfirmed(false); setDialog(name); };
  const review = (duty: Duty | 'BOTH', result: 'APPROVED' | 'RETURNED') => {
    send({ type: 'review', duty, result, confirmed, round: state.round, reason });
    if (duty === 'BOTH') setDialog(null);
    setReason('');
  };
  const canReview = (duty: Duty) => !currentRecord(state, duty) && (duty === 'SQE'
    ? actor === 'SQE' && state.status === 'SQE_PENDING'
    : !dual && actor === duty && state.status === 'MANAGEMENT_PENDING' && managementDuties(state).includes(duty));

  return <div className="se-preview">
    <a className="se-skip" href="#se-main">跳到供应商交互内容</a>
    <header className="se-header"><strong><ClipboardList size={20} aria-hidden="true" /> QMS · 供应商质量</strong><AppearanceButton /></header>
    <main id="se-main" className="se-main">
      <div className="se-toolbar"><div><h1>供应商独立 8D · 交互样例</h1><p className="se-muted">SUP-DEMO-001 · 演示供应商甲 · 不绑定任何真实企业或人员</p></div><Button onClick={() => open('reset')}>重置交互样例</Button></div>
      <Alert type="warning" showIcon title="仅内存样例，刷新即重置；不是正式 API，也不是生产或人工验收证据。" description="只演示新生命周期与披露边界。D2～D8 使用文字摘要代表已填写的既有表单，不重复建设完整编辑器；不执行附件上传、扫描、报告生成或真实审批。外观偏好仍复用浏览器设置。" />
      <div className="se-controls">
        <Field id="se-actor" label="演示操作身份（非认证）"><select id="se-actor" value={actor} onChange={event => { setActor(event.target.value as Actor); setReason(''); setSupplement(''); }}>{Object.entries(actors).map(([key, value]) => <option key={key} value={key}>{value}{key === 'MANAGER' && dual ? '（兼部长）' : ''}</option>)}</select></Field>
        <section aria-label="当前状态" className="se-current" role="region"><Tag color={closed ? 'success' : 'processing'}>{statuses[state.status]}</Tag><span>第 {state.round} 轮 · {risks[state.risk]} · {locked ? '在审不允许代改' : '按当前身份操作'}</span></section>
      </div>
      <nav className="se-nav" aria-label="供应商样例分区"><a href="#se-disclosure">披露与释放</a><a href="#se-body">完整提交摘要</a><a href="#se-review">先专业后管理</a><a href="#se-dates">阶段期限 / 延期</a><a href="#se-report">批准与补充</a></nav>
      <div className="se-workspace">
        <div className="se-content">
          <section id="se-disclosure" className="se-panel" aria-label={supplier ? '供应商可见内容' : '内部复制与披露'}>
            <h2>01 · 披露与正式释放</h2>
            {supplier ? draft ? <Empty description="尚未释放，本企业暂无可见内容" /> : <><p className="se-snapshot">{state.disclosure}</p><p className="se-muted">仅本企业获准文字；无内部来源跳转或附件下载许可。释放不等于真实送达。</p></> : <>
              <p>内部原单与供应商单独立：不回写、不联动关闭。来源 SQE 正式协作待办以内部 8D 正式发单为时点，不因选物料、四类复核或复制草稿提前产生。</p>
              <div className="se-grid"><Field id="se-source" label="复制来源（演示）"><select id="se-source" disabled={!draft || actor !== 'SQE'} value={source} onChange={event => setSource(event.target.value)}>{['过程', '客诉', '新品', '来料独立入口'].map(value => <option key={value}>{value}</option>)}</select></Field>
                <Field id="se-risk" label="供应商单独立风险"><select id="se-risk" value={state.risk} disabled={!draft || actor !== 'SQE'} onChange={event => send({ type: 'configure', risk: event.target.value as Risk, samePerson: state.samePerson, portal: state.portal })}>{Object.entries(risks).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field></div>
              <div className="se-actions"><Button disabled={!draft || actor !== 'SQE'} onClick={() => send({ type: 'disclosure', text: `${source}适当内容副本（演示）：连接端子批次 DEMO-S01，连接松动，请核对围堵措施。` })}>复制适当内容到草稿</Button><Button aria-pressed={state.samePerson} disabled={!draft || actor !== 'SQE'} onClick={() => send({ type: 'configure', risk: state.risk, portal: state.portal, samePerson: !state.samePerson })}>经理与部长为同一人（演示）</Button><Checkbox disabled={!draft || actor !== 'SQE'} checked={state.portal} onChange={event => send({ type: 'configure', risk: state.risk, samePerson: state.samePerson, portal: event.target.checked })}>已配置本企业有效门户账号（演示）</Checkbox></div>
              <Field id="se-disclosure-text" label="外发草稿文字"><textarea id="se-disclosure-text" rows={3} value={state.disclosure} disabled={!draft || actor !== 'SQE'} onChange={event => send({ type: 'disclosure', text: event.target.value })} /></Field>
              <p className="se-muted">默认只含本企业物料和不良事实，不带客户、VIN、联系方式、内部分析或其他供应商资料。自由文字须人工核对，本样例不会自动清除敏感语义。</p>
              <ScrollTable name="附件披露边界"><thead><tr><th>候选证据</th><th>当前事实</th><th>本次外发</th></tr></thead><tbody><tr><td>源照片 source-file-demo</td><td>未接扫描与对象版本核验</td><td>排除；复制 ID 不授予门户权限</td></tr><tr><td>内部分析材料</td><td>内部受控资料</td><td>排除；不自动外发</td></tr></tbody></ScrollTable>
              <Button type="primary" disabled={!draft || actor !== 'SQE' || !state.portal || !state.disclosure.trim() || !state.dates.ANALYSIS || !state.dates.CLOSURE} onClick={() => open('release')}>预览并释放到演示门户</Button>
              {!state.portal && <p role="alert">未配置有效账号，不可释放，不会标记为已送达。</p>}
              {draft && <p className="se-muted">先在阶段期限区填写 SQE 的两个日期，再明确确认释放。没有默认期限。</p>}
            </>}
          </section>
          <section id="se-body" className="se-panel" aria-label="供应商完整提交摘要">
            <h2>02 · 完整表单摘要</h2>
            <p>D2 问题事实 / D3 围堵 / D4 原因 / D5 对策 / D6 有效性 / D7 横展标准化 / D8 总结。此处仅模拟已完成表单的摘要，不验证真实完整性或附件。</p>
            <p className="se-muted"><strong>字段共通、审批独立。</strong>沿用既有 D2～D8 字段规则，不沿用内部审批链；供应商仍先 SQE 后管理。</p>
            <ul className="se-muted">
              <li>D3 导入时间是临时措施实际投入使用时间，不等于围堵完结；附件按需，可选扩展围堵不强制。</li>
              <li>D6 检验规范 / 设备程序变更也须记录实际应用改善的首批批次，版本 / 日期不能替代；后续批数或跟进时长二选一，不设统一阈值，不凭文件或日期自动判有效。</li>
              <li>D7 保留七列 / 11 个预置文件，可新增；按适用性记录，不要求全部更新，不适用写理由；完成标记不代表正式发布。</li>
              <li>D4 系统因可空，OK / NG 图齐全性不强制，不因缺图或未填系统因阻断提交。</li>
            </ul>
            <Field id="se-body-text" label="完整表单摘要（演示）"><textarea id="se-body-text" rows={4} value={draft ? '' : state.body} disabled={!canFill} onChange={event => send({ type: 'edit', body: event.target.value, measuresReady: state.measuresReady })} /></Field>
            <Checkbox disabled={!canFill} checked={state.measuresReady} onChange={event => send({ type: 'edit', body: state.body, measuresReady: event.target.checked })}>已制定对策（演示）</Checkbox>
            <div className="se-actions"><Button type="primary" disabled={!canFill || !state.body.trim() || !state.measuresReady || !state.dates.SUBMISSION} onClick={() => send({ type: 'submit' })}>完整提交（仅内存）</Button><a href="/process-eight-d-preview.html" target="_blank" rel="noreferrer">查看既有 D2～D8 分区样例（内部规则，不是供应商审批链）</a></div>
            <p className="se-muted">提交后本轮正文锁定；供应商、SQE 和经理均不能代改。退回后由供应商修改重提，所有职责重新审核。</p>
          </section>
          <section id="se-dates" className="se-panel" aria-label="阶段期限与独立延期">
            <h2>03 · 阶段期限与独立延期</h2>
            <div className="se-grid">{(Object.keys(stages) as Stage[]).map(key => <Field key={key} id={`se-date-${key}`} label={stages[key]}><input id={`se-date-${key}`} type="date" value={state.dates[key]} max={!draft && state.dates[key] ? state.dates[key] : undefined} disabled={!dateEditable(state, actor, key)} onChange={event => send({ type: 'date', stage: key, date: event.target.value })} /></Field>)}</div>
            <p className="se-muted">SQE 设置分析及计划关闭；对策制定后供应商填写完整提交计划。已有有效日期仅可普通提前，不可清空或普通延期；待延期审批的对应日期禁止普通编辑。申请不暂停，原有效期限继续计时；最终批准后才生效，历史超期不抹除。计划不等于实际关闭。</p>
            <p><strong>延期专用链：</strong>{state.risk === 'LOW' || state.risk === 'MEDIUM' ? '供应商 → SQE（最终）' : '供应商 → SQE → 经理（最终）'}；不需要部长，不沿用关闭双批。每次重置演示一笔延期。</p>
            <div className="se-grid"><Field id="se-extension-stage" label="申请延期阶段"><select id="se-extension-stage" value={stage} disabled={!canFill || !!e} onChange={event => setStage(event.target.value as Stage)}>{Object.entries(stages).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></Field><Field id="se-requested" label="申请延期至"><input id="se-requested" type="date" value={requested} disabled={!canFill || !!e} onChange={event => setRequested(event.target.value)} /></Field></div>
            <div className="se-actions"><Button disabled={!canFill || !!e || !requested || !state.dates[stage] || requested <= state.dates[stage]} onClick={() => send({ type: 'extend', stage, date: requested })}>申请延期（仅内存）</Button><Button disabled={!canExtensionReview} onClick={() => send({ type: 'extension-review', result: 'APPROVED' })}>批准本级延期</Button><Button danger disabled={!canExtensionReview} onClick={() => send({ type: 'extension-review', result: 'RETURNED' })}>退回延期</Button></div>
            {e && <ScrollTable name="延期记录"><thead><tr><th>阶段</th><th>原期限</th><th>申请期限</th><th>审批状态</th></tr></thead><tbody><tr><td>{stages[e.stage]}</td><td>{e.original}</td><td>{e.requested}</td><td>{extensionStatuses[e.status]}{e.round !== state.round && (e.status === 'SQE_PENDING' || e.status === 'MANAGER_PENDING') ? ' · 旧轮失效' : ''}</td></tr></tbody></ScrollTable>}
          </section>
          <section id="se-report" className="se-panel" aria-label="批准与补充版本">
            <h2>04 · 批准依据与当前补充</h2>
            <section aria-label="批准依据"><h3>关闭时批准依据（固定）</h3><p>{state.approved || '尚未形成批准依据'}</p><p>实际关闭时刻（内存汇聚）：{state.closedAt || '尚未关闭'} · 风险：{risks[state.risk]}</p></section>
            {!supplier && <section aria-label="当前内部补充"><h3>当前内部补充（不冒充原批准）</h3>{state.supplements.length ? <ol>{state.supplements.map((item, index) => <li key={index}>补充 {index + 1} · {actors[item.actor]}：{item.text}</li>)}</ol> : <p className="se-muted">暂无闭后资料补充。</p>}
              {canSupplement && <><Field id="se-supplement" label="闭后补充说明"><textarea id="se-supplement" rows={3} value={supplement} onChange={event => setSupplement(event.target.value)} /></Field><Button disabled={!supplement.trim()} onClick={() => { send({ type: 'supplement', text: supplement }); setSupplement(''); }}>保存闭后补充（仅内存）</Button></>}
              <p className="se-muted">仅本单 SQE / 有效经理修补资料；部长、其他经理和供应商不可代改。保存不重开、不造待办、不重新审批，也不改变风险、批准依据或实际关闭时间。</p>
            </section>}
            {supplier && <p className="se-muted">供应商仅看到获准的提交 / 批准版本，不自动获准内部闭后补充。</p>}
          </section>
        </div>
        <aside id="se-review" className="se-panel se-review" aria-label="关闭审核与职责记录">
          <h2>先专业，后管理</h2><p>SQE 专业审核通过后，低 / 中由经理审批；高 / 重大经理与部长并行，缺一不可。</p>
          {dual && <p className="se-notice">兼岗人员须明确确认两项职责。经理与部长各留一份记录，不是免审或自动通过。</p>}
          <ol className="se-duty-list">{(['SQE', ...managementDuties(state)] as Duty[]).map(duty => {
            const record = currentRecord(state, duty);
            const active = duty === 'SQE' ? state.status === 'SQE_PENDING' : state.status === 'MANAGEMENT_PENDING';
            return <li key={duty}><strong>{duties[duty]}</strong><span>{record ? `${record.result === 'APPROVED' ? '已通过' : '已退回'}${state.status === 'RETURNED' ? ' · 旧轮失效' : ''}` : active ? '待处理' : '未开放'}</span></li>;
          })}</ol>
          <Field id="se-reason" label="审核意见"><textarea id="se-reason" rows={3} disabled={!locked || supplier || actor === 'OTHER_MANAGER'} value={reason} onChange={event => setReason(event.target.value)} /></Field>
          <div className="se-review-actions">{(['SQE', 'MANAGER', 'MINISTER'] as Duty[]).map(duty => <div className="se-actions" key={duty}><Button disabled={!canReview(duty) || !reason.trim()} onClick={() => review(duty, 'APPROVED')}>{duties[duty]} 通过</Button><Button danger disabled={!canReview(duty) || !reason.trim()} onClick={() => review(duty, 'RETURNED')}>{duties[duty]} 退回</Button></div>)}
            {dual && <Button type="primary" disabled={actor !== 'MANAGER' || state.status !== 'MANAGEMENT_PENDING' || !reason.trim()} onClick={() => open('both')}>同时处理经理与部长职责</Button>}
          </div>
          <p className="se-muted">任一退回后旧轮失效，迟到结果不入新轮；重提必须重走 SQE 及全部管理职责。延期与此区相互独立。</p>
          <ScrollTable name="审核职责记录"><thead><tr><th>轮次 / 版本</th><th>职责</th><th>结果</th><th>操作</th><th>意见 / 操作者</th></tr></thead><tbody>{state.records.map((record, index) => <tr key={index}><td>R{record.round} / V{record.round}{record.round !== state.round || state.status === 'RETURNED' ? ' · 旧轮失效' : ''}</td><td>{duties[record.duty]}</td><td>{record.result === 'APPROVED' ? '通过' : '退回'}</td><td>DEMO-OP-{record.operation}</td><td>{record.reason} · {actors[record.actor]}</td></tr>)}</tbody></ScrollTable>
          {!state.records.length && <p className="se-muted">暂无审核记录；选择身份不会自动审批。</p>}
        </aside>
      </div>
      <p role="status" aria-label="操作反馈" className="se-notice">{feedback}</p>
    </main>
    <Modal title={dialog === 'release' ? '释放前外发预览' : dialog === 'both' ? '同人双职责明确确认' : '重置内存样例？'} open={dialog !== null} onCancel={() => setDialog(null)} footer={dialog === 'release'
      ? <><Button onClick={() => setDialog(null)}>返回核对</Button><Button type="primary" disabled={!confirmed} onClick={() => { send({ type: 'release', confirmed }); setDialog(null); }}>确认释放（仅内存）</Button></>
      : dialog === 'both' ? <><Button onClick={() => setDialog(null)}>取消</Button><Button danger disabled={!confirmed} onClick={() => review('BOTH', 'RETURNED')}>确认两项职责退回</Button><Button type="primary" disabled={!confirmed} onClick={() => review('BOTH', 'APPROVED')}>确认两项职责通过</Button></>
        : <><Button onClick={() => setDialog(null)}>继续当前样例</Button><Button danger onClick={() => { setState(initialDemo()); setActor('SQE'); setSource('过程'); setReason(''); setSupplement(''); setStage('ANALYSIS'); setRequested(''); setDialog(null); setFeedback('内存样例已重置；未修改任何真实业务。'); }}>确认清除并重置</Button></>}>
      {dialog === 'release' ? <><p>目标：演示供应商甲 · {risks[state.risk]}</p><p className="se-snapshot">{state.disclosure}</p><p>附件全部排除；没有自动脱敏、真实授权或送达。内部原单不会变化。</p><Checkbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)}>已人工核对外发文字及披露范围（演示）</Checkbox></>
        : dialog === 'both' ? <><p>第 {state.round} 轮 / V{state.round} · {risks[state.risk]}</p><ul><li>经理职责：本单责任科室管理审批</li><li>部长职责：本单责任部门管理审批</li></ul><p>同一意见：{reason}。一次操作分别写入两份职责记录；不合并 SQE 专业审核。</p><Checkbox checked={confirmed} onChange={event => setConfirmed(event.target.checked)}>我确认本次同时履行经理与部长两项职责</Checkbox></>
          : <p>清除本页草稿、轮次、延期和补充记录，回到内部草稿。外观设置保持不变。</p>}
    </Modal>
  </div>;
}
