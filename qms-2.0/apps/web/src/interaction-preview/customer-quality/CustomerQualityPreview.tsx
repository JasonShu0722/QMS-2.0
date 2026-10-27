import { Alert, Button, Empty, Modal, Tag, Tooltip } from 'antd';
import { ClipboardList, Info } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppearanceButton } from '../../theme/AppearanceButton';
import { blank, createFact, engineers, faes, fields, initialFacts, inspect, interceptions, mappings, parseSheet, readPreviewExcel, services, sqes, supplementChanges } from './model';
import type { Fact, Issue, Mapping, Raw } from './model';
import './customer-quality.css';

type Entry = 'manual' | 'paste' | 'excel';
type Choice = { action: '' | 'add' | 'skip' | 'supplement'; target: string };
type RowResult = { row: string; message: string };
const emptyText = (text: string) => text || '待补';
const rowNumber = (row: Raw, index: number) => row.sourceRow || String(index + 2);
const issueText = (issue: Issue) => `${issue.field} · 原填写「${issue.original}」· ${issue.reason}`;

function Field({ label, value, onChange, options, multiline, disabled, id = label, maxLength = 2000 }: {
  label: string; value: string; onChange: (value: string) => void; options?: readonly string[];
  multiline?: boolean; disabled?: boolean; id?: string; maxLength?: number | null;
}) {
  return <label className="cq-field" htmlFor={`cq-${id}`}><span>{label}</span>
    {options ? <select id={`cq-${id}`} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">请选择（空）</option>{options.map(option => <option key={option}>{option}</option>)}
    </select> : multiline ? <textarea id={`cq-${id}`} rows={3} maxLength={maxLength ?? undefined} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
      : <input id={`cq-${id}`} maxLength={maxLength ?? undefined} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />}
  </label>;
}

function DataIssueNote({ fact }: { fact: Fact }) {
  const issues = inspect(fact.raw);
  if (!issues.length) return null;
  return <Tooltip title={<ul>{issues.map(issue => <li key={issue.field}>{issueText(issue)}</li>)}</ul>} trigger={['hover', 'focus']}>
    <button type="button" className="cq-info cq-warning" aria-label={`${fact.id} 原文待补正说明`}>!</button>
  </Tooltip>;
}

function MappingNote({ fact, map }: { fact: Fact; map: Record<string, Mapping> }) {
  const mapping = map[fact.raw.component];
  const conflict = mapping && fact.engineer && mapping.engineer !== fact.engineer;
  const explanation = !mapping ? '未检索到映射关系；可先登记，项目 / 分类 / 新品量产标签暂空，不默认量产。'
    : conflict ? `映射建议：${mapping.engineer}；保留当前跟进人 ${fact.engineer}，如需变更请人工交接。` : '已匹配演示组件映射；标签不改变已有 8D 责任人。';
  return <span className="cq-mapping">
    {mapping ? <><span>{mapping.project} · {mapping.category} / {mapping.segment}</span><Tag color={mapping.phase === '新品' ? 'cyan' : 'blue'}>{mapping.phase}</Tag></> : <span>项目 / 分类待补</span>}
    <Tooltip title={explanation} trigger={['hover', 'focus']}>
      <button type="button" className={`cq-info${!mapping || conflict ? ' cq-warning' : ''}`} aria-label={`${fact.id} 映射说明`}>{!mapping || conflict ? '!' : <Info size={14} aria-hidden="true" />}</button>
    </Tooltip>
  </span>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="cq-panel"><h2>{title}</h2>{children}</section>;
}

