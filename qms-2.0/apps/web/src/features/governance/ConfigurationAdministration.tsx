import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Spin, Switch, Typography } from 'antd';
import { LedgerTable, useLedgerPageSize } from '../../ui/ledger';
import { apiRequest, createAdminMutation } from '../../api/client';
import type { AdminOrganization } from '../admin/admin';
import { configurationPath, type Settings, type NotificationRule, type PositionCategory } from './governance';
import { GovernanceFeedback } from './GovernanceFeedback';
import { useLanguage } from '../../i18n/Language';
import { useNavigationBusy, useNavigationGuard, useUnsavedChanges } from '../../layouts/UnsavedChanges';

export function ConfigurationAdministration({ organization }: { organization: AdminOrganization }) {
  if (!organization.permissions.includes('configuration:read')) return null;
  return <PlatformConfiguration organization={organization} />;
}
function PlatformConfiguration({ organization }: { organization: AdminOrganization }) {
  const [rulePageSize, setRulePageSize] = useLedgerPageSize('configuration-notification-rules', organization.id);
  const [categoryPageSize, setCategoryPageSize] = useLedgerPageSize('configuration-position-categories', organization.id);
  const [rulePage, setRulePage] = useState(1);
  const [categoryPage, setCategoryPage] = useState(1);
  const { t } = useLanguage();
  const [settings, setSettings] = useState<Settings>();
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [categories, setCategories] = useState<PositionCategory[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [ruleEditor, setRuleEditor] = useState<NotificationRule>();
  const [categoryEditor, setCategoryEditor] = useState<{ record?: PositionCategory }>();
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [ruleDirty, setRuleDirty] = useState(false);
  const [categoryDirty, setCategoryDirty] = useState(false);
  const [settingsForm] = Form.useForm();
  const [mutate] = useState(createAdminMutation);
  const manage = organization.permissions.includes('configuration:manage');
  const requestLeave = useNavigationGuard();
  const dirty = settingsDirty || ruleDirty || categoryDirty;
  useUnsavedChanges(dirty);
  useNavigationBusy(saving);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    void Promise.all([apiRequest<Settings>(configurationPath(organization.id, 'settings')), apiRequest<NotificationRule[]>(configurationPath(organization.id, 'notification-rules')), apiRequest<PositionCategory[]>(configurationPath(organization.id, 'position-categories'))]).then(([nextSettings, nextRules, nextCategories]) => {
      if (active) { setSettings(nextSettings); setSettingsDirty(false); setRules(nextRules); setCategories(nextCategories); }
    }).catch((cause) => { if (active) setError(cause); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organization.id, revision]);
  useEffect(() => {
    if (settings) settingsForm.setFieldsValue(settings);
  }, [settings, settingsForm]);
  function refresh() {
    if (saving || loading) return;
    requestLeave(() => {
      setRuleEditor(undefined); setCategoryEditor(undefined);
      setRuleDirty(false); setCategoryDirty(false);
      setRevision((value) => value + 1);
    });
  }
  async function saveSettings(values: Pick<Settings, 'notificationLocale' | 'exportRetentionMinutes'>) {
    if (!settings || loading || saving || !manage) return;
    setSaving(true); setError(undefined);
    try { setSettings(await mutate<Settings>(configurationPath(organization.id, 'settings'), 'PATCH', { ...values, expectedVersion: settings.version })); setSettingsDirty(false); }
    catch (cause) { setError(cause); } finally { setSaving(false); }
  }
  async function saveRule(values: Pick<NotificationRule, 'enabled' | 'subjectTemplate' | 'bodyTemplate'>) {
    if (!ruleEditor) return;
    setSaving(true); setError(undefined);
    try {
      const result = await mutate<NotificationRule>(configurationPath(organization.id, `notification-rules/${ruleEditor.kind}`), 'PATCH', { ...values, expectedVersion: ruleEditor.version });
      setRules((current) => current.map((entry) => entry.kind === result.kind ? result : entry)); setRuleDirty(false); setRuleEditor(undefined);
    } catch (cause) { setError(cause); } finally { setSaving(false); }
  }
  async function saveCategory(values: { code: string; name: string; status: 'ACTIVE' | 'DISABLED'; sortOrder: number }) {
    if (!categoryEditor) return;
    setSaving(true); setError(undefined);
    try {
      const record = categoryEditor.record;
      const result = await mutate<PositionCategory>(configurationPath(organization.id, `position-categories${record ? `/${record.id}` : ''}`), record ? 'PATCH' : 'POST', record ? { name: values.name, status: values.status, sortOrder: values.sortOrder, expectedVersion: record.version } : { code: values.code, name: values.name, sortOrder: values.sortOrder });
      setCategories((current) => [...current.filter((entry) => entry.id !== result.id), result].sort((first, second) => first.sortOrder - second.sortOrder || first.code.localeCompare(second.code)));
      setCategoryDirty(false); setCategoryEditor(undefined);
    } catch (cause) { setError(cause); } finally { setSaving(false); }
  }
  const notificationName = (kind: NotificationRule['kind']) => t(kind === 'TASK_ASSIGNED' ? '任务分配' : kind === 'TASK_REMINDER' ? '时限提醒' : '超时升级');
  return <section className="governance-panel" aria-label={t('平台配置')}>
    {!ruleEditor && !categoryEditor ? <GovernanceFeedback error={error} retry={refresh} /> : null}
    <Button disabled={saving || loading} onClick={refresh}>{t('刷新')}</Button>
    <Card title={t('系统参数')}>
      <Spin spinning={loading}>
        <Form name="platform-settings" form={settingsForm} layout="vertical" onValuesChange={() => setSettingsDirty(true)} onFinish={saveSettings} disabled={!manage || loading || saving || !settings}>
          <Form.Item name="notificationLocale" label={t('通知语言')} rules={[{ required: true }]}><Select options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }]} /></Form.Item>
          <Form.Item name="exportRetentionMinutes" label={t('导出保留时间（分钟）')} rules={[{ required: true }, { type: 'number', min: 5, max: 10080 }]}><InputNumber min={5} max={10080} precision={0} /></Form.Item>
          {manage ? <Button htmlType="submit" type="primary" loading={saving}>{t('保存')}</Button> : null}
        </Form>
      </Spin>
    </Card>
    <Card title={t('通知规则')} loading={loading}>
      <LedgerTable ledgerId="configuration-notification-rules" organizationId={organization.id} requiredColumnKeys={['kind', 'actions']} rowKey="kind" dataSource={rules} pagination={{ current: rulePage, pageSize: rulePageSize, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], disabled: saving, onChange: (page, size) => requestLeave(() => { setRulePage(size === rulePageSize ? page : 1); setRulePageSize(size); }) }} columns={[{ key: 'kind', title: t('事件类型'), dataIndex: 'kind', render: notificationName }, { key: 'enabled', title: t('状态'), dataIndex: 'enabled', render: (enabled: boolean) => t(enabled ? '启用' : '停用') }, { key: 'version', title: t('版本'), dataIndex: 'version' }, { key: 'actions', title: t('操作'), render: (_value, entry) => manage ? <Button disabled={saving} onClick={() => { setError(undefined); setRuleEditor(entry); }}>{t('编辑')}</Button> : t('只读') }]} />
    </Card>
    <Card title={t('岗位类别')} loading={loading}>
      {manage ? <Button disabled={saving} onClick={() => { setError(undefined); setCategoryEditor({}); }}>{t('新建')}</Button> : null}
      <LedgerTable ledgerId="configuration-position-categories" organizationId={organization.id} requiredColumnKeys={['code', 'actions']} rowKey="id" dataSource={categories} pagination={{ current: categoryPage, pageSize: categoryPageSize, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], disabled: saving, onChange: (page, size) => requestLeave(() => { setCategoryPage(size === categoryPageSize ? page : 1); setCategoryPageSize(size); }) }} columns={[{ key: 'code', title: t('代码'), dataIndex: 'code' }, { key: 'name', title: t('名称'), dataIndex: 'name' }, { key: 'sortOrder', title: t('排序'), dataIndex: 'sortOrder' }, { key: 'status', title: t('状态'), dataIndex: 'status', render: (value: string) => t(value === 'ACTIVE' ? '启用' : '停用') }, { key: 'actions', title: t('操作'), render: (_value, entry) => manage ? <Button disabled={saving} onClick={() => { setError(undefined); setCategoryEditor({ record: entry }); }}>{t('编辑')}</Button> : t('只读') }]} />
    </Card>
    <Modal destroyOnHidden open={!!ruleEditor} title={t('通知规则')} okButtonProps={{ htmlType: 'submit', form: 'notification-rule-editor' }} onCancel={() => { if (saving) return; requestLeave(() => { setRuleDirty(false); setRuleEditor(undefined); }); }} okText={t('保存')} cancelText={t('取消')} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }}>
      <GovernanceFeedback error={error} />
      <Typography.Paragraph>{t('报告编号')}: <code>{'{{reportNumber}}'}</code> · {t('名称')}: <code>{'{{nodeName}}'}</code> · {t('截止时间')}: <code>{'{{dueAt}}'}</code></Typography.Paragraph>
      {ruleEditor ? <Form key={`${ruleEditor.kind}:${ruleEditor.version}`} id="notification-rule-editor" name="notification-rule-editor" initialValues={ruleEditor} layout="vertical" onValuesChange={() => setRuleDirty(true)} onFinish={saveRule} disabled={saving}>
        <Form.Item name="enabled" label={t('发送站内通知')} valuePropName="checked"><Switch /></Form.Item>
        <Form.Item name="subjectTemplate" label={t('通知标题')} rules={[{ required: true, whitespace: true }]}><Input maxLength={255} /></Form.Item>
        <Form.Item name="bodyTemplate" label={t('通知正文')} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} maxLength={2000} /></Form.Item>
      </Form> : null}
    </Modal>
    <Modal destroyOnHidden open={!!categoryEditor} title={t('岗位类别')} okButtonProps={{ htmlType: 'submit', form: 'position-category-editor' }} onCancel={() => { if (saving) return; requestLeave(() => { setCategoryDirty(false); setCategoryEditor(undefined); }); }} okText={t('保存')} cancelText={t('取消')} confirmLoading={saving} cancelButtonProps={{ disabled: saving }} closable={!saving} keyboard={!saving} mask={{ closable: !saving }}>
      <GovernanceFeedback error={error} />{categoryEditor ? <Form key={`${categoryEditor.record?.id ?? 'new'}:${categoryEditor.record?.version ?? 0}`} id="position-category-editor" name="position-category-editor" initialValues={categoryEditor.record ?? { sortOrder: 0 }} layout="vertical" onValuesChange={() => setCategoryDirty(true)} onFinish={saveCategory} disabled={saving}>
        {!categoryEditor?.record ? <Form.Item name="code" label={t('代码')} rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ }]}><Input maxLength={64} /></Form.Item> : null}
        <Form.Item name="name" label={t('名称')} rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="sortOrder" label={t('排序')} rules={[{ required: true }]}><InputNumber min={0} max={10000} precision={0} /></Form.Item>
        {categoryEditor?.record ? <Form.Item name="status" label={t('状态')}><Select options={['ACTIVE', 'DISABLED'].map((value) => ({ value, label: t(value === 'ACTIVE' ? '启用' : '停用') }))} /></Form.Item> : null}
      </Form> : null}
    </Modal>
  </section>;
}
