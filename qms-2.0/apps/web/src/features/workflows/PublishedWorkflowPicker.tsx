import type { components } from '@qms/contracts';
import { Button, Select, Space, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../../api/client';
import { useWorkTabsStore } from '../../work-tabs/workTabsStore';
import { getWorkflow, getWorkflows, getWorkflowVersion, type WorkflowGraph } from './workflow-api';

type Binding = Pick<components['schemas']['StartSupplierPcnWorkflowDto'], 'workflowDefinitionId' | 'workflowVersionId'>;
type PickerProps = {
  organizationId: string;
  kind: 'audit-import' | 'supplier-pcn';
  disabled: boolean;
  onSelect: (binding: Binding) => void;
};
type Option = Binding & { label: string; value: string };
type Lookup = { status: 'loading' | 'denied' | 'error' } | { status: 'ready'; options: Option[] };

function eligible({ nodes, transitions }: WorkflowGraph, kind: PickerProps['kind']) {
  const starts = nodes.filter(node => node.config?.isStart === true);
  const start = starts[0];
  if (starts.length !== 1 || !start || start.type === 'CLOSE' || Object.hasOwn(start.config ?? {}, 'closureReview')
    || nodes.some(({ config = {} }) => Object.hasOwn(config, 'processEightD') || Object.hasOwn(config, 'supplierEightD'))) return false;
  if (kind === 'audit-import') return true;

  const approval = nodes.find(node => node.type === 'APPROVAL');
  const close = nodes.find(node => node.type === 'CLOSE' && node.config?.isEnd === true);
  const hasEdge = (from: string, to: string, action: components['schemas']['WorkflowAction']) =>
    transitions.some(edge => edge.from === from && edge.to === to && edge.action === action);
  return nodes.length === 3 && transitions.length === 3 && start.type === 'ACTION'
    && start.config?.assignment?.permission === 'supplier-pcn:submissions:write'
    && approval?.config?.assignment?.permission === 'supplier-pcn:requests:approve'
    && close?.config?.assignment?.permission === 'supplier-pcn:requests:approve'
    && hasEdge(start.id, approval.id, 'SUBMIT') && hasEdge(approval.id, close.id, 'APPROVE')
    && hasEdge(approval.id, start.id, 'RETURN');
}

async function loadOptions(organizationId: string, kind: PickerProps['kind'], signal: AbortSignal): Promise<Lookup> {
  const access = await apiRequest<components['schemas']['PermissionsResponseDto']>('/api/v1/system/my-permissions', { signal });
  signal.throwIfAborted();
  if (access.organizationId !== organizationId || !access.permissions.includes('workflow:manage')) return { status: 'denied' };

  const options = new Map<string, Option>();
  const pageSize = 100;
  for (let offset = 0; offset <= 10000; offset += pageSize) {
    const page = await getWorkflows(new URLSearchParams({ pageSize: String(pageSize), offset: String(offset) }), signal);
    signal.throwIfAborted();
    const histories = await Promise.all(page.items.filter(item => item.organizationId === organizationId).map(async item => {
      const definition = await getWorkflow(item.id, signal);
      return definition.id === item.id && definition.organizationId === organizationId ? definition : undefined;
    }));
    signal.throwIfAborted();
    for (const definition of histories) {
      if (!definition) continue;
      for (const version of definition.versions) {
        if (version.status !== 'PUBLISHED' || version.workflowDefinitionId !== definition.id || options.has(version.id)) continue;
        const snapshot = await getWorkflowVersion(definition.id, version.id, signal);
        signal.throwIfAborted();
        if (snapshot.id !== definition.id || snapshot.organizationId !== organizationId || snapshot.version.id !== version.id
          || snapshot.version.workflowDefinitionId !== definition.id || snapshot.version.status !== 'PUBLISHED'
          || !eligible(snapshot.version.structureSnapshot, kind)) continue;
        options.set(version.id, { value: version.id, label: `${definition.name} · ${definition.code} · v${version.version}`, workflowDefinitionId: definition.id, workflowVersionId: version.id });
      }
    }
    if (offset + page.items.length >= page.total) return { status: 'ready', options: [...options.values()] };
    if (page.items.length < pageSize) break;
  }
  return { status: 'error' };
}

export function PublishedWorkflowPicker(props: PickerProps) {
  const session = useWorkTabsStore(state => state.sessionScope);
  return <ScopedPicker key={JSON.stringify([session, props.organizationId, props.kind])} {...props} />;
}

function ScopedPicker({ organizationId, kind, disabled, onSelect }: PickerProps) {
  const [lookup, setLookup] = useState<Lookup>();
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);

  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const session = useWorkTabsStore.getState().sessionScope;
    const unsubscribe = useWorkTabsStore.subscribe(state => { if (state.sessionScope !== session) controller.abort(); });
    setLookup({ status: 'loading' });
    try {
      const result = await loadOptions(organizationId, kind, controller.signal);
      if (!controller.signal.aborted) setLookup(result);
    } catch (cause) {
      if (!controller.signal.aborted) setLookup({ status: cause instanceof ApiError && (cause.status === 401 || cause.status === 403) ? 'denied' : 'error' });
    } finally {
      unsubscribe();
    }
  }

  return <Space orientation="vertical" style={{ width: '100%' }}>
    <Button disabled={disabled} loading={lookup?.status === 'loading'} onClick={() => void load()}>查找已发布流程</Button>
    {lookup?.status === 'ready' && lookup.options.length > 0 ? <Select<string, Option>
      aria-label="已发布流程版本" placeholder="选择已发布流程版本" value={null} options={lookup.options}
      disabled={disabled} showSearch={{ optionFilterProp: 'label' }} style={{ width: '100%' }}
      onChange={(_, option) => { if (option && !Array.isArray(option)) onSelect({ workflowDefinitionId: option.workflowDefinitionId, workflowVersionId: option.workflowVersionId }); }}
    /> : null}
    <Typography.Text type="secondary" role="status">
      {lookup?.status === 'denied' ? '无法查看当前组织的流程版本，可手动填写 ID。'
        : lookup?.status === 'error' ? '流程版本加载失败，可重试或手动填写 ID。'
        : lookup?.status === 'ready' && !lookup.options.length ? '当前组织没有可用的已发布流程版本，可手动填写 ID。' : null}
    </Typography.Text>
  </Space>;
}
