import { ConfigProvider } from 'antd';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { WorkflowClosurePreview } from './WorkflowClosurePreview';

function setup() {
  render(<LanguageProvider><ThemeProvider><ConfigProvider theme={{ token: { motion: false } }}>
    <WorkflowClosurePreview />
  </ConfigProvider></ThemeProvider></LanguageProvider>);
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const select = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));
const current = () => screen.getByRole('region', { name: '当前轮' });
const duty = (name: string) => within(current()).getByRole('group', { name });

describe('workflow closure memory-only preview', () => {
  it('switches internal severity policy and only skips the low/medium same-owner management duty', () => {
    setup();
    expect(screen.getByRole('alert')).toHaveTextContent('仅内存交互样例，非生产，不连接API/不代表验收');
    for (const severity of ['低风险', '中风险', '高风险', '重大风险']) {
      select(severity);
      click('提交新轮次');
      expect(duty('专业审核')).toHaveTextContent('待审核');
      const management = severity === '低风险' || severity === '中风险' ? '经理审核' : '部长审核';
      expect(duty(management)).toHaveTextContent('待审核');
      expect(within(current()).queryByRole('group', { name: management === '经理审核' ? '部长审核' : '经理审核' })).not.toBeInTheDocument();
      click(`${management}通过`);
      expect(within(current()).getByRole('status')).toHaveTextContent('审核中');
      click('专业审核通过');
      expect(within(current()).getByRole('status')).toHaveTextContent('本轮汇聚完成（仅样例）');
    }
    select('低风险');
    fireEvent.click(screen.getByRole('checkbox', { name: '演示负责人 = 经理' }));
    click('提交新轮次');
    expect(duty('经理审核')).toHaveTextContent('同人跳过（仅管理侧）');
    expect(duty('专业审核')).toHaveTextContent('待审核');
    expect(within(current()).getByRole('status')).toHaveTextContent('审核中');
    expect(screen.getByRole('radio', { name: '供应商' })).toBeDisabled();
    click('专业审核通过');
    select('中风险');
    click('提交新轮次');
    expect(duty('经理审核')).toHaveTextContent('同人跳过（仅管理侧）');
    click('专业审核通过');
    select('高风险');
    click('提交新轮次');
    expect(duty('部长审核')).toHaveTextContent('待审核');
    expect(within(current()).getByRole('status')).toHaveTextContent('审核中');
  }, 30000);

  it('gates supplier management behind professional review, joins both duties, and explicitly confirms same-person records', () => {
    setup();
    select('供应商');
    for (const severity of ['低风险', '中风险', '高风险', '重大风险']) {
      select(severity);
      click('提交新轮次');
      expect(duty('经理审核')).toHaveTextContent('等待专业通过');
      expect(screen.getByRole('button', { name: '经理审核通过' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '经理审核退回' })).toBeDisabled();
      click('专业审核通过');
      click('经理审核通过');
      if (severity === '高风险' || severity === '重大风险') {
        expect(within(current()).getByRole('status')).toHaveTextContent('审核中');
        expect(duty('部长审核')).toHaveTextContent('待审核');
        click('部长审核通过');
      }
      expect(within(current()).getByRole('status')).toHaveTextContent('本轮汇聚完成（仅样例）');
    }
    fireEvent.click(screen.getByRole('checkbox', { name: '演示经理 = 部长' }));
    click('提交新轮次');
    const confirm = screen.getByRole('button', { name: '一次确认经理与部长（两份记录）' });
    expect(confirm).toBeDisabled();
    click('专业审核通过');
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '我确认同时履行经理与部长两项职责' }));
    fireEvent.click(confirm);
    expect(duty('经理审核')).toHaveTextContent('已通过');
    expect(duty('部长审核')).toHaveTextContent('已通过');
    expect(duty('经理审核')).toHaveTextContent('同次确认 R5-M');
    expect(duty('部长审核')).toHaveTextContent('同次确认 R5-M');
    expect(within(current()).getByRole('status')).toHaveTextContent('本轮汇聚完成（仅样例）');
    expect(confirm).toBeDisabled();
  }, 30000);

  it('cancels the entire returned round, isolates history, and restarts both sides on resubmission', () => {
    setup();
    click('提交新轮次');
    click('专业审核通过');
    click('经理审核退回');
    expect(within(current()).getByRole('status')).toHaveTextContent('已退回 / 整轮取消');
    expect(screen.getByRole('button', { name: '专业审核通过' })).toBeDisabled();
    click('重新提交（新轮次）');
    expect(current()).toHaveTextContent('第 2 轮');
    expect(duty('专业审核')).toHaveTextContent('待审核');
    expect(duty('经理审核')).toHaveTextContent('待审核');
    const history = screen.getByRole('region', { name: '历史轮次' });
    expect(history).toHaveTextContent('第 1 轮');
    expect(history).toHaveTextContent('已通过');
    expect(history).toHaveTextContent('已退回');
    expect(history).toHaveTextContent('不计入当前轮');
    expect(within(history).queryByRole('button')).not.toBeInTheDocument();
    click('专业审核退回');
    expect(duty('经理审核')).toHaveTextContent('已取消');
    select('供应商');
    select('高风险');
    fireEvent.click(screen.getByRole('checkbox', { name: '演示经理 = 部长' }));
    click('重新提交（新轮次）');
    click('专业审核通过');
    expect(screen.queryByRole('button', { name: '部长审核退回' })).not.toBeInTheDocument();
    const jointReturn = screen.getByRole('button', { name: '一次退回经理与部长（两份记录）' });
    expect(jointReturn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '我确认同时履行经理与部长两项职责' }));
    fireEvent.click(jointReturn);
    expect(duty('经理审核')).toHaveTextContent('已退回');
    expect(duty('部长审核')).toHaveTextContent('已退回');
    expect(duty('经理审核')).toHaveTextContent('同次确认 R3-M');
    expect(duty('部长审核')).toHaveTextContent('同次确认 R3-M');
    expect(screen.getByRole('button', { name: '一次确认经理与部长（两份记录）' })).toBeDisabled();
    click('重新提交（新轮次）');
    expect(duty('专业审核')).toHaveTextContent('待审核');
    expect(duty('经理审核')).toHaveTextContent('等待专业通过');
    expect(duty('部长审核')).toHaveTextContent('等待专业通过');
    expect(screen.getByRole('checkbox', { name: '我确认同时履行经理与部长两项职责' })).not.toBeChecked();
    click('专业审核通过');
    expect(screen.getByRole('button', { name: '一次确认经理与部长（两份记录）' })).toBeDisabled();
  }, 30000);
});
