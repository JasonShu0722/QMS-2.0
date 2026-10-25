import { ConfigProvider } from 'antd';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/Language';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { ComponentProjectPreview } from './ComponentProjectPreview';

beforeEach(() => {
  // rc-component's fixed test-id otherwise mixes Tooltip and Modal accessible names.
  vi.stubEnv('NODE_ENV', 'development');
});
afterEach(() => vi.unstubAllEnvs());

function setup() {
  localStorage.clear();
  render(<LanguageProvider><ThemeProvider><ConfigProvider theme={{ token: { motion: false } }}><ComponentProjectPreview /></ConfigProvider></ThemeProvider></LanguageProvider>);
}

async function view(label: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '查看交互状态' }));
  fireEvent.click(await screen.findByText(label, { selector: '.ant-select-item-option-content' }));
}

function components() {
  return screen.getByRole('region', { name: '组件映射' });
}

function componentRow(code: string) {
  return within(components()).getByLabelText(`编辑组件 ${code}`).closest('tr')!;
}

async function choose(label: string, option: string, scope: HTMLElement = document.body) {
  fireEvent.mouseDown(within(scope).getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByText(option, { selector: '.ant-select-item-option-content' }));
}

async function editProject(code = 'DEMO-P-001') {
  fireEvent.click(screen.getByRole('button', { name: '维护项目资料' }));
  const dialog = screen.getByRole('dialog', { name: '编辑项目' });
  if (code === 'DEMO-P-002') await choose('选择维护项目', 'DEMO-P-002 · 演示储备项目', dialog);
  return dialog;
}

