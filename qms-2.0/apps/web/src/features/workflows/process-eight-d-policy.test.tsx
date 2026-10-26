import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { components } from '@qms/contracts';
import { LanguageProvider } from '../../i18n/Language';
import { WorkflowProperties } from './WorkflowProperties';

type Graph = components['schemas']['WorkflowGraphResponseDto'];
function Editor({ readOnly = false }: { readOnly?: boolean }) {
  const [graph, setGraph] = useState<Graph>({ nodes: [{ id: 'owner', type: 'ACTION', name: '负责人处理', config: { assignment: { roleCode: 'OLD' }, slaMinutes: 30, reminders: [{ offsetMinutes: 0 }], escalation: { roleCode: 'OLD' } } }], transitions: [] });
  return <LanguageProvider><WorkflowProperties graph={graph} selected="owner" readOnly={readOnly} options={{ roles: [], users: [], permissions: [] }} onChange={setGraph} onSelect={() => {}} /><output data-testid="graph">{JSON.stringify(graph)}</output></LanguageProvider>;
}
it('sets the controlled owner policy and explicitly disables reminders instead of generic SLA', () => {
  render(<Editor />); fireEvent.click(screen.getByLabelText('过程8D负责人处理'));
  const config = () => JSON.parse(screen.getByTestId('graph').textContent!).nodes[0].config;
  expect(config()).toEqual({ isStart: true, assignment: { permission: 'workflow:act' }, processEightD: { schemaVersion: 1, extensionPolicy: 'LEADER_THEN_PROFESSIONAL', reminderEveryHours: null } });
  expect(screen.queryByLabelText('处理范围 角色')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('处理时限（分钟）')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('8D提醒间隔（小时）'), { target: { value: '8760' } });
  expect(config().processEightD.reminderEveryHours).toBe(8760);
  fireEvent.change(screen.getByLabelText('8D提醒间隔（小时）'), { target: { value: '0' } });
  expect(config().processEightD.reminderEveryHours).toBe(8760);
  fireEvent.change(screen.getByLabelText('8D提醒间隔（小时）'), { target: { value: '' } });
  expect(config().processEightD.reminderEveryHours).toBeNull();
});
it('does not allow changing a published controlled policy', () => {
  render(<Editor readOnly />); expect(screen.getByLabelText('过程8D负责人处理')).toBeDisabled();
});
