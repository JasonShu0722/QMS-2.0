import { useMemo, useState } from 'react';
import { Drawer, Empty, Input, Space, Tag, Typography } from 'antd';
import { permissionLabel, useLanguage } from '../../i18n/Language';
import type { AdminRole, PermissionCatalogGroup } from './admin';

type RolePermission = AdminRole['permissions'][number];

type PermissionEntry = {
  code: string;
  groupKey: string;
  groupName: string;
  moduleKey: string;
  moduleName: string;
  operationName: string;
};

export function permissionSummary(permissions: RolePermission[], catalog: PermissionCatalogGroup[], locale: 'zh-CN' | 'en-US') {
  const unique = [...new Map(permissions.map((permission) => [permission.code, permission])).values()];
  const modules: string[] = [];
  for (const permission of unique) {
    const match = catalog.flatMap((group) => group.modules.flatMap((module) => module.operations.map((operation) => ({ group, module, operation })))).find(({ operation }) => operation.code === permission.code);
    const name = match ? permissionLabel(locale, 'module', match.module.key, match.module.name) : permission.name || permission.code;
    if (!modules.includes(name)) modules.push(name);
  }
  return { count: unique.length, modules: modules.slice(0, 2) };
}

function permissionEntries(permissions: RolePermission[], catalog: PermissionCatalogGroup[], locale: 'zh-CN' | 'en-US', fallbackGroup: string) {
  const unique = [...new Map(permissions.map((permission) => [permission.code, permission])).values()];
  return unique.map<PermissionEntry>((permission) => {
    const match = catalog.flatMap((group) => group.modules.flatMap((module) => module.operations.map((operation) => ({ group, module, operation })))).find(({ operation }) => operation.code === permission.code);
    if (!match) return { code: permission.code, groupKey: 'unmatched', groupName: fallbackGroup, moduleKey: permission.code, moduleName: permission.name || permission.code, operationName: permission.name || permission.code };
    return {
      code: permission.code,
      groupKey: match.group.key,
      groupName: permissionLabel(locale, 'group', match.group.key, match.group.name),
      moduleKey: match.module.key,
      moduleName: permissionLabel(locale, 'module', match.module.key, match.module.name),
      operationName: permissionLabel(locale, 'operation', match.operation.code, match.operation.name),
    };
  });
}

export function RolePermissionDetails({ open, role, catalog, onClose, afterClose }: {
  open: boolean;
  role?: AdminRole;
  catalog: PermissionCatalogGroup[];
  onClose: () => void;
  afterClose?: () => void;
}) {
  const { t, locale } = useLanguage();
  const [search, setSearch] = useState('');
  const entries = useMemo(() => permissionEntries(role?.permissions ?? [], catalog, locale, t('权限')), [catalog, locale, role, t]);
  const query = search.trim().toLocaleLowerCase();
  const groups = entries.reduce<{ key: string; name: string; modules: { key: string; name: string; entries: PermissionEntry[] }[] }[]>((result, entry) => {
    const group = result.find((item) => item.key === entry.groupKey) ?? (() => {
      const next = { key: entry.groupKey, name: entry.groupName, modules: [] as { key: string; name: string; entries: PermissionEntry[] }[] };
      result.push(next);
      return next;
    })();
    const module = group.modules.find((item) => item.key === entry.moduleKey) ?? (() => {
      const next = { key: entry.moduleKey, name: entry.moduleName, entries: [] as PermissionEntry[] };
      group.modules.push(next);
      return next;
    })();
    module.entries.push(entry);
    return result;
  }, []).map((group) => ({ ...group, modules: group.modules.map((module) => ({ ...module, entries: module.entries.filter((entry) => !query || [entry.groupName, entry.moduleName, entry.operationName, entry.code].some((value) => value.toLocaleLowerCase().includes(query))) })).filter((module) => module.entries.length > 0) })).filter((group) => group.modules.length > 0);

  return <Drawer open={open} title={role ? `${role.name} · ${t('详情')}` : t('详情')} onClose={onClose} afterOpenChange={(visible) => { if (!visible) { setSearch(''); afterClose?.(); } }} destroyOnHidden>
    <Input aria-label={t('搜索权限')} placeholder={t('搜索模块、权限名称或代码')} value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
    {!groups.length ? <Empty description={t('无匹配权限')} /> : groups.map((group) => <section className="permission-group" key={group.key}>
      <Typography.Title level={4}>{group.name}</Typography.Title>
      {group.modules.map((module) => <section className="permission-module" key={module.key} aria-label={module.name}>
        <Typography.Text strong>{module.name}</Typography.Text>
        <Space orientation="vertical" size={4}>
          {module.entries.map((entry) => <div className="permission-operation" key={entry.code}><Typography.Text>{entry.operationName}</Typography.Text> <Tag>{entry.code}</Tag></div>)}
        </Space>
      </section>)}
    </section>)}
  </Drawer>;
}
