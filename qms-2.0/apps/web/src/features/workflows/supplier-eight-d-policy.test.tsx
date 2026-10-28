import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { WorkflowProperties } from './WorkflowProperties';
import type { WorkflowGraph } from './workflow-api';

const initial: WorkflowGraph = { nodes: [
  { id: 'owner', type: 'ACTION', name: '供应商处理', config: { assignment: { roleCode: 'OLD' }, slaMinutes: 30, reminders: [{ offsetMinutes: 0 }], escalation: { roleCode: 'OLD' } } },
  { id: 'other', type: 'ACTION', name: '原起点', config: { isStart: true } },
  { id: 'review', type: 'APPROVAL', name: '审核', config: { closureReview: { schemaVersion: 1, policy: 'INTERNAL', domainCode: 'customer-quality' } } },
], transitions: [] };
function Editor({ readOnly = false, graph: source = initial }: { readOnly?: boolean; graph?: WorkflowGraph }) {
  const [graph, setGraph] = useState(source);
  const [selected, select] = useState('owner');
  return <LanguageProvider><button onClick={() => select('review')}>审核属性</button><button onClick={() => select('other')}>其他属性</button><WorkflowProperties graph={graph} selected={selected} readOnly={readOnly} options={{ roles: [], users: [], permissions: [] }} onChange={setGraph} onSelect={select} /><output data-testid="graph">{JSON.stringify(graph)}</output></LanguageProvider>;
}
const graph = (): WorkflowGraph => JSON.parse(screen.getByTestId('graph').textContent!);
it('sets a unique supplier owner with fixed responses permission and no generic SLA, without rewriting closure rules', () => {
  render(<Editor />);
  fireEvent.click(screen.getByLabelText('供应商8D负责人处理'));
  expect(graph().nodes[0].config).toEqual({ isStart: true, assignment: { permission: 'supplier-quality:responses:write' }, supplierEightD: { schemaVersion: 1, reminderEveryHours: null } });
  expect(graph().nodes[1].config?.isStart).toBe(false);
  expect(graph().nodes[2].config?.closureReview?.domainCode).toBe('customer-quality');
  expect(screen.getByLabelText('过程8D负责人处理')).toBeDisabled();
  expect(screen.getByLabelText('节点类型')).toBeDisabled();
  expect(screen.queryByLabelText('处理范围 角色')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('处理时限（分钟）')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: '新名称' } });
  fireEvent.change(screen.getByLabelText('节点类型'), { target: { value: 'APPROVAL' } });
  expect(graph().nodes[0].config?.supplierEightD).toEqual({ schemaVersion: 1, reminderEveryHours: null });
  expect(graph().nodes[0].type).toBe('ACTION');
  fireEvent.click(screen.getByText('其他属性'));
  expect(screen.getByLabelText('起始节点')).toBeDisabled();
  expect(screen.getByLabelText('供应商8D负责人处理')).toBeDisabled();
});
it('accepts only null or integer reminder hours in 1..8760', () => {
  render(<Editor />); fireEvent.click(screen.getByLabelText('供应商8D负责人处理'));
  const input = screen.getByLabelText('供应商8D提醒间隔（小时）');
  fireEvent.change(input, { target: { value: '8760' } });
  for (const value of ['0', '-1', '1.5', '8761']) {
    fireEvent.change(input, { target: { value } });
    expect(graph().nodes[0].config?.supplierEightD?.reminderEveryHours).toBe(8760);
  }
  fireEvent.change(input, { target: { value: '' } });
  expect(graph().nodes[0].config?.supplierEightD?.reminderEveryHours).toBeNull();
});
it('changes only the explicitly selected closure policy to the precise supplier domain', () => {
  render(<Editor />); fireEvent.click(screen.getByText('审核属性'));
  fireEvent.change(screen.getByLabelText('关闭审核策略'), { target: { value: 'SUPPLIER' } });
  expect(graph().nodes[2].config?.closureReview).toEqual({ schemaVersion: 1, policy: 'SUPPLIER', domainCode: 'supplier-quality' });
});
it('keeps a published supplier marker read-only', () => {
  render(<Editor readOnly graph={{ ...initial, nodes: [{ ...initial.nodes[0], config: { isStart: true, assignment: { permission: 'supplier-quality:responses:write' }, supplierEightD: { schemaVersion: 1, reminderEveryHours: null } } }] }} />);
  expect(screen.getByLabelText('供应商8D负责人处理')).toBeDisabled();
  expect(screen.getByLabelText('供应商8D提醒间隔（小时）')).toBeDisabled();
});
it('does not introduce a supplier marker into a graph with a process owner on another node', () => {
  render(<Editor graph={{ ...initial, nodes: initial.nodes.map(node => node.id === 'other' ? { ...node, config: { isStart: true, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null } } } : node) }} />);
  expect(screen.getByLabelText('供应商8D负责人处理')).toBeDisabled();
});
