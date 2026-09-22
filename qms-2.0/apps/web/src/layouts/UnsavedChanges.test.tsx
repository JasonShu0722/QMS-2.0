import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Link, useLocation } from 'react-router-dom';
import { beforeEach, expect, it } from 'vitest';
import { UnsavedChangesProvider, useUnsavedChanges } from './UnsavedChanges';
import { WorkTabs } from '../work-tabs/WorkTabs';
import { useWorkTabsStore } from '../work-tabs/workTabsStore';

beforeEach(() => useWorkTabsStore.getState().reset());
function Editor() {
  const location = useLocation();
  useUnsavedChanges(location.pathname === '/app/edit');
  return <><output aria-label="path">{location.pathname}</output><Link to="/app/next">下一页</Link><WorkTabs /></>;
}
it('keeps edits when leaving is cancelled and leaves only after discard', async () => {
  render(<MemoryRouter initialEntries={['/app/edit']}><UnsavedChangesProvider><Editor /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('link', { name: '下一页' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
  expect(screen.getByLabelText('path')).toHaveTextContent('/app/edit');
  fireEvent.click(screen.getByRole('link', { name: '下一页' }));
  fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }));
  expect(screen.getByLabelText('path')).toHaveTextContent('/app/next');
});
it('closing an inactive page does not navigate away from an unsaved active editor', () => {
  const store = useWorkTabsStore.getState();
  store.openTab({ id: 'other', path: '/app/other', title: 'Other' });
  store.openTab({ id: 'edit', path: '/app/edit', title: 'Edit' });
  render(<MemoryRouter initialEntries={['/app/edit']}><UnsavedChangesProvider><Editor /></UnsavedChangesProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: '关闭 Other' }));
  expect(screen.getByLabelText('path')).toHaveTextContent('/app/edit');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('sizes overflow to the available width and isolates restored pages by identity', () => {
  const store = useWorkTabsStore.getState();
  store.bindSession('INTERNAL:org:a');
  for (let i = 0; i < 8; i++) store.openTab({ id: `${i}`, title: `Page ${i}`, path: `/app/page/${i}` });
  store.setStripWidth(320);
  expect(useWorkTabsStore.getState().visibleTabs.map(tab => tab.id)).toEqual(['7']);
  store.setStripWidth(1200);
  expect(useWorkTabsStore.getState().visibleTabs.length).toBeGreaterThan(1);
  store.bindSession('INTERNAL:org:b');
  expect(useWorkTabsStore.getState().tabs).toEqual([]);
  expect(sessionStorage.getItem('qms:work-pages:v1')).not.toContain('Page');
});
