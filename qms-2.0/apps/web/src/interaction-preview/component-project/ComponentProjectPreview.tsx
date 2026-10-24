import { Alert, Button, Checkbox, Empty, Form, Input, Modal, Radio, Select, Skeleton, Table, Tag, Tooltip } from 'antd';
import { Boxes, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../i18n/Language';
import { AppearanceButton } from '../../theme/AppearanceButton';

// Local view models only; formal pages must use the generated API contract instead.
type DemoProject = {
  id: string; code: string; name: string; stage: 'NEW_PRODUCT' | 'MASS_PRODUCTION';
  customerEngineer: string; projectEngineer: string;
};
type DemoComponent = {
  id: string; code: string; name: string; projectId: string; category: string; segment: string;
  manualCustomerEngineer: string; manualProjectEngineer: string;
};
type ProjectDraft = Omit<DemoProject, 'stage'> & { stage: DemoProject['stage'] | '' };
type Editor = { kind: 'project'; value: ProjectDraft; fresh: boolean } | { kind: 'component'; value: DemoComponent; fresh: boolean };
type View = 'normal' | 'readonly' | 'empty' | 'loading' | 'error' | 'long';
type BulkField = 'projectId' | 'stage' | 'customerEngineer' | 'projectEngineer' | 'category' | 'segment';
type BulkDraft = {
  enabled: Partial<Record<BulkField, boolean>>;
  projectId: string; stage: DemoProject['stage'] | ''; customerEngineer: string; projectEngineer: string;
  clearCustomerEngineer: boolean; clearProjectEngineer: boolean; category: string; segment: string;
};

function blankComponent(code = '', name = ''): DemoComponent {
  return { id: crypto.randomUUID(), code, name, projectId: '', category: '', segment: '', manualCustomerEngineer: '', manualProjectEngineer: '' };
}

const seedProjects: DemoProject[] = [
  { id: 'p1', code: 'DEMO-P-001', name: '演示控制系统', stage: 'NEW_PRODUCT', customerEngineer: '演示工程师甲', projectEngineer: '演示工程师乙' },
  { id: 'p2', code: 'DEMO-P-002', name: '演示储备项目', stage: 'MASS_PRODUCTION', customerEngineer: '', projectEngineer: '' },
];
const seedComponents: DemoComponent[] = [
  { id: 'c1', code: 'DEMO-CONTROL-001', name: '控制板', projectId: 'p1', category: '电子组件', segment: '控制板', manualCustomerEngineer: '', manualProjectEngineer: '' },
  { id: 'c2', code: 'DEMO-DRIVE-002', name: '驱动板', projectId: 'p1', category: '电子组件', segment: '驱动板', manualCustomerEngineer: '', manualProjectEngineer: '演示工程师丙' },
  { id: 'c3', code: 'DEMO-UNIT-003', name: '整机', projectId: 'p1', category: '整机产品', segment: '控制系统', manualCustomerEngineer: '', manualProjectEngineer: '' },
  { id: 'c4', code: 'DEMO-UNMAPPED', name: '待映射组件', projectId: '', category: '电子组件', segment: '控制板', manualCustomerEngineer: '', manualProjectEngineer: '' },
  { id: 'long', code: 'DEMO-LONG-COMPONENT-CODE-00000000000000000000000000000000000000000000000000000001', name: '长编码组件', projectId: 'p1', category: '电子组件', segment: '控制板', manualCustomerEngineer: '', manualProjectEngineer: '' },
];

export function ComponentProjectPreview() {
  const { locale, setLocale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const [projects, setProjects] = useState(seedProjects);
  const [componentRows, setComponents] = useState(seedComponents);
  const [view, setView] = useState<View>('normal');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [mode, setMode] = useState<'import' | 'bulk' | null>(null);
  const [importText, setImportText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<BulkDraft>({ enabled: {}, projectId: '', stage: '', customerEngineer: '', projectEngineer: '', clearCustomerEngineer: false, clearProjectEngineer: false, category: '', segment: '' });
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [fail, setFail] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const readOnly = view !== 'normal' && view !== 'long';
  const dialogOpen = editor !== null || mode !== null;
  const blocked = readOnly || dialogOpen || busy;
  const title = mode === 'import' ? text('批量导入基础组件', 'Import basic components')
    : mode === 'bulk' ? text('批量设置组件映射', 'Bulk component mapping') : editor?.kind === 'project'
    ? text(editor.fresh ? '新增项目' : '编辑项目', editor.fresh ? 'New project' : 'Edit project')
    : text(editor?.fresh ? '新增组件' : '编辑组件', editor?.fresh ? 'New component' : 'Edit component');
  const unassigned = text('未配置', 'Not assigned');
  const stageName = (stage: ProjectDraft['stage']) => stage === 'NEW_PRODUCT' ? text('新品', 'New product') : stage === 'MASS_PRODUCTION' ? text('量产', 'Mass production') : unassigned;
  const projectOptions = projects.map(project => ({ value: project.id, label: `${project.code} · ${project.name}` }));
  const selectedRows = componentRows.filter(row => selected.includes(row.id));
  const hasSharedChanges = bulk.enabled.stage || bulk.enabled.customerEngineer || bulk.enabled.projectEngineer;
  const affectedProjects = hasSharedChanges ? projects.filter(project => selectedRows.some(row => (bulk.enabled.projectId ? bulk.projectId : row.projectId) === project.id)) : [];

  useEffect(() => {
    if (!dirty && !busy) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, busy]);

  function openEditor(value: Editor) {
    if (blocked || lock.current) return;
    setEditor(value); setDirty(false); setError(''); setPreview(false);
  }
  function resetDialog() {
    setEditor(null); setMode(null); setImportText(''); setPreview(false); setDirty(false); setError('');
  }
  function closeEditor() {
    if (lock.current) return;
    if (dirty) setDiscard(true);
    else resetDialog();
  }
  function openMode(value: 'import' | 'bulk') {
    if (blocked || lock.current) return;
    setMode(value); setImportText(''); setDirty(false); setError(''); setPreview(false);
    setBulk({ enabled: {}, projectId: '', stage: '', customerEngineer: '', projectEngineer: '', clearCustomerEngineer: false, clearProjectEngineer: false, category: '', segment: '' });
  }
  function patchBulk(patch: Partial<BulkDraft>) {
    if (lock.current) return;
    setBulk({ ...bulk, ...patch }); setDirty(true); setPreview(false); setError('');
  }
  function patchProject(patch: Partial<ProjectDraft>) {
    if (editor?.kind !== 'project' || lock.current) return;
    setEditor({ ...editor, value: { ...editor.value, ...patch } }); setDirty(true); setPreview(false);
  }
  function patchComponent(patch: Partial<DemoComponent>) {
    if (editor?.kind !== 'component' || lock.current) return;
    setEditor({ ...editor, value: { ...editor.value, ...patch } }); setDirty(true);
  }
  async function commitLocal(change: () => void, message = text('本地样例已更新，未写入业务系统。', 'Local example updated; no business data was written.')) {
    if (readOnly || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      // shortcut: fixed local delay demonstrates busy, not backend concurrency or latency.
      await new Promise(resolve => window.setTimeout(resolve, 350));
      if (fail) { setError(text('模拟保存失败，输入已保留。关闭失败模拟后重试。', 'Simulated save failure. Input retained; turn off failure simulation and retry.')); return; }
      change(); resetDialog(); setNotice(message);
    } finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (!editor || readOnly || lock.current) return;
    const code = editor.value.code.trim();
    const name = editor.value.name.trim();
    if (!code || !name) { setError(text('编码和名称不能为空', 'Code and name are required')); return; }
    const stage = editor.kind === 'project' ? editor.value.stage : '';
    if (editor.kind === 'project' && !stage) { setError(text('请选择项目阶段（新品 / 量产）', 'Select a project stage (new product / mass production)')); return; }
    const rows = editor.kind === 'project' ? projects : componentRows;
    if (rows.some(row => row.id !== editor.value.id && row.code === code)) {
      setError(text('编码已存在，请修改后重试', 'Code already exists; change it and retry')); return;
    }
    if (editor.kind === 'project' && !editor.fresh && !preview) {
      const old = projects.find(project => project.id === editor.value.id);
      if (old && (old.stage !== editor.value.stage || old.customerEngineer !== editor.value.customerEngineer.trim() || old.projectEngineer !== editor.value.projectEngineer.trim())) {
        setPreview(true); setError(''); return;
      }
    }
    await commitLocal(() => {
      if (editor.kind === 'project' && stage) {
        const value = { ...editor.value, stage, code, name, customerEngineer: editor.value.customerEngineer.trim(), projectEngineer: editor.value.projectEngineer.trim() };
        setProjects(rows => editor.fresh ? [...rows, value] : rows.map(row => row.id === value.id ? value : row));
      } else if (editor.kind === 'component') {
        const value = { ...editor.value, code, name, category: editor.value.category.trim(), segment: editor.value.segment.trim(), manualCustomerEngineer: editor.value.manualCustomerEngineer.trim(), manualProjectEngineer: editor.value.manualProjectEngineer.trim() };
        setComponents(rows => editor.fresh ? [...rows, value] : rows.map(row => row.id === value.id ? value : row));
      }
    });
  }
  async function importComponents() {
    if (mode !== 'import' || readOnly || lock.current) return;
    const seen = new Set(componentRows.map(row => row.code));
    const added: DemoComponent[] = [];
    const duplicates: string[] = [];
    const lines = importText.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      const cells = line.split('\t').map(cell => cell.trim());
      if (cells.length === 2 && ['组件号', 'PROD_ID', '成品编码'].includes(cells[0]) && ['组件名称', 'MTRL_NAME', '物料名称'].includes(cells[1])) continue;
      if (cells.length !== 2 || !cells[0] || !cells[1]) {
        setError(text(`第 ${index + 1} 行需为两列非空文本（组件号、组件名称）；尚未导入任何行。`, `Line ${index + 1} needs two nonempty text columns (component code, name). Nothing imported.`)); return;
      }
      if (seen.has(cells[0])) duplicates.push(cells[0]);
      else { seen.add(cells[0]); added.push(blankComponent(cells[0], cells[1])); }
    }
    if (!added.length && !duplicates.length) { setError(text('请粘贴至少一行组件号和组件名称。', 'Paste at least one component code and name.')); return; }
    await commitLocal(() => setComponents(rows => [...rows, ...added]), text(
      `本地样例：新增 ${added.length} 行，跳过重复 ${duplicates.length} 行${duplicates.length ? `（${duplicates.join('、')}）` : ''}；不覆盖已有数据，未调用真实 API。`,
      `Local example: added ${added.length}, skipped ${duplicates.length} duplicates${duplicates.length ? ` (${duplicates.join(', ')})` : ''}. No overwrites or real API calls.`,
    ));
  }
  function previewBulk() {
    if (mode !== 'bulk' || readOnly || lock.current) return;
    if (!selectedRows.length || selectedRows.length > 100) { setError(text('请选择 1～100 个组件。', 'Select 1 to 100 components.')); return; }
    if (!Object.values(bulk.enabled).some(Boolean)) { setError(text('至少启用一个字段；未勾选字段不会修改。', 'Enable at least one field. Unchecked fields stay unchanged.')); return; }
    for (const field of Object.keys(bulk.enabled) as BulkField[]) {
      if (!bulk.enabled[field]) continue;
      const clear = field === 'customerEngineer' ? bulk.clearCustomerEngineer : field === 'projectEngineer' && bulk.clearProjectEngineer;
      if (!bulk[field].trim() && !clear) { setError(text('空值不会覆盖：请填写启用字段，或对工程师勾选“明确清空”。', 'Empty values never overwrite. Fill enabled fields or explicitly clear an engineer.')); return; }
    }
    if (bulk.enabled.projectId && !projects.some(project => project.id === bulk.projectId)) { setError(text('请选择已有项目。', 'Select an existing project.')); return; }
    if (hasSharedChanges && selectedRows.some(row => !projects.some(project => project.id === (bulk.enabled.projectId ? bulk.projectId : row.projectId)))) {
      setError(text('未映射组件需明确选择项目，才能修改共享阶段或工程师。', 'Unmapped components need an explicit project before shared stage or engineer changes.')); return;
    }
    setError(''); setPreview(true);
  }
  async function saveBulk() {
    if (mode !== 'bulk' || !preview || readOnly || lock.current) return;
    await commitLocal(() => {
      setComponents(rows => rows.map(row => !selected.includes(row.id) ? row : { ...row,
        projectId: bulk.enabled.projectId ? bulk.projectId : row.projectId,
        category: bulk.enabled.category ? bulk.category.trim() : row.category,
        segment: bulk.enabled.segment ? bulk.segment.trim() : row.segment,
      }));
      setProjects(rows => rows.map(project => !affectedProjects.some(affected => affected.id === project.id) ? project : { ...project,
        stage: bulk.enabled.stage && bulk.stage ? bulk.stage : project.stage,
        customerEngineer: bulk.enabled.customerEngineer ? (bulk.clearCustomerEngineer ? '' : bulk.customerEngineer.trim()) : project.customerEngineer,
        projectEngineer: bulk.enabled.projectEngineer ? (bulk.clearProjectEngineer ? '' : bulk.projectEngineer.trim()) : project.projectEngineer,
      }));
      setSelected([]);
    });
  }

  function hint(label: string, detail: string) {
    return <Tooltip title={detail} trigger={['hover', 'focus', 'click']}><Button className="cp-hint" type="text" size="small" aria-label={label}>!</Button></Tooltip>;
  }
  function engineer(manual: string, suggested: string | undefined, role: string) {
    const difference = Boolean(manual && suggested && manual !== suggested);
    return <span className="cp-engineer"><span>{manual || suggested || unassigned}</span>
      {manual && <small>{text('人工', 'Manual')}</small>}
      {difference && hint(text(`${role}存在差异`, `${role} differs`), text(`当前：${manual}；建议：${suggested}。保留人工值，不自动覆盖。`, `Current: ${manual}; Suggested: ${suggested}. Manual value retained, never overwritten.`))}
    </span>;
  }
  const componentTable = <section aria-label={text('组件映射', 'Component mapping')}>
    <div className="cp-toolbar"><span>{text('一行一个组件；项目阶段和工程师集中维护，同项目共享，不复制到组件。', 'One row per component. Stage and engineers belong to a shared project, never duplicated per component.')}</span>
      <div className="cp-actions">
        <Button disabled={blocked} onClick={() => openMode('import')}>{text('批量导入基础组件', 'Import basic components')}</Button>
        <Button disabled={blocked || !projects.length} onClick={() => openEditor({ kind: 'project', fresh: false, value: { ...projects[0] } })}>{text('维护项目资料', 'Maintain projects')}</Button>
        <Button disabled={blocked} onClick={() => openEditor({ kind: 'project', fresh: true, value: { id: crypto.randomUUID(), code: '', name: '', stage: '', customerEngineer: '', projectEngineer: '' } })}>{text('新增项目', 'New project')}</Button>
        <Button type="primary" icon={<Plus size={16} aria-hidden="true" />} disabled={blocked} onClick={() => openEditor({ kind: 'component', fresh: true, value: blankComponent() })}>{text('新增组件', 'New component')}</Button>
      </div>
    </div>
    <div className="cp-selection"><span>{text(`已选 ${selected.length} 个组件`, `${selected.length} components selected`)}</span>
      <Button disabled={blocked || !selected.length || selected.length > 100} onClick={() => openMode('bulk')}>{text('批量设置', 'Bulk update')}</Button>
      <Button type="text" disabled={blocked || !selected.length} onClick={() => setSelected([])}>{text('清除选择', 'Clear selection')}</Button>
      <span className="cp-note">{text('最多选择 100 行；仅启用字段会修改，共享变更需预览确认。', 'Up to 100 rows. Only enabled fields change; preview shared changes before confirmation.')}</span>
    </div>
    <Table<DemoComponent> rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 1450 }} dataSource={componentRows.filter(row => view === 'long' || row.id !== 'long')} rowSelection={{
      selectedRowKeys: selected, preserveSelectedRowKeys: true, onChange: keys => setSelected(keys.map(String)), getCheckboxProps: () => ({ disabled: blocked }),
    }} columns={[
      { title: text('组件号', 'Component code'), dataIndex: 'code', width: 220, render: value => <code className="cp-code">{value}</code> },
      { title: text('组件名称', 'Component name'), dataIndex: 'name', width: 170 },
      { title: text('项目', 'Project'), width: 200, render: (_, row) => {
        const project = projects.find(project => project.id === row.projectId);
        return project ? <div><code className="cp-code">{project.code}</code><span>{project.name}</span><Button className="cp-project-edit" type="link" disabled={blocked} aria-label={text(`维护项目 ${project.code}（${row.code}）`, `Maintain project ${project.code} (${row.code})`)} onClick={() => openEditor({ kind: 'project', fresh: false, value: { ...project } })}>{text('维护资料', 'Maintain')}</Button></div>
          : <span>{text('未映射', 'Not mapped')}{hint(text('未检索到映射关系', 'No mapping found'), text('未检索到映射关系：未配置所属项目。编辑组件或批量设置所属项目后可恢复；不按组件号或名称推断项目与类型。', 'No mapping found: project not configured. Edit or bulk assign a project to restore mapping. Never infer project or type from component code or name.'))}</span>;
      } },
      { title: text('新品 / 量产', 'New / mass production'), width: 130, render: (_, row) => {
        const project = projects.find(project => project.id === row.projectId);
        return project ? <Tag color={project.stage === 'NEW_PRODUCT' ? 'blue' : 'green'}>{stageName(project.stage)}</Tag> : '—';
      } },
      { title: text('产品大类 / 细分', 'Category / segment'), width: 170, render: (_, row) => <span>{row.category || unassigned} / {row.segment || unassigned}{!row.category && hint(text('未配置产品大类', 'Product category not configured'), text('未配置产品大类。编辑组件或批量设置产品大类后可恢复；产品细分和工程师允许留空。', 'Product category not configured. Edit or bulk assign a product category to complete it; segment and engineers may remain empty.'))}</span> },
      { title: text('客户质量工程师', 'Customer quality engineer'), width: 200, render: (_, row) => engineer(row.manualCustomerEngineer, projects.find(project => project.id === row.projectId)?.customerEngineer, text('客户质量工程师', 'Customer quality engineer')) },
      { title: text('项目质量工程师', 'Project quality engineer'), width: 200, render: (_, row) => engineer(row.manualProjectEngineer, projects.find(project => project.id === row.projectId)?.projectEngineer, text('项目质量工程师', 'Project quality engineer')) },
      { title: text('操作', 'Actions'), width: 100, render: (_, row) => <Button type="link" disabled={blocked} aria-label={text(`编辑组件 ${row.code}`, `Edit component ${row.code}`)} onClick={() => openEditor({ kind: 'component', fresh: false, value: { ...row } })}>{text('编辑', 'Edit')}</Button> },
    ]} />
    <p className="cp-note">{text('空人工值可取项目建议；人工非空值始终保留，差异仅用小 ! 提示。这里不更改任何已发问题或审批快照。', 'Empty manual values may use project suggestions. Nonempty manual values are retained with a small difference hint. No issued issue or approval snapshot is changed.')}</p>
  </section>;

  return <div className="cp-preview">
    <a className="cp-skip" href="#component-project-workspace">{text('跳到映射工作区', 'Skip to mapping workspace')}</a>
    <header className="cp-header"><div className="cp-brand"><Boxes size={22} aria-hidden="true" /><strong>QMS</strong><span>{text('组件 / 项目映射', 'Component / project mapping')}</span></div><div className="cp-actions"><Tag color="gold">{text('非生产样例', 'Non-production')}</Tag><Button onClick={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}>{locale === 'zh-CN' ? 'EN' : '中文'}</Button><AppearanceButton /></div></header>
    <main id="component-project-workspace" className="cp-main qms-content">
      <div className="cp-heading"><div><span className="cp-note">N2-A / SIDECAR</span><h1>{text('组件与项目映射维护', 'Component and project mapping')}</h1><p>{text('一处调整项目阶段，多组件同步查看。', 'Change a project stage once; see it on every linked component.')}</p></div></div>
      <Alert type="info" showIcon title={text('非生产交互样例 · 仅内存演示，刷新后重置', 'Non-production interaction example · In-memory only, reset on reload')} description={text('全部为虚构演示数据，不读取或写入 API。不联动阶段门或审批，不代替真实授权与业务验收。', 'All data is fictional. No API reads or writes. No stage-gate or approval changes; this is not authorization or business acceptance evidence.')} />
      <div className="cp-controls"><label htmlFor="cp-view">{text('查看交互状态', 'Interaction state')}</label><Select id="cp-view" aria-label={text('查看交互状态', 'Interaction state')} disabled={dialogOpen} value={view} onChange={value => { setView(value); setNotice(''); setSelected([]); }} options={[
        { value: 'normal', label: text('正常维护', 'Normal') }, { value: 'readonly', label: text('只读查看', 'Read-only') },
        { value: 'empty', label: text('空数据', 'Empty') }, { value: 'loading', label: text('加载中', 'Loading') },
        { value: 'error', label: text('加载错误', 'Load error') }, { value: 'long', label: text('长编码', 'Long code') },
      ]} /><Checkbox checked={fail} disabled={dialogOpen || readOnly} onChange={event => setFail(event.target.checked)}>{text('模拟保存失败', 'Simulate save failure')}</Checkbox>
        <span className="cp-note">{view === 'readonly' ? text('只读：可查看提示，不可修改。', 'Read-only: hints available, editing disabled.') : text('演示不调用真实业务服务', 'No business service calls')}</span>
      </div>
      {notice && <p role="status" className="cp-notice">{notice}</p>}
      <div className="cp-panel">
        {view === 'loading' ? <div role="status" aria-live="polite"><p>{text('正在加载演示数据', 'Loading demo data')}</p><Skeleton active /></div>
          : view === 'error' ? <Alert type="error" showIcon title={text('演示读取失败', 'Demo loading failed')} action={<Button onClick={() => setView('normal')}>{text('重试演示读取', 'Retry demo loading')}</Button>} />
            : view === 'empty' ? <Empty description={text('暂无演示数据', 'No demo data')}><Button onClick={() => setView('normal')}>{text('返回有数据样例', 'Return to populated example')}</Button></Empty>
              : componentTable}
      </div>
      <footer className="cp-note">{text('评审建议：粘贴两列基础清单 → 多选归项目 → 预览共享影响 → 确认阶段 / 工程师 → 查看人工差异。长编码状态另有一个同项目组件，影响预览也计入。正式界面独立接入，不复制本样例模型。', 'Review: paste two columns → select and assign a project → preview shared impact → confirm stage / engineers → inspect manual differences. Long-code mode has another linked component, included in impact counts. Formal pages integrate separately, never these demo models.')}</footer>
    </main>

    <Modal className="cp-dialog" title={title} open={dialogOpen} width={mode === 'bulk' ? 700 : 580} destroyOnHidden onCancel={closeEditor} keyboard={!busy} closable={!busy} mask={{ closable: !busy }} footer={<div className="qms-dialog-actions"><Button disabled={busy} onClick={closeEditor}>{text('取消', 'Cancel')}</Button>
      <Button type="primary" loading={busy} disabled={busy || readOnly} onClick={() => {
        if (mode === 'import') void importComponents();
        else if (mode === 'bulk') { if (preview) void saveBulk(); else previewBulk(); }
        else void save();
      }}>{mode === 'import' ? text('导入到本地样例', 'Import local example') : mode === 'bulk' ? (preview ? text('确认批量更新', 'Confirm bulk update') : text('预览影响', 'Preview impact')) : preview ? text('确认并保存到本地样例', 'Confirm and save local example') : text('保存到本地样例', 'Save local example')}</Button></div>}>
      {dialogOpen && <Form layout="vertical" disabled={busy}>
        <p className="cp-note">{text('仅修改本地演示数据；空工程师允许保存。', 'Only local demo data changes; empty engineers are allowed.')}</p>
        {mode === 'import' ? <>
          <p>{text('两列模板：组件号 / 组件名称。可从表格复制两列，以制表符分隔；不是逗号分隔。', 'Template: component code / component name. Copy two tab-separated columns, not comma-separated text.')}</p>
          <pre className="cp-template">{'组件号\t组件名称\n001.02-03\t控制板(新),^^保留'}</pre>
          <p className="cp-note">{text('IMS：PROD_ID / 成品编码 → 组件号；MTRL_NAME / 物料名称 → 组件名称。兼容中英文及双行表头。只新增基础信息，重复组件号跳过，不覆盖名称或映射；项目、产品分类、阶段不作推断。', 'IMS: PROD_ID / 成品编码 → component code; MTRL_NAME / 物料名称 → component name. Chinese, English and stacked headers accepted. Only basic fields are added; duplicate codes are skipped without overwriting names or mappings. Project, classification and stage are never inferred.')}</p>
          <Form.Item label={text('粘贴两列 TSV', 'Paste two-column TSV')} htmlFor="cp-import"><Input.TextArea id="cp-import" rows={8} value={importText} onChange={event => { if (lock.current) return; setImportText(event.target.value); setDirty(true); setError(''); }} /></Form.Item>
          <p className="cp-note">{text('组件号按文本保留前导 0、点和横线；名称保留括号、逗号、^^。仅样例内存，无真实 API，也不处理 Excel 文件。', 'Codes remain text with leading zeros, dots and hyphens. Names retain parentheses, commas and ^^. In-memory example only; no real API or Excel file processing.')}</p>
        </> : mode === 'bulk' ? <>
          <p>{text(`已选 ${selectedRows.length} 个组件。只改明确勾选字段，空值不会覆盖；不批量改组件号或名称。`, `${selectedRows.length} components selected. Only checked fields change; empty input never overwrites. Component codes and names cannot be bulk edited.`)}</p>
          <p className="cp-note">{selectedRows.map(row => row.code).join(' / ')}</p>
          <div className="cp-bulk-field"><Checkbox checked={Boolean(bulk.enabled.projectId)} onChange={event => patchBulk({ enabled: { ...bulk.enabled, projectId: event.target.checked } })}>{text('修改项目号', 'Change project')}</Checkbox>
            <Select aria-label={text('批量项目号', 'Bulk project')} disabled={busy || !bulk.enabled.projectId} placeholder={text('选择已有项目', 'Select existing project')} value={bulk.projectId || undefined} onChange={value => patchBulk({ projectId: value })} options={projectOptions} />
          </div>
          <div className="cp-bulk-field"><Checkbox checked={Boolean(bulk.enabled.stage)} onChange={event => patchBulk({ enabled: { ...bulk.enabled, stage: event.target.checked } })}>{text('修改新品 / 量产', 'Change stage')}</Checkbox>
            <Radio.Group aria-label={text('批量新品 / 量产', 'Bulk stage')} disabled={busy || !bulk.enabled.stage} value={bulk.stage} onChange={event => patchBulk({ stage: event.target.value })}><Radio value="NEW_PRODUCT">{text('新品', 'New product')}</Radio><Radio value="MASS_PRODUCTION">{text('量产', 'Mass production')}</Radio></Radio.Group>
          </div>
          {(['customerEngineer', 'projectEngineer'] as const).map(field => {
            const label = field === 'customerEngineer' ? text('客户质量工程师', 'Customer quality engineer') : text('项目质量工程师', 'Project quality engineer');
            const clearField = field === 'customerEngineer' ? 'clearCustomerEngineer' : 'clearProjectEngineer';
            return <div className="cp-bulk-field" key={field}>
              <Checkbox checked={Boolean(bulk.enabled[field])} onChange={event => patchBulk({ enabled: { ...bulk.enabled, [field]: event.target.checked } })}>{text(`修改${label}`, `Change ${label}`)}</Checkbox>
              <label htmlFor={`cp-bulk-${field}`}>{text(`批量${label}`, `Bulk ${label}`)}</label>
              <Input id={`cp-bulk-${field}`} disabled={busy || !bulk.enabled[field] || bulk[clearField]} list="cp-demo-engineers" value={bulk[field]} onChange={event => patchBulk({ [field]: event.target.value })} />
              <Checkbox disabled={busy || !bulk.enabled[field]} checked={bulk[clearField]} onChange={event => patchBulk({ [clearField]: event.target.checked })}>{text(`明确清空${label}`, `Explicitly clear ${label}`)}</Checkbox>
            </div>;
          })}
          {(['category', 'segment'] as const).map(field => {
            const label = field === 'category' ? text('产品大类', 'Product category') : text('产品细分', 'Product segment');
            return <div className="cp-bulk-field" key={field}>
              <Checkbox checked={Boolean(bulk.enabled[field])} onChange={event => patchBulk({ enabled: { ...bulk.enabled, [field]: event.target.checked } })}>{text(`修改${label}`, `Change ${label}`)}</Checkbox>
              <label htmlFor={`cp-bulk-${field}`}>{text(`批量${label}`, `Bulk ${label}`)}</label>
              <Input id={`cp-bulk-${field}`} disabled={busy || !bulk.enabled[field]} value={bulk[field]} onChange={event => patchBulk({ [field]: event.target.value })} />
            </div>;
          })}
          {preview && <section className="cp-impact" aria-label={text('批量影响预览', 'Bulk impact preview')} aria-live="polite">
            <h3>{text('批量影响预览', 'Bulk impact preview')}</h3>
            <p>{text('同项目都会同步阶段 / 工程师建议，包括未选中或未在当前页显示的组件；非空人工台账工程师不覆盖，不自动转派。', 'Stage / engineer suggestions synchronize for every component in a project, including unselected and off-page rows. Nonempty manual ledger engineers stay unchanged; no automatic reassignment.')}</p>
            {bulk.enabled.projectId ? <ul>{selectedRows.map(row => <li key={row.id}>{row.code}：{projects.find(project => project.id === row.projectId)?.code || text('未映射', 'Not mapped')} → {projects.find(project => project.id === bulk.projectId)?.code}</li>)}</ul> : <p>{text('项目关系不变，不偷偷转派组件。', 'Project links stay unchanged; no silent component reassignment.')}</p>}
            {bulk.enabled.stage && <p>{text('新品 / 量产', 'Stage')} → {bulk.stage && stageName(bulk.stage)}</p>}
            {(['customerEngineer', 'projectEngineer'] as const).filter(field => bulk.enabled[field]).map(field => <p key={field}>{field === 'customerEngineer' ? text('客户质量工程师', 'Customer quality engineer') : text('项目质量工程师', 'Project quality engineer')} → {(field === 'customerEngineer' ? bulk.clearCustomerEngineer : bulk.clearProjectEngineer) ? text('明确清空', 'Explicitly clear') : bulk[field]}</p>)}
            {(['category', 'segment'] as const).filter(field => bulk.enabled[field]).map(field => <p key={field}>{field === 'category' ? text('产品大类', 'Product category') : text('产品细分', 'Product segment')} → {bulk[field]}</p>)}
            {affectedProjects.map(project => <p key={project.id}><strong>{project.code} · {project.name}</strong>：{text(`未选组件 ${componentRows.filter(row => row.projectId === project.id && !selected.includes(row.id)).length}`, `Unselected components ${componentRows.filter(row => row.projectId === project.id && !selected.includes(row.id)).length}`)}</p>)}
            {!hasSharedChanges && <p>{text('未启用共享阶段 / 工程师修改，其他组件不变。', 'Shared stage / engineers are not enabled. Other components stay unchanged.')}</p>}
            <p className="cp-note">{text('此刻尚未更新。确认后才写入内存；任何字段修改均需重新预览。非真实服务端预览 / 事务证据。', 'Nothing changed yet. Confirmation writes to memory; any edit requires another preview. Not evidence of server-side preview or transactions.')}</p>
          </section>}
        </> : editor?.kind === 'project' ? <>
          {!editor.fresh && <Form.Item label={text('选择维护项目', 'Select project to maintain')}><Select aria-label={text('选择维护项目', 'Select project to maintain')} disabled={busy || dirty} value={editor.value.id} options={projectOptions} onChange={id => { const project = projects.find(row => row.id === id); if (project) { setEditor({ kind: 'project', fresh: false, value: { ...project } }); setError(''); setPreview(false); } }} /><span className="cp-note">{text('有草稿时先保存或取消，避免切换丢失输入。', 'Save or cancel a draft before switching projects.')}</span></Form.Item>}
          <Form.Item required label={text('项目号', 'Project code')} htmlFor="cp-project-code"><Input id="cp-project-code" value={editor.value.code} onChange={event => patchProject({ code: event.target.value })} /></Form.Item>
          <Form.Item required label={text('项目名称', 'Project name')} htmlFor="cp-project-name"><Input id="cp-project-name" value={editor.value.name} onChange={event => patchProject({ name: event.target.value })} /></Form.Item>
          <Form.Item required label={text('项目阶段', 'Project stage')}><Radio.Group aria-label={text('项目阶段', 'Project stage')} aria-required="true" value={editor.value.stage} onChange={event => patchProject({ stage: event.target.value })}><Radio value="NEW_PRODUCT">{text('新品', 'New product')}</Radio><Radio value="MASS_PRODUCTION">{text('量产', 'Mass production')}</Radio></Radio.Group></Form.Item>
          <Form.Item label={text('客户质量工程师', 'Customer quality engineer')} htmlFor="cp-customer-engineer"><Input id="cp-customer-engineer" list="cp-demo-engineers" value={editor.value.customerEngineer} onChange={event => patchProject({ customerEngineer: event.target.value })} /></Form.Item>
          <Form.Item label={text('项目质量工程师', 'Project quality engineer')} htmlFor="cp-project-engineer"><Input id="cp-project-engineer" list="cp-demo-engineers" value={editor.value.projectEngineer} onChange={event => patchProject({ projectEngineer: event.target.value })} /></Form.Item>
          <p className="cp-note">{text('保存后关联组件共同读取此阶段 / 人员；不联动阶段门或审批。', 'Linked components read this stage and these engineers after saving; no stage-gate or approval change.')}</p>
          {preview && <section className="cp-impact" aria-label={text('项目共享影响预览', 'Shared project impact preview')} aria-live="polite"><h3>{text('项目共享影响预览', 'Shared project impact preview')}</h3>
            <p>{editor.value.code} · {editor.value.name}：{text(`未选组件 ${componentRows.filter(row => row.projectId === editor.value.id).length}（从项目资料集中维护，本操作不选择组件行）。`, `Unselected components ${componentRows.filter(row => row.projectId === editor.value.id).length} (centralized project edit, no component rows selected in this operation).`)}</p>
            <p>{stageName(editor.value.stage)} / {editor.value.customerEngineer || unassigned} / {editor.value.projectEngineer || unassigned}</p>
            <p>{text('同项目都会同步，包含长编码及未在当前页显示的组件；非空人工台账工程师仍保留，不自动转派。确认后才修改样例。', 'All linked components synchronize, including long-code and off-page rows. Nonempty manual ledger engineers stay unchanged; no automatic reassignment. Only confirmation updates the example.')}</p>
          </section>}
        </> : editor?.kind === 'component' ? <>
          <Form.Item required label={text('组件号', 'Component code')} htmlFor="cp-component-code"><Input id="cp-component-code" value={editor.value.code} onChange={event => patchComponent({ code: event.target.value })} /></Form.Item>
          <Form.Item required label={text('组件名称', 'Component name')} htmlFor="cp-component-name"><Input id="cp-component-name" value={editor.value.name} onChange={event => patchComponent({ name: event.target.value })} /></Form.Item>
          <Form.Item label={text('所属项目', 'Project')} htmlFor="cp-project-link"><Select id="cp-project-link" aria-label={text('所属项目', 'Project')} allowClear value={editor.value.projectId || undefined} onChange={value => patchComponent({ projectId: value ?? '' })} options={projects.map(project => ({ value: project.id, label: `${project.code} · ${project.name}` }))} /></Form.Item>
          <Form.Item label={text('产品大类', 'Product category')} htmlFor="cp-category"><Input id="cp-category" value={editor.value.category} onChange={event => patchComponent({ category: event.target.value })} /></Form.Item>
          <Form.Item label={text('产品细分', 'Product segment')} htmlFor="cp-segment"><Input id="cp-segment" value={editor.value.segment} onChange={event => patchComponent({ segment: event.target.value })} /></Form.Item>
          <Form.Item label={text('人工客户质量工程师', 'Manual customer quality engineer')} htmlFor="cp-manual-customer"><Input id="cp-manual-customer" list="cp-demo-engineers" value={editor.value.manualCustomerEngineer} onChange={event => patchComponent({ manualCustomerEngineer: event.target.value })} /></Form.Item>
          <Form.Item label={text('人工项目质量工程师', 'Manual project quality engineer')} htmlFor="cp-manual-project"><Input id="cp-manual-project" list="cp-demo-engineers" value={editor.value.manualProjectEngineer} onChange={event => patchComponent({ manualProjectEngineer: event.target.value })} /></Form.Item>
          <p className="cp-note">{text('人工工程师输入只演示优先级，不写回任何真实问题；留空时取项目建议。', 'Manual input demonstrates priority only, without writing to any real issue. Empty values use project suggestions.')}</p>
        </> : null}
        <datalist id="cp-demo-engineers">{['甲', '乙', '丙', '丁'].map(suffix => <option key={suffix} value={`演示工程师${suffix}`} />)}</datalist>
        {error && <Alert type="error" showIcon title={error} action={fail ? <Button disabled={busy} onClick={() => { setFail(false); setError(''); }}>{text('关闭失败模拟', 'Turn off failure simulation')}</Button> : undefined} />}
      </Form>}
    </Modal>
    <Modal className="cp-dialog" title={text('未保存的修改', 'Unsaved changes')} open={discard} destroyOnHidden onCancel={() => setDiscard(false)} footer={<div className="qms-dialog-actions"><Button onClick={() => setDiscard(false)}>{text('继续编辑', 'Keep editing')}</Button><Button danger onClick={() => { setDiscard(false); resetDialog(); }}>{text('放弃修改并关闭', 'Discard changes and close')}</Button></div>}>
      <p>{text('当前输入尚未保存。放弃后不会修改本地样例。', 'Current input has not been saved. Discarding leaves the local example unchanged.')}</p>
    </Modal>
  </div>;
}