async function save(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
  const confirm = within(dialog).queryByRole('button', { name: '确认并保存到本地样例' });
  if (confirm) fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

function selectRow(code: string) {
  fireEvent.click(within(componentRow(code)).getByRole('checkbox'));
}

function bulk() {
  fireEvent.click(screen.getByRole('button', { name: '批量设置' }));
  return screen.getByRole('dialog', { name: '批量设置组件映射' });
}

async function confirmBulk(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '确认批量更新' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('component-project isolated interaction preview', { timeout: 60000 }, () => {
  it('requires an explicit stage before creating a project and saves the selected stage', async () => {
    setup();
    fireEvent.click(within(components()).getByRole('button', { name: '新增项目' }));
    const dialog = screen.getByRole('dialog', { name: '新增项目' });
    fireEvent.change(within(dialog).getByLabelText('项目号'), { target: { value: 'DEMO-P-003' } });
    fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '显式阶段项目' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请选择项目阶段');
    expect(within(dialog).getByLabelText('项目号')).toHaveValue('DEMO-P-003');
    expect(within(dialog).getByLabelText('项目名称')).toHaveValue('显式阶段项目');
    expect(within(dialog).getByRole('radio', { name: '新品' })).not.toBeChecked();
    expect(within(dialog).getByRole('radio', { name: '量产' })).not.toBeChecked();
    expect(within(dialog).getByLabelText('项目号')).not.toBeDisabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('radio', { name: '量产' }));
    await save(dialog);
    expect(screen.getByRole('status')).toHaveTextContent('本地样例已更新');
    const saved = await editProject();
    expect(within(saved).getByRole('radio', { name: '新品' })).toBeChecked();
    await choose('选择维护项目', 'DEMO-P-003 · 显式阶段项目', saved);
    expect(within(saved).getByRole('radio', { name: '量产' })).toBeChecked();
    expect(within(saved).getByLabelText('客户质量工程师')).toHaveValue('');
    expect(within(saved).getByLabelText('项目质量工程师')).toHaveValue('');
  });

  it('keeps a missing category hint after import and project-only bulk mapping until category is supplied', async () => {
    setup();
    fireEvent.click(within(components()).getByRole('button', { name: '批量导入基础组件' }));
    const imported = screen.getByRole('dialog', { name: '批量导入基础组件' });
    fireEvent.change(within(imported).getByLabelText('粘贴两列 TSV'), { target: { value: 'P2-IMPORT-001\t分类待补组件' } });
    fireEvent.click(within(imported).getByRole('button', { name: '导入到本地样例' }));
    await waitFor(() => expect(imported).not.toBeInTheDocument());
    const initial = componentRow('P2-IMPORT-001');
    expect(initial).toHaveTextContent('未映射');
    expect(initial).toHaveTextContent('未配置 / 未配置');
    const missingProject = within(initial).getByRole('button', { name: '未检索到映射关系' });
    expect(missingProject).toHaveTextContent('!');
    expect(within(initial).getByRole('button', { name: '未配置产品大类' })).toHaveTextContent('!');
    fireEvent.focus(missingProject);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('未配置所属项目');
    fireEvent.blur(missingProject);
    selectRow('P2-IMPORT-001');
    const project = bulk();
    fireEvent.click(within(project).getByRole('checkbox', { name: '修改项目号' }));
    await choose('批量项目号', 'DEMO-P-002 · 演示储备项目', project);
    await confirmBulk(project);
    const mapped = componentRow('P2-IMPORT-001');
    expect(mapped).toHaveTextContent('演示储备项目');
    expect(mapped).toHaveTextContent('量产');
    expect(within(mapped).queryByRole('button', { name: '未检索到映射关系' })).not.toBeInTheDocument();
    const hint = within(mapped).getByRole('button', { name: '未配置产品大类' });
    expect(hint).toHaveTextContent('!');
    fireEvent.focus(hint);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('未配置产品大类');
    expect(tooltip).not.toHaveTextContent('未检索到映射关系');
    expect(within(mapped).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.blur(hint);
    selectRow('P2-IMPORT-001');
    const category = bulk();
    fireEvent.click(within(category).getByRole('checkbox', { name: '修改产品大类' }));
    fireEvent.change(within(category).getByLabelText('批量产品大类'), { target: { value: '电子组件' } });
    await confirmBulk(category);
    const complete = componentRow('P2-IMPORT-001');
    expect(complete).toHaveTextContent('电子组件 / 未配置');
    expect(within(complete).getAllByText('未配置')).toHaveLength(2);
    expect(within(complete).queryByText('!')).not.toBeInTheDocument();
    expect(within(complete).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('changes one project stage and all three linked components share it', async () => {
    setup();
    const dialog = await editProject();
    fireEvent.click(within(dialog).getByRole('radio', { name: '量产' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
    expect(within(dialog).getByRole('region', { name: '项目共享影响预览' })).toHaveTextContent('未选组件 4');
    expect(componentRow('DEMO-CONTROL-001')).toHaveTextContent('新品');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认并保存到本地样例' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    for (const code of ['DEMO-CONTROL-001', 'DEMO-DRIVE-002', 'DEMO-UNIT-003']) {
      expect(componentRow(code)).toHaveTextContent('量产');
    }
    expect(screen.getByText(/不联动阶段门或审批/)).toBeVisible();
  });

  it('allows both project engineers to stay empty and propagates the empty values', async () => {
    setup();
    const dialog = await editProject('DEMO-P-002');
    expect(within(dialog).getByLabelText('客户质量工程师')).toHaveValue('');
    expect(within(dialog).getByLabelText('项目质量工程师')).toHaveValue('');
    fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '空工程师项目' } });
    await save(dialog);
    fireEvent.click(within(components()).getByRole('button', { name: '编辑组件 DEMO-UNMAPPED' }));
    const componentDialog = screen.getByRole('dialog', { name: '编辑组件' });
    fireEvent.mouseDown(within(componentDialog).getByRole('combobox', { name: '所属项目' }));
    fireEvent.click(await screen.findByText('DEMO-P-002 · 空工程师项目', { selector: '.ant-select-item-option-content' }));
    await save(componentDialog);
    const linked = componentRow('DEMO-UNMAPPED');
    expect(linked).toHaveTextContent('量产');
    expect(within(linked).getAllByText('未配置')).toHaveLength(2);
    expect(within(linked).queryByRole('button', { name: '未检索到映射关系' })).not.toBeInTheDocument();
  });

  it('never overwrites a nonempty manual engineer and shows current / suggested values on focus', async () => {
    setup();
    const row = componentRow('DEMO-DRIVE-002');
    expect(row).toHaveTextContent('演示工程师丙');
    const hint = within(row).getByRole('button', { name: '项目质量工程师存在差异' });
    fireEvent.focus(hint);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('当前：演示工程师丙');
    expect(tooltip).toHaveTextContent('建议：演示工程师乙');
    expect(within(row).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.blur(hint);
    const dialog = await editProject();
    fireEvent.change(within(dialog).getByLabelText('项目质量工程师'), { target: { value: '演示工程师丁' } });
    await save(dialog);
    const changed = componentRow('DEMO-DRIVE-002');
    expect(changed).toHaveTextContent('演示工程师丙');
    fireEvent.click(within(changed).getByRole('button', { name: '项目质量工程师存在差异' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('建议：演示工程师丁');
    expect(componentRow('DEMO-CONTROL-001')).toHaveTextContent('演示工程师丁');
  });

  it('opens the missing mapping hint on click and restores mapping after local configuration', async () => {
    setup();
    const row = componentRow('DEMO-UNMAPPED');
    fireEvent.click(within(row).getByRole('button', { name: '未检索到映射关系' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('未检索到映射关系');
    fireEvent.click(within(row).getByRole('button', { name: '编辑组件 DEMO-UNMAPPED' }));
    const dialog = screen.getByRole('dialog', { name: '编辑组件' });
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: '所属项目' }));
    fireEvent.click(await screen.findByText('DEMO-P-001 · 演示控制系统', { selector: '.ant-select-item-option-content' }));
    await save(dialog);
    const repaired = componentRow('DEMO-UNMAPPED');
    expect(within(repaired).queryByRole('button', { name: '未检索到映射关系' })).not.toBeInTheDocument();
    expect(repaired).toHaveTextContent('演示控制系统');
    expect(repaired).toHaveTextContent('演示工程师乙');
  });

  it('keeps tables readable and disables all mutations in read-only mode', async () => {
    setup();
    await view('只读查看');
    expect(screen.getByRole('button', { name: '新增项目' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '维护项目资料' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批量导入基础组件' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '批量设置' })).toBeDisabled();
    const panel = components();
    expect(within(panel).getByRole('button', { name: '新增组件' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: '编辑组件 DEMO-UNMAPPED' })).toBeDisabled();
    expect(componentRow('DEMO-CONTROL-001')).toBeVisible();
    expect(within(panel).getAllByRole('checkbox').every(input => (input as HTMLInputElement).disabled)).toBe(true);
  });

  it('protects unsaved changes on cancel and escape, and discards only after confirmation', async () => {
    setup();
    const dialog = await editProject();
    fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '保留的输入' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    const confirmation = await screen.findByRole('dialog', { name: '未保存的修改' });
    fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(confirmation).not.toBeInTheDocument());
    expect(within(dialog).getByLabelText('项目名称')).toHaveValue('保留的输入');
    fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 27 });
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改并关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(componentRow('DEMO-CONTROL-001')).toHaveTextContent('演示控制系统');
  });

  it('freezes inputs while saving and retains failed input for retry', async () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: '模拟保存失败' }));
    const dialog = await editProject();
    fireEvent.change(within(dialog).getByLabelText('项目名称'), { target: { value: '错误保留输入' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
    expect(within(dialog).getByLabelText('项目名称')).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /取\s*消/ })).toBeDisabled();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('模拟保存失败');
    expect(within(dialog).getByLabelText('项目名称')).toHaveValue('错误保留输入');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭失败模拟' }));
    await save(dialog);
    expect(componentRow('DEMO-CONTROL-001')).toHaveTextContent('错误保留输入');
  });

  it('switches empty, loading, error and long-code examples without a business request', async () => {
    setup();
    expect(screen.getByText(/非生产.*刷新后重置/)).toBeVisible();
    await view('空数据');
    expect(screen.getByText('暂无演示数据')).toBeVisible();
    await view('加载中');
    expect(screen.getByRole('status')).toHaveTextContent('正在加载演示数据');
    await view('加载错误');
    expect(screen.getByRole('button', { name: '重试演示读取' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '重试演示读取' }));
    await view('长编码');
    expect(within(components()).getByRole('row', { name: /DEMO-LONG-COMPONENT-CODE/ })).toHaveTextContent('长编码组件');
  });

  it('validates local duplicate / blank codes without losing form input', async () => {
    setup();
    const dialog = await editProject('DEMO-P-002');
    fireEvent.change(within(dialog).getByLabelText('项目号'), { target: { value: 'DEMO-P-001' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('编码已存在');
    expect(within(dialog).getByLabelText('项目号')).toHaveValue('DEMO-P-001');
    fireEvent.change(within(dialog).getByLabelText('项目号'), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存到本地样例' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('编码和名称不能为空');
  });

  it('uses one component table with project maintenance dialogs, never project/component tabs', () => {
    setup();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    for (const name of ['组件号', '组件名称', '项目', '新品 / 量产', '产品大类 / 细分', '客户质量工程师', '项目质量工程师']) {
      expect(screen.getByRole('columnheader', { name })).toBeVisible();
    }
    expect(within(components()).getAllByRole('row')).toHaveLength(5);
  });

  it('imports friendly and IMS two-column TSV as text, skips duplicates without overwriting, and leaves mapping empty', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '批量导入基础组件' }));
    const dialog = screen.getByRole('dialog', { name: '批量导入基础组件' });
    expect(dialog).toHaveTextContent('PROD_ID');
    expect(dialog).toHaveTextContent('MTRL_NAME');
    fireEvent.change(within(dialog).getByLabelText('粘贴两列 TSV'), { target: { value: '组件号\t组件名称\r\nPROD_ID\tMTRL_NAME\r\n成品编码\t物料名称\r\n001.02-03\t控制板(新),^^保留\r\nDEMO-CONTROL-001\t禁止覆盖\r\n001.02-03\t批内重复\r\n000.00-X\t整机（试制）' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '导入到本地样例' }));
    expect(within(dialog).getByLabelText('粘贴两列 TSV')).toBeDisabled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('新增 2 行，跳过重复 2 行');
    const row = componentRow('001.02-03');
    expect(row).toHaveTextContent('控制板(新),^^保留');
    expect(row).toHaveTextContent('未映射');
    expect(row).toHaveTextContent('未配置 / 未配置');
    expect(within(row).queryByText('新品')).not.toBeInTheDocument();
    expect(within(row).queryByText('量产')).not.toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '未检索到映射关系' })).toBeVisible();
    expect(componentRow('DEMO-CONTROL-001')).toHaveTextContent('控制板');
    expect(componentRow('DEMO-CONTROL-001')).toHaveTextContent('演示控制系统');
    expect(screen.queryByText('禁止覆盖')).not.toBeInTheDocument();
    expect(screen.queryByText('批内重复')).not.toBeInTheDocument();
  });

  it('rejects malformed import atomically, retains failed import and protects its draft', async () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: '模拟保存失败' }));
    fireEvent.click(screen.getByRole('button', { name: '批量导入基础组件' }));
    const dialog = screen.getByRole('dialog', { name: '批量导入基础组件' });
    const input = within(dialog).getByLabelText('粘贴两列 TSV');
    fireEvent.change(input, { target: { value: '001-X\t名称\n002-X\t' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '导入到本地样例' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('第 2 行');
    expect(screen.queryByRole('row', { name: /001-X/ })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '001-X\t名称' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '导入到本地样例' }));
    expect(await within(dialog).findByText(/模拟保存失败，输入已保留/)).toBeVisible();
    expect(input).toHaveValue('001-X\t名称');
    fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }));
    fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }));
    expect(input).toHaveValue('001-X\t名称');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭失败模拟' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '导入到本地样例' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(componentRow('001-X')).toHaveTextContent('名称');
  });

  it('maps selected unmapped rows only using enabled fields and preserves existing classification and manual engineers', async () => {
    setup();
    selectRow('DEMO-UNMAPPED');
    selectRow('DEMO-DRIVE-002');
    const dialog = bulk();
    expect(dialog).toHaveTextContent('已选 2 个组件');
    expect(within(dialog).queryByLabelText('组件号')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('组件名称')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: '批量项目号' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '修改项目号' }));
    await choose('批量项目号', 'DEMO-P-001 · 演示控制系统', dialog);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '修改产品大类' }));
    fireEvent.change(within(dialog).getByLabelText('批量产品大类'), { target: { value: '未启用不得覆盖' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '修改产品大类' }));
    expect(within(dialog).getByLabelText('批量产品大类')).toBeDisabled();
    await confirmBulk(dialog);
    const row = componentRow('DEMO-UNMAPPED');
    expect(row).toHaveTextContent('演示控制系统');
    expect(row).toHaveTextContent('新品');
    expect(row).toHaveTextContent('电子组件 / 控制板');
    expect(within(row).queryByRole('button', { name: '未检索到映射关系' })).not.toBeInTheDocument();
    expect(componentRow('DEMO-DRIVE-002')).toHaveTextContent('演示工程师丙');
    expect(componentRow('DEMO-DRIVE-002')).toHaveTextContent('电子组件 / 驱动板');
    expect(screen.queryByText('未启用不得覆盖')).not.toBeInTheDocument();
  });

  it('previews shared project and unselected sibling impact before changing stage or engineers, without silent reassignment', async () => {
    setup();
    selectRow('DEMO-CONTROL-001');
    const dialog = bulk();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '修改新品 / 量产' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: '量产' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '修改项目质量工程师' }));
    fireEvent.change(within(dialog).getByLabelText('批量项目质量工程师'), { target: { value: '演示工程师丁' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
    const preview = within(dialog).getByRole('region', { name: '批量影响预览' });
    expect(preview).toHaveTextContent('DEMO-P-001');
    expect(preview).toHaveTextContent('未选组件 3');
    expect(preview).toHaveTextContent('同项目都会同步');
    expect(preview).toHaveTextContent('量产');
    expect(preview).toHaveTextContent('演示工程师丁');
    expect(componentRow('DEMO-CONTROL-001')).toHaveTextContent('新品');
    fireEvent.click(within(dialog).getByRole('button', { name: '确认批量更新' }));
    expect(within(dialog).getByRole('button', { name: /取\s*消/ })).toBeDisabled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    for (const code of ['DEMO-CONTROL-001', 'DEMO-DRIVE-002', 'DEMO-UNIT-003']) {
      expect(componentRow(code)).toHaveTextContent('量产');
    }
    const manual = componentRow('DEMO-DRIVE-002');
    expect(manual).toHaveTextContent('演示工程师丙');
    fireEvent.click(within(manual).getByRole('button', { name: '项目质量工程师存在差异' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('建议：演示工程师丁');
    expect(componentRow('DEMO-UNMAPPED')).toHaveTextContent('未映射');
  });

  it('requires explicit engineer clearing, invalidates previews on edits, and retains failed bulk input', async () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: '模拟保存失败' }));
    selectRow('DEMO-CONTROL-001');
    const dialog = bulk();
    fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('至少启用一个字段');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '修改客户质量工程师' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('空值不会覆盖');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '明确清空客户质量工程师' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
    expect(within(dialog).getByRole('region', { name: '批量影响预览' })).toHaveTextContent('明确清空');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '修改新品 / 量产' }));
    expect(within(dialog).queryByRole('button', { name: '确认批量更新' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('radio', { name: '量产' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认批量更新' }));
    expect(await within(dialog).findByText(/模拟保存失败，输入已保留/)).toBeVisible();
    expect(within(dialog).getByRole('checkbox', { name: '明确清空客户质量工程师' })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭失败模拟' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '确认批量更新' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const row = componentRow('DEMO-CONTROL-001');
    expect(row).toHaveTextContent('未配置');
    expect(row).not.toHaveTextContent('演示工程师甲');
    expect(row).toHaveTextContent('量产');
  });

  it('blocks shared changes on unmapped rows unless a destination project is explicitly enabled', async () => {
    setup();
    selectRow('DEMO-UNMAPPED');
    const dialog = bulk();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '修改新品 / 量产' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: '量产' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '预览影响' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('未映射组件需明确选择项目');
    expect(within(dialog).queryByRole('button', { name: '确认批量更新' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '修改项目号' }));
    await choose('批量项目号', 'DEMO-P-002 · 演示储备项目', dialog);
    await confirmBulk(dialog);
    expect(componentRow('DEMO-UNMAPPED')).toHaveTextContent('演示储备项目');
    expect(componentRow('DEMO-CONTROL-001')).toHaveTextContent('新品');
  });
});
