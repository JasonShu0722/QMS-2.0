import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { SupplierEightDPreview } from './SupplierEightDPreview';

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const change = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name, { exact: true }), { target: { value } });
const role = (value: string) => change('演示操作身份（非认证）', value);
const section = (name: string) => screen.getByRole('region', { name });
function setup() {
  render(<LanguageProvider><ThemeProvider><SupplierEightDPreview /></ThemeProvider></LanguageProvider>);
}
function release(risk = 'HIGH', same = false) {
  change('供应商单独立风险', risk);
  if (same) click('经理与部长为同一人（演示）');
  change('原因分析 / 对策制定期限', '2026-11-02');
  change('计划关闭时间', '2026-11-16');
  click('预览并释放到演示门户');
  fireEvent.click(screen.getByLabelText('已人工核对外发文字及披露范围（演示）'));
  click('确认释放（仅内存）');
}
function submit() {
  role('SUPPLIER');
  change('完整表单摘要（演示）', '完整 D2～D8 摘要：已核对措施及验证记录');
  fireEvent.click(screen.getByLabelText('已制定对策（演示）'));
  change('完整提交计划时间', '2026-11-09');
  click('完整提交（仅内存）');
}
function sqeApprove() {
  role('SQE');
  change('审核意见', '已核对完整性（演示）');
  click('SQE 通过');
}

describe('supplier independently clickable preview', () => {
  it('labels memory/reset boundaries and releases only reviewed disclosure, without source secrets or fake attachment scanning', () => {
    setup();
    expect(screen.getByText(/刷新即重置/)).toBeInTheDocument();
    expect(screen.getByText(/不是正式 API/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '预览并释放到演示门户' })).toBeDisabled();
    role('SUPPLIER');
    expect(section('供应商可见内容')).toHaveTextContent('尚未释放');
    expect(screen.queryByLabelText('外发草稿文字')).not.toBeInTheDocument();
    role('SQE');
    change('外发草稿文字', '仅披露本企业批次与不良事实');
    release();
    role('SUPPLIER');
    expect(section('供应商可见内容')).toHaveTextContent('仅披露本企业批次与不良事实');
    expect(screen.queryByRole('region', { name: '内部复制与披露' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /下载附件|扫描通过|CLEAN/ })).not.toBeInTheDocument();
  });

  it('locks the submitted version and allows manager/minister in parallel only after SQE', () => {
    setup(); release(); submit();
    expect(section('当前状态')).toHaveTextContent('待 SQE 专业审核');
    expect(screen.getByLabelText('完整表单摘要（演示）')).toBeDisabled();
    role('MANAGER');
    expect(screen.getByRole('button', { name: '经理 通过' })).toBeDisabled();
    sqeApprove();
    role('MINISTER'); change('审核意见', '部长审阅'); click('部长 通过');
    expect(section('当前状态')).toHaveTextContent('待管理审批');
    role('MANAGER'); change('审核意见', '经理审阅'); click('经理 通过');
    expect(section('当前状态')).toHaveTextContent('已关闭（内存演示）');
    expect(section('批准依据')).toHaveTextContent('完整 D2～D8 摘要');
  });

  it('explicitly confirms two same-person duties and leaves two traceable records', async () => {
    setup(); release('CRITICAL', true); submit(); sqeApprove();
    role('MANAGER'); change('审核意见', '同时承担两项职责'); click('同时处理经理与部长职责');
    const dialog = await screen.findByRole('dialog', { name: '同人双职责明确确认' });
    expect(dialog).toHaveTextContent('经理职责');
    expect(dialog).toHaveTextContent('部长职责');
    expect(within(dialog).getByRole('button', { name: '确认两项职责通过' })).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText('我确认本次同时履行经理与部长两项职责'));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认两项职责通过' }));
    const rows = within(screen.getByRole('table', { name: '审核职责记录' })).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[2]).toHaveTextContent('经理');
    expect(rows[3]).toHaveTextContent('部长');
    expect(within(rows[2]).getAllByRole('cell')[3].textContent).toBe(within(rows[3]).getAllByRole('cell')[3].textContent);
    expect(section('当前状态')).toHaveTextContent('已关闭（内存演示）');
  });

  it('return preserves old records but resets SQE and all management on resubmission', () => {
    setup(); release(); submit(); sqeApprove();
    role('MANAGER'); change('审核意见', '经理通过 v1'); click('经理 通过');
    role('MINISTER'); change('审核意见', '验证记录待补充'); click('部长 退回');
    expect(section('当前状态')).toHaveTextContent('退回供应商修改');
    role('SUPPLIER'); change('完整表单摘要（演示）', '修改后 v2'); click('完整提交（仅内存）');
    expect(section('当前状态')).toHaveTextContent('第 2 轮');
    expect(section('当前状态')).toHaveTextContent('待 SQE 专业审核');
    role('MANAGER'); expect(screen.getByRole('button', { name: '经理 通过' })).toBeDisabled();
    sqeApprove(); role('MANAGER');
    change('审核意见', '经理重新审阅'); click('经理 通过');
    expect(section('当前状态')).toHaveTextContent('待管理审批');
    expect(screen.getByRole('table', { name: '审核职责记录' })).toHaveTextContent('旧轮失效');
  });

  it('keeps the independent extension SQE→manager, excludes minister, and changes only the final effective date', () => {
    setup(); release(); role('SUPPLIER');
    change('申请延期至', '2026-11-05'); click('申请延期（仅内存）');
    expect(section('阶段期限与独立延期')).toHaveTextContent('原有效期限继续计时');
    role('MINISTER'); expect(screen.getByRole('button', { name: '批准本级延期' })).toBeDisabled();
    role('SQE'); click('批准本级延期');
    expect(screen.getByLabelText('原因分析 / 对策制定期限')).toHaveValue('2026-11-02');
    role('MANAGER'); click('批准本级延期');
    expect(screen.getByLabelText('原因分析 / 对策制定期限')).toHaveValue('2026-11-05');
    expect(section('当前状态')).toHaveTextContent('供应商填写中');
  });

  it('allows only SQE/local manager closed supplements, does not overwrite the approved or supplier-visible version', () => {
    setup(); release('LOW'); submit(); sqeApprove();
    role('MANAGER'); change('审核意见', '经理通过'); click('经理 通过');
    for (const actor of ['SUPPLIER', 'MINISTER', 'OTHER_MANAGER']) {
      role(actor);
      expect(screen.queryByRole('button', { name: '保存闭后补充（仅内存）' })).not.toBeInTheDocument();
    }
    role('MANAGER'); change('闭后补充说明', '本单经理补充资料'); click('保存闭后补充（仅内存）');
    expect(section('当前内部补充')).toHaveTextContent('本单经理补充资料');
    expect(section('批准依据')).not.toHaveTextContent('本单经理补充资料');
    expect(within(screen.getByRole('table', { name: '审核职责记录' })).getAllByRole('row')).toHaveLength(3);
    role('SUPPLIER'); expect(screen.queryByText('本单经理补充资料')).not.toBeInTheDocument();
  });

  it('supports keyboard activation and requires confirmation before discarding the memory scenario', async () => {
    setup();
    const user = userEvent.setup();
    const reset = screen.getByRole('button', { name: '重置交互样例' });
    reset.focus(); await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: '重置内存样例？' });
    expect(dialog).toHaveTextContent('清除');
    fireEvent.click(within(dialog).getByRole('button', { name: '继续当前样例' }));
    expect(screen.getByLabelText('供应商单独立风险')).toHaveValue('HIGH');
  });
});
