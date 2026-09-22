import { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { apiRequest, createAdminMutation } from '../../api/client';
import type { AdminOrganization } from '../admin/admin';
import { organizationPath, type Organization } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';

export function OrganizationAdministration({ organization, organizations, onChanged }: { organization: AdminOrganization; organizations: AdminOrganization[]; onChanged?: () => void }) {
  const { t } = useLanguage();
  const [items, setItems] = useState<Organization[]>([]);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; target: Organization }>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [mutate] = useState(createAdminMutation);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    void apiRequest<Organization[]>(`/api/v1/organizations/tree?organizationId=${organization.id}&limit=100&offset=${offset}`).then((result) => { if (active) setItems(result); }).catch((cause) => { if (active) setError(cause); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, offset, revision]);
  const canManage = (id: string) => !!organizations.find((entry) => entry.id === id)?.permissions.includes('organization:manage');
  function edit(target: Organization, mode: 'create' | 'edit') {
    form.resetFields(); form.setFieldsValue(mode === 'edit' ? target : {}); setError(undefined); setEditor({ target, mode });
  }
  async function save(values: { code: string; name: string; parentId?: string; status?: 'ACTIVE' | 'DISABLED' }) {
    if (!editor) return;
    setSaving(true); setError(undefined);
    try {
      if (editor.mode === 'create') await mutate(organizationPath(editor.target.id, '/children'), 'POST', { code: values.code, name: values.name });
      else await mutate(organizationPath(editor.target.id), 'PATCH', { expectedVersion: editor.target.version, name: values.name, status: values.status, ...(values.parentId && values.parentId !== editor.target.parentId ? { parentId: values.parentId, expectedParentId: editor.target.parentId } : {}) });
      setEditor(undefined); setRevision((value) => value + 1); onChanged?.();
    } catch (cause) { setError(cause); }
    finally { setSaving(false); }
  }
  return <section className="governance-panel" aria-label={t('组织结构')}>
    <div className="governance-toolbar"><Button disabled={saving || loading} onClick={() => setRevision((value) => value + 1)}>{t('刷新')}</Button><Button disabled={saving || loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>{t('上一页')}</Button><Button disabled={saving || loading || items.length < 100} onClick={() => setOffset(offset + 100)}>{t('下一页')}</Button></div>
    {!editor ? <GovernanceFeedback error={error} retry={() => setRevision((value) => value + 1)} /> : null}
    <Table rowKey="id" dataSource={error && !editor ? [] : items} loading={loading} pagination={false} scroll={{ x: 700 }} columns={[
      { title: t('代码'), dataIndex: 'code' }, { title: t('名称'), dataIndex: 'name' }, { title: t('父组织'), dataIndex: 'parentId', render: (id: string | null) => items.find((entry) => entry.id === id)?.name ?? id ?? '—' },
      { title: t('状态'), dataIndex: 'status', render: (value: string) => <Tag color={value === 'ACTIVE' ? 'green' : undefined}>{t(value === 'ACTIVE' ? '启用' : '停用')}</Tag> },
      { title: t('操作'), render: (_value, entry) => canManage(entry.id) ? <Space><Button disabled={saving} onClick={() => edit(entry, 'edit')}>{t('编辑')}</Button>{entry.status === 'ACTIVE' ? <Button disabled={saving} onClick={() => edit(entry, 'create')}>{t('新增子组织')}</Button> : null}</Space> : t('只读') },
    ]} />
    <Modal title={t(editor?.mode === 'create' ? '新增子组织' : '编辑')} open={!!editor} okText={t('保存')} cancelText={t('取消')} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} maskClosable={!saving} onCancel={() => setEditor(undefined)} onOk={() => form.submit()}>
      <GovernanceFeedback error={error} />
      <Form name="organization-editor" form={form} layout="vertical" onFinish={save} disabled={saving}>
        {editor?.mode === 'create' ? <Form.Item label={t('代码')} name="code" rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ }]}><Input maxLength={64} /></Form.Item> : null}
        <Form.Item label={t('名称')} name="name" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        {editor?.mode === 'edit' ? <><Form.Item label={t('父组织')} name="parentId"><Select options={items.filter((entry) => entry.id !== editor.target.id && entry.type === editor.target.type && entry.status === 'ACTIVE' && canManage(entry.id)).map((entry) => ({ value: entry.id, label: entry.name }))} /></Form.Item><Form.Item label={t('状态')} name="status"><Select options={['ACTIVE', 'DISABLED'].map((value) => ({ value, label: t(value === 'ACTIVE' ? '启用' : '停用') }))} /></Form.Item></> : null}
      </Form>
    </Modal>
  </section>;
}
