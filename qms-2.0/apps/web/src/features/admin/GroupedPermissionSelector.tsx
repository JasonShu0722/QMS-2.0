import { useState } from 'react';
import { permissionLabel, useLanguage } from '../../i18n/Language';
import { Button, Checkbox, Empty, Input, Select, Space, Tag, Typography } from 'antd';
import type { PermissionCatalogGroup } from './admin';

export function GroupedPermissionSelector({ catalog, value = [], onChange, disabled = false }: {
  catalog: PermissionCatalogGroup[];
  value?: string[];
  onChange?: (codes: string[]) => void;
  disabled?: boolean;
}) {
  const { t, locale } = useLanguage();
  const [groupKey, setGroupKey] = useState('all');
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const selected = new Set(value);
  const groups = catalog.filter((group) => groupKey === 'all' || group.key === groupKey).map((group) => ({
    ...group,
    modules: group.modules.map((module) => ({
      ...module,
      operations: module.operations.filter((operation) => !query || permissionLabel(locale, 'module', module.key, module.name).toLocaleLowerCase().includes(query) || permissionLabel(locale, 'operation', operation.code, operation.name).toLocaleLowerCase().includes(query) || operation.code.toLocaleLowerCase().includes(query)),
    })).filter((module) => !query || permissionLabel(locale, 'module', module.key, module.name).toLocaleLowerCase().includes(query) || module.operations.length > 0),
  })).filter((group) => group.modules.length > 0);
  function change(codes: string[], checked: boolean) {
    if (disabled) return;
    const next = new Set(value);
    for (const code of codes) { if (checked) next.add(code); else next.delete(code); }
    onChange?.([...next]);
  }
  return <div className="permission-selector">
    <div className="admin-toolbar"><Space wrap>
      <Select virtual={false} aria-label={t('板块筛选')} value={groupKey} onChange={setGroupKey} options={[{ value: 'all', label: t('全部板块') }, ...catalog.map((group) => ({ value: group.key, label: permissionLabel(locale, 'group', group.key, group.name) }))]} />
      <Input aria-label={t('搜索权限')} placeholder={t('搜索模块、权限名称或代码')} value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
    </Space></div>
    {!groups.length && <Empty description={t('无匹配权限')} />}
    {groups.map((group) => <section className="permission-group" key={group.key}>
      <Typography.Title level={4}>{permissionLabel(locale, 'group', group.key, group.name)}</Typography.Title>
      {group.modules.map((module) => {
        const planned = group.status === 'planned' || module.status === 'planned';
        const assignable = planned ? [] : module.operations.filter((operation) => operation.grantable).map((operation) => operation.code);
        const selectedCount = assignable.filter((code) => selected.has(code)).length;
        return <section className="permission-module" key={module.key} aria-label={permissionLabel(locale, 'module', module.key, module.name)}>
          <header>{planned ? <strong>{permissionLabel(locale, 'module', module.key, module.name)}</strong> : <Checkbox aria-label={`${permissionLabel(locale, 'module', module.key, module.name)} · ${t('可授予权限')}`} checked={assignable.length > 0 && selectedCount === assignable.length} indeterminate={selectedCount > 0 && selectedCount < assignable.length} disabled={disabled || !assignable.length} onChange={(event) => change(assignable, event.target.checked)}><strong>{permissionLabel(locale, 'module', module.key, module.name)}</strong></Checkbox>}{planned ? <Tag>{t('待接入')}</Tag> : <Space>
            <Button size="small" aria-label={`${permissionLabel(locale, 'module', module.key, module.name)} ${t('全选')}`} disabled={disabled || !assignable.length} onClick={() => change(assignable, true)}>{t('全选')}</Button>
            <Button size="small" aria-label={`${permissionLabel(locale, 'module', module.key, module.name)} ${t('清空')}`} disabled={disabled || !assignable.length} onClick={() => change(assignable, false)}>{t('清空')}</Button>
          </Space>}</header>
          {!planned && <div className="permission-operations">{module.operations.map((operation) => <div className="permission-operation" key={operation.code}>
            <Checkbox aria-label={`${permissionLabel(locale, 'module', module.key, module.name)} · ${permissionLabel(locale, 'operation', operation.code, operation.name)}`} checked={selected.has(operation.code)} disabled={disabled || !operation.grantable} onChange={(event) => change([operation.code], event.target.checked)}>{permissionLabel(locale, 'operation', operation.code, operation.name)}</Checkbox>
            <code>{operation.code}</code>
            {operation.enforcement === 'reserved' && <Tag>{t('预留权限')}</Tag>}
          </div>)}</div>}
        </section>;
      })}
    </section>)}
  </div>;
}
