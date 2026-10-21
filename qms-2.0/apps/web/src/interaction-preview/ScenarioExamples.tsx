import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Input, Modal, Progress, Radio, Skeleton, Steps, Tabs, Tag } from 'antd';
import type { InputRef } from 'antd';
import { Download, RotateCcw, ScanLine, ShieldAlert } from 'lucide-react';

type ImportStatus = 'pending' | 'success' | 'failed';
type DataState = 'normal' | 'loading' | 'empty' | 'filtered' | 'error' | 'forbidden';

export function ScenarioExamples({ english }: { english: boolean }) {
  const pick = (zh: string, en: string) => english ? en : zh;
  const [viewer, setViewer] = useState(false);
  const [reason, setReason] = useState('');
  const [workflow, setWorkflow] = useState<'review' | 'returned' | 'verified' | 'voided'>('review');
  const [confirmation, setConfirmation] = useState<'verify' | 'void' | null>(null);
  const [rows, setRows] = useState<ImportStatus[]>(['pending', 'pending', 'pending']);
  const [importMode, setImportMode] = useState<'pending' | 'failed' | null>(null);
  const [started, setStarted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [attachment, setAttachment] = useState('transfer');
  const [downloadNotice, setDownloadNotice] = useState(false);
  const [dataState, setDataState] = useState<DataState>('normal');
  const [barcode, setBarcode] = useState('');
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [scanFeedback, setScanFeedback] = useState<'recorded' | 'duplicate' | 'invalid' | null>(null);
  const [lastBarcode, setLastBarcode] = useState('');
  const barcodeInput = useRef<InputRef>(null);

  useEffect(() => {
    if (!importMode) return;
    const index = rows.findIndex((status) => status === importMode);
    if (index === -1) {
      setImportMode(null);
      return;
    }
    timer.current = setTimeout(() => {
      setRows((current) => current.map((status, rowIndex) => rowIndex === index
        ? (importMode === 'pending' && index === 1 ? 'failed' : 'success')
        : status));
    }, 150);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [importMode, rows]);

  const stopImport = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setImportMode(null);
  };
  const scan = () => {
    const value = barcode.trim();
    if (!/^DEMO-\S+$/.test(value)) {
      setScanFeedback('invalid');
      barcodeInput.current?.focus();
      return;
    }
    if (barcodes.includes(value)) {
      setScanFeedback('duplicate');
    } else {
      setBarcodes((current) => [...current, value]);
      setLastBarcode(value);
      setScanFeedback('recorded');
    }
    setBarcode('');
    barcodeInput.current?.focus();
  };

  const successCount = rows.filter((status) => status === 'success').length;
  const failureCount = rows.filter((status) => status === 'failed').length;
  const pendingCount = rows.filter((status) => status === 'pending').length;
  const busy = importMode !== null;
  const processingRow = importMode ? rows.findIndex((status) => status === importMode) : -1;
  const cannotProcess = viewer || workflow !== 'review';
  const workflowStatus = {
    review: pick('验证中', 'Verification in progress'),
    returned: pick('待补充', 'Awaiting supplements'),
    verified: pick('本地验证演示结束', 'Local verification demo finished'),
    voided: pick('本地样例已作废', 'Local sample voided'),
  }[workflow];
  const attachmentLabels = {
    transfer: pick('传输中', 'Transferring'),
    scanning: pick('扫描中', 'Scanning'),
    available: pick('可用', 'Available'),
    rejected: pick('拒绝', 'Rejected'),
  };

  return <>
    <section id="sample-05" className="preview-section" aria-label={pick('S05 流程与高风险动作', 'S05 Workflow and high-risk actions')}>
      <div className="preview-section-heading">
        <h2>{pick('S05 流程与高风险动作', 'S05 Workflow and high-risk actions')}</h2>
        <p>{pick('用于节点处理、理由校验与危险确认；此处仅演示本地状态，不构成业务批准或签名。', 'Use for workflow actions, reason validation and destructive confirmations. Local state only; no business approval or signature.')}</p>
      </div>
      <div className="preview-split">
        <div className="preview-example">
          <h3>{pick('处理资格与前置条件', 'Eligibility and prerequisites')}</h3>
          {workflow !== 'review' && <Button size="small" onClick={() => { setWorkflow('review'); setReason(''); setConfirmation(null); }}>{pick('重置流程样例', 'Reset workflow example')}</Button>}
          <Radio.Group
            aria-label={pick('样例处理身份', 'Sample processing role')}
            value={viewer ? 'viewer' : 'handler'}
            onChange={(event) => { setViewer(event.target.value === 'viewer'); setConfirmation(null); }}
            options={[
              { value: 'handler', label: pick('当前处理者', 'Current handler') },
              { value: 'viewer', label: pick('只读查看者', 'Read-only viewer') },
            ]}
          />
          <Steps size="small" status={workflow === 'voided' ? 'error' : workflow === 'verified' ? 'finish' : 'process'} current={workflow === 'returned' ? 0 : workflow === 'verified' ? 2 : 1} items={[
            { title: pick('补充证据', 'Supply evidence') },
            { title: pick('验证', 'Verify') },
            { title: pick('完成', 'Complete') },
          ]} />
          <p>{pick('当前节点：', 'Current node: ')}<Tag>{workflowStatus}</Tag></p>
          <p className="preview-note">{pick('示例证据：已齐备。退回前仍须填写理由；验证通过不要求退回理由。', 'Sample evidence is complete. Returning requires a reason; passing verification does not require a return reason.')}</p>
          <label htmlFor="preview-processing-reason">{pick('处理理由', 'Processing reason')}</label>
          <Input.TextArea id="preview-processing-reason" aria-label={pick('处理理由', 'Processing reason')} value={reason}
            disabled={cannotProcess} onChange={(event) => setReason(event.target.value)} rows={3} />
          <p className="preview-note">{viewer
            ? pick('只读身份无处理资格，仅可查看样例。', 'This read-only role can view the sample but cannot process it.')
            : workflow === 'voided'
              ? pick('作废样例不能继续处理；刷新页面可重新演示。', 'A voided sample cannot be processed. Refresh the page to restart the demo.')
              : !reason.trim()
                ? pick('缺项提示：尚未填写退回理由，退回补充不可用。', 'Missing prerequisite: enter a reason to enable returning for supplements.')
                : pick('退回理由已填写，可演示退回。', 'A return reason is present; returning can be demonstrated.')}</p>
          <div className="preview-actions">
            <Button disabled={cannotProcess || !reason.trim()} onClick={() => {
              if (!cannotProcess && reason.trim()) setWorkflow('returned');
            }}>{pick('退回补充', 'Return for supplements')}</Button>
            <Button type="primary" disabled={cannotProcess} onClick={() => setConfirmation('verify')}>{pick('验证通过', 'Pass verification')}</Button>
          </div>
          <div role="status" aria-live="polite">
            {workflow === 'returned' && <p>{pick('样例已退回补充。', 'Sample returned for supplements.')}</p>}
            {workflow === 'verified' && <p>{pick('样例验证演示完成，仅更新当前页面；未批准任何业务记录。', 'Sample verification demo complete on this page only; no business record was approved.')}</p>}
          </div>
        </div>
        <div className="preview-example">
          <h3>{pick('危险作废与影响确认', 'Destructive action and impact confirmation')}</h3>
          <p>{pick('仅作废当前本地样例，并禁用其处理动作；不删除或修改真实记录。正常完成动作不使用危险样式。', 'Voids this local sample and disables its processing actions. No real records are modified or deleted. Normal completion uses standard action styling.')}</p>
          <Button danger icon={<ShieldAlert size={16} aria-hidden="true" />} disabled={cannotProcess} onClick={() => setConfirmation('void')}>
            {pick('作废样例', 'Void sample')}
          </Button>
          <p role="status">{workflow === 'voided' ? pick('样例已作废，仅影响当前页面。', 'Sample voided on this page only.') : pick('尚未作废。', 'Sample has not been voided.')}</p>
        </div>
      </div>
      <Modal open={confirmation !== null} title={confirmation === 'void' ? pick('确认作废本地样例', 'Confirm voiding the local sample') : pick('确认本地验证演示', 'Confirm local verification demo')}
        onCancel={() => setConfirmation(null)} cancelText={pick('取消', 'Cancel')}
        okText={confirmation === 'void' ? pick('确认作废样例', 'Confirm void sample') : pick('完成本地演示', 'Complete local demo')}
        okButtonProps={{ danger: confirmation === 'void', disabled: cannotProcess }}
        onOk={() => {
          if (cannotProcess || !confirmation) return;
          setWorkflow(confirmation === 'void' ? 'voided' : 'verified');
          setConfirmation(null);
        }}>
        <p>{confirmation === 'void'
          ? pick('影响范围：仅当前页面的本地样例。确认后处理按钮禁用；可用“重置流程样例”重新演示，重置不代表真实业务可撤销。不会发出业务请求。', 'Impact: the local sample on this page only. Processing is disabled after confirmation. Use Reset workflow example to restart the demo; this does not imply real actions are reversible. No business request is sent.')
          : pick('这是本地确认交互演示，仅改变样例状态，不代表独立验证、电子签名或业务批准已完成。', 'This local confirmation changes sample state only. It does not establish independent verification, electronic signing or business approval.')}</p>
      </Modal>
    </section>

    <section id="sample-06" className="preview-section" aria-label={pick('S06 导入与附件状态', 'S06 Import and attachment states')}>
      <div className="preview-section-heading">
        <h2>{pick('S06 导入与附件状态', 'S06 Import and attachment states')}</h2>
        <p>{pick('用于逐行反馈和文件状态区分；固定本地三行数据，不接收真实文件，不执行真实导入或扫描。', 'Use for row-level feedback and distinct file states. Three fixed local rows; no real files, imports or scans.')}</p>
      </div>
      <div className="preview-split">
        <div className="preview-example">
          <h3>{pick('三行导入、停止与失败行重试', 'Three-row import, stop and failed-row retry')}</h3>
          <p className="preview-note">{pick('每行演示耗时 150 ms；第 2 行首次固定失败。停止仅停止本地循环，保留完成结果；继续只处理未处理行，重试只处理失败行。', 'Each sample row takes 150 ms. Row 2 fails on its first attempt. Stopping halts the local loop and preserves results. Continue handles pending rows; retry handles failed rows only.')}</p>
          <div className="preview-actions">
            <Button type="primary" disabled={started || busy} onClick={() => { if (!started && !busy) { setStarted(true); setImportMode('pending'); } }}>
              {pick('运行示例导入', 'Run sample import')}
            </Button>
            <Button disabled={!busy} onClick={stopImport}>{pick('停止本地循环', 'Stop local loop')}</Button>
            <Button disabled={busy || !started || pendingCount === 0} onClick={() => { if (!busy && pendingCount) setImportMode('pending'); }}>
              {pick('继续未处理行', 'Continue pending rows')}
            </Button>
            <Button icon={<RotateCcw size={16} aria-hidden="true" />} disabled={busy || failureCount === 0}
              onClick={() => { if (!busy && failureCount) setImportMode('failed'); }}>{pick('重试失败行', 'Retry failed rows')}</Button>
          </div>
          <Progress percent={Math.round((successCount + failureCount) / 3 * 100)} status={failureCount > 0 ? 'exception' : 'normal'} aria-label={pick('已处理行比例，含失败行', 'Processed rows, including failed rows')} />
          <div className="preview-table-wrap">
            <table>
              <caption>{pick('本地示例导入结果，共 3 行', 'Local sample import results: 3 rows')}</caption>
              <thead><tr><th scope="col">{pick('行号', 'Row')}</th><th scope="col">{pick('示例值', 'Sample value')}</th><th scope="col">{pick('状态与反馈', 'Status and feedback')}</th></tr></thead>
              <tbody>{rows.map((status, index) => <tr key={index}>
                <th scope="row">{index + 1}</th><td>{`DEMO-00${index + 1}`}</td>
                <td>{processingRow === index
                  ? pick('处理中（本地演示）', 'Processing (local demo)')
                  : status === 'success' ? pick('成功（本地）', 'Succeeded (local)')
                    : status === 'failed' ? pick('失败：示例校验错误，可重试', 'Failed: sample validation error; retry available')
                      : pick('未处理', 'Pending')}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div role="status" aria-live="polite">
            <p>{pick(`样例结果：成功 ${successCount}，失败 ${failureCount}。`, `Sample result: ${successCount} succeeded, ${failureCount} failed.`)}</p>
            <p>{pick(`未处理 ${pendingCount} 行。`, `${pendingCount} rows pending.`)} {busy ? pick('本地循环运行中。', 'Local loop running.') : started && pendingCount > 0 ? pick('已停止，可继续未处理行。', 'Stopped; pending rows can be continued.') : pick('本地循环未运行。', 'Local loop is not running.')}</p>
          </div>
        </div>
        <div className="preview-example">
          <h3>{pick('附件状态与下载资格', 'Attachment states and download eligibility')}</h3>
          <p className="preview-note">{pick('示例附件：DEMO-evidence.txt（无实际文件）。手动选择展示状态，不会启动传输或安全扫描。', 'Sample attachment: DEMO-evidence.txt (no actual file). Select a display state manually; no transfer or security scan is started.')}</p>
          <Radio.Group aria-label={pick('附件展示状态', 'Attachment display state')} value={attachment}
            onChange={(event) => { setAttachment(event.target.value); setDownloadNotice(false); }}
            options={Object.entries(attachmentLabels).map(([value, label]) => ({ value, label }))} />
          <p>{pick('当前样例状态：', 'Current sample state: ')}<Tag>{attachmentLabels[attachment as keyof typeof attachmentLabels]}</Tag></p>
          <Alert showIcon type={attachment === 'rejected' ? 'error' : 'info'} title={attachment === 'available'
            ? pick('可用仅为展示选项，不是安全扫描结论。', 'Available is a display option, not a security scan result.')
            : attachment === 'rejected' ? pick('示例拒绝状态：禁止下载。', 'Sample rejected state: download disabled.')
              : pick('传输或扫描尚未可用：禁止下载。', 'Transferring or scanning: download disabled.')} />
          <div className="preview-actions">
            <Button disabled={attachment !== 'available'} icon={<Download size={16} aria-hidden="true" />} onClick={() => {
              if (attachment === 'available') setDownloadNotice(true);
            }}>{pick('下载样例附件', 'Download sample attachment')}</Button>
          </div>
          <p role="status">{downloadNotice ? pick('样例附件当前可用；仅展示下载提示，未生成或下载真实文件。', 'Sample attachment is available; this is a notice only. No real file was generated or downloaded.') : pick('未执行下载。', 'No download performed.')}</p>
        </div>
      </div>
    </section>

    <section id="sample-07" className="preview-section" aria-label={pick('S07 数据状态与详情', 'S07 Data states and details')}>
      <div className="preview-section-heading">
        <h2>{pick('S07 数据状态与详情', 'S07 Data states and details')}</h2>
        <p>{pick('用于区分数据区域状态及当前／历史详情；均为本地示例，不代表服务端加载或授权结果。', 'Use to distinguish data states and current versus historical details. Local examples only; no server loading or authorization result.')}</p>
      </div>
      <div className="preview-example">
        <h3>{pick('区域状态切换与错误恢复', 'Data states and error recovery')}</h3>
        <Radio.Group aria-label={pick('数据展示状态', 'Data display state')} value={dataState} onChange={(event) => setDataState(event.target.value)} options={[
          { value: 'normal', label: pick('正常', 'Normal') },
          { value: 'loading', label: pick('加载中', 'Loading') },
          { value: 'empty', label: pick('暂无数据', 'No data') },
          { value: 'filtered', label: pick('筛选无结果', 'No matching results') },
          { value: 'error', label: pick('加载失败', 'Loading failed') },
          { value: 'forbidden', label: pick('无权限', 'No permission') },
        ]} />
        <div aria-busy={dataState === 'loading'}>
          {dataState === 'loading' && <><p role="status">{pick('正在加载本地示例展示。', 'Displaying the local loading example.')}</p><Skeleton active={false} paragraph={{ rows: 3 }} /></>}
          {dataState === 'empty' && <Empty description={pick('暂无数据：尚未建立示例记录。', 'No data: no sample records created.')} />}
          {dataState === 'filtered' && <Empty description={pick('筛选无结果：记录可能存在，但不符合当前条件。', 'No matching results: records may exist outside the current filters.')}>
            <Button onClick={() => setDataState('normal')}>{pick('清除示例筛选', 'Clear sample filters')}</Button>
          </Empty>}
          {dataState === 'error' && <Alert type="error" showIcon title={pick('示例加载失败，不能当作空数据。', 'Sample loading failed; this is not an empty dataset.')}
            action={<Button onClick={() => setDataState('normal')}>{pick('重试加载', 'Retry loading')}</Button>} />}
          {dataState === 'forbidden' && <Alert type="warning" showIcon title={pick('示例无权限：隐藏记录详情，不显示敏感数据。', 'Sample permission denied: record details are hidden.')} />}
          {dataState === 'normal' && <>
            <h3>{pick('示例质量记录', 'Sample quality record')}</h3>
            <p className="preview-note">{pick('当前详情反映此刻样例值；历史只读展示冻结快照，不随当前身份或状态变化。', 'Current details show present sample values. Read-only history is a frozen snapshot, independent of the current role or state.')}</p>
            <Tabs defaultActiveKey="current" items={[
              { key: 'current', label: pick('当前详情', 'Current details'), children: <Descriptions size="small" column={1} bordered items={[
                { key: 'id', label: pick('样例编号', 'Sample ID'), children: 'DEMO-Q-001' },
                { key: 'state', label: pick('当前状态', 'Current state'), children: workflowStatus },
                { key: 'role', label: pick('当前查看身份', 'Current viewing role'), children: viewer ? pick('只读查看者', 'Read-only viewer') : pick('当前处理者', 'Current handler') },
                { key: 'source', label: pick('来源', 'Source'), children: pick('本页内存中的示例，非业务记录。', 'In-memory example on this page; not a business record.') },
              ]} /> },
              { key: 'history', label: pick('历史只读', 'Read-only history'), children: <Descriptions size="small" column={1} bordered items={[
                { key: 'version', label: pick('冻结快照', 'Frozen snapshot'), children: pick('示例版本 1，2026-10-20 09:00（UTC+08:00）', 'Sample version 1, 2026-10-20 09:00 (UTC+08:00)') },
                { key: 'state', label: pick('快照状态', 'Snapshot state'), children: pick('待验证（冻结值）', 'Awaiting verification (frozen value)') },
                { key: 'handler', label: pick('当时处理者', 'Handler at snapshot time'), children: pick('样例处理者 A（非真实人员）', 'Sample handler A (fictional)') },
                { key: 'boundary', label: pick('只读边界', 'Read-only boundary'), children: pick('历史身份不等于当前处理资格；本地操作不改写此快照。', 'Historical identity does not grant current processing eligibility. Local actions do not alter this snapshot.') },
              ]} /> },
            ]} />
          </>}
        </div>
      </div>
    </section>

    <section id="sample-08" className="preview-section" aria-label={pick('S08 分析与扫码输入', 'S08 Analytics and barcode input')}>
      <div className="preview-section-heading">
        <h2>{pick('S08 分析与扫码输入', 'S08 Analytics and barcode input')}</h2>
        <p>{pick('用于解释指标缺失和连续输入；趋势不是 SPC，键盘输入不是相机、离线能力或真实设备验收。', 'Use to explain missing metrics and continuous input. This trend is not SPC; keyboard input does not validate cameras, offline support or real devices.')}</p>
      </div>
      <div className="preview-split">
        <div className="preview-example">
          <h3>{pick('指标语义与简单趋势', 'Metric semantics and a simple trend')}</h3>
          <Descriptions size="small" column={1} bordered items={[
            { key: 'zero', label: pick('示例缺陷数（件）', 'Sample defects (items)'), children: pick('0：已观察，计数为零', '0: observed, zero counted') },
            { key: 'missing', label: pick('待补充计数（件）', 'Missing count (items)'), children: pick('null：数据缺失，不计作 0', 'null: missing data, not counted as 0') },
            { key: 'na', label: pick('不适用指标', 'Inapplicable metric'), children: pick('NA：当前对象不适用，不参与汇总', 'NA: not applicable to this object; excluded from totals') },
          ]} />
          <figure className="preview-trend">
            <svg viewBox="0 0 320 120" width="100%" height="120" role="img" aria-label={pick('示例每日缺陷数趋势：10月18日2件，19日0件，20日3件。等价表格如下。', 'Sample daily defects: October 18, 2 items; October 19, 0; October 20, 3. Equivalent table follows.')}>
              <path d="M24 14V96H296" fill="none" stroke="var(--qms-border, currentColor)" />
              <polyline points="32,44 160,92 288,20" fill="none" stroke="var(--qms-accent, currentColor)" strokeWidth="3" />
              {[[32, 44], [160, 92], [288, 20]].map(([cx, cy]) => <circle key={cx} cx={cx} cy={cy} r="4" fill="var(--qms-accent, currentColor)" />)}
            </svg>
            <figcaption>{pick('单位：件／日；期间：2026-10-18～2026-10-20（UTC+08:00）；来源：固定本地示例，非真实质量数据。', 'Unit: items/day. Period: October 18–20, 2026 (UTC+08:00). Source: fixed local examples, not real quality data.')}</figcaption>
          </figure>
          <div className="preview-table-wrap">
            <table>
              <caption>{pick('趋势等价表格：示例每日缺陷数（件）', 'Equivalent trend table: sample daily defects (items)')}</caption>
              <thead><tr><th scope="col">{pick('日期（UTC+08:00）', 'Date (UTC+08:00)')}</th><th scope="col">{pick('缺陷数（件）', 'Defects (items)')}</th></tr></thead>
              <tbody>{[['2026-10-18', 2], ['2026-10-19', 0], ['2026-10-20', 3]].map(([date, value]) => <tr key={date}><th scope="row">{date}</th><td>{value}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="preview-note">{pick('仅展示简单趋势，不是 SPC：无控制限、过程稳定性判断或统计能力结论。缺失、不适用与真实零值分开表达。', 'Simple trend only, not SPC: no control limits, process stability assessment or capability conclusions. Missing, inapplicable and observed zero values remain distinct.')}</p>
        </div>
        <div className="preview-example">
          <h3>{pick('连续条码输入与重复保护', 'Continuous barcode input and duplicate protection')}</h3>
          <p className="preview-note" id="preview-barcode-help">{pick('输入 DEMO-001 等 DEMO- 前缀条码，按回车或点击校验。仅保存于本页内存，刷新即清除；未接入相机、离线队列或扫码设备。', 'Enter a barcode such as DEMO-001 with the DEMO- prefix, then press Enter or validate. Stored in page memory only and cleared on refresh. No camera, offline queue or scanner integration.')}</p>
          <label htmlFor="preview-barcode-input">{pick('条码输入', 'Barcode input')}</label>
          <Input id="preview-barcode-input" ref={barcodeInput} aria-label={pick('条码输入', 'Barcode input')} aria-describedby="preview-barcode-help"
            value={barcode} onChange={(event) => setBarcode(event.target.value)} onPressEnter={(event) => {
              if (event.nativeEvent.isComposing) return;
              event.preventDefault();
              scan();
            }} />
          <div className="preview-actions"><Button icon={<ScanLine size={16} aria-hidden="true" />} onClick={scan}>{pick('校验条码', 'Validate barcode')}</Button></div>
          <div role="status" aria-live="polite">
            {scanFeedback === 'recorded' && <p>{pick(`样例已记录 ${lastBarcode}`, `Sample recorded ${lastBarcode}`)}</p>}
            {scanFeedback === 'duplicate' && <p>{pick('重复条码，未重复记录。', 'Duplicate barcode; no duplicate record added.')}</p>}
            {scanFeedback === 'invalid' && <p>{pick('仅接受 DEMO- 前缀且后缀非空、无空格的样例条码；输入已保留。', 'Only sample barcodes with the DEMO- prefix and a non-empty, space-free suffix are accepted. Input retained.')}</p>}
            <p>{pick(`本地已记录 ${barcodes.length} 个条码。`, `${barcodes.length} barcodes recorded locally.`)}</p>
          </div>
          {barcodes.length > 0 && <ul aria-label={pick('本地已记录条码', 'Locally recorded barcodes')}>{barcodes.map((value) => <li key={value}>{value}</li>)}</ul>}
        </div>
      </div>
    </section>
  </>;
}
