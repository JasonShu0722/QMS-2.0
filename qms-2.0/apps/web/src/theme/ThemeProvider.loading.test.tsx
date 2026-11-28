import { render, screen } from '@testing-library/react';
import { Spin, Table } from 'antd';
import { expect, it } from 'vitest';
import { ThemeProvider } from './ThemeProvider';

it('applies the brand indicator to standalone, nested and table loading', () => {
  const { container } = render(<ThemeProvider>
    <Spin aria-label="Page loading" />
    <Spin aria-label="Region loading"><p>Current content</p></Spin>
    <Table loading columns={[{ title: 'Name', dataIndex: 'name' }]} dataSource={[]} />
    <Spin spinning={false}><p>Ready content</p></Spin>
  </ThemeProvider>);

  expect(container.querySelectorAll('[data-qms-loading-mark]')).toHaveLength(3);
  expect(screen.getAllByText('正在加载')).toHaveLength(3);
  expect(screen.getByLabelText('Page loading')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByLabelText('Region loading')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('Current content')).toBeInTheDocument();
  expect(screen.getByText('Ready content')).toBeInTheDocument();
});
