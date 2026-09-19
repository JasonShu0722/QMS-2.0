import { useState } from 'react';
import { Button, Checkbox, Empty, Input, Select, Space, Tag, Typography } from 'antd';
import type { PermissionCatalogGroup } from './admin';

export function GroupedPermissionSelector({ catalog, value = [], onChange, disabled = false }: {
  catalog: PermissionCatalogGroup[];
  value?: string[];
  onChange?: (codes: string[]) => void;
  disabled?: boolean;
}) {
  const [groupKey, setGroupKey] = useState('all');
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const selected = new Set(value);
  const groups = catalog.filter((group) => groupKey === 'all' || group.key === groupKey).map((group) => ({
    ...group,
    modules: group.modules.map((module) => ({
      ...module,
      operations: module.operations.filter((operation) => !query || module.name.toLocaleLowerCase().includes(query) || operation.name.toLocaleLowerCase().includes(query) || operation.code.toLocaleLowerCase().includes(query)),
    })).filter((module) => !query || module.name.toLocaleLowerCase().includes(query) || module.operations.length > 0),
  })).filter((group) => group.modules.length > 0);
  function change(codes: string[], checked: boolean) {
    if (disabled) return;
    const next = new Set(value);
    for (const code of codes) { if (checked) next.add(code); else next.delete(code); }
    onChange?.([...next]);
  }
  return <div className="permission-selector">
    <div className="admin-toolbar"><Space wrap>
      <Select aria-label="板块筛选" value={groupKey} onChange={setGroupKey} options={[{ value: 'all', label: '全部板块' }, ...catalog.map((group) => ({ value: group.key, label: group.name }))]} />
      <Input aria-label="搜索权限" placeholder="搜索模块、权限名称或代码" value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
    </Space></div>
    {!groups.length && <Empty description="无匹配权限" />}
    {groups.map((group) => <section className="permission-group" key={group.key}>
      <Typography.Title level={4}>{group.name}</Typography.Title>
      {group.modules.map((module) => {
        const planned = group.status === 'planned' || module.status === 'planned';
        const assignable = planned ? [] : module.operations.filter((operation) => operation.grantable).map((operation) => operation.code);
        return <section className="permission-module" key={module.key} aria-label={module.name}>
          <header><strong>{module.name}</strong>{planned ? <Tag>待接入</Tag> : <Space>
            <Button size="small" aria-label={`${module.name}全选`} disabled={disabled || !assignable.length} onClick={() => change(assignable, true)}>全选</Button>
            <Button size="small" aria-label={`${module.name}清空`} disabled={disabled || !assignable.length} onClick={() => change(assignable, false)}>清空</Button>
          </Space>}</header>
          {!planned && <div className="permission-operations">{module.operations.map((operation) => <div className="permission-operation" key={operation.code}>
            <Checkbox aria-label={`${module.name} · ${operation.name}`} checked={selected.has(operation.code)} disabled={disabled || !operation.grantable} onChange={(event) => change([operation.code], event.target.checked)}>{operation.name}</Checkbox>
            <code>{operation.code}</code>
            {operation.enforcement === 'reserved' && <Tag>预留权限</Tag>}
          </div>)}</div>}
        </section>;
      })}
    </section>)}
  </div>;
}
