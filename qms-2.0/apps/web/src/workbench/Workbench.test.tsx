import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/Language';
import { Workbench } from './Workbench';

afterEach(() => localStorage.clear());

const locales = [
  {
    locale: 'zh-CN', workbench: '综合工作台', tasks: '我的待办',
    problems: '问题中心', account: '个人账号', duplicate: '处理我的待办',
    overview: '质量概览', planned: '待接入',
    slogan: '从待办开始，推进每一项质量改进。',
    unavailable: '统计尚未接入，当前不展示汇总数值。请从待办或问题中心查看实际记录。',
  },
  {
    locale: 'en-US', workbench: 'Workbench', tasks: 'My tasks',
    problems: 'Problem center', account: 'My account', duplicate: 'Open my tasks',
    overview: 'Quality overview', planned: 'Planned',
    slogan: 'Start with your tasks and move quality improvements forward.',
    unavailable: 'Summary metrics are not yet available. View actual records in My tasks or Problem center.',
  },
];

it.each(locales)('keeps one task card linking to My tasks in $locale', (copy) => {
  localStorage.setItem('qms:locale:v1', copy.locale);
  render(<MemoryRouter><LanguageProvider><Workbench /></LanguageProvider></MemoryRouter>);
  const workbench = within(screen.getByRole('region', { name: copy.workbench }));
  const taskLinks = workbench.getAllByRole('link').filter((link) => link.getAttribute('href') === '/app/my-tasks');

  expect(taskLinks).toHaveLength(1);
  expect(taskLinks[0]).toHaveAccessibleName(copy.tasks);
  expect(workbench.getByRole('link', { name: copy.problems })).toHaveAttribute('href', '/app/problem-center');
  expect(workbench.getByRole('link', { name: copy.account })).toHaveAttribute('href', '/app/account');
  expect(workbench.getByRole('heading', { level: 1, name: copy.workbench })).toHaveClass('sr-only');
  expect(within(taskLinks[0]!).getByText(copy.tasks)).toBeVisible();
  expect(workbench.queryByRole('link', { name: copy.duplicate })).not.toBeInTheDocument();
  expect(workbench.queryByText(copy.slogan)).not.toBeInTheDocument();
});

it.each(locales)('explains that overview metrics are unavailable in $locale', (copy) => {
  localStorage.setItem('qms:locale:v1', copy.locale);
  render(<MemoryRouter><LanguageProvider><Workbench /></LanguageProvider></MemoryRouter>);
  const overview = within(screen.getByRole('region', { name: copy.overview }));

  expect(overview.getByText(copy.unavailable)).toBeVisible();
  expect(overview.getAllByText(copy.planned).length).toBeGreaterThan(0);
});
