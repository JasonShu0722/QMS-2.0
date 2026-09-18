import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InternalLayout } from '../../layouts/InternalLayout';
import { SupplierLayout } from '../../layouts/SupplierLayout';

describe('portal navigation', () => {
  it('shows the internal workbench with full domain navigation', () => {
    render(
      <MemoryRouter initialEntries={['/app/workbench']}>
        <InternalLayout />
      </MemoryRouter>,
    );

    for (const label of ['问题中心', '流程设计', '供应商质量', '审计管理', '体系文件', '风险看板']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText('个人待办')).toBeInTheDocument();
    expect(screen.getByText('待审批')).toBeInTheDocument();
    expect(screen.getByText('即将逾期')).toBeInTheDocument();
    expect(screen.getByText('高风险')).toBeInTheDocument();
    expect(screen.getByText('关键指标')).toBeInTheDocument();
    expect(screen.getAllByText('待接入')).toHaveLength(5);
    expect(screen.queryByText('12')).not.toBeInTheDocument();
    expect(screen.queryByText('5')).not.toBeInTheDocument();
    expect(screen.queryByText('98.6%')).not.toBeInTheDocument();
  });

  it('collapses to an icon rail and exposes the active domain context menu', () => {
    render(
      <MemoryRouter initialEntries={['/app/problem-center']}>
        <InternalLayout />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('内部领域图标导航')).toBeInTheDocument();
    expect(screen.getByText('问题中心上下文')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CAPA' })).toBeInTheDocument();
  });

  it('uses an independent supplier portal entry set', () => {
    render(
      <MemoryRouter initialEntries={['/supplier/inbox']}>
        <SupplierLayout />
      </MemoryRouter>,
    );

    for (const label of ['待办', '整改', '资料', '绩效', '账号']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('link', { name: '问题中心' })).not.toBeInTheDocument();
  });
});
