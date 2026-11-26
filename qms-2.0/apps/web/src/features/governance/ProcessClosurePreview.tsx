import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Form, Modal, Select, Space, Typography } from 'antd';
import type { components } from '@qms/contracts';
import { ApiError, apiRequest, csrfToken } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { GovernanceFeedback } from './GovernanceFeedback';

type Input = components['schemas']['WorkflowClosurePreviewInputDto'];
type Result = components['schemas']['WorkflowClosurePreviewDto'];
type ClosureOptions = components['schemas']['WorkflowClosureOptionsDto'];
type WorkflowOptions = components['schemas']['WorkflowOptionsDto'];
type PersonOption = { value: string; label: string };
type Fields = Pick<Input, 'severity' | 'ownerUserId' | 'professionalUserId'>;
type Props = {
  departmentId: string; organizationId: string; disabled: boolean; owners: PersonOption[];
  ownersLoading: boolean; ownersError: unknown;
  onOpenChange: (open: boolean) => void; onSessionExpired: (error: unknown) => void;
};

export function ProcessClosurePreview({ departmentId, organizationId, disabled, owners, ownersLoading, ownersError, onOpenChange, onSessionExpired }: Props) {
  const { locale } = useLanguage();
  const text = (chinese: string, english: string) => locale === 'en-US' ? english : chinese;
  const title = text('制程 8D 关闭审核预览', 'Process 8D closure review preview');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<Fields>();
  const [search, setSearch] = useState('');
  const [professionals, setProfessionals] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [directoryError, setDirectoryError] = useState<unknown>();
  const [previewError, setPreviewError] = useState<unknown>();
  const [result, setResult] = useState<Result>();
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const term = search.trim();
    const searchParams = term ? { search: term } : undefined;
    const closureQuery = new URLSearchParams({ pageSize: '100', ...searchParams });
    const workflowQuery = new URLSearchParams({ limit: '100', ...searchParams });
    setLoading(true); setDirectoryError(undefined); setProfessionals([]);
    const init = { signal: controller.signal };
    void Promise.all([
      apiRequest<ClosureOptions>(`/api/v1/workflows/closure-options?${closureQuery}`, init),
      apiRequest<WorkflowOptions>(`/api/v1/workflows/options?${workflowQuery}`, init),
    ]).then(([closureOptions, workflowOptions]) => {
      if (controller.signal.aborted) return;
      const options = new Map(closureOptions.users.map(person => [person.id, personLabel(person)]));
      for (const person of workflowOptions.users) {
        if (!options.has(person.id)) options.set(person.id, person.name);
      }
      setProfessionals(Array.from(options, ([value, label]) => ({ value, label })));
    }).catch(cause => {
      if (!controller.signal.aborted) {
        setDirectoryError(cause);
        if (cause instanceof ApiError && cause.status === 401) onSessionExpired(cause);
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, search, retry, onSessionExpired]);

  async function load(fields: Fields) {
    if (request.current || disabled || !fields.ownerUserId) return;
    const controller = new AbortController();
    request.current = controller; setPending(true); setResult(undefined); setPreviewError(undefined);
    try {
      const input: Input = { ...fields, policy: 'INTERNAL', domainCode: 'process-quality', responsibleSectionDepartmentId: departmentId };
      const token = await csrfToken(controller.signal);
      controller.signal.throwIfAborted();
      const next = await apiRequest<Result>('/api/v1/workflows/closure-preview', {
        method: 'POST', headers: { 'x-csrf-token': token }, body: JSON.stringify(input), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (next.organizationId !== organizationId || next.sectionDepartmentId !== departmentId || !next.previewOnly) {
        throw new ApiError({ code: 'ORGANIZATION_SCOPE_DENIED', message: '' }, 403);
      }
      setResult(next);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setPreviewError(cause);
        if (cause instanceof ApiError && cause.status === 401) onSessionExpired(cause);
      }
    } finally {
      if (!controller.signal.aborted) { request.current = undefined; setPending(false); }
    }
  }

  function changeOpen(next: boolean) {
    if (request.current) return;
    if (!next) { form.resetFields(); setResult(undefined); setPreviewError(undefined); setSearch(''); }
    setOpen(next); onOpenChange(next);
  }

  const risk = text('风险等级', 'Risk level');
  const owner = text('问题负责人', 'Problem owner');
  const issuer = text('发单人（专业审核）', 'Issuer (professional review)');
  const professionalLabel = text('专业审核', 'Professional review');
  const managementLabel = text('管理审核', 'Management review');
  return <>
    <Button disabled={disabled} onClick={() => changeOpen(true)}>{title}</Button>
    <Modal open={open} destroyOnHidden title={title} onCancel={() => changeOpen(false)} footer={null} closable={!pending} keyboard={!pending} mask={{ closable: !pending }}>
      <Form<Fields> form={form} layout="vertical" initialValues={{ severity: 'LOW' }} disabled={pending || disabled} onValuesChange={() => { setResult(undefined); setPreviewError(undefined); }} onFinish={values => void load(values)}>
        <Form.Item label={risk} name="severity" rules={[{ required: true }]}><Select aria-label={risk} virtual={false} options={[
          { value: 'LOW', label: text('低', 'Low') }, { value: 'MEDIUM', label: text('中', 'Medium') }, { value: 'HIGH', label: text('高', 'High') }, { value: 'CRITICAL', label: text('重大', 'Critical') },
        ]} /></Form.Item>
        <Form.Item label={owner} name="ownerUserId" rules={[{ required: true }]}><Select aria-label={owner} aria-busy={ownersLoading} virtual={false} loading={ownersLoading} showSearch={{ optionFilterProp: 'label' }} options={owners} /></Form.Item>
        <GovernanceFeedback error={ownersError} />
        <Form.Item label={issuer} name="professionalUserId" rules={[{ required: true }]}><Select aria-label={issuer} virtual={false} loading={loading} showSearch={{ filterOption: false, onSearch: setSearch }} options={professionals} /></Form.Item>
        <GovernanceFeedback error={directoryError} retry={() => setRetry(value => value + 1)} />
        <Space><Button type="primary" htmlType="submit" loading={pending} disabled={disabled || ownersLoading || !!ownersError}>{text('生成预览', 'Run preview')}</Button></Space>
      </Form>
      <GovernanceFeedback error={previewError} />
      {result && <section aria-label={text('制程关闭审核预览结果', 'Process closure preview result')}>
        {result.issues.map(issue => <Alert key={`${issue.duty}:${issue.code}`} type="warning" showIcon title={issue.duty === 'OWNER' ? text('问题负责人不符合办理条件', 'The owner is not eligible') : text('发单人不符合专业审核条件', 'The issuer is not eligible for professional review')} />)}
        {result.duties.map(({ duty, participant, status }) => participant && <Typography.Paragraph key={duty}>
          {duty === 'PROFESSIONAL' ? professionalLabel : managementLabel}：{participant.fullName ? `${participant.fullName} (${participant.username})` : participant.username}
          {duty !== 'PROFESSIONAL' && ` · ${participant.scopeId ? text('下级部门分管', 'Subordinate coverage') : text('主负责人', 'Primary lead')}`}
          {status === 'SKIPPED_SAME_PERSON' && ` · ${text('同人，跳过管理审核', 'Same person; management review skipped')}`}
        </Typography.Paragraph>)}
        {result.managementNote && <Alert type="info" showIcon title={result.managementNote} />}
      </section>}
    </Modal>
  </>;
}

function personLabel(person: ClosureOptions['users'][number]) {
  return `${person.fullName ? `${person.fullName} (${person.username})` : person.username}${person.departmentName ? ` · ${person.departmentName}` : ''}`;
}
