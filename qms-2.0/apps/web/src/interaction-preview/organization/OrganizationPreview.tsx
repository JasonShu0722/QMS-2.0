import { Alert, Button, Checkbox, Descriptions, Empty, Form, Input, Modal, Select, Skeleton, Table, Tabs, Tag, Tooltip, Tree } from 'antd';
import type { TreeDataNode } from 'antd';
import { Building2, CircleAlert, GitBranch, Plus, RotateCcw, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLanguage } from '../../i18n/Language';
import { AppearanceButton } from '../../theme/AppearanceButton';
import { apply, blockers, createModel, people, permissions, type Appointment, type Command, type Kind, type Model, type Node, type Position } from './model';

type Editor = { kind: 'node'; value: Node; fresh: boolean } | { kind: 'position'; value: Position; fresh: boolean } | { kind: 'appointment'; value: Appointment; fresh: boolean };
type View = 'normal' | 'loading' | 'empty' | 'error' | 'readonly';

export function OrganizationPreview() {
  const { locale, setLocale } = useLanguage();
  const text = (zh: string, en: string) => locale === 'en-US' ? en : zh;
  const [model, setModel] = useState<Model>(createModel);
  const [selected, setSelected] = useState('process');
  const [managed, setManaged] = useState('hq');
  const [tab, setTab] = useState('basic');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fail, setFail] = useState(false);
  const [view, setView] = useState<View>('normal');
  const [impact, setImpact] = useState<'delete' | 'disable' | null>(null);
  const [reset, setReset] = useState(false);
  const node = model.nodes.find(item => item.id === selected) ?? model.nodes[0]!;
  const readOnly = view !== 'normal';
  const kindName = (kind: Kind) => ({ organization: text('组织', 'Organization'), department: text('部门', 'Department'), section: text('科室', 'Section') })[kind];
  const nodeName = (item?: Node) => item?.name ?? '—';
  const personName = (id: string) => people.find(person => person.id === id)?.name ?? id;
  const dutyName = (duty: Position['duty']) => ({ engineer: text('工程师', 'Engineer'), manager: text('科室经理', 'Section manager'), minister: text('部长', 'Minister'), admin: text('管理员', 'Administrator') })[duty];
  function inScope(id: string, root = node.id): boolean {
    const candidate = model.nodes.find(item => item.id === id);
    return id === root || Boolean(candidate?.kind !== 'organization' && candidate?.parentId && inScope(candidate.parentId, root));
  }
  function organizationFor(id: string): string {
    const candidate = model.nodes.find(item => item.id === id);
    return candidate?.kind === 'organization' ? candidate.id : candidate?.parentId ? organizationFor(candidate.parentId) : managed;
  }
  const positions = model.positions.filter(position => inScope(position.nodeId));
  const appointments = model.appointments.filter(appointment => positions.some(position => position.id === appointment.positionId) || appointment.sectionIds.some(id => inScope(id)));
  const ministers = model.appointments.filter(appointment => appointment.sectionIds.includes(node.id));
  const treeData = (parentId?: string): TreeDataNode[] => model.nodes.filter(item => item.parentId === parentId).map(item => ({
    key: item.id,
    title: <span className="org-tree-title"><span>{nodeName(item)}</span><small>{kindName(item.kind)}{!item.enabled ? text(' · 停用', ' · Inactive') : ''}</small></span>,
    children: item.kind === 'organization' && item.id !== managed ? [] : treeData(item.id),
  }));
  const editTitle = !editor ? '' : editor.kind === 'node'
    ? editor.fresh ? editor.value.kind === 'organization' ? text('新增子组织', 'New child organization') : text(`新增${kindName(editor.value.kind)}`, `New ${kindName(editor.value.kind)}`) : text('编辑基本信息', 'Edit basic details')
    : editor.kind === 'position' ? text(editor.fresh ? '新增岗位' : '编辑岗位', editor.fresh ? 'New position' : 'Edit position')
      : text(editor.fresh ? '新增人员任职' : '编辑人员任职', editor.fresh ? 'New appointment' : 'Edit appointment');

  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty]);

  function openEditor(value: Editor) { setEditor(value); setDirty(false); setError(''); }
  function closeEditor() { if (dirty) setDiscard(true); else setEditor(null); }
  function finish(command: Command) {
    const result = apply(model, command);
    if (result.error) { setError(result.error); return false; }
    setModel(result.model);
    setNotice(text('本地样例已更新；未写入业务系统。', 'Local example updated; no business data was written.'));
    return true;
  }
  function save() {
    if (!editor || readOnly) return;
    if (fail) { setError(text('模拟保存失败，输入已保留，请关闭失败模拟后重试。', 'Simulated save failure. Input retained; turn off failure simulation and retry.')); return; }
    if (finish({ type: editor.kind, value: editor.value } as Command)) {
      if (editor.kind === 'node') { setSelected(editor.value.id); if (editor.value.kind === 'organization') setManaged(editor.value.id); }
      if (editor.kind === 'position') setTab('positions');
      if (editor.kind === 'appointment') setTab('appointments');
      setEditor(null); setDirty(false);
    }
  }
  function addNode(kind: Kind) {
    openEditor({ kind: 'node', fresh: true, value: { id: crypto.randomUUID(), parentId: node.id, kind, name: '', code: '', enabled: true } });
  }
  function newPosition() {
    const duty = node.kind === 'section' ? 'engineer' : node.kind === 'organization' ? 'admin' : 'minister';
    openEditor({ kind: 'position', fresh: true, value: { id: crypto.randomUUID(), nodeId: node.id, name: '', duty, permissions: duty === 'admin' ? permissions.map(item => item.key) : [] } });
  }
  function newAppointment() {
    openEditor({ kind: 'appointment', fresh: true, value: { id: crypto.randomUUID(), positionId: positions[0]!.id, personId: '', sectionIds: [] } });
  }
  const impactReasons = impact ? blockers(model, node.id, impact) : [];
  const positionForEditor = editor?.kind === 'appointment' ? model.positions.find(position => position.id === editor.value.positionId) : undefined;

  return <div className="org-preview">
    <a className="org-skip" href="#org-workspace">{text('跳到组织工作区', 'Skip to workspace')}</a>
    <header className="org-header">
      <div className="org-brand"><Building2 size={23} aria-hidden="true" /><strong>QMS</strong><span>{text('平台管理 / 组织与岗位', 'Administration / Organization & positions')}</span></div>
      <div className="org-header-actions"><Tag color="gold">{text('本地交互样例', 'Local prototype')}</Tag><Button onClick={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}>{locale === 'zh-CN' ? 'EN' : '中文'}</Button><AppearanceButton /></div>
    </header>

    <main id="org-workspace" className="org-main">
      <div className="org-page-heading"><div><div className="org-eyebrow">WORKSPACE / 01</div><h1>{text('组织与岗位', 'Organization & positions')}</h1><p>{text('在同一张架构里，维护岗位、权限与人员职责。', 'One structure for positions, permissions and responsibilities.')}</p></div><Button icon={<RotateCcw size={15} aria-hidden="true" />} disabled={editor !== null} onClick={() => setReset(true)}>{text('重置全部样例', 'Reset demo')}</Button></div>

      <Alert type="info" showIcon title={text('仅供交互评审 · 所有记录均为模拟数据，刷新后重置', 'Interaction review only · All records are simulated and reset on reload')} description={text('不会读取或写入 API、发单或审批。分管关系与权限检查仅演示候选规则，不代表真实授权已实现。未决项：正式服务、在途变更和生产初始化实现细节。', 'No API access, business writes or approvals. Scope and permission checks are demonstrations, not authorization evidence. Service implementation, in-flight changes and production setup remain outside this preview.')} />

      <div className="org-review-controls"><label htmlFor="org-view">{text('查看交互状态', 'Preview state')}</label><Select id="org-view" aria-label={text('查看交互状态', 'Preview state')} value={view} disabled={editor !== null} onChange={setView} options={[
        { value: 'normal', label: text('正常办理', 'Normal') }, { value: 'readonly', label: text('只读查看', 'Read only') }, { value: 'loading', label: text('加载中', 'Loading') }, { value: 'empty', label: text('无数据', 'Empty') }, { value: 'error', label: text('加载失败', 'Load error') },
      ]} /><Checkbox checked={fail} onChange={event => setFail(event.target.checked)}>{text('模拟保存失败', 'Simulate save failure')}</Checkbox><span>{text('变更仅保留在本页面内存中', 'Changes stay in this page memory')}</span></div>
      {notice && <div className="org-notice" role="status"><ShieldCheck size={16} aria-hidden="true" />{notice}</div>}

      <div className="org-workspace">
        <aside className="org-structure" aria-label={text('组织架构', 'Organization structure')}><div className="org-panel-heading"><GitBranch size={17} aria-hidden="true" /><strong>{text('架构与范围', 'Structure & scope')}</strong></div><div className="org-scope"><label htmlFor="org-managed">{text('管理组织', 'Managed organization')}</label><strong>{nodeName(model.nodes.find(item => item.id === managed))} · {model.nodes.find(item => item.id === managed)?.code}</strong><Select id="org-managed" aria-label={text('管理组织', 'Managed organization')} value={managed} disabled={editor !== null} options={model.nodes.filter(item => item.kind === 'organization').map(item => ({ value: item.id, label: item.name }))} onChange={id => { setManaged(id); setSelected(id); setNotice(''); setTab('basic'); }} /></div>
          <Tree key={`${managed}:${model.nodes.length}`} aria-label={text('组织架构树', 'Organization tree')} blockNode showLine defaultExpandAll selectedKeys={[node.id]} treeData={treeData(model.nodes.find(item => item.id === managed)?.parentId).filter(item => item.key === managed)} disabled={editor !== null} onSelect={keys => { if (keys[0]) { const id = String(keys[0]); setManaged(organizationFor(id)); setSelected(id); setNotice(''); setTab('basic'); } }} />
          <div className="org-tree-note"><CircleAlert size={15} aria-hidden="true" /><p>{text('组织是授权边界，部门 / 科室是内部架构。展开节点不会自动授予权限。', 'Organizations define access boundaries; departments and sections define structure. Expanding a node grants no permissions.')}</p></div>
        </aside>

        <section className="org-detail" aria-label={text('所选节点工作区', 'Selected node workspace')}>
          {view === 'loading' ? <Skeleton active paragraph={{ rows: 7 }} /> : view === 'error' ? <Alert type="error" showIcon title={text('模拟加载失败，原有样例数据未丢失', 'Simulated load error; local records are retained')} action={<Button onClick={() => setView('normal')}>{text('重试', 'Retry')}</Button>} /> : view === 'empty' ? <Empty description={text('此处演示无数据状态；左侧模拟架构仍保留。', 'Empty-state simulation; the local structure is retained.')}><Button onClick={() => setView('normal')}>{text('恢复样例数据', 'Return to demo data')}</Button></Empty> : <>
            {view === 'readonly' && <Alert type="warning" showIcon title={text('模拟只读：可查看，不可修改。此状态不是后端鉴权验证。', 'Read-only simulation, not server authorization verification.')} />}
            <div className="org-node-heading"><div><span className="org-breadcrumb">{node.parentId ? nodeName(model.nodes.find(item => item.id === node.parentId)) : text('管理组织', 'Managed organization')} / {kindName(node.kind)}</span><h2>{nodeName(node)}<Tag color={node.enabled ? 'green' : undefined}>{node.enabled ? text('启用', 'Active') : text('停用', 'Inactive')}</Tag></h2><code>{node.code}</code></div><div className="org-actions">
              {node.kind === 'organization' && <Button type="primary" disabled={readOnly || !node.enabled} icon={<Plus size={15} aria-hidden="true" />} onClick={() => addNode('department')}>{text('新增部门', 'New department')}</Button>}
              {node.kind === 'organization' && <Button disabled={readOnly || !node.enabled} onClick={() => addNode('organization')}>{text('新增子组织', 'New child organization')}</Button>}
              {node.kind === 'department' && <Button type="primary" disabled={readOnly || !node.enabled} icon={<Plus size={15} aria-hidden="true" />} onClick={() => addNode('section')}>{text('新增科室', 'New section')}</Button>}
              {node.kind === 'section' && <Button type="primary" disabled={readOnly || !node.enabled} icon={<Plus size={15} aria-hidden="true" />} onClick={newPosition}>{text('新增岗位', 'New position')}</Button>}
              <Button disabled={readOnly} onClick={() => openEditor({ kind: 'node', value: { ...node }, fresh: false })}>{text('编辑基本信息', 'Edit basic details')}</Button>
            </div></div>
            <Tabs activeKey={tab} onChange={setTab} items={[
              { key: 'basic', label: text('基本信息', 'Basic details'), children: <>
                <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small" items={[
                  { key: 'type', label: text('节点类型', 'Node type'), children: kindName(node.kind) },
                  { key: 'parent', label: text('上级节点', 'Parent'), children: nodeName(model.nodes.find(item => item.id === node.parentId)) },
                  { key: 'scope', label: text('管理岗位范围', 'Position scope'), children: text('当前节点及下级', 'This node and descendants') },
                  { key: 'count', label: text('所属岗位 / 任职', 'Positions / appointments'), children: `${positions.length} / ${appointments.length}` },
                  { key: 'minister', label: text('分管部长', 'Responsible minister'), children: ministers.length ? ministers.map(item => personName(item.personId)).join('、') : text('未配置 / 不适用', 'Not configured / not applicable') },
                  { key: 'manager', label: text('科室经理', 'Section manager'), children: appointments.filter(item => model.positions.some(position => position.id === item.positionId && position.nodeId === node.id && position.duty === 'manager')).map(item => personName(item.personId)).join('、') || text('未配置 / 不适用', 'Not configured / not applicable') },
                ]} />
                <div className="org-subsection"><h3>{text('配置如何进入流程', 'How configuration feeds workflows')}</h3><ol><li>{text('选择责任科室后，只在该科室有效任职人员中选择负责人。', 'Select an owner from valid appointments in the responsible section.')}</li><li>{text('经理来自科室管理岗位；部长按分管科室匹配，不从同部门任取一人。', 'Resolve the manager by section and the minister by coverage, not arbitrarily by department.')}</li><li>{text('实际审批轮次、同人处理与权限检查由后续正式服务实现，本样例不执行审批。', 'The future service handles review rounds, same-person rules and authorization. This demo performs no approvals.')}</li></ol></div>
                <div className="org-danger-zone"><div><h3>{text('停用与删除', 'Deactivate & delete')}</h3><p>{text('先检查依赖，再明确确认；不会自动迁移或级联清理。', 'Inspect dependencies before confirmation. No automatic migration or cascading cleanup.')}</p></div><div className="org-actions"><Button disabled={readOnly || !node.enabled} onClick={() => { setError(''); setImpact('disable'); }}>{text('检查停用影响', 'Inspect deactivation')}</Button><Button danger disabled={readOnly} onClick={() => { setError(''); setImpact('delete'); }}>{text('检查删除影响', 'Inspect deletion')}</Button></div></div>
              </> },
              { key: 'positions', label: text('岗位与权限', 'Positions & permissions'), children: <><div className="org-table-toolbar"><span>{text('岗位即业务授权对象，不另建角色清单。', 'Positions are authorization objects; no separate role list.')}</span><Button disabled={readOnly || !node.enabled} onClick={newPosition}>{text('新增岗位', 'New position')}</Button></div><Table rowKey="id" pagination={false} size="small" scroll={{ x: 660 }} dataSource={positions} columns={[
                { title: text('岗位', 'Position'), dataIndex: 'name' }, { title: text('所属节点', 'Node'), render: (_, item) => nodeName(model.nodes.find(value => value.id === item.nodeId)) }, { title: text('职责', 'Duty'), render: (_, item) => dutyName(item.duty) },
                { title: text('功能权限', 'Permissions'), render: (_, item) => item.permissions.map(key => permissions.find(value => value.key === key)?.[locale === 'en-US' ? 'en' : 'zh'] ?? key).join(' / ') || '—' },
                { title: text('操作', 'Actions'), render: (_, item) => <Button type="link" disabled={readOnly} onClick={() => openEditor({ kind: 'position', fresh: false, value: { ...item, permissions: [...item.permissions] } })}>{text('编辑岗位', 'Edit position')}</Button> },
              ]} /></> },
              { key: 'appointments', label: text('人员任职与分管', 'Appointments & coverage'), children: <><div className="org-table-toolbar"><span>{text('同账号可兼岗；同科室同期仅一名分管部长。', 'One account may hold multiple positions; one minister per section at a time.')}</span><Tooltip title={!positions.length ? text('请先在所选范围建立岗位', 'Create a position in this scope first') : undefined}><Button disabled={readOnly || !node.enabled || !positions.length} icon={<Users size={15} aria-hidden="true" />} onClick={newAppointment}>{text('新增人员任职', 'New appointment')}</Button></Tooltip></div><Table rowKey="id" pagination={false} size="small" scroll={{ x: 630 }} dataSource={appointments} columns={[
                { title: text('人员', 'Person'), render: (_, item) => personName(item.personId) }, { title: text('任职岗位', 'Position'), render: (_, item) => model.positions.find(position => position.id === item.positionId)?.name },
                { title: text('分管科室', 'Section coverage'), render: (_, item) => item.sectionIds.map(id => nodeName(model.nodes.find(value => value.id === id))).join('、') || '—' },
                { title: text('操作', 'Actions'), render: (_, item) => <Button type="link" disabled={readOnly} onClick={() => openEditor({ kind: 'appointment', fresh: false, value: { ...item, sectionIds: [...item.sectionIds] } })}>{text('编辑任职', 'Edit appointment')}</Button> },
              ]} /></> },
            ]} />
          </>}
        </section>
      </div>
      <footer className="org-footer">{text('评审路径：建架构 → 建岗配权 → 人员兼岗 / 部长分管 → 编码纠错 / 删除停用。实际用户账号创建仍在用户管理，不在此复制。', 'Review path: structure → permissions → appointments / minister coverage → code corrections / lifecycle checks. Account creation remains in user management.')}<a href="/interaction-preview.html">{text('返回基础交互样例', 'Interaction library')}</a></footer>
    </main>

    <Modal title={editTitle} open={editor !== null} onCancel={closeEditor} destroyOnHidden footer={<div className="org-dialog-actions"><Button onClick={closeEditor}>{text('取消', 'Cancel')}</Button><Button type="primary" disabled={readOnly} onClick={save}>{text('保存到本地样例', 'Save local example')}</Button></div>}>
      {editor && <Form layout="vertical" onValuesChange={() => setDirty(true)}>
        <p className="org-muted">{text('只更新模拟数据，所属范围不会随更名 / 改码自动迁移。', 'Only simulated records change. Renaming does not migrate scope.')}</p>
        {editor.kind === 'node' && <>
          {editor.fresh && editor.value.kind === 'organization' && <Alert type="warning" showIcon title={text('子组织是独立授权范围，不是内部部门', 'A child organization is a separate authorization scope, not a department')} description={text('本地样例不继承父组织岗位、任职或权限；保存后切换到新组织范围。', 'The demo inherits no parent positions, appointments or permissions. Saving switches to the new scope.')} />}
          <Form.Item label={text('节点类型', 'Node type')}><Input readOnly value={kindName(editor.value.kind)} /></Form.Item>
          <Form.Item label={text('名称', 'Name')} htmlFor="org-node-name" required><Input id="org-node-name" autoFocus value={editor.value.name} onChange={event => { setEditor({ ...editor, value: { ...editor.value, name: event.target.value } }); setDirty(true); }} /></Form.Item>
          <Form.Item label={text('编码', 'Code')} htmlFor="org-node-code" required><Input id="org-node-code" value={editor.value.code} onChange={event => { setEditor({ ...editor, value: { ...editor.value, code: event.target.value } }); setDirty(true); }} /></Form.Item>
        </>}
        {editor.kind === 'position' && <>
          <Form.Item label={text('所属节点', 'Parent node')}><Input readOnly value={nodeName(model.nodes.find(item => item.id === editor.value.nodeId))} /></Form.Item>
          <Form.Item label={text('岗位名称', 'Position name')} htmlFor="org-position-name" required><Input id="org-position-name" autoFocus value={editor.value.name} onChange={event => { setEditor({ ...editor, value: { ...editor.value, name: event.target.value } }); setDirty(true); }} /></Form.Item>
          <Form.Item label={text('岗位职责', 'Position duty')} htmlFor="org-position-duty"><Select id="org-position-duty" value={editor.value.duty} onChange={(duty: Position['duty']) => { setEditor({ ...editor, value: { ...editor.value, duty, permissions: duty === 'admin' ? permissions.map(item => item.key) : editor.value.permissions } }); setDirty(true); }} options={(['engineer', 'manager', 'minister', 'admin'] as const).filter(value => value !== 'minister' || model.nodes.find(item => item.id === editor.value.nodeId)?.kind === 'department').filter(value => value !== 'admin' || model.nodes.find(item => item.id === editor.value.nodeId)?.kind !== 'section').map(value => ({ value, label: dutyName(value) }))} /></Form.Item>
          <Form.Item label={text('功能权限', 'Function permissions')}><Checkbox.Group value={editor.value.permissions} disabled={editor.value.duty === 'admin'} options={permissions.map(item => ({ value: item.key, label: locale === 'en-US' ? item.en : item.zh }))} onChange={values => { setEditor({ ...editor, value: { ...editor.value, permissions: values as string[] } }); setDirty(true); }} /></Form.Item>
          {editor.value.duty === 'admin' && <Alert type="info" title={text('管理员示例包含本演示的全部权限，不代表正式系统权限目录或跨组织超管。', 'The admin example includes all demo permissions, not the real permission catalog or cross-organization access.')} />}
        </>}
        {editor.kind === 'appointment' && <>
          <Form.Item label={text('任职岗位', 'Position')} htmlFor="org-appointment-position" required><Select id="org-appointment-position" value={editor.value.positionId} options={model.positions.filter(item => positions.some(value => value.id === item.id) || item.id === editor.value.positionId).map(item => ({ value: item.id, label: item.name }))} onChange={positionId => { setEditor({ ...editor, value: { ...editor.value, positionId, sectionIds: [] } }); setDirty(true); }} /></Form.Item>
          <Form.Item label={text('任职人员', 'Appointee')} htmlFor="org-appointment-person" required><Select id="org-appointment-person" placeholder={text('选择已有演示账号', 'Select a demo account')} value={editor.value.personId || undefined} options={people.map(person => ({ value: person.id, label: person.name }))} onChange={personId => { setEditor({ ...editor, value: { ...editor.value, personId } }); setDirty(true); }} /></Form.Item>
          {positionForEditor?.duty === 'minister' && <Form.Item label={text('分管科室', 'Responsible sections')} htmlFor="org-appointment-sections" required><Select mode="multiple" id="org-appointment-sections" value={editor.value.sectionIds} options={model.nodes.filter(item => item.kind === 'section' && item.enabled && inScope(item.id, positionForEditor.nodeId)).map(item => ({ value: item.id, label: nodeName(item) }))} onChange={sectionIds => { setEditor({ ...editor, value: { ...editor.value, sectionIds } }); setDirty(true); }} /></Form.Item>}
          <p className="org-muted">{text('同一人员可任多个岗位；分管冲突拒绝保存，输入保留。', 'One person may hold multiple positions. Conflicting section coverage is rejected without losing input.')}</p>
        </>}
        {error && <Alert type="error" showIcon title={error} action={fail ? <Button size="small" onClick={() => setFail(false)}>{text('关闭失败模拟', 'Disable failure simulation')}</Button> : undefined} />}
      </Form>}
    </Modal>
    <Modal title={text('尚有未保存修改', 'Unsaved changes')} open={discard} onCancel={() => setDiscard(false)} footer={<div className="org-dialog-actions"><Button onClick={() => setDiscard(false)}>{text('继续编辑', 'Continue editing')}</Button><Button danger onClick={() => { setDiscard(false); setEditor(null); setDirty(false); setError(''); }}>{text('放弃修改', 'Discard changes')}</Button></div>}><p>{text('关闭将丢弃当前输入，已保存的样例不受影响。', 'Closing discards current edits. Saved local examples remain unchanged.')}</p></Modal>
    <Modal title={impact === 'delete' ? text('删除影响检查', 'Deletion impact') : text('停用影响检查', 'Deactivation impact')} open={impact !== null} onCancel={() => setImpact(null)} footer={<div className="org-dialog-actions"><Button onClick={() => setImpact(null)}>{text('取消', 'Cancel')}</Button><Button danger disabled={readOnly || impactReasons.length > 0} onClick={() => {
      if (!impact) return;
      const action = impact;
      if (finish({ type: action, id: node.id })) {
        setImpact(null);
        if (action === 'delete') { setSelected(node.parentId ?? 'hq'); setManaged(organizationFor(node.parentId ?? 'hq')); setNotice(text('本地样例已删除；未删除任何线上对象。', 'Local example deleted; no online objects changed.')); }
      }
    }}>{impact === 'delete' ? text('确认删除', 'Confirm deletion') : text('确认停用', 'Confirm deactivation')}</Button></div>}>
      <p><strong>{nodeName(node)}</strong> · {node.code}</p>
      {impactReasons.length ? <Alert type="warning" showIcon title={text('当前不能执行，请先处理以下依赖', 'Action blocked by dependencies')} description={<ul>{impactReasons.map(reason => <li key={reason}>{reason}</li>)}</ul>} /> : <Alert type="info" showIcon title={text('模拟检查未发现阻止项', 'No blockers in this local example')} description={text('这里只验证内存样例，不代表真实数据库无引用。确认后只改变本页模拟对象。', 'This does not prove the absence of database references. Confirmation changes only local simulated data.')} />}
      {error && <Alert type="error" title={error} />}
    </Modal>
    <Modal title={text('重置全部样例', 'Reset demo')} open={reset} onCancel={() => setReset(false)} onOk={() => { setModel(createModel()); setSelected('process'); setManaged('hq'); setTab('basic'); setNotice(''); setFail(false); setView('normal'); setReset(false); }} okText={text('确认重置', 'Confirm reset')} cancelText={text('取消', 'Cancel')}><p>{text('清除本次所有模拟修改，恢复预设架构、任职和分管关系。', 'Discard local changes and restore the demo structure, appointments and coverage.')}</p></Modal>
  </div>;
}