function Registration({ entry, facts, map, onCancel, onApply }: {
  entry: Entry; facts: Fact[]; map: Record<string, Mapping>; onCancel: () => void;
  onApply: (rows: Raw[], choices: Choice[], skipErrors: boolean) => void;
}) {
  const [raw, setRaw] = useState(blank);
  const [paste, setPaste] = useState('');
  const [rows, setRows] = useState<Raw[] | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<boolean | null>(null);
  function preview(next: Raw[]) {
    if (!next.length) { setError('没有可预览的数据行'); return; }
    setRows(next);
    setChoices(next.map(row => {
      // shortcut: exact trace hints in demo memory only; formal duplicate policy belongs to the API.
      const match = row.trace && facts.find(fact => fact.raw.trace === row.trace);
      return { action: match ? '' : 'add', target: match ? match.id : '' };
    }));
    setError('');
  }
  function previewPaste() {
    try {
      if (paste.length > 200000) throw new Error('粘贴内容超过内存预览 200000 字符上限');
      preview(parseSheet(paste.split(/\r?\n/).map(line => line.split('\t'))));
    } catch (failure) { setError(failure instanceof Error ? failure.message : '无法读取粘贴内容'); }
  }
  async function readFile(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try { preview(await readPreviewExcel(file)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Excel 无法读取；未写入任何记录'); }
    finally { setBusy(false); }
  }
  function continueWith(skipErrors: boolean) {
    if (!rows) return;
    const needsConfirmation = choices.some((choice, index) => choice.action === 'supplement' && !(skipErrors && inspect(rows[index]).length));
    if (needsConfirmation) setConfirm(skipErrors);
    else onApply(rows, choices, skipErrors);
  }
  const blocked = choices.some(choice => !choice.action || (choice.action === 'supplement' && !choice.target));
  return <Modal open title={confirm !== null ? '确认补充具体变更' : rows ? '登记预览 · 仅内存' : `${entry === 'manual' ? '单条登记' : entry === 'paste' ? '粘贴 Excel' : '上传 Excel'} · 演示`}
    width={920} className="cq-dialog" closable={!busy} mask={{ closable: false }} keyboard={!busy} onCancel={onCancel}
    footer={confirm !== null ? <div className="qms-dialog-actions"><Button onClick={() => setConfirm(null)}>返回核对</Button><Button type="primary" onClick={() => rows && onApply(rows, choices, confirm)}>确认补充到内存</Button></div>
      : rows ? <div className="qms-dialog-actions"><Button aria-label="取消" onClick={onCancel}>取消</Button><Button disabled={blocked} onClick={() => continueWith(true)}>跳过错误行</Button><Button type="primary" disabled={blocked} onClick={() => continueWith(false)}>继续（保留警告）</Button></div>
        : <div className="qms-dialog-actions"><Button aria-label="取消" onClick={onCancel} disabled={busy}>取消</Button>{entry !== 'excel' && <Button type="primary" onClick={() => entry === 'manual' ? preview([{ ...raw, sourceRow: '1' }]) : previewPaste()}>{entry === 'manual' ? '预览单条' : '预览粘贴内容'}</Button>}</div>}>
    <div className="cq-dialog-body">
      <p className="cq-muted">仅处理演示内存；不会创建客户、派工、索赔、发备件或发起 8D。取消不登记。</p>
      {error && <p role="alert" className="cq-error">{error}</p>}
      {confirm !== null && rows ? <>
        <p>只应用以下非空字段差异；不替换人工跟进人、FAE / SQE 解析、附件、收件、关闭状态或已有 8D。</p>
        {rows.map((row, index) => {
          const choice = choices[index];
          const target = facts.find(fact => fact.id === choice.target);
          if (choice.action !== 'supplement' || !target || (confirm && inspect(row).length)) return null;
          const changes = supplementChanges(target.raw, row);
          return <section className="cq-preview-row" key={index}><h3>第 {rowNumber(row, index)} 行 → {target.id}</h3>
            {changes.length ? <ul>{changes.map(change => <li key={change.key}>{change.label}：{emptyText(change.before)} → {change.after}</li>)}</ul> : <p>无可补充差异，不改旧值。</p>}
          </section>;
        })}
      </> : rows ? <>
        <p>{rows.length} 条待处理；空值不默认，问题原文保留，无效规范值暂空。日期 / 里程 / MIS 不在样例中计算。</p>
        {rows.map((row, index) => {
          const issues = inspect(row);
          const choice = choices[index];
          const isDuplicate = row.trace && facts.some(fact => fact.raw.trace === row.trace);
          return <section className="cq-preview-row" key={index} aria-label={`第 ${rowNumber(row, index)} 行预览`}>
            <h3>第 {rowNumber(row, index)} 行 · {emptyText(row.customer)} · {emptyText(row.kind)} <Tag>{issues.length ? '有错误原文' : '可登记'}</Tag></h3>
            <p>{emptyText(row.component)} · 数量原文：{emptyText(row.quantity)} · {emptyText(row.description)}</p>
            <details><summary>核对本行原始字段</summary><dl className="cq-raw-fields">{fields.filter(([, key]) => row[key]).map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{row[key]}</dd></div>)}</dl></details>
            {!map[row.component] && <p className="cq-muted">未检索到映射关系，可先登记；未知客户仅保留原文，不自动建档。</p>}
            {issues.length > 0 && <ul className="cq-issues">{issues.map(issue => <li key={issue.field}>{issueText(issue)}</li>)}</ul>}
            {isDuplicate && <div className="cq-inline">
              <label>第 {rowNumber(row, index)} 行重复处理<select aria-label={`第 ${rowNumber(row, index)} 行重复处理`} value={choice.action} onChange={event => setChoices(choices.map((item, current) => current === index ? { ...item, action: event.target.value as Choice['action'] } : item))}>
                <option value="">疑似重复，请人工选择</option><option value="add">新增（独立一行）</option><option value="skip">跳过</option><option value="supplement">补充已有</option>
              </select></label>
              <span className="cq-muted">仅演示追溯码相同提示，不自动去重。</span>
              {choice.action === 'supplement' && <label>补充目标<select aria-label={`第 ${rowNumber(row, index)} 行补充目标`} value={choice.target} onChange={event => setChoices(choices.map((item, current) => current === index ? { ...item, target: event.target.value } : item))}>
                {facts.map(fact => <option key={fact.id} value={fact.id}>{fact.id} · {fact.raw.customer}</option>)}
              </select></label>}
            </div>}
          </section>;
        })}
      </> : entry === 'manual' ? <div className="cq-form-grid">{fields.map(([label, key]) => <Field key={key} label={label} value={raw[key]} onChange={value => setRaw({ ...raw, [key]: value })}
        options={key === 'kind' ? ['零公里', '售后'] : key === 'service' ? services : key === 'interception' ? interceptions : key === 'engineer' ? engineers : undefined} multiline={key === 'description'} />)}</div>
        : entry === 'paste' ? <>
          <p>首行为中文列名，列间用制表符分隔；最多 100 行，每格 2000 字，整批 200000 字符；超限明确提示，不截断原文。允许列：{fields.map(([label]) => label).join('、')}。</p>
          <Field label="Excel 制表符文本" value={paste} onChange={setPaste} multiline maxLength={null} />
          <Button onClick={() => setPaste('客户\t类型\t组件号\t数量\t服务方式\t拦截状态\n演示客户甲\t售后\tC-200\t2\t现场现调\t否，索赔件\n未知客户\t零公里\tC-404\t待补正\t未知方式\t')}>填入演示文本</Button>
        </> : <>
          <p>仅在本机读取 .xlsx，最多 2 MB / 100 数据行。首行使用相同中文字段；公式、重复列、未知列或损坏文件明确失败，不上传服务器。</p>
          <p>请将日期格设为文本以保留原填写；Excel 日期值只转成日期文本，不计算派生字段。</p>
          <input type="file" accept=".xlsx" aria-label="选择 Excel 清单" disabled={busy} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
          {busy && <p role="status">正在本地读取文件；非 API 请求，请稍候。</p>}
        </>}
    </div>
  </Modal>;
}

function Detail({ fact, map, onChange, onRecover, onBack, notify }: {
  fact: Fact; map: Record<string, Mapping>; onChange: (next: Fact) => void;
  onRecover: () => void; onBack: () => void; notify: (text: string) => void;
}) {
  const [actor, setActor] = useState('对应工程师');
  const [fae, setFae] = useState(fact.fae);
  const [transfer, setTransfer] = useState('');
  const [faeText, setFaeText] = useState(fact.faeText);
  const [sqe, setSqe] = useState(fact.sqe);
  const [sqeText, setSqeText] = useState(fact.sqeText);
  const [files, setFiles] = useState<Record<string, string[]>>({ FAE: [], SQE: [] });
  const [tracking, setTracking] = useState(fact.tracking);
  const [received, setReceived] = useState(fact.received);
  const [reason, setReason] = useState('');
  const [discard, setDiscard] = useState(false);
  const engineer = actor === '对应工程师' && Boolean(fact.engineer);
  const maintainRegistration = engineer || actor === '登记维护人员';
  const canSetEngineer = engineer || (actor === '登记维护人员' && !fact.engineer);
  const receiveAllowed = engineer || actor === '该条登记售后';
  const faeAllowed = engineer || (actor === '指定 FAE' && Boolean(fact.fae));
  const sqeAllowed = engineer || (actor === '指定 SQE' && Boolean(fact.sqe));
  const dirty = fae !== fact.fae || transfer !== '' || faeText !== fact.faeText || sqe !== fact.sqe || sqeText !== fact.sqeText || tracking !== fact.tracking || received !== fact.received || Boolean(reason) || files.FAE.length > 0 || files.SQE.length > 0;
  const record = (message: string) => `${new Date().toLocaleString('zh-CN', { hour12: false })} · ${fact.engineer || '演示人'} · ${message}`;
  function save(patch: Partial<Fact>, message: string) { onChange({ ...fact, ...patch }); notify(`${message}；仅内存，未发送 API。`); }
  function attachments(kind: 'FAE' | 'SQE', disabled: boolean) {
    return <div className="cq-attachment"><label>{kind} 附件选择<input type="file" multiple aria-label={`${kind} 附件选择`} disabled={disabled}
      onChange={event => setFiles({ ...files, [kind]: Array.from(event.target.files ?? []).slice(0, 10).map(file => file.name) })} /></label>
      <p className="cq-muted">最多展示 10 个文件名；仅已选择，未上传 / 未扫描，不作为有效附件或解析完成依据。</p>
      {files[kind].map((name, index) => <p key={`${name}-${index}`}>{name} · 仅已选择，未上传</p>)}
    </div>;
  }
  return <section className="cq-detail" aria-label={`客诉详情 ${fact.id}`}>
    <div className="cq-toolbar"><div><h1 tabIndex={-1}>{fact.id}</h1><span>{fact.raw.customer || '客户原文待补'} · <Tag>{fact.state}</Tag></span></div><Button onClick={() => dirty ? setDiscard(true) : onBack()}>返回台账</Button></div>
    <div className="cq-panel cq-inline"><Field label="演示操作身份（非认证）" value={actor} onChange={setActor} options={['对应工程师', '登记维护人员', '该条登记售后', '指定 FAE', '指定 SQE', '只读查看人']} /><p className="cq-muted">仅演示按钮边界，不代表真实任职、权限或身份验证。登记维护人员仅可维护跟进人和映射，不获得收件、解析或关闭权限。</p></div>
    <div className="cq-detail-grid"><div className="cq-stack">
      <Panel title="来源事实"><div className="cq-inline"><strong>{emptyText(fact.raw.kind)}</strong><MappingNote fact={fact} map={map} /></div>
        <p>登记数量：{emptyText(fact.raw.quantity)}{inspect(fact.raw).some(issue => issue.field === '数量') ? '（原文待补正，规范数量暂空）' : ''} · 唯一登记归口</p>
        <dl className="cq-facts">{fields.filter(([, key]) => !['quantity', 'engineer'].includes(key)).map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{emptyText(fact.raw[key])}</dd></div>)}</dl>
        <p className="cq-muted">派生展示：{fact.demoDerived || '日期 / 里程分档 / 服务月数 / MIS 未计算（未接公共计算器）'}</p>
        {inspect(fact.raw).map(issue => <p className="cq-issues" key={issue.field}>{issue.field}：{issue.original} · {issue.reason}</p>)}
        <Field label="质量工程师" value={fact.engineer} options={engineers} disabled={!canSetEngineer} onChange={value => { if (canSetEngineer) save({ engineer: value, engineerSource: value ? '人工指定' : '待指定', raw: { ...fact.raw, engineer: value } }, '已明确更新内存跟进人'); }} />
        <p className="cq-muted">人员来源：{fact.engineerSource}；补映射不自动换人或改变 8D。</p>
        {!map[fact.raw.component] && <Button onClick={onRecover} disabled={!maintainRegistration}>演示补齐映射</Button>}
        {map[fact.raw.component] && fact.engineer && map[fact.raw.component].engineer !== fact.engineer && <p className="cq-note">映射建议 {map[fact.raw.component].engineer}；保留当前跟进人，请人工交接。</p>}
      </Panel>
      <Panel title="轻量收件"><div className="cq-form-grid"><Field label="快递单号" value={tracking} onChange={setTracking} disabled={!receiveAllowed} /><Field label="收件日期" value={received} onChange={setReceived} disabled={!receiveAllowed} /></div>
        <p className="cq-muted">仅对应工程师或该条真实登记售后可维护；日期不默认、不改变登记数量。</p>
        <Button disabled={!receiveAllowed || (Boolean(received) && inspect({ ...blank(), occurred: received }).length > 0)} onClick={() => save({ tracking, received }, '已保存内存收件')}>保存收件到内存</Button>
        <p>已存快递：{fact.tracking || '未填写'} · 收件日期：{fact.received || '未填写'}</p>
      </Panel>
    </div><div className="cq-stack">
      <Panel title="分析协作"><fieldset aria-label="FAE 解析"><legend>FAE 解析</legend>
        <p>当前指定：{fact.fae || '未指定'} · {fact.faeText.trim() ? '已解析（演示文字）' : '待解析'}</p>
        <div className="cq-inline"><Field label="直接指定 FAE" value={fae} onChange={setFae} options={faes} disabled={!engineer} /><Button disabled={!engineer || !fae} onClick={() => save({ fae }, '已直接指定内存 FAE')}>指定 FAE 到内存</Button></div>
        <div className="cq-inline"><Field label="同部门内部转派" value={transfer} onChange={setTransfer} options={faes.filter(person => person !== fact.fae)} disabled={!faeAllowed || !fact.fae} /><Button disabled={!faeAllowed || !transfer || transfer === fact.fae} onClick={() => { save({ fae: transfer, history: [...fact.history, record(`FAE 同部门转派 ${fact.fae} → ${transfer}`)] }, '已转派内存 FAE'); setFae(transfer); setTransfer(''); }}>确认内部转派</Button></div>
        <p className="cq-muted">候选均为同部门固定演示人，不查真实组织。转派保留已有解析原文。</p>
        <Field label="FAE 解析正文" value={faeText} onChange={setFaeText} multiline disabled={!faeAllowed} />{attachments('FAE', !faeAllowed)}
        <Button disabled={!faeAllowed || !fact.fae} onClick={() => save({ faeText }, '已保存内存 FAE 正文；选文件不算已上传')}>保存 FAE 解析到内存</Button>
      </fieldset><fieldset aria-label="SQE 供应商分析"><legend>SQE 供应商分析</legend>
        <p>当前指定：{fact.sqe || '未指定'} · 已存分析：{fact.sqeText || '未填写'}</p>
        <Field label="指定 SQE" value={sqe} onChange={setSqe} options={sqes} disabled={!engineer} />
        <Field label="供应商分析正文" value={sqeText} onChange={setSqeText} multiline disabled={!sqeAllowed} />{attachments('SQE', !sqeAllowed)}
        <Button disabled={!sqeAllowed || !sqe || (!engineer && sqe !== fact.sqe)} onClick={() => save({ sqe, sqeText }, '已保存独立内存 SQE 分析')}>保存 SQE 分析到内存</Button>
        <p className="cq-muted">独立正文，不套 FAE 二选一判定；不自动创建供应商单、待办或关闭关卡。</p>
      </fieldset></Panel>
      <Panel title="来源关闭与恢复"><p>来源仅两态，与收件、解析、已有 8D 状态独立；仅对应工程师演示身份可操作。</p>
        <Field label="关闭结论或恢复原因" value={reason} onChange={setReason} multiline disabled={!engineer} />
        <Button disabled={!engineer || !reason.trim()} onClick={() => {
          const state = fact.state === '跟进中' ? '已关闭' : '跟进中';
          save({ state, history: [...fact.history, record(`${state}：${reason.trim()}`)] }, `来源${state}`); setReason('');
        }}>{fact.state === '跟进中' ? '关闭来源（内存）' : '恢复跟进（内存）'}</Button>
        <section aria-label="来源历史" className="cq-history"><h3>来源历史 · 仅内存</h3>{fact.history.length ? <ul>{fact.history.map((entry, index) => <li key={index}>{entry}</li>)}</ul> : <p>暂无演示历史</p>}</section>
      </Panel>
      <Panel title="关联资料"><fieldset aria-label="已有 8D 引用"><legend>已有 8D 引用</legend>{fact.links.length ? fact.links.map(link => <Tag key={link}>{link} · 固定演示引用</Tag>) : <p>无已有演示引用</p>}<p className="cq-muted">仅标签，不新建 / 打开发单流程，不推断真实 8D 状态。</p></fieldset></Panel>
    </div></div>
    <Modal open={discard} title="未保存的演示修改" className="cq-dialog" onCancel={() => setDiscard(false)} footer={<div className="qms-dialog-actions"><Button onClick={() => setDiscard(false)}>继续编辑</Button><Button onClick={onBack}>放弃修改并返回台账</Button></div>}><p>未保存文字和所选附件文件名只在当前面板中；返回会丢弃它们，不影响已经保存的内存记录。</p></Modal>
  </section>;
}

