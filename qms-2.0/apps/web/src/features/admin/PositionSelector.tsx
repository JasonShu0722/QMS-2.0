import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Select, Space, Tag, Typography } from 'antd';
import { safeAccountError } from '../../api/client';
import { useLanguage } from '../../i18n/Language';
import { loadPositionDirectory, previewPositions, type AuthorizationPreview, type PositionDirectory } from './position-authorization';

type Props = {
  organizationId: string; value: string[]; onChange: (value: string[]) => void;
  preview?: AuthorizationPreview; onPreviewChange: (preview: AuthorizationPreview | undefined) => void;
  targetUserId?: string; disabled?: boolean; allowEmpty?: boolean; directory?: PositionDirectory;
};

export function PositionSelector({ organizationId, value, onChange, preview, onPreviewChange, targetUserId, disabled = false, allowEmpty = false, directory: suppliedDirectory }: Props) {
  const { t } = useLanguage();
  const [directory, setDirectory] = useState<PositionDirectory>();
  const [loading, setLoading] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const alive = useRef(false);
  const identity = JSON.stringify([organizationId, targetUserId, [...value].sort()]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; setPreviewBusy(false); setError(undefined); }, [identity]);
  useEffect(() => {
    if (suppliedDirectory) { setDirectory(suppliedDirectory); return; }
    let active = true;
    const controller = new AbortController();
    setDirectory(undefined); setLoading(true); setError(undefined);
    void loadPositionDirectory(organizationId, controller.signal).then(result => { if (active) setDirectory(result); })
      .catch(cause => { if (active) setError(safeAccountError(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [organizationId, suppliedDirectory, revision]);
  async function loadPreview() {
    if (disabled || loading || previewBusy || (!allowEmpty && !value.length) || value.length > 100) return;
    const request = ++generation.current;
    setPreviewBusy(true); setError(undefined); onPreviewChange(undefined);
    try {
      const result = await previewPositions(organizationId, value, targetUserId);
      if (alive.current && request === generation.current && currentIdentity.current === identity) onPreviewChange(result);
    } catch (cause) { if (alive.current && request === generation.current && currentIdentity.current === identity) setError(safeAccountError(cause)); }
    finally { if (alive.current && request === generation.current && currentIdentity.current === identity) setPreviewBusy(false); }
  }
  return <Space orientation="vertical" className="admin-form-stack">
    <Select aria-label={t('任职岗位')} mode="multiple" maxCount={100} value={value} loading={loading} disabled={disabled || loading || !directory} optionFilterProp="label"
      options={directory?.departments.map(department => ({ label: department.name, options: directory.positions.filter(position => position.departmentId === department.id).map(position => ({ value: position.id, label: `${position.name} · ${position.code}`, disabled: position.status !== 'ACTIVE' || department.status !== 'ACTIVE' })) }))}
      onChange={selected => { generation.current++; onPreviewChange(undefined); onChange(selected); }} />
    {!loading && directory && !directory.positions.some(position => position.status === 'ACTIVE' && directory.departments.some(department => department.id === position.departmentId && department.status === 'ACTIVE')) && <Alert showIcon type="warning" title={t('当前组织没有可用岗位')} />}
    {error && <Alert showIcon type="error" title={t(error)} action={!directory ? <Button onClick={() => setRevision(value => value + 1)}>{t('重试')}</Button> : undefined} />}
    <Button disabled={disabled || loading || !directory || (!allowEmpty && !value.length)} loading={previewBusy} onClick={() => void loadPreview()}>{t('预览授权')}</Button>
    {preview && <section aria-label={t('权限预览')}>
      {preview.positions.map(position => <div key={position.id}>
        <Typography.Text strong>{position.department.name} · {position.name}</Typography.Text>
        {!position.permissionCodes.length && !position.historicalSources.some(source => source.permissionCodes.length) && <Alert showIcon type="warning" title={t('该岗位未配置系统权限')} />}
        {position.historicalSources.map(source => <Typography.Paragraph key={source.roleId}>{t('历史兼容授权')} · {source.name} · {source.permissionCodes.join(', ') || t('无系统权限')}</Typography.Paragraph>)}
      </div>)}
      <Typography.Paragraph>{t('有效权限')}：{preview.effectivePermissionCodes.map(code => <Tag key={code}>{code}</Tag>)}{!preview.effectivePermissionCodes.length && t('无系统权限')}</Typography.Paragraph>
      <Typography.Paragraph>{t('MFA 要求')}：{t(preview.effectiveMfaRequired ? '需要 MFA' : '不要求 MFA')}</Typography.Paragraph>
      {!!preview.retainedSources?.length && <><Typography.Text strong>{t('仍保留的历史授权来源')}</Typography.Text>{preview.retainedSources.map(source => <Typography.Paragraph key={source.roleId}>{source.name} · {source.permissionCodes.join(', ') || t('无系统权限')}</Typography.Paragraph>)}</>}
    </section>}
  </Space>;
}