export function CustomerQualityPreview() {
  const [facts, setFacts] = useState(initialFacts);
  const [map, setMap] = useState(mappings);
  const [view, setView] = useState('全部');
  const [customer, setCustomer] = useState('');
  const [state, setState] = useState('');
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState('');
  const [engineer, setEngineer] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [linked, setLinked] = useState('');
  const [date, setDate] = useState('');
  const [selected, setSelected] = useState('');
  const [entry, setEntry] = useState<Entry | null>(null);
  const [feedback, setFeedback] = useState('');
  const [results, setResults] = useState<RowResult[]>([]);
  const [page, setPage] = useState(1);
  const sequence = useRef(4);
  const preview = useRef<HTMLDivElement>(null);
  const returnTo = useRef('');
  useLayoutEffect(() => {
    const heading = preview.current?.querySelector<HTMLHeadingElement>('h1');
    if (selected) heading?.focus();
    else if (returnTo.current) {
      const action = preview.current?.querySelector<HTMLButtonElement>(`button[aria-label="查看 ${returnTo.current}"]`);
      (action ?? heading)?.focus();
      returnTo.current = '';
    }
  }, [selected]);
  const selectedFact = facts.find(fact => fact.id === selected);
  const filtered = facts.filter(fact => (view === '全部' || fact.raw.kind === view)
    && (!customer || fact.raw.customer === customer) && (!state || fact.state === state)
    && (!query || `${fact.raw.component} ${map[fact.raw.component]?.project || ''} ${fact.raw.description}`.includes(query))
    && (!phase || map[fact.raw.component]?.phase === phase) && (!engineer || fact.engineer === engineer)
    && (!analysis || (analysis === '有 FAE 正文' ? Boolean(fact.faeText.trim()) : Boolean(fact.sqeText.trim())))
    && (!linked || Boolean(fact.links.length) === (linked === '已关联')) && (!date || fact.raw.occurred === date));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 10)));
  const shown = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  function update(next: Fact) { setFacts(current => current.map(fact => fact.id === next.id ? next : fact)); }
  function apply(rows: Raw[], choices: Choice[], skipErrors: boolean) {
    const next = facts.map(fact => ({ ...fact }));
    const outcomes: RowResult[] = [];
    let added = 0; let supplemented = 0; let skipped = 0; let pending = 0;
    rows.forEach((raw, index) => {
      const choice = choices[index];
      const errors = inspect(raw);
      const record = (message: string) => outcomes.push({ row: rowNumber(raw, index), message });
      if (choice.action === 'skip' || (skipErrors && errors.length)) {
        skipped++;
        record(`跳过 · ${choice.action === 'skip' ? '人工选择跳过疑似重复；未新增或修改已有记录' : `按错误行过滤：${errors.map(issueText).join('；')}`}`);
        return;
      }
      let saved: Fact;
      let outcome: string;
      if (choice.action === 'supplement') {
        const target = next.find(fact => fact.id === choice.target);
        if (!target) { skipped++; record('跳过 · 补充目标不存在，未修改任何记录'); return; }
        const changes = supplementChanges(target.raw, raw);
        target.raw = { ...target.raw, ...Object.fromEntries(changes.map(change => [change.key, change.after])) };
        target.demoDerived = undefined;
        target.history = [...target.history, `${new Date().toLocaleString('zh-CN')} · 内存明确补充：${changes.map(change => change.label).join('、') || '无差异'}`];
        supplemented++;
        saved = target; outcome = '补充';
      } else if (choice.action === 'add') {
        saved = createFact(raw, `CQ-DEMO-${String(sequence.current++).padStart(3, '0')}`, map);
        next.push(saved); added++; outcome = '新增';
      } else { skipped++; record('跳过 · 未明确选择处理方式，未写入'); return; }
      const remaining = inspect(saved.raw);
      if (remaining.length) pending++;
      record(`${outcome} ${saved.id}${remaining.length ? ` · 待补正：${remaining.map(issueText).join('；')}` : ' · 无待补正数据问题'}`);
    });
    setFacts(next); setResults(outcomes); setEntry(null); setPage(1);
    setFeedback(`仅内存：新增 ${added}；补充 ${supplemented}；待补 ${pending}；跳过 ${skipped}；失败 0。无 API 写入；待补为处理后仍需补正的行数，不重复计入数量。`);
  }
  return <div className="cq-preview" ref={preview}>
    <a className="cq-skip" href="#cq-main">跳到客户质量样例</a>
    <header className="cq-header"><div className="cq-inline"><ClipboardList size={22} aria-hidden="true" /><strong>QMS / 客户质量</strong><Tag>独立交互样例 C</Tag></div><AppearanceButton /></header>
    <main id="cq-main" className="cq-main">
      <Alert type="warning" showIcon title="仅内存 / 无API / 刷新重置 · 非生产、非业务验收" description="固定演示人及数据；不连接认证、组织、数据库、上传扫描或审批。日期 / 里程 / MIS 仅展示，不替代公共计算器。主题偏好沿用共享设置，业务数据不持久化。" />
      <div role="status" aria-label="操作反馈" className="cq-feedback">{feedback || '可自由点击验证三视图、登记预览与独立分析；未执行真实业务操作。'}</div>
      {results.length > 0 && <section className="cq-panel" aria-label="本次登记结果"><details><summary>逐行处理结果 · 仅内存</summary><ul>{results.map(result => <li key={result.row} aria-label={`第 ${result.row} 行处理结果`}>第 {result.row} 行 · {result.message}</li>)}</ul></details></section>}
      {selectedFact ? <Detail key={selectedFact.id} fact={selectedFact} map={map} onChange={update} onBack={() => setSelected('')} notify={setFeedback}
        onRecover={() => {
          const recovery = { project: '演示恢复项目', category: '电驱', segment: '控制器', phase: '新品', engineer: engineers[2] };
          setMap({ ...map, [selectedFact.raw.component]: recovery });
          setFacts(current => current.map(fact => fact.raw.component === selectedFact.raw.component && !fact.engineer ? { ...fact, engineer: recovery.engineer, engineerSource: '映射带出' } : fact));
          setFeedback('已补齐演示映射；保留当前跟进人，不自动交接，不改 8D。');
        }} /> : <>
        <div className="cq-toolbar"><div><h1 tabIndex={-1}>客户质量来源台账</h1><p className="cq-muted">全部、零公里、售后 · 同一份来源事实，不随 8D 自动关闭</p></div><div className="cq-inline"><Button type="primary" onClick={() => setEntry('manual')}>单条登记</Button><Button onClick={() => setEntry('paste')}>粘贴 Excel</Button><Button onClick={() => setEntry('excel')}>上传 Excel</Button></div></div>
        <section className="cq-panel" aria-label="台账筛选">
          <div className="cq-view" role="group" aria-label="同源三视图">{['全部', '零公里', '售后'].map(name => <Button key={name} aria-label={name} type={view === name ? 'primary' : 'default'} aria-pressed={view === name} onClick={() => { setView(name); setPage(1); }}>{name}</Button>)}</div>
          <div className="cq-filters"><Field label="客户筛选" value={customer} onChange={value => { setCustomer(value); setPage(1); }} options={[...new Set(facts.map(fact => fact.raw.customer).filter(Boolean))]} />
            <Field label="组件 / 项目 / 描述" value={query} onChange={value => { setQuery(value); setPage(1); }} />
            <Field label="阶段筛选" value={phase} onChange={value => { setPhase(value); setPage(1); }} options={['新品', '量产']} />
            <Field label="发生日期筛选" value={date} onChange={value => { setDate(value); setPage(1); }} />
            <Field label="工程师筛选" value={engineer} onChange={value => { setEngineer(value); setPage(1); }} options={engineers} />
            <Field label="来源状态筛选" value={state} onChange={value => { setState(value); setPage(1); }} options={['跟进中', '已关闭']} />
            <Field label="分析内容筛选" value={analysis} onChange={value => { setAnalysis(value); setPage(1); }} options={['有 FAE 正文', '有 SQE 正文']} />
            <Field label="关联 8D 筛选" value={linked} onChange={value => { setLinked(value); setPage(1); }} options={['已关联', '未关联']} />
          </div><div className="cq-inline"><Button onClick={() => { setEngineer(engineers[0]); setPage(1); }}>我负责的（演示林）</Button><Button onClick={() => { setCustomer(''); setState(''); setQuery(''); setPhase(''); setEngineer(''); setAnalysis(''); setLinked(''); setDate(''); setPage(1); }}>清空筛选</Button></div>
        </section>
        <section className="cq-panel" aria-label="台账结果"><p className="cq-summary">当前视图 {filtered.length} 条 · 跟进中 {filtered.filter(fact => fact.state === '跟进中').length} · 已关闭 {filtered.filter(fact => fact.state === '已关闭').length}<span className="cq-muted">行数不是件数；不计算风险、百分比或绩效</span></p>
          <div className="cq-table-scroll" role="region" aria-label="台账横向滚动区" tabIndex={0}><table aria-label="客户质量来源台账"><thead><tr>{['来源 / 客户', '类型 / 项目 / 阶段', '事实摘要', '登记数量', '质量工程师 / 两态', '最近解析 / 已有 8D', '操作'].map(title => <th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{shown.map(fact => <tr key={fact.id}>
            <th scope="row">{fact.id}<span className="cq-cell-sub">{emptyText(fact.raw.customer)}</span></th>
            <td>{emptyText(fact.raw.kind)}<span className="cq-cell-sub">{emptyText(fact.raw.component)}</span><MappingNote fact={fact} map={map} /></td>
            <td><span className="cq-description">{emptyText(fact.raw.description)}</span><span className="cq-cell-sub">发生：{emptyText(fact.raw.occurred)}</span>{view === '零公里' ? <span className="cq-cell-sub">上线：{emptyText(fact.raw.online)} · 生产：{emptyText(fact.raw.produced)} · 追溯：{emptyText(fact.raw.trace)}</span> : view === '售后' ? <span className="cq-cell-sub">里程原文：{emptyText(fact.raw.mileage)} · 交付：{emptyText(fact.raw.delivered)}<br />{fact.demoDerived || 'MIS / 里程分档未计算'} · 收件：{fact.received || '未填写'}</span> : null}</td>
            <td>{emptyText(fact.raw.quantity)}<DataIssueNote fact={fact} /></td><td>{fact.engineer || '待指定'}<span className="cq-cell-sub">{fact.engineerSource}</span><Tag color={fact.state === '跟进中' ? 'blue' : 'default'}>{fact.state}</Tag></td>
            <td><span className="cq-cell-sub">FAE：{fact.faeText.trim() ? '已有演示正文' : '待解析'}</span><span className="cq-cell-sub">SQE：{fact.sqeText ? '已有演示内容' : '未填写'}</span><Tag>已有 8D {fact.links.length} · 演示引用</Tag></td>
            <td><Button aria-label={`查看 ${fact.id}`} onClick={() => { returnTo.current = fact.id; setSelected(fact.id); }}>查看</Button></td>
          </tr>)}</tbody></table></div>
          {!shown.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有演示记录，可清空筛选或登记内存样例" />}
          <div className="cq-pagination"><span>第 {currentPage} / {Math.max(1, Math.ceil(filtered.length / 10))} 页 · 每页 10 条</span><Button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</Button><Button disabled={currentPage * 10 >= filtered.length} onClick={() => setPage(currentPage + 1)}>下一页</Button></div>
        </section>
      </>}
      <footer className="cq-muted">设计来源 DISC-031～047 · Issue #74 / V0.0.32 · 样例方向确认 ≠ 正式能力或人工验收完成</footer>
    </main>
    {entry && <Registration entry={entry} facts={facts} map={map} onCancel={() => setEntry(null)} onApply={apply} />}
  </div>;
}
